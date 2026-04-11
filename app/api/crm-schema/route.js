import mysql from 'mysql2/promise'

export async function GET(req) {
  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // 1. All tables
    const [tables] = await conn.execute(`SHOW TABLES`)
    const tableNames = tables.map(r => Object.values(r)[0])

    // 2. DESCRIBE every table
    const schema = {}
    for (const tbl of tableNames) {
      const [cols] = await conn.execute(`DESCRIBE \`${tbl}\``)
      schema[tbl] = cols
    }

    // 3. Row counts per table
    const counts = {}
    for (const tbl of tableNames) {
      const [[r]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``)
      counts[tbl] = r.cnt
    }

    // 4. Distinct values for key status/type/remark columns (top 30 per field)
    const distinctValues = {}

    const fieldsToSample = [
      { table: 'transac_tbl',    col: 'trxn_status' },
      { table: 'transac_tbl',    col: 'type_gold' },
      { table: 'transac_tbl',    col: 'txn_rmrk' },
      { table: 'transac_tbl',    col: 'pymt_mde' },
      { table: 'customer_walkin', col: 'walkin_status' },
      { table: 'customer_walkin', col: 'item_type' },
      { table: 'customer_walkin', col: 'walk_reason' },
      { table: 'customer_walkin', col: 'source' },
      { table: 'rejctd_tbl',     col: 'rej_rsn' },
      { table: 'chklist_tbl',    col: null },   // just describe it — col=null means skip distinct
    ]

    for (const { table, col } of fieldsToSample) {
      if (!tableNames.includes(table) || !col) continue
      const key = `${table}.${col}`
      try {
        const [rows] = await conn.execute(
          `SELECT \`${col}\` AS val, COUNT(*) AS cnt FROM \`${table}\`
           GROUP BY \`${col}\` ORDER BY cnt DESC LIMIT 30`
        )
        distinctValues[key] = rows
      } catch { distinctValues[key] = 'error' }
    }

    // 5. Sample 3 recent rows from each table
    const samples = {}
    for (const tbl of tableNames) {
      try {
        const [rows] = await conn.execute(`SELECT * FROM \`${tbl}\` ORDER BY id DESC LIMIT 3`)
        samples[tbl] = rows
      } catch {
        try {
          const [rows] = await conn.execute(`SELECT * FROM \`${tbl}\` LIMIT 3`)
          samples[tbl] = rows
        } catch { samples[tbl] = 'error' }
      }
    }

    // 6. Today's IST date — show live counts by status from transac_tbl
    const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]
    const [[todaySummary]] = await conn.execute(`
      SELECT
        COUNT(*) AS total_txns,
        SUM(CASE WHEN trxn_status='approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN trxn_status='pending'  THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN trxn_status='rejected' THEN 1 ELSE 0 END) AS rejected,
        COUNT(DISTINCT branch_id) AS branches_active
      FROM transac_tbl
      WHERE DATE(date + INTERVAL 330 MINUTE) = ?
    `, [todayIST])

    const [[walkinSummary]] = await conn.execute(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN walkin_status='sold' THEN 1 ELSE 0 END) AS sold,
        SUM(CASE WHEN walkin_status='visited not sold' THEN 1 ELSE 0 END) AS visited_not_sold,
        SUM(CASE WHEN walkin_status IS NULL OR walkin_status='' THEN 1 ELSE 0 END) AS no_update
      FROM customer_walkin
      WHERE DATE(date + INTERVAL 330 MINUTE) = ?
    `, [todayIST])

    // 7. Distinct walkin statuses across ALL time (not just today)
    const [[txnStatusAllTime]] = await conn.execute(`
      SELECT trxn_status, COUNT(*) AS cnt FROM transac_tbl GROUP BY trxn_status ORDER BY cnt DESC
    `).catch(() => [[]])

    const [walkinStatusAllTime] = await conn.execute(`
      SELECT IFNULL(walkin_status,'(null/empty)') AS walkin_status, COUNT(*) AS cnt
      FROM customer_walkin GROUP BY walkin_status ORDER BY cnt DESC
    `).catch(() => [[]])

    const [typeGoldAllTime] = await conn.execute(`
      SELECT type_gold, COUNT(*) AS cnt FROM transac_tbl GROUP BY type_gold ORDER BY cnt DESC
    `).catch(() => [[]])

    const [paymentModes] = await conn.execute(`
      SELECT pymt_mde, COUNT(*) AS cnt FROM transac_tbl GROUP BY pymt_mde ORDER BY cnt DESC
    `).catch(() => [[]])

    const [rejReasons] = await conn.execute(`
      SELECT IFNULL(rej_rsn,'(blank)') AS rej_rsn, COUNT(*) AS cnt
      FROM rejctd_tbl GROUP BY rej_rsn ORDER BY cnt DESC LIMIT 30
    `).catch(() => [[]])

    const [txnRemarks] = await conn.execute(`
      SELECT IFNULL(txn_rmrk,'(blank)') AS txn_rmrk, COUNT(*) AS cnt
      FROM transac_tbl WHERE txn_rmrk IS NOT NULL AND txn_rmrk != ''
      GROUP BY txn_rmrk ORDER BY cnt DESC LIMIT 30
    `).catch(() => [[]])

    return Response.json({
      tableNames,
      schema,
      counts,
      distinctValues,
      samples,
      todayIST,
      todaySummary,
      walkinSummary,
      allTime: {
        txnStatus: txnStatusAllTime,
        walkinStatus: walkinStatusAllTime,
        typeGold: typeGoldAllTime,
        paymentModes,
        rejReasons,
        txnRemarks,
      }
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
