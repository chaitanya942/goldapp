// lib/generateConsigneeReport.js
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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

export function generateConsigneeReport({ consignment, items }) {
  const doc   = new jsPDF('l', 'mm', 'a4')
  const pageW = 297
  const L = 8, R = 8
  const useW = pageW - L - R  // 281

  const ORANGE = [196, 73, 0]
  const WHITE  = [255, 255, 255]
  const BLACK  = [0, 0, 0]
  const RED    = [176, 0, 0]
  const DBLUE  = [0, 0, 160]

  // Column widths (must sum to 281)
  const CW = [12, 35, 55, 33, 22, 19, 19, 22, 64]
  // Cumulative x positions
  const CX = CW.reduce((acc, _w, i) => { acc.push(i === 0 ? L : acc[i - 1] + CW[i - 1]); return acc }, [])

  // Right section (NET WT + GROSS AMT = cols 7+8)
  const rightColsStart = CX[7]           // x where right section starts
  const rightColsW     = CW[7] + CW[8]  // 86
  const leftColsW      = useW - rightColsW // 195

  const challanDate = new Date(consignment.created_at)
  const dateStr = [
    String(challanDate.getDate()).padStart(2, '0'),
    String(challanDate.getMonth() + 1).padStart(2, '0'),
    challanDate.getFullYear(),
  ].join('-')

  function fmtDate(d) {
    if (!d) return ''
    const dt  = new Date(d)
    const day = String(dt.getDate()).padStart(2, '0')
    const mon = dt.toLocaleString('en-US', { month: 'short' })
    const yr  = dt.getFullYear()
    const wd  = dt.toLocaleString('en-US', { weekday: 'short' })
    return `${day}-${mon}-${yr},${wd}`
  }

  // Raw number display (minimal decimals, matches source data)
  const raw = (x) => String(parseFloat(parseFloat(x || 0).toFixed(3)))

  const totalGross = items.reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0)
  const totalStone = items.reduce((s, p) => s + parseFloat(p.stone_weight || 0), 0)
  const totalWaste = items.reduce((s, p) => s + parseFloat(p.wastage      || 0), 0)
  const totalNet   = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const totalAmt   = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

  // ── Title bar ─────────────────────────────────────────────────────────────
  let y = 8
  doc.setFillColor(...ORANGE)
  doc.rect(L, y, useW, 9, 'F')
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(L, y, useW, 9)

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.text('WHITE GOLD BULLION PVT LTD , GOLD CONSIGNEE REPORT', L + 3, y + 6.3)
  doc.setFontSize(9)
  doc.text('(EXTERNAL-MOVEMENT)', L + useW * 0.67, y + 6.3)
  doc.text(dateStr, L + useW - 2, y + 6.3, { align: 'right' })

  y += 10

  // ── Data table ────────────────────────────────────────────────────────────
  const dataRows = items.map((p, i) => [
    i + 1,
    fmtDate(p.purchase_date),
    p.customer_name || '',
    p.branch_name   || consignment.branch_name,
    raw(p.gross_weight),
    raw(p.stone_weight),
    raw(p.wastage),
    raw(p.net_weight),
    raw(p.total_amount),
  ])

  const totalsRow = [
    items.length, '', '', '',
    totalGross.toFixed(2),
    totalStone.toFixed(2),
    totalWaste.toFixed(2),
    totalNet.toFixed(2),
    totalAmt.toFixed(2),
  ]

  autoTable(doc, {
    startY: y,
    head: [['S.N', 'DATE', 'CUST NAME', 'BRANCH NAME', 'GRS WT', 'STONE', 'WSTG', 'NET WT', 'GROSS AMT']],
    body: [...dataRows, totalsRow],
    theme: 'grid',
    headStyles: {
      fillColor: ORANGE, textColor: WHITE, fontStyle: 'bold',
      halign: 'center', fontSize: 8, cellPadding: 2.5,
    },
    styles: { fontSize: 8, cellPadding: 2.5, lineColor: BLACK, lineWidth: 0.2, textColor: BLACK },
    columnStyles: {
      0: { halign: 'center', cellWidth: CW[0] },
      1: { halign: 'center', cellWidth: CW[1] },
      2: { halign: 'left',   cellWidth: CW[2] },
      3: { halign: 'left',   cellWidth: CW[3] },
      4: { halign: 'right',  cellWidth: CW[4] },
      5: { halign: 'right',  cellWidth: CW[5] },
      6: { halign: 'right',  cellWidth: CW[6] },
      7: { halign: 'right',  cellWidth: CW[7] },
      8: { halign: 'right',  cellWidth: CW[8] },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === dataRows.length) {
        data.cell.styles.fillColor  = ORANGE
        data.cell.styles.textColor  = WHITE
        data.cell.styles.fontStyle  = 'bold'
        data.cell.styles.halign     = data.column.index === 0 ? 'center' : data.column.index < 4 ? 'left' : 'right'
      }
    },
    margin: { left: L, right: R },
  })

  const tableBottom = doc.lastAutoTable.finalY

  // ── Ref / Tamper row ──────────────────────────────────────────────────────
  const refH  = 9
  const valH  = refH / 2   // 4.5 each for VALUE OF GOODS / GRAND TOTAL
  const lblW  = 52          // label portion inside right section

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.2)
  doc.rect(L, tableBottom, leftColsW, refH)
  doc.rect(rightColsStart, tableBottom,        rightColsW, valH)
  doc.rect(rightColsStart, tableBottom + valH, rightColsW, valH)
  doc.line(rightColsStart + lblW, tableBottom, rightColsStart + lblW, tableBottom + refH)

  // Ref and Tamper content
  doc.setTextColor(...RED)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(`Ref:-   ${consignment.challan_no}`,          L + 3,            tableBottom + 3.8)
  doc.text(`TAMPER PROOF No:-   ${consignment.tmp_prf_no}`, L + leftColsW * 0.48, tableBottom + 3.8)

  // VALUE OF GOODS / GRAND TOTAL
  const fmtIN = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('VALUE  OF GOODS', rightColsStart + 2, tableBottom + valH * 0.72)
  doc.text(fmtIN(totalAmt), rightColsStart + rightColsW - 2, tableBottom + valH * 0.72, { align: 'right' })
  doc.text('GRAND  TOTAL',   rightColsStart + 2, tableBottom + valH + valH * 0.72)
  doc.text(fmtIN(totalAmt), rightColsStart + rightColsW - 2, tableBottom + valH + valH * 0.72, { align: 'right' })

  // ── Amount in words ───────────────────────────────────────────────────────
  const wordsY = tableBottom + refH
  const wordsH = 8
  doc.rect(L, wordsY, useW, wordsH)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BLACK)
  const wordsText = amountToWords(totalAmt)
  doc.text(wordsText, L + useW / 2, wordsY + wordsH / 2 + 2, { align: 'center' })

  // ── NOTE section ──────────────────────────────────────────────────────────
  const noteY = wordsY + wordsH
  const noteH = 26
  const sideW = 12
  doc.rect(L, noteY, useW, noteH)

  doc.setFillColor(...ORANGE)
  doc.rect(L, noteY, sideW, noteH, 'F')
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  // "NOTE" rotated 90° CCW
  doc.text('NOTE', L + sideW / 2 + 2, noteY + noteH - 3, { angle: 90, align: 'center' })

  const noteText = '"BEFORE PACKING, PLEASE ENSURE THAT THE GOLD SENDING REPORT, DELIVERY CHALLAN, AND  E-WAY BILL/SALES INVOICE ALL REFLECT THE SAME VALUE AT THE TIME OF MOVEMENT. THE DELIVERY CHALLAN AND E-INVOICE/SALES INVOICE MUST BE PHYSICALLY HANDED OVER ALONG WITH THE CONSIGNMENT. IN CASE OF ANY DISCREPANCIES, THE RESPECTIVE BRANCH WILL BE HELD SOLELY RESPONSIBLE."'
  doc.setTextColor(...DBLUE)
  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(8)
  const noteLines = doc.splitTextToSize(noteText, useW - sideW - 6)
  doc.text(noteLines, L + sideW + 4, noteY + 6)

  return doc
}
