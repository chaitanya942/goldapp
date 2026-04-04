import { useRef, useState, useEffect } from 'react'

// ── THEMES ──
export const THEMES = {
  dark: {
    bg:     '#0a0a0a',
    card:   '#111111',
    card2:  '#161616',
    card3:  '#1c1c1c',
    text1:  '#f0e6c8',
    text2:  '#c8b89a',
    text3:  '#7a6a4a',
    text4:  '#4a3a2a',
    gold:   '#c9a84c',
    border: '#1e1e1e',
    border2:'#252525',
    green:  '#3aaa6a',
    red:    '#e05555',
    blue:   '#3a8fbf',
    purple: '#8c5ac8',
    orange: '#c9981f',
    shadow: '0 1px 3px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)',
    shadowLg: '0 4px 24px rgba(0,0,0,.7), 0 1px 4px rgba(0,0,0,.5)',
  },
  light: {
    bg:     '#f0ebe0',
    card:   '#e8e2d6',
    card2:  '#e0d9cc',
    card3:  '#d8d0c2',
    text1:  '#1a1208',
    text2:  '#5a4a2a',
    text3:  '#8a7a5a',
    text4:  '#b0a080',
    gold:   '#a07830',
    border: '#d0c8b8',
    border2:'#c5bca8',
    green:  '#2a8a5a',
    red:    '#c03030',
    blue:   '#2a6a9a',
    purple: '#6a3a9a',
    orange: '#a07010',
    shadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06)',
    shadowLg: '0 4px 24px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.08)',
  },
}

export const CHART_COLORS = ['#c9a84c','#3a8fbf','#3aaa6a','#e05555','#8c5ac8','#c9981f','#bf5a3a','#5ac8a0']
export const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
export const STATES = ['Karnataka','Kerala','Andhra Pradesh','Telangana']

// ── FORMATTERS ──
export const fmt      = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
export const fmtVal   = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'
export const fmtDate  = (d) => { if (!d) return '—'; const dt = new Date(d); return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
export const fmtShort = (d) => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }
export const pct      = (a, b) => b ? ((Number(a) / Number(b)) * 100).toFixed(1) : '0.0'
export const growth   = (cur, prev) => (prev && Number(prev) > 0) ? (((Number(cur) - Number(prev)) / Number(prev)) * 100).toFixed(1) : null

// ── EXPORT HELPERS ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script'); s.src = src
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

export async function exportReportPDF(rows, columns, filename, meta = {}) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')

  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // ── Header band ──
  doc.setFillColor(10, 10, 10)
  doc.rect(0, 0, 297, 22, 'F')
  doc.setTextColor(201, 168, 76)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('GOLDAPP', 10, 14)
  doc.setTextColor(200, 184, 154)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Purchase Report', 40, 14)

  if (meta.dateRange) {
    doc.setTextColor(154, 138, 106)
    doc.setFontSize(8)
    doc.text(meta.dateRange, 297 - 10, 14, { align: 'right' })
  }

  // ── KPI summary row ──
  let yPos = 28
  if (meta.kpis && meta.kpis.length > 0) {
    const colW  = (297 - 20) / meta.kpis.length
    meta.kpis.forEach((kpi, i) => {
      const x = 10 + i * colW
      doc.setFillColor(22, 22, 22)
      doc.roundedRect(x, yPos, colW - 2, 16, 2, 2, 'F')
      doc.setTextColor(154, 138, 106)
      doc.setFontSize(6)
      doc.setFont('helvetica', 'normal')
      doc.text(kpi.label.toUpperCase(), x + 3, yPos + 5)
      doc.setTextColor(240, 230, 200)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(String(kpi.value), x + 3, yPos + 12)
    })
    yPos += 22
  }

  // ── Table ──
  doc.autoTable({
    startY: yPos,
    head: [columns.map(c => c.label)],
    body: rows.map(r => columns.map(c => c.fn ? c.fn(r) : (r[c.key] ?? ''))),
    styles: {
      fontSize: 7,
      cellPadding: 2,
      textColor: [200, 184, 154],
      fillColor: [17, 17, 17],
      lineColor: [30, 30, 30],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [10, 10, 10],
      textColor: [201, 168, 76],
      fontStyle: 'bold',
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [22, 22, 22] },
    margin: { left: 10, right: 10 },
  })

  // ── Footer ──
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(6)
    doc.setTextColor(106, 90, 58)
    doc.text(`Page ${i} of ${pageCount}  ·  Generated ${new Date().toLocaleString('en-IN')}`, 148.5, 207, { align: 'center' })
  }

  doc.save(filename)
}

