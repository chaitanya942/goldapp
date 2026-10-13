'use client'

// Head Office yard — animated replay of today's real consignments to HO.
// On open it plays the day back (first dispatch → now) and then stays live:
//   • trucks appear at their dispatch time and drive the inbound highway;
//     received ones reach the gate in time to dock at their real received_at,
//     others travel at the branch's delivery TAT (estimate — no GPS)
//   • at the gate a truck takes a free dock bay, unloads (forklift shuttles
//     pallets to HO inventory), then leaves
//   • HO inventory grows at the real received_at of each bill

import { useEffect, useMemo, useRef, useState } from 'react'
import { P, Box, Quad, FaceQuad, FaceText, Shadow, Tree, Truck, Forklift, PalletLoad, Label } from './iso'
import { fmtN, fmtG } from './simData'

export const YARD_PALETTES = {
  light: {
    sky: '#e7edf5', ground: '#dce4ee', grass: '#cfe2c4', grassEdge: '#bdd6af', road: '#c3cddb', lane: '#ffffff',
    yard: '#e9eef5', bayLine: '#f0b429', wall: '#f6f8fc', trim: '#3b6cf6', roof: '#edf1f7',
    glass: '#8fb8ea', door: '#2c4a80', cardboard: '#d29e62', pallet: '#b88a52', truckBody: '#fbfcfe', truckCab: '#2f62e0',
    forklift: '#f4b52c', tree: '#5aa866', trunk: '#8a6a4a', gold: '#e2b23a', shadow: 'rgba(30,45,70,.16)',
    text: '#1d2a3d', label: 'rgba(255,255,255,.96)', muted: '#6b7689', blue: '#2f62e0', green: '#1f9254', ring: '#2f62e0', puff: '#9aa6b8',
  },
  dark: {
    sky: '#0d1219', ground: '#131a23', grass: '#15241a', grassEdge: '#1b2e21', road: '#222b37', lane: '#55627a',
    yard: '#18202b', bayLine: '#c9a84c', wall: '#2b3443', trim: '#c9a84c', roof: '#262f3d',
    glass: '#3c6595', door: '#111827', cardboard: '#a8763e', pallet: '#7a5a36', truckBody: '#dfe4ec', truckCab: '#3a6fd8',
    forklift: '#d8a024', tree: '#2e6a3b', trunk: '#5a4630', gold: '#e0b84a', shadow: 'rgba(0,0,0,.38)',
    text: '#e9edf3', label: 'rgba(24,30,40,.94)', muted: '#9aa6b8', blue: '#6d9dff', green: '#4cc283', ring: '#6d9dff', puff: '#6b7689',
  },
}

const HO = { x0: 22, x1: 35, y0: 3.5, y1: 10, h: 3.4 }
const BAYS_X = [24.6, 28.2, 31.8]
const BAY_Y = 11.4
const LANES_Y = [13.4, 14.8, 16.2]
const ROAD_X0 = -12, ROAD_X1 = 21, EXIT_X = 44
const INV = { x0: 22, y0: 14.6, cols: 10, rows: 3 }
const FORK_HOME = { x: 21.2, y: 13.0 }
const TREES = [[-9, 10, 1], [-2, 9.6, 0.9], [5, 10.2, 1.1], [12, 9.8, 0.9], [18, 10.4, 1], [-7, 19.6, 1], [1, 19.8, 1.1], [9, 19.4, 0.9], [16, 19.8, 1], [38, 6, 1], [40, 18.5, 0.9], [19, 4, 1]]

const MIN = 60e3
const DOCK_LEG = 15 * MIN, UNLOAD = 40 * MIN, LEAVE = 15 * MIN
const REPLAY_MS = 15000

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const lerp = (a, b, f) => a + (b - a) * f
const short = (s, n = 14) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const istClock = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })

