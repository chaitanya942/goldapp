// Detailed case-wise, stage-wise timeline report for the new CRM, reconstructed
// from artifact timestamps (the native Timer table is not populated for current
// cases). Covers:
//   A) Live WIP / in-flight cases (created today, not yet completed)
//   B) Completed cases — decomposed: valuation → estimation+negotiation →
//      quotation prep → quotation approval → KYC actions → payment → order
//   C) Pledge (RELEASED_GOLD) release sub-flow (Release + Agreement)
//   node scripts/gen-crm-case-timeline.mjs
import pg from 'pg'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
  .split('\n').reduce((a, l) => { const e = l.indexOf('='); if (e > 0 && !l.startsWith('#')) a[l.slice(0, e).trim()] = l.slice(e + 1).trim().replace(/^["']|["']$/g, ''); return a }, {})

const { Client } = pg
const NOW = new Date()
const IST  = ts => ts ? new Date(new Date(ts).getTime() + 5.5 * 3600000) : null
const hhmm = ts => { const d = IST(ts); return d ? `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}` : '—' }
const dur  = (a, b) => { if (!a || !b) return '—'; const m = (new Date(b) - new Date(a)) / 60000; if (m < 0) return '(reorder)'; return m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(1) + 'm' }
const med  = (arr) => { const a = arr.filter(x => x != null && x >= 0); if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const fmtm = (m) => m == null ? '—' : (m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(1) + 'm')
const mn   = (a, b) => (a && b) ? (new Date(b) - new Date(a)) / 60000 : null
const ageM = (a) => a ? (NOW - new Date(a)) / 60000 : null

// status → role that the case is waiting on (for the WIP view)
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

const c = new Client({ host: env.NEW_CRM_DB_HOST, port: parseInt(env.NEW_CRM_DB_PORT || '5432'), database: env.NEW_CRM_DB_NAME, user: env.NEW_CRM_DB_USER, password: env.NEW_CRM_DB_PASSWORD, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 })
await c.connect()

const emp = (await c.query(`SELECT id, emp_id, trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) nm, role FROM "Employee"`)).rows
const byId = {}, byEmp = {}
emp.forEach(e => { byId[e.id] = e; if (e.emp_id) byEmp[e.emp_id] = e })
const who = x => { if (!x) return null; const e = byId[x] || byEmp[x]; return e ? `${e.nm || '?'} (${e.role || '?'})` : `${x}` }
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
const CREATED_IST = `(t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date`

// ── B/C cohort: completed & created today ────────────────────────────────────
const cohort = (await c.query(`
  SELECT t.id, t.code, t.created_at opened, t.updated_at completed, t.emp_id, t.transaction_type,
         b.name branch, trim(coalesce(cu.first_name,'')||' '||coalesce(cu.last_name,'')) customer
  FROM "Transaction" t
  LEFT JOIN "Branch" b ON b.id = t.branch_id
  LEFT JOIN "Customer" cu ON cu.id = t.customer_id
  WHERE t.status = 'FINAL_PAYMENT_COMPLETED' AND ${CREATED_IST} = ${TODAY}
  ORDER BY t.created_at`)).rows
const ids = cohort.map(r => r.id)
const inlist = ids.map((_, i) => `$${i + 1}`).join(',')

const est = (await c.query(`SELECT transaction_id, min(created_at) ts, max(updated_at) upd, (array_agg(negotiation_approved_id) FILTER (WHERE negotiation_approved_id IS NOT NULL))[1] neg, (array_agg(service_charge_approved_id) FILTER (WHERE service_charge_approved_id IS NOT NULL))[1] svc FROM "Estimation" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const quo = (await c.query(`SELECT transaction_id, min(created_at) ts, max(updated_at) upd, (array_agg(quotation_approved_id) FILTER (WHERE quotation_approved_id IS NOT NULL))[1] appr FROM "Quotation" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const pay = (await c.query(`SELECT transaction_id, min(created_at) ts, (array_agg(employee_id))[1] emp, (array_agg(sales_emp_id))[1] sales FROM "Payment" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const ord = (await c.query(`SELECT transaction_id, min(created_at) ts, (array_agg(emp_id))[1] emp FROM "Order" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const klog = (await c.query(`SELECT k.transaction_id, l.emp_id, l.employee_class, l.action, l.created_at FROM "KycLog" l JOIN "Kyc" k ON k.id = l.kyc_id WHERE k.transaction_id IN (${inlist}) ORDER BY l.created_at`, ids)).rows
const rel = (await c.query(`SELECT transaction_id, min(created_at) ts, max(updated_at) upd, (array_agg(estimation_sales_approval))[1] sa, (array_agg(estimation_sales_head_approval))[1] sha, (array_agg(total_release_amount))[1] amt FROM "Release" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const agr = (await c.query(`SELECT r.transaction_id, min(a.created_at) ts, max(a.updated_at) upd, bool_or(a.signed) signed FROM "Agreement" a JOIN "Release" r ON r.id = a.release_id WHERE r.transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows

// ── A cohort: in-flight (created today, not terminal) ────────────────────────
const wip = (await c.query(`
  SELECT t.id, t.code, t.status, t.transaction_type, t.created_at, b.name branch,
         trim(coalesce(cu.first_name,'')||' '||coalesce(cu.last_name,'')) customer
  FROM "Transaction" t
  LEFT JOIN "Branch" b ON b.id = t.branch_id
  LEFT JOIN "Customer" cu ON cu.id = t.customer_id
  WHERE ${CREATED_IST} = ${TODAY} AND t.status NOT IN ('FINAL_PAYMENT_COMPLETED','WALKOUT')
  ORDER BY t.created_at`)).rows
const backlog = (await c.query(`SELECT count(*) n FROM "Transaction" t WHERE ${CREATED_IST} < ${TODAY} AND t.status NOT IN ('FINAL_PAYMENT_COMPLETED','WALKOUT','WALKIN')`)).rows[0].n
await c.end()

const idx = arr => { const m = {}; arr.forEach(r => m[r.transaction_id] = r); return m }
const E = idx(est), Q = idx(quo), P = idx(pay), O = idx(ord), R = idx(rel), A = idx(agr)
const K = {}; klog.forEach(r => { (K[r.transaction_id] = K[r.transaction_id] || []).push(r) })

const nowIst = IST(NOW.toISOString())
const istDate = `${nowIst.getUTCFullYear()}-${String(nowIst.getUTCMonth() + 1).padStart(2, '0')}-${String(nowIst.getUTCDate()).padStart(2, '0')}`

let md = `# New CRM — Case-wise Stage Timeline (${istDate} IST)\n\n`
md += `Reconstructed from stage-artifact timestamps (Transaction / Estimation / Quotation / Kyc+KycLog / Payment / Order / Release / Agreement). All times **IST**, snapshot at **${hhmm(NOW.toISOString())}**. The native \`Timer\` table is not populated for current cases. "(reorder)" = the artifact was timestamped before the previous milestone (stages overlap in the CRM).\n\n`

// ── SECTION A — WIP ──────────────────────────────────────────────────────────
md += `## A · Live WIP — in-flight cases created today (NOT yet completed)\n\n`
md += `**${wip.length} cases** still open (created today). Plus **${backlog} older cases** still open from previous days (carried-over backlog).\n\n`
const byStatus = {}
wip.forEach(r => { (byStatus[r.status] = byStatus[r.status] || []).push(ageM(r.created_at)) })
md += `### Where they're stuck (by current status)\n\n| Current status | Waiting on | open cases | median age | oldest |\n|---|---|---|---|---|\n`
Object.entries(byStatus).sort((a, b) => b[1].length - a[1].length).forEach(([s, ages]) => {
  md += `| ${s} | ${STATUS_OWNER[s] || '?'} | ${ages.length} | ${fmtm(med(ages))} | ${fmtm(Math.max(...ages))} |\n`
})
const oldest = [...wip].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 20)
md += `\n### 20 oldest open cases right now\n\n| Code | Customer | Branch | Type | Status (waiting on) | Open since | Age |\n|---|---|---|---|---|---|---|\n`
oldest.forEach(r => { md += `| ${r.code} | ${r.customer || '—'} | ${r.branch || '—'} | ${(r.transaction_type || '').replace('_GOLD','')} | ${r.status} — ${STATUS_OWNER[r.status] || '?'} | ${hhmm(r.created_at)} | ${fmtm(ageM(r.created_at))} |\n` })
md += `\n---\n\n`

// ── decomposed medians for completed cohort ──────────────────────────────────
const agg = { val: [], estneg: [], quoprep: [], quoappr: [], kmkc: [], pay: [], ord: [], total: [] }
const built = []
for (const t of cohort) {
  const e = E[t.id], q = Q[t.id], p = P[t.id], o = O[t.id], r = R[t.id], a = A[t.id]
  const ks = K[t.id] || []
  const km = ks.filter(x => x.employee_class === 'KYC_MAKER')[0]?.created_at || null
  const kc = ks.filter(x => x.employee_class === 'KYC_CHECKER').slice(-1)[0]?.created_at || null
  agg.val.push(mn(t.opened, e?.ts)); agg.estneg.push(mn(e?.ts, e?.upd)); agg.quoprep.push(mn(e?.upd, q?.ts))
  agg.quoappr.push(mn(q?.ts, q?.upd)); agg.kmkc.push(mn(km, kc)); agg.pay.push(mn(kc || q?.upd, p?.ts)); agg.ord.push(mn(p?.ts, t.completed)); agg.total.push(mn(t.opened, t.completed))
  built.push({ t, e, q, p, o, r, a, ks, km, kc })
}
md += `## B · Completed cases — overall medians (decomposed)\n\n**Cohort:** ${cohort.length} completed & created today (note: 3 cases completed today but created on a prior day are not included here).\n\n`
md += `| Stage | n | median |\n|---|---|---|\n`
const ar = (l, a) => `| ${l} | ${a.filter(x => x != null && x >= 0).length} | ${fmtm(med(a))} |\n`
md += ar('1 · Valuation (open → estimation)', agg.val)
md += ar('2 · Estimation + negotiation/SC approval', agg.estneg)
md += ar('3 · Quotation prep (estimation → quotation)', agg.quoprep)
md += ar('4 · Quotation approval', agg.quoappr)
md += ar('5 · KYC maker → checker', agg.kmkc)
md += ar('6 · Payment', agg.pay)
md += ar('7 · Order → completion', agg.ord)
md += `| **TOTAL open → completed** | ${agg.total.filter(x => x != null && x >= 0).length} | **${fmtm(med(agg.total))}** |\n\n---\n\n`

// ── per-case detail ──────────────────────────────────────────────────────────
md += `## Case-by-case detail\n\n`
let n = 0
for (const { t, e, q, p, o, r, a, ks, km, kc } of built) {
  n++
  const isRel = t.transaction_type === 'RELEASED_GOLD'
  md += `### ${n}. ${t.code} · ${t.customer || '—'} · ${t.branch || '—'} · ${(t.transaction_type || '').replace('_GOLD','')}\n`
  md += `Opened **${hhmm(t.opened)}** → Completed **${hhmm(t.completed)}** · total **${dur(t.opened, t.completed)}** · opened by ${who(t.emp_id) || '—'}\n\n`
  md += `| Stage | Start | End | Duration | Handled by (role) |\n|---|---|---|---|---|\n`
  const row = (s, x, y, act) => { md += `| ${s} | ${hhmm(x)} | ${hhmm(y)} | ${dur(x, y)} | ${act || '—'} |\n` }
  row('1 · Valuation', t.opened, e?.ts, who(t.emp_id))
  row('2 · Estimation + negotiation', e?.ts, e?.upd, who(e?.neg) || who(e?.svc) || 'assayer / sales')
  row('3 · Quotation prep', e?.upd, q?.ts, who(t.emp_id) || 'branch / sales')
  row('4 · Quotation approval', q?.ts, q?.upd, who(q?.appr) || 'sales')
  if (isRel && r) {
    row('R · Release sales approval', r.ts, r.upd, `sales: ${r.sa || '—'} / head: ${r.sha || '—'}`)
    if (a) row('R · Takeover agreement', a.ts, a.upd, a.signed ? 'signed' : 'unsigned')
  }
  if (ks.length) for (const k of ks) md += `| KYC · ${k.action} | ${hhmm(k.created_at)} | ${hhmm(k.created_at)} | — | ${who(k.emp_id) || k.emp_id} · ${k.employee_class} |\n`
  else md += `| KYC | — | — | — | (no KycLog) |\n`
  row('6 · Payment', kc || q?.upd, p?.ts, who(p?.emp) || who(p?.sales) || 'accounts / branch')
  if (o) row('7 · Order', p?.ts, o.ts, who(o.emp))
  row('8 · Completion', p?.ts, t.completed, 'system')
  md += `\n`
}

const out = resolve(__dir, `../docs/new-crm-case-timeline-${istDate}.md`)
writeFileSync(out, md)
console.log('WROTE', out)
console.log('Completed cohort:', cohort.length, '| WIP open today:', wip.length, '| carried-over backlog:', backlog)
console.log('Decomposed medians — valuation:', fmtm(med(agg.val)), 'est+neg:', fmtm(med(agg.estneg)), 'quo-prep:', fmtm(med(agg.quoprep)), 'quo-approval:', fmtm(med(agg.quoappr)), 'payment:', fmtm(med(agg.pay)), 'total:', fmtm(med(agg.total)))
