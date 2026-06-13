// app/api/eod-branch-snapshot/route.js
//
// EOD Branch Stock Report — "how much gold was lying AT THE BRANCH at end of
// day, and which cases", frozen daily at 22:00 IST (10 PM).
//
//   POST  /api/eod-branch-snapshot               → capture today's at-branch
//                                                   stock (region + branch
//                                                   rollups + bill-level cases),
//                                                   upsert. Auth: ADMIN or
//                                                   X-Cron-Token (the cron hits
//                                                   this at 22:00 IST).
//   GET   /api/eod-branch-snapshot?list=1        → recent snapshot dates (picker)
//   GET   /api/eod-branch-snapshot?date=YYYY-MM-DD → that day's summary
//   GET   /api/eod-branch-snapshot?date=...&branch=NAME → the cases for one
//                                                   branch on that date.
//
// At-branch only (stock_status='at_branch' — not yet dispatched). Distinct from
// /api/eod-inventory-snapshot (23:30, at_branch + in_transit, aggregate-only).

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'
import { istToday } from '../../../lib/dateIst'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const emptyAgg = () => ({ gross_wt: 0, net_wt: 0, gross_amt: 0, bills: 0 })
const addToAgg = (agg, b) => {
  agg.gross_wt  += Number(b.gross_weight || 0)
  agg.net_wt    += Number(b.net_weight   || 0)
  agg.gross_amt += Number(b.total_amount || 0)
  agg.bills     += 1
}

// Page through every at_branch bill (the picker overflows past 1000 rows).
async function fetchAllAtBranch() {
  const CHUNK = 1000
  let from = 0
  const all = []
  while (true) {
    const { data, error } = await supabase
      .from('purchases')
      .select('id, application_id, branch_name, current_branch, customer_name, purchase_date, gross_weight, net_weight, total_amount')
      .eq('stock_status', 'at_branch')
      .eq('is_deleted', false)
      .neq('crm_status', 'deleted')
      .range(from, from + CHUNK - 1)
    if (error) throw new Error(`purchases select failed: ${error.message}`)
    if (!data?.length) break
    all.push(...data)
    if (data.length < CHUNK) break
    from += CHUNK
  }
  return all
}

async function buildSnapshot(actor) {
  const snapshotDate = istToday()
  const bills = await fetchAllAtBranch()

  const { data: branches, error: brErr } = await supabase
    .from('branches').select('name, region')
  if (brErr) throw new Error(`branches select failed: ${brErr.message}`)
  const regionByBranch = Object.fromEntries((branches || []).map(b => [b.name, b.region]))

  const total       = emptyAgg()
  const byRegion    = {}   // region → agg (+ branch set)
  const byBranchMap = {}   // branch → { branch_name, region, ...agg }
  const items       = []   // bill-level rows

  for (const bill of bills) {
    // at_branch bills physically sit at current_branch (covers leaf→hub
    // transfers); fall back to branch_name when current_branch is null.
    const ownerBranch = bill.current_branch || bill.branch_name
    const region      = regionByBranch[ownerBranch] || 'Unknown'

    addToAgg(total, bill)

    if (!byRegion[region]) byRegion[region] = { ...emptyAgg(), _branches: new Set() }
    addToAgg(byRegion[region], bill)
    byRegion[region]._branches.add(ownerBranch)

    if (!byBranchMap[ownerBranch]) byBranchMap[ownerBranch] = { branch_name: ownerBranch, region, ...emptyAgg() }
    addToAgg(byBranchMap[ownerBranch], bill)

    items.push({
      snapshot_date:  snapshotDate,
      branch_name:    ownerBranch,
      region,
      application_id: bill.application_id,
      customer_name:  bill.customer_name,
      purchase_date:  bill.purchase_date,
      gross_weight:   Number(bill.gross_weight || 0),
      net_weight:     Number(bill.net_weight   || 0),
      total_amount:   Number(bill.total_amount || 0),
    })
  }

  // Finalise region buckets (swap the branch Set for a count).
  const byRegionOut = {}
  for (const [region, agg] of Object.entries(byRegion)) {
    const { _branches, ...rest } = agg
    byRegionOut[region] = { ...rest, branches: _branches.size }
  }
  total.branches = Object.keys(byBranchMap).length
  const byBranch = Object.values(byBranchMap).sort((a, b) => b.net_wt - a.net_wt)

  // Upsert the summary (idempotent on snapshot_date).
  const { data: saved, error: upErr } = await supabase
    .from('eod_branch_stock_snapshots')
    .upsert({ snapshot_date: snapshotDate, generated_by: actor || 'system', total, by_region: byRegionOut, by_branch: byBranch }, { onConflict: 'snapshot_date' })
    .select()
    .single()
  if (upErr) throw new Error(`snapshot upsert failed: ${upErr.message}`)

  // Replace the day's items (delete-then-insert so a re-run is clean).
  await supabase.from('eod_branch_stock_items').delete().eq('snapshot_date', snapshotDate)
  if (items.length) {
    const INS = 500
    for (let i = 0; i < items.length; i += INS) {
      const { error: insErr } = await supabase.from('eod_branch_stock_items').insert(items.slice(i, i + INS))
      if (insErr) throw new Error(`items insert failed: ${insErr.message}`)
    }
  }

  return saved
}

// ── POST: generate today's snapshot (cron at 22:00 IST, or admin) ───────────
export async function POST(req) {
  const cronToken = req.headers.get('x-cron-token')
  let actorEmail = 'cron'
  if (process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET) {
    // cron-authorised
  } else {
    const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
    if (!auth.ok) return auth.response
    actorEmail = auth.profile?.email || auth.user?.email || 'admin'
  }
  try {
    const saved = await buildSnapshot(actorEmail)
    return Response.json({ success: true, snapshot: saved })
  } catch (e) {
    return Response.json({ error: e.message || 'snapshot failed' }, { status: 500 })
  }
}

// ── GET: list dates / one day's summary / one branch's cases ────────────────
export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ANY })
  if (!auth.ok) return auth.response

  const url    = new URL(req.url)
  const list   = url.searchParams.get('list')
  const date   = url.searchParams.get('date')
  const branch = url.searchParams.get('branch')

  if (list) {
    const { data, error } = await supabase
      .from('eod_branch_stock_snapshots')
      .select('snapshot_date, generated_at, generated_by')
      .order('snapshot_date', { ascending: false })
      .limit(120)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ list: data || [] })
  }

  // Drill-down: the cases (bills) for one branch on one date.
  if (date && branch) {
    const { data, error } = await supabase
      .from('eod_branch_stock_items')
      .select('application_id, customer_name, purchase_date, gross_weight, net_weight, total_amount')
      .eq('snapshot_date', date)
      .eq('branch_name', branch)
      .order('net_weight', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ items: data || [] })
  }

  // One day's summary (or the most recent).
  const q = supabase
    .from('eod_branch_stock_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(1)
  const { data, error } = date ? await q.eq('snapshot_date', date).maybeSingle() : await q.maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data)  return Response.json({ snapshot: null }, { status: 404 })
  return Response.json({ snapshot: data })
}
