// Renders a printable E-Invoice PDF from the ClearTax/IRP signed response.
// We don't depend on a ClearTax "print PDF" endpoint (it doesn't exist) —
// instead we render the invoice ourselves and embed the SignedQRCode JWT
// as a QR image. Anyone can scan that QR and verify against NIC IRP.

import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import QRCode from 'qrcode'

const fmtIN = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function generateEInvoicePdf({ consignment, branch, items, companySettings, irn, ackNo, ackDt, signedQrCode }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const M = 12

  const cs   = companySettings || {}
  const isInternal   = consignment?.movement_type === 'INTERNAL'
  const sc           = consignment?.state_code || 'KA'
  const isInterstate = !isInternal && sc !== 'KA'
  const upliftPct    = parseFloat(cs.value_uplift_pct ?? 7.5) || 0
  const igstRate     = parseFloat(cs.igst_rate        ?? 3) || 3

  const totalGross = items.reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0)
  const totalNet   = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const rawAmt     = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)
  const assAmt     = isInterstate ? rawAmt * (1 + upliftPct / 100) : rawAmt
  const igst       = isInterstate ? assAmt * (igstRate / 100) : 0
  const grand      = assAmt + igst

  // ── Header ──
  doc.setFillColor(76, 35, 110)
  doc.rect(M, M, W - 2 * M, 14, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('E-INVOICE (IRP REGISTERED)', W / 2, M + 9, { align: 'center' })

  doc.setTextColor(0, 0, 0)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(cs.company_name || 'White Gold Bullion Pvt Ltd', M, M + 22)
  doc.text(`PAN: ${cs.pan || ''}`, M, M + 27)

  // ── IRN block ──
  let y = M + 34
  doc.setDrawColor(180, 180, 180)
  doc.rect(M, y, W - 2 * M, 22)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text('IRN', M + 2, y + 4)
  doc.text('Ack No', M + 2, y + 11)
  doc.text('Ack Date', M + 2, y + 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(String(irn || ''), M + 18, y + 4)
  doc.setFontSize(8)
  doc.text(String(ackNo || ''), M + 18, y + 11)
  doc.text(String(ackDt || ''), M + 18, y + 18)

  // ── QR ──
  if (signedQrCode) {
    try {
      const qrDataUrl = await QRCode.toDataURL(String(signedQrCode), { errorCorrectionLevel: 'L', margin: 0, width: 150 })
      doc.addImage(qrDataUrl, 'PNG', W - M - 22, y + 1, 20, 20)
    } catch {}
  }
  y += 28

  // ── Seller / Buyer ──
  const colW = (W - 2 * M - 4) / 2
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text('SELLER / DISPATCH FROM', M, y)
  doc.text('BUYER / SHIP TO', M + colW + 4, y)
  y += 4
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  const sellerLines = [
    cs.company_name || 'White Gold Bullion Pvt Ltd',
    branch?.name || '',
    branch?.address || '',
    `${branch?.city || ''} - ${branch?.pin_code || ''}`,
    `GSTIN: ${cs[`gstin_${sc.toLowerCase()}`] || branch?.branch_gstin || ''}`,
  ]
  const buyerLines = [
    cs.company_name || 'White Gold Bullion Pvt Ltd',
    cs.head_office_building || '',
    cs.head_office_address || '',
    `${cs.head_office_city || ''} - ${cs.head_office_pin || ''}`,
    `GSTIN: ${cs.gstin || cs.gstin_ka || ''}`,
  ]
  for (let i = 0; i < Math.max(sellerLines.length, buyerLines.length); i++) {
    if (sellerLines[i]) doc.text(String(sellerLines[i]).slice(0, 60), M, y + i * 4)
    if (buyerLines[i])  doc.text(String(buyerLines[i]).slice(0, 60),  M + colW + 4, y + i * 4)
  }
  y += Math.max(sellerLines.length, buyerLines.length) * 4 + 4

  // ── Document details ──
  doc.setDrawColor(180, 180, 180)
  doc.rect(M, y, W - 2 * M, 8)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text(`Doc No: ${consignment?.tmp_prf_no || ''}`, M + 2, y + 5.5)
  doc.text(`Doc Type: INV`,            M + 60, y + 5.5)
  doc.text(`Doc Date: ${new Date(consignment?.created_at || Date.now()).toLocaleDateString('en-IN')}`, M + 110, y + 5.5)
  y += 12

  // ── Items table ──
  doc.autoTable({
    startY: y,
    head: [['#', 'Product', 'HSN', 'Qty', 'Unit', 'Net Wt', 'Rate', 'Assessable', 'GST%', 'IGST', 'Total']],
    body: [[
      '1',
      cs.product_name || 'Used Gold Ornaments and Gold Jewellery',
      cs.hsn_code || '71131910',
      totalGross.toFixed(3),
      'GMS',
      totalNet.toFixed(3),
      totalGross > 0 ? (assAmt / totalGross).toFixed(2) : '0.00',
      fmtIN(assAmt),
      isInterstate ? igstRate.toFixed(2) : '0.00',
      fmtIN(igst),
      fmtIN(grand),
    ]],
    styles:    { fontSize: 7, cellPadding: 1.2 },
    headStyles:{ fillColor: [76, 35, 110], textColor: 255, fontSize: 7, halign: 'center' },
    margin: { left: M, right: M },
    theme: 'grid',
  })
  y = doc.lastAutoTable.finalY + 4

  // ── Totals ──
  const rightX = W - M - 60
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  const rows = [
    ['Assessable Value',           fmtIN(assAmt)],
    [`IGST @ ${igstRate}%`,        fmtIN(igst)],
    ['CGST',                       '0.00'],
    ['SGST',                       '0.00'],
    ['Round Off',                  '0.00'],
  ]
  for (const [k, v] of rows) {
    doc.text(k, rightX, y)
    doc.text(v, W - M, y, { align: 'right' })
    y += 4.5
  }
  doc.setDrawColor(0, 0, 0)
  doc.line(rightX, y - 2, W - M, y - 2)
  doc.setFont('helvetica', 'bold')
  doc.text('Total Invoice Value', rightX, y + 2)
  doc.text(fmtIN(grand), W - M, y + 2, { align: 'right' })
  y += 8

  // ── Footer ──
  doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5)
  doc.setTextColor(120, 120, 120)
  doc.text('This is a digitally registered E-Invoice. Verify on the NIC e-Invoice portal using the QR code above.', M, 285)

  return Buffer.from(doc.output('arraybuffer'))
}
