import mysql from 'mysql2/promise'

export async function GET() {
  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    const [tables] = await conn.execute(`SHOW TABLES`)
    const tableNames = tables.map(r => Object.values(r)[0])

    // Describe all tables in parallel
    const schemaResults = await Promise.all(
      tableNames.map(tbl => conn.execute(`DESCRIBE \`${tbl}\``).then(([cols]) => [tbl, cols]))
    )
    const schema = Object.fromEntries(schemaResults)

    // Key distinct values — all in one shot
    const [
      [txnStatuses], [walkinStatuses], [typeGold], [payModes], [rejReasons], [txnRemarks], [walkReasons], [walkinSources]
    ] = await Promise.all([
      conn.execute(`SELECT trxn_status AS val, COUNT(*) cnt FROM transac_tbl GROUP BY trxn_status ORDER BY cnt DESC`),
      conn.execute(`SELECT IFNULL(walkin_status,'(empty)') AS val, COUNT(*) cnt FROM customer_walkin GROUP BY walkin_status ORDER BY cnt DESC`),
      conn.execute(`SELECT type_gold AS val, COUNT(*) cnt FROM transac_tbl GROUP BY type_gold ORDER BY cnt DESC`),
      conn.execute(`SELECT pymt_mde AS val, COUNT(*) cnt FROM transac_tbl GROUP BY pymt_mde ORDER BY cnt DESC`),
      conn.execute(`SELECT IFNULL(rej_rsn,'(blank)') AS val, COUNT(*) cnt FROM rejctd_tbl GROUP BY rej_rsn ORDER BY cnt DESC LIMIT 30`),
      conn.execute(`SELECT IFNULL(txn_rmrk,'(blank)') AS val, COUNT(*) cnt FROM transac_tbl WHERE txn_rmrk IS NOT NULL AND txn_rmrk!='' GROUP BY txn_rmrk ORDER BY cnt DESC LIMIT 30`),
      conn.execute(`SELECT IFNULL(walk_reason,'(blank)') AS val, COUNT(*) cnt FROM customer_walkin GROUP BY walk_reason ORDER BY cnt DESC LIMIT 20`),
      conn.execute(`SELECT IFNULL(source,'(blank)') AS val, COUNT(*) cnt FROM customer_walkin GROUP BY source ORDER BY cnt DESC`),
    ])

    // 3 sample rows from each table (fast — no sort on large tables)
    const sampleResults = await Promise.all(
      tableNames.map(tbl =>
        conn.execute(`SELECT * FROM \`${tbl}\` LIMIT 3`).then(([rows]) => [tbl, rows]).catch(() => [tbl, []])
      )
    )
    const samples = Object.fromEntries(sampleResults)

    return Response.json({
      tableNames,
      schema,
      distinctValues: { txnStatuses, walkinStatuses, typeGold, payModes, rejReasons, txnRemarks, walkReasons, walkinSources },
      samples,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
