// lib/generateIssueVoucher.js
// Issue Voucher — Branch → Hub inventory transfer document.
// Distinct from Delivery Challan: no GST, no transporter section, simpler format.
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function numberToWords(num) {
  if (num === 0) return 'ZERO'
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  function b100(n)  { return n < 20 ? ones[n] : tens[Math.floor(n/10)] + (n%10 ? ' '+ones[n%10] : '') }
  function b1000(n) { return n < 100 ? b100(n) : ones[Math.floor(n/100)] + ' HUNDRED' + (n%100 ? ' '+b100(n%100) : '') }
  let r = '', n = num
  if (n >= 10000000) { r += b100(Math.floor(n/10000000)) + ' CRORE ';   n %= 10000000 }
  if (n >= 100000)   { r += b100(Math.floor(n/100000))   + ' LACS ';    n %= 100000 }
  if (n >= 1000)     { r += b1000(Math.floor(n/1000))    + ' THOUSAND '; n %= 1000 }
  if (n > 0)         { r += b1000(n) }
  return r.trim()
}

function amountToWords(amount) {
  const rupees = Math.floor(amount)
  return 'RUPEES ' + numberToWords(rupees) + ' ONLY'
}

function buildBranchLine(branch) {
  const parts = []
  if (branch?.address) parts.push(branch.address.trim())
  if (branch?.city)    parts.push(branch.city.trim().toUpperCase())
  if (branch?.state)   parts.push(branch.state.trim().toUpperCase() + (branch?.pin_code ? ' ' + branch.pin_code : ''))
  return parts.join(', ')
}

