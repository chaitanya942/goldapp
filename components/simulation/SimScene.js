'use client'

// SVG isometric scene for the ops simulation. Static ground + buildings are
// memoized (same element identity → React skips them each frame); moving
// things are rebuilt per frame and depth-sorted together with the buildings
// (painter's algorithm on x+y of each object's centre).

import { useMemo } from 'react'
import {
  P, poly, shade, Box, Quad, FaceQuad, FaceText, Shadow, Tree, Truck, Forklift,
  PalletLoad, GoldBar, Pin, Label, faceMatrix,
} from './iso'
import {
  TRUNK_Y, COLLECTOR_X, EXIT_X, BAYS_X, HUB, CONVEYOR, FURNACE, VAULT, FORK_LANE_Y,
  DROP_LANE_X, BRANCH_YC, STATIONS, VAULT_PAD, CREATE_PHASES,
} from './engine'

export const SCENE_PALETTES = {
  light: {
    sky: '#e7edf5', ground: '#dce4ee', grass: '#cfe2c4', grassEdge: '#bdd6af', road: '#c3cddb', lane: '#ffffff',
    yard: '#e9eef5', pad: '#f4f7fb', bayLine: '#f0b429', wall: '#f6f8fc', trim: '#3b6cf6', roof: '#edf1f7',
    glass: '#8fb8ea', door: '#2c4a80', brick: '#9c4b37', steel: '#5c6779', conveyor: '#687386', roller: '#4d5768',
    cardboard: '#d29e62', booked: '#f2c14e', pallet: '#b88a52', truckBody: '#fbfcfe', truckCab: '#2f62e0',
    forklift: '#f4b52c', tree: '#5aa866', trunk: '#8a6a4a', gold: '#e2b23a', shadow: 'rgba(30,45,70,.16)',
    text: '#1d2a3d', label: 'rgba(255,255,255,.96)', muted: '#6b7689', blue: '#2f62e0', green: '#1f9254',
    orange: '#d9731f', goldText: '#8a6410', ring: '#2f62e0',
  },
  dark: {
    sky: '#0d1219', ground: '#131a23', grass: '#15241a', grassEdge: '#1b2e21', road: '#222b37', lane: '#55627a',
    yard: '#18202b', pad: '#1e2834', bayLine: '#c9a84c', wall: '#2b3443', trim: '#c9a84c', roof: '#262f3d',
    glass: '#3c6595', door: '#111827', brick: '#71342a', steel: '#3b4454', conveyor: '#3f4858', roller: '#2b323e',
    cardboard: '#a8763e', booked: '#d8b04a', pallet: '#7a5a36', truckBody: '#dfe4ec', truckCab: '#3a6fd8',
    forklift: '#d8a024', tree: '#2e6a3b', trunk: '#5a4630', gold: '#e0b84a', shadow: 'rgba(0,0,0,.38)',
    text: '#e9edf3', label: 'rgba(24,30,40,.94)', muted: '#9aa6b8', blue: '#6d9dff', green: '#4cc283',
    orange: '#ff9a4a', goldText: '#f0cf72', ring: '#6d9dff',
  },
}

const TREES = [
  [8.6, 1.8, 1], [10.8, 4.2, 0.9], [8.4, 9.6, 1.1], [11.6, 11.2, 0.85], [19.6, 2.6, 1], [19.9, 8.4, 0.9],
  [9.2, 17.4, 1], [12.6, 20.2, 1.1], [9.6, 24.6, 0.9], [15.8, 23.4, 1], [17.6, 17.2, 0.85], [13.4, 27.2, 1],
  [23.6, 17.6, 1], [28.4, 20.2, 1.1], [33.8, 17.4, 0.9], [38.6, 19.6, 1], [43.8, 5.2, 1], [44.8, 10.4, 0.9],
  [22.4, 1.6, 0.9],
]

const short = (s, n = 16) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const LX = CONVEYOR.x
const BELT = { x0: LX - 0.45, x1: LX + 0.45 }
const isScale = (s) => s.key === 'weighIn' || s.key === 'weighOut'