// Walk a polyline of {x,y,h} points by fraction f; heading comes from the leg.
function along(points, f) {
  const legs = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    legs.push(d); total += d
  }
  let dist = clamp01(f) * total
  for (let i = 0; i < legs.length; i++) {
    if (dist <= legs[i] || i === legs.length - 1) {
      const g = legs[i] ? Math.min(1, dist / legs[i]) : 1
      return { x: lerp(points[i].x, points[i + 1].x, g), y: lerp(points[i].y, points[i + 1].y, g), heading: points[i + 1].h }
    }
    dist -= legs[i]
  }
  return { x: points[0].x, y: points[0].y, heading: points[0].h }
}

// Fix the timeline of every consignment to HO: dispatch, gate, dock bay, unload, leave.
function buildSchedule(consignments) {
  const toHo = consignments.filter(c => c.type === 'EXTERNAL')
  const bayFree = BAYS_X.map(() => 0)
  return toHo
    .map((c, i) => ({ c, lane: i % LANES_Y.length, disp: new Date(c.dispatched_at).getTime(), recv: c.received_at ? new Date(c.received_at).getTime() : null, tat: (c.tat_hours || 24) * 3600e3 }))
    .sort((a, b) => (a.recv ?? Infinity) - (b.recv ?? Infinity))
    .map(s => {
      if (s.recv == null) return s
      const bay = bayFree.indexOf(Math.min(...bayFree))
      const dockAt = Math.max(s.recv, bayFree[bay])
      bayFree[bay] = dockAt + UNLOAD + LEAVE / 2
      return { ...s, bay, gateAt: Math.max(s.disp, s.recv - DOCK_LEG), dockAt, unloadEnd: dockAt + UNLOAD, goneAt: dockAt + UNLOAD + LEAVE }
    })
}

const roadX = (p) => ROAD_X0 + 1 + p * (ROAD_X1 - ROAD_X0 - 1.5)

// Where each truck is at sim time T.
function truckAt(s, T) {
  if (T < s.disp) return null
  const laneY = LANES_Y[s.lane]
  if (s.recv == null) {
    const p = Math.min(0.94, (T - s.disp) / s.tat)
    return { x: roadX(p), y: laneY, heading: 'x+', phase: 'road', moving: p < 0.94 }
  }
  if (T < s.gateAt) {
    const p = clamp01((T - s.disp) / Math.max(1, s.gateAt - s.disp))
    return { x: roadX(p), y: laneY, heading: 'x+', phase: 'road', moving: true }
  }
  const bx = BAYS_X[s.bay]
  if (T < s.dockAt) {
    const f = (T - s.gateAt) / Math.max(1, s.dockAt - s.gateAt)
    return { ...along([{ x: roadX(1), y: laneY, h: 'x+' }, { x: bx, y: laneY, h: 'x+' }, { x: bx, y: BAY_Y, h: 'y-' }], f), phase: 'docking', moving: true }
  }
  if (T < s.unloadEnd) return { x: bx, y: BAY_Y, heading: 'y-', phase: 'unloading', moving: false }
  if (T < s.goneAt) {
    const f = (T - s.unloadEnd) / LEAVE
    const pos = along([{ x: bx, y: BAY_Y, h: 'y-' }, { x: bx, y: LANES_Y[0], h: 'y-' }, { x: EXIT_X, y: LANES_Y[0], h: 'x+' }], f)
    return { ...pos, phase: 'leaving', moving: true }
  }
  return null
}

function bounds() {
  const pts = [[ROAD_X0, 9], [ROAD_X0, 20], [HO.x1 + 4, HO.y0 - 1], [HO.x1 + 4, 20], [HO.x0, HO.y0 - 2]]
  const xs = pts.map(([x, y]) => P(x, y, 0)[0]), ys = pts.map(([x, y]) => P(x, y, 0)[1])
  return { x: Math.min(...xs) - 30, y: Math.min(...ys) - 150, w: Math.max(...xs) - Math.min(...xs) + 60, h: Math.max(...ys) - Math.min(...ys) + 190 }
}