export function generateIssueVoucher({ consignment, sourceBranch, destBranch, companySettings, items, logoBase64 }) {
  const doc  = new jsPDF('p', 'mm', 'a4')
  const L    = 12, R = 12
  const useW = 210 - L - R
  const half = useW / 2

  const BK = [0, 0, 0],   WH = [255, 255, 255]
  const PR = [110, 80, 180]    // purple — issue voucher accent
  const GY = [130, 130, 130]
  const HG = [248, 246, 252]

  // jsPDF default font (helvetica) doesn't render ₹ or →. Use ASCII alternatives.
  const RS  = 'Rs.'
  const ARR = '->'

  const fmtIN = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const dateStr = new Date(consignment.created_at)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    .toUpperCase().replace(/ /g, '-')

  let y = 12

  // ── HEADER ────────────────────────────────────────────────────────────────
  const hH = 30
  doc.setFillColor(...WH)
  doc.rect(L, y, useW, hH, 'F')
  doc.setDrawColor(...BK); doc.setLineWidth(0.4); doc.rect(L, y, useW, hH)

  if (logoBase64) {
    try { doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', L + 4, y + 4, 22, 22) } catch {}
  }

  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text('ISSUE VOUCHER', L + useW / 2, y + 12, { align: 'center' })
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GY)
  doc.text('INTER-BRANCH INVENTORY TRANSFER', L + useW / 2, y + 18, { align: 'center' })
  doc.setFontSize(9); doc.setTextColor(...BK); doc.setFont('helvetica', 'bold')
  doc.text(companySettings.company_name || '', L + useW / 2, y + 25, { align: 'center' })

  doc.setDrawColor(...PR); doc.setLineWidth(0.5)
  doc.rect(L + useW - 50, y + 4, 46, 8)
  doc.setFontSize(7); doc.setTextColor(...PR); doc.setFont('helvetica', 'bold')
  doc.text('TMP PRF NO', L + useW - 47, y + 9.5)
  doc.setFontSize(8); doc.setTextColor(...BK)
  doc.text(consignment.tmp_prf_no || '', L + useW - 27, y + 9.5)

  y += hH

  // ── INFO ROW ──────────────────────────────────────────────────────────────
  const irH = 6
  const irLblW = 38
  const ir = [
    ['VOUCHER NO',   consignment.challan_no || consignment.internal_no || '',   'DATE', dateStr],
    ['MOVEMENT',     `BRANCH ${ARR} HUB`,                                       'STATE', (sourceBranch?.state || '').toUpperCase()],
  ]
  ir.forEach(([ll, lv, rl, rv], i) => {
    const ry = y + i * irH, ty = ry + irH * 0.7
    doc.setDrawColor(...BK); doc.setLineWidth(0.2)
    doc.rect(L, ry, half, irH); doc.rect(L + half, ry, half, irH)
    doc.setFontSize(7.5); doc.setTextColor(...BK)
    doc.setFont('helvetica', 'bold'); doc.text(ll, L + 2, ty)
    doc.setFont('helvetica', 'bold'); doc.text(rl, L + half + 2, ty)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + lv, L + irLblW, ty)
    doc.setFont('helvetica', 'normal'); doc.text(': ' + rv, L + half + irLblW, ty)
  })
  y += 2 * irH + 3

  // ── ISSUED FROM / RECEIVED AT (auto-sized to fit address + GSTIN) ────────
  doc.setFontSize(7.5)
  const fromAddr = doc.splitTextToSize(buildBranchLine(sourceBranch) || '—', half - 5)
  const toAddr   = doc.splitTextToSize(buildBranchLine(destBranch)   || '—', half - 5)
  // height = 4 (top label) + 6 (branch name) + addr.lines * 3.5 + 5 (gstin) + 3 (padding)
  const blkH = Math.max(
    4 + 6 + fromAddr.length * 3.5 + (sourceBranch?.branch_gstin ? 6 : 0) + 4,
    4 + 6 + toAddr.length   * 3.5 + (destBranch?.branch_gstin   ? 6 : 0) + 4,
    28,
  )
  const blkY = y

  // Left: Issued From
  doc.setFillColor(...HG); doc.rect(L, blkY, half - 1, blkH, 'F')
  doc.setDrawColor(...PR); doc.setLineWidth(0.3); doc.rect(L, blkY, half - 1, blkH)
  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text('ISSUED FROM', L + 2, blkY + 4)
  doc.setFontSize(10); doc.setTextColor(...BK)
  doc.text(sourceBranch?.name || '', L + 2, blkY + 10)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal')
  doc.text(fromAddr, L + 2, blkY + 14)
  if (sourceBranch?.branch_gstin) {
    const gstinY = blkY + 14 + fromAddr.length * 3.5 + 2
    doc.setFont('helvetica', 'bold'); doc.text('GSTIN: ', L + 2, gstinY)
    doc.setFont('helvetica', 'normal'); doc.text(sourceBranch.branch_gstin, L + 16, gstinY)
  }

  // Right: Received At
  doc.setFillColor(...HG); doc.rect(L + half + 1, blkY, half - 1, blkH, 'F')
  doc.setDrawColor(...PR); doc.rect(L + half + 1, blkY, half - 1, blkH)
  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text('RECEIVED AT (HUB)', L + half + 3, blkY + 4)
  doc.setFontSize(10); doc.setTextColor(...BK)
  doc.text(destBranch?.name || consignment.dest_branch || '', L + half + 3, blkY + 10)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal')
  doc.text(toAddr, L + half + 3, blkY + 14)
  if (destBranch?.branch_gstin) {
    const gstinY = blkY + 14 + toAddr.length * 3.5 + 2
    doc.setFont('helvetica', 'bold'); doc.text('GSTIN: ', L + half + 3, gstinY)
    doc.setFont('helvetica', 'normal'); doc.text(destBranch.branch_gstin, L + half + 17, gstinY)
  }

  y = blkY + blkH + 4

  // ── ITEMS TABLE ──────────────────────────────────────────────────────────
  const totalGross = items.reduce((s, i) => s + parseFloat(i.gross_weight || 0), 0)
  const totalNet   = items.reduce((s, i) => s + parseFloat(i.net_weight   || 0), 0)
  const totalAmt   = items.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0)
  const wAvgPurity = totalNet > 0
    ? (items.reduce((s, i) => s + parseFloat(i.net_weight || 0) * parseFloat(i.purity || 0), 0) / totalNet)
    : 0

  const rows = items.map((it, i) => [
    String(i + 1),
    it.application_id || '',
    it.customer_name  || '',
    new Date(it.purchase_date).toLocaleDateString('en-GB'),
    Number(it.gross_weight || 0).toFixed(3),
    Number(it.net_weight   || 0).toFixed(3),
    Number(it.purity       || 0).toFixed(2),
    fmtIN(it.total_amount  || 0),
  ])

  autoTable(doc, {
    startY: y,
    head: [['#', 'APP ID', 'CUSTOMER', 'DATE', 'GROSS WT', 'NET WT', 'PURITY %', `VALUE (${RS})`]],
    body: rows,
    foot: [['', '', '', 'TOTAL',
      totalGross.toFixed(3),
      totalNet.toFixed(3),
      wAvgPurity.toFixed(2),
      fmtIN(totalAmt)
    ]],
    theme: 'grid',
    styles:      { fontSize: 7.5, cellPadding: 1.6, lineColor: BK, lineWidth: 0.15, textColor: BK },
    headStyles:  { fillColor: PR, textColor: WH, fontStyle: 'bold', halign: 'center' },
    footStyles:  { fillColor: HG, textColor: BK, fontStyle: 'bold', lineWidth: 0.3, lineColor: BK },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8  },
      1: { cellWidth: 22 },
      2: { cellWidth: 'auto' },
      3: { halign: 'center', cellWidth: 22 },
      4: { halign: 'right',  cellWidth: 18 },
      5: { halign: 'right',  cellWidth: 18 },
      6: { halign: 'right',  cellWidth: 16 },
      7: { halign: 'right',  cellWidth: 24 },
    },
    margin: { left: L, right: R },
  })

  y = doc.lastAutoTable.finalY + 4

  // ── SUMMARY BOX ──────────────────────────────────────────────────────────
  const sumH = 22
  doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(L, y, useW, sumH)
  doc.setFillColor(...HG); doc.rect(L, y, useW, 6, 'F'); doc.rect(L, y, useW, 6)
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text('TRANSFER SUMMARY', L + 2, y + 4)
  doc.setFontSize(8); doc.setTextColor(...BK)
  const sumRow = (label, val, x, ly) => {
    doc.setFont('helvetica', 'bold'); doc.text(label, x, ly)
    doc.setFont('helvetica', 'normal'); doc.text(val, x + 30, ly)
  }
  sumRow('Total Bills:',  String(items.length),                  L + 2,           y + 12)
  sumRow('Gross Wt:',     totalGross.toFixed(3) + ' g',          L + 2,           y + 17)
  sumRow('Net Wt:',       totalNet.toFixed(3)   + ' g',          L + half / 2,    y + 12)
  sumRow('Avg Purity:',   wAvgPurity ? wAvgPurity.toFixed(2) + '%' : '--',        L + half / 2, y + 17)
  sumRow('Indicative Value:', RS + ' ' + fmtIN(totalAmt),        L + half + 4,    y + 12)
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...GY)
  doc.text('No GST event - intra-company stock transfer', L + half + 4, y + 17)
  y += sumH + 3

  // ── AMOUNT IN WORDS ──────────────────────────────────────────────────────
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text('VALUE IN WORDS:', L, y + 4)
  doc.setFont('helvetica', 'normal')
  const wordsLines = doc.splitTextToSize(amountToWords(totalAmt), useW - 35)
  doc.text(wordsLines, L + 35, y + 4)
  y += 4 + wordsLines.length * 4 + 4

  // ── TRANSIT DETAILS (NEW — fillable form to use bottom space) ────────────
  const transitH = 26
  doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(L, y, useW, transitH)
  doc.setFillColor(...HG); doc.rect(L, y, useW, 6, 'F'); doc.rect(L, y, useW, 6)
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text('TRANSIT DETAILS (to be filled at handover)', L + 2, y + 4)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
  // 4 fields in a grid: Carrier Name | Phone | Vehicle/Mode | Seal/Lock No
  const colW = useW / 2
  const fieldRow = (label, x, ly) => {
    doc.setFont('helvetica', 'bold'); doc.text(label, x + 2, ly)
    doc.setLineWidth(0.2); doc.setDrawColor(...GY)
    doc.line(x + 30, ly + 0.5, x + colW - 4, ly + 0.5)
  }
  fieldRow('Carrier Name :',     L,         y + 12)
  fieldRow('Carrier Phone :',    L,         y + 18)
  fieldRow('Carrier ID Proof :', L,         y + 24)
  fieldRow('Vehicle / Mode :',   L + colW,  y + 12)
  fieldRow('Seal / Lock No :',   L + colW,  y + 18)
  fieldRow('Departure Time :',   L + colW,  y + 24)
  y += transitH + 3

  // ── FOOTER NOTE ──────────────────────────────────────────────────────────
  doc.setFontSize(6.8); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GY)
  const note = 'This is an internal stock transfer document for movement of inventory between two branches of the same legal entity. Inventory remains the property of the company throughout transit. Custody transfers to the receiving hub on signature below.'
  const noteLines = doc.splitTextToSize(note, useW)
  doc.text(noteLines, L, y + 3)
  y += noteLines.length * 3 + 6

  // ── SIGNATURE BLOCKS — taller, 4 fields, 1mm strip line for actual signature ─
  const sigY = Math.max(y, 244)
  const sigH = 36
  const sigW = (useW - 4) / 2
  ;[
    { label: 'ISSUED BY (Source Branch)', x: L },
    { label: 'RECEIVED BY (Hub)',         x: L + sigW + 4 },
  ].forEach(({ label, x }) => {
    doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(x, sigY, sigW, sigH)
    doc.setFillColor(...HG); doc.rect(x, sigY, sigW, 5, 'F'); doc.rect(x, sigY, sigW, 5)
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
    doc.text(label, x + 2, sigY + 3.5)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
    // Field rows with underlines for filling
    const sigField = (label, fy) => {
      doc.setFont('helvetica', 'bold'); doc.text(label, x + 2, fy)
      doc.setLineWidth(0.2); doc.setDrawColor(...GY)
      doc.line(x + 24, fy + 0.5, x + sigW - 3, fy + 0.5)
    }
    sigField('Name :',         sigY + 11)
    sigField('Designation :',  sigY + 17)
    sigField('Date / Time :',  sigY + 23)
    // Bigger signature box
    doc.setFont('helvetica', 'bold'); doc.text('Signature :', x + 2, sigY + 29)
    doc.setLineWidth(0.2); doc.setDrawColor(...GY)
    doc.line(x + 24, sigY + 33.5, x + sigW - 3, sigY + 33.5)
  })

  // ── PAGE FOOTER ──────────────────────────────────────────────────────────
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GY)
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}  |  ${consignment.tmp_prf_no || ''}  |  Page 1 of 1`,
    L + useW / 2, 290, { align: 'center' })

  return doc
}
