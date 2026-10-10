'use client'

// Consignment & Melting — Live Simulation.
// A self-contained, synthetic-data "game" view of the full branch → consignment
// → Head Office → melting pipeline, built for a single demo account
// (see PAGE_EMAIL_ALLOWLIST.simulation in lib/context.js). No real data is
// read or written here — shipments are generated and advanced locally on a
// timer. Animation is plain CSS transitions/@keyframes (no animation lib in
// this repo), matching the house convention used elsewhere (LiveFeedFlashcards,
// ConsignmentData, etc.) of a single global <style>{`@keyframes ...`}</style>.

import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'

const BRANCHES = [
  { id: 'HUBLI',      name: 'Hubli',      short: 'HBL', hub: null,      region: 'Rest of Karnataka' },
  { id: 'DHARWAD',    name: 'Dharwad',    short: 'DWD', hub: 'HUBLI',   region: 'Rest of Karnataka' },
  { id: 'MYSURU',     name: 'Mysuru',     short: 'MYS', hub: null,      region: 'Bangalore' },
  { id: 'MANGALURU',  name: 'Mangaluru',  short: 'MLR', hub: null,      region: 'Rest of Karnataka' },
  { id: 'VIJAYAWADA', name: 'Vijayawada', short: 'VJW', hub: null,      region: 'Andhra Pradesh' },
  { id: 'KOCHI',      name: 'Kochi',      short: 'KCH', hub: null,      region: 'Kerala' },
]

const MAX_ACTIVE   = 9
const MAX_LANES    = 5
const LINGER_TICKS = 6   // how long a finished shipment stays visible before pruning

const STAGE_META = {
  booked:        { label: 'Booked',               icon: '📦' },
  consignment:   { label: 'Consignment created',  icon: '🧾' },
  transit:       { label: 'In transit',           icon: '🚚' },
  ho_received:   { label: 'Received at HO',       icon: '🏢' },
  melting_scan:  { label: 'Scanned for melting',  icon: '🔎' },
  weigh_before:  { label: 'Weighed (before)',     icon: '⚖️' },
  melting:       { label: 'Melting',              icon: '🔥' },
  weigh_after:   { label: 'Weighed (after)',      icon: '⚖️' },
  purity:        { label: 'Purity check',         icon: '🧪' },
  done:          { label: 'Processed',            icon: '🥇' },
}

const rnd  = (a, b) => a + Math.random() * (b - a)
const rndi = (a, b) => Math.floor(rnd(a, b + 1))
const pick = (arr) => arr[rndi(0, arr.length - 1)]
const clock = () => new Date().toLocaleTimeString('en-IN', { hour12: false })
const billId = () => 'WG' + rndi(100000, 999999)

let shipmentSeq = 1
let batchSeq = 1

function spawnShipment() {
  const branch = pick(BRANCHES)
  const bills = rndi(3, 14)
  const avgPerBill = rnd(7, 14) // grams
  const weight = +(bills * avgPerBill * rnd(0.9, 1.1)).toFixed(1)
  const viaHub = !!branch.hub
  return {
    seq: shipmentSeq++,
    id: billId(),
    branch,
    bills,
    weight,
    viaHub,
    stage: 'booked',
    t: 0,              // ticks spent in current stage
    dur: rndi(3, 6),    // ticks needed in current stage
    lane: rndi(0, MAX_LANES - 1),
    progress: 0,         // 0..1, used only during 'transit'
    transitTicks: rndi(22, 36) + (viaHub ? 10 : 0),
    grossWeight: null,
    netWeight: null,
    purity: null,
  }
}

