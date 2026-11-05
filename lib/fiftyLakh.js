// lib/fiftyLakh.js — 50L+ Transactions (Finance & Accounts).
//
// Customers whose CUMULATIVE purchases in the financial year exceed ₹50,00,000
// (strictly greater), and their bills in the report window, in the Billed vs
// Paid case-wise shape plus FY-cumulative columns.
//
//   • Financial year = 1 Apr → 31 Mar. The cumulative includes EVERY bill this
//     FY — old-CRM bills (archived as crm_status 'archived_old_crm', Apr–15 Jun)
//     and New-CRM bills — even though only window bills are listed.
//   • Amount = final amount (final_amount_crm, else final_amount_calc).
//   • Customer = mobile number (last 10 digits). No customer PAN exists in
//     either CRM, so mobile is the only identifier on every bill.

import { createClient } from '@supabase/supabase-js'
import { buildBilledVsPaidRows } from './billedVsPaid'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

export const FIFTY_LAKH = 5_000_000

export const fyStartFor = (ymd) => {
  const [y, m] = ymd.split('-').map(Number)
  return `${m >= 4 ? y : y - 1}-04-01`
}
export const mobileKey = (p) => {
  const d = String(p || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}
const billAmount = (p) => Number(p.final_amount_crm ?? p.final_amount_calc ?? 0) || 0

const SLIM = 'application_id, customer_name, phone_number, purchase_date, transaction_time, final_amount_crm, final_amount_calc'
const FULL = 'application_id, customer_name, branch_name, crm_source, purchase_date, final_amount_crm, gross_weight, transaction_type, pan_number'
const LIVE_OR_ARCHIVED = 'and(is_deleted.eq.false,crm_status.eq.approved),crm_status.eq.archived_old_crm'
const PAGE = 1000      // = Supabase max_rows
const PARALLEL = 8

async function fetchFyBills(fyStart, to) {
  // select() must come before the filters in supabase-js.
  const base = (cols, opts) => supabase.from('purchases').select(cols, opts)
    .gte('purchase_date', fyStart).lte('purchase_date', to).or(LIVE_OR_ARCHIVED)
  const { count, error } = await base('id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  const pages = Math.ceil((count || 0) / PAGE), out = new Array(pages)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(PARALLEL, pages) }, async () => {
    while (next < pages) {
      const i = next++
      const { data, error: e } = await base(SLIM)
        .order('purchase_date').order('application_id').range(i * PAGE, i * PAGE + PAGE - 1)
      if (e) throw new Error(e.message)
      out[i] = data || []
    }
  }))
  return out.flat()
}

async function fetchBillDetails(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 100) {   // keep .in() URLs short
    const { data, error } = await supabase.from('purchases').select(FULL).in('application_id', ids.slice(i, i + 100)).or(LIVE_OR_ARCHIVED)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
  }
  return out
}

// Same window again within 5 minutes (re-run, CSV download) → cached result.
const cache = new Map()
const CACHE_MS = 5 * 60 * 1000

export async function buildFiftyLakhReport({ from, to, threshold = FIFTY_LAKH }) {
  const key = `${from}|${to}|${threshold}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.data, cached: true }
  const data = await computeFiftyLakhReport({ from, to, threshold })
  cache.set(key, { at: Date.now(), data })
  if (cache.size > 20) cache.delete(cache.keys().next().value)
  return data
}

async function computeFiftyLakhReport({ from, to, threshold }) {
  const fyStart = fyStartFor(to)

  // Every real purchase this FY up to `to`: live approved bills + archived
  // old-CRM bills (genuine purchases, hidden from day-to-day screens). Only the
  // fields the cumulative needs; pages fetched in parallel (~39k rows / 1000).
  const all = await fetchFyBills(fyStart, to)

  // Cumulative per customer, in date/time order.
  const byCust = new Map()
  let unidentified = 0
  for (const p of all) {
    const k = mobileKey(p.phone_number)
    if (!k) { unidentified++; continue }
    if (!byCust.has(k)) byCust.set(k, [])
    byCust.get(k).push(p)
  }
  const extra = new Map()   // app_id → FY columns
  const customers = []
  for (const [k, bills] of byCust) {
    bills.sort((a, b) => (a.purchase_date + (a.transaction_time || '')).localeCompare(b.purchase_date + (b.transaction_time || '')))
    const total = bills.reduce((s, b) => s + billAmount(b), 0)
    if (!(total > threshold)) continue
    let running = 0, crossed = false
    for (const b of bills) {
      running += billAmount(b)
      const crossesHere = !crossed && running > threshold
      if (crossesHere) crossed = true
      extra.set(b.application_id, { mobile: k, fy_running: Math.round(running), fy_total: Math.round(total), fy_bills: bills.length, crossed_here: crossesHere })
    }
    const inWindow = bills.filter(b => b.purchase_date >= from && b.purchase_date <= to)
    customers.push({ mobile: k, name: bills[bills.length - 1].customer_name, fy_total: Math.round(total), fy_bills: bills.length, window_bills: inWindow.length })
  }

  // Window bills of those customers → Billed vs Paid rows (+ FY columns).
  const listedIds = all.filter(p => extra.has(p.application_id) && p.purchase_date >= from && p.purchase_date <= to).map(p => p.application_id)
  const master = await fetchBillDetails(listedIds)
  const regionByBranch = {}
  {
    const { data: brs } = await supabase.from('branches').select('name, region')
    for (const b of brs || []) regionByBranch[b.name] = b.region
  }
  const { rows, razorpay_linked, warnings } = await buildBilledVsPaidRows(master, { from, to, regionByBranch, onlyListed: true })
  for (const r of rows) Object.assign(r, extra.get(r.app_id) || {})
  // Biggest customers first; each customer's bills oldest → newest.
  rows.sort((a, b) => (b.fy_total - a.fy_total) || a.mobile.localeCompare(b.mobile) || (a.fy_running - b.fy_running))
  customers.sort((a, b) => b.fy_total - a.fy_total)

  return {
    from, to, fy_start: fyStart, threshold,
    rows, customers,
    summary: {
      customers: customers.length,
      customers_in_window: customers.filter(c => c.window_bills > 0).length,
      bills: rows.length,
      window_total: rows.reduce((s, r) => s + (r.billed || 0), 0),
      fy_bills_scanned: all.length,
      unidentified_bills: unidentified,
    },
    razorpay_linked, warnings,
  }
}
