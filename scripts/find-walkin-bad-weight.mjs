// Probe: find today's customer_walkin rows where gms_weight is suspicious,
// and resolve the entering employee + their assigned branch.
import mysql from 'mysql2/promise'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dir, '../.env.local')
const envVars = readFileSync(envFile, 'utf8')
  .split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .reduce((acc, line) => {
    const eq = line.indexOf('=')
    if (eq === -1) return acc
    acc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    return acc
  }, {})
const env = k => envVars[k] || process.env[k] || ''

const conn = await mysql.createConnection({
  host:     env('CRM_DB_HOST'),
  port:     parseInt(env('CRM_DB_PORT') || '3306'),
  database: env('CRM_DB_NAME'),
  user:     env('CRM_DB_USER'),
  password: env('CRM_DB_PASSWORD'),
})

console.log('✅ Connected\n')

// What employee tables exist? Look for anything that might map empid → branch/name
const [tables] = await conn.execute(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND (table_name LIKE '%emp%' OR table_name LIKE '%user%' OR table_name LIKE '%staff%')
`)
console.log('── Candidate employee tables ──')
tables.forEach(t => console.log(`   ${t.TABLE_NAME || t.table_name}`))
console.log()

const istNow  = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const todayIST = istNow.toISOString().split('T')[0]

const [bad] = await conn.execute(`
  SELECT
    cw.id, cw.date, cw.time,
    cw.cust_name, cw.cust_mobile, cw.alt_cust_mobi,
    cw.branch_id, b.brnch_name AS branch_name,
    cw.brn_empid,
    cw.gms_weight, cw.item_type, cw.walkin_status,
    cw.walk_reason, cw.source, cw.cust_rmrks
  FROM customer_walkin cw
  LEFT JOIN branch_tbl b ON b.brnch_id = cw.branch_id
  WHERE DATE(cw.date + INTERVAL 330 MINUTE) = ?
    AND NOT (
      (cw.gms_weight + 0) < 10000
      OR (cw.gms_weight + 0) != FLOOR(cw.gms_weight + 0)
    )
  ORDER BY (cw.gms_weight + 0) DESC
`, [todayIST])

console.log(`── Suspicious walk-ins IST ${todayIST} (${bad.length} rows) ──\n`)
for (const r of bad) {
  console.log(`  Row ID:        ${r.id}`)
  console.log(`  Time:          ${r.time}`)
  console.log(`  Customer:      ${r.cust_name}  /  mobile ${r.cust_mobile}  /  alt ${r.alt_cust_mobi || '—'}`)
  console.log(`  Branch:        "${r.branch_name || '∅'}"  (branch_id="${r.branch_id || '∅'}")`)
  console.log(`  brn_empid:     "${r.brn_empid || '∅'}"`)
  console.log(`  gms_weight:    ${r.gms_weight}  ← bad value`)
  console.log(`  Item type:     ${r.item_type}`)
  console.log(`  Source:        ${r.source}`)
  console.log(`  Remarks:       ${r.cust_rmrks}`)
  console.log()
}

// If we got an empid, try to resolve it against each candidate employee table
for (const r of bad) {
  if (!r.brn_empid) { console.log(`  (Row ${r.id}: no brn_empid set — likely a form-side bug)\n`); continue }
  console.log(`── Looking up brn_empid="${r.brn_empid}" across candidate tables ──`)
  for (const t of tables) {
    const tn = t.TABLE_NAME || t.table_name
    try {
      const [cols] = await conn.execute(`SHOW COLUMNS FROM \`${tn}\``)
      const colNames = cols.map(c => c.Field)
      // Heuristic: any column with 'id' or 'emp' in the name might be the join key.
      const idCols = colNames.filter(c => /id|emp|code/i.test(c))
      for (const idCol of idCols) {
        try {
          const [rows] = await conn.execute(
            `SELECT * FROM \`${tn}\` WHERE \`${idCol}\` = ? LIMIT 1`,
            [r.brn_empid]
          )
          if (rows.length) {
            console.log(`   ✅ Match in ${tn} by ${idCol}:`)
            console.log('     ', JSON.stringify(rows[0], null, 2).split('\n').slice(0, 30).join('\n     '))
            break
          }
        } catch {}
      }
    } catch {}
  }
  console.log()
}

await conn.end()
