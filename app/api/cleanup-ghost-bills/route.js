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

function createConn() {
  return mysql.createConnection({
    host:     process.env.CRM_DB_HOST,
    port:     parseInt(process.env.CRM_DB_PORT || '3306'),
    database: process.env.CRM_DB_NAME,
    user:     process.env.CRM_DB_USER,
    password: process.env.CRM_DB_PASSWORD,
  })
}

async function markDeleted(ids) {
  if (!ids.length) return
  await supabaseAdmin
    .from('purchases')
    .update({ crm_status: 'deleted' })
    .in('application_id', ids)
    .eq('crm_source', 'old_crm')
}

export async function GET(request) { return POST(request) }

// Modes:
//   ?days=90&dry_run=true           → fingerprint-based ghost detection over date range
//   ?reconcile_date=YYYY-MM-DD      → full reconcile for one specific date
//   ?reconcile_range=true&days=90   → full reconcile for entire date range (catches all deletes)
export async function POST(request) {
  const url           = new URL(request.url)
  const days          = parseInt(url.searchParams.get('days') || '90')
  const dryRun        = url.searchParams.get('dry_run') === 'true'
  const reconcileDate = url.searchParams.get('reconcile_date') || null
  const reconcileAll  = url.searchParams.get('reconcile_range') === 'true'

  let conn
  try {
    conn = await createConn()

    // ── MODE: reconcile a single date ─────────────────────────────────────────
    if (reconcileDate) {
      const [rows] = await conn.execute(
        `SELECT bill_no FROM transac_tbl WHERE trxn_status = 'approved' AND DATE(date) = ?`,
        [reconcileDate]
      )
      const crmIds = new Set(rows.map(r => normalizeAppId(r.bill_no)))

      const { data: supaRows } = await supabaseAdmin
        .from('purchases')
        .select('application_id')
        .eq('crm_source', 'old_crm')
        .eq('crm_status', 'approved')
        .eq('purchase_date', reconcileDate)

      const missing = (supaRows || []).map(b => b.application_id).filter(id => !crmIds.has(id))

      if (!dryRun) await markDeleted(missing)

      return Response.json({
        success: true, dry_run: dryRun, mode: 'reconcile_date', date: reconcileDate,
        crm_approved: crmIds.size,
        supabase_approved: (supaRows || []).length,
        missing_from_crm: missing.length,
        marked_deleted: dryRun ? 0 : missing.length,
        missing_ids: missing,
        message: dryRun
          ? `DRY RUN: ${missing.length} bills in Supabase not in CRM for ${reconcileDate}`
          : `Set crm_status='deleted' on ${missing.length} bills for ${reconcileDate}`,
      })
    }

    // ── MODE: full range reconcile — catches ALL deletes (not just recreates) ──
    if (reconcileAll) {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

      // Fetch all CRM approved IDs in the window
      const [crmRows] = await conn.execute(
        `SELECT bill_no FROM transac_tbl WHERE trxn_status = 'approved' AND DATE(date) >= ?`,
        [cutoff]
      )
      const crmIds = new Set(crmRows.map(r => normalizeAppId(r.bill_no)))

      // Fetch all Supabase approved bills in the window (paginated)
      const CHUNK = 1000
      let offset = 0, supaRows = []
      while (true) {
        const { data } = await supabaseAdmin
          .from('purchases')
          .select('application_id')
          .eq('crm_source', 'old_crm')
          .eq('crm_status', 'approved')
          .gte('purchase_date', cutoff)
          .range(offset, offset + CHUNK - 1)
        if (!data || data.length === 0) break
        supaRows.push(...data)
        if (data.length < CHUNK) break
        offset += CHUNK
      }

      const missing = supaRows.map(b => b.application_id).filter(id => !crmIds.has(id))

      if (!dryRun) await markDeleted(missing)

      return Response.json({
        success: true, dry_run: dryRun, mode: 'reconcile_range',
        window_days: days, cutoff,
        crm_approved: crmIds.size,
        supabase_approved: supaRows.length,
        missing_from_crm: missing.length,
        marked_deleted: dryRun ? 0 : missing.length,
        missing_ids: missing,
        message: dryRun
          ? `DRY RUN: ${missing.length} Supabase bills not in CRM for last ${days} days`
          : `Set crm_status='deleted' on ${missing.length} bills for last ${days} days`,
      })
    }

    // ── MODE: fingerprint-based ghost detection (delete+recreate only) ─────────
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

    const [rows] = await conn.execute(`
      SELECT
        t.bill_no AS application_id, t.date AS purchase_date,
        t.cust_name AS customer_name, t.branch_id,
        t.finl_amnt AS final_amount_crm,
        GROUP_CONCAT(o.net_wet ORDER BY o.id) AS net_weight_str
      FROM transac_tbl t
      LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
      WHERE t.trxn_status = 'approved' AND t.date >= ?
      GROUP BY t.id
    `, [cutoff])

    const [branches] = await conn.execute(`SELECT brnch_id, brnch_name FROM branch_tbl`)
    const branchMap  = {}
    branches.forEach(b => { branchMap[b.brnch_id] = b.brnch_name?.trim() })

    const crmIds = new Set()
    const crmFingerprints = new Set()
    for (const r of rows) {
      const appId  = normalizeAppId(r.application_id)
      const netWt  = (r.net_weight_str || '').split(',').reduce((s, v) => s + (parseFloat(v) || 0), 0)
      const brName = (branchMap[r.branch_id] || String(r.branch_id))?.trim()
      const date   = String(r.purchase_date).split('T')[0].split(' ')[0]
      crmIds.add(appId)
      crmFingerprints.add(`${brName}|${date}|${(r.customer_name||'').toLowerCase().trim()}|${Math.round(netWt*100)}|${Math.round(r.final_amount_crm||0)}`)
    }

    const CHUNK = 1000
    let offset = 0, supaRows = []
    while (true) {
      const { data } = await supabaseAdmin
        .from('purchases')
        .select('application_id, branch_name, purchase_date, customer_name, net_weight, final_amount_crm')
        .eq('crm_source', 'old_crm')
        .eq('crm_status', 'approved')
        .gte('purchase_date', cutoff)
        .range(offset, offset + CHUNK - 1)
      if (!data || data.length === 0) break
      supaRows.push(...data)
      if (data.length < CHUNK) break
      offset += CHUNK
    }

    const ghosts = [], orphans = []
    for (const b of supaRows) {
      if (crmIds.has(b.application_id)) continue
      const fingerprint = `${b.branch_name}|${b.purchase_date}|${(b.customer_name||'').toLowerCase().trim()}|${Math.round((b.net_weight||0)*100)}|${Math.round(b.final_amount_crm||0)}`
      if (crmFingerprints.has(fingerprint)) ghosts.push(b.application_id)
      else orphans.push(b.application_id)
    }

    if (!dryRun) await markDeleted(ghosts)

    return Response.json({
      success: true, dry_run: dryRun, mode: 'ghost_fingerprint',
      window_days: days, cutoff,
      crm_approved: rows.length,
      supabase_total: supaRows.length,
      ghosts_found: ghosts.length,
      ghosts_marked: dryRun ? 0 : ghosts.length,
      orphans_found: orphans.length,
      ghost_ids: ghosts,
      orphan_ids: orphans.slice(0, 20),
      message: dryRun
        ? `DRY RUN: ${ghosts.length} ghost bills (delete+recreate). ${orphans.length} orphans left untouched.`
        : `Set crm_status='deleted' on ${ghosts.length} ghost bills. ${orphans.length} orphans left untouched.`,
    })

  } catch (err) {
    console.error('Cleanup ghost bills error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