// ── SHARED STYLES ──
export const getStyles = (t) => ({
  card: {
    background: t.card,
    border: `1px solid ${t.border}`,
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '16px',
    boxShadow: t.shadow,
  },
  card2: {
    background: t.card2,
    border: `1px solid ${t.border}`,
    borderRadius: '10px',
    padding: '16px',
    boxShadow: t.shadow,
  },
  kpiCard: {
    background: t.card,
    border: `1px solid ${t.border}`,
    borderRadius: '12px',
    padding: '18px 20px',
    boxShadow: t.shadow,
    position: 'relative',
    overflow: 'hidden',
  },
  sTitle: {
    fontSize: '.58rem',
    color: t.text3,
    letterSpacing: '.2em',
    textTransform: 'uppercase',
    marginBottom: '14px',
    fontWeight: 500,
  },
  th: {
    padding: '10px 14px',
    fontSize: '.58rem',
    color: t.text3,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    textAlign: 'left',
    borderBottom: `1px solid ${t.border}`,
    background: t.card,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 14px',
    fontSize: '.73rem',
    color: t.text1,
    borderBottom: `1px solid ${t.border}18`,
    whiteSpace: 'nowrap',
  },
  pill: (active, col) => ({
    padding: '5px 14px',
    borderRadius: '100px',
    border: `1px solid ${active ? (col || t.gold) : t.border}`,
    background: active ? `${col || t.gold}18` : 'transparent',
    color: active ? (col || t.gold) : t.text3,
    fontSize: '.65rem',
    cursor: 'pointer',
    letterSpacing: '.05em',
    fontWeight: active ? 500 : 400,
    transition: 'all .18s ease',
    outline: 'none',
  }),
  pillSm: (active, col) => ({
    padding: '3px 10px',
    borderRadius: '100px',
    border: `1px solid ${active ? (col || t.gold) : t.border}`,
    background: active ? `${col || t.gold}15` : 'transparent',
    color: active ? (col || t.gold) : t.text3,
    fontSize: '.6rem',
    cursor: 'pointer',
    letterSpacing: '.04em',
    transition: 'all .15s',
    outline: 'none',
  }),
  drillBtn: (active) => ({
    padding: '5px 14px', borderRadius: '6px',
    border: `1px solid ${active ? t.gold : t.border}`,
    background: active ? `${t.gold}15` : 'transparent',
    color: active ? t.gold : t.text2,
    fontSize: '.7rem', cursor: 'pointer',
  }),
  badge: (color) => ({
    fontSize: '.6rem',
    padding: '2px 8px',
    borderRadius: '100px',
    background: `${color}18`,
    color: color,
    fontWeight: 500,
    letterSpacing: '.04em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
  }),
  input: {
    background: t.card2,
    border: `1px solid ${t.border2}`,
    borderRadius: '8px',
    padding: '8px 12px',
    color: t.text1,
    fontSize: '.73rem',
    outline: 'none',
    transition: 'border-color .18s',
  },
  select: {
    background: t.card2,
    border: `1px solid ${t.border2}`,
    borderRadius: '8px',
    padding: '8px 12px',
    color: t.text1,
    fontSize: '.73rem',
    cursor: 'pointer',
    outline: 'none',
  },
  btnPrimary: {
    background: t.gold,
    border: 'none',
    borderRadius: '9px',
    padding: '10px 28px',
    color: '#0a0a0a',
    fontSize: '.75rem',
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '.06em',
    boxShadow: `0 2px 12px ${t.gold}40`,
    transition: 'all .18s ease',
  },
  btnSecondary: {
    background: 'transparent',
    border: `1px solid ${t.border2}`,
    borderRadius: '9px',
    padding: '10px 20px',
    color: t.text2,
    fontSize: '.73rem',
    cursor: 'pointer',
    letterSpacing: '.04em',
    transition: 'all .18s ease',
  },
  divider: {
    height: '1px',
    background: t.border,
    margin: '16px 0',
  },
})

// ── GROWTH BADGE ──
export function GrowthBadge({ value, t }) {
  if (value === null || value === undefined) return null
  const up = Number(value) >= 0
  return (
    <span style={{
      fontSize: '.62rem', padding: '2px 8px', borderRadius: '100px',
      background: up ? `${t.green}20` : `${t.red}20`,
      color: up ? t.green : t.red,
      fontWeight: 500,
      display: 'inline-flex', alignItems: 'center', gap: '2px',
    }}>
      {up ? '▲' : '▼'} {Math.abs(value)}%
    </span>
  )
}

