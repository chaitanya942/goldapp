// lib/generateIssueVoucher.js
// Issue Voucher — Branch → Hub inventory transfer document.
// Distinct from Delivery Challan: no GST, no transporter section, simpler format.
//
// IMPORTANT — value/weight redaction (per management directive):
// This document goes to branch employees during the physical handover. They
// only need to verify the bill list (customer name, application ID) and a
// single consolidated gross weight to weigh against. Per-bill weights, per-
// bill values, total invoice value, and "amount in words" are NOT rendered
// here. Accounts and management still see the full numbers in-app and on the
// EWB / E-Invoice payloads (those are separate documents accounts owns).
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtIN as fmtINShared } from './pdfHelpers'
import { computeConsignmentTotals } from './consignmentTotals'
import { computeAuditHash } from './auditHash'

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

  const fmtIN = fmtINShared
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

  // ── ISSUED FROM / RECEIVED AT (auto-sized to fit address + GSTIN + contact) ─
  // Block heights are computed up front so the two halves stay equal —
  // top label (4) + branch name (6) + address lines + GSTIN (6 if present) +
  // contact line (5 if branch has a contact_person) + bottom padding (4).
  doc.setFontSize(7.5)
  const fromAddr     = doc.splitTextToSize(buildBranchLine(sourceBranch) || '—', half - 5)
  const toAddr       = doc.splitTextToSize(buildBranchLine(destBranch)   || '—', half - 5)
  const fromContact  = sourceBranch?.contact_person || ''
  const fromCPhone   = sourceBranch?.contact_phone  || ''
  const blkH = Math.max(
    4 + 6 + fromAddr.length * 3.5 + (sourceBranch?.branch_gstin ? 6 : 0) + (fromContact ? 6 : 0) + 4,
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
  let leftCur = blkY + 14 + fromAddr.length * 3.5
  if (sourceBranch?.branch_gstin) {
    leftCur += 2
    doc.setFont('helvetica', 'bold'); doc.text('GSTIN: ', L + 2, leftCur)
    doc.setFont('helvetica', 'normal'); doc.text(sourceBranch.branch_gstin, L + 16, leftCur)
    leftCur += 4
  }
  // Branch Contact line — pulls the consignment override if set, branch
  // default otherwise (resolved in lib/consignmentSnapshot.js). Skipped
  // cleanly when neither is configured.
  if (fromContact) {
    if (!sourceBranch?.branch_gstin) leftCur += 2   // pad below address when no GSTIN row preceded
    doc.setFont('helvetica', 'bold'); doc.text('CONTACT: ', L + 2, leftCur)
    doc.setFont('helvetica', 'normal')
    const contactLine = fromCPhone ? `${fromContact} · ${fromCPhone}` : fromContact
    doc.text(contactLine, L + 18, leftCur)
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

  // ── ITEMS TABLE — branch verification only ───────────────────────────────
  // Per-bill weights / values are intentionally NOT in this table. Branch
  // staff verify each line by customer name + application ID + branch they
  // came from. The hub re-weighs on receipt and reconciles against the
  // consolidated total below.
  const T = computeConsignmentTotals({ consignment, items, companySettings: companySettings || {} })

  const rows = items.map((it, i) => [
    String(i + 1),
    it.application_id || '',
    it.customer_name  || '',
    it.purchase_date ? new Date(it.purchase_date).toLocaleDateString('en-GB') : '',
    it.branch_name || sourceBranch?.name || '',
  ])

  autoTable(doc, {
    startY: y,
    head: [['#', 'APP ID', 'CUSTOMER', 'DATE', 'BRANCH']],
    body: rows,
    theme: 'grid',
    styles:      { fontSize: 8.5, cellPadding: 2, lineColor: BK, lineWidth: 0.15, textColor: BK },
    headStyles:  { fillColor: PR, textColor: WH, fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 30 },
      2: { cellWidth: 'auto' },
      3: { halign: 'center', cellWidth: 26 },
      4: { cellWidth: 44 },
    },
    margin: { left: L, right: R },
  })

  y = doc.lastAutoTable.finalY + 4

  // ── BILL SUMMARY BAND — total bills + consolidated gross weight ──────────
  // Two cells: total bills (left), consolidated gross weight (right).
  // Tinted purple to match the document accent.
  const sumH = 14
  doc.setDrawColor(...PR); doc.setLineWidth(0.4); doc.rect(L, y, useW, sumH)
  doc.setFillColor(...HG); doc.rect(L + 0.4, y + 0.4, useW - 0.8, sumH - 0.8, 'F')
  doc.setLineWidth(0.2); doc.setDrawColor(...PR)
  doc.line(L + half, y, L + half, y + sumH)

  const sumMidY = y + sumH * 0.55
  const sumLblY = y + 5

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text('TOTAL BILLS', L + half / 2, sumLblY, { align: 'center' })
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text(String(T.bills), L + half / 2, sumMidY + 4, { align: 'center' })

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text('CONSOLIDATED GROSS WEIGHT', L + half + half / 2, sumLblY, { align: 'center' })
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text(`${T.totalGrossWt.toFixed(3)} g`, L + half + half / 2, sumMidY + 4, { align: 'center' })

  y += sumH + 3

  // ── VALUE BREAKDOWN BAND ─────────────────────────────────────────────────
  // The same numbers that flow into the EWB and E-Invoice payloads (computed
  // by the shared lib/consignmentTotals.js so all five docs agree).
  // Four cells: Total Value · Markup · IGST · Grand Total.
  // For Branch → Hub (intra-company), markup and IGST are zero and the cells
  // show '—' so it reads as 'not applicable, not missing'.
  const valH = 18
  doc.setDrawColor(...PR); doc.setLineWidth(0.4); doc.rect(L, y, useW, valH)
  doc.setFillColor(...HG); doc.rect(L + 0.4, y + 0.4, useW - 0.8, valH - 0.8, 'F')
  const valColW = useW / 4
  doc.setLineWidth(0.2); doc.setDrawColor(...PR)
  for (let i = 1; i < 4; i++) doc.line(L + valColW * i, y, L + valColW * i, y + valH)

  const valLblY = y + 5
  const valNumY = y + valH * 0.78
  const drawValCell = (label, value, idx, accent = BK) => {
    const cx = L + valColW * idx + valColW / 2
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
    doc.text(label, cx, valLblY, { align: 'center' })
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...accent)
    doc.text(value, cx, valNumY, { align: 'center' })
  }

  const dash = '—'
  drawValCell('TOTAL VALUE',           `${RS} ${fmtIN(T.rawValue)}`,                                        0, BK)
  drawValCell(`MARKUP @ ${T.upliftPct}%`, T.isExternalInterstate ? `${RS} ${fmtIN(T.markupAmt)}` : dash,     1, BK)
  drawValCell(`IGST @ ${T.gstRate}%`,    T.isExternalInterstate ? `${RS} ${fmtIN(T.igstAmt)}`   : dash,     2, BK)
  drawValCell('GRAND TOTAL',           `${RS} ${fmtIN(T.grandTotal)}`,                                      3, PR)

  y += valH + 3

  // Disclaimer caption beneath the value band.
  // jsPDF default helvetica doesn't render '→' (turns into '!''). Use the ARR
  // ASCII constant defined at the top of the file. Lines rendered manually
  // with an explicit y-offset (jsPDF's array-text path was overlapping lines
  // and cutting the middle of the sentence — rendering each line in its own
  // doc.text() call gives us deterministic spacing).
  doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GY)
  const intraCompanyNote = `No GST event - intra-company stock transfer. Markup and IGST do not apply for Branch ${ARR} Hub flows. Per-bill weights and values are confidential and not included on this document.`
  const interstateNote   = 'Markup and IGST are applied for interstate movements per company policy. The values above are the same that will flow to the E-Way Bill and E-Invoice.'
  const disclaimer       = T.isExternalInterstate ? interstateNote : intraCompanyNote
  const disclaimerLines  = doc.splitTextToSize(disclaimer, useW - 2)
  const lineGap          = 3.4
  disclaimerLines.forEach((line, i) => doc.text(line, L, y + 3 + i * lineGap))
  y += disclaimerLines.length * lineGap + 3

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

  // ── AUDIT FINGERPRINT ────────────────────────────────────────────────────
  // Same 8-char hash printed on the Consignee Report / Delivery Challan and
  // exposed in the document-audit response (so accounts can read it off the
  // EWB / E-Invoice previews too). If hashes match across docs, every audited
  // field agrees. Different hash = manual investigation before goods move.
  const auditHash = computeAuditHash({ consignment, branch: sourceBranch, totals: T })
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PR)
  doc.text(`AUDIT HASH:  ${auditHash}`, L, 284)
  doc.setFontSize(6.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GY)
  doc.text('Cross-check this hash against the Consignee Report and EWB / E-Invoice. All should match.',
    L + useW, 284, { align: 'right' })

  // ── PAGE FOOTER ──────────────────────────────────────────────────────────
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GY)
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}  |  ${consignment.tmp_prf_no || ''}  |  Page 1 of 1`,
    L + useW / 2, 290, { align: 'center' })

  return doc
}
