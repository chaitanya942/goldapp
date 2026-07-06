// lib/consignmentReportData.js
// Shared builder for the consignment "in-transit stock" ledger — the per-bill
// rows behind the Consignment Report screen (action=in_transit_stock) and the
// scheduled Finance consignment report, so both show identical data.
//
// Returns every bill whose owning consignment was CREATED in the [from,to] IST
// window (regardless of current stock_status — a bill received later still
// appears for the day it was consigned). Extracted verbatim from the route so
// there is one source of truth.
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

/**
 * @param {object} o
 * @param {string} [o.from]  YYYY-MM-DD IST — filter consignments.created_at >= from 00:00
 * @param {string} [o.to]    YYYY-MM-DD IST — filter consignments.created_at <= to 23:59
 * @param {string[]|null} [o.allowedBranches]  restrict to these branch names (null = all)
 * @returns {Promise<Array>} enriched per-bill rows
 */
export async function fetchInTransitStock({ from = null, to = null, allowedBranches = null } = {}) {
  // Step 1 — consignment_items joined to their (approved, non-cancelled,
  // dispatched) consignment, windowed by creation date, paginated.
  const PAGE = 1000
  const MAX_PAGES = 60
  let offset = 0
  const itemRows = []
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase
      .from('consignment_items')
      .select('purchase_id, consignments!inner(id, tmp_prf_no, branch_name, dest_branch, movement_type, status, approval_status, dispatched_at, created_at)')
      .neq('consignments.status', 'cancelled')
      .neq('consignments.status', 'seed')
      .not('consignments.dispatched_at', 'is', null)
      .order('purchase_id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (from) q = q.gte('consignments.created_at', `${from}T00:00:00+05:30`)
    if (to)   q = q.lte('consignments.created_at', `${to}T23:59:59+05:30`)
    if (allowedBranches) q = q.in('consignments.branch_name', allowedBranches)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data?.length) break
    itemRows.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  if (!itemRows.length) return []

  // De-dup per bill: keep the most-recently-created active consignment.
  const consByPurchase = {}
  for (const row of itemRows) {
    const c = row.consignments
    if (!c) continue
    const prev = consByPurchase[row.purchase_id]
    if (!prev || new Date(c.created_at) > new Date(prev.created_at)) consByPurchase[row.purchase_id] = c
  }
  const purchaseIds = Object.keys(consByPurchase)
  if (!purchaseIds.length) return []

  // Step 2 — fetch the bills (no FK to purchases → fetch by id, chunked).
  const P_CHUNK = 100
  const WAVE = 10
  const PCOLS = 'id, application_id, branch_name, customer_name, purchase_date, gross_weight, net_weight, total_amount, dispatched_at, booked_at, stock_status'
  const bills = []
  for (let i = 0; i < purchaseIds.length; i += P_CHUNK * WAVE) {
    const waveSlices = []
    for (let j = i; j < Math.min(i + P_CHUNK * WAVE, purchaseIds.length); j += P_CHUNK) waveSlices.push(purchaseIds.slice(j, j + P_CHUNK))
    const results = await Promise.all(waveSlices.map(slice =>
      supabase.from('purchases').select(PCOLS).in('id', slice).eq('is_deleted', false)
    ))
    for (const r of results) {
      if (r.error) throw new Error(r.error.message)
      bills.push(...(r.data || []))
    }
  }
  if (!bills.length) return []

  // Branch region + delivery TAT.
  const branchNames = [...new Set(bills.map(b => b.branch_name).filter(Boolean))]
  const { data: brRows } = branchNames.length
    ? await supabase.from('branches').select('name, region, delivery_tat_hours').in('name', branchNames)
    : { data: [] }
  const regionByBranch = Object.fromEntries((brRows || []).map(b => [b.name, b.region]))
  const tatByBranch = Object.fromEntries((brRows || []).map(b => [b.name, Number(b.delivery_tat_hours) || null]))

  return bills.map(b => {
    const c = consByPurchase[b.id]
    return {
      ...b,
      region: regionByBranch[b.branch_name] || null,
      delivery_tat_hours: tatByBranch[b.branch_name] ?? null,
      consignment_created_at: c?.created_at || null,
      consignment: c ? {
        id: c.id, tmp_prf_no: c.tmp_prf_no,
        source: c.branch_name, dest: c.dest_branch,
        movement_type: c.movement_type,
        status: c.status, approval_status: c.approval_status,
        dispatched_at: c.dispatched_at, created_at: c.created_at,
      } : null,
    }
  })
}
