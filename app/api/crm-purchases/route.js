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
      if (search) { conditions.push('(cust_name LIKE ? OR cust_mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
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

      // Fetch region mapping from Supabase branch management (crm_branch_id → region)
      const { data: sbBranches } = await supabase
        .from('branches')
        .select('crm_branch_id, region')
        .not('crm_branch_id', 'is', null)
      const regionMap = {}
      const allRegions = []
      for (const b of sbBranches || []) {
        if (b.crm_branch_id) regionMap[String(b.crm_branch_id)] = b.region || ''
        if (b.region && !allRegions.includes(b.region)) allRegions.push(b.region)
      }
      allRegions.sort()

      // All old-CRM queries in parallel
      const [
        [[walkinSummary]],
        [ornmentRows],
        [branches],
        [hourly],
        [todayTxns],
        [todayWalkins],
        [[kycBlacklisted]],
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

        // 5. Today's transactions for timeline (grms_wet CSV summed in frontend)
        conn.execute(`
          SELECT t.id, t.bill_no, t.cust_name, t.cust_mobile,
            t.time, t.branch_id, b.brnch_name AS branch_name,
            t.type_gold, t.trxn_status, (t.finl_amnt+0) AS amount,
            t.txn_rmrk, t.pymt_mde, o.grms_wet AS grms_wet_csv
          FROM transac_tbl t
          LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
          LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
          WHERE DATE(t.date + INTERVAL 330 MINUTE) = ?
          ORDER BY t.time DESC LIMIT 300
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

        // 7. KYC blacklisted today (rejctd_tbl)
        conn.execute(`
          SELECT COUNT(*) AS cnt, ROUND(SUM(grams+0),2) AS total_grams
          FROM rejctd_tbl WHERE DATE(date + INTERVAL 330 MINUTE) = ?
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

      // grms_wet is CSV per row (e.g. "24.91,17.05,2.96") — must parse in JS
      const csvSum = str => String(str || '').split(',').reduce((s, v) => {
        const n = parseFloat(v.trim()); return s + (isNaN(n) ? 0 : n)
      }, 0)

      // Build per-status and per-type_gold aggregates from ornment rows
      const byStatus    = {}  // { approved: { count, wt, value }, pending: {...}, rejected: {...} }
      const byType      = {}  // { physical: { approved, pending, rejected, wt }, released: {...} }
      const seenTxns    = new Set()

      for (const r of ornmentRows) {
        const st = r.trxn_status
        const tp = r.type_gold || 'physical'
        const wt = csvSum(r.grms_wet)

        if (!byStatus[st]) byStatus[st] = { count: 0, wt: 0, value: 0 }
        if (!seenTxns.has(r.txn_id)) {
          byStatus[st].count++
          byStatus[st].value += parseFloat(r.amount) || 0
          seenTxns.add(r.txn_id)
        }
        byStatus[st].wt += wt

        if (!byType[tp]) byType[tp] = { approved: 0, pending: 0, rejected: 0, wt: 0 }
        byType[tp][st] = (byType[tp][st] || 0) + (seenTxns.has(r.txn_id) ? 0 : 1)
        byType[tp].wt += wt
      }

      // Walkins not billed = walkin_status not 'sold'
      const walkedOutCount   = todayWalkins.filter(w => w.walkin_status === 'visited not sold').length
      const noBillCount      = todayWalkins.filter(w => !w.walkin_status || w.walkin_status === '').length
      const notBilledWt      = todayWalkins
        .filter(w => w.walkin_status !== 'sold')
        .reduce((s, w) => s + (parseFloat(w.gms_weight) || 0), 0)

      // Build summary object from ornment rows (more accurate than old query 1)
      const summary = {
        total:          seenTxns.size,
        approved:       byStatus['approved']?.count || 0,
        pending:        byStatus['pending']?.count  || 0,
        rejected:       byStatus['rejected']?.count || 0,
        approved_value: parseFloat((byStatus['approved']?.value || 0).toFixed(2)),
        branches_active: new Set(todayTxns.map(t => t.branch_id)).size,
      }

      const goldPipeline = {
        walked_in_wt:       parseFloat(walkinSummary.total_gold_wt) || 0,
        missing_weight_cnt: walkinSummary.missing_weight_count || 0,
        purchased_wt:       parseFloat((byStatus['approved']?.wt || 0).toFixed(2)),
        pending_wt:         parseFloat((byStatus['pending']?.wt  || 0).toFixed(2)),
        rejected_wt:        parseFloat((byStatus['rejected']?.wt || 0).toFixed(2)),
        not_billed_wt:      parseFloat(notBilledWt.toFixed(2)),
        kyc_blacklisted_cnt: Number(kycBlacklisted.cnt) || 0,
        kyc_blacklisted_wt:  parseFloat(kycBlacklisted.total_grams) || 0,
        kyc_checklist_cnt:   Number(chklistCount.cnt) || 0,
        walked_out_cnt:      walkedOutCount,
        no_bill_cnt:         noBillCount,
        // Physical vs released/takeover split
        physical:  { approved: byType['physical']?.approved || 0, pending: byType['physical']?.pending || 0, rejected: byType['physical']?.rejected || 0 },
        released:  { approved: byType['released']?.approved || 0, pending: byType['released']?.pending || 0, rejected: byType['released']?.rejected || 0 },
      }

      // Try new CRM for stage breakdown (best-effort, don't fail if unreachable)
      let stages = null
      let pgClient
      try {
        pgClient = new PgClient({
          host:     process.env.NEW_CRM_DB_HOST,
          port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
          database: process.env.NEW_CRM_DB_NAME,
          user:     process.env.NEW_CRM_DB_USER,
          password: process.env.NEW_CRM_DB_PASSWORD,
          ssl:      { rejectUnauthorized: false },
          connectionTimeoutMillis: 5000,
        })
        await pgClient.connect()

        const todayStart = `${todayIST}T00:00:00+05:30`
        const todayEnd   = `${todayIST}T23:59:59+05:30`

        const { rows: stageRows } = await pgClient.query(`
          SELECT
            t.status,
            COUNT(*)                                   AS count,
            COALESCE(ROUND(SUM(ow.net_weight)::numeric, 2), 0) AS net_wt
          FROM "Transaction" t
          LEFT JOIN (
            SELECT q.transaction_id, SUM(o.net_weight) AS net_weight
            FROM "Quotation" q
            JOIN "Ornament" o ON o.quotation_id = q.id
            GROUP BY q.transaction_id
          ) ow ON ow.transaction_id = t.id
          WHERE t.created_at BETWEEN $1 AND $2
          GROUP BY t.status
          ORDER BY count DESC
        `, [todayStart, todayEnd])

        stages = {}
        for (const r of stageRows) {
          stages[r.status] = { count: Number(r.count), net_wt: parseFloat(r.net_wt) || 0 }
        }
      } catch (e) {
        // New CRM unreachable — stages will be null, UI falls back gracefully
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
        allRegions,
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
