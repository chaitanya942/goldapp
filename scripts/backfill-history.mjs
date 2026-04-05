/**
 * Local backfill script — pulls all CRM purchases before 2025-04-01 into Supabase.
 * Run: node scripts/backfill-history.mjs
 */

import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Load .env.local ───────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dir, '../.env.local')
const envVars = readFileSync(envFile, 'utf8')
  .split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .reduce((acc, line) => {
    const eq = line.indexOf('=')
    if (eq === -1) return acc
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    acc[key] = val
    return acc
  }, {})

const env = k => envVars[k] || process.env[k] || ''

const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

function parseCSVFloat(str) {
  if (!str) return []
  return str.split(',').map(v => parseFloat(v.trim()) || 0)
}
function sumCSV(str) { return parseCSVFloat(str).reduce((a, b) => a + b, 0) }
function weightedAvgPurity(netStr, purStr) {
  const nets = parseCSVFloat(netStr), purs = parseCSVFloat(purStr)
  const tot  = nets.reduce((a, b) => a + b, 0)
  if (!tot) return 0
  return nets.reduce((s, n, i) => s + n * (purs[i] || 0), 0) / tot
}
function normalizeAppId(raw) {
  const s = String(raw).trim()
  return s.toUpperCase().startsWith('WGKA') ? s.toUpperCase() : `WGKA${s}`
}

// ── Quarter ranges to backfill (everything before 2025-04-01) ────────────────
const QUARTERS = [
  { from: '2020-01-01', to: '2020-12-31' },
  { from: '2021-01-01', to: '2021-12-31' },
  { from: '2022-01-01', to: '2022-12-31' },
  { from: '2023-01-01', to: '2023-06-30' },
  { from: '2023-07-01', to: '2023-12-31' },
  { from: '2024-01-01', to: '2024-06-30' },
  { from: '2024-07-01', to: '2024-12-31' },
  { from: '2025-01-01', to: '2025-03-31' },
]