// Pure stage-advance. Mutates nothing; returns { shipment, events } where
// shipment === null means "drop from the active list".
function advance(s, log, completed, counters) {
  const next = { ...s, t: s.t + 1 }

  if (next.stage === 'transit') {
    next.progress = Math.min(1, next.progress + 1 / next.transitTicks)
    if (next.progress >= 1) {
      next.stage = 'ho_received'
      next.t = 0
      next.dur = rndi(3, 5)
      counters.atHOIn++
      log.push({ ts: clock(), icon: '🏢', text: `${next.id} received at Head Office — ${next.bills} bills, ${next.weight}g` })
    }
    return next
  }

  if (next.t < next.dur) {
    // Mid-stage micro-events, purely cosmetic (checklist ticks in the UI).
    return next
  }

  // Stage boundary reached — transition.
  switch (next.stage) {
    case 'booked':
      next.stage = 'consignment'
      next.t = 0
      next.dur = rndi(5, 8)
      log.push({ ts: clock(), icon: '🧾', text: `${next.id} — consignment created · QR generated · doc emailed to ${next.branch.name}` })
      break
    case 'consignment':
      next.stage = 'transit'
      next.t = 0
      next.progress = 0
      counters.dispatched++
      counters.weightDispatched += next.weight
      log.push({ ts: clock(), icon: '✅', text: `${next.id} marked as moved${next.viaHub ? ` via ${next.branch.hub} hub` : ''} · e-Invoice/EWB generated (ClearTax)` })
      break
    case 'ho_received':
      next.stage = 'melting_scan'
      next.t = 0
      next.dur = 3
      break
    case 'melting_scan':
      next.stage = 'weigh_before'
      next.t = 0
      next.dur = 2
      break
    case 'weigh_before':
      next.grossWeight = +(next.weight * rnd(0.98, 1.0)).toFixed(1)
      next.stage = 'melting'
      next.t = 0
      next.dur = rndi(10, 16)
      counters.atHOIn--
      counters.melting++
      log.push({ ts: clock(), icon: '🔥', text: `Batch for ${next.id} entered the furnace — gross ${next.grossWeight}g` })
      break
    case 'melting':
      next.stage = 'weigh_after'
      next.t = 0
      next.dur = 2
      counters.melting--
      break
    case 'weigh_after':
      next.netWeight = +(next.grossWeight * rnd(0.965, 0.99)).toFixed(1)
      next.stage = 'purity'
      next.t = 0
      next.dur = 3
      break
    case 'purity': {
      next.purity = +rnd(91, 96.5).toFixed(1)
      next.stage = 'done'
      next.t = 0
      next.dur = LINGER_TICKS
      const fine = +(next.netWeight * next.purity / 100).toFixed(1)
      next.fineGold = fine
      counters.totalBillsProcessed += next.bills
      counters.totalFineGold += fine
      counters.puritySum += next.purity
      counters.batchesCompleted++
      counters.score += Math.round(fine * 3 + next.bills * 6)
      completed.unshift({
        batch: 'B' + batchSeq++,
        id: next.id,
        branch: next.branch.short,
        gross: next.grossWeight,
        net: next.netWeight,
        purity: next.purity,
        fine,
      })
      if (completed.length > 8) completed.length = 8
      log.push({ ts: clock(), icon: '🥇', text: `${next.id} processed — ${next.purity}% purity, ${fine}g fine gold` })
      break
    }
    case 'done':
      return null // prune
    default:
      break
  }
  return next
}

function useCountUp(target, duration = 550) {
  const [val, setVal] = useState(target)
  const rafRef = useRef(null)
  const fromRef = useRef(target)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    const start = performance.now()
    const startVal = fromRef.current
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(startVal + (target - startVal) * eased)
      if (p < 1) rafRef.current = requestAnimationFrame(step)
      else fromRef.current = target
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  return val
}

