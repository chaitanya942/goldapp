// Ops simulation engine — pure data + stepSim(sim, dt). No React, no I/O.
// World units are iso grid cells (see iso.js); time is seconds of sim time.
// Everything here is synthetic: bills, weights, purities and EWB numbers are
// random. Only the branch/hub NAMES come from the real branches table.

export const TRUNK_Y     = 14
export const COLLECTOR_X = 6
export const GATE_X      = 19.5
export const EXIT_X      = 58
export const BAY_Y       = 11.4
export const BAYS_X      = [24.6, 28.2, 31.8]
export const HUB         = { x0: 13, x1: 17, y0: 6.6, y1: 9.8, stopX: 15, stopY: 11.3 }
// Melting line runs beside the HO along -y: lots enter near the trunk and
// travel "up" the screen into the vault.
export const CONVEYOR    = { x: 37.6, y0: 12.4, y1: 1.3 }
export const FURNACE     = { x0: 36.4, x1: 38.8, y0: 6.2, y1: 8.6 }
export const VAULT       = { x0: 36.3, x1: 39.5, y0: -1.6, y1: 1.3 }
export const FORK_LANE_Y = 13.0
export const DROP_LANE_X = 36.65
export const DROP        = { x: 36.7, y: CONVEYOR.y0 }
export const BRANCH_YC   = [2, 6, 10, 18, 22, 26]
export const VAULT_PAD   = { x0: 39.2, y0: 1.8 }

export const STATIONS = [
  { key: 'scan',     label: 'SCAN',      y: 11.4, dur: 1.0 },
  { key: 'weighIn',  label: 'WEIGH-IN',  y: 9.8,  dur: 1.4 },
  { key: 'furnace',  label: 'FURNACE',   y: 7.4,  dur: 4.5 },
  { key: 'weighOut', label: 'WEIGH-OUT', y: 5.0,  dur: 1.4 },
  { key: 'purity',   label: 'PURITY',    y: 3.0,  dur: 1.7 },
  { key: 'vault',    label: 'VAULT',     y: 1.4,  dur: 0.3 },
]

export const CREATE_PHASES = [
  { key: 'qr',    pin: 'QR',  text: 'QR code generated' },
  { key: 'doc',   pin: 'DOC', text: 'Consignment doc generated' },
  { key: 'email', pin: '✉',   text: 'Emailed to branch ✓' },
  { key: 'route', pin: '⇄',   text: null },
  { key: 'moved', pin: '✓',   text: 'Marked moved · EWB via ClearTax' },
]

export const TRACK_STEPS = [
  { key: 'created',  label: 'Consignment created', sub: 'QR · Doc · Email' },
  { key: 'moved',    label: 'Marked moved',        sub: 'EWB · ClearTax' },
  { key: 'hub',      label: 'Hub consolidation',   sub: 'via hub', hubOnly: true },
  { key: 'received', label: 'Received at HO',      sub: 'Dock bay' },
  { key: 'scanned',  label: 'Scanned',             sub: 'Melting line' },
  { key: 'melted',   label: 'Melted',              sub: 'Furnace' },
  { key: 'purity',   label: 'Purity check',        sub: 'XRF lab' },
  { key: 'vault',    label: 'In vault',            sub: 'Fine gold' },
]

export const TRUCK_STATUS = {
  toHub: 'To hub', atHub: 'At hub', toHO: 'To HO', queued: 'Queued at gate',
  docking: 'Docking', unloading: 'Unloading', leaving: 'Returning',
}

const TRUCK_SPEED = 4.2
const QUEUE_SPEED = 3
const FORK_SPEED  = 3.2
const BELT_SPEED  = 2
const MAX_TRUCKS  = 6
const FLIP = { 'x+': 'x-', 'x-': 'x+', 'y+': 'y-', 'y-': 'y+' }

const rnd  = (a, b) => a + Math.random() * (b - a)
const rndi = (a, b) => Math.floor(rnd(a, b + 1))

