import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

function normalizeAppId(raw) {
  const s = String(raw).trim()
  if (s.toUpperCase().startsWith('WGKA')) return s.toUpperCase()
  return `WGKA${s}`
}

function fmtDate(d) {
  if (!d) return null
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return String(d).split('T')[0].split(' ')[0]
}

// GET /api/diag-missing-bills?from=2026-04-01&to=2026-04-25
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') || '2026-04-01'
  const to   = searchParams.get('to')   || '2026-04-25'

  let conn
  try {
    // ── 1. Pull approved CRM transactions in range ────────────────────────────
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    const [rows] = await conn.execute(`
      SELECT t.id AS txn_id, t.bill_no AS application_id, t.date AS purchase_date,
             t.cust_name AS customer_name, t.cust_mobile AS phone_number,
             t.finl_amnt AS final_amount,
             COALESCE(SUM(o.net_wet),0) AS net_weight
      FROM transac_tbl t
      LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
      WHERE t.trxn_status = 'approved' AND t.date BETWEEN ? AND ?
      GROUP BY t.id
    `, [from, to])

    const crmCount = rows.length

    // Normalise to match Supabase format
    const crmBills = rows.map(r => ({
      txn_id:         r.txn_id,
      application_id: normalizeAppId(r.application_id),
      purchase_date:  fmtDate(r.purchase_date),
      customer_name:  r.customer_name?.trim() || null,
      phone_number:   r.phone_number?.trim()  || null,
      final_amount:   parseFloat(r.final_amount) || 0,
      net_weight:     parseFloat(r.net_weight)   || 0,
    }))

    // ── 2. Pull Supabase rows in range ────────────────────────────────────────
    let allSupa = []
    let offset = 0
    const CHUNK = 1000
    while (true) {
      const { data } = await supabaseAdmin
        .from('purchases')
        .select('application_id, purchase_date, customer_name, phone_number, final_amount_crm, net_weight, crm_status, is_deleted, is_duplicate')
        .eq('crm_source', 'old_crm')
        .gte('purchase_date', from)
        .lte('purchase_date', to)
        .range(offset, offset + CHUNK - 1)
      if (!data || data.length === 0) break
      allSupa.push(...data)
      if (data.length < CHUNK) break
      offset += CHUNK
    }

    // ── 3. Find which CRM bills don't appear in Supabase by app_id ────────────
    // (smartDedup may also have suffixed duplicates with -txn_id, check both)
    const supaIds = new Set(allSupa.map(r => r.application_id))

    const missingFromSupa = crmBills.filter(c => {
      if (supaIds.has(c.application_id)) return false
      // Also check suffixed variants
      const suffixed = `${c.application_id}-${c.txn_id}`
      if (supaIds.has(suffixed)) return false
      return true
    })

    // ── 4. Group CRM bills by app_id to find duplicates ───────────────────────
    const byAppId = {}
    for (const c of crmBills) {
      if (!byAppId[c.application_id]) byAppId[c.application_id] = []
      byAppId[c.application_id].push(c)
    }
    const crmDupGroups = Object.entries(byAppId).filter(([, arr]) => arr.length > 1)

    // ── 5. Count Supabase bills filtered by report query (matches what reports show) ──
    const reportVisible = allSupa.filter(r => r.crm_status === 'approved' && r.is_deleted === false)

    // ── 6. Bills excluded by report filter (have row but not visible) ─────────
    const excludedFromReport = allSupa.filter(r => r.crm_status !== 'approved' || r.is_deleted === true)

    return Response.json({
      summary: {
        crm_approved_count:        crmCount,
        supabase_total_in_range:   allSupa.length,
        supabase_visible_in_report: reportVisible.length,
        supabase_excluded_from_report: excludedFromReport.length,
        missing_from_supabase:     missingFromSupa.length,
        crm_app_id_dup_groups:     crmDupGroups.length,
      },
      missing_from_supabase: missingFromSupa.slice(0, 50),
      crm_app_id_dup_groups: crmDupGroups.slice(0, 50).map(([appId, arr]) => ({ application_id: appId, count: arr.length, txn_ids: arr.map(r => r.txn_id) })),
      excluded_from_report: excludedFromReport.slice(0, 50).map(r => ({
        application_id: r.application_id,
        purchase_date:  r.purchase_date,
        customer_name:  r.customer_name,
        crm_status:     r.crm_status,
        is_deleted:     r.is_deleted,
        is_duplicate:   r.is_duplicate,
      })),
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
