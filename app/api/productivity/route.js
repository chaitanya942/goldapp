// app/api/productivity/route.js
//
// Data engine for the Productivity module (gated to a hard email allowlist —
// see PAGE_EMAIL_ALLOWLIST). Reconstructs the FULL per-case stage timeline of
// the NEW CRM from artifact timestamps (Transaction / Estimation / Quotation /
// Kyc+KycLog / Payment / Order / Release / Agreement) — the same logic as
// scripts/gen-crm-case-timeline.mjs — and serves it LIVE and FILTERABLE.
//
// Stages (minutes), per case:
//   1 Valuation        opened → estimation.created
//   2 Estimation+nego  estimation.created → estimation.updated
//   3 Quotation prep   estimation.updated → quotation.created
//   4 Quotation appr   quotation.created → quotation.updated
//   5 KYC maker→checker KycLog(maker).min → KycLog(checker).max
//   6 Payment          (kyc-checker | quotation.updated) → payment.created
//   7 Order→completion payment.created → completed
//   R Release / Agreement sub-stages (RELEASED_GOLD only)
//
// action=report → ONE call powers the whole screen: kpis, per-stage medians,
//   a grouped breakdown (by any dimension), WIP stuck-by-status, the filtered
//   case list (drill-down) and facets (filter options). Every dimension is a
//   filter AND a group-by: state · branch · type · stone · ornaments · status ·
//   employee. Date window routes to NEW CRM (>=15 Jun) or OLD CRM (<=14 Jun).
//
// action=tat → legacy OLD-CRM walk-in→payment slices (kept for the OLD window).

import mysql from 'mysql2/promise'
import pg from 'pg'
import { requireAuthForPage } from '../../../lib/apiAuth'

const NEW_CUTOVER = '2026-06-15'   // >= this = NEW CRM (rich stages), else OLD CRM

// ── connection pools ─────────────────────────────────────────────────────────
let _my = null
function myPool() {
  if (!_my) _my = mysql.createPool({
    host: process.env.CRM_DB_HOST, port: parseInt(process.env.CRM_DB_PORT || '3306'),
    database: process.env.CRM_DB_NAME, user: process.env.CRM_DB_USER, password: process.env.CRM_DB_PASSWORD,
    waitForConnections: true, connectionLimit: 3, connectTimeout: 20000,
  })
  return _my
}
let _pg = null
function pgPool() {
  if (!_pg) _pg = new pg.Pool({
    host: process.env.NEW_CRM_DB_HOST, port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 20000, idleTimeoutMillis: 10000,
  })
  return _pg
}

