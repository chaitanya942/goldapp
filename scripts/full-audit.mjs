/**
 * Full audit — compare CRM approved records vs Supabase by year and by month.
 * Run: node scripts/full-audit.mjs
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
const conn = await mysql.createConnection({
  host: env('CRM_DB_HOST'), port: parseInt(env('CRM_DB_PORT') || '3306'),
  database: env('CRM_DB_NAME'), user: env('CRM_DB_USER'), password: env('CRM_DB_PASSWORD'),
})

console.log('\n📊 FULL AUDIT — CRM (approved) vs GoldApp\n')
console.log('─'.repeat(60))

// ── 1. Year-by-year comparison ───────────────────────────────
const years = ['2021','2022','2023','2024','2025']
let totalCRM = 0, totalSB = 0, totalMissing = 0

for (const yr of years) {
  const from = `${yr}-01-01`, to = `${yr}-12-31`

  const [crmRows] = await conn.execute(
    `SELECT COUNT(DISTINCT id) as cnt FROM transac_tbl WHERE trxn_status='approved' AND date >= ? AND date <= ?`,
    [from, to]
  )
  const crmCount = Number(crmRows[0].cnt)

  const { count: sbCount } = await supabase
    .from('purchases')
    .select('*', { count: 'exact', head: true })
    .gte('purchase_date', from).lte('purchase_date', to)

  const diff = crmCount - (sbCount || 0)
  const status = diff === 0 ? '✅' : diff > 0 ? '❌' : '⚠️ '
  console.log(`${status}  ${yr}  CRM: ${String(crmCount).padStart(6)}  GoldApp: ${String(sbCount||0).padStart(6)}  Diff: ${diff > 0 ? '+' : ''}${diff}`)
  totalCRM += crmCount; totalSB += (sbCount || 0); totalMissing += Math.max(0, diff)
}

console.log('─'.repeat(60))
console.log(`     TOTAL  CRM: ${String(totalCRM).padStart(6)}  GoldApp: ${String(totalSB).padStart(6)}  Missing: ${totalMissing}`)

// ── 2. Month-by-month for 2025 (most recent, most important) ─
console.log('\n📅  2025 month-by-month breakdown:\n')
for (let m = 1; m <= 3; m++) {
  const mm = String(m).padStart(2,'0')
  const lastDay = new Date(2025, m, 0).getDate()
  const from = `2025-${mm}-01`, to = `2025-${mm}-${lastDay}`

  const [crmRows] = await conn.execute(
    `SELECT COUNT(DISTINCT id) as cnt FROM transac_tbl WHERE trxn_status='approved' AND date >= ? AND date <= ?`,
    [from, to]
  )
  const crmCount = Number(crmRows[0].cnt)
  const { count: sbCount } = await supabase
    .from('purchases').select('*', { count: 'exact', head: true })
    .gte('purchase_date', from).lte('purchase_date', to)

  const diff = crmCount - (sbCount || 0)
  const status = diff === 0 ? '✅' : '❌'
  const monthName = new Date(2025, m-1).toLocaleString('en-IN',{month:'long'})
  console.log(`  ${status}  ${monthName.padEnd(10)}  CRM: ${String(crmCount).padStart(5)}  GoldApp: ${String(sbCount||0).padStart(5)}  Diff: ${diff > 0 ? '+' : ''}${diff}`)
}

// ── 3. Spot-check Jan 22 2025 (the known discrepancy date) ───
console.log('\n🔍  Spot-check 2025-01-22:\n')
const [sc] = await conn.execute(
  `SELECT COUNT(DISTINCT id) as cnt FROM transac_tbl WHERE trxn_status='approved' AND date='2025-01-22'`
)
const { count: scSB } = await supabase.from('purchases').select('*',{count:'exact',head:true}).eq('purchase_date','2025-01-22')
const scDiff = Number(sc[0].cnt) - (scSB || 0)
console.log(`  ${scDiff === 0 ? '✅' : '❌'}  2025-01-22  CRM: ${sc[0].cnt}  GoldApp: ${scSB}  Diff: ${scDiff > 0 ? '+' : ''}${scDiff}`)

if (totalMissing === 0) {
  console.log('\n🎉  All CRM approved records are present in GoldApp!\n')
} else {
  console.log(`\n⚠️   ${totalMissing} records still missing. Run backfill again.\n`)
}

await conn.end()
