// app/api/productivity/route.js
//
// Data engine for the Productivity module (gated to a hard email allowlist —
// see PAGE_EMAIL_ALLOWLIST). Reconstructs per-case stage timelines from both
// CRMs and serves them LIVE, FILTERABLE, and COMPARABLE.
//
// NEW CRM (>=15 Jun) — full 7-stage timeline from artifact timestamps
//   (Transaction/Estimation/Quotation/Kyc+KycLog/Payment/Order/Release/Agreement):
//   1 Valuation · 2 Estimation+nego · 3 Quotation prep · 4 Quotation approval ·
//   5 KYC maker→checker · 6 Payment · 7 Order→completion.
// OLD CRM (<=14 Jun) — walk-in → approval → payout (2 stages + total).
//
// Query params:
//   action  report | people | case
//   source  new | old | compare | auto(default, by date)
//   from,to date window (purchase/walk-in date, IST)
//   bucket  day | week                      (trend granularity)
//   groupBy state|region|branch|type|stone|ornaments|employee|status
//   <dim>   any facet value → filter        (combinable)
//   code    (action=case) bill/transaction code → full timeline
//
// One report() call returns, per active source: kpis, per-stage medians, the
// "where time goes" split, a grouped breakdown by ANY dimension, a day/week
// trend, WIP stuck-by-status (NEW), facets, and a capped case list.

import mysql from 'mysql2/promise'
import pg from 'pg'
import { requireAuthForPage } from '../../../lib/apiAuth'

const CUTOVER = '2026-06-15'

