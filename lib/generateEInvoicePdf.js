// Renders a Tally-style Tax Invoice / E-Invoice PDF.
// Matches the standard GST e-Invoice format used by accounting software.

import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

const STATE_NAMES = { '29': 'Karnataka', '32': 'Kerala', '37': 'Andhra Pradesh', '36': 'Telangana', '33': 'Tamil Nadu' }
const STATE_FROM_REGION = {
  'Andhra Pradesh': '37', 'Kerala': '32', 'Telangana': '36',
  'Tamil Nadu': '33', 'Rest of Karnataka': '29', 'Bangalore': '29',
}

const fmtIN = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Convert number to Indian words (for "Amount Chargeable in words")
function numberToIndianWords(num) {
  if (num == null || isNaN(num)) return ''
  const n = Math.floor(Math.abs(Number(num)))
  const paise = Math.round((Math.abs(Number(num)) - n) * 100)
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const twoDigits = (x) => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '')
  const threeDigits = (x) => {
    const h = Math.floor(x / 100); const r = x % 100
    return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? twoDigits(r) : '')
  }
  if (n === 0) return paise ? `Zero and ${twoDigits(paise)} Paise Only` : 'Zero Only'
  let s = n
  const crore = Math.floor(s / 10000000); s %= 10000000
  const lakh  = Math.floor(s / 100000);   s %= 100000
  const thousand = Math.floor(s / 1000);  s %= 1000
  const hundred = s
  let words = ''
  if (crore)   words += twoDigits(crore) + ' Crore '
  if (lakh)    words += twoDigits(lakh) + ' Lakh '
  if (thousand) words += twoDigits(thousand) + ' Thousand '
  if (hundred) words += threeDigits(hundred)
  words = words.trim().replace(/\s+/g, ' ')
  return paise
    ? `INR ${words} and ${twoDigits(paise)} Paise Only`
    : `INR ${words} Only`
}

