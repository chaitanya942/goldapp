// lib/otpChannels.js — Telesales vs Direct Walk-in, from CRM OTP generation.
//
// The CRM's "Token" table is the OTP issued for a customer visit. Its `prefix`
// says which channel generated it:
//   TS = Telesales      (always tied to a CRM Lead; ~1 in 4 walk in)
//   DW = Direct walk-in (generated at the branch; ~all become a Transaction)
// Per OTP we take the channel, its IST day, and the branch — the walk-in's
// branch when the customer came in, else the telesales lead's branch — plus
// whether it became a walk-in (Transaction) and a completed purchase (with the
// final amount). Data is reported from 1 Oct 2026 (when OTP-by-channel became
// the reporting basis).

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

async function crmOtpRows(from, to) {
  const sql = postgres({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432', 10),
    database: process.env.NEW_CRM_DB_NAME,
    username: process.env.NEW_CRM_DB_USER,
    password: process.env.NEW_CRM_DB_PASSWORD,
    ...newCrmOptsForPostgresPkg(), connect_timeout: 10, max: 1,
  })
  try {
    // created_at columns are UTC "timestamp without time zone".
    return await sql`
      SELECT k.prefix::text AS ch,
             ((k.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS d,
             COALESCE(bt.name, bl.name) AS branch,
             COUNT(*)::int AS otps,
             COUNT(k.transaction_id)::int AS walked_in,
             COUNT(*) FILTER (WHERE t.status = 'FINAL_PAYMENT_COMPLETED')::int AS purchased,
             COALESCE(SUM(q.final_amount) FILTER (WHERE t.status = 'FINAL_PAYMENT_COMPLETED'), 0)::float AS purchase_value
      FROM "Token" k
      LEFT JOIN "Transaction" t ON t.id = k.transaction_id
      LEFT JOIN "Branch" bt ON bt.id = t.branch_id
      LEFT JOIN "Lead" l ON l.id = k.lead_id
      LEFT JOIN "Branch" bl ON bl.id = l.branch_id
      LEFT JOIN LATERAL (
        SELECT final_amount FROM "Quotation" WHERE transaction_id = t.id ORDER BY updated_at DESC LIMIT 1
      ) q ON t.status = 'FINAL_PAYMENT_COMPLETED'
      WHERE k.created_at >= ${from}::date - interval '1 day'
        AND k.created_at <  ${to}::date + interval '1 day'
        AND ((k.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2, 3
    `
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {})
  }
}

const blank = () => ({ otps: 0, walked_in: 0, purchased: 0, purchase_value: 0 })
const add = (acc, r) => { acc.otps += r.otps; acc.walked_in += r.walked_in; acc.purchased += r.purchased; acc.purchase_value += r.purchase_value; return acc }

export async function buildOtpChannelReport({ from, to, allowedRegions = null }) {
  const [rows, { data: branches }] = await Promise.all([
    crmOtpRows(from, to),
    supabase.from('branches').select('name, region, state'),
  ])
  const resolve = buildBranchResolver(branches || [])
  const allowed = allowedRegions ? new Set(allowedRegions) : null

  const totals = { TS: blank(), DW: blank() }
  const byRegion = new Map(), byBranch = new Map(), byDay = new Map()
  for (const r of rows) {
    const ch = r.ch === 'TS' || r.ch === 'DW' ? r.ch : null
    if (!ch) continue
    const b = r.branch ? resolve(r.branch) : { name: 'Unassigned', region: null }
    const region = b.region || 'Unassigned'
    if (allowed && !allowed.has(region)) continue
    add(totals[ch], r)
    const reg = byRegion.get(region) || { region, TS: blank(), DW: blank() }; add(reg[ch], r); byRegion.set(region, reg)
    const br = byBranch.get(b.name) || { branch: b.name, region, TS: blank(), DW: blank() }; add(br[ch], r); byBranch.set(b.name, br)
    const day = byDay.get(r.d) || { date: r.d, TS: 0, DW: 0 }; day[ch] += r.otps; byDay.set(r.d, day)
  }
  const rate = (a, b) => (b > 0 ? a / b : null)
  for (const c of ['TS', 'DW']) {
    totals[c].walkin_rate = rate(totals[c].walked_in, totals[c].otps)
    totals[c].purchase_rate = rate(totals[c].purchased, totals[c].otps)
  }
  const otpsOf = (x) => x.TS.otps + x.DW.otps
  return {
    from, to, channels: CHANNELS, totals,
    regions: [...byRegion.values()].sort((a, b) => otpsOf(b) - otpsOf(a)),
    branches: [...byBranch.values()].sort((a, b) => otpsOf(b) - otpsOf(a)),
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}