// ── pools ────────────────────────────────────────────────────────────────────
let _my = null
function myPool() {
  if (!_my) _my = mysql.createPool({ host: process.env.CRM_DB_HOST, port: parseInt(process.env.CRM_DB_PORT || '3306'), database: process.env.CRM_DB_NAME, user: process.env.CRM_DB_USER, password: process.env.CRM_DB_PASSWORD, waitForConnections: true, connectionLimit: 3, connectTimeout: 20000 })
  return _my
}
let _pg = null
function pgPool() {
  if (!_pg) _pg = new pg.Pool({ host: process.env.NEW_CRM_DB_HOST, port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'), database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 20000, idleTimeoutMillis: 10000 })
  return _pg
}

// ── helpers ──────────────────────────────────────────────────────────────────
const med = (arr) => { const a = arr.filter(x => x != null && x >= 0); if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const avg = (arr) => { const a = arr.filter(x => x != null && x >= 0); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }
const r1 = (x) => x == null ? null : Math.round(x * 10) / 10
const dmin = (a, b) => (a != null && b != null) ? (b - a) / 60 : null
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
// business region (Branch.region_id is unpopulated in NEW CRM → derive from state)
const regionOf = (state) => state === 'KERALA' ? 'Kerala' : (state === 'ANDHRA PRADESH' || state === 'TELANGANA') ? 'AP & Telangana' : 'Karnataka'
const ornBucket = (n) => n == null || n === 0 ? 'unknown' : n === 1 ? '1' : n <= 5 ? '2-5' : n <= 10 ? '6-10' : '>10'
function isoWeek(dstr) { const d = new Date(dstr + 'T00:00:00Z'); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); const wk = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7); return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}` }

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
const NEW_STAGES = [
  { key: 'val', label: '1 · Valuation' }, { key: 'estneg', label: '2 · Estimation + negotiation' },
  { key: 'quoprep', label: '3 · Quotation prep' }, { key: 'quoappr', label: '4 · Quotation approval' },
  { key: 'kyc', label: '5 · KYC maker → checker' }, { key: 'pay', label: '6 · Payment' }, { key: 'order', label: '7 · Order → completion' },
]
const OLD_STAGES = [{ key: 'process', label: '1 · Walk-in → approval' }, { key: 'payout', label: '2 · Approval → payout' }]
const DIM = { state: 'state', region: 'region', branch: 'branch', type: 'type', stone: 'stone', ornaments: 'ornBucket', employee: 'opener', status: 'status' }
const FILTERS = { state: 'state', region: 'region', branch: 'branch', type: 'type', stone: 'stone', ornaments: 'ornBucket', status: 'status', employee: 'opener' }

// ── NEW CRM pull ─────────────────────────────────────────────────────────────
async function newCrmPull(from, to) {
  const p = pgPool()
  const WIN = `(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2`
  const q = (sql) => p.query(sql, [from, to]).then(r => r.rows)
  const [emps, cohort, est, quo, pay, ord, klog, rel, agr, orn] = await Promise.all([
    p.query(`SELECT id, emp_id, trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) nm, role FROM "Employee"`).then(r => r.rows),
    q(`SELECT t.id, t.code, t.status, t.transaction_type ttype, t.emp_id opener, b.name branch, b.state bstate,
          EXTRACT(EPOCH FROM t.created_at) opened_s, EXTRACT(EPOCH FROM t.updated_at) completed_s,
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
    q(`SELECT pp.transaction_id tid, EXTRACT(EPOCH FROM min(pp.created_at)) ts, (array_agg(pp.employee_id))[1] emp, (array_agg(pp.sales_emp_id))[1] sales FROM "Payment" pp JOIN "Transaction" t ON t.id=pp.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT oo.transaction_id tid, EXTRACT(EPOCH FROM min(oo.created_at)) ts, (array_agg(oo.emp_id))[1] emp FROM "Order" oo JOIN "Transaction" t ON t.id=oo.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT k.transaction_id tid, l.employee_class cls, EXTRACT(EPOCH FROM min(l.created_at)) mn, EXTRACT(EPOCH FROM max(l.created_at)) mx, (array_agg(l.emp_id))[1] emp FROM "KycLog" l JOIN "Kyc" k ON k.id=l.kyc_id JOIN "Transaction" t ON t.id=k.transaction_id WHERE ${WIN} GROUP BY 1,2`),
    q(`SELECT rr.transaction_id tid, EXTRACT(EPOCH FROM min(rr.created_at)) ts, EXTRACT(EPOCH FROM max(rr.updated_at)) upd FROM "Release" rr JOIN "Transaction" t ON t.id=rr.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT rr.transaction_id tid, EXTRACT(EPOCH FROM min(a.created_at)) ts, EXTRACT(EPOCH FROM max(a.updated_at)) upd, bool_or(a.signed) signed FROM "Agreement" a JOIN "Release" rr ON rr.id=a.release_id JOIN "Transaction" t ON t.id=rr.transaction_id WHERE ${WIN} GROUP BY 1`),
    q(`SELECT qq.transaction_id tid, count(*) cnt, bool_or(coalesce(o.with_stone,false) OR coalesce(o.stone_weight,0)>0) has_stone FROM "Ornament" o JOIN "Quotation" qq ON qq.id=o.quotation_id JOIN "Transaction" t ON t.id=qq.transaction_id WHERE ${WIN} GROUP BY 1`),
  ])
  const byId = {}, byEmp = {}
  emps.forEach(e => { byId[e.id] = e; if (e.emp_id) byEmp[e.emp_id] = e })
  const who = (x) => { if (!x) return null; const e = byId[x] || byEmp[x]; return e ? (e.nm || String(x)) : String(x) }
  const idx = (a) => { const m = {}; a.forEach(r => m[r.tid] = r); return m }
  const E = idx(est), Q = idx(quo), P = idx(pay), O = idx(ord), R = idx(rel), A = idx(agr), ORN = idx(orn)
  const K = {}; klog.forEach(r => { (K[r.tid] = K[r.tid] || []).push(r) })
  return cohort.map(t => {
    const e = E[t.id], qr = Q[t.id], pr = P[t.id], rr = R[t.id], a = A[t.id], on = ORN[t.id]
    const ks = K[t.id] || []
    const mk = ks.filter(x => x.cls === 'KYC_MAKER'), ck = ks.filter(x => x.cls === 'KYC_CHECKER')
    const km = mk.map(x => x.mn).sort((a, b) => a - b)[0] ?? null
    const kc = ck.map(x => x.mx).sort((a, b) => b - a)[0] ?? null
    const state = normState(t.bstate, t.branch)
    const completed = t.status === 'FINAL_PAYMENT_COMPLETED'
    const cnt = on ? Number(on.cnt) : null
    const stages = { val: dmin(t.opened_s, e?.ts), estneg: dmin(e?.ts, e?.upd), quoprep: dmin(e?.upd, qr?.ts), quoappr: dmin(qr?.ts, qr?.upd), kyc: dmin(km, kc), pay: dmin(kc ?? qr?.upd, pr?.ts), order: dmin(pr?.ts, t.completed_s) }
    return {
      code: t.code, status: t.status, type: t.ttype === 'RELEASED_GOLD' ? 'TAKEOVER' : 'PHYSICAL',
      state, region: regionOf(state), branch: t.branch || '—',
      stone: on ? (on.has_stone ? 'with_stone' : 'no_stone') : 'no_stone', ornCnt: cnt, ornBucket: ornBucket(cnt),
      opener: who(t.opener) || '—', openedDate: t.opened_date, openedIst: t.opened_ist,
      ageMin: t.age_min == null ? null : Number(t.age_min), completed, stages,
      total: completed ? dmin(t.opened_s, t.completed_s) : null, owner: STATUS_OWNER[t.status] || '—',
      handlers: { val: who(t.opener), estneg: who(e?.neg) || who(e?.svc), quoprep: who(t.opener), quoappr: who(qr?.appr), kyc: who(ck[0]?.emp) || who(mk[0]?.emp), pay: who(pr?.emp) || who(pr?.sales) },
      release: rr ? { signed: a?.signed || false } : null,
    }
  })
}

