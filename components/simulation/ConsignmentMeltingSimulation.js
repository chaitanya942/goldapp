'use client'

// Simulation tab — live operations map (chaitanya-only, see lib/simulationAccess).
// Region tabs show branches on a real map (stock, bookings, today's
// consignments); the Head Office tab shows the isometric HO yard with today's
// inbound trucks and HO inventory. Melting is intentionally out of scope.

import { useState, useMemo, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import BranchMap from './BranchMap'
import HoYard from './HoYard'
import { useSimData, transitProgress, etaOf, fmtN, fmtG, fmtINR, fmtTime, fmtDateTime, consLabel } from './simData'

const HO_TAB = '__HO__'

export default function ConsignmentMeltingSimulation() {
  const { theme, canSee } = useApp()
  const t = THEMES[theme] || THEMES.dark
  if (!canSee('simulation')) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: t.text3 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text1 }}>Restricted</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>This module is limited to specific accounts.</div>
      </div>
    )
  }
  return <LiveOpsMap theme={theme} />
}

function Kpi({ t, icon, label, value, sub, color }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: color || t.text1, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: t.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
    </div>
  )
}

function Row({ t, k, v, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: `1px solid ${t.border}`, fontSize: 12.5 }}>
      <span style={{ color: t.text3 }}>{k}</span>
      <span style={{ color: t.text1, fontWeight: strong ? 800 : 600, textAlign: 'right' }}>{v}</span>
    </div>
  )
}

