// lib/reports/purchaseRegisterReport.js
// Emails the FULL Purchase Register — the exact 26-column Excel that the
// Purchase Register module downloads (/api/purchase-register), including bank/
// payment details and payment-pending bills. Uses the same shared builder, so
// the attached workbook is identical to the on-screen export.
import * as XLSX from 'xlsx'
import { buildPurchaseRegister, REGISTER_COLUMNS } from '../purchaseRegisterData'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDateLong = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return `${String(d).padStart(2, '0')} ${MON[(m || 1) - 1]} ${y}` }

export async function buildPurchaseRegisterReport(dateYmd) {
  // Full register (completed + payment-pending) — same as the module download.
  const built = await buildPurchaseRegister(dateYmd, dateYmd)
  const { records, errors } = built
  const COLUMNS = REGISTER_COLUMNS
  const completed = records.filter(r => r.completed).length
  const pending = records.length - completed
  const dateLong = fmtDateLong(dateYmd)
  const isEmpty = records.length === 0

  // Array-of-arrays identical to the /api/purchase-register xlsx export: same
  // 26 columns, SL as the row index, account-number text-guard (="…") unwrapped.
  const aoa = [COLUMNS]
  records.forEach((rec, i) => {
    aoa.push(COLUMNS.map(c => {
      if (c === 'SL') return i + 1
      let v = rec.cell[c]
      if (typeof v === 'string') { const m = v.match(/^="(.*)"$/); if (m) v = m[1] }
      return v == null ? '' : v
    }))
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Purchase Register')
  const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })

  const attachments = [{ filename: `Purchase_Register_${dateYmd}.xlsx`, contentBase64: xlsxBase64, contentType: XLSX_MIME }]
  const subject = `Purchase Register — ${dateLong} · ${records.length} bills`
  const errNote = errors && errors.length
    ? `<div style="margin:12px 0;padding:8px 12px;background:#fff4e5;border:1px solid #ffc98a;border-radius:6px;font-size:12px;color:#8a5a00">Note: some source data was unavailable at send time — ${errors.join('; ')}</div>`
    : ''
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#222;max-width:640px">
    <p style="font-size:13px;margin:0 0 4px">Hi Team,</p>
    <p style="font-size:13px;margin:0 0 8px">Please find the full <b>Purchase Register</b> for <b>${dateLong}</b> attached as an Excel file (bill-level, with bank &amp; payment details).</p>
    ${errNote}
    <table style="border-collapse:collapse;font-size:13px;margin-top:6px">
      <tr><td style="padding:4px 12px 4px 0;color:#555">Total bills</td><td style="padding:4px 0;font-weight:700">${records.length}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Completed</td><td style="padding:4px 0;font-weight:700">${completed}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Payment pending</td><td style="padding:4px 0;font-weight:700">${pending}</td></tr>
    </table>
    <p style="font-size:12px;color:#888;margin:18px 0 4px">Auto-generated from the WhiteGold Purchase Register.</p>
  </div>`

  return { date: dateYmd, subject, html, isEmpty, attachments, counts: { total: records.length, completed, pending }, errors }
}
