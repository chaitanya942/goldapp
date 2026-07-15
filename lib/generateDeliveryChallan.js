// lib/generateDeliveryChallan.js
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { amountToWords, fmtIN as fmtINShared } from './pdfHelpers'
import { computeConsignmentTotals } from './consignmentTotals'

// ── State lookup ──────────────────────────────────────────────────────────────
const GST_NUM    = { KA: '29', KL: '32', AP: '37', TS: '36', TN: '33' }
const STATE_NAME = { KA: 'KARNATAKA', KL: 'KERALA', AP: 'ANDHRA PRADESH', TS: 'TELANGANA', TN: 'TAMIL NADU' }

// ── Build branch address ──────────────────────────────────────────────────────
function buildBranchAddress(branch) {
  const raw = (branch?.address || '').trim()
  if (!raw) return ''
  const pinAlreadyIn = branch?.pin_code && raw.includes(branch.pin_code)
  if (pinAlreadyIn) {
    return raw.toUpperCase().includes('INDIA') ? raw : raw + ', INDIA'
  }
  const parts = [raw]
  const city  = (branch?.city  || '').trim().toUpperCase()
  const state = (branch?.state || '').trim().toUpperCase()
  const pin   = (branch?.pin_code || '').trim()
  if (city  && !raw.toUpperCase().includes(city))  parts.push(city)
  if (state && !raw.toUpperCase().includes(state)) parts.push([state, pin].filter(Boolean).join(' '))
  else if (pin && !raw.includes(pin))              parts.push(pin)
  parts.push('INDIA')
  return parts.join(', ')
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═════════════════════════════════════════════════════════════════════════════
// hubGroups (optional): when provided, the per-bill verification table is
// replaced with a branch-wise summary — one row per source branch with
// bills count, gross weight, and value. Used by Bangalore hub dispatches
// where bill-level data is intentionally not shown on the challan; the
// legal items table (consolidated total) is unchanged.
// Shape: [{ branch_name, is_hub, bills, gross_wt, net_wt, value }, ...]
export function generateDeliveryChallan({ consignment, branch, companySettings, items, hubGroups, logoBase64 }) {
  const doc  = new jsPDF('p', 'mm', 'a4')
  const L    = 10, R = 10
  const useW = 210 - L - R   // 190 mm
  const half = useW / 2      //  95 mm

  // ── Colours ───────────────────────────────────────────────────────────────
  const BK = [0, 0, 0],   WH = [255, 255, 255]
  const BL = [0, 51, 153], RD = [180, 20,  20]
  const GY = [130, 130, 130]
  const HG = [245, 245, 245]

  // ── Derived values ────────────────────────────────────────────────────────
  const sc           = consignment.state_code || 'KA'
  const gstNum       = GST_NUM[sc]   || '29'
  const stateName    = (branch?.state || STATE_NAME[sc] || 'KARNATAKA').toUpperCase()
  // Interstate iff source state != HO (Karnataka). INTERNAL Branch→Hub is
  // always same-state by enforcement so it never reaches this challan path
  // (uses Issue Voucher instead) — but the check below makes it explicit and
  // keeps Voucher/Challan/EWB/E-Invoice consistent on assessable value.
  const isInternal   = consignment?.movement_type === 'INTERNAL'
  const isInterstate = !isInternal && sc !== 'KA'
  const branchGSTIN  = branch?.branch_gstin || companySettings[`gstin_${sc.toLowerCase()}`] || ''
  const branchPAN    = companySettings.pan  || (branchGSTIN.length >= 12 ? branchGSTIN.substring(2, 12) : '')
  const igstRate     = parseFloat(companySettings.igst_rate        || 3)
  const upliftPct    = parseFloat(companySettings.value_uplift_pct || 7.5)
  const hoGSTIN      = companySettings.gstin || ''
  const hoState      = (companySettings.head_office_state || 'KARNATAKA').toUpperCase()
  const companyName  = companySettings.company_name || ''

  const fmtIN = fmtINShared
  const dateStr = new Date(consignment.created_at)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    .toUpperCase().replace(/ /g, '-')

  const sigTextY = 289

  let y = 10

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  const hH    = 32
  const logoW = 30
  const copyW = 50
  const titleW  = useW - logoW - copyW
  const titleCX = L + logoW + titleW / 2
  const copyX   = L + logoW + titleW

  doc.setFillColor(...WH)
  doc.rect(L, y, logoW, hH, 'F')
  if (logoBase64) {
    try {
      const imgProps = doc.getImageProperties(`data:image/png;base64,${logoBase64}`)
      const aspect   = imgProps.width / imgProps.height
      const maxW     = logoW - 4, maxH = hH - 4
      const fitW     = Math.min(maxW, maxH * aspect)
      const fitH     = fitW / aspect
      const imgX     = L + (logoW - fitW) / 2
      const imgY     = y  + (hH   - fitH) / 2
      doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', imgX, imgY, fitW, fitH)
    } catch { drawTextLogo(doc, L, y, logoW, hH, BL, WH) }
  } else {
    drawTextLogo(doc, L, y, logoW, hH, BL, WH)
  }

  doc.setTextColor(...BK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  const titleStr = 'DELIVERY CHALLAN'
  doc.text(titleStr, titleCX, y + 7, { align: 'center' })
  const tw = doc.getTextWidth(titleStr)
  doc.setDrawColor(...BK); doc.setLineWidth(0.5)
  doc.line(titleCX - tw/2, y + 8.5, titleCX + tw/2, y + 8.5)
  doc.setLineWidth(0.3)

  // Tamper Proof number: skipped on hub challans. Bangalore hub dispatches
  // don't use the tmp_prf_no convention — that's an outstation sequence
  // tied to the per-branch tamper-proof tape numbering. For hubs the
  // consignment_no / delivery challan number is the sole identifier.
  if (!Array.isArray(hubGroups) || hubGroups.length === 0) {
    doc.setFontSize(9)
    const tpLbl = 'TAMPER PROOF No:-  '
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
    const tpLW = doc.getTextWidth(tpLbl)
    doc.setFont('helvetica', 'bold')
    const tpVW = doc.getTextWidth(consignment.tmp_prf_no || '')
    const tpX  = titleCX - (tpLW + tpVW) / 2
    doc.setFont('helvetica', 'normal'); doc.text(tpLbl, tpX, y + 18)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...RD)
    doc.text(consignment.tmp_prf_no || '', tpX + tpLW, y + 18)
    doc.setTextColor(...BK)
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...GY)
  doc.text('(REFER RULE 55 TO CGST ACT)', titleCX, y + 25, { align: 'center' })
  doc.setTextColor(...BK)

  doc.setFontSize(6.5)
  ;['ORIGINAL FOR CONSIGNEE', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR CONSIGNOR'].forEach((lbl, i) =>
    doc.text(lbl, copyX + 3, y + hH * (i + 0.65) / 3))

  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  doc.rect(L, y, useW, hH)
  doc.line(L + logoW, y, L + logoW, y + hH)
  doc.line(copyX, y, copyX, y + hH)
  doc.line(copyX, y + hH/3,   L + useW, y + hH/3)
  doc.line(copyX, y + hH*2/3, L + useW, y + hH*2/3)
  y += hH

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. INFO ROWS
  // ═══════════════════════════════════════════════════════════════════════════
  const irH    = 5
  const irLblW = 44
  const ir4 = [
    ['DELIVERY CHALLAN NO',   consignment.challan_no || '',   'TRANSPORTER NAME',   companySettings.transporter_name   || 'BVC LOGISTICS PVT. LTD.'],
    ['DELIVERY CHALLAN DATE', dateStr,                        'TRANSPORTATION MODE', companySettings.transportation_mode || 'BY AIR & ROAD'],
    ['STATE',                 stateName,                      'PLACE OF SUPPLY',    stateName],
    ['STATE CODE',            gstNum,                         'VEHICLE NO.',        ''],
  ]
  doc.setLineWidth(0.2)
  ir4.forEach(([ll, lv, rl, rv], i) => {
    const ry = y + i * irH, ty = ry + irH * 0.72
    doc.setDrawColor(...BK)
    doc.rect(L, ry, half, irH); doc.rect(L + half, ry, half, irH)
    doc.setFontSize(7.5); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold'); doc.text(ll, L + 2, ty)
    doc.setFont('helvetica', 'bold'); doc.text(rl, L + half + 2, ty)
    if (i === 0) {
      const pts = (lv || '').split('/'), ext = pts.pop()
      const pfx = ': ' + pts.join('/') + '/ '
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK); doc.text(pfx, L + irLblW, ty)
      doc.setFont('helvetica', 'bold');   doc.setTextColor(...RD); doc.text(ext, L + irLblW + doc.getTextWidth(pfx), ty)
      doc.setTextColor(...BK)
    } else {
      doc.setFont('helvetica', 'normal'); doc.text(': ' + lv, L + irLblW, ty)
    }
    doc.setFont('helvetica', 'normal'); doc.text(': ' + rv, L + half + irLblW, ty)
  })
  y += 4 * irH

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. BILL FROM / CONSIGNEE SECTION
  // ═══════════════════════════════════════════════════════════════════════════
  const lLblW = 33
  const lValX = L + lLblW + 1
  const rLblW = 24
  const rValX = L + half + rLblW + 1
  const RH    = 6
  const bY    = y

  const fullAddr = buildBranchAddress(branch)
  const addrMaxW = half - lLblW - 6

  let addrFsz = 7
  doc.setFontSize(7); let addrLines = doc.splitTextToSize(fullAddr, addrMaxW)
  if (addrLines.length > 5) { addrFsz = 6.5; doc.setFontSize(6.5); addrLines = doc.splitTextToSize(fullAddr, addrMaxW) }
  if (addrLines.length > 6) { addrFsz = 6;   doc.setFontSize(6);   addrLines = doc.splitTextToSize(fullAddr, addrMaxW) }
  if (addrLines.length > 8) addrLines = addrLines.slice(0, 8)
  doc.setFontSize(7.5)
  const addrLH   = addrFsz <= 6 ? 3.5 : addrFsz <= 6.5 ? 4 : 4.5
  const addrBlkH = addrLines.length * addrLH + 3

  const hoLines = [
    companyName + '-BENGALURU',
    companySettings.head_office_building || '',
    companySettings.head_office_address  || '',
    [companySettings.head_office_city,
      (companySettings.head_office_state || '') + '-' + (companySettings.head_office_pin || '')]
      .filter(Boolean).join(','),
  ].filter(l => l && l.trim())

  const branchName    = branch?.name || ''
  const combined      = companyName + '    ' + branchName
  const billCheckW    = half - lLblW - 3
  let   billFsz       = 7.5
  let   billSplit     = false
  doc.setFont('helvetica', 'normal')
  let   billFitted    = false
  for (const sz of [7.5, 6.5, 6]) {
    doc.setFontSize(sz)
    if (doc.getTextWidth(': ' + combined) <= billCheckW) { billFsz = sz; billFitted = true; break }
  }
  if (!billFitted) { billSplit = true; billFsz = 7.5 }
  doc.setFontSize(7.5)

  const billFromH = billSplit ? (4 + RH) : RH
  const lEnd = 5
    + billFromH        // BILL FROM
    + RH               // CONTACT PERSON (with phone)
    + addrBlkH         // ADDRESS block
    + RH               // STATE CODE
    + RH               // GSTIN
    + RH               // PAN/AADHAR
    + RH               // PURPOSE OF MOVEMENT
    + 3

  const rOff = 10 + hoLines.length * 3.8 + 3
  const rEnd  = rOff + RH * 3 + 3   // STATE / STATE CODE / GSTIN

  const billH = Math.max(lEnd, rEnd) + 4

  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  doc.rect(L, y, useW, billH)
  doc.line(L + half, y, L + half, y + billH)

  let lCur = 5

  function lRow(label, value, advance, fsz) {
    const sz = fsz || 7.5
    doc.setFontSize(sz); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + 2, bY + lCur)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + (value || ''), lValX - 1, bY + lCur)
    lCur += advance
  }

  if (billSplit) {
    lRow('BILL FROM', companyName, 4, 7.5)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
    doc.text(branchName, lValX, bY + lCur)
    lCur += RH
  } else {
    lRow('BILL FROM', combined, RH, billFsz)
  }

  const contactName  = branch?.contact_person || ''
  const contactPhone = branch?.contact_phone  || ''
  doc.setFontSize(7.5); doc.setTextColor(...BK)
  doc.setFont('helvetica', 'bold')
  doc.text('CONTACT PERSON', L + 2, bY + lCur)
  doc.text(': ' + contactName, lValX - 1, bY + lCur)
  if (contactPhone) {
    doc.setFont('helvetica', 'normal')
    doc.text(contactPhone, L + half - 2, bY + lCur, { align: 'right' })
  }
  lCur += RH

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
  doc.text('ADDRESS', L + 2, bY + lCur)
  doc.setFont('helvetica', 'normal'); doc.text(':', lValX - 1, bY + lCur)
  doc.setFontSize(addrFsz)
  addrLines.forEach((line, i) => doc.text(line, lValX + 1, bY + lCur + i * addrLH))
  doc.setFontSize(7.5)
  lCur += addrBlkH

  lRow('STATE CODE',           gstNum,           RH)
  lRow('GSTIN',                branchGSTIN,      RH)
  lRow('PAN/AADHAR',           branchPAN,        RH)
  lRow('PURPOSE OF MOVEMENT',  'STOCK TRANSFER', RH, 6.5)

  function rf(label, value, off, fsz) {
    doc.setFontSize(fsz || 7.5); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + half + 2, bY + off)
    doc.setFont('helvetica', 'normal')
    if (value) doc.text(': ' + value, rValX - 1, bY + off)
    else       doc.text(':',          rValX - 1, bY + off)
  }

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text('CONSIGNEE ADDRESS :', L + half + 2, bY + 5)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal')
  hoLines.forEach((line, i) => doc.text(line, L + half + 4, bY + 10 + i * 3.8))

  // Derive HO state code from the HO GSTIN — first 2 digits are the state code per
  // GSTIN spec. Falls back to '29' (Karnataka) only if GSTIN is missing/malformed.
  const hoStcdFromGstin = (typeof hoGSTIN === 'string' && /^\d{2}/.test(hoGSTIN)) ? hoGSTIN.slice(0, 2) : '29'
  rf('STATE',      hoState,           rOff)
  rf('STATE CODE', hoStcdFromGstin,   rOff + RH)
  rf('GSTIN',      hoGSTIN,           rOff + RH * 2)

  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  y += billH + 1

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. VERIFICATION SUMMARY — branch-wise (Bangalore hub only)
  //
  // Per-bill details (App ID / Customer / Date / Branch) are intentionally NOT
  // shown on the Delivery Challan — it stays a single-page legal document whose
  // only movement content is the consolidated GST items table below. The
  // bill-level manifest lives in the Consignee Report.
  //
  // Bangalore hub dispatches still render a compact branch-wise summary (one
  // row per source branch with bills count, gross weight, and value) so the
  // receiving team can verify branch-by-branch. That is per-BRANCH, not
  // per-bill, and fits comfortably on one page.
  // ═══════════════════════════════════════════════════════════════════════════
  if (Array.isArray(hubGroups) && hubGroups.length > 0) {
    const branchRows = hubGroups.map((g, i) => [
      String(i + 1),
      (g.branch_name || '') + (g.is_hub ? '  (HUB)' : ''),
      String(g.bills || 0),
      Number(g.gross_wt || 0).toFixed(3),
      fmtIN(g.value || 0),
    ])
    // Hub-total row at the bottom of the verification table.
    const grandBills = hubGroups.reduce((s, g) => s + Number(g.bills || 0), 0)
    const grandWt    = hubGroups.reduce((s, g) => s + Number(g.gross_wt || 0), 0)
    const grandVal   = hubGroups.reduce((s, g) => s + Number(g.value || 0), 0)
    branchRows.push(['', 'HUB TOTAL', String(grandBills), grandWt.toFixed(3), fmtIN(grandVal)])

    autoTable(doc, {
      startY: y,
      head: [['#', 'SOURCE BRANCH', 'BILLS', 'GROSS WT (G)', 'VALUE (₹)']],
      body: branchRows,
      theme: 'grid',
      tableWidth: 190,
      styles:     { fontSize: 7.5, cellPadding: 1.4, lineColor: BK, lineWidth: 0.15, textColor: BK, valign: 'middle' },
      headStyles: { fillColor: HG, textColor: BK, fontStyle: 'bold', halign: 'center', fontSize: 7.5, valign: 'middle', cellPadding: 1.4 },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { cellWidth: 'auto' },
        2: { halign: 'center', cellWidth: 22 },
        3: { halign: 'right',  cellWidth: 36 },
        4: { halign: 'right',  cellWidth: 40 },
      },
      // Bolden the last row (HUB TOTAL).
      didParseCell: (data) => {
        if (data.row.index === branchRows.length - 1 && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = HG
        }
      },
      margin: { left: L, right: R },
    })
    y = doc.lastAutoTable.finalY + 2
    doc.setFontSize(6.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GY)
    doc.text(
      'Bill-level breakup intentionally omitted on hub dispatches — verify against each source branch above. Consolidated total in the GST items table below.',
      L, y + 2.5
    )
    y += 5
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ITEMS TABLE  (GST format — required by law to show consolidated qty,
  //    rate, value, IGST, and grand total. This is the legal Challan content.)
  // ═══════════════════════════════════════════════════════════════════════════
  // Totals via the canonical calculator — the same numbers feed the EWB and
  // E-Invoice payloads. Five docs, one math.
  const T      = computeConsignmentTotals({ consignment, items, companySettings: companySettings || {} })
  const totWt  = T.totalGrossWt
  const totAmt = T.rawValue
  const rate   = totWt > 0 ? totAmt / totWt : 0
  const vog    = T.assessableValue
  const igst   = T.igstAmt
  const grand  = T.grandTotal

  // Footer rows are drawn manually after the table — autotable cannot reliably
  // render vertical borders or honour alignment on empty cells in any section.
  const fH       = 6   // manual footer row height (mm)
  const ftrCount = isInterstate ? 3 : 1
  // Reserve below the items table = manual footer rows + words box (~13) +
  // grand-total box (10) + a small margin before the signature line. The
  // per-bill list is gone, so the items table now fills the page down to this
  // reserve instead of leaving a large gap above the signatures.
  const bottomReserve = ftrCount * fH + 36
  const availForTable = sigTextY - y - bottomReserve
  const rH_est   = 6.25
  const tblFixed = 8 + rH_est   // header(8) + 1 data row
  // Fewer filler rows now (the bill list above already filled visual space)
  const nEmpty   = Math.max(0, Math.floor((availForTable - tblFixed) / rH_est))

  const emptyR = ['', '', '', '', '', '']
  const bodyR  = [
    // Gross weight to 3 decimals — matches EWB / E-Invoice / Issue Voucher /
    // Consignee Report. Was .toFixed(2) which silently disagreed with the GST
    // documents whenever the third decimal was non-zero.
    ['1', `USED GOLD ORNAMENTS-${sc}`, companySettings.hsn_code || '711319',
      totWt.toFixed(3), fmtIN(rate), fmtIN(totAmt)],
    ...Array(nEmpty).fill(emptyR),
  ]

  autoTable(doc, {
    startY: y,
    head: [['S.No.', 'DESCRIPTION OF GOODS', 'HSN OF\nGOODS',
      'QUANTITY/GROSS\nWEIGHT (GMS)', 'RATE', 'VALUE OF GOODS']],
    body: bodyR,
    theme: 'grid',
    tableWidth: 190,
    styles:     { fontSize: 7.5, cellPadding: 1.5, lineColor: BK, lineWidth: 0.2, textColor: BK, valign: 'middle' },
    headStyles: { fillColor: HG, textColor: BK, fontStyle: 'bold', halign: 'center', fontSize: 7.5, valign: 'middle', cellPadding: 1.5 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { halign: 'left',   cellWidth: 72 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'center', cellWidth: 30 },
      4: { halign: 'center', cellWidth: 28 },
      5: { halign: 'center', cellWidth: 32 },
    },
    margin: { left: L, right: R },
  })
  y = doc.lastAutoTable.finalY

  // ── Manual footer rows (VALUE OF GOODS / IGST / GRAND TOTAL) ─────────────
  // Column x-positions matching columnStyles widths: 10+72+18+30+28+32 = 190
  const fCols = [
    { x: L,       w: 10 },   // S.No
    { x: L + 10,  w: 72 },   // Description
    { x: L + 82,  w: 18 },   // HSN
    { x: L + 100, w: 30 },   // Quantity
    { x: L + 130, w: 28 },   // label
    { x: L + 158, w: 32 },   // amount
  ]
  const ftrData = isInterstate
    ? [['VALUE OF GOODS', fmtIN(vog)], [`IGST @ ${igstRate}%`, fmtIN(igst)], ['GRAND TOTAL', fmtIN(grand)]]
    : [['GRAND TOTAL', fmtIN(grand)]]

  doc.setLineWidth(0.2); doc.setDrawColor(...BK)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...BK)

  ftrData.forEach(([label, amount], i) => {
    const ry  = y + i * fH
    const ty  = ry + fH * 0.68   // text baseline within row
    fCols.forEach(c => doc.rect(c.x, ry, c.w, fH))
    // Label centred in col 4, amount centred in col 5
    doc.text(label,  fCols[4].x + fCols[4].w / 2, ty, { align: 'center' })
    doc.text(amount, fCols[5].x + fCols[5].w / 2, ty, { align: 'center' })
  })
  y += ftrCount * fH

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. TOTAL IN WORDS + GRAND TOTAL
  // ═══════════════════════════════════════════════════════════════════════════
  // Widths chosen so these boxes align exactly with the items-table footer
  // columns above (label col at L+130 w28, amount col at L+158 w32): rbX lands
  // on L+130 and the mid-divider on L+158, so the vertical grid lines run
  // straight through the GRAND TOTAL / words rows with no jog.
  const rbW = 60, rbX = L + useW - rbW
  const rb1 = 28, rb2 = rbW - rb1

  const wLbl = 'TOTAL VALUE IN WORDS :'
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
  const wLblW = doc.getTextWidth(wLbl) + 4
  doc.setFont('helvetica', 'normal')
  const wMaxW = rbX - L - wLblW - 2
  const wStr  = amountToWords(grand)
  const wLns  = doc.splitTextToSize(wStr, wMaxW)
  const wH    = Math.max(12, wLns.length * 4.5 + 4)

  doc.setLineWidth(0.2); doc.setDrawColor(...BK)
  doc.rect(L, y, useW - rbW, wH)
  doc.rect(rbX, y, rb1, wH)
  doc.rect(rbX + rb1, y, rb2, wH)

  doc.setFont('helvetica', 'bold'); doc.text(wLbl, L + 2, y + 5.5)
  doc.setFont('helvetica', 'normal'); doc.text(wLns, L + wLblW + 2, y + 5.5)
  y += wH

  const exH = 10
  doc.rect(L, y, useW - rbW, exH)
  doc.rect(rbX, y, rb1, exH)
  doc.rect(rbX + rb1, y, rb2, exH)

  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL', rbX + rb1 / 2, y + exH / 2 + 1.5, { align: 'center' })
  doc.text(fmtIN(grand),  rbX + rb1 + rb2 / 2, y + exH / 2 + 1.5, { align: 'center' })
  y += exH

  // ── Signature labels ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...BK)
  doc.text("Receiver's Signature",                                     L,        sigTextY)
  doc.text("Stamp & Signature of supplier/ authorised representative", L + useW, sigTextY, { align: 'right' })

  return doc
}

function drawTextLogo(doc, L, y, logoW, hH, BL, WH) {
  doc.setFillColor(...BL); doc.rect(L, y, logoW, hH, 'F')
  doc.setTextColor(...WH); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('WHITE', L + 3, y + 13); doc.text('GOLD', L + 5, y + 21)
}