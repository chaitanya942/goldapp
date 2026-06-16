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
  'Customer Account number','Customer Bank IFSC Code',
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
      const appId = String(t.bill_no || '').toUpperCase().startsWith('WGKA') ? String(t.bill_no).toUpperCase() : `WGKA${t.bill_no}`
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
      WITH pay AS (
        SELECT DISTINCT ON (transaction_id) transaction_id, utr, processor, bank_name,
               account_holder_name, account_number, ifsc_code
        FROM "Payment" WHERE action='DEBITED' ORDER BY transaction_id, created_at DESC
      ),
      quo AS (
        SELECT DISTINCT ON (transaction_id) transaction_id, COALESCE(release_amount,0) takeover
        FROM "Quotation" ORDER BY transaction_id, created_at DESC
      )
      SELECT t.code, COALESCE(quo.takeover,0) takeover,
             pay.utr, pay.processor, pay.bank_name, pay.account_holder_name, pay.account_number, pay.ifsc_code
      FROM "Transaction" t
      LEFT JOIN pay ON pay.transaction_id=t.id
      LEFT JOIN quo ON quo.transaction_id=t.id
      WHERE t.status='FINAL_PAYMENT_COMPLETED'
        AND (t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2
    `, [from, to])
    const map = {}
    for (const r of rows) {
      const code = String(r.code || '').trim().replace(/-/g, '').toUpperCase()
      const appId = code.startsWith('WGKA') ? code : `WGKA${code}`
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

  const [oldRes, newRes] = await Promise.allSettled([oldCrmBankMap(from, to), newCrmBankMap(from, to)])
  const oldMap = oldRes.status === 'fulfilled' ? oldRes.value : {}
  const newMap = newRes.status === 'fulfilled' ? newRes.value : {}
  const errors = []
  if (oldRes.status === 'rejected') errors.push(`old CRM bank details unavailable: ${oldRes.reason?.message || oldRes.reason}`)
  if (newRes.status === 'rejected') errors.push(`new CRM bank details unavailable: ${newRes.reason?.message || newRes.reason}`)

  let oldCount = 0, newCount = 0
  const lines = [COLUMNS.join(',')]
  rows.forEach((r, i) => {
    const isNew = r.crm_source === 'new_crm'
    isNew ? newCount++ : oldCount++
    const bank = (isNew ? newMap : oldMap)[r.application_id] || {}
    const final = parseFloat(r.final_amount_crm) || 0
    const takeover = parseFloat(bank.takeover) || 0
    const cell = {
      'SL': i + 1,
      'Date': ddmmyyyy(r.purchase_date),
      'Cust Name': r.customer_name || '',
      'Mobile Number': r.phone_number || '',
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
      'Bank Name': bank.bankName || '',
      'Payment Ref No': bank.payRef || '',
      'Customer Bank Name': bank.custBank || '',
      'Account Holder Name': bank.acctHolder || '',
      'Bank Branch': bank.bankBranch || '',
      'Customer Account number': bank.acctNo ? `="${bank.acctNo}"` : '',
      'Customer Bank IFSC Code': bank.ifsc || '',
    }
    lines.push(COLUMNS.map(c => csvCell(cell[c])).join(','))
  })

  return Response.json({
    from, to,
    total: rows.length, oldCount, newCount,
    errors: errors.length ? errors : null,
    csv: '﻿' + lines.join('\r\n'),
  })
}
