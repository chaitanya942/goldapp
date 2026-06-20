// Purchase Register — unified daily-bills export in the legacy 25-column report.
//
// Weights/amounts/customer/branch come from the MASTER purchase data (Supabase
// `purchases`) — the single reconciled source of truth (matches Purchase
// Reports exactly, and correctly handles takeover/released-gold net weight,
// which the raw old-CRM ornament rows understate). Bank/payment details and the
// takeover amount (not stored in `purchases`) are enriched from the source CRMs
// — old CRM (MySQL: transac_tbl + cust_bnkdet) keyed by bill_no, new CRM
// (Postgres: Payment + Quotation) keyed by code.
//   GET /api/purchase-register?from=YYYY-MM-DD&to=YYYY-MM-DD   (IST dates)
import mysql from 'mysql2/promise'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { aliasBranchName } from '../../../lib/crmBranchAlias'

const { Client } = pg
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const COLUMNS = [
  'SL','Date','Cust Name','Mobile Number','Branch','Grs Wt','Stone','Wastage',
  'Net Weight','Purity','Gross Amount','Service Charge percentage','Service Charge Amount',
  'Takover Amount','Balance Amount','Final Amount','Transaction Type','Application No.',
  'Bank Name','Payment Ref No','Customer Bank Name','Account Holder Name','Bank Branch',
  'Customer Account number','Customer Bank IFSC Code','Status',
]

const n2 = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n.toFixed(2) : '' }
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const ddmmyyyy = (ymd) => { const [y,m,d] = String(ymd).split('-'); return d ? `${d}-${m}-${y}` : (ymd || '') }

// ── Bank/payment enrichment from OLD CRM (MySQL), keyed by WGKA<bill_no> ──────
async function oldCrmBankMap(from, to) {
  const conn = await mysql.createConnection({
    host: process.env.CRM_DB_HOST, port: parseInt(process.env.CRM_DB_PORT || '3306'),
    database: process.env.CRM_DB_NAME, user: process.env.CRM_DB_USER, password: process.env.CRM_DB_PASSWORD,
    connectTimeout: 20000,
  })
  try {
    const [txns] = await conn.query(
      `SELECT t.id, t.bill_no, t.tkvr_amnt, t.pmt_bank_name, t.pmt_refno
         FROM transac_tbl t
        WHERE t.trxn_status='approved' AND DATE(t.date + INTERVAL 330 MINUTE) BETWEEN ? AND ?`, [from, to])
    const map = {}
    if (!txns.length) return map
    const ids = txns.map(t => String(t.id))
    const ph = ids.map(() => '?').join(',')
    const [bnk] = await conn.query(
      `SELECT trnxnn_id, cust_name, accn_num, bank_nme, bank_ifsc, bank_brnch
         FROM cust_bnkdet WHERE trnxnn_id IN (${ph})`, ids)
    const B = {}; bnk.forEach(r => { if (!B[String(r.trnxnn_id)]) B[String(r.trnxnn_id)] = r })
    for (const t of txns) {
      const bd = B[String(t.id)] || {}
      const raw = String(t.bill_no || '').trim().replace(/-/g, '').toUpperCase()
      const appId = raw.startsWith('WGKA') ? raw : `WGKA${raw}`
      map[appId] = {
        takeover: parseFloat(t.tkvr_amnt) || 0,
        bankName: t.pmt_bank_name || '',
        payRef: t.pmt_refno || '',
        custBank: bd.bank_nme || '',
        acctHolder: bd.cust_name || '',
        bankBranch: bd.bank_brnch || '',
        acctNo: bd.accn_num || '',
        ifsc: bd.bank_ifsc || '',
      }
    }
    return map
  } finally { await conn.end() }
}

