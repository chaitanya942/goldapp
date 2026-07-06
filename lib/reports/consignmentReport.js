// lib/reports/consignmentReport.js
// Builds the daily Finance "Consignment Report" for one IST date:
//   • Excel (case-wise) — one row per bill whose consignment was CREATED that day.
//   • PNG per region — branch-wise breakdown image (reuses the app's canvas
//     renderer so it matches the on-screen "Download PNG" export).
//   • HTML email body — region-wise summary; the per-region PNGs + case Excel
//     ride along as attachments.
import * as XLSX from 'xlsx'
import { fetchInTransitStock } from '../consignmentReportData'
import { generateInTransitJpg } from '../generateInTransitJpg'
import { REGION_ORDER, regionExpectedDelivery } from '../consignmentDelivery'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const STATUS_LABEL = { in_consignment: 'In transit', at_ho: 'Received', sent_for_melting: 'Melting', melted: 'Melted', sold: 'Sold', at_branch: 'Back at branch' }

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const fmtWt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtAmt = (n) => Math.round(n).toLocaleString('en-IN')
const istYmd = (iso) => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null  // YYYY-MM-DD
const fmtDateLong = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return `${String(d).padStart(2, '0')} ${MON[(m || 1) - 1]} ${y}` }
const fmtCell = (ymd) => { if (!ymd) return ''; const [y, m, d] = String(ymd).slice(0, 10).split('-'); return `${d}-${MON[+m - 1]}-${y}` }
const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')

export async function buildConsignmentReport(dateYmd) {
  const rows = await fetchInTransitStock({ from: dateYmd, to: dateYmd })
  const dateLong = fmtDateLong(dateYmd)
  const isEmpty = rows.length === 0

  // Normalize each bill with a consignment date (IST) + expected delivery.
  const bills = rows.map(r => {
    const consignYmd = istYmd(r.consignment_created_at) || istYmd(r.dispatched_at)
    const region = r.region || 'Others'
    return {
      ...r,
      _region: region,
      _consignYmd: consignYmd,
      _expDeliv: regionExpectedDelivery(consignYmd, region, r.delivery_tat_hours),
    }
  })

  // ── Region-wise summary (for the email body + subject) ──────────────────────
  const regionAgg = new Map()
  for (const b of bills) {
    const g = regionAgg.get(b._region) || { region: b._region, bills: 0, net: 0, gross: 0 }
    g.bills++; g.net += num(b.net_weight); g.gross += num(b.total_amount); regionAgg.set(b._region, g)
  }
  const orderIdx = (r) => { const i = REGION_ORDER.indexOf(r); return i === -1 ? 999 : i }
  const regionRows = [...regionAgg.values()].sort((a, b) => (orderIdx(a.region) - orderIdx(b.region)) || (b.gross - a.gross))
  const grand = regionRows.reduce((a, r) => ({ bills: a.bills + r.bills, net: a.net + r.net, gross: a.gross + r.gross }), { bills: 0, net: 0, gross: 0 })

  // ── Excel: case-wise detail ─────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  const HEAD = ['SL', 'Application ID', 'Purchase Date', 'Customer', 'Branch', 'Region', 'Gross Wt (g)', 'Net Wt (g)', 'Gross Amt', 'Consignment Date', 'Booking Date', 'Expected Delivery', 'TMP PRF No', 'Status']
  const sortedBills = [...bills].sort((a, b) =>
    (a._consignYmd || '').localeCompare(b._consignYmd || '') ||
    (a.branch_name || '').localeCompare(b.branch_name || '') ||
    (a.application_id || '').localeCompare(b.application_id || ''))
  const detailAoa = [HEAD]
  sortedBills.forEach((b, i) => {
    detailAoa.push([
      i + 1,
      b.application_id || '',
      fmtCell(b.purchase_date),
      b.customer_name || '',
      b.branch_name || '',
      b._region,
      num(b.gross_weight), num(b.net_weight), num(b.total_amount),
      fmtCell(b._consignYmd),
      fmtCell(istYmd(b.booked_at)),
      fmtCell(b._expDeliv),
      b.consignment?.tmp_prf_no || '',
      STATUS_LABEL[b.stock_status] || (b.stock_status || ''),
    ])
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailAoa), 'Consignments (case-wise)')

  // Region summary sheet.
  const sumAoa = [
    [`CONSIGNMENT REPORT — Region-wise — ${dateLong}`],
    ['Region', 'No of Bills', 'Total Net Weight', 'Gross Amount'],
    ...regionRows.map(r => [r.region, r.bills, +r.net.toFixed(2), Math.round(r.gross)]),
    ['Grand Total', grand.bills, +grand.net.toFixed(2), Math.round(grand.gross)],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumAoa), 'Region Summary')
  const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })

  const attachments = [{ filename: `Consignment_Report_${dateYmd}.xlsx`, contentBase64: xlsxBase64, contentType: XLSX_MIME }]

  // ── PNG per region (branch-wise) ────────────────────────────────────────────
  // Group bills into (branch + consignment date) rows within each region, then
  // render one branch-wise PNG per region via the shared canvas renderer.
  const byRegion = new Map()
  for (const b of bills) {
    if (!byRegion.has(b._region)) byRegion.set(b._region, [])
    byRegion.get(b._region).push(b)
  }
  const regionsOrdered = [...byRegion.keys()].sort((a, b) => (orderIdx(a) - orderIdx(b)) || a.localeCompare(b))
  for (const region of regionsOrdered) {
    const regionBills = byRegion.get(region)
    const groups = new Map()
    for (const b of regionBills) {
      const key = `${b._consignYmd || '∅'}|${b.branch_name || '—'}`
      let g = groups.get(key)
      if (!g) { g = { consignment_date: b._consignYmd, branch_name: b.branch_name || '—', region, bills: 0, gross_weight: 0, net_weight: 0, total_amount: 0, expected_delivery_date: b._expDeliv }; groups.set(key, g) }
      g.bills++; g.gross_weight += num(b.gross_weight); g.net_weight += num(b.net_weight); g.total_amount += num(b.total_amount)
    }
    const branchRows = [...groups.values()].sort((a, b) =>
      (a.consignment_date || '').localeCompare(b.consignment_date || '') || (b.total_amount - a.total_amount))
    try {
      const png = await generateInTransitJpg({
        viewMode: 'branch',
        rows: branchRows,
        meta: { region, filter_label: `Consignments · ${dateLong}` },
      })
      attachments.push({ filename: `Consignment_${sanitize(region)}_${dateYmd}.png`, contentBase64: png.toString('base64'), contentType: 'image/png' })
    } catch { /* skip a region that fails to render rather than fail the whole report */ }
  }

  const html = buildHtml({ dateLong, regionRows, grand, attachments })
  const subject = `Consignment Report — ${dateLong} · ${grand.bills} bills · ${fmtWt(grand.net)}g · ₹${fmtAmt(grand.gross)}`

  return { date: dateYmd, subject, html, isEmpty, attachments, counts: { total: bills.length } }
}

