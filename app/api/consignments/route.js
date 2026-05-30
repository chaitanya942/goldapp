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
import { requireAuth, requireAuthForPage, ROLE_GROUPS, getRegionFilter, resolveAllowedBranchNames } from '../../../lib/apiAuth'
import { istToday, istStartOfDayIso, istEndOfDayIso, addWorkingDaysSkipSunday } from '../../../lib/dateIst'
import { cancelEWayBill, cancelEInvoice } from '../../../lib/clearTaxClient'
import { REGION_TO_STATE_CODE } from '../../../lib/stateMap'

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

  // ── Branch Stock / In Transit Overview (new landing view) ────────────────
  // Single endpoint serves both lifecycle states via the ?status= param so
  // the dashboard reads at_branch and in_consignment from the same RPC and
  // they stay in lock-step semantically (per-bill counts, oldest = MIN
  // purchase_date, etc.). Defaults to at_branch for backwards-compat.
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
    const bangaloreBranches = new Set(
      includeBangalore
        ? (branches || []).filter(b => b.region === 'Bangalore').map(b => b.name)
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
      const meta = branchMeta[branchName] || { region: 'Unknown', pickup_time: null, pickup_days: null, is_hub: false, hub_branch_name: null }
      summary[branchName] = {
        branch_name: branchName, region: meta.region, pickup_time: meta.pickup_time,
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
    const dayAfterArrival = addWorkingDaysSkipSunday(arrivalDate, 1)

    // Branch metadata — TAT, region, pickup time, pickup_days, is_hub. We
    // need pickup_days + is_hub now to compute Section 4 (branch-stock-pre-
    // EOD) eligibility: only branches with a still-ahead pickup today, and
    // only Kerala hubs (not leaf branches that already consolidate at hub).
    let branchQ = supabase
      .from('branches')
      .select('name, region, state, delivery_tat_hours, pickup_time, pickup_days, is_hub, logistics_partner')
      .eq('is_active', true)
    if (allowedRegions) branchQ = branchQ.in('region', allowedRegions)
    const { data: branchRows, error: bErr } = await branchQ
    if (bErr) return Response.json({ error: bErr.message }, { status: 500 })
    const branchMeta = {}
    for (const b of branchRows || []) branchMeta[b.name] = b

    const bangaloreBranchNames = (branchRows || []).filter(b => b.region === 'Bangalore').map(b => b.name)
    const outsideBranchNames   = (branchRows || []).filter(b => b.region !== 'Bangalore').map(b => b.name)

    // Section 4 eligibility: at_branch bills at non-Bangalore branches whose
    // pickup is STILL AHEAD today, AND whose TAT lets them arrive at HO on
    // the target arrivalDate (i.e. TAT ≤ 24h for default tomorrow-arrival).
    // Kerala restriction: only the hub branches (per ops spec — leaf-branch
    // bills already consolidate at hub before moving to HO).
    const nowIstHHMM = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
    const todayDow   = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' })
    const preEodEligibleBranchNames = (branchRows || []).filter(b => {
      if (b.region === 'Bangalore')                          return false
      if (Number(b.delivery_tat_hours || 0) > 24)            return false   // 48h-TAT picked up today arrives day-after, not tomorrow
      if (b.region === 'Kerala' && !b.is_hub)                return false   // Kerala: hub-only (leaves consolidate at hub first)
      // Kerala hubs are ALWAYS included — they receive transferred bills
      // from leaf branches throughout the day and dispatch to HO at EOD.
      // The logistics module often leaves their pickup_time blank because
      // the schedule is implicit ("end of day"); we don't want that to hide
      // them.
      if (b.region === 'Kerala' && b.is_hub) return true
      // Non-Kerala: include branches whose pickup_days lists today. We
      // intentionally do NOT filter by pickup_time — pickups can run
      // late, and ops needs to keep seeing the bills sitting at the
      // branch *after* the scheduled time so delayed pickups aren't
      // hidden from the bidding pool. pickup_time is treated as
      // informational only, not a gate.
      if (!Array.isArray(b.pickup_days))                     return false
      if (!b.pickup_days.includes(todayDow))                 return false
      return true
    }).map(b => b.name)

    // 1) Bangalore — bills purchased on bangalorePurchaseDate, status approved.
    //    Include any stock_status: the time-of-day lifecycle moves them at
    //    19:30 IST so depending on when this endpoint is queried they could
    //    be at_branch, in_consignment, or at_ho. All of them count toward
    //    tomorrow's bid.
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
        .map(b => ({ ...b, branch_name: b.current_branch || b.branch_name }))
        .filter(b => !postDispatchedBranches.has(b.branch_name))
    }

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

    const bangaloreByBranch  = groupByBranch(bangBills)
    const transit24hByBranch = groupByBranch(inflight24h)
    const transit48hByBranch = groupByBranch(inflight48h)
    const preEodByBranch     = groupByBranch(preEodBills)
    // Back-compat alias: the older UI reads supply.in_transit and expects
    // the bookable-tomorrow bucket. Keep it pointing at the 24h transit.
    const inflightByBranch   = transit24hByBranch

    // Section totals + grand total.
    const sumOf = (rows) => rows.reduce((a, r) => ({
      bills:    a.bills    + r.total_bills,
      gross_wt: a.gross_wt + r.total_gross_wt,
      net_wt:   a.net_wt   + r.total_net_wt,
      amount:   a.amount   + r.total_amount,
    }), { bills: 0, gross_wt: 0, net_wt: 0, amount: 0 })

    const bangTotal       = sumOf(bangaloreByBranch)
    const transit24hTotal = sumOf(transit24hByBranch)
    const transit48hTotal = sumOf(transit48hByBranch)
    const preEodTotal     = sumOf(preEodByBranch)
    // Bookable pool = sections that can actually arrive at HO on arrivalDate.
    // Section 3 (transit_48h) is informational only — excluded from grandTotal.
    const grandTotal = {
      bills:    bangTotal.bills    + transit24hTotal.bills    + preEodTotal.bills,
      gross_wt: bangTotal.gross_wt + transit24hTotal.gross_wt + preEodTotal.gross_wt,
      net_wt:   bangTotal.net_wt   + transit24hTotal.net_wt   + preEodTotal.net_wt,
      amount:   bangTotal.amount   + transit24hTotal.amount   + preEodTotal.amount,
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

    // S1 — at_branch at a Kerala hub. Filter on current_branch (the physical
    // location) so transferred-in bills land here, not under the original leaf.
    let klS1Bills = []
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
      klS1Bills = (s1 || []).map(b => ({ ...b, branch_name: b.current_branch || b.branch_name }))
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

    // S3 — at_branch at a Kerala leaf (not a hub), waiting to be dispatched.
    let klS3Bills = []
    if (klLeafNames.length) {
      const list = klLeafNames.map(n => `"${n}"`).join(',')
      const { data: s3, error: s3Err } = await supabase
        .from('purchases')
        .select('id, application_id, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, dispatched_at, crm_status')
        .or(`current_branch.in.(${list}),and(current_branch.is.null,branch_name.in.(${list}))`)
        .eq('stock_status', 'at_branch')
        .eq('crm_status',   'approved')
        .eq('is_deleted',   false)
        .is('booking_id',   null)
      if (s3Err) return Response.json({ error: s3Err.message }, { status: 500 })
      klS3Bills = (s3 || []).map(b => ({ ...b, branch_name: b.current_branch || b.branch_name }))
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
        klS1Bills = klS1Bills.filter(b => !klHubsDispatchedToday.has(b.branch_name))
        klS2Bills = klS2Bills.filter(b => !klHubsDispatchedToday.has(b.branch_name))
      }
    }

    const klS1ByHub  = groupByBranch(klS1Bills)
    const klS2ByHub  = groupByBranch(klS2Bills)
    const klS3ByLeaf = groupByBranch(klS3Bills)
    const klS1Total  = sumOf(klS1ByHub)
    const klS2Total  = sumOf(klS2ByHub)
    const klS3Total  = sumOf(klS3ByLeaf)

    return Response.json({
      data: {
        arrival_date:            arrivalDate,
        day_after_arrival:       dayAfterArrival,
        bangalore_purchase_date: bangalorePurchaseDate,
        bangalore:      { branches: bangaloreByBranch,  total: bangTotal       },
        transit_24h:    { branches: transit24hByBranch, total: transit24hTotal },
        transit_48h:    { branches: transit48hByBranch, total: transit48hTotal },   // view-only, NOT part of bookable pool
        branch_pre_eod: { branches: preEodByBranch,     total: preEodTotal, _debug: debugSection4 },
        // Back-compat for the existing UI — alias of transit_24h.
        in_transit: { branches: inflightByBranch, total: inflightTotal },
        // Kerala bid-desk taxonomy (consumed by the KL tab).
        kerala_sections: {
          hubs:                  klHubNames,
          hubs_dispatched_today: [...klHubsDispatchedToday],
          s1_hub_stock:          { branches: klS1ByHub,  total: klS1Total  },
          s2_in_movement:        { branches: klS2ByHub,  total: klS2Total  },
          s3_at_leaf:            { branches: klS3ByLeaf, total: klS3Total  },
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
        r.attached_net_weight_g = sumByBooking[r.id]   || 0
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
        const sourced  = attached + pending
        // Settled = arrival day passed OR ops manually closed a small
        // residual pipeline. Either way the leftover folds into gain.
        const settled  = !!(r.date && String(r.date) < todayIst) || !!r.pipeline_closed_at
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
        'cancellation_approved',
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
    //   3 = ewb_cancelled / einvoice_cancelled (has doc no, ack, reason)
    //   2 = cancelled (RPC marker, carries had_ewb/had_irn flags)
    //   1 = cancellation_approved (route marker, carries portal_cancelled list)
    const eventsByConsignment = new Map()
    for (const e of events || []) {
      const existing = eventsByConsignment.get(e.consignment_id)
      if (!existing) { eventsByConsignment.set(e.consignment_id, e); continue }
      const specifity = (t) => {
        if (t === 'ewb_cancelled' || t === 'einvoice_cancelled') return 3
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
        .select('id, tmp_prf_no, branch_name, dest_branch, movement_type, total_bills, total_amount, total_net_wt, approval_status, status, rejection_reason, created_at, eway_bill_no, irn')
        .in('id', ids)
      if (cErr) return Response.json({ error: cErr.message }, { status: 500 })
      consignmentsAll = (cs || []).map(c => ({ ...c, total_gross_value: c.total_amount }))
    }
    const byId = new Map(consignmentsAll.map(c => [c.id, c]))
    const inScope = (c) => !allowedBranches || (c && allowedBranches.includes(c.branch_name))

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
      if (e.event_type === 'cancelled') {
        if (e.details?.had_ewb) inferredType = 'ewb_cancelled'
        else if (e.details?.had_irn) inferredType = 'einvoice_cancelled'
      } else if (e.event_type === 'cancellation_approved') {
        // portal_cancelled is a free-form string array: ["EWB 123 cancelled on NIC", "E-Invoice cancelled on IRP", ...]
        // Sniff for the EWB pattern first so combo cases (had both) prefer EWB
        // styling — matches the priority in the upstream cancel flow.
        const portal = e.details?.portal_cancelled
        const hasEwb = Array.isArray(portal) && portal.some(p => /\bewb\b/i.test(String(p)))
        const hasIrn = Array.isArray(portal) && portal.some(p => /e-?invoice|irp|irn/i.test(String(p)))
        if (hasEwb) inferredType = 'ewb_cancelled'
        else if (hasIrn) inferredType = 'einvoice_cancelled'
        // Last resort: read the consignment row itself if it was cancelled,
        // since the portal_cancelled array may be empty for pre-doc cancels.
        else if (c?.status === 'cancelled') inferredType = 'cancelled'
      }
      // Also surface the doc number on the synthesized details so the UI
      // shows something useful even when only the cancellation_approved
      // event survived (the canonical EWB/IRN cancel events carry it
      // directly; for fallbacks we read it from the consignment row, or
      // from the portal_cancelled array as a last resort).
      const synthDetails = { ...(e.details || {}) }
      if (inferredType === 'ewb_cancelled' && !synthDetails.ewb_no) {
        const portal = e.details?.portal_cancelled
        const ewbFromPortal = Array.isArray(portal)
          ? (portal.find(p => /ewb\s+\S+/i.test(String(p))) || '').match(/ewb\s+(\S+)/i)?.[1]
          : null
        synthDetails.ewb_no = ewbFromPortal || c?.eway_bill_no || null
      }
      if (inferredType === 'einvoice_cancelled' && !synthDetails.irn) {
        synthDetails.irn = c?.irn || null
      }
      return [{
        ...e,
        event_type:           inferredType,
        details:              synthDetails,
        consignment:          c || null,
        consignment_missing:  !c,
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
    const fromDate = searchParams.get('from')
    const toDate   = searchParams.get('to')
    const isDateRange = !!(fromDate || toDate)

    // Slim select — the Consignment Report only displays App ID / Purchase /
    // Customer / Branch / Gross / Net / Gross Amt / Dispatched Date / Status,
    // plus consignment metadata via a separate query. Skipping the stone /
    // wastage / svc / final / transaction_type columns reduces payload on
    // wider date ranges and lets the Postgres index-only path apply.
    let billsQ = supabase
      .from('purchases')
      .select('id, application_id, branch_name, customer_name, purchase_date, gross_weight, net_weight, total_amount, dispatched_at, stock_status')
      .eq('is_deleted', false)
    if (isDateRange) {
      // dispatched_at is TIMESTAMPTZ — convert YYYY-MM-DD (IST) to UTC instants
      // at IST midnight bounds so the day comparison aligns with the operator's
      // calendar instead of UTC.
      if (fromDate) billsQ = billsQ.gte('dispatched_at', `${fromDate}T00:00:00+05:30`)
      if (toDate)   billsQ = billsQ.lte('dispatched_at', `${toDate}T23:59:59+05:30`)
      // Exclude bills that were never dispatched (still at_branch or returned).
      billsQ = billsQ.not('dispatched_at', 'is', null)
    } else {
      billsQ = billsQ.eq('stock_status', 'in_consignment')
    }
    // Filter by branch_name (origin) so a region-restricted user only sees their bills.
    if (allowedBranches) billsQ = billsQ.in('branch_name', allowedBranches)
    const { data: bills, error: be } = await billsQ

    if (be) return Response.json({ error: be.message }, { status: 500 })
    if (!bills?.length) return Response.json({ data: [] })

    // Attach branch region + delivery TAT to each bill so the client doesn't
    // need a second lookup. Bangalore included — date-range mode covers it
    // via the 19:30 IST lifecycle and direct-to-HO Bangalore dispatches.
    // delivery_tat_hours drives the Expected Delivery column in the Consignment
    // Report: 24h-TAT → next IST day, 48h-TAT → day after, etc.
    const branchNames = [...new Set(bills.map(b => b.branch_name).filter(Boolean))]
    const { data: brRows } = branchNames.length
      ? await supabase.from('branches').select('name, region, delivery_tat_hours').in('name', branchNames)
      : { data: [] }
    const regionByBranch = Object.fromEntries((brRows || []).map(b => [b.name, b.region]))
    const tatByBranch    = Object.fromEntries((brRows || []).map(b => [b.name, Number(b.delivery_tat_hours) || null]))

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
        region: regionByBranch[b.branch_name] || null,
        delivery_tat_hours: tatByBranch[b.branch_name] ?? null,
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
  const BIDDING_WRITES = new Set(['set_bidding_pending', 'create_booking', 'update_booking_status', 'close_booking_pipeline', 'toggle_bill_hold'])
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

  // ── Approve a pending cancellation request (accounts side) ───────────────
  // Three-step flow done server-side so accounts never needs to leave the app:
  //   1. Cancel the EWB on NIC (if one was generated). Hard failure stops the
  //      whole approval — operations team can inspect the error and retry.
  //   2. Cancel the IRN on IRP (if one was generated). Same hard-fail policy.
  //   3. Void the consignment via cancel_consignment_atomic (frees bills,
  //      marks status='cancelled' in a single txn).
  // Audit log entries written at each step so the timeline reads sequentially.
  if (action === 'approve_cancellation') {
    const { id } = body
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
    const composedReason = `Approved by accounts (${actorEmail}). Operations reason: ${c.cancellation_reason || '—'}`
    const portalCancelled = []  // tracks what we cancelled for the audit + UI

    // STEP 1 — EWB on NIC
    if (c.eway_bill_no) {
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
        console.error('[approve_cancellation] NIC EWB cancel failed:', err)
        return Response.json({
          error: `Could not cancel the E-Way Bill on NIC: ${err.message || 'unknown error'}. Nothing has been changed. Try again or escalate if NIC is down.`,
        }, { status: 502 })
      }
    }

    // STEP 2 — IRN on IRP
    if (c.irn) {
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
        console.error('[approve_cancellation] IRP E-Invoice cancel failed:', err)
        // EWB may have already been cancelled by this point — that's an
        // inconsistent state. Tell the user precisely so they can decide.
        const ewbNote = portalCancelled.length
          ? ` Note: the E-Way Bill was already cancelled on NIC. The consignment has NOT been voided.`
          : ''
        return Response.json({
          error: `Could not cancel the E-Invoice on IRP: ${err.message || 'unknown error'}.${ewbNote}`,
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

    // Clear the portal-doc fields locally so the UI stops showing them as
    // active. Done after the RPC so the RPC's "already cancelled" guard
    // doesn't trip on a row we've just cancelled.
    const clearUpdate = {}
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

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'cancellation_approved',
      actor_email:    actorEmail,
      actor_role:     auth.role,
      details: {
        operations_reason: c.cancellation_reason,
        requested_by:      c.cancellation_requested_by,
        requested_at:      c.cancellation_requested_at,
        portal_cancelled:  portalCancelled,
      },
    })

    // Compose a user-facing message that names what was cancelled where.
    const parts = ['Cancellation approved.', 'Bills returned to source branch.']
    if (portalCancelled.length) parts.push(portalCancelled.join(' · ') + '.')

    return Response.json({
      data:    rpcCancelled || { id, status: 'cancelled' },
      message: parts.join(' '),
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
    // gain_rate — the booking's refining-margin rate. Kerala = 0,
    // everything else the 3.5 % standard. The new gain model derives
    // gain = sourced_net × gain_rate, so this is the single number that
    // ties net weight to bid weight.
    breakdownPayload.gain_rate = is_kl ? 0 : 0.035
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
          .update({ booking_id: data.id, booked_at: bookedAt })
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

    return Response.json({ data, message: 'Booking created.' })
  }

  // ── At-risk bookings summary ─────────────────────────────────────────────
  // Aggregates today's bookings whose attached bills are still at_branch past
  // the source branch's pickup_time + 2h grace. Powers the 7pm in-app banner
  // shown to anyone with bidding access — listing party / weight / source
  // branches so ops can immediately spot what's stuck.
  //
  // Same at_risk logic as bidding_bookings (single-flag derivation); rolled
  // up into a flat summary that the dashboard banner can render in one read.
  if (action === 'bidding_at_risk_summary') {
    const todayIst = istToday()
    // Today's bookings (created_at IST) that are still active.
    const { data: bookings, error: bkErr } = await supabase
      .from('cal_quotas')
      .select('id, party, weight, is_kl, status, created_at')
      .gte('created_at', istStartOfDayIso(todayIst))
      .lt('created_at',  istEndOfDayIso(todayIst))
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

  // ── Hub Dispatch (Bangalore) ─────────────────────────────────────────────
  // One-click create-consignment for a Bangalore hub. Replaces the outstation
  // pick-branch / pick-bills / create-consignment / download-report /
  // download-challan / preview-EWB / generate-EWB chain — the operator just
  // clicks "Dispatch" on the hub card and we:
  //
  //   1. Resolve eligible bills: every at_branch bill belonging to the hub
  //      itself OR to any leaf whose hub_branch_name = <hub>. Filtered to
  //      crm_status='approved', is_deleted=false, booking_id IS NULL, and
  //      not already audit-consumed.
  //   2. Pre-stamp current_branch = <hub> on those bills so they pass the
  //      same-branch validation in create_consignment_atomic. This is the
  //      "Transaction Executive sweeps the hub" leg modelled as an instant
  //      transfer — no separate INTERNAL consignment.
  //   3. Build per-bill snapshots, generate the consignment numbers, and
  //      create one EXTERNAL consignment via the atomic RPC.
  //   4. Auto-stamp ops_confirmed_at + consignee_report_generated_at so the
  //      sequential workflow gate releases — the operator can fire Challan
  //      and EWB on demand from the Consignment Data page.
  //   5. Flip the bills' stock_status to 'in_consignment' (the atomic RPC
  //      leaves them at_branch; for hub dispatch we approve in the same
  //      breath since there's no separate accounts-approval queue for it).
  //
  // Returns { consignment, summary } where summary is the branch-wise
  // breakdown the UI rendered in the confirmation dialog.
  if (action === 'create_hub_consignment') {
    const { hub_branch_name, transaction_executive } = body
    if (!hub_branch_name) return Response.json({ error: 'hub_branch_name required' }, { status: 400 })
    // Transaction Executive name (who physically picks up the hub) is
    // surfaced on the UI as required. Trim + truncate defensively in case
    // the picker ever sends garbage. Stored on logistics_notes for now;
    // a dedicated column can replace this when the TE roster is wired in.
    const teClean = (typeof transaction_executive === 'string' ? transaction_executive : '').trim().slice(0, 80) || null

    // 1) Resolve the hub + its leaves.
    const { data: hubBranch, error: hubErr } = await supabase
      .from('branches')
      .select('*')
      .eq('name', hub_branch_name)
      .single()
    if (hubErr || !hubBranch) return Response.json({ error: `Hub '${hub_branch_name}' not found` }, { status: 404 })
    if (!hubBranch.is_hub)     return Response.json({ error: `'${hub_branch_name}' is not configured as a hub.` }, { status: 400 })
    if (hubBranch.region !== 'Bangalore') return Response.json({ error: 'Hub dispatch is a Bangalore-only flow.' }, { status: 400 })

    // Two separate queries instead of a single .or() — PostgREST's or()
    // parser treats commas and periods as separators and chokes on
    // unquoted spaces, which silently dropped hubs whose name contains
    // a space (e.g. 'K R PURAM'). The single-clause variants below are
    // bulletproof regardless of the hub's spelling.
    const [hubRow, leafRows] = await Promise.all([
      supabase.from('branches').select('name').eq('name', hub_branch_name).eq('is_active', true).maybeSingle(),
      supabase.from('branches').select('name').eq('hub_branch_name', hub_branch_name).eq('region', 'Bangalore').eq('is_active', true),
    ])
    const memberSet = new Set()
    if (hubRow.data?.name) memberSet.add(hubRow.data.name)
    for (const b of leafRows.data || []) memberSet.add(b.name)
    const memberNames = [...memberSet]
    if (memberNames.length === 0) return Response.json({ error: 'No branches resolved for this hub.' }, { status: 400 })

    // 2) Discover eligible at_branch bills across the hub + its leaves.
    const { data: bills, error: billsErr } = await supabase
      .from('purchases')
      .select('id, application_id, sl_no, branch_name, current_branch, customer_name, gross_weight, net_weight, total_amount, purchase_date, stock_status, crm_status, booking_id, audit_consumed_at')
      .in('branch_name', memberNames)
      .eq('stock_status', 'at_branch')
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
      .is('booking_id', null)
      .is('audit_consumed_at', null)
    if (billsErr) return Response.json({ error: billsErr.message }, { status: 500 })
    if (!bills || bills.length === 0) {
      return Response.json({ error: 'No eligible at_branch bills to dispatch from this hub right now.' }, { status: 400 })
    }
    if (bills.length > 100) {
      return Response.json({
        error: `Too many bills (${bills.length}). One consignment can carry at most 100 bills — split into multiple dispatches.`,
      }, { status: 400 })
    }

    // Quality validation — same gate as create_consignment.
    const todayIso = istToday()
    const qualityErrors = []
    for (const p of bills) {
      const tag = p.sl_no || `bill ${p.id}`
      const wt = Number(p.gross_weight ?? p.net_weight ?? 0)
      if (wt <= 0)                                            qualityErrors.push(`${tag}: weight is 0 or missing`)
      if (Number(p.total_amount || 0) <= 0)                    qualityErrors.push(`${tag}: amount is 0 or missing`)
      if (!p.customer_name || !String(p.customer_name).trim()) qualityErrors.push(`${tag}: customer name is missing`)
      if (p.purchase_date && String(p.purchase_date).slice(0, 10) > todayIso) {
        qualityErrors.push(`${tag}: purchase date is in the future (${p.purchase_date})`)
      }
    }
    if (qualityErrors.length) {
      return Response.json({
        error: 'Some bills have incomplete data and cannot be dispatched. Fix in Purchases first:\n' + qualityErrors.slice(0, 10).join('\n') + (qualityErrors.length > 10 ? `\n…and ${qualityErrors.length - 10} more` : ''),
      }, { status: 400 })
    }

    // Build branch-wise summary first so we can return it even on partial failure.
    const summaryMap = {}
    for (const b of bills) {
      const src = b.branch_name
      if (!summaryMap[src]) summaryMap[src] = { branch_name: src, bills: 0, gross_wt: 0, net_wt: 0, value: 0 }
      summaryMap[src].bills    += 1
      summaryMap[src].gross_wt += Number(b.gross_weight || 0)
      summaryMap[src].net_wt   += Number(b.net_weight   || 0)
      summaryMap[src].value    += Number(b.total_amount || 0)
    }
    const summary = Object.values(summaryMap).sort((a, b) => b.gross_wt - a.gross_wt)
    const billIds = bills.map(b => b.id)

    // 3) Pre-stamp current_branch on every leaf bill so create_consignment's
    //    same-branch validation isn't a problem in future flows (and so
    //    Branch Stock immediately shows the bills at the hub).
    const leafBillIds = bills.filter(b => b.branch_name !== hub_branch_name).map(b => b.id)
    if (leafBillIds.length > 0) {
      const { error: stampErr } = await supabase
        .from('purchases')
        .update({ current_branch: hub_branch_name })
        .in('id', leafBillIds)
      if (stampErr) return Response.json({ error: `Failed to virtualize leaves at hub: ${stampErr.message}` }, { status: 500 })
    }

    // 4) Number generation.
    const stateCode  = regionToStateCode(hubBranch.region) || 'KA'
    const branchCode = autoBranchCode(hub_branch_name)
    let tmpPrfNo = await generateTmpPrfNo(supabase, hub_branch_name)
    let extNo = null, challan = null
    const ext = await generateExternalNo(supabase, branchCode, stateCode)
    extNo   = ext.extNo
    challan = ext.challan

    // GST snapshot (same logic as create_consignment).
    const { data: cs } = await supabase.from('company_settings').select('*').single()
    const igstRate = parseFloat(cs?.igst_rate ?? 3) || 3
    const gstSnapshot = {
      igst: igstRate,
      cgst: parseFloat(cs?.cgst_rate ?? (igstRate / 2)) || (igstRate / 2),
      sgst: parseFloat(cs?.sgst_rate ?? (igstRate / 2)) || (igstRate / 2),
      hsn:  cs?.hsn_code || '71131910',
      captured_at: new Date().toISOString(),
    }
    const sourceGstinKey  = `gstin_${stateCode.toLowerCase()}`
    const sourceGstinSnap = cs?.[sourceGstinKey] || hubBranch.branch_gstin || cs?.gstin || null

    // 5) Build snapshots + create the consignment.
    const itemSnapshots = bills.map(p => ({
      purchase_id:   p.id,
      bill_no:       p.sl_no != null ? String(p.sl_no) : null,
      gross_weight:  Number(p.gross_weight ?? 0) || 0,
      net_weight:    Number(p.net_weight   ?? 0) || 0,
      total_amount:  Number(p.total_amount ?? 0) || 0,
      customer_name: p.customer_name || null,
      purchase_date: p.purchase_date ? String(p.purchase_date).slice(0, 10) : null,
    }))
    const totalNetWt   = itemSnapshots.reduce((s, i) => s + i.net_weight,   0)
    const totalGrossWt = itemSnapshots.reduce((s, i) => s + i.gross_weight, 0)
    const totalAmount  = itemSnapshots.reduce((s, i) => s + i.total_amount, 0)

    let rpcConsignment = null
    let rpcErr         = null
    const MAX_RETRIES  = 5
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await supabase.rpc('create_consignment_atomic', {
        p_payload: {
          consignment_no:  challan,
          tmp_prf_no:      tmpPrfNo,
          external_no:     extNo,
          challan_no:      challan,
          branch_name:     hub_branch_name,
          branch_code:     branchCode,
          state_code:      stateCode,
          movement_type:   'EXTERNAL',
          dest_branch:     null,
          total_bills:     billIds.length,
          total_net_wt:    totalNetWt,
          total_gross_wt:  totalGrossWt,
          total_amount:    totalAmount,
          gst_snapshot:    gstSnapshot,
          created_by:      actorEmail,
          added_by:        auth.user?.id || null,
          purchase_ids:    billIds,
          source_address:  hubBranch.address  || null,
          source_city:     hubBranch.city     || null,
          source_pin:      hubBranch.pin_code || null,
          source_state:    hubBranch.state    || null,
          source_region:   hubBranch.region   || null,
          source_gstin:    sourceGstinSnap,
          item_snapshots:  itemSnapshots,
        },
      })
      rpcConsignment = result.data
      rpcErr         = result.error
      const isNumberCollision = rpcErr?.code === '23505' && /consignment_no|external_no|challan_no|tmp_prf/i.test(rpcErr.message || '')
      if (!isNumberCollision || attempt >= MAX_RETRIES) break
      await new Promise(r => setTimeout(r, 80 + Math.random() * 160))
      tmpPrfNo = await generateTmpPrfNo(supabase, hub_branch_name)
      const r2 = await generateExternalNo(supabase, branchCode, stateCode)
      extNo   = r2.extNo
      challan = r2.challan
    }
    if (rpcErr) return Response.json({ error: rpcErr.message }, { status: 500 })
    if (!rpcConsignment) return Response.json({ error: 'Consignment creation returned no row.' }, { status: 500 })

    // 6) Auto-stamp the workflow timestamps so Challan + EWB can fire without
    //    the ops_confirmed / consignee_report sequential checks blocking.
    //    Bangalore hub dispatch is operator-driven end-to-end, so these
    //    intermediate confirmations don't model the workflow.
    const nowIso = new Date().toISOString()
    await supabase
      .from('consignments')
      .update({
        ops_confirmed_at:              nowIso,
        ops_confirmed_by:              auth.user?.id || null,
        consignee_report_generated_at: nowIso,
        approval_status:               'approved',
        approved_at:                   nowIso,
      })
      .eq('id', rpcConsignment.id)

    // 7) Flip bills' stock_status to in_consignment (the atomic RPC leaves
    //    them at_branch). Mirrors the approve_consignment step which the
    //    outstation flow runs separately.
    const { error: flipErr } = await supabase
      .from('purchases')
      .update({ stock_status: 'in_consignment', dispatched_at: nowIso })
      .in('id', billIds)
    if (flipErr) console.warn('[create_hub_consignment] stock_status flip warning:', flipErr.message)

    // 8) Stash the Transaction Executive who picked up this hub. Stored
    //    on the activity-log row (where details is JSONB) so it's audit-
    //    visible immediately without a schema change. If the consignments
    //    table later grows a dedicated transaction_executive column we
    //    can move this to a first-class field.
    if (teClean) {
      try {
        await supabase.from('consignment_activity_log').insert({
          consignment_id: rpcConsignment.id,
          event_type:     'hub_picked_up',
          actor_email:    actorEmail,
          details:        { transaction_executive: teClean, hub: hub_branch_name },
        })
      } catch (logErr) {
        console.warn('[create_hub_consignment] TE log write failed (non-fatal):', logErr?.message)
      }
    }

    return Response.json({
      success: true,
      consignment: {
        ...rpcConsignment,
        ops_confirmed_at:                nowIso,
        consignee_report_generated_at:   nowIso,
        transaction_executive:           teClean,
      },
      summary,
      totals: {
        bills: billIds.length,
        gross_wt: Number(totalGrossWt.toFixed(3)),
        net_wt:   Number(totalNetWt.toFixed(3)),
        value:    Number(totalAmount.toFixed(2)),
      },
    })
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

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}