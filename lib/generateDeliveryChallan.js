// lib/generateDeliveryChallan.js
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Number → words ────────────────────────────────────────────────────────────
function numberToWords(num) {
  if (num === 0) return 'ZERO'
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  function b100(n)  { return n < 20 ? ones[n] : tens[Math.floor(n/10)] + (n%10 ? ' '+ones[n%10] : '') }
  function b1000(n) { return n < 100 ? b100(n) : ones[Math.floor(n/100)] + ' HUNDRED' + (n%100 ? ' '+b100(n%100) : '') }
  let r = '', n = num
  if (n >= 10000000) { r += b100(Math.floor(n/10000000)) + ' CRORE ';  n %= 10000000 }
  if (n >= 100000)   { r += b100(Math.floor(n/100000))  + ' LACS ';   n %= 100000 }
  if (n >= 1000)     { r += b1000(Math.floor(n/1000))   + ' THOUSAND '; n %= 1000 }
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

// ── State lookup ──────────────────────────────────────────────────────────────
const GST_NUM    = { KA: '29', KL: '32', AP: '37', TS: '36', TN: '33' }
const STATE_NAME = { KA: 'KARNATAKA', KL: 'KERALA', AP: 'ANDHRA PRADESH', TS: 'TELANGANA', TN: 'TAMIL NADU' }

// ── Build branch address without duplicating city/state/pin ───────────────────
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
export function generateDeliveryChallan({ consignment, branch, companySettings, items, logoBase64 }) {
  const doc  = new jsPDF('p', 'mm', 'a4')
  const L    = 10, R = 10
  const useW = 210 - L - R   // 190 mm
  const half = useW / 2      //  95 mm

  // ── Colours ───────────────────────────────────────────────────────────────
  const BK = [0, 0, 0],   WH = [255, 255, 255]
  const BL = [0, 51, 153], RD = [180, 20,  20]
  const GY = [130, 130, 130], LG = [200, 200, 200]
  const HG = [245, 245, 245]

  // ── Derived values ────────────────────────────────────────────────────────
  const sc           = consignment.state_code || 'KA'
  const gstNum       = GST_NUM[sc]   || '29'
  const stateName    = (branch?.state || STATE_NAME[sc] || 'KARNATAKA').toUpperCase()
  const isInterstate = sc !== 'KA'
  const branchGSTIN  = branch?.branch_gstin || companySettings[`gstin_${sc.toLowerCase()}`] || ''
  const branchPAN    = companySettings.pan  || (branchGSTIN.length >= 12 ? branchGSTIN.substring(2, 12) : '')
  const igstRate     = parseFloat(companySettings.igst_rate        || 3)
  const upliftPct    = parseFloat(companySettings.value_uplift_pct || 7.5)
  const hoGSTIN      = companySettings.gstin || ''
  const hoState      = (companySettings.head_office_state || 'KARNATAKA').toUpperCase()
  const companyName  = companySettings.company_name || ''

  const fmtIN = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const dateStr = new Date(consignment.created_at)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    .toUpperCase().replace(/ /g, '-')

  // Signature text pinned to bottom of page
  const sigTextY = 289

  let y = 10

  // ═══════════════════════════════════════════════════════════════════════════
  // 1.  HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  const hH    = 32
  const logoW = 30
  const copyW = 50
  const titleW  = useW - logoW - copyW   // 110 mm
  const titleCX = L + logoW + titleW / 2
  const copyX   = L + logoW + titleW

  // Logo — maintain aspect ratio (contain within box)
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

  // Title
  doc.setTextColor(...BK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  const titleStr = 'DELIVERY CHALLAN/ISSUE VOUCHER'
  doc.text(titleStr, titleCX, y + 7, { align: 'center' })
  const tw = doc.getTextWidth(titleStr)
  doc.setDrawColor(...BK); doc.setLineWidth(0.5)
  doc.line(titleCX - tw/2, y + 8.5, titleCX + tw/2, y + 8.5)
  doc.setLineWidth(0.3)

  // Tamper proof
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

  // Rule ref
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...GY)
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
  doc.line(copyX, y + hH/3,   L + useW, y + hH/3)
  doc.line(copyX, y + hH*2/3, L + useW, y + hH*2/3)
  y += hH

  // ═══════════════════════════════════════════════════════════════════════════
  // 2.  INFO ROWS
  // ═══════════════════════════════════════════════════════════════════════════
  const irH    = 5
  const irLblW = 44
  const ir4 = [
    ['DELIVERY CHALLAN NO',   consignment.challan_no || '',   'TRASNPORTER NAME',   companySettings.transporter_name   || 'BVC LOGISTICS PVT. LTD.'],
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
      // Last segment of challan no in bold red
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
  // 3.  BILL FROM / CONSIGNEE SECTION
  // ═══════════════════════════════════════════════════════════════════════════
  const lLblW = 33           // left label column width
  const lValX = L + lLblW + 1  // x where ': value' starts (43mm from left)
  const rLblW = 24           // right label column width
  const rValX = L + half + rLblW + 1
  const RH    = 6            // standard row height (6mm gives letters breathing room)
  const bY    = y

  // ── Address block ─────────────────────────────────────────────────────────
  const fullAddr = buildBranchAddress(branch)
  const addrMaxW = half - lLblW - 6

  let addrFsz = 7
  doc.setFontSize(7); let addrLines = doc.splitTextToSize(fullAddr, addrMaxW)
  if (addrLines.length > 5) { addrFsz = 6.5; doc.setFontSize(6.5); addrLines = doc.splitTextToSize(fullAddr, addrMaxW) }
  if (addrLines.length > 6) { addrFsz = 6;   doc.setFontSize(6);   addrLines = doc.splitTextToSize(fullAddr, addrMaxW) }
  if (addrLines.length > 8) addrLines = addrLines.slice(0, 8)
  doc.setFontSize(7.5)
  // Generous line height so letters don't appear clipped between address lines
  const addrLH   = addrFsz <= 6 ? 3.5 : addrFsz <= 6.5 ? 4 : 4.5
  const addrBlkH = addrLines.length * addrLH + 3

  // ── HO lines (consignee right side) ───────────────────────────────────────
  const hoLines = [
    companyName + '-BENGALURU',
    companySettings.head_office_building || '',
    companySettings.head_office_address  || '',
    [companySettings.head_office_city,
      (companySettings.head_office_state || '') + '-' + (companySettings.head_office_pin || '')]
      .filter(Boolean).join(','),
  ].filter(l => l && l.trim())

  // ── BILL FROM: try single line at 7.5→6.5→6pt; if still too wide, split ──
  // Available width for ': company    branch' text = from lValX-1 to L+half (minus 3mm safety)
  const branchName    = branch?.name || ''
  const combined      = companyName + '    ' + branchName
  const billCheckW    = half - lLblW - 3   // = 59mm
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

  // ── Pre-calculate heights ──────────────────────────────────────────────────
  // Left: trace cursor through all rows (initial lCur = 5)
  const billFromH = billSplit ? (4 + RH) : RH
  const lEnd = 5
    + billFromH    // BILL FROM (1 or 2 lines)
    + RH           // CONTACT PERSON
    + addrBlkH     // ADDRESS
    + RH           // STATE CODE
    + RH           // GSTIN
    + RH           // DISPATCH FROM
    + RH           // CONTACT PERSON (2nd)
    + RH           // Co. Name and address
    + RH           // STATE CODE (2nd)
    + RH           // PAN/AADHAR
    + RH           // PURPOSE OF MOVEMENT
    + 3            // bottom padding

  // Right: CONSIGNEE ADDR header(10) + hoLines×3.8 + 3 + STATE+STATECODE+GSTIN(3×RH) + 7gap + CONSIGNEE+CoNAME+ADDR+GSTIN(4×RH) + 3pad
  const rOff = 10 + hoLines.length * 3.8 + 3
  const rEnd  = rOff + RH * 3 + 7 + RH * 4 + 3

  const billH = Math.max(lEnd, rEnd) + 4

  // Outer box + centre divider
  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  doc.rect(L, y, useW, billH)
  doc.line(L + half, y, L + half, y + billH)

  // ── Left side — running cursor ────────────────────────────────────────────
  let lCur = 5
  const lSeps = []

  function lRow(label, value, advance, fsz) {
    lSeps.push(lCur)
    const sz = fsz || 7.5
    doc.setFontSize(sz); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + 2, bY + lCur)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + (value || ''), lValX - 1, bY + lCur)
    lCur += advance
  }

  // ── BILL FROM ─────────────────────────────────────────────────────────────
  if (billSplit) {
    // Two lines: company on top, branch name below (both normal weight)
    lRow('BILL FROM', companyName, 4, 7.5)
    lSeps.push(lCur)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
    doc.text(branchName, lValX, bY + lCur)
    lCur += RH
  } else {
    lRow('BILL FROM', combined, RH, billFsz)
  }

  // ── CONTACT PERSON — name bold, phone right-aligned ───────────────────────
  const contactName  = branch?.contact_person || ''
  const contactPhone = branch?.contact_phone  || ''
  lSeps.push(lCur)
  doc.setFontSize(7.5); doc.setTextColor(...BK)
  doc.setFont('helvetica', 'bold')
  doc.text('CONTACT PERSON', L + 2, bY + lCur)
  doc.text(': ' + contactName, lValX - 1, bY + lCur)
  if (contactPhone) {
    doc.setFont('helvetica', 'normal')
    doc.text(contactPhone, L + half - 2, bY + lCur, { align: 'right' })
  }
  lCur += RH

  // ── ADDRESS — multi-line with explicit line spacing ────────────────────────
  lSeps.push(lCur)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
  doc.text('ADDRESS', L + 2, bY + lCur)
  doc.setFont('helvetica', 'normal'); doc.text(':', lValX - 1, bY + lCur)
  doc.setFontSize(addrFsz)
  addrLines.forEach((line, i) => doc.text(line, lValX + 1, bY + lCur + i * addrLH))
  doc.setFontSize(7.5)
  lCur += addrBlkH

  lRow('STATE CODE',           gstNum,           RH)
  lRow('GSTIN',                branchGSTIN,      RH)
  lRow('DISPATCH FROM',        '',               RH)
  lRow('CONTACT PERSON',       '',               RH)
  lRow('Co. Name and address', '',               RH, 6.5)
  lRow('STATE CODE',           '',               RH)
  lRow('PAN/AADHAR',           branchPAN,        RH)
  lRow('PURPOSE OF MOVEMENT',  'STOCK TRANSFER', RH, 6.5)

  // ── Right side ────────────────────────────────────────────────────────────
  function rf(label, value, off, fsz) {
    doc.setFontSize(fsz || 7.5); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold');   doc.text(label, L + half + 2, bY + off)
    doc.setFont('helvetica', 'normal')
    if (value) doc.text(': ' + value, rValX - 1, bY + off)
    else       doc.text(':',          rValX - 1, bY + off)
  }

  // Consignee header + HO address lines
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text('CONSIGNEE ADDRESS :', L + half + 2, bY + 5)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal')
  hoLines.forEach((line, i) => doc.text(line, L + half + 4, bY + 10 + i * 3.8))

  rf('STATE',      hoState,  rOff)
  rf('STATE CODE', '29',     rOff + RH)
  rf('GSTIN',      hoGSTIN,  rOff + RH * 2)

  rf('CONSIGNEE',  '(DELIVERY ADDRESS- IF NOT SAME)', rOff + RH * 2 + 7)
  rf('Co.NAME',    '',  rOff + RH * 2 + 7 + RH)
  rf('ADDRESS',    '',  rOff + RH * 2 + 7 + RH * 2)
  rf('GSTIN',      '',  rOff + RH * 2 + 7 + RH * 3)

  // (no horizontal separator lines — clean open layout)

  doc.setDrawColor(...BK); doc.setLineWidth(0.3)
  y += billH + 1

  // ═══════════════════════════════════════════════════════════════════════════
  // 4.  ITEMS TABLE  (dynamic row count to fill page)
  // ═══════════════════════════════════════════════════════════════════════════
  const totWt  = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const totAmt = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const rate   = totWt > 0 ? totAmt / totWt : 0
  const vog    = isInterstate ? totAmt * (1 + upliftPct / 100) : totAmt
  const igst   = isInterstate ? vog * (igstRate / 100)         : 0
  const grand  = vog + igst

  // Footer rows go in body (not foot) — autotable's foot section does not
  // reliably draw vertical border lines for its cells, and overrides columnStyles.
  // bottomReserve = words box(~12) + GT box(10) + sig gap(~40) = 62
  const bottomReserve = 62
  const availForTable = sigTextY - y - bottomReserve
  const rH_est   = 6.25
  const ftrCount = isInterstate ? 3 : 1
  // tblFixed: header(8) + 1 data row + ftrCount footer-style rows
  const tblFixed = 8 + (1 + ftrCount) * rH_est
  const nEmpty   = Math.max(4, Math.floor((availForTable - tblFixed) / rH_est))

  const ftrRows = isInterstate
    ? [
        ['', '', '', '', 'VALUE OF GOODS',      fmtIN(vog)],
        ['', '', '', '', `IGST @ ${igstRate}%`, fmtIN(igst)],
        ['', '', '', '', 'GRAND TOTAL',         fmtIN(grand)],
      ]
    : [['', '', '', '', 'GRAND TOTAL', fmtIN(grand)]]

  const emptyR = ['', '', '', '', '', '']
  const bodyR  = [
    ['1', `USED GOLD ORNAMENTS-${sc}`, companySettings.hsn_code || '711319',
      totWt.toFixed(2), fmtIN(rate), fmtIN(totAmt)],
    ...Array(nEmpty).fill(emptyR),
    ...ftrRows,
  ]

  // Row indices of the footer-style rows (bold, at end of body)
  const ftrStart = 1 + nEmpty

  autoTable(doc, {
    startY: y,
    head: [['S.No.', 'DESCRIPTION OF GOODS', 'HSN OF\nGOODS',
      'QUANTITY/GROSS\nWEIGHT (GMS)', 'RATE', 'VALUE OF GOODS']],
    body: bodyR,
    theme: 'grid',
    styles:     { fontSize: 7.5, cellPadding: 1.8, lineColor: BK, lineWidth: 0.2, textColor: BK, valign: 'middle' },
    headStyles: { fillColor: HG, textColor: BK, fontStyle: 'bold', halign: 'center', fontSize: 7.5, valign: 'middle' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { halign: 'left',   cellWidth: 74 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'center', cellWidth: 28 },
      4: { halign: 'center', cellWidth: 28 },
      5: { halign: 'center', cellWidth: 32 },
    },
    didParseCell(d) {
      if (d.section === 'body' && d.row.index >= ftrStart) {
        d.cell.styles.fontStyle = 'bold'
      }
    },
    margin: { left: L, right: R },
  })
  y = doc.lastAutoTable.finalY

  // ═══════════════════════════════════════════════════════════════════════════
  // 5.  TOTAL IN WORDS  +  GRAND TOTAL  (matches physical challan layout)
  // ═══════════════════════════════════════════════════════════════════════════
  // Right box: 58mm wide, split into two sub-boxes (GRAND TOTAL label | amount)
  const rbW = 58, rbX = L + useW - rbW
  const rb1 = 29, rb2 = rbW - rb1   // sub-box widths

  // Row A — "TOTAL VALUE IN WORDS" left, two EMPTY sub-boxes right (matches physical)
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

  // Row B — empty left, GRAND TOTAL in right sub-boxes (matches physical)
  const exH = 10
  doc.rect(L, y, useW - rbW, exH)
  doc.rect(rbX, y, rb1, exH)
  doc.rect(rbX + rb1, y, rb2, exH)

  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL', rbX + rb1 / 2, y + exH / 2 + 1.5, { align: 'center' })
  doc.text(fmtIN(grand),  rbX + rb1 + rb2 / 2, y + exH / 2 + 1.5, { align: 'center' })
  y += exH

  // ── Signature labels pinned to bottom of page ─────────────────────────────
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
