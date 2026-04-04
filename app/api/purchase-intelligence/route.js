// app/api/purchase-intelligence/route.js
// Comprehensive purchase intelligence — branch health, repeat customers, pending aging, funnel

import mysql from 'mysql2/promise'

const ALLOWED = new Set(['overview', 'branch-matrix', 'repeat-customers', 'pending-aging', 'pipeline-intel'])

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
  const minVisits = Math.max(1, parseInt(searchParams.get('minVisits') || '2'))
  const search    = searchParams.get('search') || ''
  const page      = Math.max(0, parseInt(searchParams.get('page') || '0'))
  const pageSize  = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') || '200')))

  if (!ALLOWED.has(action)) {
    return Response.json({ error: 'Invalid action' }, { status: 400 })
  }

  let conn
  try {
    conn = await createConn()

    // ── OVERVIEW ─────────────────────────────────────────────────────────────
    if (action === 'overview') {
      const [[funnel]]     = await conn.execute(`
        SELECT
          COUNT(*)                                                                       AS total_submissions,
          SUM(CASE WHEN trxn_status='approved' THEN 1 ELSE 0 END)                       AS approved,
          SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END)                       AS rejected,
          SUM(CASE WHEN trxn_status='pending'  THEN 1 ELSE 0 END)                       AS pending,
          ROUND(SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0) * 100, 1)                                             AS overall_rejection_rate,
          -- today
          SUM(CASE WHEN trxn_status='approved' AND date = CURDATE() THEN 1 ELSE 0 END)  AS approved_today,
          SUM(CASE WHEN trxn_status='approved' AND date >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN 1 ELSE 0 END) AS approved_mtd,
          SUM(CASE WHEN trxn_status='approved' AND date >= DATE_FORMAT(CURDATE(),'%Y-%m-01')
                THEN (finl_amnt + 0) ELSE 0 END)                                       AS value_mtd
        FROM transac_tbl
      `)

      // Branch activity buckets
      const [[branchActivity]] = await conn.execute(`
        SELECT
          COUNT(DISTINCT branch_id)                                                                             AS total_branches,
          SUM(CASE WHEN days_since = 0    THEN 1 ELSE 0 END)                                                   AS active_today,
          SUM(CASE WHEN days_since BETWEEN 1 AND 6 THEN 1 ELSE 0 END)                                         AS active_week,
          SUM(CASE WHEN days_since BETWEEN 7 AND 29 THEN 1 ELSE 0 END)                                        AS dormant,
          SUM(CASE WHEN days_since >= 30 THEN 1 ELSE 0 END)                                                    AS inactive
        FROM (
          SELECT branch_id,
            DATEDIFF(CURDATE(), MAX(CASE WHEN trxn_status='approved' THEN date END)) AS days_since
          FROM transac_tbl
          WHERE branch_id IS NOT NULL AND branch_id != ''
          GROUP BY branch_id
          HAVING MAX(CASE WHEN trxn_status='approved' THEN date END) IS NOT NULL
        ) sub
      `)

      // Pending aging buckets
      const [pendingAging] = await conn.execute(`
        SELECT
          CASE
            WHEN DATEDIFF(CURDATE(), date) = 0          THEN 'Today'
            WHEN DATEDIFF(CURDATE(), date) <= 7         THEN '1–7 days'
            WHEN DATEDIFF(CURDATE(), date) <= 30        THEN '8–30 days'
            WHEN DATEDIFF(CURDATE(), date) <= 90        THEN '31–90 days'
            ELSE '90+ days'
          END AS bucket,
          COUNT(*) AS count,
          SUM(finl_amnt + 0) AS total_value,
          MAX(DATEDIFF(CURDATE(), date)) AS max_days
        FROM transac_tbl
        WHERE trxn_status = 'pending'
        GROUP BY bucket
        ORDER BY max_days DESC
      `)

      // Top rejection branches (rate > 20%)
      const [highRejBranches] = await conn.execute(`
        SELECT b.brnch_name AS branch_name, t.branch_id,
          COUNT(*) AS total,
          SUM(CASE WHEN t.trxn_status='rejected' THEN 1 ELSE 0 END) AS rejected,
          ROUND(SUM(CASE WHEN t.trxn_status='rejected' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0)*100,1) AS rejection_rate
        FROM transac_tbl t
        LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
        WHERE t.branch_id IS NOT NULL AND t.branch_id != ''
        GROUP BY t.branch_id, b.brnch_name
        HAVING total >= 5 AND rejection_rate > 20
        ORDER BY rejection_rate DESC
        LIMIT 10
      `)

      // Walk-in funnel
      const [[walkinFunnel]] = await conn.execute(`
        SELECT
          COUNT(*) AS total_walkin,
          SUM(CASE WHEN walkin_status='sold' THEN 1 ELSE 0 END)                AS sold,
          SUM(CASE WHEN walkin_status='visited not sold' THEN 1 ELSE 0 END)    AS visited_not_sold,
          SUM(CASE WHEN walkin_status='enquiry' THEN 1 ELSE 0 END)             AS enquiry,
          SUM(CASE WHEN walkin_status='planning to visit' THEN 1 ELSE 0 END)   AS planning,
          SUM(CASE WHEN walkin_status='call later' THEN 1 ELSE 0 END)          AS call_later
        FROM customer_walkin
      `)

      return Response.json({ funnel, branchActivity, pendingAging, highRejBranches, walkinFunnel })
    }

    // ── BRANCH MATRIX ─────────────────────────────────────────────────────────
    if (action === 'branch-matrix') {
      // Main branch stats from CRM transac_tbl
      const [branches] = await conn.execute(`
        SELECT
          b.brnch_id  AS branch_id,
          b.brnch_name AS branch_name,
          COUNT(t.id)                                                                              AS total_submissions,
          SUM(CASE WHEN t.trxn_status='approved' THEN 1 ELSE 0 END)                               AS total_approved,
          SUM(CASE WHEN t.trxn_status='rejected' THEN 1 ELSE 0 END)                               AS total_rejected,
          SUM(CASE WHEN t.trxn_status='pending'  THEN 1 ELSE 0 END)                               AS total_pending,
          MAX(CASE WHEN t.trxn_status='approved' THEN t.date END)                                 AS last_approved_date,
          DATEDIFF(CURDATE(), MAX(CASE WHEN t.trxn_status='approved' THEN t.date END))            AS days_since_purchase,
          ROUND(
            SUM(CASE WHEN t.trxn_status='rejected' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(t.id), 0) * 100, 1)                                                    AS rejection_rate,
          -- MTD (this month approved)
          SUM(CASE WHEN t.trxn_status='approved'
                AND t.date >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN 1 ELSE 0 END)                AS mtd_count,
          SUM(CASE WHEN t.trxn_status='approved'
                AND t.date >= DATE_FORMAT(CURDATE(),'%Y-%m-01')
                THEN (t.finl_amnt + 0) ELSE 0 END)                                               AS mtd_value,
          -- Last month approved
          SUM(CASE WHEN t.trxn_status='approved'
                AND t.date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH),'%Y-%m-01')
                AND t.date <  DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN 1 ELSE 0 END)               AS lm_count,
          SUM(CASE WHEN t.trxn_status='approved'
                AND t.date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH),'%Y-%m-01')
                AND t.date <  DATE_FORMAT(CURDATE(),'%Y-%m-01')
                THEN (t.finl_amnt + 0) ELSE 0 END)                                               AS lm_value,
          -- Last 7 days
          SUM(CASE WHEN t.trxn_status='approved'
                AND t.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END)             AS last7_count,
          SUM(CASE WHEN t.trxn_status='approved'
                AND t.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                THEN (t.finl_amnt + 0) ELSE 0 END)                                               AS last7_value
        FROM branch_tbl b
        LEFT JOIN transac_tbl t ON t.branch_id = b.brnch_id
        WHERE b.brnch_id IS NOT NULL AND b.brnch_id != '' AND b.brnch_name IS NOT NULL
        GROUP BY b.brnch_id, b.brnch_name
        HAVING total_submissions > 0
        ORDER BY ISNULL(last_approved_date), days_since_purchase ASC, total_approved DESC
      `)

      // Walk-in pipeline count per branch
      const [walkinCounts] = await conn.execute(`
        SELECT branch_id, COUNT(*) AS pipeline_count
        FROM customer_walkin
        WHERE walkin_status IN ('visited not sold','enquiry','planning to visit','call later')
        GROUP BY branch_id
      `)
      const walkinMap = {}
      walkinCounts.forEach(w => { walkinMap[w.branch_id] = Number(w.pipeline_count) })

      // Merge walk-in counts into branch data
      const enriched = branches.map(b => ({
        ...b,
        pipeline_count: walkinMap[b.branch_id] || 0,
        days_since_purchase: b.days_since_purchase === null ? 9999 : Number(b.days_since_purchase),
        growth_pct: b.lm_count > 0
          ? parseFloat(((Number(b.mtd_count) - Number(b.lm_count)) / Number(b.lm_count) * 100).toFixed(1))
          : null,
      }))

      return Response.json({ branches: enriched })
    }

    // ── REPEAT CUSTOMERS ─────────────────────────────────────────────────────
    if (action === 'repeat-customers') {
      const offset = page * pageSize
      const searchCond = search
        ? `AND (cust_name LIKE ? OR cust_mobile LIKE ?)` : ''
      const searchParams = search ? [`%${search}%`, `%${search}%`] : []

      const [[{ total }]] = await conn.execute(
        `SELECT COUNT(*) AS total FROM (
           SELECT cust_mobile
           FROM transac_tbl
           WHERE cust_mobile IS NOT NULL AND cust_mobile != '' AND LENGTH(cust_mobile) >= 8
             ${searchCond}
           GROUP BY cust_mobile
           HAVING COUNT(*) >= ?
         ) sub`,
        [...searchParams, minVisits]
      )

      const [rows] = await conn.execute(
        `SELECT
           cust_mobile,
           -- Take the most recent name used
           SUBSTRING_INDEX(GROUP_CONCAT(cust_name ORDER BY date DESC SEPARATOR '|||'), '|||', 1) AS cust_name,
           COUNT(*)                                                                     AS total_visits,
           SUM(CASE WHEN trxn_status='approved' THEN 1 ELSE 0 END)                    AS approved_visits,
           SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END)                    AS rejected_visits,
           SUM(CASE WHEN trxn_status='pending'  THEN 1 ELSE 0 END)                    AS pending_visits,
           SUM(CASE WHEN trxn_status='approved' THEN (finl_amnt+0) ELSE 0 END)        AS total_value,
           COUNT(DISTINCT branch_id)                                                   AS branches_visited,
           MIN(date)                                                                   AS first_visit,
           MAX(date)                                                                   AS last_visit,
           DATEDIFF(CURDATE(), MAX(date))                                              AS days_since_last
         FROM transac_tbl
         WHERE cust_mobile IS NOT NULL AND cust_mobile != '' AND LENGTH(cust_mobile) >= 8
           ${searchCond}
         GROUP BY cust_mobile
         HAVING total_visits >= ?
         ORDER BY total_visits DESC, total_value DESC
         LIMIT ? OFFSET ?`,
        [...searchParams, minVisits, pageSize, offset]
      )

      // Stats
      const [[stats]] = await conn.execute(`
        SELECT
          COUNT(DISTINCT cust_mobile)                                                  AS unique_customers,
          SUM(CASE WHEN visit_count > 1  THEN 1 ELSE 0 END)                           AS repeat_customers,
          SUM(CASE WHEN visit_count >= 5 THEN 1 ELSE 0 END)                           AS loyal_5plus,
          SUM(CASE WHEN visit_count >= 10 THEN 1 ELSE 0 END)                          AS loyal_10plus,
          SUM(CASE WHEN branch_count > 1 THEN 1 ELSE 0 END)                           AS multi_branch
        FROM (
          SELECT cust_mobile,
            COUNT(*) AS visit_count,
            COUNT(DISTINCT branch_id) AS branch_count
          FROM transac_tbl
          WHERE cust_mobile IS NOT NULL AND cust_mobile != '' AND LENGTH(cust_mobile) >= 8
          GROUP BY cust_mobile
        ) sub
      `)

      return Response.json({ rows, total, stats, page, pageSize })
    }

    // ── PENDING AGING ─────────────────────────────────────────────────────────
    if (action === 'pending-aging') {
      // All pending bills sorted by age
      const [rows] = await conn.execute(`
        SELECT
          t.id, t.bill_no, t.cust_name, t.cust_mobile,
          t.date, t.branch_id, b.brnch_name AS branch_name,
          DATEDIFF(CURDATE(), t.date)        AS days_pending,
          (t.finl_amnt + 0)                  AS amount,
          t.pymt_mde, t.txn_rmrk, t.type_gold,
          t.pmt_status
        FROM transac_tbl t
        LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
        WHERE t.trxn_status = 'pending'
        ORDER BY days_pending DESC
      `)

      // Aging summary
      const [[agingSummary]] = await conn.execute(`
        SELECT
          COUNT(*) AS total_pending,
          SUM(finl_amnt + 0) AS total_value,
          MAX(DATEDIFF(CURDATE(), date)) AS oldest_days,
          AVG(DATEDIFF(CURDATE(), date)) AS avg_days,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) = 0 THEN 1 ELSE 0 END) AS today_count,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) BETWEEN 1 AND 7 THEN 1 ELSE 0 END) AS week_count,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) BETWEEN 8 AND 30 THEN 1 ELSE 0 END) AS month_count,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS quarter_count,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) > 90 THEN 1 ELSE 0 END) AS old_count
        FROM transac_tbl WHERE trxn_status = 'pending'
      `)

      // By branch
      const [byBranch] = await conn.execute(`
        SELECT t.branch_id, b.brnch_name AS branch_name,
          COUNT(*) AS count,
          SUM(t.finl_amnt + 0) AS total_value,
          MAX(DATEDIFF(CURDATE(), t.date)) AS oldest_days,
          AVG(DATEDIFF(CURDATE(), t.date)) AS avg_days
        FROM transac_tbl t
        LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
        WHERE t.trxn_status = 'pending'
        GROUP BY t.branch_id, b.brnch_name
        ORDER BY oldest_days DESC
      `)

      return Response.json({ rows, agingSummary, byBranch })
    }

    // ── PIPELINE INTELLIGENCE ─────────────────────────────────────────────────
    if (action === 'pipeline-intel') {
      // Full walk-in funnel
      const [[funnel]] = await conn.execute(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN walkin_status='sold' THEN 1 ELSE 0 END)                AS sold,
          SUM(CASE WHEN walkin_status='visited not sold' THEN 1 ELSE 0 END)    AS visited_not_sold,
          SUM(CASE WHEN walkin_status='enquiry' THEN 1 ELSE 0 END)             AS enquiry,
          SUM(CASE WHEN walkin_status='planning to visit' THEN 1 ELSE 0 END)   AS planning,
          SUM(CASE WHEN walkin_status='call later' THEN 1 ELSE 0 END)          AS call_later,
          SUM(CASE WHEN walkin_status NOT IN ('sold','visited not sold','enquiry','planning to visit','call later') THEN 1 ELSE 0 END) AS other
        FROM customer_walkin
      `)

      // Pipeline aging (walk-ins still in pipeline, how old)
      const [[pipelineAging]] = await conn.execute(`
        SELECT
          COUNT(*) AS total_pipeline,
          MAX(DATEDIFF(CURDATE(), date)) AS oldest_days,
          AVG(DATEDIFF(CURDATE(), date)) AS avg_days,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) <= 3 THEN 1 ELSE 0 END) AS fresh,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) BETWEEN 4 AND 14 THEN 1 ELSE 0 END) AS recent,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) BETWEEN 15 AND 30 THEN 1 ELSE 0 END) AS stale,
          SUM(CASE WHEN DATEDIFF(CURDATE(), date) > 30 THEN 1 ELSE 0 END) AS old_leads
        FROM customer_walkin
        WHERE walkin_status IN ('visited not sold','enquiry','planning to visit','call later')
      `)

      // Source distribution
      const [sourceDist] = await conn.execute(`
        SELECT IFNULL(NULLIF(source,''), '(not captured)') AS source,
          COUNT(*) AS total,
          SUM(CASE WHEN walkin_status='sold' THEN 1 ELSE 0 END) AS converted,
          ROUND(SUM(CASE WHEN walkin_status='sold' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0)*100,1) AS conv_rate
        FROM customer_walkin
        GROUP BY source ORDER BY total DESC LIMIT 10
      `)

      // Branch conversion (top 20 by walk-in volume)
      const [branchConv] = await conn.execute(`
        SELECT
          cw.branch_id, b.brnch_name AS branch_name,
          COUNT(*) AS total,
          SUM(CASE WHEN cw.walkin_status='sold' THEN 1 ELSE 0 END) AS sold,
          SUM(CASE WHEN cw.walkin_status IN ('visited not sold','enquiry','planning to visit','call later') THEN 1 ELSE 0 END) AS pipeline,
          ROUND(SUM(CASE WHEN cw.walkin_status='sold' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0)*100,1) AS conv_rate
        FROM customer_walkin cw
        LEFT JOIN branch_tbl b ON b.brnch_id = cw.branch_id
        GROUP BY cw.branch_id, b.brnch_name
        ORDER BY total DESC
        LIMIT 20
      `)

      // Walk-in customers also in transac_tbl (cross-reference for conversion validation)
      return Response.json({ funnel, pipelineAging, sourceDist, branchConv })
    }

  } catch (err) {
    console.error('Purchase intelligence error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
