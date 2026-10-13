// app/api/crm-purchases/route.js
// Live CRM reads for the dashboard tiles (action=flashcards) and the Live Feed
// (action=live). New CRM (Postgres) only — the old CRM is fully decoupled.

import postgres  from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { aliasBranchName } from '../../../lib/crmBranchAlias'
import { newCrmOptsForPostgresPkg } from '../../../lib/newCrmPg'
import { getAllowedRegionsForAuth } from '../../../lib/regionScope'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const ALLOWED_ACTIONS = new Set(['live', 'flashcards'])

// In-memory cache for the lightweight `flashcards` endpoint (30s). Cache key
// includes the region-scope fingerprint so a region-restricted user can never
// read another scope's cached payload.
const FLASHCARD_CACHE_TTL_MS = 30000
const FLASHCARD_CACHE_MAX    = 50
const flashcardCache = new Map()

export async function GET(req) {
  // Operational read — any authenticated user (customer PII in the live feed).
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || ''
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
  //   • WALKED IN count + weight: live from the New CRM (every Transaction
  //     opened + re-walk-ins) — not in Supabase. Real-time.
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

      // Supabase aggregate for the purchased numbers.
      const [agg] = await Promise.all([
        supabase.rpc('get_purchase_aggregates', {
          p_from_date:        todayIST,
          p_to_date:          todayIST,
          p_branch:           null,
          p_txn_type:         null,
          p_region_branches:  regionBranches,
          p_single_day:       true,
        }),
      ])

      const allowedSet = needRegionMap ? new Set(allowedRegions) : null

      let walkedInCount = 0
      let walkedInWt    = 0
      let reWalkinCount = 0   // subset of walkedInCount that walked in earlier (re-walk-ins)

      // ── New CRM live — walk-ins (every Transaction today) + completed
      //    bills, queried directly so the dashboard matches the Live Feed
      //    instead of waiting for the sync. Walk-ins = every transaction opened;
      //    completed feed the LIVE purchased calc below. Best-effort +
      //    region-scoped; if the new CRM is unreachable we keep the synced
      //    numbers.
      let ncCompleted = 0, ncCompletedNet = 0, ncCompletedGross = 0, ncCompletedValue = 0, ncLiveOk = false
      try {
        const ncSql = postgres({
          host:     process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
          port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
          database: process.env.NEW_CRM_DB_NAME,
          username: process.env.NEW_CRM_DB_USER,
          password: process.env.NEW_CRM_DB_PASSWORD,
          ...newCrmOptsForPostgresPkg(), connect_timeout: 3, max: 1,
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
          // Tracked separately so ratios (conversion) can use FRESH walk-ins only.
          for (const r of ncRewalkRows) {
            if (!inAllowedBranch(r.branch)) continue
            walkedInCount += Number(r.c)      || 0
            walkedInWt    += parseFloat(r.wt) || 0
            reWalkinCount += Number(r.c)      || 0
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
      } catch { /* new CRM offline — keep the synced numbers */ }

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
          total:         walkedInCount,                              // fresh + re-walk-ins (display)
          fresh:         Math.max(0, walkedInCount - reWalkinCount), // walked in today only (ratio basis)
          rewalkin:      reWalkinCount,
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
    }
  }


  // ── LIVE FEED ──────────────────────────────────────────────────────────────
  try {
    if (action === 'live') {
      const istNow  = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
      const defaultIST = istNow.toISOString().split('T')[0]
      // Single-day mode (default): ?date= or nothing → a snapshot of one day.
      // Range mode (e.g. "Last Week"): ?from=&to= aggregates across every day
      // in the range, inclusive. When only `date` is given, from/to both
      // resolve to it, so every query below (BETWEEN fromIST AND toIST)
      // degenerates to exactly the old single-day behaviour.
      const singleDate = searchParams.get('date') || defaultIST
      const fromIST = searchParams.get('from') || singleDate
      const toIST   = searchParams.get('to')   || singleDate
      const todayIST = fromIST   // legacy alias — still means "the day/window start" below

      const { data: sbBranches } = await supabase.from('branches').select('name, region').not('region', 'is', null)
      const nameRegionMap = {}
      const allRegionsSet = new Set()
      for (const b of sbBranches || []) {
        if (!b.region) continue
        if (b.name) nameRegionMap[b.name.trim().toLowerCase()] = b.region
        allRegionsSet.add(b.region)
      }
      const allowedRegions = await getAllowedRegionsForAuth(supabase, auth)
      const allRegions = allowedRegions
        ? allowedRegions.filter(r => allRegionsSet.has(r)).sort()
        : Array.from(allRegionsSet).sort()

      // Try new CRM (best-effort, don't fail if unreachable)
      let stages = null
      let newCrmTxns = null   // null = offline; [] = online but no data
      let newCrmCompletedToday = null   // completed-purchased-today rows (dashboard basis)
      let newCrmError = null
      let sql
      try {
        sql = postgres({
          host:     process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
          port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
          database: process.env.NEW_CRM_DB_NAME,
          username: process.env.NEW_CRM_DB_USER,
          password: process.env.NEW_CRM_DB_PASSWORD,
          ...newCrmOptsForPostgresPkg(),
          connect_timeout: 3,
          max:      1,
        })

        const todayStart = `${fromIST}T00:00:00+05:30`
        const todayEnd   = `${toIST}T23:59:59+05:30`

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
                     SUM(pc.net_weight * CASE WHEN btrim(COALESCE(pc.purity,'')) ~ '^[0-9]*[.]?[0-9]+$' THEN pc.purity::float END) pw,
                     SUM(CASE WHEN btrim(COALESCE(pc.purity,'')) ~ '^[0-9]*[.]?[0-9]+$' THEN pc.net_weight END) pwn
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
            LIMIT 7000
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
            SELECT t.code AS bill_no, t.transaction_type, b.name AS branch_name, t.status,
                   -- Date/time are the ORIGINAL walk-in (created_at) — for re-walk-ins
                   -- this shows the earlier day they first came in; the detail table
                   -- needs these + name/phone/amount to render like the other metrics.
                   TO_CHAR(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS txn_date,
                   TO_CHAR(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') AS txn_time,
                   TRIM(COALESCE(NULLIF(btrim(wk.first_name),''), c.first_name, '') || ' ' || COALESCE(NULLIF(btrim(wk.last_name),''), c.last_name, '')) AS cust_name,
                   c.mobile AS cust_mobile,
                   COALESCE(NULLIF(q.final_amount,0), 0)::float AS amount,
                   COALESCE(orn.g, 0)::float AS gross_weight,
                   COALESCE(orn.n, 0)::float AS net_weight,
                   -- re_walkin = walked in BEFORE this window started but closed
                   -- within it (the walk-in/created date is earlier than the
                   -- window's first day). These aren't in "Total" (created
                   -- within the window) — counted as re-walk-ins instead.
                   ((t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date < ${fromIST}::date) AS re_walkin
            FROM "Transaction" t
            LEFT JOIN "Branch" b ON b.id = t.branch_id
            LEFT JOIN "Customer" c ON c.id = t.customer_id
            LEFT JOIN LATERAL (SELECT first_name, last_name FROM "Walkin" WHERE transaction_id = t.id ORDER BY created_at DESC LIMIT 1) wk ON true
            LEFT JOIN LATERAL (SELECT final_amount FROM "Quotation" WHERE transaction_id = t.id ORDER BY created_at DESC LIMIT 1) q ON true
            LEFT JOIN orn ON orn.tid = t.id
            JOIN LATERAL (
              SELECT MAX(created_at) fp FROM "Payment"
              WHERE transaction_id = t.id AND status = 'COMPLETED' AND type = 'FINAL_PAYMENT'
            ) fpay ON true
            WHERE t.status = 'FINAL_PAYMENT_COMPLETED'
              AND (fpay.fp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${fromIST}::date AND ${toIST}::date
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
        fromIST,
        toIST,
        isRange: fromIST !== toIST,
        stages,
        allRegions,
        newCrmTxns,
        newCrmCompletedToday,
        newCrmError,
      })
    }
  } catch (err) {
    console.error('CRM purchases error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
