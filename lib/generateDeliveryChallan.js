// lib/generateDeliveryChallan.js
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Number to words ───────────────────────────────────────────────────────────
function numberToWords(num) {
  if (num === 0) return 'ZERO'
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  function b100(n) { return n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') }
  function b1000(n) { return n < 100 ? b100(n) : ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + b100(n % 100) : '') }
  let r = '', n = num
  if (n >= 10000000) { r += b100(Math.floor(n / 10000000)) + ' CRORE ';  n %= 10000000 }
  if (n >= 100000)   { r += b100(Math.floor(n / 100000))  + ' LACS ';   n %= 100000 }
  if (n >= 1000)     { r += b1000(Math.floor(n / 1000))   + ' THOUSAND '; n %= 1000 }
  if (n > 0)         { r += b1000(n) }
  return r.trim()
}

function amountToWords(amount) {
  const rupees = Math.floor(amount)
  const paise  = Math.round((amount - rupees) * 100)
  let result   = 'RUPEES ' + numberToWords(rupees)
  if (paise > 0) result += ' AND ' + numberToWords(paise) + ' PAISAS'
  return result + ' ONLY'
}

// ── State mappings (all states where WG operates) ─────────────────────────────
const GST_NUM   = { KA: '29', KL: '32', AP: '37', TS: '36', TN: '33' }
const STATE_NAME = {
  KA: 'KARNATAKA', KL: 'KERALA', AP: 'ANDHRA PRADESH', TS: 'TELANGANA', TN: 'TAMIL NADU',
}

