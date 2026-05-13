// How fresh is the GoldRate table? Update frequency, latest values, state coverage.
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

// 1. Total rows + age range
const { rows: stats } = await client.query(`
  SELECT
    COUNT(*) AS total,
    MIN(created_at) AS oldest,
    MAX(created_at) AS newest,
    COUNT(DISTINCT state_id) AS distinct_states
  FROM "GoldRate"
`)
console.log('── GoldRate overview ──')
console.log('  Total rows         :', stats[0].total)
console.log('  Oldest entry       :', stats[0].oldest)
console.log('  Newest entry       :', stats[0].newest)
console.log('  Distinct states    :', stats[0].distinct_states)
console.log('  Newest age         :', Math.floor((Date.now() - new Date(stats[0].newest).getTime()) / 60000), 'minutes ago')
console.log()

// 2. Update frequency — last 24h activity
const { rows: freq } = await client.query(`
  SELECT
    DATE_TRUNC('hour', created_at) AS hour,
    COUNT(*) AS updates
  FROM "GoldRate"
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY hour
  ORDER BY hour DESC
  LIMIT 24
`)
console.log('── Updates per hour (last 24h) ──')
if (freq.length === 0) {
  console.log('  ⚠️  Zero updates in the last 24 hours — table may not be live-updating')
} else {
  freq.forEach(r => console.log(' ', r.hour, '→', r.updates, 'updates'))
}
console.log()

// 3. Latest rate per state — join to State table to get state names
const { rows: latestByState } = await client.query(`
  SELECT DISTINCT ON (gr.state_id)
    gr.state_id,
    s.name AS state_name,
    gr.rate_22k,
    gr.rate_24k,
    gr.margin_22k,
    gr.margin_24k,
    gr.created_at
  FROM "GoldRate" gr
  LEFT JOIN "State" s ON s.id = gr.state_id
  ORDER BY gr.state_id, gr.created_at DESC
`)
console.log('── Current rate per state (latest snapshot) ──')
latestByState.forEach(r => {
  const ageMin = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000)
  console.log(`  ${r.state_name || r.state_id}: 22k=${r.rate_22k}  24k=${r.rate_24k}  margin22k=${r.margin_22k}  (${ageMin}m ago)`)
})

await client.end()
console.log('\n✅ Done')