export default function HoYard({ data, dark, selected, onSelect, t }) {
  const pal = YARD_PALETTES[dark ? 'dark' : 'light']
  const vb = useMemo(bounds, [])
  const schedule = useMemo(() => buildSchedule(data?.consignments || []), [data])
  const arrivals = useMemo(() => (data?.hoToday?.arrivals || []).map(a => ({ ...a, ms: new Date(a.at).getTime() })), [data])

  // Replay window: a little before the first event today → now.
  const startT = useMemo(() => {
    const dayStart = data?.dayStart ? new Date(data.dayStart).getTime() : Date.now() - 12 * 3600e3
    const events = [...schedule.map(s => s.disp), ...arrivals.map(a => a.ms)].filter(ms => ms >= dayStart)
    return events.length ? Math.max(dayStart, Math.min(...events) - 30 * MIN) : Date.now() - 3 * 3600e3
  }, [schedule, arrivals, data])

  const [simT, setSimT] = useState(startT)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [anim, setAnim] = useState(0)
  const simRef = useRef(startT)
  const playRef = useRef(true)
  const speedRef = useRef(1)
  const startRef = useRef(startT)
  playRef.current = playing
  speedRef.current = speed

  // Replay window moved by more than a minute (e.g. a new day) → restart replay.
  // Routine 60s data refreshes keep the current position.
  useEffect(() => {
    if (Math.abs(startRef.current - startT) < 60e3) return
    startRef.current = startT
    simRef.current = startT
    setSimT(startT)
    setPlaying(true)
  }, [startT])

  useEffect(() => {
    let raf, last = performance.now()
    const loop = (now) => {
      const dt = Math.min(100, now - last)
      last = now
      const wall = Date.now()
      if (playRef.current) {
        const span = Math.max(60e3, wall - startRef.current)
        simRef.current = Math.min(wall, simRef.current + dt * (span / REPLAY_MS) * speedRef.current)
        if (simRef.current >= wall) setPlaying(false)
      } else if (simRef.current >= wall - 2000) {
        simRef.current = wall   // live: follow the real clock
      }
      setSimT(simRef.current)
      setAnim(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const wallNow = Date.now()
  const live = !playing && simT >= wallNow - 2000
  const scrub = (v) => { simRef.current = Number(v); setSimT(Number(v)); setPlaying(false) }
  const replay = () => { simRef.current = startRef.current; setSimT(startRef.current); setPlaying(true) }
  const goLive = () => { simRef.current = Date.now(); setPlaying(false) }

  // ── world state at simT ────────────────────────────────────────────────
  const trucks = schedule.map(s => ({ s, pos: truckAt(s, simT) })).filter(x => x.pos)
  // Keep road trucks ≥2.9 apart per lane (recent dispatches otherwise bunch
  // at the start of the highway); trucks are nudged forward, never past the gate.
  for (let lane = 0; lane < LANES_Y.length; lane++) {
    let prev = -Infinity
    for (const tr of trucks.filter(x => x.pos.phase === 'road' && x.s.lane === lane).sort((a, b) => a.pos.x - b.pos.x)) {
      tr.pos = { ...tr.pos, x: Math.min(roadX(1), Math.max(tr.pos.x, prev + 2.9)) }
      prev = tr.pos.x
    }
  }
  const onRoad = trucks.filter(x => x.pos.phase === 'road').length
  const atDocks = trucks.filter(x => x.pos.phase === 'docking' || x.pos.phase === 'unloading').length
  let invBills = 0, invNet = 0
  for (const a of arrivals) if (a.ms <= simT) { invBills += a.bills; invNet += a.net }
  const pallets = Math.min(INV.cols * INV.rows, Math.ceil(invBills / 2))
  const unloadingBays = trucks.filter(x => x.pos.phase === 'unloading').map(x => x.s.bay)
  const sel = (c) => selected?.type === 'cons' && selected.id === c.id

  const objects = []
  objects.push({ k: 28.5 + 6.75, el: (
    <g key="ho" onClick={() => onSelect({ type: 'ho' })} style={{ cursor: 'pointer' }}>
      <Shadow x={HO.x0} y={HO.y0} w={HO.x1 - HO.x0} d={HO.y1 - HO.y0} fill={pal.shadow} />
      <Box x={HO.x0} y={HO.y0} w={HO.x1 - HO.x0} d={HO.y1 - HO.y0} h={HO.h} c={pal.wall} top={pal.roof} />
      {[0, 1, 2].map(i => <Box key={i} x={HO.x0 + 0.6} y={HO.y0 + 0.9 + i * 2} z={HO.h} w={HO.x1 - HO.x0 - 1.2} d={0.55} h={0.35} c={pal.glass} />)}
      <FaceQuad face="y" at={HO.y1} a0={HO.x0} a1={HO.x1} z0={HO.h - 0.4} z1={HO.h - 0.2} fill={pal.gold} />
      <FaceQuad face="x" at={HO.x1} a0={HO.y0} a1={HO.y1} z0={HO.h - 0.4} z1={HO.h - 0.2} fill={pal.gold} />
      {BAYS_X.map((bx, i) => (
        <g key={i}>
          <FaceQuad face="y" at={HO.y1} a0={bx - 0.78} a1={bx + 0.78} z0={0} z1={1.75} fill={pal.trim} />
          <FaceQuad face="y" at={HO.y1} a0={bx - 0.62} a1={bx + 0.62} z0={0} z1={1.6} fill={unloadingBays.includes(i) ? pal.gold : pal.door} />
          <FaceText face="y" x={bx - 0.2} y={HO.y1} z={2.05} size={9} fill={pal.trim}>{`D${i + 1}`}</FaceText>
        </g>
      ))}
      <FaceText face="y" x={HO.x0 + 0.5} y={HO.y1} z={2.55} size={15} fill={pal.text} spacing={1.5}>WHITE GOLD · HEAD OFFICE</FaceText>
      {[4.6, 6.4, 8.2].map(yy => <FaceQuad key={yy} face="x" at={HO.x1} a0={yy - 0.5} a1={yy + 0.5} z0={1.2} z1={2.2} fill={pal.glass} />)}
    </g>
  ) })
  for (const [x, y, s] of TREES) objects.push({ k: x + y, el: <Tree key={`t${x}-${y}`} x={x} y={y} s={s} pal={pal} /> })

  for (let i = 0; i < pallets; i++) {
    const col = i % INV.cols, row = Math.floor(i / INV.cols)
    const x = INV.x0 + 0.6 + col * 1.2, y = INV.y0 + 0.6 + row * 1.15
    objects.push({ k: x + y, el: <g key={`inv${i}`} className="sim-pop" onClick={() => onSelect({ type: 'ho' })} style={{ cursor: 'pointer' }}><PalletLoad x={x} y={y} pal={pal} bills={4} /></g> })
  }

  // Forklift: shuttles bay pad ↔ inventory while any truck is unloading (real-time ping-pong).
  if (unloadingBays.length) {
    const cycle = Math.floor(anim / 6000)
    const bay = unloadingBays[cycle % unloadingBays.length]
    const pad = { x: BAYS_X[bay] + 1.4, y: 12.6 }
    const inv = { x: INV.x0 + 1 + (cycle % INV.cols) * 1.2, y: INV.y0 - 0.2 }
    const ph = (anim % 6000) / 6000
    const toInv = ph < 0.5
    const f = toInv ? ph * 2 : (ph - 0.5) * 2
    const pos = toInv
      ? along([{ ...pad, h: 'y+' }, { x: pad.x, y: inv.y - 1, h: 'y+' }, { x: inv.x, y: inv.y - 1, h: inv.x > pad.x ? 'x+' : 'x-' }], f)
      : along([{ x: inv.x, y: inv.y - 1, h: 'y-' }, { x: pad.x, y: inv.y - 1, h: pad.x > inv.x ? 'x+' : 'x-' }, { ...pad, h: 'y-' }], f)
    objects.push({ k: pos.x + pos.y + 0.02, el: <Forklift key="fork" x={pos.x} y={pos.y} heading={pos.heading} pal={pal} load={toInv ? (lx, ly, lz) => <PalletLoad x={lx} y={ly} z={lz} pal={pal} bills={4} /> : null} /> })
  } else {
    objects.push({ k: FORK_HOME.x + FORK_HOME.y, el: <Forklift key="fork" x={FORK_HOME.x} y={FORK_HOME.y} heading="x+" pal={pal} /> })
  }

  const puffs = []
  for (const { s, pos } of trucks) {
    objects.push({ k: pos.x + pos.y + 0.01, el: <g key={`tr${s.c.id}`} className={pos.moving ? 'sim-drive' : undefined} onClick={() => onSelect({ type: 'cons', id: s.c.id })} style={{ cursor: 'pointer' }}><title>{`${s.c.from} · ${s.c.bills} bills · ${fmtG(s.c.net)}`}</title><Truck x={pos.x} y={pos.y} heading={pos.heading} pal={pal} /></g> })
    if (pos.moving && (playing || pos.phase !== 'road')) {
      const back = pos.heading === 'x+' ? [pos.x - 1.4, pos.y] : pos.heading === 'x-' ? [pos.x + 1.4, pos.y] : pos.heading === 'y-' ? [pos.x, pos.y + 1.4] : [pos.x, pos.y - 1.4]
      const [px, py] = P(back[0], back[1], 0.35)
      for (let i = 0; i < 3; i++) puffs.push(<circle key={`pf${s.c.id}${i}`} cx={px} cy={py} r={4} fill={pal.puff} className="sim-puff" style={{ animationDelay: `${i * 0.3}s` }} />)
    }
  }
  const sorted = objects.sort((a, b) => a.k - b.k).map(o => o.el)

  const ground = [
    <Quad key="g" x={-40} y={-10} w={90} d={40} fill={pal.ground} />,
    <Quad key="gr1" x={ROAD_X0} y={8.6} w={ROAD_X1 - ROAD_X0 - 1} d={3.6} fill={pal.grass} stroke={pal.grassEdge} strokeWidth={1.5} />,
    <Quad key="gr2" x={ROAD_X0} y={17.4} w={ROAD_X1 - ROAD_X0 - 1} d={3.4} fill={pal.grass} stroke={pal.grassEdge} strokeWidth={1.5} />,
    <Quad key="yard" x={HO.x0 - 1} y={HO.y1} w={HO.x1 - HO.x0 + 2} d={8.6} fill={pal.yard} />,
    <Quad key="road" x={ROAD_X0} y={LANES_Y[0] - 0.7} w={EXIT_X - ROAD_X0} d={LANES_Y[2] - LANES_Y[0] + 1.4} fill={pal.road} />,
    ...LANES_Y.slice(0, -1).map((ly, i) => {
      const [a, b] = P(ROAD_X0 + 0.5, ly + 0.7), [c, d] = P(ROAD_X1 - 0.5, ly + 0.7)
      return <line key={`ln${i}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.lane} strokeWidth={1.6} strokeDasharray="9 9" className="sim-lane" opacity={0.85} />
    }),
    ...BAYS_X.map((bx, i) => <Quad key={`bay${i}`} x={bx - 0.72} y={10.05} w={1.44} d={2.75} fill={unloadingBays.includes(i) ? pal.gold : 'none'} opacity={unloadingBays.includes(i) ? 0.35 : 1} stroke={pal.bayLine} strokeWidth={1.6} />),
    <Quad key="inv" x={INV.x0} y={INV.y0} w={INV.cols * 1.2 + 0.2} d={INV.rows * 1.15 + 0.2} fill="none" stroke={pal.gold} strokeWidth={1.4} dash="5 4" />,
  ]

  const labels = []
  for (const { s, pos } of trucks) {
    if (pos.phase === 'leaving') continue
    // On the road: compact bill-count badge (full name on hover / when selected) so a busy convoy stays readable.
    const full = sel(s.c) || pos.phase !== 'road'
    const text = !full ? `${s.c.bills}` : pos.phase === 'road' ? `${short(s.c.from)} · ${s.c.bills} bills` : pos.phase === 'docking' ? `${short(s.c.from)} · arriving` : `${short(s.c.from)} · unloading ${s.c.bills}`
    labels.push(<Label key={`l${s.c.id}`} x={pos.x} y={pos.y} z={full ? 2.4 : 1.9} text={text}
      bg={sel(s.c) ? pal.ring : pos.phase === 'unloading' ? pal.green : pal.label} fg={sel(s.c) || pos.phase === 'unloading' ? '#fff' : pal.text}
      size={12} strong={sel(s.c)} onClick={() => onSelect({ type: 'cons', id: s.c.id })} />)
  }
  labels.push(<Label key="lho" x={28.5} y={6.75} z={4.6} text="HEAD OFFICE" bg={pal.gold} fg="#1a1208" size={15} onClick={() => onSelect({ type: 'ho' })} />)
  labels.push(<Label key="linv" x={INV.x0 + INV.cols * 0.6} y={INV.y0 + INV.rows * 1.15 + 0.6} z={0.2} text={`HO inventory · ${invBills} bills · ${fmtG(Math.round(invNet))}`} bg={pal.label} fg={pal.text} size={13} onClick={() => onSelect({ type: 'ho' })} />)
  if (!trucks.length) labels.push(<Label key="lroad" x={ROAD_X0 + 6} y={LANES_Y[1]} z={1.2} text="No trucks on the road" bg={pal.label} fg={pal.muted} size={12} />)

  const btn = (active) => ({ padding: '5px 10px', borderRadius: 8, border: `1px solid ${active ? t.gold : t.border}`, background: active ? `${t.gold}26` : t.card, color: active ? t.gold : t.text2, fontSize: 12, fontWeight: 700, cursor: 'pointer' })

  return (
    <>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', background: pal.sky }}>
        {ground}
        {sorted}
        {puffs}
        {labels}
      </svg>

      <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: t.card + 'ee', border: `1px solid ${t.border}`, borderRadius: 12, padding: '6px 10px', pointerEvents: 'auto' }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: t.text1, fontVariantNumeric: 'tabular-nums' }}>{istClock(simT)}</span>
          {live
            ? <span style={{ fontSize: 11, fontWeight: 900, color: t.green, background: t.green + '22', padding: '3px 8px', borderRadius: 999 }}>● LIVE</span>
            : <span style={{ fontSize: 11, fontWeight: 800, color: t.gold, background: t.gold + '22', padding: '3px 8px', borderRadius: 999 }}>{playing ? 'REPLAYING TODAY' : 'PAUSED'}</span>}
          <button style={btn(false)} onClick={() => (playing ? setPlaying(false) : simT >= wallNow - 2000 ? replay() : setPlaying(true))}>{playing ? '⏸' : '▶'}</button>
          <button style={btn(false)} onClick={replay} title="Replay today from the start">↺ Replay</button>
          {[1, 2, 4].map(sp => <button key={sp} style={btn(speed === sp)} onClick={() => setSpeed(sp)}>{sp}×</button>)}
          {!live && <button style={btn(false)} onClick={goLive}>Go live</button>}
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: t.card + 'ee', border: `1px solid ${t.border}`, borderRadius: 12, padding: '8px 12px', fontSize: 12, color: t.text2, pointerEvents: 'auto' }}>
          <span>🚚 On road <b style={{ color: t.text1 }}>{onRoad}</b></span>
          <span>🏢 At docks <b style={{ color: t.text1 }}>{atDocks}</b></span>
          <span>📦 HO inventory <b style={{ color: t.text1 }}>{fmtN(invBills)}</b> bills · {fmtG(Math.round(invNet))}</span>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 14, right: 14, bottom: 12, display: 'flex', alignItems: 'center', gap: 10, background: t.card + 'ee', border: `1px solid ${t.border}`, borderRadius: 12, padding: '6px 12px' }}>
        <span style={{ fontSize: 11, color: t.text3 }}>{istClock(startRef.current)}</span>
        <input type="range" min={startRef.current} max={wallNow} step={60000} value={Math.min(simT, wallNow)} onChange={e => scrub(e.target.value)} style={{ flex: 1, accentColor: t.gold }} />
        <span style={{ fontSize: 11, color: t.text3 }}>now</span>
      </div>
    </>
  )
}
