// lib/generateDeliveryChallan.js
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Number → words ────────────────────────────────────────────────────────────
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

// ── State lookup tables ───────────────────────────────────────────────────────
const GST_NUM   = { KA: '29', KL: '32', AP: '37', TS: '36', TN: '33' }
const STATE_NAME = { KA: 'KARNATAKA', KL: 'KERALA', AP: 'ANDHRA PRADESH', TS: 'TELANGANA', TN: 'TAMIL NADU' }

// ── Build branch address without duplicating city/state/pin ───────────────────
function buildBranchAddress(branch) {
  const raw = (branch?.address || '').trim()
  if (!raw) return ''
  // If the pin code is already in the address text, don't re-append city/state/pin
  const pinAlreadyIn = branch?.pin_code && raw.includes(branch.pin_code)
  if (pinAlreadyIn) {
    return raw.toUpperCase().includes('INDIA') ? raw : raw + ', INDIA'
  }
  // Build from parts, only adding what isn't already present
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
export function generateDeliveryChallan({ consignment, branch, companySettings, items, logoBase64 }) {
  const doc  = new jsPDF('p', 'mm', 'a4')
  const L    = 10, R = 10
  const useW = 210 - L - R   // 190 mm
  const half = useW / 2      //  95 mm

  // ── Palette ───────────────────────────────────────────────────────────────
  const BK = [0,   0,   0  ]   // black
  const WH = [255, 255, 255]   // white
  const BL = [0,   51,  153]   // blue  (logo fallback)
  const RD = [180, 20,  20 ]   // red   (WG number)
  const GY = [130, 130, 130]   // gray  (rule text)
  const LG = [210, 210, 210]   // light gray (dividers)
  const HG = [245, 245, 245]   // near-white (table header)

  // ── State & GSTIN resolution ──────────────────────────────────────────────
  const sc          = consignment.state_code || 'KA'
  const gstNum      = GST_NUM[sc]   || '29'
  const stateName   = (branch?.state || STATE_NAME[sc] || 'KARNATAKA').toUpperCase()
  const isInterstate = sc !== 'KA'
  const branchGSTIN = branch?.branch_gstin || companySettings[`gstin_${sc.toLowerCase()}`] || ''
  const branchPAN   = companySettings.pan  || (branchGSTIN.length >= 12 ? branchGSTIN.substring(2, 12) : '')

  // ── Rates ─────────────────────────────────────────────────────────────────
  const igstRate  = parseFloat(companySettings.igst_rate        || 3)
  const upliftPct = parseFloat(companySettings.value_uplift_pct || 7.5)

  // ── HO details ───────────────────────────────────────────────────────────
  const hoGSTIN = companySettings.gstin || ''
  const hoState = (companySettings.head_office_state || 'KARNATAKA').toUpperCase()

  const fmtIN = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const dateStr = new Date(consignment.created_at)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    .toUpperCase().replace(/ /g, '-')

  let y = 10

  // ═════════════════════════════════════════════════════════════════════════
  // 1. HEADER
  // ═════════════════════════════════════════════════════════════════════════
  const hH    = 30
  const logoW = 32
  const copyW = 52
  const titleW = useW - logoW - copyW
  const titleCX = L + logoW + titleW / 2
  const copyX   = L + logoW + titleW

  // Logo box (white bg so PNG looks correct on white)
  doc.setFillColor(...WH)
  doc.rect(L, y, logoW, hH, 'F')
  if (logoBase64) {
    try { doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', L + 2, y + 2, logoW - 4, hH - 4) }
    catch { drawTextLogo(doc, L, y, logoW, hH, BL, WH) }
  } else {
    drawTextLogo(doc, L, y, logoW, hH, BL, WH)
  }

  // Title
  doc.setTextColor(...BK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5)
  const titleStr = 'DELIVERY CHALLAN/ISSUE VOUCHER'
  doc.text(titleStr, titleCX, y + 8, { align: 'center' })
  const tw = doc.getTextWidth(titleStr)
  doc.setDrawColor(...BK); doc.setLineWidth(0.5)
  doc.line(titleCX - tw / 2, y + 9.5, titleCX + tw / 2, y + 9.5)
  doc.setLineWidth(0.3)

  // Tamper proof — WG number in bold red
  doc.setFontSize(9.5)
  const tpLabel = 'TAMPER PROOF No:-  '
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
  const tpLW = doc.getTextWidth(tpLabel)
  doc.setFont('helvetica', 'bold')
  const tpVW = doc.getTextWidth(consignment.tmp_prf_no || '')
  const tpX  = titleCX - (tpLW + tpVW) / 2
  doc.setFont('helvetica', 'normal'); doc.text(tpLabel, tpX, y + 18)
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...RD)
  doc.text(consignment.tmp_prf_no || '', tpX + tpLW, y + 18)
  doc.setTextColor(...BK)

  // Rule ref
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GY)
  doc.text('(REFER RULE 55 TO CGST ACT)', titleCX, y + 25, { align: 'center' })
  doc.setTextColor(...BK)

  // Copy labels
  doc.setFontSize(6.5)
  ;['ORIGINAL FOR CONSIGNEE', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR CONSIGNOR'].forEach((lbl, i) =>
    doc.text(lbl, copyX + 3, y + hH * (i + 0.65) / 3))

  // Header borders
  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  doc.rect(L, y, useW, hH)
  doc.line(L + logoW, y, L + logoW, y + hH)
  doc.line(copyX, y, copyX, y + hH)
  doc.line(copyX, y + hH / 3,     L + useW, y + hH / 3)
  doc.line(copyX, y + hH * 2 / 3, L + useW, y + hH * 2 / 3)
  y += hH

  // ═════════════════════════════════════════════════════════════════════════
  // 2. INFO ROWS
  // ═════════════════════════════════════════════════════════════════════════
  const irH    = 5.5
  const irLblW = 42
  const rows4 = [
    ['DELIVERY CHALLAN NO',   consignment.challan_no || '',    'TRASNPORTER NAME',    companySettings.transporter_name   || 'BVC LOGISTICS PVT. LTD.'],
    ['DELIVERY CHALLAN DATE', dateStr,                         'TRANSPORTATION MODE',  companySettings.transportation_mode || 'BY AIR & ROAD'],
    ['STATE',                 stateName,                       'PLACE OF SUPPLY',     stateName],
    ['STATE CODE',            gstNum,                          'VEHICLE NO.',         ''],
  ]
  doc.setLineWidth(0.2)
  rows4.forEach(([ll, lv, rl, rv], i) => {
    const ry = y + i * irH, ty = ry + irH * 0.73
    doc.setDrawColor(...BK)
    doc.rect(L, ry, half, irH); doc.rect(L + half, ry, half, irH)
    doc.setFontSize(7.5); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold'); doc.text(ll, L + 2, ty)
    doc.setFont('helvetica', 'bold'); doc.text(rl, L + half + 2, ty)
    if (i === 0) {
      const parts = (lv || '').split('/'), ext = parts.pop()
      const pfx = ': ' + parts.join('/') + '/ '
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK); doc.text(pfx, L + irLblW, ty)
      doc.setFont('helvetica', 'bold');   doc.setTextColor(...RD); doc.text(ext, L + irLblW + doc.getTextWidth(pfx), ty)
      doc.setTextColor(...BK)
    } else {
      doc.setFont('helvetica', 'normal'); doc.text(': ' + lv, L + irLblW, ty)
    }
    doc.setFont('helvetica', 'normal'); doc.text(': ' + rv, L + half + irLblW, ty)
  })
  y += 4 * irH

  // ═════════════════════════════════════════════════════════════════════════
  // 3. BILL FROM / CONSIGNEE
  // ═════════════════════════════════════════════════════════════════════════
  const lLblW  = 40          // left label column width
  const lValX  = L + lLblW + 1
  const rLblW  = 24          // right label column width
  const rValX  = L + half + rLblW + 1
  const RH     = 5           // standard row height
  const bY     = y

  // ── Address (pre-compute to know height) ──────────────────────────────────
  const fullAddr   = buildBranchAddress(branch)
  const addrMaxW   = half - lLblW - 5

  let addrFsz = 7.5, addrLines
  doc.setFontSize(7.5);   addrLines = doc.splitTextToSize(fullAddr, addrMaxW)
  if (addrLines.length > 4) { addrFsz = 6.5; doc.setFontSize(6.5); addrLines = doc.splitTextToSize(fullAddr, addrMaxW) }
  if (addrLines.length > 5) { addrFsz = 6;   doc.setFontSize(6);   addrLines = doc.splitTextToSize(fullAddr, addrMaxW) }
  if (addrLines.length > 7)   addrLines = addrLines.slice(0, 7)
  doc.setFontSize(7.5)
  const addrLH   = addrFsz <= 6 ? 3 : addrFsz <= 6.5 ? 3.5 : 4
  const addrBlkH = addrLines.length * addrLH + 4

  // ── HO lines ──────────────────────────────────────────────────────────────
  const hoLines = [
    (companySettings.company_name || '') + '-BENGALURU',
    companySettings.head_office_building || '',
    companySettings.head_office_address  || '',
    [companySettings.head_office_city,
      (companySettings.head_office_state || '') + '-' + (companySettings.head_office_pin || '')]
      .filter(Boolean).join(','),
  ].filter(l => l && l.trim())

  // ── Height calculation ────────────────────────────────────────────────────
  // Left cursor trace: start=5, BILL FROM adv 4.5, branch adv 5, CONTACT adv 5,
  // ADDRESS adv addrBlkH, then 8×RH rows + one 2×RH row + pad 3
  const lEnd = 5 + 4.5 + RH + RH + addrBlkH + RH + RH + RH + RH + (RH * 2) + RH + RH + RH + 3

  // Right: header(5) + hoLines*4 + 4gap = rOff, then STATE+STATECODE+GSTIN(3×RH) + CONSIGNEE gap(8) + Co.NAME+ADDRESS+GSTIN(3×RH) + pad(3)
  const rOff = 10 + hoLines.length * 4 + 4
  const rEnd  = rOff + RH * 3 + 8 + RH * 3 + 3

  const billH = Math.max(lEnd, rEnd) + 5

  // Outer box
  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  doc.rect(L, y, useW, billH)
  doc.line(L + half, y, L + half, y + billH)

  // ── Left side: running cursor approach ────────────────────────────────────
  let lCur = 5          // y-offset from bY
  const lSeps = []      // separator line positions

  function lRow(label, value, advance, fsz) {
    lSeps.push(lCur)
    doc.setFontSize(fsz || 7.5); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + 2, bY + lCur)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + (value || ''), lValX - 1, bY + lCur)
    lCur += advance
  }

  // Row 1: BILL FROM — company name only (no overflow)
  lRow('BILL FROM', companySettings.company_name || '', 4.5)

  // Row 2: branch name (no label, indented)
  lSeps.push(lCur)
  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text(branch?.name || '', lValX, bY + lCur)
  lCur += RH

  // Row 3: CONTACT PERSON
  lRow('CONTACT PERSON', (branch?.contact_person || '') + (branch?.contact_phone ? '   ' + branch.contact_phone : ''), RH)

  // Row 4+: ADDRESS (multi-line)
  lSeps.push(lCur)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.text('ADDRESS', L + 2, bY + lCur)
  doc.setFont('helvetica', 'normal'); doc.text(':', lValX - 1, bY + lCur)
  doc.setFontSize(addrFsz); doc.text(addrLines, lValX + 1, bY + lCur)
  doc.setFontSize(7.5)
  lCur += addrBlkH

  // Remaining rows
  lRow('STATE CODE',           gstNum,          RH)
  lRow('GSTIN',                branchGSTIN,     RH)
  lRow('DISPATCH FROM',        '',              RH)
  lRow('CONTACT PERSON',       '',              RH)
  lRow('Co. Name and address', '',              RH * 2)  // double gap below
  lRow('STATE CODE',           '',              RH)
  lRow('PAN/AADHAR',           branchPAN,       RH)
  lRow('PURPOSE OF MOVEMENT',  'STOCK TRANSFER', RH)

  // ── Right side ────────────────────────────────────────────────────────────
  function rf(label, value, off) {
    doc.setFontSize(7.5); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + half + 2, bY + off)
    doc.setFont('helvetica', 'normal')
    if (value) doc.text(': ' + value, rValX - 1, bY + off)
    else       doc.text(':',          rValX - 1, bY + off)
  }

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text('CONSIGNEE ADDRESS :', L + half + 2, bY + 5)
  doc.setFont('helvetica', 'normal')
  hoLines.forEach((line, i) => doc.text(line, L + half + 4, bY + 10 + i * 4))

  rf('STATE',     hoState,   rOff)
  rf('STATE CODE', '29',     rOff + RH)
  rf('GSTIN',     hoGSTIN,   rOff + RH * 2)
  rf('CONSIGNEE', '(DELIVERY ADDRESS- IF NOT SAME)', rOff + RH * 2 + 8)
  rf('Co.NAME',   '',        rOff + RH * 2 + 8 + RH)
  rf('ADDRESS',   '',        rOff + RH * 2 + 8 + RH * 2)
  rf('GSTIN',     '',        rOff + RH * 2 + 8 + RH * 3)

  // ── Separator lines ───────────────────────────────────────────────────────
  doc.setDrawColor(...LG); doc.setLineWidth(0.1)
  lSeps.forEach(off => doc.line(L, bY + off, L + half, bY + off))
  ;[5, rOff, rOff + RH, rOff + RH * 2, rOff + RH * 2 + 8, rOff + RH * 2 + 8 + RH, rOff + RH * 2 + 8 + RH * 2].forEach(off =>
    doc.line(L + half, bY + off, L + useW, bY + off))

  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  y += billH + 1

  // ═════════════════════════════════════════════════════════════════════════
  // 4. ITEMS TABLE
  // ═════════════════════════════════════════════════════════════════════════
  const totWt  = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const totAmt = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const rate   = totWt > 0 ? totAmt / totWt : 0

  const vog     = isInterstate ? totAmt * (1 + upliftPct / 100) : totAmt
  const igst    = isInterstate ? vog * (igstRate / 100)         : 0
  const grand   = vog + igst

  const emptyR = ['', '', '', '', '', '']
  const bodyR = [
    ['1', `USED GOLD ORNAMENTS-${sc}`, companySettings.hsn_code || '711319',
      totWt.toFixed(2), fmtIN(rate), fmtIN(totAmt)],
    ...Array(10).fill(emptyR),
  ]
  const footR = isInterstate
    ? [
        ['', '', '', '', 'VALUE OF GOODS',       fmtIN(vog)],
        ['', '', '', '', `IGST @ ${igstRate}%`,  fmtIN(igst)],
        ['', '', '', '', 'GRAND TOTAL',           fmtIN(grand)],
      ]
    : [['', '', '', '', 'GRAND TOTAL',           fmtIN(grand)]]

  autoTable(doc, {
    startY: y,
    head: [['S.No.', 'DESCRIPTION OF GOODS', 'HSN OF\nGOODS',
      { content: 'QUANTITY/GROSS\nWEIGHT (GMS)', styles: { halign: 'center' } }, 'RATE', 'VALUE OF GOODS']],
    body: bodyR, foot: footR,
    theme: 'grid',
    styles:     { fontSize: 7.5, cellPadding: 1.8, lineColor: BK, lineWidth: 0.2, textColor: BK },
    headStyles: { fillColor: HG, textColor: BK, fontStyle: 'bold', halign: 'center', fontSize: 7.5 },
    footStyles: { fillColor: WH, textColor: BK, fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'left',   cellWidth: 72 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'right',  cellWidth: 28 },
      4: { halign: 'right',  cellWidth: 30 },
      5: { halign: 'right',  cellWidth: 30 },
    },
    didParseCell(d) {
      if (d.section === 'foot' && d.column.index === 4) d.cell.styles.halign = 'center'
      if (d.section === 'foot' && d.column.index === 5) d.cell.styles.halign = 'right'
    },
    margin: { left: L, right: R },
  })
  y = doc.lastAutoTable.finalY

  // ═════════════════════════════════════════════════════════════════════════
  // 5. TOTAL IN WORDS  +  GRAND TOTAL BOX
  // ═════════════════════════════════════════════════════════════════════════
  const rbW  = 60, rbX = L + useW - rbW, midX = rbX + 32
  doc.setDrawColor(...BK); doc.setLineWidth(0.2)

  // Dynamic words-row height
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  const wStr  = amountToWords(grand)
  const wLns  = doc.splitTextToSize(wStr, useW - rbW - 54)
  const wH    = Math.max(10, wLns.length * 4.5 + 4)

  doc.rect(L, y, useW - rbW, wH); doc.rect(rbX, y, rbW, wH); doc.line(midX, y, midX, y + wH)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...BK)
  doc.text('TOTAL VALUE IN WORDS :', L + 2, y + 5.5)
  doc.setFont('helvetica', 'normal'); doc.text(wLns, L + 54, y + 5.5)
  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL',         rbX + 2,      y + wH / 2 + 2)
  doc.text(fmtIN(grand),          L + useW - 2, y + wH / 2 + 2, { align: 'right' })
  y += wH

  // Extra box (stamp / signature gap)
  const exH = 18
  doc.rect(L, y, useW - rbW, exH); doc.rect(rbX, y, rbW, exH); doc.line(midX, y, midX, y + exH)
  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL',         rbX + 2,      y + exH - 3)
  doc.text(fmtIN(grand),          L + useW - 2, y + exH - 3, { align: 'right' })
  y += exH + 22

  // ═════════════════════════════════════════════════════════════════════════
  // 6. SIGNATURES
  // ═════════════════════════════════════════════════════════════════════════
  const sigH = 20
  doc.setLineWidth(0.2)
  doc.rect(L, y, half, sigH); doc.rect(L + half, y, half, sigH)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...BK)
  doc.text("Receiver's Signature",                                      L + 3,        y + sigH - 3)
  doc.text("Stamp & Signature of supplier/ authorised representative",  L + half + 3, y + sigH - 3)

  return doc
}

// ── Fallback text logo when image unavailable ─────────────────────────────────
function drawTextLogo(doc, L, y, logoW, hH, BL, WH) {
  doc.setFillColor(...BL); doc.rect(L, y, logoW, hH, 'F')
  doc.setTextColor(...WH); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('WHITE', L + 4, y + 13); doc.text('GOLD', L + 6, y + 21)
}