// ── Bank/payment enrichment from NEW CRM (Postgres), keyed by WGKA<code> ──────
async function newCrmBankMap(from, to) {
  const client = new Client({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  })
  await client.connect()
  try {
    const { rows } = await client.query(`
      WITH fp AS (
        -- The actual customer payout: latest FINAL_PAYMENT debit per txn. Bank
        -- details (UTR / customer bank / account / IFSC) live on this row.
        SELECT DISTINCT ON (transaction_id) transaction_id, utr, processor, bank_name,
               account_holder_name, account_number, ifsc_code,
               (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS pay_date
        FROM "Payment" WHERE action='DEBITED' AND type='FINAL_PAYMENT'
        ORDER BY transaction_id, created_at DESC
      ),
      quo AS (
        SELECT DISTINCT ON (transaction_id) transaction_id, COALESCE(release_amount,0) takeover
        FROM "Quotation" ORDER BY transaction_id, created_at DESC
      )
      -- Date by the FINAL-PAYMENT day (== purchase_date in the master), not
      -- created_at — so re-walk-ins (walked in earlier, paid in range) match.
      SELECT t.code, COALESCE(quo.takeover,0) takeover,
             fp.utr, fp.processor, fp.bank_name, fp.account_holder_name, fp.account_number, fp.ifsc_code
      FROM "Transaction" t
      JOIN fp ON fp.transaction_id=t.id
      LEFT JOIN quo ON quo.transaction_id=t.id
      WHERE fp.pay_date BETWEEN $1 AND $2
    `, [from, to])
    const map = {}
    for (const r of rows) {
      // Key hyphen-insensitively (WGKA-57225 → WGKA57225) so the lookup matches
      // regardless of the stored hyphen form.
      const appId = String(r.code || '').trim().replace(/-/g, '').toUpperCase()
      map[appId] = {
        takeover: parseFloat(r.takeover) || 0,
        bankName: r.processor || '',
        payRef: r.utr || '',
        custBank: r.bank_name || '',
        acctHolder: r.account_holder_name || '',
        bankBranch: '',                 // not stored in new CRM
        acctNo: r.account_number || '',
        ifsc: r.ifsc_code || '',
      }
    }
    return map
  } finally { await client.end() }
}

// ── Master rows from Supabase (the reconciled weights/amounts) ───────────────
async function masterRows(from, to) {
  const cols = 'application_id, crm_source, crm_status, purchase_date, transaction_time, customer_name, phone_number, branch_name, transaction_type, gross_weight, stone_weight, wastage, net_weight, purity, total_amount, final_amount_crm, service_charge_pct, service_charge_amount_crm'
  const out = []
  const CHUNK = 1000
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await supabase.from('purchases').select(cols)
      .gte('purchase_date', from).lte('purchase_date', to)
      .eq('crm_status', 'approved').eq('is_deleted', false)
      .order('purchase_date').order('transaction_time')
      .range(offset, offset + CHUNK - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < CHUNK) break
  }
  return out
}