// ── OLD CRM pull (comparable) ────────────────────────────────────────────────
async function oldCrmPull(from, to) {
  const p = myPool()
  const TAT = 'TIMESTAMPDIFF(MINUTE, TIMESTAMP(t.date,t.time), TIMESTAMP(t.pmt_date,t.pmt_time))'
  const [emps] = await p.query(`SELECT employee_code ec, TRIM(CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,''))) nm FROM mst_employee`)
  const eMap = {}; emps.forEach(e => { if (e.ec) eMap[e.ec] = e.nm || e.ec })
  const [rows] = await p.query(
    `SELECT t.bill_no code, t.type_gold, COALESCE(NULLIF(t.tkvr_amnt,''),'0')+0 tkvr, b.state bstate, b.brnch_name branch, t.brnch_emp opener_code,
        UNIX_TIMESTAMP(TIMESTAMP(t.date,t.time)) walkin_s,
        UNIX_TIMESTAMP(TIMESTAMP(t.pmt_date,t.pymt_ap_time)) appr_s,
        UNIX_TIMESTAMP(TIMESTAMP(t.pmt_date,t.pmt_time)) pay_s,
        DATE_FORMAT(t.date,'%Y-%m-%d') opened_date, DATE_FORMAT(t.time,'%H:%i') opened_ist,
        CAST(o.num_ornmnts AS UNSIGNED) orncnt, CAST(o.stnt_wet AS DECIMAL(10,3)) stone_wt
     FROM transac_tbl t JOIN ornments_tbl o ON o.trnxnn_id=t.bill_no JOIN branch_tbl b ON b.brnch_id=t.branch_id
     WHERE t.date BETWEEN ? AND ? AND t.pmt_date IS NOT NULL AND ${TAT} BETWEEN 0 AND 1440`, [from, to])
  return rows.map(r => {
    const state = normState(r.bstate, r.branch)
    const total = dmin(r.walkin_s, r.pay_s), process = dmin(r.walkin_s, r.appr_s), payout = dmin(r.appr_s, r.pay_s)
    const opener = eMap[r.opener_code] || r.opener_code || '—'
    return {
      code: String(r.code), status: 'COMPLETED', type: (r.type_gold === 'released' || r.tkvr > 0) ? 'TAKEOVER' : 'PHYSICAL',
      state, region: regionOf(state), branch: r.branch || '—',
      stone: Number(r.stone_wt) > 0 ? 'with_stone' : 'no_stone', ornCnt: r.orncnt == null ? null : Number(r.orncnt), ornBucket: ornBucket(r.orncnt == null ? null : Number(r.orncnt)),
      opener, openedDate: r.opened_date, openedIst: r.opened_ist, ageMin: null, completed: true,
      stages: { process, payout }, total, owner: '—',
      handlers: { process: opener, payout: opener },
    }
  })
}

