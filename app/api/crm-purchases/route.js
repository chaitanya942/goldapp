// app/api/crm-purchases/route.js
// Queries CRM MySQL for rejected, pending, walk-in, and blacklisted data

import mysql from 'mysql2/promise'
import pg    from 'pg'

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

      // All old-CRM queries in parallel
      const [
        [[summary]],
        [[walkinSummary]],
        [goldByStatus],
        [branches],
        [hourly],
        [payments],
        [todayTxns],
        [todayWalkins],
      ] = await Promise.all([

        // 1. Transaction summary
        conn.execute(`
          SELECT
            COUNT(*)                                                                 AS total,
            SUM(CASE WHEN trxn_status='approved' THEN 1 ELSE 0 END)                AS approved,
            SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END)                AS rejected,
            SUM(CASE WHEN trxn_status='pending'  THEN 1 ELSE 0 END)                AS pending,
            COUNT(DISTINCT branch_id)                                               AS branches_active,
            SUM(CASE WHEN trxn_status='approved' THEN (finl_amnt+0) ELSE 0 END)   AS approved_value,
            SUM(CASE WHEN type_gold='physical'   THEN 1 ELSE 0 END)               AS physical_count,
            SUM(CASE WHEN type_gold!='physical'  THEN 1 ELSE 0 END)               AS takeover_count
          FROM transac_tbl
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
        `, [todayIST]),

        // 2. Walk-in summary
        conn.execute(`
          SELECT
            COUNT(*)                                                                          AS total,
            SUM(CASE WHEN walkin_status='sold'             THEN 1 ELSE 0 END)                AS sold,
            SUM(CASE WHEN walkin_status='visited not sold' THEN 1 ELSE 0 END)                AS visited_not_sold,
            SUM(CASE WHEN walkin_status='enquiry'          THEN 1 ELSE 0 END)                AS enquiry,
            SUM(CASE WHEN walkin_status='planning to visit'THEN 1 ELSE 0 END)                AS planning_to_visit,
            SUM(CASE WHEN walkin_status='call later'       THEN 1 ELSE 0 END)                AS call_later,
            ROUND(SUM(gms_weight + 0), 2)                                                    AS total_gold_wt
          FROM customer_walkin
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
        `, [todayIST]),

        // 3. Count by transaction status (no ornments join — column names unknown)
        conn.execute(`
          SELECT
            trxn_status,
            COUNT(*)                                    AS count,
            ROUND(SUM(finl_amnt + 0), 2)               AS total_amt
          FROM transac_tbl
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
          GROUP BY trxn_status
        `, [todayIST]),

        // 4. Branch breakdown
        conn.execute(`
          SELECT
            b.brnch_name  AS branch_name,
            COUNT(*)      AS bills,
            SUM(CASE WHEN t.trxn_status='approved' THEN 1 ELSE 0 END)              AS approved,
            SUM(CASE WHEN t.trxn_status='pending'  THEN 1 ELSE 0 END)              AS pending,
            SUM(CASE WHEN t.trxn_status='rejected' THEN 1 ELSE 0 END)              AS rejected,
            ROUND(SUM(CASE WHEN t.trxn_status='approved' THEN (t.finl_amnt+0) ELSE 0 END), 0) AS value
          FROM transac_tbl t
          LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
          WHERE DATE(t.date + INTERVAL 330 MINUTE) = ?
          GROUP BY t.branch_id, b.brnch_name
          ORDER BY value DESC
          LIMIT 20
        `, [todayIST]),

        // 5. Hourly activity
        conn.execute(`
          SELECT
            HOUR(TIME(date + INTERVAL 330 MINUTE))                                  AS hour,
            COUNT(*)                                                                 AS bills,
            SUM(CASE WHEN trxn_status='approved' THEN 1 ELSE 0 END)                AS approved,
            SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END)                AS rejected
          FROM transac_tbl
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
          GROUP BY hour
          ORDER BY hour
        `, [todayIST]),

        // 6. Payment method split (approved only)
        conn.execute(`
          SELECT
            LOWER(TRIM(pymt_mde)) AS method,
            COUNT(*)              AS count,
            ROUND(SUM(finl_amnt+0), 0) AS value
          FROM transac_tbl
          WHERE DATE(date + INTERVAL 330 MINUTE) = ?
            AND trxn_status = 'approved'
            AND pymt_mde IS NOT NULL AND pymt_mde != ''
          GROUP BY pymt_mde
          ORDER BY count DESC
        `, [todayIST]),

        // 7. Today's transactions (for timeline)
        conn.execute(`
          SELECT t.id, t.bill_no, t.cust_name, t.cust_mobile,
            t.time, t.branch_id, b.brnch_name AS branch_name,
            t.type_gold, t.trxn_status, (t.finl_amnt+0) AS amount, t.txn_rmrk, t.pymt_mde,
            0 AS net_weight_g
          FROM transac_tbl t
          LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
          WHERE DATE(t.date + INTERVAL 330 MINUTE) = ?
          ORDER BY t.time DESC
          LIMIT 200
        `, [todayIST]),

        // 8. Today's walk-ins (for timeline)
        conn.execute(`
          SELECT cw.id, cw.cust_name, cw.cust_mobile, cw.time,
            cw.walkin_status, cw.item_type, cw.gms_weight,
            cw.walk_reason, cw.source, cw.branch_id, b.brnch_name AS branch_name
          FROM customer_walkin cw
          LEFT JOIN branch_tbl b ON b.brnch_id = cw.branch_id
          WHERE DATE(cw.date + INTERVAL 330 MINUTE) = ?
          ORDER BY cw.time DESC
        `, [todayIST]),
      ])

      // Build gold pipeline from walkin weight + transaction counts
      const goldByStatusMap = {}
      for (const r of goldByStatus) goldByStatusMap[r.trxn_status] = r

      const goldPipeline = {
        walked_in_wt:    parseFloat(walkinSummary.total_gold_wt) || 0,
        purchased_wt:    0,   // ornments_tbl column names unknown — show counts instead
        purchased_gross: 0,
        pending_wt:      0,
        rejected_wt:     0,
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
        payments,
        todayTxns,
        todayWalkins,
        // legacy compat
        todaySummary: summary,
        walkinToday:  walkinSummary.total,
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
