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

export async function POST(request) {
  let conn
  try {
    // ── Parse date range from request body ────────────────
    const body = await request.json().catch(() => ({}))
    const from = body.from || null
    const to   = body.to   || null

    if (!from || !to) {
      return Response.json({
        success: false,
        error: 'Please provide from and to dates. Example: {"from":"2023-04-01","to":"2024-03-31"}',
      }, { status: 400 })
    }

    // ── Connect to CRM MySQL ──────────────────────────────
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // ── Pull records for the given date range ─────────────
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
      AND t.date >= ? AND t.date <= ?
      GROUP BY t.id
    `, [from, to])

    if (!rows.length) {
      return Response.json({ success: true, message: `No records found between ${from} and ${to}`, total: 0, synced: 0 })
    }

    // ── Branch lookup ─────────────────────────────────────
    const [branches] = await conn.execute(`SELECT brnch_id, brnch_name FROM branch_tbl`)
    const branchMap = {}
    branches.forEach(b => { branchMap[b.brnch_id] = b.brnch_name?.trim() })

    // ── Get existing application_ids from Supabase ────────
    const crmAppIds = rows.map(r => String(r.application_id)?.trim())
    const existingIds = new Set()
    const FETCH_CHUNK = 500
    for (let i = 0; i < crmAppIds.length; i += FETCH_CHUNK) {
      const chunk = crmAppIds.slice(i, i + FETCH_CHUNK)
      const { data } = await supabaseAdmin
        .from('purchases')
        .select('application_id')
        .in('application_id', chunk)
      if (data) data.forEach(r => existingIds.add(r.application_id))
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
        application_id:             `WGKA${String(r.application_id).trim()}`,
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

    // ── Filter to only NEW records ─────────────────────────
    const newRecords = allRecords.filter(r => !existingIds.has(r.application_id))

    if (!newRecords.length) {
      return Response.json({
        success:  true,
        total:    rows.length,
        synced:   0,
        message:  `All ${rows.length} records for ${from} → ${to} already exist in Supabase`,
      })
    }

    // ── Insert in batches of 100 ──────────────────────────
    const BATCH = 100
    let synced = 0, errors = 0, lastError = null

    for (let i = 0; i < newRecords.length; i += BATCH) {
      const batch = newRecords.slice(i, i + BATCH)
      const { error } = await supabaseAdmin
        .from('purchases')
        .insert(batch)
      if (error) {
        console.error('Backfill error:', JSON.stringify(error, null, 2))
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
      message:  `${from} → ${to}: ${synced} records inserted (${errors} errors)`,
    })

  } catch (err) {
    console.error('Backfill error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}