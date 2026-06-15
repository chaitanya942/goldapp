// Generate a detailed case-wise, stage-wise timeline report for today's
// completed new-CRM transactions. Reconstructed from artifact timestamps
// (the native Timer table is not populated for current cases).
//   node scripts/gen-crm-case-timeline.mjs
import pg from 'pg'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
  .split('\n').reduce((a, l) => {
    const e = l.indexOf('='); if (e > 0 && !l.startsWith('#')) a[l.slice(0, e).trim()] = l.slice(e + 1).trim().replace(/^["']|["']$/g, '')
    return a
  }, {})

const { Client } = pg
const IST  = ts => ts ? new Date(new Date(ts).getTime() + 5.5 * 3600000) : null
const hhmm = ts => { const d = IST(ts); return d ? `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}` : '—' }
const dur  = (a, b) => { if (!a || !b) return '—'; const m = (new Date(b) - new Date(a)) / 60000; if (m < 0) return '(reorder)'; return m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(1) + 'm' }
const med  = (arr) => { const a = arr.filter(x => x != null && x >= 0); if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const fmtm = (m) => m == null ? '—' : (m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(1) + 'm')
const mn   = (a, b) => (a && b) ? (new Date(b) - new Date(a)) / 60000 : null

const c = new Client({ host: env.NEW_CRM_DB_HOST, port: parseInt(env.NEW_CRM_DB_PORT || '5432'), database: env.NEW_CRM_DB_NAME, user: env.NEW_CRM_DB_USER, password: env.NEW_CRM_DB_PASSWORD, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 })
await c.connect()

const emp = (await c.query(`SELECT id, emp_id, trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) nm, role FROM "Employee"`)).rows
const byId = {}, byEmp = {}
emp.forEach(e => { byId[e.id] = e; if (e.emp_id) byEmp[e.emp_id] = e })
const who = x => { if (!x) return null; const e = byId[x] || byEmp[x]; return e ? `${e.nm || '?'} (${e.role || '?'})` : `${x}` }

const cohort = (await c.query(`
  SELECT t.id, t.code, t.created_at opened, t.updated_at completed, t.emp_id,
         t.transaction_type, b.name branch,
         trim(coalesce(cu.first_name,'')||' '||coalesce(cu.last_name,'')) customer
  FROM "Transaction" t
  LEFT JOIN "Branch" b ON b.id = t.branch_id
  LEFT JOIN "Customer" cu ON cu.id = t.customer_id
  WHERE t.status = 'FINAL_PAYMENT_COMPLETED'
    AND (t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ORDER BY t.created_at`)).rows

const ids = cohort.map(r => r.id)
const inlist = ids.map((_, i) => `$${i + 1}`).join(',')

const est = (await c.query(`SELECT transaction_id, min(created_at) ts FROM "Estimation" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const quo = (await c.query(`SELECT transaction_id, min(created_at) ts, (array_agg(quotation_approved_id) FILTER (WHERE quotation_approved_id IS NOT NULL))[1] appr FROM "Quotation" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const pay = (await c.query(`SELECT transaction_id, min(created_at) ts, (array_agg(employee_id))[1] emp, (array_agg(sales_emp_id))[1] sales FROM "Payment" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const ord = (await c.query(`SELECT transaction_id, min(created_at) ts, (array_agg(emp_id))[1] emp FROM "Order" WHERE transaction_id IN (${inlist}) GROUP BY 1`, ids)).rows
const klog = (await c.query(`SELECT k.transaction_id, l.emp_id, l.employee_class, l.action, l.created_at FROM "KycLog" l JOIN "Kyc" k ON k.id = l.kyc_id WHERE k.transaction_id IN (${inlist}) ORDER BY l.created_at`, ids)).rows
await c.end()

const idx = arr => { const m = {}; arr.forEach(r => m[r.transaction_id] = r); return m }
const E = idx(est), Q = idx(quo), P = idx(pay), O = idx(ord)
const K = {}; klog.forEach(r => { (K[r.transaction_id] = K[r.transaction_id] || []).push(r) })

const nowIst = IST(new Date().toISOString())
const istDate = `${nowIst.getUTCFullYear()}-${String(nowIst.getUTCMonth() + 1).padStart(2, '0')}-${String(nowIst.getUTCDate()).padStart(2, '0')}`

let md = `# New CRM — Case-wise Stage Timeline (Completed cases, ${istDate} IST)\n\n`
md += `Reconstructed from stage-artifact timestamps (Transaction / Estimation / Quotation / Kyc+KycLog / Payment / Order). All times **IST**. The native \`Timer\` table is not populated for current cases, so this is rebuilt from each artifact's \`created_at\` and actor fields. "(reorder)" means that stage's artifact was timestamped before the previous milestone (stages can overlap/run out of strict order in the CRM).\n\n`
md += `**Cohort:** ${cohort.length} transactions with status FINAL_PAYMENT_COMPLETED created today.\n\n`

const agg = { open_est: [], est_quo: [], quo_km: [], km_kc: [], kc_pay: [], pay_done: [], total: [] }
const built = []
for (const t of cohort) {
  const e = E[t.id], q = Q[t.id], p = P[t.id]
  const ks = K[t.id] || []
  const km = ks.filter(x => x.employee_class === 'KYC_MAKER')[0]?.created_at || null
  const kc = ks.filter(x => x.employee_class === 'KYC_CHECKER').slice(-1)[0]?.created_at || null
  agg.open_est.push(mn(t.opened, e?.ts)); agg.est_quo.push(mn(e?.ts, q?.ts)); agg.quo_km.push(mn(q?.ts, km))
  agg.km_kc.push(mn(km, kc)); agg.kc_pay.push(mn(kc, p?.ts)); agg.pay_done.push(mn(p?.ts, t.completed)); agg.total.push(mn(t.opened, t.completed))
  built.push({ t, e, q, p, km, kc, ks })
}

md += `## Overall medians (today)\n\n| Stage | n | median |\n|---|---|---|\n`
const aggRow = (lbl, arr) => `| ${lbl} | ${arr.filter(x => x != null && x >= 0).length} | ${fmtm(med(arr))} |\n`
md += aggRow('Open → Estimation', agg.open_est)
md += aggRow('Estimation → Quotation', agg.est_quo)
md += aggRow('Quotation → KYC maker', agg.quo_km)
md += aggRow('KYC maker → checker', agg.km_kc)
md += aggRow('KYC checker → Payment', agg.kc_pay)
md += aggRow('Payment → Completed', agg.pay_done)
md += `| **TOTAL Open → Completed** | ${agg.total.filter(x => x != null && x >= 0).length} | **${fmtm(med(agg.total))}** |\n\n---\n\n`

md += `## Case-by-case detail\n\n`
let n = 0
for (const { t, e, q, p, km, kc, ks } of built) {
  n++
  md += `### ${n}. ${t.code} · ${t.customer || '—'} · ${t.branch || '—'} · ${t.transaction_type || ''}\n`
  md += `Opened **${hhmm(t.opened)}** → Completed **${hhmm(t.completed)}** · total **${dur(t.opened, t.completed)}** · opened by ${who(t.emp_id) || '—'}\n\n`
  md += `| Stage | Start | End | Duration | Handled by (role) |\n|---|---|---|---|---|\n`
  const row = (stage, a, b, actor) => { md += `| ${stage} | ${hhmm(a)} | ${hhmm(b)} | ${dur(a, b)} | ${actor || '—'} |\n` }
  row('Estimation / valuation', t.opened, e?.ts, who(t.emp_id))
  row('Quotation approval', e?.ts, q?.ts, who(q?.appr) || 'valuation / sales')
  if (ks.length) for (const k of ks) md += `| KYC · ${k.action} | ${hhmm(k.created_at)} | ${hhmm(k.created_at)} | — | ${who(k.emp_id) || k.emp_id} · ${k.employee_class} |\n`
  else md += `| KYC | — | — | — | (no KycLog) |\n`
  row('Payment', kc || q?.ts, p?.ts, who(p?.emp) || who(p?.sales) || 'accounts / branch')
  if (O[t.id]) row('Order', p?.ts, O[t.id].ts, who(O[t.id].emp))
  row('Completion', p?.ts, t.completed, 'system')
  md += `\n`
}

const out = resolve(__dir, `../docs/new-crm-case-timeline-${istDate}.md`)
writeFileSync(out, md)
console.log('WROTE', out)
console.log('Cohort:', cohort.length, '| KycLog events:', klog.length, '| total median:', fmtm(med(agg.total)))
