// lib/generateIssueVoucher.js
// Issue Voucher — Branch → Hub inventory transfer document.
// Distinct from Delivery Challan: no GST, no transporter section, simpler format.
//
// Visual language deliberately matches the Delivery Challan / E-Invoice — a
// formal black-grid GST-style document (grey header strips, white address
// cells, a single red accent on the tamper-proof number), NOT a coloured card
// layout. Keeps every White Gold document looking like one consistent set.
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
  const raw   = (branch?.address || '').trim()
  const parts = raw ? [raw] : []
  const has   = (s) => s && raw.toUpperCase().includes(String(s).trim().toUpperCase())
  const city  = (branch?.city  || '').trim()
  const state = (branch?.state || '').trim()
  const pin   = (branch?.pin_code || '').toString().trim()
  // Only append city / state / PIN the address doesn't already contain — avoids
  // "…Palakkad, Kerala - 678001, PALAKKAD, KERALA 678001" style duplication.
  if (city  && !has(city))  parts.push(city.toUpperCase())
  if (state && !has(state)) parts.push(state.toUpperCase() + (pin && !has(pin) ? ' ' + pin : ''))
  else if (pin && !has(pin)) parts.push(pin)
  return parts.join(', ')
}

export function generateIssueVoucher({ consignment, sourceBranch, destBranch, companySettings, items, logoBase64 }) {
  const doc  = new jsPDF('p', 'mm', 'a4')
  const L    = 12, R = 12
  const useW = 210 - L - R
  const half = useW / 2

  // ── Palette — same formal set as the Delivery Challan / E-Invoice ──
  const BK = [0, 0, 0],   WH = [255, 255, 255]
  const GY = [130, 130, 130]
  const HG = [245, 245, 245]   // light-grey header strips / table header fill
  const RD = [180, 20, 20]     // tamper-proof number accent (matches the Challan)
  const SL = [70, 70, 78]      // dark-slate for small uppercase section labels

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

  // Title — black bold with an underline, exactly like "DELIVERY CHALLAN".
  doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  const titleStr = 'ISSUE VOUCHER'
  doc.text(titleStr, L + useW / 2, y + 11, { align: 'center' })
  const tw = doc.getTextWidth(titleStr)
  doc.setDrawColor(...BK); doc.setLineWidth(0.5)
  doc.line(L + useW / 2 - tw / 2, y + 12.6, L + useW / 2 + tw / 2, y + 12.6)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GY)
  doc.text('INTER-BRANCH INVENTORY TRANSFER', L + useW / 2, y + 18, { align: 'center' })
  doc.setFontSize(9); doc.setTextColor(...BK); doc.setFont('helvetica', 'bold')
  doc.text(companySettings.company_name || '', L + useW / 2, y + 25, { align: 'center' })

  // TMP PRF box — black border, red number (mirrors the Delivery Challan).
  doc.setDrawColor(...BK); doc.setLineWidth(0.4)
  doc.rect(L + useW - 50, y + 4, 46, 8)
  doc.setFontSize(6.5); doc.setTextColor(...SL); doc.setFont('helvetica', 'bold')
  doc.text('TMP PRF NO', L + useW - 47, y + 9.5)
  doc.setFontSize(8.5); doc.setTextColor(...RD); doc.setFont('helvetica', 'bold')
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

  // ── ISSUED FROM / RECEIVED AT (white cells, black border — like the Challan) ─
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
  doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(L, blkY, half - 1, blkH)
  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
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
  // default otherwise (resolved in lib/consignmentSnapshot.js).
  if (fromContact) {
    if (!sourceBranch?.branch_gstin) leftCur += 2
    doc.setFont('helvetica', 'bold'); doc.text('CONTACT: ', L + 2, leftCur)
    doc.setFont('helvetica', 'normal')
    const contactLine = fromCPhone ? `${fromContact} · ${fromCPhone}` : fromContact
    doc.text(contactLine, L + 18, leftCur)
  }

  // Right: Received At
  doc.setDrawColor(...BK); doc.rect(L + half + 1, blkY, half - 1, blkH)
  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
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
    headStyles:  { fillColor: HG, textColor: BK, fontStyle: 'bold', halign: 'center', lineColor: BK, lineWidth: 0.15 },
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
  const sumH = 14
  doc.setFillColor(...HG); doc.rect(L, y, useW, sumH, 'F')
  doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(L, y, useW, sumH)
  doc.line(L + half, y, L + half, y + sumH)

  const sumMidY = y + sumH * 0.55
  const sumLblY = y + 5

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
  doc.text('TOTAL BILLS', L + half / 2, sumLblY, { align: 'center' })
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text(String(T.bills), L + half / 2, sumMidY + 4, { align: 'center' })

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
  doc.text('CONSOLIDATED GROSS WEIGHT', L + half + half / 2, sumLblY, { align: 'center' })
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...BK)
  doc.text(`${T.totalGrossWt.toFixed(3)} g`, L + half + half / 2, sumMidY + 4, { align: 'center' })

  y += sumH + 3

  // ── VALUE BREAKDOWN BAND ─────────────────────────────────────────────────
  // The same numbers that flow into the EWB and E-Invoice payloads (computed
  // by the shared lib/consignmentTotals.js so all five docs agree).
  // Four cells: Total Value · Markup · IGST · Grand Total. For Branch → Hub
  // (intra-company) markup and IGST are '—' (not applicable, not missing).
  const valH = 18
  doc.setFillColor(...HG); doc.rect(L, y, useW, valH, 'F')
  doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(L, y, useW, valH)
  const valColW = useW / 4
  for (let i = 1; i < 4; i++) doc.line(L + valColW * i, y, L + valColW * i, y + valH)

  const valLblY = y + 5
  const valNumY = y + valH * 0.78
  const drawValCell = (label, value, idx, accent = BK) => {
    const cx = L + valColW * idx + valColW / 2
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
    doc.text(label, cx, valLblY, { align: 'center' })
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...accent)
    doc.text(value, cx, valNumY, { align: 'center' })
  }

  const dash = '—'
  drawValCell('TOTAL VALUE',            `${RS} ${fmtIN(T.rawValue)}`,                                    0, BK)
  drawValCell(`MARKUP @ ${T.upliftPct}%`, T.isExternalInterstate ? `${RS} ${fmtIN(T.markupAmt)}` : dash, 1, BK)
  drawValCell(`IGST @ ${T.gstRate}%`,     T.isExternalInterstate ? `${RS} ${fmtIN(T.igstAmt)}`   : dash, 2, BK)
  drawValCell('GRAND TOTAL',            `${RS} ${fmtIN(T.grandTotal)}`,                                  3, BK)

  y += valH + 3

  // Disclaimer caption beneath the value band.
  doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GY)
  const intraCompanyNote = `No GST event - intra-company stock transfer. Markup and IGST do not apply for Branch ${ARR} Hub flows. Per-bill weights and values are confidential and not included on this document.`
  const interstateNote   = 'Markup and IGST are applied for interstate movements per company policy. The values above are the same that will flow to the E-Way Bill and E-Invoice.'
  const disclaimer       = T.isExternalInterstate ? interstateNote : intraCompanyNote
  const disclaimerLines  = doc.splitTextToSize(disclaimer, useW - 2)
  const lineGap          = 3.4
  disclaimerLines.forEach((line, i) => doc.text(line, L, y + 3 + i * lineGap))
  y += disclaimerLines.length * lineGap + 3

  // ── TRANSIT DETAILS (fillable form) ──────────────────────────────────────
  const transitH = 26
  doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(L, y, useW, transitH)
  doc.setFillColor(...HG); doc.rect(L, y, useW, 6, 'F'); doc.rect(L, y, useW, 6)
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
  doc.text('TRANSIT DETAILS (to be filled at handover)', L + 2, y + 4)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
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

  // ── REMARKS / DISCREPANCIES ──────────────────────────────────────────────
  // Fills the mid-page space with something useful: ruled lines for the branch
  // and hub to note any weight variance, missing bills, or seal issues at
  // handover. Sized to the gap that remains before the signature blocks.
  const remAvail = 244 - y - 4
  if (remAvail >= 22) {
    const remH = Math.min(remAvail, 46)
    doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(L, y, useW, remH)
    doc.setFillColor(...HG); doc.rect(L, y, useW, 6, 'F'); doc.rect(L, y, useW, 6)
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
    doc.text('REMARKS / DISCREPANCIES NOTED ON HANDOVER', L + 2, y + 4)
    doc.setLineWidth(0.15); doc.setDrawColor(214, 214, 214)
    for (let ly = y + 13; ly <= y + remH - 3.5; ly += 7) doc.line(L + 3, ly, L + useW - 3, ly)
    y += remH + 4
  }

  // ── SIGNATURE BLOCKS ─────────────────────────────────────────────────────
  const sigY = Math.max(y, 244)
  const sigH = 36
  const sigW = (useW - 4) / 2
  ;[
    { label: 'ISSUED BY (Source Branch)', x: L },
    { label: 'RECEIVED BY (Hub)',         x: L + sigW + 4 },
  ].forEach(({ label, x }) => {
    doc.setDrawColor(...BK); doc.setLineWidth(0.3); doc.rect(x, sigY, sigW, sigH)
    doc.setFillColor(...HG); doc.rect(x, sigY, sigW, 5, 'F'); doc.rect(x, sigY, sigW, 5)
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...SL)
    doc.text(label, x + 2, sigY + 3.5)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...BK)
    const sigField = (label, fy) => {
      doc.setFont('helvetica', 'bold'); doc.text(label, x + 2, fy)
      doc.setLineWidth(0.2); doc.setDrawColor(...GY)
      doc.line(x + 24, fy + 0.5, x + sigW - 3, fy + 0.5)
    }
    sigField('Name :',         sigY + 11)
    sigField('Designation :',  sigY + 17)
    sigField('Date / Time :',  sigY + 23)
    doc.setFont('helvetica', 'bold'); doc.text('Signature :', x + 2, sigY + 29)
    doc.setLineWidth(0.2); doc.setDrawColor(...GY)
    doc.line(x + 24, sigY + 33.5, x + sigW - 3, sigY + 33.5)
  })

  // ── AUDIT FINGERPRINT ────────────────────────────────────────────────────
  // 8-char fingerprint of this consignment's audited figures, also printed on
  // the Consignee Report. NOT on the Delivery Challan / EWB / E-Invoice.
  const auditHash = computeAuditHash({ consignment, branch: sourceBranch, totals: T })
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 60)
  doc.text(`AUDIT HASH:  ${auditHash}`, L, 284)
  doc.setFontSize(6.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GY)
  doc.text('Cross-check this hash against the Consignee Report for this consignment — both must match.',
    L + useW, 284, { align: 'right' })

  // ── PAGE FOOTER ──────────────────────────────────────────────────────────
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GY)
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}  |  ${consignment.tmp_prf_no || ''}  |  Page 1 of 1`,
    L + useW / 2, 290, { align: 'center' })

  return doc
}
