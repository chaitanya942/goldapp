import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { NEW_CRM_LIVE_DATE } from '../../../lib/crmConfig'

const { Client } = pg

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Map new CRM Transaction.status → simple crm_status ───────────────────────
function mapStatus(status) {
  if (!status) return 'pending'
  const s = status.toUpperCase()
  if (s === 'FINAL_PAYMENT_COMPLETED') return 'approved'
  if (s === 'WALKOUT') return 'rejected'
  return 'pending'  // everything else: ESTIMATION_PENDING, KYC_PENDING, FINAL_PAYMENT_PENDING, etc.
}

// ── Map new CRM transaction_type → GoldApp type ──────────────────────────────
function mapTxnType(type) {
  if (!type) return 'PHYSICAL'
  return type.toUpperCase().includes('RELEASED') ? 'TAKEOVER' : 'PHYSICAL'
}

// ── Format Postgres timestamp → YYYY-MM-DD (IST) ─────────────────────────────
function fmtDate(ts) {
  if (!ts) return null
  const d = new Date(ts)
  // Add 5:30 for IST
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`
}

function fmtTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return `${String(ist.getUTCHours()).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')}:${String(ist.getUTCSeconds()).padStart(2,'0')}`
}

export async function POST(request) {
  // ── New CRM not live yet — wipe any test data and skip sync ────────────────
  if (!NEW_CRM_LIVE_DATE) {
    await supabaseAdmin.from('purchases').delete().eq('crm_source', 'new_crm')
    return Response.json({ success: true, message: 'New CRM not live yet — test data cleared', synced: 0 })
  }

  let client
  try {
    client = new Client({
      host:     process.env.NEW_CRM_DB_HOST,
      port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
      database: process.env.NEW_CRM_DB_NAME,
      user:     process.env.NEW_CRM_DB_USER,
      password: process.env.NEW_CRM_DB_PASSWORD,
      ssl:      { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    await client.connect()

    // ── Find cutoff: latest new_crm record in Supabase ─────────────────────
    const { data: latestRow } = await supabaseAdmin
      .from('purchases')
      .select('purchase_date')
      .eq('crm_source', 'new_crm')
      .order('purchase_date', { ascending: false })
      .limit(1)
      .single()

    // 7-day buffer; never go before the official go-live date
    const cutoffDate = latestRow?.purchase_date
      ? new Date(Math.max(
          new Date(latestRow.purchase_date).getTime() - 7 * 86400000,
          new Date(NEW_CRM_LIVE_DATE).getTime()
        )).toISOString().split('T')[0]
      : NEW_CRM_LIVE_DATE

    // ── Pull only completed (FINAL_PAYMENT_COMPLETED) transactions ────────────
    const { rows } = await client.query(`
      SELECT
        t.id,
        t.code,
        t.status,
        t.transaction_type,
        t.created_at,
        t.branch_id,
        t.customer_id,
        c.first_name,
        c.last_name,
        c.mobile,
        b.name AS branch_name,
        q.service_charge,
        q.service_charge_amount,
        q.final_amount,
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
      LEFT JOIN "Customer" c ON c.id = t.customer_id
      LEFT JOIN "Branch"   b ON b.id = t.branch_id
      LEFT JOIN "Quotation" q ON q.transaction_id = t.id
      LEFT JOIN "Ornament"  o ON o.quotation_id = q.id
      WHERE t.created_at >= $1
        AND t.status = 'FINAL_PAYMENT_COMPLETED'
      GROUP BY t.id, t.code, t.status, t.transaction_type, t.created_at, t.branch_id,
               t.customer_id, c.first_name, c.last_name, c.mobile, b.name,
               q.service_charge, q.service_charge_amount, q.final_amount
      ORDER BY t.created_at DESC
    `, [cutoffDate])

    if (!rows.length) {
      return Response.json({ success: true, message: 'No new CRM records found', synced: 0, newCount: 0 })
    }

    // ── Build normalized records ───────────────────────────────────────────
    const allRecords = rows.map(r => {
      const netWeight   = parseFloat(r.net_weight)   || 0
      const finalAmount = parseFloat(r.final_amount)  || 0
      const svcPct      = parseFloat(r.service_charge) || 0
      const svcAmount   = parseFloat(r.service_charge_amount) || 0
      const customerName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null

      // Normalize code: strip any spaces, ensure WGKA prefix (new CRM uses WGKA-XXXXX)
      const rawCode  = String(r.code || '').trim().replace(/-/g, '')
      const appId    = rawCode.toUpperCase().startsWith('WGKA') ? rawCode.toUpperCase() : `WGKA${rawCode}`

      return {
        application_id:             appId,
        crm_source:                 'new_crm',
        crm_status:                 mapStatus(r.status),
        purchase_date:              fmtDate(r.created_at),
        transaction_time:           fmtTime(r.created_at),
        customer_name:              customerName,
        phone_number:               r.mobile?.trim() || null,
        branch_name:                r.branch_name?.trim() || null,
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
        service_charge_amount_crm:  svcAmount,
        service_charge_amount_calc: svcAmount,
        net_weight_mismatch:        false,
        service_charge_mismatch:    false,
        final_amount_mismatch:      false,
        // stock_status intentionally omitted — DB default 'at_branch' applies on INSERT,
        // existing rows keep their current status (in_consignment, at_ho, etc.)
        is_duplicate:               false,
        is_deleted:                 false,
      }
    })

    // ── Full refresh: delete Supabase records in sync window, re-insert completed
    const dates   = allRecords.map(r => r.purchase_date).filter(Boolean)
    const minDate = dates.reduce((a, b) => a < b ? a : b)
    const maxDate = dates.reduce((a, b) => a > b ? a : b)
    await supabaseAdmin
      .from('purchases')
      .delete()
      .eq('crm_source', 'new_crm')
      .gte('purchase_date', minDate)
      .lte('purchase_date', maxDate)

    // ── Upsert all completed records for the window ──────────────────────────
    const BATCH = 100
    let synced = 0, errors = 0, lastError = null
    for (let i = 0; i < allRecords.length; i += BATCH) {
      const batch = allRecords.slice(i, i + BATCH)
      const { error } = await supabaseAdmin
        .from('purchases')
        .upsert(batch, { onConflict: 'application_id,crm_source', ignoreDuplicates: false })
      if (error) {
        console.error('New CRM upsert error:', error.message)
        lastError = error
        errors += batch.length
      } else {
        synced += batch.length
      }
    }

    return Response.json({
      success:   errors === 0,
      total:     rows.length,
      synced,
      errors,
      lastError: lastError ? lastError.message : null,
      message:   `New CRM full refresh ${minDate}→${maxDate}: ${allRecords.length} completed bills (${errors} errors)`,
    })

  } catch (err) {
    console.error('New CRM sync error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (client) await client.end()
  }
}

export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(req)
}
