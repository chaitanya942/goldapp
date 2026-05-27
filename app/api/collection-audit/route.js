// app/api/collection-audit/route.js
//
// Collection Audit module — the at-HO intake workflow that replaces the
// manual stock_status flips. Two endpoints:
//
//   GET  /api/collection-audit
//     Returns { bangalore: [...], outstation: [{consignment, bills: [...]}, ...] }
//     - bangalore  = bills from KA-Bangalore branches still at stock_status='at_branch'
//                    (these never enter the consignment/EWB flow; they walk in to HO)
//     - outstation = bills with stock_status='in_consignment', grouped by their
//                    parent consignment (so the auditor sees them as the truck arrives)
//
//   POST /api/collection-audit
//     Body: { purchase_id, audit_gross_weight, action: 'receive' | 'keep_pending', remark? }
//     - 'receive'      : flip stock_status → 'at_ho', clear current_branch, stamp received_at,
//                        and if this was the last in_consignment bill of its consignment,
//                        flip consignment.status → 'received'.
//     - 'keep_pending' : only write the audit fields. stock_status stays put.
//                        If audit_gross_weight differs from gross_weight, the discrepancy
//                        is captured for follow-up.
//
// Auth: AUDIT role group (super_admin / founders_office / admin / audit).

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

// ── GET: list pending bills (default) OR historical audits (?mode=history) ──
export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.AUDIT })
  if (!auth.ok) return auth.response

  const url  = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'pending'

  // ── History mode: paginated list of every audited bill in the window ──
  // Used by the Audit Report page to power KPIs + per-auditor/per-branch
  // breakdowns. Filters by audited_at, not purchase_date.
  if (mode === 'history') {
    const from = url.searchParams.get('from')   // YYYY-MM-DD inclusive
    const to   = url.searchParams.get('to')     // YYYY-MM-DD inclusive
    const COLS = 'id, application_id, customer_name, branch_name, purchase_date, gross_weight, net_weight, total_amount, audit_gross_weight, audit_discrepancy_g, audited_at, audited_by, audit_remark, stock_status'

    let q = supabase
      .from('purchases')
      .select(COLS)
      .not('audited_at', 'is', null)
      .order('audited_at', { ascending: false })
      .limit(2000)
    if (from) q = q.gte('audited_at', `${from}T00:00:00+05:30`)
    if (to)   q = q.lte('audited_at', `${to}T23:59:59+05:30`)
    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Resolve auditor emails for display — single user_profiles lookup.
    const userIds = [...new Set((data || []).map(r => r.audited_by).filter(Boolean))]
    let emailByUid = new Map()
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', userIds)
      emailByUid = new Map((profiles || []).map(p => [p.id, p.email || p.full_name || '—']))
    }
    return Response.json({
      rows: (data || []).map(r => ({ ...r, audited_by_email: emailByUid.get(r.audited_by) || '—' })),
    })
  }

  // ── Default: pending audit queue (the original AuditData screen) ──
  // Bangalore-branch identification — every branch carries region; KA-Bangalore
  // ones have region='Bangalore'. The Audit Data screen surfaces their
  // at_branch bills directly (no consignment wrapping for intrastate moves).
  const { data: branches } = await supabase.from('branches').select('name, region')
  const bangaloreNames = (branches || []).filter(b => b.region === 'Bangalore').map(b => b.name)

  // SELECT clause shared between the two pools — only the columns the auditor
  // sees on screen so the payload stays small.
  const COLS = 'id, application_id, customer_name, branch_name, purchase_date, gross_weight, net_weight, total_amount, audit_gross_weight, audit_discrepancy_g, audited_at, audit_remark, stock_status, dispatched_at, crm_status, is_deleted'

  // ── Bangalore pool: at_branch + from a Bangalore branch ─────────────────
  let bangalore = []
  if (bangaloreNames.length) {
    const { data, error } = await supabase
      .from('purchases')
      .select(COLS)
      .eq('stock_status', 'at_branch')
      .eq('is_deleted', false)
      .neq('crm_status', 'deleted')
      .in('branch_name', bangaloreNames)
      .order('purchase_date', { ascending: true })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    bangalore = data || []
  }

  // ── Outstation pool: in_consignment, grouped by parent consignment ──────
  // Linked via consignment_items.purchase_id → consignments.id. Pull both
  // tables in parallel, then stitch in JS.
  const [outstationRowsRes, outstationLinksRes] = await Promise.all([
    supabase
      .from('purchases')
      .select(COLS)
      .eq('stock_status', 'in_consignment')
      .eq('is_deleted', false)
      .neq('crm_status', 'deleted')
      .order('dispatched_at', { ascending: true, nullsFirst: false }),
    supabase
      .from('consignment_items')
      .select('purchase_id, consignment_id'),
  ])
  if (outstationRowsRes.error) return Response.json({ error: outstationRowsRes.error.message }, { status: 500 })
  if (outstationLinksRes.error) return Response.json({ error: outstationLinksRes.error.message }, { status: 500 })

  const outstationRows = outstationRowsRes.data || []
  const links          = outstationLinksRes.data || []
  const linkByPid      = new Map(links.map(l => [l.purchase_id, l.consignment_id]))
  const consignmentIds = [...new Set(outstationRows.map(r => linkByPid.get(r.id)).filter(Boolean))]

  let consignmentMap = new Map()
  if (consignmentIds.length) {
    const { data: cs } = await supabase
      .from('consignments')
      .select('id, tmp_prf_no, challan_no, branch_name, dest_branch, movement_type, status, dispatched_at, total_bills, total_net_wt, total_gross_wt, total_amount')
      .in('id', consignmentIds)
    consignmentMap = new Map((cs || []).map(c => [c.id, c]))
  }

  // Group outstation bills by consignment.
  const byConsignment = new Map()
  for (const bill of outstationRows) {
    const cid = linkByPid.get(bill.id)
    if (!cid) continue   // orphan in_consignment bill — shouldn't happen but skip
    if (!byConsignment.has(cid)) byConsignment.set(cid, { consignment: consignmentMap.get(cid), bills: [] })
    byConsignment.get(cid).bills.push(bill)
  }
  const outstation = [...byConsignment.values()]
    .filter(g => g.consignment)
    .sort((a, b) => {
      // Oldest dispatch first (FIFO).
      const aT = new Date(a.consignment.dispatched_at || 0).getTime()
      const bT = new Date(b.consignment.dispatched_at || 0).getTime()
      return aT - bT
    })

  return Response.json({ bangalore, outstation })
}

