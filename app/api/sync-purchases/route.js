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
  if (s.toUpperCase().startsWith('WGKA')) return s.toUpperCase()
  return `WGKA${s}`
}

// ── Format MySQL date safely without timezone shift ───────────────────────────
function fmtDate(d) {
  if (!d) return null
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return String(d).split('T')[0].split(' ')[0]
}

// ── Smart dedup: same bill_no only a true dup if key fields also match ────────
function smartDedup(records) {
  const grouped = new Map()
  records.forEach(r => {
    const key = r.application_id
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(r)
  })
  const result = []
  for (const group of grouped.values()) {
    if (group.length === 1) { result.push(group[0]); continue }
    const kept = []
    for (const r of group) {
      const dupIdx = kept.findIndex(d =>
        d.customer_name === r.customer_name &&
        d.purchase_date === r.purchase_date &&
        Math.abs((d.net_weight||0) - (r.net_weight||0)) < 0.01 &&
        Math.abs((d.final_amount_crm||0) - (r.final_amount_crm||0)) < 1 &&
        d.phone_number === r.phone_number
      )
      if (dupIdx >= 0) {
        kept[dupIdx].is_duplicate = true // true duplicate — mark and skip
      } else {
        if (kept.length > 0) r.application_id = `${r.application_id}-${r._txn_id}`
        kept.push(r)
      }
    }
    result.push(...kept)
  }
  return result
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

    // 7-day buffer to catch bills approved days after creation; fall back to 30 days ago
    const cutoff = latestRow?.purchase_date
      ? new Date(new Date(latestRow.purchase_date).getTime() - 7 * 86400000).toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

    // ── Clean up non-approved old CRM records already in Supabase ────────────
    // purchases table is approved-only; any pending/rejected are stale data
    await supabaseAdmin
      .from('purchases')
      .delete()
      .eq('crm_source', 'old_crm')
      .neq('crm_status', 'approved')

    // ── Pull only approved records from CRM ──────────────────────────────────
    const [rows] = await conn.execute(`
      SELECT
        t.id                          AS txn_id,
        t.bill_no                     AS application_id,
        t.trxn_status                 AS crm_status,
        t.date                        AS purchase_date,
        t.time                        AS transaction_time,
        t.cust_name                   AS customer_name,
        t.cust_mobile                 AS phone_number,
        t.branch_id,
        t.type_gold                   AS transaction_type,
        t.serv_chr                    AS service_charge_pct,
        t.finl_amnt                   AS final_amount_crm,
        GROUP_CONCAT(o.grms_wet   ORDER BY o.id) AS gross_weight_str,
        GROUP_CONCAT(o.stnt_wet   ORDER BY o.id) AS stone_weight_str,
        GROUP_CONCAT(o.wastag_wet ORDER BY o.id) AS wastage_str,
        GROUP_CONCAT(o.net_wet    ORDER BY o.id) AS net_weight_str,
        GROUP_CONCAT(o.purity     ORDER BY o.id) AS purity_str,
        GROUP_CONCAT(o.grs_amnt   ORDER BY o.id) AS total_amount_str
      FROM transac_tbl t
      LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
      WHERE t.trxn_status = 'approved' AND t.date >= ?
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

    // ── Get existing OLD CRM records from Supabase to avoid duplicate inserts ─
    const existingIds = new Set()
    const CHUNK = 500
    for (let i = 0; i < crmAppIds.length; i += CHUNK) {
      const chunk = crmAppIds.slice(i, i + CHUNK)
      const { data } = await supabaseAdmin
        .from('purchases')
        .select('application_id')
        .eq('crm_source', 'old_crm')
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
        _txn_id:                    r.txn_id,
        application_id:             appId,
        crm_status:                 r.crm_status || 'approved',
        purchase_date:              fmtDate(r.purchase_date),
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
        crm_source:                 'old_crm',
      }
    })

    // ── Smart dedup → only insert records not already in Supabase ────────────
    const deduped    = smartDedup(allRecords).map(({ _txn_id, ...r }) => r)
    const newRecords = deduped.filter(r => !existingIds.has(r.application_id))

    // ── Insert new records in batches of 100 ──────────────────────────────────
    const BATCH = 100
    let synced = 0, errors = 0, lastError = null

    for (let i = 0; i < newRecords.length; i += BATCH) {
      const batch = newRecords.slice(i, i + BATCH)
      const { error } = await supabaseAdmin
        .from('purchases')
        .upsert(batch, { onConflict: 'application_id,crm_source', ignoreDuplicates: true })
      if (error) {
        console.error('Upsert error:', JSON.stringify(error, null, 2))
        lastError = error
        errors += batch.length
      } else {
        synced += batch.length
      }
    }

    if (!newRecords.length) {
      return Response.json({
        success:  true,
        total:    rows.length,
        synced:   0,
        newCount: 0,
        message:  'All records already synced — nothing new to add',
      })
    }

    return Response.json({
      success:  errors === 0,
      total:    rows.length,
      newCount: newRecords.length,
      synced,
      statusUpdated,
      errors,
      lastError: lastError ? JSON.stringify(lastError) : null,
      message:  `${newRecords.length} new approved bills — synced ${synced} (${errors} errors)`,
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