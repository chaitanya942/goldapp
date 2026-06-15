/**
 * Local sync script — pulls new CRM (Postgres) purchases into Supabase.
 * Scheduled via Windows Task Scheduler to run every 5 minutes.
 * Run manually: node scripts/sync-new-crm.mjs
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { aliasBranchName } from '../lib/crmBranchAlias.js'

const { Client } = pg

// ── Load .env.local ───────────────────────────────────────────────────────────
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

const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

function mapStatus(status) {
  if (!status) return 'pending'
  const s = status.toUpperCase()
  if (s === 'FINAL_PAYMENT_COMPLETED') return 'approved'
  if (s === 'WALKOUT') return 'rejected'
  return 'pending'  // everything else: ESTIMATION_PENDING, KYC_PENDING, FINAL_PAYMENT_PENDING, etc.
}

function mapTxnType(type) {
  if (!type) return 'PHYSICAL'
  return type.toUpperCase().includes('RELEASED') ? 'TAKEOVER' : 'PHYSICAL'
}

function fmtDate(ts) {
  if (!ts) return null
  const ist = new Date(new Date(ts).getTime() + 5.5 * 60 * 60 * 1000)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`
}

function fmtTime(ts) {
  if (!ts) return null
  const ist = new Date(new Date(ts).getTime() + 5.5 * 60 * 60 * 1000)
  return `${String(ist.getUTCHours()).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')}:${String(ist.getUTCSeconds()).padStart(2,'0')}`
}

async function main() {
  console.log(`\n[${new Date().toLocaleTimeString('en-IN')}] 🔄 Starting New CRM sync...`)

  const client = new Client({
    host:     env('NEW_CRM_DB_HOST'),
    port:     parseInt(env('NEW_CRM_DB_PORT') || '5432'),
    database: env('NEW_CRM_DB_NAME'),
    user:     env('NEW_CRM_DB_USER'),
    password: env('NEW_CRM_DB_PASSWORD'),
    ssl:      { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  })

  await client.connect()
  console.log('✅ Connected to New CRM')

  // ── Find cutoff from Supabase ─────────────────────────────────────────────
  const { data: latestRow } = await supabase
    .from('purchases')
    .select('purchase_date')
    .eq('crm_source', 'new_crm')
    .order('purchase_date', { ascending: false })
    .limit(1)
    .single()

  const GO_LIVE = '2026-06-15'
  const cutoffDate = latestRow?.purchase_date
    ? new Date(Math.max(
        new Date(latestRow.purchase_date).getTime() - 2 * 86400000,
        new Date(GO_LIVE).getTime()
      )).toISOString().split('T')[0]
    : GO_LIVE

  console.log(`📅 Syncing from ${cutoffDate}...`)

  // ── Pull from new CRM ─────────────────────────────────────────────────────
  const { rows } = await client.query(`
    SELECT
      t.id, t.code, t.status, t.transaction_type, t.created_at,
      c.first_name, c.last_name, c.mobile,
      b.name AS branch_name,
      q.service_charge, q.service_charge_amount, q.final_amount,
      COALESCE(SUM(o.gross_weight), 0) AS gross_weight,
      COALESCE(SUM(o.stone_weight), 0) AS stone_weight,
      COALESCE(SUM(o.wastage), 0)      AS wastage,
      COALESCE(SUM(o.net_weight), 0)   AS net_weight,
      CASE WHEN COALESCE(SUM(o.net_weight), 0) > 0
        THEN SUM(o.net_weight * o.purity) / SUM(o.net_weight)
        ELSE 0
      END AS purity,
      COALESCE(SUM(o.amount), 0) AS total_amount
    FROM "Transaction" t
    LEFT JOIN "Customer"  c ON c.id = t.customer_id
    LEFT JOIN "Branch"    b ON b.id = t.branch_id
    LEFT JOIN "Quotation" q ON q.transaction_id = t.id
    LEFT JOIN "Ornament"  o ON o.quotation_id = q.id
    WHERE t.created_at >= $1
      AND t.status != 'WALKIN'
    GROUP BY t.id, t.code, t.status, t.transaction_type, t.created_at,
             c.first_name, c.last_name, c.mobile, b.name,
             q.service_charge, q.service_charge_amount, q.final_amount
    ORDER BY t.created_at DESC
  `, [cutoffDate])

  await client.end()

  if (!rows.length) {
    console.log('⚪ No new records found')
    return
  }
  console.log(`   Found ${rows.length} records from new CRM`)

  // ── Build records ─────────────────────────────────────────────────────────
  const allRecords = rows.map(r => {
    const rawCode  = String(r.code || '').trim().replace(/-/g, '')
    const appId    = rawCode.toUpperCase().startsWith('WGKA') ? rawCode.toUpperCase() : `WGKA${rawCode}`
    const finalAmount = parseFloat(r.final_amount)  || 0
    const svcPct      = parseFloat(r.service_charge) || 0
    const netWeight   = parseFloat(r.net_weight)    || 0
    return {
      application_id:             appId,
      crm_source:                 'new_crm',
      crm_status:                 mapStatus(r.status),
      purchase_date:              fmtDate(r.created_at),
      transaction_time:           fmtTime(r.created_at),
      customer_name:              [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null,
      phone_number:               r.mobile?.trim() || null,
      branch_name:                aliasBranchName(r.branch_name?.trim()) || null,
      transaction_type:           mapTxnType(r.transaction_type),
      gross_weight:               parseFloat(r.gross_weight) || 0,
      stone_weight:               parseFloat(r.stone_weight) || 0,
      wastage:                    parseFloat(r.wastage)      || 0,
      net_weight:                 netWeight,
      net_weight_crm:             netWeight,
      net_weight_calculated:      netWeight,
      purity:                     parseFloat(r.purity)       || 0,
      total_amount:               parseFloat(r.total_amount) || 0,
      final_amount_crm:           finalAmount,
      final_amount_calc:          finalAmount,
      service_charge_pct:         svcPct,
      service_charge_amount_crm:  parseFloat(r.service_charge_amount) || 0,
      service_charge_amount_calc: parseFloat(r.service_charge_amount) || 0,
      net_weight_mismatch:        false,
      service_charge_mismatch:    false,
      final_amount_mismatch:      false,
      stock_status:               'at_branch',
      is_duplicate:               false,
      is_deleted:                 false,
    }
  })

  // ── Check existing in Supabase ────────────────────────────────────────────
  const appIds = allRecords.map(r => r.application_id)
  const existingIds    = new Set()
  const existingStatus = new Map()
  const CHUNK = 500
  for (let i = 0; i < appIds.length; i += CHUNK) {
    const chunk = appIds.slice(i, i + CHUNK)
    const { data } = await supabase.from('purchases').select('application_id, crm_status').eq('crm_source', 'new_crm').in('application_id', chunk)
    ;(data || []).forEach(r => { existingIds.add(r.application_id); existingStatus.set(r.application_id, r.crm_status) })
  }

  const newRecords    = allRecords.filter(r => !existingIds.has(r.application_id))
  // All existing records from new CRM need crm_source + crm_status updated
  const existingToUpdate = allRecords.filter(r => existingIds.has(r.application_id))

  // ── Update crm_source + crm_status for existing records ──────────────────
  let statusUpdated = 0
  for (let i = 0; i < existingToUpdate.length; i += 20) {
    const chunk = existingToUpdate.slice(i, i + 20)
    const results = await Promise.all(
      chunk.map(r => supabase.from('purchases')
        .update({ crm_status: r.crm_status, crm_source: 'new_crm' })
        .eq('application_id', r.application_id)
        .eq('crm_source', 'new_crm'))   // scope to the new_crm row — the same WGKA number may also exist as old_crm
    )
    results.forEach(({ error }, idx) => {
      if (error) console.error(`  ❌ Update failed: ${chunk[idx].application_id}`)
      else statusUpdated++
    })
  }

  // ── Insert new records ────────────────────────────────────────────────────
  let synced = 0, errors = 0
  for (let i = 0; i < newRecords.length; i += 100) {
    const batch = newRecords.slice(i, i + 100)
    const { error } = await supabase.from('purchases').upsert(batch, { onConflict: 'application_id,crm_source', ignoreDuplicates: true })
    if (error) { console.error('  ❌ Batch error:', error.message); errors += batch.length }
    else { synced += batch.length; process.stdout.write('.') }
  }

  console.log(`\n✅ Done: ${synced} inserted, ${statusUpdated} status updates, ${errors} errors`)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