// ── aggregation ──────────────────────────────────────────────────────────────
function applyFilters(cases, f) { return cases.filter(c => Object.entries(FILTERS).every(([k, field]) => !f[k] || String(c[field]) === f[k])) }
function stageMedians(rows, stageMeta) {
  const out = {}
  stageMeta.forEach(s => { const a = rows.map(r => r.stages[s.key]); out[s.key] = { median: r1(med(a)), n: a.filter(x => x != null && x >= 0).length } })
  out.total = { median: r1(med(rows.map(r => r.total))), n: rows.filter(r => r.total != null).length }
  return out
}
function buildReport(all, { groupByKey, stageMeta, isNew, bucket, filt }) {
  const rows = applyFilters(all, filt)
  const done = rows.filter(c => c.completed)
  const open = isNew ? rows.filter(c => !c.completed && c.status !== 'WALKOUT') : []
  const totals = done.map(r => r.total).filter(x => x != null)
  const kpis = { completed: done.length, open: open.length, total: rows.length, medianTat: r1(med(totals)), avgTat: r1(avg(totals)), fastest: totals.length ? r1(Math.min(...totals)) : null, slowest: totals.length ? r1(Math.max(...totals)) : null }
  const stages = stageMedians(done, stageMeta)
  const gmap = {}; done.forEach(c => { const k = c[groupByKey] ?? '—'; (gmap[k] = gmap[k] || []).push(c) })
  const groups = Object.entries(gmap).map(([key, rs]) => ({ key, n: rs.length, medianTat: r1(med(rs.map(r => r.total))), stages: Object.fromEntries(stageMeta.map(s => [s.key, r1(med(rs.map(r => r.stages[s.key])))])) })).sort((a, b) => b.n - a.n)
  // trend
  const tmap = {}; done.forEach(c => { if (!c.openedDate) return; const k = bucket === 'week' ? isoWeek(c.openedDate) : c.openedDate; (tmap[k] = tmap[k] || []).push(c.total) })
  const trend = Object.entries(tmap).map(([bucket, arr]) => ({ bucket, n: arr.length, medianTat: r1(med(arr)) })).sort((a, b) => a.bucket < b.bucket ? -1 : 1)
  // wip
  const smap = {}; open.forEach(c => { (smap[c.status] = smap[c.status] || []).push(c.ageMin) })
  const wip = Object.entries(smap).map(([status, ages]) => ({ status, owner: STATUS_OWNER[status] || '—', n: ages.length, medianAge: r1(med(ages)), oldestAge: r1(Math.max(...ages)) })).sort((a, b) => b.n - a.n)
  const oldestOpen = [...open].sort((a, b) => b.ageMin - a.ageMin).slice(0, 30).map(c => ({ code: c.code, opener: c.opener, branch: c.branch, type: c.type, state: c.state, status: c.status, owner: c.owner, openedIst: c.openedIst, ageMin: r1(c.ageMin) }))
  const cases = [...done].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 400).map(c => ({ code: c.code, branch: c.branch, state: c.state, type: c.type, stone: c.stone, ornCnt: c.ornCnt, opener: c.opener, openedDate: c.openedDate, openedIst: c.openedIst, total: r1(c.total), stages: Object.fromEntries(stageMeta.map(s => [s.key, r1(c.stages[s.key])])) }))
  const uniq = (field) => [...new Set(all.map(c => c[field]).filter(Boolean))].sort()
  const facets = { state: uniq('state'), region: uniq('region'), branch: uniq('branch'), type: uniq('type'), stone: uniq('stone'), ornaments: ['1', '2-5', '6-10', '>10', 'unknown'].filter(b => all.some(c => c.ornBucket === b)), status: uniq('status'), employee: uniq('opener') }
  return { kpis, stages, groups, trend, wip, oldestOpen, cases, facets, stageMeta, groupBy: Object.keys(DIM).find(k => DIM[k] === groupByKey) || 'state' }
}
function peopleAgg(cases, stageMeta) {
  const ppl = {}
  cases.filter(c => c.completed).forEach(c => {
    Object.entries(c.handlers || {}).forEach(([stage, h]) => {
      if (!h || h === '—') return
      const e = ppl[h] = ppl[h] || { name: h, cases: new Set(), stages: {} }
      e.cases.add(c.code); (e.stages[stage] = e.stages[stage] || []).push(c.stages[stage])
    })
  })
  return Object.values(ppl).map(e => ({ name: e.name, cases: e.cases.size, stages: Object.fromEntries(stageMeta.map(s => [s.key, e.stages[s.key] ? { median: r1(med(e.stages[s.key])), n: e.stages[s.key].filter(x => x != null && x >= 0).length } : null])) })).sort((a, b) => b.cases - a.cases).slice(0, 200)
}