// ── KPI CARD ──
export function KpiCard({ label, value, sub, color, icon, t, trend }) {
  const s = getStyles(t)
  return (
    <div style={{ ...s.kpiCard }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: `linear-gradient(90deg, transparent, ${color || t.gold}60, transparent)`,
        borderRadius: '12px 12px 0 0',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '.58rem', color: t.text3, letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: '1.4rem', color: color || t.gold, fontWeight: 200, letterSpacing: '-.01em', lineHeight: 1 }}>{value}</div>
          {sub && <div style={{ fontSize: '.65rem', color: t.text3, marginTop: '6px' }}>{sub}</div>}
        </div>
        {icon && (
          <div style={{
            width: '34px', height: '34px', borderRadius: '9px',
            background: `${color || t.gold}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1rem', flexShrink: 0,
          }}>{icon}</div>
        )}
      </div>
      {trend !== undefined && trend !== null && (
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <GrowthBadge value={trend} t={t} />
          <span style={{ fontSize: '.6rem', color: t.text4 }}>vs prev period</span>
        </div>
      )}
    </div>
  )
}

// ── BAR CHART ──
export function BarChart({ data, xKey, yKey, color, height = 140, t, formatValue }) {
  const [hovered, setHovered] = useState(null)
  if (!data?.length) return null
  const max = Math.max(...data.map(d => Number(d[yKey]) || 0))
  return (
    <div style={{ width: '100%', position: 'relative', overflow: 'visible' }}>
      {hovered !== null && (
        <div style={{
          position: 'absolute', bottom: '100%',
          left: `${Math.min(Math.max((hovered / data.length) * 100, 5), 75)}%`,
          transform: 'translateX(-50%)',
          marginBottom: '6px',
          fontWeight: 600,
          background: t?.card2 || '#1a1a1a',
          border: `1px solid ${color || CHART_COLORS[0]}50`,
          borderRadius: '8px', padding: '6px 14px',
          pointerEvents: 'none', zIndex: 10,
          whiteSpace: 'nowrap', boxShadow: t?.shadowLg,
        }}>
          <div style={{ fontSize: '.65rem', color: t?.text2, marginBottom: '3px' }}>
            {fmtDate(data[hovered]?.[xKey]) || data[hovered]?.[xKey]}
          </div>
          <div style={{ fontSize: '.88rem', color: color || CHART_COLORS[0], fontWeight: 700 }}>
            {formatValue ? formatValue(Number(data[hovered]?.[yKey])) : fmt(data[hovered]?.[yKey])}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: `${height}px` }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}>
            <div style={{
              width: '100%',
              background: hovered === i ? color || CHART_COLORS[0] : `${color || CHART_COLORS[0]}80`,
              borderRadius: '3px 3px 0 0',
              height: `${max > 0 ? (Number(d[yKey]) / max) * 100 : 0}%`,
              minHeight: '2px',
              opacity: hovered === null ? 1 : hovered === i ? 1 : .4,
              transition: 'all .15s',
              cursor: 'default',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
        <span style={{ fontSize: '.55rem', color: t?.text4 }}>{fmtShort(data[0]?.[xKey]) || data[0]?.[xKey]}</span>
        <span style={{ fontSize: '.55rem', color: t?.text4 }}>{fmtShort(data[data.length-1]?.[xKey]) || data[data.length-1]?.[xKey]}</span>
      </div>
    </div>
  )
}

// ── LINE CHART ──
export function LineChart({ data, xKey, yKey, color, height = 160, t, formatValue }) {
  const ref = useRef(null)
  const [w, setW] = useState(500)
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    if (!ref.current) return
    setW(ref.current.offsetWidth)
    const ro = new ResizeObserver(() => { if (ref.current) setW(ref.current.offsetWidth) })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [data])

  if (!data?.length || data.length < 2) return (
    <div style={{ textAlign: 'center', color: t?.text4, padding: '40px', fontSize: '.72rem' }}>Not enough data</div>
  )

  const vals = data.map(d => Number(d[yKey]) || 0)
  const max = Math.max(...vals), min = Math.min(...vals), range = max - min || 1
  const pad = { t: 20, b: 24, l: 36, r: 12 }
  const cw = w - pad.l - pad.r, ch = height - pad.t - pad.b

  const pts = data.map((_, i) => [
    pad.l + (i / (data.length - 1)) * cw,
    pad.t + ((max - vals[i]) / range) * ch,
  ])
  const polyline = pts.map(p => p.join(',')).join(' ')
  const area = [...pts.map(p => p.join(',')), `${pts[pts.length-1][0]},${height - pad.b}`, `${pts[0][0]},${height - pad.b}`].join(' ')

  const handleMouseMove = (e) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const mouseX = e.clientX - rect.left
    let nearest = 0, minDist = Infinity
    pts.forEach(([x], i) => { const d = Math.abs(x - mouseX); if (d < minDist) { minDist = d; nearest = i } })
    const [px, py] = pts[nearest]
    setTooltip({ x: px, y: py, label: fmtDate(data[nearest][xKey]) || data[nearest][xKey], value: formatValue ? formatValue(vals[nearest]) : fmt(vals[nearest]) })
  }

  const maxIdx = vals.indexOf(max)
  const minIdx = vals.indexOf(Math.min(...vals))

  return (
    <div style={{ width: '100%', position: 'relative' }} ref={ref} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: Math.min(tooltip.x + 14, w - 150),
          top: Math.max(tooltip.y - 44, 0),
          background: t?.card2 || '#161616',
          border: `1px solid ${color}50`,
          borderRadius: '8px', padding: '8px 14px',
          pointerEvents: 'none', zIndex: 10,
          whiteSpace: 'nowrap', boxShadow: t?.shadowLg,
        }}>
          <div style={{ fontSize: '.6rem', color: t?.text3, marginBottom: '3px' }}>{tooltip.label}</div>
          <div style={{ fontSize: '.85rem', color: color, fontWeight: 500 }}>{tooltip.value}</div>
        </div>
      )}
      <svg width="100%" height={height} style={{ overflow: 'visible', cursor: 'crosshair' }}>
        <defs>
          <linearGradient id={`lg_${yKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, .25, .5, .75, 1].map((p, i) => {
          const yPos = pad.t + p * ch, val = max - p * range
          return (
            <g key={i}>
              <line x1={pad.l} y1={yPos} x2={w - pad.r} y2={yPos} stroke={color} strokeWidth=".5" opacity=".1" />
              <text x={pad.l - 5} y={yPos + 4} textAnchor="end" fontSize="9" fill={color} opacity=".35">
                {val >= 1000 ? `${(val/1000).toFixed(1)}k` : Math.round(val)}
              </text>
            </g>
          )
        })}
        <polygon points={area} fill={`url(#lg_${yKey})`} />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <circle cx={pts[maxIdx][0]} cy={pts[maxIdx][1]} r="5" fill={color} opacity=".9" />
        <text x={pts[maxIdx][0]} y={pts[maxIdx][1] - 11} textAnchor="middle" fontSize="9" fill={color} fontWeight="600">
          ▲ {formatValue ? formatValue(max) : fmt(max)}
        </text>
        <circle cx={pts[minIdx][0]} cy={pts[minIdx][1]} r="4" fill={color} opacity=".5" />
        <text x={pts[minIdx][0]} y={pts[minIdx][1] + 17} textAnchor="middle" fontSize="9" fill={color} opacity=".7">
          ▼ {formatValue ? formatValue(Math.min(...vals)) : fmt(Math.min(...vals))}
        </text>
        {tooltip && <line x1={tooltip.x} y1={pad.t} x2={tooltip.x} y2={height - pad.b} stroke={color} strokeWidth="1" strokeDasharray="3,3" opacity=".4" />}
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={tooltip && Math.abs(tooltip.x - x) < 5 ? 5 : 2.5} fill={color}
            opacity={tooltip && Math.abs(tooltip.x - x) < 5 ? 1 : .55} style={{ transition: 'r .1s, opacity .1s' }} />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', paddingLeft: `${pad.l}px`, paddingRight: `${pad.r}px` }}>
        <span style={{ fontSize: '.55rem', color: t?.text4 }}>{fmtShort(data[0]?.[xKey])}</span>
        <span style={{ fontSize: '.55rem', color: t?.text4 }}>{fmtShort(data[data.length - 1]?.[xKey])}</span>
      </div>
    </div>
  )
}

// ── HEATMAP ROW ──
export function HeatmapRow({ label, value, max, color, sub, t }) {
  const w = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
      <div style={{ width: '44px', fontSize: '.65rem', color: t.text3, textAlign: 'right', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: '18px', background: t.border, borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          width: `${w}%`, height: '100%',
          background: `linear-gradient(90deg, ${color}cc, ${color})`,
          borderRadius: '4px', transition: 'width .5s ease',
        }} />
      </div>
      <div style={{ width: '72px', fontSize: '.65rem', color: t.text2, textAlign: 'right', flexShrink: 0 }}>{sub || value}</div>
    </div>
  )
}

// ── EMPTY STATE ──
export function EmptyState({ message = 'No data available', t }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: '1.4rem', marginBottom: '10px', opacity: .4 }}>◈</div>
      <div style={{ fontSize: '.78rem', color: t.text3 }}>{message}</div>
    </div>
  )
}

// ── SECTION HEADER ──
export function SectionHeader({ title, sub, actions, t }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
      <div>
        <div style={{ fontSize: '.78rem', fontWeight: 600, color: t.text1, letterSpacing: '.04em' }}>{title}</div>
        {sub && <div style={{ fontSize: '.65rem', color: t.text3, marginTop: '3px' }}>{sub}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{actions}</div>}
    </div>
  )
}