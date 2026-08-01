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
import { applyConsignmentApproval } from '../../../lib/consignmentApproval'
import { fetchInTransitStock } from '../../../lib/consignmentReportData'
import { requireAuth, requireAuthForPage, ROLE_GROUPS, getRegionFilter, resolveAllowedBranchNames } from '../../../lib/apiAuth'
import { istToday, istStartOfDayIso, istEndOfDayIso, addWorkingDaysSkipSunday } from '../../../lib/dateIst'
import { cancelEWayBill, cancelEInvoice } from '../../../lib/clearTaxClient'
import { REGION_TO_STATE_CODE } from '../../../lib/stateMap'
import { sendMail, mailConfigured } from '../../../lib/sendMail'
import { docFilename } from '../../../lib/docFilename'

// Accounts inbox that must manually verify/remove a cancelled EWB / E-Invoice
// from the government portal when ops cancels a fully-documented consignment.
const ACCOUNTS_CANCEL_CC = ['Rudresh.kedia@whitegold.money', 'sunay.kumar@whitegold.money']

// Purchase-date lock helper — returns the subset of `dates` (YYYY-MM-DD) that
// fall inside any active lock range (bidding_purchase_date_locks). Used to block
// booking of locked-date bills in create_booking + attach_selected_to_pipeline.
async function lockedPurchaseDates(sb, dates) {
  const uniq = [...new Set((dates || []).filter(Boolean).map(d => String(d).slice(0, 10)))]
  if (!uniq.length) return []
  const { data: locks } = await sb.from('bidding_purchase_date_locks').select('from_date, to_date')
  if (!locks || !locks.length) return []
  return uniq.filter(d => locks.some(l => d >= l.from_date && d <= l.to_date))
}

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
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // Cron-token bypass — narrow allow-list of read-only actions that the
  // `goldapp-cron` worker can hit server-to-server without a user session.
  // Any new action added here MUST be read-only.
  const cronToken     = req.headers.get('x-cron-token')
  const CRON_ALLOWED  = new Set(['bidding_at_risk_summary'])
  const isCronCaller  = !!process.env.CRON_SECRET
                      && cronToken === process.env.CRON_SECRET
                      && CRON_ALLOWED.has(action)
  let auth
  if (isCronCaller) {
    // Synthesize a minimal auth shape so downstream code that reads
    // auth.user / auth.role doesn't blow up. No region restrictions —
    // cron sees everything.
    auth = { ok: true, user: { id: null, email: 'cron' }, role: 'super_admin', profile: null }
  } else {
    // Any authenticated user can read consignment data; specific actions can
    // tighten further by checking auth.role inline.
    auth = await requireAuth(req, { requiredRoles: null })
    if (!auth.ok) return auth.response
  }

  // Region scoping: resolve once per request. allowedBranches=null means
  // "no restriction" (admin/founders bypass, or user has no allowed_regions).
  // When non-null, it's the explicit list of branch names this user can see;
  // every data action must filter by it. allowedRegions is the same info but
  // expressed as region names — useful when joining via branches.region.
  const allowedRegions  = getRegionFilter(auth)
  const allowedBranches = allowedRegions ? await resolveAllowedBranchNames(supabase, auth) : null

  // ── Purchase-date locks — ranges ops have locked out of booking ──────────
  if (action === 'date_locks') {
    const { data, error } = await supabase
      .from('bidding_purchase_date_locks')
      .select('id, from_date, to_date, note, locked_by, locked_at')
      .order('from_date', { ascending: true })
    if (error) return Response.json({ locks: [], error: error.message })
    return Response.json({ locks: data || [] })
  }

  // ── Branch Stock / In Transit Overview (new landing view) ────────────────
  // Single endpoint serves both lifecycle states via the ?status= param so
  // the dashboard reads at_branch and in_consignment from the same RPC and
  // they stay in lock-step semantically (per-bill counts, oldest = MIN
  // purchase_date, etc.). Defaults to at_branch for backwards-compat.
  // Per-(branch, purchase_date) breakdown for the Branch Stock Overview date
  // chips. Same RPC contract as branch_overview, grouped by purchase_date too.
  if (action === 'branch_overview_dates') {
    const stockStatus = searchParams.get('status') || 'at_branch'
    if (!['at_branch', 'in_consignment'].includes(stockStatus)) {
      return Response.json({ by_branch_date: [], error: `Invalid status '${stockStatus}'.` }, { status: 400 })
    }
    const { data: rows, error } = await supabase.rpc('branch_stock_by_date', { p_stock_status: stockStatus })
    if (error) {
      return Response.json({ by_branch_date: [], error: `branch_stock_by_date RPC missing. Apply sql/branch_stock_by_date_rpc.sql. ${error.message}` })
    }
    let out = rows || []
    if (allowedBranches) { const set = new Set(allowedBranches); out = out.filter(r => set.has(r.branch_name)) }
    return Response.json({
      by_branch_date: out.map(r => ({
        branch_name:  r.branch_name,
        purchase_date: r.purchase_date ? String(r.purchase_date).slice(0, 10) : null,
        bills:        Number(r.bills || 0),
        net_wt:       Number(r.net_wt || 0),
        gross_wt:     Number(r.gross_wt || 0),
        gross_value:  Number(r.gross_value || 0),
      })),
    })
  }

  if (action === 'branch_overview') {
    const stockStatus = searchParams.get('status') || 'at_branch'
    if (!['at_branch', 'in_consignment'].includes(stockStatus)) {
      return Response.json({ data: [], error: `Invalid status '${stockStatus}'. Use 'at_branch' or 'in_consignment'.` }, { status: 400 })
    }

    // Server-side aggregation via RPC — single grouped SQL query handles
    // 24K+ bills in <500ms. RPC must be the parameterised version from
    // sql/branch_stock_summary_rpc.sql.
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('branch_stock_summary', { p_stock_status: stockStatus })

    if (rpcErr) {
      console.warn('[branch_overview] RPC failed:', rpcErr.message)
      return Response.json({ data: [], error: `branch_stock_summary RPC missing or incompatible. Apply sql/branch_stock_summary_rpc.sql. Error: ${rpcErr.message}` })
    }

    // Fetch branch metadata to filter outside_bangalore + attach region/pickup.
    // Region scoping applied here so downstream summary only includes user's branches.
    // is_hub + hub_branch_name come along so the Bangalore tab can group
    // leaves under their hubs.
    let branchesQ = supabase
      .from('branches')
      .select('name, region, state, model_type, pickup_time, pickup_days, is_hub, hub_branch_name')
      .eq('is_active', true)
    if (allowedRegions) branchesQ = branchesQ.in('region', allowedRegions)
    const { data: branches, error: bErr } = await branchesQ
    if (bErr) return Response.json({ data: [], error: bErr.message })

    const branchMeta = {}
    for (const b of branches || []) {
      branchMeta[b.name] = {
        region:          b.region || 'Unknown',
        state:           b.state,
        model_type:      b.model_type,
        pickup_time:     b.pickup_time || null,
        pickup_days:     Array.isArray(b.pickup_days) ? b.pickup_days : null,
        is_hub:          !!b.is_hub,
        hub_branch_name: b.hub_branch_name || null,
      }
    }
    const outsideBranches = new Set(
      (branches || []).filter(b => b.model_type === 'outside_bangalore').map(b => b.name)
    )
    // Dashboard's Consignment Overview wants Bangalore branches in scope too.
    // The RPC handles the time-of-day lifecycle for Bangalore (at_branch
    // before 19:30 IST → in_consignment after 19:30 → at_ho after midnight),
    // so the API just needs to allow Bangalore rows into the response when
    // the caller asks for them.
    const includeBangalore =
      searchParams.get('include_bangalore_today') === 'true'
      || searchParams.get('include_bangalore') === 'true'
    // Same-day-HO membership is the MODEL, not the region — so KA-KOLAR
    // (geographically Rest of Karnataka, but same-day HO) sits in the Bangalore
    // stock tab alongside the city branches. Mirrors the outsideBranches filter
    // above, which already keys off model_type.
    const bangaloreBranches = new Set(
      includeBangalore
        ? (branches || []).filter(b => b.model_type === 'bangalore').map(b => b.name)
        : []
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

    // Pre-populate zero-stock rows so a branch with no bills still appears.
    // Outstation: included by default. Bangalore: only included when the
    // include_bangalore_today flag is set (Dashboard's Consignment Overview).
    const summary = {}
    const populateZeroRow = (branchName) => {
      const meta = branchMeta[branchName] || { region: 'Unknown', model_type: null, pickup_time: null, pickup_days: null, is_hub: false, hub_branch_name: null }
      summary[branchName] = {
        branch_name: branchName, region: meta.region, model_type: meta.model_type, pickup_time: meta.pickup_time,
        pickup_days: meta.pickup_days,
        is_hub:          !!meta.is_hub,
        hub_branch_name: meta.hub_branch_name || null,
        last_moved_at: lastMovedByBranch[branchName] || null,
        total_bills: 0, today_bills: 0, older_bills: 0,
        today_net_wt: 0, older_net_wt: 0,
        today_gross_value: 0, older_gross_value: 0,
        total_gross_wt: 0, total_net_wt: 0, total_gross_value: 0,
        oldest_date: null,
      }
    }
    for (const branchName of outsideBranches)   populateZeroRow(branchName)
    for (const branchName of bangaloreBranches) populateZeroRow(branchName)

    // Merge RPC aggregates into summary. The RPC already applies the
    // Bangalore time-of-day lifecycle (at_branch before 19:30 IST →
    // in_consignment after → at_ho after midnight), so Bangalore rows arrive
    // already filtered — no special transform needed here.
    for (const row of rpcRows || []) {
      const isOutside   = outsideBranches.has(row.branch_name)
      const isBangalore = bangaloreBranches.has(row.branch_name)
      if (!isOutside && !isBangalore) continue
      const s = summary[row.branch_name]
      if (!s) continue
      const totalBills = Number(row.total_bills || 0)
      const todayBills = Number(row.today_bills || 0)
      const totalNet   = parseFloat(row.total_net_wt      || 0)
      const todayNet   = parseFloat(row.today_net_wt      || 0)
      const totalGross = parseFloat(row.total_gross_wt    || 0)
      const totalVal   = parseFloat(row.total_gross_value || 0)
      const todayVal   = parseFloat(row.today_gross_value || 0)

      // Same merge for both outstation and Bangalore now.
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

    // Age counts are IST CALENDAR-day differences (not rolling 24h elapsed), so
    // "Xd" / "Xd ago" always agrees with the IST date shown beside it. A bill
    // dated 04 Jul reads "2d" today (06 Jul) whether it landed at 9am or 9pm.
    const istDateStr = (v) => new Date(new Date(v).getTime() + 5.5 * 3600000).toISOString().slice(0, 10)
    const istToday   = istDateStr(Date.now())
    const calDaysAgo = (v) => Math.round((Date.parse(istToday) - Date.parse(istDateStr(v))) / 86400000)
    const result = Object.values(summary).map(s => {
      const oldestDays    = s.oldest_date   ? calDaysAgo(s.oldest_date)   : 0
      const lastMovedDays = s.last_moved_at ? calDaysAgo(s.last_moved_at) : null
      return { ...s, oldest_age_days: oldestDays, last_moved_days_ago: lastMovedDays }
    }).sort((a, b) => b.total_gross_wt - a.total_gross_wt)

    return Response.json({ data: result })
  }

  // ── Get outside-Bangalore branches from branches master ──────────────────
  if (action === 'branches') {
    // Bangalore branches are intentionally INCLUDED here post-cutover
    // (1 Jun 2026). The pre-cutover .neq('region','Bangalore') filter
    // was a safety from when Bangalore stock bypassed the consignment
    // flow entirely; under the event-driven lifecycle they DO appear in
    // ConsignmentData and the UI needs their region/state to decide
    // EWB vs E-Invoice. Missing them made BOMMANAHALLI → HO render as
    // E-INVOICE PENDING instead of EWB PENDING (region lookup returned
    // undefined → defaulted to interstate → wrong document path).
    let q = supabase
      .from('branches')
      .select('id, name, state, region, cluster, model_type, address, city, pin_code, contact_person, contact_phone, branch_gstin, is_hub, hub_branch_name, pickup_time')
      .eq('is_active', true)
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
      const PICKER_COLS = 'id,branch_name,current_branch,customer_name,application_id,purchase_date,transaction_time,net_weight,total_amount,final_amount_crm,transaction_type,crm_source'

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

  // ── Last destination for a source branch ─────────────────────────────────
  // For the create-consignment screen: when ops opens it for a branch they've
  // shipped from before, default the destination + movement type to whatever
  // they used most recently. Ops can override on the screen — this just
  // saves the typical case (a branch usually consolidates to the same hub).
  //
  // Returns { suggestion: { dest_branch, movement_type, created_at } | null }.
  // null when this branch has no prior consignment in history.
  if (action === 'last_destination_for_branch') {
    const branch = searchParams.get('branch')
    if (!branch) return Response.json({ error: 'branch required' }, { status: 400 })
    const { data, error } = await supabase
      .from('consignments')
      .select('dest_branch, movement_type, created_at, status')
      .eq('branch_name', branch)
      .neq('status', 'cancelled')
      .neq('status', 'seed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!data)  return Response.json({ suggestion: null })
    return Response.json({
      suggestion: {
        dest_branch:   data.dest_branch || null,
        movement_type: data.movement_type || null,
        created_at:    data.created_at,
      },
    })
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

  // ── Portal cleanup pending ────────────────────────────────────────────────
  // Consignments cancelled in GoldApp whose EWB / IRN is STILL LIVE on NIC/IRP —
  // i.e. force-local cancels. Without this queue they are invisible: the row reads
  // "cancelled" here while the government still has an active document against gold
  // that isn't moving. Each row can be retried against NIC from the UI
  // (action=retry_portal_cancel), so accounts never has to go to the portal by hand.
  if (action === 'portal_cleanup_pending') {
    const { data, error } = await supabase
      .from('consignments')
      .select('id, tmp_prf_no, branch_name, dest_branch, movement_type, status, eway_bill_no, ewb_generated_at, irn, einvoice_generated_at, cancelled_at, cancellation_reason_final')
      .eq('status', 'cancelled')
      .or('eway_bill_no.not.is.null,irn.not.is.null')
      .order('cancelled_at', { ascending: false })
    if (error) return Response.json({ data: [], error: error.message })
    const now = Date.now()
    const rows = (data || []).map(c => {
      const ageH = c.ewb_generated_at ? (now - new Date(c.ewb_generated_at).getTime()) / 3600000 : null
      return {
        ...c,
        ewb_age_hours:      ageH != null ? Number(ageH.toFixed(1)) : null,
        // NIC only allows cancellation within 24h of generation. Past that the EWB
        // can ONLY expire — retrying is pointless and we should say so.
        can_cancel_on_nic:  !!c.eway_bill_no && ageH != null && ageH < 24,
        expires_only:       !!c.eway_bill_no && ageH != null && ageH >= 24,
      }
    })
    return Response.json({ data: rows })
  }

  // ── Pending approvals — accounts team queue ────────────────────────────
  // EWB-route consignments (INTERNAL, or KA-source EXTERNAL) are now
  // operations self-service: ops previews/generates the EWB on Consignment
  // Data, which auto-approves. Accounts has no action to take on them, so
  // they're filtered OUT of this action queue (they still appear in the
  // read-only Approved / Rejected / Cancellations / Reports tabs). Only
  // E-Invoice-route consignments (non-KA interstate) still need accounts.
  if (action === 'pending_approvals') {
    const { data, error } = await supabase
      .from('consignments')
      .select('*')
      .eq('approval_status', 'pending')
      .neq('status', 'cancelled')
      .neq('status', 'seed')
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = (data || []).filter(c => {
      const isInternal = c.movement_type === 'INTERNAL'
      const isKaSource = c.state_code === 'KA'
      const needsEwb   = isInternal || isKaSource   // EWB route → ops self-serves
      return !needsEwb
    })
    return Response.json({ data: rows })
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

  // ── Bidding volume: gold expected to be available at HO on a given date ──
  // The bid desk uses this to decide tomorrow morning's price. "Available"
  // means the bill will be at HO by the morning bid (i.e. has arrived
  // overnight). Two contributions:
  //   1. Today's Bangalore purchases — auto-consolidated at 19:30 IST so
  //      they're at HO by tomorrow morning. To view tomorrow's pool we
  //      include Bangalore approved bills purchased today.
  //   2. Outside-Bangalore bills currently in_consignment — for each, the
  //      expected arrival = dispatched_at + branch.delivery_tat_hours.
  //      A 24h-TAT branch dispatched today arrives tomorrow → included
  //      in tomorrow's pool. A 48h-TAT branch dispatched today arrives the
  //      day after → NOT in tomorrow's pool, in day-after-tomorrow's.
  //
  // Query string:
  //   ?action=bidding_volume[&date=YYYY-MM-DD]   — arrival date (IST). Default: tomorrow.
  if (action === 'bidding_volume') {
    const today = istToday()                                              // 'YYYY-MM-DD' IST
    const addDays = (yyyymmdd, n) => {
      const [y, m, d] = yyyymmdd.split('-').map(Number)
      const dt = new Date(Date.UTC(y, m - 1, d + n))
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    }
    // Default arrival = next working day (Sunday skipped — logistics off).
    // So bidding on Saturday targets Monday arrival; bidding on Sunday also
    // targets Monday. If the operator passes ?date= explicitly, honour it.
    const arrivalDate = searchParams.get('date') || addWorkingDaysSkipSunday(today, 1)

    // "Bangalore today" = the most recent working day before arrivalDate.
    // If arrival is Monday (typical on a Saturday bid), the relevant
    // Bangalore purchase day is Saturday — NOT Sunday — because Bangalore
    // branches are closed Sundays. Plain -1 calendar day would land us on
    // Sunday and return zero bills.
    const subWorkingDaySkipSunday = (yyyymmdd) => {
      const [y, m, d] = yyyymmdd.split('-').map(Number)
      const dt = new Date(Date.UTC(y, m - 1, d - 1))
      if (dt.getUTCDay() === 0) dt.setUTCDate(dt.getUTCDate() - 1)   // walk past Sunday
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    }
    const bangalorePurchaseDate = subWorkingDaySkipSunday(arrivalDate)

    // dayAfterArrival should also skip Sunday — if arrival is Friday or
    // Saturday, the next working arrival is Monday, not Sunday.
    const dayAfterArrival  = addWorkingDaysSkipSunday(arrivalDate, 1)
    // +2 working days — the 72h-TAT window (arriving after 2 days).
    const dayAfter2Arrival = addWorkingDaysSkipSunday(arrivalDate, 2)

    // Branch metadata — TAT, region, pickup time, pickup_days, is_hub. We
    // need pickup_days + is_hub now to compute Section 4 (branch-stock-pre-
    // EOD) eligibility: only branches with a still-ahead pickup today, and
    // only Kerala hubs (not leaf branches that already consolidate at hub).
    let branchQ = supabase
      .from('branches')
      .select('name, region, state, model_type, delivery_tat_hours, pickup_time, pickup_days, is_hub, logistics_partner')
      .eq('is_active', true)
    if (allowedRegions) branchQ = branchQ.in('region', allowedRegions)
    const { data: branchRows, error: bErr } = await branchQ
    if (bErr) return Response.json({ error: bErr.message }, { status: 500 })
    const branchMeta = {}
    for (const b of branchRows || []) branchMeta[b.name] = b

    // Booking-volume eligibility keys off the MODEL: same-day-HO branches
    // (bangalore model, incl. KA-KOLAR) never consign, everyone else does.
    const bangaloreBranchNames = (branchRows || []).filter(b => b.model_type === 'bangalore').map(b => b.name)
    const outsideBranchNames   = (branchRows || []).filter(b => b.model_type !== 'bangalore').map(b => b.name)

    // Section 4 eligibility: at_branch bills at non-Bangalore branches whose
    // pickup is STILL AHEAD today, AND whose TAT lets them arrive at HO on
    // the target arrivalDate (i.e. TAT ≤ 24h for default tomorrow-arrival).
    // Kerala restriction: only the hub branches (per ops spec — leaf-branch
    // bills already consolidate at hub before moving to HO).
    const nowIstHHMM = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
    const todayDow   = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' })
    // Section 7 = full branch-pickup-pending view: ALL non-Bangalore branches
    // (Kerala hub-only — leaves consolidate at hub first). Each branch is
    // flagged `pickup_today` so the client can offer a Today / All filter. Note:
    // grandTotal below counts ONLY the pickup-today subset (bid-pool math is
    // unchanged); the extra non-pickup-today branches are display-only.
    const preEodEligibleBranchNames = (branchRows || []).filter(b => {
      if (b.region === 'Bangalore')           return false
      if (b.region === 'Kerala' && !b.is_hub) return false   // Kerala: hub-only
      return true
    }).map(b => b.name)
    // Subset whose pickup is scheduled TODAY. Kerala hubs = daily (always today).
    // pickup_time is NOT a gate (pickups run late; ops keeps seeing the stock).
    const pickupTodaySet = new Set((branchRows || []).filter(b => {
      if (b.region === 'Bangalore') return false
      if (b.region === 'Kerala')    return b.is_hub
      return Array.isArray(b.pickup_days) && b.pickup_days.includes(todayDow)
    }).map(b => b.name))

    // 1) Bangalore — bills purchased on bangalorePurchaseDate, status approved.
    //    Include any stock_status: the time-of-day lifecycle moves them at
    //    19:30 IST so depending on when this endpoint is queried they could
    //    be at_branch, in_consignment, or at_ho. All of them count toward
    //    tomorrow's bid. (Yesterday's stragglers that were attributed to gain
    //    are surfaced separately as bangalore_gain_rebookable below.)
    let bangBills = []
    if (bangaloreBranchNames.length) {
      const { data: bb, error: bbErr } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status, audit_hold, audit_consumed_at')
        .in('branch_name', bangaloreBranchNames)
        .gte('purchase_date', bangalorePurchaseDate)
        .lt('purchase_date',  addDays(bangalorePurchaseDate, 1))
        .eq('crm_status', 'approved')
        .eq('is_deleted', false)
        .is('booking_id', null)
      if (bbErr) return Response.json({ error: bbErr.message }, { status: 500 })
      // Don't surface bills the EOD audit already consumed — they're now
      // labelled gain and shouldn't show as bookable.
      bangBills = (bb || []).filter(b => !b.audit_consumed_at)
    }

    // 2) Outside Bangalore — bills currently in_consignment. Filter to those
    //    whose expected arrival (dispatched_at + branch.delivery_tat_hours)
    //    lands on the target arrivalDate in IST. Done client-side since the
    //    join+date-math is cleaner in JS than embedded in PostgREST filters.
    let inflightBills = []
    if (outsideBranchNames.length) {
      const { data: ib, error: ibErr } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, customer_name, gross_weight, net_weight, total_amount, purchase_date, dispatched_at, stock_status, crm_status')
        .in('branch_name', outsideBranchNames)
        .eq('stock_status', 'in_consignment')
        .eq('is_deleted', false)
        .not('dispatched_at', 'is', null)
        .is('booking_id', null)
      if (ibErr) return Response.json({ error: ibErr.message }, { status: 500 })
      inflightBills = ib || []
    }

    // Compute arrival_date for each in-flight bill using working-day math
    // (skip Sundays — logistics partner is off). Examples:
    //   24h-TAT bill dispatched Sat → Mon arrival (not Sun)
    //   48h-TAT bill dispatched Sat → Tue arrival (Sun skipped within transit)
    // The dispatch IST date is the starting point; we then add ceil(TAT/24)
    // working days to get the arrival IST date.
    const istDateOf = (utcIso) => {
      const d = new Date(new Date(utcIso).getTime() + 5.5 * 3600_000)  // shift to IST
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
    const inflightWithArrival = inflightBills.map(b => {
      const tat = branchMeta[b.branch_name]?.delivery_tat_hours || 24
      const dispatchDate = istDateOf(b.dispatched_at)
      const workDays = Math.max(1, Math.ceil(tat / 24))
      const arrivalIst = addWorkingDaysSkipSunday(dispatchDate, workDays)
      return { ...b, _arrival_date: arrivalIst, _tat_hours: tat }
    })
    const inflight24h = inflightWithArrival.filter(b => b._arrival_date === arrivalDate)
    const inflight48h = inflightWithArrival.filter(b => b._arrival_date === dayAfterArrival)
    const inflight72h = inflightWithArrival.filter(b => b._arrival_date === dayAfter2Arrival)
    // Manually-flagged at_ho bills (purchases.force_pending_booking = true) that
    // ops wants surfaced as pending-booking even though they're already received
    // at HO. Section 5's normal pool is in_consignment only; this pulls in
    // SPECIFIC received-but-unbooked bills WITHOUT widening the rule to the whole
    // at_ho backlog. Appended ONLY to inflightPendingBooking below, so they never
    // touch the forward bid-window math (Sections 2/3) or bid targets.
    let forcePending = []
    if (outsideBranchNames.length) {
      const { data: fp, error: fpErr } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, customer_name, gross_weight, net_weight, total_amount, purchase_date, dispatched_at, stock_status, crm_status')
        .in('branch_name', outsideBranchNames)
        .eq('stock_status', 'at_ho')
        .eq('force_pending_booking', true)
        .eq('is_deleted', false)
        .is('booking_id', null)
      if (fpErr) return Response.json({ error: fpErr.message }, { status: 500 })
      forcePending = (fp || []).map(b => {
        const tat = branchMeta[b.branch_name]?.delivery_tat_hours || 24
        const dispatchDate = b.dispatched_at ? istDateOf(b.dispatched_at) : null
        const arrivalIst = dispatchDate ? addWorkingDaysSkipSunday(dispatchDate, Math.max(1, Math.ceil(tat / 24))) : null
        return { ...b, _arrival_date: arrivalIst, _tat_hours: tat }
      })
    }

    // Consignment created · booking pending — in_consignment + unbooked bills
    // whose computed arrival is NEITHER tomorrow (Section 2 main) NOR the day
    // after (Section 3). These are consignments already dispatched that fell
    // outside the forward bid windows: arrival already passed (stuck, never
    // received) or held back to book later. Ops created the movement but
    // never attached a booking. PLUS the manually-flagged at_ho bills above.
    // Surfaced as a flagged, still-bookable sub-group. Non-Kerala only —
    // the KL tab has its own movement sections.
    const inflightPendingBooking = [
      ...inflightWithArrival.filter(b =>
        b._arrival_date !== arrivalDate &&
        b._arrival_date !== dayAfterArrival &&
        b._arrival_date !== dayAfter2Arrival &&
        (branchMeta[b.branch_name]?.region) !== 'Kerala',
      ),
      ...forcePending.filter(b => (branchMeta[b.branch_name]?.region) !== 'Kerala'),
    ]

    // Bangalore counterpart — Bangalore bills currently in_consignment with
    // no booking attached, EXCLUDING those already surfaced in Section 1
    // (today's Bangalore pool, by id). What's left is older Bangalore
    // consignments still in transit and never booked — created and
    // forgotten, or stuck un-received. Rendered as a consolidated,
    // drill-down sub-group inside Section 1 (Bangalore's own section).
    let bangalorePendingBooking = []
    if (bangaloreBranchNames.length) {
      const section1Ids = new Set(bangBills.map(b => b.id))
      const { data: bpb } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, dispatched_at, stock_status, crm_status, audit_consumed_at')
        .in('branch_name', bangaloreBranchNames)
        .eq('stock_status', 'in_consignment')
        .eq('crm_status', 'approved')
        .eq('is_deleted', false)
        .is('booking_id', null)
      bangalorePendingBooking = (bpb || [])
        .filter(b => !b.audit_consumed_at && !section1Ids.has(b.id))
        // Keep the ORIGIN branch. branch_name gets re-keyed to the owning branch so the
        // bill groups under the hub it was transferred INTO — which silently hides where
        // the gold actually came from. Ops needs that on the bill row.
        .map(b => ({ ...b, _origin_branch: b.branch_name, branch_name: b.current_branch || b.branch_name }))
    }

    // Bangalore bills the EOD audit already attributed to GAIN that ops may want
    // to LATE-BOOK to a customer. Surfaced as a separate, clearly-labelled,
    // selectable group — NOT folded into the Section 1 totals, so it never
    // double-counts against gain. Booking one reverses the gain attribution (see
    // create_booking, which clears audit_consumed_at/audit_attributed_to).
    // Scoped to the previous working day onward (today's aren't consumed yet).
    let bangaloreGainRebookable = []
    if (bangaloreBranchNames.length) {
      const { data: gbr } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, crm_status, audit_attributed_to')
        .in('branch_name', bangaloreBranchNames)
        .eq('crm_status', 'approved')
        .eq('is_deleted', false)
        .is('booking_id', null)
        .eq('audit_attributed_to', 'gain')
        .gte('purchase_date', subWorkingDaySkipSunday(bangalorePurchaseDate))
        .lt('purchase_date',  addDays(bangalorePurchaseDate, 1))
      bangaloreGainRebookable = (gbr || [])
        // Keep the ORIGIN branch. branch_name gets re-keyed to the owning branch so the
        // bill groups under the hub it was transferred INTO — which silently hides where
        // the gold actually came from. Ops needs that on the bill row.
        .map(b => ({ ...b, _origin_branch: b.branch_name, branch_name: b.current_branch || b.branch_name }))
    }

    // Back-compat alias for the existing UI (renders only the 24h bucket).
    const inflightForTarget = inflight24h

    // 4) Branch-stock pre-EOD — at_branch bills at eligible branches (defined
    //    above). Picked up later today, arrives at HO tomorrow → bookable.
    //
    // Kerala hubs (Vennala / Thrissur) accept transferred-in bills from leaf
    // branches — those have purchases.current_branch = <hub_name> but
    // purchases.branch_name = <original leaf>. We want them counted at the
    // hub, so filter by current_branch when it's set, fall back to
    // branch_name when it's null (the common case for un-transferred bills
    // at non-Kerala branches).
    //
    // POST-DISPATCH EXCLUSION: once a branch has already created a non-cancelled
    // consignment today, any NEW at_branch bills there are for tomorrow's
    // dispatch — not today's — so the branch is hidden from section 4 for the
    // remainder of the day. This prevents double-booking: yesterday a branch
    // could have a consignment dispatched at 4:30 PM and a new purchase land
    // at 5 PM, and section 4 would still surface that bill as "pickup-pending
    // today" even though logically it belongs to tomorrow's bid.
    let postDispatchedBranches = new Set()
    if (preEodEligibleBranchNames.length) {
      const { data: todaysDispatches } = await supabase
        .from('consignments')
        .select('branch_name')
        .gte('created_at', `${bangalorePurchaseDate}T00:00:00+05:30`)
        .lte('created_at', `${bangalorePurchaseDate}T23:59:59+05:30`)
        .neq('status', 'cancelled')
        .in('branch_name', preEodEligibleBranchNames)
      postDispatchedBranches = new Set((todaysDispatches || []).map(c => c.branch_name))
    }
    const preEodEligibleAfterDispatch = preEodEligibleBranchNames.filter(n => !postDispatchedBranches.has(n))

    let preEodBills = []
    if (preEodEligibleAfterDispatch.length) {
      const list = preEodEligibleAfterDispatch.map(n => `"${n}"`).join(',')
      const { data: pb, error: pbErr } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
        .or(`current_branch.in.(${list}),and(current_branch.is.null,branch_name.in.(${list}))`)
        .eq('stock_status', 'at_branch')
        .eq('crm_status',   'approved')
        .eq('is_deleted',   false)
        .is('booking_id',   null)
      if (pbErr) return Response.json({ error: pbErr.message }, { status: 500 })
      // Re-key each bill to the effective owner branch so groupByBranch puts
      // transferred bills under the receiving hub, not the original source.
      // Also re-check the post-dispatch set against the resolved owner — a
      // bill at a leaf branch transferred to a hub that has already dispatched
      // today must be excluded the same way.
      preEodBills = (pb || [])
        .map(b => {
          const owner = b.current_branch || b.branch_name
          const tat   = branchMeta[owner]?.delivery_tat_hours ?? branchMeta[b.branch_name]?.delivery_tat_hours ?? null
          // _origin_branch = where the gold actually came from. branch_name is re-keyed
          // to the owning branch so the bill groups under the hub it was transferred
          // INTO, which otherwise hides its origin from ops entirely.
          return { ...b, _origin_branch: b.branch_name, branch_name: owner, _tat_hours: tat }
        })
        .filter(b => !postDispatchedBranches.has(b.branch_name))
    }

    // 4b) Already-dispatched-today stock — the at_branch bills we just excluded
    //     because their branch already fired a consignment today. Not bookable
    //     (they belong to tomorrow's cycle), but ops wants them VISIBLE as a
    //     read-only band at the bottom of Section 7 so the branch's leftover
    //     stock isn't invisible. Same query as preEodBills, but for the
    //     post-dispatched branches only.
    let dispatchedTodayBills = []
    if (postDispatchedBranches.size) {
      const dlist = [...postDispatchedBranches].map(n => `"${n}"`).join(',')
      const { data: db } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
        .or(`current_branch.in.(${dlist}),and(current_branch.is.null,branch_name.in.(${dlist}))`)
        .eq('stock_status', 'at_branch')
        .eq('crm_status',   'approved')
        .eq('is_deleted',   false)
        .is('booking_id',   null)
      dispatchedTodayBills = (db || [])
        .map(b => {
          const owner = b.current_branch || b.branch_name
          const tat   = branchMeta[owner]?.delivery_tat_hours ?? branchMeta[b.branch_name]?.delivery_tat_hours ?? null
          return { ...b, _origin_branch: b.branch_name, branch_name: owner, _tat_hours: tat }
        })
        .filter(b => postDispatchedBranches.has(b.branch_name))
    }

    // 5) Booked Pending Dispatch — at_branch bills that are already attached
    //    to a booking (booking_id IS NOT NULL). These are "promises without
    //    delivery in motion" — a booking row commits this weight to a buyer,
    //    but the bill itself is still sitting at the branch. Surfaces
    //    stalled bookings that need either a consignment kicked off or the
    //    booking released. View-only on the picker — not part of any
    //    bookable total (the booking already counts it).
    //
    //    NOT scoped by today's arrival window — a stalled booking is a
    //    stalled booking regardless of which day it was supposed to arrive
    //    on. The whole point is to surface ones that have lingered.
    //
    //    Partitioned by region so the KA·AP·TS tab and the KL tab can each
    //    show their own slice.
    let bookedPendingBills = []
    const allBookableBranchNames = (branchRows || []).map(b => b.name)
    if (allBookableBranchNames.length) {
      const { data: bp, error: bpErr } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status, booking_id, booked_at')
        .in('branch_name', allBookableBranchNames)
        .eq('stock_status', 'at_branch')
        .eq('crm_status',   'approved')
        .eq('is_deleted',   false)
        .not('booking_id',  'is', null)
      if (bpErr) return Response.json({ error: bpErr.message }, { status: 500 })
      bookedPendingBills = (bp || []).map(b => ({ ...b, _origin_branch: b.branch_name, branch_name: b.current_branch || b.branch_name }))
    }

    // Booking metadata join — fetch the cal_quotas row each bill is attached
    // to so the UI can show "booked for [party] · by [user] · created [ts]".
    // bookedPendingBills.booked_at (already in the select above) covers WHEN
    // the bill was attached to the booking; party + created_by + created_at
    // come from cal_quotas. created_by is a uuid (auth.users.id) on prod —
    // we resolve it to email/full_name via user_profiles so the UI doesn't
    // show a raw UUID. Some legacy rows still have created_by stored as an
    // email TEXT (the TEXT-schema fallback path in create_booking); those
    // get passed through unchanged.
    if (bookedPendingBills.length) {
      const bookingIds = [...new Set(bookedPendingBills.map(b => b.booking_id).filter(Boolean))]
      if (bookingIds.length) {
        const { data: qrs } = await supabase
          .from('cal_quotas')
          .select('id, party, created_at, created_by')
          .in('id', bookingIds)

        // Collect unique creator IDs that LOOK like UUIDs and resolve them
        // in a single batched query. Anything that doesn't look like a UUID
        // (e.g. already-an-email legacy rows) is left alone.
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        const uuidIds = [...new Set((qrs || [])
          .map(q => q.created_by)
          .filter(v => typeof v === 'string' && UUID_RE.test(v)))]
        let userMap = {}
        if (uuidIds.length) {
          const { data: users } = await supabase
            .from('user_profiles')
            .select('id, email, full_name')
            .in('id', uuidIds)
          userMap = Object.fromEntries((users || []).map(u => [u.id, u.full_name || u.email || u.id]))
        }
        const resolveCreator = (v) => {
          if (!v) return null
          if (typeof v === 'string' && UUID_RE.test(v)) return userMap[v] || v
          return v
        }

        const qMeta = Object.fromEntries((qrs || []).map(q => [q.id, q]))
        bookedPendingBills = bookedPendingBills.map(b => {
          const q = qMeta[b.booking_id] || {}
          return {
            ...b,
            _booking_party:      q.party      || null,
            _booking_created_at: q.created_at || null,
            _booking_created_by: resolveCreator(q.created_by),
          }
        })
      }
    }

    const bookedNonKlBills = bookedPendingBills.filter(b => (branchMeta[b.branch_name]?.region) !== 'Kerala')
    const bookedKlBills    = bookedPendingBills.filter(b => (branchMeta[b.branch_name]?.region) === 'Kerala')

    // Group by branch for the per-branch breakdown card.
    const groupByBranch = (bills) => {
      const m = {}
      for (const b of bills) {
        const key = b.branch_name
        if (!m[key]) {
          const meta = branchMeta[key] || {}
          m[key] = {
            branch_name:   key,
            region:        meta.region || 'Unknown',
            tat_hours:     meta.delivery_tat_hours || null,
            pickup_time:   meta.pickup_time || null,
            pickup_days:   Array.isArray(meta.pickup_days) ? meta.pickup_days : null,
            partner:       meta.logistics_partner || null,
            bills:         [],
            total_bills:   0,
            total_gross_wt: 0,
            total_net_wt:  0,
            total_amount:  0,
          }
        }
        const row = m[key]
        row.bills.push(b)
        row.total_bills    += 1
        row.total_gross_wt += Number(b.gross_weight || 0)
        row.total_net_wt   += Number(b.net_weight   || 0)
        row.total_amount   += Number(b.total_amount || 0)
      }
      return Object.values(m).sort((a, b) => b.total_net_wt - a.total_net_wt)
    }

    // Pending-booking bills (both outstation Section-2 and Bangalore
    // Section-1 sub-groups) carry their parent consignment's creation
    // stamp (when + by whom) so each row can show 'created <date> by
    // <who>' — the whole point being to chase down who dispatched a
    // consignment and never booked it. Resolved via consignment_items →
    // consignments (most recent non-cancelled link per bill). created_by
    // is stored as an email on consignments.
    const stampConsignmentMeta = async (bills) => {
      if (!bills.length) return
      const ids = bills.map(b => b.id)
      const linkByBill = {}   // purchase_id → { created_at, created_by }
      const IN_CHUNK = 100
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const slice = ids.slice(i, i + IN_CHUNK)
        const { data: links } = await supabase
          .from('consignment_items')
          .select('purchase_id, consignment:consignment_id(created_at, created_by, status)')
          .in('purchase_id', slice)
        for (const l of links || []) {
          const c = l.consignment
          if (!c || c.status === 'cancelled') continue
          const prev = linkByBill[l.purchase_id]
          if (!prev || new Date(c.created_at) > new Date(prev.created_at)) {
            linkByBill[l.purchase_id] = { created_at: c.created_at, created_by: c.created_by }
          }
        }
      }
      for (const b of bills) {
        const meta = linkByBill[b.id]
        b._consignment_created_at = meta?.created_at || null
        b._consignment_created_by = meta?.created_by || null
      }
    }
    await stampConsignmentMeta(inflightPendingBooking)
    await stampConsignmentMeta(bangalorePendingBooking)
    // Transit tiers (Sections 2/3/4) — stamp so each branch row can show its
    // consignment-created date next to the TAT chip. inflight24h/48h/72h are
    // filtered views of inflightWithArrival (same object refs), so stamping the
    // parent here — before groupByBranch snapshots the bills — covers all three.
    await stampConsignmentMeta(inflightWithArrival)

    // Annotate each pending-booking branch row with the consignment-creation
    // summary (earliest/latest stamp + unique creators) so the collapsed
    // row reads 'created <date> by <who>' without expanding.
    const annotateConsignmentMeta = (rows) => rows.map(b => {
      const bills    = b.bills || []
      const stamps   = bills.map(x => x._consignment_created_at).filter(Boolean).sort()
      const creators = [...new Set(bills.map(x => x._consignment_created_by).filter(Boolean))]
      return {
        ...b,
        _consignment_earliest: stamps[0]                 || null,
        _consignment_latest:   stamps[stamps.length - 1] || null,
        _consignment_creators: creators,
      }
    })

    const bangaloreByBranch  = groupByBranch(bangBills)
    const transit24hByBranch = groupByBranch(inflight24h)
    const transit48hByBranch = groupByBranch(inflight48h)
    const transit72hByBranch = groupByBranch(inflight72h)
    const pendingBookingByBranch     = annotateConsignmentMeta(groupByBranch(inflightPendingBooking))
    const bangPendingBookingByBranch = annotateConsignmentMeta(groupByBranch(bangalorePendingBooking))
    const bangGainRebookableByBranch = groupByBranch(bangaloreGainRebookable)
    const preEodByBranch     = groupByBranch(preEodBills)
    const dispatchedTodayByBranch = groupByBranch(dispatchedTodayBills)
    // Flag whether each branch's pickup is today (Today/All client filter).
    for (const b of preEodByBranch) b.pickup_today = pickupTodaySet.has(b.branch_name)

    // For booked-pending: also fold in branch-level booking summaries
    // (earliest + latest booked_at, unique parties, unique created_by) so
    // the collapsed branch row can show "when + by whom" at a glance,
    // without the operator needing to expand into the bill list.
    const annotateBookingMeta = (rows) => rows.map(b => {
      const bills   = b.bills || []
      const parties = [...new Set(bills.map(x => x._booking_party).filter(Boolean))]
      const users   = [...new Set(bills.map(x => x._booking_created_by).filter(Boolean))]
      const ts      = bills.map(x => x.booked_at).filter(Boolean).sort()
      return {
        ...b,
        _booking_parties:  parties,
        _booking_users:    users,
        _booking_earliest: ts[0]               || null,
        _booking_latest:   ts[ts.length - 1]   || null,
      }
    })
    const bookedNonKlByBranch = annotateBookingMeta(groupByBranch(bookedNonKlBills))
    const bookedKlByBranch    = annotateBookingMeta(groupByBranch(bookedKlBills))
    // Back-compat alias: the older UI reads supply.in_transit and expects
    // the bookable-tomorrow bucket. Keep it pointing at the 24h transit.
    const inflightByBranch   = transit24hByBranch

    // ── Per-section "already booked" tally ──────────────────────────────────
    // The selectable lists above are unbooked-only (booking_id IS NULL). For
    // the per-section hero cards ops asked for, Total = booked + unbooked, so
    // we also need the BOOKED net weight that falls in each section's window.
    // One query, bucketed in JS to mirror the unbooked bucketing exactly.
    let bookedWindowBills = []
    if (allBookableBranchNames.length) {
      // Paginate — without a range, this caps at Supabase max_rows (1000) and
      // would silently undercount booked stock in the transit/pre-EOD tallies
      // once enough bills are booked.
      const CHUNK = 1000
      let from = 0
      while (true) {
        const { data: bw, error: bwErr } = await supabase
          .from('purchases')
          .select('id, application_id, customer_name, branch_name, current_branch, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
          .in('branch_name', allBookableBranchNames)
          .eq('crm_status', 'approved')
          .eq('is_deleted', false)
          .not('booking_id', 'is', null)
          // Only in_consignment + at_branch are ever bucketed below (bookedInflight
          // / bookedPreEod). Excluding at_ho keeps this from paginating the entire
          // booked-and-received backlog (e.g. the 68k pre-GoldApp historical-close
          // bills) on every load — that was making bidding_volume crawl.
          .in('stock_status', ['in_consignment', 'at_branch'])
          .range(from, from + CHUNK - 1)
        if (bwErr || !bw?.length) break
        bookedWindowBills.push(...bw.map(b => ({ ...b, _owner: b.current_branch || b.branch_name })))
        if (bw.length < CHUNK) break
        from += CHUNK
      }
    }
    const sumNet = (bills) => ({
      bills:  bills.length,
      net_wt: bills.reduce((s, b) => s + Number(b.net_weight || 0), 0),
    })
    // Section 1 (Bangalore today): booked Bangalore purchases in today's window.
    // Query SERVER-SIDE (mirroring the unbooked bangBills query) rather than
    // JS-comparing purchase_date — purchase_date is a timestamptz, so the IST
    // day comes back as the prior UTC date and a JS string compare against
    // 'YYYY-MM-DD' silently dropped every bill (Booked Net always read 0).
    let bookedBang = []
    if (bangaloreBranchNames.length) {
      const { data: bbk } = await supabase
        .from('purchases')
        .select('id, application_id, customer_name, branch_name, current_branch, gross_weight, net_weight, total_amount, purchase_date, stock_status')
        .in('branch_name', bangaloreBranchNames)
        .gte('purchase_date', bangalorePurchaseDate)
        .lt('purchase_date',  addDays(bangalorePurchaseDate, 1))
        .eq('crm_status', 'approved')
        .eq('is_deleted', false)
        .not('booking_id', 'is', null)
      bookedBang = bbk || []
    }
    // Sections 2/3/4 (transit): booked in_consignment bills bucketed by arrival.
    const bookedInflight = bookedWindowBills
      .filter(b => b.stock_status === 'in_consignment' && b.dispatched_at && outsideBranchNames.includes(b.branch_name))
      .map(b => {
        const tat = branchMeta[b.branch_name]?.delivery_tat_hours || 24
        const arrivalIst = addWorkingDaysSkipSunday(istDateOf(b.dispatched_at), Math.max(1, Math.ceil(tat / 24)))
        return { ...b, _arrival_date: arrivalIst }
      })
    const bookedT24 = bookedInflight.filter(b => b._arrival_date === arrivalDate)
    const bookedT48 = bookedInflight.filter(b => b._arrival_date === dayAfterArrival)
    const bookedT72 = bookedInflight.filter(b => b._arrival_date === dayAfter2Arrival)
    // Stamp the ALREADY-BOOKED transit bills too, so their booked rows can show
    // the consignment-created date. bookedT24/48/72 are filtered views of
    // bookedInflight (same refs), so stamping the parent before bookedSection.
    await stampConsignmentMeta(bookedInflight)
    // Section 7 (branch pre-EOD): booked at_branch bills at the eligible branches.
    const preEodOwnerSet = new Set(preEodEligibleAfterDispatch)
    const bookedPreEod = bookedWindowBills.filter(b => b.stock_status === 'at_branch' && preEodOwnerSet.has(b._owner))
    // Booked bills grouped by branch — so each section can render an
    // "Already booked" read-only band (booked bills stay visible; they don't
    // vanish just because they left the unbooked picker list).
    const bookedSection = (bills, useOwner) => {
      const branches = groupByBranch(useOwner ? bills.map(b => ({ ...b, branch_name: b._owner })) : bills)
      return { ...sumNet(bills), branches }
    }

    // Section totals + grand total.
    const sumOf = (rows) => rows.reduce((a, r) => ({
      bills:    a.bills    + r.total_bills,
      gross_wt: a.gross_wt + r.total_gross_wt,
      net_wt:   a.net_wt   + r.total_net_wt,
      amount:   a.amount   + r.total_amount,
    }), { bills: 0, gross_wt: 0, net_wt: 0, amount: 0 })

    const bangTotal         = sumOf(bangaloreByBranch)
    const transit24hTotal   = sumOf(transit24hByBranch)
    const transit48hTotal   = sumOf(transit48hByBranch)
    const transit72hTotal   = sumOf(transit72hByBranch)
    const pendingBookingTotal     = sumOf(pendingBookingByBranch)
    const bangPendingBookingTotal = sumOf(bangPendingBookingByBranch)
    const bangGainRebookableTotal = sumOf(bangGainRebookableByBranch)
    const preEodTotal       = sumOf(preEodByBranch)   // full set (section baseline = All view)
    // grandTotal (bid-pool math) counts ONLY the pickup-today subset — unchanged.
    const preEodTotalToday  = sumOf(preEodByBranch.filter(b => b.pickup_today))
    const bookedNonKlTotal  = sumOf(bookedNonKlByBranch)
    const bookedKlTotal     = sumOf(bookedKlByBranch)
    // Bookable pool = sections that can actually arrive at HO on arrivalDate.
    // Section 3 (transit_48h) is informational only — excluded from grandTotal.
    const grandTotal = {
      bills:    bangTotal.bills    + transit24hTotal.bills    + preEodTotalToday.bills,
      gross_wt: bangTotal.gross_wt + transit24hTotal.gross_wt + preEodTotalToday.gross_wt,
      net_wt:   bangTotal.net_wt   + transit24hTotal.net_wt   + preEodTotalToday.net_wt,
      amount:   bangTotal.amount   + transit24hTotal.amount   + preEodTotalToday.amount,
    }
    // Back-compat alias for the existing UI (which reads `in_transit.total`).
    const inflightTotal = transit24hTotal

    // Pending Delivery — shared signed carry-over for this arrival date.
    // maybeSingle() so a date with no row just yields 0 (the common case).
    const { data: pendingRow } = await supabase
      .from('bidding_pending_delivery')
      .select('pending_grams, note, updated_at, updated_by')
      .eq('arrival_date', arrivalDate)
      .maybeSingle()

    // Diagnostic snapshot — surfaces *why* Section 4 contains what it
    // contains. Helps ops debug "hub X isn't showing up" without needing
    // a DB shell: if the hub appears in eligible_branches but NOT in the
    // branches with bills, it's a stock-status issue (no at_branch bills
    // currently at the hub); if it's missing from eligible_branches, the
    // branch metadata is wrong (is_hub flag, region, etc.).
    const preEodKeralaHubsEligible = (branchRows || [])
      .filter(b => b.region === 'Kerala' && b.is_hub)
      .map(b => b.name)
    const preEodBranchesWithBills = preEodByBranch.map(b => b.branch_name)
    const debugSection4 = {
      eligible_branches:        preEodEligibleBranchNames,
      eligible_kerala_hubs:     preEodKeralaHubsEligible,
      branches_with_at_branch_bills: preEodBranchesWithBills,
      post_dispatched_today:    [...postDispatchedBranches],
      eligible_after_dispatch:  preEodEligibleAfterDispatch,
      now_ist_hhmm: nowIstHHMM,
      today_dow:    todayDow,
    }

    // ── Kerala bid-desk sections ──────────────────────────────────────────────
    // The KL tab on Bidding Volume reads its own taxonomy (S1/S2/S3) instead
    // of the Bangalore-flavoured one above. Same underlying tables, just
    // grouped by where in the Kerala leaf → hub → HO flow each bill sits.
    //
    //   S1 · Hub Stock   — at_branch at a Kerala hub, ready for hub→HO dispatch.
    //   S2 · In Movement — in_consignment on an INTERNAL run, dest = a Kerala hub.
    //                      Includes both already-dispatched and still-pending
    //                      INTERNAL runs (status NOT IN cancelled/received/seed).
    //   S3 · At Leaf     — at_branch at a Kerala leaf branch, dispatch yet to fire.
    //
    // S1 and S2 form the "certain pool" auto-selected by Remaining. S3 is
    // contingent on the leaf→hub pickup actually running today, so the picker
    // surfaces it but auto-select skips it (operator ticks manually).
    const klHubNames   = (branchRows || []).filter(b => b.region === 'Kerala' &&  b.is_hub).map(b => b.name)
    const klLeafNames  = (branchRows || []).filter(b => b.region === 'Kerala' && !b.is_hub).map(b => b.name)

    const allKlNames = [...klHubNames, ...klLeafNames]

    // S1 — bills physically AT a Kerala hub (at_branch, unbooked), split by
    // ORIGIN: hub-origin (the hub's own purchases) vs received-from-leaf (leaf
    // bills already transferred in and now sitting at the hub). Both belong to
    // tonight's hub→HO pool; surfaced as distinct sub-groups so a leaf bill that
    // has reached the hub is never hidden, while its origin stays visible.
    let klS1HubOrigin = []   // branch_name = hub
    let klS1FromLeaf  = []   // branch_name = leaf, current_branch = hub
    if (klHubNames.length) {
      const list = klHubNames.map(n => `"${n}"`).join(',')
      const { data: s1, error: s1Err } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
        .or(`current_branch.in.(${list}),and(current_branch.is.null,branch_name.in.(${list}))`)
        .eq('stock_status', 'at_branch')
        .eq('crm_status',   'approved')
        .eq('is_deleted',   false)
        .is('booking_id',   null)
      if (s1Err) return Response.json({ error: s1Err.message }, { status: 500 })
      const hubSet = new Set(klHubNames)
      for (const b of s1 || []) {
        if (hubSet.has(b.branch_name)) klS1HubOrigin.push({ ...b })
        else klS1FromLeaf.push({ ...b, _at_hub: b.current_branch })  // group under origin leaf, tag hub
      }
    }

    // S2 — bills sitting on an active INTERNAL consignment whose destination
    // is one of the Kerala hubs. Three-step fetch: consignments → items →
    // purchases (keeps the join out of PostgREST land where it's flaky).
    let klS2Bills = []
    let klS2BillToConsignment = {}   // purchase_id → { consignment_id, source_branch, created_at }
    if (klHubNames.length) {
      const { data: activeIntConsignments, error: cErr } = await supabase
        .from('consignments')
        .select('id, branch_name, created_at, status, dest_branch')
        .eq('movement_type', 'INTERNAL')
        .in('dest_branch', klHubNames)
        .not('status', 'in', '("cancelled","received","seed","completed")')
      if (cErr) return Response.json({ error: cErr.message }, { status: 500 })

      const cIds  = (activeIntConsignments || []).map(c => c.id)
      const cMeta = Object.fromEntries((activeIntConsignments || []).map(c => [c.id, c]))

      if (cIds.length) {
        const { data: items, error: iErr } = await supabase
          .from('consignment_items')
          .select('purchase_id, consignment_id')
          .in('consignment_id', cIds)
        if (iErr) return Response.json({ error: iErr.message }, { status: 500 })

        const pIds = []
        for (const it of items || []) {
          pIds.push(it.purchase_id)
          klS2BillToConsignment[it.purchase_id] = {
            consignment_id: it.consignment_id,
            source_branch:  cMeta[it.consignment_id]?.branch_name || null,
            dest_branch:    cMeta[it.consignment_id]?.dest_branch || null,
            created_at:     cMeta[it.consignment_id]?.created_at  || null,
          }
        }
        if (pIds.length) {
          const { data: s2, error: s2Err } = await supabase
            .from('purchases')
            .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
            .in('id', pIds)
            .eq('crm_status', 'approved')
            .eq('is_deleted', false)
            .is('booking_id', null)
          if (s2Err) return Response.json({ error: s2Err.message }, { status: 500 })
          // Re-key each S2 bill to its DESTINATION hub so the picker groups by
          // "where it's heading", not the original leaf. The leaf is still
          // surfaced as `source_branch` for the picker subtitle.
          klS2Bills = (s2 || []).map(b => {
            const link = klS2BillToConsignment[b.id] || {}
            return {
              ...b,
              branch_name:    link.dest_branch || b.branch_name,
              _source_branch: link.source_branch || b.branch_name,
              _consignment_created_at: link.created_at,
            }
          })
        }
      }
    }

    // S5 — at_branch at a Kerala leaf (not a hub), dispatch to hub yet to fire.
    let klS5Bills = []
    if (klLeafNames.length) {
      const list = klLeafNames.map(n => `"${n}"`).join(',')
      const { data: s5, error: s5Err } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
        .or(`current_branch.in.(${list}),and(current_branch.is.null,branch_name.in.(${list}))`)
        .eq('stock_status', 'at_branch')
        .eq('crm_status',   'approved')
        .eq('is_deleted',   false)
        .is('booking_id',   null)
      if (s5Err) return Response.json({ error: s5Err.message }, { status: 500 })
      klS5Bills = (s5 || []).map(b => ({ ...b, _origin_branch: b.branch_name, branch_name: b.current_branch || b.branch_name }))
    }

    // S3 — "consignment created · not booked": any Kerala bill that is
    // in_consignment with no booking and ISN'T already on a leaf→hub INTERNAL
    // run (those are S2). In practice this is the hub→HO EXTERNAL dispatches
    // plus any other stray in-transit gold still awaiting a booking.
    let klS3Bills = []
    if (allKlNames.length) {
      const list = allKlNames.map(n => `"${n}"`).join(',')
      const { data: s3, error: s3Err } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
        .or(`branch_name.in.(${list}),current_branch.in.(${list})`)
        .eq('stock_status', 'in_consignment')
        .eq('crm_status',   'approved')
        .eq('is_deleted',   false)
        .is('booking_id',   null)
      if (s3Err) return Response.json({ error: s3Err.message }, { status: 500 })
      // Group by ORIGIN branch (branch_name), NOT current_branch. A hub→HO
      // consignment consolidates bills from several leaf branches at the hub, so
      // grouping by current_branch lumps every bill under that one hub (e.g. all
      // under KL-THRISSUR). Keeping branch_name shows each bill under the branch
      // it was actually bought at.
      klS3Bills = (s3 || []).filter(b => !klS2BillToConsignment[b.id])   // drop leaf→hub INTERNAL (those are S2)
    }

    // S2 "may slip" heuristic — flag bills whose INTERNAL consignment was
    // created after the source leaf's published pickup_time + 2h buffer. They
    // likely won't reach the hub in time for tonight's hub→HO dispatch.
    // Surfaced on the bill row so the picker can render a small warning pill;
    // doesn't affect counting (math stays loose per v1 spec).
    const flagSlipRisk = (bill) => {
      const link = klS2BillToConsignment[bill.id]
      if (!link?.created_at) return bill
      const src = link.source_branch && branchMeta[link.source_branch]
      if (!src?.pickup_time) return bill
      const [ph, pm] = src.pickup_time.split(':').map(Number)
      if (!Number.isFinite(ph)) return bill
      const cIst = new Date(new Date(link.created_at).getTime() + 5.5 * 3600_000)
      const cutoff = ph * 60 + (pm || 0) + 120   // pickup + 2h buffer
      const cMin   = cIst.getUTCHours() * 60 + cIst.getUTCMinutes()
      return cMin > cutoff ? { ...bill, _slip_risk: true } : bill
    }
    klS2Bills = klS2Bills.map(flagSlipRisk)

    // ── Per-hub post-dispatch exclusion ──────────────────────────────────────
    // Once a KL hub has cut its hub→HO EXTERNAL consignment (E-invoice) today,
    // tonight's BVC pickup is sealed. Any bills currently AT that hub (S1) or
    // IN MOVEMENT to it (S2) physically can't make tonight's truck — they go
    // on tomorrow's hub→HO run and arrive at HO the day after. So when the
    // operator is bidding for the standard "tomorrow's HO arrival", exclude
    // those bills here. When bidding further out, leave everything in (those
    // ARE the bills landing on the further-out date).
    //
    // EXTERNAL = hub → HO. INTERNAL = leaf → hub (we want to ignore those
    // here — they're upstream of the dispatch cutoff). Excludes 'cancelled'
    // and 'seed' so a placeholder row doesn't read as "dispatched".
    let klHubsDispatchedToday = new Set()
    const standardArrival = addWorkingDaysSkipSunday(today, 1)
    if (klHubNames.length && arrivalDate === standardArrival) {
      const { data: dispatched } = await supabase
        .from('consignments')
        .select('branch_name')
        .in('branch_name', klHubNames)
        .eq('movement_type', 'EXTERNAL')
        .gte('created_at', `${bangalorePurchaseDate}T00:00:00+05:30`)
        .lte('created_at', `${bangalorePurchaseDate}T23:59:59+05:30`)
        .not('status', 'in', '("cancelled","seed")')
      klHubsDispatchedToday = new Set((dispatched || []).map(c => c.branch_name))

      // Strip excluded bills from S1 + S2. S3 stays untouched — a leaf bill's
      // eventual hub is decided when the next leaf→hub consignment is created;
      // if its closest hub has post-dispatched, ops will just route it to
      // the other hub or hold it for tomorrow.
      if (klHubsDispatchedToday.size > 0) {
        klS1HubOrigin = klS1HubOrigin.filter(b => !klHubsDispatchedToday.has(b.branch_name))
        klS1FromLeaf  = klS1FromLeaf.filter(b  => !klHubsDispatchedToday.has(b._at_hub))
        klS2Bills     = klS2Bills.filter(b     => !klHubsDispatchedToday.has(b.branch_name))
      }
    }

    const klS1ByHub      = groupByBranch(klS1HubOrigin)
    const klS1LeafByLeaf = groupByBranch(klS1FromLeaf)
    const klS2ByHub      = groupByBranch(klS2Bills)
    const klS3ByBranch   = groupByBranch(klS3Bills)
    const klS5ByLeaf     = groupByBranch(klS5Bills)
    const klS1Total      = sumOf(klS1ByHub)
    const klS1LeafTotal  = sumOf(klS1LeafByLeaf)
    const klS2Total      = sumOf(klS2ByHub)
    const klS3Total      = sumOf(klS3ByBranch)
    const klS5Total      = sumOf(klS5ByLeaf)

    // ── Today's purchases by region (ops header summary) ──────────────────────
    // A flat "what was bought today" tally — bills + net weight grouped by
    // region, independent of the arrival windows. Region scope is inherited via
    // branchMeta (already filtered to allowedRegions), so a bill at an
    // out-of-scope branch is skipped. Kerala lands here too; the client shows it
    // only on the KL tab.
    const { data: todaysPurchaseRows } = await supabase
      .from('purchases')
      .select('net_weight, branch_name')
      .eq('purchase_date', today)
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
      .limit(5000)
    const todaysByRegionMap = {}
    for (const p of todaysPurchaseRows || []) {
      const region = branchMeta[p.branch_name]?.region
      if (!region) continue
      if (!todaysByRegionMap[region]) todaysByRegionMap[region] = { region, bills: 0, net_wt: 0 }
      todaysByRegionMap[region].bills  += 1
      todaysByRegionMap[region].net_wt += Number(p.net_weight || 0)
    }
    const todays_purchases_by_region = Object.values(todaysByRegionMap)
      .sort((a, b) => b.net_wt - a.net_wt)

    return Response.json({
      data: {
        arrival_date:            arrivalDate,
        day_after_arrival:       dayAfterArrival,
        day_after_2_arrival:     dayAfter2Arrival,
        bangalore_purchase_date: bangalorePurchaseDate,
        todays_purchase_date:    today,
        todays_purchases_by_region,
        bangalore:      { branches: bangaloreByBranch,  total: bangTotal,       booked: bookedSection(bookedBang)        },
        transit_24h:    { branches: transit24hByBranch, total: transit24hTotal, booked: bookedSection(bookedT24)         },
        transit_48h:    { branches: transit48hByBranch, total: transit48hTotal, booked: bookedSection(bookedT48)         },   // selectable
        transit_72h:    { branches: transit72hByBranch, total: transit72hTotal, booked: bookedSection(bookedT72)         },   // arriving after 2 days (72h), selectable
        // Section 2 sub-group — consignment created, booking pending. Still
        // bookable (selectable), but off the tomorrow window so it's flagged
        // separately under Section 2 rather than mixed into the main list.
        consignment_pending_booking: { branches: pendingBookingByBranch, total: pendingBookingTotal },
        // Bangalore counterpart — rendered as a consolidated drill-down
        // sub-group inside Section 1 (Bangalore's own section).
        bangalore_pending_booking:   { branches: bangPendingBookingByBranch, total: bangPendingBookingTotal },
        bangalore_gain_rebookable:   { branches: bangGainRebookableByBranch, total: bangGainRebookableTotal },
        branch_pre_eod: { branches: preEodByBranch,     total: preEodTotalToday, total_all: preEodTotal, booked: bookedSection(bookedPreEod, true), dispatched_today: dispatchedTodayByBranch, _debug: debugSection4 },
        // Section 5 — booked but consignment not yet created (at_branch +
        // booking_id IS NOT NULL). View-only; intentionally excluded from
        // bookable totals (the booking row already counts this weight).
        booked_pending_dispatch: { branches: bookedNonKlByBranch, total: bookedNonKlTotal },
        // Back-compat for the existing UI — alias of transit_24h.
        in_transit: { branches: inflightByBranch, total: inflightTotal },
        // Kerala bid-desk taxonomy (consumed by the KL tab).
        kerala_sections: {
          hubs:                  klHubNames,
          hubs_dispatched_today: [...klHubsDispatchedToday],
          // S1 — hub stock: hub-origin bills + a received-from-leaf sub-group.
          s1_hub_stock:          { branches: klS1ByHub, total: klS1Total,
                                   received_from_leaf: { branches: klS1LeafByLeaf, total: klS1LeafTotal } },
          // S2 — leaf→hub INTERNAL runs in movement.
          s2_in_movement:        { branches: klS2ByHub, total: klS2Total },
          // S3 — consignment created (→HO etc.) but not booked.
          s3_created_not_booked: { branches: klS3ByBranch, total: klS3Total },
          // S4 — booked, consignment not created.
          s4_booked_pending:     { branches: bookedKlByBranch, total: bookedKlTotal },
          // S5 — at leaf branch, dispatch pending.
          s5_at_leaf:            { branches: klS5ByLeaf, total: klS5Total },
        },
        grand_total: grandTotal,
        pending: {
          grams:      Number(pendingRow?.pending_grams) || 0,
          note:       pendingRow?.note       || null,
          updated_at: pendingRow?.updated_at || null,
          updated_by: pendingRow?.updated_by || null,
        },
      },
    })
  }

  // ── Bidder names — distinct parties seen on past bookings ────────────────
  // Powers the dropdown on the Bidding Volume booking modal. Sourced from
  // cal_quotas.party (the same column CalTable writes to) so any name that
  // has ever appeared in either flow shows up as a suggestion.
  if (action === 'bidder_names') {
    const { data, error } = await supabase
      .from('cal_quotas')
      .select('party, created_at')
      .not('party', 'is', null)
      .neq('party', '')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    // De-dupe case-insensitively, preserve most-recent capitalisation, return
    // a flat sorted list.
    const seen = new Map()
    for (const r of data || []) {
      const p = String(r.party || '').trim()
      if (!p) continue
      const k = p.toLowerCase()
      if (!seen.has(k)) seen.set(k, p)
    }
    const bidders = [...seen.values()].sort((a, b) => a.localeCompare(b))
    return Response.json({ data: bidders })
  }

  // ── Bidding bookings: list of buyer commitments for a given arrival date ──
  // Stored in cal_quotas (same table the Sales → Cal Table → Quotas tab
  // reads), with extended columns for status + audit trail. We surface all
  // statuses so the UI can show fulfilled/cancelled rows in their own
  // collapsed groups; the active-pool roll-up excludes cancelled.
  //
  // KNOWN CONSTRAINT (go-live, tracked): cal_quotas has NO branch/region
  // column — source branches live only in the free-text `notes` ("Sources:
  // …"). So this list is NOT region-scoped. bidding_volume IS region-scoped
  // (Incoming), so a region-restricted user would get scoped Incoming but
  // full-company Booked → a wrong (often falsely-overbooked) pool. Bidding
  // Volume is therefore HQ-only for now: do NOT grant page.consignment-
  // bidding to a region-restricted role until cal_quotas gains a region
  // dimension. Bypass roles (super_admin/founders_office/admin) are
  // unaffected (they see all regions anyway).
  // ── Booking bill breakdown: the bills attached to ONE booking, grouped by
  //    branch — powers the click-to-expand "branch-wise breakup" on the
  //    Bookings tab. Owner branch = current_branch || branch_name (so leaf→hub
  //    transfers roll up under the hub). ──
  if (action === 'booking_bills') {
    const bookingId = searchParams.get('booking_id')
    if (!bookingId) return Response.json({ error: 'booking_id required' }, { status: 400 })
    // No is_deleted filter — mirror the bidding_bookings attached-weight
    // aggregation exactly (it filters only on booking_id). Filtering
    // is_deleted = false would drop rows where the column is NULL, which is
    // what made this come back empty while the Net Wt showed 2898 g.
    const { data: bills, error: bErr } = await supabase
      .from('purchases')
      .select('id, application_id, customer_name, branch_name, current_branch, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, received_at, booked_at')
      .eq('booking_id', bookingId)
      .order('net_weight', { ascending: false })
    if (bErr) return Response.json({ error: bErr.message }, { status: 500 })
    const { data: brs } = await supabase.from('branches').select('name, region, delivery_tat_hours')
    const regionBy = Object.fromEntries((brs || []).map(x => [x.name, x.region]))
    const tatBy    = Object.fromEntries((brs || []).map(x => [x.name, Number(x.delivery_tat_hours) || 24]))
    const istDateOf = (utcIso) => {
      if (!utcIso) return null
      const d = new Date(new Date(utcIso).getTime() + 5.5 * 3600_000)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
    // Consignment created_at per bill (latest non-cancelled) — used to place each
    // bill in the section it was in AT BOOKING TIME.
    const billIds = (bills || []).map(b => b.id).filter(Boolean)
    const consMap = {}   // purchase_id → consignment created_at
    for (let i = 0; i < billIds.length; i += 200) {
      const { data: ci } = await supabase
        .from('consignment_items')
        .select('purchase_id, consignment:consignment_id(created_at, status)')
        .in('purchase_id', billIds.slice(i, i + 200))
      for (const l of ci || []) {
        const c = l.consignment
        if (!c || c.status === 'cancelled' || c.status === 'seed') continue
        if (!consMap[l.purchase_id] || new Date(c.created_at) > new Date(consMap[l.purchase_id])) consMap[l.purchase_id] = c.created_at
      }
    }
    const nowIstDate = istDateOf(new Date().toISOString())
    // Section the bill was booked FROM — reconstructed as of its booking day:
    //   S1 Bangalore · S2/S3/S4 outstation transit arriving +1/+2/+3 working days
    //   from the booking day · S5 consignment created but its arrival had already
    //   passed the booking day (the stuck/older pool) · S6 booked with no
    //   consignment · S7 outstation branch-pickup (no consignment, still at branch).
    const classifySection = (p, isBlr) => {
      if (isBlr) return 'S1'
      const cc = consMap[p.id]
      if (!cc) return p.stock_status === 'at_branch' ? 'S7' : 'S6'
      const dispatchDate = p.dispatched_at ? istDateOf(p.dispatched_at) : istDateOf(cc)
      const tat = tatBy[p.branch_name] || 24
      const ea = addWorkingDaysSkipSunday(dispatchDate, Math.max(1, Math.ceil(tat / 24)))
      const bday = p.booked_at ? istDateOf(p.booked_at) : nowIstDate
      if (ea === addWorkingDaysSkipSunday(bday, 1)) return 'S2'
      if (ea === addWorkingDaysSkipSunday(bday, 2)) return 'S3'
      if (ea === addWorkingDaysSkipSunday(bday, 3)) return 'S4'
      return 'S5'
    }
    const byBranch = {}
    let tBills = 0, tNet = 0, tGross = 0
    for (const p of bills || []) {
      const owner = p.current_branch || p.branch_name
      if (!byBranch[owner]) byBranch[owner] = { branch_name: owner, region: regionBy[owner] || 'Unknown', bills: [], net_wt: 0, gross_wt: 0, _sections: new Set() }
      const g = byBranch[owner]
      const isBlr = (regionBy[owner] || regionBy[p.branch_name]) === 'Bangalore'
      const tat = tatBy[p.branch_name] || 24
      // Consignment date: Bangalore moves same-day → = purchase date; outstation
      // → the actual dispatch day.
      const consignment_date = isBlr ? p.purchase_date : istDateOf(p.dispatched_at)
      // Expected arrival: at_ho → actual received day; Bangalore → consignment
      // (= purchase) day + 24h; outstation → dispatch + TAT (working days,
      // Sunday-skipped); at_branch outstation → not dispatched yet.
      let expected_arrival
      if (p.stock_status === 'at_ho')      expected_arrival = istDateOf(p.received_at)
      else if (isBlr)                      expected_arrival = p.purchase_date ? addWorkingDaysSkipSunday(p.purchase_date, 1) : null
      else                                 expected_arrival = p.dispatched_at ? addWorkingDaysSkipSunday(istDateOf(p.dispatched_at), Math.max(1, Math.ceil(tat / 24))) : null
      const section = classifySection(p, isBlr)
      g._sections.add(section)
      g.bills.push({
        application_id: p.application_id, customer_name: p.customer_name,
        purchase_date: p.purchase_date, stock_status: p.stock_status,
        consignment_date, expected_arrival, section,
        net_weight: Number(p.net_weight || 0), gross_weight: Number(p.gross_weight || 0),
        total_amount: Number(p.total_amount || 0),
      })
      g.net_wt += Number(p.net_weight || 0); g.gross_wt += Number(p.gross_weight || 0)
      tBills += 1; tNet += Number(p.net_weight || 0); tGross += Number(p.gross_weight || 0)
    }
    const SECT_ORDER = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']
    const branches = Object.values(byBranch).sort((a, b) => b.net_wt - a.net_wt)
    for (const g of branches) { g.sections = [...g._sections].sort((a, b) => SECT_ORDER.indexOf(a) - SECT_ORDER.indexOf(b)); delete g._sections }
    return Response.json({ branches, total: { bills: tBills, net_wt: tNet, gross_wt: tGross } })
  }

  // ── Melting pool — gold by stock_status, grouped by branch (drill to cases).
  //   ?status=in_consignment → 1st tab (in transit to HO)
  //   ?status=at_ho          → 2nd tab (arrived at HO)
  // Columns surface the consignment (dispatch) date, booked/unbooked split, the
  // arrival date (expected for in-transit, actual received_at for at_ho), and an
  // audited flag. Approved, non-deleted bills only.
  if (action === 'melting_incoming') {
    const status = searchParams.get('status') === 'at_ho' ? 'at_ho' : 'in_consignment'
    // at_ho is the entire standing HO inventory (~100k bills) — not a melt
    // worklist. Scope it to recently-purchased gold so the tab is a usable,
    // performant "to melt" list. Window is configurable via ?days= (default 7).
    const days = Math.max(1, Math.min(60, parseInt(searchParams.get('days') || '7', 10) || 7))
    const cutoff = (() => {
      const d = new Date(Date.now() + 5.5 * 3600_000 - days * 86400_000)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    })()
    const round = (n) => Math.round((Number(n) || 0) * 100) / 100
    const istDateOf = (utcIso) => {
      if (!utcIso) return null
      const d = new Date(new Date(utcIso).getTime() + 5.5 * 3600_000)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }

    const { data: branchRows } = await supabase.from('branches').select('name, region, delivery_tat_hours')
    const meta = {}
    for (const b of (branchRows || [])) meta[b.name] = b

    const FIELDS = 'id, application_id, crm_source, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, received_at, booking_id, audited_at, audit_consumed_at'

    // Paginate — at_ho (HO inventory awaiting melt) can exceed the 1000-row cap.
    const rows = []
    const CHUNK = 1000
    for (let from = 0; ; from += CHUNK) {
      let qy = supabase.from('purchases').select(FIELDS)
        .eq('stock_status', status).eq('crm_status', 'approved').eq('is_deleted', false)
        .order('purchase_date', { ascending: false })
        .range(from, from + CHUNK - 1)
      if (status === 'at_ho') qy = qy.gte('purchase_date', cutoff)   // recent worklist only
      const { data, error } = await qy
      if (error) return Response.json({ error: error.message }, { status: 500 })
      rows.push(...(data || []))
      if (!data || data.length < CHUNK) break
    }

    const all = rows.map(b => {
      const owner = b.current_branch || b.branch_name
      const region = meta[owner]?.region || meta[b.branch_name]?.region || 'Unknown'
      let arrival
      if (status === 'at_ho') {
        arrival = istDateOf(b.received_at)                         // actual arrival
      } else {
        const tat = meta[b.branch_name]?.delivery_tat_hours || 24  // expected arrival
        arrival = b.dispatched_at ? addWorkingDaysSkipSunday(istDateOf(b.dispatched_at), Math.max(1, Math.ceil(tat / 24))) : null
      }
      return { ...b, _source: region === 'Bangalore' ? 'bangalore' : 'consignment', _arrival: arrival, _audited: !!(b.audited_at || b.audit_consumed_at) }
    })

    const byBranch = {}
    for (const b of all) {
      const owner = b.current_branch || b.branch_name
      if (!byBranch[owner]) byBranch[owner] = {
        branch_name: owner, region: meta[owner]?.region || meta[b.branch_name]?.region || 'Unknown',
        cases: [], net: 0, gross: 0, booked_net: 0, unbooked_net: 0, booked_bills: 0, unbooked_bills: 0,
        audited_bills: 0, _arrivals: new Set(), _cdates: new Set(),
      }
      const g = byBranch[owner]
      const booked = !!b.booking_id
      const consignmentDate = istDateOf(b.dispatched_at)   // when the consignment was created/dispatched
      g.cases.push({
        application_id: b.application_id, crm_source: b.crm_source, customer_name: b.customer_name,
        gross_weight: round(b.gross_weight), net_weight: round(b.net_weight),
        stock_status: b.stock_status, source: b._source,
        consignment_date: consignmentDate, expected_arrival: b._arrival,
        booked, audited: b._audited,
      })
      g.net += Number(b.net_weight || 0); g.gross += Number(b.gross_weight || 0)
      if (b._audited) g.audited_bills++
      if (booked) { g.booked_net += Number(b.net_weight || 0); g.booked_bills++ }
      else { g.unbooked_net += Number(b.net_weight || 0); g.unbooked_bills++ }
      if (b._arrival) g._arrivals.add(b._arrival)
      if (consignmentDate) g._cdates.add(consignmentDate)
    }
    const branches = Object.values(byBranch).map(g => ({
      branch_name: g.branch_name, region: g.region,
      bills: g.cases.length,
      net: round(g.net), gross: round(g.gross),
      booked_net: round(g.booked_net), unbooked_net: round(g.unbooked_net),
      booked_bills: g.booked_bills, unbooked_bills: g.unbooked_bills, audited_bills: g.audited_bills,
      arrivals: [...g._arrivals].sort(),
      consignment_dates: [...g._cdates].sort(),
      cases: g.cases.sort((a, b) => b.gross_weight - a.gross_weight),
    })).sort((a, b) => b.gross - a.gross)

    const total = {
      bills: all.length,
      net: round(all.reduce((s, b) => s + Number(b.net_weight || 0), 0)),
      gross: round(all.reduce((s, b) => s + Number(b.gross_weight || 0), 0)),
      booked_bills: all.filter(b => b.booking_id).length,
      unbooked_bills: all.filter(b => !b.booking_id).length,
      audited_bills: all.filter(b => b._audited).length,
    }
    return Response.json({ status, branches, total, days: status === 'at_ho' ? days : null, cutoff: status === 'at_ho' ? cutoff : null })
  }

  if (action === 'bidding_bookings') {
    // Accept either `bidding_date` (NEW: filter by created_at IST date —
    // the day the booking was placed) or `date` (LEGACY: filter by
    // cal_quotas.date which is the arrival date). The Bookings tab now
    // pivots on bidding day so a booking placed on 21 May for arrival
    // 22 May surfaces under "21 May", not "22 May".
    const biddingDate = searchParams.get('bidding_date')
    const date        = searchParams.get('date')
    if (!biddingDate && !date) return Response.json({ error: 'bidding_date or date required (YYYY-MM-DD)' }, { status: 400 })

    const fullSelect = `id, date, party, buyer_phone, weight, rate, is_kl, purity, notes,
                        status, created_at, created_by,
                        confirmed_at, confirmed_by, fulfilled_at, fulfilled_by,
                        cancelled_at, cancelled_by, cancellation_reason,
                        pipeline_remaining_g, pipeline_region, pipeline_arrival_date,
                        pipeline_attached_at, gain_realized_g,
                        bills_net_weight_g, gain_applied_g, pending_g,
                        additional_gain_g, pipeline_original_g,
                        gain_audited_at, gain_rate, pipeline_closed_at`
    const baseSelect = `id, date, party, buyer_phone, weight, rate, is_kl, purity, notes,
                        status, created_at, created_by,
                        confirmed_at, confirmed_by, fulfilled_at, fulfilled_by,
                        cancelled_at, cancelled_by, cancellation_reason`

    // Build the query — bidding_date filters by created_at IST, date by
    // arrival.
    const applyFilter = (q) => {
      if (biddingDate) {
        return q
          .gte('created_at', istStartOfDayIso(biddingDate))
          .lt('created_at',  istEndOfDayIso(biddingDate))
      }
      return q.eq('date', date)
    }

    let rows = null
    let bkErr = null
    {
      const tryFull = await applyFilter(
        supabase.from('cal_quotas').select(fullSelect)
      ).order('created_at', { ascending: true })
      if (tryFull.error && /column .* does not exist/i.test(tryFull.error.message || '')) {
        console.warn('[bidding_bookings] breakdown/pipeline columns missing — falling back to base select. Run sql/cal_quotas_breakdown.sql + sql/cal_quotas_pipeline_attach.sql.')
        const tryBase = await applyFilter(
          supabase.from('cal_quotas').select(baseSelect)
        ).order('created_at', { ascending: true })
        rows = tryBase.data
        bkErr = tryBase.error
      } else {
        rows = tryFull.data
        bkErr = tryFull.error
      }
    }
    if (bkErr) return Response.json({ error: bkErr.message }, { status: 500 })

    // For each booking, also surface the live sum of attached bill weights
    // (purchases.net_weight WHERE booking_id = row.id). This lets the UI
    // distinguish "snapshot at creation" (bills_net_weight_g) from "live
    // sum after pipeline attachments" (attached_net_weight_g).
    if (rows && rows.length > 0) {
      const ids = rows.map(r => r.id)
      // Also pull stock_status + source branch so we can compute the
      // per-booking dispatch_state (ready / partial / pending / at_risk)
      // — surfaces "booked but not shipped" risk to the bid desk.
      const { data: agg } = await supabase
        .from('purchases')
        .select('booking_id, net_weight, stock_status, branch_name, current_branch')
        .in('booking_id', ids)
      const sumByBooking      = {}
      const countByBooking    = {}
      const billsByBooking    = {}
      for (const p of agg || []) {
        sumByBooking[p.booking_id]   = (sumByBooking[p.booking_id]   || 0) + Number(p.net_weight || 0)
        countByBooking[p.booking_id] = (countByBooking[p.booking_id] || 0) + 1
        if (!billsByBooking[p.booking_id]) billsByBooking[p.booking_id] = []
        billsByBooking[p.booking_id].push(p)
      }

      // Fold in split allocations so a booking that closed another's pipeline
      // (or was closed by a split bill) shows its TRUE sourced net, not the raw
      // booking_id sum. Zero for every normal whole-bill booking.
      var splitDelta = await allocDeltaByBooking(supabase, ids)

      // Pull pickup_time for every source branch we touch so at_risk can use
      // the published pickup + 2h buffer as the cutoff. One query, keyed by
      // branch name.
      const srcBranchNames = [...new Set((agg || []).map(p => p.current_branch || p.branch_name).filter(Boolean))]
      let branchPickupTimes = {}
      if (srcBranchNames.length) {
        const { data: bps } = await supabase
          .from('branches')
          .select('name, pickup_time')
          .in('name', srcBranchNames)
        for (const b of bps || []) branchPickupTimes[b.name] = b.pickup_time
      }

      // Now-in-IST as minutes-since-midnight for the at_risk cutoff.
      const nowIst = new Date(Date.now() + 5.5 * 3600_000)
      const nowMin = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes()

      const MOVED = new Set(['in_consignment', 'at_ho'])

      for (const r of rows) {
        r.attached_net_weight_g = Math.max(0, (sumByBooking[r.id] || 0) + (splitDelta[r.id] || 0))
        r.attached_bills_count  = countByBooking[r.id] || 0

        // dispatch_state: per attached bill, is it still at_branch or has the
        // physical movement started? Only meaningful for active bookings —
        // cancelled bookings have detached bills already.
        const bills = billsByBooking[r.id] || []
        if (r.status === 'cancelled' || r.status === 'fulfilled' || bills.length === 0) {
          r.dispatch_state = null
          continue
        }
        let moved = 0, atBranch = 0
        let pastCutoffCount = 0, withCutoffCount = 0
        for (const b of bills) {
          if (MOVED.has(b.stock_status))     moved++
          if (b.stock_status === 'at_branch') {
            atBranch++
            const src = b.current_branch || b.branch_name
            const pt  = branchPickupTimes[src]
            if (pt) {
              const [ph, pm] = pt.split(':').map(Number)
              if (Number.isFinite(ph)) {
                withCutoffCount++
                const cutoff = ph * 60 + (pm || 0) + 120   // pickup + 2h buffer
                if (nowMin > cutoff) pastCutoffCount++
              }
            }
          }
        }
        if (moved === bills.length) {
          r.dispatch_state = 'ready'
        } else if (moved > 0) {
          r.dispatch_state = 'partial'
        } else if (atBranch > 0 && withCutoffCount > 0 && pastCutoffCount === withCutoffCount) {
          // Every at_branch bill we can time-check is past its pickup+2h cutoff
          r.dispatch_state = 'at_risk'
        } else {
          r.dispatch_state = 'pending'
        }
      }
    }

    // ── Derived gain + pipeline (the new gain model) ──────────────────────────
    // gain and pipeline are no longer drifting stored addends — they're
    // computed fresh from weight, gain_rate, pending and the live attached
    // net weight:
    //   sourced_net = attached + pending
    //   while arrival_date >= today (live):
    //     derived_gain     = sourced_net × gain_rate          (clean 3.5 %)
    //     derived_pipeline = weight − sourced_net × (1+rate)
    //   once arrival_date < today (settled — EOD leftover folds in):
    //     derived_gain     = weight − sourced_net
    //     derived_pipeline = 0
    {
      const todayIst = istToday()
      for (const r of rows || []) {
        const W       = Number(r.weight || 0)
        const rate    = r.gain_rate != null ? Number(r.gain_rate) : (r.is_kl ? 0 : 0.035)
        const pending = Number(r.pending_g || 0)
        const attached = Number(r.attached_net_weight_g || 0)
        // Manual bookings (ops-entered net/gain, no bills) and any booking with
        // no live-attached bills fall back to the net snapshot captured at
        // creation, so their gain/pipeline derive from a real base instead of 0.
        const baseNet  = attached > 0 ? attached : Number(r.bills_net_weight_g || 0)
        const sourced  = baseNet + pending
        // Settled = arrival day passed OR ops manually closed a small
        // residual pipeline. Either way the leftover folds into gain.
        // Settle by the pipeline's ARRIVAL date, not the booking date — a
        // back-dated booking (e.g. booked on a past bidding day) can still carry
        // an open pipeline expected to fill from future incoming. For every
        // normal booking arrival_date == date, so this is a no-op; it only keeps
        // an intentionally back-dated open pipeline from folding into gain.
        const settleDate = r.pipeline_arrival_date || r.date
        const settled  = !!(settleDate && String(settleDate) < todayIst) || !!r.pipeline_closed_at
        // additional_gain_g — incremental gain added outside the rate-based
        // formula (e.g. when the weight column was floored to an integer and
        // the fractional remainder was parked here, or when a small residual
        // pipeline was closed by ops). Always added to the displayed gain.
        const additional = Number(r.additional_gain_g || 0)
        r.gain_rate_effective = rate
        r.sourced_net_g       = sourced
        r.is_settled          = settled
        if (settled) {
          r.derived_gain_g     = Math.max(0, W - sourced) + additional
          r.derived_pipeline_g = 0
        } else {
          r.derived_gain_g     = sourced * rate + additional
          r.derived_pipeline_g = Math.max(0, W - sourced * (1 + rate))
        }
      }
    }

    // Roll-up — active = booked + confirmed + fulfilled; cancelled excluded.
    const active = (rows || []).filter(r => r.status !== 'cancelled')
    const totalQty   = active.reduce((s, r) => s + Number(r.weight || 0), 0)
    const totalValue = active.reduce((s, r) => s + Number(r.weight || 0) * Number(r.rate || 0), 0)
    const byStatus = (rows || []).reduce((m, r) => {
      m[r.status] = (m[r.status] || 0) + 1
      return m
    }, {})

    return Response.json({
      data: {
        date,
        bookings:        rows || [],
        active_qty_grams: totalQty,
        active_value:    totalValue,
        counts:          byStatus,
      },
    })
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
    // Includes:
    //   - the canonical *_cancelled types
    //   - the legacy generic 'cancelled' (written by the RPC)
    //   - the legacy *_cancel_skipped variants (interim soft-success implementation)
    //   - cancellation_approved (written by the approve route after every
    //     successful approval — most reliable signal since it's logged
    //     outside the RPC's exception-swallowing block).
    // Audit-critical: as long as any one of these exists the cancellation
    // surfaces, so a silent RPC failure or a missed per-doc event can't
    // make a cancelled consignment vanish from the audit log.
    const { data: events, error: evErr } = await supabase
      .from('consignment_activity_log')
      .select('id, consignment_id, event_type, actor_email, actor_role, details, created_at')
      .in('event_type', [
        'ewb_cancelled', 'einvoice_cancelled', 'cancelled',
        'ewb_cancel_skipped', 'einvoice_cancel_skipped',
        'cancellation_approved', 'cancellation_forced_local',
      ])
      .order('created_at', { ascending: false })
    if (evErr) return Response.json({ error: evErr.message }, { status: 500 })

    // Normalise legacy skipped events back to the canonical type so the rest
    // of this handler + the UI's badge logic don't need a special case.
    for (const e of events || []) {
      if (e.event_type === 'ewb_cancel_skipped')      e.event_type = 'ewb_cancelled'
      if (e.event_type === 'einvoice_cancel_skipped') e.event_type = 'einvoice_cancelled'
    }

    // Group events by consignment_id. Specificity ordering so the tab shows
    // the most informative event per consignment:
    //   4 = ewb_cancelled       (EWB is the movement doc — wins combo cases)
    //   3 = einvoice_cancelled  (has doc no, ack, reason)
    //   2 = cancelled (RPC marker, carries had_ewb/had_irn flags)
    //   1 = cancellation_approved (route marker, carries portal_cancelled list)
    //
    // EWB ranks ABOVE E-Invoice: a consignment that had both docs logs an
    // ewb_cancelled AND an einvoice_cancelled event. They used to tie at 3,
    // so whichever was written last won — which mislabelled EWB moves as
    // 'E-INVOICE CANCELLED'. Ranking EWB higher makes combo cases always
    // show the EWB, matching how ops thinks of the movement.
    const eventsByConsignment = new Map()
    for (const e of events || []) {
      const existing = eventsByConsignment.get(e.consignment_id)
      if (!existing) { eventsByConsignment.set(e.consignment_id, e); continue }
      const specifity = (t) => {
        if (t === 'ewb_cancelled') return 4
        if (t === 'einvoice_cancelled') return 3
        if (t === 'cancelled') return 2
        return 1
      }
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
      // total_amount is the canonical column on consignments; older summary
      // shapes use total_gross_value as the alias, so we re-expose both so
      // either consumer (Cancellations card UI, docs report, etc.) finds
      // what it expects without another round trip.
      const { data: cs, error: cErr } = await supabase
        .from('consignments')
        .select('id, tmp_prf_no, branch_name, dest_branch, movement_type, state_code, total_bills, total_amount, total_net_wt, approval_status, status, rejection_reason, created_at, eway_bill_no, irn')
        .in('id', ids)
      if (cErr) return Response.json({ error: cErr.message }, { status: 500 })
      consignmentsAll = (cs || []).map(c => ({ ...c, total_gross_value: c.total_amount }))
    }
    const byId = new Map(consignmentsAll.map(c => [c.id, c]))
    const inScope = (c) => !allowedBranches || (c && allowedBranches.includes(c.branch_name))

    // Recover the DOC NUMBERS. consignments.eway_bill_no / irn are NULLED at cancel
    // time, and the cancel event itself often carries nothing (the generic
    // cancellation_approved / forced_local paths) — which is why most rows showed no
    // number at all. The GENERATION events survive untouched, so read the EWB / IRN
    // from there. That is the only durable record of what document was cancelled.
    const genByConsignment = new Map()   // id → { ewb_no, irn }
    if (ids.length) {
      for (let i = 0; i < ids.length; i += 100) {
        const slice = ids.slice(i, i + 100)
        const { data: gens } = await supabase
          .from('consignment_activity_log')
          .select('consignment_id, event_type, details, created_at')
          .in('consignment_id', slice)
          .in('event_type', ['ewb_generated', 'einvoice_generated'])
          .order('created_at', { ascending: true })
        for (const g of gens || []) {
          const cur = genByConsignment.get(g.consignment_id) || {}
          if (g.event_type === 'ewb_generated') {
            cur.ewb_no = g.details?.ewb_no || g.details?.eway_bill_no || cur.ewb_no
          } else {
            cur.irn = g.details?.irn || cur.irn
          }
          genByConsignment.set(g.consignment_id, cur)
        }
      }
    }

    // For non-specific fallbacks ('cancelled' and 'cancellation_approved'),
    // infer the doc-type label from the event's details payload so the
    // UI's badge logic continues to work (it switches on event_type ===
    // 'ewb_cancelled' for the green EWB pill, anything else for the
    // purple E-Invoice pill).
    const rows = dedupedEvents.flatMap(e => {
      const c = byId.get(e.consignment_id)
      // Region scoping: if the consignment exists but is outside the user's
      // allowed branches, drop the event (security). If the consignment is
      // missing entirely (deleted), KEEP the event so the audit trail isn't
      // silently broken — the UI will render with a 'consignment deleted'
      // placeholder.
      if (c && !inScope(c)) return []
      let inferredType = e.event_type
      // Which document does this consignment's ROUTE actually carry? Same rule the
      // rest of the app uses (see ConsignmentData):
      //   INTERNAL (branch → hub)            → EWB
      //   EXTERNAL from a KA source (→ HO)   → EWB (intrastate)
      //   EXTERNAL from a non-KA source      → E-Invoice (interstate hub → HO)
      // This is the ONLY trustworthy source of the doc type for the fallback events:
      // eway_bill_no / irn are nulled at cancel time, and the event itself may carry
      // nothing. Previously these fell through to the generic 'cancelled', and the UI
      // painted anything that wasn't 'ewb_cancelled' as "E-INVOICE CANCELLED" — which
      // mislabelled every branch→hub and KA→HO move (all of them EWB) as an E-Invoice.
      const docTypeOf = (cc) => {
        if (!cc) return 'cancelled'
        const isInternal = cc.movement_type === 'INTERNAL'
        const isKaSource = cc.state_code === 'KA'
        return (!isInternal && !isKaSource) ? 'einvoice_cancelled' : 'ewb_cancelled'
      }
      // Did anything actually get cancelled on the portal? A force-local cancel (or a
      // cancel we wrongly read as failed) touches NIC/IRP not at all — claiming
      // "EWB CANCELLED" there would be a lie.
      let portalUntouched = false

      if (e.event_type === 'cancelled') {
        if (e.details?.had_ewb) inferredType = 'ewb_cancelled'
        else if (e.details?.had_irn) inferredType = 'einvoice_cancelled'
        else inferredType = docTypeOf(c)
      } else if (e.event_type === 'cancellation_forced_local') {
        inferredType    = docTypeOf(c)
        portalUntouched = true
      } else if (e.event_type === 'cancellation_approved') {
        // portal_cancelled is a free-form string array: ["EWB 123 cancelled on NIC", "E-Invoice cancelled on IRP", ...]
        // Sniff for the EWB pattern first so combo cases (had both) prefer EWB.
        const portal = e.details?.portal_cancelled
        const hasEwb = Array.isArray(portal) && portal.some(p => /\bewb\b/i.test(String(p)))
        const hasIrn = Array.isArray(portal) && portal.some(p => /e-?invoice|irp|irn/i.test(String(p)))
        if (hasEwb) inferredType = 'ewb_cancelled'
        else if (hasIrn) inferredType = 'einvoice_cancelled'
        else {
          // Nothing recorded as cancelled on the portal — name the doc from the route
          // and flag that the portal was never touched.
          inferredType    = docTypeOf(c)
          portalUntouched = true
        }
      }
      // Also surface the doc number on the synthesized details so the UI
      // shows something useful even when only the cancellation_approved
      // event survived (the canonical EWB/IRN cancel events carry it
      // directly; for fallbacks we read it from the consignment row, or
      // from the portal_cancelled array as a last resort).
      const synthDetails = { ...(e.details || {}) }
      const gen = genByConsignment.get(e.consignment_id) || {}
      if (inferredType === 'ewb_cancelled' && !synthDetails.ewb_no) {
        const portal = e.details?.portal_cancelled
        const ewbFromPortal = Array.isArray(portal)
          ? (portal.find(p => /ewb\s+\S+/i.test(String(p))) || '').match(/ewb\s+(\S+)/i)?.[1]
          : null
        // …falling back to the generation event, which still has the number even
        // though the consignment column was nulled at cancel time.
        synthDetails.ewb_no = ewbFromPortal || c?.eway_bill_no || gen.ewb_no || null
      }
      if (inferredType === 'einvoice_cancelled' && !synthDetails.irn) {
        synthDetails.irn = c?.irn || gen.irn || null
      }
      return [{
        ...e,
        event_type:           inferredType,
        details:              synthDetails,
        consignment:          c || null,
        consignment_missing:  !c,
        // true = cancelled in GoldApp only; the EWB/IRN was never cancelled on the
        // portal. The UI badges this differently so it can't be read as a clean
        // portal cancellation.
        portal_untouched:     portalUntouched,
        doc_label:            inferredType === 'ewb_cancelled' ? 'EWB' : inferredType === 'einvoice_cancelled' ? 'E-Invoice' : null,
      }]
    })
    // Opt-in diagnostics: ?action=cancellation_history&debug=1 returns a
    // breakdown of every stage of the pipeline so we can pin down where
    // rows are dropping out (raw events / dedupe / consignment lookup /
    // region scope). Audit-only; doesn't change normal callers.
    if (searchParams.get('debug') === '1') {
      return Response.json({
        data: rows,
        debug: {
          allowedBranches:    allowedBranches,
          raw_events_count:   events?.length || 0,
          raw_events_sample:  (events || []).slice(0, 10).map(e => ({
            consignment_id: e.consignment_id, event_type: e.event_type, created_at: e.created_at,
          })),
          deduped_count:      dedupedEvents.length,
          consignment_ids:    ids,
          consignments_found: consignmentsAll.map(c => ({ id: c.id, tmp_prf_no: c.tmp_prf_no, branch_name: c.branch_name })),
          rows_count:         rows.length,
        },
      })
    }
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
        .order('created_at', { ascending: true })
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
    // Mirror the pending_approvals filter exactly: EWB-route consignments are
    // ops self-service and must not inflate the accounts badge. Fetch the
    // discriminator columns and filter in JS so this stays in lockstep with
    // the queue (no PostgREST null-handling drift).
    let q = supabase
      .from('consignments')
      .select('movement_type, state_code, branch_name')
      .eq('approval_status', 'pending')
      .neq('status', 'cancelled')
      .neq('status', 'seed')
    if (allowedBranches) q = q.in('branch_name', allowedBranches)
    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const count = (data || []).filter(c => {
      const isInternal = c.movement_type === 'INTERNAL'
      const isKaSource = c.state_code === 'KA'
      return !(isInternal || isKaSource)   // only E-Invoice-route awaits accounts
    }).length
    return Response.json({ count })
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
    // Column list mirrors the Consignment Report case-wise table: same set of
    // weights / charges the Purchase Data module exposes, plus dispatched_at
    // (= "consignment since") so ops can bucket by transition date.
    // Optional date-range mode — when `from` / `to` (YYYY-MM-DD in IST) are
    // supplied, return ALL bills dispatched in that window regardless of their
    // current stock_status. The Consignment Report uses this to show "what
    // moved on a particular date" — a bill received last week still appears
    // when its dispatch date is in the window. Without the params we fall
    // back to the original "currently in transit" snapshot.
    // Data build extracted to lib/consignmentReportData.js so the scheduled
    // consignment email report renders identical rows. See there for the full
    // rationale (created-date window, per-bill de-dup, region/TAT enrichment).
    const fromDate = searchParams.get('from')
    const toDate   = searchParams.get('to')
    try {
      const enriched = await fetchInTransitStock({ from: fromDate, to: toDate, allowedBranches })
      return Response.json({ data: enriched })
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 })
    }
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
    // Annotate each row with the latest "documents emailed" timestamp so the UI
    // can flag which consignments have already had their docs mailed to the
    // branch (ops can still resend). Best-effort.
    //
    // NOTE: chunk the id list. A single `.in(all-ids)` with hundreds of
    // consignments builds a ~17 KB URL that PostgREST rejects (URI too long) —
    // the query then errored and the catch silently left EVERY row un-flagged,
    // so the "Mail Sent" state never showed. Batch of 100 keeps each URL small.
    if (data?.length) {
      try {
        const ids = data.map(r => r.id)
        const latest = {}, bounced = {}
        const CH = 100
        for (let i = 0; i < ids.length; i += CH) {
          const { data: rows } = await supabase
            .from('consignment_activity_log')
            .select('consignment_id, created_at, event_type')
            .in('event_type', ['documents_emailed', 'documents_email_bounced'])
            .in('consignment_id', ids.slice(i, i + CH))
            .order('created_at', { ascending: false })
          for (const row of (rows || [])) {
            if (row.event_type === 'documents_emailed'        && !latest[row.consignment_id])  latest[row.consignment_id]  = row.created_at
            if (row.event_type === 'documents_email_bounced'  && !bounced[row.consignment_id]) bounced[row.consignment_id] = row.created_at
          }
        }
        for (const r of data) { r.documents_emailed_at = latest[r.id] || null; r.documents_email_bounced_at = bounced[r.id] || null }
      } catch { /* leave rows un-annotated on log hiccup */ }
    }
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

// ── Auto-reconcile helper ─────────────────────────────────────────────────────
// Detach SMALLEST-FIRST bills from a booking until attached_net × (1+gain_rate)
// no longer exceeds the booked weight, then return any residual gap that
// should land in pipeline_remaining_g.
//
// Shared between create_booking (runs automatically on every new booking)
// and reconcile_booking (one-click fix for legacy over-attached rows).
// Returns { detached, residual_pipeline_g, error }.
async function reconcileBookingOverAttachment({ supabase, bookingId, bookedWeight, isKl }) {
  const gainRate = isKl ? 0 : 0.035
  let detachedItems = []
  let residualPipelineG = 0
  let error = null
  try {
    const { data: attached, error: fetchErr } = await supabase
      .from('purchases')
      .select('id, application_id, customer_name, net_weight, stock_status, branch_name, current_branch')
      .eq('booking_id', bookingId)
    if (fetchErr) { error = fetchErr.message; return { detached: [], residual_pipeline_g: 0, error } }
    if (!attached || attached.length === 0) {
      return { detached: [], residual_pipeline_g: 0, error: null }
    }

    // Allocation-aware: if this booking gave net away to close another's
    // pipeline (a split bill), its effective sourced net is lower — so it isn't
    // really over-attached and reconcile must not rip the split bill off it.
    const recDelta           = await allocDeltaByBooking(supabase, [bookingId])
    const attachedNet        = attached.reduce((s, b) => s + Number(b.net_weight || 0), 0) + (recDelta[bookingId] || 0)
    const effectiveCommitted = attachedNet * (1 + gainRate)
    const excessEffective    = effectiveCommitted - bookedWeight

    if (excessEffective <= 0.01) {
      // Float-noise threshold — not worth touching.
      return { detached: [], residual_pipeline_g: 0, error: null }
    }
    const excessNet = excessEffective / (1 + gainRate)

    // RULE: only ever free SECTION-1 BANGALORE bills that are still locally
    // available (at_branch / at_ho). NEVER detach in-transit (in_consignment)
    // bills — those are already dispatched and physically committed to this
    // booking's consignment — and never pull from non-Bangalore branches.
    // Outstation / in-transit weight stays put even if that leaves the booking
    // over-attached; it's the operator's call to fix, not ours to silently
    // strip in-transit gold. (See incident 16-Jun-2026: smallest-first across
    // ALL bills wrongly freed 13 outstation in-transit bills.)
    const { data: blrBranches } = await supabase
      .from('branches').select('name').eq('region', 'Bangalore')
    const bangaloreNames = new Set((blrBranches || []).map(b => b.name))
    const isDetachable = (b) =>
      (b.stock_status === 'at_branch' || b.stock_status === 'at_ho') &&
      (bangaloreNames.has(b.current_branch) || bangaloreNames.has(b.branch_name))

    const ordered = attached
      .filter(b => isDetachable(b) && Number(b.net_weight || 0) > 0)
      .sort((a, b) => Number(a.net_weight || 0) - Number(b.net_weight || 0))
    const detachIds = []
    let cumulativeDetachedNet = 0
    for (const bill of ordered) {
      if (cumulativeDetachedNet >= excessNet) break
      detachIds.push(bill.id)
      detachedItems.push({
        id:             bill.id,
        application_id: bill.application_id,
        customer_name:  bill.customer_name,
        net_weight_g:   Number(bill.net_weight || 0),
      })
      cumulativeDetachedNet += Number(bill.net_weight || 0)
    }
    if (detachIds.length === 0) {
      // No Bangalore local bills available to free — leave the booking as-is
      // rather than touching in-transit / outstation weight.
      return { detached: [], residual_pipeline_g: 0, error: null }
    }
    const { error: detErr } = await supabase
      .from('purchases')
      .update({ booking_id: null, booked_at: null })
      .in('id', detachIds)
    if (detErr) {
      // Don't claim a detach happened if the UPDATE failed.
      return { detached: [], residual_pipeline_g: 0, error: detErr.message }
    }
    const newAttachedNet = attachedNet - cumulativeDetachedNet
    const newEffective   = newAttachedNet * (1 + gainRate)
    residualPipelineG    = Math.max(0, bookedWeight - newEffective)
  } catch (e) {
    return { detached: [], residual_pipeline_g: 0, error: e?.message || 'reconcile threw' }
  }
  return {
    detached:            detachedItems,
    residual_pipeline_g: Number(residualPipelineG.toFixed(3)),
    error:               null,
  }
}

// ── Split-allocation delta per booking ──────────────────────────────────────
// A bill split across bookings (see booking_split_allocations + the
// split_close_and_book action) contributes net grams to the pipeline booking
// it closed while giving up the same grams from its own (primary) booking. So
// a booking's TRUE sourced net = raw Σ(booking_id) + delta, where
//   delta(B) = Σ(net_g to_booking=B) − Σ(net_g from_booking=B).
// Returns { [bookingId]: deltaNet }. Delta is 0 for every normal whole-bill
// booking (no allocation rows). Degrades to {} if the table doesn't exist yet
// (migration not run) so callers never break.
async function allocDeltaByBooking(supabase, bookingIds) {
  const delta = {}
  const ids = [...new Set((bookingIds || []).filter(Boolean))]
  if (!ids.length) return delta
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100)
      // Two separate queries (not an or()) — PostgREST mis-parses uuid lists
      // with dashes inside or() expressions.
      const [outRes, inRes] = await Promise.all([
        supabase.from('booking_split_allocations').select('from_booking_id, net_g').in('from_booking_id', slice),
        supabase.from('booking_split_allocations').select('to_booking_id,   net_g').in('to_booking_id',   slice),
      ])
      if (outRes.error || inRes.error) {
        const msg = outRes.error?.message || inRes.error?.message || ''
        if (/does not exist/i.test(msg)) return {}   // table missing — treat as no splits
        continue
      }
      for (const a of outRes.data || []) delta[a.from_booking_id] = (delta[a.from_booking_id] || 0) - Number(a.net_g || 0)
      for (const a of inRes.data  || []) delta[a.to_booking_id]   = (delta[a.to_booking_id]   || 0) + Number(a.net_g || 0)
    }
  } catch { return {} }
  return delta
}

// ── Reopen a booking's pipeline after bills are detached ─────────────────────
// When bills are unbooked (e.g. they won't reach HO), the freed weight is gold
// the buyer is STILL owed — it must show as pipeline, not fold into gain. If the
// booking was fully sourced before (pipeline_closed_at set, or its arrival day
// passed), it would otherwise stay "settled" and the derived model reports the
// shortfall as gain (gain = weight − sourced). This recomputes the live sourced
// net (allocation-aware) and, when under-booked, clears pipeline_closed_at, sets
// pipeline_remaining_g, and keeps the arrival date non-past so the shortfall
// surfaces as an OPEN pipeline. Returns true if it reopened one.
async function reopenBookingPipeline(supabase, bookingId) {
  if (!bookingId) return false
  const { data: bk } = await supabase
    .from('cal_quotas')
    .select('id, weight, gain_rate, pending_g, is_kl, status, date, pipeline_arrival_date, pipeline_region, pipeline_closed_at')
    .eq('id', bookingId)
    .maybeSingle()
  if (!bk || bk.status === 'cancelled') return false
  const rate = bk.gain_rate != null ? Number(bk.gain_rate) : (bk.is_kl ? 0 : 0.035)
  const { data: bills } = await supabase.from('purchases').select('net_weight').eq('booking_id', bookingId)
  const attached = (bills || []).reduce((s, x) => s + Number(x.net_weight || 0), 0)
  const delta    = await allocDeltaByBooking(supabase, [bookingId])
  const sourced  = Math.max(0, attached + (delta[bookingId] || 0)) + Number(bk.pending_g || 0)
  const W        = Number(bk.weight || 0)
  const shortfall = W - sourced * (1 + rate)
  if (shortfall <= 0.001) return false   // still fully sourced — nothing to reopen
  const todayIst = istToday()
  const patch = {
    pipeline_remaining_g: Number(shortfall.toFixed(3)),
    pipeline_closed_at:   null,
    pipeline_region:      bk.pipeline_region || (bk.is_kl ? 'Kerala' : 'Bangalore'),
  }
  // Keep it unsettled so the shortfall reads as pipeline, not gain: if the
  // settle date has already passed, bump the pipeline arrival to today.
  const settleDate = bk.pipeline_arrival_date || bk.date
  if (!settleDate || String(settleDate) < todayIst) patch.pipeline_arrival_date = todayIst
  await supabase.from('cal_quotas').update(patch).eq('id', bookingId)
  return true
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req) {
  const body   = await req.json()
  // Accept `action` from EITHER the URL query string (the convention used
  // by every Bidding Volume client call — create_booking,
  // update_booking_status) OR the JSON body (older callers like
  // set_bidding_pending). Falling back to body keeps backwards compat
  // while letting query-style calls actually reach their handler — without
  // this fallback they all silently returned "Invalid action" (HTTP 400).
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || body.action

  // Bidding Volume writes mutate shared, money/inventory-affecting state
  // (the team-wide Pending pool number; financial booking commitments in
  // cal_quotas). They were previously ungated → ANY authenticated session
  // could POST them. Gate them by the SAME permission that controls who
  // can see the Bidding Volume page (page.consignment-bidding) rather than
  // a hardcoded role group — so the gate can never lock out whichever role
  // ops actually grant the page to (the KT §VII trap-2 lesson).
  const BIDDING_WRITES = new Set(['set_bidding_pending', 'create_booking', 'create_manual_booking', 'reconcile_booking', 'update_booking_status', 'close_booking_pipeline', 'toggle_bill_hold', 'unbook_bills', 'attach_selected_to_pipeline', 'lock_dates', 'unlock_dates'])
  let auth
  if (BIDDING_WRITES.has(action)) {
    auth = await requireAuthForPage(req, 'consignment-bidding')
  } else {
    // requireAuth always validates the bearer token; requiredRoles narrows
    // further for accounts/admin-only actions.
    const requiredRoles = ACTION_ROLE_REQUIREMENTS[action] || null
    auth = await requireAuth(req, { requiredRoles })
  }
  if (!auth.ok) return auth.response

  // Region scoping — same contract as GET. Some read-only POST actions
  // (e.g. bidding_stuck_summary) filter by branch, so they need this too;
  // null = no restriction (admin/founders or users without allowed_regions).
  const allowedRegions  = getRegionFilter(auth)
  const allowedBranches = allowedRegions ? await resolveAllowedBranchNames(supabase, auth) : null

  // Identity is now derived from the verified session — never from the body.
  // Callers can no longer spoof created_by / approver_email / cancelled_by.
  const actorEmail = auth.profile?.email || auth.user?.email || 'unknown'

  // ── Lock / unlock a purchase-date range (ops lock-out of booking) ─────────
  if (action === 'lock_dates') {
    const { from, to, note } = body
    if (!from || !to) return Response.json({ error: 'from and to (YYYY-MM-DD) required' }, { status: 400 })
    if (String(to) < String(from)) return Response.json({ error: 'to must be on/after from' }, { status: 400 })
    const { data, error } = await supabase
      .from('bidding_purchase_date_locks')
      .insert({ from_date: from, to_date: to, note: note ? String(note).trim() : null, locked_by: actorEmail })
      .select('id, from_date, to_date, note, locked_by, locked_at')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  }
  if (action === 'unlock_dates') {
    const { id } = body
    if (!id) return Response.json({ error: 'lock id required' }, { status: 400 })
    const { error } = await supabase.from('bidding_purchase_date_locks').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data: { unlocked: true } })
  }

  // ── Create consignment ───────────────────────────────────────────────────
  if (action === 'create_consignment') {
    const { purchase_ids, branch_name, movement_type, dest_branch, eway_bill_no } = body
    const created_by = actorEmail
    if (!purchase_ids?.length) return Response.json({ error: 'No purchases selected' }, { status: 400 })
    if (!branch_name)          return Response.json({ error: 'Branch name required' },  { status: 400 })

    // Cap consignment size. NIC E-Way Bill caps a single document at 250
    // line items; E-Invoice caps at 1000. INTERNAL (Branch → Hub) doesn't
    // hit either portal — only an Issue Voucher PDF — so it can run
    // unlimited. EXTERNAL (Branch → HO) needs the EWB, so respect NIC's
    // 250-line-item cap.
    //
    // The previous 100-bill cap was a guess at PDF readability, not a real
    // technical constraint. Ops asked for it lifted (Kerala hub dispatches
    // routinely run 100+ bills) and the Delivery Challan paginates fine
    // well beyond 100 rows.
    const isInternalCheck = movement_type === 'INTERNAL'
    const consignmentCap  = isInternalCheck ? Infinity : 250
    if (purchase_ids.length > consignmentCap) {
      return Response.json({
        error: `Too many bills (${purchase_ids.length}). NIC E-Way Bill caps a single document at 250 line items, so a Branch → HO consignment can carry at most 250 bills — split this into multiple consignments.`,
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

    // ── Pre-flight in-flight check ───────────────────────────────────────────
    // Same predicate the RPC uses, run BEFORE generateExternalNo so a
    // guaranteed-to-fail attempt does not burn a consignment_external_no_seq
    // value (Postgres sequences are non-transactional — nextval is never
    // rolled back). Without this, every retry leaves visible gaps in the
    // challan numbering. Catches bills whose stock_status was manually
    // flipped back to at_branch but whose parent consignment was never
    // cancelled (the WG000325 / TUMKUR pattern).
    const { data: inFlight } = await supabase
      .from('consignment_items')
      .select('purchase_id, consignments!inner(id, tmp_prf_no, consignment_no, status, eway_bill_no)')
      .in('purchase_id', purchase_ids)
      .not('consignments.status', 'in', '(cancelled,received)')
    if (inFlight && inFlight.length) {
      const parents = Array.from(new Set(inFlight.map(r => r.consignments?.consignment_no || r.consignments?.tmp_prf_no).filter(Boolean)))
      return Response.json({
        error: `${inFlight.length} bill(s) are still attached to an in-flight consignment (${parents.join(', ')}). Cancel that consignment first, then retry.`,
        stuck_parents: parents,
      }, { status: 409 })
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

    let tmpPrfNo = await generateTmpPrfNo(supabase, branch_name)

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
    //
    // RETRY-ON-CONFLICT: generateExternalNo / generateIssueVoucherNo /
    // generateTmpPrfNo all use a read-then-write pattern that races under
    // concurrent creates — two users see the same max value and pick the
    // same next number, then one of them 23505s on the unique constraint.
    // Detect that specific failure and regenerate fresh numbers + retry
    // (jittered backoff) so the user never sees a "duplicate key" error.
    let rpcConsignment = null
    let rpcErr         = null
    const MAX_RETRIES  = 5
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await supabase.rpc('create_consignment_atomic', {
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
      rpcConsignment = result.data
      rpcErr         = result.error

      // Unique-constraint collision on a number we generated → regenerate
      // fresh and retry. Postgres reports code='23505'; the message names
      // the constraint so we can scope the retry to number conflicts only
      // (other unique violations e.g. on the bills-already-in-flight check
      // should propagate immediately).
      const isNumberCollision = rpcErr?.code === '23505' && /consignment_no|external_no|challan_no|tmp_prf/i.test(rpcErr.message || '')
      if (!isNumberCollision || attempt >= MAX_RETRIES) break

      console.warn(`[create_consignment] number collision (attempt ${attempt}/${MAX_RETRIES}): ${rpcErr.message}`)
      await new Promise(r => setTimeout(r, 80 + Math.random() * 160))   // jittered backoff
      // Regenerate every sequenced field — collisions can happen on any of them.
      tmpPrfNo = await generateTmpPrfNo(supabase, branch_name)
      if (isInternal) {
        const r2 = await generateIssueVoucherNo(supabase, branchCode, stateCode)
        internalNo = r2.internalNo
        challan    = r2.voucher
      } else {
        const r2 = await generateExternalNo(supabase, branchCode, stateCode)
        extNo   = r2.extNo
        challan = r2.challan
      }
    }

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
    //
    // Also fold in the per-consignment Branch Contact override the operator
    // entered on the create modal (replaces the EWB-No input that used to
    // live there). Empty/missing → leave NULL so PDF generators fall back to
    // branches.contact_person / contact_phone at render time. Done in the
    // same fire-and-forget UPDATE to avoid an extra round-trip.
    const postCreatePatch = {
      ops_confirmed_at: new Date().toISOString(),
      ops_confirmed_by: auth.user?.id || null,
    }
    const ccName  = (typeof body.branch_contact_name  === 'string') ? body.branch_contact_name.trim().slice(0, 80) : ''
    const ccPhone = (typeof body.branch_contact_phone === 'string') ? body.branch_contact_phone.trim().slice(0, 24) : ''
    if (ccName)  postCreatePatch.branch_contact_name  = ccName
    if (ccPhone) postCreatePatch.branch_contact_phone = ccPhone

    supabase.from('consignments')
      .update(postCreatePatch)
      .eq('id', rpcConsignment.id)
      .then(() => {})
      .catch(() => {})

    // Per-consignment transporter (BVC / Branch Employee / Other) — a SEPARATE
    // fire-and-forget update so that if the transporter columns aren't deployed
    // yet (sql/consignment_transporter.sql), it no-ops without taking down the
    // ops_confirmed / branch-contact patch above. Empty → left NULL so the
    // Delivery Challan falls back to the company default (BVC).
    const transporter = (typeof body.transporter_name === 'string') ? body.transporter_name.trim().slice(0, 60) : ''
    const transMode   = (typeof body.transport_mode   === 'string') ? body.transport_mode.trim().slice(0, 40)   : ''
    if (transporter || transMode) {
      const tp = {}
      if (transporter) tp.transporter_name = transporter
      if (transMode)   tp.transport_mode   = transMode
      supabase.from('consignments').update(tp).eq('id', rpcConsignment.id).then(() => {}).catch(() => {})
    }

    // INTERNAL (Branch → Hub): bills become hub stock the moment the voucher
    // is created. Mirrors the Bangalore hub-create flow and the documented
    // model at the top of this handler — instantaneous transfer, no receive
    // step at hub. Flip current_branch → dest_branch so Branch Stock at the
    // hub immediately reflects the new bills, and the hub → HO consignment
    // created later finds them on the same-branch validation.
    //
    // Previously had a KL-specific revert here that forced status back to
    // 'dispatched'. That broke the model: bills got stuck on leaf →  hub
    // vouchers indefinitely because the hub had no way to receive them
    // (no "received at hub" workflow gate exists for KL today, by design).
    // Ops needs them auto-received so the hub → HO consignment can be
    // built. See sql/one-off-receive-stuck-kl-leaf-hub-vouchers.sql for
    // the cleanup of rows created under the previous behaviour.
    if (isInternal && dest_branch) {
      await supabase.from('purchases')
        .update({ current_branch: dest_branch })
        .in('id', purchase_ids)
    }

    // Stick the contact back onto the branch row so the NEXT create from
    // this branch pre-fills the modal with the last-used values, not the
    // original branch default. Spec from ops: "we can't expect the team to
    // re-type for every consignment." We only stick fields the operator
    // actually provided — empty input → keep whatever's already on the
    // branch. Fire-and-forget; this is a UX nicety, not a correctness gate.
    const branchPatch = {}
    if (ccName)  branchPatch.contact_person = ccName
    if (ccPhone) branchPatch.contact_phone  = ccPhone
    if (Object.keys(branchPatch).length > 0) {
      supabase.from('branches')
        .update(branchPatch)
        .eq('name', branch_name)
        .then(() => {})
        .catch(() => {})
    }

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

    // Approval is the moment bills physically leave the source branch — the
    // transition + stock movement live in one shared helper so an accounts
    // approval and an EWB-generate auto-approval can never move stock
    // differently. See lib/consignmentApproval.js.
    const { data, error } = await applyConsignmentApproval(supabase, {
      id,
      approverEmail: approver_email,
      eventType:     'approved_by_accounts',
      note:          note || null,
    })
    if (error) return Response.json({ error: error.message }, { status: 500 })
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

  // ── Ops self-service cancellation ────────────────────────────────────────
  // Ops cancels a consignment directly (no accounts approval step). Behaviour
  // scales with how far the consignment got:
  //   • no gov doc (EWB/E-Invoice not generated) → just void, bills return.
  //   • gov doc generated → best-effort cancel it on NIC/IRP, AND email accounts
  //     (Rudresh/Sunay) the doc as a precaution so they remove it on the portal
  //     manually. Portal failure NEVER blocks the void — the accounts mail is the
  //     safety net.
  //   • branch was already emailed the docs → also email the branch that the
  //     consignment is cancelled and its documents are no longer valid.
  if (action === 'ops_cancel_consignment') {
    const { id, reason } = body
    if (!id || !reason || !String(reason).trim()) return Response.json({ error: 'Reason is required' }, { status: 400 })

    const { data: c, error: fErr } = await supabase.from('consignments').select('*').eq('id', id).single()
    if (fErr || !c)               return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (c.status === 'cancelled') return Response.json({ error: 'Already cancelled' }, { status: 400 })

    const cleanReason = String(reason).trim()
    const isInternal  = c.movement_type === 'INTERNAL'
    const gstKind     = c.eway_bill_no ? 'ewb' : c.irn ? 'einvoice' : null
    const gstLabel    = gstKind === 'ewb' ? 'E-Way Bill' : gstKind === 'einvoice' ? 'E-Invoice' : null
    const dest        = isInternal ? (c.dest_branch || 'Hub') : 'Head Office'
    const dateStr     = c.created_at
      ? new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
      : ''

    const { data: branch } = await supabase
      .from('branches').select('name, region, branch_gstin, contact_email').eq('name', c.branch_name).maybeSingle()

    // Was the branch already emailed the documents? (documents_emailed is a log
    // event, not a column.)
    let mailSent = false
    try {
      const { data: em } = await supabase.from('consignment_activity_log')
        .select('id').eq('consignment_id', id).eq('event_type', 'documents_emailed').limit(1)
      mailSent = !!(em && em.length)
    } catch {}

    const origin  = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/+$/, '')
    const authHdr = req.headers.get('authorization') || ''

    // 1) Government doc: grab the PDF (while the numbers are still on the row) for
    //    the accounts email, then attempt the portal cancel (best-effort).
    let gstPdf = null, portalCancelled = false, portalError = null
    if (gstKind) {
      try {
        const path = gstKind === 'ewb' ? `/api/eway-bill/pdf?id=${id}` : `/api/e-invoice/pdf?id=${id}`
        const pres = await fetch(`${origin}${path}`, { headers: { authorization: authHdr } })
        if (pres.ok) gstPdf = {
          filename:    docFilename({ consignment: c, branch: branch || { name: c.branch_name }, docType: gstKind === 'ewb' ? 'ewb' : 'einvoice', ext: 'pdf' }),
          content:     Buffer.from(await pres.arrayBuffer()),
          contentType: 'application/pdf',
        }
      } catch (e) { console.error('[ops_cancel] gst pdf fetch failed:', e?.message) }

      const { data: cs } = await supabase.from('company_settings').select('*').single()
      const stateCode  = REGION_TO_STATE_CODE[branch?.region]
      const stateGstin = stateCode ? cs?.[`gstin_${stateCode.toLowerCase()}`] : null
      const gstinFor   = c.source_gstin || stateGstin || branch?.branch_gstin || process.env.WG_GSTIN
      try {
        if (gstKind === 'ewb') await cancelEWayBill({ ewbNumber: c.eway_bill_no, reasonCode: '2', remark: cleanReason.slice(0, 100), gstinOverride: gstinFor })
        else                   await cancelEInvoice({ irn: c.irn,            reasonCode: '2', remark: cleanReason.slice(0, 100), gstinOverride: gstinFor })
        portalCancelled = true
      } catch (e) { portalError = e?.message || 'portal cancel failed' }
    }

    // 2) Void the consignment — bills return to the source branch.
    const composedReason = `Cancelled by operations (${actorEmail}). Reason: ${cleanReason}`
    const { error: rpcErr } = await supabase.rpc('cancel_consignment_atomic', { p_consignment_id: id, p_reason: composedReason, p_cancelled_by: actorEmail })
    if (rpcErr && rpcErr.code !== 'PGRST202') return Response.json({ error: rpcErr.message }, { status: 400 })
    if (rpcErr) {
      const { data: links } = await supabase.from('consignment_items').select('purchase_id').eq('consignment_id', id)
      const pids = (links || []).map(l => l.purchase_id)
      if (pids.length) await supabase.from('purchases').update({ stock_status: 'at_branch', current_branch: c.branch_name }).in('id', pids)
      await supabase.from('consignments').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: actorEmail, cancellation_reason_final: composedReason }).eq('id', id)
    }

    // 3) Flip approval to rejected (keeps it off the Approved tab + reads as a
    //    cancellation, not an accounts rejection). Clear any stale request flags.
    //    Clear the portal-doc numbers only if the portal cancel actually
    //    succeeded; otherwise keep them so accounts can find the doc to remove.
    const cancelledDoc = c.irn ? 'E-Invoice' : c.eway_bill_no ? 'E-Way Bill' : 'consignment'
    const upd = {
      approval_status:  'rejected',
      rejection_reason: `Rejected because of cancellation of ${cancelledDoc}`,
      approved_at:      new Date().toISOString(),
      approved_by:      actorEmail,
      cancellation_requested_at: null,
      cancellation_reason:       null,
      cancellation_requested_by: null,
    }
    if (portalCancelled) {
      if (c.eway_bill_no) { upd.eway_bill_no = null; upd.ewb_valid_until = null; upd.ewb_generated_at = null; upd.ewb_generation_started_at = null }
      if (c.irn)          { upd.irn = null; upd.ack_no = null; upd.ack_dt = null; upd.signed_qr_code = null; upd.einvoice_generated_at = null }
    }
    await supabase.from('consignments').update(upd).eq('id', id)

    // 4) Emails (best-effort — never block the cancel).
    const senderName  = (auth.profile?.full_name || '').trim() || (auth.profile?.email || '').split('@')[0] || 'White Gold'
    const senderEmail = (auth.profile?.email || '').trim() || undefined
    const emailsSent  = []
    if (mailConfigured()) {
      // 4a) Accounts precautionary email — only when a gov doc existed.
      if (gstKind) {
        const docNo = gstKind === 'ewb' ? c.eway_bill_no : (c.einvoice_doc_no || c.irn)
        const actionLine = portalCancelled
          ? `The system reported the ${gstLabel} was cancelled on the portal. Please VERIFY on the government portal and remove it manually if it still shows active.`
          : `The system could NOT auto-cancel the ${gstLabel} on the portal (${portalError || 'reason unknown'}). Please cancel / delete it on the government portal MANUALLY.`
        const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.55">
          <p>Team,</p>
          <p>Consignment <b>${c.tmp_prf_no}</b> (${c.branch_name} &rarr; ${dest}${dateStr ? `, ${dateStr}` : ''}) has been <b>cancelled</b> by operations.</p>
          <table style="border-collapse:collapse;font-size:13px;margin:8px 0">
            <tr><td style="padding:2px 14px 2px 0;color:#666">${gstLabel}</td><td><b>${docNo || '—'}</b></td></tr>
            <tr><td style="padding:2px 14px 2px 0;color:#666">Reason</td><td>${cleanReason}</td></tr>
            <tr><td style="padding:2px 14px 2px 0;color:#666">Cancelled by</td><td>${senderName}</td></tr>
          </table>
          <p><b>Action needed:</b> ${actionLine}</p>
          <p>The ${gstLabel} is attached for reference.</p>
        </div>`
        try {
          await sendMail({ to: ACCOUNTS_CANCEL_CC, subject: `White Gold · ${c.tmp_prf_no} cancelled · ${gstLabel} to be removed from portal`, html, attachments: gstPdf ? [gstPdf] : undefined, fromName: senderName, replyTo: senderEmail })
          emailsSent.push('accounts')
        } catch (e) { console.error('[ops_cancel] accounts email failed:', e?.message) }
      }
      // 4b) Branch notice — only if the branch was already emailed the docs.
      if (mailSent && branch?.contact_email) {
        const docList = `Consignee Report, ${isInternal ? 'Issue Voucher' : 'Delivery Challan'}${gstLabel ? `, ${gstLabel}` : ''}`
        const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.55">
          <p>Hello ${c.branch_name} team,</p>
          <p>The consignment <b>${c.tmp_prf_no}</b>${dateStr ? ` dated ${dateStr}` : ''} that we emailed you earlier has been <b>CANCELLED</b>.</p>
          <p>The documents sent for it (${docList}) are <b>no longer valid</b> — please do not act on them or hand over any stock against them. A fresh consignment and a new set of documents will follow in a separate email.</p>
          <p style="color:#888;font-size:12px">Sent by ${senderName} · White Gold consignment system.</p>
        </div>`
        try {
          await sendMail({ to: branch.contact_email, subject: `White Gold · ${c.tmp_prf_no} CANCELLED — documents no longer valid`, html, fromName: senderName, replyTo: senderEmail })
          emailsSent.push('branch')
        } catch (e) { console.error('[ops_cancel] branch email failed:', e?.message) }
      }
    }

    // 5) Audit. When the portal doc was actually cancelled, also log the
    //    standard ewb_cancelled / einvoice_cancelled event so it shows on the
    //    accounts Cancellations tab (same as the old accounts-driven flow). If
    //    the portal cancel failed, we DON'T log it — the doc is still live and
    //    surfaces on the portal-cleanup banner + the accounts email instead.
    if (gstKind && portalCancelled) {
      await logConsignmentEvent(supabase, {
        consignment_id: id,
        event_type:  gstKind === 'ewb' ? 'ewb_cancelled' : 'einvoice_cancelled',
        actor_email: actorEmail,
        actor_role:  auth.role,
        details:     { [gstKind === 'ewb' ? 'ewb_no' : 'irn']: gstKind === 'ewb' ? c.eway_bill_no : c.irn, via: 'ops_cancel', reason: cleanReason },
      })
    }
    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'cancelled_by_ops',
      actor_email:    actorEmail,
      actor_role:     auth.role,
      details:        { reason: cleanReason, gst_kind: gstKind, portal_cancelled: portalCancelled, portal_error: portalError, mail_sent_to_branch: mailSent, emails_sent: emailsSent, eway_bill_no: c.eway_bill_no || null, irn: c.irn || null },
    })

    return Response.json({ ok: true, message: 'Consignment cancelled. Bills returned to branch.', portal_cancelled: portalCancelled, portal_error: portalError, emails_sent: emailsSent, gst_kind: gstKind })
  }

  // ── Approve a pending cancellation request (accounts side) ───────────────
  // Three-step flow done server-side so accounts never needs to leave the app:
  //   1. Cancel the EWB on NIC (if one was generated). Hard failure stops the
  //      whole approval — operations team can inspect the error and retry.
  //   2. Cancel the IRN on IRP (if one was generated). Same hard-fail policy.
  //   3. Void the consignment via cancel_consignment_atomic (frees bills,
  //      marks status='cancelled' in a single txn).
  // Audit log entries written at each step so the timeline reads sequentially.
  if (action === 'approve_cancellation') {
    const { id, force_local } = body
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

    const { data: c, error: fetchErr } = await supabase
      .from('consignments').select('*').eq('id', id).single()
    if (fetchErr || !c)              return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!c.cancellation_requested_at) return Response.json({ error: 'No cancellation request on this consignment' }, { status: 400 })
    if (c.status === 'cancelled')    return Response.json({ error: 'Already cancelled' }, { status: 400 })

    // GSTIN MUST match the one that GENERATED the EWB / IRN. Re-resolving from
    // current company_settings risks drift (state-wise GSTIN may have been
    // edited since generation), and NIC/IRP then reject with "Valid Irn
    // missing (107)" because the IRN doesn't belong to the GSTIN we present.
    // source_gstin is the authoritative snapshot frozen at create time —
    // same priority order as lib/clearTaxClient.buildPayload.
    const { data: branch } = await supabase
      .from('branches').select('branch_gstin, region').eq('name', c.branch_name).single()
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const stateCode  = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinFor   = c.source_gstin || stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    const HOUR_MS = 3600 * 1000
    const WINDOW  = 24 * HOUR_MS
    const now     = Date.now()
    const composedReason = force_local
      ? `Force-cancelled locally by accounts (${actorEmail}). Portal docs left untouched. Operations reason: ${c.cancellation_reason || '—'}`
      : `Approved by accounts (${actorEmail}). Operations reason: ${c.cancellation_reason || '—'}`
    const portalCancelled = []  // tracks what we cancelled for the audit + UI

    // STEP 1 — EWB on NIC
    // Force-local mode: skip the portal calls entirely and jump straight to
    // local void. EWB/IRN remain "active" on NIC/IRP; accounts must verify
    // and handle there manually (or via a credit note for IRN-past-24h).
    if (c.eway_bill_no && !force_local) {
      // Sanity check: is the 24h NIC window even open? request_cancellation
      // already gated this when the request was filed, but the request might
      // have been sitting in the queue for hours. Re-check at approval time.
      const ewbAge = c.ewb_generated_at ? now - new Date(c.ewb_generated_at).getTime() : Infinity
      if (ewbAge >= WINDOW) {
        return Response.json({
          error: `E-Way Bill cancel window has closed (>24h since generation). NIC cannot cancel ${c.eway_bill_no} anymore. Generate a fresh consignment with the corrected bills.`,
        }, { status: 400 })
      }
      try {
        const nicResult = await cancelEWayBill({
          ewbNumber:     c.eway_bill_no,
          reasonCode:    '2', // 2 = Order Cancelled (best fit for ops-requested cancellation)
          remark:        String(c.cancellation_reason || 'Operations cancellation request').slice(0, 100),
          gstinOverride: gstinFor,
        })
        // Soft-success path: NIC said the EWB is no longer active (107 after
        // retries). Log under the standard ewb_cancelled type so the
        // Cancellations tab picks it up; flag the not_active_at_nic detail so
        // anyone auditing can see NIC didn't actively confirm.
        if (nicResult?.ewb_not_found) {
          await logConsignmentEvent(supabase, {
            consignment_id: id,
            event_type:     'ewb_cancelled',
            actor_email:    actorEmail,
            actor_role:     auth.role,
            details: {
              ewb_no:                c.eway_bill_no,
              reason_code:           '2',
              remark:                c.cancellation_reason || 'Operations cancellation request',
              triggered_by:          'approve_cancellation',
              not_active_at_nic:     true,
              not_active_reason:     'NIC returned 107 (EWB not recognised) — treated as already cancelled upstream',
              raw_nic_response:      nicResult?.raw,
            },
          })
          portalCancelled.push(`EWB ${c.eway_bill_no} was already not active at NIC`)
        } else {
          const govtResp = nicResult?.govt_response || nicResult?.data?.govt_response || nicResult?.response?.govt_response || nicResult
          await logConsignmentEvent(supabase, {
            consignment_id: id,
            event_type:     'ewb_cancelled',
            actor_email:    actorEmail,
            actor_role:     auth.role,
            details: {
              ewb_no:     c.eway_bill_no,
              reason_code:'2',
              remark:     c.cancellation_reason || 'Operations cancellation request',
              nic_ack:    govtResp,
              triggered_by: 'approve_cancellation',
            },
          })
          portalCancelled.push(`EWB ${c.eway_bill_no} cancelled on NIC`)
        }
      } catch (err) {
        console.error('[approve_cancellation] NIC EWB cancel failed:', err, JSON.stringify(err?.cleartaxResponse))
        // Unpack the NIC diagnostic the ClearTax client attaches as a
        // non-enumerable property on the Error object (`err.cleartaxResponse`,
        // see lib/clearTaxClient.js attachDebug). Without this, accounts
        // sees "Failed to cancel E-Way Bill" — no code, no reason — and has
        // no way to tell whether it's a 24h-window expiry (need Force Cancel
        // Local), a GSTIN mismatch (Company Settings fix), a transient NIC
        // outage (retry), or a real EWB-side rejection.
        //
        // Note: the property is NON-enumerable so JSON.stringify(err) hides
        // it. Read it directly. Earlier code looked at err.debug.* and
        // always got undefined.
        const nicResponse = err?.cleartaxResponse
        const firstResp   = Array.isArray(nicResponse) ? nicResponse[0] : nicResponse
        const govt        = firstResp?.govt_response
        // ClearTax returns errorDetails as EITHER an array (NIC's preferred
        // shape when forwarding NIC's own response) OR a single object (when
        // ClearTax does its own pre-NIC validation and bounces the payload).
        // Normalize to an array so the same map() works on both.
        const rawDetails =
          govt?.ErrorDetails || govt?.errorDetails ||
          firstResp?.ErrorDetails || firstResp?.errorDetails ||
          nicResponse?.ErrorDetails || nicResponse?.errorDetails
        const errorDetails = rawDetails == null ? null
          : Array.isArray(rawDetails) ? rawDetails
          : [rawDetails]
        const nicErrorCode = errorDetails
          ? errorDetails.map(e => e?.error_code   || e?.errorCode).filter(Boolean).join(', ')
          : (govt?.error_code || firstResp?.error_code || null)
        const nicErrorMsg  = errorDetails
          ? errorDetails.map(e => e?.error_message || e?.errorMessage || e?.message).filter(Boolean).join('; ')
          : (govt?.info || govt?.status_desc || firstResp?.message || firstResp?.status_desc || null)
        const ewbAgeMs     = c.ewb_generated_at ? (Date.now() - new Date(c.ewb_generated_at).getTime()) : null
        const ewbAgeHours  = ewbAgeMs != null ? Number((ewbAgeMs / 3600000).toFixed(1)) : null
        let hint = null
        if (ewbAgeHours != null && ewbAgeHours > 24) {
          hint = `EWB ${c.eway_bill_no} is ${ewbAgeHours}h old — NIC only allows cancellation within 24 hours of generation. An admin can use Force Cancel (Local) on the Approvals → Approved tab row for ${c.tmp_prf_no} to clear the consignment without touching NIC; the EWB will expire on NIC naturally.`
        }
        const reasonLine = nicErrorMsg
          ? `NIC said: ${nicErrorMsg}${nicErrorCode ? ` (code ${nicErrorCode})` : ''}.`
          : (err?.message || 'unknown error')
        // PERSIST the failure. This used to go only to the Railway console, so the
        // real NIC reason was lost the moment the tab closed — which is how we ended
        // up with a generic "Failed to cancel E-Way Bill" and a pointless force-local.
        await logConsignmentEvent(supabase, {
          consignment_id: id,
          event_type:     'ewb_cancel_failed',
          actor_email:    actorEmail,
          actor_role:     auth.role,
          details: {
            ewb_no: c.eway_bill_no, nic_error_code: nicErrorCode || null,
            nic_error_message: nicErrorMsg || null, ewb_age_hours: ewbAgeHours,
            error: err?.message || String(err), raw_response: nicResponse ?? null,
          },
        })
        return Response.json({
          error:           `Could not cancel the E-Way Bill on NIC. ${reasonLine}${hint ? `\n\n${hint}` : ' Nothing has been changed. Try again or escalate if NIC is down.'}`,
          nic_error_code:  nicErrorCode || null,
          nic_error_text:  nicErrorMsg  || null,
          nic_raw:         nicResponse  || null,
          ewb_age_hours:   ewbAgeHours,
          hint,
          can_force_local: true,
        }, { status: 502 })
      }
    }

    // STEP 2 — IRN on IRP
    if (c.irn && !force_local) {
      const irnAge = c.einvoice_generated_at ? now - new Date(c.einvoice_generated_at).getTime() : Infinity
      if (irnAge >= WINDOW) {
        return Response.json({
          error: 'E-Invoice cancel window has closed (>24h since generation). IRP cannot cancel this IRN anymore. A credit note is required instead.',
        }, { status: 400 })
      }
      try {
        const irpResult = await cancelEInvoice({
          irn:           c.irn,
          reasonCode:    '1', // 1 = Duplicate (IRP's default; "Order Cancelled" isn't a standard code there)
          remark:        String(c.cancellation_reason || 'Operations cancellation request').slice(0, 100),
          gstinOverride: gstinFor,
        })
        // Soft-success path: IRP said the IRN is no longer active (107 after
        // retries). Log under the standard einvoice_cancelled type so the
        // Cancellations tab picks it up; flag the not_active_at_irp detail
        // so anyone auditing can see IRP didn't actively confirm.
        if (irpResult?.irp_not_found) {
          await logConsignmentEvent(supabase, {
            consignment_id: id,
            event_type:     'einvoice_cancelled',
            actor_email:    actorEmail,
            actor_role:     auth.role,
            details: {
              irn:                   c.irn,
              reason_code:           '1',
              remark:                c.cancellation_reason || 'Operations cancellation request',
              triggered_by:          'approve_cancellation',
              not_active_at_irp:     true,
              not_active_reason:     'IRP returned 107 (IRN not recognised) — treated as already cancelled upstream',
              raw_irp_response:      irpResult?.raw,
            },
          })
          portalCancelled.push(`E-Invoice was already not active at IRP`)
        } else {
          const govtResp = irpResult?.govt_response || irpResult?.data?.govt_response || irpResult?.response?.govt_response || irpResult
          await logConsignmentEvent(supabase, {
            consignment_id: id,
            event_type:     'einvoice_cancelled',
            actor_email:    actorEmail,
            actor_role:     auth.role,
            details: {
              irn:        c.irn,
              reason_code:'1',
              remark:     c.cancellation_reason || 'Operations cancellation request',
              irp_ack:    govtResp,
              triggered_by: 'approve_cancellation',
            },
          })
          portalCancelled.push('E-Invoice cancelled on IRP')
        }
      } catch (err) {
        console.error('[approve_cancellation] IRP E-Invoice cancel failed:', err, JSON.stringify(err?.cleartaxResponse))
        // EWB may have already been cancelled by this point — that's an
        // inconsistent state. Tell the user precisely so they can decide.
        const ewbNote = portalCancelled.length
          ? ` Note: the E-Way Bill was already cancelled on NIC. The consignment has NOT been voided.`
          : ''
        // Extract IRP diagnostics from the ClearTax client's attached debug
        // payload — same pattern as the EWB catch above. Lets the UI show
        // "IRP said: <message> (code N)" plus age + a Force Cancel Local
        // escape hatch instead of the bare error string.
        const irpResponse  = err?.cleartaxResponse
        const firstResp    = Array.isArray(irpResponse) ? irpResponse[0] : irpResponse
        const govt         = firstResp?.govt_response
        const rawDetails   =
          govt?.ErrorDetails || govt?.errorDetails ||
          firstResp?.ErrorDetails || firstResp?.errorDetails ||
          irpResponse?.ErrorDetails || irpResponse?.errorDetails
        const errorDetails = rawDetails == null ? null
          : Array.isArray(rawDetails) ? rawDetails
          : [rawDetails]
        const irpErrorCode = errorDetails
          ? errorDetails.map(e => e?.error_code   || e?.errorCode).filter(Boolean).join(', ')
          : (govt?.error_code || firstResp?.error_code || null)
        const irpErrorMsg  = errorDetails
          ? errorDetails.map(e => e?.error_message || e?.errorMessage || e?.message).filter(Boolean).join('; ')
          : (govt?.info || govt?.status_desc || firstResp?.message || firstResp?.status_desc || null)
        const irnAgeMs     = c.einvoice_generated_at ? (Date.now() - new Date(c.einvoice_generated_at).getTime()) : null
        const irnAgeHours  = irnAgeMs != null ? Number((irnAgeMs / 3600000).toFixed(1)) : null
        const reasonLine   = irpErrorMsg
          ? `IRP said: ${irpErrorMsg}${irpErrorCode ? ` (code ${irpErrorCode})` : ''}.`
          : (err?.message || 'unknown error')
        const hint = `An admin can use Force Cancel (Local) to clear this consignment without touching IRP — the IRN ${c.irn} will remain on IRP unless accounts handles it there directly (cancel within 24h or issue a credit note).`
        return Response.json({
          error:           `Could not cancel the E-Invoice on IRP. ${reasonLine}${ewbNote}\n\n${hint}`,
          irp_error_code:  irpErrorCode || null,
          irp_error_text:  irpErrorMsg  || null,
          irp_raw:         irpResponse  || null,
          irn_age_hours:   irnAgeHours,
          hint,
          can_force_local: true,
        }, { status: 502 })
      }
    }

    // STEP 3 — Void the consignment locally (free bills, flip status)
    const { data: rpcCancelled, error: rpcCancelErr } = await supabase.rpc('cancel_consignment_atomic', {
      p_consignment_id: id,
      p_reason:         composedReason,
      p_cancelled_by:   actorEmail,
    })
    if (rpcCancelErr && rpcCancelErr.code !== 'PGRST202') {
      return Response.json({ error: rpcCancelErr.message }, { status: 400 })
    }
    if (rpcCancelErr) {
      // RPC missing — manual fallback.
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

    // Clear the portal-doc fields locally so the UI stops showing them as active.
    //
    // NEVER do this on a FORCE-LOCAL cancel. In that path we deliberately skipped
    // NIC/IRP, so the EWB / IRN is STILL LIVE on the government portal — wiping the
    // number here would destroy the only reference anyone could use to go cancel it
    // there, leaving an active E-Way Bill with no matching movement and no record of
    // it on our side. Keep the numbers; the row is already marked cancelled, so the
    // UI shows it as cancelled either way, and accounts retains what it needs to
    // clean up the portal (or let the EWB expire).
    const clearUpdate = {}
    if (!force_local) {
      if (c.eway_bill_no) {
        clearUpdate.eway_bill_no = null
        clearUpdate.ewb_valid_until = null
        clearUpdate.ewb_generated_at = null
        clearUpdate.ewb_generation_started_at = null
      }
      if (c.irn) {
        clearUpdate.irn = null
        clearUpdate.ack_no = null
        clearUpdate.ack_dt = null
        clearUpdate.signed_qr_code = null
        clearUpdate.einvoice_generated_at = null
      }
      if (Object.keys(clearUpdate).length) {
        await supabase.from('consignments').update(clearUpdate).eq('id', id)
      }
    }

    // Flip approval_status to 'rejected' — the RPC only sets status='cancelled',
    // it never touches approval_status. Without this the row keeps
    // approval_status='approved' and leaks into the Approved tab even though it's
    // cancelled (worse on force-local, where the IRN/EWB is deliberately kept, so
    // the "has a doc" filter also still matches). The standard
    // "Rejected because of cancellation of…" reason additionally keeps it OFF the
    // Rejected tab (that query excludes this prefix), so it surfaces only on the
    // Cancellations tab — same convention as the eway-bill/cancel + e-invoice/cancel
    // routes.
    const cancelledDoc = c.irn ? 'E-Invoice' : c.eway_bill_no ? 'E-Way Bill' : 'consignment'
    await supabase.from('consignments')
      .update({
        approval_status:  'rejected',
        rejection_reason: `Rejected because of cancellation of ${cancelledDoc}`,
        approved_at:      new Date().toISOString(),
        approved_by:      actorEmail,
      })
      .eq('id', id)

    // What is still live on the portal after this cancel? Force-local always leaves
    // the doc standing; the normal path leaves nothing.
    const stillLiveOnPortal = force_local
      ? [c.eway_bill_no ? `EWB ${c.eway_bill_no}` : null, c.irn ? `IRN ${c.irn}` : null].filter(Boolean)
      : []

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     force_local ? 'cancellation_forced_local' : 'cancellation_approved',
      actor_email:    actorEmail,
      actor_role:     auth.role,
      details: {
        operations_reason: c.cancellation_reason,
        requested_by:      c.cancellation_requested_by,
        requested_at:      c.cancellation_requested_at,
        portal_cancelled:  portalCancelled,
        // The whole point of the force-local escape hatch: these documents are
        // STILL VALID on NIC/IRP. Recorded so an auditor can always find them.
        portal_still_live: stillLiveOnPortal,
        forced_local:      !!force_local,
        eway_bill_no:      c.eway_bill_no || null,
        irn:               c.irn || null,
      },
    })

    // Compose a user-facing message that names what was cancelled where — and,
    // crucially, what was NOT. A bare "Cancellation approved." on a force-local
    // cancel reads as success when the E-Way Bill is still live on NIC.
    const parts = []
    if (force_local) {
      parts.push('Cancelled in GoldApp only. Bills returned to source branch.')
      if (stillLiveOnPortal.length) {
        parts.push(`⚠ ${stillLiveOnPortal.join(' and ')} is STILL ACTIVE on the portal — cancel it on NIC/IRP or let it expire. The number has been kept on this consignment.`)
      }
    } else {
      parts.push('Cancellation approved.', 'Bills returned to source branch.')
      if (portalCancelled.length) parts.push(portalCancelled.join(' · ') + '.')
    }

    return Response.json({
      data:              rpcCancelled || { id, status: 'cancelled' },
      message:           parts.join(' '),
      forced_local:      !!force_local,
      portal_still_live: stillLiveOnPortal,
    })
  }

  // ── Retry the PORTAL cancellation for a consignment already cancelled here ──
  // The force-local escape hatch cancels in GoldApp but leaves the EWB/IRN LIVE on
  // NIC/IRP. That is not a cancellation — it just makes us disagree with the
  // government, and it dumps the real work on accounts (go cancel it on the portal
  // by hand). This action closes that loop: it re-attempts the NIC/IRP cancel from
  // the app for a consignment whose portal doc is still standing, and only clears
  // the local doc fields once the portal actually confirms.
  //
  // NIC still enforces its own 24h window — if that has closed, the EWB genuinely
  // cannot be cancelled and can only expire. We say so explicitly rather than
  // pretending.
  if (action === 'retry_portal_cancel') {
    const { id } = body
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

    const { data: c, error: fErr } = await supabase.from('consignments').select('*').eq('id', id).single()
    if (fErr || !c)                    return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!c.eway_bill_no && !c.irn)     return Response.json({ error: 'Nothing left on the portal for this consignment.' }, { status: 400 })

    const { data: branch } = await supabase.from('branches').select('branch_gstin, region').eq('name', c.branch_name).single()
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const stateCode  = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinFor   = c.source_gstin || stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    const cleared = {}
    const done    = []

    if (c.eway_bill_no) {
      const ageMs = c.ewb_generated_at ? Date.now() - new Date(c.ewb_generated_at).getTime() : null
      const ageH  = ageMs != null ? ageMs / 3600000 : null
      if (ageH != null && ageH >= 24) {
        return Response.json({
          error: `NIC's 24h cancel window has closed (EWB is ${ageH.toFixed(1)}h old). ${c.eway_bill_no} can no longer be cancelled on NIC — it will expire on its own. Nothing to do on the portal.`,
          window_closed: true,
        }, { status: 400 })
      }
      try {
        const r = await cancelEWayBill({
          ewbNumber:     c.eway_bill_no,
          reasonCode:    '2',
          remark:        String(c.cancellation_reason || 'Consignment cancelled').slice(0, 100),
          gstinOverride: gstinFor,
        })
        cleared.eway_bill_no = null
        cleared.ewb_valid_until = null
        cleared.ewb_generated_at = null
        cleared.ewb_generation_started_at = null
        done.push(`EWB ${c.eway_bill_no} cancelled on NIC`)
        await logConsignmentEvent(supabase, {
          consignment_id: id, event_type: 'ewb_cancelled', actor_email: actorEmail, actor_role: auth.role,
          details: { ewb_no: c.eway_bill_no, via: 'retry_portal_cancel', not_active_at_nic: !!r?.ewb_not_found },
        })
      } catch (e) {
        // PERSIST the failure. Previously this only hit the Railway console, so the
        // real NIC reason was lost and accounts was left with "Failed to cancel".
        const raw   = e?.cleartaxResponse
        const first = Array.isArray(raw) ? raw[0] : raw
        const govt  = first?.govt_response
        const rawD  = govt?.ErrorDetails || govt?.errorDetails || first?.ErrorDetails || first?.errorDetails
        const dets  = rawD == null ? null : (Array.isArray(rawD) ? rawD : [rawD])
        const code  = dets ? dets.map(x => x?.error_code || x?.errorCode).filter(Boolean).join(', ') : (govt?.error_code || null)
        const msg   = dets ? dets.map(x => x?.error_message || x?.errorMessage || x?.message).filter(Boolean).join('; ')
                           : (govt?.info || govt?.status_desc || null)
        await logConsignmentEvent(supabase, {
          consignment_id: id, event_type: 'ewb_cancel_failed', actor_email: actorEmail, actor_role: auth.role,
          details: { ewb_no: c.eway_bill_no, nic_error_code: code || null, nic_error_message: msg || null,
                     error: e?.message || String(e), raw_response: raw ?? null },
        })
        return Response.json({
          error: `NIC refused to cancel EWB ${c.eway_bill_no}${code ? ` (${code})` : ''}: ${msg || e?.message || 'no reason returned'}`,
          nic_error_code: code || null,
          nic_error_message: msg || null,
        }, { status: 502 })
      }
    }

    if (c.irn) {
      try {
        await cancelEInvoice({ irn: c.irn, reasonCode: '2', remark: String(c.cancellation_reason || 'Consignment cancelled').slice(0, 100), gstinOverride: gstinFor })
        cleared.irn = null; cleared.ack_no = null; cleared.ack_dt = null
        cleared.signed_qr_code = null; cleared.einvoice_generated_at = null
        done.push(`IRN cancelled on IRP`)
        await logConsignmentEvent(supabase, {
          consignment_id: id, event_type: 'einvoice_cancelled', actor_email: actorEmail, actor_role: auth.role,
          details: { irn: c.irn, via: 'retry_portal_cancel' },
        })
      } catch (e) {
        return Response.json({ error: `IRP refused to cancel the IRN: ${e?.message || e}` }, { status: 502 })
      }
    }

    if (Object.keys(cleared).length) await supabase.from('consignments').update(cleared).eq('id', id)
    return Response.json({ data: { id }, message: `${done.join(' · ')}. Portal is now in sync — no manual action needed.` })
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

  // ── Bidding bookings: create + status transitions ────────────────────────
  // Rows live in cal_quotas (same table CalTable's Quotas tab uses), so a
  // booking created here automatically appears for allocation on the
  // arrival date. Status flow: booked → confirmed → fulfilled, with a
  // separate cancelled state that voids the row from the active pool.

  // ── Set Pending Delivery carry-over for an arrival date ──────────────────
  // Shared, server-side. Signed value (can be negative). Upsert keyed on
  // arrival_date so re-saving the same date overwrites rather than stacking.
  // ── Toggle a bill's audit_hold flag ──────────────────────────────────────
  // A held Bangalore Section 1 bill stays visible in the picker but is
  // skipped by the 23:30 audit — it won't be swept into open bookings'
  // pipeline NOR attributed to gain. Use cases: quality dispute, intentional
  // roll-forward to tomorrow's bid.
  //
  // Constrained to bills that aren't already attached to a booking
  // (booking_id IS NULL) and haven't been audit-consumed yet — once either
  // happens, the hold is moot.
  if (action === 'toggle_bill_hold') {
    const { bill_id, hold } = body
    if (!bill_id)                       return Response.json({ error: 'bill_id required' }, { status: 400 })
    if (typeof hold !== 'boolean')      return Response.json({ error: 'hold must be boolean' }, { status: 400 })

    const { data: bill, error: fErr } = await supabase
      .from('purchases')
      .select('id, booking_id, audit_consumed_at, branch_name, stock_status')
      .eq('id', bill_id)
      .single()
    if (fErr || !bill)                  return Response.json({ error: 'Bill not found' }, { status: 404 })
    if (bill.booking_id)                return Response.json({ error: 'Already booked — release the booking first.' }, { status: 400 })
    if (bill.audit_consumed_at)         return Response.json({ error: 'Already audit-consumed — bill is no longer eligible.' }, { status: 400 })
    if (bill.stock_status !== 'at_branch')
      return Response.json({ error: `Bill is in '${bill.stock_status}', not at_branch.` }, { status: 400 })

    const { data, error } = await supabase
      .from('purchases')
      .update({ audit_hold: hold })
      .eq('id', bill_id)
      .select('id, audit_hold')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, bill: data })
  }

  if (action === 'set_bidding_pending') {
    const { date, pending_grams, note } = body
    if (!date) return Response.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })
    const g = Number(pending_grams)
    if (!Number.isFinite(g)) {
      return Response.json({ error: 'pending_grams must be a finite number (may be negative)' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('bidding_pending_delivery')
      .upsert({
        arrival_date:  date,
        pending_grams: g,
        note:          note ? String(note).trim() : null,
        updated_at:    new Date().toISOString(),
        updated_by:    actorEmail,
      }, { onConflict: 'arrival_date' })
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  }

  // Manual, bill-less booking — for committing leftover/old inventory that has
  // no bills in the picker. Ops enters net weight + optional gain + rate +
  // bidder; booked weight = net + gain. Stored as a cal_quota with the net as
  // its creation snapshot and the flat gain encoded as a per-net gain_rate, so
  // the Bookings table derives NET=net, GAIN=gain, PENDING/PIPELINE=0.
  if (action === 'create_manual_booking') {
    const { party, rate, net_weight, gain, is_kl, date } = body
    if (!party || !String(party).trim()) return Response.json({ error: 'Bidder name required' }, { status: 400 })
    const net = Number(net_weight), g = Number(gain) || 0, rt = Number(rate)
    if (!Number.isFinite(net) || net <= 0) return Response.json({ error: 'Net weight must be a positive number' }, { status: 400 })
    if (!Number.isFinite(g)   || g < 0)    return Response.json({ error: 'Gain must be 0 or more' }, { status: 400 })
    if (!Number.isFinite(rt)  || rt <= 0)  return Response.json({ error: 'Rate must be a positive number' }, { status: 400 })
    const bookWeight = net + g
    const bdate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : istToday()
    const actorUuid = auth.user?.id || null
    const baseRow = {
      date: bdate, party: String(party).trim(), weight: bookWeight, rate: rt,
      is_kl: !!is_kl, status: 'booked', created_by: actorUuid || actorEmail,
      notes: 'Manual booking · bill-less (old inventory)',
    }
    const insert = (row) => supabase.from('cal_quotas').insert(row).select().single()
    let { data, error: insErr } = await insert(baseRow)
    if (insErr && /invalid input syntax for type uuid/i.test(insErr.message || '') && actorUuid) {
      const retry = await insert({ ...baseRow, created_by: actorEmail }); data = retry.data; insErr = retry.error
    } else if (insErr && /invalid input syntax for type uuid/i.test(insErr.message || '') && !actorUuid) {
      const retry = await insert({ ...baseRow, created_by: null }); data = retry.data; insErr = retry.error
    }
    if (insErr) return Response.json({ error: insErr.message }, { status: 500 })
    // Best-effort: encode net/gain into the breakdown + gain_rate columns so the
    // Bookings table shows them split correctly (columns present in prod).
    try {
      const { error: bdErr } = await supabase.from('cal_quotas').update({
        gain_rate:          net > 0 ? g / net : 0,
        bills_net_weight_g: net,
        gain_applied_g:     g,
        pending_g:          0,
        additional_gain_g:  0,
      }).eq('id', data.id)
      if (bdErr) console.warn('[create_manual_booking] breakdown update failed (migration may be missing):', bdErr.message)
    } catch (e) { console.warn('[create_manual_booking] breakdown update threw:', e?.message) }
    return Response.json({ data, message: `Booking created for ${baseRow.party} — ${bookWeight.toFixed(2)} g (net ${net.toFixed(2)} + gain ${g.toFixed(2)}).` })
  }

  if (action === 'create_booking') {
    const { date, party, buyer_phone, weight, rate, purity, is_kl, notes, source_branches, bill_ids,
            pipeline_remaining_g, pipeline_region, pipeline_include_in_transit,
            // Breakdown components — snapshots of what built the committed
            // weight on the modal at creation time. Optional; old clients
            // can omit them and the booking still saves.
            bills_net_weight_g, gain_applied_g, pending_g, additional_gain_g, pipeline_original_g } = body
    if (!date)   return Response.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })
    if (!party || !String(party).trim()) return Response.json({ error: 'Buyer name required' }, { status: 400 })
    const w = Number(weight); const r = Number(rate)
    if (!Number.isFinite(w) || w <= 0) return Response.json({ error: 'weight must be a positive number' }, { status: 400 })
    if (!Number.isFinite(r) || r <= 0) return Response.json({ error: 'rate must be a positive number' }, { status: 400 })
    if (purity && !['24K', '22K', '18K'].includes(purity)) {
      return Response.json({ error: "purity must be one of '24K', '22K', '18K'" }, { status: 400 })
    }

    // Purchase-date lock — refuse to book any bill whose purchase_date ops has
    // locked. Checked BEFORE the booking row is created so a rejection leaves
    // no orphan quota.
    if (Array.isArray(bill_ids) && bill_ids.length > 0) {
      const { data: lockChk } = await supabase.from('purchases').select('purchase_date').in('id', bill_ids)
      const locked = await lockedPurchaseDates(supabase, (lockChk || []).map(b => b.purchase_date))
      if (locked.length) {
        return Response.json({ error: `Can't book — purchase date${locked.length > 1 ? 's' : ''} locked: ${locked.join(', ')}. Unlock to book these bills.` }, { status: 409 })
      }
    }

    // Pipeline attribution — when the operator commits more weight than the
    // currently selected bills cover, the excess can be tagged as "pipeline"
    // and auto-back-filled from incoming purchases as they sync. Server
    // derives pipeline_region from source_branches if the client didn't
    // send one (defensive — keeps the column accurate even if older clients
    // hit this endpoint).
    const pipelineGap = Number(pipeline_remaining_g)
    const hasPipeline = Number.isFinite(pipelineGap) && pipelineGap > 0
    let pipelineRegionResolved = pipeline_region || null
    if (hasPipeline && !pipelineRegionResolved && Array.isArray(source_branches) && source_branches.length > 0) {
      const { data: srcBranches } = await supabase
        .from('branches')
        .select('region')
        .in('name', source_branches)
      const regions = [...new Set((srcBranches || []).map(b => b.region).filter(Boolean))]
      pipelineRegionResolved = regions.length === 1 ? regions[0] : null
    }

    // Two-step insert so the booking still succeeds when the pipeline
    // migration hasn't been run yet:
    //   1) base insert — only columns guaranteed by the original schema
    //   2) follow-up UPDATE for pipeline_* columns, best-effort
    // If step 2 errors (column missing), the booking is already created;
    // we log a warning so ops can spot it in Railway logs and run the
    // migration.
    // Production's `created_by` column on cal_quotas was changed to UUID at
    // some point (the migration file in this repo still shows TEXT — out of
    // sync). Postgres rejects emails with "invalid input syntax for type
    // uuid". To be resilient either way, try the UUID first; if Postgres
    // complains about UUID type, retry with the email (TEXT) instead.
    const actorUuid = auth.user?.id || null
    const baseInsert = {
      date,
      party:       String(party).trim(),
      buyer_phone: buyer_phone ? String(buyer_phone).trim() : null,
      weight:      w,
      rate:        r,
      is_kl:       !!is_kl,
      purity:      purity || null,
      notes:       notes ? String(notes).trim() : null,
      status:      'booked',
      created_by:  actorUuid || actorEmail,
    }
    let { data, error: insErr } = await supabase
      .from('cal_quotas')
      .insert(baseInsert)
      .select()
      .single()
    // Fallback: if the schema actually wants TEXT and we sent UUID, retry
    // with the email. Catches the dev/staging copies that still have the
    // original TEXT column.
    if (insErr && /invalid input syntax for type uuid/i.test(insErr.message || '') && actorUuid) {
      console.warn('[create_booking] UUID rejected, retrying created_by with email (TEXT schema)')
      const retry = await supabase
        .from('cal_quotas')
        .insert({ ...baseInsert, created_by: actorEmail })
        .select()
        .single()
      data = retry.data; insErr = retry.error
    } else if (insErr && /invalid input syntax for type uuid/i.test(insErr.message || '') && !actorUuid) {
      // We sent an email and the column is UUID — no UUID available to
      // retry with. Insert with null so the row still saves; audit lost.
      console.warn('[create_booking] created_by is UUID but no auth.user.id available — inserting null')
      const retry = await supabase
        .from('cal_quotas')
        .insert({ ...baseInsert, created_by: null })
        .select()
        .single()
      data = retry.data; insErr = retry.error
    }
    if (insErr) return Response.json({ error: insErr.message }, { status: 500 })

    if (hasPipeline) {
      try {
        const { error: pipeErr } = await supabase
          .from('cal_quotas')
          .update({
            pipeline_remaining_g:        pipelineGap,
            pipeline_region:             pipelineRegionResolved,
            pipeline_arrival_date:       date,
            // New: opt-in flag so the auto-attacher also pulls outstation
            // 24h-transit bills (sql/cal_quotas_pipeline_in_transit.sql).
            // Only meaningful for non-Kerala bookings; safely defaults to
            // false when the client omits it.
            pipeline_include_in_transit: !!pipeline_include_in_transit,
          })
          .eq('id', data.id)
        if (pipeErr) {
          console.warn('[create_booking] pipeline columns update failed (migration may not have run — see sql/cal_quotas_pipeline_attach.sql):', pipeErr.message)
        }
      } catch (pipeThrew) {
        console.warn('[create_booking] pipeline update threw (non-fatal):', pipeThrew?.message)
      }
    }

    // Breakdown components — best-effort snapshot of how the committed
    // weight was built. Lets the Bookings tab render a bill-style row
    // without parsing notes. If the breakdown migration hasn't run,
    // the UPDATE quietly fails and the booking is still saved (UI just
    // shows "—" for the breakdown columns on this row).
    const breakdownPayload = {}
    if (Number.isFinite(Number(bills_net_weight_g)))  breakdownPayload.bills_net_weight_g  = Number(bills_net_weight_g)
    if (Number.isFinite(Number(gain_applied_g)))      breakdownPayload.gain_applied_g      = Number(gain_applied_g)
    if (Number.isFinite(Number(pending_g)))           breakdownPayload.pending_g           = Number(pending_g)
    if (Number.isFinite(Number(additional_gain_g)))   breakdownPayload.additional_gain_g   = Number(additional_gain_g)
    if (Number.isFinite(Number(pipeline_original_g))) breakdownPayload.pipeline_original_g = Number(pipeline_original_g)
    // gain_rate — the booking's refining-margin rate. The live gain model
    // derives gain = sourced_net × gain_rate, so gain_rate must reflect the
    // gain the operator actually applied on the modal (gain_applied_g), NOT a
    // hardcoded 3.5 %. Without this, a manual grams override (e.g. 30 g) was
    // ignored and gain snapped back to 3.5 % of sourced. Default (no override)
    // still lands on ~0.035 because gain_applied_g = net × 3.5 % by default.
    // Kerala = 0. Falls back to the 3.5 % standard when net is unknown.
    {
      // Divide by SOURCED (net + pending), not net alone: the live gain model
      // is gain = sourced × gain_rate, so dividing by sourced makes it reproduce
      // exactly the grams the operator applied. Without the pending term, a
      // booking with pending would show gain inflated by pending × rate while
      // live (the row reading over its booked weight) and only reconcile once
      // the arrival day settled it. With pending = 0 this is unchanged.
      const netForRate  = (Number(bills_net_weight_g) || 0) + (Number(pending_g) || 0)
      const appliedGain = Number(gain_applied_g)
      breakdownPayload.gain_rate = is_kl ? 0
        : (netForRate > 0 && Number.isFinite(appliedGain) && appliedGain >= 0)
          ? Number((appliedGain / netForRate).toFixed(6))
          : 0.035
    }
    if (Object.keys(breakdownPayload).length > 0) {
      try {
        const { error: brkErr } = await supabase
          .from('cal_quotas')
          .update(breakdownPayload)
          .eq('id', data.id)
        if (brkErr) {
          console.warn('[create_booking] breakdown columns update failed (run sql/cal_quotas_breakdown.sql):', brkErr.message)
        }
      } catch (brkThrew) {
        console.warn('[create_booking] breakdown update threw (non-fatal):', brkThrew?.message)
      }
    }

    // Mark the source branches' eligible bills as booked. Same eligibility
    // logic as the bidding_volume reader: Bangalore = purchase_date on the
    // bangalore source date (arrival - 1) and crm approved; outside = bills
    // in_consignment whose computed arrival lands on the booking date.
    // Errors here are logged but don't fail the booking (the audit row is
    // already created; an admin can rerun the link if needed).
    // Bill-level claim — if the UI sent explicit bill_ids, use them and skip
    // the legacy branch-wide claim. This makes the booking honor partial
    // selections (e.g. "3 of 7 bills at Mysore") without claiming the bills
    // ops didn't pick.
    if (Array.isArray(bill_ids) && bill_ids.length > 0) {
      try {
        const bookedAt = new Date().toISOString()
        await supabase
          .from('purchases')
          // Booking a bill reverses any prior "consumed as gain" attribution —
          // the gold is now committed to this booking, not company gain. No-op
          // for normal bills (those columns are already null).
          .update({ booking_id: data.id, booked_at: bookedAt, audit_consumed_at: null, audit_attributed_to: null })
          .in('id', bill_ids)
          .is('booking_id', null)        // never re-claim a bill that's already booked
      } catch (linkErr) {
        console.error('[create_booking] bill_ids claim failed:', linkErr?.message)
      }
    } else if (Array.isArray(source_branches) && source_branches.length > 0) {
      try {
        const { data: branchRows } = await supabase
          .from('branches')
          .select('name, region, delivery_tat_hours')
          .in('name', source_branches)
        const branchMeta = {}
        for (const b of branchRows || []) branchMeta[b.name] = b
        const bangaloreNames = source_branches.filter(n => branchMeta[n]?.region === 'Bangalore')
        const outsideNames   = source_branches.filter(n => branchMeta[n]?.region && branchMeta[n].region !== 'Bangalore')

        const bookedAt = new Date().toISOString()

        // Bangalore: purchase_date = date - 1 day
        if (bangaloreNames.length) {
          const bangPurchaseDate = (() => {
            const [y, m, d] = date.split('-').map(Number)
            const dt = new Date(Date.UTC(y, m - 1, d - 1))
            return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
          })()
          const bangPurchaseNextDate = (() => {
            const [y, m, d] = bangPurchaseDate.split('-').map(Number)
            const dt = new Date(Date.UTC(y, m - 1, d + 1))
            return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
          })()
          await supabase
            .from('purchases')
            .update({ booking_id: data.id, booked_at: bookedAt })
            .in('branch_name', bangaloreNames)
            .gte('purchase_date', bangPurchaseDate)
            .lt('purchase_date',  bangPurchaseNextDate)
            .eq('crm_status', 'approved')
            .eq('is_deleted', false)
            .is('booking_id', null)
        }

        // Outside in-transit: arrival date math has to happen in JS because
        // PostgREST can't easily do `(dispatched_at + tat_hours)::date == X`.
        // Fetch candidates, compute, then update by id list.
        if (outsideNames.length) {
          const { data: candidates } = await supabase
            .from('purchases')
            .select('id, branch_name, dispatched_at')
            .in('branch_name', outsideNames)
            .eq('stock_status', 'in_consignment')
            .eq('is_deleted', false)
            .not('dispatched_at', 'is', null)
            .is('booking_id', null)
          // Working-day arrival math (skip Sundays — same rule used in the
          // bidding_volume action and the Consignment Report).
          const istDispatchDate = (utcIso) => {
            const d = new Date(new Date(utcIso).getTime() + 5.5 * 3600_000)
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
          }
          const matchingIds = (candidates || []).filter(b => {
            const tat = branchMeta[b.branch_name]?.delivery_tat_hours || 24
            const workDays = Math.max(1, Math.ceil(tat / 24))
            return addWorkingDaysSkipSunday(istDispatchDate(b.dispatched_at), workDays) === date
          }).map(b => b.id)
          if (matchingIds.length) {
            await supabase
              .from('purchases')
              .update({ booking_id: data.id, booked_at: bookedAt })
              .in('id', matchingIds)
          }
        }
      } catch (linkErr) {
        console.error('[create_booking] failed to mark source bills:', linkErr?.message)
      }
    }

    // ── Auto-reconcile over-attachment ─────────────────────────────────
    // Shared helper; same logic used by the standalone reconcile_booking
    // action for legacy over-attached rows.
    const recon = await reconcileBookingOverAttachment({
      supabase,
      bookingId:    data.id,
      bookedWeight: w,
      isKl:         !!is_kl,
    })
    if (recon.error) {
      console.warn('[create_booking] reconcile non-fatal:', recon.error)
    }

    // Fold any residual into pipeline_remaining_g. Overrides any explicit
    // pipeline value the client sent — in the over-attached scenario the
    // client's overBy is 0 so there's no conflict in practice.
    if (recon.residual_pipeline_g > 0.001) {
      try {
        await supabase
          .from('cal_quotas')
          .update({
            pipeline_remaining_g:  recon.residual_pipeline_g,
            pipeline_region:       pipelineRegionResolved || (is_kl ? 'Kerala' : 'Bangalore'),
            pipeline_arrival_date: date,
          })
          .eq('id', data.id)
      } catch (pErr) {
        console.warn('[create_booking] residual pipeline update failed:', pErr?.message)
      }
    }

    return Response.json({
      data,
      message:             'Booking created.',
      detached:            recon.detached,
      residual_pipeline_g: recon.residual_pipeline_g,
    })
  }

  // ── Reconcile an existing booking — same auto-detach logic as create ──
  // For legacy over-attached rows that pre-date the auto-reconcile feature.
  // Takes a booking_id, runs the smallest-first detach, folds residual into
  // pipeline_remaining_g. Returns the same shape as create_booking so the
  // UI can show the same toast.
  if (action === 'reconcile_booking') {
    const { booking_id } = body
    if (!booking_id) return Response.json({ error: 'booking_id required' }, { status: 400 })

    const { data: booking, error: getErr } = await supabase
      .from('cal_quotas')
      .select('id, date, weight, is_kl, pipeline_region, status')
      .eq('id', booking_id)
      .single()
    if (getErr) return Response.json({ error: getErr.message }, { status: 500 })
    if (!booking) return Response.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.status && booking.status !== 'booked') {
      return Response.json({ error: `Cannot reconcile a ${booking.status} booking.` }, { status: 400 })
    }

    const recon = await reconcileBookingOverAttachment({
      supabase,
      bookingId:    booking.id,
      bookedWeight: Number(booking.weight),
      isKl:         !!booking.is_kl,
    })
    if (recon.error) return Response.json({ error: recon.error }, { status: 500 })

    // No-op when nothing to reconcile — return a friendly message instead of
    // 200/empty so the UI can say 'already reconciled' rather than 'reconciled'.
    if (recon.detached.length === 0 && recon.residual_pipeline_g === 0) {
      return Response.json({
        data:                booking,
        message:             'Nothing to reconcile — booking is already within booked weight.',
        detached:            [],
        residual_pipeline_g: 0,
      })
    }

    if (recon.residual_pipeline_g > 0.001) {
      try {
        await supabase
          .from('cal_quotas')
          .update({
            pipeline_remaining_g:  recon.residual_pipeline_g,
            pipeline_region:       booking.pipeline_region || (booking.is_kl ? 'Kerala' : 'Bangalore'),
            pipeline_arrival_date: booking.date,
          })
          .eq('id', booking.id)
      } catch (pErr) {
        console.warn('[reconcile_booking] residual pipeline update failed:', pErr?.message)
      }
    }

    return Response.json({
      data:                booking,
      message:             'Booking reconciled.',
      detached:            recon.detached,
      residual_pipeline_g: recon.residual_pipeline_g,
    })
  }

  // ── At-risk bookings summary ─────────────────────────────────────────────
  // Aggregates every ACTIVE booking whose attached bills are still at_branch
  // past the source branch's pickup_time + 2h grace, regardless of when the
  // booking was placed. Powers the 7pm in-app banner shown to anyone with
  // bidding access — listing party / weight / source branches so ops can
  // immediately spot what's stuck.
  //
  // The original scope was today's bookings only, which silently buried
  // older stuck bookings (e.g. TS-PANJAGUTTA bills that got booked days ago
  // and never moved — the bills don't show in Section 4 because they're
  // booking_id != NULL, and the banner never flagged them because the
  // booking was from days ago). Lifting the date scope here means every
  // multi-day stuck booking is now visible until ops resolves it (either
  // via Create Consignment or Mark Unbooked, both already wired on the
  // booking row).
  //
  // Same at_risk logic as bidding_bookings (single-flag derivation), with
  // an extra days_stuck field per booking so the UI can sort oldest first.
  if (action === 'bidding_at_risk_summary') {
    const todayIst = istToday()
    // ALL active bookings, no date filter. cancelled + fulfilled are
    // terminal and excluded.
    const { data: bookings, error: bkErr } = await supabase
      .from('cal_quotas')
      .select('id, party, weight, is_kl, status, created_at, date')
      .neq('status', 'cancelled')
      .neq('status', 'fulfilled')
    if (bkErr) return Response.json({ error: bkErr.message }, { status: 500 })
    if (!bookings || bookings.length === 0) {
      return Response.json({ data: { count: 0, bookings: [], by_branch: [], totals: { weight_g: 0, bills: 0 } } })
    }

    // Pull attached bills + each source branch's pickup_time in two queries.
    const ids = bookings.map(b => b.id)
    const { data: bills } = await supabase
      .from('purchases')
      .select('booking_id, net_weight, stock_status, branch_name, current_branch')
      .in('booking_id', ids)
    const srcNames = [...new Set((bills || []).map(b => b.current_branch || b.branch_name).filter(Boolean))]
    let pickupByBranch = {}
    if (srcNames.length) {
      const { data: bps } = await supabase
        .from('branches')
        .select('name, pickup_time')
        .in('name', srcNames)
      for (const b of bps || []) pickupByBranch[b.name] = b.pickup_time
    }

    const nowIst = new Date(Date.now() + 5.5 * 3600_000)
    const nowMin = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes()
    const MOVED  = new Set(['in_consignment', 'at_ho'])

    const billsByBooking = {}
    for (const p of bills || []) {
      if (!billsByBooking[p.booking_id]) billsByBooking[p.booking_id] = []
      billsByBooking[p.booking_id].push(p)
    }

    const atRisk = []
    const branchAgg = {}        // branch_name → { bills, weight_g, parties: Set }
    for (const bk of bookings) {
      const attached = billsByBooking[bk.id] || []
      if (attached.length === 0) continue
      let moved = 0, atBranchCount = 0, pastCutoff = 0, timed = 0
      const branchesTouched = new Set()
      for (const p of attached) {
        if (MOVED.has(p.stock_status))       moved++
        if (p.stock_status === 'at_branch')  {
          atBranchCount++
          const src = p.current_branch || p.branch_name
          if (src) branchesTouched.add(src)
          const pt = pickupByBranch[src]
          if (pt) {
            const [ph, pm] = pt.split(':').map(Number)
            if (Number.isFinite(ph)) {
              timed++
              const cutoff = ph * 60 + (pm || 0) + 120
              if (nowMin > cutoff) pastCutoff++
            }
          }
        }
      }
      const isAtRisk = (moved === 0) && (atBranchCount > 0) && (timed > 0) && (pastCutoff === timed)
      if (!isAtRisk) continue

      // Aggregate per-booking weight from attached bills (live), not the
      // booking's committed weight — only the still-at-branch portion is
      // the risk.
      const atBranchWt = attached.filter(p => p.stock_status === 'at_branch').reduce((s, p) => s + Number(p.net_weight || 0), 0)
      atRisk.push({
        id:          bk.id,
        party:       bk.party,
        is_kl:       !!bk.is_kl,
        at_branch_bills:  atBranchCount,
        at_branch_weight_g: Number(atBranchWt.toFixed(3)),
        booking_weight_g: Number(bk.weight || 0),
        branches:    [...branchesTouched],
      })
      for (const br of branchesTouched) {
        if (!branchAgg[br]) branchAgg[br] = { branch_name: br, bills: 0, weight_g: 0, parties: new Set() }
        // Each branch's portion of this booking — count of at_branch bills
        // at this specific branch, and their weight.
        const here = attached.filter(p => p.stock_status === 'at_branch' && (p.current_branch || p.branch_name) === br)
        branchAgg[br].bills    += here.length
        branchAgg[br].weight_g += here.reduce((s, p) => s + Number(p.net_weight || 0), 0)
        branchAgg[br].parties.add(bk.party)
      }
    }

    const byBranch = Object.values(branchAgg)
      .map(b => ({ branch_name: b.branch_name, bills: b.bills, weight_g: Number(b.weight_g.toFixed(3)), parties: [...b.parties] }))
      .sort((a, b) => b.weight_g - a.weight_g)

    const totals = {
      bills:     atRisk.reduce((s, b) => s + b.at_branch_bills, 0),
      weight_g:  Number(atRisk.reduce((s, b) => s + b.at_branch_weight_g, 0).toFixed(3)),
    }

    return Response.json({
      data: {
        as_of:    new Date().toISOString(),
        date:     todayIst,
        count:    atRisk.length,
        bookings: atRisk,
        by_branch: byBranch,
        totals,
      },
    })
  }

  // ── Stuck-booking summary ──────────────────────────────────────────────────
  // Sibling to bidding_at_risk_summary, but for the past-day case: bills
  // that were booked YESTERDAY OR EARLIER, are still at_branch, and have
  // booking_id IS NOT NULL — meaning the consignment was never created and
  // the stock never moved. Ops must either fire the consignment now or
  // unbook the bill. Drives the non-dismissible StuckBookingsBanner.
  //
  // Filter logic:
  //   booking_id IS NOT NULL                          ← still attached
  //   stock_status = 'at_branch'                      ← never moved
  //   booked_at < istStartOfDay(today)                ← past-day, not same-day
  //   is_deleted = false, audit_consumed_at IS NULL   ← still live
  if (action === 'bidding_stuck_summary') {
    const todayIst   = istToday()
    const todayStart = istStartOfDayIso(todayIst)

    // Page through purchases — Supabase caps at 1000 rows per query, and a
    // multi-day backlog could easily exceed that across branches.
    const CHUNK = 1000
    let from = 0
    const allBills = []
    while (true) {
      let q = supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, booking_id, booked_at, net_weight, gross_weight, purchase_date')
        .not('booking_id', 'is', null)
        .eq('stock_status', 'at_branch')
        .eq('is_deleted', false)
        .is('audit_consumed_at', null)
        .lt('booked_at', todayStart)
        .order('booked_at', { ascending: true })
        .range(from, from + CHUNK - 1)
      if (allowedBranches) q = q.in('branch_name', allowedBranches)
      const { data, error } = await q
      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!data || data.length === 0) break
      allBills.push(...data)
      if (data.length < CHUNK) break
      from += CHUNK
    }

    if (allBills.length === 0) {
      return Response.json({ data: { as_of: new Date().toISOString(), date: todayIst, count: 0, bills: [], by_branch: [], totals: { bills: 0, weight_g: 0 } } })
    }

    // Resolve booking metadata (party, date) so the row shows useful context.
    const bookingIds = [...new Set(allBills.map(b => b.booking_id))]
    const { data: bookings } = await supabase
      .from('cal_quotas')
      .select('id, party, date, status')
      .in('id', bookingIds)
    const bookingById = new Map((bookings || []).map(b => [b.id, b]))

    // Per-bill view + per-branch aggregation. branch_name is the source of
    // truth here (current_branch may be set during consignment movement but
    // since these bills never moved, branch_name === current_branch).
    const byBranchMap = {}
    const bills = []
    for (const p of allBills) {
      const branch = p.current_branch || p.branch_name
      const bk     = bookingById.get(p.booking_id) || null
      const wt     = Number(p.net_weight || 0)
      bills.push({
        id:             p.id,
        application_id: p.application_id,
        branch_name:    branch,
        booking_id:     p.booking_id,
        booked_at:      p.booked_at,
        purchase_date:  p.purchase_date,
        net_weight_g:   Number(wt.toFixed(3)),
        gross_weight_g: Number(Number(p.gross_weight || 0).toFixed(3)),
        booking_party:  bk?.party  || null,
        booking_date:   bk?.date   || null,
        booking_status: bk?.status || null,
      })
      if (!byBranchMap[branch]) byBranchMap[branch] = { branch_name: branch, bills: 0, weight_g: 0 }
      byBranchMap[branch].bills    += 1
      byBranchMap[branch].weight_g += wt
    }
    const byBranch = Object.values(byBranchMap)
      .map(b => ({ ...b, weight_g: Number(b.weight_g.toFixed(3)) }))
      .sort((a, b) => b.weight_g - a.weight_g)
    const totals = {
      bills:    bills.length,
      weight_g: Number(bills.reduce((s, b) => s + b.net_weight_g, 0).toFixed(3)),
    }
    return Response.json({
      data: {
        as_of:    new Date().toISOString(),
        date:     todayIst,
        count:    bills.length,
        bills,
        by_branch: byBranch,
        totals,
      },
    })
  }

  // ── Bills attached to a booking, grouped by source branch ─────────────────
  // Powers the "Create consignment" action on at_risk bookings — the UI needs
  // to know which source branches to fire a consignment for and which bills
  // belong to each.
  if (action === 'booking_bills_by_branch') {
    const bookingId = searchParams.get('booking_id')
    if (!bookingId) return Response.json({ error: 'booking_id required' }, { status: 400 })
    const { data: bills, error } = await supabase
      .from('purchases')
      .select('id, application_id, branch_name, current_branch, customer_name, net_weight, gross_weight, total_amount, stock_status, purchase_date')
      .eq('booking_id', bookingId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const byBranch = {}
    for (const b of bills || []) {
      const key = b.current_branch || b.branch_name
      if (!byBranch[key]) byBranch[key] = { branch_name: key, bills: [], at_branch_bills: [], moved_bills: [] }
      byBranch[key].bills.push(b)
      if (b.stock_status === 'at_branch')      byBranch[key].at_branch_bills.push(b)
      else if (b.stock_status === 'in_consignment' || b.stock_status === 'at_ho') byBranch[key].moved_bills.push(b)
    }
    return Response.json({ data: { groups: Object.values(byBranch) } })
  }

  if (action === 'update_booking_status') {
    const { id, status, reason } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const allowed = ['booked', 'confirmed', 'fulfilled', 'cancelled']
    if (!allowed.includes(status)) return Response.json({ error: `status must be one of ${allowed.join(', ')}` }, { status: 400 })

    // Status-specific audit columns. Fetch the row first to gate transitions
    // (no transitioning out of cancelled / fulfilled).
    const { data: existing, error: fetchErr } = await supabase
      .from('cal_quotas')
      .select('id, status')
      .eq('id', id)
      .single()
    if (fetchErr || !existing) return Response.json({ error: 'Booking not found' }, { status: 404 })
    if (existing.status === 'cancelled' && status !== 'cancelled') {
      return Response.json({ error: 'Cancelled bookings cannot be re-activated. Create a new one.' }, { status: 400 })
    }
    if (existing.status === 'fulfilled' && status !== 'fulfilled') {
      return Response.json({ error: 'Fulfilled bookings are immutable.' }, { status: 400 })
    }

    // Production's _by columns on cal_quotas are UUID (same drift as
    // created_by — see create_booking). Try UUID first, retry with email
    // if the schema is still TEXT in this environment.
    const actorUuid = auth.user?.id || null
    const now = new Date().toISOString()
    const upd = { status }
    if (status === 'confirmed')  { upd.confirmed_at  = now; upd.confirmed_by  = actorUuid || actorEmail }
    if (status === 'fulfilled')  { upd.fulfilled_at  = now; upd.fulfilled_by  = actorUuid || actorEmail }
    if (status === 'cancelled')  {
      upd.cancelled_at = now
      upd.cancelled_by = actorUuid || actorEmail
      upd.cancellation_reason = reason ? String(reason).trim() : null
    }

    let { data, error: updErr } = await supabase
      .from('cal_quotas')
      .update(upd)
      .eq('id', id)
      .select()
      .single()
    if (updErr && /invalid input syntax for type uuid/i.test(updErr.message || '') && actorUuid) {
      console.warn('[update_booking_status] UUID rejected, retrying _by with email (TEXT schema)')
      const retryUpd = { ...upd }
      if (status === 'confirmed')  retryUpd.confirmed_by = actorEmail
      if (status === 'fulfilled')  retryUpd.fulfilled_by = actorEmail
      if (status === 'cancelled')  retryUpd.cancelled_by = actorEmail
      const retry = await supabase
        .from('cal_quotas')
        .update(retryUpd)
        .eq('id', id)
        .select()
        .single()
      data = retry.data; updErr = retry.error
    }
    if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

    // Releasing the booking → release the bills it had claimed so they're
    // available for re-booking. Safe to no-op when nothing was linked.
    if (status === 'cancelled') {
      try {
        await supabase
          .from('purchases')
          .update({ booking_id: null, booked_at: null })
          .eq('booking_id', id)
      } catch (unlinkErr) {
        console.error('[update_booking_status] failed to release bills:', unlinkErr?.message)
      }
    }

    return Response.json({ data, message: `Booking marked ${status}.` })
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

  // ── Close a small residual pipeline → gain ────────────────────────────────
  // Ops-triggered: a live booking with a tiny pipeline residual the
  // no-overshoot attacher can't fill gets settled on the spot. The residual
  // folds into gain (same as the EOD settle). Guarded server-side to a
  // sub-10 g residual so a large open pipeline can't be closed by accident.
  if (action === 'close_booking_pipeline') {
    const { id } = body
    if (!id) return Response.json({ error: 'booking id required' }, { status: 400 })

    const { data: bk, error: bkErr } = await supabase
      .from('cal_quotas')
      .select('id, weight, gain_rate, pending_g, is_kl, status, pipeline_closed_at')
      .eq('id', id)
      .single()
    if (bkErr || !bk) return Response.json({ error: 'Booking not found' }, { status: 404 })
    if (bk.status === 'cancelled') return Response.json({ error: 'Booking is cancelled' }, { status: 400 })
    if (bk.pipeline_closed_at)     return Response.json({ error: 'Pipeline already closed' }, { status: 400 })

    // Compute the live residual: weight − sourced_net × (1 + rate).
    const { data: agg } = await supabase
      .from('purchases')
      .select('net_weight')
      .eq('booking_id', id)
    const attached = (agg || []).reduce((s, p) => s + Number(p.net_weight || 0), 0)
    const rate     = bk.gain_rate != null ? Number(bk.gain_rate) : (bk.is_kl ? 0 : 0.035)
    const sourced  = attached + Number(bk.pending_g || 0)
    const residual = Number(bk.weight || 0) - sourced * (1 + rate)

    if (residual <= 0) {
      return Response.json({ error: 'No residual pipeline to close' }, { status: 400 })
    }
    if (residual >= 10) {
      return Response.json({ error: `Residual is ${residual.toFixed(2)} g — only sub-10 g residuals can be closed manually.` }, { status: 400 })
    }

    const { error: updErr } = await supabase
      .from('cal_quotas')
      .update({ pipeline_closed_at: new Date().toISOString(), pipeline_remaining_g: 0 })
      .eq('id', id)
    if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

    return Response.json({ data: { closed: true, residual_g: Number(residual.toFixed(3)) } })
  }

  // ── Manually close pipeline using a SELECTED set of bills ──────────────────
  // The bid desk picks specific in-transit/branch bills and applies them to the
  // open pipeline owed from prior bids (instead of waiting for the auto-attacher
  // or booking a fresh quota). Attaches the bills FIFO to the region's
  // open-pipeline bookings (oldest first), filling each booking's residual
  // before spilling to the next. Mirrors the live residual math used elsewhere:
  //   residual = weight − (attached_net + pending) × (1 + rate)
  if (action === 'attach_selected_to_pipeline') {
    // allow_overattach: ops chose "close & over-attach" instead of splitting the
    // remainder into a new booking. The selected bill fills the open pipeline and
    // the EXCESS stays attached to that same booking as over-attachment (net now
    // exceeds booked). We skip the >10 g refusal, and — unlike a clean close — we do
    // NOT settle the booking or fold the excess into gain: the over-attachment is
    // derived live from net > booked (the "⚠ over-attached" chip + Auto-fix), and
    // folding would double-count it.
    const { bill_ids, is_kl, bidding_date, allow_overattach } = body
    if (!Array.isArray(bill_ids) || bill_ids.length === 0) {
      return Response.json({ error: 'bill_ids[] required' }, { status: 400 })
    }
    // bidding_date scopes which bookings' pipeline we close — it MUST match the
    // bid desk's displayed pipeline (bookings created on that IST day). Without
    // it the FIFO would target ancient carried-over bookings, not what ops sees.
    if (!bidding_date) return Response.json({ error: 'bidding_date required' }, { status: 400 })
    const klFlag = !!is_kl

    // 1) Selected bills that are actually free to attach (unbooked, approved).
    const { data: billRows, error: bErr } = await supabase
      .from('purchases')
      .select('id, application_id, net_weight, booking_id, purchase_date')
      .in('id', bill_ids)
      .eq('is_deleted', false)
    if (bErr) return Response.json({ error: bErr.message }, { status: 500 })
    const eligible = (billRows || []).filter(b => !b.booking_id)
    if (eligible.length === 0) {
      return Response.json({ error: 'None of the selected bills are free to attach (already booked?).' }, { status: 400 })
    }
    // Purchase-date lock — refuse locked-date bills.
    const lockedDates = await lockedPurchaseDates(supabase, eligible.map(b => b.purchase_date))
    if (lockedDates.length) {
      return Response.json({ error: `Can't close pipeline — purchase date${lockedDates.length > 1 ? 's' : ''} locked: ${lockedDates.join(', ')}.` }, { status: 409 })
    }

    // 2) Region's open-pipeline bookings FOR THAT BIDDING DAY (created_at IST =
    //    bidding_date), oldest first — the same set the bid desk sums as the
    //    pipeline. Day-scoped so we never touch carried-over historical bookings.
    const { data: bookings, error: qErr } = await supabase
      .from('cal_quotas')
      .select('id, weight, gain_rate, pending_g, additional_gain_g, is_kl, status, pipeline_closed_at, created_at')
      .eq('is_kl', klFlag)
      .neq('status', 'cancelled')
      .is('pipeline_closed_at', null)
      .gte('created_at', istStartOfDayIso(bidding_date))
      .lt('created_at',  istEndOfDayIso(bidding_date))
      .order('created_at', { ascending: true })
    if (qErr) return Response.json({ error: qErr.message }, { status: 500 })

    // Current attached net per booking → live residual.
    const bkIds = (bookings || []).map(b => b.id)
    const attachedByBk = {}
    for (let i = 0; i < bkIds.length; i += 100) {
      const { data: rows } = await supabase
        .from('purchases').select('booking_id, net_weight').in('booking_id', bkIds.slice(i, i + 100))
      for (const r of rows || []) attachedByBk[r.booking_id] = (attachedByBk[r.booking_id] || 0) + Number(r.net_weight || 0)
    }
    const attachDelta = await allocDeltaByBooking(supabase, bkIds)
    const open = (bookings || []).map(b => {
      const rate     = b.gain_rate != null ? Number(b.gain_rate) : (b.is_kl ? 0 : 0.035)
      const attached = (attachedByBk[b.id] || 0) + (attachDelta[b.id] || 0)
      const residual = Math.max(0, Number(b.weight || 0) - (attached + Number(b.pending_g || 0)) * (1 + rate))
      return { id: b.id, weight: Number(b.weight || 0), rate, attached, pending_g: Number(b.pending_g || 0), additional_gain_g: Number(b.additional_gain_g || 0), residual }
    }).filter(b => b.residual > 0.001)
    if (open.length === 0) {
      return Response.json({ error: 'No open pipeline for this region to close.' }, { status: 400 })
    }

    // 3) FIFO-assign bills to bookings. A bill contributes net×(1+rate) toward a
    //    booking's residual; the boundary bill may slightly overshoot (folds in).
    const assign = {}            // booking_id → [bill ids]
    const netAdded = {}          // booking_id → net grams added
    let bi = 0, remaining = open[0].residual
    for (const bill of eligible) {
      if (bi >= open.length) break
      const bk = open[bi]
      ;(assign[bk.id]   = assign[bk.id]   || []).push(bill.id)
      netAdded[bk.id]   = (netAdded[bk.id] || 0) + Number(bill.net_weight || 0)
      remaining        -= Number(bill.net_weight || 0) * (1 + bk.rate)
      if (remaining <= 0.001) { bi++; if (bi < open.length) remaining = open[bi].residual }
    }
    const attachedCount = Object.values(assign).reduce((s, a) => s + a.length, 0)
    if (attachedCount === 0) return Response.json({ error: 'Nothing could be attached.' }, { status: 400 })

    // 4) Plan each touched booking — new residual + any OVERSHOOT (sourced beyond
    //    committed). A small overshoot (≤ 10 g) closes the pipeline and folds the
    //    excess into the booking's gain. Bigger than that is refused so a single
    //    fat bill can't dump huge "free" gain — deselect instead. Validate the
    //    whole plan BEFORE any write so a rejection leaves nothing half-applied.
    const plan = []
    for (const bk of open) {
      const ids = assign[bk.id]
      if (!ids || !ids.length) continue
      const sourcedAfter  = (bk.attached + (netAdded[bk.id] || 0) + bk.pending_g) * (1 + bk.rate)
      const residualAfter = Math.max(0, bk.weight - sourcedAfter)
      const overshoot     = Math.max(0, sourcedAfter - bk.weight)
      if (!allow_overattach && overshoot > 10.001) {
        return Response.json({ error: `Selection overshoots a booking by ${overshoot.toFixed(2)} g — only up to 10 g can fold into gain. Use “Close & over-attach”, or deselect a bill.` }, { status: 400 })
      }
      plan.push({ bk, ids, residualAfter, overshoot })
    }

    // 5) Apply the validated plan.
    const nowIso = new Date().toISOString()
    let closedBookings = 0, closedG = 0, gainFoldedG = 0, overAttachedG = 0
    for (const p of plan) {
      const { error: upErr } = await supabase
        .from('purchases')
        .update({ booking_id: p.bk.id, booked_at: nowIso, audit_consumed_at: null, audit_attributed_to: null })
        .in('id', p.ids)
      if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
      const upd = { pipeline_remaining_g: p.residualAfter }
      // A big overshoot in over-attach mode: the pipeline is filled (remaining 0) but
      // the booking now holds MORE than booked. Leave it UNSETTLED (no pipeline_closed_at)
      // and DON'T fold into gain, so it surfaces as "⚠ over-attached" with Auto-fix —
      // exactly the state ops asked for. A small (≤10 g) overshoot still closes cleanly
      // and folds into gain, same as before.
      const overAttach = allow_overattach && p.overshoot > 10.001
      if (p.residualAfter <= 0.001) {
        if (overAttach) {
          overAttachedG += p.overshoot
        } else {
          upd.pipeline_closed_at = nowIso; closedBookings++
          if (p.overshoot > 0.001) { upd.additional_gain_g = p.bk.additional_gain_g + p.overshoot; gainFoldedG += p.overshoot }
        }
      }
      await supabase.from('cal_quotas').update(upd).eq('id', p.bk.id)
      closedG += (p.bk.residual - p.residualAfter)   // grams of pipeline actually closed
    }

    return Response.json({ data: {
      attached_bills:   attachedCount,
      bookings_touched: plan.length,
      bookings_closed:  closedBookings,
      pipeline_closed_g: Number(closedG.toFixed(3)),
      gain_folded_g:    Number(gainFoldedG.toFixed(3)),
      over_attached_g:  Number(overAttachedG.toFixed(3)),
      skipped:          eligible.length - attachedCount,
    } })
  }

  // ── Unbook a list of bills ────────────────────────────────────────────────
  // Used by the StuckBookingsBanner + Bidding "Booked · no consignment" Unbook
  // action. Takes a list of application_ids and clears booking_id + booked_at.
  // Defensive: only flips bills that are CURRENTLY booked AND not yet in a
  // dispatched consignment — i.e. stock_status is at_branch OR at_ho. Bills
  // that are in_consignment (or downstream: sent_for_melting / melted) are
  // refused, since their consignment has fired. NOTE: at_ho must be allowed —
  // the Bangalore lifecycle and the manual at_ho SQL moves leave booked-but-
  // unconsigned bills at_ho, and ops still needs to release them.
  if (action === 'unbook_bills') {
    const { application_ids } = body
    if (!Array.isArray(application_ids) || application_ids.length === 0) {
      return Response.json({ error: 'application_ids[] required' }, { status: 400 })
    }

    const UNBOOKABLE_STATUS = new Set(['at_branch', 'at_ho'])
    const { data: rows, error: fErr } = await supabase
      .from('purchases')
      .select('id, application_id, stock_status, booking_id, is_deleted, audit_consumed_at')
      .in('application_id', application_ids)
    if (fErr) return Response.json({ error: fErr.message }, { status: 500 })

    // A WGKA number can exist in BOTH crm_sources; only one is the booked row.
    // So evaluate every fetched row and unbook each that qualifies, rather than
    // keying one row per application_id (which could pick the unbooked twin).
    const qualifies = (r) => !r.is_deleted && !r.audit_consumed_at && r.booking_id && UNBOOKABLE_STATUS.has(r.stock_status)
    const toUnbook = (rows || []).filter(qualifies).map(r => r.id)
    const skipped  = []
    for (const appId of application_ids) {
      const rs = (rows || []).filter(r => r.application_id === appId)
      if (rs.length === 0)      { skipped.push({ application_id: appId, reason: 'Not found' }); continue }
      if (rs.some(qualifies))   continue   // at least one row (the booked one) is being unbooked
      const r = rs[0]
      const reason = r.is_deleted ? 'Deleted'
        : r.audit_consumed_at ? 'Already audit-consumed'
        : !r.booking_id ? 'Not booked'
        : `In a consignment (${r.stock_status})`
      skipped.push({ application_id: appId, reason })
    }

    if (toUnbook.length === 0) {
      return Response.json({ data: { unbooked: 0, skipped } })
    }

    // Capture the bookings we're pulling bills FROM before detaching, so we can
    // reopen their pipeline afterwards.
    const affectedBookingIds = [...new Set((rows || []).filter(qualifies).map(r => r.booking_id).filter(Boolean))]

    const { error: uErr } = await supabase
      .from('purchases')
      .update({ booking_id: null, booked_at: null })
      .in('id', toUnbook)
    if (uErr) return Response.json({ error: uErr.message }, { status: 500 })

    // Reopen pipeline on each affected booking — the freed weight is gold the
    // buyer is still owed, so it must show as PIPELINE, not fold into gain. A
    // booking whose pipeline was previously closed (pipeline_closed_at set)
    // would otherwise stay "settled" and report the shortfall as gain.
    let reopened = 0
    for (const bid of affectedBookingIds) {
      try { if (await reopenBookingPipeline(supabase, bid)) reopened++ } catch (e) { console.warn('[unbook_bills] reopen pipeline failed', bid, e?.message) }
    }

    return Response.json({ data: { unbooked: toUnbook.length, skipped, pipeline_reopened: reopened } })
  }

  // ── Split a big bill: close open pipeline(s) + book the remainder ──────────
  // Ops selected one (or a few) bill(s) too big to just fold into gain (the
  // >10 g overshoot wall in attach_selected_to_pipeline). This does BOTH in one
  // motion, atomically:
  //   1) FIFO-close the day's open pipeline(s) with part of the bill's net
  //   2) create a NEW booking (party/rate/weight) sourced from the remainder
  // The physical bill stays whole (booking_id = the new booking). The pipeline
  // fill is recorded as an accounting allocation (booking_split_allocations),
  // so total sourced gold is conserved and the CRM re-sync never disturbs it.
  if (action === 'split_close_and_book') {
    const { bill_ids, is_kl, bidding_date, party, rate, weight, purity, buyer_phone, notes, arrival_date, gain_rate, pending_g, gain_applied_g } = body
    if (!Array.isArray(bill_ids) || bill_ids.length === 0) return Response.json({ error: 'bill_ids[] required' }, { status: 400 })
    if (!bidding_date) return Response.json({ error: 'bidding_date required' }, { status: 400 })
    if (!party || !String(party).trim()) return Response.json({ error: 'Buyer name required' }, { status: 400 })
    const bookDate = arrival_date || bidding_date
    const wNew = Number(weight), rNew = Number(rate)
    if (!Number.isFinite(wNew) || wNew <= 0) return Response.json({ error: 'weight must be a positive number' }, { status: 400 })
    if (!Number.isFinite(rNew) || rNew <= 0) return Response.json({ error: 'rate must be a positive number' }, { status: 400 })
    if (purity && !['24K', '22K', '18K'].includes(purity)) return Response.json({ error: "purity must be one of '24K', '22K', '18K'" }, { status: 400 })
    const klFlag  = !!is_kl
    const newRate = klFlag ? 0 : (Number.isFinite(Number(gain_rate)) ? Number(gain_rate) : 0.035)

    // 1) Selected bills that are free to attach (unbooked, not deleted).
    const { data: billRows, error: bErr } = await supabase
      .from('purchases')
      .select('id, application_id, net_weight, booking_id, purchase_date, branch_name, current_branch')
      .in('id', bill_ids)
      .eq('is_deleted', false)
    if (bErr) return Response.json({ error: bErr.message }, { status: 500 })
    const eligible = (billRows || []).filter(b => !b.booking_id)
    if (eligible.length === 0) return Response.json({ error: 'Selected bill(s) are already booked.' }, { status: 400 })
    const lockedDates = await lockedPurchaseDates(supabase, eligible.map(b => b.purchase_date))
    if (lockedDates.length) return Response.json({ error: `Can't book — purchase date${lockedDates.length > 1 ? 's' : ''} locked: ${lockedDates.join(', ')}.` }, { status: 409 })
    const billNet = eligible.reduce((s, b) => s + Number(b.net_weight || 0), 0)
    // "Sources: …" audit note — same convention as create_booking, so the
    // Bookings tab shows the italic sources line + the ▸ view breakup link.
    const srcBranches = [...new Set(eligible.map(b => b.current_branch || b.branch_name).filter(Boolean))].sort()
    const sourcesNote = srcBranches.length ? `Sources: ${srcBranches.join(', ')}` : null

    // 2) Region's open-pipeline bookings for that bidding day, oldest first —
    //    the same set the bid desk sums (and attach_selected_to_pipeline uses).
    const { data: bookings, error: qErr } = await supabase
      .from('cal_quotas')
      .select('id, weight, gain_rate, pending_g, additional_gain_g, is_kl, status, pipeline_closed_at, created_at')
      .eq('is_kl', klFlag)
      .neq('status', 'cancelled')
      .is('pipeline_closed_at', null)
      .gte('created_at', istStartOfDayIso(bidding_date))
      .lt('created_at',  istEndOfDayIso(bidding_date))
      .order('created_at', { ascending: true })
    if (qErr) return Response.json({ error: qErr.message }, { status: 500 })
    const bkIds = (bookings || []).map(b => b.id)
    const attachedByBk = {}
    for (let i = 0; i < bkIds.length; i += 100) {
      const { data: rws } = await supabase.from('purchases').select('booking_id, net_weight').in('booking_id', bkIds.slice(i, i + 100))
      for (const r of rws || []) attachedByBk[r.booking_id] = (attachedByBk[r.booking_id] || 0) + Number(r.net_weight || 0)
    }
    const alloc0 = await allocDeltaByBooking(supabase, bkIds)
    const open = (bookings || []).map(b => {
      const bRate    = b.gain_rate != null ? Number(b.gain_rate) : (b.is_kl ? 0 : 0.035)
      const attached = (attachedByBk[b.id] || 0) + (alloc0[b.id] || 0)
      const residual = Math.max(0, Number(b.weight || 0) - (attached + Number(b.pending_g || 0)) * (1 + bRate))
      return { id: b.id, rate: bRate, residual }
    }).filter(b => b.residual > 0.001)
    if (open.length === 0) return Response.json({ error: 'No open pipeline for this region/day to close.' }, { status: 400 })

    // 3) FIFO-allocate the bill's net to close pipeline residuals (committed
    //    grams closed = net × (1 + booking rate)). Record each allocation.
    let remainingNet = billNet
    const allocations = []   // { to_booking_id, net_g, rate, residualAfter }
    for (const bk of open) {
      if (remainingNet <= 0.001) break
      const netNeeded = bk.residual / (1 + bk.rate)
      const use = Math.min(remainingNet, netNeeded)
      if (use <= 0.001) continue
      const residualAfter = Math.max(0, bk.residual - use * (1 + bk.rate))
      allocations.push({ to_booking_id: bk.id, net_g: Number(use.toFixed(4)), rate: bk.rate, residualAfter })
      remainingNet -= use
    }
    const closedNet    = billNet - remainingNet
    const remainderNet = remainingNet
    if (closedNet <= 0.001)     return Response.json({ error: 'Nothing to close — selection did not cover any pipeline.' }, { status: 400 })
    if (remainderNet <= 0.001)  return Response.json({ error: 'Selection fully absorbed by the pipeline — use “Close Pipeline” instead (no remainder to book).' }, { status: 400 })

    // 4) Create the new booking (same created_by UUID/TEXT resilience as create_booking).
    const actorUuid = auth.user?.id || null
    const baseInsert = {
      date: bookDate, party: String(party).trim(),
      buyer_phone: buyer_phone ? String(buyer_phone).trim() : null,
      weight: wNew, rate: rNew, is_kl: klFlag, purity: purity || null,
      notes: notes ? String(notes).trim() : sourcesNote, status: 'booked',
      created_by: actorUuid || actorEmail,
    }
    let { data: newBk, error: insErr } = await supabase.from('cal_quotas').insert(baseInsert).select().single()
    if (insErr && /invalid input syntax for type uuid/i.test(insErr.message || '') && actorUuid) {
      const retry = await supabase.from('cal_quotas').insert({ ...baseInsert, created_by: actorEmail }).select().single()
      newBk = retry.data; insErr = retry.error
    } else if (insErr && /invalid input syntax for type uuid/i.test(insErr.message || '')) {
      const retry = await supabase.from('cal_quotas').insert({ ...baseInsert, created_by: null }).select().single()
      newBk = retry.data; insErr = retry.error
    }
    if (insErr || !newBk) return Response.json({ error: insErr?.message || 'Could not create booking.' }, { status: 500 })

    // 5) Attach the physical bill(s) to the new booking.
    const bookedAt = new Date().toISOString()
    const { error: attErr } = await supabase
      .from('purchases')
      .update({ booking_id: newBk.id, booked_at: bookedAt, audit_consumed_at: null, audit_attributed_to: null })
      .in('id', eligible.map(b => b.id))
      .is('booking_id', null)
    if (attErr) {
      await supabase.from('cal_quotas').delete().eq('id', newBk.id)   // roll back the orphan booking
      return Response.json({ error: `Could not attach bill(s): ${attErr.message}` }, { status: 500 })
    }

    // 6) Record allocations (credit the pipeline bookings from the new booking).
    //    If the ledger table is missing, roll the whole thing back so we never
    //    leave a half-applied split.
    const primaryBillId = eligible[0]?.id || null
    const allocRows = allocations.map(a => ({
      purchase_id: primaryBillId, from_booking_id: newBk.id, to_booking_id: a.to_booking_id,
      net_g: a.net_g, created_by: actorEmail,
    }))
    if (allocRows.length) {
      const { error: aErr } = await supabase.from('booking_split_allocations').insert(allocRows)
      if (aErr) {
        await supabase.from('purchases').update({ booking_id: null, booked_at: null }).in('id', eligible.map(b => b.id))
        await supabase.from('cal_quotas').delete().eq('id', newBk.id)
        return Response.json({ error: `Split allocation failed (apply sql/booking_split_allocations.sql): ${aErr.message}` }, { status: 500 })
      }
    }

    // 7) Close the pipeline booking(s) that were fully covered.
    let closedBookings = 0
    for (const a of allocations) {
      const upd = { pipeline_remaining_g: Number(a.residualAfter.toFixed(3)) }
      if (a.residualAfter <= 0.001) { upd.pipeline_closed_at = bookedAt; closedBookings++ }
      await supabase.from('cal_quotas').update(upd).eq('id', a.to_booking_id)
    }

    // 8) Set the new booking's own pipeline + breakdown from the remainder.
    // Operator overrides (from the split modal):
    //   · pending_g       — owed/delayed gold ops KNOWS is coming. Counts as
    //                       sourced (attached + pending), so it shrinks pipeline
    //                       instead of leaving it open to auto-attach. Mirrors
    //                       the pending_g model in create_booking.
    //   · gain_applied_g  — an absolute gain override (grams). gain_rate is
    //                       derived from it exactly as create_booking does
    //                       (appliedGain / net), so the live gain model honours
    //                       the operator's figure instead of snapping to 3.5 %.
    const pendingG = Math.max(0, Number(pending_g) || 0)
    const gainOverride = Number(gain_applied_g)
    const gainAppliedG = Number.isFinite(gainOverride) && gainOverride >= 0
      ? gainOverride
      : remainderNet * newRate
    const newSourced  = remainderNet + pendingG                        // pending counts as sourced
    // gain_rate is derived over SOURCED (net + pending), not net alone, so the
    // live gain model (gain = sourced × rate) reproduces exactly the grams the
    // operator entered — otherwise pending would earn phantom gain while the
    // booking is live and the row would read over its own booked weight until
    // the arrival day settled it. With pending = 0 this is identical to net-only.
    const effGainRate = klFlag ? 0
      : (newSourced > 0 && Number.isFinite(gainAppliedG) && gainAppliedG >= 0)
        ? Number((gainAppliedG / newSourced).toFixed(6))
        : newRate
    const newPipeline = Math.max(0, wNew - newSourced * (1 + effGainRate))
    const pipelineRegion = klFlag ? 'Kerala' : 'Bangalore'
    await supabase.from('cal_quotas').update({
      gain_rate:             effGainRate,
      bills_net_weight_g:    Number(remainderNet.toFixed(3)),
      gain_applied_g:        Number(gainAppliedG.toFixed(3)),
      pending_g:             Number(pendingG.toFixed(3)),
      pipeline_original_g:   Number(newPipeline.toFixed(3)),
      pipeline_remaining_g:  newPipeline > 0.001 ? Number(newPipeline.toFixed(3)) : 0,
      pipeline_region:       newPipeline > 0.001 ? pipelineRegion : null,
      pipeline_arrival_date: bookDate,
    }).eq('id', newBk.id)

    return Response.json({ data: {
      booking_id:             newBk.id,
      closed_pipeline_g:      Number(allocations.reduce((s, a) => s + a.net_g * (1 + a.rate), 0).toFixed(3)),
      bookings_closed:        closedBookings,
      remainder_net_g:        Number(remainderNet.toFixed(3)),
      new_booking_weight_g:   wNew,
      new_booking_pipeline_g: Number(newPipeline.toFixed(3)),
    } })
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}