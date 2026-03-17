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
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    const [rows] = await conn.execute(`
      SELECT
        t.id                          AS txn_id,
        t.bill_no                     AS application_id,
        t.date                        AS purchase_date,
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
      AND t.date >= '2026-03-15'
      GROUP BY t.id
    `)

    if (!rows.length) {
      return Response.json({ success: true, message: 'No records found', synced: 0 })
    }

    const [branches] = await conn.execute(`SELECT brnch_id, brnch_name FROM branch_tbl`)
    const branchMap = {}
    branches.forEach(b => { branchMap[b.brnch_id] = b.brnch_name })

    const records = rows.map(r => {
      const grossWeight = sumCSV(r.gross_weight_str)
      const stoneWeight = sumCSV(r.stone_weight_str)
      const wastage     = sumCSV(r.wastage_str)
      const netWeight   = sumCSV(r.net_weight_str)
      const totalAmount = sumCSV(r.total_amount_str)
      const purity      = weightedAvgPurity(r.net_weight_str, r.purity_str)
      const finalAmount = parseFloat(r.final_amount_crm) || 0
      const svcPct      = parseFloat(r.service_charge_pct) || 0
      const svcAmount   = finalAmount * (svcPct / 100)
      const branchName  = branchMap[r.branch_id] || String(r.branch_id)

      return {
        application_id:             String(r.application_id),
        purchase_date:              r.purchase_date ? new Date(r.purchase_date).toISOString().split('T')[0] : null,
        customer_name:              r.customer_name || null,
        phone_number:               r.phone_number  || null,
        branch_name:                branchName,
        transaction_type:           r.transaction_type === 'physical' ? 'PHYSICAL' : 'TAKEOVER',
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

    const BATCH = 100
    let synced = 0, errors = 0, lastError = null

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH)
      const { error } = await supabaseAdmin
  .from('purchases')
  .upsert(batch, { onConflict: 'application_id', ignoreDuplicates: false })
      if (error) {
        console.error('Insert error:', JSON.stringify(error, null, 2))
        console.error('First record sample:', JSON.stringify(batch[0], null, 2))
        lastError = error
        errors += batch.length
      } else {
        synced += batch.length
      }
    }

    return Response.json({
      success: errors === 0,
      total:   records.length,
      synced,
      errors,
      lastError: lastError ? JSON.stringify(lastError) : null,
      message: `Synced ${synced} records from CRM (${errors} errors)`,
    })

  } catch (err) {
    console.error('Sync error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}