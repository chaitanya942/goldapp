// lib/otpChannels.js — Telesales vs Direct Walk-in, from CRM OTP generation.
//
// The CRM's "Token" table is the OTP issued for a customer visit; `prefix`
// says which channel generated it: TS = Telesales (tied to a Lead), DW = Direct
// walk-in (generated at the branch). Each figure is counted on its own date,
// the same basis as the rest of the dashboard:
//   • OTPs       — day generated. An OTP that led to a walk-in counts once
//                  per walk-in; unused OTPs count once per mobile per channel
//                  per day, and not at all if that mobile's OTP was used that
//                  day — so a regenerated OTP isn't counted twice.
//   • Walk-ins   — day the walk-in (Transaction) was created.
//   • Purchases  — day of the final payment (FINAL_PAYMENT COMPLETED/
//                  CONFIRMED; a release-only takeover uses its release
//                  payment) — same rule as the Purchased tile; value = final
//                  amount of the latest quotation.
// A walk-in's channel is the prefix of the OTP linked to it; if none is
// linked, an unlinked OTP for the same mobile (60 days before → 1 day after)
// is used. Walk-ins with no OTP at all for that mobile are left out of both
// channels and reported separately as `no_otp` for reconciliation.
// Branch: the walk-in's branch; for an OTP not yet walked in, the telesales
// lead's branch. Data from 1 Oct 2026.

import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { newCrmOptsForPostgresPkg } from './newCrmPg'
import { buildBranchResolver } from './branchNameResolver'

