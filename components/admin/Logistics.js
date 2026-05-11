'use client'

// Admin → Logistics
// Per-branch logistics configuration: courier partner, pickup time, delivery
// TAT, active days, courier contact, free-form notes. One card per outstation
// branch with a single 'Save changes' footer button when any field is dirty.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const REGION_COLORS = {
  'Andhra Pradesh':    '#5ec1d6',
  'Kerala':            '#3aaa6a',
  'Telangana':         '#c9a84c',
  'Tamil Nadu':        '#e58a3b',
  'Rest of Karnataka': '#9275d5',
  'Bangalore':         '#e05555',
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// Single source of truth for the row grid template. The card and the column
// header above the rows share this so the labels line up with each control.
const ROW_GRID = '22px 38px minmax(170px, 1.2fr) 112px 108px 130px 196px 100px'

// Known partners — extensible. The dropdown also supports free text via the
// 'Other' option, falling back to a text input.
const PARTNERS = ['BVC', 'BlueDart', 'DTDC', 'India Post', 'Other']

export default function Logistics() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [loading, setLoading]       = useState(true)
  const [branches, setBranches]     = useState([])
  const [search,   setSearch]       = useState('')
  const [region,   setRegion]       = useState('')
  const [partner,  setPartner]      = useState('')
  const [busyName, setBusyName]     = useState(null)
  const [toast,    setToast]        = useState(null)
  // Multi-select state for bulk apply. A Set of branch names; the floating
  // panel at the bottom edits common fields and applies them to this set
  // in one call to bulk_update.
  const [selected, setSelected]     = useState(() => new Set())
  const [bulkBusy, setBulkBusy]     = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const r = await authedFetch('/api/admin/logistics')
      const j = await r.json()
      setBranches(j.branches || [])
    } catch (e) {
      setToast({ type: 'error', msg: e.message || 'Load failed' })
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const saveBranch = useCallback(async (branch_name, patch) => {
    setBusyName(branch_name)
    try {
      const r = await authedFetch('/api/admin/logistics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'update', branch_name, ...patch }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setToast({ type: 'error', msg: j.error || 'Save failed' }); return false }
      setToast({ type: 'success', msg: `${branch_name} updated` })
      // Refresh in place — replace just this row instead of refetching all.
      setBranches(prev => prev.map(b => b.name === branch_name ? { ...b, ...j.branch } : b))
      return true
    } finally {
      setBusyName(null)
      setTimeout(() => setToast(null), 4000)
    }
  }, [])

  // Apply a partial patch to every selected branch in a single API call.
  // Only fields the user actually set in the bulk panel get sent — empty
  // strings / unset means "leave alone".
  const applyBulk = useCallback(async (patch) => {
    if (selected.size === 0) return
    const branch_names = [...selected]
    setBulkBusy(true)
    try {
      const r = await authedFetch('/api/admin/logistics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'bulk_update', branch_names, ...patch }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setToast({ type: 'error', msg: j.error || 'Bulk apply failed' }); return }
      // Patch local state for every returned branch row so each card refreshes
      // without a full fetch round-trip.
      const byName = new Map((j.branches || []).map(b => [b.name, b]))
      setBranches(prev => prev.map(b => byName.has(b.name) ? { ...b, ...byName.get(b.name) } : b))
      setSelected(new Set())
      setToast({ type: 'success', msg: `${j.updated_count} branch${j.updated_count === 1 ? '' : 'es'} updated` })
    } finally {
      setBulkBusy(false)
      setTimeout(() => setToast(null), 4000)
    }
  }, [selected])

  const toggleSelect = useCallback((name) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }, [])

  // Region + partner filter options derived from data.
  const regions  = useMemo(() => [...new Set(branches.map(b => b.region).filter(Boolean))].sort(), [branches])
  const partners = useMemo(() => [...new Set(branches.map(b => b.logistics_partner).filter(Boolean))].sort(), [branches])

  const filtered = useMemo(() => branches.filter(b => {
    if (region  && b.region !== region) return false
    if (partner && b.logistics_partner !== partner) return false
    if (search) {
      const q = search.toLowerCase()
      if (!b.name.toLowerCase().includes(q) && !(b.region || '').toLowerCase().includes(q)) return false
    }
    return true
  }), [branches, region, partner, search])

  // Header stats
  const stats = useMemo(() => {
    const total = branches.length
    const withPickup = branches.filter(b => b.pickup_time).length
    const withTat    = branches.filter(b => b.delivery_tat_hours).length
    const missingAny = branches.filter(b => !b.pickup_time || !b.delivery_tat_hours || !b.logistics_partner).length
    return { total, withPickup, withTat, missingAny }
  }, [branches])

  // Group rendered cards by region for visual scannability.
  const grouped = useMemo(() => {
    const m = {}
    filtered.forEach(b => {
      const r = b.region || 'Unknown'
      if (!m[r]) m[r] = []
      m[r].push(b)
    })
    return m
  }, [filtered])

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const inp  = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 11px', fontSize: '12px', color: t.text1, outline: 'none' }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Global animations + interactive states for the page. */}
      <style>{`
        @keyframes logiCardIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes logiPulse {
          0%,100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          50%     { box-shadow: 0 0 0 6px transparent;  opacity: .55; }
        }
        @keyframes logiToast {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes logiBar {
          0%   { background-position: -120% 0; }
          100% { background-position: 220% 0; }
        }
        .logi-pulse { animation: logiPulse 2.4s ease-in-out infinite; }
        .logi-toast { animation: logiToast .25s ease-out; }
        .logi-pulse-bar {
          background: linear-gradient(90deg, transparent 0%, currentColor 50%, transparent 100%) !important;
          background-size: 200% 100% !important;
          animation: logiBar 2s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .logi-card, .logi-pulse, .logi-toast, .logi-pulse-bar { animation: none !important; }
        }
      `}</style>
      {toast && (
        <div className="logi-toast" style={{ padding: '10px 14px', borderRadius: '8px', background: toast.type === 'success' ? `${t.green}15` : `${t.red}15`, border: `1px solid ${toast.type === 'success' ? t.green : t.red}40`, fontSize: '12px', color: toast.type === 'success' ? t.green : t.red }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600 }}>Admin</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em', marginTop: '4px' }}>Logistics</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            Configure courier partner, pickup time and delivery TAT per outstation branch.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={async () => {
            if (!window.confirm('Apply BVC partner schedule to 36 branches?\n\nThis will overwrite logistics partner, pickup time, delivery TAT and pickup days for the branches BVC services. Branches not in the BVC table stay untouched.')) return
            setBulkBusy(true)
            try {
              const r = await authedFetch('/api/admin/logistics', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'seed_bvc_schedule' }),
              })
              const j = await r.json()
              if (!r.ok || j.error) { setToast({ type: 'error', msg: j.error || 'Seed failed' }); return }
              const byName = new Map((j.branches || []).map(b => [b.name, b]))
              setBranches(prev => prev.map(b => byName.has(b.name) ? { ...b, ...byName.get(b.name) } : b))
              setToast({ type: 'success', msg: `Seeded ${j.updated_count} of ${j.requested_count} branches with BVC defaults` })
            } finally {
              setBulkBusy(false)
              setTimeout(() => setToast(null), 5000)
            }
          }} disabled={bulkBusy}
            title="Apply the BVC partner schedule to the 36 branches BVC services"
            style={{ background: `${t.gold}15`, border: `1px solid ${t.gold}55`, borderRadius: '8px', padding: '7px 14px', color: t.gold, fontSize: '12px', fontWeight: 700, cursor: bulkBusy ? 'wait' : 'pointer' }}>
            {bulkBusy ? 'Seeding…' : '⚡ Seed BVC schedule'}
          </button>
          <button onClick={fetchAll}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', color: t.text2, fontSize: '12px', cursor: 'pointer' }}>
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* Stat band — gradient cards with prominent numbers and a status pulse
          on Needs Attention so the eye is pulled where work remains. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <Stat t={t} label="Outstation branches" value={stats.total} sub="active rows" accent={t.gold}   icon="◉" />
        <Stat t={t} label="With pickup time"    value={`${stats.withPickup} / ${stats.total}`} sub="config complete"     accent={t.green}  icon="◷" />
        <Stat t={t} label="With TAT"            value={`${stats.withTat} / ${stats.total}`}    sub="delivery target set" accent={t.blue}   icon="⇄" />
        <Stat t={t} label="Needs attention"     value={stats.missingAny} sub={stats.missingAny ? 'missing pickup, TAT, or partner' : 'all configured'} accent={stats.missingAny ? t.orange : t.green} icon="!" pulse={stats.missingAny > 0} />
      </div>

      {/* Filter bar — chip-based instead of select-based. Search stays as input. */}
      <div style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch / region…"
              style={{ ...inp, width: '100%', padding: '8px 12px 8px 30px', boxSizing: 'border-box' }} />
          </div>
          {(search || region || partner) && (
            <button onClick={() => { setSearch(''); setRegion(''); setPartner('') }}
              style={{ ...inp, color: t.gold, borderColor: `${t.gold}55`, cursor: 'pointer', fontWeight: 600 }}>
              Clear all
            </button>
          )}
          <span style={{ fontSize: '11px', color: t.text4 }}>
            <strong style={{ color: t.text2, fontFamily: 'monospace' }}>{filtered.length}</strong> of {branches.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Region chips */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, marginRight: '2px' }}>Region</span>
            <FilterChip t={t} active={!region} color={t.gold} onClick={() => setRegion('')}>All</FilterChip>
            {regions.map(r => (
              <FilterChip key={r} t={t} active={region === r} color={REGION_COLORS[r] || t.gold} onClick={() => setRegion(region === r ? '' : r)}>{r}</FilterChip>
            ))}
          </div>
          {/* Partner chips */}
          {partners.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, marginRight: '2px' }}>Partner</span>
              <FilterChip t={t} active={!partner} color={t.gold} onClick={() => setPartner('')}>All</FilterChip>
              {partners.map(p => (
                <FilterChip key={p} t={t} active={partner === p} color={t.blue} onClick={() => setPartner(partner === p ? '' : p)}>{p}</FilterChip>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center', color: t.text4 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No branches match the current filter.</div>
      ) : (
        Object.entries(grouped).map(([r, list]) => {
          const accent = REGION_COLORS[r] || t.gold
          const allSelected = list.length > 0 && list.every(b => selected.has(b.name))
          const someSelected = list.some(b => selected.has(b.name))
          const selectedCount = list.filter(b => selected.has(b.name)).length
          const configuredCount = list.filter(b => b.logistics_partner && b.pickup_time && b.delivery_tat_hours && (b.pickup_days || []).length).length
          const toggleRegion = () => {
            setSelected(prev => {
              const next = new Set(prev)
              if (allSelected) list.forEach(b => next.delete(b.name))
              else             list.forEach(b => next.add(b.name))
              return next
            })
          }
          return (
            <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Region banner — coloured gradient, large name, inline metrics + select all */}
              <div style={{
                background: `linear-gradient(90deg, ${accent}22 0%, ${accent}08 40%, transparent 70%)`,
                border: `1px solid ${accent}30`,
                borderLeft: `4px solid ${accent}`,
                borderRadius: '10px',
                padding: '12px 18px',
                display: 'flex', alignItems: 'center', gap: '14px',
                flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '15px', color: t.text1, fontWeight: 700, letterSpacing: '.02em' }}>{r}</span>
                  <span style={{ fontSize: '11px', color: t.text3 }}>
                    <strong style={{ color: accent, fontFamily: 'monospace' }}>{configuredCount}</strong>
                    <span style={{ color: t.text4 }}> / </span>
                    <strong style={{ color: t.text2, fontFamily: 'monospace' }}>{list.length}</strong> configured
                  </span>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={toggleRegion}
                  style={{
                    background: someSelected ? `${accent}22` : 'transparent',
                    border: `1px solid ${someSelected ? `${accent}70` : `${accent}40`}`,
                    color: someSelected ? accent : t.text2,
                    borderRadius: '7px',
                    padding: '6px 14px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: '.03em',
                    transition: 'all .15s ease',
                  }}>
                  {allSelected ? '✓ All selected · clear' : someSelected ? `${selectedCount} of ${list.length} selected · select rest` : 'Select all in region'}
                </button>
              </div>
              {/* Card grid — auto-fill so cards reflow naturally; min 320px */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '10px',
              }}>
                {list.map((b, i) => (
                  <BranchCard
                    key={b.name}
                    t={t}
                    branch={b}
                    busy={busyName === b.name}
                    onSave={saveBranch}
                    regionAccent={accent}
                    selected={selected.has(b.name)}
                    onToggleSelect={() => toggleSelect(b.name)}
                    delayMs={Math.min(i * 25, 300)}
                  />
                ))}
              </div>
            </div>
          )
        })
      )}

      {/* Sticky bulk-apply panel — only renders when at least one branch is selected.
          Lives outside the body scroll area so the floating bar stays put as
          the user scrolls through 73 branches. */}
      {selected.size > 0 && (
        <BulkPanel
          t={t}
          count={selected.size}
          busy={bulkBusy}
          onApply={applyBulk}
          onClear={() => setSelected(new Set())}
        />
      )}
    </div>
  )
}

