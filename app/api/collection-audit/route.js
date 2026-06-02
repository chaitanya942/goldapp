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
// Auth: page-permission based (page.audit-data). Any role that has been
// granted that permission via Role Management can hit this endpoint — so
// custom roles ops create (e.g. master_auditor) work without a code change.
// Same KT §VII trap-2 pattern as the bidding writes in app/api/consignments.

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'
import { istDateStr, addWorkingDaysSkipSunday } from '../../../lib/dateIst'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

// ── GET: list pending bills (default) OR historical audits (?mode=history) ──
export async function GET(req) {
  const auth = await requireAuthForPage(req, 'audit-data')
  if (!auth.ok) return auth.response

  const url  = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'pending'

  // ── Events mode: per-action audit log ──────────────────────────────────
  // Used by the Audit Roster → Audit History tab. Returns one row per
  // AUDIT ACTION, not per bill — so a bill that was count-received then
  // later weight-audited produces TWO event rows in reverse chronological
  // order. Sources:
  //   - count_received_at + count_received_by → type='count'
  //   - audited_at + audited_by               → type='weight' (carries
  //     measured weight, discrepancy, and remark)
  // The two-stage audit model is documented in sql/purchases_count_audit.sql.
  if (mode === 'events') {
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)))

    // Pull bills that produced ANY audit event. To avoid PostgREST's lack of
    // `OR (a IS NOT NULL, b IS NOT NULL)` ergonomics across two columns, run
    // two parallel selects and merge in JS. Each query is small (limited)
    // because we only need the recent slice.
    const COLS = 'id, application_id, branch_name, current_branch, gross_weight, net_weight, audit_gross_weight, audit_discrepancy_g, audited_at, audited_by, audit_remark, count_received_at, count_received_by, stock_status'
    const [{ data: countRows, error: cErr }, { data: weightRows, error: wErr }] = await Promise.all([
      supabase
        .from('purchases')
        .select(COLS)
        .not('count_received_at', 'is', null)
        .order('count_received_at', { ascending: false })
        .limit(limit),
      supabase
        .from('purchases')
        .select(COLS)
        .not('audited_at', 'is', null)
        .order('audited_at', { ascending: false })
        .limit(limit),
    ])
    if (cErr) return Response.json({ error: cErr.message }, { status: 500 })
    if (wErr) return Response.json({ error: wErr.message }, { status: 500 })

    const events = []
    for (const r of (countRows || [])) {
      events.push({
        type:           'count',
        when:           r.count_received_at,
        who:            r.count_received_by,
        purchase_id:    r.id,
        application_id: r.application_id,
        branch_name:    r.current_branch || r.branch_name,
        net_weight_g:   r.net_weight,
        gross_weight_g: r.gross_weight,
      })
    }
    for (const r of (weightRows || [])) {
      events.push({
        type:                'weight',
        when:                r.audited_at,
        who:                 r.audited_by,
        purchase_id:         r.id,
        application_id:      r.application_id,
        branch_name:         r.current_branch || r.branch_name,
        net_weight_g:        r.net_weight,
        gross_weight_g:      r.gross_weight,
        audit_gross_weight:  r.audit_gross_weight,
        audit_discrepancy_g: r.audit_discrepancy_g,
        audit_remark:        r.audit_remark,
        stock_status:        r.stock_status,
      })
    }

    // Sort across both buckets, slice to the requested limit.
    events.sort((a, b) => (b.when || '').localeCompare(a.when || ''))
    const top = events.slice(0, limit)

    // Resolve auditor identity in one round-trip.
    const userIds = [...new Set(top.map(e => e.who).filter(Boolean))]
    let profileByUid = new Map()
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', userIds)
      profileByUid = new Map((profiles || []).map(p => [p.id, p]))
    }
    const out = top.map(e => {
      const p = profileByUid.get(e.who)
      return {
        ...e,
        auditor_name:  p?.full_name || null,
        auditor_email: p?.email || null,
      }
    })
    return Response.json({ rows: out })
  }

  // ── History mode: per-bill audit log + per-branch breakdown ──────────
  // Used by the Audit Report page. Returns:
  //   rows          → one entry per audited bill in the window. Each carries
  //                   first_audit + latest_audit from audit_events so the
  //                   log can show original measurement vs re-audit weight.
  //   branchBreakdown → one entry per source branch with in-transit /
  //                   received / audited / discrepancy counts, expected
  //                   vs received-audited weights, and the list of
  //                   auditors who touched bills from that branch in window.
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
    const { data: audited, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // ── Re-audit history per bill ────────────────────────────────────────
    // Pull every audit event for the bills in this window so the UI can
    // separate first audit from latest re-audit. We don't filter events
    // by window — even if a re-audit happened OUTSIDE the window, it's
    // still the most recent audit on that bill and should surface.
    const billIds = (audited || []).map(r => r.id)
    const eventsByBill = new Map()
    if (billIds.length) {
      // Chunk to dodge any large-IN limits on the Supabase REST layer.
      const EVT_CHUNK = 1000
      for (let i = 0; i < billIds.length; i += EVT_CHUNK) {
        const slice = billIds.slice(i, i + EVT_CHUNK)
        const { data: evts } = await supabase
          .from('audit_events')
          .select('purchase_id, action, audit_gross_weight, crm_gross_weight, discrepancy_g, remark, audited_at, audited_by')
          .in('purchase_id', slice)
          .order('audited_at', { ascending: true })
        for (const e of (evts || [])) {
          if (!eventsByBill.has(e.purchase_id)) eventsByBill.set(e.purchase_id, [])
          eventsByBill.get(e.purchase_id).push(e)
        }
      }
    }

    // Resolve auditor emails — covers both bill-level audited_by and
    // event-level audited_by in one round-trip.
    const userIds = new Set()
    for (const r of (audited || [])) if (r.audited_by) userIds.add(r.audited_by)
    for (const evts of eventsByBill.values()) {
      for (const e of evts) if (e.audited_by) userIds.add(e.audited_by)
    }
    let emailByUid = new Map()
    if (userIds.size) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', [...userIds])
      emailByUid = new Map((profiles || []).map(p => [p.id, p.email || p.full_name || '—']))
    }

    const rows = (audited || []).map(r => {
      const events = eventsByBill.get(r.id) || []
      const first  = events[0] || null
      const latest = events.length > 1 ? events[events.length - 1] : null
      return {
        ...r,
        audited_by_email: emailByUid.get(r.audited_by) || '—',
        first_audit: first ? {
          audit_gross_weight: first.audit_gross_weight,
          discrepancy_g:      first.discrepancy_g,
          audited_at:         first.audited_at,
          audited_by_email:   emailByUid.get(first.audited_by) || null,
          remark:             first.remark,
          action:             first.action,
        } : null,
        reaudit: latest ? {
          audit_gross_weight: latest.audit_gross_weight,
          discrepancy_g:      latest.discrepancy_g,
          audited_at:         latest.audited_at,
          audited_by_email:   emailByUid.get(latest.audited_by) || null,
          remark:             latest.remark,
          action:             latest.action,
        } : null,
        audit_attempts: events.length,
      }
    })

    // ── Per-branch breakdown ─────────────────────────────────────────────
    // In-transit is a LIVE snapshot — bills currently sitting in
    // stock_status='in_consignment' from each source branch, irrespective
    // of the audit window. The rest of the metrics scope to the audit
    // window via the rows fetched above.
    const inTransitByBranch = new Map()
    {
      const CHUNK = 1000
      let fromIdx = 0
      while (true) {
        const { data: live } = await supabase
          .from('purchases')
          .select('branch_name, gross_weight, net_weight')
          .eq('stock_status', 'in_consignment')
          .eq('is_deleted', false)
          .neq('crm_status', 'deleted')
          .range(fromIdx, fromIdx + CHUNK - 1)
        if (!live || live.length === 0) break
        for (const p of live) {
          const k = p.branch_name || '—'
          if (!inTransitByBranch.has(k)) inTransitByBranch.set(k, { bills: 0, weight_g: 0 })
          inTransitByBranch.get(k).bills    += 1
          inTransitByBranch.get(k).weight_g += Number(p.gross_weight || 0)
        }
        if (live.length < CHUNK) break
        fromIdx += CHUNK
      }
    }

    const branchAgg = new Map()
    const ensure = (k) => {
      if (!branchAgg.has(k)) branchAgg.set(k, {
        branch:                   k,
        in_transit_count:         0,
        in_transit_weight_g:      0,
        received_count:           0,
        received_weight_g:        0,
        audited_count:            0,
        discrepancy_count:        0,
        sum_abs_discrepancy_g:    0,
        total_expected_g:         0,   // sum of CRM gross for audited bills in window
        total_received_audited_g: 0,   // sum of measured for the received subset
        auditors:                 new Set(),
      })
      return branchAgg.get(k)
    }

    // Seed with in-transit so branches with no audits this window still appear.
    for (const [k, v] of inTransitByBranch.entries()) {
      const e = ensure(k)
      e.in_transit_count   = v.bills
      e.in_transit_weight_g = Number(v.weight_g.toFixed(3))
    }

    for (const r of rows) {
      const e = ensure(r.branch_name || '—')
      e.audited_count    += 1
      e.total_expected_g += Number(r.gross_weight || 0)
      if (r.stock_status === 'at_ho') {
        e.received_count           += 1
        e.received_weight_g        += Number(r.audit_gross_weight || 0)
        e.total_received_audited_g += Number(r.audit_gross_weight || 0)
      }
      const d = Number(r.audit_discrepancy_g || 0)
      if (d !== 0) {
        e.discrepancy_count    += 1
        e.sum_abs_discrepancy_g += Math.abs(d)
      }
      if (r.audited_by_email) e.auditors.add(r.audited_by_email)
    }

    const branchBreakdown = [...branchAgg.values()].map(b => ({
      branch:                   b.branch,
      in_transit_count:         b.in_transit_count,
      in_transit_weight_g:      Number(b.in_transit_weight_g.toFixed(3)),
      received_count:           b.received_count,
      received_weight_g:        Number(b.received_weight_g.toFixed(3)),
      audited_count:            b.audited_count,
      discrepancy_count:        b.discrepancy_count,
      sum_abs_discrepancy_g:    Number(b.sum_abs_discrepancy_g.toFixed(3)),
      total_expected_g:         Number(b.total_expected_g.toFixed(3)),
      total_received_audited_g: Number(b.total_received_audited_g.toFixed(3)),
      auditors:                 [...b.auditors],
    })).sort((a, b) =>
      b.discrepancy_count - a.discrepancy_count ||
      b.audited_count     - a.audited_count
    )

    return Response.json({ rows, branchBreakdown })
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
  // count_received_at / count_received_by surface the interim "count
  // audit done, weight still pending" state on the bill card. See
  // sql/purchases_count_audit.sql for the business rules.
  const COLS = 'id, application_id, customer_name, branch_name, purchase_date, transaction_time, transaction_type, audit_gross_weight, audited_at, audit_remark, stock_status, dispatched_at, count_received_at, count_received_by'

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
      // Arrival is purely data-driven: branches.delivery_tat_hours tells us
      // how long the truck takes. < 24h = same-day arrival, >= 24h =
      // working-day math (Sunday-skipping). If a branch has TAT = NULL we
      // fall back to 24h. To configure a same-building move (e.g. Bangalore
      // hubs that dispatch to HO in the same yard), set their
      // delivery_tat_hours to 0 in the branches table.
      const rawTat   = Number(branchByName.get(c.branch_name)?.delivery_tat_hours)
      const tatHours = Number.isFinite(rawTat) ? rawTat : 24
      let expectedDate = null
      if (c.dispatched_at) {
        const dispDate = istDateStr(new Date(c.dispatched_at))    // YYYY-MM-DD in IST
        if (tatHours < 24) {
          expectedDate = dispDate    // same-day arrival
        } else {
          const days   = Math.ceil(tatHours / 24)
          expectedDate = addWorkingDaysSkipSunday(dispDate, days)
        }
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
  const auth = await requireAuthForPage(req, 'audit-data')
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const { purchase_id, purchase_ids, audit_gross_weight, action, remark, acknowledged_diff } = body

  // ── 'mark_received' — count audit, single OR bulk ────────────────────────
  // Bulk mode (purchase_ids array) lets the auditor mark an entire truck's
  // bills as count-received in one click. Per-bill mode (single purchase_id)
  // is still supported for the per-card button.
  //
  // Skips bills that are already weight-audited (count is moot then), and
  // is idempotent on bills already count-received. Stock_status stays
  // in_consignment for everyone — weight audit is still required to flip
  // to at_ho.
  if (action === 'mark_received') {
    const ids = Array.isArray(purchase_ids) && purchase_ids.length
      ? purchase_ids
      : (purchase_id ? [purchase_id] : [])
    if (!ids.length) {
      return Response.json({ error: 'purchase_id or purchase_ids required' }, { status: 400 })
    }
    // Load the candidate bills so we can apply the eligibility filter once
    // server-side rather than trusting the client.
    const { data: bills, error: billsErr } = await supabase
      .from('purchases')
      .select('id, application_id, stock_status, is_deleted, crm_status, count_received_at, audited_at')
      .in('id', ids)
    if (billsErr) return Response.json({ error: billsErr.message }, { status: 500 })
    if (!bills || bills.length === 0) {
      return Response.json({ error: 'No matching bills found' }, { status: 404 })
    }
    const eligible = []
    let skippedDeleted     = 0
    let skippedNotInTransit = 0
    let skippedAudited     = 0
    let alreadyReceived    = 0
    for (const b of bills) {
      if (b.is_deleted || b.crm_status === 'deleted')              { skippedDeleted++;     continue }
      if (!['at_branch', 'in_consignment'].includes(b.stock_status)) { skippedNotInTransit++; continue }
      if (b.audited_at)        { skippedAudited++;  continue }
      if (b.count_received_at) { alreadyReceived++; continue }
      eligible.push(b.id)
    }
    if (eligible.length === 0) {
      return Response.json({
        success:           true,
        action:            'mark_received',
        marked:            0,
        already_received:  alreadyReceived,
        skipped_audited:   skippedAudited,
        skipped_deleted:   skippedDeleted,
        skipped_not_in_transit: skippedNotInTransit,
      })
    }
    const { error: upErr } = await supabase
      .from('purchases')
      .update({
        count_received_at: new Date().toISOString(),
        count_received_by: auth.user?.id || null,
      })
      .in('id', eligible)
    if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
    return Response.json({
      success:           true,
      action:            'mark_received',
      marked:            eligible.length,
      already_received:  alreadyReceived,
      skipped_audited:   skippedAudited,
      skipped_deleted:   skippedDeleted,
      skipped_not_in_transit: skippedNotInTransit,
    })
  }

  // ── 'receive' / 'keep_pending' — weight audit on a single bill ───────────
  if (!purchase_id) return Response.json({ error: 'purchase_id required' }, { status: 400 })
  if (action !== 'receive' && action !== 'keep_pending') {
    return Response.json({ error: 'action must be "receive", "keep_pending", or "mark_received"' }, { status: 400 })
  }
  const measured = Number(audit_gross_weight)
  if (!Number.isFinite(measured) || measured <= 0) {
    return Response.json({ error: 'audit_gross_weight must be a positive number' }, { status: 400 })
  }

  // Load the bill so we can verify it's still in a state that's audit-eligible
  // and (for the consignment auto-receive below) find its parent consignment.
  const { data: bill, error: billErr } = await supabase
    .from('purchases')
    .select('id, application_id, branch_name, gross_weight, stock_status, is_deleted, crm_status, count_received_at, audited_at')
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
  const auditedAtIso = new Date().toISOString()

  // Common audit-fields write — applied on both 'receive' and 'keep_pending'.
  const auditFields = {
    audit_gross_weight: measured,
    audited_at:         auditedAtIso,
    audited_by:         auth.user?.id || null,
    audit_remark:       remark || null,
  }

  // Append-only event log — one row per audit ACTION, even re-audits. See
  // sql/audit_events.sql for schema + backfill. We snapshot CRM gross so
  // a later CRM edit can't retroactively rewrite history.
  const recordEvent = (eventAction) =>
    supabase.from('audit_events').insert({
      purchase_id,
      action:             eventAction,
      audit_gross_weight: measured,
      crm_gross_weight:   Number(bill.gross_weight || 0),
      discrepancy_g:      diff,
      remark:             remark || null,
      audited_at:         auditedAtIso,
      audited_by:         auth.user?.id || null,
    })

  if (action === 'keep_pending') {
    const { error } = await supabase.from('purchases').update(auditFields).eq('id', purchase_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await recordEvent('keep_pending')
    return Response.json({
      success:       true,
      action:        'keep_pending',
      discrepancy_g: diff,
      crm_gross:     Number(bill.gross_weight || 0),
      measured,
    })
  }

  // ── 'receive' path ──
  // Two-stage flow for negative discrepancies:
  //   1. First submit (no acknowledged_diff flag) → if measured < CRM,
  //      reveal the comparison so the auditor SEES what they entered vs
  //      what was expected. Bill stays pending.
  //   2. Second submit (acknowledged_diff: true) → accept the receive,
  //      whether or not the auditor added a remark. The remark stays
  //      OPTIONAL throughout.
  //
  // Positive discrepancy auto-accepts on first submit — extra weight is
  // not suspicious and doesn't need a confirmation step.
  if (diff < 0 && !acknowledged_diff) {
    // Write the measurement now so the discrepancy badge surfaces in the
    // queue if the auditor closes the modal without confirming.
    await supabase.from('purchases').update(auditFields).eq('id', purchase_id)
    await recordEvent('keep_pending')   // not received yet — interim state
    return Response.json({
      reveal:        true,
      discrepancy_g: diff,
      crm_gross:     Number(bill.gross_weight || 0),
      measured,
      message:       'Measured weight is LESS than CRM. Review the comparison and confirm to accept; a remark is optional.',
    }, { status: 409 })
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
  await recordEvent('receive')

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
