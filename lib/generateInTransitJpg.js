// lib/generateInTransitJpg.js
//
// JPG renderer for the Consignment Report (in-transit) tab. Two layouts:
//
//   viewMode = 'case'   — one row per bill. Columns:
//     App ID | Customer | Branch | Gross (g) | Net (g) | Amount | Date
//
//   viewMode = 'branch' — one row per (branch + consignment date). The App ID
//     column is replaced with No of Bills (since branch-wise aggregates).
//     Columns: Date | Branch | No of Bills | Gross (g) | Net (g) | Amount
//
// Numbers are 2-decimal everywhere to match the in-app tables. Layout is
// modelled on lib/generateConsigneeReport.js (same fonts, same @napi-rs
// canvas) so the visual style stays consistent with the other JPG export.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { join } from 'path'

;(() => {
  const d = join(process.cwd(), 'node_modules/@fontsource/noto-sans/files')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-normal.woff2'), 'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-normal.woff2'), 'ReportBold')
})()

const fmtWt    = (n) => n != null ? Number(n).toFixed(2) : '—'
const fmtAmt   = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmtDate  = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[+m - 1]} ${y.slice(-2)}`
}
const formatDispatched = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit',
    })
  } catch { return '—' }
}

export async function generateInTransitJpg({ viewMode = 'case', rows = [], meta = {} } = {}) {
  const isBranch = viewMode === 'branch'

  // ── Theme ──────────────────────────────────────────────────────────────────
  const WHITE  = '#FFFFFF'
  const INK    = '#1A1A1A'
  const MUTED  = '#666666'
  const SOFT   = '#FAF7F0'
  const STRIPE = '#F5F2EE'
  const GOLD   = '#C9A84C'
  const GREEN  = '#3AAA6A'
  const BLUE   = '#3A8FBF'
  const LINE   = '#D8D2C4'

  // ── Geometry ───────────────────────────────────────────────────────────────
  const W       = 1400
  const PAD     = 32
  const HEAD_H  = 110
  const COL_H   = 44
  const ROW_H   = 32
  const TOT_H   = 44
  const FOOT_H  = 30

  // Column widths in px. Sums (across with 4×PAD margins) ≤ W - 2*PAD.
  const cols = isBranch ? [
    { key: 'consignment_date',    label: 'Consignment Date', w: 160, align: 'left'  },
    { key: 'branch_name',         label: 'Branch',           w: 320, align: 'left'  },
    { key: 'bills',               label: 'No of Bills',      w: 140, align: 'right' },
    { key: 'gross_weight',        label: 'Gross (g)',        w: 160, align: 'right' },
    { key: 'net_weight',          label: 'Net (g)',          w: 160, align: 'right' },
    { key: 'total_amount',        label: 'Amount',           w: 256, align: 'right' },
  ] : [
    { key: 'application_id',      label: 'App ID',           w: 160, align: 'left'  },
    { key: 'customer_name',       label: 'Customer',         w: 300, align: 'left'  },
    { key: 'branch_name',         label: 'Branch',           w: 200, align: 'left'  },
    { key: 'gross_weight',        label: 'Gross (g)',        w: 140, align: 'right' },
    { key: 'net_weight',          label: 'Net (g)',          w: 140, align: 'right' },
    { key: 'total_amount',        label: 'Amount',           w: 220, align: 'right' },
    { key: 'dispatched_at',       label: 'Consignment Date', w: 176, align: 'left'  },
  ]
  const innerW = cols.reduce((a, c) => a + c.w, 0)
  const startX = Math.max(PAD, Math.round((W - innerW) / 2))

  // Compute totals across all rows for the bottom totals row.
  const totals = rows.reduce((acc, r) => {
    acc.bills        += isBranch ? Number(r.bills || 0) : 1
    acc.gross_weight += Number(r.gross_weight || 0)
    acc.net_weight   += Number(r.net_weight   || 0)
    acc.total_amount += Number(r.total_amount || 0)
    return acc
  }, { bills: 0, gross_weight: 0, net_weight: 0, total_amount: 0 })

  const H = HEAD_H + COL_H + ROW_H * rows.length + TOT_H + FOOT_H + PAD
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // ── Background ─────────────────────────────────────────────────────────────
  ctx.fillStyle = WHITE
  ctx.fillRect(0, 0, W, H)

  // ── Header band ────────────────────────────────────────────────────────────
  ctx.fillStyle = SOFT
  ctx.fillRect(0, 0, W, HEAD_H)
  ctx.fillStyle = GOLD
  ctx.fillRect(0, HEAD_H - 4, W, 4)

  ctx.fillStyle = INK
  ctx.font = 'bold 28px ReportBold, Arial'
  ctx.textBaseline = 'top'
  ctx.fillText('Consignment Report — In Transit', PAD, 22)

  ctx.font = '15px Report, Arial'
  ctx.fillStyle = MUTED
  const subtitle = isBranch ? 'Branch-wise · one row per branch + consignment date' : 'Case-wise · one row per bill'
  ctx.fillText(subtitle, PAD, 56)

  // Meta line (right-aligned): generated_at + filter range + region
  ctx.textAlign = 'right'
  const metaBits = []
  if (meta.filter_label) metaBits.push(meta.filter_label)
  if (meta.region)       metaBits.push(meta.region)
  metaBits.push(`${rows.length} ${isBranch ? 'rows' : 'bills'}`)
  ctx.font = '13px Report, Arial'
  ctx.fillStyle = INK
  ctx.fillText(metaBits.join('  ·  '), W - PAD, 28)
  ctx.font = '12px Report, Arial'
  ctx.fillStyle = MUTED
  const gen = meta.generated_at ? new Date(meta.generated_at) : new Date()
  ctx.fillText(`Generated ${gen.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, W - PAD, 52)
  if (meta.generated_by) ctx.fillText(`By ${meta.generated_by}`, W - PAD, 72)
  ctx.textAlign = 'left'

  // ── Column headers ─────────────────────────────────────────────────────────
  let y = HEAD_H
  ctx.fillStyle = STRIPE
  ctx.fillRect(0, y, W, COL_H)
  ctx.strokeStyle = LINE
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, y + COL_H + 0.5)
  ctx.lineTo(W, y + COL_H + 0.5)
  ctx.stroke()

  ctx.font = 'bold 13px ReportBold, Arial'
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  let x = startX
  for (const c of cols) {
    ctx.textAlign = c.align
    const tx = c.align === 'right' ? x + c.w - 12 : x + 12
    ctx.fillText(c.label.toUpperCase(), tx, y + COL_H / 2)
    x += c.w
  }
  ctx.textAlign = 'left'
  y += COL_H

  // ── Body rows ──────────────────────────────────────────────────────────────
  ctx.font = '14px Report, Arial'
  ctx.textBaseline = 'middle'
  rows.forEach((r, i) => {
    if (i % 2 === 1) {
      ctx.fillStyle = STRIPE + '70'  // hex alpha
      ctx.fillRect(0, y, W, ROW_H)
    }
    let cx = startX
    for (const c of cols) {
      const tx = c.align === 'right' ? cx + c.w - 12 : cx + 12
      let val = ''
      let color = INK
      switch (c.key) {
        case 'application_id':
          val = r.application_id || '—'
          color = GOLD
          break
        case 'customer_name':
          val = (r.customer_name || '—').slice(0, 36)
          break
        case 'branch_name':
          val = (r.branch_name || '—').slice(0, 28)
          break
        case 'consignment_date':
          val = fmtDate(r.consignment_date)
          color = GOLD
          break
        case 'dispatched_at':
          val = formatDispatched(r.dispatched_at)
          break
        case 'bills':
          val = String(r.bills || 0)
          color = GOLD
          break
        case 'gross_weight':
          val = fmtWt(r.gross_weight)
          break
        case 'net_weight':
          val = fmtWt(r.net_weight)
          color = GOLD
          break
        case 'total_amount':
          val = fmtAmt(r.total_amount)
          color = BLUE
          break
        default:
          val = String(r[c.key] ?? '—')
      }
      ctx.fillStyle = color
      ctx.textAlign = c.align
      ctx.fillText(val, tx, y + ROW_H / 2)
      cx += c.w
    }
    y += ROW_H
  })

  // ── Totals row ─────────────────────────────────────────────────────────────
  ctx.fillStyle = SOFT
  ctx.fillRect(0, y, W, TOT_H)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, y + 0.5)
  ctx.lineTo(W, y + 0.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, y + TOT_H - 0.5)
  ctx.lineTo(W, y + TOT_H - 0.5)
  ctx.stroke()

  ctx.font = 'bold 14px ReportBold, Arial'
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  let tx = startX
  for (const c of cols) {
    const tpos = c.align === 'right' ? tx + c.w - 12 : tx + 12
    let val = ''
    let color = INK
    if (c.key === cols[0].key) { val = 'Σ TOTALS'; color = GOLD }
    else if (c.key === 'bills')        { val = String(totals.bills);        color = GOLD }
    else if (c.key === 'application_id') { val = `${rows.length} bills`;   color = GOLD }
    else if (c.key === 'gross_weight') { val = fmtWt(totals.gross_weight) }
    else if (c.key === 'net_weight')   { val = fmtWt(totals.net_weight);   color = GOLD }
    else if (c.key === 'total_amount') { val = fmtAmt(totals.total_amount); color = GREEN }
    else { val = '' }
    ctx.fillStyle = color
    ctx.textAlign = c.align
    if (val) ctx.fillText(val, tpos, y + TOT_H / 2)
    tx += c.w
  }
  ctx.textAlign = 'left'
  y += TOT_H

  // ── Footer ─────────────────────────────────────────────────────────────────
  ctx.font = '11px Report, Arial'
  ctx.fillStyle = MUTED
  ctx.textBaseline = 'top'
  ctx.fillText('White Gold · Consignment Report (In Transit)', PAD, y + 8)
  ctx.textAlign = 'right'
  ctx.fillText(`stock_status = in_consignment  ·  IST`, W - PAD, y + 8)
  ctx.textAlign = 'left'

  return canvas.toBuffer('image/jpeg', 0.95)
}
