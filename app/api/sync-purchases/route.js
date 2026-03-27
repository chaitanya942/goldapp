import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function parseCSVFloat(str) {
  if (!str) return []
  return str.split(',').map(v => parseFloat(v.trim()) || 0)
}

function sumCSV(str) {
  return parseCSVFloat(str).reduce((a, b) => a + b, 0)
}

function weightedAvgPurity(netWetStr, purityStr) {
  const nets     = parseCSVFloat(netWetStr)
  const purities = parseCSVFloat(purityStr)
  const totalNet = nets.reduce((a, b) => a + b, 0)
  if (totalNet === 0) return 0
  const weighted = nets.reduce((sum, n, i) => sum + n * (purities[i] || 0), 0)
  return weighted / totalNet
}

// ── Normalize application_id — strip any existing WGKA prefix first ──────────
function normalizeAppId(raw) {
  const s = String(raw).trim()
  // If already starts with WGKA, return as-is
  if (s.toUpperCase().startsWith('WGKA')) return s.toUpperCase()
  return `WGKA${s}`
}

export async function POST(request) {
  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // ── Find latest synced date in Supabase ───────────────
    const { data: latestRow } = await supabaseAdmin
      .from('purchases')
      .select('purchase_date')
      .order('purchase_date', { ascending: false })
      .limit(1)
      .single()

    // Use latest synced date minus 2 days as buffer (to catch late CRM approvals)
    // Fall back to 30 days ago if Supabase is empty
    const cutoff = latestRow?.purchase_date
      ? new Date(new Date(latestRow.purchase_date).getTime() - 2 * 86400000).toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

    // ── Pull approved records from CRM ────────────────────
    const [rows] = await conn.execute(`
      SELECT
        t.id                          AS txn_id,
        t.bill_no                     AS application_id,
        t.date                        AS purchase_date,
        t.time                        AS transaction_time,
        t.cust_name                   AS customer_name,
        t.cust_mobile                 AS phone_number,
        t.branch_id,
        t.type_gold                   AS transaction_type,
        t.serv_chr                    AS service_charge_pct,
        t.finl_amnt                   AS final_amount_crm,
        GROUP_CONCAT(o.grms_wet)      AS gross_weight_str,
        GROUP_CONCAT(o.stnt_wet)      AS stone_weight_str,
        GROUP_CONCAT(o.wastag_wet)    AS wastage_str,
        GROUP_CONCAT(o.net_wet)       AS net_weight_str,
        GROUP_CONCAT(o.purity)        AS purity_str,
        GROUP_CONCAT(o.grs_amnt)      AS total_amount_str
      FROM transac_tbl t
      LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
      WHERE t.trxn_status = 'approved'
      AND t.date >= ?
      GROUP BY t.id
    `, [cutoff])

    if (!rows.length) {
      return Response.json({ success: true, message: 'No records in CRM', synced: 0, newCount: 0 })
    }

    // ── Branch lookup ──────────────────────────────────────
    const [branches] = await conn.execute(`SELECT brnch_id, brnch_name FROM branch_tbl`)
    const branchMap  = {}
    branches.forEach(b => { branchMap[b.brnch_id] = b.brnch_name?.trim() })

    // ── Build normalized application_ids from CRM ─────────
    const crmAppIds = rows.map(r => normalizeAppId(r.application_id))

    // ── Get ALL existing application_ids from Supabase in one query ──
    // Use chunks of 500 to avoid URL length limits
    const existingIds = new Set()
    const CHUNK = 500
    for (let i = 0; i < crmAppIds.length; i += CHUNK) {
      const chunk = crmAppIds.slice(i, i + CHUNK)
      const { data } = await supabaseAdmin
        .from('purchases')
        .select('application_id')
        .in('application_id', chunk)
      ;(data || []).forEach(r => existingIds.add(r.application_id))
    }

    // ── Map CRM rows → Supabase records ───────────────────
    const allRecords = rows.map(r => {
      const grossWeight = sumCSV(r.gross_weight_str)
      const stoneWeight = sumCSV(r.stone_weight_str)
      const wastage     = sumCSV(r.wastage_str)
      const netWeight   = sumCSV(r.net_weight_str)
      const totalAmount = sumCSV(r.total_amount_str)
      const purity      = weightedAvgPurity(r.net_weight_str, r.purity_str)
      const finalAmount = parseFloat(r.final_amount_crm) || 0
      const svcPct      = parseFloat(r.service_charge_pct) || 0
      const svcAmount   = finalAmount * (svcPct / 100)
      const branchName  = (branchMap[r.branch_id] || String(r.branch_id))?.trim()
      const txnType     = r.transaction_type?.trim()?.toLowerCase()
      const appId       = normalizeAppId(r.application_id)

      let txnTime = null
      if (r.transaction_time !== null && r.transaction_time !== undefined) {
        if (typeof r.transaction_time === 'string') {
          txnTime = r.transaction_time.trim()
        } else if (typeof r.transaction_time === 'object') {
          const h = String(Math.floor(Math.abs(r.transaction_time) / 3600)).padStart(2, '0')
          const m = String(Math.floor((Math.abs(r.transaction_time) % 3600) / 60)).padStart(2, '0')
          const s = String(Math.abs(r.transaction_time) % 60).padStart(2, '0')
          txnTime = `${h}:${m}:${s}`
        }
      }

      return {
        application_id:             appId,
        purchase_date:              r.purchase_date ? new Date(r.purchase_date).toISOString().split('T')[0] : null,
        transaction_time:           txnTime,
        customer_name:              r.customer_name?.trim() || null,
        phone_number:               r.phone_number?.trim()  || null,
        branch_name:                branchName,
        transaction_type:           txnType === 'physical' ? 'PHYSICAL' : 'TAKEOVER',
        gross_weight:               grossWeight,
        stone_weight:               stoneWeight,
        wastage:                    wastage,
        net_weight:                 netWeight,
        net_weight_crm:             netWeight,
        net_weight_calculated:      netWeight,
        purity:                     purity,
        total_amount:               totalAmount,
        final_amount_crm:           finalAmount,
        final_amount_calc:          finalAmount,
        service_charge_pct:         svcPct,
        service_charge_amount_crm:  svcAmount,
        service_charge_amount_calc: svcAmount,
        net_weight_mismatch:        false,
        service_charge_mismatch:    false,
        final_amount_mismatch:      false,
        stock_status:               'at_branch',
        is_duplicate:               false,
        is_deleted:                 false,
      }
    })

    // ── Filter to only NEW records not already in Supabase ─
    const newRecords = allRecords.filter(r => !existingIds.has(r.application_id))

    if (!newRecords.length) {
      return Response.json({
        success:  true,
        total:    rows.length,
        synced:   0,
        newCount: 0,
        message:  'All records already synced — nothing new to add',
      })
    }

    // ── Insert new records in batches of 100 ──────────────
    // Use upsert with onConflict to prevent duplicates even on concurrent syncs
    const BATCH = 100
    let synced = 0, errors = 0, lastError = null

    for (let i = 0; i < newRecords.length; i += BATCH) {
      const batch = newRecords.slice(i, i + BATCH)
      const { error } = await supabaseAdmin
        .from('purchases')
        .upsert(batch, { onConflict: 'application_id', ignoreDuplicates: true })
      if (error) {
        console.error('Upsert error:', JSON.stringify(error, null, 2))
        lastError = error
        errors += batch.length
      } else {
        synced += batch.length
      }
    }

    return Response.json({
      success:  errors === 0,
      total:    rows.length,
      newCount: newRecords.length,
      synced,
      errors,
      lastError: lastError ? JSON.stringify(lastError) : null,
      message:  `${newRecords.length} new records found — synced ${synced} (${errors} errors)`,
    })

  } catch (err) {
    console.error('Sync error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}

// ── GET handler for Vercel cron (midnight auto-sync) ─────────────────────────
export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}