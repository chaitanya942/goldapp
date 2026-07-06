// lib/reports/purchaseReport.js
// Builds the daily Finance "Purchase Report": an .xlsx workbook + an HTML email
// body, from the reconciled Purchase Register (lib/purchaseRegisterData.js) so
// the emailed numbers match the on-screen register exactly.
//
// Deliverables (matching the format Finance already uses):
//   • Excel "Detail" sheet — the 16-column per-bill export.
//   • Excel "Region Summary" + one sheet per region-section (branch breakdown).
//   • HTML email body — region-wise summary + per-region branch tables inline.
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { buildPurchaseRegister } from '../purchaseRegisterData'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

// The 16 finance columns, and where each pulls from in a register record's cell.
// `BM Pur` = Purity. SL is the row index.
const REPORT_COLUMNS = [
  ['SL',                  null],
  ['Purchase Date',       'Date'],
  ['Application No.',      'Application No.'],
  ['Cust Name',           'Cust Name'],
  ['Mobile Number',       'Mobile Number'],
  ['Branch',              'Branch'],
  ['Transaction Type',    'Transaction Type'],
  ['Grs Wt',              'Grs Wt'],
  ['Stone',               'Stone'],
  ['Wastage',             'Wastage'],
  ['Net Weight',          'Net Weight'],
  ['BM Pur',              'Purity'],
  ['Gross Amount',        'Gross Amount'],
  ['Service Charge Amt',  'Service Charge Amount'],
  ['Final Amount',        'Final Amount'],
  ['Payment Ref No',      'Payment Ref No'],
]

// Presentation grouping used by the Finance report: Andhra Pradesh + Telangana
// share one branch-breakdown table (their existing format). Region → branch
// assignment always comes from the `branches` table (data), never hardcoded;
// only this section pairing is presentational.
const SECTION_COMBINE = { 'Andhra Pradesh': 'Andhra Pradesh and Telangana', 'Telangana': 'Andhra Pradesh and Telangana' }
// Cosmetic label so the stored region 'Bangalore' prints as 'Bengaluru' (matches
// the report Finance already receives).
const REGION_DISPLAY = { 'Bangalore': 'Bengaluru' }

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const fmtWt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtAmt = (n) => Math.round(n).toLocaleString('en-IN')
const dispRegion = (r) => REGION_DISPLAY[r] || r
const sectionOf = (r) => SECTION_COMBINE[r] || dispRegion(r)

