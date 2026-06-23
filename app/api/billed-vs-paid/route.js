// app/api/billed-vs-paid/route.js
//
// Billed vs Paid — case-wise reconciliation for the Accounts module.
//
//   GET /api/billed-vs-paid?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// For every approved purchase whose FINAL-PAYMENT day falls in [from, to] it
// answers three questions per case:
//   1. BILLED  — what the case shows as purchased (master purchases.amount).
//   2. PAID    — what actually left our bank: NEW-CRM FINAL_PAYMENT +
//                RELEASE_PAYMENT (takeover) − CREDITED reversals. If RazorpayX
//                creds are configured we also fetch the REAL payout amount/status
//                by UTR (the authoritative "money out").
//   3. ACCOUNT — did the FINAL_PAYMENT go to the penny-drop-verified account?
//
// Scope: both CRMs. OLD CRM has no clean paid-amount or payout account, so its
// rows carry billed + customer bank only (paid / account-match shown blank).
//
// RazorpayX is env-gated: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and
// RAZORPAYX_ACCOUNT_NUMBER to light up the live "bank-settled" column. Without
// them the module still works off the CRM-recorded payout.

import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import mysql from 'mysql2/promise'
import { requireAuthForPage } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
const addDays  = (yyyymmdd, n) => {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}
const norm = (s) => String(s || '').trim().replace(/-/g, '').toUpperCase()

// ── NEW CRM (Postgres): per-case paid rollup + accounts + UTRs ────────────────
async function newCrmPayments(from, to) {
  const client = new Client({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  })
  await client.connect()
  try {
    const { rows } = await client.query(`
      WITH pays AS (
        SELECT transaction_id,
          SUM(CASE WHEN type='FINAL_PAYMENT'   AND action='DEBITED'  THEN amount ELSE 0 END) fin,
          SUM(CASE WHEN type='RELEASE_PAYMENT' AND action='DEBITED'  THEN amount ELSE 0 END) rel,
          SUM(CASE WHEN type='FINAL_PAYMENT'   AND action='CREDITED' THEN amount ELSE 0 END) rev,
          array_remove(array_agg(DISTINCT CASE WHEN action='DEBITED' AND type IN ('FINAL_PAYMENT','RELEASE_PAYMENT') THEN utr END), NULL) utrs,
          string_agg(DISTINCT processor::text, ',') processors
        FROM "Payment" GROUP BY transaction_id
      ),
      fa AS (
        SELECT DISTINCT ON (transaction_id) transaction_id, account_number, ifsc_code, account_holder_name, bank_name
        FROM "Payment" WHERE type='FINAL_PAYMENT' AND action='DEBITED'
        ORDER BY transaction_id, created_at DESC
      ),
      pa AS (
        SELECT DISTINCT ON (transaction_id) transaction_id, account_number, ifsc_code
        FROM "Payment" WHERE type='PENNY_DROP' AND account_number IS NOT NULL AND account_number <> ''
        ORDER BY transaction_id, created_at DESC
      ),
      fp AS (
        SELECT DISTINCT ON (transaction_id) transaction_id,
               (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date d
        FROM "Payment" WHERE type='FINAL_PAYMENT' AND action='DEBITED'
        ORDER BY transaction_id, created_at DESC
      )
      SELECT t.code, p.fin, p.rel, p.rev, (p.fin + p.rel - p.rev) AS paid_crm,
             p.utrs, p.processors,
             fa.account_number fin_acct, fa.ifsc_code fin_ifsc, fa.account_holder_name fin_holder, fa.bank_name fin_bank,
             pa.account_number pen_acct, pa.ifsc_code pen_ifsc,
             fp.d AS pay_date
      FROM "Transaction" t
      JOIN pays p ON p.transaction_id = t.id
      JOIN fp    ON fp.transaction_id = t.id
      LEFT JOIN fa ON fa.transaction_id = t.id
      LEFT JOIN pa ON pa.transaction_id = t.id
      WHERE fp.d BETWEEN $1 AND $2
    `, [from, to])
    const map = {}
    for (const r of rows) {
      map[norm(r.code)] = {
        paidCrm:   Number(r.paid_crm) || 0,
        fin:       Number(r.fin) || 0,
        rel:       Number(r.rel) || 0,
        rev:       Number(r.rev) || 0,
        utrs:      (r.utrs || []).filter(Boolean),
        processor: r.processors || '',
        finAcct:   r.fin_acct || '', finIfsc: r.fin_ifsc || '', finHolder: r.fin_holder || '', finBank: r.fin_bank || '',
        penAcct:   r.pen_acct || '', penIfsc: r.pen_ifsc || '',
        payDate:   r.pay_date ? new Date(r.pay_date).toISOString().slice(0, 10) : null,
      }
    }
    return map
  } finally { await client.end() }
}

