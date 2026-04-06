/**
 * Audit a specific date — compare CRM vs Supabase counts and show what's missing.
 * Run: node scripts/audit-date.mjs 2025-01-22
 */

import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envVars = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
  .split('\n').filter(l => l.trim() && !l.startsWith('#'))
  .reduce((acc, line) => {
    const eq = line.indexOf('=')
    if (eq === -1) return acc
    acc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    return acc
  }, {})
const env = k => envVars[k] || process.env[k] || ''

const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
const date = process.argv[2] || '2025-01-22'

const conn = await mysql.createConnection({
  host: env('CRM_DB_HOST'), port: parseInt(env('CRM_DB_PORT') || '3306'),
  database: env('CRM_DB_NAME'), user: env('CRM_DB_USER'), password: env('CRM_DB_PASSWORD'),
})

console.log(`\n🔍 Auditing CRM vs GoldApp for ${date}\n`)

// 1. All status breakdown on this date
const [statusRows] = await conn.execute(
  `SELECT trxn_status, COUNT(*) as cnt FROM transac_tbl WHERE date = ? GROUP BY trxn_status ORDER BY cnt DESC`,
  [date]
)
console.log('CRM status breakdown:')
let totalCRM = 0
statusRows.forEach(r => { console.log(`  ${r.trxn_status}: ${r.cnt}`); totalCRM += Number(r.cnt) })
console.log(`  TOTAL: ${totalCRM}`)

// 2. Approved count in CRM
const [approvedRows] = await conn.execute(
  `SELECT COUNT(*) as cnt FROM transac_tbl WHERE date = ? AND trxn_status = 'approved'`, [date]
)
console.log(`\nCRM approved: ${approvedRows[0].cnt}`)

// 3. GoldApp count for this date
const { count } = await supabase.from('purchases').select('*', { count: 'exact', head: true }).eq('purchase_date', date)
console.log(`GoldApp count: ${count}`)

// 4. Find approved CRM records missing from GoldApp
const [crmApproved] = await conn.execute(
  `SELECT bill_no FROM transac_tbl WHERE date = ? AND trxn_status = 'approved'`, [date]
)
const crmIds = crmApproved.map(r => {
  const s = String(r.bill_no).trim()
  return s.toUpperCase().startsWith('WGKA') ? s.toUpperCase() : `WGKA${s}`
})

const { data: sbRows } = await supabase.from('purchases').select('application_id').eq('purchase_date', date)
const sbIds = new Set((sbRows || []).map(r => r.application_id))

const missing = crmIds.filter(id => !sbIds.has(id))
if (missing.length) {
  console.log(`\n❌ ${missing.length} approved CRM records NOT in GoldApp:`)
  missing.forEach(id => console.log(`  ${id}`))
} else {
  console.log('\n✅ All approved CRM records are in GoldApp')
  console.log('→ The difference is non-approved records (pending/rejected/etc.)')
}

await conn.end()
