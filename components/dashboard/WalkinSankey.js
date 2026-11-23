'use client'

// Animated Sankey for the walk-in journey: Jarvis walk-ins → OTPs (Telesales /
// Direct) → actual walk-ins, with drop-offs in red. Every flow balances: OTPs the
// cameras never saw (Telesales OTPs sent before a visit, branches without a
// camera) enter from a small "Outside Jarvis" source instead of being forced out
// of the Jarvis count.
//
// `cells` = the visible branch rows of the Walk-in Analysis table
// ({ jarvis_group, otp_TS, otp_DW, walk_TS, walk_DW }).

import { useState, useEffect, useRef, useMemo, useId } from 'react'

// Readable text colour for a node: dark ink on light fills, white on dark ones.
const inkFor = (hex) => {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1a1208' : '#ffffff'
}
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
const fmtN = (n) => Math.round(n).toLocaleString('en-IN')
const fmtP = (p) => (p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`)

function buildGraph(cells, jarvis) {
  const sum = (f) => cells.reduce((s, c) => s + (f(c) || 0), 0)
  const OTS = sum(c => c.otp_TS), ODW = sum(c => c.otp_DW)
  const WTS = sum(c => c.walk_TS), WDW = sum(c => c.walk_DW)
  const cam = cells.filter(c => (c.jarvis_group || 0) > 0)
  const J = jarvis ? sum(c => c.jarvis_group) : 0

  const nodes = [], links = []
  const node = (id, col, label, short, value, kind) => { if (value > 0.0001) nodes.push({ id, col, label, short, value, kind }) }
  const link = (s, t, value) => { if (value > 0.0001) links.push({ s, t, value }) }

  const off = jarvis && J > 0 ? 1 : 0
  if (off) {
    // People the cameras saw who carried an OTP: camera-branch Telesales walk-ins + Direct OTPs.
    let inTS = cam.reduce((s, c) => s + (c.walk_TS || 0), 0)
    let inDW = cam.reduce((s, c) => s + (c.otp_DW || 0), 0)
    const inStore = inTS + inDW
    if (inStore > J) { const f = J / inStore; inTS *= f; inDW *= f }
    const noOtp = Math.max(0, J - inTS - inDW)
    const extTS = Math.max(0, OTS - inTS), extDW = Math.max(0, ODW - inDW)
    node('jarvis', 0, 'Jarvis walk-ins', 'Jarvis', J, 'base')
    node('ext', 0, 'Outside Jarvis', 'Outside', extTS + extDW, 'ext')
    link('jarvis', 'tsOtp', inTS); link('jarvis', 'dwOtp', inDW); link('jarvis', 'noOtp', noOtp)
    link('ext', 'tsOtp', extTS); link('ext', 'dwOtp', extDW)
    node('noOtp', 1, 'No OTP', 'No OTP', noOtp, 'drop')
  }
  node('tsOtp', off, 'Telesales OTP', 'TS OTP', OTS, 'ts')
  node('dwOtp', off, 'Direct OTP', 'Direct OTP', ODW, 'dw')
  node('tsWalk', off + 1, 'Telesales walk-in', 'TS walk-in', WTS, 'ts')
  node('dwWalk', off + 1, 'Direct walk-in', 'Direct walk-in', WDW, 'dw')
  node('tsNoShow', off + 1, 'Telesales no-show', 'TS no-show', Math.max(0, OTS - WTS), 'drop')
  node('dwDrop', off + 1, 'Direct not walked in', 'DW drop', Math.max(0, ODW - WDW), 'drop')
  link('tsOtp', 'tsWalk', Math.min(WTS, OTS)); link('tsOtp', 'tsNoShow', Math.max(0, OTS - WTS))
  link('dwOtp', 'dwWalk', Math.min(WDW, ODW)); link('dwOtp', 'dwDrop', Math.max(0, ODW - WDW))

  // Column order top → bottom (drops last, like a funnel).
  const ORDER = ['jarvis', 'ext', 'dwOtp', 'tsOtp', 'noOtp', 'dwWalk', 'tsWalk', 'tsNoShow', 'dwDrop']
  nodes.sort((a, b) => a.col - b.col || ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
  const ids = new Set(nodes.map(n => n.id))
  return { nodes, links: links.filter(l => ids.has(l.s) && ids.has(l.t)), cols: off + 2, J, OTS, ODW }
}

function layout(g, W, H, isMobile) {
  const cols = g.cols
  const nodeW = Math.max(isMobile ? 74 : 110, Math.min(isMobile ? 96 : 168, W * (isMobile ? 0.25 : 0.16)))
  const colGap = (W - cols * nodeW) / Math.max(1, cols - 1)
  const gap = isMobile ? 10 : 14, minH = isMobile ? 36 : 42
  const byCol = Array.from({ length: cols }, (_, c) => g.nodes.filter(n => n.col === c))
  // Scale so the fullest column fits.
  let k = Infinity
  for (const list of byCol) {
    const tot = list.reduce((s, n) => s + n.value, 0)
    if (tot > 0) k = Math.min(k, (H - (list.length - 1) * gap - list.length * 4) / tot)
  }
  if (!isFinite(k)) k = 1
  const pos = {}
  let maxY = 0
  byCol.forEach((list, c) => {
    const hs = list.map(n => Math.max(minH, n.value * k))
    const tot = hs.reduce((s, h) => s + h, 0) + (list.length - 1) * gap
    let y = Math.max(0, (H - tot) / 2)
    list.forEach((n, i) => {
      pos[n.id] = { x: c * (nodeW + colGap), y, w: nodeW, h: hs[i], outOff: 0, inOff: 0 }
      y += hs[i] + gap
    })
    maxY = Math.max(maxY, y - gap)
  })
  // Flows sit centred inside their node (nodes can be taller than their flows via minH).
  const outTot = {}, inTot = {}
  for (const l of g.links) { outTot[l.s] = (outTot[l.s] || 0) + l.value * k; inTot[l.t] = (inTot[l.t] || 0) + l.value * k }
  for (const id in pos) { const p = pos[id]; p.outOff = (p.h - (outTot[id] || 0)) / 2; p.inOff = (p.h - (inTot[id] || 0)) / 2 }
  const orderOf = (id) => g.nodes.findIndex(n => n.id === id)
  const links = [...g.links]
    .sort((a, b) => orderOf(a.s) - orderOf(b.s) || orderOf(a.t) - orderOf(b.t))
    .map(l => {
      const s = pos[l.s], t = pos[l.t], w = l.value * k
      const y0 = s.y + s.outOff; s.outOff += w
      return { ...l, w, x0: s.x + s.w, y0, x1: t.x }
    })
  // incoming offsets ordered by source position
  const incoming = [...links].sort((a, b) => orderOf(a.t) - orderOf(b.t) || orderOf(a.s) - orderOf(b.s))
  for (const l of incoming) { const t = pos[l.t]; l.y1 = t.y + t.inOff; t.inOff += l.w }
  return { pos, links, height: Math.max(H, maxY), nodeW }
}

export default function WalkinSankey({ t, isMobile, cells, jarvis }) {
  const wrapRef = useRef(null)
  const [W, setW] = useState(0)
  const [p, setP] = useState(0)
  const [hover, setHover] = useState(null)   // { key, x, y, text }
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const g = useMemo(() => buildGraph(cells || [], jarvis), [cells, jarvis])
  const sig = g.nodes.map(n => `${n.id}:${Math.round(n.value)}`).join('|')

  // Replay the reveal whenever the numbers change.
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setP(1); return }
    let raf, start
    setP(0)
    const tick = (ts) => {
      if (!start) start = ts
      const v = Math.min(1, (ts - start) / 1600)
      setP(v)
      if (v < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sig])

  const H = isMobile ? 250 : 300
  const L = W > 0 && g.nodes.length ? layout(g, W, H, isMobile) : null

  const C = {
    base: ['#4a5d95', '#26345e'],
    ext: [t.text4 || '#8a8a8a', t.text3 || '#6a6a6a'],
    ts: [t.blue || '#3a8fbf', '#22607f'],
    dw: [t.gold || '#c9a84c', '#9b7d2e'],
    drop: [t.red || '#e05555', '#a83a3a'],
  }
  const kindOf = Object.fromEntries(g.nodes.map(n => [n.id, n.kind]))
  const pctOf = (n) => {
    if (n.id === 'noOtp') return g.J ? n.value / g.J : null
    if (n.id === 'tsWalk' || n.id === 'tsNoShow') return g.OTS ? n.value / g.OTS : null
    if (n.id === 'dwWalk' || n.id === 'dwDrop') return g.ODW ? n.value / g.ODW : null
    if ((n.id === 'tsOtp' || n.id === 'dwOtp') && g.J) return n.value / g.J
    return null
  }
  const label = (n) => (isMobile ? n.short : n.label)
  const linkP = ease((p - 0.12) / 0.88)
  const colP = (c) => ease((p - c * 0.16) / 0.45)
  const showTip = (e, key, text) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    setHover({ key, x: e.clientX - r.left, y: e.clientY - r.top, text })
  }
  const nameOf = (id) => g.nodes.find(n => n.id === id)?.label || id

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: isMobile ? '14px 10px' : '18px 18px', marginBottom: 12, boxSizing: 'border-box', overflow: 'hidden' }}
      onMouseLeave={() => setHover(null)}>
      {L && (
        <svg width="100%" height={L.height} viewBox={`0 0 ${W} ${L.height}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <clipPath id={`rv${uid}`}><rect x="0" y="-10" width={(W) * linkP} height={L.height + 20} /></clipPath>
            {L.links.map((l, i) => {
              const a = C[kindOf[l.s]] || C.base, b = C[kindOf[l.t]] || C.base
              return (
                <linearGradient key={i} id={`lg${uid}${i}`} gradientUnits="userSpaceOnUse" x1={l.x0} x2={l.x1} y1="0" y2="0">
                  <stop offset="0%" stopColor={a[0]} />
                  <stop offset="100%" stopColor={b[0]} />
                </linearGradient>
              )
            })}
            {Object.entries(C).map(([k, [c0, c1]]) => (
              <linearGradient key={k} id={`ng${uid}${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c0} />
                <stop offset="100%" stopColor={c1} />
              </linearGradient>
            ))}
            <filter id={`sh${uid}`} x="-20%" y="-20%" width="140%" height="160%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* Ribbons */}
          <g clipPath={`url(#rv${uid})`}>
            {L.links.map((l, i) => {
              const xm = (l.x0 + l.x1) / 2
              const d = `M${l.x0},${l.y0} C${xm},${l.y0} ${xm},${l.y1} ${l.x1},${l.y1} L${l.x1},${l.y1 + l.w} C${xm},${l.y1 + l.w} ${xm},${l.y0 + l.w} ${l.x0},${l.y0 + l.w} Z`
              const key = `${l.s}>${l.t}`
              const active = hover?.key === key
              const dim = hover && !active && !hover.key.includes(l.s) && !hover.key.includes(l.t)
              const drop = kindOf[l.t] === 'drop'
              return (
                <path key={key} d={d} fill={`url(#lg${uid}${i})`}
                  style={{ opacity: active ? 0.78 : dim ? 0.12 : (drop ? 0.38 : 0.42), transition: 'opacity .25s ease', cursor: 'pointer' }}
                  onMouseMove={e => showTip(e, key, `${nameOf(l.s)} → ${nameOf(l.t)}: ${fmtN(l.value)}`)}
                  onClick={e => showTip(e, key, `${nameOf(l.s)} → ${nameOf(l.t)}: ${fmtN(l.value)}`)} />
              )
            })}
          </g>

          {/* Nodes */}
          {g.nodes.map(n => {
            const ps = L.pos[n.id], cp = colP(n.col)
            const pc = pctOf(n)
            const big = ps.h >= (isMobile ? 34 : 38)
            const fs1 = isMobile ? 9.5 : 11.5, fs2 = isMobile ? 12 : 15
            const ink = inkFor((C[n.kind] || C.base)[1])
            const cx = ps.x + ps.w / 2, cy = ps.y + ps.h / 2
            const key = `node:${n.id}`
            return (
              <g key={n.id} style={{ opacity: cp, transform: `translate(${cx}px,${cy}px) scale(${0.6 + 0.4 * cp},${cp}) translate(${-cx}px,${-cy}px)`, cursor: 'pointer' }}
                onMouseMove={e => showTip(e, key, `${n.label}: ${fmtN(n.value)}${pc != null ? ` (${fmtP(pc)})` : ''}`)}
                onClick={e => showTip(e, key, `${n.label}: ${fmtN(n.value)}${pc != null ? ` (${fmtP(pc)})` : ''}`)}>
                <rect x={ps.x} y={ps.y} width={ps.w} height={ps.h} rx="7"
                  fill={n.kind === 'ext' ? 'transparent' : `url(#ng${uid}${n.kind})`}
                  stroke={n.kind === 'ext' ? (t.text4 || '#888') : 'rgba(255,255,255,.08)'} strokeDasharray={n.kind === 'ext' ? '4 3' : undefined}
                  filter={n.kind === 'ext' ? undefined : `url(#sh${uid})`} />
                {big ? (
                  <>
                    <text x={cx} y={cy - (isMobile ? 4 : 5)} textAnchor="middle" fontSize={fs1} fontWeight="600" fill={n.kind === 'ext' ? (t.text3 || '#777') : ink} style={{ opacity: 0.92 }}>{label(n)}</text>
                    <text x={cx} y={cy + (isMobile ? 11 : 14)} textAnchor="middle" fontSize={fs2} fontWeight="800" fill={n.kind === 'ext' ? (t.text2 || '#555') : ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtN(n.value * ease(p / 0.85))}{pc != null && !isMobile ? <tspan fontSize={fs1} fontWeight="600" dx="4" style={{ opacity: 0.85 }}>{fmtP(pc)}</tspan> : null}
                    </text>
                  </>
                ) : (
                  <text x={cx} y={cy + 4} textAnchor="middle" fontSize={fs1} fontWeight="700" fill={n.kind === 'ext' ? (t.text3 || '#777') : ink}>
                    {label(n)} · {fmtN(n.value * ease(p / 0.85))}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hover && (
        <div style={{ position: 'absolute', left: Math.min(hover.x + 12, (W || 300) - 190), top: Math.max(4, hover.y - 38), pointerEvents: 'none', background: t.card2 || '#111', color: t.text1, border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,.25)', whiteSpace: 'nowrap', zIndex: 2 }}>
          {hover.text}
        </div>
      )}
    </div>
  )
}