async function backfillRange(conn, branchMap, from, to) {
  console.log(`\n📅  Pulling ${from} → ${to} from CRM...`)

  const [rows] = await conn.execute(`
    SELECT
      t.id, t.bill_no AS application_id, t.date AS purchase_date,
      t.time AS transaction_time, t.cust_name AS customer_name,
      t.cust_mobile AS phone_number, t.branch_id,
      t.type_gold AS transaction_type, t.serv_chr AS service_charge_pct,
      t.finl_amnt AS final_amount_crm,
      GROUP_CONCAT(o.grms_wet)   AS gross_weight_str,
      GROUP_CONCAT(o.stnt_wet)   AS stone_weight_str,
      GROUP_CONCAT(o.wastag_wet) AS wastage_str,
      GROUP_CONCAT(o.net_wet)    AS net_weight_str,
      GROUP_CONCAT(o.purity)     AS purity_str,
      GROUP_CONCAT(o.grs_amnt)   AS total_amount_str
    FROM transac_tbl t
    LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
    WHERE t.trxn_status = 'approved' AND t.date >= ? AND t.date <= ?
    GROUP BY t.id
  `, [from, to])

  if (!rows.length) { console.log('   ⚪ No records found — skipping'); return }
  console.log(`   Found ${rows.length} CRM records`)

  // Check which already exist in Supabase
  const crmIds = rows.map(r => normalizeAppId(r.application_id))
  const existingIds = new Set()
  for (let i = 0; i < crmIds.length; i += 500) {
    const chunk = crmIds.slice(i, i + 500)
    const { data } = await supabase.from('purchases').select('application_id').in('application_id', chunk)
    ;(data || []).forEach(r => existingIds.add(r.application_id))
  }

  const newRecords = rows
    .map(r => {
      const netWeight   = sumCSV(r.net_weight_str)
      const finalAmount = parseFloat(r.final_amount_crm) || 0
      const svcPct      = parseFloat(r.service_charge_pct) || 0
      let txnTime = null
      if (r.transaction_time != null) {
        if (typeof r.transaction_time === 'string') txnTime = r.transaction_time.trim()
        else if (typeof r.transaction_time === 'object') {
          const abs = Math.abs(r.transaction_time)
          const h = String(Math.floor(abs / 3600)).padStart(2, '0')
          const m = String(Math.floor((abs % 3600) / 60)).padStart(2, '0')
          const s = String(abs % 60).padStart(2, '0')
          txnTime = `${h}:${m}:${s}`
        }
      }
      return {
        application_id:             normalizeAppId(r.application_id),
        purchase_date:              r.purchase_date ? (r.purchase_date instanceof Date ? `${r.purchase_date.getFullYear()}-${String(r.purchase_date.getMonth()+1).padStart(2,'0')}-${String(r.purchase_date.getDate()).padStart(2,'0')}` : String(r.purchase_date).split('T')[0].split(' ')[0]) : null,
        transaction_time:           txnTime,
        customer_name:              r.customer_name?.trim() || null,
        phone_number:               r.phone_number?.trim()  || null,
        branch_name:                (branchMap[r.branch_id] || String(r.branch_id))?.trim(),
        transaction_type:           r.transaction_type?.trim()?.toLowerCase() === 'physical' ? 'PHYSICAL' : 'TAKEOVER',
        gross_weight:               sumCSV(r.gross_weight_str),
        stone_weight:               sumCSV(r.stone_weight_str),
        wastage:                    sumCSV(r.wastage_str),
        net_weight:                 netWeight,
        net_weight_crm:             netWeight,
        net_weight_calculated:      netWeight,
        purity:                     weightedAvgPurity(r.net_weight_str, r.purity_str),
        total_amount:               sumCSV(r.total_amount_str),
        final_amount_crm:           finalAmount,
        final_amount_calc:          finalAmount,
        service_charge_pct:         svcPct,
        service_charge_amount_crm:  finalAmount * (svcPct / 100),
        service_charge_amount_calc: finalAmount * (svcPct / 100),
        net_weight_mismatch:        false,
        service_charge_mismatch:    false,
        final_amount_mismatch:      false,
        stock_status:               'at_branch',
        is_duplicate:               false,
        is_deleted:                 false,
      }
    })
    .filter(r => !existingIds.has(r.application_id))

  if (!newRecords.length) { console.log(`   ✅ All ${rows.length} already in Supabase`); return }
  console.log(`   Inserting ${newRecords.length} new records...`)

  let synced = 0, errors = 0
  for (let i = 0; i < newRecords.length; i += 100) {
    const batch = newRecords.slice(i, i + 100)
    const { error } = await supabase.from('purchases').upsert(batch, { onConflict: 'application_id', ignoreDuplicates: true })
    if (error) { console.error('   ❌ Batch error:', error.message); errors += batch.length }
    else { synced += batch.length; process.stdout.write('.') }
  }
  console.log(`\n   ✅ Done: ${synced} inserted, ${errors} errors`)
}

async function main() {
  console.log('🔗 Connecting to CRM MySQL...')
  const conn = await mysql.createConnection({
    host:     env('CRM_DB_HOST'),
    port:     parseInt(env('CRM_DB_PORT') || '3306'),
    database: env('CRM_DB_NAME'),
    user:     env('CRM_DB_USER'),
    password: env('CRM_DB_PASSWORD'),
  })
  console.log('✅ Connected')

  const [branches] = await conn.execute(`SELECT brnch_id, brnch_name FROM branch_tbl`)
  const branchMap  = {}
  branches.forEach(b => { branchMap[b.brnch_id] = b.brnch_name?.trim() })

  for (const { from, to } of QUARTERS) {
    await backfillRange(conn, branchMap, from, to)
  }

  await conn.end()
  console.log('\n🎉 Backfill complete!')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