// Floating bulk-apply panel. Stays at the bottom of the viewport while the user
// scrolls. Inputs default to blank; only fields the user touches are sent —
// touched-state tracked per-field so we can distinguish "leave alone" from
// "clear this field" (the latter handled by setting a specific blank marker
// in the input, but for now we treat empty string + untouched the same way:
// don't include in the patch).
function BulkPanel({ t, count, busy, onApply, onClear }) {
  const [partner,     setPartner]     = useState('')
  const [pickupTime,  setPickupTime]  = useState('')
  const [tat,         setTat]         = useState('')
  const [days,        setDays]        = useState([])
  const [daysTouched, setDaysTouched] = useState(false)

  const reset = () => {
    setPartner(''); setPickupTime(''); setTat(''); setDays([]); setDaysTouched(false)
  }

  // Build the patch — only include fields the user actually set.
  const hasAny = (partner || pickupTime || tat || daysTouched)

  const handleApply = async () => {
    const patch = {}
    if (partner)      patch.partner            = partner
    if (pickupTime)   patch.pickup_time        = pickupTime
    if (tat)          patch.delivery_tat_hours = Number(tat)
    if (daysTouched)  patch.pickup_days        = days
    if (!Object.keys(patch).length) return
    await onApply(patch)
    reset()
  }

  const chip = (active, color) => ({
    background: active ? `${color}20` : 'transparent',
    color:      active ? color : t.text3,
    border:     `1px solid ${active ? `${color}55` : t.border2 || t.border}`,
    borderRadius:'6px', padding:'6px 11px', fontSize:'11px', fontWeight:600, cursor:'pointer',
  })
  const inp = { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', fontSize: '12px', color: t.text1, outline: 'none' }

  return (
    <div style={{
      position: 'sticky', bottom: '12px',
      background: t.card, border: `1px solid ${t.gold}40`,
      borderRadius: '14px', padding: '14px 18px',
      boxShadow: `0 12px 36px rgba(0,0,0,.35), 0 0 0 1px ${t.gold}15`,
      marginTop: '8px', zIndex: 5,
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: t.gold }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.gold }} />
          {count} branch{count === 1 ? '' : 'es'} selected
        </span>
        <span style={{ fontSize: '10px', color: t.text4 }}>Only the fields you fill below are applied. Empty fields stay untouched.</span>
        <button onClick={onClear} disabled={busy}
          style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer' }}>
          Clear selection
        </button>
      </div>

      {/* Field row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>Partner</div>
          <select value={partner} onChange={e => setPartner(e.target.value)} disabled={busy} style={inp}>
            <option value="">— leave —</option>
            {PARTNERS.filter(p => p !== 'Other').map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>Pickup time</div>
          <input type="time" value={pickupTime} onChange={e => setPickupTime(e.target.value)} disabled={busy} style={inp} />
        </div>
        <div>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>TAT</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {['', 24, 48, 72].map(h => (
              <button key={h || 'none'} onClick={() => setTat(h === '' ? '' : String(h))} disabled={busy}
                style={chip(String(tat) === String(h), t.gold)}>
                {h === '' ? '—' : `${h}h`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>Pickup days {daysTouched ? <span style={{ color: t.gold }}>· will be applied</span> : <span>· untouched</span>}</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {DAYS.map(d => {
              const active = days.includes(d)
              return (
                <button key={d} onClick={() => { setDaysTouched(true); setDays(prev => active ? prev.filter(x => x !== d) : [...prev, d]) }} disabled={busy}
                  style={chip(active, t.green)}>
                  {d}
                </button>
              )
            })}
            {daysTouched && (
              <button onClick={() => { setDaysTouched(false); setDays([]) }} disabled={busy}
                style={{ ...chip(false, t.text3), borderStyle: 'dashed' }}>
                undo
              </button>
            )}
          </div>
        </div>
        <button onClick={handleApply} disabled={busy || !hasAny}
          style={{
            background: hasAny && !busy ? t.gold : `${t.gold}40`,
            color: '#1a0a00', border: 'none', borderRadius: '8px',
            padding: '9px 18px', fontSize: '12px', fontWeight: 700,
            cursor: busy || !hasAny ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            alignSelf: 'end',
          }}>
          {busy ? `Applying to ${count}…` : `Apply to ${count} branch${count === 1 ? '' : 'es'}`}
        </button>
      </div>
    </div>
  )
}

function Stat({ t, label, value, sub, accent, icon, pulse }) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: `linear-gradient(135deg, ${accent}10 0%, ${t.card} 60%)`,
      border: `1px solid ${accent}30`,
      borderRadius: '12px',
      padding: '14px 16px',
    }}>
      {/* Top accent stripe */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}40 60%, transparent 100%)` }} />
      {/* Big watermark icon */}
      {icon && (
        <span aria-hidden style={{
          position: 'absolute', top: '50%', right: '14px', transform: 'translateY(-50%)',
          fontSize: '46px', color: accent, opacity: .14, fontWeight: 700, lineHeight: 1, pointerEvents: 'none',
        }}>{icon}</span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
        {pulse && <span className="logi-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: accent, color: accent, display: 'inline-block' }} />}
      </div>
      <div style={{ fontSize: '22px', color: accent, fontWeight: 700, marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.1, letterSpacing: '-.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '6px', position: 'relative', zIndex: 1 }}>{sub}</div>}
    </div>
  )
}

function FilterChip({ t, active, color, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '5px 11px',
        background: active ? `${color}22` : 'transparent',
        border: `1px solid ${active ? `${color}70` : t.border2 || t.border}`,
        color: active ? color : t.text3,
        borderRadius: '99px',
        fontSize: '11px',
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        letterSpacing: '.02em',
        transition: 'all .15s ease',
        whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  )
}

// PartnerPicker — custom popover replacing the native <select>. Button shows
// the active partner as a chip; clicking opens a small menu of options.
// Closes on outside click + Escape.
function PartnerPicker({ t, accent, busy, value, onChange, other, setOther, dirty, options, legacy }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const display = value === 'Other' ? (other?.trim() || 'Other') : value || legacy || 'Set partner'
  // Same logo / dot styling for known partners so the chip reads more like a
  // brand chip than a generic dropdown — visually distinguishes BVC from
  // BlueDart at a glance without expanding the picker.
  const partnerColor = {
    BVC:        accent,
    BlueDart:   t.blue,
    DTDC:       t.green,
    'India Post': t.red,
    Other:      t.text3,
  }[value] || accent

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button onClick={() => !busy && setOpen(o => !o)} disabled={busy}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: '8px',
          background: dirty ? `${t.gold}10` : `${partnerColor}10`,
          border: `1px solid ${dirty ? t.gold : `${partnerColor}55`}`,
          borderRadius: '7px',
          padding: '6px 10px',
          fontSize: '12px',
          color: t.text1,
          cursor: busy ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          transition: 'background .15s, border-color .15s',
        }}>
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: partnerColor, flexShrink: 0,
          boxShadow: `0 0 0 2px ${partnerColor}25`,
        }} />
        <span style={{ flex: 1, fontWeight: 600, color: value ? t.text1 : t.text4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {display}
        </span>
        <span style={{ fontSize: '9px', color: t.text4, transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .15s' }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: t.card, border: `1px solid ${t.border}`,
          borderRadius: '8px', overflow: 'hidden', zIndex: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          animation: 'logiCardIn .15s ease-out',
        }}>
          {options.map(opt => {
            const active = value === opt
            const optColor = {
              BVC: accent, BlueDart: t.blue, DTDC: t.green, 'India Post': t.red, Other: t.text3,
            }[opt] || accent
            return (
              <button key={opt} onClick={() => { onChange(opt); if (opt !== 'Other') setOpen(false) }}
                style={{
                  width: '100%', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  background: active ? `${optColor}15` : 'transparent',
                  border: 'none', borderBottom: `1px solid ${t.border}`,
                  padding: '7px 12px', fontSize: '11.5px', color: t.text1,
                  fontWeight: active ? 700 : 500, cursor: 'pointer',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${optColor}12`}
                onMouseLeave={e => e.currentTarget.style.background = active ? `${optColor}15` : 'transparent'}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: optColor, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{opt}</span>
                {active && <span style={{ fontSize: '11px', color: optColor }}>✓</span>}
              </button>
            )
          })}
          {legacy && !options.includes(legacy) && (
            <button onClick={() => { onChange(legacy); setOpen(false) }}
              style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '7px 12px', fontSize: '11px', color: t.text3, fontStyle: 'italic', cursor: 'pointer' }}>
              Legacy: {legacy}
            </button>
          )}
        </div>
      )}

      {value === 'Other' && (
        <input value={other || ''} onChange={e => setOther(e.target.value)} placeholder="Partner name" maxLength={60} disabled={busy}
          style={{
            width: '100%', marginTop: '4px',
            background: t.card,
            border: `1px solid ${t.gold}`,
            borderRadius: '6px', padding: '5px 8px', fontSize: '12px', color: t.text1, outline: 'none',
            boxSizing: 'border-box',
          }} />
      )}
    </div>
  )
}