// ── OLD CRM (MySQL): customer bank only (no clean paid amount) ────────────────
async function oldCrmBank(from, to) {
  const conn = await mysql.createConnection({
    host: process.env.CRM_DB_HOST, port: parseInt(process.env.CRM_DB_PORT || '3306'),
    database: process.env.CRM_DB_NAME, user: process.env.CRM_DB_USER, password: process.env.CRM_DB_PASSWORD,
    connectTimeout: 20000,
  })
  try {
    const [txns] = await conn.query(
      `SELECT t.id, t.bill_no, t.pmt_bank_name, t.pmt_refno
         FROM transac_tbl t
        WHERE t.trxn_status='approved' AND DATE(t.date + INTERVAL 330 MINUTE) BETWEEN ? AND ?`, [from, to])
    const map = {}
    if (!txns.length) return map
    const ids = txns.map(t => String(t.id))
    const [bnk] = await conn.query(
      `SELECT trnxnn_id, accn_num, bank_ifsc FROM cust_bnkdet WHERE trnxnn_id IN (${ids.map(() => '?').join(',')})`, ids)
    const B = {}; bnk.forEach(r => { if (!B[String(r.trnxnn_id)]) B[String(r.trnxnn_id)] = r })
    for (const t of txns) {
      const bd = B[String(t.id)] || {}
      map[norm(t.bill_no)] = { processor: t.pmt_bank_name || '', payRef: t.pmt_refno || '', acctNo: bd.accn_num || '', ifsc: bd.bank_ifsc || '' }
    }
    return map
  } finally { await conn.end() }
}

