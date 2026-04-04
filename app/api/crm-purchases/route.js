// app/api/crm-purchases/route.js
// Queries CRM MySQL for rejected, pending, walk-in, and blacklisted data

import mysql from 'mysql2/promise'

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
      if (fromDate) { conditions.push('t.date >= ?');                                       params.push(fromDate) }
      if (toDate)   { conditions.push('t.date <= ?');                                       params.push(toDate) }
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
           t.date, t.time, t.branch_id, t.type_gold,
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
      if (fromDate) { conditions.push('t.date >= ?');                                       params.push(fromDate) }
      if (toDate)   { conditions.push('t.date <= ?');                                       params.push(toDate) }
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
           t.date, t.time, t.branch_id, t.type_gold,
           t.finl_amnt, t.txn_rmrk,
           t.pymt_mde, t.pmt_status, t.trxn_status,
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

      if (branch)   { conditions.push('cw.branch_id = ?');                                  params.push(branch) }
      if (fromDate) { conditions.push('cw.date >= ?');                                       params.push(fromDate) }
      if (toDate)   { conditions.push('cw.date <= ?');                                       params.push(toDate) }
      if (search)   { conditions.push('(cw.cust_name LIKE ? OR cw.cust_mobile LIKE ?)');   params.push(`%${search}%`, `%${search}%`) }

      const where = conditions.join(' AND ')
      const offset = page * pageSize

      const [[{ total }]] = await conn.execute(
        `SELECT COUNT(*) AS total FROM customer_walkin cw WHERE ${where}`,
        params
      )

      const [rows] = await conn.execute(
        `SELECT
           cw.id, cw.cust_name, cw.cust_mobile, cw.item_type, cw.gms_weight,
           cw.walkin_status, cw.walk_reason, cw.source, cw.date, cw.time,
           cw.branch_id, b.brnch_name AS branch_name
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
      // IST today
      const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
      const todayIST = istNow.toISOString().split('T')[0]

      // Today's transaction summary
      const [[todaySummary]] = await conn.execute(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN trxn_status='approved' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN trxn_status='pending'  THEN 1 ELSE 0 END) AS pending,
          COUNT(DISTINCT branch_id) AS branches_active,
          SUM(CASE WHEN trxn_status='approved' THEN (finl_amnt+0) ELSE 0 END) AS approved_value
        FROM transac_tbl WHERE date = ?
      `, [todayIST])

      // Today's walk-ins count
      const [[walkinToday]] = await conn.execute(
        `SELECT COUNT(*) AS count FROM customer_walkin WHERE date = ?`, [todayIST]
      )

      // Today's transactions (detail)
      const [todayTxns] = await conn.execute(`
        SELECT t.id, t.bill_no, t.cust_name, t.cust_mobile,
          t.time, t.branch_id, b.brnch_name AS branch_name,
          t.type_gold, t.trxn_status, (t.finl_amnt+0) AS amount, t.txn_rmrk, t.pymt_mde
        FROM transac_tbl t
        LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
        WHERE t.date = ?
        ORDER BY t.time DESC
      `, [todayIST])

      // Today's walk-ins (detail)
      const [todayWalkins] = await conn.execute(`
        SELECT cw.id, cw.cust_name, cw.cust_mobile, cw.time,
          cw.walkin_status, cw.item_type, cw.gms_weight,
          cw.walk_reason, cw.source, cw.branch_id, b.brnch_name AS branch_name
        FROM customer_walkin cw
        LEFT JOIN branch_tbl b ON b.brnch_id = cw.branch_id
        WHERE cw.date = ?
        ORDER BY cw.time DESC
      `, [todayIST])

      // ── PENDING GOLD AT EACH BRANCH ──────────────────────────────────────
      // Gold physically present at branch — bill created & weighed but NOT paid yet
      const [pendingGold] = await conn.execute(`
        SELECT
          t.branch_id,
          b.brnch_name                          AS branch_name,
          COUNT(DISTINCT t.id)                  AS pending_bills,
          ROUND(SUM(o.grms_wet + 0), 2)         AS gross_weight_g,
          ROUND(SUM(o.net_wet   + 0), 2)         AS net_weight_g,
          SUM(t.finl_amnt + 0)                  AS pending_value,
          DATEDIFF(CURDATE(), MIN(t.date))       AS oldest_days,
          MIN(t.date)                            AS oldest_date
        FROM transac_tbl t
        LEFT JOIN branch_tbl b  ON b.brnch_id  = t.branch_id
        LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
        WHERE t.trxn_status = 'pending'
          AND t.branch_id IS NOT NULL AND t.branch_id != ''
        GROUP BY t.branch_id, b.brnch_name
        HAVING pending_bills > 0
        ORDER BY net_weight_g DESC
      `)

      // ── PENDING GOLD TOTALS ───────────────────────────────────────────────
      const [[pendingTotals]] = await conn.execute(`
        SELECT
          COUNT(DISTINCT t.id)          AS total_bills,
          ROUND(SUM(o.net_wet + 0), 2)  AS total_net_g,
          SUM(t.finl_amnt + 0)          AS total_value
        FROM transac_tbl t
        LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
        WHERE t.trxn_status = 'pending'
      `)

      return Response.json({
        todayIST,
        todaySummary,
        walkinToday: walkinToday.count,
        todayTxns,
        todayWalkins,
        pendingGold,
        pendingTotals,
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
