// app/api/crm-purchases/route.js
// Queries CRM MySQL for rejected, pending, walk-in, and blacklisted data

import mysql    from 'mysql2/promise'
import postgres  from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { aliasBranchName } from '../../../lib/crmBranchAlias'

const REGION_BYPASS_ROLES = new Set(['super_admin', 'founders_office', 'admin'])

// Returns the user's allowed regions array, or null when unrestricted (bypass role
// or no scoping set). Reads user_profiles directly via the supabase admin client
// (which bypasses RLS) to dodge any PostgREST schema cache staleness.
async function getAllowedRegionsForAuth(supabase, auth) {
  if (!auth || REGION_BYPASS_ROLES.has(auth.role)) return null
  const uid = auth.user?.id || auth.profile?.id
  if (!uid) return null
  const { data: prof } = await supabase
    .from('user_profiles')
    .select('allowed_regions')
    .eq('id', uid)
    .maybeSingle()
  const regions = Array.isArray(prof?.allowed_regions) ? prof.allowed_regions : []
  return regions.length === 0 ? null : regions
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const ALLOWED_ACTIONS = new Set(['rejected', 'pending', 'walkin', 'blacklisted', 'branches', 'kpis', 'live', 'flashcards'])

// In-memory cache for the lightweight `flashcards` endpoint. LiveFeedFlashcards
// + the dashboard panel both poll every 10s; a small TTL coalesces concurrent
// callers (and same caller across ticks) so we don't run the MySQL queries
// every time. 5s keeps us inside the ops-stated "5-10s is fine" tolerance.
// Cache key includes the region-scope fingerprint so a region-restricted user
// can never read another scope's cached payload.
const FLASHCARD_CACHE_TTL_MS = 5000
const FLASHCARD_CACHE_MAX    = 50
const flashcardCache = new Map()

let _pool
function createConn() {
  if (!_pool) {
    _pool = mysql.createPool({
      host:             process.env.CRM_DB_HOST,
      port:             parseInt(process.env.CRM_DB_PORT || '3306'),
      database:         process.env.CRM_DB_NAME,
      user:             process.env.CRM_DB_USER,
      password:         process.env.CRM_DB_PASSWORD,
      waitForConnections: true,
      connectionLimit:    3,
      queueLimit:         0,
    })
  }
  return _pool.getConnection()
}

export async function GET(req) {
  // Operational read — any authenticated user. Customer PII flows through here
  // (rejected/pending/walkin lists), so anonymous reads were a privacy leak.
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const action   = searchParams.get('action') || ''
  const page     = Math.max(0, parseInt(searchParams.get('page') || '0'))
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') || '100')))
  const branch   = searchParams.get('branch') || ''
  const fromDate = searchParams.get('from')   || ''
  const toDate   = searchParams.get('to')     || ''
  const search   = searchParams.get('search') || ''
  const reason   = searchParams.get('reason') || ''

  if (!ALLOWED_ACTIONS.has(action)) {
    return Response.json({ error: 'Invalid action' }, { status: 400 })
  }

  // ── FLASHCARDS endpoint ──────────────────────────────────────────────────
  // Backs LiveFeedFlashcards. Two-source design — same answer as the rest
  // of the app:
  //   • PURCHASED count + weight + value: from Supabase (via the same
  //     get_purchase_aggregates RPC the dashboard panel and Purchase Reports
  //     use). Guarantees the flashcards never disagree with Purchase Reports
  //     by construction. Lags CRM by the sync interval (~10s, accepted).
  //   • WALKED IN count + weight: from CRM customer_walkin (this data does
  //     not exist in Supabase — sync only mirrors purchases). Real-time.
  // Cache check happens BEFORE acquiring a MySQL pool connection so cache
  // hits don't queue behind other in-flight queries.
  if (action === 'flashcards') {
    const istNow     = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    const defaultIST = istNow.toISOString().split('T')[0]
    const todayIST   = searchParams.get('date') || defaultIST

    const allowedRegions = await getAllowedRegionsForAuth(supabase, auth)
    const cacheKey = `${todayIST}::${(allowedRegions || ['ALL']).slice().sort().join(',')}`

    const cached = flashcardCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < FLASHCARD_CACHE_TTL_MS) {
      return Response.json({ ...cached.data, cached: true })
    }

    let conn
    try {
      // Region-scoped users need a branch→region map (CRM has only branch
      // IDs). Admin/founder/super_admin skip this Supabase round trip.
      const needRegionMap = !!allowedRegions

      // Resolve allowed branch *names* for the Supabase aggregate call — the
      // RPC expects branch names, not regions. For unrestricted users we
      // pass null (= all branches).
      let regionBranches = null
      if (allowedRegions) {
        const { data: sbBranches } = await supabase
          .from('branches')
          .select('name')
          .eq('is_active', true)
          .in('region', allowedRegions)
        regionBranches = (sbBranches || []).map(b => b.name)
        if (regionBranches.length === 0) {
          // No accessible branches → empty result, no point hitting CRM.
          const empty = {
            todayIST,
            walkinSummary: { total: 0, total_gold_wt: 0 },
            summary:       { approved: 0, approved_value: 0 },
            goldPipeline:  { walked_in_wt: 0, purchased_wt: 0 },
          }
          flashcardCache.set(cacheKey, { data: empty, ts: Date.now() })
          return Response.json(empty)
        }
      }

      conn = await createConn()

      // CRM walk-ins + branch→region map (for filtering walk-ins) +
      // Supabase aggregate (for purchased numbers) all in parallel.
      const [
        [walkinRows],
        sbBranchesForMap,
        agg,
      ] = await Promise.all([
        conn.execute(`
          SELECT
            branch_id,
            COUNT(*) AS bills,
            -- Only sum weights that look like real gold weights. Lead-form
            -- bugs occasionally copy the customer's 10-digit mobile into
            -- gms_weight; without this guard a single bad row poisons the
            -- daily total by ~9 billion grams. Heuristic: valid = below
            -- 10000 OR has a decimal component. A genuine 9.876 gram entry
            -- has decimals; a 9876543210 phone number does not.
            ROUND(SUM(CASE
              WHEN (gms_weight + 0) < 10000
                OR (gms_weight + 0) != FLOOR(gms_weight + 0)
              THEN gms_weight + 0
              ELSE 0
            END), 2) AS wt
          FROM customer_walkin
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
          GROUP BY branch_id
        `, [todayIST]),
        needRegionMap
          ? supabase.from('branches').select('crm_branch_id, region').not('region', 'is', null)
          : Promise.resolve({ data: [] }),
        supabase.rpc('get_purchase_aggregates', {
          p_from_date:        todayIST,
          p_to_date:          todayIST,
          p_branch:           null,
          p_txn_type:         null,
          p_region_branches:  regionBranches,
          p_single_day:       true,
        }),
      ])

      // Build branch→region map for walk-in scoping.
      const regionMap = {}
      for (const b of (sbBranchesForMap?.data || [])) {
        if (b.crm_branch_id) regionMap[String(b.crm_branch_id)] = b.region
      }
      const allowedSet = needRegionMap ? new Set(allowedRegions) : null
      const inAllowed  = (branchId) => !needRegionMap || allowedSet.has(regionMap[String(branchId)] || '')

      let walkedInCount = 0
      let walkedInWt    = 0
      for (const r of walkinRows) {
        if (!inAllowed(r.branch_id)) continue
        walkedInCount += Number(r.bills) || 0
        walkedInWt    += parseFloat(r.wt) || 0
      }

      // ── New CRM live — walk-ins (every Transaction today) + completed
      //    bills, queried directly so the dashboard matches the Live Feed
      //    instead of waiting for the sync. Walk-ins add to the old-CRM count;
      //    completed feed the LIVE purchased calc below. Best-effort +
      //    region-scoped; if the new CRM is unreachable we keep the synced
      //    numbers.
      let ncCompleted = 0, ncCompletedNet = 0, ncCompletedGross = 0, ncCompletedValue = 0, ncLiveOk = false
      try {
        const sslOpt = process.env.NEW_CRM_DB_CA
          ? { ca: process.env.NEW_CRM_DB_CA, rejectUnauthorized: true }
          : { rejectUnauthorized: false }
        const ncSql = postgres({
          host:     process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
          port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
          database: process.env.NEW_CRM_DB_NAME,
          username: process.env.NEW_CRM_DB_USER,
          password: process.env.NEW_CRM_DB_PASSWORD,
          ssl:      sslOpt, connect_timeout: 3, max: 1,
        })
        try {
          const dayStart = `${todayIST}T00:00:00+05:30`
          const dayEnd   = `${todayIST}T23:59:59+05:30`
          // Walk-ins = every transaction created today (provisional gross
          // weight). Dated by created_at — a walk-in belongs to the day the
          // customer came in.
          const ncWalkRows = await ncSql`
            SELECT b.name AS branch,
                   COUNT(*)::int AS c,
                   COALESCE(ROUND(SUM(ow.gross_weight)::numeric, 2), 0) AS wt
            FROM "Transaction" t
            LEFT JOIN "Branch" b ON b.id = t.branch_id
            LEFT JOIN (
              -- Union-dedup gross (estimation OR quotation link, deduped by
              -- ornament_id) — same basis as the Live Feed "Total Today", so the
              -- dashboard Walked-In weight matches it. Quotation-only missed all
              -- estimation-stage gross (undercounted ~2.1 kg on a 189-walk-in day).
              SELECT tid AS transaction_id, SUM(gw) AS gross_weight FROM (
                SELECT DISTINCT ON (tid, COALESCE(ornament_id, oid)) tid, gw FROM (
                  SELECT q.transaction_id tid, o.ornament_id, o.id::text oid, o.gross_weight gw, o.approve ap, o.created_at ca, 2 sr
                  FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id = q.id
                  UNION ALL
                  SELECT e.transaction_id, o.ornament_id, o.id::text, o.gross_weight, o.approve, o.created_at, 1
                  FROM "Estimation" e JOIN "Ornament" o ON o.estimation_id = e.id
                ) z ORDER BY tid, COALESCE(ornament_id, oid), sr DESC, ap DESC NULLS LAST, ca DESC
              ) y GROUP BY tid
            ) ow ON ow.transaction_id = t.id
            WHERE t.created_at BETWEEN ${dayStart} AND ${dayEnd}
            GROUP BY b.name
          `
          // Purchases (completed) — IDENTICAL basis to the Live Feed COMPLETED
          // card and the master: final-payment date (== invoice day), APPROVED
          // ornaments only, deduped by ornament_id. Keeps the dashboard's
          // Purchased number/weight in lockstep with the Live Feed.
          const ncDoneRows = await ncSql`
            WITH ap AS (
              SELECT q.transaction_id tid, o.ornament_id, o.id::text oid, o.net_weight nw, o.gross_weight gw, o.created_at ca
              FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id = q.id WHERE o.approve = true
              UNION ALL
              SELECT e.transaction_id, o.ornament_id, o.id::text, o.net_weight, o.gross_weight, o.created_at
              FROM "Estimation" e JOIN "Ornament" o ON o.estimation_id = e.id WHERE o.approve = true
            ),
            dd AS (SELECT DISTINCT ON (tid, COALESCE(ornament_id, oid)) tid, nw, gw FROM ap ORDER BY tid, COALESCE(ornament_id, oid), ca DESC),
            ow AS (SELECT tid, SUM(nw) n, SUM(gw) g FROM dd GROUP BY tid)
            SELECT b.name AS branch,
                   COUNT(*)::int AS done,
                   COALESCE(ROUND(SUM(ow.n)::numeric, 2), 0) AS done_net,
                   COALESCE(ROUND(SUM(ow.g)::numeric, 2), 0) AS done_gross,
                   COALESCE(ROUND(SUM(q.final_amount)::numeric, 0), 0) AS done_val
            FROM "Transaction" t
            LEFT JOIN "Branch" b ON b.id = t.branch_id
            JOIN LATERAL (SELECT MAX(created_at) fp FROM "Payment" WHERE transaction_id = t.id AND status = 'COMPLETED' AND type = 'FINAL_PAYMENT') f ON true
            LEFT JOIN ow ON ow.tid = t.id
            LEFT JOIN LATERAL (SELECT final_amount FROM "Quotation" WHERE transaction_id = t.id ORDER BY updated_at DESC LIMIT 1) q ON true
            WHERE t.status = 'FINAL_PAYMENT_COMPLETED'
              AND (f.fp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = ${todayIST}::date
            GROUP BY b.name
          `
          // Re-walk-ins — a customer who walked in on an EARLIER day and CLOSED
          // (final payment completed) TODAY. The NEW CRM stores only the first
          // walk-in + the closing payment, so the re-visit is inferred from
          // final-payment date ≠ walk-in (created) date. Counted as a walk-in on
          // the closing day, so Total walk-ins = fresh + re-walk-ins. Same
          // provisional union-dedup gross basis as the fresh walk-in query.
          const ncRewalkRows = await ncSql`
            SELECT b.name AS branch,
                   COUNT(*)::int AS c,
                   COALESCE(ROUND(SUM(ow.gross_weight)::numeric, 2), 0) AS wt
            FROM "Transaction" t
            LEFT JOIN "Branch" b ON b.id = t.branch_id
            JOIN LATERAL (SELECT MAX(created_at) fp FROM "Payment" WHERE transaction_id = t.id AND status = 'COMPLETED' AND type = 'FINAL_PAYMENT') f ON true
            LEFT JOIN (
              SELECT tid AS transaction_id, SUM(gw) AS gross_weight FROM (
                SELECT DISTINCT ON (tid, COALESCE(ornament_id, oid)) tid, gw FROM (
                  SELECT q.transaction_id tid, o.ornament_id, o.id::text oid, o.gross_weight gw, o.approve ap, o.created_at ca, 2 sr
                  FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id = q.id
                  UNION ALL
                  SELECT e.transaction_id, o.ornament_id, o.id::text, o.gross_weight, o.approve, o.created_at, 1
                  FROM "Estimation" e JOIN "Ornament" o ON o.estimation_id = e.id
                ) z ORDER BY tid, COALESCE(ornament_id, oid), sr DESC, ap DESC NULLS LAST, ca DESC
              ) y GROUP BY tid
            ) ow ON ow.transaction_id = t.id
            WHERE t.status = 'FINAL_PAYMENT_COMPLETED'
              AND (f.fp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = ${todayIST}::date
              AND t.created_at < ${dayStart}
            GROUP BY b.name
          `
          let regionByName = null
          if (needRegionMap) {
            const { data: brAll } = await supabase.from('branches').select('name, region').not('region', 'is', null)
            regionByName = {}
            for (const b of (brAll || [])) regionByName[(b.name || '').trim().toLowerCase()] = b.region
          }
          const inAllowedBranch = (name) => {
            const canon = aliasBranchName(name)
            return !needRegionMap || allowedSet.has(regionByName[(canon || '').trim().toLowerCase()] || '')
          }
          for (const r of ncWalkRows) {
            if (!inAllowedBranch(r.branch)) continue
            walkedInCount += Number(r.c)      || 0
            walkedInWt    += parseFloat(r.wt) || 0
          }
          // Add re-walk-ins (walked in earlier, closed today) to the walk-in total.
          for (const r of ncRewalkRows) {
            if (!inAllowedBranch(r.branch)) continue
            walkedInCount += Number(r.c)      || 0
            walkedInWt    += parseFloat(r.wt) || 0
          }
          for (const r of ncDoneRows) {
            if (!inAllowedBranch(r.branch)) continue
            ncCompleted      += Number(r.done)           || 0
            ncCompletedNet   += parseFloat(r.done_net)   || 0
            ncCompletedGross += parseFloat(r.done_gross) || 0
            ncCompletedValue += parseFloat(r.done_val)   || 0
          }
          ncLiveOk = true
        } finally { await ncSql.end() }
      } catch { /* new CRM offline — keep old-CRM + synced numbers */ }

      // Purchased = old CRM (synced purchases aggregate, ~live) + new CRM
      // (LIVE completed from the query above). The synced purchases table lags
      // the new CRM, so subtract the synced new_crm slice and add the live
      // completed counts — old CRM stays from the aggregate.
      // purchased_wt is GROSS (the dashboard card shows gross weight, matching
      // the Live Feed "Total Today" gross basis).
      const kpis = agg?.data?.kpis || {}
      let purchasedCount = Number(kpis.total_count) || 0
      let purchasedWt    = Number(kpis.total_gross) || 0
      let approvedValue  = Number(kpis.total_value) || 0
      if (ncLiveOk) {
        let nsq = supabase.from('purchases')
          .select('gross_weight, total_amount')
          .eq('crm_source', 'new_crm').eq('crm_status', 'approved')
          .eq('purchase_date', todayIST)
        if (regionBranches) nsq = nsq.in('branch_name', regionBranches)
        const { data: nsRows } = await nsq
        const nsCount = (nsRows || []).length
        const nsGross = (nsRows || []).reduce((s, r) => s + (Number(r.gross_weight) || 0), 0)
        const nsVal   = (nsRows || []).reduce((s, r) => s + (Number(r.total_amount) || 0), 0)
        purchasedCount = Math.max(0, purchasedCount - nsCount + ncCompleted)
        purchasedWt    = Math.max(0, purchasedWt    - nsGross + ncCompletedGross)
        approvedValue  = Math.max(0, approvedValue  - nsVal   + ncCompletedValue)
      }

      const result = {
        todayIST,
        walkinSummary: {
          total:         walkedInCount,
          total_gold_wt: Number(walkedInWt.toFixed(2)),
        },
        summary: {
          approved:       purchasedCount,
          approved_value: Number(approvedValue.toFixed(2)),
        },
        goldPipeline: {
          walked_in_wt: Number(walkedInWt.toFixed(2)),
          purchased_wt: Number(purchasedWt.toFixed(2)),
        },
      }

      flashcardCache.set(cacheKey, { data: result, ts: Date.now() })
      if (flashcardCache.size > FLASHCARD_CACHE_MAX) {
        flashcardCache.delete(flashcardCache.keys().next().value)
      }
      return Response.json(result)
    } catch (err) {
      console.error('Flashcards error:', err)
      return Response.json({ error: err.message }, { status: 500 })
    } finally {
      if (conn) conn.release()
    }
  }

  // ── All other actions share an outer pool connection ────────────────────
  let conn
  try {
    conn = await createConn()

    // ── REJECTED BILLS ───────────────────────────────────────────────────────
    if (action === 'rejected') {
      const conditions = ["t.trxn_status = 'rejected'"]
      const params = []
      if (branch)   { conditions.push('t.branch_id = ?');                                  params.push(branch) }
      if (fromDate) { conditions.push('DATE(t.date + INTERVAL 330 MINUTE) >= ?');          params.push(fromDate) }
      if (toDate)   { conditions.push('DATE(t.date + INTERVAL 330 MINUTE) <= ?');          params.push(toDate) }
      if (search)   { conditions.push('(t.cust_name LIKE ? OR t.bill_no LIKE ? OR t.cust_mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }
      if (reason)   { conditions.push('t.txn_rmrk LIKE ?');                                params.push(`%${reason}%`) }

      const where = conditions.join(' AND ')
      const offset = page * pageSize

      const [[{ total }]] = await conn.execute(
        `SELECT COUNT(*) AS total FROM transac_tbl t WHERE ${where}`,
        params
      )

      const [rows] = await conn.execute(
        `SELECT
           t.id, t.bill_no, t.cust_name, t.cust_mobile,
           DATE(t.date + INTERVAL 330 MINUTE) AS txn_date,
           t.time, t.branch_id, t.type_gold,
           t.finl_amnt, t.txn_rmrk, t.trxn_status,
           b.brnch_name AS branch_name
         FROM transac_tbl t
         LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
         WHERE ${where}
         ORDER BY t.date DESC, t.time DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      )

      const [topReasons] = await conn.execute(
        `SELECT IFNULL(txn_rmrk, '(blank)') AS reason, COUNT(*) AS count
         FROM transac_tbl
         WHERE trxn_status = 'rejected'
         GROUP BY txn_rmrk
         ORDER BY count DESC
         LIMIT 12`
      )

      return Response.json({ rows, total, topReasons, page, pageSize })
    }

    // ── PENDING BILLS ────────────────────────────────────────────────────────
    if (action === 'pending') {
      const conditions = ["t.trxn_status = 'pending'"]
      const params = []
      if (branch)   { conditions.push('t.branch_id = ?');                                  params.push(branch) }
      if (fromDate) { conditions.push('DATE(t.date + INTERVAL 330 MINUTE) >= ?');          params.push(fromDate) }
      if (toDate)   { conditions.push('DATE(t.date + INTERVAL 330 MINUTE) <= ?');          params.push(toDate) }
      if (search)   { conditions.push('(t.cust_name LIKE ? OR t.bill_no LIKE ? OR t.cust_mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }

      const where = conditions.join(' AND ')
      const offset = page * pageSize

      const [[{ total }]] = await conn.execute(
        `SELECT COUNT(*) AS total FROM transac_tbl t WHERE ${where}`,
        params
      )

      const [rows] = await conn.execute(
        `SELECT
           t.id, t.bill_no, t.cust_name, t.cust_mobile,
           DATE(t.date + INTERVAL 330 MINUTE) AS txn_date,
           t.time, t.branch_id, t.type_gold,
           t.finl_amnt, t.txn_rmrk,
           t.pymt_mde, t.pmt_status, t.trxn_status,
           DATEDIFF(CURDATE(), DATE(t.date + INTERVAL 330 MINUTE)) AS days_pending,
           b.brnch_name AS branch_name
         FROM transac_tbl t
         LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
         WHERE ${where}
         ORDER BY t.date DESC, t.time DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      )

      return Response.json({ rows, total, page, pageSize })
    }

    // ── WALK-IN PIPELINE ─────────────────────────────────────────────────────
    if (action === 'walkin') {
      const PIPELINE_STATUSES = ['visited not sold', 'enquiry', 'planning to visit', 'call later']
      const statusPlaceholders = PIPELINE_STATUSES.map(() => '?').join(',')
      const conditions = [`cw.walkin_status IN (${statusPlaceholders})`]
      const params = [...PIPELINE_STATUSES]

      if (branch)   { conditions.push('cw.branch_id = ?');                                                params.push(branch) }
      if (fromDate) { conditions.push('DATE(cw.date + INTERVAL 330 MINUTE) >= ?');                      params.push(fromDate) }
      if (toDate)   { conditions.push('DATE(cw.date + INTERVAL 330 MINUTE) <= ?');                      params.push(toDate) }
      if (search)   { conditions.push('(cw.cust_name LIKE ? OR cw.cust_mobile LIKE ?)');               params.push(`%${search}%`, `%${search}%`) }

      const where = conditions.join(' AND ')
      const offset = page * pageSize

      const [[{ total }]] = await conn.execute(
        `SELECT COUNT(*) AS total FROM customer_walkin cw WHERE ${where}`,
        params
      )

      const [rows] = await conn.execute(
        `SELECT
           cw.id, cw.cust_name, cw.cust_mobile, cw.item_type, cw.gms_weight,
           cw.walkin_status, cw.walk_reason, cw.source,
           DATE(cw.date + INTERVAL 330 MINUTE) AS walkin_date,
           cw.time, cw.branch_id, b.brnch_name AS branch_name
         FROM customer_walkin cw
         LEFT JOIN branch_tbl b ON b.brnch_id = cw.branch_id
         WHERE ${where}
         ORDER BY cw.date DESC, cw.time DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      )

      // Conversion rates by branch (all time, unfiltered)
      const [branchStats] = await conn.execute(
        `SELECT
           cw.branch_id, b.brnch_name AS branch_name,
           COUNT(*) AS total_walkin,
           SUM(CASE WHEN cw.walkin_status = 'sold' THEN 1 ELSE 0 END) AS sold_count,
           SUM(CASE WHEN cw.walkin_status IN ('visited not sold','enquiry','planning to visit','call later') THEN 1 ELSE 0 END) AS pipeline_count
         FROM customer_walkin cw
         LEFT JOIN branch_tbl b ON b.brnch_id = cw.branch_id
         GROUP BY cw.branch_id, b.brnch_name
         ORDER BY total_walkin DESC
         LIMIT 25`
      )

      // Walk reason distribution
      const [reasonDist] = await conn.execute(
        `SELECT
           IFNULL(walk_reason, '(not specified)') AS reason,
           COUNT(*) AS count
         FROM customer_walkin
         WHERE walkin_status IN (${statusPlaceholders})
         GROUP BY walk_reason
         ORDER BY count DESC
         LIMIT 10`,
        PIPELINE_STATUSES
      )

      return Response.json({ rows, total, branchStats, reasonDist, page, pageSize })
    }

    // ── BLACKLISTED CUSTOMERS ────────────────────────────────────────────────
    if (action === 'blacklisted') {
      const conditions = ['1=1']
      const params = []
      if (search) { conditions.push('(name LIKE ? OR mob_num LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
      if (reason) { conditions.push('rej_rsn LIKE ?'); params.push(`%${reason}%`) }

      const where = conditions.join(' AND ')
      const offset = page * pageSize

      const [[{ total }]] = await conn.execute(
        `SELECT COUNT(*) AS total FROM rejctd_tbl WHERE ${where}`,
        params
      )

      const [rows] = await conn.execute(
        `SELECT * FROM rejctd_tbl WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      )

      const [reasonDist] = await conn.execute(
        `SELECT IFNULL(rej_rsn, '(not specified)') AS reason, COUNT(*) AS count
         FROM rejctd_tbl
         GROUP BY rej_rsn
         ORDER BY count DESC
         LIMIT 15`
      )

      return Response.json({ rows, total, reasonDist, page, pageSize })
    }

    // ── BRANCH LIST (for filter dropdowns) ──────────────────────────────────
    if (action === 'branches') {
      const [branches] = await conn.execute(
        `SELECT brnch_id, brnch_name FROM branch_tbl ORDER BY brnch_name`
      )
      return Response.json({ branches })
    }

    // ── LIVE FEED ─────────────────────────────────────────────────────────────
    if (action === 'live') {
      const istNow  = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
      const defaultIST = istNow.toISOString().split('T')[0]
      // Allow explicit date override via ?date=; default to today IST
      const todayIST = searchParams.get('date') || defaultIST

      // Supabase branches + all old-CRM queries run in parallel
      const [
        { data: sbBranches },
        [[walkinSummary]],
        [ornmentRows],
        [branches],
        [hourly],
        [todayTxns],
        [todayWalkins],
        [kycRows],
        [takeoverRows],
      ] = await Promise.all([
        supabase.from('branches').select('crm_branch_id, name, region').not('region', 'is', null),

        // 1. Walk-in summary
        conn.execute(`
          SELECT
            COUNT(*)                                                                    AS total,
            SUM(CASE WHEN walkin_status='sold'              THEN 1 ELSE 0 END)         AS sold,
            SUM(CASE WHEN walkin_status='visited not sold'  THEN 1 ELSE 0 END)         AS visited_not_sold,
            SUM(CASE WHEN walkin_status IS NULL OR walkin_status='' THEN 1 ELSE 0 END) AS no_update,
            -- Sanity filter: lead-form bugs occasionally jam the customer's
            -- 10-digit mobile into gms_weight. A genuine weight is either
            -- under 10000g (very high upper bound for any plausible visit)
            -- or has a decimal component (real weights like 9.876g do).
            -- Phone numbers are large integers, so they fail both checks
            -- and contribute 0 to the daily total instead of poisoning it.
            ROUND(SUM(CASE
              WHEN (gms_weight + 0) < 10000
                OR (gms_weight + 0) != FLOOR(gms_weight + 0)
              THEN gms_weight + 0
              ELSE 0
            END), 2)                                                                    AS total_gold_wt,
            SUM(CASE WHEN gms_weight IS NULL OR gms_weight=0 THEN 1 ELSE 0 END)        AS missing_weight_count,
            -- Count of rows where the filter rejected the weight — surfaced
            -- so the UI can flag "N walk-ins have invalid weight entries"
            -- without ops having to dig through CRM.
            SUM(CASE
              WHEN (gms_weight + 0) >= 10000
                AND (gms_weight + 0) = FLOOR(gms_weight + 0)
              THEN 1 ELSE 0
            END)                                                                        AS invalid_weight_count
          FROM customer_walkin
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
        `, [todayIST]),

        // 2. Raw ornment rows (grms_wet is CSV) — summed in JS per status + type_gold
        conn.execute(`
          SELECT t.trxn_status, t.type_gold, t.id AS txn_id,
            (t.finl_amnt+0) AS amount, o.grms_wet
          FROM transac_tbl t
          LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
          WHERE DATE(t.date + INTERVAL 330 MINUTE) = ?
        `, [todayIST]),

        // 3. Branch breakdown
        conn.execute(`
          SELECT
            t.branch_id   AS branch_id,
            b.brnch_name  AS branch_name,
            COUNT(*)      AS bills,
            SUM(CASE WHEN t.trxn_status='approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN t.trxn_status='pending'  THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN t.trxn_status='rejected' THEN 1 ELSE 0 END) AS rejected,
            ROUND(SUM(CASE WHEN t.trxn_status='approved' THEN (t.finl_amnt+0) ELSE 0 END), 0) AS value
          FROM transac_tbl t
          LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
          WHERE DATE(t.date + INTERVAL 330 MINUTE) = ?
          GROUP BY t.branch_id, b.brnch_name
          ORDER BY value DESC
          LIMIT 40
        `, [todayIST]),

        // 4. Hourly activity
        conn.execute(`
          SELECT
            HOUR(TIME(date + INTERVAL 330 MINUTE)) AS hour,
            COUNT(*) AS bills,
            SUM(CASE WHEN trxn_status='approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END) AS rejected
          FROM transac_tbl
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
          GROUP BY hour ORDER BY hour
        `, [todayIST]),

        // 5. Today's transactions — GROUP BY transaction so each bill is one row
        conn.execute(`
          SELECT t.id, t.bill_no, t.cust_name, t.cust_mobile,
            DATE(t.date + INTERVAL 330 MINUTE) AS txn_date,
            t.time, t.branch_id, b.brnch_name AS branch_name,
            t.type_gold, t.trxn_status, (t.finl_amnt+0) AS amount,
            t.txn_rmrk, t.pymt_mde, t.serv_chr,
            GROUP_CONCAT(o.grms_wet   SEPARATOR ',') AS grms_wet_csv,
            GROUP_CONCAT(o.stnt_wet   SEPARATOR ',') AS stnt_wet_csv,
            GROUP_CONCAT(o.wastag_wet SEPARATOR ',') AS wastag_csv,
            GROUP_CONCAT(o.net_wet    SEPARATOR ',') AS net_wet_csv,
            GROUP_CONCAT(o.purity     ORDER BY o.id SEPARATOR ',') AS purity_csv,
            GROUP_CONCAT(o.grs_amnt   SEPARATOR ',') AS grs_amnt_csv
          FROM transac_tbl t
          LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
          LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
          WHERE DATE(t.date + INTERVAL 330 MINUTE) = ?
          GROUP BY t.id
          ORDER BY t.time DESC
          LIMIT 500
        `, [todayIST]),

        // 6. Today's walk-ins for timeline
        conn.execute(`
          SELECT cw.id, cw.cust_name, cw.cust_mobile, cw.time,
            cw.walkin_status, cw.item_type, cw.gms_weight,
            cw.walk_reason, cw.source, cw.cust_rmrks,
            cw.branch_id, b.brnch_name AS branch_name
          FROM customer_walkin cw
          LEFT JOIN branch_tbl b ON b.brnch_id = cw.branch_id
          WHERE DATE(cw.date + INTERVAL 330 MINUTE) = ?
          ORDER BY cw.time DESC
        `, [todayIST]),

        // 7. KYC blacklisted today — full detail for region filter + detail table
        conn.execute(`
          SELECT r.branh_id, r.mob_num, r.grams+0 AS grams,
            r.name, r.rej_rsn, r.time,
            b.brnch_name AS branch_name
          FROM rejctd_tbl r
          LEFT JOIN branch_tbl b ON b.brnch_id = r.branh_id
          WHERE DATE(r.date + INTERVAL 330 MINUTE) = ?
        `, [todayIST]),

        // 8. Takeover bills today + original walk-in date from customer_walkin history
        conn.execute(`
          SELECT
            t.id AS txn_id, t.bill_no, t.cust_name, t.cust_mobile,
            DATE(t.date + INTERVAL 330 MINUTE) AS txn_date,
            t.time, t.trxn_status, (t.finl_amnt+0) AS amount,
            t.txn_rmrk, b.brnch_name AS branch_name,
            prev.last_walkin_date,
            DATEDIFF(DATE(t.date + INTERVAL 330 MINUTE), prev.last_walkin_date) AS days_gap,
            prev.last_walkin_status, prev.last_walkin_item, prev.last_walkin_wt
          FROM transac_tbl t
          LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
          LEFT JOIN (
            SELECT
              cust_mobile,
              DATE(MAX(date) + INTERVAL 330 MINUTE) AS last_walkin_date,
              SUBSTRING_INDEX(GROUP_CONCAT(walkin_status ORDER BY date DESC SEPARATOR '|'), '|', 1) AS last_walkin_status,
              SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(item_type,'') ORDER BY date DESC SEPARATOR '|'), '|', 1) AS last_walkin_item,
              SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(CAST(gms_weight AS CHAR),'') ORDER BY date DESC SEPARATOR '|'), '|', 1) AS last_walkin_wt
            FROM customer_walkin
            GROUP BY cust_mobile
          ) prev ON prev.cust_mobile = t.cust_mobile
          WHERE DATE(t.date + INTERVAL 330 MINUTE) = ?
            AND t.type_gold = 'released'
          ORDER BY t.time DESC
        `, [todayIST]).catch(() => [[]]),
      ])

      // Build region maps from parallel-fetched Supabase data
      const regionMap     = {}
      const nameRegionMap = {}
      const allRegionsSet = new Set()
      for (const b of sbBranches || []) {
        const region = b.region || ''
        if (!region) continue
        if (b.crm_branch_id) regionMap[String(b.crm_branch_id)] = region
        if (b.name) nameRegionMap[b.name.trim().toLowerCase()] = region
        allRegionsSet.add(region)
      }
      const allRegions = Array.from(allRegionsSet).sort()

      // Attach region from Supabase to MySQL rows
      for (const b  of branches)     b.region  = regionMap[String(b.branch_id)]  || ''
      for (const tx of todayTxns)    tx.region = regionMap[String(tx.branch_id)] || ''
      for (const w  of todayWalkins) w.region  = regionMap[String(w.branch_id)]  || ''
      for (const k  of kycRows)      k.region  = regionMap[String(k.branh_id)]   || ''

      // ── Region scoping: drop everything outside user's allowed regions ──
      // Done BEFORE aggregations so summary/goldPipeline/stages/hourly all reflect scope.
      // Mutating in place because the arrays are bound with `const` (destructured from
      // Promise.all results); reassigning the binding would throw, but mutating the
      // backing array is allowed and propagates to all downstream consumers.
      const allowedRegions = await getAllowedRegionsForAuth(supabase, auth)
      if (allowedRegions) {
        const allowedSet = new Set(allowedRegions)
        const inAllowed = (r) => r && allowedSet.has(r)
        const replaceInPlace = (arr, predicate) => {
          if (!Array.isArray(arr)) return
          const kept = arr.filter(predicate)
          arr.length = 0
          for (const x of kept) arr.push(x)
        }
        replaceInPlace(branches,     b => inAllowed(b.region))
        replaceInPlace(todayTxns,    t => inAllowed(t.region))
        replaceInPlace(todayWalkins, w => inAllowed(w.region))
        replaceInPlace(kycRows,      k => inAllowed(k.region))
        // Attach region to takeoverRows then filter (it didn't get region above).
        if (Array.isArray(takeoverRows)) {
          for (const r of takeoverRows) r.region = regionMap[String(r.branch_id)] || ''
          replaceInPlace(takeoverRows, r => inAllowed(r.region))
        }
        // ornmentRows aren't branch-keyed directly — they're joined to a transaction by txn_id.
        // Filter ornmentRows to only those whose transaction is in the (now filtered) todayTxns.
        const allowedTxnIds = new Set(todayTxns.map(t => t.id))
        replaceInPlace(ornmentRows, o => allowedTxnIds.has(o.txn_id))
        // Restrict allRegions to user's allowed regions so the UI region pills stay accurate.
        // eslint-disable-next-line no-param-reassign
        allRegions.length = 0
        for (const r of allowedRegions) if (allRegionsSet.has(r)) allRegions.push(r)

        // hourly came from raw SQL — rebuild from filtered todayTxns.
        if (Array.isArray(hourly)) {
          const hourMap = {}
          for (const t of todayTxns) {
            // Extract hour from t.time (format "HH:MM:SS") or fallback to txn_date_time
            const hourStr = (t.time || '').split(':')[0]
            const h = parseInt(hourStr, 10)
            if (Number.isNaN(h)) continue
            if (!hourMap[h]) hourMap[h] = { hour: h, bills: 0, approved: 0, rejected: 0 }
            hourMap[h].bills++
            if (t.trxn_status === 'approved') hourMap[h].approved++
            if (t.trxn_status === 'rejected') hourMap[h].rejected++
          }
          hourly.length = 0
          for (const h of Object.keys(hourMap).map(Number).sort((a, b) => a - b)) hourly.push(hourMap[h])
        }

        // walkinSummary came from a raw SQL aggregate (no region awareness).
        // Recompute it from the filtered todayWalkins so the LiveFeed cards
        // (walked-in count, sold, visited-not-sold, total gold weight, missing-weight)
        // reflect only the user's regions.
        if (walkinSummary && Array.isArray(todayWalkins)) {
          let total = 0, sold = 0, visited_not_sold = 0, no_update = 0
          let total_gold_wt = 0, missing_weight_count = 0, invalid_weight_count = 0
          for (const w of todayWalkins) {
            total++
            if (w.walkin_status === 'sold') sold++
            else if (w.walkin_status === 'visited not sold') visited_not_sold++
            else if (!w.walkin_status) no_update++
            const wt = parseFloat(w.gms_weight) || 0
            // Mirror the SQL-side sanity filter — a phone number jammed into
            // gms_weight (large integer, no decimals) gets excluded from the
            // total. Counted separately so the UI can flag the rows.
            const isInvalid = wt >= 10000 && wt === Math.floor(wt)
            if (isInvalid) invalid_weight_count++
            else total_gold_wt += wt
            if (!wt) missing_weight_count++
          }
          walkinSummary.total                = total
          walkinSummary.sold                 = sold
          walkinSummary.visited_not_sold     = visited_not_sold
          walkinSummary.no_update            = no_update
          walkinSummary.total_gold_wt        = total_gold_wt.toFixed(2)
          walkinSummary.missing_weight_count = missing_weight_count
          walkinSummary.invalid_weight_count = invalid_weight_count
        }
      }

      // grms_wet is CSV per row (e.g. "24.91,17.05,2.96") — must parse in JS
      const csvSum = str => String(str || '').split(',').reduce((s, v) => {
        const n = parseFloat(v.trim()); return s + (isNaN(n) ? 0 : n)
      }, 0)

      // --- Build mobile-level sets for cross-table linking ---
      // Mobile numbers that have an approved bill today
      const approvedMobiles = new Set(
        todayTxns.filter(t => t.trxn_status === 'approved').map(t => t.cust_mobile).filter(Boolean)
      )
      // Mobile numbers that have ANY bill today (approved/pending/rejected)
      const billedMobiles = new Set(
        todayTxns.map(t => t.cust_mobile).filter(Boolean)
      )

      // --- Aggregate ornment rows by status + type ---
      const byStatus = {}  // { approved: { count, wt, value }, pending: {...}, rejected: {...} }
      const byType   = {}  // { physical: { approved, pending, rejected }, released: {...} }


      // Build per-txn weight map first (sum all ornment rows per txn)
      const txnWeightMap = {}
      const txnMeta = {}
      for (const r of ornmentRows) {
        if (!txnWeightMap[r.txn_id]) {
          txnWeightMap[r.txn_id] = 0
          txnMeta[r.txn_id] = { status: r.trxn_status, type: r.type_gold || 'physical', amount: parseFloat(r.amount) || 0 }
        }
        txnWeightMap[r.txn_id] += csvSum(r.grms_wet)
      }

      // Also include txns with no ornment record (they appear in todayTxns but not ornmentRows)
      for (const tx of todayTxns) {
        if (!txnMeta[tx.id]) {
          txnMeta[tx.id] = { status: tx.trxn_status, type: tx.type_gold || 'physical', amount: parseFloat(tx.amount) || 0 }
          txnWeightMap[tx.id] = 0
        }
      }

      for (const [txnId, meta] of Object.entries(txnMeta)) {
        const st = meta.status
        const tp = meta.type
        const wt = txnWeightMap[txnId] || 0

        if (!byStatus[st]) byStatus[st] = { count: 0, wt: 0, value: 0 }
        byStatus[st].count++
        byStatus[st].value += meta.amount
        byStatus[st].wt   += wt

        if (!byType[tp]) byType[tp] = { approved: 0, pending: 0, rejected: 0 }
        byType[tp][st] = (byType[tp][st] || 0) + 1
      }

      // --- FIX 1: Rejected weight — only count truly rejected customers ---
      // If a customer's mobile has an approved bill today, their rejected bill was a wrong entry
      // that got re-submitted and approved. Don't double-count the weight.
      const trueRejectedTxns = todayTxns.filter(t =>
        t.trxn_status === 'rejected' && !approvedMobiles.has(t.cust_mobile)
      )
      const trueRejectedCount = trueRejectedTxns.length
      const trueRejectedWt = trueRejectedTxns.reduce((s, t) => s + (txnWeightMap[t.id] || 0), 0)

      // Wrong entries (rejected but customer eventually approved)
      const wrongEntryCount = (byStatus['rejected']?.count || 0) - trueRejectedCount

      // Walkins where status=null but they DID get a bill (CRM not updated)
      const crmNotUpdatedCount = todayWalkins.filter(w =>
        (!w.walkin_status || w.walkin_status === '') && billedMobiles.has(w.cust_mobile)
      ).length

      // KYC blocked today but later got an approved bill (mob_num → cust_mobile cross-ref)
      const kycMobiles = new Set(kycRows.map(r => r.mob_num).filter(Boolean))
      const kycOverriddenCount = [...kycMobiles].filter(m => approvedMobiles.has(m)).length

      // FIX 3: Exclude KYC blocked walkins from Left Unbilled to avoid double-counting weight
      // A KYC-blocked customer's gold is already counted in kyc_blacklisted_wt (rejctd_tbl.grams)
      // If they're also in customer_walkin, their gms_weight would be double-counted in not_billed_wt
      const trulyUnbilledWalkins = todayWalkins.filter(w =>
        !billedMobiles.has(w.cust_mobile) && !kycMobiles.has(w.cust_mobile)
      )
      const trulyUnbilledCount = trulyUnbilledWalkins.length
      const trulyUnbilledWt    = trulyUnbilledWalkins.reduce((s, w) => s + (parseFloat(w.gms_weight) || 0), 0)

      // Build summary
      const summary = {
        total:           Object.values(txnMeta).length,
        approved:        byStatus['approved']?.count || 0,
        pending:         byStatus['pending']?.count  || 0,
        rejected:        byStatus['rejected']?.count || 0,
        true_rejected:   trueRejectedCount,
        wrong_entry:     wrongEntryCount,
        approved_value:  parseFloat((byStatus['approved']?.value || 0).toFixed(2)),
        branches_active: new Set(todayTxns.map(t => t.branch_id)).size,
      }

      const goldPipeline = {
        walked_in_wt:        parseFloat(walkinSummary.total_gold_wt) || 0,
        missing_weight_cnt:  walkinSummary.missing_weight_count || 0,
        purchased_wt:        parseFloat((byStatus['approved']?.wt || 0).toFixed(2)),
        pending_wt:          parseFloat((byStatus['pending']?.wt  || 0).toFixed(2)),
        // Only truly rejected (not wrong entries that got re-approved)
        rejected_wt:         parseFloat(trueRejectedWt.toFixed(2)),
        rejected_cnt:        trueRejectedCount,
        wrong_entry_cnt:     wrongEntryCount,
        // Only walkins with no bill at all today
        not_billed_wt:       parseFloat(trulyUnbilledWt.toFixed(2)),
        not_billed_cnt:      trulyUnbilledCount,
        crm_not_updated_cnt: crmNotUpdatedCount,
        kyc_blacklisted_cnt: kycRows.length,
        kyc_blacklisted_wt:  parseFloat(kycRows.reduce((s, r) => s + (parseFloat(r.grams) || 0), 0).toFixed(2)),
        kyc_overridden_cnt:  kycOverriddenCount,
        physical: { approved: byType['physical']?.approved || 0, pending: byType['physical']?.pending || 0, rejected: byType['physical']?.rejected || 0 },
        released: { approved: byType['released']?.approved || 0, pending: byType['released']?.pending || 0, rejected: byType['released']?.rejected || 0 },
      }

      // Try new CRM (best-effort, don't fail if unreachable)
      let stages = null
      let newCrmTxns = null   // null = offline; [] = online but no data
      let newCrmCompletedToday = null   // completed-purchased-today rows (dashboard basis)
      let newCrmError = null
      let sql
      try {
        const sslOptions = process.env.NEW_CRM_DB_CA
          ? { ca: process.env.NEW_CRM_DB_CA, rejectUnauthorized: true }
          : { rejectUnauthorized: false }
        sql = postgres({
          host:     process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
          port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
          database: process.env.NEW_CRM_DB_NAME,
          username: process.env.NEW_CRM_DB_USER,
          password: process.env.NEW_CRM_DB_PASSWORD,
          ssl:      sslOptions,
          connect_timeout: 3,
          max:      1,
        })

        const todayStart = `${todayIST}T00:00:00+05:30`
        const todayEnd   = `${todayIST}T23:59:59+05:30`

        const [stageRows, txnRows, completedTodayRows] = await Promise.all([
          // Stage counts.
          // Weight lives in a DIFFERENT place depending on stage (see the resolver
          // chain in the txn query below): physical-gold ornaments link via
          // Ornament.estimation_id (pre-quotation) or Ornament.quotation_id (after),
          // takeover/pledge gold lives in PledgeCompany (via Release), the branch
          // confirms a final weight in Order, and a rough lead weight sits in Lead.
          // We coalesce ornament → pledge → order so every stage's net_wt is real,
          // deduping ornaments by ornament_id (the quotation copy duplicates the
          // estimation copy once a quotation is cut).
          sql`
            WITH txn_orn AS (
              SELECT q.transaction_id tid, o.ornament_id, o.id::text oid, o.net_weight nw, o.purity pu, o.approve ap, o.created_at ca, 2 sr
              FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id = q.id
              UNION ALL
              SELECT e.transaction_id, o.ornament_id, o.id::text, o.net_weight, o.purity, o.approve, o.created_at, 1
              FROM "Estimation" e JOIN "Ornament" o ON o.estimation_id = e.id
            ),
            orn_dd AS (
              SELECT DISTINCT ON (tid, COALESCE(ornament_id, oid)) tid, nw
              FROM txn_orn ORDER BY tid, COALESCE(ornament_id, oid), sr DESC, ap DESC NULLS LAST, ca DESC
            ),
            orn AS (SELECT tid, SUM(nw) n FROM orn_dd GROUP BY tid),
            pledge AS (SELECT r.transaction_id tid, SUM(pc.net_weight) n FROM "Release" r JOIN "PledgeCompany" pc ON pc.release_id = r.id GROUP BY r.transaction_id),
            ord AS (SELECT transaction_id tid, SUM(branch_net_weight) n FROM "Order" GROUP BY transaction_id)
            SELECT
              t.status,
              COUNT(*) AS count,
              COALESCE(ROUND(SUM(
                CASE WHEN COALESCE(orn.n,0)>0 THEN orn.n
                     WHEN COALESCE(pl.n,0)>0  THEN pl.n
                     WHEN COALESCE(od.n,0)>0  THEN od.n
                     ELSE 0 END)::numeric, 2), 0) AS net_wt
            FROM "Transaction" t
            LEFT JOIN orn ON orn.tid = t.id
            LEFT JOIN pledge pl ON pl.tid = t.id
            LEFT JOIN ord od ON od.tid = t.id
            WHERE t.created_at BETWEEN ${todayStart} AND ${todayEnd}
            GROUP BY t.status ORDER BY count DESC
          `,

          // Full transaction rows for today.
          // weight_source records WHERE each row's weight came from, resolving in
          // stage order: ornament (estimation+quotation, deduped by ornament_id) →
          // pledge (PledgeCompany via Release, for takeover/release gold) → order
          // (branch-confirmed weight) → lead approx gross (rough, gross only).
          // 'none' = nothing weighed yet (fresh WALKIN / just-registered ESTIMATION
          // / PLEDGE_ESTIMATION) — genuinely no data, the UI shows it as such.
          // Name comes from Walkin (matches the CRM dashboard), falling back to Customer.
          sql`
            WITH txn_orn AS (
              SELECT q.transaction_id tid, o.ornament_id, o.id::text oid, o.gross_weight gw, o.stone_weight sw, o.wastage wa, o.net_weight nw, o.purity pu, o.approve ap, o.created_at ca, 2 sr
              FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id = q.id
              UNION ALL
              SELECT e.transaction_id, o.ornament_id, o.id::text, o.gross_weight, o.stone_weight, o.wastage, o.net_weight, o.purity, o.approve, o.created_at, 1
              FROM "Estimation" e JOIN "Ornament" o ON o.estimation_id = e.id
            ),
            orn_dd AS (
              SELECT DISTINCT ON (tid, COALESCE(ornament_id, oid)) tid, gw, sw, wa, nw, pu
              FROM txn_orn ORDER BY tid, COALESCE(ornament_id, oid), sr DESC, ap DESC NULLS LAST, ca DESC
            ),
            orn AS (
              SELECT tid, SUM(gw) g, SUM(sw) s, SUM(wa) w, SUM(nw) n,
                     CASE WHEN SUM(nw)>0 THEN SUM(nw*pu)/SUM(nw) ELSE 0 END p
              FROM orn_dd GROUP BY tid
            ),
            pledge AS (
              SELECT r.transaction_id tid, SUM(pc.gross_weight) g, SUM(pc.net_weight) n, SUM(pc.final_amount) amt,
                     -- PledgeCompany.purity is free text; weight only the numeric ones
                     SUM(pc.net_weight * CASE WHEN btrim(COALESCE(pc.purity,'')) ~ '^[0-9.]+$' THEN pc.purity::float END) pw,
                     SUM(CASE WHEN btrim(COALESCE(pc.purity,'')) ~ '^[0-9.]+$' THEN pc.net_weight END) pwn
              FROM "Release" r JOIN "PledgeCompany" pc ON pc.release_id = r.id GROUP BY r.transaction_id
            ),
            rel AS (SELECT transaction_id tid, SUM(total_release_amount) tot FROM "Release" GROUP BY transaction_id),
            ord AS (SELECT transaction_id tid, SUM(branch_gross_weight) g, SUM(branch_stone_weight) s, SUM(branch_wastage) w, SUM(branch_net_weight) n, AVG(NULLIF(billing_purity,0)) p FROM "Order" GROUP BY transaction_id),
            leadw AS (SELECT DISTINCT ON (transaction_id) transaction_id tid, approx_gross_weight ag FROM "Lead" WHERE transaction_id IS NOT NULL ORDER BY transaction_id, created_at DESC)
            SELECT
              t.id, t.code AS bill_no, t.status, t.transaction_type,
              TO_CHAR(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') AS txn_time,
              TO_CHAR(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS txn_date,
              TRIM(COALESCE(NULLIF(btrim(wk.first_name),''), c.first_name, '') || ' ' || COALESCE(NULLIF(btrim(wk.last_name),''), c.last_name, '')) AS cust_name,
              c.mobile AS cust_mobile,
              b.name AS branch_name,
              -- Amount resolves like the weight: quotation → estimation (physical,
              -- before a quotation is cut) → pledge → release total. Pledge-stage
              -- bills often have no amount computed yet → stays 0/blank.
              COALESCE(NULLIF(q.final_amount,0), NULLIF(est.final_amount,0), NULLIF(pl.amt,0), NULLIF(rl.tot,0), 0)::float AS amount,
              COALESCE(q.service_charge, est.service_charge)::float AS serv_chr,
              (CASE WHEN COALESCE(orn.n,0)>0 THEN 'ornament'
                    WHEN COALESCE(pl.n,0)>0  THEN 'pledge'
                    WHEN COALESCE(od.n,0)>0  THEN 'order'
                    WHEN COALESCE(ld.ag,0)>0 THEN 'lead_approx'
                    ELSE 'none' END) AS weight_source,
              (CASE WHEN COALESCE(orn.n,0)>0 THEN orn.g WHEN COALESCE(pl.n,0)>0 THEN pl.g WHEN COALESCE(od.n,0)>0 THEN od.g WHEN COALESCE(ld.ag,0)>0 THEN ld.ag ELSE 0 END)::float AS gross_weight,
              (CASE WHEN COALESCE(orn.n,0)>0 THEN orn.s WHEN COALESCE(od.n,0)>0 THEN od.s ELSE 0 END)::float AS stone_weight,
              (CASE WHEN COALESCE(orn.n,0)>0 THEN orn.w WHEN COALESCE(od.n,0)>0 THEN od.w ELSE 0 END)::float AS wastage,
              (CASE WHEN COALESCE(orn.n,0)>0 THEN orn.n WHEN COALESCE(pl.n,0)>0 THEN pl.n WHEN COALESCE(od.n,0)>0 THEN od.n ELSE 0 END)::float AS net_weight,
              (CASE WHEN COALESCE(orn.n,0)>0 THEN ROUND(orn.p::numeric,1)
                    WHEN COALESCE(pl.n,0)>0 AND COALESCE(pl.pwn,0)>0 THEN ROUND((pl.pw/pl.pwn)::numeric,1)
                    WHEN COALESCE(od.n,0)>0  THEN ROUND(od.p::numeric,1)
                    ELSE NULL END)::float AS avg_purity
            FROM "Transaction" t
            LEFT JOIN "Customer" c ON c.id = t.customer_id
            LEFT JOIN "Branch"   b ON b.id = t.branch_id
            LEFT JOIN LATERAL (SELECT first_name, last_name FROM "Walkin" WHERE transaction_id = t.id ORDER BY created_at DESC LIMIT 1) wk ON true
            LEFT JOIN LATERAL (SELECT final_amount, service_charge FROM "Quotation" WHERE transaction_id = t.id ORDER BY created_at DESC LIMIT 1) q ON true
            LEFT JOIN LATERAL (SELECT final_amount, service_charge FROM "Estimation" WHERE transaction_id = t.id ORDER BY created_at DESC LIMIT 1) est ON true
            LEFT JOIN orn       ON orn.tid = t.id
            LEFT JOIN pledge pl ON pl.tid = t.id
            LEFT JOIN rel    rl ON rl.tid = t.id
            LEFT JOIN ord    od ON od.tid = t.id
            LEFT JOIN leadw  ld ON ld.tid = t.id
            WHERE t.created_at BETWEEN ${todayStart} AND ${todayEnd}
            ORDER BY t.created_at DESC
            LIMIT 1000
          `,

          // COMPLETED PURCHASES today — dated by the FINAL PAYMENT date (the day
          // the final payment / invoice was generated), NOT created_at and NOT
          // updated_at. A purchase belongs to the day its final payment was made.
          // updated_at is unsafe — any later edit re-floats an old bill into a new
          // day (confirmed: WGKA-55734/55754 paid 15-Jun showed under 16-Jun after a
          // 16-Jun edit). Final-payment created_at is immutable and == invoice date
          // (verified 0 discrepancies across 342 bills). Weight = APPROVED
          // ornaments only (approve=true), matching the dashboard exactly.
          sql`
            WITH txn_orn AS (
              SELECT q.transaction_id tid, o.ornament_id, o.id::text oid, o.gross_weight gw, o.net_weight nw, o.created_at ca
              FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id = q.id WHERE o.approve = true
              UNION ALL
              SELECT e.transaction_id, o.ornament_id, o.id::text, o.gross_weight, o.net_weight, o.created_at
              FROM "Estimation" e JOIN "Ornament" o ON o.estimation_id = e.id WHERE o.approve = true
            ),
            orn_dd AS (
              SELECT DISTINCT ON (tid, COALESCE(ornament_id, oid)) tid, gw, nw
              FROM txn_orn ORDER BY tid, COALESCE(ornament_id, oid), ca DESC
            ),
            orn AS (SELECT tid, SUM(gw) g, SUM(nw) n FROM orn_dd GROUP BY tid)
            SELECT t.code AS bill_no, t.transaction_type, b.name AS branch_name,
                   COALESCE(orn.g, 0)::float AS gross_weight,
                   COALESCE(orn.n, 0)::float AS net_weight,
                   -- re_walkin = walked in on an EARLIER day but closed today (the
                   -- walk-in/created date differs from the final-payment day). These
                   -- aren't in "Total Today" (created today) — counted as re-walk-ins.
                   ((t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date <> ${todayIST}::date) AS re_walkin
            FROM "Transaction" t
            LEFT JOIN "Branch" b ON b.id = t.branch_id
            LEFT JOIN orn ON orn.tid = t.id
            JOIN LATERAL (
              SELECT MAX(created_at) fp FROM "Payment"
              WHERE transaction_id = t.id AND status = 'COMPLETED' AND type = 'FINAL_PAYMENT'
            ) fpay ON true
            WHERE t.status = 'FINAL_PAYMENT_COMPLETED'
              AND (fpay.fp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = ${todayIST}::date
          `,
        ])

        stages = {}
        for (const r of stageRows) {
          stages[r.status] = { count: Number(r.count), net_wt: parseFloat(r.net_wt) || 0 }
        }

        const txnArr = [...txnRows]
        for (const row of txnArr) {
          row.branch_name = aliasBranchName(row.branch_name)   // stale-CRM-name → canonical
          row.region = nameRegionMap[(row.branch_name || '').trim().toLowerCase()] || ''
        }
        // Region scope: drop new-CRM rows outside user's allowed regions.
        const allowedRegionsForNewCrm = await getAllowedRegionsForAuth(supabase, auth)
        newCrmTxns = allowedRegionsForNewCrm
          ? txnArr.filter(r => r.region && allowedRegionsForNewCrm.includes(r.region))
          : txnArr

        // Completed-purchased-today rows (dashboard basis) — alias branch → region
        // so the client can region/type-filter the COMPLETED card.
        const ctArr = [...completedTodayRows].map(row => {
          const branch_name = aliasBranchName(row.branch_name)
          return { ...row, branch_name, region: nameRegionMap[(branch_name || '').trim().toLowerCase()] || '' }
        })
        newCrmCompletedToday = allowedRegionsForNewCrm
          ? ctArr.filter(r => r.region && allowedRegionsForNewCrm.includes(r.region))
          : ctArr

      } catch (e) {
        newCrmError = e.message
      } finally {
        if (sql) try { await sql.end() } catch {}
      }

      return Response.json({
        todayIST,
        summary,
        walkinSummary,
        goldPipeline,
        stages,
        branches,
        hourly,
        todayTxns,
        todayWalkins,
        kycRows,
        takeoverRows,
        allRegions,
        newCrmTxns,
        newCrmCompletedToday,
        newCrmError,
      })
    }

    // ── KPI COUNTS ───────────────────────────────────────────────────────────
    if (action === 'kpis') {
      const [[{ rejected }]]    = await conn.execute(`SELECT COUNT(*) AS rejected FROM transac_tbl WHERE trxn_status = 'rejected'`)
      const [[{ pending }]]     = await conn.execute(`SELECT COUNT(*) AS pending FROM transac_tbl WHERE trxn_status = 'pending'`)
      const [[{ approved }]]    = await conn.execute(`SELECT COUNT(*) AS approved FROM transac_tbl WHERE trxn_status = 'approved'`)
      const [[{ walkin }]]      = await conn.execute(`SELECT COUNT(*) AS walkin FROM customer_walkin WHERE walkin_status IN ('visited not sold','enquiry','planning to visit','call later')`)
      const [[{ blacklisted }]] = await conn.execute(`SELECT COUNT(*) AS blacklisted FROM rejctd_tbl`)
      return Response.json({ rejected, pending, approved, walkin, blacklisted })
    }

  } catch (err) {
    console.error('CRM purchases error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) conn.release()
  }
}
