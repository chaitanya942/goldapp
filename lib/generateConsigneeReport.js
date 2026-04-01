// lib/generateConsigneeReport.js
import { createCanvas } from '@napi-rs/canvas'

// ── Number → Words (no short forms) ──────────────────────────────────────────
function numberToWords(num) {
  if (num === 0) return 'ZERO'
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN',
    'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN',
    'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY',
    'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
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

// Indian number format, always 2 decimals
const fmtIN = (n) => Number(n).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// ── Main generator — returns a JPEG Buffer ────────────────────────────────────
export async function generateConsigneeReport({ consignment, items }) {
  const S = 4   // 4 px per mm  ≈ 102 DPI

  // ── Colours ──────────────────────────────────────────────────────────────
  const ORANGE = '#C44900'
  const RED    = '#B00000'
  const DBLUE  = '#0000B4'
  const WHITE  = '#FFFFFF'
  const BLACK  = '#000000'

  // ── Page & column layout ─────────────────────────────────────────────────
  const pW   = Math.round(297 * S)          // 1188 px
  const L    = Math.round(8 * S)            // 32 px  (left & right margin)
  const useW = pW - 2 * L                   // 1124 px

  // Column widths: [12,35,64,32,22,19,19,22,56] mm  → sum = 281 mm = useW
  const CW_MM = [12, 35, 64, 32, 22, 19, 19, 22, 56]
  const CW    = CW_MM.map(w => Math.round(w * S))
  const CX    = CW.reduce((a, _, i) => { a.push(i ? a[i-1]+CW[i-1] : L); return a }, [])

  // ── Row heights ───────────────────────────────────────────────────────────
  const TITLE_H = Math.round(13 * S)    // two-line title bar
  const HEAD_H  = Math.round(8  * S)    // column headers
  const ROW_H   = Math.round(7  * S)    // data rows
  const VAL_H   = Math.round(7  * S)    // ref/value sub-rows
  const WORDS_H = Math.round(8  * S)    // amount-in-words
  const NOTE_H  = Math.round(28 * S)    // note section
  const TOP_PAD = Math.round(6  * S)
  const BOT_PAD = Math.round(6  * S)

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

  // Right section geometry
  const rightColsStart = CX[7]
  const rightColsW     = CW[7] + CW[8]
  const leftColsW      = useW - rightColsW
  const numValRows     = isInterstate ? 3 : 2
  const refH           = VAL_H * numValRows
  const lblW           = Math.round(44 * S)   // label column inside val section

  // ── Canvas size ───────────────────────────────────────────────────────────
  const totalH = TOP_PAD + TITLE_H + HEAD_H + (items.length + 1) * ROW_H
               + refH + WORDS_H + NOTE_H + BOT_PAD

  const canvas = createCanvas(pW, totalH)
  const ctx    = canvas.getContext('2d')

  // White background
  ctx.fillStyle = WHITE
  ctx.fillRect(0, 0, pW, totalH)

  // ── Drawing helpers ───────────────────────────────────────────────────────
  function setFont(size, bold = false, italic = false) {
    ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px sans-serif`
  }

  function drawRect(x, y, w, h, fill, strokeColor, lw = 1) {
    if (fill)        { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
    if (strokeColor) {
      ctx.save(); ctx.strokeStyle = strokeColor; ctx.lineWidth = lw
      ctx.strokeRect(x + lw/2, y + lw/2, w - lw, h - lw)
      ctx.restore()
    }
  }

  function drawLine(x1, y1, x2, y2, color = BLACK, lw = 1) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.restore()
  }

  function drawText(str, x, y, color, align = 'left') {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
    ctx.fillText(String(str), x, y)
  }

  // Draw text inside a table cell with clipping
  function cellText(str, cx, cy, cw, ch, align, color, pad = 6) {
    ctx.save()
    ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip()
    ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'
    const ty = cy + ch * 0.73
    if (align === 'center')      { ctx.textAlign = 'center'; ctx.fillText(String(str), cx + cw/2, ty) }
    else if (align === 'right')  { ctx.textAlign = 'right';  ctx.fillText(String(str), cx + cw - pad, ty) }
    else                         { ctx.textAlign = 'left';   ctx.fillText(String(str), cx + pad, ty) }
    ctx.restore()
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
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

  let y = TOP_PAD

  // ── 1. TITLE BAR (two lines) ──────────────────────────────────────────────
  drawRect(L, y, useW, TITLE_H, ORANGE, BLACK, 1)

  // Line 1 — main title CENTERED
  setFont(15, true)
  drawText('WHITE GOLD BULLION PVT LTD , GOLD CONSIGNEE REPORT',
           L + useW / 2, y + Math.round(TITLE_H * 0.40), WHITE, 'center')

  // Line 2 — sub-label + date
  setFont(11, true)
  drawText('(EXTERNAL-MOVEMENT)', L + Math.round(useW * 0.58), y + Math.round(TITLE_H * 0.82), WHITE, 'left')
  drawText(dateStr, L + useW - 8,                               y + Math.round(TITLE_H * 0.82), WHITE, 'right')

  y += TITLE_H

  // ── 2. TABLE HEADER ───────────────────────────────────────────────────────
  const HEADERS = ['S.N', 'DATE', 'CUST NAME', 'BRANCH NAME', 'GRS WT', 'STONE', 'WSTG', 'NET WT', 'GROSS AMT']
  drawRect(L, y, useW, HEAD_H, ORANGE, null)
  setFont(11, true)
  HEADERS.forEach((h, i) => {
    drawRect(CX[i], y, CW[i], HEAD_H, null, BLACK, 1)
    cellText(h, CX[i], y, CW[i], HEAD_H, 'center', WHITE)
  })
  y += HEAD_H

  // ── 3. DATA ROWS ──────────────────────────────────────────────────────────
  const ROW_ALIGNS = ['center', 'center', 'left', 'left', 'right', 'right', 'right', 'right', 'right']
  setFont(10.5, false)
  items.forEach((p, idx) => {
    const row = [
      String(idx + 1),
      fmtDate(p.purchase_date),
      p.customer_name  || '',
      p.branch_name    || consignment.branch_name || '',
      fmtIN(p.gross_weight),
      fmtIN(p.stone_weight),
      fmtIN(p.wastage),
      fmtIN(p.net_weight),
      fmtIN(p.total_amount),
    ]
    // Alternating row background for readability
    const rowBg = idx % 2 === 0 ? WHITE : '#FFF7F3'
    drawRect(L, y, useW, ROW_H, rowBg, null)
    row.forEach((val, i) => {
      drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, 1)
      cellText(val, CX[i], y, CW[i], ROW_H, ROW_ALIGNS[i], BLACK)
    })
    y += ROW_H
  })

  // ── 4. TOTALS ROW ─────────────────────────────────────────────────────────
  const totRow   = [String(items.length), '', '', '',
    fmtIN(totalGross), fmtIN(totalStone), fmtIN(totalWaste), fmtIN(totalNet), fmtIN(totalAmt)]
  const TOT_ALIGNS = ['center', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right']
  drawRect(L, y, useW, ROW_H, ORANGE, null)
  setFont(10.5, true)
  totRow.forEach((val, i) => {
    drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, 1)
    cellText(val, CX[i], y, CW[i], ROW_H, TOT_ALIGNS[i], WHITE)
  })
  y += ROW_H

  // ── 5. REF / VALUE SECTION ────────────────────────────────────────────────
  const tblBot = y

  // Left cell (Ref + Tamper Proof)
  drawRect(L, tblBot, leftColsW, refH, WHITE, BLACK, 1)

  // Right value sub-rows
  for (let i = 0; i < numValRows; i++) {
    drawRect(rightColsStart, tblBot + i*VAL_H, rightColsW, VAL_H, WHITE, BLACK, 1)
  }
  // Vertical divider inside right cell
  drawLine(rightColsStart + lblW, tblBot, rightColsStart + lblW, tblBot + refH)

  // Ref and Tamper Proof text (bold red)
  setFont(11, true)
  const refMidY = tblBot + refH / 2 + 4
  drawText(`Ref:-   ${consignment.challan_no}`,             L + 8,                refMidY, RED,  'left')
  drawText(`TAMPER PROOF No:-   ${consignment.tmp_prf_no}`, L + leftColsW * 0.46, refMidY, RED,  'left')

  // Value amounts
  setFont(11, true)
  const rY = (i) => tblBot + i*VAL_H + VAL_H * 0.72

  drawText('VALUE  OF GOODS', rightColsStart + 6,              rY(0), BLACK, 'left')
  drawText(fmtIN(valueOfGoods), rightColsStart + rightColsW - 6, rY(0), BLACK, 'right')

  if (isInterstate) {
    drawText('IGST @ 3%', rightColsStart + 6,            rY(1), BLACK, 'left')
    drawText(fmtIN(igst),  rightColsStart + rightColsW - 6, rY(1), BLACK, 'right')
  }

  drawText('GRAND  TOTAL', rightColsStart + 6,                rY(numValRows-1), BLACK, 'left')
  drawText(fmtIN(grandTotal), rightColsStart + rightColsW - 6, rY(numValRows-1), BLACK, 'right')

  y = tblBot + refH

  // ── 6. AMOUNT IN WORDS ────────────────────────────────────────────────────
  drawRect(L, y, useW, WORDS_H, WHITE, BLACK, 1)
  setFont(11.5, true)
  // LEFT aligned as requested
  drawText(amountToWords(grandTotal), L + 10, y + WORDS_H * 0.72, BLACK, 'left')
  y += WORDS_H

  // ── 7. NOTE SECTION ───────────────────────────────────────────────────────
  const sideW = Math.round(12 * S)   // 48 px orange sidebar

  drawRect(L, y, useW, NOTE_H, WHITE, BLACK, 1)
  drawRect(L, y, sideW, NOTE_H, ORANGE, null)
  drawLine(L + sideW, y, L + sideW, y + NOTE_H)

  // "NOTE" rotated 90° CCW (text goes upward from baseline → use textBaseline:'middle')
  ctx.save()
  ctx.translate(L + sideW/2, y + NOTE_H/2)
  ctx.rotate(-Math.PI / 2)
  setFont(14, true)
  ctx.fillStyle    = WHITE
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NOTE', 0, 0)
  ctx.restore()

  // Note body text — bold italic, dark blue
  const NOTE_TEXT = '"BEFORE PACKING, PLEASE ENSURE THAT THE GOLD SENDING REPORT, DELIVERY CHALLAN, AND E-WAY BILL/SALES INVOICE ALL REFLECT THE SAME VALUE AT THE TIME OF MOVEMENT. THE DELIVERY CHALLAN AND E-INVOICE/SALES INVOICE MUST BE PHYSICALLY HANDED OVER ALONG WITH THE CONSIGNMENT. IN CASE OF ANY DISCREPANCIES, THE RESPECTIVE BRANCH WILL BE HELD SOLELY RESPONSIBLE."'

  setFont(11, true, true)
  ctx.fillStyle    = DBLUE
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'alphabetic'

  // Word-wrap note text to fit within the content area
  const maxNoteW = useW - sideW - 16
  const words    = NOTE_TEXT.split(' ')
  const nLines   = []
  let cur        = ''
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w
    if (ctx.measureText(test).width > maxNoteW && cur) { nLines.push(cur); cur = w }
    else cur = test
  }
  if (cur) nLines.push(cur)

  const lineH  = 18
  const blockH = nLines.length * lineH
  const nyY    = y + (NOTE_H - blockH) / 2 + lineH * 0.8
  nLines.forEach((ln, i) => ctx.fillText(ln, L + sideW + 8, nyY + i * lineH))

  // ── Encode to JPEG ────────────────────────────────────────────────────────
  return await canvas.encode('jpeg', 95)
}
