// lib/generateConsigneeReport.js
// Generates Gold Consignee Report PDF

import jsPDF from 'jspdf'
import 'jspdf-autotable'

export function generateConsigneeReport({ consignment, branch, companySettings, items }) {
  const doc       = new jsPDF('l', 'mm', 'a4')   // landscape for wide table
  const pageW     = doc.internal.pageSize.getWidth()
  const blue      = [0, 51, 153]
  const black     = [0, 0, 0]
  const gray      = [100, 100, 100]
  const red       = [200, 0, 0]
  const lightGray = [240, 240, 240]

  const challanDate = new Date(consignment.created_at)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()
    .replace(/ /g, '-')

  let y = 10

  // ── Header box ────────────────────────────────────────────────────────────
  doc.setDrawColor(...blue)
  doc.setLineWidth(0.5)
  doc.rect(10, y, pageW - 20, 20)

  // Logo block
  doc.setFillColor(...blue)
  doc.rect(10, y, 30, 20, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('WHITE', 13, y + 8)
  doc.text('GOLD', 13, y + 15)

  // Company name + title
  doc.setTextColor(...black)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(companySettings.company_name || 'WHITE GOLD BULLION PVT.LTD', pageW / 2, y + 8, { align: 'center' })

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...gray)
  doc.text('GOLD CONSIGNEE REPORT', pageW / 2, y + 14, { align: 'center' })

  // Tamper proof no (red, right side)
  doc.setTextColor(...red)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(`TAMPER PROOF No: ${consignment.tmp_prf_no}`, pageW - 14, y + 8, { align: 'right' })
  doc.setTextColor(...gray)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text(`CHALLAN No: ${consignment.challan_no}`, pageW - 14, y + 14, { align: 'right' })

  y += 22

  // ── Info row ──────────────────────────────────────────────────────────────
  doc.setFontSize(8)
  doc.setTextColor(...black)

  const infoLeft = [
    `BRANCH: ${consignment.branch_name}`,
    `ADDRESS: ${[branch.address, branch.city, branch.state, branch.pin_code].filter(Boolean).join(', ') || '—'}`,
  ]
  const infoRight = [
    `DATE: ${challanDate}`,
    `GSTIN: ${branch.branch_gstin || '—'}`,
  ]

  doc.setFont('helvetica', 'bold')
  doc.text(infoLeft[0], 12, y)
  doc.text(infoLeft[1], 12, y + 5)
  doc.setFont('helvetica', 'bold')
  doc.text(infoRight[0], pageW - 12, y, { align: 'right' })
  doc.text(infoRight[1], pageW - 12, y + 5, { align: 'right' })

  y += 9

  // ── Items table ───────────────────────────────────────────────────────────
  const totalGross  = items.reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0)
  const totalStone  = items.reduce((s, p) => s + parseFloat(p.stone_weight || 0), 0)
  const totalWaste  = items.reduce((s, p) => s + parseFloat(p.wastage || 0), 0)
  const totalNet    = items.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
  const totalAmount = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

  const fmtG = (n) => parseFloat(n || 0).toFixed(3)
  const fmtA = (n) => parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''

  const rows = items.map((p, i) => [
    i + 1,
    fmtD(p.purchase_date),
    p.customer_name || '—',
    p.branch_name || consignment.branch_name,
    fmtG(p.gross_weight),
    fmtG(p.stone_weight),
    fmtG(p.wastage),
    fmtG(p.net_weight),
    fmtA(p.total_amount),
  ])

  doc.autoTable({
    startY: y,
    head: [[
      'S.No', 'Date', 'Customer Name', 'Branch',
      'Gross Wt\n(g)', 'Stone\n(g)', 'Wastage\n(g)', 'Net Wt\n(g)', 'Amount\n(₹)',
    ]],
    body: rows,
    foot: [[
      '', '', '', 'TOTAL',
      fmtG(totalGross),
      fmtG(totalStone),
      fmtG(totalWaste),
      fmtG(totalNet),
      fmtA(totalAmount),
    ]],
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.5, lineColor: [180, 180, 180], lineWidth: 0.2 },
    headStyles: { fillColor: lightGray, textColor: black, fontStyle: 'bold', halign: 'center', fontSize: 7.5 },
    footStyles: { fillColor: [245, 245, 245], textColor: black, fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'center', cellWidth: 22 },
      2: { halign: 'left',   cellWidth: 55 },
      3: { halign: 'left',   cellWidth: 42 },
      4: { halign: 'right',  cellWidth: 22 },
      5: { halign: 'right',  cellWidth: 20 },
      6: { halign: 'right',  cellWidth: 22 },
      7: { halign: 'right',  cellWidth: 22 },
      8: { halign: 'right',  cellWidth: 30 },
    },
    didParseCell(data) {
      // Bold totals row
      if (data.section === 'foot') {
        data.cell.styles.halign = data.column.index < 4 ? (data.column.index === 3 ? 'center' : 'left') : 'right'
      }
    },
    margin: { left: 10, right: 10 },
  })

  y = doc.lastAutoTable.finalY + 4

  // ── Summary strip ─────────────────────────────────────────────────────────
  doc.setFillColor(245, 245, 245)
  doc.rect(10, y, pageW - 20, 9, 'F')
  doc.setDrawColor(180, 180, 180)
  doc.rect(10, y, pageW - 20, 9)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...black)
  doc.text(
    `Total Bills: ${items.length}   |   Total Net Weight: ${fmtG(totalNet)} g   |   Total Amount: ₹${fmtA(totalAmount)}`,
    pageW / 2, y + 5.5, { align: 'center' }
  )

  y += 12

  // ── NOTE ──────────────────────────────────────────────────────────────────
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...black)
  doc.text('NOTE:', 12, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...gray)
  const noteLines = doc.splitTextToSize(
    'This is a computer-generated document. All gold items listed above have been dispatched in sealed tamper-proof bags bearing the above Tamper Proof Number. The receiving branch must verify each item on delivery and report any discrepancy to Head Office within 24 hours. This document is to be retained by the branch as proof of receipt.',
    pageW - 35
  )
  doc.text(noteLines, 25, y)

  y += noteLines.length * 4 + 6

  // ── Signature blocks ──────────────────────────────────────────────────────
  const sigW = (pageW - 30) / 3
  doc.setDrawColor(...gray)
  doc.setLineWidth(0.2)
  ;[
    { label: "Prepared By",        x: 10 },
    { label: "Authorised By",      x: 10 + sigW + 5 },
    { label: "Receiver's Signature", x: 10 + (sigW + 5) * 2 },
  ].forEach(({ label, x }) => {
    doc.rect(x, y, sigW, 16)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...gray)
    doc.text(label, x + sigW / 2, y + 13, { align: 'center' })
  })

  return doc
}