// ── helpers ──────────────────────────────────────────────────────────────────
const med = (arr) => { const a = arr.filter(x => x != null && x >= 0); if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const avg = (arr) => { const a = arr.filter(x => x != null && x >= 0); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }
const r1  = (x) => x == null ? null : Math.round(x * 10) / 10
const dmin = (a, b) => (a != null && b != null) ? (b - a) / 60 : null   // epoch-seconds → minutes

// state normalisation (Branch.state can be 'KA'/'KL'/'AP'/'TS'/null; fall back to name prefix)
function normState(code, name) {
  const c = (code || '').toUpperCase().trim()
  if (c === 'KA' || c === 'KARNATAKA') return 'KARNATAKA'
  if (c === 'KL' || c === 'KERALA') return 'KERALA'
  if (c === 'AP' || c === 'ANDHRA PRADESH') return 'ANDHRA PRADESH'
  if (c === 'TS' || c === 'TG' || c === 'TELANGANA') return 'TELANGANA'
  const n = (name || '').toUpperCase()
  if (n.startsWith('KL-')) return 'KERALA'
  if (n.startsWith('AP-')) return 'ANDHRA PRADESH'
  if (n.startsWith('TS-')) return 'TELANGANA'
  return 'KARNATAKA'
}
const ornBucket = (n) => n == null || n === 0 ? 'unknown' : n === 1 ? '1' : n <= 5 ? '2-5' : n <= 10 ? '6-10' : '>10'
const STATUS_OWNER = {
  WALKIN: 'Branch (intake)', ESTIMATION_PENDING: 'Branch / Assayer (valuation)', VALUATION_PENDING: 'Branch / Assayer (valuation)',
  REVALUATION_PENDING: 'Assayer (revaluation)', BRANCH_KYC_PENDING: 'Branch (KYC capture)', KYC_PENDING: 'KYC Checker',
  KYC_REQUESTED: 'Customer / KYC Maker (docs)', QUOTATION_PENDING: 'Sales (quotation)', KYC_REJECTED: 'KYC (rework)',
  PENNY_DROP_PENDING: 'Accounts / Bank (penny-drop)', FINAL_PAYMENT_PENDING: 'Accounts / Branch (payment)',
  SALES_APPROVAL_PENDING: 'Sales (approval)', SALES_HEAD_APPROVAL_PENDING: 'Sales Head (approval)',
  SALES_NEGOTIATION_PENDING: 'Sales (negotiation)', REVALUATION_COMPLETED: 'Sales / Ops',
  PLEDGE_ESTIMATION_PENDING: 'Release / Valuation', RELEASE_AGREEMENT_PENDING: 'Release (agreement)',
  RELEASE_PENDING: 'Release / Ops', RELEASE_PAYMENT_PENDING: 'Accounts (release payment)',
  SERVICE_CHARGE_APPROVAL_PENDING: 'Sales / Accounts (service charge)', PLEDGE_APPROVAL_PENDING: 'Sales Head (pledge)',
}
const STAGES = [
  { key: 'val',     label: '1 · Valuation' },
  { key: 'estneg',  label: '2 · Estimation + negotiation' },
  { key: 'quoprep', label: '3 · Quotation prep' },
  { key: 'quoappr', label: '4 · Quotation approval' },
  { key: 'kyc',     label: '5 · KYC maker → checker' },
  { key: 'pay',     label: '6 · Payment' },
  { key: 'order',   label: '7 · Order → completion' },
]

// ── NEW CRM: pull the window once, build per-case stage objects ───────────────
async function newCrmPull(from, to) {
  const p = pgPool()
  const WIN = `(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2`
  const q = (sql) => p.query(sql, [from, to]).then(r => r.rows)

  const [emps, cohort, est, quo, pay, ord, klog, rel, agr, orn] = await Promise.all([
    p.query(`SELECT id, emp_id, trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) nm, role FROM "Employee"`).then(r => r.rows),
    q(`SELECT t.id, t.code, t.status, t.transaction_type ttype, t.emp_id opener,
            b.name branch, b.state bstate,
            EXTRACT(EPOCH FROM t.created_at) opened_s,
            EXTRACT(EPOCH FROM t.updated_at) completed_s,
            to_char((t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'),'YYYY-MM-DD') opened_date,
            to_char((t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'),'HH24:MI') opened_ist,
            EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - t.created_at))/60 age_min
       FROM "Transaction" t LEFT JOIN "Branch" b ON b.id=t.branch_id WHERE ${WIN}`),
    q(`SELECT e.transaction_id tid, EXTRACT(EPOCH FROM min(e.created_at)) ts, EXTRACT(EPOCH FROM max(e.updated_at)) upd,
            (array_agg(e.negotiation_approved_id) FILTER (WHERE e.negotiation_approved_id IS NOT NULL))[1] neg,
            (array_agg(e.service_charge_approved_id) FILTER (WHERE e.service_charge_approved_id IS NOT NULL))[1] svc
       FROM "Estimation" e JOIN "Transaction" t ON t.id=e.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT qq.transaction_id tid, EXTRACT(EPOCH FROM min(qq.created_at)) ts, EXTRACT(EPOCH FROM max(qq.updated_at)) upd,
            (array_agg(qq.quotation_approved_id) FILTER (WHERE qq.quotation_approved_id IS NOT NULL))[1] appr
       FROM "Quotation" qq JOIN "Transaction" t ON t.id=qq.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT pp.transaction_id tid, EXTRACT(EPOCH FROM min(pp.created_at)) ts,
            (array_agg(pp.employee_id))[1] emp, (array_agg(pp.sales_emp_id))[1] sales
       FROM "Payment" pp JOIN "Transaction" t ON t.id=pp.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT oo.transaction_id tid, EXTRACT(EPOCH FROM min(oo.created_at)) ts, (array_agg(oo.emp_id))[1] emp
       FROM "Order" oo JOIN "Transaction" t ON t.id=oo.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT k.transaction_id tid, l.employee_class cls, EXTRACT(EPOCH FROM min(l.created_at)) mn, EXTRACT(EPOCH FROM max(l.created_at)) mx
       FROM "KycLog" l JOIN "Kyc" k ON k.id=l.kyc_id JOIN "Transaction" t ON t.id=k.transaction_id WHERE ${WIN} GROUP BY 1,2`),
    q(`SELECT rr.transaction_id tid, EXTRACT(EPOCH FROM min(rr.created_at)) ts, EXTRACT(EPOCH FROM max(rr.updated_at)) upd
       FROM "Release" rr JOIN "Transaction" t ON t.id=rr.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT rr.transaction_id tid, EXTRACT(EPOCH FROM min(a.created_at)) ts, EXTRACT(EPOCH FROM max(a.updated_at)) upd, bool_or(a.signed) signed
       FROM "Agreement" a JOIN "Release" rr ON rr.id=a.release_id JOIN "Transaction" t ON t.id=rr.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT qq.transaction_id tid, count(*) cnt, bool_or(coalesce(o.with_stone,false) OR coalesce(o.stone_weight,0)>0) has_stone
       FROM "Ornament" o JOIN "Quotation" qq ON qq.id=o.quotation_id JOIN "Transaction" t ON t.id=qq.transaction_id WHERE ${WIN} GROUP BY 1`),
  ])

  const byId = {}, byEmp = {}
  emps.forEach(e => { byId[e.id] = e; if (e.emp_id) byEmp[e.emp_id] = e })
  const who = (x) => { if (!x) return null; const e = byId[x] || byEmp[x]; return e ? { name: e.nm || '?', role: e.role || '?' } : { name: String(x), role: '?' } }
  const idx = (arr) => { const m = {}; arr.forEach(r => m[r.tid] = r); return m }
  const E = idx(est), Q = idx(quo), P = idx(pay), O = idx(ord), R = idx(rel), A = idx(agr), ORN = idx(orn)
  const K = {}; klog.forEach(r => { (K[r.tid] = K[r.tid] || []).push(r) })

  return cohort.map(t => {
    const e = E[t.id], qrow = Q[t.id], pr = P[t.id], o = O[t.id], rr = R[t.id], a = A[t.id], on = ORN[t.id]
    const ks = K[t.id] || []
    const km = ks.filter(x => x.cls === 'KYC_MAKER').map(x => x.mn).sort((a, b) => a - b)[0] ?? null
    const kc = ks.filter(x => x.cls === 'KYC_CHECKER').map(x => x.mx).sort((a, b) => b - a)[0] ?? null
    const opener = who(t.opener)
    const stages = {
      val:     dmin(t.opened_s, e?.ts),
      estneg:  dmin(e?.ts, e?.upd),
      quoprep: dmin(e?.upd, qrow?.ts),
      quoappr: dmin(qrow?.ts, qrow?.upd),
      kyc:     dmin(km, kc),
      pay:     dmin(kc ?? qrow?.upd, pr?.ts),
      order:   dmin(pr?.ts, t.completed_s),
    }
    const completed = t.status === 'FINAL_PAYMENT_COMPLETED'
    const cnt = on ? Number(on.cnt) : null
    return {
      id: t.id, code: t.code, status: t.status,
      type: t.ttype === 'RELEASED_GOLD' ? 'TAKEOVER' : 'PHYSICAL',
      state: normState(t.bstate, t.branch), branch: t.branch || '—',
      stone: on ? (on.has_stone ? 'with_stone' : 'no_stone') : 'no_stone',
      ornCnt: cnt, ornBucket: ornBucket(cnt),
      openerId: t.opener, opener: opener?.name || '—', openerRole: opener?.role || '—',
      sales: who(pr?.sales)?.name || who(e?.neg)?.name || null,
      approver: who(qrow?.appr)?.name || null,
      openedDate: t.opened_date, openedIst: t.opened_ist,
      ageMin: t.age_min == null ? null : Number(t.age_min),
      completed, stages,
      total: completed ? dmin(t.opened_s, t.completed_s) : null,
      owner: STATUS_OWNER[t.status] || '—',
      release: rr ? { rel: dmin(rr.ts, rr.upd), agr: a ? dmin(a.ts, a.upd) : null, signed: a?.signed || false } : null,
    }
  })
}

// ── filtering & aggregation (all in JS — flexible across every dimension) ─────
const FILTERS = ['state', 'branch', 'type', 'stone', 'ornBucket', 'status', 'opener']
function applyFilters(cases, f) {
  return cases.filter(c => FILTERS.every(k => !f[k] || f[k] === '__all' || String(c[k]) === f[k]))
}
const DIM = { state: 'state', branch: 'branch', type: 'type', stone: 'stone', ornaments: 'ornBucket', employee: 'opener', status: 'status' }

function stageMedians(rows) {
  const out = {}
  STAGES.forEach(s => { const a = rows.map(r => r.stages[s.key]); out[s.key] = { median: r1(med(a)), avg: r1(avg(a)), n: a.filter(x => x != null && x >= 0).length } })
  out.total = { median: r1(med(rows.map(r => r.total))), avg: r1(avg(rows.map(r => r.total))), n: rows.filter(r => r.total != null).length }
  return out
}

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'productivity')
  if (!auth.ok) return auth.response

  const sp = new URL(req.url).searchParams
  const action = sp.get('action') || 'report'
  const from = sp.get('from') || '2026-06-15'
  const to   = sp.get('to')   || '2026-06-30'

  try {
    if (action === 'tat') return Response.json({ data: await oldCrmTat(from, to), window: { from, to } })

    if (action === 'report') {
      if (to < NEW_CUTOVER) {
        // OLD-CRM window — serve the legacy TAT slices (no per-stage artifacts there).
        return Response.json({ mode: 'old', window: { from, to }, tat: await oldCrmTat(from, to) })
      }
      const all = await newCrmPull(from, to)
      const filt = {
        state: sp.get('state'), branch: sp.get('branch'), type: sp.get('type'), stone: sp.get('stone'),
        ornBucket: sp.get('ornaments'), status: sp.get('status'), opener: sp.get('employee'),
      }
      const groupByKey = DIM[sp.get('groupBy')] || 'state'
      const rows = applyFilters(all, filt)
      const done = rows.filter(c => c.completed)
      const open = rows.filter(c => !c.completed && c.status !== 'WALKOUT')

      // KPIs
      const kpis = {
        completed: done.length, open: open.length, total: rows.length,
        medianTat: r1(med(done.map(r => r.total))), avgTat: r1(avg(done.map(r => r.total))),
        fastest: done.length ? r1(Math.min(...done.map(r => r.total).filter(x => x != null))) : null,
        slowest: done.length ? r1(Math.max(...done.map(r => r.total).filter(x => x != null))) : null,
      }
      // per-stage medians for completed set
      const stages = stageMedians(done)
      // grouped breakdown (completed) by chosen dimension
      const gmap = {}
      done.forEach(c => { const k = c[groupByKey] ?? '—'; (gmap[k] = gmap[k] || []).push(c) })
      const groups = Object.entries(gmap).map(([key, rs]) => ({
        key, n: rs.length, medianTat: r1(med(rs.map(r => r.total))),
        stages: Object.fromEntries(STAGES.map(s => [s.key, r1(med(rs.map(r => r.stages[s.key])))])),
      })).sort((a, b) => b.n - a.n)
      // WIP — stuck by status
      const smap = {}
      open.forEach(c => { (smap[c.status] = smap[c.status] || []).push(c.ageMin) })
      const wip = Object.entries(smap).map(([status, ages]) => ({
        status, owner: STATUS_OWNER[status] || '—', n: ages.length,
        medianAge: r1(med(ages)), oldestAge: r1(Math.max(...ages)),
      })).sort((a, b) => b.n - a.n)
      const oldestOpen = [...open].sort((a, b) => b.ageMin - a.ageMin).slice(0, 30)
        .map(c => ({ code: c.code, opener: c.opener, branch: c.branch, type: c.type, state: c.state, status: c.status, owner: c.owner, openedIst: c.openedIst, ageMin: r1(c.ageMin) }))
      // case list (drill-down) — completed, slowest first, capped
      const caseList = [...done].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 300).map(c => ({
        code: c.code, branch: c.branch, state: c.state, type: c.type, stone: c.stone, ornCnt: c.ornCnt,
        opener: c.opener, openedIst: c.openedIst, openedDate: c.openedDate, total: r1(c.total),
        stages: Object.fromEntries(STAGES.map(s => [s.key, r1(c.stages[s.key])])),
      }))
      // facets (from the FULL unfiltered window, so dropdowns are stable)
      const uniq = (key) => [...new Set(all.map(c => c[key]).filter(Boolean))].sort()
      const facets = {
        state: uniq('state'), branch: uniq('branch'), type: uniq('type'), stone: uniq('stone'),
        ornaments: ['1', '2-5', '6-10', '>10', 'unknown'].filter(b => all.some(c => c.ornBucket === b)),
        status: uniq('status'), employee: uniq('opener'),
      }
      return Response.json({ mode: 'new', window: { from, to }, groupBy: sp.get('groupBy') || 'state',
        kpis, stages, groups, wip, oldestOpen, cases: caseList, facets, stageMeta: STAGES })
    }
    return Response.json({ error: `Unknown action '${action}'` }, { status: 400 })
  } catch (err) {
    console.error('[productivity] error:', err)
    return Response.json({ error: err.message || 'Productivity query failed' }, { status: 500 })
  }
}

