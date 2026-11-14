// lib/financePerformance.js — Finance performance: how long each payment
// request waits in an employee's queue before it is actioned, from CRM data.
//
// The CRM records no "request assigned / bill viewed / first click" events
// (its AuditTrails table exists but is empty), so each request type is timed
// from the event that puts it in the queue to the moment it is actioned:
//
//   PENNY_DROP      requested (row created)      → completed / skipped / failed
//                   employee = who requested it (branch staff; the CRM records
//                   no finance approver for penny drops)
//   FINAL_PAYMENT   penny drop completed         → payout initiated (Razorpay)
//                   employee = finance employee; bank confirmation shown apart
//   RELEASE_PAYMENT release agreement signed     → release payment recorded
//                   (fallback: release request raised — flagged in `basis`)
//                   employee = finance employee
//   MANUAL_PAYMENT  penny drop completed         → offline payment recorded
//                   employee = not recorded in the CRM
//
// `view_bill_min` / `first_click_min` come from the CRM's AuditTrails log
// (null until the CRM logs those events). Data from 15 Jun 2026 (New CRM go-live).

import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { newCrmOptsForPostgresPkg } from './newCrmPg'
import { buildBranchResolver } from './branchNameResolver'

export const FINANCE_DATA_START = '2026-06-15'
export const REQUEST_TYPES = {
  PENNY_DROP:      'Penny drop',
  FINAL_PAYMENT:   'Final payment',
  RELEASE_PAYMENT: 'Release payment',
  MANUAL_PAYMENT:  'Manual payment',
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const PENNY_DONE = `(SELECT MAX(COALESCE(q.updated_at, q.created_at)) FROM "Payment" q
  WHERE q.transaction_id = p.transaction_id AND q.type = 'PENNY_DROP' AND q.status IN ('COMPLETED','DROP_SKIPPED')
    AND COALESCE(q.updated_at, q.created_at) <= p.created_at)`

async function crmCases(from, to) {
  const sql = postgres({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432', 10),
    database: process.env.NEW_CRM_DB_NAME,
    username: process.env.NEW_CRM_DB_USER,
    password: process.env.NEW_CRM_DB_PASSWORD,
    ...newCrmOptsForPostgresPkg(), connect_timeout: 10, max: 1,
  })
  // Window on the ACTION time, by IST day. Timestamps are UTC (no tz).
  const inWin = (col) => `${col} >= $1::date - interval '1 day' AND ${col} < $2::date + interval '1 day'
    AND ((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date`
  try {
    return await sql.unsafe(`
      WITH x AS (
        SELECT 'PENNY_DROP' AS req, p.id AS pay_id, p.transaction_id, p.employee_id AS emp,
               p.created_at AS landed, p.updated_at AS actioned, NULL::timestamp AS bank_done,
               p.status::text AS status, p.utr, 'Penny drop requested → completed' AS basis
        FROM "Payment" p
        WHERE p.type = 'PENNY_DROP' AND p.status IN ('COMPLETED','DROP_SKIPPED','FAILED') AND ${inWin('p.updated_at')}
        UNION ALL
        SELECT 'FINAL_PAYMENT', p.id, p.transaction_id, p.employee_id,
               ${PENNY_DONE}, p.created_at, CASE WHEN p.status IN ('COMPLETED','CONFIRMED') THEN p.updated_at END,
               p.status::text, p.utr, 'Penny drop completed → payout initiated'
        FROM "Payment" p
        WHERE p.type = 'FINAL_PAYMENT' AND p.processor = 'RAZORPAY' AND p.action = 'DEBITED' AND ${inWin('p.created_at')}
        UNION ALL
        SELECT 'MANUAL_PAYMENT', p.id, p.transaction_id, p.employee_id,
               ${PENNY_DONE}, p.created_at, NULL, p.status::text, p.utr, 'Penny drop completed → manual payment recorded'
        FROM "Payment" p
        WHERE p.type = 'FINAL_PAYMENT' AND p.processor = 'OFFLINE' AND p.action = 'DEBITED' AND ${inWin('p.created_at')}
        UNION ALL
        SELECT 'RELEASE_PAYMENT', p.id, p.transaction_id, p.employee_id,
               COALESCE(ag.at, r.created_at), p.created_at, NULL, p.status::text, p.utr,
               CASE WHEN ag.at IS NOT NULL THEN 'Release agreement signed → release paid' ELSE 'Release requested → release paid (no signed agreement)' END
        FROM "Payment" p
        LEFT JOIN LATERAL (SELECT id, created_at FROM "Release" WHERE transaction_id = p.transaction_id AND created_at <= p.created_at ORDER BY created_at DESC LIMIT 1) r ON true
        LEFT JOIN LATERAL (SELECT MAX(a.updated_at) AS at FROM "Agreement" a WHERE a.release_id = r.id AND a.signed AND a.updated_at <= p.created_at) ag ON true
        WHERE p.type = 'RELEASE_PAYMENT' AND ${inWin('p.created_at')}
      )
      , y AS (
        -- CRM activity log (AuditTrails, see docs/crm/finance-activity-logging-request.md).
        -- Empty today; once the CRM logs these events they override the
        -- inferred queue time and fill the view-bill / first-click columns.
        SELECT x.*,
               COALESCE(au.queued, x.landed) AS landed2, au.viewed, au.clicked,
               CASE WHEN au.queued IS NOT NULL THEN 'Logged: request queued → actioned' ELSE x.basis END AS basis2
        FROM x
        LEFT JOIN LATERAL (
          SELECT MIN(a.created_at) FILTER (WHERE a.action = 'PAYMENT_REQUEST_QUEUED') AS queued,
                 MIN(a.created_at) FILTER (WHERE a.action = 'PAYMENT_BILL_VIEWED')   AS viewed,
                 MIN(a.created_at) FILTER (WHERE a.action = 'PAYMENT_ACTION_CLICKED') AS clicked
          FROM "AuditTrails" a
          WHERE a.payload->>'transaction_id' = x.transaction_id AND a.payload->>'request_type' = x.req
            AND a.created_at <= x.actioned + interval '1 minute'
        ) au ON true
      )
      SELECT x.req, x.status, x.utr, x.basis2 AS basis,
             to_char((x.landed2  AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS landed_ist,
             to_char((x.actioned AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS actioned_ist,
             ((x.actioned AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
             ROUND((EXTRACT(EPOCH FROM x.actioned - x.landed2) / 60.0)::numeric, 2)::float AS wait_min,
             ROUND((EXTRACT(EPOCH FROM x.viewed  - x.landed2) / 60.0)::numeric, 2)::float AS view_bill_min,
             ROUND((EXTRACT(EPOCH FROM x.clicked - x.landed2) / 60.0)::numeric, 2)::float AS first_click_min,
             ROUND((EXTRACT(EPOCH FROM x.bank_done - x.actioned) / 60.0)::numeric, 2)::float AS bank_min,
             (SELECT COUNT(*) FROM "File" f WHERE f.payment_id = x.pay_id)::int AS screenshots,
             t.code, t.transaction_type::text AS txn_type, b.name AS branch,
             x.emp AS emp_code, TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS emp_name,
             e.designation, e.role::text AS emp_role
      FROM y x
      JOIN "Transaction" t ON t.id = x.transaction_id
      LEFT JOIN "Branch" b ON b.id = t.branch_id
      LEFT JOIN "Employee" e ON e.emp_id = x.emp`, [from, to])
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {})
  }
}

