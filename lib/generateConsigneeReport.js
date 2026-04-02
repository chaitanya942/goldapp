// lib/generateConsigneeReport.js
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function numberToWords(num) {
  if (num === 0) return 'ZERO'
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN',
    'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN',
    'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  const b100  = (n) => n < 20 ? ones[n] : tens[Math.floor(n/10)] + (n%10 ? ' '+ones[n%10] : '')
  const b1000 = (n) => n < 100 ? b100(n) : ones[Math.floor(n/100)] + ' HUNDRED' + (n%100 ? ' '+b100(n%100) : '')
  let r = '', n = num
  if (n >= 10000000) { r += b100(Math.floor(n/10000000))  + ' CRORE ';    n %= 10000000 }
  if (n >= 100000)   { r += b1000(Math.floor(n/100000))   + ' LAKH ';     n %= 100000 }
  if (n >= 1000)     { r += b1000(Math.floor(n/1000))     + ' THOUSAND '; n %= 1000 }
  if (n > 0)         { r += b1000(n) }
  return r.trim()
}

function amountToWords(amount) {
  const rupees = Math.floor(amount)
  const paise  = Math.round((amount - rupees) * 100)
  let result   = 'RUPEES ' + numberToWords(rupees)
  if (paise > 0) result += ' AND ' + numberToWords(paise) + ' PAISE'
  return result + ' ONLY'
}

const fmtIN = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDate(d) {
  if (!d) return ''
  const dt  = new Date(d)
  const day = String(dt.getDate()).padStart(2, '0')
  const mon = dt.toLocaleString('en-US', { month: 'short' })
  const yr  = dt.getFullYear()
  const wd  = dt.toLocaleString('en-US', { weekday: 'short' })
  return `${day}-${mon}-${yr},${wd}`
}

