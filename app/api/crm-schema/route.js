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

    // Just the key tables we need to understand
    const targets = ['transac_tbl', 'customer_walkin', 'rejctd_tbl', 'tkovr_app', 'cust_walk_status', 'customer_tbl', 'paymt_trxns', 'chklist_tbl']

    const schema = {}
    for (const tbl of targets) {
      try {
        const [cols] = await conn.execute(`DESCRIBE \`${tbl}\``)
        schema[tbl] = cols.map(c => ({ field: c.Field, type: c.Type, key: c.Key }))
      } catch(e) { schema[tbl] = 'error: ' + e.message }
    }

    // Distinct values for key operational fields
    const [txnStatuses]    = await conn.execute(`SELECT trxn_status, COUNT(*) cnt FROM transac_tbl GROUP BY trxn_status ORDER BY cnt DESC`)
    const [typeGold]       = await conn.execute(`SELECT type_gold, COUNT(*) cnt FROM transac_tbl GROUP BY type_gold ORDER BY cnt DESC`)
    const [payModes]       = await conn.execute(`SELECT pymt_mde, COUNT(*) cnt FROM transac_tbl WHERE pymt_mde IS NOT NULL GROUP BY pymt_mde ORDER BY cnt DESC`)
    const [txnRemarks]     = await conn.execute(`SELECT txn_rmrk, COUNT(*) cnt FROM transac_tbl WHERE txn_rmrk IS NOT NULL AND txn_rmrk!='' GROUP BY txn_rmrk ORDER BY cnt DESC LIMIT 30`)
    const [walkinStatuses] = await conn.execute(`SELECT IFNULL(walkin_status,'(empty)') val, COUNT(*) cnt FROM customer_walkin GROUP BY walkin_status ORDER BY cnt DESC`)
    const [walkReasons]    = await conn.execute(`SELECT IFNULL(walk_reason,'(blank)') val, COUNT(*) cnt FROM customer_walkin GROUP BY walk_reason ORDER BY cnt DESC LIMIT 20`)
    const [walkSources]    = await conn.execute(`SELECT IFNULL(source,'(blank)') val, COUNT(*) cnt FROM customer_walkin GROUP BY source ORDER BY cnt DESC`)
    const [rejReasons]     = await conn.execute(`SELECT IFNULL(rej_rsn,'(blank)') val, COUNT(*) cnt FROM rejctd_tbl GROUP BY rej_rsn ORDER BY cnt DESC LIMIT 20`)
    const [walkStatuses]   = await conn.execute(`SELECT led_status, COUNT(*) cnt FROM cust_walk_status GROUP BY led_status ORDER BY cnt DESC LIMIT 20`).catch(() => [[]])

    // Sample rows from tkovr_app to understand takeover flow
    const [tkovrSample]   = await conn.execute(`SELECT * FROM tkovr_app LIMIT 5`).catch(() => [[]])
    const [custWalkSample] = await conn.execute(`SELECT * FROM cust_walk_status ORDER BY id DESC LIMIT 5`).catch(() => [[]])
    const [payTrxnSample] = await conn.execute(`SELECT * FROM paymt_trxns ORDER BY id DESC LIMIT 5`).catch(() => [[]])

    // How does kyc_id in chklist_tbl link to customer?
    const [chklistSample] = await conn.execute(`SELECT c.*, ct.cust_name, ct.cust_mobile FROM chklist_tbl c LEFT JOIN customer_tbl ct ON ct.cust_id = c.kyc_id ORDER BY c.id DESC LIMIT 5`).catch(() => [[]])

    return Response.json({
      schema,
      distinctValues: { txnStatuses, typeGold, payModes, txnRemarks, walkinStatuses, walkReasons, walkSources, rejReasons, walkStatuses },
      samples: { tkovr_app: tkovrSample, cust_walk_status: custWalkSample, paymt_trxns: payTrxnSample, chklist_join_test: chklistSample },
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
