// lib/generateConsigneeReport.js
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { join } from 'path'

;(() => {
  const d = join(process.cwd(), 'node_modules/@fontsource/noto-sans/files')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-normal.woff2'), 'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-normal.woff2'), 'ReportBold')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-italic.woff2'), 'ReportItalic')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-italic.woff2'), 'ReportBoldItalic')
})()

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

export async function generateConsigneeReport({ consignment, items }) {
  const S = 4   // 4 px/mm → 1188 px wide

  const ORANGE = '#C44900'
  const RED    = '#B00000'
  const BLUE   = '#0033CC'
  const DBLUE  = '#0000B4'
  const WHITE  = '#FFFFFF'
  const BLACK  = '#000000'

  const pW   = Math.round(297 * S)
  const L    = Math.round(8   * S)
  const useW = pW - 2 * L

  const CW_MM = [12, 35, 64, 32, 22, 19, 19, 22, 56]
  const CW    = CW_MM.map(w => Math.round(w * S))
  const CX    = CW.reduce((a, _, i) => { a.push(i ? a[i-1]+CW[i-1] : L); return a }, [])

  const mainTitleW = Math.round(163 * S)
  const extMovW    = Math.round(55  * S)
  const dateSectW  = useW - mainTitleW - extMovW

  // ── Font sizes ────────────────────────────────────────────────────────────
  const FS_TITLE  = 24
  const FS_EXT    = 15
  const FS_DATE   = 17
  const FS_HEAD   = 18
  const FS_BODY   = 17
  const FS_TOT    = 17
  const FS_REF    = 18
  const FS_VAL    = 16
  const FS_WORDS  = 17
  const FS_NOTE   = 14
  const FS_NOTE_L = 26

  // ── Row / section heights ─────────────────────────────────────────────────
  const TITLE_H = Math.round(13 * S)
  const HEAD_H  = Math.round(11 * S)
  const ROW_H   = Math.round(11 * S)
  const VAL_H   = Math.round(11 * S)
  const WORDS_H = Math.round(12 * S)
  const NOTE_H  = Math.round(30 * S)
  const TOP_PAD = Math.round(3  * S)
  const BOT_PAD = Math.round(3  * S)
  const LW      = Math.round(0.5 * S)

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
  const lblW           = Math.round(44 * S)

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

  function drawRect(x, y, w, h, fill, stroke, lw = LW) {
    if (fill)   { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
    if (stroke) { ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(x+lw/2, y+lw/2, w-lw, h-lw); ctx.restore() }
  }

  function drawLine(x1, y1, x2, y2, color = BLACK, lw = LW) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.restore()
  }

  // Auto-shrinking cell text: shrinks font until text fits the cell width
  function cellText(str, cx, cy, cw, ch, align, color, fontSize, bold = false, italic = false, pad = 8) {
    ctx.save()
    ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip()

    const maxW = cw - 2 * pad
    let sz = fontSize
    setFont(sz, bold, italic)
    while (sz > 9 && ctx.measureText(String(str)).width > maxW) {
      sz -= 0.5
      setFont(sz, bold, italic)
    }

    ctx.fillStyle    = color
    ctx.textBaseline = 'middle'
    const ty = cy + ch / 2
    if (align === 'center')      { ctx.textAlign = 'center'; ctx.fillText(String(str), cx + cw/2, ty) }
    else if (align === 'right')  { ctx.textAlign = 'right';  ctx.fillText(String(str), cx + cw - pad, ty) }
    else                         { ctx.textAlign = 'left';   ctx.fillText(String(str), cx + pad, ty) }
    ctx.restore()
  }

  function midText(str, x, midY, color, align = 'left') {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'
    ctx.fillText(String(str), x, midY)
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

  // ── 1. TITLE BAR ─────────────────────────────────────────────────────────
  const sec1X = L, sec2X = L + mainTitleW, sec3X = L + mainTitleW + extMovW

  drawRect(sec1X, y, mainTitleW, TITLE_H, ORANGE, null)
  drawRect(sec2X, y, extMovW,   TITLE_H, ORANGE, null)
  drawRect(sec3X, y, dateSectW, TITLE_H, ORANGE, null)

  ctx.save(); ctx.strokeStyle = BLACK; ctx.lineWidth = LW * 1.5
  ctx.strokeRect(L + LW*.75, y + LW*.75, useW - LW*1.5, TITLE_H - LW*1.5); ctx.restore()
  drawLine(sec2X, y, sec2X, y + TITLE_H)
  drawLine(sec3X, y, sec3X, y + TITLE_H)

  const titleMidY = y + TITLE_H / 2

  // Section 1: title — auto-fit to section width
  setFont(FS_TITLE, true)
  let titleSz = FS_TITLE
  const titleStr = 'WHITE GOLD BULLION PVT LTD , GOLD CONSIGNEE REPORT'
  while (titleSz > 12 && ctx.measureText(titleStr).width > mainTitleW - 24) {
    titleSz -= 0.5; setFont(titleSz, true)
  }
  midText(titleStr, sec1X + 12, titleMidY, WHITE, 'left')

  setFont(FS_EXT, true)
  midText('(EXTERNAL-MOVEMENT)', sec2X + extMovW / 2, titleMidY, WHITE, 'center')

  setFont(FS_DATE, true)
  midText(dateStr, sec3X + dateSectW / 2, titleMidY, WHITE, 'center')

  y += TITLE_H

  // ── 2. TABLE HEADER ───────────────────────────────────────────────────────
  const HEADERS = ['S.N', 'DATE', 'CUST NAME', 'BRANCH NAME', 'GRS WT', 'STONE', 'WSTG', 'NET WT', 'GROSS AMT']
  drawRect(L, y, useW, HEAD_H, ORANGE, null)
  HEADERS.forEach((h, i) => {
    drawRect(CX[i], y, CW[i], HEAD_H, null, BLACK, LW)
    cellText(h, CX[i], y, CW[i], HEAD_H, 'center', WHITE, FS_HEAD, true)
  })
  y += HEAD_H

  // ── 3. DATA ROWS ──────────────────────────────────────────────────────────
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
      cellText(val, CX[i], y, CW[i], ROW_H, 'center', BLACK, FS_BODY)
    })
    y += ROW_H
  })

  // ── 4. TOTALS ROW ─────────────────────────────────────────────────────────
  const totRow = [String(items.length), '', '', '',
    fmtIN(totalGross), fmtIN(totalStone), fmtIN(totalWaste), fmtIN(totalNet), fmtIN(totalAmt)]
  drawRect(L, y, useW, ROW_H, ORANGE, null)
  totRow.forEach((val, i) => {
    drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, LW)
    cellText(val, CX[i], y, CW[i], ROW_H, 'center', WHITE, FS_TOT, true)
  })
  y += ROW_H

  // ── 5. REF / VALUE SECTION ────────────────────────────────────────────────
  const tblBot = y
  drawRect(L, tblBot, leftColsW, refH, WHITE, BLACK, LW)
  for (let i = 0; i < numValRows; i++)
    drawRect(rightColsStart, tblBot + i*VAL_H, rightColsW, VAL_H, WHITE, BLACK, LW)
  drawLine(rightColsStart + lblW, tblBot, rightColsStart + lblW, tblBot + refH)

  setFont(FS_REF, true)
  const refMidY  = tblBot + refH / 2
  const refLabel = 'Ref:-   '
  const tpLabel  = 'TAMPER PROOF No:-   '
  ctx.textBaseline = 'middle'

  ctx.fillStyle = RED;  ctx.textAlign = 'left'; ctx.fillText(refLabel, L + 12, refMidY)
  ctx.fillStyle = BLUE; ctx.fillText(consignment.challan_no, L + 12 + ctx.measureText(refLabel).width, refMidY)

  const tpX = L + leftColsW * 0.46
  ctx.fillStyle = RED;  ctx.fillText(tpLabel, tpX, refMidY)
  ctx.fillStyle = BLUE; ctx.fillText(consignment.tmp_prf_no, tpX + ctx.measureText(tpLabel).width, refMidY)

  // Value section
  setFont(FS_VAL, true)
  ctx.textBaseline = 'middle'
  const rMidY = (i) => tblBot + i*VAL_H + VAL_H / 2
  const valPad = 14

  midText('VALUE  OF GOODS',   rightColsStart + valPad,              rMidY(0), BLACK, 'left')
  midText(fmtIN(valueOfGoods), rightColsStart + rightColsW - valPad, rMidY(0), BLACK, 'right')

  if (isInterstate) {
    midText('IGST @ 3%',  rightColsStart + valPad,              rMidY(1), BLACK, 'left')
    midText(fmtIN(igst),  rightColsStart + rightColsW - valPad, rMidY(1), BLACK, 'right')
  }

  midText('GRAND  TOTAL',    rightColsStart + valPad,              rMidY(numValRows-1), BLACK, 'left')
  midText(fmtIN(grandTotal), rightColsStart + rightColsW - valPad, rMidY(numValRows-1), BLACK, 'right')

  y = tblBot + refH

  // ── 6. AMOUNT IN WORDS ────────────────────────────────────────────────────
  drawRect(L, y, useW, WORDS_H, WHITE, BLACK, LW)
  setFont(FS_WORDS, true)
  // Auto-shrink if words are too long
  const wordsStr = amountToWords(grandTotal)
  let wSz = FS_WORDS
  setFont(wSz, true)
  while (wSz > 11 && ctx.measureText(wordsStr).width > useW - 28) {
    wSz -= 0.5; setFont(wSz, true)
  }
  midText(wordsStr, L + 14, y + WORDS_H / 2, BLACK, 'left')
  y += WORDS_H

  // ── 7. NOTE SECTION ───────────────────────────────────────────────────────
  const sideW = Math.round(13 * S)

  drawRect(L, y, useW, NOTE_H, WHITE, BLACK, LW)
  drawRect(L, y, sideW, NOTE_H, ORANGE, null)
  drawLine(L + sideW, y, L + sideW, y + NOTE_H)

  // "NOTE" rotated, larger font, centred in sidebar
  ctx.save()
  ctx.translate(L + sideW / 2, y + NOTE_H / 2)
  ctx.rotate(-Math.PI / 2)
  setFont(FS_NOTE_L, true)
  ctx.fillStyle    = WHITE
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NOTE', 0, 0)
  ctx.restore()

  // Note body text — auto word-wrap
  const NOTE_TEXT = '"BEFORE PACKING, PLEASE ENSURE THAT THE GOLD SENDING REPORT, DELIVERY CHALLAN, AND E-WAY BILL/SALES INVOICE ALL REFLECT THE SAME VALUE AT THE TIME OF MOVEMENT. THE DELIVERY CHALLAN AND E-INVOICE/SALES INVOICE MUST BE PHYSICALLY HANDED OVER ALONG WITH THE CONSIGNMENT. IN CASE OF ANY DISCREPANCIES, THE RESPECTIVE BRANCH WILL BE HELD SOLELY RESPONSIBLE."'

  setFont(FS_NOTE, true, true)
  ctx.fillStyle    = DBLUE
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'alphabetic'

  const maxNoteW = useW - sideW - 20
  const nLines   = []
  let cur        = ''
  for (const w of NOTE_TEXT.split(' ')) {
    const test = cur ? cur + ' ' + w : w
    if (ctx.measureText(test).width > maxNoteW && cur) { nLines.push(cur); cur = w }
    else cur = test
  }
  if (cur) nLines.push(cur)

  const lineH  = FS_NOTE * 1.5
  const blockH = nLines.length * lineH
  const nyY    = y + (NOTE_H - blockH) / 2 + FS_NOTE * 0.85
  nLines.forEach((ln, i) => ctx.fillText(ln, L + sideW + 12, nyY + i * lineH))

  return await canvas.encode('jpeg', 95)
}
