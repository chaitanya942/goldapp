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
//   • Customer = bills sharing a mobile number, or the same distinctive full
//     name at the same branch (see groupCustomers). No customer PAN exists in
//     either CRM. Each customer's bills are listed together under their name.

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

// Customer matching. Bills join one customer when they share a MOBILE, or
// carry the same FULL NAME at the SAME BRANCH — a returning customer who gave
// a different number. Name-linking is limited to distinctive names: at least
// two words of 3+ letters, and used with fewer than 5 different mobiles this
// FY. Common names ("Manjunath", "Vijay Kumar") belong to many different
// people and would otherwise merge strangers into false ₹50L customers.
export const nameKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/s+/g, ' ').trim()
const distinctiveName = (n) => { const w = n.split(' '); return w.length >= 2 && w.filter(x => x.length >= 3).length >= 2 }
const COMMON_NAME_MOBILES = 5

function groupCustomers(bills) {
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a) }
  const mobilesByName = new Map()
  for (const p of bills) {
    const m = mobileKey(p.phone_number); if (!m) continue
    if (!parent.has(m)) parent.set(m, m)
    const n = nameKey(p.customer_name)
    if (n) { if (!mobilesByName.has(n)) mobilesByName.set(n, new Set()); mobilesByName.get(n).add(m) }
  }
  const firstMobileAt = new Map()   // "NAME|BRANCH" → mobile
  let nameLinks = 0
  for (const p of bills) {
    const m = mobileKey(p.phone_number), n = nameKey(p.customer_name)
    if (!m || !distinctiveName(n) || mobilesByName.get(n).size >= COMMON_NAME_MOBILES) continue
    const k = n + '|' + p.branch_name
    const other = firstMobileAt.get(k)
    if (!other) firstMobileAt.set(k, m)
    else if (find(other) !== find(m)) { join(other, m); nameLinks++ }
  }
  const groups = new Map()
  for (const p of bills) {
    const m = mobileKey(p.phone_number); if (!m) continue
    const r = find(m)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(p)
  }
  return { groups, nameLinks }
}

const SLIM = 'application_id, customer_name, phone_number, branch_name, purchase_date, transaction_time, final_amount_crm, final_amount_calc'
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

  // Cumulative per customer (mobile + same-name-same-branch), in date/time order.
  const unidentified = all.filter(p => !mobileKey(p.phone_number)).length
  const { groups, nameLinks } = groupCustomers(all)
  const extra = new Map()   // app_id → customer + FY columns
  const customers = []
  for (const [, bills] of groups) {
    bills.sort((a, b) => (a.purchase_date + (a.transaction_time || '')).localeCompare(b.purchase_date + (b.transaction_time || '')))
    const total = bills.reduce((s, b) => s + billAmount(b), 0)
    if (!(total > threshold)) continue
    const mobiles = [...new Set(bills.map(b => mobileKey(b.phone_number)))]
    const names = [...new Set(bills.map(b => String(b.customer_name || '').trim()).filter(Boolean))]
    // Display name: the fullest spelling (most words, then longest) — e.g.
    // 'Abdul Rahiman' over 'Abdul'; ties go to the most-used spelling.
    const counts = new Map(); for (const b of bills) { const n = String(b.customer_name || '').trim(); if (n) counts.set(n, (counts.get(n) || 0) + 1) }
    const words = (n) => nameKey(n).split(' ').filter(Boolean).length
    const name = [...counts].sort((x, y) => (words(y[0]) - words(x[0])) || (nameKey(y[0]).length - nameKey(x[0]).length) || (y[1] - x[1]))[0]?.[0] || '—'
    const cust = { customer_id: mobiles[0], customer_name: name, customer_names: names, mobiles }
    let running = 0, crossed = false
    for (const b of bills) {
      running += billAmount(b)
      const crossesHere = !crossed && running > threshold
      if (crossesHere) crossed = true
      extra.set(b.application_id, { ...cust, mobile: mobileKey(b.phone_number), fy_running: Math.round(running), fy_total: Math.round(total), fy_bills: bills.length, crossed_here: crossesHere })
    }
    const inWindow = bills.filter(b => b.purchase_date >= from && b.purchase_date <= to)
    customers.push({ ...cust, fy_total: Math.round(total), fy_bills: bills.length, window_bills: inWindow.length, window_total: Math.round(inWindow.reduce((s, b) => s + billAmount(b), 0)) })
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
  rows.sort((a, b) => (b.fy_total - a.fy_total) || a.customer_id.localeCompare(b.customer_id) || (a.fy_running - b.fy_running))
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
      name_links: nameLinks,
      multi_mobile_customers: customers.filter(c => c.mobiles.length > 1).length,
    },
    razorpay_linked, warnings,
  }
}
