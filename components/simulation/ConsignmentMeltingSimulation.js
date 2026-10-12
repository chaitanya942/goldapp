'use client'

// Ops Simulator — an isometric, game-style playground of the full
// Branch → Consignment → Head Office → Melting flow. Synthetic data only
// (branch/hub names come from the real branches table). Locked to a single
// account via PAGE_EMAIL_ALLOWLIST.simulation in lib/context.js.

import { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import SimScene, { SCENE_PALETTES, selectedPosition } from './SimScene'
import { P } from './iso'
import {
  createSim, stepSim, warmSim, pickSceneBranches, fmtClock, truckEtaMin,
  CREATE_PHASES, TRACK_STEPS, TRUCK_STATUS, STATIONS,
} from './engine'

// Default camera: leaves headroom for the KPI row and the bottom panels.
const FIT = { x: -810, y: -200, w: 1960, h: 1180 }
const FIT_MOBILE = { x: -260, y: 120, w: 1250, h: 900 }
const MIN_W = 420, MAX_W = 2600
const LEVEL_PTS = 1500

const fmtG = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })

function useCountUp(target, duration = 600) {
  const [val, setVal] = useState(target)
  const rafRef = useRef(null)
  const fromRef = useRef(target)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    const start = performance.now()
    const startVal = fromRef.current
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const v = startVal + (target - startVal) * (1 - Math.pow(1 - p, 3))
      fromRef.current = v
      setVal(v)
      if (p < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])
  return val
}

const glass = (dark) => ({
  background: dark ? 'rgba(20,24,32,.92)' : 'rgba(255,255,255,.95)',
  border: `1px solid ${dark ? 'rgba(255,255,255,.08)' : 'rgba(20,40,80,.08)'}`,
  borderRadius: 14,
  boxShadow: dark ? '0 10px 30px rgba(0,0,0,.45)' : '0 10px 30px rgba(30,50,90,.12)',
  backdropFilter: 'blur(8px)',
})

const Chip = ({ text, color }) => (
  <span style={{ fontSize: 11, fontWeight: 800, color, background: color + '1f', padding: '3px 9px', borderRadius: 7, whiteSpace: 'nowrap' }}>{text}</span>
)