export function generateConsigneeReport({ consignment, items }) {
  // ── Page setup ────────────────────────────────────────────────────────────
  const doc  = new jsPDF('l', 'mm', 'a4')   // landscape A4: 297 × 210 mm
  const pageW = 297
  const L = 8, R = 8
  const useW = pageW - L - R   // 281 mm

  const ORANGE = [196, 73, 0]
  const WHITE  = [255, 255, 255]
  const BLACK  = [0, 0, 0]
  const RED    = [176, 0, 0]
  const BLUE   = [0, 51, 204]
  const DBLUE  = [0, 0, 180]

  // Column widths (sum = 281)
  const CW = [12, 35, 64, 32, 22, 19, 19, 22, 56]
  const CX = CW.reduce((acc, _, i) => {
    acc.push(i === 0 ? L : acc[i-1] + CW[i-1]); return acc
  }, [])

  const rightColsStart = CX[7]
  const rightColsW     = CW[7] + CW[8]
  const leftColsW      = useW - rightColsW

  // ── Aggregates & tax ─────────────────────────────────────────────────────
  const totalGross = items.reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0)
  const totalStone = items.reduce((s, p) => s + parseFloat(p.stone_weight || 0), 0)
  const totalWaste = items.reduce((s, p) => s + parseFloat(p.wastage      || 0), 0)
  const totalNet   = items.reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0)
  const totalAmt   = items.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

  const stateCode    = consignment.state_code || 'KA'
  const isInterstate = stateCode !== 'KA'
  const valueOfGoods = isInterstate ? totalAmt * 1.075 : totalAmt
  const igst         = isInterstate ? valueOfGoods * 0.03 : 0
  const grandTotal   = valueOfGoods + igst

  // ── Title date ────────────────────────────────────────────────────────────
  const challanDate = new Date(consignment.created_at)
  const dateStr = [
    String(challanDate.getDate()).padStart(2, '0'),
    challanDate.toLocaleString('en-US', { month: 'short' }),
    challanDate.getFullYear(),
  ].join('-')

  let y = 8

  // ── 1. TITLE BAR — single orange strip, 3 text zones ─────────────────────
  const TITLE_H = 11
  doc.setFillColor(...ORANGE)
  doc.rect(L, y, useW, TITLE_H, 'F')

  // Outer border only — no internal dividers
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.rect(L, y, useW, TITLE_H)

  // Section widths
  const mainTitleW = 163
  const extMovW    = 55
  const dateSectW  = useW - mainTitleW - extMovW

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')

  // Main title — left aligned
  doc.setFontSize(12)
  doc.text('WHITE GOLD BULLION PVT LTD , GOLD CONSIGNEE REPORT', L + 3, y + 7.5)

  // (EXTERNAL-MOVEMENT) — centred in its section
  doc.setFontSize(8.5)
  doc.text('(EXTERNAL-MOVEMENT)', L + mainTitleW + extMovW / 2, y + 7.5, { align: 'center' })

  // Date — centred in its section
  doc.setFontSize(10)
  doc.text(dateStr, L + mainTitleW + extMovW + dateSectW / 2, y + 7.5, { align: 'center' })

  y += TITLE_H

  // ── 2. DATA TABLE ─────────────────────────────────────────────────────────
  const dataRows = items.map((p, i) => [
    i + 1,
    fmtDate(p.purchase_date),
    p.customer_name || '',
    p.branch_name   || consignment.branch_name || '',
    fmtIN(p.gross_weight),
    fmtIN(p.stone_weight),
    fmtIN(p.wastage),
    fmtIN(p.net_weight),
    fmtIN(p.total_amount),
  ])

  const totalsRow = [
    items.length, '', '', '',
    fmtIN(totalGross), fmtIN(totalStone), fmtIN(totalWaste), fmtIN(totalNet), fmtIN(totalAmt),
  ]

  autoTable(doc, {
    startY: y,
    head:  [['S.N', 'DATE', 'CUST NAME', 'BRANCH NAME', 'GRS WT', 'STONE', 'WSTG', 'NET WT', 'GROSS AMT']],
    body:  [...dataRows, totalsRow],
    theme: 'grid',
    headStyles: {
      fillColor: ORANGE, textColor: WHITE, fontStyle: 'bold',
      halign: 'center', fontSize: 9, cellPadding: 3,
    },
    styles: {
      fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      lineColor: BLACK, lineWidth: 0.25, textColor: BLACK, halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: CW[0] },
      1: { cellWidth: CW[1] },
      2: { cellWidth: CW[2], halign: 'left' },
      3: { cellWidth: CW[3] },
      4: { cellWidth: CW[4] },
      5: { cellWidth: CW[5] },
      6: { cellWidth: CW[6] },
      7: { cellWidth: CW[7] },
      8: { cellWidth: CW[8] },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === dataRows.length) {
        // Totals row
        data.cell.styles.fillColor  = ORANGE
        data.cell.styles.textColor  = WHITE
        data.cell.styles.fontStyle  = 'bold'
        data.cell.styles.fontSize   = 9
        data.cell.styles.halign     = 'center'
      }
    },
    margin: { left: L, right: R },
  })

  const tableBottom = doc.lastAutoTable.finalY

  // ── 3. REF / VALUE SECTION ────────────────────────────────────────────────
  const VAL_H   = 8
  const numRows = isInterstate ? 3 : 2
  const refH    = VAL_H * numRows
  const lblW    = 44

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.25)

  // Left cell
  doc.rect(L, tableBottom, leftColsW, refH)
  // Right sub-rows
  for (let i = 0; i < numRows; i++) {
    doc.rect(rightColsStart, tableBottom + i * VAL_H, rightColsW, VAL_H)
  }
  // Divider inside right cell (label | amount)
  doc.line(rightColsStart + lblW, tableBottom, rightColsStart + lblW, tableBottom + refH)

  // Ref/Tamper text — vertically centred in left cell
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  const refMidY = tableBottom + refH / 2 + 1.5

  // "Ref:-" in RED, challan in BLUE
  const refLabel = 'Ref:-   '
  doc.setTextColor(...RED);  doc.text(refLabel, L + 4, refMidY)
  const refLabelW = doc.getTextWidth(refLabel)
  doc.setTextColor(...BLUE); doc.text(consignment.challan_no, L + 4 + refLabelW, refMidY)

  // "TAMPER PROOF No:-" in RED, WG number in BLUE
  const tpLabel  = 'TAMPER PROOF No:-   '
  const tpStartX = L + leftColsW * 0.46
  doc.setTextColor(...RED);  doc.text(tpLabel, tpStartX, refMidY)
  const tpLabelW = doc.getTextWidth(tpLabel)
  doc.setTextColor(...BLUE); doc.text(consignment.tmp_prf_no, tpStartX + tpLabelW, refMidY)

  // Value rows
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const rY = (i) => tableBottom + i * VAL_H + VAL_H * 0.72

  doc.text('VALUE  OF GOODS',   rightColsStart + 4,              rY(0))
  doc.text(fmtIN(valueOfGoods), rightColsStart + rightColsW - 3, rY(0), { align: 'right' })

  if (isInterstate) {
    doc.text('IGST @ 3%',  rightColsStart + 4,              rY(1))
    doc.text(fmtIN(igst),  rightColsStart + rightColsW - 3, rY(1), { align: 'right' })
  }

  doc.text('GRAND  TOTAL',    rightColsStart + 4,              rY(numRows - 1))
  doc.text(fmtIN(grandTotal), rightColsStart + rightColsW - 3, rY(numRows - 1), { align: 'right' })

  // ── 4. AMOUNT IN WORDS ────────────────────────────────────────────────────
  const wordsY = tableBottom + refH
  const wordsH = 9

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.25)
  doc.rect(L, wordsY, useW, wordsH)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...BLACK)
  doc.text(amountToWords(grandTotal), L + 4, wordsY + 6)

  // ── 5. NOTE SECTION ───────────────────────────────────────────────────────
  const noteY = wordsY + wordsH
  const noteH = 28
  const sideW = 12

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(L, noteY, useW, noteH)

  doc.setFillColor(...ORANGE)
  doc.rect(L, noteY, sideW, noteH, 'F')
  doc.setDrawColor(...BLACK)
  doc.line(L + sideW, noteY, L + sideW, noteY + noteH)

  // "NOTE" rotated
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...WHITE)
  const noteWordW = doc.getTextWidth('NOTE')
  doc.text('NOTE', L + sideW / 2, noteY + noteH / 2 + noteWordW / 2, { angle: 90 })

  // Note body
  const NOTE_TEXT = '"BEFORE PACKING, PLEASE ENSURE THAT THE GOLD SENDING REPORT, DELIVERY CHALLAN, AND E-WAY BILL/SALES INVOICE ALL REFLECT THE SAME VALUE AT THE TIME OF MOVEMENT. THE DELIVERY CHALLAN AND E-INVOICE/SALES INVOICE MUST BE PHYSICALLY HANDED OVER ALONG WITH THE CONSIGNMENT. IN CASE OF ANY DISCREPANCIES, THE RESPECTIVE BRANCH WILL BE HELD SOLELY RESPONSIBLE."'

  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(8)
  doc.setTextColor(...DBLUE)
  const noteLines  = doc.splitTextToSize(NOTE_TEXT, useW - sideW - 8)
  const lineH      = 4.5
  const textBlockH = noteLines.length * lineH
  const noteTextY  = noteY + (noteH - textBlockH) / 2 + lineH
  doc.text(noteLines, L + sideW + 4, noteTextY)

  return doc
}