const cache = new Map()
const CACHE_MS = 2 * 60 * 1000

async function casesFor(from, to) {
  const key = `${from}|${to}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const [rows, { data: branches }] = await Promise.all([crmCases(from, to), supabase.from('branches').select('name, region, state')])
  const resolve = buildBranchResolver(branches || [])
  const data = rows.map(r => {
    const b = r.branch ? resolve(r.branch) : { name: '—', region: null }
    return {
      ...r,
      branch: b.name, region: b.region || 'Unassigned',
      employee: r.emp_code ? `${r.emp_name || r.emp_code} (${r.emp_code})` : 'Not recorded',
      // Clock skew / out-of-order events → no valid queue time.
      wait_min: r.wait_min != null && r.wait_min >= 0 ? r.wait_min : null,
    }
  })
  cache.set(key, { at: Date.now(), data })
  if (cache.size > 20) cache.delete(cache.keys().next().value)
  return data
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const p90 = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] }
const round = (v) => (v == null ? null : Math.round(v * 10) / 10)

function summarize(list, keyFn) {
  const groups = new Map()
  for (const r of list) {
    const k = keyFn(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  return [...groups].map(([key, rs]) => {
    const w = rs.map(r => r.wait_min).filter(v => v != null)
    const vb = rs.map(r => r.view_bill_min).filter(v => v != null && v >= 0)
    const fc = rs.map(r => r.first_click_min).filter(v => v != null && v >= 0)
    return {
      key, count: rs.length, timed: w.length,
      avg_min: round(w.length ? w.reduce((s, v) => s + v, 0) / w.length : null),
      median_min: round(median(w)), p90_min: round(p90(w)), max_min: round(w.length ? Math.max(...w) : null),
      over10: w.filter(v => v > 10).length, over15: w.filter(v => v > 15).length, over20: w.filter(v => v > 20).length,
      view_bill_median_min: round(median(vb)), first_click_median_min: round(median(fc)),
      designation: rs[0].designation || null,
    }
  }).sort((a, b) => b.count - a.count)
}

// filters: { types:[], employee, branch, region, txnType, minMinutes }
export async function buildFinancePerformance({ from, to, filters = {}, allowedRegions = null, caseLimit = 500 }) {
  const all = await casesFor(from, to)
  const allowed = allowedRegions ? new Set(allowedRegions) : null
  const f = filters
  const list = all.filter(r =>
    (!allowed || allowed.has(r.region)) &&
    (!f.types?.length || f.types.includes(r.req)) &&
    (!f.employee || r.employee === f.employee) &&
    (!f.branch || r.branch === f.branch) &&
    (!f.region || r.region === f.region) &&
    (!f.txnType || r.txn_type === f.txnType) &&
    (!f.minMinutes || (r.wait_min != null && r.wait_min > f.minMinutes)))
  const scope = all.filter(r => !allowed || allowed.has(r.region))
  const uniq = (fn) => [...new Set(scope.map(fn).filter(Boolean))].sort()
  return {
    from, to, request_types: REQUEST_TYPES,
    totals: summarize(list, () => 'All')[0] || { count: 0 },
    by_type: summarize(list, r => r.req),
    by_employee: summarize(list, r => r.employee),
    cases: list.sort((a, b) => (b.wait_min ?? -1) - (a.wait_min ?? -1)).slice(0, caseLimit),
    case_count: list.length,
    options: { employees: uniq(r => r.employee), branches: uniq(r => r.branch), regions: uniq(r => r.region), txnTypes: uniq(r => r.txn_type) },
    _all: list,   // for CSV export (stripped by the route for JSON responses)
  }
}