function KpiCard({ t, dark, icon, tint, label, value, decimals = 0, sub, children }) {
  const shown = useCountUp(value)
  return (
    <div style={{ ...glass(dark), padding: '10px 14px', display: 'flex', gap: 11, alignItems: 'center', minWidth: 0, pointerEvents: 'auto' }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: tint + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: t.text3, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: t.text1, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
          {shown.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
        </div>
        {sub && <div style={{ fontSize: 10.5, color: t.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
        {children}
      </div>
    </div>
  )
}

function consStatus(sim, c) {
  if (!c) return ''
  if (c.done) return 'In vault'
  const lot = sim.lots.find(l => l.cons === c)
  if (lot) {
    if (lot.state === 'pad') return 'At HO · awaiting forklift'
    if (lot.state === 'carried') return 'Forklift → melting line'
    return STATIONS[lot.ti].label.charAt(0) + STATIONS[lot.ti].label.slice(1).toLowerCase()
  }
  const tr = sim.trucks.find(x => x.cons === c)
  if (tr) return TRUCK_STATUS[tr.state]
  return 'Creating at branch'
}

function DetailPanel({ sim, sel, t, dark, pal, onClose, onLocate }) {
  let d = null
  const row = (k, v) => [k, v]
  if (sel.type === 'branch') {
    const b = sim.branches.find(x => x.name === sel.id)
    if (b) {
      const booked = b.bills.filter(x => x.booked).length
      const ph = b.creating ? CREATE_PHASES[b.creating.phase] : null
      d = {
        icon: '🏬', kicker: `BRANCH${b.region ? ' · ' + b.region : ''}`, title: b.name,
        chip: ph ? [`Creating ${b.creating.cons.id}`, pal.gold] : b.bills.length ? ['Stock waiting', pal.blue] : ['Idle', t.text3],
        rows: [
          row('Bills in branch stock', b.bills.length),
          row('Booked (bidding)', booked),
          row('Unbooked', b.bills.length - booked),
          row('Stock weight', `${fmtG(b.bills.reduce((s, x) => s + x.w, 0))} g`),
          row('Route to HO', b.viaHub ? `Via ${sim.scene.hubName} hub` : 'Direct'),
          row('Consignment at', `${b.threshold} bills`),
          row('Consignments sent', b.sent),
        ],
        note: 'Gold parcel = booked · brown parcel = unbooked',
      }
    }
  } else if (sel.type === 'truck') {
    const tr = sim.trucks.find(x => x.id === sel.id)
    if (tr) {
      const c = tr.cons
      d = {
        icon: '🚚', kicker: `TRUCK · ${tr.code}`, title: c.id,
        chip: [TRUCK_STATUS[tr.state], tr.state === 'unloading' ? pal.green : tr.state === 'queued' ? pal.orange : pal.blue],
        rows: [
          row('From', c.branch),
          row('Bills', `${c.bills} (${c.booked} booked)`),
          row('Declared weight', `${fmtG(c.weight)} g`),
          row('Route', c.viaHub ? `Via ${sim.scene.hubName} hub` : 'Direct to HO'),
          row('EWB (ClearTax)', c.ewb),
          row('Dispatched', fmtClock(c.steps.moved)),
          row(tr.bay ? 'Dock' : 'ETA', tr.bay ? `Bay ${tr.bay}` : `${truckEtaMin(tr)} min`),
        ],
      }
    }
  } else if (sel.type === 'lot') {
    const l = sim.lots.find(x => x.id === sel.id)
    if (l) {
      const c = l.cons
      d = {
        icon: l.form === 'bar' ? '🥇' : '📦', kicker: `LOT · ${c.branch}`, title: c.id,
        chip: [consStatus(sim, c), l.form === 'bar' ? pal.gold : pal.blue],
        rows: [
          row('Bills', c.bills),
          row('Declared weight', `${fmtG(l.weight)} g`),
          row('Gross (weigh-in)', l.gross != null ? `${fmtG(l.gross)} g` : '—'),
          row('Net (weigh-out)', l.net != null ? `${fmtG(l.net)} g` : '—'),
          row('Purity', l.purity != null ? `${l.purity}%` : '—'),
          row('Fine gold', l.fine != null ? `${fmtG(l.fine)} g` : '—'),
        ],
      }
    }
  } else if (sel.type === 'forklift') {
    const f = sim.forklifts.find(x => x.id === sel.id)
    if (f) {
      const lot = f.lot != null ? sim.lots.find(l => l.id === f.lot) : null
      const task = { idle: 'Idle', toPick: 'Heading to dock pad', picking: 'Lifting pallet', toDrop: 'Moving to melting line', waitDrop: 'Waiting for scan station', dropping: 'Loading belt', returning: 'Returning' }[f.state]
      d = {
        icon: '🚜', kicker: 'FORKLIFT · HO', title: f.id,
        chip: [task, f.state === 'idle' ? t.text3 : pal.green],
        rows: [row('Carrying', lot ? lot.cons.id : '—'), row('Branch', lot ? lot.cons.branch : '—'), row('Weight', lot ? `${fmtG(lot.weight)} g` : '—')],
      }
    }
  } else if (sel.type === 'hub') {
    const feeders = sim.branches.filter(b => b.viaHub).map(b => b.name).join(', ') || '—'
    d = {
      icon: '🏬', kicker: 'HUB', title: sim.scene.hubName || 'Hub',
      chip: [`${sim.trucks.filter(x => x.state === 'atHub').length} truck(s) here`, pal.blue],
      rows: [row('Feeder branches', feeders), row('Consolidations', sim.stats.hubStops)],
    }
  } else if (sel.type === 'ho') {
    const hoLots = sim.lots.filter(l => l.state === 'pad' || l.state === 'carried')
    d = {
      icon: '🏢', kicker: 'HEAD OFFICE', title: 'Receiving & HO stock',
      chip: [`${sim.bays.filter(b => b.truck).length}/${sim.bays.length} docked`, pal.green],
      rows: [
        row('Gate queue', `${sim.queue.length} truck(s)`),
        row('HO stock (awaiting melt)', `${hoLots.length} lots`),
        row('HO stock weight', `${fmtG(hoLots.reduce((s, l) => s + l.weight, 0))} g`),
        row('Bills received', sim.stats.received),
        row('Weight received', `${fmtG(sim.stats.receivedWeight)} g`),
      ],
    }
  } else if (sel.type === 'line') {
    const fl = sim.stations[2].lot != null ? sim.lots.find(l => l.id === sim.stations[2].lot) : null
    const loss = sim.stats.gross ? (1 - sim.stats.net / sim.stats.gross) * 100 : 0
    d = {
      icon: '🔥', kicker: 'MELTING LINE', title: 'Scan → Weigh → Melt → Purity',
      chip: [fl ? `Melting ${fl.cons.id}` : 'Furnace idle', fl ? pal.orange : t.text3],
      rows: [
        row('Lots on line', sim.lots.filter(l => l.state === 'belt').length),
        row('Melted (gross)', `${fmtG(sim.stats.melted)} g`),
        row('Net after melt', `${fmtG(sim.stats.net)} g`),
        row('Avg melt loss', `${loss.toFixed(2)}%`),
        row('Avg purity', sim.stats.lotsDone ? `${(sim.stats.puritySum / sim.stats.lotsDone).toFixed(1)}%` : '—'),
      ],
    }
  } else if (sel.type === 'vault') {
    d = {
      icon: '🥇', kicker: 'VAULT', title: 'Fine gold',
      chip: [`${sim.vaultBars} bars`, pal.gold],
      rows: [
        row('Fine gold', `${fmtG(sim.stats.fine)} g`),
        row('Lots processed', sim.stats.lotsDone),
        row('Avg purity', sim.stats.lotsDone ? `${(sim.stats.puritySum / sim.stats.lotsDone).toFixed(1)}%` : '—'),
        row('Score', sim.stats.score.toLocaleString('en-IN')),
      ],
    }
  }
  if (!d) return null
  const iconBtn = { width: 30, height: 30, borderRadius: 9, border: `1px solid ${t.border}`, background: 'transparent', color: t.text2, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  return (
    <div style={{ ...glass(dark), padding: 16, width: 310, pointerEvents: 'auto', animation: 'simIn .25s ease' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: pal.gold + '26', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>{d.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: pal.blue, letterSpacing: '.06em' }}>{d.kicker}</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
        </div>
        <button title="Locate" style={iconBtn} onClick={onLocate}>⌖</button>
        <button title="Close" style={iconBtn} onClick={onClose}>✕</button>
      </div>
      <div style={{ margin: '12px 0 8px' }}><Chip text={d.chip[0]} color={d.chip[1]} /></div>
      {d.rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: `1px solid ${t.border}`, fontSize: 12.5 }}>
          <span style={{ color: t.text3 }}>{k}</span>
          <span style={{ color: t.text1, fontWeight: 700, textAlign: 'right' }}>{v}</span>
        </div>
      ))}
      {d.note && <div style={{ fontSize: 11, color: t.text3, marginTop: 6 }}>{d.note}</div>}
    </div>
  )
}

function Tracker({ sim, cons, t, dark, pal, onOpen }) {
  if (!cons) {
    return (
      <div style={{ ...glass(dark), padding: '14px 18px', pointerEvents: 'auto', fontSize: 12.5, color: t.text3 }}>
        <b style={{ color: t.text1 }}>Shipment tracking</b> — waiting for the first consignment…
      </div>
    )
  }
  const steps = TRACK_STEPS.filter(s => !s.hubOnly || cons.viaHub)
  const cur = steps.findIndex(s => cons.steps[s.key] == null)
  const tr = sim.trucks.find(x => x.cons === cons)
  return (
    <div style={{ ...glass(dark), padding: '12px 16px', pointerEvents: 'auto', display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 460px', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: t.text1 }}>🚚 Shipment Tracking</div>
          <div style={{ fontSize: 11.5, color: t.text3, fontWeight: 700 }}>{cons.truck || '—'} · {cons.id}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto' }}>
          {steps.map((s, i) => {
            const done = cons.steps[s.key] != null
            const active = i === cur
            const color = done ? pal.blue : active ? pal.gold : t.text4
            return (
              <div key={s.key} style={{ flex: '1 0 74px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                {i > 0 && <div style={{ position: 'absolute', top: 13, right: '50%', width: '100%', height: 3, background: done || active ? pal.blue : t.border, zIndex: 0 }} />}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? pal.blue : dark ? '#1c222c' : '#fff', border: `2.5px solid ${color}`, color: done ? '#fff' : color,
                  fontSize: 12, fontWeight: 900, animation: active ? 'simPulse 1.3s ease-in-out infinite' : 'none',
                }}>{done ? '✓' : i + 1}</div>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: done || active ? t.text1 : t.text3, marginTop: 5, textAlign: 'center', lineHeight: 1.2 }}>{s.label}</div>
                <div style={{ fontSize: 9.5, color: t.text3, textAlign: 'center' }}>{done ? fmtClock(cons.steps[s.key]) : s.sub}</div>
              </div>
            )
          })}
        </div>
      </div>
      <div onClick={onOpen} style={{ flex: '0 0 230px', borderRadius: 12, background: dark ? 'rgba(255,255,255,.04)' : '#f3f6fb', padding: '10px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: t.text1 }}>#{cons.id}</div>
        <div style={{ fontSize: 11.5, color: t.text2 }}>{cons.branch} → Head Office</div>
        <div><Chip text={consStatus(sim, cons)} color={cons.done ? pal.gold : pal.green} /></div>
        <div style={{ fontSize: 11, color: t.text3 }}>
          {cons.bills ? `${cons.bills} bills · ${fmtG(cons.weight)} g` : 'Bundling bills…'}
          {tr && !tr.bay ? ` · ETA ${truckEtaMin(tr)} min` : ''}
          {cons.result ? ` · ${fmtG(cons.result.fine)} g fine` : ''}
        </div>
      </div>
    </div>
  )
}

function OpsPanel({ sim, t, dark, pal, tab, setTab, onPick }) {
  const tabs = [
    ['docks', `Docks ${sim.bays.filter(b => b.truck).length}/${sim.bays.length}`],
    ['trucks', `Trucks ${sim.trucks.length}`],
    ['melting', 'Melting'],
    ['summary', 'Summary'],
    ['feed', 'Feed'],
  ]
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderTop: `1px solid ${t.border}`, fontSize: 12, cursor: 'pointer' }
  const bar = (p, color) => (
    <div style={{ width: 54, height: 5, borderRadius: 9, background: t.border, overflow: 'hidden' }}>
      <div style={{ width: `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`, height: '100%', background: color }} />
    </div>
  )
  let body
  if (tab === 'docks') {
    body = (
      <>
        {sim.bays.map(b => {
          const tr = b.truck != null ? sim.trucks.find(x => x.id === b.truck) : null
          const st = !tr ? ['Available', t.text3] : tr.state === 'unloading' ? ['Unloading', pal.green] : tr.state === 'leaving' ? ['Leaving', t.text3] : ['Docking', pal.blue]
          return (
            <div key={b.id} style={rowStyle} onClick={() => tr && onPick({ type: 'truck', id: tr.id })}>
              <div style={{ width: 48 }}><div style={{ fontWeight: 800, color: t.text1 }}>Bay {b.id}</div><div style={{ fontSize: 10, color: t.text3 }}>HO</div></div>
              <div style={{ flex: 1, color: tr ? t.text1 : t.text3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tr ? <>● {tr.code} · {tr.cons.branch}</> : 'No truck assigned'}
              </div>
              <Chip text={st[0]} color={st[1]} />
              {tr?.state === 'unloading' ? bar(1 - tr.timer / 2.4, pal.green) : <div style={{ width: 54 }} />}
            </div>
          )
        })}
        <div style={{ ...rowStyle, cursor: 'default' }}>
          <div style={{ width: 48, fontWeight: 800, color: t.text1 }}>Gate</div>
          <div style={{ flex: 1, color: t.text2 }}>{sim.queue.length ? `${sim.queue.length} truck(s) waiting for a bay` : 'Clear'}</div>
          <Chip text={sim.queue.length ? 'Queued' : 'Open'} color={sim.queue.length ? pal.orange : pal.green} />
        </div>
      </>
    )
  } else if (tab === 'trucks') {
    body = sim.trucks.length ? sim.trucks.map(tr => (
      <div key={tr.id} style={rowStyle} onClick={() => onPick({ type: 'truck', id: tr.id })}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: t.text1 }}>{tr.code} · {tr.cons.id}</div>
          <div style={{ fontSize: 10.5, color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr.cons.branch} · {tr.cons.bills} bills · {fmtG(tr.cons.weight)} g</div>
        </div>
        <Chip text={TRUCK_STATUS[tr.state]} color={tr.state === 'queued' ? pal.orange : tr.state === 'unloading' ? pal.green : pal.blue} />
        <div style={{ width: 46, textAlign: 'right', color: t.text2, fontWeight: 700 }}>{tr.bay ? `B${tr.bay}` : `${truckEtaMin(tr)}m`}</div>
      </div>
    )) : <div style={{ padding: '14px 2px', color: t.text3, fontSize: 12 }}>No trucks on the road.</div>
  } else if (tab === 'melting') {
    body = sim.stations.map((st, i) => {
      const lot = st.lot != null ? sim.lots.find(l => l.id === st.lot) : null
      const here = lot && lot.ti === i
      const state = !lot ? ['Idle', t.text3] : !here ? ['Incoming', pal.blue] : lot.phase === 'work' ? ['Working', pal.orange] : lot.phase === 'wait' ? ['Waiting', pal.gold] : ['Arriving', pal.blue]
      return (
        <div key={st.key} style={rowStyle} onClick={() => lot ? onPick({ type: 'lot', id: lot.id }) : onPick({ type: st.key === 'vault' ? 'vault' : 'line' })}>
          <div style={{ width: 78, fontWeight: 800, color: t.text1, fontSize: 11 }}>{st.label}</div>
          <div style={{ flex: 1, color: lot ? t.text1 : t.text3 }}>{lot ? lot.cons.id : '—'}</div>
          <Chip text={state[0]} color={state[1]} />
          {here && lot.phase === 'work' ? bar(1 - lot.timer / st.dur, pal.orange) : <div style={{ width: 54 }} />}
        </div>
      )
    })
  } else if (tab === 'summary') {
    body = sim.summary.length ? (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead>
          <tr>{['Consignment', 'Branch', 'Gross', 'Net', 'Purity', 'Fine'].map(h => <th key={h} style={{ textAlign: h === 'Consignment' || h === 'Branch' ? 'left' : 'right', padding: '6px 4px', color: t.text3, fontWeight: 800, borderBottom: `1px solid ${t.border}` }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {sim.summary.map(r => (
            <tr key={r.id} style={{ animation: 'simIn .3s ease' }}>
              <td style={{ padding: '5px 4px', color: t.text1, fontWeight: 700 }}>{r.id}</td>
              <td style={{ padding: '5px 4px', color: t.text2, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.branch}</td>
              <td style={{ padding: '5px 4px', color: t.text2, textAlign: 'right' }}>{fmtG(r.gross)}</td>
              <td style={{ padding: '5px 4px', color: t.text2, textAlign: 'right' }}>{fmtG(r.net)}</td>
              <td style={{ padding: '5px 4px', color: pal.green, textAlign: 'right', fontWeight: 800 }}>{r.purity}%</td>
              <td style={{ padding: '5px 4px', color: t.text1, textAlign: 'right', fontWeight: 800 }}>{fmtG(r.fine)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : <div style={{ padding: '14px 2px', color: t.text3, fontSize: 12 }}>No lots processed yet — the first batch is on its way.</div>
  } else {
    body = sim.log.length ? sim.log.slice(0, 14).map((e, i) => (
      <div key={e.id} style={{ display: 'flex', gap: 8, padding: '5px 2px', borderTop: `1px solid ${t.border}`, fontSize: 11.5, color: t.text2, animation: i === 0 ? 'simIn .3s ease' : 'none' }}>
        <span style={{ color: t.text3, fontVariantNumeric: 'tabular-nums' }}>{e.ts}</span>
        <span>{e.icon}</span>
        <span>{e.text}</span>
      </div>
    )) : <div style={{ padding: '14px 2px', color: t.text3, fontSize: 12 }}>Simulation starting…</div>
  }
  return (
    <div style={{ ...glass(dark), padding: '12px 14px', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 2, marginBottom: 6, overflowX: 'auto' }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '5px 8px', borderRadius: 8, border: `1px solid ${tab === k ? pal.blue + '55' : 'transparent'}`,
            background: tab === k ? pal.blue + '18' : 'transparent', color: tab === k ? pal.blue : t.text2,
            fontSize: 11.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>
      <div style={{ overflowY: 'auto', minHeight: 0 }}>{body}</div>
    </div>
  )
}

export default function ConsignmentMeltingSimulation() {
  const { theme, canSee, branches } = useApp()
  if (!canSee('simulation')) {
    const t = THEMES[theme] || THEMES.dark
    return (
      <div style={{ padding: 60, textAlign: 'center', color: t.text3 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text1 }}>Restricted</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>This module is limited to specific accounts.</div>
      </div>
    )
  }
  return <OpsSimulator theme={theme} branches={branches} />
}

export function OpsSimulator({ theme, branches }) {
  const isMobile = useMobile()
  const dark = theme !== 'light'
  const t = THEMES[theme] || THEMES.dark
  const pal = SCENE_PALETTES[dark ? 'dark' : 'light']

  const branchCount = Object.keys(branches || {}).length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => pickSceneBranches(branches), [branchCount])
  const simRef = useRef(null)
  // The sim is random, so it is only created on the client (after mount) to
  // keep server and client renders identical.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (mounted && (!simRef.current || simRef.current.scene !== scene)) simRef.current = warmSim(createSim(scene), 70)
  const sim = simRef.current

  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('docks')
  const [, forceRender] = useReducer(x => x + 1, 0)

  const playingRef = useRef(playing)
  const speedRef = useRef(speed)
  playingRef.current = playing
  speedRef.current = speed

  const vbRef = useRef({ ...FIT })
  const camRef = useRef({ ...FIT })
  const fit = isMobile ? FIT_MOBILE : FIT
  useEffect(() => {
    camRef.current = { ...fit }
    vbRef.current = { ...fit }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const dragRef = useRef({ active: false, moved: false })

  useEffect(() => {
    let raf
    let last = performance.now()
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (playingRef.current && simRef.current) {
        let rem = dt * speedRef.current
        while (rem > 1e-6) { const h = Math.min(0.05, rem); stepSim(simRef.current, h); rem -= h }
      }
      const vb = vbRef.current, cam = camRef.current, k = Math.min(1, dt * 7)
      vb.x += (cam.x - vb.x) * k; vb.y += (cam.y - vb.y) * k
      vb.w += (cam.w - vb.w) * k; vb.h += (cam.h - vb.h) * k
      forceRender()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const setCamera = (next, immediate) => {
    camRef.current = next
    if (immediate) vbRef.current = { ...next }
  }
  const zoomAt = (px, py, factor, immediate) => {
    const c = camRef.current
    const w = Math.max(MIN_W, Math.min(MAX_W, c.w * factor))
    const f = w / c.w
    setCamera({ x: px - (px - c.x) * f, y: py - (py - c.y) * f, w, h: c.h * f }, immediate)
  }
  const zoomCenter = (factor) => { const c = camRef.current; zoomAt(c.x + c.w / 2, c.y + c.h / 2, factor) }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e) => {
      const svg = svgRef.current
      if (!svg || !svg.contains(e.target)) return
      e.preventDefault()
      const pt = svg.createSVGPoint()
      pt.x = e.clientX; pt.y = e.clientY
      const p = pt.matrixTransform(svg.getScreenCTM().inverse())
      zoomAt(p.x, p.y, e.deltaY > 0 ? 1.12 : 1 / 1.12, true)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  const onPointerDown = (e) => {
    const svg = svgRef.current
    if (e.button !== 0 || !svg || !svg.contains(e.target)) return
    const rect = svg.getBoundingClientRect()
    const scale = Math.max(vbRef.current.w / rect.width, vbRef.current.h / rect.height)
    const start = { sx: e.clientX, sy: e.clientY, cam: { ...camRef.current } }
    dragRef.current = { active: true, moved: false }
    const move = (ev) => {
      const dx = ev.clientX - start.sx, dy = ev.clientY - start.sy
      if (!dragRef.current.moved && Math.hypot(dx, dy) < 4) return
      dragRef.current.moved = true
      setCamera({ ...start.cam, x: start.cam.x - dx * scale, y: start.cam.y - dy * scale }, true)
    }
    const up = () => {
      dragRef.current.active = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const select = useCallback((target) => (e) => {
    e.stopPropagation()
    if (dragRef.current.moved) return
    setSelected(target)
  }, [])

  const onSceneClick = (e) => {
    if (dragRef.current.moved) return
    if (svgRef.current && svgRef.current.contains(e.target)) setSelected(null)
  }

  if (!sim) {
    return <div style={{ height: isMobile ? '58vh' : 'calc(100vh - 90px)', margin: isMobile ? 10 : 16, borderRadius: 18, background: pal.sky, border: `1px solid ${t.border}` }} />
  }

  const selPos = selectedPosition(sim, selected)
  const activeSel = selPos ? selected : null
  const locate = () => {
    if (!selPos) return
    const [sx, sy] = P(selPos.x, selPos.y, 1)
    const w = Math.min(camRef.current.w, 950)
    const h = w * (fit.h / fit.w)
    setCamera({ x: sx - w / 2, y: sy - h / 2, w, h })
  }
  const restart = () => { simRef.current = createSim(scene); setSelected(null) }

  // ── derived numbers ────────────────────────────────────────────────────────
  const st = sim.stats
  const branchBills = sim.branches.reduce((s, b) => s + b.bills.length, 0)
  const branchBooked = sim.branches.reduce((s, b) => s + b.bills.filter(x => x.booked).length, 0)
  const onRoad = sim.trucks.filter(x => ['toHub', 'atHub', 'toHO', 'queued', 'docking'].includes(x.state)).length
  const docked = sim.bays.filter(b => b.truck).length
  const hoLots = sim.lots.filter(l => l.state === 'pad' || l.state === 'carried')
  const onLine = sim.lots.filter(l => l.state === 'belt').length
  const avgPurity = st.lotsDone ? st.puritySum / st.lotsDone : 0
  const level = Math.floor(st.score / LEVEL_PTS) + 1
  const levelProg = (st.score % LEVEL_PTS) / LEVEL_PTS

  let trackCons = null
  if (activeSel?.type === 'truck') trackCons = sim.trucks.find(x => x.id === activeSel.id)?.cons
  else if (activeSel?.type === 'lot') trackCons = sim.lots.find(x => x.id === activeSel.id)?.cons
  else if (activeSel?.type === 'branch') {
    const b = sim.branches.find(x => x.name === activeSel.id)
    trackCons = b?.creating?.cons || sim.consignments.find(c => c.branch === activeSel.id)
  }
  if (!trackCons) trackCons = [...sim.consignments].reverse().find(c => !c.done) || sim.consignments[0]
  const openTracked = () => {
    if (!trackCons) return
    const tr = sim.trucks.find(x => x.cons === trackCons)
    const lot = sim.lots.find(l => l.cons === trackCons)
    if (tr) setSelected({ type: 'truck', id: tr.id })
    else if (lot) setSelected({ type: 'lot', id: lot.id })
    else if (trackCons.done) setSelected({ type: 'vault' })
  }

  const ctrlBtn = (active) => ({
    padding: '7px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
    border: `1px solid ${active ? pal.blue : t.border}`, background: active ? pal.blue : 'transparent', color: active ? '#fff' : t.text2,
  })
  const zoomBtn = { width: 36, height: 36, border: 'none', background: 'transparent', color: t.text1, fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }

  const kpis = (
    <>
      <KpiCard t={t} dark={dark} icon="🏬" tint={pal.blue} label="Branch stock" value={branchBills} sub={`${branchBooked} booked · ${branchBills - branchBooked} unbooked`} />
      <KpiCard t={t} dark={dark} icon="🚚" tint={pal.blue} label="Trucks on road" value={onRoad} sub={`${docked}/${sim.bays.length} docked · ${sim.queue.length} queued`} />
      <KpiCard t={t} dark={dark} icon="🏢" tint={pal.green} label="HO stock" value={hoLots.length} sub={`lots · ${onLine} on melting line`} />
      <KpiCard t={t} dark={dark} icon="🥇" tint={pal.gold} label="Fine gold (g)" value={st.fine} decimals={1} sub={`${st.lotsDone} lots · ${avgPurity ? avgPurity.toFixed(1) + '% avg' : '—'}`} />
      <KpiCard t={t} dark={dark} icon="⭐" tint={pal.gold} label={`Score · Lv ${level}`} value={st.score}>
        <div style={{ width: 96, height: 5, borderRadius: 9, background: t.border, overflow: 'hidden', marginTop: 4 }}>
          <div style={{ width: `${levelProg * 100}%`, height: '100%', background: pal.gold, transition: 'width .4s ease' }} />
        </div>
      </KpiCard>
    </>
  )

  const detail = activeSel && (
    <DetailPanel sim={sim} sel={activeSel} t={t} dark={dark} pal={pal} onClose={() => setSelected(null)} onLocate={locate} />
  )
  const tracker = <Tracker sim={sim} cons={trackCons} t={t} dark={dark} pal={pal} onOpen={openTracked} />
  const ops = <OpsPanel sim={sim} t={t} dark={dark} pal={pal} tab={tab} setTab={setTab} onPick={setSelected} />

  return (
    <div style={{ padding: isMobile ? 10 : 16 }} className={playing ? undefined : 'sim-paused'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${pal.gold}, #8a5a10)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🎮</div>
          <div>
            <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 900, color: t.text1, display: 'flex', alignItems: 'center', gap: 8 }}>
              Ops Simulator
              <span style={{ fontSize: 10, fontWeight: 900, color: '#1a1208', background: pal.gold, padding: '2px 8px', borderRadius: 999, letterSpacing: '.06em' }}>DEMO</span>
            </div>
            <div style={{ fontSize: 12, color: t.text3 }}>Branch → Consignment → Head Office → Melting · synthetic data · drag to pan, scroll to zoom, click anything</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 999, background: pal.green + '1f', color: pal.green, fontWeight: 900, fontSize: 12.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: pal.green, animation: playing ? 'simBlink 1.2s ease-in-out infinite' : 'none' }} />
            {playing ? 'Live' : 'Paused'} {fmtClock(sim.clock)}
          </span>
          <button onClick={() => setPlaying(p => !p)} style={ctrlBtn(!playing)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
          {[1, 2, 4].map(sp => <button key={sp} onClick={() => setSpeed(sp)} style={ctrlBtn(sp === speed)}>{sp}×</button>)}
          <button onClick={restart} style={ctrlBtn(false)} title="Restart">↺</button>
        </div>
      </div>

      {isMobile && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 10 }}>{kpis}</div>}

      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onClick={onSceneClick}
        style={{
          position: 'relative', height: isMobile ? '58vh' : 'calc(100vh - 150px)', minHeight: isMobile ? 380 : 640,
          borderRadius: 18, overflow: 'hidden', background: pal.sky, border: `1px solid ${t.border}`,
          cursor: dragRef.current.active ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none',
        }}
      >
        <SimScene sim={sim} pal={pal} selected={activeSel} select={select} viewBox={vbRef.current} svgRef={svgRef} />

        {!isMobile && (
          <div style={{ position: 'absolute', top: 14, left: 14, right: activeSel ? 390 : 70, display: 'flex', gap: 10, flexWrap: 'wrap', pointerEvents: 'none' }}>
            {kpis}
          </div>
        )}

        <div style={{ position: 'absolute', top: 14, right: !isMobile && activeSel ? 338 : 14, ...glass(dark), padding: 3, display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}>
          <button style={zoomBtn} title="Zoom in" onClick={() => zoomCenter(1 / 1.25)}>+</button>
          <button style={zoomBtn} title="Zoom out" onClick={() => zoomCenter(1.25)}>−</button>
          <div style={{ height: 1, background: t.border, margin: '3px 6px' }} />
          <button style={{ ...zoomBtn, fontSize: 15 }} title="Fit to view" onClick={() => setCamera({ ...fit })}>⌂</button>
          <button style={{ ...zoomBtn, fontSize: 15, opacity: activeSel ? 1 : 0.35 }} title="Locate selection" onClick={locate}>⌖</button>
        </div>

        {!isMobile && activeSel && <div style={{ position: 'absolute', top: 14, right: 14 }}>{detail}</div>}

        {!isMobile && (
          <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, display: 'flex', gap: 12, alignItems: 'flex-end', pointerEvents: 'none' }}>
            <div style={{ flex: '0 0 390px', maxHeight: 270, display: 'flex' }}>{ops}</div>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>{tracker}</div>
          </div>
        )}
      </div>

      {isMobile && (
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {detail}
          {tracker}
          <div style={{ maxHeight: 320, display: 'flex' }}>{ops}</div>
        </div>
      )}

      <style>{`
        @keyframes simBob    { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
        @keyframes simFlick  { 0%, 100% { opacity: 1 } 45% { opacity: .72 } 70% { opacity: .9 } }
        @keyframes simSmoke  { 0% { transform: translate(0,0) scale(.5); opacity: .55 } 100% { transform: translate(-16px,-52px) scale(1.9); opacity: 0 } }
        @keyframes simDash   { to { stroke-dashoffset: -28 } }
        @keyframes simBlink  { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }
        @keyframes simPulse  { 0%, 100% { box-shadow: 0 0 0 0 ${pal.gold}66 } 50% { box-shadow: 0 0 0 6px ${pal.gold}00 } }
        @keyframes simIn     { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }
        .sim-bob     { animation: simBob 1.2s ease-in-out infinite }
        .sim-flicker { animation: simFlick .5s ease-in-out infinite }
        .sim-smoke   { transform-box: fill-box; transform-origin: center; animation: simSmoke 1.8s ease-out infinite }
        .sim-ring    { stroke-dasharray: 8 6; animation: simDash 1s linear infinite }
        .sim-paused * { animation-play-state: paused !important }
      `}</style>
    </div>
  )
}
