import pg from 'pg'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'

// Live employee insights, computed straight from the NEW CRM (Employee +
// Transaction + stage artifacts). Independent of the stored branch_employees
// activity columns, so it's always fresh and needs no migration. ADMIN only.
//   • directory + activity (cases opened / handled, last active, idle)
//   • performance: per-employee stage TAT medians (valuation → payment), ranked
//   • branch rollups (staff, managers, cases, avg total TAT)
//   • role distribution · tenure / new-joiners / exits
const med = (a) => { const x = a.filter(v => v != null && v >= 0).sort((p, q) => p - q); if (!x.length) return null; const m = Math.floor(x.length / 2); return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2 }
const r1  = (x) => x == null ? null : Math.round(x * 10) / 10
const dmin = (a, b) => (a != null && b != null && b >= a) ? (b - a) / 60 : null
const STAGES = ['val', 'estneg', 'quoprep', 'quoappr', 'kyc', 'pay']

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  let client
  try {
    // Short-lived Pool (not a single Client) so the 8 queries run concurrently;
    // ended promptly so it never hits the NEW CRM's 60s idle-session timeout.
    client = new pg.Pool({
      host: process.env.NEW_CRM_DB_HOST, port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
      database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }, max: 6, connectionTimeoutMillis: 15000, idleTimeoutMillis: 8000,
    })
    client.on('error', () => {})
    const Q = (s) => client.query(s).then(r => r.rows)
    const [emps, opened, handled, cohort, est, quo, pay, klog] = await Promise.all([
      Q(`SELECT e.id, e.emp_id, trim(coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')) name,
                e.role::text role, e.designation, e.active, e.logged_in_at, e.date_of_joining,
                b.name branch, b.state
           FROM "Employee" e LEFT JOIN "Branch" b ON b.id=e.branch_id
          WHERE trim(coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')) <> ''`),
      Q(`SELECT emp_id, count(*)::int n, max(created_at) last_txn FROM "Transaction" WHERE emp_id IS NOT NULL GROUP BY emp_id`),
      Q(`WITH h AS (
           SELECT id tid, emp_id hk FROM "Transaction" WHERE emp_id IS NOT NULL
           UNION ALL SELECT transaction_id, negotiation_approved_id FROM "Estimation" WHERE negotiation_approved_id IS NOT NULL
           UNION ALL SELECT transaction_id, quotation_approved_id FROM "Quotation" WHERE quotation_approved_id IS NOT NULL
           UNION ALL SELECT transaction_id, employee_id FROM "Payment" WHERE employee_id IS NOT NULL
           UNION ALL SELECT transaction_id, emp_id FROM "Order" WHERE emp_id IS NOT NULL
           UNION ALL SELECT k.transaction_id, l.emp_id FROM "KycLog" l JOIN "Kyc" k ON k.id=l.kyc_id WHERE l.emp_id IS NOT NULL
         ), norm AS (SELECT h.tid, COALESCE(e1.emp_id,e2.emp_id) emp FROM h LEFT JOIN "Employee" e1 ON e1.emp_id=h.hk LEFT JOIN "Employee" e2 ON e2.id=h.hk)
         SELECT emp, count(DISTINCT tid)::int n FROM norm WHERE emp IS NOT NULL GROUP BY emp`),
      Q(`SELECT id, emp_id opener, EXTRACT(EPOCH FROM created_at) o, EXTRACT(EPOCH FROM updated_at) c FROM "Transaction" WHERE status='FINAL_PAYMENT_COMPLETED'`),
      Q(`SELECT transaction_id tid, EXTRACT(EPOCH FROM min(created_at)) ts, EXTRACT(EPOCH FROM max(updated_at)) upd, (array_agg(negotiation_approved_id) FILTER (WHERE negotiation_approved_id IS NOT NULL))[1] neg FROM "Estimation" GROUP BY 1`),
      Q(`SELECT transaction_id tid, EXTRACT(EPOCH FROM min(created_at)) ts, EXTRACT(EPOCH FROM max(updated_at)) upd, (array_agg(quotation_approved_id) FILTER (WHERE quotation_approved_id IS NOT NULL))[1] appr FROM "Quotation" GROUP BY 1`),
      Q(`SELECT transaction_id tid, EXTRACT(EPOCH FROM min(created_at)) ts, (array_agg(employee_id))[1] emp FROM "Payment" GROUP BY 1`),
      Q(`SELECT k.transaction_id tid, EXTRACT(EPOCH FROM min(l.created_at) FILTER (WHERE l.employee_class='KYC_MAKER')) km, EXTRACT(EPOCH FROM max(l.created_at) FILTER (WHERE l.employee_class='KYC_CHECKER')) kc, (array_agg(l.emp_id) FILTER (WHERE l.employee_class='KYC_CHECKER'))[1] emp FROM "KycLog" l JOIN "Kyc" k ON k.id=l.kyc_id GROUP BY 1`),
    ])
    await client.end(); client = null

    // emp-id normalisation (handler ids can be Employee.id or emp_id code)
    const byId = {}, codeSet = new Set()
    emps.forEach(e => { byId[e.id] = e.emp_id; if (e.emp_id) codeSet.add(e.emp_id) })
    const norm = (x) => !x ? null : (codeSet.has(x) ? x : (byId[x] || null))
    const idx = (a) => Object.fromEntries(a.map(r => [r.tid, r]))
    const E = idx(est), Qn = idx(quo), P = idx(pay), K = idx(klog)

    // Per-employee stage duration buckets (attribute each stage to its handler).
    const stagePerf = {}   // emp_id → { val:[], estneg:[], ... , total:[] }
    const push = (emp, stage, val) => { if (!emp || val == null) return; const g = stagePerf[emp] = stagePerf[emp] || { val: [], estneg: [], quoprep: [], quoappr: [], kyc: [], pay: [], total: [], cases: 0 }; g[stage].push(val) }
    for (const t of cohort) {
      const e = E[t.id], q = Qn[t.id], p = P[t.id], k = K[t.id]
      const opener = t.opener
      push(opener, 'val', dmin(t.o, e?.ts))
      push(norm(e?.neg), 'estneg', dmin(e?.ts, e?.upd))
      push(opener, 'quoprep', dmin(e?.upd, q?.ts))
      push(norm(q?.appr), 'quoappr', dmin(q?.ts, q?.upd))
      push(norm(k?.emp), 'kyc', dmin(k?.km, k?.kc))
      push(norm(p?.emp), 'pay', dmin(k?.kc ?? q?.upd, p?.ts))
      if (opener) { const g = stagePerf[opener]; if (g) { g.cases++; const tot = dmin(t.o, t.c); if (tot != null) g.total.push(tot) } }
    }
    const perfOf = (emp) => { const g = stagePerf[emp]; if (!g) return null; const out = { cases: g.cases, total: r1(med(g.total)) }; STAGES.forEach(s => { out[s] = r1(med(g[s])); out[`${s}_n`] = g[s].filter(v => v != null && v >= 0).length }); return out }

    const openedBy = Object.fromEntries(opened.map(r => [r.emp_id, r]))
    const handledBy = Object.fromEntries(handled.map(r => [r.emp, r.n]))
    const now = Date.now()
    const daysSince = (d) => d ? Math.floor((now - new Date(d)) / 86400000) : null
    const tenureMonths = (doj) => { if (!doj) return null; const t = new Date(doj); if (isNaN(t)) return null; return Math.max(0, Math.round((now - t) / (86400000 * 30.44))) }

    const people = emps.map(e => {
      const o = openedBy[e.emp_id]
      const lastActive = [o?.last_txn, e.logged_in_at].filter(Boolean).sort().pop() || null
      return {
        emp_id: e.emp_id, name: e.name, role: e.role, designation: e.designation,
        branch: e.branch || '—', state: e.state || null, active: e.active !== false,
        cases_opened: o?.n || 0, cases_handled: handledBy[e.emp_id] || 0,
        last_active: lastActive, idle_days: daysSince(lastActive),
        tenure_months: tenureMonths(e.date_of_joining), date_of_joining: e.date_of_joining || null,
        perf: perfOf(e.emp_id),
      }
    })
    const active = people.filter(p => p.active)

    // branch rollup — staff, managers, cases, avg total TAT (median of members' medians)
    const bmap = {}
    for (const p of active) {
      const k = p.branch || '—'
      const g = bmap[k] = bmap[k] || { key: k, state: p.state, staff: 0, managers: 0, cases_opened: 0, tats: [] }
      g.staff++; if (/manager/i.test(p.designation || '')) g.managers++
      g.cases_opened += p.cases_opened
      if (p.perf?.total != null) g.tats.push(p.perf.total)
    }
    const byBranch = Object.values(bmap).map(g => ({ key: g.key, state: g.state, staff: g.staff, managers: g.managers, cases_opened: g.cases_opened, median_tat: r1(med(g.tats)) })).sort((a, b) => b.staff - a.staff)
    const byRole = Object.values(active.reduce((m, p) => { const k = p.role || '—'; m[k] = (m[k] || 0) + 1; return m }, {})).length ? Object.entries(active.reduce((m, p) => { const k = p.role || '—'; m[k] = (m[k] || 0) + 1; return m }, {})).map(([key, staff]) => ({ key, staff })).sort((a, b) => b.staff - a.staff) : []

    const topOpeners  = [...active].filter(p => p.cases_opened > 0).sort((a, b) => b.cases_opened - a.cases_opened).slice(0, 15)
    const topHandlers = [...active].filter(p => p.cases_handled > 0).sort((a, b) => b.cases_handled - a.cases_handled).slice(0, 15)
    // fastest: employees with enough completed cases, by median total TAT (asc)
    const fastest = [...active].filter(p => (p.perf?.cases || 0) >= 5 && p.perf?.total != null).sort((a, b) => a.perf.total - b.perf.total).slice(0, 15)
    const idle = active.filter(p => p.idle_days == null || p.idle_days >= 30).sort((a, b) => (b.idle_days ?? 1e9) - (a.idle_days ?? 1e9)).slice(0, 40)
    const newJoiners = people.filter(p => p.tenure_months != null && p.tenure_months <= 3).sort((a, b) => (a.tenure_months) - (b.tenure_months)).slice(0, 30)
    const exits = people.filter(p => !p.active)

    return Response.json({
      totals: {
        total: people.length, active: active.length,
        with_activity: active.filter(p => p.cases_opened > 0 || p.cases_handled > 0).length,
        idle_30d: idle.length, exits: exits.length,
        total_cases_opened: active.reduce((s, p) => s + p.cases_opened, 0),
        median_org_tat: r1(med(active.map(p => p.perf?.total).filter(v => v != null))),
      },
      byBranch, byRole, topOpeners, topHandlers, fastest, idle, newJoiners, exits, people,
      stages: STAGES, generated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[employee-insights] error:', err)
    return Response.json({ error: err.message || 'Insights query failed' }, { status: 500 })
  } finally {
    if (client) { try { await client.end() } catch {} }
  }
}