export async function generateEInvoicePdf({ consignment, branch, items, companySettings, irn, ackNo, ackDt, signedQrCode }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const H = 297
  const M = 10

  const cs = companySettings || {}

  // ── Compute values ──
  const isInternal   = consignment?.movement_type === 'INTERNAL'
  const sc           = consignment?.state_code || 'KA'
  const isInterstate = !isInternal && sc !== 'KA'
  const upliftPct    = parseFloat(cs.value_uplift_pct ?? 7.5) || 0
  const igstRate     = parseFloat(cs.igst_rate        ?? 3) || 3
  // Always uses gross_weight — matches the EWB and Delivery Challan so every
  // legal artifact for one consignment carries the same weight figure.
  const totalGross   = items.reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0)
  const rawAmt       = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const assAmt       = isInterstate ? rawAmt * (1 + upliftPct / 100) : rawAmt
  const igstAmt      = isInterstate ? assAmt * (igstRate / 100) : 0
  // Tally rounds total to nearest rupee, separating round-off
  const grandRaw     = assAmt + igstAmt
  const grand        = Math.round(grandRaw)
  const roundOff     = +(grand - grandRaw).toFixed(2)
  const ratePerUnit  = totalGross > 0 ? assAmt / totalGross : 0

  // Resolve seller state code/name. Strict mapping — never silently fall back to
  // KA when state is unknown (would stamp wrong GSTIN on the invoice).
  const STATE_GSTIN_KEY = { '29': 'gstin_ka', '32': 'gstin_kl', '37': 'gstin_ap', '36': 'gstin_ts', '33': 'gstin_tn' }
  const sellerStcd = STATE_FROM_REGION[branch?.region] || sc || ''
  if (!sellerStcd || !STATE_GSTIN_KEY[sellerStcd]) {
    throw new Error(`generateEInvoicePdf: unknown state code '${sellerStcd}' for branch '${branch?.name}'. Add gstin_<code> to company_settings or fix branch.region.`)
  }
  const sellerStateName = STATE_NAMES[sellerStcd] || branch?.state || ''
  const sellerGstin = cs[STATE_GSTIN_KEY[sellerStcd]] || branch?.branch_gstin || ''
  if (!sellerGstin) {
    throw new Error(`generateEInvoicePdf: no GSTIN configured for state '${sellerStcd}'. Set company_settings.${STATE_GSTIN_KEY[sellerStcd]}.`)
  }

  // Resolve HO state
  const hoGstin = cs.gstin || cs.gstin_ka || ''
  const hoStcd  = (hoGstin || '').slice(0, 2) || '29'
  const hoStateName = STATE_NAMES[hoStcd] || cs.head_office_state || 'Karnataka'

  // ── Drawing helpers ──
  const drawText = (x, y, text, opts = {}) => {
    if (opts.bold) doc.setFont('helvetica', 'bold')
    else doc.setFont('helvetica', 'normal')
    if (opts.size) doc.setFontSize(opts.size)
    if (opts.color) doc.setTextColor(...opts.color)
    else doc.setTextColor(0, 0, 0)
    doc.text(String(text || ''), x, y, { align: opts.align || 'left' })
  }

  // Largest font size at which `text` fits in `maxWidth` on a single line.
  // Steps down by 0.25pt; returns `minSize` if even that doesn't fit.
  const fitFontSize = (text, maxWidth, baseSize, minSize = 5.5) => {
    const s = String(text || '')
    if (!s.trim()) return baseSize
    for (let size = baseSize; size >= minSize; size -= 0.25) {
      doc.setFontSize(size)
      if (doc.getTextWidth(s) <= maxWidth) return size
    }
    return minSize
  }

  // Fit text into a fixed box (width × maxLines). Picks the largest font size
  // at which splitTextToSize yields ≤ maxLines lines. If even minSize overflows,
  // truncates the overflow lines so the box never bleeds.
  const fitTextBox = (text, maxWidth, maxLines, baseSize, minSize = 5.5) => {
    const s = String(text || '').trim()
    if (!s) return { lines: [], fontSize: baseSize }
    for (let size = baseSize; size >= minSize; size -= 0.25) {
      doc.setFontSize(size)
      const lines = doc.splitTextToSize(s, maxWidth)
      if (lines.length <= maxLines) return { lines, fontSize: size }
    }
    doc.setFontSize(minSize)
    return { lines: doc.splitTextToSize(s, maxWidth).slice(0, maxLines), fontSize: minSize }
  }

  // ── Top header bar ──
  doc.setLineWidth(0.3)
  doc.setDrawColor(0, 0, 0)
  let y = M
  // Outer box
  doc.rect(M, y, W - 2 * M, H - 2 * M)

  // Title row
  drawText(W / 2, y + 7, 'Tax Invoice', { size: 13, bold: true, align: 'center' })
  drawText(W - M - 3, y + 7, 'e-Invoice', { size: 9, bold: true, align: 'right' })
  doc.line(M, y + 10, W - M, y + 10)
  y += 10

  // ── IRN / Ack block + QR code ──
  // QR sized to NIC IRP recommendation: ≥2 cm, errorCorrectionLevel 'M' (≈15%
  // damage tolerance), with a quiet zone (margin: 1) so phone scanners can
  // detect the finder pattern reliably. 26 mm at 300 px source keeps the print
  // resolution well above the 200 DPI scan threshold.
  const irnBlockH = 28
  const qrSize = 26
  doc.line(W - M - qrSize - 2, y, W - M - qrSize - 2, y + irnBlockH)  // QR cell separator
  drawText(M + 2, y + 5, 'IRN', { size: 8, bold: true })
  drawText(M + 18, y + 5, ': ' + (irn || ''), { size: 6.5 })
  drawText(M + 2, y + 11, 'Ack No.', { size: 8, bold: true })
  drawText(M + 18, y + 11, ': ' + (ackNo || ''), { size: 8 })
  drawText(M + 2, y + 17, 'Ack Date', { size: 8, bold: true })
  drawText(M + 18, y + 17, ': ' + (ackDt || ''), { size: 8 })

  if (signedQrCode) {
    try {
      const qrDataUrl = await QRCode.toDataURL(String(signedQrCode), { errorCorrectionLevel: 'M', margin: 1, width: 300 })
      doc.addImage(qrDataUrl, 'PNG', W - M - qrSize - 1, y + 1, qrSize, qrSize)
    } catch {}
  }
  doc.line(M, y + irnBlockH, W - M, y + irnBlockH)
  y += irnBlockH

  // ── Three-column layout: Left = parties, Right = doc details ──
  const leftColW   = (W - 2 * M) * 0.55
  const rightColX  = M + leftColW
  const rightColW  = W - 2 * M - leftColW
  doc.line(rightColX, y, rightColX, y + 80)  // vertical divider for parties/doc-details

  // Right side — invoice details mini-table.
  // Truncate long invoice numbers so they don't overflow into the next cell.
  const truncFit = (s, max) => {
    s = String(s || '')
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  }
  const dateStr = new Date(consignment.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  // Each row carries an optional `valSize` so long values (full invoice number)
  // get a smaller font to fit without truncation; short values stay readable.
  const detailRows = [
    // Invoice No = the per-state E-Invoice DocNo issued at generation time
    // (WG/{STATE}/{FY}/{SEQ}). Falls back to the legacy challan number for
    // pre-migration rows that don't have einvoice_doc_no populated.
    ['Invoice No.',                consignment.einvoice_doc_no || consignment.consignment_no || consignment.tmp_prf_no || '', 'Dated', dateStr, 6.5],
    ['Delivery Note',              '',                                                          'Mode/Terms of Payment', ''],
    ['Reference No. & Date.',      `${consignment.tmp_prf_no || ''} dt. ${dateStr}`,            'Other References', ''],
    ['Buyer\'s Order No.',         '',                                                          'Dated',                ''],
    ['Dispatch Doc No.',           '',                                                          'Delivery Note Date',   ''],
    ['Dispatched through',         truncFit(cs.transportation_mode || '', 22),                  'Destination', truncFit(cs.head_office_city || 'Bengaluru', 22)],
  ]
  const detailRowH = 80 / detailRows.length / 2
  let dY = y
  const halfW = rightColW / 2
  for (const [l1, v1, l2, v2, valSize] of detailRows) {
    drawText(rightColX + 2, dY + 3, l1, { size: 7, color: [80, 80, 80] })
    drawText(rightColX + 2, dY + 7.5, v1, { size: valSize || 7.5, bold: true })
    doc.line(rightColX + halfW, dY, rightColX + halfW, dY + detailRowH * 2)
    drawText(rightColX + halfW + 2, dY + 3, l2, { size: 7, color: [80, 80, 80] })
    drawText(rightColX + halfW + 2, dY + 7.5, v2, { size: 7.5, bold: true })
    if (dY + detailRowH * 2 < y + 80) doc.line(rightColX, dY + detailRowH * 2, W - M, dY + detailRowH * 2)
    dY += detailRowH * 2
  }

  // ── Address-block renderer ──────────────────────────────────────────────
  // Renders {company name, branch label, address (auto-wrapped, auto-shrunk),
  // city/PIN, GSTIN, state} into a fixed-height box. Auto-fits the address
  // into up to 3 lines (down to 6pt) so long Anantapur-style addresses don't
  // overflow, and short addresses don't leave awkward gaps. Vertically
  // distributes content so the box looks balanced regardless of how many
  // address lines the auto-fit produced.
  const renderPartyBlock = ({
    blockY, blockH, label, companyName, line2, addressText, city, pin,
    gstinLabel, gstinValue, stateName, stateCode, maxAddrLines = 3,
  }) => {
    const innerW = leftColW - 4
    const fit    = fitTextBox(addressText, innerW, maxAddrLines, 7.5, 6)
    const cityLn = city || pin ? `${city || ''}${city && pin ? ' - ' : ''}${pin || ''}` : ''
    const stateLn = stateName ? `State Name: ${stateName}${stateCode ? `, Code: ${stateCode}` : ''}` : ''

    // Stack: optional label, company name, optional line2, addr lines, city, gstin, state.
    const stack = []
    if (label)        stack.push({ text: label,        size: 7,   color: [80, 80, 80], gap: 4 })
    stack.push({ text: companyName,                    size: 9,   bold: true,           gap: 4 })
    if (line2)        stack.push({ text: line2,        size: 7.5,                       gap: 3.5 })
    for (const ln of fit.lines) stack.push({ text: ln, size: fit.fontSize,              gap: fit.fontSize <= 6 ? 3 : 3.5 })
    if (cityLn)       stack.push({ text: cityLn,       size: 7.5,                       gap: 3.5 })
    stack.push({ text: `${gstinLabel}: ${gstinValue}`, size: 7.5, bold: true,            gap: 3.5 })
    if (stateLn)      stack.push({ text: stateLn,      size: 7,                         gap: 3.5 })

    // If the natural stack underfills the box, distribute the slack as a top
    // pad so the block feels centred rather than top-loaded with empty bottom.
    const totalH    = stack.reduce((s, e) => s + e.gap, 2)  // 2mm bottom buffer
    const padTop    = Math.max(0, (blockH - totalH) / 2) + 4

    let cy = blockY + padTop
    for (const e of stack) {
      drawText(M + 2, cy, e.text, { size: e.size, bold: e.bold, color: e.color })
      cy += e.gap
    }
  }

  // Left side — Seller block (top third)
  const sellerH = 32
  renderPartyBlock({
    blockY:      y,
    blockH:      sellerH,
    companyName: cs.company_name || 'White Gold Bullion Pvt Ltd',
    line2:       branch?.name || '',
    addressText: branch?.address || '',
    city:        branch?.city,
    pin:         branch?.pin_code,
    gstinLabel:  'GSTIN/UIN',
    gstinValue:  sellerGstin,
    stateName:   sellerStateName,
    stateCode:   sellerStcd,
    maxAddrLines: 3,
  })
  doc.line(M, y + sellerH, rightColX, y + sellerH)

  // Left side — Consignee (Ship to)
  const consigneeY = y + sellerH
  const consigneeH = 24
  renderPartyBlock({
    blockY:      consigneeY,
    blockH:      consigneeH,
    label:       'Consignee (Ship to)',
    companyName: cs.company_name || 'White Gold Bullion Pvt Ltd',
    line2:       cs.head_office_building || '',
    addressText: cs.head_office_address || '',
    city:        cs.head_office_city,
    pin:         cs.head_office_pin,
    gstinLabel:  'GSTIN/UIN',
    gstinValue:  hoGstin,
    maxAddrLines: 2,
  })
  doc.line(M, consigneeY + consigneeH, rightColX, consigneeY + consigneeH)

  // Left side — Buyer (Bill to)
  const buyerY = consigneeY + consigneeH
  const buyerH = 80 - sellerH - consigneeH
  renderPartyBlock({
    blockY:      buyerY,
    blockH:      buyerH,
    label:       'Buyer (Bill to)',
    companyName: cs.company_name || 'White Gold Bullion Pvt Ltd',
    line2:       cs.head_office_building || '',
    addressText: cs.head_office_address || '',
    city:        cs.head_office_city,
    pin:         cs.head_office_pin,
    gstinLabel:  'GSTIN/UIN',
    gstinValue:  hoGstin,
    stateName:   hoStateName,
    stateCode:   hoStcd,
    maxAddrLines: 2,
  })

  y += 80
  doc.line(M, y, W - M, y)

  // ── Items table header ──
  const colDef = [
    { label: 'Sl\nNo.',                 w: 9,  align: 'center' },
    { label: 'Description of Goods',    w: 60, align: 'left'   },
    { label: 'HSN/SAC',                 w: 18, align: 'center' },
    { label: 'Quantity',                w: 22, align: 'center' },
    { label: 'Rate',                    w: 22, align: 'right'  },
    { label: 'per',                     w: 12, align: 'center' },
    { label: 'Amount',                  w: W - 2 * M - 9 - 60 - 18 - 22 - 22 - 12, align: 'right' },
  ]
  const headerH = 9
  let cx = M
  for (const c of colDef) {
    doc.rect(cx, y, c.w, headerH)
    const lines = c.label.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const tx = c.align === 'right'  ? cx + c.w - 1
              : c.align === 'center' ? cx + c.w / 2
              : cx + 1
      drawText(tx, y + 4 + i * 3.5, lines[i], { size: 7.5, bold: true, align: c.align })
    }
    cx += c.w
  }
  y += headerH

  // Items shown as a single aggregated line. NIC IRP allows aggregation, the
  // per-bill manifest lives in the Consignee Report, and gold-trading
  // consignments are by nature bulk movements of one HSN. Description is kept
  // short so it never bleeds into the HSN column — bill count belongs in the
  // Consignee Report, not on the invoice line.
  const itemRowH = 8
  cx = M
  const aggregateDesc = cs.product_name || 'Used Gold Ornaments'
  const itemValues = [
    '1',
    aggregateDesc,
    cs.hsn_code || '711319',
    `${totalGross.toFixed(2)} Gms`,
    fmtIN(ratePerUnit),
    'Gms',
    fmtIN(assAmt),
  ]
  for (let i = 0; i < colDef.length; i++) {
    const c = colDef[i]
    const tx = c.align === 'right'  ? cx + c.w - 1
            : c.align === 'center' ? cx + c.w / 2
            : cx + 1
    // Auto-shrink the description (col 1) if it ever exceeds the column.
    // Other cols hold short numeric strings — keep the fixed 8pt.
    const baseSize = 8
    const cellSize = i === 1 ? fitFontSize(itemValues[i], c.w - 2, baseSize, 6) : baseSize
    drawText(tx, y + 5, itemValues[i], { size: cellSize, bold: i === 1, align: c.align })
    cx += c.w
  }
  y += itemRowH

  // Tax sub-rows — all amounts right-aligned to the Amount column edge.
  const amountX = W - M - 1
  const ratePerX = M + colDef[0].w + colDef[1].w + colDef[2].w + colDef[3].w + colDef[4].w / 2  // center of "Rate"
  const perX     = M + colDef[0].w + colDef[1].w + colDef[2].w + colDef[3].w + colDef[4].w + colDef[5].w / 2  // center of "per"
  const descTextX = M + colDef[0].w + 2

  if (isInterstate) {
    // "Output IGST - 3%" label spans Description col, indented in italic-bold style
    drawText(descTextX, y + 5, `Output IGST - ${igstRate}%`, { size: 8, bold: true })
    drawText(perX, y + 5, `${igstRate} %`, { size: 8, align: 'center' })
    drawText(amountX, y + 5, fmtIN(igstAmt), { size: 8, bold: true, align: 'right' })
    y += itemRowH
  }

  if (Math.abs(roundOff) > 0.005) {
    drawText(descTextX, y + 5, 'Less : Round Off', { size: 8 })
    drawText(amountX, y + 5, `(-)${fmtIN(Math.abs(roundOff))}`, { size: 8, align: 'right' })
    y += itemRowH
  }

  // Compact: only ONE blank spacer row for visual breathing room (Tally style).
  // No more 5+ empty rows pushing the Total to the bottom of the page.
  y += itemRowH * 1.5

  // Vertical column separators down the items area (from header start to bottom)
  const itemsTopY = y - (
    1                                     // main product row
    + (isInterstate ? 1 : 0)              // IGST row
    + (Math.abs(roundOff) > 0.005 ? 1 : 0)// Round-off row
  ) * itemRowH - itemRowH * 1.5            // spacer
  cx = M
  for (let i = 0; i < colDef.length - 1; i++) {
    cx += colDef[i].w
    doc.line(cx, itemsTopY, cx, y)
  }

  // Total row
  doc.line(M, y, W - M, y)
  drawText(M + colDef[0].w + colDef[1].w / 2, y + 5, 'Total', { size: 8.5, bold: true, align: 'center' })
  drawText(M + colDef[0].w + colDef[1].w + colDef[2].w + colDef[3].w / 2, y + 5, `${totalGross.toFixed(2)} Gms`, { size: 8.5, bold: true, align: 'center' })
  // Use 'Rs.' instead of '₹' since helvetica doesn't render the rupee glyph reliably
  drawText(amountX, y + 5, `Rs. ${fmtIN(grand)}`, { size: 9, bold: true, align: 'right' })
  cx = M
  for (let i = 0; i < colDef.length - 1; i++) {
    cx += colDef[i].w
    doc.line(cx, y, cx, y + itemRowH)
  }
  y += itemRowH
  doc.line(M, y, W - M, y)

  // ── Amount in words ──
  const wordsRowH = 9
  drawText(M + 2, y + 4, 'Amount Chargeable (in words)', { size: 7, color: [80, 80, 80] })
  drawText(W - M - 2, y + 4, 'E. & O.E', { size: 7, color: [80, 80, 80], align: 'right' })
  drawText(M + 2, y + 8, numberToIndianWords(grand), { size: 8.5, bold: true })
  y += wordsRowH
  doc.line(M, y, W - M, y)

  // ── HSN/SAC tax breakdown ──
  const hsnHeaderH = 7
  // First header row: HSN/SAC | Taxable Value | IGST | Total Tax Amount
  // Sub headers: Rate | Amount under IGST
  const hsnCols = [
    { label: 'HSN/SAC',       w: 30, align: 'center' },
    { label: 'Taxable\nValue', w: 35, align: 'center' },
    { label: 'IGST',          w: 60, align: 'center' },  // split into Rate + Amount
    { label: 'Total\nTax Amount', w: W - 2 * M - 30 - 35 - 60, align: 'center' },
  ]
  cx = M
  for (const c of hsnCols) {
    doc.rect(cx, y, c.w, hsnHeaderH * 2)
    const lines = c.label.split('\n')
    for (let i = 0; i < lines.length; i++) {
      drawText(cx + c.w / 2, y + 4 + i * 3, lines[i], { size: 7.5, bold: true, align: 'center' })
    }
    cx += c.w
  }
  // Split IGST column into Rate / Amount sub-headers (lower row)
  const igstX = M + hsnCols[0].w + hsnCols[1].w
  const igstW = hsnCols[2].w
  doc.line(igstX, y + hsnHeaderH, igstX + igstW, y + hsnHeaderH)
  doc.line(igstX + igstW / 2, y + hsnHeaderH, igstX + igstW / 2, y + hsnHeaderH * 2)
  drawText(igstX + igstW / 4, y + hsnHeaderH + 4.5, 'Rate', { size: 7.5, bold: true, align: 'center' })
  drawText(igstX + igstW * 3 / 4, y + hsnHeaderH + 4.5, 'Amount', { size: 7.5, bold: true, align: 'center' })
  y += hsnHeaderH * 2

  // HSN data + total rows. IGST split into Rate sub-col (left half of igstW)
  // and Amount sub-col (right half of igstW). Right-align amount to right
  // edge of the Amount sub-col, NOT the divider — that was the previous bug.
  const igstRateRightX   = igstX + igstW / 2 - 2  // right edge of Rate sub-col
  const igstAmountRightX = igstX + igstW - 2      // right edge of Amount sub-col
  const drawHsnRow = (vals, bold) => {
    const hsnRowH = 7
    doc.rect(M, y, W - 2 * M, hsnRowH)
    // verticals
    let lx = M
    doc.line(lx + hsnCols[0].w, y, lx + hsnCols[0].w, y + hsnRowH)
    doc.line(lx + hsnCols[0].w + hsnCols[1].w, y, lx + hsnCols[0].w + hsnCols[1].w, y + hsnRowH)
    doc.line(igstX + igstW / 2, y, igstX + igstW / 2, y + hsnRowH)
    doc.line(igstX + igstW, y, igstX + igstW, y + hsnRowH)
    // values: HSN | Taxable | Rate | Amount | TotalTax
    drawText(M + hsnCols[0].w / 2,                        y + 4.5, vals[0], { size: 8, bold, align: 'center' })
    drawText(M + hsnCols[0].w + hsnCols[1].w - 2,         y + 4.5, vals[1], { size: 8, bold, align: 'right' })
    drawText(igstRateRightX,                              y + 4.5, vals[2], { size: 8, bold, align: 'right' })
    drawText(igstAmountRightX,                            y + 4.5, vals[3], { size: 8, bold, align: 'right' })
    drawText(W - M - 2,                                   y + 4.5, vals[4], { size: 8, bold, align: 'right' })
    y += hsnRowH
  }
  drawHsnRow([
    cs.hsn_code || '711319',
    fmtIN(assAmt),
    isInterstate ? `${igstRate}%` : '0%',
    fmtIN(igstAmt),
    fmtIN(igstAmt),
  ], false)
  drawHsnRow([
    'Total',
    fmtIN(assAmt),
    '',
    fmtIN(igstAmt),
    fmtIN(igstAmt),
  ], true)

  // Tax amount in words
  const taxWordsH = 8
  drawText(M + 2, y + 4.5, 'Tax Amount (in words)  :', { size: 7.5, bold: true })
  drawText(M + 42, y + 4.5, numberToIndianWords(igstAmt), { size: 8 })
  y += taxWordsH
  doc.line(M, y, W - M, y)

  // ── Declaration + Signatory (two columns) ──
  const declH = 22
  doc.line(M + (W - 2 * M) * 0.65, y, M + (W - 2 * M) * 0.65, y + declH)
  drawText(M + 2, y + 4, 'Declaration', { size: 7.5, bold: true })
  const declLines = [
    'We declare that this invoice shows the actual price of the',
    'goods described and that all particulars are true and',
    'correct.',
  ]
  for (let i = 0; i < declLines.length; i++) {
    drawText(M + 2, y + 8.5 + i * 3.5, declLines[i], { size: 7.5 })
  }
  // Right side — for / Authorised Signatory
  const signX = M + (W - 2 * M) * 0.65 + 2
  drawText(W - M - 2, y + 4, `for ${cs.company_name || 'White Gold Bullion Pvt Ltd'}`, { size: 8, bold: true, align: 'right' })
  drawText(W - M - 2, y + declH - 3, 'Authorised Signatory', { size: 8, align: 'right' })
  y += declH
  doc.line(M, y, W - M, y)

  // Footer
  drawText(W / 2, y + 5, 'This is a Computer Generated Invoice', { size: 7, align: 'center', color: [100, 100, 100] })

  return Buffer.from(doc.output('arraybuffer'))
}
