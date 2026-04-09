// app/api/crm-purchases/route.js
// Queries CRM MySQL for rejected, pending, walk-in, and blacklisted data

import mysql from 'mysql2/promise'
import pg    from 'pg'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { Client: PgClient } = pg

const ALLOWED_ACTIONS = new Set(['rejected', 'pending', 'walkin', 'blacklisted', 'branches', 'kpis', 'live'])

function createConn() {
  return mysql.createConnection({
    host:     process.env.CRM_DB_HOST,
    port:     parseInt(process.env.CRM_DB_PORT || '3306'),
    database: process.env.CRM_DB_NAME,
    user:     process.env.CRM_DB_USER,
    password: process.env.CRM_DB_PASSWORD,
  })
}

export async function GET(req) {
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

      // Fetch region mapping from Supabase branch management
      const { data: sbBranches } = await supabase
        .from('branches')
        .select('crm_branch_id, name, region')
        .not('region', 'is', null)
      const regionMap     = {}  // old CRM: crm_branch_id → region
      const nameRegionMap = {}  // new CRM: lowercase branch name → region
      const allRegionsSet = new Set()
      for (const b of sbBranches || []) {
        const region = b.region || ''
        if (!region) continue
        if (b.crm_branch_id) regionMap[String(b.crm_branch_id)] = region
        if (b.name) nameRegionMap[b.name.trim().toLowerCase()] = region
        allRegionsSet.add(region)
      }
      const allRegions = Array.from(allRegionsSet).sort()

      // All old-CRM queries in parallel
      const [
        [[walkinSummary]],
        [ornmentRows],
        [branches],
        [hourly],
        [todayTxns],
        [todayWalkins],
        [kycRows],
        [[chklistCount]],
      ] = await Promise.all([

        // 1. Walk-in summary
        conn.execute(`
          SELECT
            COUNT(*)                                                                    AS total,
            SUM(CASE WHEN walkin_status='sold'              THEN 1 ELSE 0 END)         AS sold,
            SUM(CASE WHEN walkin_status='visited not sold'  THEN 1 ELSE 0 END)         AS visited_not_sold,
            SUM(CASE WHEN walkin_status IS NULL OR walkin_status='' THEN 1 ELSE 0 END) AS no_update,
            ROUND(SUM(gms_weight + 0), 2)                                              AS total_gold_wt,
            SUM(CASE WHEN gms_weight IS NULL OR gms_weight=0 THEN 1 ELSE 0 END)        AS missing_weight_count
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
            cw.walk_reason, cw.source, cw.branch_id, b.brnch_name AS branch_name
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

        // 8. KYC checklist filled today (chklist_tbl) — customers who went through KYC
        conn.execute(`
          SELECT COUNT(*) AS cnt FROM chklist_tbl
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
        `, [todayIST]),
      ])

      // Attach region from Supabase to MySQL rows
      for (const b  of branches)     b.region  = regionMap[String(b.branch_id)]  || ''
      for (const tx of todayTxns)    tx.region = regionMap[String(tx.branch_id)] || ''
      for (const w  of todayWalkins) w.region  = regionMap[String(w.branch_id)]  || ''
      for (const k  of kycRows)      k.region  = regionMap[String(k.branh_id)]   || ''

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
        kyc_checklist_cnt:   Number(chklistCount.cnt) || 0,
        physical: { approved: byType['physical']?.approved || 0, pending: byType['physical']?.pending || 0, rejected: byType['physical']?.rejected || 0 },
        released: { approved: byType['released']?.approved || 0, pending: byType['released']?.pending || 0, rejected: byType['released']?.rejected || 0 },
      }

      // Try new CRM (best-effort, don't fail if unreachable)
      let stages = null
      let newCrmTxns = null   // null = offline; [] = online but no data
      let newCrmError = null
      let pgClient
      try {
        const _host = process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST
        const _port = process.env.NEW_CRM_DB_PORT || '5432'
        const _db   = process.env.NEW_CRM_DB_NAME
        const _user = process.env.NEW_CRM_DB_USER
        const _pass = process.env.NEW_CRM_DB_PASSWORD
        const connectionString = `postgresql://${encodeURIComponent(_user)}:${encodeURIComponent(_pass)}@${_host}:${_port}/${_db}?sslmode=disable`
        pgClient = new PgClient({
          connectionString,
          connectionTimeoutMillis: 8000,
        })
        await pgClient.connect()

        const todayStart = `${todayIST}T00:00:00+05:30`
        const todayEnd   = `${todayIST}T23:59:59+05:30`

        const [{ rows: stageRows }, { rows: txnRows }] = await Promise.all([
          // Stage counts
          pgClient.query(`
            SELECT
              t.status,
              COUNT(*) AS count,
              COALESCE(ROUND(SUM(ow.net_weight)::numeric, 2), 0) AS net_wt
            FROM "Transaction" t
            LEFT JOIN (
              SELECT q.transaction_id, SUM(o.net_weight) AS net_weight
              FROM "Quotation" q
              JOIN "Ornament" o ON o.quotation_id = q.id
              GROUP BY q.transaction_id
            ) ow ON ow.transaction_id = t.id
            WHERE t.created_at BETWEEN $1 AND $2
            GROUP BY t.status ORDER BY count DESC
          `, [todayStart, todayEnd]),

          // Full transaction rows for today
          pgClient.query(`
            SELECT
              t.id, t.code AS bill_no, t.status, t.transaction_type,
              TO_CHAR(t.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') AS txn_time,
              TO_CHAR(t.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS txn_date,
              TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS cust_name,
              c.mobile AS cust_mobile,
              b.name AS branch_name,
              COALESCE(q.final_amount, 0)::float AS amount,
              q.service_charge::float AS serv_chr,
              COALESCE(SUM(o.gross_weight), 0)::float AS gross_weight,
              COALESCE(SUM(o.stone_weight), 0)::float AS stone_weight,
              COALESCE(SUM(o.wastage), 0)::float       AS wastage,
              COALESCE(SUM(o.net_weight), 0)::float    AS net_weight,
              CASE WHEN COALESCE(SUM(o.net_weight), 0) > 0
                THEN ROUND((SUM(o.net_weight * o.purity) / SUM(o.net_weight))::numeric, 1)::float
                ELSE NULL END AS avg_purity
            FROM "Transaction" t
            LEFT JOIN "Customer"  c ON c.id = t.customer_id
            LEFT JOIN "Branch"    b ON b.id = t.branch_id
            LEFT JOIN "Quotation" q ON q.transaction_id = t.id
            LEFT JOIN "Ornament"  o ON o.quotation_id = q.id
            WHERE t.created_at BETWEEN $1 AND $2
            GROUP BY t.id, t.code, t.status, t.transaction_type, t.created_at,
                     c.first_name, c.last_name, c.mobile,
                     b.name, q.final_amount, q.service_charge
            ORDER BY t.created_at DESC
            LIMIT 1000
          `, [todayStart, todayEnd]),
        ])

        stages = {}
        for (const r of stageRows) {
          stages[r.status] = { count: Number(r.count), net_wt: parseFloat(r.net_wt) || 0 }
        }

        // Attach region via branch name
        for (const row of txnRows) {
          row.region = nameRegionMap[(row.branch_name || '').trim().toLowerCase()] || ''
        }
        newCrmTxns = txnRows

      } catch (e) {
        console.error('New CRM connect error:', e.message)
        const u = process.env.NEW_CRM_DB_USER || ''
        const p = process.env.NEW_CRM_DB_PASSWORD || ''
        const h = process.env.NEW_CRM_DB_HOSTNAME || ''
        newCrmError = `${e.message} [debug: host=${h.slice(0,12)} user_len=${u.length} pass_len=${p.length} pass_last=${p.slice(-4)}]`
      } finally {
        if (pgClient) try { await pgClient.end() } catch {}
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
        allRegions,
        newCrmTxns,
        newCrmError,
      })
    }

    // ── KPI COUNTS ───────────────────────────────────────────────────────────
    if (action === 'kpis') {
      const [[{ rejected }]]   = await conn.execute(`SELECT COUNT(*) AS rejected FROM transac_tbl WHERE trxn_status = 'rejected'`)
      const [[{ pending }]]    = await conn.execute(`SELECT COUNT(*) AS pending FROM transac_tbl WHERE trxn_status = 'pending'`)
      const [[{ walkin }]]     = await conn.execute(`SELECT COUNT(*) AS walkin FROM customer_walkin WHERE walkin_status IN ('visited not sold','enquiry','planning to visit','call later')`)
      const [[{ blacklisted }]] = await conn.execute(`SELECT COUNT(*) AS blacklisted FROM rejctd_tbl`)
      return Response.json({ rejected, pending, walkin, blacklisted })
    }

  } catch (err) {
    console.error('CRM purchases error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
