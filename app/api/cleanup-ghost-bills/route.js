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
function fp(b) {
  return `${b.branch_name}|${fmtDate(b.purchase_date)||b.purchase_date}|${(b.customer_name||'').toLowerCase().trim()}|${Math.round((b.net_weight||0)*100)}|${Math.round(b.final_amount_crm||0)}`
}

export async function GET(request) { return POST(request) }

// POST: run the cleanup (accepts ?days=90&dry_run=true)
export async function POST(request) {
  const url     = new URL(request.url)
  const days    = parseInt(url.searchParams.get('days') || '90')
  const dryRun  = url.searchParams.get('dry_run') === 'true'
  const cutoff  = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // ── Fetch all approved bill IDs + fingerprint fields from CRM ─────────────
    const [rows] = await conn.execute(`
      SELECT
        t.bill_no AS application_id,
        t.date    AS purchase_date,
        t.cust_name AS customer_name,
        t.branch_id,
        t.finl_amnt AS final_amount_crm,
        GROUP_CONCAT(o.net_wet ORDER BY o.id) AS net_weight_str
      FROM transac_tbl t
      LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
      WHERE t.trxn_status = 'approved' AND t.date >= ?
      GROUP BY t.id
    `, [cutoff])

    // ── Branch name lookup ─────────────────────────────────────────────────────
    const [branches] = await conn.execute(`SELECT brnch_id, brnch_name FROM branch_tbl`)
    const branchMap  = {}
    branches.forEach(b => { branchMap[b.brnch_id] = b.brnch_name?.trim() })

    // Build CRM ID set + fingerprint set
    const crmIds = new Set()
    const crmFingerprints = new Set()
    for (const r of rows) {
      const appId    = normalizeAppId(r.application_id)
      const netWt    = sumCSV(r.net_weight_str)
      const brName   = (branchMap[r.branch_id] || String(r.branch_id))?.trim()
      crmIds.add(appId)
      crmFingerprints.add(fp({ branch_name: brName, purchase_date: r.purchase_date, customer_name: r.customer_name, net_weight: netWt, final_amount_crm: r.final_amount_crm }))
    }

    // ── Pull all Supabase old_crm bills in the window (paginated) ─────────────
    const CHUNK = 1000
    let offset = 0, supaRows = []
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('purchases')
        .select('application_id, branch_name, purchase_date, customer_name, net_weight, final_amount_crm')
        .eq('crm_source', 'old_crm')
        .eq('is_deleted', false)
        .gte('purchase_date', cutoff)
        .range(offset, offset + CHUNK - 1)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      supaRows.push(...data)
      if (data.length < CHUNK) break
      offset += CHUNK
    }

    // ── Classify each Supabase bill ────────────────────────────────────────────
    const ghosts     = []   // not in CRM but fingerprint twin exists → delete+recreate
    const orphans    = []   // not in CRM, no twin → old data / pre-window deletion
    const inCrm      = []   // still in CRM → keep

    for (const b of supaRows) {
      if (crmIds.has(b.application_id)) {
        inCrm.push(b.application_id)
      } else {
        const fingerprint = fp(b)
        if (crmFingerprints.has(fingerprint)) {
          ghosts.push(b.application_id)
        } else {
          orphans.push(b.application_id)
        }
      }
    }

    // ── Mark ghosts as deleted (unless dry run) ────────────────────────────────
    let marked = 0
    if (!dryRun && ghosts.length > 0) {
      const { error } = await supabaseAdmin
        .from('purchases')
        .update({ is_deleted: true })
        .in('application_id', ghosts)
        .eq('crm_source', 'old_crm')
      if (error) throw new Error(error.message)
      marked = ghosts.length
    }

    return Response.json({
      success:     true,
      dry_run:     dryRun,
      window_days: days,
      cutoff,
      crm_approved:    rows.length,
      supabase_total:  supaRows.length,
      in_crm:          inCrm.length,
      ghosts_found:    ghosts.length,
      ghosts_marked:   marked,
      orphans_found:   orphans.length,
      ghost_ids:       ghosts,
      orphan_ids:      orphans.slice(0, 20),   // first 20 for inspection
      message: dryRun
        ? `DRY RUN: ${ghosts.length} ghost bills would be marked deleted. ${orphans.length} orphans (no CRM twin) left untouched.`
        : `Marked ${marked} ghost bills as deleted. ${orphans.length} orphans left untouched.`,
    })

  } catch (err) {
    console.error('Cleanup ghost bills error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
