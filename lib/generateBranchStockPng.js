// lib/generateBranchStockPng.js
//
// PNG renderer for the Branch Stock Overview (Consignment → Branch Stock).
// One row per branch. Columns:
//   Branch | Region | Total Net (g) | Today Bills | Today Net (g) |
//   Pending Bills | Pending Net (g) | Pending Value
//
// Mirrors lib/generateInTransitJpg.js for visual consistency. The caller
// (ConsignmentOverview) passes the ALREADY-FILTERED rows (current region +
// date selection) plus a meta block describing the active scope, so the image
// self-describes what slice it represents.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { join } from 'path'

;(() => {
  const d = join(process.cwd(), 'node_modules/@fontsource/noto-sans/files')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-normal.woff2'),     'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-ext-400-normal.woff2'), 'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-greek-400-normal.woff2'),     'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-normal.woff2'),     'ReportBold')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-ext-700-normal.woff2'), 'ReportBold')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-greek-700-normal.woff2'),     'ReportBold')
})()

const fmtWt  = (n) => n != null ? Number(n).toFixed(2) : '-'
// "Rs " prefix (not ₹) — the latin font subset doesn't reliably carry U+20B9.
const fmtAmt = (n) => n != null ? `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '-'

export async function generateBranchStockPng({ rows = [], meta = {} } = {}) {
  // ── Theme (matches generateInTransitJpg) ────────────────────────────────────
  const WHITE  = '#FFFFFF', INK = '#1A1A1A', MUTED = '#666666'
  const SOFT   = '#FAF7F0', STRIPE = '#F5F2EE'
  const GOLD   = '#C9A84C', GREEN = '#3AAA6A', LINE = '#D8D2C4'

  // ── Geometry ─────────────────────────────────────────────────────────────
  const W = 1400, PAD = 32, HEAD_H = 110, COL_H = 48, ROW_H = 36, TOT_H = 48, FOOT_H = 30

  // Widths sum to W - 2*PAD = 1336.
  const cols = [
    { key: 'branch_name',   label: 'Branch',         w: 240, align: 'left'  },
    { key: 'region',        label: 'Region',         w: 170, align: 'left'  },
    { key: 'total_net',     label: 'Total Net (g)',  w: 150, align: 'right' },
    { key: 'today_bills',   label: 'Today Bills',    w: 110, align: 'right' },
    { key: 'today_net',     label: 'Today Net (g)',  w: 140, align: 'right' },
    { key: 'pending_bills', label: 'Pending Bills',  w: 120, align: 'right' },
    { key: 'pending_net',   label: 'Pending Net (g)',w: 150, align: 'right' },
    { key: 'pending_value', label: 'Pending Value',  w: 256, align: 'right' },
  ]
  const CELL_PAD = 18
  const innerW = cols.reduce((a, c) => a + c.w, 0)
  const startX = Math.max(PAD, Math.round((W - innerW) / 2))

  // Normalise each row to the column keys.
  const norm = rows.map(b => {
    const todayNet = Number(b.today_net_wt || 0)
    const pendNet  = Number(b.older_net_wt || 0)
    return {
      branch_name:   b.branch_name || '-',
      region:        b.region || '-',
      total_net:     todayNet + pendNet,
      today_bills:   Number(b.today_bills || 0),
      today_net:     todayNet,
      pending_bills: Number(b.older_bills || 0),
      pending_net:   pendNet,
      pending_value: Number(b.older_gross_value || 0),
    }
  })

  const totals = norm.reduce((a, r) => {
    a.total_net += r.total_net; a.today_bills += r.today_bills; a.today_net += r.today_net
    a.pending_bills += r.pending_bills; a.pending_net += r.pending_net; a.pending_value += r.pending_value
    return a
  }, { total_net: 0, today_bills: 0, today_net: 0, pending_bills: 0, pending_net: 0, pending_value: 0 })

  const H = HEAD_H + COL_H + ROW_H * norm.length + TOT_H + FOOT_H + PAD
  const SCALE = 2
  const canvas = createCanvas(W * SCALE, H * SCALE)
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textRendering = 'geometricPrecision'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // ── Background + header band ─────────────────────────────────────────────
  ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = SOFT;  ctx.fillRect(0, 0, W, HEAD_H)
  ctx.fillStyle = GOLD;  ctx.fillRect(0, HEAD_H - 4, W, 4)

  ctx.fillStyle = INK
  ctx.font = 'bold 28px ReportBold, Arial'
  ctx.textBaseline = 'top'
  ctx.fillText('Branch Stock Overview', PAD, 22)

  ctx.font = '15px Report, Arial'
  ctx.fillStyle = MUTED
  const sub = [
    meta.scope || 'Branches',
    meta.regions ? `Region: ${meta.regions}` : null,
    meta.dates ? `Dates: ${meta.dates}` : null,
  ].filter(Boolean).join('  ·  ')
  ctx.fillText(sub, PAD, 56)

  ctx.textAlign = 'right'
  ctx.font = '13px Report, Arial'
  ctx.fillStyle = INK
  ctx.fillText(`${norm.length} ${norm.length === 1 ? 'branch' : 'branches'}`, W - PAD, 28)
  ctx.font = '12px Report, Arial'
  ctx.fillStyle = MUTED
  const gen = meta.generated_at ? new Date(meta.generated_at) : new Date()
  ctx.fillText(`Generated ${gen.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, W - PAD, 52)
  if (meta.generated_by) ctx.fillText(`By ${meta.generated_by}`, W - PAD, 72)
  ctx.textAlign = 'left'

  // ── Column headers ─────────────────────────────────────────────────────────
  let y = HEAD_H
  ctx.fillStyle = STRIPE; ctx.fillRect(0, y, W, COL_H)
  ctx.strokeStyle = LINE; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, y + COL_H + 0.5); ctx.lineTo(W, y + COL_H + 0.5); ctx.stroke()
  ctx.font = 'bold 13px ReportBold, Arial'
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  let x = startX
  for (const c of cols) {
    ctx.textAlign = c.align
    const tx = c.align === 'right' ? x + c.w - CELL_PAD : x + CELL_PAD
    ctx.fillText(c.label.toUpperCase(), tx, y + COL_H / 2)
    x += c.w
  }
  ctx.textAlign = 'left'
  y += COL_H

  // ── Body rows ──────────────────────────────────────────────────────────────
  ctx.textBaseline = 'middle'
  norm.forEach((r, i) => {
    if (i % 2 === 1) { ctx.fillStyle = STRIPE + '70'; ctx.fillRect(0, y, W, ROW_H) }
    let cx = startX
    for (const c of cols) {
      const tx = c.align === 'right' ? cx + c.w - CELL_PAD : cx + CELL_PAD
      let val = '', bold = false
      switch (c.key) {
        case 'branch_name':   val = String(r.branch_name).slice(0, 30); bold = true; break
        case 'region':        val = String(r.region).slice(0, 22); break
        case 'total_net':     val = fmtWt(r.total_net); bold = true; break
        case 'today_bills':   val = String(r.today_bills); break
        case 'today_net':     val = fmtWt(r.today_net); break
        case 'pending_bills': val = String(r.pending_bills); break
        case 'pending_net':   val = fmtWt(r.pending_net); break
        case 'pending_value': val = fmtAmt(r.pending_value); break
        default:              val = ''
      }
      ctx.font = bold ? 'bold 15px ReportBold, Arial' : '15px Report, Arial'
      ctx.fillStyle = INK
      ctx.textAlign = c.align
      ctx.fillText(val, tx, y + ROW_H / 2)
      cx += c.w
    }
    y += ROW_H
  })

  // ── Totals row ─────────────────────────────────────────────────────────────
  ctx.fillStyle = SOFT; ctx.fillRect(0, y, W, TOT_H)
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, y + TOT_H - 0.5); ctx.lineTo(W, y + TOT_H - 0.5); ctx.stroke()
  ctx.font = 'bold 15px ReportBold, Arial'
  ctx.textBaseline = 'middle'
  let tx2 = startX
  for (const c of cols) {
    const tpos = c.align === 'right' ? tx2 + c.w - CELL_PAD : tx2 + CELL_PAD
    let val = '', color = INK
    if (c.key === cols[0].key) { val = `TOTALS  -  ${norm.length} ${norm.length === 1 ? 'branch' : 'branches'}`; color = GOLD }
    else if (c.key === 'total_net')     val = fmtWt(totals.total_net)
    else if (c.key === 'today_bills')   val = String(totals.today_bills)
    else if (c.key === 'today_net')     val = fmtWt(totals.today_net)
    else if (c.key === 'pending_bills') val = String(totals.pending_bills)
    else if (c.key === 'pending_net')   val = fmtWt(totals.pending_net)
    else if (c.key === 'pending_value') { val = fmtAmt(totals.pending_value); color = GREEN }
    ctx.fillStyle = color
    ctx.textAlign = c.align
    if (val) ctx.fillText(val, tpos, y + TOT_H / 2)
    tx2 += c.w
  }
  ctx.textAlign = 'left'
  y += TOT_H

  // ── Footer ─────────────────────────────────────────────────────────────────
  ctx.font = '11px Report, Arial'
  ctx.fillStyle = MUTED
  ctx.textBaseline = 'top'
  ctx.fillText('White Gold · Branch Stock Overview', PAD, y + 8)
  ctx.textAlign = 'right'
  ctx.fillText('Net weight in grams · IST', W - PAD, y + 8)
  ctx.textAlign = 'left'

  return canvas.toBuffer('image/png')
}
