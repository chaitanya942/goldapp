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
  if (n >= 10000000) { r += b100(Math.floor(n / 10000000)) + ' CRORE ';   n %= 10000000 }
  if (n >= 100000)   { r += b100(Math.floor(n / 100000))  + ' LAC ';      n %= 100000 }
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

const fmtIN = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Minimal-decimal display (matches source data — e.g. 5 not 5.000, 35.92 not 35.920)
const raw = (x) => String(parseFloat(parseFloat(x || 0).toFixed(3)))

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

  // Column widths must sum to 281
  // S.N | DATE | CUST NAME | BRANCH NAME | GRS WT | STONE | WSTG | NET WT | GROSS AMT
  const CW = [12, 37, 56, 34, 22, 19, 19, 22, 60]
  // Cumulative X positions
  const CX = CW.reduce((acc, _, i) => {
    acc.push(i === 0 ? L : acc[i - 1] + CW[i - 1])
    return acc
  }, [])

  // Right section starts at NET WT column (col 7)
  const rightColsStart = CX[7]           // x of NET WT col
  const rightColsW     = CW[7] + CW[8]  // 82
  const leftColsW      = useW - rightColsW // 199

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

  const totalGross = items.reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0)
  const totalStone = items.reduce((s, p) => s + parseFloat(p.stone_weight || 0), 0)
  const totalWaste = items.reduce((s, p) => s + parseFloat(p.wastage      || 0), 0)
  const totalNet   = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const totalAmt   = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

  // ── Title bar ─────────────────────────────────────────────────────────────
  const titleH = 10
  let y = 8

  doc.setFillColor(...ORANGE)
  doc.rect(L, y, useW, titleH, 'F')
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.rect(L, y, useW, titleH)

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('WHITE GOLD BULLION PVT LTD , GOLD CONSIGNEE REPORT', L + 4, y + 6.8)
  doc.setFontSize(9.5)
  doc.text('(EXTERNAL-MOVEMENT)', L + useW * 0.65, y + 6.8)
  doc.text(dateStr, L + useW - 3, y + 6.8, { align: 'right' })

  y += titleH   // table starts immediately after title — no gap

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
      halign: 'center', fontSize: 9, cellPadding: 3,
    },
    styles: {
      fontSize: 8.5, cellPadding: 3,
      lineColor: BLACK, lineWidth: 0.25,
      textColor: BLACK,
    },
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
      // Totals row — orange background, white bold text
      if (data.section === 'body' && data.row.index === dataRows.length) {
        data.cell.styles.fillColor = ORANGE
        data.cell.styles.textColor = WHITE
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fontSize  = 9
        data.cell.styles.halign    =
          data.column.index === 0 ? 'center'
          : data.column.index < 4 ? 'left'
          : 'right'
      }
    },
    margin: { left: L, right: R },
  })

  const tableBottom = doc.lastAutoTable.finalY

  // ── Ref / Tamper + VALUE OF GOODS / GRAND TOTAL row ──────────────────────
  const refH  = 11           // total height of ref row
  const valH  = refH / 2    // 5.5mm per sub-row (VALUE OF GOODS / GRAND TOTAL)
  const lblW  = 50           // label width inside right section

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.25)

  // Left cell (Ref + Tamper)
  doc.rect(L, tableBottom, leftColsW, refH)

  // Right cell — 2 sub-rows
  doc.rect(rightColsStart, tableBottom,        rightColsW, valH)
  doc.rect(rightColsStart, tableBottom + valH, rightColsW, valH)
  // Vertical divider inside right cell
  doc.line(rightColsStart + lblW, tableBottom, rightColsStart + lblW, tableBottom + refH)

  // Ref and Tamper text — red bold
  doc.setTextColor(...RED)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const refY = tableBottom + refH / 2 + 1.5
  doc.text(`Ref:-   ${consignment.challan_no}`, L + 4, refY)
  doc.text(`TAMPER PROOF No:-   ${consignment.tmp_prf_no}`, L + leftColsW * 0.46, refY)

  // VALUE OF GOODS / GRAND TOTAL
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  const vY1 = tableBottom + valH * 0.75
  const vY2 = tableBottom + valH + valH * 0.75
  doc.text('VALUE  OF GOODS', rightColsStart + 3, vY1)
  doc.text(fmtIN(totalAmt),   rightColsStart + rightColsW - 3, vY1, { align: 'right' })
  doc.text('GRAND  TOTAL',    rightColsStart + 3, vY2)
  doc.text(fmtIN(totalAmt),   rightColsStart + rightColsW - 3, vY2, { align: 'right' })

  // ── Amount in words ───────────────────────────────────────────────────────
  const wordsY = tableBottom + refH
  const wordsH = 9

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.25)
  doc.rect(L, wordsY, useW, wordsH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...BLACK)
  const wordsText = amountToWords(totalAmt)
  doc.text(wordsText, L + useW / 2, wordsY + wordsH / 2 + 1.5, { align: 'center' })

  // ── NOTE section ──────────────────────────────────────────────────────────
  const noteY = wordsY + wordsH
  const noteH = 30
  const sideW = 13

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(L, noteY, useW, noteH)
  doc.line(L + sideW, noteY, L + sideW, noteY + noteH)

  // Orange sidebar
  doc.setFillColor(...ORANGE)
  doc.rect(L, noteY, sideW, noteH, 'F')

  // "NOTE" rotated 90° — centered in sidebar
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('NOTE', L + sideW / 2, noteY + noteH / 2, { angle: 90, align: 'center' })

  // Note text — blue bold italic
  const noteText = '"BEFORE PACKING, PLEASE ENSURE THAT THE GOLD SENDING REPORT, DELIVERY CHALLAN, AND  E-WAY BILL/SALES INVOICE ALL REFLECT THE SAME VALUE AT THE TIME OF MOVEMENT. THE DELIVERY CHALLAN AND E-INVOICE/SALES INVOICE MUST BE PHYSICALLY HANDED OVER ALONG WITH THE CONSIGNMENT. IN CASE OF ANY DISCREPANCIES, THE RESPECTIVE BRANCH WILL BE HELD SOLELY RESPONSIBLE."'
  doc.setTextColor(...DBLUE)
  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(8.5)
  const noteLines = doc.splitTextToSize(noteText, useW - sideW - 8)
  const noteTextStartY = noteY + (noteH - noteLines.length * 4.5) / 2 + 4
  doc.text(noteLines, L + sideW + 5, noteTextStartY)

  return doc
}
