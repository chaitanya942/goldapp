// lib/generateInTransitJpg.js
//
// JPG renderer for the Consignment Report (movements-by-date) tab. Two layouts:
//
//   viewMode = 'case'   — one row per bill. Columns:
//     App ID | Customer | Branch | Gross (g) | Net (g) | Amount |
//     Consignment Date | Status
//
//   viewMode = 'branch' — one row per (branch + consignment date). Columns:
//     Consignment Date | Branch | No of Bills | Gross (g) | Net (g) |
//     Amount | Expected Delivery
//
// Numbers are 2-decimal everywhere to match the in-app tables. Dates render
// as DD-MMM-YYYY (e.g. "23-May-2026") so the JPG self-describes when shared
// outside the app. Layout is modelled on lib/generateConsigneeReport.js so
// the visual style stays consistent with the other JPG export.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { join } from 'path'

;(() => {
  const d = join(process.cwd(), 'node_modules/@fontsource/noto-sans/files')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-400-normal.woff2'), 'Report')
  GlobalFonts.registerFromPath(join(d, 'noto-sans-latin-700-normal.woff2'), 'ReportBold')
})()

const fmtWt    = (n) => n != null ? Number(n).toFixed(2) : '—'
const fmtAmt   = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// DD-MMM-YYYY (e.g. "23-May-2026") — same format the in-app table uses so the
// JPG and the on-screen view always read identically.
const fmtDate  = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return `${day}-${MONTHS[+m - 1]}-${y}`
}
const formatDispatched = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    }).replace(/ /g, '-')
  } catch { return '—' }
}
const STATUS_LABEL = {
  in_consignment:   'In transit',
  at_ho:            'Received',
  sent_for_melting: 'Melting',
  melted:           'Melted',
  sold:             'Sold',
  at_branch:        'Back at branch',
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
  // Total target is ~1336px ( W - 2*PAD = 1400 - 64 ).
  const cols = isBranch ? [
    { key: 'consignment_date',     label: 'Consignment Date',  w: 170, align: 'left'  },
    { key: 'branch_name',          label: 'Branch',            w: 286, align: 'left'  },
    { key: 'bills',                label: 'No of Bills',       w: 130, align: 'right' },
    { key: 'gross_weight',         label: 'Gross (g)',         w: 150, align: 'right' },
    { key: 'net_weight',           label: 'Net (g)',           w: 150, align: 'right' },
    { key: 'total_amount',         label: 'Amount',            w: 240, align: 'right' },
    { key: 'expected_delivery_date', label: 'Expected Delivery', w: 210, align: 'left' },
  ] : [
    { key: 'application_id',       label: 'App ID',            w: 150, align: 'left'  },
    { key: 'customer_name',        label: 'Customer',          w: 240, align: 'left'  },
    { key: 'branch_name',          label: 'Branch',            w: 180, align: 'left'  },
    { key: 'gross_weight',         label: 'Gross (g)',         w: 130, align: 'right' },
    { key: 'net_weight',           label: 'Net (g)',           w: 130, align: 'right' },
    { key: 'total_amount',         label: 'Amount',            w: 210, align: 'right' },
    { key: 'dispatched_at',        label: 'Consignment Date',  w: 170, align: 'left'  },
    { key: 'stock_status',         label: 'Status',            w: 126, align: 'left'  },
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
  // 2× the backing-store resolution so text stays crisp regardless of where
  // the image is opened (browser preview, WhatsApp, print). All draw calls
  // stay in the same logical pixel coordinates thanks to ctx.scale(SCALE).
  const SCALE  = 2
  const canvas = createCanvas(W * SCALE, H * SCALE)
  const ctx    = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textRendering = 'geometricPrecision'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

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
  ctx.fillText('Consignment Report', PAD, 22)

  ctx.font = '15px Report, Arial'
  ctx.fillStyle = MUTED
  const subtitle = isBranch
    ? 'Branch-wise · one row per (branch + consignment date)'
    : 'Case-wise · one row per dispatched bill'
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
  // Body text rendered in plain INK rather than the on-screen gold / blue
  // tints — JPEG compression + the white background washed those colours
  // out, making cells appear half-faded. Headers + totals keep the accent
  // colour for visual hierarchy. App-id / dates use bold ink instead of
  // colour to stand out.
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
      let bold = false
      switch (c.key) {
        case 'application_id':
          val = r.application_id || '—'
          bold = true
          break
        case 'customer_name':
          val = (r.customer_name || '—').slice(0, 36)
          break
        case 'branch_name':
          val = (r.branch_name || '—').slice(0, 32)
          break
        case 'consignment_date':
          val = fmtDate(r.consignment_date)
          bold = true
          break
        case 'expected_delivery_date':
          val = fmtDate(r.expected_delivery_date)
          break
        case 'dispatched_at':
          val = formatDispatched(r.dispatched_at)
          bold = true
          break
        case 'bills':
          val = String(r.bills || 0)
          bold = true
          break
        case 'gross_weight':
          val = fmtWt(r.gross_weight)
          break
        case 'net_weight':
          val = fmtWt(r.net_weight)
          bold = true
          break
        case 'total_amount':
          val = fmtAmt(r.total_amount)
          break
        case 'stock_status':
          val = STATUS_LABEL[r.stock_status] || (r.stock_status || '—')
          break
        default:
          val = String(r[c.key] ?? '—')
      }
      ctx.font = bold ? 'bold 14px ReportBold, Arial' : '14px Report, Arial'
      ctx.fillStyle = INK
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
    if (c.key === cols[0].key) {
      // First cell carries "Σ TOTALS · N rows/bills" — single source of the
      // count so the second column isn't crowded with a label.
      const count = `${rows.length} ${isBranch ? 'rows' : 'bills'}`
      val = `Σ TOTALS  ·  ${count}`
      color = GOLD
    }
    else if (c.key === 'bills')        { val = String(totals.bills) }
    else if (c.key === 'gross_weight') { val = fmtWt(totals.gross_weight) }
    else if (c.key === 'net_weight')   { val = fmtWt(totals.net_weight) }
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
  ctx.fillText('White Gold · Consignment Report', PAD, y + 8)
  ctx.textAlign = 'right'
  ctx.fillText(`Movements by dispatch date · IST`, W - PAD, y + 8)
  ctx.textAlign = 'left'

  // PNG, not JPEG — text-heavy reports get visible chroma-subsampling
  // ghosting on JPEG even at quality 1.0. PNG is lossless and scales cleanly
  // to whatever the recipient's viewer needs.
  return canvas.toBuffer('image/png')
}