function KpiCard({ t, icon, label, value, decimals = 0, accent }) {
  const shown = useCountUp(value)
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{icon}</span>{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || t.text1, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {shown.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
      </div>
    </div>
  )
}

function Highway({ t, shipments, isMobile }) {
  const laneH = isMobile ? 26 : 30
  const height = MAX_LANES * laneH + 20
  const transitShips = shipments.filter(s => s.stage === 'transit')
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
        Branch → Head Office highway
      </div>
      <div style={{ position: 'relative', height, borderRadius: 10, background: t.card2 }}>
        {/* Lane guide lines */}
        {Array.from({ length: MAX_LANES }).map((_, i) => (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: 10 + i * laneH + laneH / 2, height: 1, background: t.border, opacity: 0.6 }} />
        ))}
        {/* Origin + destination markers */}
        <div style={{ position: 'absolute', left: 8, top: 4, fontSize: 11, fontWeight: 800, color: t.text3 }}>🏬 Branches</div>
        <div style={{ position: 'absolute', right: 8, top: 4, fontSize: 11, fontWeight: 800, color: t.gold }}>🏢 HEAD OFFICE</div>
        {/* Trucks */}
        {transitShips.map(s => (
          <div
            key={s.seq}
            title={`${s.id} · ${s.branch.name} · ${s.bills} bills · ${s.weight}g`}
            style={{
              position: 'absolute',
              left: `calc(${4 + s.progress * 88}% - 10px)`,
              top: 10 + s.lane * laneH + laneH / 2 - 10,
              transition: 'left 200ms linear',
              display: 'flex', alignItems: 'center', gap: 5,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: 16, display: 'inline-block', animation: 'simBob 0.6s ease-in-out infinite' }}>🚚</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: t.text2, background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, padding: '1px 5px' }}>
              {s.branch.short} · {s.weight}g
            </span>
          </div>
        ))}
        {transitShips.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, color: t.text4 }}>
            Waiting for the next dispatch…
          </div>
        )}
      </div>
    </div>
  )
}

function StageCard({ t, s }) {
  const meta = STAGE_META[s.stage]
  const steps = ['QR', 'Doc', 'Email']
  const stepsDone = s.stage === 'consignment' ? Math.min(3, Math.ceil((s.t / s.dur) * 3)) : s.stage === 'booked' ? 0 : 3
  return (
    <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, color: t.text1 }}>
        <span>{s.id}</span>
        <span style={{ color: t.text3, fontWeight: 600 }}>{s.branch.short}</span>
      </div>
      <div style={{ fontSize: 10, color: t.text3, marginTop: 2 }}>{s.bills} bills · {s.weight}g</div>
      <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
        {steps.map((st, i) => (
          <span key={st} style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
            color: i < stepsDone ? t.goldText : t.text4,
            background: i < stepsDone ? t.gold : 'transparent',
            border: `1px solid ${i < stepsDone ? t.gold : t.border}`,
          }}>{i < stepsDone ? '✓ ' : ''}{st}</span>
        ))}
      </div>
      <div style={{ fontSize: 9.5, color: t.text4, marginTop: 5 }}>{meta.icon} {meta.label}</div>
    </div>
  )
}

