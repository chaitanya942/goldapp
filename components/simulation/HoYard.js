'use client'

// Head Office yard — isometric view of today's consignments to HO.
// Trucks still in transit sit on the inbound highway at their estimated
// progress (dispatch → branch TAT); the latest received ones are docked;
// bills received today are stacked as HO inventory in front of the building.

import { useMemo } from 'react'
import { P, Box, Quad, FaceQuad, FaceText, Shadow, Tree, Truck, PalletLoad, Label } from './iso'
import { transitProgress } from './simData'

export const YARD_PALETTES = {
  light: {
    sky: '#e7edf5', ground: '#dce4ee', grass: '#cfe2c4', grassEdge: '#bdd6af', road: '#c3cddb', lane: '#ffffff',
    yard: '#e9eef5', bayLine: '#f0b429', wall: '#f6f8fc', trim: '#3b6cf6', roof: '#edf1f7',
    glass: '#8fb8ea', door: '#2c4a80', cardboard: '#d29e62', pallet: '#b88a52', truckBody: '#fbfcfe', truckCab: '#2f62e0',
    tree: '#5aa866', trunk: '#8a6a4a', gold: '#e2b23a', shadow: 'rgba(30,45,70,.16)',
    text: '#1d2a3d', label: 'rgba(255,255,255,.96)', muted: '#6b7689', blue: '#2f62e0', green: '#1f9254', ring: '#2f62e0',
  },
  dark: {
    sky: '#0d1219', ground: '#131a23', grass: '#15241a', grassEdge: '#1b2e21', road: '#222b37', lane: '#55627a',
    yard: '#18202b', bayLine: '#c9a84c', wall: '#2b3443', trim: '#c9a84c', roof: '#262f3d',
    glass: '#3c6595', door: '#111827', cardboard: '#a8763e', pallet: '#7a5a36', truckBody: '#dfe4ec', truckCab: '#3a6fd8',
    tree: '#2e6a3b', trunk: '#5a4630', gold: '#e0b84a', shadow: 'rgba(0,0,0,.38)',
    text: '#e9edf3', label: 'rgba(24,30,40,.94)', muted: '#9aa6b8', blue: '#6d9dff', green: '#4cc283', ring: '#6d9dff',
  },
}

const HO = { x0: 22, x1: 35, y0: 3.5, y1: 10, h: 3.4 }
const BAYS_X = [24.6, 28.2, 31.8]
const BAY_Y = 11.4
const LANES_Y = [13.4, 14.8, 16.2]
const ROAD_X0 = -12, ROAD_X1 = 21
const INV = { x0: 22, y0: 14.6, cols: 10, rows: 3 }
const TREES = [[-9, 10, 1], [-2, 9.6, 0.9], [5, 10.2, 1.1], [12, 9.8, 0.9], [18, 10.4, 1], [-7, 19.6, 1], [1, 19.8, 1.1], [9, 19.4, 0.9], [16, 19.8, 1], [38, 6, 1], [39, 12, 0.9], [19, 4, 1]]

const short = (s, n = 14) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// Place in-transit trucks on the lanes, keeping ~2.8 units between trucks.
function layoutTrucks(list) {
  const lanes = LANES_Y.map(() => [])
  return [...list]
    .map(c => ({ c, x: ROAD_X0 + 2 + transitProgress(c) * (ROAD_X1 - ROAD_X0 - 6) }))
    .sort((a, b) => b.x - a.x)
    .map((t, i) => {
      const lane = i % LANES_Y.length
      const prev = lanes[lane][lanes[lane].length - 1]
      const x = prev != null ? Math.min(t.x, prev - 2.8) : t.x
      lanes[lane].push(x)
      return { ...t, x: Math.max(ROAD_X0 + 1, x), y: LANES_Y[lane], lane }
    })
}

function bounds() {
  const pts = [[ROAD_X0, 9], [ROAD_X0, 20], [HO.x1 + 4, HO.y0 - 1], [HO.x1 + 4, 20], [HO.x0, HO.y0 - 2]]
  const xs = pts.map(([x, y]) => P(x, y, 0)[0]), ys = pts.map(([x, y]) => P(x, y, 0)[1])
  return { x: Math.min(...xs) - 30, y: Math.min(...ys) - 150, w: Math.max(...xs) - Math.min(...xs) + 60, h: Math.max(...ys) - Math.min(...ys) + 190 }
}

