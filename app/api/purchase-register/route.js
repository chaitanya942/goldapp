// Purchase Register — unified daily-bills export across BOTH CRMs.
// Old CRM (MySQL) approved bills + New CRM (Postgres) completed bills, merged
// into the legacy 25-column report. Returns { csv, total, oldCount, newCount }.
//   GET /api/purchase-register?from=YYYY-MM-DD&to=YYYY-MM-DD   (IST dates)
import mysql from 'mysql2/promise'
import pg from 'pg'
import { requireAuth } from '../../../lib/apiAuth'
import { aliasBranchName } from '../../../lib/crmBranchAlias'

const { Client } = pg

const COLUMNS = [
  'SL','Date','Cust Name','Mobile Number','Branch','Grs Wt','Stone','Wastage',
  'Net Weight','Purity','Gross Amount','Service Charge percentage','Service Charge Amount',
  'Takover Amount','Balance Amount','Final Amount','Transaction Type','Application No.',
  'Bank Name','Payment Ref No','Customer Bank Name','Account Holder Name','Bank Branch',
  'Customer Account number','Customer Bank IFSC Code',
]

const n2 = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n.toFixed(2) : '' }
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${d.getUTCFullYear()}`
const istFromUtc = (ts) => ts ? ddmmyyyy(new Date(new Date(ts).getTime() + 5.5 * 3600000)) : ''

// ── Old CRM (MySQL) ──────────────────────────────────────────────────────────
async function fetchOldCrm(from, to) {
  const conn = await mysql.createConnection({
    host: process.env.CRM_DB_HOST, port: parseInt(process.env.CRM_DB_PORT || '3306'),
    database: process.env.CRM_DB_NAME, user: process.env.CRM_DB_USER, password: process.env.CRM_DB_PASSWORD,
    connectTimeout: 20000,
  })
  try {
    const [txns] = await conn.query(
      `SELECT t.id, t.bill_no, t.date, t.cust_name, t.cust_mobile, t.type_gold,
              t.tkvr_amnt, t.serv_chr, t.finl_amnt, t.blnc_amnt, t.pmt_bank_name, t.pmt_refno,
              b.brnch_name AS branch
         FROM transac_tbl t
         LEFT JOIN branch_tbl b ON b.brnch_id = t.branch_id
        WHERE t.trxn_status = 'approved'
          AND DATE(t.date + INTERVAL 330 MINUTE) BETWEEN ? AND ?
        ORDER BY t.date, t.id`, [from, to])
    if (!txns.length) return []
    const ids = txns.map(t => String(t.id))
    const ph = ids.map(() => '?').join(',')
    const [orn] = await conn.query(
      `SELECT trnxnn_id,
              SUM(grms_wet) grs, SUM(stnt_wet) stone, SUM(wastag_wet) wastage, SUM(net_wet) net,
              CASE WHEN SUM(net_wet) > 0 THEN SUM(net_wet * purity) / SUM(net_wet) ELSE 0 END purity,
              SUM(grs_amnt) grs_amnt
         FROM ornments_tbl WHERE trnxnn_id IN (${ph}) GROUP BY trnxnn_id`, ids)
    const [bnk] = await conn.query(
      `SELECT trnxnn_id, cust_name, accn_num, bank_nme, bank_ifsc, bank_brnch
         FROM cust_bnkdet WHERE trnxnn_id IN (${ph})`, ids)
    const O = {}; orn.forEach(r => O[String(r.trnxnn_id)] = r)
    const B = {}; bnk.forEach(r => { if (!B[String(r.trnxnn_id)]) B[String(r.trnxnn_id)] = r })
    return txns.map(t => {
      const o = O[String(t.id)] || {}, bd = B[String(t.id)] || {}
      const gross = parseFloat(o.grs_amnt) || 0
      const svcPct = parseFloat(t.serv_chr) || 0
      const final = parseFloat(t.finl_amnt) || 0
      const takeover = parseFloat(t.tkvr_amnt) || 0
      return {
        _ts: new Date(t.date).getTime(),
        Date: istFromUtc(t.date),
        'Cust Name': t.cust_name || '',
        'Mobile Number': t.cust_mobile || '',
        Branch: t.branch || '',
        'Grs Wt': n2(o.grs), Stone: n2(o.stone), Wastage: n2(o.wastage), 'Net Weight': n2(o.net), Purity: n2(o.purity),
        'Gross Amount': n2(gross),
        'Service Charge percentage': n2(svcPct),
        'Service Charge Amount': n2(gross * svcPct / 100),
        'Takover Amount': n2(takeover),
        'Balance Amount': n2(final - takeover),
        'Final Amount': n2(final),
        'Transaction Type': String(t.type_gold || '').toLowerCase().includes('release') ? 'TAKEOVER' : 'PHYSICAL',
        'Application No.': t.bill_no ? (String(t.bill_no).toUpperCase().startsWith('WGKA') ? String(t.bill_no).toUpperCase() : `WGKA${t.bill_no}`) : '',
        'Bank Name': t.pmt_bank_name || '',
        'Payment Ref No': t.pmt_refno || '',
        'Customer Bank Name': bd.bank_nme || '',
        'Account Holder Name': bd.cust_name || '',
        'Bank Branch': bd.bank_brnch || '',
        'Customer Account number': bd.accn_num || '',
        'Customer Bank IFSC Code': bd.bank_ifsc || '',
      }
    })
  } finally { await conn.end() }
}

// ── New CRM (Postgres) ───────────────────────────────────────────────────────
async function fetchNewCrm(from, to) {
  const client = new Client({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  })
  await client.connect()
  try {
    const { rows } = await client.query(`
      WITH orn AS (
        SELECT q.transaction_id,
               COALESCE(SUM(o.gross_weight),0) grs, COALESCE(SUM(o.stone_weight),0) stone,
               COALESCE(SUM(o.wastage),0) wastage, COALESCE(SUM(o.net_weight),0) net,
               CASE WHEN COALESCE(SUM(o.net_weight),0)>0 THEN SUM(o.net_weight*o.purity)/SUM(o.net_weight) ELSE 0 END purity,
               COALESCE(SUM(o.amount),0) gross_amount
        FROM "Quotation" q LEFT JOIN "Ornament" o ON o.quotation_id=q.id GROUP BY q.transaction_id
      ),
      pay AS (
        SELECT DISTINCT ON (transaction_id) transaction_id, utr, processor, bank_name,
               account_holder_name, account_number, ifsc_code
        FROM "Payment" WHERE action='DEBITED' ORDER BY transaction_id, created_at DESC
      )
      SELECT t.code, t.created_at, t.transaction_type,
             trim(coalesce(cu.first_name,'')||' '||coalesce(cu.last_name,'')) cust, cu.mobile,
             b.name branch,
             orn.grs, orn.stone, orn.wastage, orn.net, orn.purity, orn.gross_amount,
             q.service_charge, q.service_charge_amount, q.final_amount, COALESCE(q.release_amount,0) takeover,
             pay.utr, pay.processor, pay.bank_name, pay.account_holder_name, pay.account_number, pay.ifsc_code
      FROM "Transaction" t
      LEFT JOIN "Customer" cu ON cu.id=t.customer_id
      LEFT JOIN "Branch"   b  ON b.id=t.branch_id
      LEFT JOIN "Quotation" q ON q.transaction_id=t.id
      LEFT JOIN orn ON orn.transaction_id=t.id
      LEFT JOIN pay ON pay.transaction_id=t.id
      WHERE t.status='FINAL_PAYMENT_COMPLETED'
        AND (t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2
      ORDER BY t.created_at
    `, [from, to])
    return rows.map(r => {
      const code = String(r.code || '').trim().replace(/-/g, '').toUpperCase()
      const final = parseFloat(r.final_amount) || 0
      const takeover = parseFloat(r.takeover) || 0
      return {
        _ts: new Date(r.created_at).getTime(),
        Date: istFromUtc(r.created_at),
        'Cust Name': r.cust || '',
        'Mobile Number': r.mobile || '',
        Branch: aliasBranchName((r.branch || '').trim()) || '',
        'Grs Wt': n2(r.grs), Stone: n2(r.stone), Wastage: n2(r.wastage), 'Net Weight': n2(r.net), Purity: n2(r.purity),
        'Gross Amount': n2(r.gross_amount),
        'Service Charge percentage': n2(r.service_charge),
        'Service Charge Amount': n2(r.service_charge_amount),
        'Takover Amount': n2(takeover),
        'Balance Amount': n2(final - takeover),
        'Final Amount': n2(final),
        'Transaction Type': String(r.transaction_type || '').toUpperCase().includes('RELEASED') ? 'TAKEOVER' : 'PHYSICAL',
        'Application No.': code.startsWith('WGKA') ? code : `WGKA${code}`,
        'Bank Name': r.processor || '',
        'Payment Ref No': r.utr || '',
        'Customer Bank Name': r.bank_name || '',
        'Account Holder Name': r.account_holder_name || '',
        'Bank Branch': '',
        'Customer Account number': r.account_number || '',
        'Customer Bank IFSC Code': r.ifsc_code || '',
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

  const results = await Promise.allSettled([fetchOldCrm(from, to), fetchNewCrm(from, to)])
  const oldRows = results[0].status === 'fulfilled' ? results[0].value : []
  const newRows = results[1].status === 'fulfilled' ? results[1].value : []
  const errors = []
  if (results[0].status === 'rejected') errors.push(`old CRM: ${results[0].reason?.message || results[0].reason}`)
  if (results[1].status === 'rejected') errors.push(`new CRM: ${results[1].reason?.message || results[1].reason}`)

  const merged = [...oldRows, ...newRows].sort((a, b) => a._ts - b._ts)
  const lines = [COLUMNS.join(',')]
  merged.forEach((r, i) => {
    const cells = COLUMNS.map(col => {
      if (col === 'SL') return i + 1
      // keep leading zeros on account numbers when opened in Excel
      if (col === 'Customer Account number' && r[col]) return `="${r[col]}"`
      return r[col]
    })
    lines.push(cells.map(csvCell).join(','))
  })
  const csv = '﻿' + lines.join('\r\n')

  return Response.json({
    from, to,
    total: merged.length, oldCount: oldRows.length, newCount: newRows.length,
    errors: errors.length ? errors : null,
    csv,
  })
}