function MeltingFloor({ t, shipments }) {
  const active = shipments.filter(s => ['ho_received', 'melting_scan', 'weigh_before', 'melting', 'weigh_after', 'purity'].includes(s.stage))
  const furnace = active.find(s => s.stage === 'melting')
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: '16px 10px', borderRadius: 10, marginBottom: 10,
        background: furnace ? 'radial-gradient(ellipse at center, rgba(224,85,85,.18), transparent 70%)' : 'transparent',
        border: `1px solid ${t.border}`,
      }}>
        <span style={{ fontSize: 30, animation: furnace ? 'simGlow 1s ease-in-out infinite' : 'none', filter: furnace ? 'none' : 'grayscale(0.6) opacity(0.5)' }}>🔥</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: t.text1 }}>{furnace ? `Melting ${furnace.id}` : 'Furnace idle'}</div>
          {furnace && (
            <div style={{ width: 140, height: 5, borderRadius: 999, background: t.border, marginTop: 5, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, (furnace.t / furnace.dur) * 100)}%`, height: '100%', background: t.red, transition: 'width 200ms linear' }} />
            </div>
          )}
        </div>
      </div>
      {active.length === 0 && <div style={{ fontSize: 11.5, color: t.text4, textAlign: 'center', padding: '10px 0' }}>No batches at HO right now.</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {active.slice(0, 4).map(s => (
          <div key={s.seq} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '5px 8px', borderRadius: 8, background: t.card2 }}>
            <span style={{ color: t.text2, fontWeight: 600 }}>{STAGE_META[s.stage].icon} {s.id}</span>
            <span style={{ color: t.text4 }}>
              {s.stage === 'purity' && s.purity != null ? `${s.purity}% purity` : s.grossWeight != null ? `${s.grossWeight}g` : `${s.weight}g`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryTable({ t, completed }) {
  if (completed.length === 0) {
    return <div style={{ fontSize: 11.5, color: t.text4, textAlign: 'center', padding: '14px 0' }}>No batches processed yet.</div>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {['Batch', 'Bill', 'Branch', 'Gross g', 'Net g', 'Purity', 'Fine g'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '4px 6px', color: t.text4, fontWeight: 700, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {completed.map(r => (
            <tr key={r.batch} style={{ animation: 'simFadeIn 0.4s ease' }}>
              <td style={{ padding: '4px 6px', color: t.gold, fontWeight: 700 }}>{r.batch}</td>
              <td style={{ padding: '4px 6px', color: t.text2 }}>{r.id}</td>
              <td style={{ padding: '4px 6px', color: t.text2 }}>{r.branch}</td>
              <td style={{ padding: '4px 6px', color: t.text2 }}>{r.gross}</td>
              <td style={{ padding: '4px 6px', color: t.text2 }}>{r.net}</td>
              <td style={{ padding: '4px 6px', color: t.green, fontWeight: 700 }}>{r.purity}%</td>
              <td style={{ padding: '4px 6px', color: t.text1, fontWeight: 700 }}>{r.fine}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EventLog({ t, log }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
        Live feed
      </div>
      <div style={{ display: 'grid', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
        {log.length === 0 && <div style={{ fontSize: 11.5, color: t.text4 }}>Simulation starting…</div>}
        {log.map((e, i) => (
          <div key={i} style={{ fontSize: 11.5, color: t.text2, display: 'flex', gap: 7, animation: i === 0 ? 'simFadeIn 0.4s ease' : 'none' }}>
            <span style={{ color: t.text4, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{e.ts}</span>
            <span style={{ flexShrink: 0 }}>{e.icon}</span>
            <span>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ConsignmentMeltingSimulation() {
  const { theme, user, canSee } = useApp()
  const isMobile = useMobile()
  const t = THEMES[theme] || THEMES.dark
  const allowed = canSee('simulation')

  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [, forceRender] = useReducer(x => x + 1, 0)

  const shipmentsRef  = useRef([])
  const completedRef  = useRef([])
  const logRef        = useRef([])
  const countersRef   = useRef({
    dispatched: 0, weightDispatched: 0, atHOIn: 0, melting: 0,
    totalBillsProcessed: 0, totalFineGold: 0, puritySum: 0, batchesCompleted: 0, score: 0,
  })
  const spawnCooldownRef = useRef(0)

  const tick = useCallback(() => {
    const c = countersRef.current
    const log = []
    const completedPushed = []
    const next = []
    for (const s of shipmentsRef.current) {
      const ns = advance(s, log, completedPushed, c)
      if (ns) next.push(ns)
    }
    spawnCooldownRef.current--
    if (spawnCooldownRef.current <= 0 && next.length < MAX_ACTIVE) {
      next.push(spawnShipment())
      spawnCooldownRef.current = rndi(2, 5)
      log.push({ ts: clock(), icon: '📦', text: `New bill ${next[next.length - 1].id} booked at ${next[next.length - 1].branch.name}` })
    }
    shipmentsRef.current = next
    if (completedPushed.length) {
      completedRef.current = [...completedPushed, ...completedRef.current].slice(0, 8)
    }
    if (log.length) {
      logRef.current = [...log.reverse(), ...logRef.current].slice(0, 14)
    }
    forceRender()
  }, [])

  useEffect(() => {
    if (!allowed || !playing) return
    const id = setInterval(tick, 200 / speed)
    return () => clearInterval(id)
  }, [allowed, playing, speed, tick])

  const liveShipments = shipmentsRef.current
  // Recomputed every render (forced once per tick) — the list is tiny (<=9),
  // and stages change far more often than the array's length, so memoizing
  // on length alone would show stale counts.
  const stageCounts = { transit: 0, atHO: 0, melting: 0, consignment: 0 }
  for (const s of liveShipments) {
    if (s.stage === 'transit') stageCounts.transit++
    else if (s.stage === 'ho_received') stageCounts.atHO++
    else if (['melting_scan', 'weigh_before', 'melting', 'weigh_after', 'purity'].includes(s.stage)) stageCounts.melting++
    else if (['booked', 'consignment'].includes(s.stage)) stageCounts.consignment++
  }

  if (!allowed) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: t.text3 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text1 }}>Restricted</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>This module is limited to specific accounts.</div>
      </div>
    )
  }

  const c = countersRef.current
  const avgPurity = c.batchesCompleted ? c.puritySum / c.batchesCompleted : 0
  const consignmentItems = liveShipments.filter(s => ['booked', 'consignment'].includes(s.stage)).slice(0, 4)

  const btn = (active) => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? t.gold : t.border}`,
    background: active ? t.gold : t.card2,
    color: active ? t.goldText : t.text2,
  })

  return (
    <div style={{ padding: isMobile ? 12 : 20, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 800, color: t.text1, display: 'flex', alignItems: 'center', gap: 8 }}>
            🎮 Consignment &amp; Melting — Live Simulation
            <span style={{ fontSize: 10, fontWeight: 800, color: t.goldText, background: t.gold, padding: '2px 8px', borderRadius: 999, letterSpacing: '.06em' }}>DEMO</span>
          </div>
          <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>
            Synthetic data only — a playground view of the full branch → consignment → Head Office → melting pipeline, {user?.email}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setPlaying(p => !p)} style={btn(playing)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
          {[1, 2, 4].map(sp => (
            <button key={sp} onClick={() => setSpeed(sp)} style={btn(sp === speed)}>{sp}×</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(6,1fr)', gap: 10, marginBottom: 16 }}>
        <KpiCard t={t} icon="📦" label="Bills booked" value={c.dispatched + stageCounts.consignment} />
        <KpiCard t={t} icon="🚚" label="In transit" value={stageCounts.transit} />
        <KpiCard t={t} icon="🏢" label="At HO" value={stageCounts.atHO} />
        <KpiCard t={t} icon="🔥" label="Melting now" value={stageCounts.melting} />
        <KpiCard t={t} icon="🥇" label="Fine gold (g)" value={c.totalFineGold} decimals={1} accent={t.green} />
        <KpiCard t={t} icon="⭐" label="Score" value={c.score} accent={t.gold} />
      </div>

      <Highway t={t} shipments={liveShipments} isMobile={isMobile} />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Consignment creation
          </div>
          {consignmentItems.length === 0 && <div style={{ fontSize: 11.5, color: t.text4, textAlign: 'center', padding: '14px 0' }}>No bills being bundled right now.</div>}
          <div style={{ display: 'grid', gap: 6 }}>
            {consignmentItems.map(s => <StageCard key={s.seq} t={t} s={s} />)}
          </div>
        </div>

        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Melting floor
          </div>
          <MeltingFloor t={t} shipments={liveShipments} />
        </div>

        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Gold processing summary · avg purity {avgPurity.toFixed(1)}%
          </div>
          <SummaryTable t={t} completed={completedRef.current} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <EventLog t={t} log={logRef.current} />
      </div>

      <style>{`
        @keyframes simBob    { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
        @keyframes simGlow   { 0%, 100% { filter: brightness(1) } 50% { filter: brightness(1.35) } }
        @keyframes simFadeIn { from { opacity: 0; transform: translateY(-3px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
    </div>
  )
}
