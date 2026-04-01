// lib/generateDeliveryChallan.js
import jsPDF from 'jspdf'
import 'jspdf-autotable'

function numberToWords(num) {
  if (num === 0) return 'ZERO'
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  function b100(n) { return n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') }
  function b1000(n) { return n < 100 ? b100(n) : ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + b100(n % 100) : '') }
  let r = '', n = num
  if (n >= 10000000) { r += b100(Math.floor(n / 10000000)) + ' CRORE '; n %= 10000000 }
  if (n >= 100000)   { r += b100(Math.floor(n / 100000))  + ' LAC ';   n %= 100000 }
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

const GST_NUM  = { KA: '29', KL: '32', AP: '37', TS: '36' }
const STATE_NAME = { KA: 'KARNATAKA', KL: 'KERALA', AP: 'ANDHRA PRADESH', TS: 'TELANGANA' }

export function generateDeliveryChallan({ consignment, branch, companySettings, items }) {
  const doc  = new jsPDF('p', 'mm', 'a4')
  const pageW = 210
  const L = 10, R = 10
  const useW = pageW - L - R   // 190
  const halfW = useW / 2       // 95

  const BLUE  = [0, 51, 153]
  const BLACK = [0, 0, 0]
  const GRAY  = [130, 130, 130]
  const WHITE = [255, 255, 255]
  const LGRAY = [200, 200, 200]

  const sc       = consignment.state_code || 'KA'
  const gstNum   = GST_NUM[sc]   || '29'
  const stateName = (branch?.state || STATE_NAME[sc] || 'KARNATAKA').toUpperCase()
  const branchGSTIN = branch?.branch_gstin || ''
  const branchPAN   = branchGSTIN ? branchGSTIN.substring(2, 12) : (companySettings.pan || '')
  const fmtIN = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const challanDt = new Date(consignment.created_at)
  const dateStr   = challanDt.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  }).toUpperCase().replace(/ /g, '-')   // "25-MARCH-2026"

  let y = 10

  // ── HEADER ────────────────────────────────────────────────────────────────
  const hH     = 28
  const logoW  = 28
  const copyW  = 50
  const titleW = useW - logoW - copyW   // 112
  const titleCX = L + logoW + titleW / 2  // 94 — center of title area
  const copyX   = L + logoW + titleW      // 150 — copy info starts here

  // Blue logo box
  doc.setFillColor(...BLUE)
  doc.rect(L, y, logoW, hH, 'F')
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('WHITE', L + 3, y + 10)
  doc.text('GOLD', L + 5, y + 17)

  // Copy info (3 sub-rows on right)
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text('ORIGINAL FOR CONSIGNEE',    copyX + 2, y + hH * 1 / 3 - 1)
  doc.text('DUPLICATE FOR TRANSPORTER', copyX + 2, y + hH * 2 / 3 - 1)
  doc.text('TRIPLICATE FOR CONSIGNOR',  copyX + 2, y + hH - 4)

  // Title "DELIVERY CHALLAN/ISSUE VOUCHER"
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  const titleStr = 'DELIVERY CHALLAN/ISSUE VOUCHER'
  doc.text(titleStr, titleCX, y + 8, { align: 'center' })
  const tw = doc.getTextWidth(titleStr)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.5)
  doc.line(titleCX - tw / 2, y + 9.5, titleCX + tw / 2, y + 9.5)
  doc.setLineWidth(0.3)

  // TAMPER PROOF No:- [normal] WG000xxx [bold]
  doc.setFontSize(9.5)
  const tpLabel = 'TAMPER PROOF No:-  '
  doc.setFont('helvetica', 'normal')
  const lpW = doc.getTextWidth(tpLabel)
  doc.setFont('helvetica', 'bold')
  const vpW = doc.getTextWidth(consignment.tmp_prf_no)
  const tpX = titleCX - (lpW + vpW) / 2
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.text(tpLabel, tpX, y + 17)
  doc.setFont('helvetica', 'bold')
  doc.text(consignment.tmp_prf_no, tpX + lpW, y + 17)

  // Rule ref
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...GRAY)
  doc.text('(REFER RULE 55 TO CGST ACT)', titleCX, y + 23, { align: 'center' })

  // Header borders
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(L, y, useW, hH)
  doc.line(L + logoW, y, L + logoW, y + hH)
  doc.line(copyX, y, copyX, y + hH)
  doc.line(copyX, y + hH / 3,     L + useW, y + hH / 3)
  doc.line(copyX, y + hH * 2 / 3, L + useW, y + hH * 2 / 3)

  y += hH

  // ── INFO ROWS ─────────────────────────────────────────────────────────────
  const irH      = 5.5
  const irLblW   = 42
  const infoRows = [
    ['DELIVERY CHALLAN NO',   consignment.challan_no,
      'TRASNPORTER NAME',      companySettings.transporter_name || 'BVC LOGISTICS PVT. LTD.'],
    ['DELIVERY CHALLAN DATE', dateStr,
      'TRANSPORTATION MODE',   companySettings.transportation_mode || 'BY AIR & ROAD'],
    ['STATE',                  stateName,
      'PLACE OF SUPPLY',       stateName],
    ['STATE CODE',             gstNum,
      'VEHICLE NO.',           ''],
  ]

  doc.setLineWidth(0.2)
  infoRows.forEach(([ll, lv, rl, rv], i) => {
    const ry = y + i * irH
    doc.setDrawColor(...BLACK)
    doc.rect(L, ry, halfW, irH)
    doc.rect(L + halfW, ry, halfW, irH)
    const ty = ry + irH * 0.73
    doc.setFontSize(7.5)
    doc.setTextColor(...BLACK)
    doc.setFont('helvetica', 'bold');   doc.text(ll, L + 2, ty)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + lv, L + irLblW, ty)
    doc.setFont('helvetica', 'bold');   doc.text(rl, L + halfW + 2, ty)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + rv, L + halfW + irLblW, ty)
  })

  y += 4 * irH

  // ── BILL FROM / CONSIGNEE ─────────────────────────────────────────────────
  const billH  = 80
  const lLblW  = 36    // label column width, left side
  const lValX  = L + lLblW + 1
  const rLblW  = 22    // label column width, right side
  const rValX  = L + halfW + rLblW + 1
  const bY     = y

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(L, y, useW, billH)
  doc.line(L + halfW, y, L + halfW, y + billH)

  doc.setFontSize(7.5)
  doc.setTextColor(...BLACK)

  // LEFT SIDE helper
  function lf(label, value, off) {
    const ty = bY + off
    doc.setFont('helvetica', 'bold');   doc.text(label, L + 2, ty)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + value, lValX - 1, ty)
  }

  // Build full address
  const addrParts = [branch?.address, branch?.city,
    [branch?.state?.toUpperCase(), branch?.pin_code].filter(Boolean).join(' ')
  ].filter(Boolean)
  const fullAddr  = addrParts.join(', ') + (addrParts.length ? ', INDIA' : '')
  const addrLines = doc.splitTextToSize(fullAddr, halfW - lLblW - 4)

  lf('BILL FROM',           (companySettings.company_name || '') + '    ' + (branch?.name || ''), 5)
  lf('CONTACT PERSON',      (branch?.contact_person || '') + (branch?.contact_phone ? '   ' + branch.contact_phone : ''), 10)

  // ADDRESS label + multi-line value
  doc.setFont('helvetica', 'bold');   doc.text('ADDRESS', L + 2, bY + 15)
  doc.setFont('helvetica', 'normal'); doc.text(':', lValX - 1, bY + 15)
  doc.text(addrLines, lValX + 1, bY + 15)

  const addrEnd = 15 + addrLines.length * 4 + 2

  lf('STATE CODE',          gstNum,        addrEnd + 2)
  lf('GSTIN',               branchGSTIN,   addrEnd + 7)
  lf('DISPATCH FROM',       '',            addrEnd + 12)
  lf('CONTACT PERSON',      '',            addrEnd + 17)
  lf('Co. Name and address','',            addrEnd + 22)
  lf('STATE CODE',          '',            addrEnd + 32)
  lf('PAN/AADHAR',          branchPAN,     addrEnd + 37)
  lf('PURPOSE OF MOVEMENT', 'STOCK TRANSFER', addrEnd + 42)

  // RIGHT SIDE helper
  function rf(label, value, off) {
    const ty = bY + off
    doc.setFont('helvetica', 'bold');   doc.text(label, L + halfW + 2, ty)
    doc.setFont('helvetica', 'normal')
    if (value) doc.text(': ' + value, rValX - 1, ty)
    else       doc.text(':',          rValX - 1, ty)
  }

  doc.setFont('helvetica', 'bold')
  doc.text('CONSIGNEE ADDRESS :', L + halfW + 2, bY + 5)

  // HO address lines
  const hoLines = [
    (companySettings.company_name || '') + '-BENGALURU',
    companySettings.head_office_building || 'HOUSE OF WHITE',
    companySettings.head_office_address  || '',
    [companySettings.head_office_city, (companySettings.head_office_state || '') + '-' + (companySettings.head_office_pin || '')]
      .filter(Boolean).join(','),
  ].filter(l => l.trim())

  doc.setFont('helvetica', 'normal')
  hoLines.forEach((line, i) => doc.text(line, L + halfW + 4, bY + 10 + i * 4))

  const rOff = 10 + hoLines.length * 4 + 4

  rf('STATE',      (companySettings.head_office_state || 'KARNATAKA').toUpperCase(), rOff)
  rf('STATE CODE', '29',                      rOff + 5)
  rf('GSTIN',      companySettings.gstin || '', rOff + 10)
  rf('CONSIGNEE',  '(DELIVERY ADDRESS- IF NOT SAME)', rOff + 18)
  rf('Co.NAME',    '', rOff + 23)
  rf('ADDRESS',    '', rOff + 28)
  rf('GSTIN',      '', rOff + 33)

  // Thin horizontal separators, left side
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.1)
  ;[5, 10, 15, addrEnd + 2, addrEnd + 7, addrEnd + 12, addrEnd + 17, addrEnd + 22, addrEnd + 32, addrEnd + 37].forEach(off => {
    doc.line(L, bY + off, L + halfW, bY + off)
  })
  // Right side separators
  ;[5, rOff, rOff + 5, rOff + 10, rOff + 18, rOff + 23, rOff + 28].forEach(off => {
    doc.line(L + halfW, bY + off, L + useW, bY + off)
  })

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)

  y += billH + 1

  // ── ITEMS TABLE ───────────────────────────────────────────────────────────
  const totalNetWt  = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const totalAmount = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const rate        = totalNetWt > 0 ? totalAmount / totalNetWt : 0

  const emptyRow = ['', '', '', '', '', '']
  const bodyRows = [
    ['1', `USED GOLD ORNAMENTS-${sc}`, companySettings.hsn_code || '711319',
      totalNetWt.toFixed(2), fmtIN(rate), fmtIN(totalAmount)],
    ...Array(10).fill(emptyRow),
  ]

  doc.autoTable({
    startY: y,
    head: [[
      'S.No.',
      'DESCRIPTION OF GOODS',
      'HSN OF GOODS',
      { content: 'QUANTITY/GROSS\nWEIGHT (GMS)', styles: { halign: 'center' } },
      'RATE',
      'VALUE OF GOODS',
    ]],
    body: bodyRows,
    foot: [['', '', '', '', 'GRAND TOTAL', fmtIN(totalAmount)]],
    theme: 'grid',
    styles:     { fontSize: 7.5, cellPadding: 2, lineColor: BLACK, lineWidth: 0.2, textColor: BLACK },
    headStyles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'center', fontSize: 7.5 },
    footStyles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'left',   cellWidth: 72 },
      2: { halign: 'center', cellWidth: 20 },
      3: { halign: 'right',  cellWidth: 28 },
      4: { halign: 'right',  cellWidth: 28 },
      5: { halign: 'right',  cellWidth: 30 },
    },
    didParseCell(data) {
      if (data.section === 'foot' && data.column.index === 4) data.cell.styles.halign = 'center'
      if (data.section === 'foot' && data.column.index === 5) data.cell.styles.halign = 'right'
    },
    margin: { left: L, right: R },
  })

  y = doc.lastAutoTable.finalY

  // ── TOTAL IN WORDS + GRAND TOTAL BOX ─────────────────────────────────────
  // Columns 4+5 = RATE(28)+VALUE(30) = 58mm wide → right box
  const rbW = 58
  const rbX = L + useW - rbW
  const midX = rbX + 30   // internal divider in right box

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.2)

  // Words row
  const wH = 9
  doc.rect(L, y, useW - rbW, wH)
  doc.rect(rbX, y, rbW, wH)
  doc.line(midX, y, midX, y + wH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...BLACK)
  doc.text('TOTAL VALUE IN WORDS :', L + 2, y + 6)
  doc.setFont('helvetica', 'normal')
  const wordsStr = amountToWords(totalAmount)
  const wLines   = doc.splitTextToSize(wordsStr, useW - rbW - 50)
  doc.text(wLines, L + 50, y + 6)

  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL', rbX + 2, y + 6)
  doc.text(fmtIN(totalAmount), L + useW - 2, y + 6, { align: 'right' })

  y += wH

  // Extra box (2 blank sub-rows with grand total repeated at bottom)
  const exH = 18
  doc.rect(L, y, useW - rbW, exH)
  doc.rect(rbX, y, rbW, exH)
  doc.line(midX, y, midX, y + exH)
  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL', rbX + 2, y + exH - 3)
  doc.text(fmtIN(totalAmount), L + useW - 2, y + exH - 3, { align: 'right' })

  y += exH + 22   // gap for stamp / vehicle no

  // ── SIGNATURES ────────────────────────────────────────────────────────────
  const sigH = 18
  doc.setLineWidth(0.2)
  doc.rect(L, y, halfW, sigH)
  doc.rect(L + halfW, y, halfW, sigH)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...BLACK)
  doc.text("Receiver's Signature",                                          L + 3,         y + sigH - 3)
  doc.text("Stamp & Signature of supplier/ authorised representative",      L + halfW + 3, y + sigH - 3)

  return doc
}
