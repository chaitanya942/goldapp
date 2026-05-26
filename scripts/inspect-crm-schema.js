// One-shot script: dumps the column list + a sample row from every relevant
// table in the old-CRM DB, so we can see exactly what fields exist and what
// they're called.
//
// Run with:  node --env-file=.env.local scripts/inspect-crm-schema.js

const mysql = require('mysql2/promise')

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.CRM_DB_HOST,
    port:     parseInt(process.env.CRM_DB_PORT || '3306'),
    database: process.env.CRM_DB_NAME,
    user:     process.env.CRM_DB_USER,
    password: process.env.CRM_DB_PASSWORD,
  })

  console.log(`\nConnected to ${process.env.CRM_DB_NAME} @ ${process.env.CRM_DB_HOST}`)

  // List every table in the schema.
  const [tables] = await conn.execute(
    'SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    [process.env.CRM_DB_NAME]
  )

  console.log(`\n=== ALL TABLES (${tables.length}) ===`)
  tables.forEach(t => console.log(`  ${t.TABLE_NAME.padEnd(40)} ~${t.TABLE_ROWS} rows`))

  // For each likely-relevant table, dump columns + 1 sample row.
  const targets = tables
    .map(t => t.TABLE_NAME)
    .filter(n => /transac|ornment|branch|customer|payment|bank/i.test(n))

  for (const tbl of targets) {
    console.log(`\n=== ${tbl} ===`)
    try {
      const [cols] = await conn.execute(`DESCRIBE \`${tbl}\``)
      cols.forEach(c => console.log(`  ${c.Field.padEnd(28)} ${c.Type}`))

      // Try to pull the most-recent row.
      const dateCol = cols.find(c => /^date|^dt/i.test(c.Field))?.Field
      const orderBy = dateCol ? `ORDER BY \`${dateCol}\` DESC` : ''
      const [sample] = await conn.execute(`SELECT * FROM \`${tbl}\` ${orderBy} LIMIT 1`)
      if (sample.length) {
        console.log(`\n  SAMPLE (most recent row):`)
        for (const [k, v] of Object.entries(sample[0])) {
          const s = v === null ? 'NULL' : String(v).slice(0, 80)
          console.log(`    ${k.padEnd(28)} ${s}`)
        }
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`)
    }
  }

  await conn.end()
  console.log('\nDone.\n')
}

main().catch(err => { console.error(err); process.exit(1) })
