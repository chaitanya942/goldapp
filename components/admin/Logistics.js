'use client'

// Admin → Logistics
// Per-branch logistics configuration: courier partner, pickup time, delivery
// TAT, active days, courier contact, free-form notes. One card per outstation
// branch with a single 'Save changes' footer button when any field is dirty.

import React, { useState, useEffect, useMemo, useCallback } from 'react'
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
      {toast && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: toast.type === 'success' ? `${t.green}15` : `${t.red}15`, border: `1px solid ${toast.type === 'success' ? t.green : t.red}40`, fontSize: '12px', color: toast.type === 'success' ? t.green : t.red }}>
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
        <button onClick={fetchAll}
          style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', color: t.text2, fontSize: '12px', cursor: 'pointer' }}>
          ⟳ Refresh
        </button>
      </div>

      {/* Stat band */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1px', background: t.border, borderRadius: '10px', overflow: 'hidden' }}>
        <Stat t={t} label="Outstation branches"   value={stats.total}                                                      sub="active rows"            accent={t.gold} />
        <Stat t={t} label="With pickup time"      value={`${stats.withPickup} / ${stats.total}`}                          sub="config complete"        accent={t.green} />
        <Stat t={t} label="With TAT"              value={`${stats.withTat} / ${stats.total}`}                             sub="delivery target set"    accent={t.blue} />
        <Stat t={t} label="Needs attention"       value={stats.missingAny}                                                 sub={stats.missingAny ? 'missing pickup, TAT, or partner' : 'all branches configured'}  accent={stats.missingAny ? t.orange : t.green} />
      </div>

      {/* Filter bar */}
      <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch / region…"
          style={{ ...inp, minWidth: '220px', flex: 1 }} />
        <select value={region} onChange={e => setRegion(e.target.value)} style={inp}>
          <option value="">All regions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={partner} onChange={e => setPartner(e.target.value)} style={inp}>
          <option value="">All partners</option>
          {partners.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {(search || region || partner) && (
          <button onClick={() => { setSearch(''); setRegion(''); setPartner('') }}
            style={{ ...inp, color: t.gold, borderColor: `${t.gold}50`, cursor: 'pointer' }}>
            Clear
          </button>
        )}
        <span style={{ fontSize: '11px', color: t.text4 }}>{filtered.length} of {branches.length}</span>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center', color: t.text4 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No branches match the current filter.</div>
      ) : (
        Object.entries(grouped).map(([r, list]) => {
          const allSelected = list.length > 0 && list.every(b => selected.has(b.name))
          const someSelected = list.some(b => selected.has(b.name))
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: REGION_COLORS[r] || t.text3 }} />
                <span style={{ fontSize: '11px', color: t.text2, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{r}</span>
                <span style={{ fontSize: '10px', color: t.text4 }}>· {list.length} branch{list.length === 1 ? '' : 'es'}</span>
                <button onClick={toggleRegion}
                  style={{ marginLeft: '8px', background: 'transparent', border: `1px solid ${allSelected || someSelected ? `${REGION_COLORS[r] || t.gold}60` : t.border}`, color: allSelected || someSelected ? (REGION_COLORS[r] || t.gold) : t.text3, borderRadius: '6px', padding: '3px 10px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', letterSpacing: '.04em' }}>
                  {allSelected ? '✓ All selected · click to clear' : someSelected ? `${list.filter(b => selected.has(b.name)).length} selected · select rest` : 'Select all in region'}
                </button>
              </div>
              {list.map(b => (
                <BranchCard
                  key={b.name}
                  t={t}
                  branch={b}
                  busy={busyName === b.name}
                  onSave={saveBranch}
                  regionAccent={REGION_COLORS[r] || t.gold}
                  selected={selected.has(b.name)}
                  onToggleSelect={() => toggleSelect(b.name)}
                />
              ))}
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

function Stat({ t, label, value, sub, accent }) {
  return (
    <div style={{ background: t.card, padding: '14px 16px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: accent || t.text3, opacity: .55 }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '20px', color: accent || t.text1, fontWeight: 700, marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '6px' }}>{sub}</div>}
    </div>
  )
}

// Per-branch editor — compact single-row card. Operational fields only
// (partner, pickup, TAT, days). Contact + notes were dropped to keep
// the row tight; columns still exist in the DB if needed later.
function BranchCard({ t, branch, busy, onSave, regionAccent, selected, onToggleSelect }) {
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

  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? `${accent}06` : baseBg,
        border: `1px solid ${hover ? `${accent}40` : t.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: '8px',
        boxShadow: hover ? `0 2px 8px ${accent}18` : 'none',
        transition: 'background .18s ease, border-color .18s ease, box-shadow .18s ease',
        padding: '7px 12px',
        display: 'flex', alignItems: 'center', gap: '10px',
        flexWrap: 'wrap',
      }}>
      {/* Select checkbox */}
      {onToggleSelect && (
        <button onClick={onToggleSelect} aria-label={selected ? 'Deselect' : 'Select for bulk'}
          title={selected ? 'Selected. Click to deselect.' : 'Select for bulk apply'}
          style={{
            width: '17px', height: '17px', flexShrink: 0,
            background: selected ? accent : 'transparent',
            border: `1.5px solid ${selected ? accent : t.border2 || t.border}`,
            borderRadius: '4px', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '10px', fontWeight: 700,
            padding: 0,
          }}>
          {selected ? '✓' : ''}
        </button>
      )}

      {/* Branch identity */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: '28px', height: '20px', padding: '0 7px',
        fontSize: '9px', fontWeight: 700, letterSpacing: '.04em',
        color: '#fff', background: accent, borderRadius: '4px',
        fontFamily: 'monospace', flexShrink: 0,
      }}>{branch.name.split('-')[0]}</span>
      <span style={{ fontSize: '12.5px', color: t.text1, fontWeight: 600, minWidth: '170px' }}>{branch.name}</span>
      {branch.is_hub && (
        <span style={{ fontSize: '8px', color: t.gold, background: `${t.gold}15`, border: `1px solid ${t.gold}40`, borderRadius: '3px', padding: '1px 5px', fontWeight: 700, letterSpacing: '.05em', flexShrink: 0 }}>HUB</span>
      )}

      {/* Partner */}
      <select value={partner} onChange={e => setPartner(e.target.value)} disabled={busy}
        title="Logistics partner"
        style={{ ...inp(effectivePartner !== (branch.logistics_partner || null)), minWidth: '92px' }}>
        {PARTNERS.map(p => <option key={p} value={p}>{p}</option>)}
        {branch.logistics_partner && !PARTNERS.includes(branch.logistics_partner) && (
          <option value={branch.logistics_partner}>{branch.logistics_partner}</option>
        )}
      </select>
      {partner === 'Other' && (
        <input value={partnerOther} onChange={e => setPartnerOther(e.target.value)} placeholder="Partner" maxLength={60} disabled={busy}
          style={{ ...inp(true), width: '100px' }} />
      )}

      {/* Pickup time */}
      <input type="time" value={pickup} onChange={e => setPickup(e.target.value)} disabled={busy}
        title="Pickup time"
        style={{ ...inp((pickup || '') !== (branch.pickup_time || '')), width: '110px' }} />

      {/* TAT chips */}
      <div style={{ display: 'inline-flex', gap: '3px' }} title="Delivery TAT">
        {[24, 48, 72].map(h => {
          const active = Number(tat) === h
          return (
            <button key={h} onClick={() => setTat(h)} disabled={busy}
              style={{
                background:   active ? t.gold : 'transparent',
                color:        active ? '#1a0a00' : t.text2,
                border:       `1px solid ${active ? t.gold : t.border}`,
                borderRadius: '5px',
                padding:      '4px 8px',
                fontSize:     '11px',
                fontWeight:   active ? 700 : 500,
                cursor:       'pointer',
                minWidth:     '32px',
              }}>
              {h}h
            </button>
          )
        })}
      </div>

      {/* Days chips — single letters to keep the row tight */}
      <div style={{ display: 'inline-flex', gap: '2px' }} title="Pickup days">
        {DAYS.map(d => {
          const active = days.includes(d)
          return (
            <button key={d} onClick={() => setDays(prev => active ? prev.filter(x => x !== d) : [...prev, d])} disabled={busy}
              title={d}
              style={{
                background:   active ? `${accent}20` : 'transparent',
                color:        active ? accent : t.text4,
                border:       `1px solid ${active ? `${accent}50` : t.border}`,
                borderRadius: '4px',
                padding:      '3px 0',
                fontSize:     '10px',
                fontWeight:   600,
                cursor:       'pointer',
                width:        '24px',
              }}>
              {d[0]}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, minWidth: '4px' }} />

      {/* Save / cancel — inline, only when dirty */}
      {dirty && (
        <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
          <span title="Unsaved" style={{ width: '7px', height: '7px', borderRadius: '50%', background: t.gold }} />
          <button onClick={onReset} disabled={busy}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '4px 10px', fontSize: '10px', color: t.text3, cursor: busy ? 'wait' : 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={onSubmit} disabled={busy}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '5px', padding: '4px 12px', fontSize: '10px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', boxShadow: `0 1px 4px ${t.gold}50`, opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
