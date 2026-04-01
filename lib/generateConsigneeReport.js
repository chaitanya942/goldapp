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

const fmtIN = (n) => Number(n).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// ── Main generator ────────────────────────────────────────────────────────────
export async function generateConsigneeReport({ consignment, items }) {
  const S = 5   // 5 px per mm  ≈ 127 DPI

  // ── Colours ──────────────────────────────────────────────────────────────
  const ORANGE = '#C44900'
  const RED    = '#B00000'
  const BLUE   = '#0033CC'
  const DBLUE  = '#0000B4'
  const WHITE  = '#FFFFFF'
  const BLACK  = '#000000'

  // ── Page & column layout ─────────────────────────────────────────────────
  const pW   = Math.round(297 * S)   // 1485 px
  const L    = Math.round(8   * S)   // 40 px
  const useW = pW - 2 * L            // 1405 px

  // Column widths [12,35,64,32,22,19,19,22,56] mm → sum = 281 mm
  const CW_MM = [12, 35, 64, 32, 22, 19, 19, 22, 56]
  const CW    = CW_MM.map(w => Math.round(w * S))
  const CX    = CW.reduce((a, _, i) => { a.push(i ? a[i-1]+CW[i-1] : L); return a }, [])

  // Title bar 3-section widths
  const mainTitleW = Math.round(163 * S)
  const extMovW    = Math.round(55  * S)
  const dateSectW  = useW - mainTitleW - extMovW

  // ── Font sizes (px) — scaled for 127 DPI so text looks large & sharp ──────
  const FS_TITLE  = 28   // main title
  const FS_EXT    = 17   // (EXTERNAL-MOVEMENT)
  const FS_DATE   = 20   // date in title bar
  const FS_HEAD   = 21   // column header row
  const FS_BODY   = 19   // data rows
  const FS_TOT    = 20   // totals row
  const FS_REF    = 22   // ref / tamper proof
  const FS_VAL    = 19   // VALUE OF GOODS etc.
  const FS_WORDS  = 21   // amount in words
  const FS_NOTE   = 17   // note body text
  const FS_NOTE_L = 22   // "NOTE" sidebar label

  // ── Row heights (mm → px) ─────────────────────────────────────────────────
  const TITLE_H = Math.round(15 * S)   // 75 px
  const HEAD_H  = Math.round(12 * S)   // 60 px
  const ROW_H   = Math.round(12 * S)   // 60 px
  const VAL_H   = Math.round(12 * S)   // 60 px
  const WORDS_H = Math.round(13 * S)   // 65 px
  const NOTE_H  = Math.round(42 * S)   // 210 px
  const TOP_PAD = Math.round(4  * S)
  const BOT_PAD = Math.round(4  * S)
  const LW      = Math.round(0.4 * S)  // line width ≈ 2px

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

  const rightColsStart = CX[7]
  const rightColsW     = CW[7] + CW[8]
  const leftColsW      = useW - rightColsW
  const numValRows     = isInterstate ? 3 : 2
  const refH           = VAL_H * numValRows
  const lblW           = Math.round(46 * S)

  // ── Canvas ────────────────────────────────────────────────────────────────
  const totalH = TOP_PAD + TITLE_H + HEAD_H + (items.length + 1) * ROW_H
               + refH + WORDS_H + NOTE_H + BOT_PAD

  const canvas = createCanvas(pW, totalH)
  const ctx    = canvas.getContext('2d')
  ctx.fillStyle = WHITE
  ctx.fillRect(0, 0, pW, totalH)

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setFont(size, bold = false, italic = false) {
    if (bold && italic) ctx.font = `${size}px ReportBoldItalic`
    else if (bold)      ctx.font = `${size}px ReportBold`
    else if (italic)    ctx.font = `${size}px ReportItalic`
    else                ctx.font = `${size}px Report`
  }

  function drawRect(x, y, w, h, fill, strokeColor, lw = LW) {
    if (fill)        { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
    if (strokeColor) {
      ctx.save(); ctx.strokeStyle = strokeColor; ctx.lineWidth = lw
      ctx.strokeRect(x + lw/2, y + lw/2, w - lw, h - lw)
      ctx.restore()
    }
  }

  function drawLine(x1, y1, x2, y2, color = BLACK, lw = LW) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.restore()
  }

  // Vertically centred text in a cell (uses 'middle' baseline for accuracy)
  function cellText(str, cx, cy, cw, ch, align, color, pad = 10) {
    ctx.save()
    ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip()
    ctx.fillStyle    = color
    ctx.textBaseline = 'middle'
    const ty = cy + ch / 2
    if (align === 'center')      { ctx.textAlign = 'center'; ctx.fillText(String(str), cx + cw/2, ty) }
    else if (align === 'right')  { ctx.textAlign = 'right';  ctx.fillText(String(str), cx + cw - pad, ty) }
    else                         { ctx.textAlign = 'left';   ctx.fillText(String(str), cx + pad, ty) }
    ctx.restore()
  }

  // Plain text draw with middle baseline
  function drawText(str, x, y, color, align = 'left') {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'
    ctx.fillText(String(str), x, y)
  }

  // ── Dates ─────────────────────────────────────────────────────────────────
  const challanDate = new Date(consignment.created_at)
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
  const sec1X = L
  const sec2X = L + mainTitleW
  const sec3X = L + mainTitleW + extMovW

  drawRect(sec1X, y, mainTitleW, TITLE_H, ORANGE, null)
  drawRect(sec2X, y, extMovW,   TITLE_H, ORANGE, null)
  drawRect(sec3X, y, dateSectW, TITLE_H, ORANGE, null)

  ctx.save()
  ctx.strokeStyle = BLACK; ctx.lineWidth = LW * 1.5
  ctx.strokeRect(L + LW*0.75, y + LW*0.75, useW - LW*1.5, TITLE_H - LW*1.5)
  ctx.restore()
  drawLine(sec2X, y, sec2X, y + TITLE_H, BLACK, LW)
  drawLine(sec3X, y, sec3X, y + TITLE_H, BLACK, LW)

  const titleMidY = y + TITLE_H / 2

  setFont(FS_TITLE, true)
  drawText('WHITE GOLD BULLION PVT LTD , GOLD CONSIGNEE REPORT',
           sec1X + 12, titleMidY, WHITE, 'left')

  setFont(FS_EXT, true)
  drawText('(EXTERNAL-MOVEMENT)', sec2X + extMovW / 2, titleMidY, WHITE, 'center')

  setFont(FS_DATE, true)
  drawText(dateStr, sec3X + dateSectW / 2, titleMidY, WHITE, 'center')

  y += TITLE_H

  // ── 2. TABLE HEADER ───────────────────────────────────────────────────────
  const HEADERS = ['S.N', 'DATE', 'CUST NAME', 'BRANCH NAME', 'GRS WT', 'STONE', 'WSTG', 'NET WT', 'GROSS AMT']
  drawRect(L, y, useW, HEAD_H, ORANGE, null)
  setFont(FS_HEAD, true)
  HEADERS.forEach((h, i) => {
    drawRect(CX[i], y, CW[i], HEAD_H, null, BLACK, LW)
    cellText(h, CX[i], y, CW[i], HEAD_H, 'center', WHITE)
  })
  y += HEAD_H

  // ── 3. DATA ROWS ──────────────────────────────────────────────────────────
  setFont(FS_BODY, false)
  items.forEach((p, idx) => {
    const row = [
      String(idx + 1),
      fmtDate(p.purchase_date),
      p.customer_name || '',
      p.branch_name   || consignment.branch_name || '',
      fmtIN(p.gross_weight),
      fmtIN(p.stone_weight),
      fmtIN(p.wastage),
      fmtIN(p.net_weight),
      fmtIN(p.total_amount),
    ]
    drawRect(L, y, useW, ROW_H, WHITE, null)
    row.forEach((val, i) => {
      drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, LW)
      cellText(val, CX[i], y, CW[i], ROW_H, 'center', BLACK)
    })
    y += ROW_H
  })

  // ── 4. TOTALS ROW ─────────────────────────────────────────────────────────
  const totRow = [String(items.length), '', '', '',
    fmtIN(totalGross), fmtIN(totalStone), fmtIN(totalWaste), fmtIN(totalNet), fmtIN(totalAmt)]
  drawRect(L, y, useW, ROW_H, ORANGE, null)
  setFont(FS_TOT, true)
  totRow.forEach((val, i) => {
    drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, LW)
    cellText(val, CX[i], y, CW[i], ROW_H, 'center', WHITE)
  })
  y += ROW_H

  // ── 5. REF / VALUE SECTION ────────────────────────────────────────────────
  const tblBot = y
  drawRect(L, tblBot, leftColsW, refH, WHITE, BLACK, LW)
  for (let i = 0; i < numValRows; i++) {
    drawRect(rightColsStart, tblBot + i*VAL_H, rightColsW, VAL_H, WHITE, BLACK, LW)
  }
  drawLine(rightColsStart + lblW, tblBot, rightColsStart + lblW, tblBot + refH, BLACK, LW)

  // Ref/Tamper — label RED, value BLUE bold, vertically centred in left cell
  setFont(FS_REF, true)
  const refMidY    = tblBot + refH / 2
  const refLabel   = 'Ref:-   '
  const tpLabel    = 'TAMPER PROOF No:-   '
  ctx.textBaseline = 'middle'

  ctx.fillStyle = RED;  ctx.textAlign = 'left'
  ctx.fillText(refLabel, L + 14, refMidY)
  const refLabelW = ctx.measureText(refLabel).width
  ctx.fillStyle = BLUE
  ctx.fillText(consignment.challan_no, L + 14 + refLabelW, refMidY)

  const tpStartX = L + leftColsW * 0.46
  ctx.fillStyle = RED;  ctx.fillText(tpLabel, tpStartX, refMidY)
  const tpLabelW = ctx.measureText(tpLabel).width
  ctx.fillStyle = BLUE; ctx.fillText(consignment.tmp_prf_no, tpStartX + tpLabelW, refMidY)

  // Value section labels + amounts
  setFont(FS_VAL, true)
  const rMidY = (i) => tblBot + i*VAL_H + VAL_H / 2

  ctx.textBaseline = 'middle'
  drawText('VALUE  OF GOODS',   rightColsStart + 10,              rMidY(0), BLACK, 'left')
  drawText(fmtIN(valueOfGoods), rightColsStart + rightColsW - 10, rMidY(0), BLACK, 'right')

  if (isInterstate) {
    drawText('IGST @ 3%',  rightColsStart + 10,              rMidY(1), BLACK, 'left')
    drawText(fmtIN(igst),  rightColsStart + rightColsW - 10, rMidY(1), BLACK, 'right')
  }

  drawText('GRAND  TOTAL',    rightColsStart + 10,              rMidY(numValRows-1), BLACK, 'left')
  drawText(fmtIN(grandTotal), rightColsStart + rightColsW - 10, rMidY(numValRows-1), BLACK, 'right')

  y = tblBot + refH

  // ── 6. AMOUNT IN WORDS ────────────────────────────────────────────────────
  drawRect(L, y, useW, WORDS_H, WHITE, BLACK, LW)
  setFont(FS_WORDS, true)
  drawText(amountToWords(grandTotal), L + 14, y + WORDS_H / 2, BLACK, 'left')
  y += WORDS_H

  // ── 7. NOTE SECTION ───────────────────────────────────────────────────────
  const sideW = Math.round(14 * S)   // 70 px orange sidebar

  drawRect(L, y, useW, NOTE_H, WHITE, BLACK, LW)
  drawRect(L, y, sideW, NOTE_H, ORANGE, null)
  drawLine(L + sideW, y, L + sideW, y + NOTE_H, BLACK, LW)

  // "NOTE" rotated 90° CCW, white bold, centred in sidebar
  ctx.save()
  ctx.translate(L + sideW / 2, y + NOTE_H / 2)
  ctx.rotate(-Math.PI / 2)
  setFont(FS_NOTE_L, true)
  ctx.fillStyle    = WHITE
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NOTE', 0, 0)
  ctx.restore()

  // Note body — bold italic, dark blue, left-aligned with word-wrap
  const NOTE_TEXT = '"BEFORE PACKING, PLEASE ENSURE THAT THE GOLD SENDING REPORT, DELIVERY CHALLAN, AND E-WAY BILL/SALES INVOICE ALL REFLECT THE SAME VALUE AT THE TIME OF MOVEMENT. THE DELIVERY CHALLAN AND E-INVOICE/SALES INVOICE MUST BE PHYSICALLY HANDED OVER ALONG WITH THE CONSIGNMENT. IN CASE OF ANY DISCREPANCIES, THE RESPECTIVE BRANCH WILL BE HELD SOLELY RESPONSIBLE."'

  setFont(FS_NOTE, true, true)
  ctx.fillStyle    = DBLUE
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'alphabetic'

  const maxNoteW = useW - sideW - 20
  const nWords   = NOTE_TEXT.split(' ')
  const nLines   = []
  let cur        = ''
  for (const w of nWords) {
    const test = cur ? cur + ' ' + w : w
    if (ctx.measureText(test).width > maxNoteW && cur) { nLines.push(cur); cur = w }
    else cur = test
  }
  if (cur) nLines.push(cur)

  const lineH  = FS_NOTE * 1.55
  const blockH = nLines.length * lineH
  const nyY    = y + (NOTE_H - blockH) / 2 + FS_NOTE * 0.85
  nLines.forEach((ln, i) => ctx.fillText(ln, L + sideW + 14, nyY + i * lineH))

  return await canvas.encode('jpeg', 95)
}
