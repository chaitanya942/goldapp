// app/api/collection-audit/route.js
//
// Collection Audit module — the at-HO intake workflow that replaces the
// manual stock_status flips. Two endpoints:
//
//   GET  /api/collection-audit
//     Returns { bangalore: [], outstation: [{consignment, bills: [...]}, ...] }
//     - outstation = bills with stock_status='in_consignment', grouped by their
//                    parent consignment (so the auditor sees them as the truck arrives)
//     - bangalore  = INTENTIONALLY EMPTY post 1 Jun 2026 cutover. Bangalore
//                    bills no longer follow the "walk-in" model — under the
//                    event-driven lifecycle they're wrapped in a Hub → HO
//                    consignment, generate an EWB, and flip to in_consignment
//                    at EWB-generation time. Once that's done they appear in
//                    the outstation pool just like any other in-flight
//                    consignment. The field is kept in the response shape so
//                    the UI doesn't need an immediate re-render but it will
//                    always be [] going forward.
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
import { istDateStr, addWorkingDaysSkipSunday } from '../../../lib/dateIst'

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
  // BLIND-AUDIT MODE: deliberately omit gross_weight / net_weight / total_amount
  // / audit_discrepancy_g from the queue payload. The auditor must weigh the
  // bill on the scale and type what they see — not rubber-stamp by copying the
  // CRM number off the screen. audit_discrepancy_g is omitted because it would
  // let a re-auditor compute the CRM gross (measured − discrepancy). We do
  // keep audit_gross_weight / audit_remark / audited_at so re-auditors have
  // context on the previous reading + reason it was kept pending.
  // The POST handler reveals the actual CRM gross only after a submission.
  const COLS = 'id, application_id, customer_name, branch_name, purchase_date, transaction_time, transaction_type, audit_gross_weight, audited_at, audit_remark, stock_status, dispatched_at'

  // Bangalore pool deliberately empty post 1 Jun 2026 cutover. See header.
  const bangalore = []

  // ── Outstation pool: in_consignment, grouped by parent consignment ──────
  // Linked via consignment_items.purchase_id → consignments.id.
  //
  // PAGINATION: Supabase's default max_rows cap is 1000. A naive
  // `select * from consignment_items` was silently truncating to the
  // first 1000 link rows (the table has tens of thousands), so any
  // in_consignment bill whose link wasn't in that first 1000 fell
  // through the `if (!cid) continue` orphan filter below and silently
  // disappeared from the audit queue. Two changes:
  //
  //   1. Paginate the in_consignment bills fetch in chunks of 1000.
  //   2. Constrain the consignment_items lookup to ONLY the purchase
  //      IDs we just fetched (so the link result is bounded by the
  //      same N), and chunk that too if N > 1000.
  //
  // After this, the audit pool shows every in_consignment bill
  // regardless of when it was dispatched. The auditor's only filter is
  // "is this bill physically in front of me to weigh".
  const CHUNK = 1000

  async function fetchAllInConsignmentPurchases() {
    const all = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('purchases')
        .select(COLS)
        .eq('stock_status', 'in_consignment')
        .eq('is_deleted', false)
        .neq('crm_status', 'deleted')
        .order('dispatched_at', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })   // tie-breaker so pagination is stable
        .range(from, from + CHUNK - 1)
      if (error) throw error
      all.push(...(data || []))
      if (!data || data.length < CHUNK) break
      from += CHUNK
    }
    return all
  }

  async function fetchLinksForPurchaseIds(purchaseIds) {
    const all = []
    for (let i = 0; i < purchaseIds.length; i += CHUNK) {
      const slice = purchaseIds.slice(i, i + CHUNK)
      const { data, error } = await supabase
        .from('consignment_items')
        .select('purchase_id, consignment_id')
        .in('purchase_id', slice)
      if (error) throw error
      all.push(...(data || []))
    }
    return all
  }

  let outstationRows = []
  let links = []
  try {
    outstationRows = await fetchAllInConsignmentPurchases()
    if (outstationRows.length) {
      links = await fetchLinksForPurchaseIds(outstationRows.map(r => r.id))
    }
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to load audit queue' }, { status: 500 })
  }

  const linkByPid      = new Map(links.map(l => [l.purchase_id, l.consignment_id]))
  const consignmentIds = [...new Set(outstationRows.map(r => linkByPid.get(r.id)).filter(Boolean))]

  // Consolidated branch metadata lookup — feeds two needs:
  //   1) bill.region for region-grouping on the UI (auditors think
  //      region-wise: "what's coming from Karnataka tomorrow")
  //   2) consignment.delivery_tat_hours for expected_arrival_date
  // Done in one round-trip so we don't fetch branches twice.
  const allBranchNames = new Set()
  for (const b of outstationRows) if (b?.branch_name) allBranchNames.add(b.branch_name)

  let consignmentMap = new Map()
  if (consignmentIds.length) {
    // consignmentIds is bounded by outstationRows.length; chunk just in case.
    const csAll = []
    for (let i = 0; i < consignmentIds.length; i += CHUNK) {
      const slice = consignmentIds.slice(i, i + CHUNK)
      const { data: cs } = await supabase
        .from('consignments')
        .select('id, tmp_prf_no, challan_no, branch_name, dest_branch, movement_type, status, dispatched_at, total_bills, total_net_wt, total_gross_wt, total_amount')
        .in('id', slice)
      csAll.push(...(cs || []))
    }
    for (const c of csAll) if (c?.branch_name) allBranchNames.add(c.branch_name)

    let branchByName = new Map()
    if (allBranchNames.size) {
      const { data: branchMeta } = await supabase
        .from('branches')
        .select('name, region, delivery_tat_hours')
        .in('name', [...allBranchNames])
      branchByName = new Map((branchMeta || []).map(b => [b.name, b]))
    }

    // Enrich each consignment with expected_arrival_date = dispatched_at's
    // IST date + ceil(delivery_tat_hours / 24) WORKING days, skipping Sundays
    // (BVC logistics doesn't operate Sundays — same constraint
    // addWorkingDaysSkipSunday already encodes for the bidding flow).
    //
    // Returns calendar dates (YYYY-MM-DD), not instants — arrival is a
    // calendar-day promise from the auditor's perspective; the exact hour
    // the truck pulls in doesn't matter for planning.
    consignmentMap = new Map(csAll.map(c => {
      const tatHours = Number(branchByName.get(c.branch_name)?.delivery_tat_hours) || 24
      let expectedDate = null
      if (c.dispatched_at) {
        const dispDate = istDateStr(new Date(c.dispatched_at))    // YYYY-MM-DD in IST
        const days     = Math.max(1, Math.ceil(tatHours / 24))     // 24h → 1 day, 48h → 2 days
        expectedDate   = addWorkingDaysSkipSunday(dispDate, days)
      }
      const dispatchedDate = c.dispatched_at ? istDateStr(new Date(c.dispatched_at)) : null
      return [c.id, {
        ...c,
        dispatched_date:        dispatchedDate,
        expected_arrival_date:  expectedDate,
        delivery_tat_hours:     tatHours,
      }]
    }))

    // Enrich each bill with its branch's region so the UI can group
    // cards under "Rest of Karnataka", "Kerala", etc. Mutates in place
    // because outstationRows is consumed below; no copy needed.
    for (const b of outstationRows) {
      b.region = branchByName.get(b.branch_name)?.region || 'Unknown'
    }
  }

  // Group outstation bills by consignment.
  const byConsignment = new Map()
  let orphanCount = 0
  for (const bill of outstationRows) {
    const cid = linkByPid.get(bill.id)
    if (!cid) { orphanCount++; continue }   // truly orphan: no consignment_items row exists
    if (!byConsignment.has(cid)) byConsignment.set(cid, { consignment: consignmentMap.get(cid), bills: [] })
    byConsignment.get(cid).bills.push(bill)
  }
  if (orphanCount > 0) {
    // Surface as a server-log warning so we can investigate truly-broken rows
    // without breaking the response. Pagination drops should be zero after
    // this rewrite -- any remaining orphans are data integrity issues.
    console.warn(`[collection-audit] ${orphanCount} in_consignment bill(s) have no consignment_items link — investigate as data drift.`)
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
    return Response.json({
      success:       true,
      action:        'keep_pending',
      discrepancy_g: diff,
      crm_gross:     Number(bill.gross_weight || 0),
      measured,
    })
  }

  // ── 'receive' path ──
  // Reject exact-match policy violations only for the no-remark case. With a
  // remark the auditor has consciously accepted the discrepancy. The error
  // payload deliberately reveals CRM gross now — the auditor has just made a
  // blind measurement, so showing it lets them resolve the discrepancy.
  if (diff !== 0 && !remark) {
    // Write the measurement now so the discrepancy badge surfaces in the
    // queue even if the auditor closes the modal without picking a path.
    await supabase.from('purchases').update(auditFields).eq('id', purchase_id)
    return Response.json({
      error:          'Gross weight does not match CRM. Provide an audit_remark to accept the discrepancy or click "Keep Pending".',
      discrepancy_g:  diff,
      crm_gross:      Number(bill.gross_weight || 0),
      measured,
      requires_remark: true,
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
    success:              true,
    action:               'receive',
    discrepancy_g:        diff,
    crm_gross:            Number(bill.gross_weight || 0),
    measured,
    consignment_received: consignmentReceived,
  })
}