export const fmtClock = (m) => {
  const h = Math.floor(m / 60) % 24
  const mm = Math.floor(m % 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// Choose up to 6 real branches for the scene: the hub with the most leaf
// branches (2 of its leaves route via it), the rest direct, spread across regions.
export function pickSceneBranches(branchMap) {
  const all = Object.values(branchMap || {}).filter(b => b && b.name)
  const byName = new Map(all.map(b => [b.name.toUpperCase(), b]))
  const leavesByHub = new Map()
  for (const b of all) {
    const h = String(b.hub_branch_name || '').toUpperCase()
    if (h && h !== b.name.toUpperCase() && byName.has(h)) {
      if (!leavesByHub.has(h)) leavesByHub.set(h, [])
      leavesByHub.get(h).push(b)
    }
  }
  const byNameCmp = (a, b) => a.name.localeCompare(b.name)
  const best = [...leavesByHub.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  const hub = best ? byName.get(best[0]) : null
  const viaHub = best && best[1].length >= 1 ? [...best[1]].sort(byNameCmp).slice(0, 2) : []

  const used = new Set([hub?.name, ...viaHub.map(b => b.name)])
  const byRegion = new Map()
  for (const b of all) {
    if (used.has(b.name) || b.is_hub || b.hub_branch_name) continue
    const r = b.region || ''
    if (!byRegion.has(r)) byRegion.set(r, [])
    byRegion.get(r).push(b)
  }
  for (const list of byRegion.values()) list.sort(byNameCmp)
  const regions = [...byRegion.keys()].sort()
  const direct = []
  const need = 6 - viaHub.length
  for (let round = 0; direct.length < need && regions.some(r => byRegion.get(r).length > round); round++) {
    for (const r of regions) {
      const b = byRegion.get(r)[round]
      if (b && direct.length < need) direct.push(b)
    }
  }

  const picked = [
    ...viaHub.map(b => ({ name: b.name, region: b.region || '', viaHub: true })),
    ...direct.map(b => ({ name: b.name, region: b.region || '', viaHub: false })),
  ]
  for (let i = picked.length; i < 6; i++) picked.push({ name: `Branch ${i + 1}`, region: '', viaHub: false })
  return {
    hubName: hub ? hub.name : null,
    branches: picked.slice(0, 6).map((b, i) => ({ ...b, yc: BRANCH_YC[i] })),
  }
}

export function createSim(scene) {
  return {
    scene,
    t: 0,
    clock: 9 * 60,
    seq: 1,
    consSeq: 700 + rndi(0, 200),
    truckSeq: 1,
    billTimer: 0.4,
    branches: scene.branches.map(b => ({ ...b, bills: [], creating: null, sent: 0, threshold: rndi(4, 7) })),
    trucks: [],
    lots: [],
    popups: [],
    log: [],
    summary: [],
    consignments: [],
    queue: [],
    bays: BAYS_X.map((x, i) => ({ id: i + 1, x, truck: null })),
    stations: STATIONS.map(s => ({ ...s, lot: null })),
    forklifts: [
      { id: 'FL-01', x: 35.4, y: FORK_LANE_Y, home: [35.4, FORK_LANE_Y], heading: 'x-', path: [], state: 'idle', lot: null, timer: 0 },
      { id: 'FL-02', x: 34.3, y: FORK_LANE_Y, home: [34.3, FORK_LANE_Y], heading: 'x-', path: [], state: 'idle', lot: null, timer: 0 },
    ],
    vaultBars: 0,
    stats: {
      billsBorn: 0, booked: 0, consSent: 0, received: 0, receivedWeight: 0,
      melted: 0, gross: 0, net: 0, fine: 0, puritySum: 0, lotsDone: 0, score: 0, hubStops: 0,
    },
  }
}

function popup(sim, x, y, z, text, color = 'gold', big = false) {
  sim.popups.push({ id: sim.seq++, x, y, z, text, color, big, age: 0 })
}

function log(sim, icon, text) {
  sim.log.unshift({ id: sim.seq++, ts: fmtClock(sim.clock), icon, text })
  if (sim.log.length > 40) sim.log.length = 40
}

const ewbNo = () => String(rndi(1, 9)) + Array.from({ length: 11 }, () => rndi(0, 9)).join('')

// Moves e toward e.path[0] at speed; returns the waypoint when one carrying an
// action is reached (caller handles it), else null.
function stepPath(e, speed, dt) {
  let remaining = speed * dt
  while (remaining > 0 && e.path.length) {
    const wp = e.path[0]
    const dx = wp.x - e.x, dy = wp.y - e.y
    const dist = Math.hypot(dx, dy)
    if (dist > 1e-4) {
      const h = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'x+' : 'x-') : (dy > 0 ? 'y+' : 'y-')
      e.heading = wp.reverse ? FLIP[h] : h
    }
    if (dist <= remaining) {
      e.x = wp.x; e.y = wp.y
      remaining -= dist
      e.path.shift()
      if (wp.action) return wp
    } else {
      e.x += (dx / dist) * remaining
      e.y += (dy / dist) * remaining
      remaining = 0
    }
  }
  return null
}

export function pathRemaining(e) {
  let d = 0, px = e.x, py = e.y
  for (const wp of e.path) { d += Math.hypot(wp.x - px, wp.y - py); px = wp.x; py = wp.y }
  return d
}

export const truckEtaMin = (tr) => Math.round((pathRemaining(tr) / TRUCK_SPEED + (tr.wait || 0)) * 2)

const freeBay = (sim) => sim.bays.find(b => !b.truck)

function assignBay(sim, tr, bay) {
  bay.truck = tr.id
  tr.bay = bay.id
  tr.state = 'docking'
  tr.path = [{ x: bay.x, y: TRUNK_Y }, { x: bay.x, y: BAY_Y, action: 'bay' }]
}

function spawnBills(sim, dt) {
  sim.billTimer -= dt
  if (sim.billTimer > 0) return
  sim.billTimer = rnd(0.6, 1.5)
  const open = sim.branches.filter(b => b.bills.length < 20)
  if (!open.length) return
  const b = open[rndi(0, open.length - 1)]
  const w = +rnd(5, 32).toFixed(1)
  b.bills.push({ w, booked: false, born: sim.t })
  sim.stats.billsBorn++
  sim.stats.score += 5
  popup(sim, 1.8, b.yc + 1.9, 1.3, `+1 bill · ${w} g`, 'muted')
}

function dispatch(sim, b, cons) {
  const bills = b.bills.splice(0)
  cons.bills = bills.length
  cons.booked = bills.filter(x => x.booked).length
  cons.weight = +bills.reduce((s, x) => s + x.w, 0).toFixed(1)
  cons.steps.moved = sim.clock
  b.creating = null
  b.threshold = rndi(4, 8)
  b.sent++
  const path = [{ x: COLLECTOR_X, y: b.yc }, { x: COLLECTOR_X, y: TRUNK_Y }]
  if (b.viaHub) {
    path.push(
      { x: HUB.stopX, y: TRUNK_Y },
      { x: HUB.stopX, y: HUB.stopY, action: 'hub' },
      { x: HUB.stopX, y: TRUNK_Y, reverse: true },
    )
  }
  path.push({ x: GATE_X, y: TRUNK_Y, action: 'gate' })
  const truck = {
    id: sim.seq++, code: `TRK-${2000 + sim.truckSeq++}`, cons, branch: b.name,
    x: 3.9, y: b.yc, heading: 'x+', path, state: b.viaHub ? 'toHub' : 'toHO', wait: 0, timer: 0, bay: null,
  }
  cons.truck = truck.code
  sim.trucks.push(truck)
  sim.stats.consSent++
  sim.stats.score += 20
  popup(sim, 4.2, b.yc, 1.8, `Loaded ${cons.bills} bills`, 'gold')
  log(sim, '🚚', `${cons.id} marked moved from ${b.name} — ${cons.bills} bills, ${cons.weight} g · EWB ${cons.ewb}`)
}

function branchesStep(sim, dt) {
  for (const b of sim.branches) {
    for (const bill of b.bills) {
      if (!bill.booked && Math.random() < dt * 0.2) { bill.booked = true; sim.stats.booked++; sim.stats.score += 3 }
    }
    if (b.creating) {
      b.creating.timer -= dt
      if (b.creating.timer > 0) continue
      const ph = CREATE_PHASES[b.creating.phase]
      const text = ph.key === 'route'
        ? (b.viaHub ? `Route → via ${sim.scene.hubName} hub` : 'Route → direct to HO')
        : ph.text
      popup(sim, 1.8, b.yc, 2.6, text, ph.key === 'moved' ? 'green' : 'blue')
      if (ph.key === 'moved') dispatch(sim, b, b.creating.cons)
      else { b.creating.phase++; b.creating.timer = 0.8 }
      continue
    }
    const age = b.bills.length ? sim.t - b.bills[0].born : 0
    // Backpressure: hold new consignments while the road or HO is saturated.
    const active = sim.trucks.filter(t => t.state !== 'leaving').length
    if (active < MAX_TRUCKS && sim.lots.length < 7 && (b.bills.length >= b.threshold || (b.bills.length >= 2 && age > 24))) {
      const cons = {
        id: `WG${String(++sim.consSeq).padStart(6, '0')}`, branch: b.name, viaHub: b.viaHub,
        ewb: ewbNo(), steps: { created: sim.clock }, bills: 0, booked: 0, weight: 0, done: false,
      }
      sim.consignments.unshift(cons)
      if (sim.consignments.length > 30) sim.consignments.length = 30
      b.creating = { phase: 0, timer: 0.8, cons }
      log(sim, '🧾', `${cons.id} created at ${b.name} — QR + consignment doc generated`)
    }
  }
}

function finishUnload(sim, tr) {
  const bay = sim.bays.find(b => b.truck === tr.id)
  const onPad = sim.lots.filter(l => l.state === 'pad' && l.bay === bay.id).length
  sim.lots.push({
    id: sim.seq++, cons: tr.cons, bay: bay.id,
    x: bay.x + 1.45, y: 10.85 + Math.min(onPad, 1) * 0.95,
    state: 'pad', claimed: false, form: 'pallet', bills: tr.cons.bills, weight: tr.cons.weight,
  })
  tr.state = 'leaving'
  tr.path = [{ x: bay.x, y: TRUNK_Y, reverse: true, action: 'freeBay' }, { x: EXIT_X, y: TRUNK_Y, action: 'exit' }]
}

function trucksStep(sim, dt) {
  for (const tr of [...sim.trucks]) {
    if (tr.state === 'queued') continue
    if (tr.wait > 0) {
      tr.wait -= dt
      if (tr.wait <= 0) tr.state = 'toHO'
      continue
    }
    if (tr.timer > 0) {
      tr.timer -= dt
      if (tr.timer <= 0) finishUnload(sim, tr)
      continue
    }
    const next = tr.path[0]
    if (next?.action === 'gate') {
      const blocked = sim.queue.length > 0 || !freeBay(sim)
      next.x = blocked ? Math.max(tr.x, GATE_X - 3.1 * sim.queue.length) : GATE_X
    }
    const hit = stepPath(tr, TRUCK_SPEED, dt)
    if (!hit) continue
    if (hit.action === 'hub') {
      tr.wait = 2.4
      tr.state = 'atHub'
      tr.cons.steps.hub = sim.clock
      sim.stats.hubStops++
      popup(sim, HUB.stopX, HUB.stopY, 2.2, 'Hub consolidation', 'blue')
      log(sim, '🏬', `${tr.cons.id} consolidated at ${sim.scene.hubName} hub`)
    } else if (hit.action === 'gate') {
      const bay = freeBay(sim)
      if (!sim.queue.length && bay) assignBay(sim, tr, bay)
      else { sim.queue.push(tr.id); tr.state = 'queued' }
    } else if (hit.action === 'bay') {
      tr.state = 'unloading'
      tr.timer = 2.4
      tr.cons.steps.received = sim.clock
      sim.stats.received += tr.cons.bills
      sim.stats.receivedWeight += tr.cons.weight
      sim.stats.score += 30
      popup(sim, tr.x, tr.y, 2.2, `Received ✓ ${tr.cons.bills} bills`, 'green')
      log(sim, '🏢', `${tr.cons.id} received at Head Office — bay ${tr.bay}, ${tr.cons.weight} g`)
    } else if (hit.action === 'freeBay') {
      const bay = sim.bays.find(b => b.truck === tr.id)
      if (bay) bay.truck = null
    } else if (hit.action === 'exit') {
      sim.trucks = sim.trucks.filter(t => t !== tr)
    }
  }
}

function queueStep(sim, dt) {
  sim.queue.forEach((id, k) => {
    const tr = sim.trucks.find(t => t.id === id)
    if (!tr) return
    const dx = GATE_X - 3.1 * k - tr.x
    if (Math.abs(dx) > 0.01) { tr.x += Math.sign(dx) * Math.min(Math.abs(dx), QUEUE_SPEED * dt); tr.heading = 'x+' }
  })
  const bay = freeBay(sim)
  if (bay && sim.queue.length) {
    const id = sim.queue.shift()
    const tr = sim.trucks.find(t => t.id === id)
    if (tr) assignBay(sim, tr, bay)
  }
}

function forkTimerDone(sim, f) {
  const lot = sim.lots.find(l => l.id === f.lot)
  if (f.state === 'picking') {
    lot.state = 'carried'
    f.state = 'toDrop'
    f.path = [
      { x: f.x, y: FORK_LANE_Y, reverse: true },
      { x: DROP_LANE_X, y: FORK_LANE_Y },
      { x: DROP_LANE_X, y: DROP.y },
      { x: DROP.x, y: DROP.y, action: 'drop' },
    ]
  } else if (f.state === 'dropping') {
    lot.state = 'belt'
    lot.cy = CONVEYOR.y0
    lot.ti = 0
    lot.phase = 'move'
    f.lot = null
    f.state = 'returning'
    f.path = [
      { x: DROP_LANE_X, y: DROP.y, reverse: true },
      { x: DROP_LANE_X, y: FORK_LANE_Y },
      { x: f.home[0], y: f.home[1], action: 'home' },
    ]
  }
}

function forkliftsStep(sim, dt) {
  for (const f of sim.forklifts) {
    if (f.timer > 0) {
      f.timer -= dt
      if (f.timer <= 0) forkTimerDone(sim, f)
      continue
    }
    if (f.state === 'idle') {
      const lot = sim.lots.filter(l => l.state === 'pad' && !l.claimed).sort((a, b) => a.id - b.id)[0]
      if (lot) {
        lot.claimed = true
        f.lot = lot.id
        f.state = 'toPick'
        f.path = [{ x: lot.x, y: FORK_LANE_Y }, { x: lot.x, y: lot.y + 1.0, action: 'pick' }]
      }
      continue
    }
    if (f.state === 'waitDrop') {
      if (!sim.stations[0].lot) { sim.stations[0].lot = f.lot; f.state = 'dropping'; f.timer = 0.6 }
      continue
    }
    const hit = stepPath(f, FORK_SPEED, dt)
    if (!hit) continue
    if (hit.action === 'pick') { f.state = 'picking'; f.timer = 0.7 }
    else if (hit.action === 'drop') {
      if (!sim.stations[0].lot) { sim.stations[0].lot = f.lot; f.state = 'dropping'; f.timer = 0.6 }
      else f.state = 'waitDrop'
    } else if (hit.action === 'home') { f.state = 'idle'; f.heading = 'x-' }
  }
}

function stationStart(sim, lot, st) {
  if (st.key === 'weighIn') lot.gross = +(lot.weight * rnd(0.985, 1)).toFixed(1)
  if (st.key === 'weighOut') lot.net = +(lot.gross * rnd(0.965, 0.99)).toFixed(1)
  if (st.key === 'purity') { lot.purity = +rnd(88.5, 96.5).toFixed(1); lot.fine = +(lot.net * lot.purity / 100).toFixed(1) }
  if (st.key === 'furnace') popup(sim, CONVEYOR.x, st.y, 2.8, 'Melting…', 'orange')
}

function stationDone(sim, lot, st) {
  const c = lot.cons
  const x = CONVEYOR.x
  switch (st.key) {
    case 'scan':
      c.steps.scanned = sim.clock
      popup(sim, x, st.y, 1.9, 'QR scanned ✓', 'blue')
      break
    case 'weighIn':
      sim.stats.gross += lot.gross
      popup(sim, x, st.y, 1.9, `Gross ${lot.gross} g`, 'blue')
      break
    case 'furnace':
      lot.form = 'bar'
      c.steps.melted = sim.clock
      sim.stats.melted += lot.gross
      popup(sim, x, st.y - 1.4, 1.5, 'Poured → bar', 'orange')
      log(sim, '🔥', `${c.id} melted — ${lot.gross} g through the furnace`)
      break
    case 'weighOut': {
      const loss = ((1 - lot.net / lot.gross) * 100).toFixed(1)
      sim.stats.net += lot.net
      popup(sim, x, st.y, 1.9, `Net ${lot.net} g · loss ${loss}%`, 'blue')
      break
    }
    case 'purity':
      c.steps.purity = sim.clock
      popup(sim, x, st.y, 1.9, `Purity ${lot.purity}%`, 'green')
      break
    case 'vault': {
      c.steps.vault = sim.clock
      c.done = true
      c.result = { gross: lot.gross, net: lot.net, purity: lot.purity, fine: lot.fine }
      sim.vaultBars++
      const pts = Math.round(lot.fine * 2 + c.bills * 4)
      sim.stats.fine += lot.fine
      sim.stats.puritySum += lot.purity
      sim.stats.lotsDone++
      sim.stats.score += pts
      sim.summary.unshift({ id: c.id, branch: c.branch, bills: c.bills, gross: lot.gross, net: lot.net, purity: lot.purity, fine: lot.fine, at: sim.clock })
      if (sim.summary.length > 12) sim.summary.length = 12
      popup(sim, VAULT_PAD.x0 + 1.4, VAULT_PAD.y0 + 1.3, 1.8, `+${lot.fine} g fine · +${pts} pts`, 'gold', true)
      log(sim, '🥇', `${c.id} vaulted — ${lot.purity}% purity, ${lot.fine} g fine gold`)
      break
    }
    default:
      break
  }
}

function beltStep(sim, dt) {
  for (const lot of [...sim.lots]) {
    if (lot.state !== 'belt') continue
    const st = sim.stations[lot.ti]
    if (lot.phase === 'move') {
      lot.cy = Math.max(st.y, lot.cy - BELT_SPEED * dt)
      if (lot.cy <= st.y) { lot.phase = 'work'; lot.timer = st.dur; stationStart(sim, lot, st) }
    } else if (lot.phase === 'work') {
      lot.timer -= dt
      if (lot.timer <= 0) {
        stationDone(sim, lot, st)
        if (st.key === 'vault') { st.lot = null; sim.lots = sim.lots.filter(l => l !== lot); continue }
        lot.phase = 'wait'
      }
    }
    if (lot.phase === 'wait') {
      const next = sim.stations[lot.ti + 1]
      if (!next.lot) { next.lot = lot.id; st.lot = null; lot.ti++; lot.phase = 'move' }
    }
  }
}

// Fast-forward a fresh sim so the yard opens mid-action instead of empty.
export function warmSim(sim, seconds) {
  for (let t = 0; t < seconds; t += 0.05) stepSim(sim, 0.05)
  sim.popups = []
  return sim
}

export function stepSim(sim, dt) {
  sim.t += dt
  sim.clock += dt * 2
  spawnBills(sim, dt)
  branchesStep(sim, dt)
  trucksStep(sim, dt)
  queueStep(sim, dt)
  forkliftsStep(sim, dt)
  beltStep(sim, dt)
  for (const p of sim.popups) p.age += dt
  sim.popups = sim.popups.filter(p => p.age < (p.big ? 2.6 : 1.9))
}
