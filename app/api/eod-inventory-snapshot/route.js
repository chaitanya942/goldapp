// app/api/eod-inventory-snapshot/route.js
//
// EOD Physical Stock Report endpoint — generate + read daily inventory snapshots.
//
//   POST  /api/eod-inventory-snapshot           → compute today's snapshot,
//                                                  upsert into eod_inventory_snapshots,
//                                                  return the saved row. Auth: ADMIN
//                                                  or X-Cron-Token header.
//   GET   /api/eod-inventory-snapshot           → most recent snapshot
//   GET   /api/eod-inventory-snapshot?date=...  → snapshot for that specific date
//   GET   /api/eod-inventory-snapshot?list=1    → last 30 snapshot dates (for picker)

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'
import { istToday } from '../../../lib/dateIst'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Branch-region → report-region grouping (matches WGB Inventory Report format).
const REGION_TO_REPORT = {
  'Bangalore':         'Karnataka',
  'Rest of Karnataka': 'Karnataka',
  'Kerala':            'Kerala',
  'Andhra Pradesh':    'Andhra Pradesh and Telangana',
  'Telangana':         'Andhra Pradesh and Telangana',
}

const emptyAgg = () => ({ gross_wt: 0, net_wt: 0, gross_amt: 0, bills: 0 })
const addToAgg = (agg, bill) => {
  agg.gross_wt  += Number(bill.gross_weight || 0)
  agg.net_wt    += Number(bill.net_weight   || 0)
  agg.gross_amt += Number(bill.total_amount || 0)
  agg.bills     += 1
}

async function buildSnapshot(actor) {
  // Pull every bill currently sitting at_branch or in_consignment. Excludes
  // soft-deleted and CRM-deleted so the totals match what Master Purchase Data
  // shows as "active stock".
  const { data: bills, error: billsErr } = await supabase
    .from('purchases')
    .select('branch_name, current_branch, gross_weight, net_weight, total_amount, stock_status')
    .in('stock_status', ['at_branch', 'in_consignment'])
    .eq('is_deleted', false)
    .neq('crm_status', 'deleted')
  if (billsErr) throw new Error(`purchases select failed: ${billsErr.message}`)

  const { data: branches, error: brErr } = await supabase
    .from('branches')
    .select('name, region')
  if (brErr) throw new Error(`branches select failed: ${brErr.message}`)
  const regionByBranch = Object.fromEntries((branches || []).map(b => [b.name, b.region]))

  const notMovedTotal     = emptyAgg()
  const inTransitTotal    = emptyAgg()
  const notMovedByReg     = {}
  const inTransitByReg    = {}
  const notMovedByBranch  = {}
  const inTransitByBranch = {}

  for (const bill of bills || []) {
    // For at_branch bills use current_branch (covers leaf→hub transfers in Kerala);
    // in_consignment bills key off the source branch_name.
    const ownerBranch = bill.stock_status === 'at_branch'
      ? (bill.current_branch || bill.branch_name)
      : bill.branch_name
    const region        = regionByBranch[ownerBranch] || 'Unknown'
    const reportRegion  = REGION_TO_REPORT[region] || 'Other'
    const isNotMoved    = bill.stock_status === 'at_branch'

    // Org-wide totals
    addToAgg(isNotMoved ? notMovedTotal : inTransitTotal, bill)

    // Per-region buckets
    const regBucket = isNotMoved ? notMovedByReg : inTransitByReg
    if (!regBucket[reportRegion]) regBucket[reportRegion] = emptyAgg()
    addToAgg(regBucket[reportRegion], bill)

    // Per-branch buckets — index by branch name, surface region + reportRegion for the UI.
    const brBucket = isNotMoved ? notMovedByBranch : inTransitByBranch
    if (!brBucket[ownerBranch]) {
      brBucket[ownerBranch] = {
        branch_name:   ownerBranch,
        region,
        report_region: reportRegion,
        ...emptyAgg(),
      }
    }
    addToAgg(brBucket[ownerBranch], bill)
  }

  // Sort branch lists by gross_wt desc so heavyweights surface first.
  const sortBranches = (m) => Object.values(m).sort((a, b) => b.gross_wt - a.gross_wt)

  const snapshotDate = istToday()
  const payload = {
    snapshot_date:         snapshotDate,
    generated_by:          actor || 'system',
    not_moved_total:       notMovedTotal,
    in_transit_total:      inTransitTotal,
    not_moved_by_region:   notMovedByReg,
    in_transit_by_region:  inTransitByReg,
    not_moved_by_branch:   sortBranches(notMovedByBranch),
    in_transit_by_branch:  sortBranches(inTransitByBranch),
  }

  const { data: saved, error: upErr } = await supabase
    .from('eod_inventory_snapshots')
    .upsert(payload, { onConflict: 'snapshot_date' })
    .select()
    .single()
  if (upErr) throw new Error(`snapshot upsert failed: ${upErr.message}`)
  return saved
}

// ── POST: generate today's snapshot ─────────────────────────────────────────
export async function POST(req) {
  // Auth — either an ADMIN user OR a cron caller carrying X-Cron-Token.
  const cronToken = req.headers.get('x-cron-token')
  let actorEmail = 'cron'
  if (process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET) {
    // Authorized via cron token; no user attached.
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

// ── GET: fetch snapshot for a date, or the most recent one ──────────────────
export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ANY })
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const list = url.searchParams.get('list')
  if (list) {
    const { data, error } = await supabase
      .from('eod_inventory_snapshots')
      .select('snapshot_date, generated_at, generated_by')
      .order('snapshot_date', { ascending: false })
      .limit(60)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ list: data || [] })
  }

  const date = url.searchParams.get('date')
  const q = supabase
    .from('eod_inventory_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(1)
  const { data, error } = date
    ? await q.eq('snapshot_date', date).maybeSingle()
    : await q.maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data)  return Response.json({ snapshot: null }, { status: 404 })
  return Response.json({ snapshot: data })
}