// ── Main generator ────────────────────────────────────────────────────────────
// logoBase64: raw base64 string of PNG logo (no data: prefix), optional
export function generateDeliveryChallan({ consignment, branch, companySettings, items, logoBase64 }) {
  const doc  = new jsPDF('p', 'mm', 'a4')
  const L = 10, R = 10
  const useW  = 210 - L - R   // 190mm
  const halfW = useW / 2      // 95mm

  // ── Color palette ─────────────────────────────────────────────────────────
  const BLACK = [0, 0, 0]
  const WHITE = [255, 255, 255]
  const BLUE  = [0, 51, 153]
  const RED   = [180, 20, 20]
  const GRAY  = [130, 130, 130]
  const LGRAY = [210, 210, 210]

  // ── Derived values ────────────────────────────────────────────────────────
  const sc        = consignment.state_code || 'KA'
  const gstNum    = GST_NUM[sc]   || '29'
  const stateName = (branch?.state || STATE_NAME[sc] || 'KARNATAKA').toUpperCase()

  // Branch GSTIN: branch record → state-specific company setting → blank
  const branchGSTIN = branch?.branch_gstin
    || companySettings[`gstin_${sc.toLowerCase()}`]
    || ''
  const branchPAN   = companySettings.pan
    || (branchGSTIN.length >= 12 ? branchGSTIN.substring(2, 12) : '')

  // Rates from company settings
  const igstRate   = parseFloat(companySettings.igst_rate      || 3)
  const upliftPct  = parseFloat(companySettings.value_uplift_pct || 7.5)
  const isInterstate = sc !== 'KA'

  // HO details
  const hoGSTIN = companySettings.gstin || ''
  const hoState = (companySettings.head_office_state || 'KARNATAKA').toUpperCase()

  const fmtIN = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const dateStr = new Date(consignment.created_at)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    .toUpperCase().replace(/ /g, '-')

  let y = 10

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  const hH    = 30    // header height
  const logoW = 32    // logo column width
  const copyW = 52    // copy-label column width
  const titleW = useW - logoW - copyW    // title column width
  const titleCX = L + logoW + titleW / 2
  const copyX   = L + logoW + titleW

  // ── Logo area ──────────────────────────────────────────────────────────────
  if (logoBase64) {
    // White background, then logo image centered
    doc.setFillColor(...WHITE)
    doc.rect(L, y, logoW, hH, 'F')
    try {
      // Pad image 2mm inside the box, centered
      const imgX = L + 2, imgY = y + 2, imgW = logoW - 4, imgH = hH - 4
      doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', imgX, imgY, imgW, imgH)
    } catch {
      // fallback to text logo if image fails
      doc.setFillColor(...BLUE)
      doc.rect(L, y, logoW, hH, 'F')
      doc.setTextColor(...WHITE)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text('WHITE', L + 4, y + 13)
      doc.text('GOLD',  L + 6, y + 21)
    }
  } else {
    doc.setFillColor(...BLUE)
    doc.rect(L, y, logoW, hH, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('WHITE', L + 4, y + 13)
    doc.text('GOLD',  L + 6, y + 21)
  }

  // ── Title area ─────────────────────────────────────────────────────────────
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  const titleStr = 'DELIVERY CHALLAN/ISSUE VOUCHER'
  doc.text(titleStr, titleCX, y + 8, { align: 'center' })
  // Underline title
  const tw = doc.getTextWidth(titleStr)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.5)
  doc.line(titleCX - tw / 2, y + 9.5, titleCX + tw / 2, y + 9.5)
  doc.setLineWidth(0.3)

  // Tamper proof: label in black, WG number in bold red
  doc.setFontSize(9.5)
  const tpLabel = 'TAMPER PROOF No:-  '
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...BLACK)
  const tpLabelW = doc.getTextWidth(tpLabel)
  doc.setFont('helvetica', 'bold')
  const tpValW = doc.getTextWidth(consignment.tmp_prf_no || '')
  const tpX = titleCX - (tpLabelW + tpValW) / 2
  doc.setFont('helvetica', 'normal')
  doc.text(tpLabel, tpX, y + 18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...RED)
  doc.text(consignment.tmp_prf_no || '', tpX + tpLabelW, y + 18)
  doc.setTextColor(...BLACK)

  // Rule reference
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...GRAY)
  doc.text('(REFER RULE 55 TO CGST ACT)', titleCX, y + 25, { align: 'center' })
  doc.setTextColor(...BLACK)

  // ── Copy labels ────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...BLACK)
  ;['ORIGINAL FOR CONSIGNEE', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR CONSIGNOR'].forEach((lbl, i) => {
    doc.text(lbl, copyX + 3, y + hH * (i + 0.65) / 3)
  })

  // ── Header borders ─────────────────────────────────────────────────────────
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(L, y, useW, hH)
  doc.line(L + logoW, y, L + logoW, y + hH)
  doc.line(copyX,     y, copyX,     y + hH)
  doc.line(copyX, y + hH / 3,     L + useW, y + hH / 3)
  doc.line(copyX, y + hH * 2 / 3, L + useW, y + hH * 2 / 3)

  y += hH

  // ═══════════════════════════════════════════════════════════════════════════
  // INFO ROWS (4 rows, 2 columns each)
  // ═══════════════════════════════════════════════════════════════════════════
  const irH    = 5.5
  const irLblW = 42
  const infoRows = [
    ['DELIVERY CHALLAN NO',   consignment.challan_no || '',   'TRASNPORTER NAME',    companySettings.transporter_name   || 'BVC LOGISTICS PVT. LTD.'],
    ['DELIVERY CHALLAN DATE', dateStr,                        'TRANSPORTATION MODE',  companySettings.transportation_mode || 'BY AIR & ROAD'],
    ['STATE',                 stateName,                      'PLACE OF SUPPLY',     stateName],
    ['STATE CODE',            gstNum,                         'VEHICLE NO.',         ''],
  ]

  doc.setLineWidth(0.2)
  infoRows.forEach(([ll, lv, rl, rv], i) => {
    const ry = y + i * irH
    doc.setDrawColor(...BLACK)
    doc.rect(L,        ry, halfW, irH)
    doc.rect(L + halfW, ry, halfW, irH)
    const ty = ry + irH * 0.73
    doc.setFontSize(7.5)
    doc.setTextColor(...BLACK)

    doc.setFont('helvetica', 'bold'); doc.text(ll, L + 2,        ty)
    doc.setFont('helvetica', 'bold'); doc.text(rl, L + halfW + 2, ty)

    if (i === 0) {
      // Challan NO: everything before last slash in black, last segment (ext no) in bold red
      const parts  = (lv || '').split('/')
      const extSeg = parts.pop()
      const prefix = ': ' + parts.join('/') + '/ '
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...BLACK)
      doc.text(prefix, L + irLblW, ty)
      const prefW = doc.getTextWidth(prefix)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...RED)
      doc.text(extSeg, L + irLblW + prefW, ty)
      doc.setTextColor(...BLACK)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...BLACK)
      doc.text(': ' + lv, L + irLblW, ty)
    }
    doc.setFont('helvetica', 'normal')
    doc.text(': ' + rv, L + halfW + irLblW, ty)
  })

  y += 4 * irH

  // ═══════════════════════════════════════════════════════════════════════════
  // BILL FROM / CONSIGNEE  (dynamic height based on address length)
  // ═══════════════════════════════════════════════════════════════════════════
  const lLblW = 38
  const lValX = L + lLblW + 1
  const rLblW = 22
  const rValX = L + halfW + rLblW + 1
  const bY    = y

  // ── Build branch address with dynamic font sizing ─────────────────────────
  const addrRaw = [
    branch?.address,
    branch?.city,
    [branch?.state?.toUpperCase(), branch?.pin_code].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ') + ', INDIA'

  const addrAvailW = halfW - lLblW - 5  // mm available for address text

  let addrFontSz = 7.5
  let addrLines  = doc.splitTextToSize(addrRaw, addrAvailW)
  if (addrLines.length > 4) { addrFontSz = 6.5; addrLines = doc.setFontSize(6.5) && doc.splitTextToSize(addrRaw, addrAvailW) }
  if (addrLines.length > 5) { addrFontSz = 6;   addrLines = doc.setFontSize(6)   && doc.splitTextToSize(addrRaw, addrAvailW) }
  if (addrLines.length > 6) addrLines = addrLines.slice(0, 6)  // hard cap at 6 lines
  const addrLineH = addrFontSz <= 6 ? 3 : addrFontSz <= 6.5 ? 3.5 : 4

  // addrEnd = y-offset where address block ends (relative to bY)
  const addrEnd = 15 + addrLines.length * addrLineH + 2

  // ── HO address lines ──────────────────────────────────────────────────────
  const hoLines = [
    (companySettings.company_name || '') + '-BENGALURU',
    companySettings.head_office_building || '',
    companySettings.head_office_address  || '',
    [companySettings.head_office_city,
      (companySettings.head_office_state || '') + '-' + (companySettings.head_office_pin || '')]
      .filter(Boolean).join(','),
  ].filter(l => l && l.trim())

  // Right-side offsets
  const rOff = 10 + hoLines.length * 4 + 4   // where STATE row starts on right
  const rEnd  = rOff + 33                      // bottom of right content

  // Left-side max offset
  const lEnd = addrEnd + 42

  const billH = Math.max(lEnd, rEnd) + 8   // dynamic height + bottom padding

  // Draw main box and vertical divider
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(L, y, useW, billH)
  doc.line(L + halfW, y, L + halfW, y + billH)

  // ── LEFT SIDE helpers ─────────────────────────────────────────────────────
  function lf(label, value, off, sz) {
    doc.setFontSize(sz || 7.5)
    doc.setTextColor(...BLACK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + 2, bY + off)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + (value || ''), lValX - 1, bY + off)
  }

  doc.setFontSize(7.5)
  lf('BILL FROM',           (companySettings.company_name || '') + '    ' + (branch?.name || ''), 5)
  lf('CONTACT PERSON',      (branch?.contact_person || '') + (branch?.contact_phone ? '   ' + branch.contact_phone : ''), 10)

  // ADDRESS (multi-line, dynamic font)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold');   doc.text('ADDRESS', L + 2, bY + 15)
  doc.setFont('helvetica', 'normal'); doc.text(':', lValX - 1, bY + 15)
  doc.setFontSize(addrFontSz)
  doc.text(addrLines, lValX + 1, bY + 15)
  doc.setFontSize(7.5)   // reset

  lf('STATE CODE',           gstNum,           addrEnd + 2)
  lf('GSTIN',                branchGSTIN,       addrEnd + 7)
  lf('DISPATCH FROM',        '',                addrEnd + 12)
  lf('CONTACT PERSON',       '',                addrEnd + 17)
  lf('Co. Name and address', '',                addrEnd + 22)
  lf('STATE CODE',           '',                addrEnd + 32)
  lf('PAN/AADHAR',           branchPAN,         addrEnd + 37)
  lf('PURPOSE OF MOVEMENT',  'STOCK TRANSFER',  addrEnd + 42)

  // ── RIGHT SIDE helper ─────────────────────────────────────────────────────
  function rf(label, value, off) {
    doc.setFontSize(7.5)
    doc.setTextColor(...BLACK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + halfW + 2, bY + off)
    doc.setFont('helvetica', 'normal')
    if (value) doc.text(': ' + value, rValX - 1, bY + off)
    else       doc.text(':',          rValX - 1, bY + off)
  }

  // Consignee header (bold, no colon)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...BLACK)
  doc.text('CONSIGNEE ADDRESS :', L + halfW + 2, bY + 5)

  // HO address block (normal weight)
  doc.setFont('helvetica', 'normal')
  hoLines.forEach((line, i) => doc.text(line, L + halfW + 4, bY + 10 + i * 4))

  rf('STATE',      hoState,   rOff)
  rf('STATE CODE', '29',      rOff + 5)
  rf('GSTIN',      hoGSTIN,   rOff + 10)
  rf('CONSIGNEE',  '(DELIVERY ADDRESS- IF NOT SAME)', rOff + 18)
  rf('Co.NAME',    '',        rOff + 23)
  rf('ADDRESS',    '',        rOff + 28)
  rf('GSTIN',      '',        rOff + 33)

  // ── Thin horizontal divider lines ─────────────────────────────────────────
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.1)
  ;[5, 10, 15, addrEnd + 2, addrEnd + 7, addrEnd + 12, addrEnd + 17, addrEnd + 22, addrEnd + 32, addrEnd + 37].forEach(off => {
    doc.line(L,        bY + off, L + halfW, bY + off)
  })
  ;[5, rOff, rOff + 5, rOff + 10, rOff + 18, rOff + 23, rOff + 28].forEach(off => {
    doc.line(L + halfW, bY + off, L + useW, bY + off)
  })

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)

  y += billH + 1

  // ═══════════════════════════════════════════════════════════════════════════
  // ITEMS TABLE
  // ═══════════════════════════════════════════════════════════════════════════
  const totalNetWt  = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const totalAmount = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const rate        = totalNetWt > 0 ? totalAmount / totalNetWt : 0

  const valueOfGoods = isInterstate ? totalAmount * (1 + upliftPct / 100) : totalAmount
  const igst         = isInterstate ? valueOfGoods * (igstRate / 100) : 0
  const grandTotal   = valueOfGoods + igst

  const emptyRow = ['', '', '', '', '', '']
  const bodyRows = [
    ['1', `USED GOLD ORNAMENTS-${sc}`,
      companySettings.hsn_code || '711319',
      totalNetWt.toFixed(2),
      fmtIN(rate),
      fmtIN(totalAmount)],
    ...Array(10).fill(emptyRow),
  ]

  const footRows = isInterstate
    ? [
        ['', '', '', '', 'VALUE OF GOODS',          fmtIN(valueOfGoods)],
        ['', '', '', '', `IGST @ ${igstRate}%`,     fmtIN(igst)],
        ['', '', '', '', 'GRAND TOTAL',              fmtIN(grandTotal)],
      ]
    : [['', '', '', '', 'GRAND TOTAL',              fmtIN(grandTotal)]]

  autoTable(doc, {
    startY: y,
    head: [[
      'S.No.',
      'DESCRIPTION OF GOODS',
      'HSN OF\nGOODS',
      { content: 'QUANTITY/GROSS\nWEIGHT (GMS)', styles: { halign: 'center' } },
      'RATE',
      'VALUE OF GOODS',
    ]],
    body: bodyRows,
    foot: footRows,
    theme: 'grid',
    styles:     { fontSize: 7.5, cellPadding: 1.8, lineColor: BLACK, lineWidth: 0.2, textColor: BLACK },
    headStyles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'center', fontSize: 7.5 },
    footStyles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'left',   cellWidth: 72 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'right',  cellWidth: 28 },
      4: { halign: 'right',  cellWidth: 30 },
      5: { halign: 'right',  cellWidth: 30 },
    },
    didParseCell(data) {
      if (data.section === 'foot' && data.column.index === 4) data.cell.styles.halign = 'center'
      if (data.section === 'foot' && data.column.index === 5) data.cell.styles.halign = 'right'
    },
    margin: { left: L, right: R },
  })

  y = doc.lastAutoTable.finalY

  // ═══════════════════════════════════════════════════════════════════════════
  // TOTAL IN WORDS  +  GRAND TOTAL BOX
  // ═══════════════════════════════════════════════════════════════════════════
  // Right box: columns 4+5 = 30+30 = 60mm
  const rbW  = 60
  const rbX  = L + useW - rbW
  const midX = rbX + 32   // internal divider: label | value

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.2)

  // Row 1: words on left, GRAND TOTAL header on right
  const wH = 9
  doc.rect(L,   y, useW - rbW, wH)
  doc.rect(rbX, y, rbW,        wH)
  doc.line(midX, y, midX, y + wH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...BLACK)
  doc.text('TOTAL VALUE IN WORDS :', L + 2, y + 6)
  doc.setFont('helvetica', 'normal')
  const wordsStr = amountToWords(grandTotal)
  const wLines   = doc.splitTextToSize(wordsStr, useW - rbW - 50)
  doc.text(wLines, L + 50, y + 6)
  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL',         rbX + 2,        y + 6)
  doc.text(fmtIN(grandTotal),    L + useW - 2,   y + 6, { align: 'right' })
  y += wH

  // Row 2: blank left + repeated GRAND TOTAL right (for stamp / extra space)
  const exH = 18
  doc.rect(L,   y, useW - rbW, exH)
  doc.rect(rbX, y, rbW,        exH)
  doc.line(midX, y, midX, y + exH)
  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL',         rbX + 2,        y + exH - 3)
  doc.text(fmtIN(grandTotal),    L + useW - 2,   y + exH - 3, { align: 'right' })
  y += exH + 22   // gap for vehicle no / stamp area

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNATURES
  // ═══════════════════════════════════════════════════════════════════════════
  const sigH = 20
  doc.setLineWidth(0.2)
  doc.rect(L,        y, halfW, sigH)
  doc.rect(L + halfW, y, halfW, sigH)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...BLACK)
  doc.text("Receiver's Signature",                                        L + 3,         y + sigH - 3)
  doc.text("Stamp & Signature of supplier/ authorised representative",    L + halfW + 3, y + sigH - 3)

  return doc
}