// ── single-case full timeline (bill-level) — NEW CRM ─────────────────────────
async function newCaseDetail(code) {
  const p = pgPool()
  const tx = (await p.query(`SELECT t.id, t.code, t.status, t.transaction_type ttype, t.emp_id opener, b.name branch, b.state,
      EXTRACT(EPOCH FROM t.created_at) opened_s, EXTRACT(EPOCH FROM t.updated_at) completed_s,
      to_char((t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'),'HH24:MI') opened_ist FROM "Transaction" t LEFT JOIN "Branch" b ON b.id=t.branch_id WHERE t.code=$1 LIMIT 1`, [code])).rows[0]
  if (!tx) return null
  const id = tx.id
  const one = (sql) => p.query(sql, [id]).then(r => r.rows[0])
  const [emps, e, qr, pr, o, kl, rr, a] = await Promise.all([
    p.query(`SELECT id, emp_id, trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) nm, role FROM "Employee"`).then(r => r.rows),
    one(`SELECT EXTRACT(EPOCH FROM min(created_at)) ts, EXTRACT(EPOCH FROM max(updated_at)) upd, (array_agg(negotiation_approved_id) FILTER (WHERE negotiation_approved_id IS NOT NULL))[1] neg, (array_agg(service_charge_approved_id) FILTER (WHERE service_charge_approved_id IS NOT NULL))[1] svc FROM "Estimation" WHERE transaction_id=$1`),
    one(`SELECT EXTRACT(EPOCH FROM min(created_at)) ts, EXTRACT(EPOCH FROM max(updated_at)) upd, (array_agg(quotation_approved_id) FILTER (WHERE quotation_approved_id IS NOT NULL))[1] appr FROM "Quotation" WHERE transaction_id=$1`),
    one(`SELECT EXTRACT(EPOCH FROM min(created_at)) ts, (array_agg(employee_id))[1] emp, (array_agg(sales_emp_id))[1] sales FROM "Payment" WHERE transaction_id=$1`),
    one(`SELECT EXTRACT(EPOCH FROM min(created_at)) ts, (array_agg(emp_id))[1] emp FROM "Order" WHERE transaction_id=$1`),
    p.query(`SELECT l.employee_class cls, l.action, l.emp_id, EXTRACT(EPOCH FROM l.created_at) ts FROM "KycLog" l JOIN "Kyc" k ON k.id=l.kyc_id WHERE k.transaction_id=$1 ORDER BY l.created_at`, [id]).then(r => r.rows),
    one(`SELECT EXTRACT(EPOCH FROM min(created_at)) ts, EXTRACT(EPOCH FROM max(updated_at)) upd FROM "Release" WHERE transaction_id=$1`),
    one(`SELECT EXTRACT(EPOCH FROM min(a.created_at)) ts, EXTRACT(EPOCH FROM max(a.updated_at)) upd, bool_or(a.signed) signed FROM "Agreement" a JOIN "Release" r ON r.id=a.release_id WHERE r.transaction_id=$1`),
  ])
  const byId = {}, byEmp = {}; emps.forEach(x => { byId[x.id] = x; if (x.emp_id) byEmp[x.emp_id] = x })
  const who = (x) => { if (!x) return '—'; const z = byId[x] || byEmp[x]; return z ? `${z.nm} (${z.role})` : String(x) }
  const hh = (s) => { if (s == null) return '—'; const d = new Date((s + 5.5 * 3600) * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
  const km = kl.filter(x => x.cls === 'KYC_MAKER')[0]?.ts ?? null
  const kc = kl.filter(x => x.cls === 'KYC_CHECKER').slice(-1)[0]?.ts ?? null
  const rows = [
    { stage: '1 · Valuation', a: tx.opened_s, b: e?.ts, who: who(tx.opener) },
    { stage: '2 · Estimation + negotiation', a: e?.ts, b: e?.upd, who: who(e?.neg) || who(e?.svc) },
    { stage: '3 · Quotation prep', a: e?.upd, b: qr?.ts, who: who(tx.opener) },
    { stage: '4 · Quotation approval', a: qr?.ts, b: qr?.upd, who: who(qr?.appr) },
  ]
  if (tx.ttype === 'RELEASED_GOLD' && rr) { rows.push({ stage: 'R · Release', a: rr.ts, b: rr.upd, who: 'release/ops' }); if (a) rows.push({ stage: 'R · Agreement', a: a.ts, b: a.upd, who: a.signed ? 'signed' : 'unsigned' }) }
  kl.forEach(k => rows.push({ stage: `KYC · ${k.action}`, a: k.ts, b: k.ts, who: `${who(k.emp_id)} · ${k.cls}` }))
  rows.push({ stage: '6 · Payment', a: kc ?? qr?.upd, b: pr?.ts, who: who(pr?.emp) || who(pr?.sales) })
  if (o) rows.push({ stage: '7 · Order', a: pr?.ts, b: o.ts, who: who(o.emp) })
  rows.push({ stage: '8 · Completion', a: pr?.ts, b: tx.completed_s, who: 'system' })
  return {
    header: { code: tx.code, branch: tx.branch, state: normState(tx.state, tx.branch), type: tx.ttype === 'RELEASED_GOLD' ? 'TAKEOVER' : 'PHYSICAL', status: tx.status, openedIst: tx.opened_ist, total: r1(dmin(tx.opened_s, tx.completed_s)), openedBy: who(tx.opener) },
    rows: rows.map(r => ({ stage: r.stage, start: hh(r.a), end: hh(r.b), dur: r1(dmin(r.a, r.b)), who: r.who })),
  }
}

// ── route ────────────────────────────────────────────────────────────────────
export async function GET(req) {
  const auth = await requireAuthForPage(req, 'productivity')
  if (!auth.ok) return auth.response
  const sp = new URL(req.url).searchParams
  const action = sp.get('action') || 'report'
  const from = sp.get('from') || '2026-06-15'
  const to = sp.get('to') || '2026-06-30'
  const bucket = sp.get('bucket') === 'week' ? 'week' : 'day'
  let source = sp.get('source') || 'auto'
  if (source === 'auto') source = to < CUTOVER ? 'old' : (from < CUTOVER ? 'compare' : 'new')
  const filt = { state: sp.get('state'), region: sp.get('region'), branch: sp.get('branch'), type: sp.get('type'), stone: sp.get('stone'), ornaments: sp.get('ornaments'), status: sp.get('status'), employee: sp.get('employee') }

  try {
    if (action === 'case') {
      const d = await newCaseDetail(sp.get('code'))
      return d ? Response.json({ detail: d }) : Response.json({ error: 'Case not found' }, { status: 404 })
    }
    if (action === 'people') {
      const cases = await newCrmPull(from, to)
      return Response.json({ people: peopleAgg(applyFilters(cases, filt), NEW_STAGES), stageMeta: NEW_STAGES })
    }
    // report
    const out = { source, window: { from, to }, bucket, sources: {} }
    const tasks = []
    if (source === 'new' || source === 'compare') tasks.push(newCrmPull(from, to).then(c => { out.sources.new = buildReport(c, { groupByKey: DIM[sp.get('groupBy')] || 'state', stageMeta: NEW_STAGES, isNew: true, bucket, filt }) }))
    if (source === 'old' || source === 'compare') tasks.push(oldCrmPull(from, to).then(c => { out.sources.old = buildReport(c, { groupByKey: DIM[sp.get('groupBy')] || 'state', stageMeta: OLD_STAGES, isNew: false, bucket, filt }) }))
    await Promise.all(tasks)
    return Response.json(out)
  } catch (err) {
    console.error('[productivity] error:', err)
    return Response.json({ error: err.message || 'Productivity query failed' }, { status: 500 })
  }
}