function fmtDateLong(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d).padStart(2, '0')} ${MON[(m || 1) - 1]} ${y}`
}

/**
 * Build the Finance Purchase Report for one IST date.
 * @param {string} dateYmd  YYYY-MM-DD (IST)
 * @returns {Promise<{date, subject, html, filename, xlsxBase64, counts, errors, isEmpty}>}
 */
export async function buildPurchaseReport(dateYmd) {
  // APPROVED-ONLY: the Finance report must exclude new-CRM payment-pending bills.
  // includePending:false skips the FINAL_PAYMENT_PENDING fetch; the extra
  // .completed filter is a safety net so only approved rows are ever counted.
  const built = await buildPurchaseRegister(dateYmd, dateYmd, { includePending: false })
  const { errors } = built
  const records = built.records.filter(r => r.completed)
  const counts = { total: records.length }

  // Branch → region map (authoritative, from the branch master).
  const { data: branchRows } = await supabase.from('branches').select('name, region')
  const regionByBranch = {}
  for (const b of (branchRows || [])) if (b.name) regionByBranch[b.name.trim().toUpperCase()] = b.region || 'Others'
  const regionFor = (branchName) => regionByBranch[String(branchName || '').trim().toUpperCase()] || 'Others'

  // ── Aggregate: branch-level and region-level (bills / net wt / gross) ───────
  const branchAgg = new Map()   // key `${section}|${branch}` → {section, region, branch, bills, net, gross}
  const regionAgg = new Map()   // key region (raw)          → {region, bills, net, gross}
  for (const rec of records) {
    const branch = rec.cell['Branch'] || '—'
    const region = regionFor(branch)
    const section = sectionOf(region)
    const net = num(rec.cell['Net Weight'])
    const gross = num(rec.cell['Gross Amount'])

    const bKey = `${section}|${branch}`
    const b = branchAgg.get(bKey) || { section, region, branch, bills: 0, net: 0, gross: 0 }
    b.bills++; b.net += net; b.gross += gross; branchAgg.set(bKey, b)

    const r = regionAgg.get(region) || { region, bills: 0, net: 0, gross: 0 }
    r.bills++; r.net += net; r.gross += gross; regionAgg.set(region, r)
  }

  // Region-wise summary rows, sorted by gross desc.
  const regionRows = [...regionAgg.values()]
    .map(r => ({ ...r, display: dispRegion(r.region), avg: r.bills ? r.net / r.bills : 0 }))
    .sort((a, b) => b.gross - a.gross)
  const grand = regionRows.reduce((a, r) => ({ bills: a.bills + r.bills, net: a.net + r.net, gross: a.gross + r.gross }), { bills: 0, net: 0, gross: 0 })
  grand.avg = grand.bills ? grand.net / grand.bills : 0

  // Section (branch-breakdown) list, each sorted by gross desc, sections by gross desc.
  const sectionMap = new Map()  // section title → branch rows[]
  for (const b of branchAgg.values()) {
    if (!sectionMap.has(b.section)) sectionMap.set(b.section, [])
    sectionMap.get(b.section).push(b)
  }
  const sections = [...sectionMap.entries()].map(([title, rows]) => {
    rows.sort((a, b) => b.gross - a.gross)
    const tot = rows.reduce((a, r) => ({ bills: a.bills + r.bills, net: a.net + r.net, gross: a.gross + r.gross }), { bills: 0, net: 0, gross: 0 })
    return { title, rows, tot }
  }).sort((a, b) => b.tot.gross - a.tot.gross)

  const dateLong = fmtDateLong(dateYmd)
  const isEmpty = records.length === 0

  // ── Excel workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()

  // Detail sheet — 16 columns.
  const detailAoa = [REPORT_COLUMNS.map(c => c[0])]
  records.forEach((rec, i) => {
    detailAoa.push(REPORT_COLUMNS.map(([label, key]) => {
      if (label === 'SL') return i + 1
      let v = rec.cell[key]
      if (typeof v === 'string') { const m = v.match(/^="(.*)"$/); if (m) v = m[1] }
      // Numeric-ify weight/amount columns so Excel treats them as numbers.
      if (['Grs Wt','Stone','Wastage','Net Weight','BM Pur','Gross Amount','Service Charge Amt','Final Amount'].includes(label)) {
        const n = parseFloat(v); return Number.isFinite(n) ? n : (v ?? '')
      }
      return v == null ? '' : v
    }))
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailAoa), 'Detail')

  // Region Summary sheet.
  const sumAoa = [
    [`WGB REGION WISE PURCHASE REPORT — ${dateLong}`],
    ['Region', 'No Of Bills', 'Total Net Weight', 'Gross Purchases', 'Avg Wt per Bill'],
    ...regionRows.map(r => [r.display, r.bills, +r.net.toFixed(2), Math.round(r.gross), +r.avg.toFixed(2)]),
    ['Grand Total', grand.bills, +grand.net.toFixed(2), Math.round(grand.gross), +grand.avg.toFixed(2)],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumAoa), 'Region Summary')

  // One sheet per section (branch breakdown).
  const usedNames = new Set(['Detail', 'Region Summary'])
  for (const sec of sections) {
    const aoa = [
      [`PURCHASE REPORT - ${sec.title} — ${dateLong}`],
      ['Sr. No.', 'Branch', 'No. of Bills', 'Total Net Weight', 'Gross Purchases'],
      ...sec.rows.map((r, i) => [i + 1, r.branch, r.bills, +r.net.toFixed(2), Math.round(r.gross)]),
      ['Grand Total', '', sec.tot.bills, +sec.tot.net.toFixed(2), Math.round(sec.tot.gross)],
    ]
    // Excel sheet names: max 31 chars, no []:*?/\
    let name = sec.title.replace(/[\[\]:*?/\\]/g, '').slice(0, 28)
    let n = name; let k = 2; while (usedNames.has(n)) { n = `${name.slice(0, 26)} ${k++}` }
    usedNames.add(n)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n)
  }

  const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
  const filename = `Purchase_Report_${dateYmd}.xlsx`

  // ── HTML email body ──────────────────────────────────────────────────────
  const html = buildHtml({ dateLong, regionRows, grand, sections, counts, errors })
  const subject = `Purchase Report — ${dateLong} · ${grand.bills} bills · ${fmtWt(grand.net)}g · ₹${fmtAmt(grand.gross)}`

  return { date: dateYmd, subject, html, filename, xlsxBase64, counts, errors, isEmpty }
}

// ── HTML rendering (inline styles — email clients strip <style>) ─────────────
function buildHtml({ dateLong, regionRows, grand, sections, counts, errors }) {
  const HDR = 'background:#b8cce4;border:1px solid #95b3d7;padding:6px 8px;font-weight:700;font-size:12px;color:#1f3864;text-align:center'
  const CELL = 'border:1px solid #cfd8e6;padding:5px 8px;font-size:12px;color:#222'
  const CELLR = CELL + ';text-align:right'
  const TOT = 'border:1px solid #95b3d7;padding:6px 8px;font-size:12px;font-weight:800;background:#dbe5f1;color:#1f3864'
  const TOTR = TOT + ';text-align:right'
  const TITLE = 'font-weight:800;font-size:14px;color:#1f3864;margin:22px 0 2px'
  const DATE = 'font-size:12px;color:#555;margin:0 0 8px'

  const summaryTable = `
    <div style="${TITLE}">WGB Region-wise Purchase Report</div>
    <div style="${DATE}">Date : ${dateLong}</div>
    <table style="border-collapse:collapse;min-width:520px">
      <tr>
        <th style="${HDR};text-align:left">Region</th>
        <th style="${HDR}">No. of Bills</th>
        <th style="${HDR}">Total Net Weight</th>
        <th style="${HDR}">Gross Purchases</th>
        <th style="${HDR}">Avg Wt / Bill</th>
      </tr>
      ${regionRows.map(r => `
      <tr>
        <td style="${CELL}">${esc(r.display)}</td>
        <td style="${CELLR}">${r.bills}</td>
        <td style="${CELLR}">${fmtWt(r.net)}</td>
        <td style="${CELLR}">${fmtAmt(r.gross)}</td>
        <td style="${CELLR}">${fmtWt(r.avg)}</td>
      </tr>`).join('')}
      <tr>
        <td style="${TOT}">Grand Total</td>
        <td style="${TOTR}">${grand.bills}</td>
        <td style="${TOTR}">${fmtWt(grand.net)}</td>
        <td style="${TOTR}">${fmtAmt(grand.gross)}</td>
        <td style="${TOTR}">${fmtWt(grand.avg)}</td>
      </tr>
    </table>`

  const sectionTables = sections.map(sec => `
    <div style="${TITLE}">Purchase Report — ${esc(sec.title)}</div>
    <div style="${DATE}">Date : ${dateLong}</div>
    <table style="border-collapse:collapse;min-width:520px">
      <tr>
        <th style="${HDR}">Sr. No.</th>
        <th style="${HDR};text-align:left">Branch</th>
        <th style="${HDR}">No. of Bills</th>
        <th style="${HDR}">Total Net Weight</th>
        <th style="${HDR}">Gross Purchases</th>
      </tr>
      ${sec.rows.map((r, i) => `
      <tr>
        <td style="${CELLR}">${i + 1}</td>
        <td style="${CELL}">${esc(r.branch)}</td>
        <td style="${CELLR}">${r.bills}</td>
        <td style="${CELLR}">${fmtWt(r.net)}</td>
        <td style="${CELLR}">${fmtAmt(r.gross)}</td>
      </tr>`).join('')}
      <tr>
        <td style="${TOT}"></td>
        <td style="${TOT}">Grand Total</td>
        <td style="${TOTR}">${sec.tot.bills}</td>
        <td style="${TOTR}">${fmtWt(sec.tot.net)}</td>
        <td style="${TOTR}">${fmtAmt(sec.tot.gross)}</td>
      </tr>
    </table>`).join('')

  const note = errors && errors.length
    ? `<div style="margin:14px 0;padding:8px 12px;background:#fff4e5;border:1px solid #ffc98a;border-radius:6px;font-size:12px;color:#8a5a00">
         Note: some source data was unavailable at send time — ${esc(errors.join('; '))}
       </div>` : ''

  return `<!-- purchase report -->
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#222;max-width:760px">
    <p style="font-size:13px;margin:0 0 4px">Hi Team,</p>
    <p style="font-size:13px;margin:0 0 8px">Please find the Purchase Report for <b>${dateLong}</b> below, with the detailed bill-level breakup attached as an Excel file.</p>
    ${note}
    ${summaryTable}
    ${sectionTables}
    <p style="font-size:12px;color:#888;margin:22px 0 4px">
      ${counts.total} approved bills · auto-generated from the WhiteGold Purchase Register.
    </p>
  </div>`
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
