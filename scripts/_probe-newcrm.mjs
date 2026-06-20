import mysql from 'mysql2/promise'
const cfg = {
  host: 'ls-03615690ef243ab6998590bc6afc98fa82422a0e.c3slnvggcshj.ap-south-1.rds.amazonaws.com',
  port: 3306,
  user: 'nighthack',
  password: 'bo2SmYq4nEztZHmwS35ENPOEOvocgIE',
  database: 'dbwhitegold_production',
  connectTimeout: 20000,
}
try {
  const conn = await mysql.createConnection(cfg)
  console.log('✓ MySQL connection OK')
  const [v] = await conn.execute('SELECT VERSION() AS v')
  console.log('Server:', v[0].v)
  const [tabs] = await conn.execute(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [cfg.database])
  console.log(`\nTables (${tabs.length}):`)
  console.log(tabs.map(t => t.TABLE_NAME).join(', '))
  // Check the tables the sync needs
  for (const tbl of ['transac_tbl','ornments_tbl','branch_tbl']) {
    const [c] = await conn.execute(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,[cfg.database,tbl])
    console.log(`\n${tbl}: ${c[0].n ? 'EXISTS' : 'MISSING'}`)
  }
  await conn.end()
} catch (e) {
  console.log('✗ MySQL failed:', e.code || e.message)
}
