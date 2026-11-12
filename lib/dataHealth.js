// lib/dataHealth.js — continuous accuracy checks for CRM walk-ins / purchases,
// the Telesales–Direct Walk-in (OTP) split and Jarvis footfall.
//
// Run by the cron worker every 30 min via POST /api/data-health. Each check
// compares the app against its source of truth; a check that finds missing
// data first triggers the matching sync (self-heal) and re-checks. Results go
// to sync_status (sync_name "health:<key>"), and a check that turns failing is
// emailed to DATA_HEALTH_EMAILS (comma-separated) once, with a daily reminder
// while it stays failing.

import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { newCrmOptsForPostgresPkg } from './newCrmPg'
import { buildOtpChannelReport } from './otpChannels'
import { sendMail, mailConfigured } from './sendMail'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const istDay = (offsetDays = 0) => new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10)
const IST = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date`
const minutesSince = (iso) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null)

function crm() {
  return postgres({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432', 10),
    database: process.env.NEW_CRM_DB_NAME,
    username: process.env.NEW_CRM_DB_USER,
    password: process.env.NEW_CRM_DB_PASSWORD,
    ...newCrmOptsForPostgresPkg(), connect_timeout: 10, max: 1,
  })
}

// ── 1. Purchases: every CRM-completed bill of the last 3 days is in the app ──
// Same completion rule as /api/sync-new-crm (final payment COMPLETED /
// CONFIRMED / processing payout, else a release-only takeover's release
// payment). Bills paid in the last 10 minutes are skipped (sync runs every 30s).
async function crmCompletedByDay(days) {
  const sql = crm()
  try {
    return await sql.unsafe(`
      SELECT t.code, ${IST('f.at')}::text AS d, (f.at > (now() AT TIME ZONE 'UTC') - interval '10 minutes') AS fresh
      FROM "Transaction" t
      JOIN LATERAL (SELECT COALESCE(
        (SELECT MAX(created_at) FROM "Payment" WHERE transaction_id = t.id AND type = 'FINAL_PAYMENT'
           AND (status IN ('COMPLETED','CONFIRMED') OR (status = 'PENDING' AND provider_status = 'processing'))),
        (SELECT MAX(created_at) FROM "Payment" WHERE transaction_id = t.id AND type = 'RELEASE_PAYMENT' AND status IN ('COMPLETED','CONFIRMED')
           AND t.status = 'FINAL_PAYMENT_COMPLETED'
           AND NOT EXISTS (SELECT 1 FROM "Payment" p2 WHERE p2.transaction_id = t.id AND p2.type = 'FINAL_PAYMENT'))
      ) AS at) f ON f.at IS NOT NULL
      WHERE t.status IN ('FINAL_PAYMENT_COMPLETED', 'FINAL_PAYMENT_PENDING')
        AND f.at >= $1::date - interval '1 day' AND ${IST('f.at')} >= $1::date`, [days[0]])
  } finally { await sql.end({ timeout: 2 }).catch(() => {}) }
}

async function appPurchasesByDay(days) {
  const out = []
  for (let o = 0; ; o += 1000) {
    const { data, error } = await supabase.from('purchases').select('application_id, purchase_date')
      .eq('crm_source', 'new_crm').eq('is_deleted', false).eq('crm_status', 'approved')
      .gte('purchase_date', days[0]).range(o, o + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function checkPurchases() {
  const days = [istDay(-2), istDay(-1), istDay(0)]
  const [crmRows, appRows] = await Promise.all([crmCompletedByDay(days), appPurchasesByDay(days)])
  const crmSet = new Map(crmRows.filter(r => !r.fresh).map(r => [r.code, r.d]))
  const appSet = new Map(appRows.map(r => [r.application_id, r.purchase_date]))
  const missing = [...crmSet.keys()].filter(c => !appSet.has(c))
  const wrongDay = [...crmSet].filter(([c, d]) => appSet.has(c) && appSet.get(c) !== d).map(([c]) => c)
  const extra = [...appSet.keys()].filter(c => !crmSet.has(c) && !crmRows.some(r => r.code === c))
  const problems = []
  if (missing.length) problems.push(`${missing.length} completed in CRM but missing in app: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`)
  if (wrongDay.length) problems.push(`${wrongDay.length} on a different date in app: ${wrongDay.slice(0, 10).join(', ')}`)
  if (extra.length) problems.push(`${extra.length} in app but not completed in CRM: ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? '…' : ''}`)
  return { ok: !problems.length, heal: missing.length || wrongDay.length ? 'crm' : null, count: crmSet.size,
    detail: problems.length ? problems.join(' | ') : `${crmSet.size} completed bills (${days[0]} → ${days[2]}) all present` }
}

// ── 2. CRM sync freshness ─────────────────────────────────────────────────────
async function checkCrmSync() {
  const { data } = await supabase.from('sync_status').select('last_success_at, last_error').eq('sync_name', 'new_crm').maybeSingle()
  const age = minutesSince(data?.last_success_at)
  const ok = age != null && age <= 10
  return { ok, heal: ok ? null : 'crm', detail: ok ? `last sync ${age} min ago` : `last successful sync ${age ?? '?'} min ago${data?.last_error ? ` — ${data.last_error}` : ''}` }
}

// ── 3. Walk-ins & OTP split reconcile with the CRM ───────────────────────────
async function checkWalkinsOtp() {
  const problems = []
  let noOtp = 0
  for (const d of [istDay(-1), istDay(0)]) {
    const sql = crm()
    let crmWalkins
    try {
      ;[{ n: crmWalkins }] = await sql.unsafe(`SELECT COUNT(*)::int n FROM "Transaction" WHERE created_at >= $1::date - interval '1 day' AND ${IST('created_at')} = $1::date`, [d])
    } finally { await sql.end({ timeout: 2 }).catch(() => {}) }
    const r = await buildOtpChannelReport({ from: d, to: d })
    const split = r.totals.TS.walked_in + r.totals.DW.walked_in + r.no_otp.walked_in
    if (split !== crmWalkins) problems.push(`${d}: TS+DW walk-ins ${split} ≠ CRM walk-ins ${crmWalkins}`)
    noOtp += r.no_otp.walked_in
  }
  return { ok: !problems.length, count: noOtp,
    detail: problems.length ? problems.join(' | ') : `TS + DW reconcile with CRM walk-ins (yesterday + today); ${noOtp} walk-in(s) had no OTP in the CRM` }
}

// ── 4. Jarvis freshness + yesterday coverage ─────────────────────────────────
async function checkJarvis() {
  const { data: last } = await supabase.from('jarvis_footfall').select('fetched_at').order('fetched_at', { ascending: false }).limit(1)
  const age = minutesSince(last?.[0]?.fetched_at)
  const yday = istDay(-1)
  const { data: recent } = await supabase.from('jarvis_footfall').select('store_code').gte('footfall_date', istDay(-3))
  const stores = new Set((recent || []).map(r => r.store_code)).size
  const { data: yrows } = await supabase.from('jarvis_footfall').select('store_code, entry_count, group_count').eq('footfall_date', yday)
  const covered = (yrows || []).length
  const withCounts = (yrows || []).filter(r => (r.entry_count || 0) > 0 || (r.group_count || 0) > 0).length
  const problems = []
  if (age == null || age > 45) problems.push(`last Jarvis sync ${age ?? '?'} min ago`)
  if (stores && covered < stores) problems.push(`yesterday has ${covered} of ${stores} stores`)
  if (covered && withCounts / covered < 0.5) problems.push(`only ${withCounts} of ${covered} stores reported footfall yesterday`)
  return { ok: !problems.length, heal: problems.length ? 'jarvis' : null, count: withCounts,
    detail: problems.length ? problems.join(' | ') : `synced ${age} min ago; yesterday ${withCounts}/${covered} stores with footfall` }
}

export const CHECKS = [
  { key: 'purchases',    label: 'Purchases complete vs CRM (last 3 days)', run: checkPurchases },
  { key: 'crm_sync',     label: 'CRM sync running',                        run: checkCrmSync },
  { key: 'walkins_otp',  label: 'Walk-ins & Telesales/Direct split vs CRM', run: checkWalkinsOtp },
  { key: 'jarvis',       label: 'Jarvis footfall fresh & complete',        run: checkJarvis },
]

async function runOne(c) {
  try { return { key: c.key, label: c.label, ...(await c.run()) } }
  catch (e) { return { key: c.key, label: c.label, ok: false, detail: `check failed: ${e.message}` } }
}

// heal: { crm: () => Promise, jarvis: () => Promise } — supplied by the route.
export async function runDataHealth({ heal = {}, notify = false } = {}) {
  let results = await Promise.all(CHECKS.map(runOne))
  const toHeal = [...new Set(results.filter(r => !r.ok && r.heal && heal[r.heal]).map(r => r.heal))]
  if (toHeal.length) {
    for (const h of toHeal) { try { await heal[h]() } catch { /* re-check reports it */ } }
    results = await Promise.all(CHECKS.map(async c => {
      const prev = results.find(r => r.key === c.key)
      if (prev.ok || !toHeal.includes(prev.heal)) return prev
      const again = await runOne(c)
      return { ...again, healed: again.ok, healed_from: again.ok ? prev.detail : undefined }
    }))
  }
  if (notify) await persistAndAlert(results)
  return { at: new Date().toISOString(), ok: results.every(r => r.ok), results }
}

async function persistAndAlert(results) {
  const now = new Date().toISOString()
  const { data: prevRows } = await supabase.from('sync_status').select('sync_name, last_error, last_attempt_at, last_success_at').like('sync_name', 'health:%')
  const prev = Object.fromEntries((prevRows || []).map(r => [r.sync_name, r]))
  const newlyBad = []
  for (const r of results) {
    const name = `health:${r.key}`
    const p = prev[name]
    const wasBad = p && p.last_error
    // Alert when a check turns bad, and again once a day while it stays bad.
    const lastAlertDay = p?.last_error?.match(/\[alerted (\d{4}-\d{2}-\d{2})\]/)?.[1]
    if (!r.ok && (!wasBad || lastAlertDay !== istDay(0))) newlyBad.push(r)
    await supabase.from('sync_status').upsert({
      sync_name: name, last_attempt_at: now, updated_at: now, last_count: r.count ?? null,
      ...(r.ok ? { last_success_at: now, last_error: null }
               : { last_error: `${r.detail}${!r.ok && (!wasBad || lastAlertDay !== istDay(0)) ? ` [alerted ${istDay(0)}]` : lastAlertDay ? ` [alerted ${lastAlertDay}]` : ''}`.slice(0, 500) }),
    }, { onConflict: 'sync_name' })
  }
  const to = String(process.env.DATA_HEALTH_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!newlyBad.length || !to.length || !mailConfigured()) return
  const rows = newlyBad.map(r => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${r.label}</b></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${String(r.detail).replace(/</g, '&lt;')}</td></tr>`).join('')
  await sendMail({
    to, fromName: 'WhiteGold Data Health',
    subject: `Data check failing: ${newlyBad.map(r => r.label).join(', ')}`,
    html: `<div style="font-family:Arial,sans-serif;color:#222"><p>These data checks are failing in the gold app (automatic sync was retried first):</p><table style="border-collapse:collapse;font-size:13px">${rows}</table><p style="font-size:12px;color:#777">Checked ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST. You'll get one reminder a day while a check stays failing.</p></div>`,
    text: newlyBad.map(r => `${r.label}: ${r.detail}`).join('\n'),
  }).catch(() => {})
}
