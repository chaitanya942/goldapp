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
console.log('✅ Connected to New CRM (Postgres)\n')

// List all tables
const { rows: tables } = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
`)
console.log('📋 Tables:', tables.map(r => r.table_name).join(', '), '\n')

// For each table, show columns + row count
for (const { table_name } of tables) {
  const { rows: cols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table_name])

  const { rows: cnt } = await client.query(`SELECT COUNT(*) AS n FROM "${table_name}"`)
  console.log(`\n── ${table_name} (${cnt[0].n} rows) ──`)
  cols.forEach(c => console.log(`   ${c.column_name} [${c.data_type}]${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`))

  // Show 1 sample row
  const { rows: sample } = await client.query(`SELECT * FROM "${table_name}" LIMIT 1`)
  if (sample.length) {
    console.log('   Sample:', JSON.stringify(sample[0], null, 2).split('\n').slice(0, 20).join('\n'))
  }
}

await client.end()
console.log('\n✅ Done')