function ConsList({ t, list, onPick, empty }) {
  if (!list.length) return <div style={{ fontSize: 12, color: t.text3, padding: '8px 0' }}>{empty}</div>
  return list.map(c => (
    <div key={c.id} onClick={() => onPick(c)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${t.border}`, cursor: 'pointer', fontSize: 12 }}>
      <span>{c.status === 'received' ? '✅' : '🚚'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: t.text1, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.from} → {c.type === 'EXTERNAL' ? 'HO' : c.to}</div>
        <div style={{ color: t.text3, fontSize: 11 }}>{c.no} · {c.bills} bills · {fmtG(c.net)}</div>
      </div>
      <span style={{ color: c.status === 'received' ? t.green : t.gold, fontSize: 11, fontWeight: 700 }}>{c.status === 'received' ? 'Received' : 'In transit'}</span>
    </div>
  ))
}

function LiveOpsMap({ theme }) {
  const dark = theme !== 'light'
  const t = THEMES[theme] || THEMES.dark
  const isMobile = useMobile()
  const { data, error, loading, reload } = useSimData()
  const [view, setView] = useState(null) // null = all regions, region name, or HO_TAB
  const [selected, setSelected] = useState(null)

  const onSelect = useCallback((s) => setSelected(s), [])
  const onOpenHO = useCallback(() => { setView(HO_TAB); setSelected(null) }, [])
  const mapColors = useMemo(() => ({ gold: t.gold, purple: t.purple, blue: t.blue, green: t.green, muted: t.text4, text: t.text1 }), [t])

  const regions = useMemo(() => [...new Set((data?.branches || []).map(b => b.region))].filter(r => r !== 'Unassigned').sort(), [data])
  const isHO = view === HO_TAB
  const region = isHO ? null : view

  const scope = useMemo(() => {
    if (!data) return null
    const branches = data.branches.filter(b => !region || b.region === region)
    const names = new Set(branches.map(b => b.name))
    const cons = data.consignments.filter(c => isHO ? c.type === 'EXTERNAL' : (names.has(c.from) || names.has(c.to)))
    const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)
    return {
      branches, cons,
      stockBills: sum(branches, b => b.stock.bills),
      stockNet: sum(branches, b => b.stock.net),
      booked: sum(branches, b => b.stock.booked_bills),
      withStock: branches.filter(b => b.stock.bills > 0).length,
      moving: cons.filter(c => c.status !== 'received'),
      consBills: sum(cons, c => c.bills),
      consNet: sum(cons, c => c.net),
    }
  }, [data, region, isHO])

  const selBranch = selected?.type === 'branch' ? data?.branches.find(b => b.name === selected.name) : null
  const selCons = selected?.type === 'cons' ? data?.consignments.find(c => c.id === selected.id) : null

  const tab = (active) => ({
    padding: '6px 13px', borderRadius: 20, border: `1px solid ${active ? t.gold + '90' : t.border}`,
    background: active ? `${t.gold}22` : 'transparent', color: active ? t.gold : t.text2,
    fontSize: 12, fontWeight: active ? 800 : 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  })

  let panel
  if (selBranch) {
    const b = selBranch
    const out = data.consignments.filter(c => c.from === b.name)
    const inbound = data.consignments.filter(c => c.to === b.name)
    panel = (
      <>
        <div style={{ fontSize: 11, color: t.blue, fontWeight: 800, letterSpacing: '.06em' }}>BRANCH · {b.region}{b.is_hub ? ' · HUB' : ''}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.text1, margin: '2px 0 8px' }}>{b.name}</div>
        <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.5 }}>{b.address || '—'}</div>
        <div style={{ fontSize: 12, color: t.text3, margin: '4px 0 6px' }}>{[b.city, b.state, b.pin_code].filter(Boolean).join(' · ')}</div>
        {b.lat != null && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: t.blue, fontWeight: 700 }}>Open location in Google Maps ↗</a>
        )}
        <div style={{ marginTop: 12 }}>
          <Row t={t} k="Bills in stock" v={fmtN(b.stock.bills)} strong />
          <Row t={t} k="Gold in stock (net)" v={fmtG(b.stock.net)} strong />
          <Row t={t} k="Gross weight" v={fmtG(b.stock.gross)} />
          <Row t={t} k="Stock value" v={fmtINR(b.stock.value)} />
          <Row t={t} k="Booked / unbooked" v={`${fmtN(b.stock.booked_bills)} / ${fmtN(b.stock.bills - b.stock.booked_bills)}`} />
          <Row t={t} k="New today" v={`${fmtN(b.stock.today_bills)} bills`} />
          {b.stock.oldest && <Row t={t} k="Oldest pending since" v={b.stock.oldest} />}
          {b.hub && <Row t={t} k="Moves via hub" v={b.hub} />}
        </div>
        <div style={{ fontSize: 11, color: t.text3, fontWeight: 800, letterSpacing: '.06em', margin: '14px 0 4px' }}>CONSIGNMENTS TODAY</div>
        <ConsList t={t} list={[...out, ...inbound]} onPick={(c) => setSelected({ type: 'cons', id: c.id })} empty="No consignment moved from this branch today." />
      </>
    )
  } else if (selCons) {
    const c = selCons
    const eta = etaOf(c)
    panel = (
      <>
        <div style={{ fontSize: 11, color: c.type === 'EXTERNAL' ? t.gold : t.purple, fontWeight: 800, letterSpacing: '.06em' }}>🚚 CONSIGNMENT · {consLabel(c).toUpperCase()}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.text1, margin: '2px 0 4px' }}>{c.no}</div>
        <div style={{ fontSize: 12.5, color: t.text2, marginBottom: 8 }}>
          <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setSelected({ type: 'branch', name: c.from })}>{c.from}</span> → {c.type === 'EXTERNAL' ? 'Head Office' : c.to}
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: c.status === 'received' ? t.green : t.gold, background: (c.status === 'received' ? t.green : t.gold) + '22', padding: '3px 9px', borderRadius: 7 }}>
          {c.status === 'received' ? `Received ${fmtTime(c.received_at)}` : `In transit · ~${Math.round(transitProgress(c) * 100)}% of route`}
        </span>
        <div style={{ marginTop: 12 }}>
          <Row t={t} k="Bills" v={fmtN(c.bills)} strong />
          <Row t={t} k="Booked / unbooked" v={`${fmtN(c.booked_bills)} / ${fmtN(c.bills - c.booked_bills)}`} />
          <Row t={t} k="Net weight" v={fmtG(c.net)} strong />
          <Row t={t} k="Gross weight" v={fmtG(c.gross)} />
          <Row t={t} k="Value" v={fmtINR(c.value)} />
          <Row t={t} k="Dispatched" v={fmtDateTime(c.dispatched_at)} />
          {c.status !== 'received' && eta && <Row t={t} k="Expected by (TAT)" v={fmtDateTime(eta)} />}
          <Row t={t} k="E-way bill" v={c.ewb || 'Not generated'} />
          <Row t={t} k="E-invoice" v={c.irn ? 'Generated' : '—'} />
          <Row t={t} k="Vehicle" v={c.vehicles.map(v => v?.vehicle_no || v?.number || v?.vehicleNo).filter(Boolean).join(', ') || '—'} />
          <Row t={t} k="Transporter" v={c.transporter || '—'} />
          <Row t={t} k="Mode" v={c.mode || '—'} />
        </div>
        {c.status !== 'received' && <div style={{ fontSize: 11, color: t.text3, marginTop: 8 }}>Truck position is estimated from dispatch time and the branch&apos;s delivery TAT — there is no live GPS.</div>}
      </>
    )
  } else if (isHO && data) {
    const h = data.hoToday
    panel = (
      <>
        <div style={{ fontSize: 11, color: t.gold, fontWeight: 800, letterSpacing: '.06em' }}>HEAD OFFICE · TODAY</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.text1, margin: '2px 0 8px' }}>HO inventory</div>
        <Row t={t} k="Bills received today" v={fmtN(h.bills)} strong />
        <Row t={t} k="Net / gross" v={`${fmtG(h.net)} / ${fmtG(h.gross)}`} />
        <Row t={t} k="Booked bills" v={`${fmtN(h.booked_bills)} of ${fmtN(h.bills)}`} />
        <Row t={t} k="Bookings made today" v={`${fmtN(data.bookingsToday.count)} · ${fmtG(data.bookingsToday.weight)}`} />
        <div style={{ fontSize: 11, color: t.text3, fontWeight: 800, letterSpacing: '.06em', margin: '14px 0 4px' }}>MOVING TO HO TODAY</div>
        <ConsList t={t} list={scope.cons} onPick={(c) => setSelected({ type: 'cons', id: c.id })} empty="No consignment to HO today yet." />
        {h.by_branch.length > 0 && <>
          <div style={{ fontSize: 11, color: t.text3, fontWeight: 800, letterSpacing: '.06em', margin: '14px 0 4px' }}>RECEIVED TODAY BY BRANCH</div>
          {h.by_branch.map(r => <Row key={r.branch} t={t} k={r.branch} v={`${r.bills} bills · ${fmtG(r.net)}`} />)}
        </>}
      </>
    )
  } else if (scope) {
    const top = [...scope.branches].sort((a, b) => b.stock.bills - a.stock.bills).filter(b => b.stock.bills > 0).slice(0, 8)
    panel = (
      <>
        <div style={{ fontSize: 11, color: t.blue, fontWeight: 800, letterSpacing: '.06em' }}>{region ? `REGION · ${region.toUpperCase()}` : 'ALL REGIONS'}</div>
        <div style={{ fontSize: 13, color: t.text3, margin: '4px 0 10px' }}>Click a branch on the map for its location and stock, or a truck for its consignment.</div>
        <Row t={t} k="Branches with stock" v={`${scope.withStock} of ${scope.branches.length}`} />
        <Row t={t} k="Bills · gold in stock" v={`${fmtN(scope.stockBills)} · ${fmtG(Math.round(scope.stockNet))}`} strong />
        <Row t={t} k="Booked / unbooked" v={`${fmtN(scope.booked)} / ${fmtN(scope.stockBills - scope.booked)}`} />
        <div style={{ fontSize: 11, color: t.text3, fontWeight: 800, letterSpacing: '.06em', margin: '14px 0 4px' }}>MOST STOCK</div>
        {top.length ? top.map(b => (
          <div key={b.name} onClick={() => setSelected({ type: 'branch', name: b.name })} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: `1px solid ${t.border}`, fontSize: 12, cursor: 'pointer' }}>
            <span style={{ color: t.text1, fontWeight: 600 }}>{b.name}</span><span style={{ color: t.text2 }}>{b.stock.bills} · {fmtG(b.stock.net)}</span>
          </div>
        )) : <div style={{ fontSize: 12, color: t.text3 }}>No stock at branches.</div>}
        <div style={{ fontSize: 11, color: t.text3, fontWeight: 800, letterSpacing: '.06em', margin: '14px 0 4px' }}>CONSIGNMENTS TODAY</div>
        <ConsList t={t} list={scope.cons} onPick={(c) => setSelected({ type: 'cons', id: c.id })} empty="No consignment moved today yet." />
      </>
    )
  }

  const panelBox = panel && (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16, overflowY: 'auto', maxHeight: isMobile ? 'none' : '100%' }}>
      {(selBranch || selCons) && (
        <button onClick={() => setSelected(null)} style={{ float: 'right', border: `1px solid ${t.border}`, background: 'transparent', color: t.text2, borderRadius: 8, width: 28, height: 28, cursor: 'pointer' }}>✕</button>
      )}
      {panel}
    </div>
  )

  return (
    <div style={{ padding: isMobile ? 10 : 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 900, color: t.text1 }}>Live Operations Map</div>
          <div style={{ fontSize: 12, color: t.text3 }}>Branch stock, bookings, today&apos;s consignments and HO inventory · {data ? `updated ${fmtTime(data.generatedAt)}` : 'loading…'}</div>
        </div>
        <button onClick={reload} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.card, color: t.text2, fontSize: 12, cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 10 }}>
        <button style={tab(view === null)} onClick={() => { setView(null); setSelected(null) }}>All regions</button>
        {regions.map(r => <button key={r} style={tab(view === r)} onClick={() => { setView(r); setSelected(null) }}>{r}</button>)}
        <button style={tab(isHO)} onClick={onOpenHO}>🏢 Head Office</button>
      </div>

      {error && !data && <div style={{ color: t.red, fontSize: 13, padding: 20 }}>Couldn&apos;t load: {error}</div>}
      {!data && loading && <div style={{ color: t.text3, fontSize: 13, padding: 20 }}>Loading live data…</div>}

      {data && scope && <>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 8, marginBottom: 10 }}>
          <Kpi t={t} icon="🏬" label="Branch stock" value={fmtN(scope.stockBills)} sub={`${fmtG(Math.round(scope.stockNet))} · ${scope.withStock} branches`} color={t.blue} />
          <Kpi t={t} icon="🔖" label="Booked at branches" value={fmtN(scope.booked)} sub={`${fmtN(scope.stockBills - scope.booked)} unbooked`} />
          <Kpi t={t} icon="🚚" label={isHO ? 'Moving to HO today' : 'Consignments today'} value={fmtN(scope.cons.length)} sub={`${fmtN(scope.consBills)} bills · ${fmtG(Math.round(scope.consNet))} · ${scope.moving.length} in transit`} color={t.gold} />
          <Kpi t={t} icon="🏢" label="HO inventory today" value={fmtN(data.hoToday.bills)} sub={`${fmtG(data.hoToday.net)} received`} color={t.green} />
          <Kpi t={t} icon="📈" label="Bookings today" value={fmtN(data.bookingsToday.count)} sub={`${fmtG(data.bookingsToday.weight)} · ${fmtINR(data.bookingsToday.value)}`} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 340px', gap: 10, height: isMobile ? 'auto' : 'calc(100vh - 290px)', minHeight: isMobile ? 0 : 520 }}>
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: `1px solid ${t.border}`, height: isMobile ? '56vh' : '100%' }}>
            {isHO
              ? <HoYard data={data} dark={dark} selected={selected} onSelect={onSelect} t={t} />
              : <BranchMap data={data} region={region} dark={dark} colors={mapColors} selected={selected} onSelect={onSelect} onOpenHO={onOpenHO} />}
            {!isHO && (
              <div style={{ position: 'absolute', left: 10, bottom: 10, zIndex: 500, background: t.card + 'ee', border: `1px solid ${t.border}`, borderRadius: 10, padding: '7px 10px', fontSize: 11, color: t.text2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span><span style={{ color: t.gold }}>●</span> moved today</span>
                <span><span style={{ color: t.blue }}>●</span> stock waiting</span>
                <span><span style={{ color: t.text4 }}>●</span> no stock</span>
                <span>◯ hub · size = bills</span>
                <span><span style={{ color: t.gold }}>┅</span> to HO <span style={{ color: t.purple }}>┅</span> to hub</span>
              </div>
            )}
          </div>
          {panelBox}
        </div>
        {data.unplaced?.length > 0 && <div style={{ fontSize: 11, color: t.text3, marginTop: 6 }}>Locating {data.unplaced.length} new branch{data.unplaced.length > 1 ? 'es' : ''} on the map…</div>}
      </>}

      <style>{`
        @keyframes simFlow { to { stroke-dashoffset: -32 } }
        .sim-route-flow { animation: simFlow 1.2s linear infinite }
        .sim-lane { animation: simFlow 1.6s linear infinite }
        .sim-drive { animation: simRumble .35s ease-in-out infinite }
        @keyframes simRumble { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1.2px) } }
        .sim-puff { transform-box: fill-box; transform-origin: center; animation: simPuff 1s ease-out infinite; opacity: 0 }
        @keyframes simPuff { 0% { opacity: .55; transform: translate(0,0) scale(.4) } 100% { opacity: 0; transform: translate(-14px,-12px) scale(1.8) } }
        .sim-pop { transform-box: fill-box; transform-origin: center bottom; animation: simPop .45s cubic-bezier(.34,1.56,.64,1) }
        @keyframes simPop { from { transform: scale(.2); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        .sim-truck { display: flex; align-items: center; gap: 3px; background: ${t.card}; border: 1.5px solid ${t.gold}; border-radius: 12px; padding: 1px 7px 1px 4px; box-shadow: 0 2px 8px rgba(0,0,0,.3); font-size: 13px; cursor: pointer; animation: simBob 1.4s ease-in-out infinite }
        .sim-truck b { font-size: 11px; color: ${t.text1} }
        .sim-truck.sel { border-color: ${t.blue}; box-shadow: 0 0 0 3px ${t.blue}55 }
        @keyframes simBob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        .sim-ho-pin { width: 40px; height: 40px; border-radius: 50%; background: ${t.gold}; color: #1a1208; font-weight: 900; font-size: 13px; display: flex; align-items: center; justify-content: center; border: 3px solid ${t.card}; box-shadow: 0 0 0 4px ${t.gold}55, 0 4px 14px rgba(0,0,0,.35); cursor: pointer }
        .leaflet-container { font-family: inherit }
        .sim-map-dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.9) contrast(.9) saturate(.6) }
        .leaflet-tooltip { background: ${t.card}; color: ${t.text1}; border: 1px solid ${t.border}; box-shadow: 0 4px 14px rgba(0,0,0,.25); font-size: 12px }
        .leaflet-tooltip-top:before { border-top-color: ${t.card} }
      `}</style>
    </div>
  )
}
