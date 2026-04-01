// lib/generateConsigneeReport.js
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { join } from 'path'

// Register Noto Sans fonts once at module load (required on Vercel — no system fonts)
;(() => {
  const d = join(process.cwd(), 'node_modules/@fontsource/noto-sans/files')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-normal.woff2'), 'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-normal.woff2'), 'ReportBold')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-italic.woff2'), 'ReportItalic')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-italic.woff2'), 'ReportBoldItalic')
})()

// ── Number → Words ────────────────────────────────────────────────────────────
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

// ── Main generator ────────────────────────────────────────────────────────────
export async function generateConsigneeReport({ consignment, items }) {
  const S = 6   // 6 px per mm  ≈ 152 DPI — sharper text

  // ── Colours ──────────────────────────────────────────────────────────────
  const ORANGE = '#C44900'
  const RED    = '#B00000'
  const BLUE   = '#0033CC'   // for challan / tamper values
  const DBLUE  = '#0000B4'   // for NOTE body text
  const WHITE  = '#FFFFFF'
  const BLACK  = '#000000'

  // ── Page & column layout ─────────────────────────────────────────────────
  const pW   = Math.round(297 * S)   // 1188 px
  const L    = Math.round(8 * S)     // 32 px  (left & right margin)
  const useW = pW - 2 * L            // 1124 px

  // Column widths: [12,35,64,32,22,19,19,22,56] mm  sum = 281 mm = useW
  const CW_MM = [12, 35, 64, 32, 22, 19, 19, 22, 56]
  const CW    = CW_MM.map(w => Math.round(w * S))
  const CX    = CW.reduce((a, _, i) => { a.push(i ? a[i-1]+CW[i-1] : L); return a }, [])

  // Title bar 3-section widths (mm)
  const mainTitleW = Math.round(163 * S)   // ~58%  main title
  const extMovW    = Math.round(55  * S)   // ~20%  (EXTERNAL-MOVEMENT)
  const dateSectW  = useW - mainTitleW - extMovW  // ~22%  date

  // ── Row heights ───────────────────────────────────────────────────────────
  const TITLE_H = Math.round(10 * S)    // single-row title bar
  const HEAD_H  = Math.round(8  * S)    // column headers
  const ROW_H   = Math.round(7.5* S)    // data rows
  const VAL_H   = Math.round(8  * S)    // ref / value sub-rows
  const WORDS_H = Math.round(9  * S)    // amount-in-words
  const NOTE_H  = Math.round(30 * S)    // note section
  const TOP_PAD = Math.round(5  * S)
  const BOT_PAD = Math.round(5  * S)

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

  // Right section geometry (NET WT + GROSS AMT columns)
  const rightColsStart = CX[7]
  const rightColsW     = CW[7] + CW[8]
  const leftColsW      = useW - rightColsW
  const numValRows     = isInterstate ? 3 : 2
  const refH           = VAL_H * numValRows
  const lblW           = Math.round(46 * S)   // label col width inside val section

  // ── Canvas height ─────────────────────────────────────────────────────────
  const totalH = TOP_PAD + TITLE_H + HEAD_H + (items.length + 1) * ROW_H
               + refH + WORDS_H + NOTE_H + BOT_PAD

  const canvas = createCanvas(pW, totalH)
  const ctx    = canvas.getContext('2d')

  ctx.fillStyle = WHITE
  ctx.fillRect(0, 0, pW, totalH)

  // ── Drawing helpers ───────────────────────────────────────────────────────
  function setFont(size, bold = false, italic = false) {
    if (bold && italic) ctx.font = `${size}px ReportBoldItalic`
    else if (bold)      ctx.font = `${size}px ReportBold`
    else if (italic)    ctx.font = `${size}px ReportItalic`
    else                ctx.font = `${size}px Report`
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
  // DD-MMM-YYYY  e.g. 31-Mar-2026
  const dateStr = [
    String(challanDate.getDate()).padStart(2, '0'),
    challanDate.toLocaleString('en-US', { month: 'short' }),
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

  // ── 1. TITLE BAR — 3 sections ─────────────────────────────────────────────
  // Section positions
  const sec1X = L
  const sec2X = L + mainTitleW
  const sec3X = L + mainTitleW + extMovW

  // Fill all 3 sections orange
  drawRect(sec1X, y, mainTitleW, TITLE_H, ORANGE, null)
  drawRect(sec2X, y, extMovW,   TITLE_H, ORANGE, null)
  drawRect(sec3X, y, dateSectW, TITLE_H, ORANGE, null)

  // Outer border + internal dividers
  ctx.save()
  ctx.strokeStyle = BLACK
  ctx.lineWidth   = 1.5
  ctx.strokeRect(L + 0.75, y + 0.75, useW - 1.5, TITLE_H - 1.5)
  ctx.restore()
  drawLine(sec2X, y, sec2X, y + TITLE_H, BLACK, 1)
  drawLine(sec3X, y, sec3X, y + TITLE_H, BLACK, 1)

  // Section 1: main title — LEFT aligned, large bold
  setFont(15, true)
  drawText('WHITE GOLD BULLION PVT LTD , GOLD CONSIGNEE REPORT',
           sec1X + 8, y + TITLE_H * 0.70, WHITE, 'left')

  // Section 2: (EXTERNAL-MOVEMENT) — centered
  setFont(11, true)
  drawText('(EXTERNAL-MOVEMENT)', sec2X + extMovW / 2, y + TITLE_H * 0.70, WHITE, 'center')

  // Section 3: date — centered
  setFont(12, true)
  drawText(dateStr, sec3X + dateSectW / 2, y + TITLE_H * 0.70, WHITE, 'center')

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

  // ── 3. DATA ROWS — pure white, all values centre aligned ─────────────────
  const ROW_ALIGNS = ['center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center']
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
    drawRect(L, y, useW, ROW_H, WHITE, null)
    row.forEach((val, i) => {
      drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, 1)
      cellText(val, CX[i], y, CW[i], ROW_H, ROW_ALIGNS[i], BLACK)
    })
    y += ROW_H
  })

  // ── 4. TOTALS ROW ─────────────────────────────────────────────────────────
  const totRow     = [String(items.length), '', '', '',
    fmtIN(totalGross), fmtIN(totalStone), fmtIN(totalWaste), fmtIN(totalNet), fmtIN(totalAmt)]
  const TOT_ALIGNS = ['center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center']
  drawRect(L, y, useW, ROW_H, ORANGE, null)
  setFont(11, true)
  totRow.forEach((val, i) => {
    drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, 1)
    cellText(val, CX[i], y, CW[i], ROW_H, TOT_ALIGNS[i], WHITE)
  })
  y += ROW_H

  // ── 5. REF / VALUE SECTION ────────────────────────────────────────────────
  const tblBot = y

  // Left cell (Ref + Tamper Proof) — tall enough for all val rows
  drawRect(L, tblBot, leftColsW, refH, WHITE, BLACK, 1)

  // Right value sub-rows
  for (let i = 0; i < numValRows; i++) {
    drawRect(rightColsStart, tblBot + i*VAL_H, rightColsW, VAL_H, WHITE, BLACK, 1)
  }
  // Vertical divider separating label from amount in val section
  drawLine(rightColsStart + lblW, tblBot, rightColsStart + lblW, tblBot + refH)

  // Ref/Tamper text — label in RED, value in BLUE bold (larger font to fill space)
  setFont(13, true)
  const refMidY = tblBot + refH / 2 + 4

  // "Ref:-" label RED, then challan number BLUE
  const refLabel    = 'Ref:-   '
  const tpLabel     = 'TAMPER PROOF No:-   '
  ctx.textBaseline  = 'alphabetic'

  ctx.fillStyle = RED;  ctx.textAlign = 'left'; ctx.fillText(refLabel, L + 8, refMidY)
  const refLabelW = ctx.measureText(refLabel).width
  ctx.fillStyle = BLUE; ctx.fillText(consignment.challan_no, L + 8 + refLabelW, refMidY)

  const tpStartX = L + leftColsW * 0.46
  ctx.fillStyle = RED;  ctx.fillText(tpLabel, tpStartX, refMidY)
  const tpLabelW = ctx.measureText(tpLabel).width
  ctx.fillStyle = BLUE; ctx.fillText(consignment.tmp_prf_no, tpStartX + tpLabelW, refMidY)

  // Value amounts
  setFont(11, true)
  const rY = (i) => tblBot + i*VAL_H + VAL_H * 0.72

  drawText('VALUE  OF GOODS', rightColsStart + 6,              rY(0), BLACK, 'left')
  drawText(fmtIN(valueOfGoods), rightColsStart + rightColsW - 6, rY(0), BLACK, 'right')

  if (isInterstate) {
    drawText('IGST @ 3%', rightColsStart + 6,              rY(1), BLACK, 'left')
    drawText(fmtIN(igst),  rightColsStart + rightColsW - 6, rY(1), BLACK, 'right')
  }

  drawText('GRAND  TOTAL', rightColsStart + 6,                rY(numValRows-1), BLACK, 'left')
  drawText(fmtIN(grandTotal), rightColsStart + rightColsW - 6, rY(numValRows-1), BLACK, 'right')

  y = tblBot + refH

  // ── 6. AMOUNT IN WORDS ────────────────────────────────────────────────────
  drawRect(L, y, useW, WORDS_H, WHITE, BLACK, 1)
  setFont(11.5, true)
  drawText(amountToWords(grandTotal), L + 10, y + WORDS_H * 0.72, BLACK, 'left')
  y += WORDS_H

  // ── 7. NOTE SECTION ───────────────────────────────────────────────────────
  const sideW = Math.round(12 * S)   // 48 px orange sidebar

  drawRect(L, y, useW, NOTE_H, WHITE, BLACK, 1)
  drawRect(L, y, sideW, NOTE_H, ORANGE, null)
  drawLine(L + sideW, y, L + sideW, y + NOTE_H)

  // "NOTE" rotated 90° CCW, white bold, centred in sidebar
  ctx.save()
  ctx.translate(L + sideW/2, y + NOTE_H/2)
  ctx.rotate(-Math.PI / 2)
  setFont(14, true)
  ctx.fillStyle    = WHITE
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NOTE', 0, 0)
  ctx.restore()

  // Note body — bold italic, dark blue, left-aligned with word-wrap
  const NOTE_TEXT = '"BEFORE PACKING, PLEASE ENSURE THAT THE GOLD SENDING REPORT, DELIVERY CHALLAN, AND E-WAY BILL/SALES INVOICE ALL REFLECT THE SAME VALUE AT THE TIME OF MOVEMENT. THE DELIVERY CHALLAN AND E-INVOICE/SALES INVOICE MUST BE PHYSICALLY HANDED OVER ALONG WITH THE CONSIGNMENT. IN CASE OF ANY DISCREPANCIES, THE RESPECTIVE BRANCH WILL BE HELD SOLELY RESPONSIBLE."'

  setFont(11, true, true)
  ctx.fillStyle    = DBLUE
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'alphabetic'

  const maxNoteW = useW - sideW - 14
  const noteWords = NOTE_TEXT.split(' ')
  const nLines    = []
  let cur         = ''
  for (const w of noteWords) {
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