function buildHtml({ dateLong, regionRows, grand, attachments }) {
  const HDR = 'background:#b8cce4;border:1px solid #95b3d7;padding:6px 8px;font-weight:700;font-size:12px;color:#1f3864;text-align:center'
  const CELL = 'border:1px solid #cfd8e6;padding:5px 8px;font-size:12px;color:#222'
  const CELLR = CELL + ';text-align:right'
  const TOT = 'border:1px solid #95b3d7;padding:6px 8px;font-size:12px;font-weight:800;background:#dbe5f1;color:#1f3864'
  const TOTR = TOT + ';text-align:right'
  const pngNames = attachments.filter(a => a.contentType === 'image/png').map(a => a.filename)
  return `<!-- consignment report -->
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#222;max-width:760px">
    <p style="font-size:13px;margin:0 0 4px">Hi Team,</p>
    <p style="font-size:13px;margin:0 0 8px">Please find the Consignment Report for <b>${dateLong}</b> (consignments created on this date). The <b>case-wise Excel</b> and <b>region-wise branch PNGs</b> are attached.</p>
    <div style="font-weight:800;font-size:14px;color:#1f3864;margin:18px 0 2px">Consignment Report — Region-wise</div>
    <div style="font-size:12px;color:#555;margin:0 0 8px">Date : ${dateLong}</div>
    <table style="border-collapse:collapse;min-width:480px">
      <tr>
        <th style="${HDR};text-align:left">Region</th>
        <th style="${HDR}">No. of Bills</th>
        <th style="${HDR}">Total Net Weight</th>
        <th style="${HDR}">Gross Amount</th>
      </tr>
      ${regionRows.map(r => `
      <tr>
        <td style="${CELL}">${esc(r.region)}</td>
        <td style="${CELLR}">${r.bills}</td>
        <td style="${CELLR}">${fmtWt(r.net)}</td>
        <td style="${CELLR}">${fmtAmt(r.gross)}</td>
      </tr>`).join('')}
      <tr>
        <td style="${TOT}">Grand Total</td>
        <td style="${TOTR}">${grand.bills}</td>
        <td style="${TOTR}">${fmtWt(grand.net)}</td>
        <td style="${TOTR}">${fmtAmt(grand.gross)}</td>
      </tr>
    </table>
    <p style="font-size:12px;color:#666;margin:16px 0 4px">Attached: case-wise Excel${pngNames.length ? ` + ${pngNames.length} region PNG${pngNames.length > 1 ? 's' : ''}` : ''}.</p>
    <p style="font-size:12px;color:#888;margin:6px 0 4px">${grand.bills} bills · auto-generated from WhiteGold Consignments.</p>
  </div>`
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