// Per-branch editor — compact single-row card. Operational fields only
// (partner, pickup, TAT, days). Contact + notes were dropped to keep
// the row tight; columns still exist in the DB if needed later.
function BranchCard({ t, branch, busy, onSave, regionAccent, selected, onToggleSelect, delayMs = 0 }) {
  const [partner,      setPartner]      = useState(branch.logistics_partner || 'BVC')
  const [partnerOther, setPartnerOther] = useState(PARTNERS.includes(branch.logistics_partner) ? '' : (branch.logistics_partner || ''))
  const [pickup,       setPickup]       = useState(branch.pickup_time || '')
  const [tat,          setTat]          = useState(branch.delivery_tat_hours || 24)
  const [days,         setDays]         = useState(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat'])
  const [hover,        setHover]        = useState(false)

  // Reset on branch row update (after save)
  useEffect(() => { setPartner(branch.logistics_partner || 'BVC') }, [branch.logistics_partner])
  useEffect(() => { setPartnerOther(PARTNERS.includes(branch.logistics_partner) ? '' : (branch.logistics_partner || '')) }, [branch.logistics_partner])
  useEffect(() => { setPickup(branch.pickup_time || '') }, [branch.pickup_time])
  useEffect(() => { setTat(branch.delivery_tat_hours || 24) }, [branch.delivery_tat_hours])
  useEffect(() => { setDays(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat']) }, [branch.pickup_days])

  // Resolve effective partner (dropdown or 'Other' free text)
  const effectivePartner = partner === 'Other' ? partnerOther.trim() : partner

  const dirty = (
    (effectivePartner || null)             !== (branch.logistics_partner       || null) ||
    (pickup || '')                          !== (branch.pickup_time             || '')   ||
    Number(tat)                             !== Number(branch.delivery_tat_hours || 24)  ||
    JSON.stringify([...days].sort())        !== JSON.stringify([...(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat'])].sort())
  )

  const onSubmit = async () => {
    await onSave(branch.name, {
      partner:            effectivePartner,
      pickup_time:        pickup,
      delivery_tat_hours: tat,
      pickup_days:        days,
    })
  }

  const onReset = () => {
    setPartner(branch.logistics_partner || 'BVC')
    setPartnerOther(PARTNERS.includes(branch.logistics_partner) ? '' : (branch.logistics_partner || ''))
    setPickup(branch.pickup_time || '')
    setTat(branch.delivery_tat_hours || 24)
    setDays(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat'])
  }

  const accent = regionAccent || t.gold
  const baseBg = t.card2 || t.card

  const inp = (isDirty) => ({
    background: t.card,
    border: `1px solid ${isDirty ? t.gold : t.border}`,
    borderRadius: '6px',
    padding: '5px 8px',
    fontSize: '12px',
    color: t.text1,
    outline: 'none',
    transition: 'border-color .15s ease',
  })

  // Configured = all 4 operational fields have a value. Surfaces a green tick
  // accent so the eye can quickly scan which branches are still pending.
  const configured = !!branch.logistics_partner && !!branch.pickup_time && !!branch.delivery_tat_hours && (branch.pickup_days || []).length > 0

  // Field row helper — label on the left, control on the right, both share
  // a consistent baseline so every card lines up internally.
  const Row = ({ label, children }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: '10px' }}>
      <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )

  return (
    <div
      className="logi-card"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', overflow: 'hidden',
        background: hover ? `linear-gradient(180deg, ${accent}10 0%, ${baseBg} 60%)` : (configured ? baseBg : `${t.orange}06`),
        border: `1px solid ${selected ? t.gold : hover ? `${accent}55` : (configured ? t.border : `${t.orange}25`)}`,
        borderRadius: '12px',
        boxShadow: selected
          ? `0 0 0 1px ${t.gold}55, 0 6px 20px ${t.gold}25`
          : hover ? `0 6px 22px ${accent}26` : '0 1px 3px rgba(0,0,0,.15)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'background .25s ease, border-color .2s ease, box-shadow .25s ease, transform .15s ease',
        padding: '14px 16px',
        animation: 'logiCardIn .35s cubic-bezier(.4,0,.2,1) backwards',
        animationDelay: `${delayMs}ms`,
      }}>
      {/* Accent gradient top stripe */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: `linear-gradient(90deg, ${accent} 0%, ${accent}40 60%, transparent 100%)` }} />
      {dirty && <div className="logi-pulse-bar" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: t.gold, opacity: .8 }} />}

      {/* Card header — checkbox · badge · name · status · hub tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        {onToggleSelect ? (
          <button onClick={onToggleSelect} aria-label={selected ? 'Deselect' : 'Select for bulk'}
            title={selected ? 'Selected. Click to deselect.' : 'Select for bulk apply'}
            style={{
              width: '20px', height: '20px',
              background: selected ? t.gold : 'transparent',
              border: `1.5px solid ${selected ? t.gold : t.border2 || t.border}`,
              borderRadius: '5px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#1a0a00', fontSize: '12px', fontWeight: 700,
              padding: 0, flexShrink: 0,
              transition: 'background .15s, border-color .15s, transform .12s',
              transform: selected ? 'scale(1)' : 'scale(.95)',
            }}>
            {selected ? '✓' : ''}
          </button>
        ) : null}
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          height: '22px', padding: '0 8px',
          fontSize: '10px', fontWeight: 700, letterSpacing: '.05em',
          color: '#fff', background: accent, borderRadius: '5px',
          fontFamily: 'monospace', flexShrink: 0,
          boxShadow: `0 2px 6px ${accent}40`,
        }}>{branch.name.split('-')[0]}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: t.text1, fontWeight: 700, letterSpacing: '-.005em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branch.name}</span>
          {branch.is_hub && (
            <span style={{ fontSize: '8.5px', color: t.gold, background: `${t.gold}15`, border: `1px solid ${t.gold}40`, borderRadius: '3px', padding: '1px 6px', fontWeight: 700, letterSpacing: '.06em', flexShrink: 0 }}>HUB</span>
          )}
        </div>
        <span title={configured ? 'Fully configured' : 'Some fields are missing'}
          className={configured ? '' : 'logi-pulse'}
          style={{ width: '8px', height: '8px', borderRadius: '50%', background: configured ? t.green : t.orange, color: configured ? t.green : t.orange, flexShrink: 0 }} />
      </div>

      {/* Field rows — consistent label / control grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Row label="Partner">
          <PartnerPicker
            t={t} accent={accent} busy={busy}
            value={partner} onChange={setPartner}
            other={partnerOther} setOther={setPartnerOther}
            dirty={effectivePartner !== (branch.logistics_partner || null)}
            options={PARTNERS}
            legacy={branch.logistics_partner && !PARTNERS.includes(branch.logistics_partner) ? branch.logistics_partner : null}
          />
        </Row>
        <Row label="Pickup">
          <input type="time" value={pickup} onChange={e => setPickup(e.target.value)} disabled={busy}
            style={{ ...inp((pickup || '') !== (branch.pickup_time || '')), width: '100%' }} />
        </Row>
        <Row label="TAT">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
            {[24, 48, 72].map(h => {
              const active = Number(tat) === h
              return (
                <button key={h} onClick={() => setTat(h)} disabled={busy}
                  style={{
                    background:   active ? t.gold : 'transparent',
                    color:        active ? '#1a0a00' : t.text3,
                    border:       `1px solid ${active ? t.gold : t.border}`,
                    borderRadius: '6px',
                    padding:      '6px 0',
                    fontSize:     '11px',
                    fontWeight:   active ? 700 : 500,
                    cursor:       'pointer',
                    transition:   'all .12s ease',
                    boxShadow:    active ? `0 1px 4px ${t.gold}45` : 'none',
                  }}>
                  {h}h
                </button>
              )
            })}
          </div>
        </Row>
        <Row label="Days">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
            {DAYS.map(d => {
              const active = days.includes(d)
              return (
                <button key={d} onClick={() => setDays(prev => active ? prev.filter(x => x !== d) : [...prev, d])} disabled={busy}
                  title={d}
                  style={{
                    background:   active ? `${accent}28` : 'transparent',
                    color:        active ? accent : t.text4,
                    border:       `1px solid ${active ? `${accent}70` : t.border}`,
                    borderRadius: '5px',
                    padding:      '5px 0',
                    fontSize:     '10px',
                    fontWeight:   700,
                    cursor:       'pointer',
                    transition:   'all .12s ease',
                  }}>
                  {d[0]}
                </button>
              )
            })}
          </div>
        </Row>
      </div>

      {/* Footer — save / cancel slides in when dirty */}
      {dirty && (
        <div style={{
          marginTop: '12px', paddingTop: '12px',
          borderTop: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '10px', color: t.gold, fontWeight: 600, letterSpacing: '.04em', flex: 1 }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: t.gold, marginRight: '6px' }} />
            Unsaved changes
          </span>
          <button onClick={onReset} disabled={busy}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 12px', fontSize: '10px', color: t.text3, cursor: busy ? 'wait' : 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={onSubmit} disabled={busy}
            style={{
              background: `linear-gradient(180deg, ${t.gold} 0%, ${t.gold} 100%)`,
              color: '#1a0a00', border: 'none',
              borderRadius: '6px', padding: '6px 16px',
              fontSize: '10px', fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer',
              boxShadow: `0 2px 10px ${t.gold}65`,
              opacity: busy ? 0.7 : 1,
            }}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}
