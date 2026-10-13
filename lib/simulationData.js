// Data for the live Simulation map (see app/api/simulation/route.js).
// Definitions mirror the existing screens:
//   stock    = branch_stock_summary('at_branch') RPC (Branch Stock screen)
//   booked   = purchases.booking_id set (cal_quotas)
//   HO today = stock_status 'at_ho' with received_at today (IST)
//   bookings = cal_quotas created today, not cancelled

import { selectAllRows } from './supabaseAll'
import { istToday, istStartOfDayIso, istEndOfDayIso } from './dateIst'

// The HO is the (inactive) KA-KORAMANGALA branch row — same mapping the CRM
// alias table uses for 'ho' / 'head office'.
export const HO_BRANCH = 'KA-KORAMANGALA'
const LIVE_STATUSES = ['dispatched', 'received']

const num = (v) => Number(v) || 0
const r1 = (v) => Math.round(v * 10) / 10

export async function buildSimulationOverview(supabase) {
  const today = istToday()
  const dayStart = istStartOfDayIso(today)
  const dayEnd = istEndOfDayIso(today)

  const [branchesRes, stockRes, booked, consRes, hoBills, quotasRes] = await Promise.all([
    supabase.from('branches')
      .select('name, region, city, state, address, pin_code, lat, lng, is_active, is_hub, hub_branch_name, model_type, delivery_tat_hours')
      .or(`is_active.eq.true,name.eq.${HO_BRANCH}`),
    supabase.rpc('branch_stock_summary', { p_stock_status: 'at_branch' }),
    selectAllRows(() => supabase.from('purchases')
      .select('branch_name, current_branch, net_weight')
      .eq('stock_status', 'at_branch').eq('is_deleted', false).not('booking_id', 'is', null)),
    supabase.from('consignments')
      .select('id, tmp_prf_no, challan_no, branch_name, dest_branch, movement_type, status, approval_status, created_at, dispatched_at, received_at, total_bills, total_net_wt, total_gross_wt, total_amount, eway_bill_no, irn, vehicles, transporter_name, transport_mode')
      // Created today, or created earlier but received today (counts toward
      // today's HO inventory).
      .or(`and(created_at.gte.${dayStart},created_at.lte.${dayEnd}),and(received_at.gte.${dayStart},received_at.lte.${dayEnd})`)
      .in('status', LIVE_STATUSES)
      .order('created_at', { ascending: true }),
    selectAllRows(() => supabase.from('purchases')
      .select('id, branch_name, current_branch, net_weight, gross_weight, booking_id, received_at')
      .eq('stock_status', 'at_ho').eq('is_deleted', false)
      .gte('received_at', dayStart).lte('received_at', dayEnd)),
    supabase.from('cal_quotas').select('id, party, weight, rate, status, created_at')
      .gte('created_at', dayStart).lte('created_at', dayEnd).neq('status', 'cancelled'),
  ])
  for (const r of [branchesRes, stockRes, consRes, quotasRes]) if (r.error) throw r.error

  // Booked bills still at branch, by physical branch.
  const bookedBy = {}
  for (const p of booked) {
    const k = p.current_branch || p.branch_name
    const b = (bookedBy[k] ||= { bills: 0, net: 0 })
    b.bills++; b.net += num(p.net_weight)
  }

  const stockBy = Object.fromEntries((stockRes.data || []).map(s => [s.branch_name, s]))
  const allBranches = branchesRes.data || []
  const hoRow = allBranches.find(b => b.name === HO_BRANCH)
  const branches = allBranches.filter(b => b.is_active && b.name !== HO_BRANCH).map(b => {
    const s = stockBy[b.name]
    const bk = bookedBy[b.name] || { bills: 0, net: 0 }
    const bills = num(s?.total_bills)
    return {
      name: b.name, region: b.region || 'Unassigned', city: b.city, state: b.state,
      address: b.address, pin_code: b.pin_code,
      lat: b.lat, lng: b.lng,
      is_hub: !!b.is_hub, hub: b.hub_branch_name || null, model_type: b.model_type,
      tat_hours: b.delivery_tat_hours || null,
      stock: {
        bills, net: r1(num(s?.total_net_wt)), gross: r1(num(s?.total_gross_wt)), value: Math.round(num(s?.total_gross_value)),
        today_bills: num(s?.today_bills), oldest: s?.oldest_pending_date || null,
        booked_bills: Math.min(bk.bills, bills), booked_net: r1(bk.net),
      },
    }
  })
  const tatBy = Object.fromEntries(branches.map(b => [b.name, b.tat_hours]))

  // Booked-bill count per consignment (items → purchases), chunked to keep
  // PostgREST URLs short.
  const cons = consRes.data || []
  const consIds = cons.map(c => c.id)
  const items = []
  for (let i = 0; i < consIds.length; i += 100) {
    const { data, error } = await supabase.from('consignment_items').select('consignment_id, purchase_id').in('consignment_id', consIds.slice(i, i + 100))
    if (error) throw error
    items.push(...(data || []))
  }
  const purchaseIds = [...new Set(items.map(i => i.purchase_id))]
  const bookedIds = new Set()
  for (let i = 0; i < purchaseIds.length; i += 100) {
    const { data, error } = await supabase.from('purchases').select('id, booking_id').in('id', purchaseIds.slice(i, i + 100))
    if (error) throw error
    for (const p of data || []) if (p.booking_id) bookedIds.add(p.id)
  }
  const bookedByCons = {}
  for (const it of items) if (bookedIds.has(it.purchase_id)) bookedByCons[it.consignment_id] = (bookedByCons[it.consignment_id] || 0) + 1

  const consignments = cons.map(c => ({
    id: c.id,
    no: c.tmp_prf_no || c.challan_no || String(c.id).slice(0, 8),
    from: c.branch_name,
    to: c.movement_type === 'EXTERNAL' ? 'HO' : (c.dest_branch || null),
    type: c.movement_type,
    status: c.status,
    approval: c.approval_status,
    created_at: c.created_at,
    dispatched_at: c.dispatched_at || c.created_at,
    received_at: c.received_at,
    bills: num(c.total_bills),
    booked_bills: bookedByCons[c.id] || 0,
    net: r1(num(c.total_net_wt)),
    gross: r1(num(c.total_gross_wt)),
    value: Math.round(num(c.total_amount)),
    ewb: c.eway_bill_no || null,
    irn: c.irn ? true : false,
    vehicles: Array.isArray(c.vehicles) ? c.vehicles : [],
    transporter: c.transporter_name || null,
    mode: c.transport_mode || null,
    tat_hours: tatBy[c.branch_name] || null,
  }))

  // HO inventory received today, by source branch.
  const hoBy = {}
  const arrivalsBy = {}   // per minute × branch — drives the HO yard replay
  let hoNet = 0, hoGross = 0, hoBooked = 0
  for (const p of hoBills) {
    const k = p.current_branch || p.branch_name
    const b = (hoBy[k] ||= { branch: k, bills: 0, net: 0, gross: 0 })
    b.bills++; b.net += num(p.net_weight); b.gross += num(p.gross_weight)
    hoNet += num(p.net_weight); hoGross += num(p.gross_weight)
    if (p.booking_id) hoBooked++
    const at = String(p.received_at).slice(0, 16)
    const a = (arrivalsBy[`${at}|${k}`] ||= { at: new Date(p.received_at).toISOString(), branch: k, bills: 0, net: 0 })
    a.bills++; a.net += num(p.net_weight)
  }

  const quotas = quotasRes.data || []
  return {
    today,
    generatedAt: new Date().toISOString(),
    ho: {
      name: 'Head Office',
      address: hoRow?.address || null,
      lat: hoRow?.lat ?? null,
      lng: hoRow?.lng ?? null,
    },
    branches,
    consignments,
    hoToday: {
      bills: hoBills.length, net: r1(hoNet), gross: r1(hoGross), booked_bills: hoBooked,
      by_branch: Object.values(hoBy).map(b => ({ ...b, net: r1(b.net), gross: r1(b.gross) })).sort((a, b) => b.bills - a.bills),
      arrivals: Object.values(arrivalsBy).map(a => ({ ...a, net: r1(a.net) })).sort((a, b) => (a.at < b.at ? -1 : 1)),
    },
    dayStart,
    bookingsToday: {
      count: quotas.length,
      weight: r1(quotas.reduce((s, q) => s + num(q.weight), 0)),
      value: Math.round(quotas.reduce((s, q) => s + num(q.weight) * num(q.rate), 0)),
    },
    unplaced: branches.filter(b => b.lat == null || b.lng == null).map(b => b.name),
  }
}