function buildStatic(scene, pal, select) {
  const ground = []
  const objects = []
  const minY = BRANCH_YC[0] - 0.6, maxY = BRANCH_YC[BRANCH_YC.length - 1] + 0.6

  ground.push(<Quad key="g" x={-16} y={-16} w={84} d={62} fill={pal.ground} />)
  for (const [x, y, w, d] of [[7.3, 0.4, 5.3, 12.4], [7.3, 15.4, 14, 14], [18.2, 0.4, 2.9, 12.4], [21.6, 15.4, 22, 9], [42.4, -1.6, 4.6, 14.2]]) {
    ground.push(<Quad key={`gr${x}-${y}`} x={x} y={y} w={w} d={d} fill={pal.grass} stroke={pal.grassEdge} strokeWidth={1.5} />)
  }
  ground.push(<Quad key="apron" x={21} y={10} w={14.2} d={3.4} fill={pal.yard} />)
  ground.push(<Quad key="floor" x={35.2} y={-2.1} w={4.6} d={15.5} fill={pal.yard} stroke={pal.road} strokeWidth={1} />)
  ground.push(<Quad key="hubapron" x={12.6} y={9.8} w={4.8} d={2.2} fill={pal.yard} />)

  // roads
  ground.push(<Quad key="col" x={COLLECTOR_X - 0.6} y={minY} w={1.2} d={maxY - minY} fill={pal.road} />)
  ground.push(<Quad key="trunk" x={COLLECTOR_X - 0.6} y={TRUNK_Y - 0.6} w={EXIT_X + 3 - COLLECTOR_X} d={1.2} fill={pal.road} />)
  for (const yc of BRANCH_YC) ground.push(<Quad key={`sp${yc}`} x={3.0} y={yc - 0.5} w={2.4} d={1} fill={pal.road} />)
  if (scene.hubName) ground.push(<Quad key="hubsp" x={HUB.stopX - 0.6} y={HUB.y1} w={1.2} d={TRUNK_Y - 0.6 - HUB.y1} fill={pal.road} />)
  const [t0x, t0y] = P(COLLECTOR_X + 0.6, TRUNK_Y), [t1x, t1y] = P(EXIT_X + 3, TRUNK_Y)
  ground.push(<line key="tl" x1={t0x} y1={t0y} x2={t1x} y2={t1y} stroke={pal.lane} strokeWidth={1.6} strokeDasharray="9 9" opacity={0.85} />)
  const [c0x, c0y] = P(COLLECTOR_X, minY + 0.3), [c1x, c1y] = P(COLLECTOR_X, maxY - 0.3)
  ground.push(<line key="cl" x1={c0x} y1={c0y} x2={c1x} y2={c1y} stroke={pal.lane} strokeWidth={1.6} strokeDasharray="9 9" opacity={0.85} />)

  // dock bays + unloading pads + forklift lane
  BAYS_X.forEach((bx, i) => {
    ground.push(<Quad key={`bay${i}`} x={bx - 0.72} y={10.05} w={1.44} d={2.75} fill="none" stroke={pal.bayLine} strokeWidth={1.6} />)
    ground.push(<Quad key={`pad${i}`} x={bx + 0.95} y={10.35} w={1.0} d={2.0} fill={pal.pad} stroke={pal.bayLine} strokeWidth={1} dash="4 3" />)
  })
  const [f0x, f0y] = P(24, FORK_LANE_Y), [f1x, f1y] = P(DROP_LANE_X, FORK_LANE_Y)
  ground.push(<line key="fl" x1={f0x} y1={f0y} x2={f1x} y2={f1y} stroke={pal.bayLine} strokeWidth={1.4} strokeDasharray="5 6" opacity={0.7} />)
  ground.push(<Quad key="vpad" x={VAULT_PAD.x0} y={VAULT_PAD.y0} w={2.8} d={2.6} fill={shade(pal.yard, -0.05)} stroke={pal.gold} strokeWidth={1.4} />)

  // conveyor (low, so it lives in the ground layer)
  ground.push(<Box key="belt" x={BELT.x0} y={CONVEYOR.y1} w={0.9} d={CONVEYOR.y0 + 0.45 - CONVEYOR.y1} h={0.38} c={pal.conveyor} />)
  for (let yi = CONVEYOR.y1 + 0.2; yi < CONVEYOR.y0 + 0.4; yi += 0.45) {
    const [a, b] = P(BELT.x0 + 0.03, yi, 0.38), [c, d] = P(BELT.x1 - 0.03, yi, 0.38)
    ground.push(<line key={`r${yi.toFixed(2)}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.roller} strokeWidth={1} opacity={0.7} />)
  }
  for (const st of STATIONS.filter(isScale)) {
    ground.push(<Quad key={`plat${st.key}`} x={BELT.x0} y={st.y - 0.45} z={0.385} w={0.9} d={0.9} fill={pal.gold} opacity={0.35} />)
  }

  // branches
  for (const b of scene.branches) {
    const y0 = b.yc - 1.1
    objects.push({
      k: 1.8 + b.yc,
      el: (
        <g key={`br-${b.name}`} onClick={select({ type: 'branch', id: b.name })} style={{ cursor: 'pointer' }}>
          <Shadow x={0.6} y={y0} w={2.4} d={2.2} fill={pal.shadow} />
          <Box x={0.6} y={y0} w={2.4} d={2.2} h={1.5} c={pal.wall} />
          <Box x={0.5} y={y0 - 0.1} z={1.5} w={2.6} d={2.4} h={0.22} c={pal.gold} />
          <FaceQuad face="x" at={3.0} a0={b.yc - 0.35} a1={b.yc + 0.35} z0={0} z1={1.05} fill={pal.door} />
          <FaceQuad face="y" at={y0 + 2.2} a0={0.85} a1={1.75} z0={0.45} z1={1.15} fill={pal.glass} />
          <FaceQuad face="y" at={y0 + 2.2} a0={2.0} a1={2.8} z0={0.45} z1={1.15} fill={pal.glass} />
          <FaceText face="x" x={3.0} y={b.yc + 1.0} z={1.25} size={6.5} fill={pal.trim}>WHITE GOLD</FaceText>
        </g>
      ),
    })
  }

  // hub
  if (scene.hubName) {
    objects.push({
      k: 15 + 8.2,
      el: (
        <g key="hub" onClick={select({ type: 'hub' })} style={{ cursor: 'pointer' }}>
          <Shadow x={HUB.x0} y={HUB.y0} w={HUB.x1 - HUB.x0} d={HUB.y1 - HUB.y0} fill={pal.shadow} />
          <Box x={HUB.x0} y={HUB.y0} w={HUB.x1 - HUB.x0} d={HUB.y1 - HUB.y0} h={2.2} c={pal.wall} />
          <Box x={HUB.x0} y={HUB.y0} z={2.2} w={HUB.x1 - HUB.x0} d={HUB.y1 - HUB.y0} h={0.18} c={pal.trim} />
          <FaceQuad face="y" at={HUB.y1} a0={HUB.stopX - 0.65} a1={HUB.stopX + 0.65} z0={0} z1={1.45} fill={pal.door} />
          <FaceText face="y" x={HUB.x0 + 0.3} y={HUB.y1} z={1.75} size={11} fill={pal.trim} spacing={1}>HUB</FaceText>
        </g>
      ),
    })
  }

  // head office warehouse with dock doors
  const HO = { x0: 22, x1: 35, y0: 3.5, y1: 10, h: 3.4 }
  objects.push({
    k: 28.5 + 6.75,
    el: (
      <g key="ho" onClick={select({ type: 'ho' })} style={{ cursor: 'pointer' }}>
        <Shadow x={HO.x0} y={HO.y0} w={HO.x1 - HO.x0} d={HO.y1 - HO.y0} fill={pal.shadow} />
        <Box x={HO.x0} y={HO.y0} w={HO.x1 - HO.x0} d={HO.y1 - HO.y0} h={HO.h} c={pal.wall} top={pal.roof} />
        {[0, 1, 2].map(i => (
          <Box key={i} x={HO.x0 + 0.6} y={HO.y0 + 0.9 + i * 2} z={HO.h} w={HO.x1 - HO.x0 - 1.2} d={0.55} h={0.35} c={pal.glass} />
        ))}
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
        {[4.6, 6.4, 8.2].map(yy => (
          <FaceQuad key={yy} face="x" at={HO.x1} a0={yy - 0.5} a1={yy + 0.5} z0={1.2} z1={2.2} fill={pal.glass} />
        ))}
      </g>
    ),
  })

  // melting line furniture (the furnace is dynamic — rendered per frame)
  const scan = STATIONS[0]
  objects.push({ k: BELT.x0 - 0.3 + scan.y, el: <Box key="scanB" x={BELT.x0 - 0.3} y={scan.y - 0.06} w={0.12} d={0.12} h={1.45} c={pal.steel} /> })
  objects.push({ k: BELT.x1 + 0.25 + scan.y, el: <Box key="scanF" x={BELT.x1 + 0.18} y={scan.y - 0.06} w={0.12} d={0.12} h={1.45} c={pal.steel} /> })
  objects.push({ k: LX + scan.y + 0.5, el: <Box key="scanT" x={BELT.x0 - 0.3} y={scan.y - 0.1} z={1.45} w={1.6} d={0.2} h={0.16} c={pal.trim} /> })
  for (const st of STATIONS.filter(isScale)) {
    objects.push({
      k: BELT.x0 - 0.4 + st.y,
      el: (
        <g key={`sc${st.key}`}>
          <Box x={BELT.x0 - 0.45} y={st.y - 0.06} w={0.12} d={0.12} h={1.3} c={pal.steel} />
          <Box x={BELT.x0 - 0.5} y={st.y - 0.42} z={1.3} w={0.16} d={0.84} h={0.42} c="#1b2230" />
        </g>
      ),
    })
  }
  const pur = STATIONS[4]
  objects.push({
    k: 36.1 + pur.y,
    el: (
      <g key="lab" onClick={select({ type: 'line' })} style={{ cursor: 'pointer' }}>
        <Shadow x={35.35} y={pur.y - 0.7} w={1.5} d={1.4} fill={pal.shadow} />
        <Box x={35.35} y={pur.y - 0.7} w={1.5} d={1.4} h={1.45} c={pal.wall} />
        <FaceQuad face="y" at={pur.y + 0.7} a0={35.35} a1={36.85} z0={1.05} z1={1.2} fill={pal.green} />
        <FaceQuad face="x" at={36.85} a0={pur.y - 0.7} a1={pur.y + 0.7} z0={1.05} z1={1.2} fill={pal.green} />
        <FaceQuad face="y" at={pur.y + 0.7} a0={35.55} a1={36.2} z0={0.3} z1={0.85} fill={pal.glass} />
        <FaceText face="y" x={36.25} y={pur.y + 0.7} z={0.7} size={6.5} fill={pal.green}>XRF</FaceText>
      </g>
    ),
  })
  objects.push({ k: LX - 0.3 + pur.y, el: <Box key="arm" x={36.85} y={pur.y - 0.12} z={0.95} w={0.85} d={0.24} h={0.14} c={pal.steel} /> })

  // vault (the belt runs into its front door)
  objects.push({
    k: (VAULT.x0 + VAULT.x1) / 2 + (VAULT.y0 + VAULT.y1) / 2,
    el: (
      <g key="vault" onClick={select({ type: 'vault' })} style={{ cursor: 'pointer' }}>
        <Shadow x={VAULT.x0} y={VAULT.y0} w={VAULT.x1 - VAULT.x0} d={VAULT.y1 - VAULT.y0} fill={pal.shadow} />
        <Box x={VAULT.x0} y={VAULT.y0} w={VAULT.x1 - VAULT.x0} d={VAULT.y1 - VAULT.y0} h={2.3} c={pal.steel} />
        <Box x={VAULT.x0} y={VAULT.y0} z={2.3} w={VAULT.x1 - VAULT.x0} d={VAULT.y1 - VAULT.y0} h={0.14} c={pal.gold} />
        <FaceQuad face="y" at={VAULT.y1} a0={BELT.x0} a1={BELT.x1} z0={0} z1={0.75} fill="#0b0f16" />
        <g transform={faceMatrix('y', 38.85, VAULT.y1, 1.15)}>
          <circle r={15} fill={shade('#5c6779', -0.25)} stroke={pal.gold} strokeWidth={3} />
          <circle r={4.5} fill={pal.gold} />
          {[0, 60, 120].map(a => <line key={a} x1={-11 * Math.cos(a * Math.PI / 180)} y1={-11 * Math.sin(a * Math.PI / 180)} x2={11 * Math.cos(a * Math.PI / 180)} y2={11 * Math.sin(a * Math.PI / 180)} stroke={pal.gold} strokeWidth={2} />)}
        </g>
        <FaceText face="x" x={VAULT.x1} y={VAULT.y1 - 0.35} z={1.55} size={10} fill={pal.gold} spacing={2}>VAULT</FaceText>
      </g>
    ),
  })

  for (const [x, y, s] of TREES) objects.push({ k: x + y, el: <Tree key={`t${x}-${y}`} x={x} y={y} s={s} pal={pal} /> })

  return { ground, objects }
}

function Furnace({ pal, active, select }) {
  const F = FURNACE
  return (
    <g onClick={select({ type: 'line' })} style={{ cursor: 'pointer' }}>
      <Shadow x={F.x0} y={F.y0} w={F.x1 - F.x0} d={F.y1 - F.y0} fill={pal.shadow} />
      <Box x={F.x0} y={F.y0} w={F.x1 - F.x0} d={F.y1 - F.y0} h={2.0} c={pal.brick} />
      <Box x={F.x0 - 0.05} y={F.y0 - 0.05} z={2.0} w={F.x1 - F.x0 + 0.1} d={F.y1 - F.y0 + 0.1} h={0.12} c={pal.steel} />
      <Box x={F.x0 + 0.2} y={F.y0 + 0.15} z={2.12} w={0.6} d={0.6} h={1.7} c={pal.steel} />
      <FaceQuad face="y" at={F.y1} a0={BELT.x0} a1={BELT.x1} z0={0} z1={0.8} fill={active ? '#ff8a1f' : '#1a1410'} className={active ? 'sim-flicker' : undefined} />
      <FaceQuad face="x" at={F.x1} a0={F.y0 + 0.4} a1={F.y1 - 0.4} z0={0.6} z1={1.3} fill={active ? '#ffb347' : '#2a1d17'} className={active ? 'sim-flicker' : undefined} />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <FaceQuad key={i} face="x" at={F.x1} a0={F.y0 + i * 0.4} a1={F.y0 + i * 0.4 + 0.2} z0={0.08} z1={0.28} fill={pal.gold} opacity={0.8} />
      ))}
      <FaceText face="x" x={F.x1} y={F.y1 - 0.25} z={1.62} size={8.5} fill="#ffd9a8" spacing={1}>FURNACE</FaceText>
    </g>
  )
}

function BranchPile({ b, pal }) {
  const parts = b.bills.slice(0, 20).map((bill, i) => {
    const col = i % 5, row = Math.floor(i / 5) % 2, layer = Math.floor(i / 10)
    const c = bill.booked ? pal.booked : pal.cardboard
    return {
      k: layer * 100 + col + row,
      el: <Box key={i} x={0.7 + col * 0.44} y={b.yc + 1.32 + row * 0.46} z={layer * 0.38} w={0.38} d={0.38} h={0.38} c={c} top={shade(c, 0.18)} />,
    }
  })
  return <g>{parts.sort((a, c) => a.k - c.k).map(p => p.el)}</g>
}

function VaultBars({ count }) {
  const parts = []
  for (let i = 0; i < Math.min(count, 45); i++) {
    const layer = Math.floor(i / 15), r = i % 15, col = r % 3, row = Math.floor(r / 3)
    parts.push({ k: layer * 100 + col + row, el: <GoldBar key={i} x={VAULT_PAD.x0 + 0.6 + col * 0.78 + layer * 0.1} y={VAULT_PAD.y0 + 0.4 + row * 0.44 + layer * 0.1} z={layer * 0.18} /> })
  }
  return <g>{parts.sort((a, c) => a.k - c.k).map(p => p.el)}</g>
}

export default function SimScene({ sim, pal, selected, select, viewBox, svgRef }) {
  const { ground, objects } = useMemo(() => buildStatic(sim.scene, pal, select), [sim.scene, pal, select])

  const dyn = []
  for (const b of sim.branches) {
    dyn.push({ k: 1.8 + b.yc + 1.85, el: <g key={`pile-${b.name}`} onClick={select({ type: 'branch', id: b.name })} style={{ cursor: 'pointer' }}><BranchPile b={b} pal={pal} /></g> })
  }
  for (const tr of sim.trucks) {
    dyn.push({ k: tr.x + tr.y + 0.01, el: <g key={`tr-${tr.id}`} onClick={select({ type: 'truck', id: tr.id })} style={{ cursor: 'pointer' }}><Truck x={tr.x} y={tr.y} heading={tr.heading} pal={pal} /></g> })
  }
  for (const f of sim.forklifts) {
    const lot = f.lot != null ? sim.lots.find(l => l.id === f.lot && l.state === 'carried') : null
    dyn.push({
      k: f.x + f.y + 0.02,
      el: (
        <g key={`fl-${f.id}`} onClick={select({ type: 'forklift', id: f.id })} style={{ cursor: 'pointer' }}>
          <Forklift x={f.x} y={f.y} heading={f.heading} pal={pal} load={lot ? (lx, ly, lz) => <PalletLoad x={lx} y={ly} z={lz} pal={pal} bills={lot.bills} /> : null} />
        </g>
      ),
    })
  }
  for (const lot of sim.lots) {
    if (lot.state === 'carried') continue
    let x = lot.x, y = lot.y, z = 0
    if (lot.state === 'belt') {
      x = LX; y = lot.cy; z = 0.38
      if (y > FURNACE.y0 + 0.05 && y < FURNACE.y1 - 0.05) continue
    }
    dyn.push({ k: x + y + 0.03, el: <g key={`lot-${lot.id}`} onClick={select({ type: 'lot', id: lot.id })} style={{ cursor: 'pointer' }}><PalletLoad x={x} y={y} z={z} pal={pal} bills={lot.bills} form={lot.form} /></g> })
  }
  const furnaceLot = sim.stations[2].lot != null ? sim.lots.find(l => l.id === sim.stations[2].lot) : null
  const furnaceActive = !!(furnaceLot && furnaceLot.ti === 2 && furnaceLot.phase === 'work')
  dyn.push({ k: LX + STATIONS[2].y, el: <Furnace key="furnace" pal={pal} active={furnaceActive} select={select} /> })
  dyn.push({ k: VAULT_PAD.x0 + 1.4 + VAULT_PAD.y0 + 1.3, el: <g key="bars" onClick={select({ type: 'vault' })} style={{ cursor: 'pointer' }}><VaultBars count={sim.vaultBars} /></g> })

  const sorted = [...objects, ...dyn].sort((a, b) => a.k - b.k).map(o => o.el)

  // ── effects layer ──────────────────────────────────────────────────────────
  const fx = []
  const scanLot = sim.stations[0].lot != null ? sim.lots.find(l => l.id === sim.stations[0].lot) : null
  if (scanLot && scanLot.ti === 0 && scanLot.phase === 'work') {
    const [ax, ay] = P(LX, STATIONS[0].y, 1.45), [bx, by] = P(LX, STATIONS[0].y, 0.6)
    fx.push(<line key="laser" x1={ax} y1={ay} x2={bx} y2={by} stroke="#ff3b3b" strokeWidth={2.2} className="sim-flicker" />)
  }
  if (furnaceActive) {
    const [sx, sy] = P(FURNACE.x0 + 0.5, FURNACE.y0 + 0.45, 3.9)
    for (let i = 0; i < 4; i++) {
      fx.push(<circle key={`sm${i}`} cx={sx} cy={sy} r={7} fill={pal.muted} opacity={0} className="sim-smoke" style={{ animationDelay: `${i * 0.45}s` }} />)
    }
    const [gx, gy] = P(LX, FURNACE.y1 + 0.5, 0.3)
    fx.push(<ellipse key="glow" cx={gx} cy={gy} rx={46} ry={22} fill="url(#simGlow)" className="sim-flicker" />)
  }
  for (const st of sim.stations) {
    if (!['weighIn', 'weighOut', 'purity'].includes(st.key)) continue
    const idx = sim.stations.indexOf(st)
    const lot = st.lot != null ? sim.lots.find(l => l.id === st.lot) : null
    const here = lot && lot.ti === idx && (lot.phase === 'work' || lot.phase === 'wait')
    const prog = here ? (lot.phase === 'wait' ? 1 : Math.min(1, 1 - lot.timer / st.dur + 0.15)) : 0
    const tag = st.key === 'weighIn' ? 'IN' : st.key === 'weighOut' ? 'OUT' : 'XRF'
    let text = st.key === 'purity' ? `${tag} --.-%` : `${tag} 0.0 g`
    if (here) {
      if (st.key === 'weighIn') text = `${tag} ${(lot.gross * prog).toFixed(1)} g`
      if (st.key === 'weighOut') text = `${tag} ${(lot.net * prog).toFixed(1)} g`
      if (st.key === 'purity') text = `${tag} ${(lot.purity * prog).toFixed(1)}%`
    }
    const [dx, dy] = st.key === 'purity' ? P(36.1, st.y, 2.2) : P(BELT.x0 - 0.42, st.y, 2.1)
    const w = text.length * 6.6 + 12
    fx.push(
      <g key={`rd${st.key}`} transform={`translate(${(dx - w / 2).toFixed(1)},${(dy - 9).toFixed(1)})`} style={{ pointerEvents: 'none' }}>
        <rect width={w} height={16} rx={4} fill="#0f141c" stroke={here ? '#39d98a' : '#2a3342'} />
        <text x={w / 2} y={11.5} fontSize={10} fontFamily="ui-monospace, Menlo, monospace" fontWeight={700} textAnchor="middle" fill={here ? '#39d98a' : '#5c6779'}>{text}</text>
      </g>,
    )
  }

  // labels
  const labels = []
  for (const b of sim.branches) {
    const sel = selected?.type === 'branch' && selected.id === b.name
    labels.push(
      <Label key={`lb-${b.name}`} x={1.8} y={b.yc} z={2.3} text={short(b.name)} sub={`${b.bills.length}`}
        bg={pal.label} fg={sel ? pal.ring : pal.text} subBg={b.bills.length >= b.threshold ? pal.gold : pal.blue} subFg="#fff"
        strong={sel} onClick={select({ type: 'branch', id: b.name })} />,
    )
    if (b.creating) labels.push(<Pin key={`pin-${b.name}`} x={1.8} y={b.yc} z={3.2} color={pal.gold} label={CREATE_PHASES[b.creating.phase].pin} />)
  }
  if (sim.scene.hubName) {
    labels.push(<Label key="lb-hub" x={15} y={8.2} z={3.0} text={`${short(sim.scene.hubName, 18)} · HUB`} bg={pal.label} fg={pal.trim} onClick={select({ type: 'hub' })} />)
  }
  labels.push(<Label key="lb-ho" x={28.5} y={6.75} z={4.6} text="HEAD OFFICE" bg={pal.gold} fg="#1a1208" size={11} onClick={select({ type: 'ho' })} />)
  labels.push(<Label key="lst-scan" x={LX} y={STATIONS[0].y} z={2.05} text="SCAN" bg={pal.label} fg={pal.muted} size={8} />)
  labels.push(<Label key="lst-vault" x={(VAULT.x0 + VAULT.x1) / 2} y={(VAULT.y0 + VAULT.y1) / 2} z={3.2} text={`VAULT · ${sim.vaultBars} bars`} bg={pal.label} fg={pal.goldText} size={9} onClick={select({ type: 'vault' })} />)
  for (const tr of sim.trucks) {
    labels.push(<Label key={`ltr${tr.id}`} x={tr.x} y={tr.y} z={2.05} text={`${tr.cons.bills} bills`} bg={pal.blue} fg="#fff" size={8.5} onClick={select({ type: 'truck', id: tr.id })} />)
  }

  const selPos = selectedPosition(sim, selected)
  const ring = selPos && (
    <polygon key="ring" points={poly(ringPts(selPos.x, selPos.y, selPos.r))} fill="none" stroke={pal.ring} strokeWidth={2.5} className="sim-ring" style={{ pointerEvents: 'none' }} />
  )

  const popColors = { muted: pal.muted, blue: pal.blue, green: pal.green, orange: pal.orange, gold: pal.goldText }
  const pops = sim.popups.map(p => {
    const [px, py] = P(p.x, p.y, p.z)
    const k = p.age / (p.big ? 2.6 : 1.9)
    return (
      <text key={p.id} x={px} y={py - p.age * 26} fontSize={p.big ? 15 : 10.5} fontWeight={900} textAnchor="middle"
        fill={popColors[p.color] || pal.text} stroke={pal.label} strokeWidth={p.big ? 4 : 3} paintOrder="stroke"
        opacity={Math.max(0, 1 - k * k)} style={{ pointerEvents: 'none' }}>
        {p.text}
      </text>
    )
  })

  return (
    <svg ref={svgRef} viewBox={`${viewBox.x.toFixed(1)} ${viewBox.y.toFixed(1)} ${viewBox.w.toFixed(1)} ${viewBox.h.toFixed(1)}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', fontFamily: 'inherit' }}>
      <defs>
        <radialGradient id="simGlow">
          <stop offset="0%" stopColor="#ff9b3d" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>
      </defs>
      {ground}
      {ring}
      {sorted}
      {fx}
      {labels}
      {selPos && <Pin x={selPos.x} y={selPos.y} z={selPos.z} color={pal.ring} />}
      {pops}
    </svg>
  )
}

function ringPts(x, y, r) {
  const pts = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r, 0])
  }
  return pts
}

