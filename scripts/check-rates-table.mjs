// One-shot probe: does the new CRM have a live gold-rates table?
// Usage: node scripts/check-rates-table.mjs
import pg from 'pg'
const { Client } = pg

const client = new Client({
  host: 'ls-fcaf73845b17cb9d15776a8a4620e2b28d2e308d.c3slnvggcshj.ap-south-1.rds.amazonaws.com',
  port: 5432,
  database: 'dbwhitegold_production',
  user: 'marketing@whitegold.money',
  password: 'marketingAccess@2026',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
})

await client.connect()
console.log('✅ Connected\n')

// 1. List all tables, look for rate/price/gold/live in the name
const { rows: tables } = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
`)
const candidates = tables.filter(t =>
  /rate|price|gold|live|tick|quote|spot|metal/i.test(t.table_name)
)
console.log(`All tables (${tables.length}):`, tables.map(t => t.table_name).join(', '), '\n')

if (candidates.length === 0) {
  console.log('❌ No table matched rate/price/gold/live/tick/quote/spot/metal')
} else {
  console.log(`🎯 Candidate tables (${candidates.length}):`, candidates.map(t => t.table_name).join(', '), '\n')

  for (const { table_name } of candidates) {
    const { rows: cols } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table_name])
    console.log(`── ${table_name} ──`)
    cols.forEach(c => console.log(`   ${c.column_name} [${c.data_type}]`))

    // Sample the latest row
    const { rows: latest } = await client.query(`
      SELECT * FROM "${table_name}"
      ORDER BY ${cols.some(c => c.column_name === 'created_at') ? 'created_at' : cols.some(c => c.column_name === 'updated_at') ? 'updated_at' : '1'} DESC
      LIMIT 3
    `)
    console.log('   Latest 3 rows:')
    for (const r of latest) console.log('  ', JSON.stringify(r))
    console.log()
  }
}

await client.end()