// ── POST: record an audit action on a single bill ───────────────────────────
export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.AUDIT })
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const { purchase_id, audit_gross_weight, action, remark } = body
  if (!purchase_id) return Response.json({ error: 'purchase_id required' }, { status: 400 })
  if (action !== 'receive' && action !== 'keep_pending') {
    return Response.json({ error: 'action must be "receive" or "keep_pending"' }, { status: 400 })
  }
  const measured = Number(audit_gross_weight)
  if (!Number.isFinite(measured) || measured <= 0) {
    return Response.json({ error: 'audit_gross_weight must be a positive number' }, { status: 400 })
  }

  // Load the bill so we can verify it's still in a state that's audit-eligible
  // and (for the consignment auto-receive below) find its parent consignment.
  const { data: bill, error: billErr } = await supabase
    .from('purchases')
    .select('id, application_id, branch_name, gross_weight, stock_status, is_deleted, crm_status')
    .eq('id', purchase_id)
    .maybeSingle()
  if (billErr) return Response.json({ error: billErr.message }, { status: 500 })
  if (!bill)   return Response.json({ error: 'Bill not found' }, { status: 404 })
  if (bill.is_deleted)                  return Response.json({ error: 'Bill is deleted' }, { status: 400 })
  if (bill.crm_status === 'deleted')    return Response.json({ error: 'Bill is CRM-deleted' }, { status: 400 })
  if (!['at_branch', 'in_consignment'].includes(bill.stock_status)) {
    return Response.json({ error: `Bill is not audit-eligible (stock_status=${bill.stock_status})` }, { status: 400 })
  }

  const diff = Number((measured - Number(bill.gross_weight || 0)).toFixed(3))

  // Common audit-fields write — applied on both 'receive' and 'keep_pending'.
  const auditFields = {
    audit_gross_weight: measured,
    audited_at:         new Date().toISOString(),
    audited_by:         auth.user?.id || null,
    audit_remark:       remark || null,
  }

  if (action === 'keep_pending') {
    const { error } = await supabase.from('purchases').update(auditFields).eq('id', purchase_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, action: 'keep_pending', discrepancy_g: diff })
  }

  // ── 'receive' path ──
  // Reject exact-match policy violations only for the no-remark case. With a
  // remark the auditor has consciously accepted the discrepancy.
  if (diff !== 0 && !remark) {
    return Response.json({
      error: 'Gross weight does not match CRM. Provide an audit_remark to accept the discrepancy or use action="keep_pending".',
      discrepancy_g: diff,
    }, { status: 400 })
  }

  const { error: updErr } = await supabase
    .from('purchases')
    .update({
      ...auditFields,
      stock_status:   'at_ho',
      current_branch: null,
      received_at:    new Date().toISOString(),
    })
    .eq('id', purchase_id)
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

  // ── Auto-flip parent consignment to 'received' if this was the last
  //    in_consignment bill. INTERNAL consignments are auto-received at
  //    creation, so this only matters for EXTERNAL ones with dispatched status.
  let consignmentReceived = null
  const { data: link } = await supabase
    .from('consignment_items')
    .select('consignment_id')
    .eq('purchase_id', purchase_id)
    .maybeSingle()

  if (link?.consignment_id) {
    const cid = link.consignment_id
    // How many bills in this consignment are still in_consignment? Includes
    // soft-deleted bills (those shouldn't block consignment closure).
    const { data: siblingLinks } = await supabase
      .from('consignment_items')
      .select('purchase_id')
      .eq('consignment_id', cid)
    const siblingIds = (siblingLinks || []).map(l => l.purchase_id)
    if (siblingIds.length) {
      const { count } = await supabase
        .from('purchases')
        .select('id', { count: 'exact', head: true })
        .in('id', siblingIds)
        .eq('stock_status', 'in_consignment')
        .eq('is_deleted', false)
      if (count === 0) {
        await supabase
          .from('consignments')
          .update({ status: 'received', received_at: new Date().toISOString() })
          .eq('id', cid)
          .eq('status', 'dispatched')   // safety: never overwrite cancelled/received
        consignmentReceived = cid
      }
    }
  }

  return Response.json({
    success:            true,
    action:             'receive',
    discrepancy_g:      diff,
    consignment_received: consignmentReceived,
  })
}