// ── New-CRM bills at FINAL_PAYMENT_PENDING ("payment done, final not made") ──
// These aren't completed (so not in the approved master set) — pulled straight
// from the new CRM. Returns ready-made cell objects (minus SL).
async function fetchFppNewCrm(from, to) {
  const client = new Client({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  })
  await client.connect()
  try {
    const { rows } = await client.query(`
      WITH orn_dedup AS (
        SELECT DISTINCT ON (q.transaction_id, COALESCE(o.ornament_id, o.id::text))
               q.transaction_id, o.gross_weight, o.stone_weight, o.wastage, o.net_weight, o.purity, o.amount
        FROM "Quotation" q JOIN "Ornament" o ON o.quotation_id=q.id
        ORDER BY q.transaction_id, COALESCE(o.ornament_id, o.id::text), o.approve DESC NULLS LAST, o.created_at DESC
      ),
      orn AS (
        SELECT transaction_id,
               COALESCE(SUM(gross_weight),0) grs, COALESCE(SUM(stone_weight),0) stone,
               COALESCE(SUM(wastage),0) wastage, COALESCE(SUM(net_weight),0) net,
               CASE WHEN COALESCE(SUM(net_weight),0)>0 THEN SUM(net_weight*purity)/SUM(net_weight) ELSE 0 END purity,
               COALESCE(SUM(amount),0) gross_amount
        FROM orn_dedup GROUP BY transaction_id
      ),
      quo AS (SELECT DISTINCT ON (transaction_id) transaction_id, service_charge, service_charge_amount, final_amount, COALESCE(release_amount,0) takeover FROM "Quotation" ORDER BY transaction_id, created_at DESC),
      pay AS (SELECT DISTINCT ON (transaction_id) transaction_id, utr, processor, bank_name, account_holder_name, account_number, ifsc_code FROM "Payment" WHERE action='DEBITED' ORDER BY transaction_id, created_at DESC)
      SELECT t.code, t.created_at, t.transaction_type,
             trim(coalesce(NULLIF(btrim(w.first_name),''), cu.first_name, '')||' '||coalesce(NULLIF(btrim(w.last_name),''), cu.last_name, '')) cust, cu.mobile, b.name branch,
             orn.grs, orn.stone, orn.wastage, orn.net, orn.purity, orn.gross_amount,
             quo.service_charge, quo.service_charge_amount, quo.final_amount, quo.takeover,
             pay.utr, pay.processor, pay.bank_name, pay.account_holder_name, pay.account_number, pay.ifsc_code
      FROM "Transaction" t
      LEFT JOIN "Customer" cu ON cu.id=t.customer_id
      LEFT JOIN "Branch"   b  ON b.id=t.branch_id
      LEFT JOIN LATERAL (SELECT first_name, last_name FROM "Walkin" WHERE transaction_id=t.id ORDER BY created_at DESC LIMIT 1) w ON true
      LEFT JOIN orn ON orn.transaction_id=t.id
      LEFT JOIN quo ON quo.transaction_id=t.id
      LEFT JOIN pay ON pay.transaction_id=t.id
      WHERE t.status='FINAL_PAYMENT_PENDING'
        AND (t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2
    `, [from, to])
    const istDate = (u) => { const d = new Date(new Date(u).getTime() + 5.5 * 3600000); return `${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${d.getUTCFullYear()}` }
    return rows.map(r => {
      // Preserve the native hyphen for new-CRM app ids (WGKA-#### convention).
      const rawCode = String(r.code || '').trim().toUpperCase()
      const appId = rawCode.startsWith('WGKA') ? rawCode : `WGKA-${rawCode}`
      const final = parseFloat(r.final_amount) || 0
      const takeover = parseFloat(r.takeover) || 0
      return {
        _ts: new Date(r.created_at).getTime(),
        crm: 'new', completed: false,
        cell: {
          'Date': istDate(r.created_at),
          'Cust Name': r.cust || '', 'Mobile Number': r.mobile || '',
          'Branch': aliasBranchName((r.branch || '').trim()) || '',
          'Grs Wt': n2(r.grs), 'Stone': n2(r.stone), 'Wastage': n2(r.wastage), 'Net Weight': n2(r.net), 'Purity': n2(r.purity),
          'Gross Amount': n2(r.gross_amount),
          'Service Charge percentage': n2(r.service_charge),
          'Service Charge Amount': n2(r.service_charge_amount),
          'Takover Amount': n2(takeover),
          'Balance Amount': n2(final - takeover),
          'Final Amount': n2(final),
          'Transaction Type': String(r.transaction_type || '').toUpperCase().includes('RELEASED') ? 'TAKEOVER' : 'PHYSICAL',
          'Application No.': appId,
          'Bank Name': r.processor || '', 'Payment Ref No': r.utr || '',
          'Customer Bank Name': r.bank_name || '', 'Account Holder Name': r.account_holder_name || '',
          'Bank Branch': '', 'Customer Account number': r.account_number ? `="${r.account_number}"` : '',
          'Customer Bank IFSC Code': r.ifsc_code || '',
          'Status': 'Payment Pending',
        },
      }
    })
  } finally { await client.end() }
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
  const from = searchParams.get('from') || today
  const to   = searchParams.get('to')   || from
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return Response.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
  }

  let rows
  try { rows = await masterRows(from, to) }
  catch (e) { return Response.json({ error: `master data: ${e.message}` }, { status: 500 }) }

  const [oldRes, newRes, fppRes] = await Promise.allSettled([
    oldCrmBankMap(from, to), newCrmBankMap(from, to), fetchFppNewCrm(from, to),
  ])
  const oldMap = oldRes.status === 'fulfilled' ? oldRes.value : {}
  const newMap = newRes.status === 'fulfilled' ? newRes.value : {}
  const fppRecords = fppRes.status === 'fulfilled' ? fppRes.value : []
  const errors = []
  if (oldRes.status === 'rejected') errors.push(`old CRM bank details unavailable: ${oldRes.reason?.message || oldRes.reason}`)
  if (newRes.status === 'rejected') errors.push(`new CRM bank details unavailable: ${newRes.reason?.message || newRes.reason}`)
  if (fppRes.status === 'rejected') errors.push(`new CRM pending payments unavailable: ${fppRes.reason?.message || fppRes.reason}`)

  // Completed (approved) records from master data, enriched with bank details.
  const completedRecords = rows.map(r => {
    const isNew = r.crm_source === 'new_crm'
    // Both bank maps are keyed hyphen-insensitively (WGKA-57225 → WGKA57225),
    // so normalise the master application_id the same way before the lookup —
    // post-hyphen-migration the master stores WGKA-#### for new CRM.
    const bankKey = String(r.application_id || '').trim().replace(/-/g, '').toUpperCase()
    const bank = (isNew ? newMap : oldMap)[bankKey] || {}
    const final = parseFloat(r.final_amount_crm) || 0
    const takeover = parseFloat(bank.takeover) || 0
    return {
      _ts: Date.parse(`${r.purchase_date}T${r.transaction_time || '00:00:00'}+05:30`) || 0,
      crm: isNew ? 'new' : 'old', completed: true,
      cell: {
        'Date': ddmmyyyy(r.purchase_date),
        'Cust Name': r.customer_name || '', 'Mobile Number': r.phone_number || '',
        'Branch': r.branch_name || '',
        'Grs Wt': n2(r.gross_weight), 'Stone': n2(r.stone_weight), 'Wastage': n2(r.wastage),
        'Net Weight': n2(r.net_weight), 'Purity': n2(r.purity),
        'Gross Amount': n2(r.total_amount),
        'Service Charge percentage': n2(r.service_charge_pct),
        'Service Charge Amount': n2(r.service_charge_amount_crm),
        'Takover Amount': n2(takeover),
        'Balance Amount': n2(final - takeover),
        'Final Amount': n2(final),
        'Transaction Type': String(r.transaction_type || '').toUpperCase().includes('TAKEOVER') ? 'TAKEOVER' : 'PHYSICAL',
        'Application No.': r.application_id || '',
        'Bank Name': bank.bankName || '', 'Payment Ref No': bank.payRef || '',
        'Customer Bank Name': bank.custBank || '', 'Account Holder Name': bank.acctHolder || '',
        'Bank Branch': bank.bankBranch || '',
        'Customer Account number': bank.acctNo ? `="${bank.acctNo}"` : '',
        'Customer Bank IFSC Code': bank.ifsc || '',
        'Status': 'Completed',
      },
    }
  })

  const all = [...completedRecords, ...fppRecords].sort((a, b) => a._ts - b._ts)
  const lines = [COLUMNS.join(',')]
  all.forEach((rec, i) => {
    lines.push(COLUMNS.map(c => csvCell(c === 'SL' ? i + 1 : rec.cell[c])).join(','))
  })

  const completedCount = completedRecords.length
  const pendingCount   = fppRecords.length
  const newCount = all.filter(r => r.crm === 'new').length
  const oldCount = all.filter(r => r.crm === 'old').length

  return Response.json({
    from, to,
    total: all.length, oldCount, newCount, completedCount, pendingCount,
    errors: errors.length ? errors : null,
    csv: '﻿' + lines.join('\r\n'),
  })
}