export default function HoYard({ data, dark, selected, onSelect }) {
  const pal = YARD_PALETTES[dark ? 'dark' : 'light']
  const vb = useMemo(bounds, [])
  const toHo = (data?.consignments || []).filter(c => c.type === 'EXTERNAL')
  const inTransit = layoutTrucks(toHo.filter(c => c.status !== 'received'))
  const received = toHo.filter(c => c.status === 'received').sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  const docked = received.slice(0, BAYS_X.length)
  const invBills = data?.hoToday?.bills || 0
  const pallets = Math.min(INV.cols * INV.rows, Math.ceil(invBills / 2))
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
          <FaceQuad face="y" at={HO.y1} a0={bx - 0.62} a1={bx + 0.62} z0={0} z1={1.6} fill={pal.door} />
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
    objects.push({ k: x + y, el: <g key={`inv${i}`} onClick={() => onSelect({ type: 'ho' })} style={{ cursor: 'pointer' }}><PalletLoad x={x} y={y} pal={pal} bills={4} /></g> })
  }
  docked.forEach((c, i) => {
    objects.push({ k: BAYS_X[i] + BAY_Y + 0.01, el: <g key={`dk${c.id}`} onClick={() => onSelect({ type: 'cons', id: c.id })} style={{ cursor: 'pointer' }}><Truck x={BAYS_X[i]} y={BAY_Y} heading="y-" pal={pal} /></g> })
  })
  for (const t of inTransit) {
    objects.push({ k: t.x + t.y + 0.01, el: <g key={`tr${t.c.id}`} onClick={() => onSelect({ type: 'cons', id: t.c.id })} style={{ cursor: 'pointer' }}><Truck x={t.x} y={t.y} heading="x+" pal={pal} /></g> })
  }
  const sorted = objects.sort((a, b) => a.k - b.k).map(o => o.el)

  const ground = [
    <Quad key="g" x={-40} y={-10} w={90} d={40} fill={pal.ground} />,
    <Quad key="gr1" x={ROAD_X0} y={8.6} w={ROAD_X1 - ROAD_X0 - 1} d={3.6} fill={pal.grass} stroke={pal.grassEdge} strokeWidth={1.5} />,
    <Quad key="gr2" x={ROAD_X0} y={17.4} w={ROAD_X1 - ROAD_X0 - 1} d={3.4} fill={pal.grass} stroke={pal.grassEdge} strokeWidth={1.5} />,
    <Quad key="yard" x={HO.x0 - 1} y={HO.y1} w={HO.x1 - HO.x0 + 2} d={8.6} fill={pal.yard} />,
    <Quad key="road" x={ROAD_X0} y={LANES_Y[0] - 0.7} w={ROAD_X1 - ROAD_X0} d={LANES_Y[2] - LANES_Y[0] + 1.4} fill={pal.road} />,
    ...LANES_Y.slice(0, -1).map((ly, i) => {
      const [a, b] = P(ROAD_X0 + 0.5, ly + 0.7), [c, d] = P(ROAD_X1 - 0.5, ly + 0.7)
      return <line key={`ln${i}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.lane} strokeWidth={1.6} strokeDasharray="9 9" className="sim-lane" opacity={0.85} />
    }),
    ...BAYS_X.map((bx, i) => <Quad key={`bay${i}`} x={bx - 0.72} y={10.05} w={1.44} d={2.75} fill="none" stroke={pal.bayLine} strokeWidth={1.6} />),
    <Quad key="inv" x={INV.x0} y={INV.y0} w={INV.cols * 1.2 + 0.2} d={INV.rows * 1.15 + 0.2} fill="none" stroke={pal.gold} strokeWidth={1.4} dash="5 4" />,
  ]

  const labels = []
  for (const t of inTransit) {
    labels.push(<Label key={`l${t.c.id}`} x={t.x} y={t.y} z={2.2 + t.lane * 1.3} text={`${short(t.c.from)} · ${t.c.bills} bills`} bg={sel(t.c) ? pal.ring : pal.label} fg={sel(t.c) ? '#fff' : pal.text} size={12} strong={sel(t.c)} onClick={() => onSelect({ type: 'cons', id: t.c.id })} />)
  }
  docked.forEach((c, i) => {
    labels.push(<Label key={`ld${c.id}`} x={BAYS_X[i]} y={BAY_Y} z={2.1} text={`${short(c.from)} · received`} bg={sel(c) ? pal.ring : pal.green} fg="#fff" size={12} onClick={() => onSelect({ type: 'cons', id: c.id })} />)
  })
  labels.push(<Label key="lho" x={28.5} y={6.75} z={4.6} text="HEAD OFFICE" bg={pal.gold} fg="#1a1208" size={15} onClick={() => onSelect({ type: 'ho' })} />)
  labels.push(<Label key="linv" x={INV.x0 + INV.cols * 0.6} y={INV.y0 + INV.rows * 1.15 + 0.6} z={0.2} text={`HO inventory today · ${invBills} bills`} bg={pal.label} fg={pal.text} size={13} onClick={() => onSelect({ type: 'ho' })} />)
  labels.push(<Label key="lroad" x={ROAD_X0 + 3} y={LANES_Y[1]} z={1.2} text={inTransit.length ? 'From branches →' : 'No trucks on the road'} bg={pal.label} fg={pal.muted} size={12} />)

  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', background: pal.sky }}>
      {ground}
      {sorted}
      {labels}
    </svg>
  )
}