// ── OLD CRM TAT (MySQL) — legacy walk-in→payment slices for the 1–14 Jun window ─
async function oldCrmTat(from, to) {
  const p = myPool()
  const TAT = 'TIMESTAMPDIFF(MINUTE, TIMESTAMP(t.date,t.time), TIMESTAMP(t.pmt_date,t.pmt_time))'
  const TYP = "CASE WHEN t.type_gold='released' OR COALESCE(NULLIF(t.tkvr_amnt,''),'0')+0>0 THEN 'TAKEOVER' ELSE 'PHYSICAL' END"
  const STONE = "CASE WHEN CAST(o.stnt_wet AS DECIMAL(10,3))>0 THEN 'with_stone' ELSE 'no_stone' END"
  const ORN = "CASE WHEN CAST(o.num_ornmnts AS UNSIGNED)=1 THEN '1' WHEN CAST(o.num_ornmnts AS UNSIGNED) BETWEEN 2 AND 5 THEN '2-5' WHEN CAST(o.num_ornmnts AS UNSIGNED) BETWEEN 6 AND 10 THEN '6-10' ELSE '>10' END"
  const BASE = `FROM transac_tbl t JOIN ornments_tbl o ON o.trnxnn_id=t.bill_no JOIN branch_tbl b ON b.brnch_id=t.branch_id
    WHERE t.date BETWEEN ? AND ? AND t.pmt_date IS NOT NULL AND ${TAT} BETWEEN 0 AND 1440`
  const run = async (sql) => { const [r] = await p.query(sql, [from, to]); return r }
  const [overall] = await run(`SELECT COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min, MIN(${TAT}) min_min, MAX(${TAT}) max_min ${BASE}`)
  const by_state      = await run(`SELECT b.state, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY b.state ORDER BY bills DESC`)
  const by_type       = await run(`SELECT ${TYP} typ, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY typ`)
  const by_state_type = await run(`SELECT b.state, ${TYP} typ, ${STONE} stone, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY b.state, typ, stone ORDER BY b.state, typ, stone`)
  const by_ornament   = await run(`SELECT ${ORN} orn, ${STONE} stone, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY orn, stone ORDER BY orn, stone`)
  return { source: 'old_crm', overall, by_state, by_type, by_state_type, by_ornament }
}