export const OTP_DATA_START = '2026-10-01'
export const CHANNELS = { TS: 'Telesales', DW: 'Direct Walk-in' }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const IST = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date`

// Channel for a transaction `t` (with its walk-in mobile `mob`): linked OTP,
// else the nearest unlinked OTP for the same mobile.
const CHANNEL_SQL = `COALESCE(
  (SELECT k.prefix::text FROM "Token" k WHERE k.transaction_id = t.id ORDER BY k.created_at DESC LIMIT 1),
  (SELECT k.prefix::text FROM "Token" k
     WHERE k.transaction_id IS NULL AND mob.mobile IS NOT NULL AND k.mobile = mob.mobile
       AND k.created_at BETWEEN t.created_at - interval '60 days' AND t.created_at + interval '1 day'
     ORDER BY abs(extract(epoch FROM k.created_at - t.created_at)) LIMIT 1),
  'NONE')`
const MOBILE_JOIN = `LEFT JOIN LATERAL (
    SELECT COALESCE((SELECT w.mobile FROM "Walkin" w WHERE w.transaction_id = t.id ORDER BY w.created_at LIMIT 1),
                    (SELECT c.mobile FROM "Customer" c WHERE c.id = t.customer_id)) AS mobile
  ) mob ON true`

async function crmRows(from, to) {
  const sql = postgres({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432', 10),
    database: process.env.NEW_CRM_DB_NAME,
    username: process.env.NEW_CRM_DB_USER,
    password: process.env.NEW_CRM_DB_PASSWORD,
    ...newCrmOptsForPostgresPkg(), connect_timeout: 10, max: 1,
  })
  // Pre-filter on raw UTC timestamps (index-friendly), then exact IST day.
  const win = (col) => `${col} >= $1::date - interval '1 day' AND ${col} < $2::date + interval '1 day' AND ${IST(col)} BETWEEN $1::date AND $2::date`
  try {
    const [otps, walkins, purchases, crmBranches] = await Promise.all([
      sql.unsafe(`
        SELECT ch, d, branch,
               COUNT(DISTINCT CASE WHEN transaction_id IS NOT NULL THEN 't:' || transaction_id
                                   WHEN NOT used_same_day THEN 'm:' || COALESCE(mobile, id) END)::int AS n
        FROM (
          SELECT k.id, k.mobile, k.transaction_id, k.prefix::text AS ch, ${IST('k.created_at')}::text AS d,
                 -- branch: the walk-in's, else the lead's, else the lead's visited branch, else
                 -- the branch where this mobile actually walked in (nearest in time)
                 COALESCE(bt.name, bl.name, blv.name,
                   (SELECT b2.name FROM "Customer" c2
                      JOIN "Transaction" t2 ON t2.customer_id = c2.id
                      JOIN "Branch" b2 ON b2.id = t2.branch_id
                     WHERE k.mobile IS NOT NULL AND c2.mobile = k.mobile
                     ORDER BY abs(extract(epoch FROM t2.created_at - k.created_at)) LIMIT 1)) AS branch,
                 -- an unused OTP whose mobile got a used OTP the same day/channel is a regeneration
                 bool_or(k.transaction_id IS NOT NULL) OVER (PARTITION BY k.prefix, k.mobile, ${IST('k.created_at')}) AS used_same_day
          FROM "Token" k
          LEFT JOIN "Transaction" t ON t.id = k.transaction_id
          LEFT JOIN "Branch" bt ON bt.id = t.branch_id
          LEFT JOIN "Lead" l ON l.id = k.lead_id
          LEFT JOIN "Branch" bl ON bl.id = l.branch_id
          LEFT JOIN "Branch" blv ON blv.id = l.visited_branch_id
          WHERE ${win('k.created_at')}
        ) x GROUP BY 1, 2, 3`, [from, to]),
      sql.unsafe(`
        SELECT ${CHANNEL_SQL} AS ch, ${IST('t.created_at')}::text AS d, b.name AS branch, COUNT(*)::int AS n
        FROM "Transaction" t
        ${MOBILE_JOIN}
        LEFT JOIN "Branch" b ON b.id = t.branch_id
        WHERE ${win('t.created_at')}
        GROUP BY 1, 2, 3`, [from, to]),
      sql.unsafe(`
        SELECT ${CHANNEL_SQL} AS ch, ${IST('ev.at')}::text AS d, b.name AS branch,
               COUNT(*)::int AS n, COALESCE(SUM(q.final_amount), 0)::float AS value
        FROM "Transaction" t
        JOIN LATERAL (SELECT COALESCE(
          (SELECT MAX(created_at) FROM "Payment" WHERE transaction_id = t.id AND type = 'FINAL_PAYMENT' AND status IN ('COMPLETED','CONFIRMED')),
          (SELECT MAX(created_at) FROM "Payment" WHERE transaction_id = t.id AND type = 'RELEASE_PAYMENT' AND status IN ('COMPLETED','CONFIRMED')
             AND NOT EXISTS (SELECT 1 FROM "Payment" p2 WHERE p2.transaction_id = t.id AND p2.type = 'FINAL_PAYMENT'))
        ) AS at) ev ON ev.at IS NOT NULL
        ${MOBILE_JOIN}
        LEFT JOIN "Branch" b ON b.id = t.branch_id
        LEFT JOIN LATERAL (SELECT final_amount FROM "Quotation" WHERE transaction_id = t.id ORDER BY updated_at DESC LIMIT 1) q ON true
        WHERE t.status = 'FINAL_PAYMENT_COMPLETED' AND ${win('ev.at')}
        GROUP BY 1, 2, 3`, [from, to]),
      sql.unsafe(`SELECT name, cluster_id, state_id FROM "Branch" WHERE name IS NOT NULL`),
    ])
    return { otps, walkins, purchases, crmBranches }
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {})
  }
}

const blank = () => ({ otps: 0, walked_in: 0, purchased: 0, purchase_value: 0 })

// Region for a CRM branch that isn't in the branch master yet (new branches are
// only added there after their first purchase): take the region the other
// branches in the same CRM cluster resolve to; failing that, the state's region
// when that state maps to a single region. Data-derived — no hardcoded lists.
export function buildRegionFallback(masterBranches, crmBranches) {
  const resolveMaster = buildBranchResolver(masterBranches || [])
  const resolveCrm = buildBranchResolver((crmBranches || []).filter(b => b?.name))
  const tally = (m, k, r) => { if (!k || !r) return; const t = m.get(k) || m.set(k, new Map()).get(k); t.set(r, (t.get(r) || 0) + 1) }
  const byCluster = new Map(), byState = new Map()
  for (const b of crmBranches || []) {
    const r = resolveMaster(b.name).region
    tally(byCluster, b.cluster_id, r); tally(byState, b.state_id, r)
  }
  const top = (t, uniqueOnly) => {
    if (!t) return null
    const e = [...t.entries()].sort((a, b) => b[1] - a[1])
    return uniqueOnly && e.length > 1 ? null : (e[0]?.[0] || null)
  }
  return (name) => {
    if (!name) return null
    const crm = resolveCrm(name).branch
    if (!crm) return null
    return top(byCluster.get(crm.cluster_id)) || top(byState.get(crm.state_id), true)
  }
}

// filter: the dashboard's location filter { type: region|state|cluster|branch, value }
// matched against the branch master row each CRM branch resolves to.
export const OTP_FILTER_TYPES = ['region', 'state', 'cluster', 'branch']

export async function buildOtpChannelReport({ from, to, allowedRegions = null, filter = null, excludeSundays = false }) {
  const [{ otps, walkins, purchases, crmBranches }, { data: branches }] = await Promise.all([
    crmRows(from, to),
    supabase.from('branches').select('name, region, state, cluster'),
  ])
  const resolve = buildBranchResolver(branches || [])
  const regionFallback = buildRegionFallback(branches || [], crmBranches || [])
  const allowed = allowedRegions ? new Set(allowedRegions) : null
  // Optionally drop Sundays (branches closed) so a multi-day range isn't skewed.
  const isSunday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0
  const keepDay = (rows) => (excludeSundays ? rows.filter(r => !isSunday(r.d)) : rows)

  const totals = { TS: blank(), DW: blank() }
  const noOtp = { walked_in: 0, purchased: 0, purchase_value: 0 }
  const byRegion = new Map(), byBranch = new Map(), byDay = new Map()
  const place = (branch) => {
    const b = branch ? resolve(branch) : { name: 'Unassigned', region: null }
    return { name: b.name, region: b.region || regionFallback(branch) || 'Unassigned', master: b.branch || null }
  }
  const bump = (r, field, val, extra) => {
    const p = place(r.branch)
    if (allowed && !allowed.has(p.region)) return
    if (filter && (filter.type === 'region' ? p.region : filter.type === 'branch' ? p.master?.name : p.master?.[filter.type]) !== filter.value) return
    if (r.ch !== 'TS' && r.ch !== 'DW') {          // walk-in with no OTP anywhere
      if (field !== 'otps') { noOtp[field] += val; if (extra) noOtp.purchase_value += extra }
      return
    }
    for (const acc of [
      totals[r.ch],
      (byRegion.get(p.region) || byRegion.set(p.region, { region: p.region, TS: blank(), DW: blank() }).get(p.region))[r.ch],
      (byBranch.get(p.name) || byBranch.set(p.name, { branch: p.name, region: p.region, TS: blank(), DW: blank() }).get(p.name))[r.ch],
    ]) { acc[field] += val; if (extra) acc.purchase_value += extra }
    if (field === 'otps' || field === 'walked_in') {
      const d = byDay.get(r.d) || byDay.set(r.d, { date: r.d, TS: 0, DW: 0, TS_walk: 0, DW_walk: 0 }).get(r.d)
      d[field === 'otps' ? r.ch : `${r.ch}_walk`] += val
    }
  }
  for (const r of keepDay(otps))      bump(r, 'otps', r.n)
  for (const r of keepDay(walkins))   bump(r, 'walked_in', r.n)
  for (const r of keepDay(purchases)) bump(r, 'purchased', r.n, r.value)

  const rate = (a, b) => (b > 0 ? a / b : null)
  for (const c of ['TS', 'DW']) {
    totals[c].walkin_rate = rate(totals[c].walked_in, totals[c].otps)
    totals[c].purchase_rate = rate(totals[c].purchased, totals[c].walked_in)
  }
  const otpsOf = (x) => x.TS.otps + x.DW.otps + x.TS.walked_in + x.DW.walked_in
  const report = {
    from, to, filter, channels: CHANNELS, totals, no_otp: noOtp,
    regions: [...byRegion.values()].sort((a, b) => otpsOf(b) - otpsOf(a)),
    branches: [...byBranch.values()].sort((a, b) => otpsOf(b) - otpsOf(a)),
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
  // Non-enumerable so it never reaches a JSON response; the walk-in funnel uses
  // it to place Jarvis stores that aren't in the branch master either.
  Object.defineProperty(report, 'regionFallback', { value: regionFallback, enumerable: false })
  return report
}