// ── RazorpayX Payouts (env-gated): real money-out keyed by UTR ────────────────
async function razorpayPayoutsByUtr(from, to) {
  const keyId   = process.env.RAZORPAY_KEY_ID
  const secret  = process.env.RAZORPAY_KEY_SECRET
  const acct    = process.env.RAZORPAYX_ACCOUNT_NUMBER
  if (!keyId || !secret || !acct) return { linked: false, byUtr: {} }

  const auth = 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64')
  // Epoch window, padded ±3 days so payouts created just outside the
  // final-payment day still match (payout vs CRM-stamp timing skew).
  const fromEpoch = Math.floor(new Date(`${addDays(from, -3)}T00:00:00+05:30`).getTime() / 1000)
  const toEpoch   = Math.floor(new Date(`${addDays(to, 3)}T23:59:59+05:30`).getTime() / 1000)

  const byUtr = {}
  try {
    let skip = 0
    for (let page = 0; page < 200; page++) {   // hard cap: 200×100 = 20k payouts
      const url = `https://api.razorpay.com/v1/payouts?account_number=${encodeURIComponent(acct)}&count=100&skip=${skip}&from=${fromEpoch}&to=${toEpoch}`
      const res = await fetch(url, { headers: { Authorization: auth } })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        return { linked: true, byUtr, error: `Razorpay ${res.status}: ${txt.slice(0, 200)}` }
      }
      const j = await res.json()
      const items = Array.isArray(j.items) ? j.items : []
      for (const p of items) {
        if (!p.utr) continue
        // amount is in paise. Keep the latest/processed view per UTR.
        byUtr[String(p.utr).trim()] = { amount: Number(p.amount || 0) / 100, status: p.status || '', payout_id: p.id || '' }
      }
      if (items.length < 100) break
      skip += 100
    }
    return { linked: true, byUtr }
  } catch (e) {
    return { linked: true, byUtr, error: e.message }
  }
}

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'billed-vs-paid')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const to   = searchParams.get('to')   || istToday()
  const from = searchParams.get('from') || addDays(to, -7)

  // Branch → region map (region isn't a column on purchases).
  const regionByBranch = {}
  {
    const { data: brs } = await supabase.from('branches').select('name, region')
    for (const b of brs || []) regionByBranch[b.name] = b.region
  }

  // 1) Master billed — approved purchases whose purchase_date (== final-payment
  //    day) is in range. `final_amount_crm` is what the case shows as purchased.
  //    Paginated to clear Supabase's 1000-row cap.
  const master = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('purchases')
      .select('application_id, customer_name, branch_name, crm_source, purchase_date, final_amount_crm, gross_weight, transaction_type')
      .gte('purchase_date', from).lte('purchase_date', to)
      .eq('is_deleted', false).eq('crm_status', 'approved')
      .order('purchase_date', { ascending: false })
      .range(offset, offset + 999)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    master.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  // 2) Payment enrichment from both CRMs + 3) RazorpayX (gated). Each source is
  //    isolated so one outage can't blank the whole report.
  const [newMap, oldMap, rzp] = await Promise.all([
    newCrmPayments(from, to).catch(e => ({ __err: e.message })),
    oldCrmBank(from, to).catch(e => ({ __err: e.message })),
    razorpayPayoutsByUtr(from, to).catch(e => ({ linked: false, byUtr: {}, error: e.message })),
  ])
  const newErr = newMap.__err || null
  const oldErr = oldMap.__err || null

  const rows = []
  for (const p of master) {
    const key   = norm(p.application_id)
    const isNew = (p.crm_source || '').includes('new')
    const billed = Number(p.final_amount_crm) || 0
    const np = !newMap.__err ? newMap[key] : null
    const op = !oldMap.__err ? oldMap[key] : null

    let paidCrm = null, paidBank = null, payoutStatus = null, processor = '', utr = '',
        finAcct = '', finIfsc = '', penAcct = '', penIfsc = '', acctMatch = null

    if (isNew && np) {
      paidCrm   = np.paidCrm
      processor = np.processor
      utr       = (np.utrs[0] || '')
      finAcct   = np.finAcct; finIfsc = np.finIfsc
      penAcct   = np.penAcct; penIfsc = np.penIfsc
      // account-match: final-payment a/c vs penny-drop a/c (number + IFSC)
      if (finAcct && penAcct) {
        acctMatch = (norm(finAcct) === norm(penAcct)) && (norm(finIfsc) === norm(penIfsc))
      }
      // RazorpayX real money-out: sum payouts across this case's UTRs
      if (rzp.linked && Object.keys(rzp.byUtr).length) {
        let sum = 0, statuses = [], hit = false
        for (const u of np.utrs) {
          const po = rzp.byUtr[String(u).trim()]
          if (po) { sum += po.amount; statuses.push(po.status); hit = true }
        }
        if (hit) { paidBank = sum; payoutStatus = [...new Set(statuses)].join(',') }
      }
    } else if (!isNew && op) {
      processor = op.processor
      utr       = op.payRef
      penAcct   = op.acctNo; penIfsc = op.ifsc   // old CRM: only the customer bank is known
    }

    const paid = paidBank != null ? paidBank : paidCrm
    rows.push({
      app_id: p.application_id, customer: p.customer_name, branch: p.branch_name,
      region: regionByBranch[p.branch_name] || '', crm: isNew ? 'new' : 'old', purchase_date: p.purchase_date,
      txn_type: p.transaction_type, gross_weight: Number(p.gross_weight) || 0,
      billed,
      paid_crm: paidCrm, paid_bank: paidBank, payout_status: payoutStatus,
      paid,
      diff: paid != null ? Number((billed - paid).toFixed(2)) : null,
      processor, utr, fin_acct: finAcct, fin_ifsc: finIfsc, pen_acct: penAcct, pen_ifsc: penIfsc,
      acct_match: acctMatch,
    })
  }

  rows.sort((a, b) => (b.purchase_date || '').localeCompare(a.purchase_date || ''))

  // Mismatch threshold: ignore sub-₹1 rounding (payout amounts are float).
  const AMT_EPS = 1
  const summary = {
    cases:            rows.length,
    total_billed:     rows.reduce((s, r) => s + r.billed, 0),
    total_paid_crm:   rows.reduce((s, r) => s + (r.paid_crm || 0), 0),
    total_paid_bank:  rows.reduce((s, r) => s + (r.paid_bank || 0), 0),
    amount_mismatch:  rows.filter(r => r.paid != null && Math.abs(r.diff) > AMT_EPS).length,
    unpaid:           rows.filter(r => r.paid == null || r.paid === 0).length,
    account_mismatch: rows.filter(r => r.acct_match === false).length,
  }

  return Response.json({
    from, to, rows, summary,
    razorpay_linked: !!rzp.linked,
    warnings: [newErr && `New CRM: ${newErr}`, oldErr && `Old CRM: ${oldErr}`, rzp.error && `Razorpay: ${rzp.error}`].filter(Boolean),
  })
}