export function selectedPosition(sim, sel) {
  if (!sel) return null
  switch (sel.type) {
    case 'branch': { const b = sim.branches.find(x => x.name === sel.id); return b && { x: 1.8, y: b.yc, z: 4.3, r: 2 } }
    case 'truck': { const t = sim.trucks.find(x => x.id === sel.id); return t && { x: t.x, y: t.y, z: 2.9, r: 1.4 } }
    case 'forklift': { const f = sim.forklifts.find(x => x.id === sel.id); return f && { x: f.x, y: f.y, z: 2.0, r: 0.9 } }
    case 'lot': {
      const l = sim.lots.find(x => x.id === sel.id)
      if (!l) return null
      if (l.state === 'belt') return { x: LX, y: l.cy, z: 1.6, r: 0.8 }
      if (l.state === 'carried') { const f = sim.forklifts.find(x => x.lot === l.id); return f && { x: f.x, y: f.y, z: 2.0, r: 0.9 } }
      return { x: l.x, y: l.y, z: 1.5, r: 0.8 }
    }
    case 'hub': return { x: 15, y: 8.2, z: 4.0, r: 2.6 }
    case 'ho': return { x: 28.5, y: 6.75, z: 5.6, r: 5 }
    case 'line': return { x: LX, y: STATIONS[2].y, z: 4.9, r: 2 }
    case 'vault': return { x: (VAULT.x0 + VAULT.x1) / 2, y: (VAULT.y0 + VAULT.y1) / 2, z: 3.8, r: 2.4 }
    default: return null
  }
}
