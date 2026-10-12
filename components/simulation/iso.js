'use client'

// Isometric projection + SVG primitives for the ops simulation scene.
// World units are grid cells: +x runs down-right on screen, +y down-left, +z up.
// Only the top, +x and +y faces of a box are ever visible from this camera.

export const S  = 30
export const CW = S * Math.cos(Math.PI / 6)
export const CH = S / 2
export const CZ = S * 0.95

export function P(x, y, z = 0) {
  return [(x - y) * CW, (x + y) * CH - z * CZ]
}

export function poly(pts) {
  return pts.map(([x, y, z = 0]) => {
    const [a, b] = P(x, y, z)
    return a.toFixed(1) + ',' + b.toFixed(1)
  }).join(' ')
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)))
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`
}

export function Box({ x, y, z = 0, w, d, h, c, top, left, right, opacity, stroke }) {
  const sw = stroke ? 0.6 : 0
  return (
    <g opacity={opacity}>
      <polygon points={poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} fill={right || shade(c, -0.22)} stroke={stroke} strokeWidth={sw} />
      <polygon points={poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={left || shade(c, -0.08)} stroke={stroke} strokeWidth={sw} />
      <polygon points={poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={top || c} stroke={stroke} strokeWidth={sw} />
    </g>
  )
}

export function Quad({ x, y, w, d, z = 0, fill, opacity, stroke, strokeWidth = 1, dash }) {
  return (
    <polygon
      points={poly([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]])}
      fill={fill} opacity={opacity} stroke={stroke} strokeWidth={stroke ? strokeWidth : 0} strokeDasharray={dash}
    />
  )
}

// Rectangle painted on a vertical face. face 'y' = plane y=at spanning x a0..a1;
// face 'x' = plane x=at spanning y a0..a1.
export function FaceQuad({ face, at, a0, a1, z0, z1, fill, opacity, className }) {
  const pts = face === 'y'
    ? [[a0, at, z0], [a1, at, z0], [a1, at, z1], [a0, at, z1]]
    : [[at, a0, z0], [at, a1, z0], [at, a1, z1], [at, a0, z1]]
  return <polygon points={poly(pts)} fill={fill} opacity={opacity} className={className} />
}

// Group whose local 2D axes lie on a vertical face (u along the face, v down).
// For face 'x' the start point should be the end with the larger y (left on screen).
export function faceMatrix(face, x, y, z) {
  const [sx, sy] = P(x, y, z)
  return face === 'y'
    ? `matrix(${CW / S},${CH / S},0,1,${sx.toFixed(1)},${sy.toFixed(1)})`
    : `matrix(${CW / S},${-CH / S},0,1,${sx.toFixed(1)},${sy.toFixed(1)})`
}

export function FaceText({ face, x, y, z, children, size = 12, fill, weight = 800, spacing, anchor = 'start' }) {
  return (
    <text transform={faceMatrix(face, x, y, z)} fontSize={size} fontWeight={weight} fill={fill}
      letterSpacing={spacing} textAnchor={anchor} style={{ pointerEvents: 'none' }}>
      {children}
    </text>
  )
}

export function Shadow({ x, y, w, d, fill }) {
  return <Quad x={x + 0.15} y={y + 0.22} w={w} d={d} fill={fill} />
}

export function Tree({ x, y, pal, s = 1 }) {
  const [bx, by] = P(x, y, 0)
  const [tx, ty] = P(x, y, 1.1 * s)
  return (
    <g style={{ pointerEvents: 'none' }}>
      <ellipse cx={bx + 5 * s} cy={by + 2} rx={13 * s} ry={5.5 * s} fill={pal.shadow} />
      <line x1={bx} y1={by} x2={tx} y2={ty} stroke={pal.trunk} strokeWidth={4 * s} strokeLinecap="round" />
      <circle cx={tx} cy={ty - 7 * s} r={14 * s} fill={pal.tree} />
      <circle cx={tx - 4 * s} cy={ty - 11 * s} r={8 * s} fill={shade(pal.tree, 0.2)} opacity={0.75} />
    </g>
  )
}

const sortParts = (parts) => parts.sort((a, b) => a.k - b.k).map(p => p.el)

export function GoldBar({ x, y, z = 0, w = 0.62, d = 0.3, h = 0.18 }) {
  return <Box x={x - w / 2} y={y - d / 2} z={z} w={w} d={d} h={h} c="#f2c94c" top="#ffe58f" left="#e0ac2e" right="#b8861f" />
}

// A consignment lot: a pallet of sealed parcels, or (after melting) a gold bar.
export function PalletLoad({ x, y, z = 0, pal, bills = 4, form = 'pallet' }) {
  if (form === 'bar') {
    return (
      <g>
        <GoldBar x={x} y={y} z={z} />
        <GoldBar x={x} y={y} z={z + 0.18} w={0.5} d={0.24} h={0.14} />
      </g>
    )
  }
  const n = Math.max(1, Math.min(8, Math.ceil(bills / 2)))
  const spots = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]
  const parts = [{ k: -1, el: <Box key="p" x={x - 0.42} y={y - 0.42} z={z} w={0.84} d={0.84} h={0.1} c={pal.pallet} /> }]
  for (let i = 0; i < n; i++) {
    const [dx, dy] = spots[i % 4]
    const layer = Math.floor(i / 4)
    parts.push({
      k: layer * 10 + dx + dy,
      el: <Box key={i} x={x + dx - 0.18} y={y + dy - 0.18} z={z + 0.1 + layer * 0.36} w={0.36} d={0.36} h={0.36} c={pal.cardboard} top={shade(pal.cardboard, 0.15)} />,
    })
  }
  return <g>{sortParts(parts)}</g>
}

const DIR = { 'x+': [1, 0], 'x-': [-1, 0], 'y+': [0, 1], 'y-': [0, -1] }

export function Truck({ x, y, heading = 'x+', pal }) {
  const L = 1.2, F = 0.45, C0 = 0.5, C1 = 1.2, W = 0.5
  const alongX = heading[0] === 'x'
  const fwd = heading[1] === '+'
  let cont, cab
  if (alongX) {
    cont = fwd ? { x: x - L, y: y - W, w: L + F, d: 2 * W } : { x: x - F, y: y - W, w: L + F, d: 2 * W }
    cab  = fwd ? { x: x + C0, y: y - W + 0.05, w: C1 - C0, d: 2 * W - 0.1 } : { x: x - C1, y: y - W + 0.05, w: C1 - C0, d: 2 * W - 0.1 }
  } else {
    cont = fwd ? { x: x - W, y: y - L, w: 2 * W, d: L + F } : { x: x - W, y: y - F, w: 2 * W, d: L + F }
    cab  = fwd ? { x: x - W + 0.05, y: y + C0, w: 2 * W - 0.1, d: C1 - C0 } : { x: x - W + 0.05, y: y - C1, w: 2 * W - 0.1, d: C1 - C0 }
  }
  const all = alongX
    ? { x: Math.min(cont.x, cab.x), y: y - W, w: L + C1, d: 2 * W }
    : { x: x - W, y: Math.min(cont.y, cab.y), w: 2 * W, d: L + C1 }
  const contEl = (
    <g key="cont">
      <Box {...cont} z={0.32} h={1.13} c={pal.truckBody} />
      {alongX ? (
        <>
          <FaceQuad face="y" at={cont.y + cont.d} a0={cont.x + 0.05} a1={cont.x + cont.w - 0.05} z0={0.45} z1={0.6} fill={pal.gold} />
          <FaceText face="y" x={cont.x + 0.18} y={cont.y + cont.d} z={0.95} size={7.5} fill={pal.truckCab} spacing={0.6}>WHITE GOLD</FaceText>
        </>
      ) : (
        <>
          <FaceQuad face="x" at={cont.x + cont.w} a0={cont.y + 0.05} a1={cont.y + cont.d - 0.05} z0={0.45} z1={0.6} fill={pal.gold} />
          <FaceText face="x" x={cont.x + cont.w} y={cont.y + cont.d - 0.18} z={0.95} size={7.5} fill={pal.truckCab} spacing={0.6}>WHITE GOLD</FaceText>
        </>
      )}
    </g>
  )
  const cabEl = (
    <g key="cab">
      <Box {...cab} z={0.32} h={0.88} c={pal.truckCab} />
      {heading === 'x+' && <FaceQuad face="x" at={cab.x + cab.w} a0={cab.y + 0.1} a1={cab.y + cab.d - 0.1} z0={0.78} z1={1.1} fill={pal.glass} />}
      {heading === 'y+' && <FaceQuad face="y" at={cab.y + cab.d} a0={cab.x + 0.1} a1={cab.x + cab.w - 0.1} z0={0.78} z1={1.1} fill={pal.glass} />}
      {alongX && <FaceQuad face="y" at={cab.y + cab.d} a0={cab.x + 0.12} a1={cab.x + cab.w - 0.25} z0={0.78} z1={1.08} fill={pal.glass} />}
      {!alongX && <FaceQuad face="x" at={cab.x + cab.w} a0={cab.y + 0.12} a1={cab.y + cab.d - 0.25} z0={0.78} z1={1.08} fill={pal.glass} />}
    </g>
  )
  const cabFirst = !fwd
  const wheelSpots = alongX
    ? [all.x + 0.4, all.x + all.w - 0.45].map(a => faceMatrix('y', a, y + W, 0.2))
    : [all.y + all.d - 0.4, all.y + 0.45].map(a => faceMatrix('x', x + W, a, 0.2))
  return (
    <g>
      <Shadow x={all.x} y={all.y} w={all.w} d={all.d} fill={pal.shadow} />
      <Box x={all.x + 0.1} y={all.y + 0.05} z={0.12} w={all.w - 0.2} d={all.d - 0.1} h={0.22} c="#3a4150" />
      {cabFirst ? [cabEl, contEl] : [contEl, cabEl]}
      {wheelSpots.map((m, i) => (
        <g key={i} transform={m}>
          <circle r={6.2} fill="#1d2330" />
          <circle r={2.4} fill="#9aa3b2" />
        </g>
      ))}
    </g>
  )
}

export function Forklift({ x, y, heading = 'x+', pal, load }) {
  const [dx, dy] = DIR[heading]
  const parts = []
  parts.push({ k: x + y - 0.01, el: <Shadow key="s" x={x - 0.4} y={y - 0.4} w={0.8} d={0.8} fill={pal.shadow} /> })
  parts.push({ k: x + y, el: <Box key="b" x={x - 0.38} y={y - 0.38} z={0.05} w={0.76} d={0.76} h={0.5} c={pal.forklift} /> })
  parts.push({ k: x + y + 0.02, el: <Box key="seat" x={x - 0.18 - dx * 0.08} y={y - 0.18 - dy * 0.08} z={0.55} w={0.36} d={0.36} h={0.22} c="#2b3240" /> })
  // roof posts + canopy
  for (const [px, py] of [[-0.32, -0.32], [0.26, -0.32], [-0.32, 0.26], [0.26, 0.26]]) {
    parts.push({ k: x + y + px + py + 0.03, el: <Box key={'p' + px + py} x={x + px} y={y + py} z={0.55} w={0.06} d={0.06} h={0.55} c="#2b3240" /> })
  }
  parts.push({ k: x + y + 0.9, el: <Box key="roof" x={x - 0.36} y={y - 0.36} z={1.1} w={0.72} d={0.72} h={0.06} c={shade(pal.forklift, -0.15)} /> })
  // mast at the front
  const mx = x + dx * 0.42, my = y + dy * 0.42
  const mast = dx !== 0
    ? { x: mx - 0.04, y: my - 0.3, w: 0.08, d: 0.6 }
    : { x: mx - 0.3, y: my - 0.04, w: 0.6, d: 0.08 }
  parts.push({ k: mx + my, el: <Box key="m" {...mast} z={0.05} h={1.3} c="#4a5262" /> })
  if (load) {
    const lx = x + dx * 0.95, ly = y + dy * 0.95
    parts.push({ k: lx + ly, el: <g key="load">{load(lx, ly, 0.15)}</g> })
  }
  return <g>{sortParts(parts)}</g>
}

export function Pin({ x, y, z, color, label }) {
  const [sx, sy] = P(x, y, z)
  return (
    <g transform={`translate(${sx.toFixed(1)},${sy.toFixed(1)})`} style={{ pointerEvents: 'none' }}>
      <g className="sim-bob">
        <path d="M0,0 C-6,-9 -12,-15 -12,-23 A12,12 0 1 1 12,-23 C12,-15 6,-9 0,0Z" fill={color} stroke="#fff" strokeWidth={1.5} />
        <circle cx={0} cy={-23} r={label ? 8.5 : 4.8} fill="#fff" />
        {label && <text x={0} y={-20} fontSize={label.length > 2 ? 6.5 : 8.5} fontWeight={900} textAnchor="middle" fill={color}>{label}</text>}
      </g>
    </g>
  )
}

export function Label({ x, y, z, text, sub, bg, fg, subBg, subFg, size = 10.5, onClick, strong }) {
  const [sx, sy] = P(x, y, z)
  const w = text.length * size * 0.6 + 14
  const sw = sub ? String(sub).length * 9 * 0.62 + 10 : 0
  const total = w + (sub ? sw + 3 : 0)
  return (
    <g transform={`translate(${(sx - total / 2).toFixed(1)},${(sy - 10).toFixed(1)})`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <rect width={w} height={19} rx={9.5} fill={bg} stroke={strong ? fg : 'rgba(0,0,0,.08)'} strokeWidth={strong ? 1.2 : 1} />
      <text x={w / 2} y={13} fontSize={size} fontWeight={800} textAnchor="middle" fill={fg} letterSpacing={0.3}>{text}</text>
      {sub != null && (
        <g transform={`translate(${w + 3},1.5)`}>
          <rect width={sw} height={16} rx={8} fill={subBg} />
          <text x={sw / 2} y={11.5} fontSize={9} fontWeight={800} textAnchor="middle" fill={subFg}>{sub}</text>
        </g>
      )}
    </g>
  )
}
