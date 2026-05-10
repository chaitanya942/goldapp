// app/api/consignments/route.js

import { createClient } from '@supabase/supabase-js'
import {
  regionToStateCode,
  autoBranchCode,
  generateTmpPrfNo,
  generateExternalNo,
  generateInternalNo,
  generateIssueVoucherNo,
} from '../../../lib/consignmentUtils'
import { logConsignmentEvent } from '../../../lib/consignmentLog'
import { requireAuth, ROLE_GROUPS, getRegionFilter, resolveAllowedBranchNames } from '../../../lib/apiAuth'
import { istToday } from '../../../lib/dateIst'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Map POST actions to required role groups. Default is ANY authenticated user.
const ACTION_ROLE_REQUIREMENTS = {
  approve_consignment:    ROLE_GROUPS.ACCOUNTS,
  reject_approval:        ROLE_GROUPS.ACCOUNTS,
  cancel_consignment:     ROLE_GROUPS.ADMIN,
  // Cancellation request lifecycle. Operations files request_cancellation
  // (any auth'd user). Accounts decides via approve_cancellation /
  // reject_cancellation — same role gate as other approval decisions.
  approve_cancellation:   ROLE_GROUPS.ACCOUNTS,
  reject_cancellation:    ROLE_GROUPS.ACCOUNTS,
}

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(req) {
  // Any authenticated user can read consignment data; specific actions can
  // tighten further by checking auth.role inline.
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // Region scoping: resolve once per request. allowedBranches=null means
  // "no restriction" (admin/founders bypass, or user has no allowed_regions).
  // When non-null, it's the explicit list of branch names this user can see;
  // every data action must filter by it. allowedRegions is the same info but
  // expressed as region names — useful when joining via branches.region.
  const allowedRegions  = getRegionFilter(auth)
  const allowedBranches = allowedRegions ? await resolveAllowedBranchNames(supabase, auth) : null

  // ── Branch Stock Overview (new landing view) ──────────────────────────────
  if (action === 'branch_overview') {
    // Server-side aggregation via RPC — single grouped SQL query handles
    // 24K+ bills in <500ms. Falls back to JS pagination if RPC missing.
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('branch_stock_summary')

    if (rpcErr) {
      console.warn('[branch_overview] RPC failed, falling back to pagination:', rpcErr.message)
      return Response.json({ data: [], error: 'branch_stock_summary RPC missing. Apply sql/branch_stock_summary_rpc.sql.' })
    }

    // Fetch branch metadata to filter outside_bangalore + attach region/pickup.
    // Region scoping applied here so downstream summary only includes user's branches.
    let branchesQ = supabase
      .from('branches')
      .select('name, region, state, model_type, pickup_time')
      .eq('is_active', true)
    if (allowedRegions) branchesQ = branchesQ.in('region', allowedRegions)
    const { data: branches, error: bErr } = await branchesQ
    if (bErr) return Response.json({ data: [], error: bErr.message })

    const branchMeta = {}
    for (const b of branches || []) {
      branchMeta[b.name] = { region: b.region || 'Unknown', state: b.state, model_type: b.model_type, pickup_time: b.pickup_time || null }
    }
    const outsideBranches = new Set(
      (branches || []).filter(b => b.model_type === 'outside_bangalore').map(b => b.name)
    )

    // Last moved consignment date per branch
    const { data: lastMoved } = await supabase
      .from('consignments')
      .select('branch_name, created_at, status')
      .neq('status', 'seed')
      .order('created_at', { ascending: false })

    const lastMovedByBranch = {}
    for (const c of lastMoved || []) {
      if (!lastMovedByBranch[c.branch_name]) lastMovedByBranch[c.branch_name] = c.created_at
    }

    // Pre-populate zero-stock outside branches so they still appear in the table
    const summary = {}
    for (const branchName of outsideBranches) {
      const meta = branchMeta[branchName] || { region: 'Unknown', pickup_time: null }
      summary[branchName] = {
        branch_name: branchName, region: meta.region, pickup_time: meta.pickup_time,
        last_moved_at: lastMovedByBranch[branchName] || null,
        total_bills: 0, today_bills: 0, older_bills: 0,
        today_net_wt: 0, older_net_wt: 0,
        today_gross_value: 0, older_gross_value: 0,
        total_gross_wt: 0, total_net_wt: 0, total_gross_value: 0,
        oldest_date: null,
      }
    }

    // Merge RPC aggregates into summary
    for (const row of rpcRows || []) {
      if (!outsideBranches.has(row.branch_name)) continue
      const s = summary[row.branch_name]
      if (!s) continue
      const totalBills = Number(row.total_bills || 0)
      const todayBills = Number(row.today_bills || 0)
      const totalNet   = parseFloat(row.total_net_wt      || 0)
      const todayNet   = parseFloat(row.today_net_wt      || 0)
      const totalGross = parseFloat(row.total_gross_wt    || 0)
      const totalVal   = parseFloat(row.total_gross_value || 0)
      const todayVal   = parseFloat(row.today_gross_value || 0)
      s.total_bills        = totalBills
      s.today_bills        = todayBills
      s.older_bills        = totalBills - todayBills
      s.total_net_wt       = totalNet
      s.today_net_wt       = todayNet
      s.older_net_wt       = totalNet - todayNet
      s.total_gross_wt     = totalGross
      s.total_gross_value  = totalVal
      s.today_gross_value  = todayVal
      s.older_gross_value  = totalVal - todayVal
      s.oldest_date        = row.oldest_pending_date
    }

    const result = Object.values(summary).map(s => {
      const oldestMs   = s.oldest_date ? new Date(s.oldest_date).getTime() : null
      const oldestDays = oldestMs ? Math.floor((Date.now() - oldestMs) / 86400000) : 0
      const lastMovedDays = s.last_moved_at ? Math.floor((Date.now() - new Date(s.last_moved_at).getTime()) / 86400000) : null
      return { ...s, oldest_age_days: oldestDays, last_moved_days_ago: lastMovedDays }
    }).sort((a, b) => b.total_gross_wt - a.total_gross_wt)

    return Response.json({ data: result })
  }

  // ── Get outside-Bangalore branches from branches master ──────────────────
  if (action === 'branches') {
    let q = supabase
      .from('branches')
      .select('id, name, state, region, cluster, model_type, address, city, pin_code, contact_person, contact_phone, branch_gstin, is_hub, hub_branch_name, pickup_time')
      .eq('is_active', true)
      .neq('region', 'Bangalore')
      .order('region')
      .order('name')
    if (allowedRegions) q = q.in('region', allowedRegions)
    const { data, error } = await q

    // Enrich with state_code and branch_code
    const enriched = (data || []).map(b => ({
      ...b,
      branch_name: b.name,
      branch_code: autoBranchCode(b.name),
      state_code:  regionToStateCode(b.region),
    }))

    return Response.json({ data: enriched, error: error?.message })
  }

  // ── Get stock in branch (at_branch, outside Bangalore) ───────────────────
  if (action === 'stock_in_branch') {
    const branch   = searchParams.get('branch')
    const dateFrom = searchParams.get('date_from')
    const dateTo   = searchParams.get('date_to')

    const { data: outsideBranches } = await supabase
      .from('branches')
      .select('name')
      .eq('is_active', true)
      .neq('region', 'Bangalore')
    const outsideNames = (outsideBranches || []).map(b => b.name)

    // Two queries merged client-side:
    //   1. OWN bills — strict filter (approved, not deleted, at_branch)
    //   2. TRANSFERRED-IN bills — relaxed filter (just at_branch + not deleted)
    //      because the source branch already validated approval before transfer.
    //      Without this, bills that were legitimately moved disappear from the
    //      hub picker if their crm_status changed (e.g. amendments) post-move.
    if (branch) {
      // Split into THREE queries instead of an OR-chain so PostgREST never
      // has to parse a value with a dash (e.g. "TS-KUKATPALLY") inside an
      // or() expression — that mis-parsing was returning 0 rows even when
      // the data clearly matched (Branch Stock Overview's RPC saw 243 bills
      // for the same branch while this query saw 0).
      //
      //   1. OWN bills with current_branch == branch_name (the common case
      //      after a sync that populates current_branch)
      //   2. OWN bills with current_branch IS NULL (legacy rows pre-current_branch)
      //   3. TRANSFERRED-IN bills (different branch_name, current here)
      // Explicit column list — the picker only renders these 10 fields.
      // Trimming select('*') cut payload ~70% on branches with 200+ bills
      // (purchases has wide JSON columns like cleartax_response and full
      // address blocks the picker never touches).
      const PICKER_COLS = 'id,branch_name,current_branch,customer_name,application_id,purchase_date,net_weight,total_amount,final_amount_crm,transaction_type'

      const baseFilter = (q) => {
        let r = q.eq('stock_status', 'at_branch').eq('is_deleted', false)
        if (dateFrom) r = r.gte('purchase_date', dateFrom)
        if (dateTo)   r = r.lte('purchase_date', dateTo)
        return r
      }

      const ownCurrentQ = baseFilter(supabase.from('purchases').select(PICKER_COLS))
        .eq('crm_status', 'approved')
        .eq('branch_name', branch)
        .eq('current_branch', branch)

      const ownNullCurrentQ = baseFilter(supabase.from('purchases').select(PICKER_COLS))
        .eq('crm_status', 'approved')
        .eq('branch_name', branch)
        .is('current_branch', null)

      const transferredQ = baseFilter(supabase.from('purchases').select(PICKER_COLS))
        .neq('branch_name', branch)
        .eq('current_branch', branch)

      // Fourth query: which purchase IDs are already linked to a
      // non-cancelled, non-received consignment? With the new "bills don't
      // move until approval" flow, those bills still have stock_status
      // 'at_branch' and would otherwise show up here as pickable — even
      // though the duplicate-link guard would reject them at create time.
      // Exclude them from the picker to avoid the false-affordance.
      const committedQ = supabase
        .from('consignment_items')
        .select('purchase_id, consignments!inner(status)')
        .not('consignments.status', 'in', '("cancelled","received")')

      const [own1, own2, tr, committed] = await Promise.all([ownCurrentQ, ownNullCurrentQ, transferredQ, committedQ])
      const firstErr = own1.error || own2.error || tr.error || committed.error
      if (firstErr) return Response.json({ data: [], error: firstErr.message })

      const committedIds = new Set((committed.data || []).map(r => r.purchase_id))

      // De-dup defensively (a row should only fall in one bucket) and drop
      // any bill already committed to an active consignment.
      const seen = new Set()
      const merged = [...(own1.data || []), ...(own2.data || []), ...(tr.data || [])]
        .filter(r => {
          if (committedIds.has(r.id)) return false
          if (seen.has(r.id)) return false
          seen.add(r.id)
          return true
        })
        .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date))
      return Response.json({ data: merged, committed_count: committedIds.size })
    }

    // Branch-overview path (no specific branch) — keep original strict filter.
    let query = supabase
      .from('purchases')
      .select('*')
      .eq('stock_status', 'at_branch')
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
      .order('purchase_date', { ascending: false })
      .or(`current_branch.in.(${outsideNames.map(n => `"${n}"`).join(',')}),and(current_branch.is.null,branch_name.in.(${outsideNames.map(n => `"${n}"`).join(',')}))`)
    if (dateFrom) query = query.gte('purchase_date', dateFrom)
    if (dateTo)   query = query.lte('purchase_date', dateTo)

    const { data, error } = await query
    return Response.json({ data, error: error?.message })
  }

  // ── Check for unknown branches (in purchases but not in branches table) ──
  if (action === 'unknown_branches') {
    const { data: knownBranches } = await supabase
      .from('branches')
      .select('name')
      .eq('is_active', true)

    const knownNames = new Set((knownBranches || []).map(b => b.name))

    const { data: purchaseBranches } = await supabase
      .from('purchases')
      .select('branch_name')
      .eq('is_deleted', false)
      .not('branch_name', 'is', null)

    const unknownSet = new Set()
    for (const p of purchaseBranches || []) {
      if (!knownNames.has(p.branch_name)) unknownSet.add(p.branch_name)
    }

    return Response.json({ data: [...unknownSet].sort() })
  }

  // ── Debug: dump current state of all bills in a given consignment ──────
  // Use to diagnose count mismatches: where did the bills actually end up?
  if (action === 'debug_consignment_bills') {
    const cid = searchParams.get('id')
    if (!cid) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data: links } = await supabase.from('consignment_items').select('purchase_id').eq('consignment_id', cid)
    const pids = (links || []).map(l => l.purchase_id)
    if (!pids.length) return Response.json({ data: [] })
    const { data: bills } = await supabase
      .from('purchases')
      .select('id, application_id, customer_name, branch_name, current_branch, stock_status, crm_status, is_deleted, purchase_date, net_weight, total_amount, dispatched_at')
      .in('id', pids)
    return Response.json({
      data: bills || [],
      summary: {
        count: pids.length,
        by_stock_status: (bills || []).reduce((a, b) => ({ ...a, [b.stock_status]: (a[b.stock_status] || 0) + 1 }), {}),
        by_current_branch: (bills || []).reduce((a, b) => ({ ...a, [b.current_branch || 'null']: (a[b.current_branch || 'null'] || 0) + 1 }), {}),
        by_crm_status: (bills || []).reduce((a, b) => ({ ...a, [b.crm_status]: (a[b.crm_status] || 0) + 1 }), {}),
        deleted: (bills || []).filter(b => b.is_deleted).length,
      },
    })
  }

  // ── Pending approvals — accounts team queue ────────────────────────────
  if (action === 'pending_approvals') {
    const { data, error } = await supabase
      .from('consignments')
      .select('*')
      .eq('approval_status', 'pending')
      .neq('status', 'cancelled')
      .neq('status', 'seed')
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data: data || [] })
  }

  // ── Approval history (for the Approved / Rejected tabs in the
  //    Pending Approvals page). Read-only audit trail so accounts has
  //    a record of past decisions.
  if (action === 'approval_history') {
    const status = searchParams.get('status')   // 'approved' | 'rejected'
    if (status !== 'approved' && status !== 'rejected') {
      return Response.json({ error: "status must be 'approved' or 'rejected'" }, { status: 400 })
    }
    // No date floor — accounts wants the full history of approved / rejected
    // consignments in one place. If volume becomes a problem we can add
    // pagination later, but the rolling 30-day cap was hiding rows operators
    // expected to see.
    let q = supabase
      .from('consignments')
      .select('*')
      .eq('approval_status', status)
      .neq('status', 'seed')
      .order('approved_at', { ascending: false, nullsFirst: false })
    if (allowedBranches) q = q.in('branch_name', allowedBranches)
    // For the Rejected tab, exclude rows whose rejection was triggered by an
    // EWB / E-Invoice cancel — those belong on the Cancellations tab instead,
    // not Rejected. Same prefix used by the cancel routes when stamping
    // rejection_reason on auto-reject. Postgres NOT LIKE is case-sensitive,
    // matching what we wrote.
    if (status === 'rejected') {
      q = q.not('rejection_reason', 'ilike', 'Rejected because of cancellation of%')
    }
    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data: data || [] })
  }

  // ── Cancellation history: every EWB / E-Invoice cancellation in the window ──
  // Joins consignment_activity_log with the consignment row so the UI can
  // show: who cancelled what, why, when, plus the consignment context.
  //
  // Pulls THREE event types to be resilient:
  //   - ewb_cancelled       (explicit, written by /api/eway-bill/cancel)
  //   - einvoice_cancelled  (explicit, written by /api/e-invoice/cancel)
  //   - cancelled           (generic, written by cancel_consignment_atomic RPC)
  //
  // Dedup keeps one row per consignment, preferring specific types over the
  // generic. For any consignment that only has a 'cancelled' event (e.g. the
  // explicit log call silently failed), we derive the doc type from the
  // event's details payload (details.had_ewb / details.had_irn) so the row
  // still appears here instead of disappearing into the void.
  // Pending cancellation requests — accounts queue. Returns consignments
  // where ops has filed a cancellation request but accounts hasn't approved
  // or rejected yet. Region-scoped via the same filter as the other lists.
  if (action === 'cancellation_requests') {
    let q = supabase
      .from('consignments')
      .select('*')
      .not('cancellation_requested_at', 'is', null)
      .neq('status', 'cancelled')
      .order('cancellation_requested_at', { ascending: true }) // oldest first → FIFO
    const regionFilter = getRegionFilter(auth, req)
    if (regionFilter?.branch_names?.length) {
      q = q.in('branch_name', regionFilter.branch_names)
    }
    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data: data || [] })
  }

  if (action === 'cancellation_history') {
    // No date floor — the Cancellations tab now shows every recorded
    // cancellation. Audit data should be permanent.
    const { data: events, error: evErr } = await supabase
      .from('consignment_activity_log')
      .select('id, consignment_id, event_type, actor_email, actor_role, details, created_at')
      .in('event_type', ['ewb_cancelled', 'einvoice_cancelled', 'cancelled'])
      .order('created_at', { ascending: false })
    if (evErr) return Response.json({ error: evErr.message }, { status: 500 })

    // Group events by consignment_id. For each group prefer specific event
    // types; fall back to the generic 'cancelled' if that's all we have.
    const eventsByConsignment = new Map()
    for (const e of events || []) {
      const existing = eventsByConsignment.get(e.consignment_id)
      if (!existing) { eventsByConsignment.set(e.consignment_id, e); continue }
      const specifity = (t) => t === 'ewb_cancelled' || t === 'einvoice_cancelled' ? 2 : 1
      if (specifity(e.event_type) > specifity(existing.event_type)) {
        eventsByConsignment.set(e.consignment_id, e)
      }
    }
    const dedupedEvents = [...eventsByConsignment.values()]

    const ids = [...new Set(dedupedEvents.map(e => e.consignment_id).filter(Boolean))]
    // Look up consignments WITHOUT the region filter first so we can tell
    // 'deleted' apart from 'scoped out'. Apply region scoping in JS below.
    let consignmentsAll = []
    if (ids.length) {
      const { data: cs, error: cErr } = await supabase
        .from('consignments')
        .select('id, tmp_prf_no, branch_name, dest_branch, movement_type, total_bills, total_gross_value, total_net_wt, approval_status, status, rejection_reason, created_at')
        .in('id', ids)
      if (cErr) return Response.json({ error: cErr.message }, { status: 500 })
      consignmentsAll = cs || []
    }
    const byId = new Map(consignmentsAll.map(c => [c.id, c]))
    const inScope = (c) => !allowedBranches || (c && allowedBranches.includes(c.branch_name))

    // For generic 'cancelled' fallbacks, infer the doc-type label from the
    // event's details payload so the UI's badge logic continues to work
    // (it switches on event_type === 'ewb_cancelled' for the green EWB pill,
    // anything else for the purple E-Invoice pill).
    const rows = dedupedEvents.flatMap(e => {
      const c = byId.get(e.consignment_id)
      // Region scoping: if the consignment exists but is outside the user's
      // allowed branches, drop the event (security). If the consignment is
      // missing entirely (deleted), KEEP the event so the audit trail isn't
      // silently broken — the UI will render with a 'consignment deleted'
      // placeholder.
      if (c && !inScope(c)) return []
      let inferredType = e.event_type
      if (e.event_type === 'cancelled') {
        if (e.details?.had_ewb) inferredType = 'ewb_cancelled'
        else if (e.details?.had_irn) inferredType = 'einvoice_cancelled'
        // If neither, leave as 'cancelled' — UI will show as a generic void.
      }
      return [{
        ...e,
        event_type:           inferredType,
        consignment:          c || null,
        consignment_missing:  !c,
      }]
    })
    return Response.json({ data: rows })
  }

  // ── Docs generated report: every EWB + E-Invoice issued in a window ────
  // Accounts uses this for daily / monthly GST reconciliation. Returns one
  // row per generated document (a single consignment with both EWB and IRN
  // appears twice — once per doc type) so the table is flat and exportable.
  if (action === 'docs_generated_report') {
    const today    = istToday()
    const fromStr  = searchParams.get('from') || today
    const toStr    = searchParams.get('to')   || fromStr
    const fromIso  = `${fromStr}T00:00:00+05:30`
    const toIso    = `${toStr}T23:59:59+05:30`

    // EWBs generated in window
    let ewbQ = supabase
      .from('consignments')
      .select('id, tmp_prf_no, branch_name, dest_branch, movement_type, eway_bill_no, ewb_generated_at, ewb_valid_until, total_bills, total_gross_wt, total_net_wt, total_amount, approval_status, status, einvoice_doc_no, irn, einvoice_generated_at')
      .not('eway_bill_no', 'is', null)
      .gte('ewb_generated_at', fromIso)
      .lte('ewb_generated_at', toIso)
      .order('ewb_generated_at', { ascending: false })
    if (allowedBranches) ewbQ = ewbQ.in('branch_name', allowedBranches)
    const ewbRes = await ewbQ
    if (ewbRes.error) return Response.json({ error: ewbRes.error.message }, { status: 500 })

    // E-Invoices generated in window
    let eiQ = supabase
      .from('consignments')
      .select('id, tmp_prf_no, branch_name, dest_branch, movement_type, irn, ack_no, ack_dt, einvoice_doc_no, einvoice_generated_at, total_bills, total_gross_wt, total_net_wt, total_amount, approval_status, status, eway_bill_no, ewb_generated_at')
      .not('irn', 'is', null)
      .gte('einvoice_generated_at', fromIso)
      .lte('einvoice_generated_at', toIso)
      .order('einvoice_generated_at', { ascending: false })
    if (allowedBranches) eiQ = eiQ.in('branch_name', allowedBranches)
    const eiRes = await eiQ
    if (eiRes.error) return Response.json({ error: eiRes.error.message }, { status: 500 })

    // Pull the 'who generated it' from the activity log (ewb_generated /
    // einvoice_generated events). Map by consignment_id for fast lookup.
    const ids = [...new Set([...(ewbRes.data || []), ...(eiRes.data || [])].map(r => r.id))]
    let actorByEwb = new Map(), actorByEi = new Map()
    if (ids.length) {
      const { data: events } = await supabase
        .from('consignment_activity_log')
        .select('consignment_id, event_type, actor_email, created_at')
        .in('consignment_id', ids)
        .in('event_type', ['ewb_generated', 'einvoice_generated'])
        .order('created_at', { ascending: false })
      for (const e of events || []) {
        const map = e.event_type === 'ewb_generated' ? actorByEwb : actorByEi
        if (!map.has(e.consignment_id)) map.set(e.consignment_id, e.actor_email)
      }
    }

    // Pull GST rates from company_settings to compute the E-Invoice value
    // breakdown. Defaults match what the canonical calculator (lib/consignmentTotals)
    // uses everywhere else: 7.5% uplift, 3% IGST. Single fetch per request.
    const { data: cs } = await supabase.from('company_settings').select('value_uplift_pct, igst_rate').single()
    const upliftPct = parseFloat(cs?.value_uplift_pct ?? 7.5) || 7.5
    const igstRate  = parseFloat(cs?.igst_rate        ?? 3)   || 3

    return Response.json({
      from: fromStr, to: toStr,
      ewbs: (ewbRes.data || []).map(r => ({ ...r, generated_by: actorByEwb.get(r.id) || null })),
      einvoices: (eiRes.data || []).map(r => {
        // E-Invoice is always interstate (KL/TS/AP source → KA HO), so the
        // grand total is assessable + IGST. CGST/SGST = 0. Same formulas the
        // PDF + IRP payload use; numbers will match the printed invoice exactly.
        const raw            = Number(r.total_amount || 0)
        const assessable     = parseFloat((raw * (1 + upliftPct / 100)).toFixed(2))
        const igstAmount     = parseFloat((assessable * igstRate / 100).toFixed(2))
        const totalInvoice   = parseFloat((assessable + igstAmount).toFixed(2))
        return {
          ...r,
          generated_by:     actorByEi.get(r.id) || null,
          assessable_value: assessable,
          igst_amount:      igstAmount,
          total_invoice:    totalInvoice,
        }
      }),
    })
  }

  // ── User efficiency: per-user accounts-team performance over a window ──
  // For each actor returns:
  //   - approved / rejected / cancelled counts
  //   - avg/min/max minutes for the created→decided duration (the same number
  //     shown as the 'in 9m' pill on Approved tab cards). Computed across
  //     approved + rejected decisions; cancellations are pure counts.
  if (action === 'user_efficiency') {
    const today    = istToday()
    const fromStr  = searchParams.get('from') || today
    const toStr    = searchParams.get('to')   || fromStr
    const fromIso  = `${fromStr}T00:00:00+05:30`
    const toIso    = `${toStr}T23:59:59+05:30`

    // Decisions: approvals + manual rejections from the consignments table.
    // Both approved and rejected rows carry approved_at + approved_by.
    let decisionsQ = supabase
      .from('consignments')
      .select('approved_by, approved_at, created_at, approval_status, rejection_reason')
      .not('approved_by', 'is', null)
      .not('approved_at', 'is', null)
      .gte('approved_at', fromIso)
      .lte('approved_at', toIso)
      .in('approval_status', ['approved', 'rejected'])
      .neq('status', 'seed')
    if (allowedBranches) decisionsQ = decisionsQ.in('branch_name', allowedBranches)
    const { data: decisions, error: dErr } = await decisionsQ
    if (dErr) return Response.json({ error: dErr.message }, { status: 500 })

    // Cancellations from activity log: ewb / einvoice / consignment voids.
    const { data: events, error: eErr } = await supabase
      .from('consignment_activity_log')
      .select('event_type, actor_email, consignment_id')
      .in('event_type', ['ewb_cancelled', 'einvoice_cancelled', 'cancelled'])
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
    if (eErr) return Response.json({ error: eErr.message }, { status: 500 })

    // Region-scope the cancellation events by joining back to consignments.
    const consignmentIds = [...new Set((events || []).map(e => e.consignment_id))]
    let visibleConsignmentIds = new Set()
    if (consignmentIds.length) {
      let cq = supabase.from('consignments').select('id').in('id', consignmentIds).neq('status', 'seed')
      if (allowedBranches) cq = cq.in('branch_name', allowedBranches)
      const { data: cs } = await cq
      for (const c of cs || []) visibleConsignmentIds.add(c.id)
    }

    // Aggregate per actor
    const acc = {}
    const ensure = (email) => {
      if (!acc[email]) acc[email] = {
        email,
        decisionTimes: [],   // minutes (approved + rejected)
        approved:  0,
        rejected:  0,
        cancelled: 0,
      }
      return acc[email]
    }
    const minutesBetween = (start, end) =>
      Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))

    for (const r of decisions || []) {
      // Auto-rejections triggered by EWB/E-Invoice cancel carry a fixed
      // rejection_reason prefix — those count as cancellations, not manual
      // rejections, so we skip them here. The cancellation event in the
      // activity log captures them in the cancelled bucket below.
      const isAutoRejected = r.approval_status === 'rejected'
        && (r.rejection_reason || '').startsWith('Rejected because of cancellation of')
      if (isAutoRejected) continue
      const u = ensure(r.approved_by)
      if (r.created_at) u.decisionTimes.push(minutesBetween(r.created_at, r.approved_at))
      if (r.approval_status === 'approved') u.approved += 1
      else                                  u.rejected += 1
    }
    for (const e of events || []) {
      if (!visibleConsignmentIds.has(e.consignment_id)) continue
      const u = ensure(e.actor_email || 'unknown')
      u.cancelled += 1
    }

    const users = Object.values(acc)
      .map(u => {
        const arr = u.decisionTimes
        return {
          email:            u.email,
          avg_min:          arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : null,
          min_min:          arr.length ? Math.min(...arr) : null,
          max_min:          arr.length ? Math.max(...arr) : null,
          approved_count:   u.approved,
          rejected_count:   u.rejected,
          cancelled_count:  u.cancelled,
        }
      })
      // Sort by activity volume (approved + rejected + cancelled) descending.
      .sort((a, b) => (b.approved_count + b.rejected_count + b.cancelled_count)
                    - (a.approved_count + a.rejected_count + a.cancelled_count))

    return Response.json({ from: fromStr, to: toStr, users })
  }

  // ── Pending approvals count (for sidebar badge) ────────────────────────
  if (action === 'pending_approvals_count') {
    let q = supabase
      .from('consignments')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending')
      .neq('status', 'cancelled')
      .neq('status', 'seed')
    if (allowedBranches) q = q.in('branch_name', allowedBranches)
    const { count, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ count: count || 0 })
  }

  // ── Bill journey: every consignment a bill has been part of ────────────
  if (action === 'bill_journey') {
    const purchaseId = searchParams.get('purchase_id')
    if (!purchaseId) return Response.json({ error: 'purchase_id required' }, { status: 400 })
    const { data: links } = await supabase
      .from('consignment_items')
      .select('purchase_id, received_at, short_reason, consignment:consignment_id(id, tmp_prf_no, challan_no, movement_type, branch_name, dest_branch, status, created_at, received_at, cancelled_at, eway_bill_no, irn)')
      .eq('purchase_id', purchaseId)
    const journey = (links || [])
      .map(l => ({
        consignment_id:  l.consignment?.id,
        tmp_prf_no:      l.consignment?.tmp_prf_no,
        challan_no:      l.consignment?.challan_no,
        movement_type:   l.consignment?.movement_type,
        source:          l.consignment?.branch_name,
        dest:            l.consignment?.movement_type === 'INTERNAL' ? l.consignment?.dest_branch : 'HO',
        status:          l.consignment?.status,
        eway_bill_no:    l.consignment?.eway_bill_no,
        irn:             l.consignment?.irn,
        created_at:      l.consignment?.created_at,
        received_at:     l.consignment?.received_at,
        cancelled_at:    l.consignment?.cancelled_at,
        bill_received:   l.received_at,
        short_reason:    l.short_reason,
      }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    return Response.json({ data: journey })
  }

  // ── Activity log for a consignment ──────────────────────────────────────
  if (action === 'activity_log') {
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data, error } = await supabase
      .from('consignment_activity_log')
      .select('*')
      .eq('consignment_id', id)
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  }

  // ── Audit log: ClearTax response history for a consignment ──────────────
  // Returns the stored cleartax_response JSON + EWB/E-Invoice numbers + timestamps.
  // Used for compliance audits and dispute resolution.
  if (action === 'cleartax_audit') {
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data, error } = await supabase
      .from('consignments')
      .select('id, tmp_prf_no, challan_no, branch_name, dest_branch, movement_type, eway_bill_no, ewb_generated_at, irn, ack_no, ack_dt, einvoice_generated_at, cleartax_response, created_at, received_at, status')
      .eq('id', id)
      .maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!data) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    return Response.json({ data })
  }

  // ── Branch summary (state → branch → bills) ──────────────────────────────
  if (action === 'branch_summary') {
    const { data: branches } = await supabase
      .from('branches')
      .select('name, region, state')
      .eq('is_active', true)
      .neq('region', 'Bangalore')

    const branchMeta = {}
    for (const b of branches || []) {
      branchMeta[b.name] = {
        region:     b.region,
        state_code: regionToStateCode(b.region),
        state:      b.state,
      }
    }

    const { data: purchases } = await supabase
      .from('purchases')
      .select('branch_name, current_branch, stock_status, net_weight, total_amount')
      .eq('is_deleted', false)
      .in('stock_status', ['at_branch', 'in_consignment'])

    const summary = {}
    for (const row of purchases || []) {
      const key  = row.current_branch || row.branch_name
      const meta = branchMeta[key]
      if (!meta) continue
      if (!summary[key]) {
        summary[key] = {
          branch:        key,
          region:        meta.region,
          state_code:    meta.state_code,
          at_branch:     0,
          in_consignment: 0,
          at_branch_wt:  0,
          in_consignment_wt: 0,
        }
      }
      if (row.stock_status === 'at_branch') {
        summary[key].at_branch++
        summary[key].at_branch_wt += parseFloat(row.net_weight || 0)
      }
      if (row.stock_status === 'in_consignment') {
        summary[key].in_consignment++
        summary[key].in_consignment_wt += parseFloat(row.net_weight || 0)
      }
    }

    return Response.json({ data: Object.values(summary) })
  }

  // ── Bills currently at_branch (stock-level truth, paginated past 1000) ───
  // Mirror of in_transit_stock for the At Branch tab in Consignment Reports.
  if (action === 'at_branch_stock') {
    const CHUNK = 1000
    let from = 0, all = []
    while (true) {
      let q = supabase
        .from('purchases')
        .select('id, sl_no, application_id, branch_name, current_branch, customer_name, purchase_date, gross_weight, net_weight, total_amount')
        .eq('stock_status', 'at_branch')
        .eq('is_deleted', false)
      if (allowedBranches) q = q.in('current_branch', allowedBranches)  // current_branch reflects physical location
      q = q.range(from, from + CHUNK - 1)
      const { data, error } = await q
      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!data?.length) break
      all = [...all, ...data]
      if (data.length < CHUNK) break
      from += CHUNK
    }
    return Response.json({ data: all })
  }

  // ── Bills currently in transit (stock-level truth) ───────────────────────
  // Returns every purchases row with stock_status='in_consignment', enriched
  // (when possible) with the dispatched consignment that owns it. Bills that
  // were marked in_consignment manually (e.g. via SQL during data fixes) and
  // don't have a dispatched-consignment link still surface here as "untracked".
  if (action === 'in_transit_stock') {
    // 1. Live bills currently in transit (filtered to user's allowed branches when restricted).
    //    purchases.dispatched_at = the moment THIS BILL transitioned at_branch → in_consignment
    //    (stamped on consignment approval). We expose it so the Consignment Report can
    //    bucket / filter by bill-level transition date rather than consignment-level
    //    dates (which can drift when bills are cancelled + re-consigned later).
    let billsQ = supabase
      .from('purchases')
      .select('id, sl_no, application_id, branch_name, current_branch, customer_name, purchase_date, gross_weight, net_weight, total_amount, dispatched_at')
      .eq('stock_status', 'in_consignment')
      .eq('is_deleted', false)
    // Filter by branch_name (origin) for in-transit so a Kerala user sees their dispatched bills
    if (allowedBranches) billsQ = billsQ.in('branch_name', allowedBranches)
    const { data: bills, error: be } = await billsQ

    if (be) return Response.json({ error: be.message }, { status: 500 })
    if (!bills?.length) return Response.json({ data: [] })

    // 2. For each bill, look up the most recent dispatched consignment that links it.
    //    A bill might appear in multiple consignment_items rows historically (cancelled
    //    + re-consigned). Pick the most recent non-cancelled link.
    const billIds = bills.map(b => b.id)
    const { data: links } = await supabase
      .from('consignment_items')
      .select('purchase_id, consignment:consignment_id(id, tmp_prf_no, branch_name, dest_branch, movement_type, status, approval_status, dispatched_at, created_at)')
      .in('purchase_id', billIds)

    // Index: purchase_id → best matching consignment (most recent dispatched + approved)
    const consByPurchase = {}
    for (const link of links || []) {
      const c = link.consignment
      if (!c) continue
      if (c.status === 'cancelled') continue
      // Only consider rows that represent current in-flight state
      const existing = consByPurchase[link.purchase_id]
      const ts = c.dispatched_at || c.created_at
      if (!existing || new Date(ts) > new Date(existing._ts)) {
        consByPurchase[link.purchase_id] = { ...c, _ts: ts }
      }
    }

    const enriched = bills.map(b => {
      const c = consByPurchase[b.id]
      return {
        ...b,
        consignment: c ? {
          id: c.id, tmp_prf_no: c.tmp_prf_no,
          source: c.branch_name, dest: c.dest_branch,
          movement_type: c.movement_type,
          status: c.status, approval_status: c.approval_status,
          dispatched_at: c.dispatched_at,
          created_at: c.created_at,
        } : null,
      }
    })
    return Response.json({ data: enriched })
  }

  // ── Get all consignments ─────────────────────────────────────────────────
  if (action === 'consignments') {
    const status   = searchParams.get('status')
    const branch   = searchParams.get('branch')
    const dateFrom = searchParams.get('date_from')
    const dateTo   = searchParams.get('date_to')

    let query = supabase
      .from('consignments')
      .select('*')
      .neq('status', 'seed')          // never show seed records in reports
      .order('created_at', { ascending: false })

    if (status)   query = query.eq('status', status)
    if (branch)   query = query.eq('branch_name', branch)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo)   query = query.lte('created_at', dateTo)
    // Region scoping: a regional user only sees consignments dispatched FROM their region's branches.
    if (allowedBranches) query = query.in('branch_name', allowedBranches)

    const { data, error } = await query
    return Response.json({ data, error: error?.message })
  }

  // ── Get consignment detail with items ────────────────────────────────────
  if (action === 'consignment_detail') {
    const id = searchParams.get('id')
    const { data: consignment, error: ce } = await supabase
      .from('consignments').select('*').eq('id', id).single()

    if (ce) return Response.json({ error: ce.message }, { status: 404 })
    // Region scoping: deny if this consignment isn't from one of the user's branches.
    if (allowedBranches && !allowedBranches.includes(consignment.branch_name)) {
      return Response.json({ error: 'Forbidden — consignment is outside your assigned region.' }, { status: 403 })
    }

    const { data: items } = await supabase
      .from('consignment_items')
      .select('*, purchase:purchase_id(*)')
      .eq('consignment_id', id)

    return Response.json({ data: { ...consignment, items } })
  }

  // ── Transfer history: for a list of purchase IDs (or a hub branch),
  //    return the most recent INTERNAL (Branch→Hub) consignment that brought
  //    each bill to its current location. Used to surface "via WG000010"
  //    info in hub-level bill pickers and consolidated Hub→HO documents.
  if (action === 'transfer_history') {
    const branch       = searchParams.get('branch')             // hub name
    const idsParam     = searchParams.get('purchase_ids')        // comma-separated
    let purchaseIds = []

    if (idsParam) {
      purchaseIds = idsParam.split(',').filter(Boolean)
    } else if (branch) {
      // All bills currently at this hub (transferred-in OR own — we'll filter below)
      const { data } = await supabase
        .from('purchases')
        .select('id')
        .eq('current_branch', branch)
        .eq('crm_status', 'approved')
        .eq('is_deleted', false)
      purchaseIds = (data || []).map(r => r.id)
    } else {
      return Response.json({ error: 'branch or purchase_ids required' }, { status: 400 })
    }

    if (!purchaseIds.length) return Response.json({ data: {} })

    // Pull all INTERNAL consignment_items for these purchases + parent consignment
    const { data: links } = await supabase
      .from('consignment_items')
      .select('purchase_id, consignment:consignment_id(id, tmp_prf_no, challan_no, internal_no, movement_type, status, branch_name, dest_branch, created_at, received_at)')
      .in('purchase_id', purchaseIds)

    // For each purchase, pick the most recent INTERNAL+received consignment
    const map = {}
    for (const link of links || []) {
      const c = link.consignment
      if (!c || c.movement_type !== 'INTERNAL' || c.status !== 'received') continue
      const existing = map[link.purchase_id]
      if (!existing || new Date(c.created_at) > new Date(existing.created_at)) {
        map[link.purchase_id] = {
          consignment_id: c.id,
          tmp_prf_no:     c.tmp_prf_no,
          internal_no:    c.internal_no,
          challan_no:     c.challan_no,        // voucher no for INTERNAL
          source_branch:  c.branch_name,
          dest_branch:    c.dest_branch,
          received_at:    c.received_at,
          created_at:     c.created_at,
        }
      }
    }
    return Response.json({ data: map })
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req) {
  const body   = await req.json()
  const { action } = body

  // Role check based on action. requireAuth always validates the bearer token;
  // requiredRoles narrows further for accounts/admin-only actions.
  const requiredRoles = ACTION_ROLE_REQUIREMENTS[action] || null
  const auth = await requireAuth(req, { requiredRoles })
  if (!auth.ok) return auth.response

  // Identity is now derived from the verified session — never from the body.
  // Callers can no longer spoof created_by / approver_email / cancelled_by.
  const actorEmail = auth.profile?.email || auth.user?.email || 'unknown'

  // ── Create consignment ───────────────────────────────────────────────────
  if (action === 'create_consignment') {
    const { purchase_ids, branch_name, movement_type, dest_branch, eway_bill_no } = body
    const created_by = actorEmail
    if (!purchase_ids?.length) return Response.json({ error: 'No purchases selected' }, { status: 400 })
    if (!branch_name)          return Response.json({ error: 'Branch name required' },  { status: 400 })

    // Cap consignment size. NIC E-Way Bill caps a single bill at 250 line items;
    // E-Invoice caps at 1000. Beyond ~100 the PDF challan also becomes unreadable
    // and approval review unworkable. Operators should split into multiple
    // consignments rather than stuff everything into one.
    if (purchase_ids.length > 100) {
      return Response.json({
        error: `Too many bills (${purchase_ids.length}). A consignment can carry at most 100 bills — split this into multiple consignments.`,
      }, { status: 400 })
    }
    // Defensive: reject duplicate IDs (shouldn't happen via UI but a hand-rolled
    // POST could create them, and the RPC would then double-insert link rows).
    if (new Set(purchase_ids).size !== purchase_ids.length) {
      return Response.json({ error: 'Duplicate bill IDs in selection.' }, { status: 400 })
    }

    const isInternal = movement_type === 'INTERNAL'
    if (isInternal && !dest_branch) {
      return Response.json({ error: 'Destination hub is required for Branch → Hub movements' }, { status: 400 })
    }
    if (isInternal && dest_branch === branch_name) {
      return Response.json({ error: 'Source and destination cannot be the same branch' }, { status: 400 })
    }

    // Source branch meta — fetch FULL address record so we can snapshot it onto
    // the consignment. EWB / E-Invoice / challan all read from the snapshot, never
    // from live `branches` again.
    const { data: branchData, error: branchErr } = await supabase
      .from('branches')
      .select('*')
      .eq('name', branch_name)
      .single()

    if (branchErr || !branchData) {
      return Response.json({ error: `Branch '${branch_name}' not found in branch master` }, { status: 400 })
    }

    // Destination branch meta (for INTERNAL only).
    // Any branch can act as a hub for a given consignment — no pre-marking required.
    let destData = null
    if (isInternal) {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('name', dest_branch)
        .single()
      if (error || !data) return Response.json({ error: `Destination branch '${dest_branch}' not found` }, { status: 400 })
      destData = data
    }

    const stateCode  = regionToStateCode(branchData.region)
    const branchCode = autoBranchCode(branch_name)

    // Validate selected purchases are currently at this branch (use current_branch with branch_name fallback)
    const { data: purchaseCheck } = await supabase
      .from('purchases')
      .select('id, bill_no:sl_no, branch_name, current_branch, stock_status, gross_weight, net_weight, total_amount, customer_name, purchase_date')
      .in('id', purchase_ids)

    if (!purchaseCheck || purchaseCheck.length !== purchase_ids.length) {
      return Response.json({
        error: `${purchase_ids.length - (purchaseCheck?.length || 0)} bill(s) not found. They may have been deleted.`,
      }, { status: 400 })
    }

    const wrongBranch = (purchaseCheck || []).filter(p => (p.current_branch || p.branch_name) !== branch_name)
    if (wrongBranch.length) {
      return Response.json({
        error: `${wrongBranch.length} purchase(s) are not currently at '${branch_name}'.`,
      }, { status: 400 })
    }

    const alreadyInConsignment = (purchaseCheck || []).filter(p => p.stock_status === 'in_consignment')
    if (alreadyInConsignment.length) {
      return Response.json({
        error: `${alreadyInConsignment.length} purchase(s) are already in a consignment.`,
      }, { status: 400 })
    }

    // Bill-quality validation. Bills with missing/zero weight or amount break
    // the EWB and E-Invoice payloads silently — NIC accepts the request but
    // the resulting document is unusable for transport. Catch it here.
    const todayIso = istToday()
    const qualityErrors = []
    for (const p of purchaseCheck) {
      const tag = p.bill_no || `bill ${p.id}`
      const wt = Number(p.gross_weight ?? p.net_weight ?? 0)
      if (wt <= 0) qualityErrors.push(`${tag}: weight is 0 or missing`)
      if (Number(p.total_amount || 0) <= 0) qualityErrors.push(`${tag}: amount is 0 or missing`)
      if (!p.customer_name || !String(p.customer_name).trim()) qualityErrors.push(`${tag}: customer name is missing`)
      if (p.purchase_date && String(p.purchase_date).slice(0, 10) > todayIso) {
        qualityErrors.push(`${tag}: purchase date is in the future (${p.purchase_date})`)
      }
    }
    if (qualityErrors.length) {
      return Response.json({
        error: 'Some bills have incomplete data and cannot be consigned. Fix these in the Purchases module first:\n' + qualityErrors.slice(0, 10).join('\n') + (qualityErrors.length > 10 ? `\n…and ${qualityErrors.length - 10} more` : ''),
        quality_errors: qualityErrors,
      }, { status: 400 })
    }

    const tmpPrfNo = await generateTmpPrfNo(supabase, branch_name)

    // Number generation depends on movement type:
    //   EXTERNAL (Branch→HO or Hub→HO): challan_no
    //   INTERNAL (Branch→Hub):           issue voucher (stored in internal_no, displayed via challan_no field as voucher)
    let extNo = null, challan = null, internalNo = null
    if (isInternal) {
      const { internalNo: seq, voucher } = await generateIssueVoucherNo(supabase, branchCode, stateCode)
      internalNo = seq
      challan    = voucher  // reuse challan_no column to store the voucher identifier
    } else {
      const ext = await generateExternalNo(supabase, branchCode, stateCode)
      extNo   = ext.extNo
      challan = ext.challan
    }

    // Build per-bill snapshots from the data the quality-validator already loaded
    // (purchaseCheck holds id, bill_no, weights, amount, customer, date).
    const purchasesById = new Map((purchaseCheck || []).map(p => [p.id, p]))
    const itemSnapshots = purchase_ids.map(pid => {
      const p = purchasesById.get(pid) || {}
      return {
        purchase_id:   pid,
        bill_no:       p.bill_no != null ? String(p.bill_no) : null,
        gross_weight:  Number(p.gross_weight ?? 0) || 0,
        net_weight:    Number(p.net_weight   ?? 0) || 0,
        total_amount:  Number(p.total_amount ?? 0) || 0,
        customer_name: p.customer_name || null,
        purchase_date: p.purchase_date ? String(p.purchase_date).slice(0, 10) : null,
      }
    })

    const totalNetWt   = itemSnapshots.reduce((s, i) => s + i.net_weight,   0)
    const totalGrossWt = itemSnapshots.reduce((s, i) => s + i.gross_weight, 0)
    const totalAmount  = itemSnapshots.reduce((s, i) => s + i.total_amount, 0)

    // Status & bill movement depends on movement type:
    //   INTERNAL (Branch → Hub): instantaneous transfer. No receive workflow at hub.
    //     - Consignment status = 'received' immediately
    //     - Bills' current_branch flips to dest_branch (hub) right away
    //     - Bills' stock_status stays 'at_branch' so they're available in hub's stock
    //   EXTERNAL (Direct → HO or Hub → HO): in-transit until received at HO.
    //     - Consignment status = 'dispatched'
    //     - Bills' stock_status flips to 'in_consignment'
    //     - Bills' current_branch unchanged until HO receive
    const nowIso = new Date().toISOString()

    // Snapshot GST rates from company_settings — frozen against retroactive changes.
    // Column names match what's exposed in the Company Settings admin UI.
    const { data: cs } = await supabase.from('company_settings').select('*').single()
    const igstRate = parseFloat(cs?.igst_rate ?? 3) || 3
    const gstSnapshot = {
      igst: igstRate,
      cgst: parseFloat(cs?.cgst_rate ?? (igstRate / 2)) || (igstRate / 2),
      sgst: parseFloat(cs?.sgst_rate ?? (igstRate / 2)) || (igstRate / 2),
      hsn:  cs?.hsn_code || '71131910',
      captured_at: nowIso,
    }

    // Resolve source GSTIN at this moment so the EWB/E-Invoice generated days
    // later still uses the correct number — even if state-wise GSTIN config or
    // branch_gstin is edited afterwards.
    //
    // IMPORTANT: company_settings stores GSTINs keyed by STATE CODE (gstin_ka, gstin_ts, etc.)
    // but branches.state can be the full name ("Telangana") or the code ("TS"). Always
    // resolve through regionToStateCode(branch.region) — that's what lib/clearTaxClient
    // uses for the auth header. Mismatch here was producing NIC error 106
    // ("Supplier GSTIN didn't match user GSTIN").
    const sourceStateCode = regionToStateCode(branchData.region) || branchData.state
    const sourceGstinKey  = sourceStateCode ? `gstin_${String(sourceStateCode).toLowerCase()}` : null
    const sourceGstinSnap = (sourceGstinKey && cs?.[sourceGstinKey]) || branchData.branch_gstin || cs?.gstin || null
    let destGstinSnap = null
    if (isInternal && destData) {
      const destStateCode = regionToStateCode(destData.region) || destData.state
      const destGstinKey  = destStateCode ? `gstin_${String(destStateCode).toLowerCase()}` : null
      destGstinSnap = (destGstinKey && cs?.[destGstinKey]) || destData.branch_gstin || cs?.gstin || null
    }

    // ── Atomic create via Postgres RPC ────────────────────────────────────
    // create_consignment_atomic takes a single JSONB payload — adding new
    // snapshot fields no longer requires a function-signature change. The
    // RPC INSERTS the consignment header, links every purchase via
    // consignment_items (with per-bill snapshot), and writes the audit log
    // in one transaction. Bills' stock_status stays 'at_branch' until
    // accounts approves; that flip lives in approve_consignment below.
    const { data: rpcConsignment, error: rpcErr } = await supabase.rpc('create_consignment_atomic', {
      p_payload: {
        consignment_no:  challan,
        tmp_prf_no:      tmpPrfNo,
        external_no:     extNo,
        internal_no:     internalNo,
        challan_no:      challan,
        branch_name,
        branch_code:     branchCode,
        state_code:      stateCode,
        movement_type:   movement_type || 'EXTERNAL',
        dest_branch:     isInternal ? dest_branch : null,
        eway_bill_no:    eway_bill_no || null,
        total_bills:     purchase_ids.length,
        total_net_wt:    totalNetWt,
        total_gross_wt:  totalGrossWt,
        total_amount:    totalAmount,
        gst_snapshot:    gstSnapshot,
        created_by,
        added_by:        auth.user?.id || null,
        purchase_ids,
        source_address:  branchData.address || null,
        source_city:     branchData.city || null,
        source_pin:      branchData.pin_code || null,
        source_state:    branchData.state || null,
        source_region:   branchData.region || null,
        source_gstin:    sourceGstinSnap,
        dest_address:    isInternal ? (destData?.address || null) : null,
        dest_city:       isInternal ? (destData?.city || null) : null,
        dest_pin:        isInternal ? (destData?.pin_code || null) : null,
        dest_state:      isInternal ? (destData?.state || null) : null,
        dest_region:     isInternal ? (destData?.region || null) : null,
        dest_gstin:      isInternal ? destGstinSnap : null,
        item_snapshots:  itemSnapshots,
      },
    })

    if (rpcErr) {
      // PGRST202 = function not found. Surface a clear message; do NOT
      // fall back to a non-atomic legacy path — the snapshot model
      // requires the RPC's transactional semantics.
      if (rpcErr.code === 'PGRST202') {
        return Response.json({
          error: 'create_consignment_atomic RPC is not deployed. Run sql/consignment_create_cancel_rpcs.sql in Supabase SQL Editor.',
        }, { status: 500 })
      }
      return Response.json({ error: rpcErr.message }, { status: 500 })
    }
    if (!rpcConsignment) {
      return Response.json({ error: 'create_consignment_atomic returned no row' }, { status: 500 })
    }

    // Auto-stamp ops_confirmed_at on creation. The user already confirmed twice
    // during the create flow (the modal review + the 'Yes, create now' dialog) —
    // a third manual click in the workflow strip would be redundant, and the
    // sequential gates downstream still enforce: report → voucher/challan →
    // EWB. Fire-and-forget; failure to stamp doesn't void the creation.
    supabase.from('consignments')
      .update({ ops_confirmed_at: new Date().toISOString(), ops_confirmed_by: auth.user?.id || null })
      .eq('id', rpcConsignment.id)
      .then(() => {})
      .catch(() => {})

    return Response.json({ data: rpcConsignment })
  }

  // ── Dispatch consignment ─────────────────────────────────────────────────
  if (action === 'dispatch') {
    const { id } = body
    const dispatched_by = actorEmail
    // Validate: must be in draft status to dispatch
    const { data: current } = await supabase.from('consignments').select('status').eq('id', id).single()
    if (current?.status !== 'draft') {
      return Response.json({ error: `Cannot dispatch. Consignment is '${current?.status}'; must be 'draft'.` }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('consignments')
      .update({ status: 'dispatched', dispatched_at: new Date().toISOString(), dispatched_by })
      .eq('id', id).select().single()
    return Response.json({ data, error: error?.message })
  }

  // ── Receive consignment ───────────────────────────────────────────────────
  if (action === 'receive') {
    const { id } = body
    const received_by = actorEmail

    const { data: current } = await supabase.from('consignments')
      .select('status, movement_type, dest_branch')
      .eq('id', id).single()
    if (current?.status !== 'dispatched') {
      return Response.json({ error: `Cannot receive. Consignment is '${current?.status}'; must be 'dispatched'.` }, { status: 400 })
    }

    const { data: items } = await supabase
      .from('consignment_items')
      .select('purchase_id')
      .eq('consignment_id', id)
    const purchaseIds = (items || []).map(i => i.purchase_id)

    const nowIsoR = new Date().toISOString()
    const { data, error } = await supabase
      .from('consignments')
      .update({ status: 'received', received_at: nowIsoR, received_by })
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (purchaseIds.length) {
      // INTERNAL (Branch → Hub): bills now live at the hub. Reset to at_branch + update current_branch.
      // EXTERNAL (Branch → HO or Hub → HO): bills land at HO.
      if (current.movement_type === 'INTERNAL' && current.dest_branch) {
        await supabase.from('purchases')
          .update({ stock_status: 'at_branch', current_branch: current.dest_branch })
          .in('id', purchaseIds)
      } else {
        // Stamp purchases.received_at = nowIsoR alongside stock_status='at_ho' so
        // the per-bill 'received at HO' timestamp is queryable from the
        // purchases table directly (parallel to dispatched_at). Avoids a join
        // through consignment_items every time accounts wants the at-HO date.
        await supabase.from('purchases')
          .update({ stock_status: 'at_ho', received_at: nowIsoR })
          .in('id', purchaseIds)
      }
      // Mark each item as received by this user
      await supabase.from('consignment_items')
        .update({ received_at: nowIsoR, received_by_email: received_by })
        .eq('consignment_id', id)
    }

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'received',
      actor_email:    received_by,
      details:        { bills: purchaseIds.length, dest: current.dest_branch || 'HO' },
    })

    return Response.json({ data })
  }

  // ── Accounts approval workflow ───────────────────────────────────────────
  // Operations team generates EWB/IRN; accounts team approves before downloads
  // unlock. The downstream document routes check consignment.approval_status.
  if (action === 'approve_consignment') {
    const { id, note } = body
    const approver_email = actorEmail
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const nowIso = new Date().toISOString()

    // Block approval on dead or already-decided rows. Without these checks,
    // an accidental double-click on the Approve button after a cancel/reject
    // could re-flip the row to 'approved' and silently move bills out of the
    // branch's stock — invisible to the operator until the next stock count.
    const { data: existing, error: ee } = await supabase
      .from('consignments')
      .select('status, approval_status, tmp_prf_no, movement_type, state_code, eway_bill_no, irn')
      .eq('id', id)
      .single()
    if (ee || !existing) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (existing.status === 'cancelled') {
      return Response.json({ error: `${existing.tmp_prf_no} is cancelled. Cannot approve a cancelled consignment.` }, { status: 400 })
    }
    if (existing.approval_status === 'approved') {
      return Response.json({ error: `${existing.tmp_prf_no} is already approved.` }, { status: 400 })
    }
    if (existing.approval_status === 'rejected') {
      return Response.json({ error: `${existing.tmp_prf_no} was already rejected. Cannot re-approve a rejected consignment.` }, { status: 400 })
    }

    // ── Doc-required gate ────────────────────────────────────────────────
    // Approval = goods physically dispatch. Under GST law, the EWB / E-Invoice
    // must exist BEFORE transit, not after. Block approval until the right
    // doc has been generated:
    //   - INTERNAL Branch → Hub        → EWB required
    //   - KA-source EXTERNAL → HO      → EWB required (intrastate own-use)
    //   - Non-KA EXTERNAL → HO         → E-Invoice required (interstate B2B)
    // Reject is intentionally NOT gated — accounts should be able to stop
    // bad submissions without burning an NIC document number.
    const isInternal  = existing.movement_type === 'INTERNAL'
    const isKaSource  = existing.state_code === 'KA'
    const needsEwb    = isInternal || (!isInternal && isKaSource)
    const needsIrn    = !isInternal && !isKaSource
    if (needsEwb && !existing.eway_bill_no) {
      return Response.json({
        error: `Cannot approve ${existing.tmp_prf_no} — generate the E-Way Bill first. Goods cannot move without one.`,
      }, { status: 400 })
    }
    if (needsIrn && !existing.irn) {
      return Response.json({
        error: `Cannot approve ${existing.tmp_prf_no} — generate the E-Invoice first. Interstate dispatch requires an IRN before transit.`,
      }, { status: 400 })
    }

    // Approval is the moment bills physically leave the source branch.
    // Until accounts approves, purchases.stock_status stays 'at_branch' and
    // the bills appear in the source branch's stock. On approve we flip:
    //   - INTERNAL (Branch → Hub): stock_status stays 'at_branch' but
    //     current_branch flips to dest_branch (so the bills appear in the
    //     hub's stock for onward consolidation).
    //   - EXTERNAL (Direct → HO / Hub → HO): stock_status flips to
    //     'in_consignment' (removed from branch stock, in transit to HO).
    const { data, error } = await supabase
      .from('consignments')
      .update({
        approval_status:   'approved',
        approved_at:       nowIso,
        approved_by:       approver_email || null,
        rejection_reason:  null,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Look up linked purchases and flip their state.
    const { data: links } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', id)
    const purchaseIds = (links || []).map(l => l.purchase_id)

    if (purchaseIds.length) {
      const isInternal   = data.movement_type === 'INTERNAL'
      const dispatchedAt = data.dispatched_at || nowIso
      if (isInternal) {
        // INTERNAL Branch → Hub: bills stay 'at_branch' — they just move to a
        // different branch within the network (the hub). DO NOT stamp
        // dispatched_at here: that column tracks at_branch → in_consignment
        // transitions, which only happens on the HO-bound leg. When this hub
        // later issues a Hub → HO consignment, THAT approval stamps
        // dispatched_at correctly through the EXTERNAL branch below.
        await supabase.from('purchases')
          .update({
            stock_status:   'at_branch',
            current_branch: data.dest_branch,
          })
          .in('id', purchaseIds)
      } else {
        // EXTERNAL Branch → HO or Hub → HO: bills enter transit. Stamp
        // dispatched_at as the at_branch → in_consignment transition time.
        await supabase.from('purchases')
          .update({
            stock_status:   'in_consignment',
            dispatched_at:  dispatchedAt,
          })
          .in('id', purchaseIds)
      }
    }

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'approved_by_accounts',
      actor_email:    approver_email,
      details:        { note: note || null, bills_moved: purchaseIds.length },
    })
    return Response.json({ success: true, data })
  }

  if (action === 'reject_approval') {
    const { id, reason } = body
    const approver_email = actorEmail
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    if (!reason) return Response.json({ error: 'Rejection reason is required' }, { status: 400 })

    // Same guards as approve — don't decide a row that's already decided or dead.
    const { data: existing, error: ee } = await supabase
      .from('consignments')
      .select('status, approval_status, tmp_prf_no')
      .eq('id', id)
      .single()
    if (ee || !existing) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (existing.status === 'cancelled') {
      return Response.json({ error: `${existing.tmp_prf_no} is already cancelled.` }, { status: 400 })
    }
    if (existing.approval_status === 'approved') {
      return Response.json({ error: `${existing.tmp_prf_no} was already approved. Cannot reject after approval — use Cancel instead.` }, { status: 400 })
    }
    if (existing.approval_status === 'rejected') {
      return Response.json({ error: `${existing.tmp_prf_no} is already rejected.` }, { status: 400 })
    }

    // Rejection auto-voids the consignment row.
    //
    // Why: there's no "edit and resubmit" UI — once rejected, the only path
    // forward is to create a new consignment with the same (or corrected)
    // bills. If we left the row alive, the bills would stay locked to it
    // (the duplicate-link guard sees status='dispatched' and blocks them
    // from any new consignment). That forced the operator to click Void
    // every single time. So we collapse rejection + void into one action.
    //
    // Audit trail is fully preserved:
    //   - approval_status = 'rejected'  (visible on the Rejected tab)
    //   - rejection_reason = reason     (shown on the row)
    //   - status = 'cancelled'          (row is voided, bills are free)
    //   - cancel_reason = 'Rejected: ...' (cross-references the rejection)
    //   - approved_at = nowIso          (decision timestamp, used for SLA pill)
    //   - approved_by = approver_email  (auditable who decided)
    // Bills don't need reverting — under the new deferred-movement model
    // they never moved on creation.
    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('consignments')
      .update({
        approval_status:   'rejected',
        approved_at:       nowIso,                       // when accounts decided (used for SLA timer)
        approved_by:       approver_email || null,
        rejection_reason:  reason,
        status:            'cancelled',
        cancelled_at:      nowIso,
        cancel_reason:     `Rejected by accounts: ${reason}`,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'rejected_by_accounts',
      actor_email:    approver_email,
      details:        { reason, auto_voided: true },
    })
    return Response.json({ success: true, data })
  }

  // ── Request cancellation (operations side, no role gate) ─────────────────
  // Operations files a cancellation request with a reason. Accounts sees it
  // in Pending Approvals and either approves (which then runs the actual
  // cancel_consignment flow + cancels EWB / IRN on NIC / IRP) or rejects.
  // We don't void anything here — just record the request and audit it.
  if (action === 'request_cancellation') {
    const { id, reason } = body
    if (!id || !reason || !String(reason).trim()) {
      return Response.json({ error: 'Reason is required' }, { status: 400 })
    }

    const { data: c, error: fetchErr } = await supabase
      .from('consignments').select('*').eq('id', id).single()
    if (fetchErr || !c) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (c.status === 'cancelled')          return Response.json({ error: 'Already cancelled' }, { status: 400 })
    if (c.cancellation_requested_at)       return Response.json({ error: 'Cancellation already requested' }, { status: 400 })
    if (c.approval_status === 'rejected')  return Response.json({ error: 'Already rejected — no cancellation needed' }, { status: 400 })

    // EWB / IRN cancel windows are 24h on NIC / IRP. If either window has
    // closed, accounts can no longer cancel them, so the consignment can't
    // be unwound either. Block the request at the door.
    const HOUR_MS  = 3600 * 1000
    const WINDOW   = 24 * HOUR_MS
    const now      = Date.now()
    if (c.eway_bill_no && c.ewb_generated_at) {
      const elapsed = now - new Date(c.ewb_generated_at).getTime()
      if (elapsed >= WINDOW) {
        return Response.json({ error: 'E-Way Bill cancel window has closed (>24h since generation). Cannot cancel this consignment.' }, { status: 400 })
      }
    }
    if (c.irn && c.einvoice_generated_at) {
      const elapsed = now - new Date(c.einvoice_generated_at).getTime()
      if (elapsed >= WINDOW) {
        return Response.json({ error: 'E-Invoice cancel window has closed (>24h since generation). Cannot cancel this consignment.' }, { status: 400 })
      }
    }

    const reqIso = new Date().toISOString()
    const { data: updated, error: updErr } = await supabase
      .from('consignments')
      .update({
        cancellation_requested_at: reqIso,
        cancellation_reason:       String(reason).trim(),
        cancellation_requested_by: actorEmail,
      })
      .eq('id', id)
      .select()
      .single()
    if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'cancellation_requested',
      actor_email:    actorEmail,
      actor_role:     auth.role,
      details:        { reason: String(reason).trim() },
    })

    return Response.json({ data: updated, message: 'Cancellation request sent to accounts.' })
  }

  // ── Approve a pending cancellation request (accounts side) ───────────────
  // Reuses the same atomic cancel RPC as the legacy admin cancel_consignment
  // path so bills + status flip in one transaction. Audit log entry is
  // distinct ('cancellation_approved') so the timeline reads as a two-step
  // approval flow, not a unilateral void.
  if (action === 'approve_cancellation') {
    const { id } = body
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

    const { data: c, error: fetchErr } = await supabase
      .from('consignments').select('*').eq('id', id).single()
    if (fetchErr || !c)              return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!c.cancellation_requested_at) return Response.json({ error: 'No cancellation request on this consignment' }, { status: 400 })
    if (c.status === 'cancelled')    return Response.json({ error: 'Already cancelled' }, { status: 400 })

    // Use the request reason as the cancellation reason on the consignment,
    // prefixed with who approved it so the audit trail is unambiguous.
    const composedReason = `Approved by accounts (${actorEmail}). Operations reason: ${c.cancellation_reason || '—'}`

    // Atomic path: same RPC as the legacy cancel_consignment action.
    const { data: rpcCancelled, error: rpcCancelErr } = await supabase.rpc('cancel_consignment_atomic', {
      p_consignment_id: id,
      p_reason:         composedReason,
      p_cancelled_by:   actorEmail,
    })
    if (rpcCancelErr && rpcCancelErr.code !== 'PGRST202') {
      return Response.json({ error: rpcCancelErr.message }, { status: 400 })
    }
    if (rpcCancelErr) {
      // RPC missing — fall back to manual updates so the request isn't stuck.
      console.warn('[consignments.approve_cancellation] cancel_consignment_atomic RPC missing — using manual fallback.')
      const { data: links } = await supabase.from('consignment_items').select('purchase_id').eq('consignment_id', id)
      const pids = (links || []).map(l => l.purchase_id)
      if (pids.length) {
        await supabase.from('purchases')
          .update({ stock_status: 'at_branch', current_branch: c.branch_name })
          .in('id', pids)
      }
      await supabase.from('consignments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: actorEmail, cancellation_reason_final: composedReason })
        .eq('id', id)
    }

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'cancellation_approved',
      actor_email:    actorEmail,
      actor_role:     auth.role,
      details: {
        operations_reason: c.cancellation_reason,
        requested_by:      c.cancellation_requested_by,
        requested_at:      c.cancellation_requested_at,
      },
    })

    // Surface warnings: EWB / IRN still active on NIC / IRP need to be
    // cancelled separately on the GST portal within their 24h window.
    const warnings = []
    const src    = rpcCancelled || c
    if (src.eway_bill_no) warnings.push(`E-Way Bill ${src.eway_bill_no} is still active. Cancel it on the NIC portal within 24h of generation.`)
    if (src.irn)          warnings.push(`E-Invoice IRN is still active. Cancel it on the IRP portal within 24h of generation.`)

    return Response.json({
      data:     rpcCancelled || { id, status: 'cancelled' },
      message:  'Cancellation approved. Bills returned to source branch.',
      warnings: warnings.length ? warnings : undefined,
    })
  }

  // ── Reject a pending cancellation request (accounts side) ────────────────
  // Clears the request fields and logs the rejection with reason. Bills stay
  // attached — they were never freed by request_cancellation in the first
  // place. Operations sees the row revert to its normal Cancel button.
  if (action === 'reject_cancellation') {
    const { id, reason } = body
    if (!id || !reason || !String(reason).trim()) {
      return Response.json({ error: 'Rejection reason is required' }, { status: 400 })
    }

    const { data: c, error: fetchErr } = await supabase
      .from('consignments').select('id, cancellation_requested_at, cancellation_reason, cancellation_requested_by, status').eq('id', id).single()
    if (fetchErr || !c)                return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!c.cancellation_requested_at)  return Response.json({ error: 'No cancellation request on this consignment' }, { status: 400 })
    if (c.status === 'cancelled')      return Response.json({ error: 'Already cancelled' }, { status: 400 })

    const { error: updErr } = await supabase
      .from('consignments')
      .update({
        cancellation_requested_at: null,
        cancellation_reason:       null,
        cancellation_requested_by: null,
      })
      .eq('id', id)
    if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'cancellation_rejected',
      actor_email:    actorEmail,
      actor_role:     auth.role,
      details: {
        rejection_reason:  String(reason).trim(),
        operations_reason: c.cancellation_reason,
        requested_by:      c.cancellation_requested_by,
        requested_at:      c.cancellation_requested_at,
      },
    })

    return Response.json({ data: { id }, message: 'Cancellation request rejected.' })
  }

  // ── Cancel consignment (reverse flow) ────────────────────────────────────
  // Voids a consignment that was created by mistake. Bills return to source.
  // Blocked if any bill has since been re-consigned in a later movement.
  if (action === 'cancel_consignment') {
    const { id, reason } = body
    const cancelled_by = actorEmail

    // Atomic path via Postgres RPC. Returns bills, flips status, and writes the
    // audit log in one transaction. Falls back to legacy multi-step path if the
    // RPC isn't deployed.
    const { data: rpcCancelled, error: rpcCancelErr } = await supabase.rpc('cancel_consignment_atomic', {
      p_consignment_id: id,
      p_reason:         reason || null,
      p_cancelled_by:   cancelled_by,
    })
    if (!rpcCancelErr && rpcCancelled) {
      // Surface a warning if EWB/IRN was still active, so the operator
      // remembers to cancel them on the GST portal too.
      const warnings = []
      if (rpcCancelled.eway_bill_no) warnings.push(`E-Way Bill ${rpcCancelled.eway_bill_no} is still active. Cancel it on the GST portal as well.`)
      if (rpcCancelled.irn)          warnings.push('The E-Invoice IRN is still active. Cancel it on the GST portal as well.')
      return Response.json({ data: rpcCancelled, warnings: warnings.length ? warnings : undefined })
    }
    if (rpcCancelErr && rpcCancelErr.code !== 'PGRST202') {
      // RPC ran but business rule failed — surface the message verbatim.
      return Response.json({ error: rpcCancelErr.message }, { status: 400 })
    }
    console.warn('[consignments.cancel] cancel_consignment_atomic RPC missing — using non-atomic fallback. Apply sql/consignment_create_cancel_rpcs.sql.')

    const { data: c } = await supabase.from('consignments').select('*').eq('id', id).single()
    if (!c) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (c.status === 'cancelled') return Response.json({ error: 'Already cancelled' }, { status: 400 })
    if (c.status === 'received' && c.movement_type !== 'INTERNAL') {
      return Response.json({ error: 'Cannot cancel. The consignment has already been received at Head Office; initiate a return instead.' }, { status: 400 })
    }

    const { data: links } = await supabase.from('consignment_items').select('purchase_id').eq('consignment_id', id)
    const pids = (links || []).map(l => l.purchase_id)

    // For INTERNAL consignments that auto-marked received: check no bill is in a later
    // consignment (e.g. Hub→HO) before reversing. Reversing under those bills would
    // corrupt the later consignment's stock_status / current_branch.
    if (pids.length && c.movement_type === 'INTERNAL') {
      const { data: laterLinks } = await supabase
        .from('consignment_items')
        .select('purchase_id, consignment:consignment_id(id, status, created_at)')
        .in('purchase_id', pids)
        .neq('consignment_id', id)
      const laterActive = (laterLinks || []).filter(l =>
        l.consignment && l.consignment.status !== 'cancelled' && new Date(l.consignment.created_at) > new Date(c.created_at)
      )
      if (laterActive.length) {
        return Response.json({
          error: `Cannot void. ${laterActive.length} bill(s) are in a later consignment; cancel that one first.`,
        }, { status: 409 })
      }
    }

    // Bills return to source branch — only if they were actually moved
    // (i.e. accounts had approved at some point). Pre-approval consignments
    // never flipped purchase state; nothing to reverse. Clear both transition
    // timestamps so the bill looks like a fresh at_branch row again.
    if (pids.length && c.approval_status === 'approved') {
      await supabase.from('purchases')
        .update({ stock_status: 'at_branch', current_branch: c.branch_name, dispatched_at: null, received_at: null })
        .in('id', pids)
    }

    // If EWB / E-Invoice still active, surface a warning in the activity log so the
    // operator can also cancel them on the GST portal. We don't auto-cancel here
    // because that requires user input (reason code).
    const hadEwb = !!c.eway_bill_no
    const hadIrn = !!c.irn

    const cancelIso = new Date().toISOString()
    await supabase.from('consignments')
      .update({
        status:        'cancelled',
        cancelled_at:  cancelIso,
        cancel_reason: reason || null,
        // Clear received_at — INTERNAL was auto-marked received, but cancellation undoes that
        received_at:   null,
      })
      .eq('id', id)

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'cancelled',
      actor_email:    cancelled_by,
      details:        {
        reason: reason || null,
        bills_returned: pids.length,
        returned_to: c.branch_name,
        active_ewb: hadEwb ? c.eway_bill_no : null,
        active_irn: hadIrn ? c.irn : null,
        warning: (hadEwb || hadIrn) ? 'E-Way Bill or IRN is still active. Cancel it separately on the GST portal.' : null,
      },
    })

    return Response.json({
      success: true,
      warning: (hadEwb || hadIrn) ? 'E-Way Bill or IRN is still active. Cancel it separately within 24 hours.' : null,
    })
  }

  // ── Partial receive — mark specific bills received, others as missing/short ──
  if (action === 'partial_receive') {
    const { id, received_purchase_ids, short_purchase_ids, short_reason } = body
    const received_by = actorEmail
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data: c } = await supabase.from('consignments').select('status, movement_type, dest_branch').eq('id', id).single()
    if (!c) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!['dispatched', 'partial_received'].includes(c.status)) {
      return Response.json({ error: `Cannot receive. Consignment is '${c.status}'.` }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    if ((received_purchase_ids || []).length) {
      await supabase.from('consignment_items')
        .update({ received_at: nowIso, received_by_email: received_by })
        .eq('consignment_id', id).in('purchase_id', received_purchase_ids)
      const newStatus = c.movement_type === 'INTERNAL' ? 'at_branch' : 'at_ho'
      const updates = { stock_status: newStatus }
      if (c.movement_type === 'INTERNAL' && c.dest_branch) updates.current_branch = c.dest_branch
      await supabase.from('purchases').update(updates).in('id', received_purchase_ids)
    }
    if ((short_purchase_ids || []).length) {
      await supabase.from('consignment_items')
        .update({ short_reason: short_reason || 'short' })
        .eq('consignment_id', id).in('purchase_id', short_purchase_ids)
    }

    // Closure rule: a consignment is fully resolved when every item is either
    // received_at IS NOT NULL OR short_reason IS NOT NULL. Pure-pending count
    // is what we check — receive_at null AND short_reason null.
    const { count: pendingCount } = await supabase
      .from('consignment_items')
      .select('purchase_id', { count: 'exact', head: true })
      .eq('consignment_id', id)
      .is('received_at', null)
      .is('short_reason', null)
    const finalStatus = (pendingCount || 0) === 0 ? 'received' : 'partial_received'
    const upd = { status: finalStatus }
    if (finalStatus === 'received') upd.received_at = nowIso
    await supabase.from('consignments').update(upd).eq('id', id)

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     finalStatus === 'received' ? 'received_with_shortage' : 'partial_received',
      actor_email:    received_by,
      details:        { received: (received_purchase_ids || []).length, short: (short_purchase_ids || []).length, short_reason },
    })

    return Response.json({ success: true, status: finalStatus })
  }

  // ── Remove item from consignment ─────────────────────────────────────────
  if (action === 'remove_item') {
    const { consignment_id, purchase_id } = body
    await supabase.from('consignment_items')
      .delete().eq('consignment_id', consignment_id).eq('purchase_id', purchase_id)
    await supabase.from('purchases')
      .update({ stock_status: 'at_branch', dispatched_at: null }).eq('id', purchase_id)

    // Recalculate totals
    const { data: items } = await supabase
      .from('consignment_items')
      .select('purchase:purchase_id(net_weight, total_amount)')
      .eq('consignment_id', consignment_id)

    const totalNetWt  = items?.reduce((s, i) => s + parseFloat(i.purchase?.net_weight || 0), 0) || 0
    const totalAmount = items?.reduce((s, i) => s + parseFloat(i.purchase?.total_amount || 0), 0) || 0
    await supabase.from('consignments')
      .update({ total_bills: items?.length || 0, total_net_wt: totalNetWt, total_amount: totalAmount })
      .eq('id', consignment_id)

    return Response.json({ success: true })
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}