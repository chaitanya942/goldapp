// lib/generateConsigneeReport.js
//
// Branch-facing Consignee Report.
//
// IMPORTANT — value/weight redaction:
//   This document is sent to branch employees so they can verify the bill list
//   physically before packing. Per-bill weights and per-bill values used to be
//   on the report — management decided that exposes too much commercial data
//   to operations staff. The branch only needs to confirm "did I receive bills
//   from these customers, with these application IDs". So the report now shows:
//
//     · Customer name
//     · Application ID
//     · Branch the bill belongs to
//     · Date
//     · Total number of bills
//     · ONE consolidated gross weight at the bottom (verification only)
//
//   Per-bill weights, per-bill amounts, value of goods, IGST, grand total,
//   and the "Rupees in words" line are NOT rendered. Accounts and management
//   still see the full numbers in-app and on the EWB/E-Invoice payloads.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { join } from 'path'

;(() => {
  const d = join(process.cwd(), 'node_modules/@fontsource/noto-sans/files')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-normal.woff2'), 'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-normal.woff2'), 'ReportBold')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-italic.woff2'), 'ReportItalic')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-italic.woff2'), 'ReportBoldItalic')
})()

import { fmtIN } from './pdfHelpers'

export async function generateConsigneeReport({ consignment, items, companySettings = {}, transferHistory = {} }) {
  const S = 4   // 4 px/mm → 1188 px wide

  const ORANGE = '#C44900'
  const RED    = '#B00000'
  const BLUE   = '#0033CC'
  const DBLUE  = '#0000B4'
  const WHITE  = '#FFFFFF'
  const BLACK  = '#000000'
  const SOFT   = '#F5F2EE'

  const pW   = Math.round(297 * S)
  const L    = Math.round(8   * S)
  const useW = pW - 2 * L

  // 5 columns: S.N · DATE · CUSTOMER NAME · APPLICATION ID · BRANCH NAME
  // Widths in mm — sum must equal useW (281mm). Wide name + app-id columns
  // because those are the only fields branch uses to verify the bills.
  const CW_MM = [10, 32, 95, 62, 82]
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
  const FS_TOT    = 18
  const FS_REF    = 18
  const FS_NOTE   = 14
  const FS_NOTE_L = 26

  // ── Row / section heights ─────────────────────────────────────────────────
  const TITLE_H   = Math.round(13 * S)
  const HEAD_H    = Math.round(11 * S)
  const ROW_H     = Math.round(11 * S)
  const SUMMARY_H = Math.round(14 * S)
  const REF_H     = Math.round(11 * S)
  const NOTE_H    = Math.round(28 * S)
  const TOP_PAD   = Math.round(3  * S)
  const BOT_PAD   = Math.round(3  * S)
  const LW        = Math.round(0.5 * S)

  // ── Aggregates: only what branch needs to verify ──────────────────────────
  const totalGross = items.reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0)
  const totalBills = items.length

  // ── Page height: title + header + rows + summary + ref + note + padding ───
  const totalH = TOP_PAD + TITLE_H + HEAD_H + items.length * ROW_H
               + SUMMARY_H + REF_H + NOTE_H + BOT_PAD

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
    return `${day}-${mon}-${yr}`
  }

  let y = TOP_PAD

  // ── 1. TITLE BAR ─────────────────────────────────────────────────────────
  const sec1X = L, sec2X = L + mainTitleW, sec3X = L + mainTitleW + extMovW

  drawRect(sec1X, y, mainTitleW, TITLE_H, ORANGE, null)
  drawRect(sec2X, y, extMovW,   TITLE_H, ORANGE, null)
  drawRect(sec3X, y, dateSectW, TITLE_H, ORANGE, null)

  ctx.save(); ctx.strokeStyle = BLACK; ctx.lineWidth = LW * 1.5
  ctx.strokeRect(L + LW*.75, y + LW*.75, useW - LW*1.5, TITLE_H - LW*1.5); ctx.restore()

  const titleMidY = y + TITLE_H / 2

  // Section 1: title — auto-fit
  setFont(FS_TITLE, true)
  let titleSz = FS_TITLE
  const titleStr = 'WHITE GOLD BULLION PVT LTD · GOLD CONSIGNEE REPORT'
  while (titleSz > 12 && ctx.measureText(titleStr).width > mainTitleW - 24) {
    titleSz -= 0.5; setFont(titleSz, true)
  }
  midText(titleStr, sec1X + 12, titleMidY, WHITE, 'left')

  setFont(FS_EXT, true)
  const movementLabel = consignment?.movement_type === 'INTERNAL' ? '(INTERNAL-MOVEMENT)' : '(EXTERNAL-MOVEMENT)'
  midText(movementLabel, sec2X + extMovW / 2, titleMidY, WHITE, 'center')

  setFont(FS_DATE, true)
  midText(dateStr, sec3X + dateSectW / 2, titleMidY, WHITE, 'center')

  y += TITLE_H

  // ── 2. TABLE HEADER ───────────────────────────────────────────────────────
  // Slim, branch-relevant only: S.N · DATE · CUSTOMER NAME · APPLICATION ID · BRANCH NAME
  const HEADERS = ['S.N', 'DATE', 'CUSTOMER NAME', 'APPLICATION ID', 'BRANCH NAME']
  drawRect(L, y, useW, HEAD_H, ORANGE, null)
  HEADERS.forEach((h, i) => {
    drawRect(CX[i], y, CW[i], HEAD_H, null, BLACK, LW)
    cellText(h, CX[i], y, CW[i], HEAD_H, 'center', WHITE, FS_HEAD, true)
  })
  y += HEAD_H

  // ── 3. DATA ROWS ──────────────────────────────────────────────────────────
  // Alternating row-tint for readability on long lists.
  items.forEach((p, idx) => {
    const branchLabel = p.branch_name || consignment.branch_name || ''
    const row = [
      String(idx + 1),
      fmtDate(p.purchase_date),
      p.customer_name || '',
      p.application_id || '',
      branchLabel,
    ]
    const rowFill = idx % 2 === 0 ? WHITE : SOFT
    drawRect(L, y, useW, ROW_H, rowFill, null)
    row.forEach((val, i) => {
      drawRect(CX[i], y, CW[i], ROW_H, null, BLACK, LW)
      // Customer name + application ID get left-aligned (longer text reads
      // better aligned to the column edge); S.N / DATE / BRANCH stay centered.
      const align = (i === 2 || i === 3) ? 'left' : 'center'
      cellText(val, CX[i], y, CW[i], ROW_H, align, BLACK, FS_BODY)
    })
    y += ROW_H
  })

  // ── 4. CONSOLIDATED SUMMARY BAND ─────────────────────────────────────────
  // Single full-width band: "TOTAL BILLS · CONSOLIDATED GROSS WEIGHT".
  // No per-bill or value rollups — that's the whole point of redaction.
  drawRect(L, y, useW, SUMMARY_H, ORANGE, null)
  ctx.save(); ctx.strokeStyle = BLACK; ctx.lineWidth = LW
  ctx.strokeRect(L + LW/2, y + LW/2, useW - LW, SUMMARY_H - LW); ctx.restore()

  const summaryMidY = y + SUMMARY_H / 2
  setFont(FS_TOT, true)
  ctx.fillStyle    = WHITE
  ctx.textBaseline = 'middle'

  // Three-column layout: bills count (left third) · separator dot · weight (right third)
  const billsLabel  = 'TOTAL BILLS'
  const billsValue  = String(totalBills)
  const wtLabel     = 'CONSOLIDATED GROSS WEIGHT'
  const wtValue     = `${fmtIN(totalGross)} g`

  // Left block: TOTAL BILLS  N
  ctx.textAlign = 'left'
  ctx.fillText(billsLabel, L + 24, summaryMidY)
  setFont(FS_TOT + 4, true)
  const billsLabelW = (() => { setFont(FS_TOT, true); const w = ctx.measureText(billsLabel).width; setFont(FS_TOT + 4, true); return w })()
  ctx.fillText(billsValue, L + 24 + billsLabelW + 18, summaryMidY)

  // Right block: CONSOLIDATED GROSS WEIGHT  X.XXX g — right-aligned
  setFont(FS_TOT + 4, true)
  const wtValueW = ctx.measureText(wtValue).width
  ctx.textAlign = 'right'
  ctx.fillText(wtValue, L + useW - 24, summaryMidY)
  setFont(FS_TOT, true)
  const wtLabelW = ctx.measureText(wtLabel).width
  ctx.fillText(wtLabel, L + useW - 24 - wtValueW - 18, summaryMidY)

  y += SUMMARY_H

  // ── 5. REF / TAMPER PROOF ROW ────────────────────────────────────────────
  drawRect(L, y, useW, REF_H, WHITE, BLACK, LW)
  setFont(FS_REF, true)
  const refMidY  = y + REF_H / 2
  const refLabel = 'Ref:-   '
  const tpLabel  = 'TAMPER PROOF No:-   '
  ctx.textBaseline = 'middle'

  ctx.fillStyle = RED;  ctx.textAlign = 'left'; ctx.fillText(refLabel, L + 14, refMidY)
  ctx.fillStyle = BLUE; ctx.fillText(String(consignment.challan_no || consignment.tmp_prf_no || ''),
    L + 14 + ctx.measureText(refLabel).width, refMidY)

  // Right-align the tamper proof so it sits at the right edge of the row
  const tmpStr = String(consignment.tmp_prf_no || '')
  setFont(FS_REF, true)
  const tpValueW = ctx.measureText(tmpStr).width
  ctx.fillStyle = BLUE; ctx.textAlign = 'right'; ctx.fillText(tmpStr, L + useW - 14, refMidY)
  ctx.fillStyle = RED;  ctx.fillText(tpLabel, L + useW - 14 - tpValueW - 6, refMidY)

  y += REF_H

  // ── 6. NOTE SECTION ───────────────────────────────────────────────────────
  // Updated copy: no longer mentions value-matching across documents (since
  // values are redacted from this document). Branch responsibility is to
  // verify customer + application ID match what's physically in the parcel.
  const sideW = Math.round(13 * S)

  drawRect(L, y, useW, NOTE_H, WHITE, BLACK, LW)
  drawRect(L, y, sideW, NOTE_H, ORANGE, null)
  drawLine(L + sideW, y, L + sideW, y + NOTE_H)

  ctx.save()
  ctx.translate(L + sideW / 2, y + NOTE_H / 2)
  ctx.rotate(-Math.PI / 2)
  setFont(FS_NOTE_L, true)
  ctx.fillStyle    = WHITE
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NOTE', 0, 0)
  ctx.restore()

  const NOTE_TEXT = 'BEFORE PACKING, VERIFY EACH BILL AGAINST THIS LIST — CUSTOMER NAME AND APPLICATION ID MUST MATCH THE PHYSICAL DOCUMENT IN THE PARCEL. THE CONSOLIDATED GROSS WEIGHT ABOVE IS THE WEIGHT THAT WILL ARRIVE AT THE HUB / HEAD OFFICE; ANY VARIANCE WILL BE INVESTIGATED. THIS DOCUMENT IS CONFIDENTIAL — DO NOT SHARE OUTSIDE THE COMPANY.'

  setFont(FS_NOTE, true, true)
  ctx.fillStyle    = DBLUE
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'alphabetic'

  const maxNoteW = useW - sideW - 28
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
  nLines.forEach((ln, i) => ctx.fillText(ln, L + sideW + 14, nyY + i * lineH))

  return await canvas.encode('jpeg', 95)
}
