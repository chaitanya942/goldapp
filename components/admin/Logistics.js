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
const DOW  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// Compute the next scheduled pickup for a branch.
// Returns { label, color, tier } where tier ∈ 'now'|'today'|'missed'|'tomorrow'|'soon'|'later'.
function nextPickup(pickupTime, pickupDays, now = new Date()) {
  if (!pickupTime || !pickupDays?.length) return null
  const [h, m] = pickupTime.split(':').map(Number)
  if (Number.isNaN(h)) return null
  const todayName = DOW[now.getDay()]
  // Today first
  if (pickupDays.includes(todayName)) {
    const t = new Date(now); t.setHours(h, m || 0, 0, 0)
    const diffMs = t.getTime() - now.getTime()
    if (diffMs >= 0) {
      const hrs = Math.floor(diffMs / 3600000)
      const mins = Math.floor((diffMs % 3600000) / 60000)
      if (hrs === 0 && mins < 30) return { label: `in ${mins}m`, tier: 'now' }
      if (hrs < 4)                 return { label: `in ${hrs}h ${mins}m`, tier: 'today' }
      const hhmm = pickupTime
      return { label: `today at ${hhmm}`, tier: 'today' }
    }
    // Today, passed
    const passed = Math.floor((-diffMs) / 60000)
    const passedLabel = passed < 60 ? `${passed}m ago` : `${Math.floor(passed/60)}h ago`
    return { label: `missed (${passedLabel})`, tier: 'missed' }
  }
  // Next 7 days
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i)
    const name = DOW[d.getDay()]
    if (pickupDays.includes(name)) {
      const hhmm = pickupTime
      if (i === 1) return { label: `tomorrow at ${hhmm}`, tier: 'tomorrow' }
      if (i <= 3)  return { label: `${name} at ${hhmm}`,   tier: 'soon' }
      return       { label: `${name} at ${hhmm}`,          tier: 'later' }
    }
  }
  return null
}

// Default partners. Operators can add new ones at runtime via the
// 'Add new partner…' option in any branch's picker — added partners then
// appear in every other branch's dropdown for the rest of the session.
const PARTNERS = ['BVC']

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
  // Collapsed region groups — Set of region names. Click the region banner
  // to toggle. Default: all regions expanded.
  const [collapsedRegions, setCollapsedRegions] = useState(() => new Set())
  // Partners added at runtime via 'Add new partner…' in any picker. Merged
  // with PARTNERS + values already present on existing branches so a partner
  // typed on branch A immediately becomes selectable on every other branch.
  const [customPartners, setCustomPartners] = useState([])

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
  const toggleRegionCollapsed = useCallback((r) => {
    setCollapsedRegions(prev => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r); else next.add(r)
      return next
    })
  }, [])

  const addCustomPartner = useCallback((name) => {
    const cleaned = String(name || '').trim()
    if (!cleaned) return
    setCustomPartners(prev => prev.includes(cleaned) ? prev : [...prev, cleaned])
  }, [])

  // Region + partner filter options derived from data.
  const regions  = useMemo(() => [...new Set(branches.map(b => b.region).filter(Boolean))].sort(), [branches])
  const partners = useMemo(() => [...new Set(branches.map(b => b.logistics_partner).filter(Boolean))].sort(), [branches])
  // Full partner list shown in every BranchCard's picker: defaults + values
  // present on any branch + anything the operator added at runtime. Dedupes
  // case-sensitively so 'BVC' and 'bvc' would coexist (which is unlikely
  // since the API trims and validates on save).
  const allPartners = useMemo(() => {
    const set = new Set(PARTNERS)
    partners.forEach(p => set.add(p))
    customPartners.forEach(p => set.add(p))
    return [...set]
  }, [partners, customPartners])

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
        <button onClick={fetchAll}
          style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', color: t.text2, fontSize: '12px', cursor: 'pointer' }}>
          ⟳ Refresh
        </button>
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
          const collapsed = collapsedRegions.has(r)
          const configuredCount = list.filter(b => b.logistics_partner && b.pickup_time && b.delivery_tat_hours && (b.pickup_days || []).length).length
          return (
            <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <RegionBanner
                t={t} accent={accent} regionName={r} list={list}
                configuredCount={configuredCount}
                collapsed={collapsed}
                onToggleCollapse={() => toggleRegionCollapsed(r)}
              />
              {!collapsed && (
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
                      partnerOptions={allPartners}
                      onAddPartner={addCustomPartner}
                      delayMs={Math.min(i * 25, 300)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
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
// the active partner as a chip; clicking opens a menu of options + an
// 'Add new partner…' affordance at the bottom. Partners added here propagate
// to every other card's picker via the shared options list.
function PartnerPicker({ t, accent, busy, value, onChange, dirty, options, onAddPartner }) {
  const [open,      setOpen]      = useState(false)
  const [adding,    setAdding]    = useState(false)
  const [newName,   setNewName]   = useState('')
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false); setAdding(false); setNewName('')
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setAdding(false); setNewName('') } }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Brand-colour map for the known partners. Anything not listed inherits
  // the region accent — covers BVC and any custom-added partners.
  const colorFor = (p) => ({
    BVC: accent, BlueDart: t.blue, DTDC: t.green, 'India Post': t.red,
  }[p]) || accent

  const display = value || 'Set partner'
  const partnerColor = colorFor(value)

  const confirmAdd = () => {
    const cleaned = newName.trim()
    if (!cleaned) return
    if (onAddPartner) onAddPartner(cleaned)
    setAdding(false); setNewName(''); setOpen(false)
  }

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
            const optColor = colorFor(opt)
            return (
              <button key={opt} onClick={() => { onChange(opt); setOpen(false) }}
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
          {adding ? (
            <div style={{ display: 'flex', gap: '4px', padding: '6px 8px', background: `${t.gold}06` }}>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmAdd() } }}
                autoFocus placeholder="New partner name" maxLength={60}
                style={{
                  flex: 1, background: t.card,
                  border: `1px solid ${t.gold}`,
                  borderRadius: '5px', padding: '5px 8px',
                  fontSize: '11.5px', color: t.text1, outline: 'none',
                }} />
              <button onClick={confirmAdd} disabled={!newName.trim()}
                style={{ background: newName.trim() ? t.gold : `${t.gold}40`, color: '#1a0a00', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '11px', fontWeight: 700, cursor: newName.trim() ? 'pointer' : 'not-allowed' }}>
                Add
              </button>
              <button onClick={() => { setAdding(false); setNewName('') }}
                style={{ background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, borderRadius: '5px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                ×
              </button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)}
              style={{
                width: '100%', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'transparent', border: 'none',
                padding: '8px 12px', fontSize: '11.5px',
                color: t.gold, fontWeight: 600, cursor: 'pointer',
                transition: 'background .12s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = `${t.gold}10`}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ fontSize: '13px', lineHeight: 1 }}>＋</span>
              <span>Add new partner…</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// RegionBanner — region header + inline 'Set defaults for this region'
// expandable form. Lets the operator stamp partner/time/TAT/days onto all
// branches in the region in a single click without opening the floating
// bulk panel. Only fields with values are sent in the patch.

// Collapsible region header. Clicking the banner toggles whether the cards
// underneath are visible. Shows region name, configured-count, and a chevron.
function RegionBanner({ t, accent, regionName, list, configuredCount, collapsed, onToggleCollapse }) {
  return (
    <div onClick={onToggleCollapse}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse() } }}
      style={{
        background: `linear-gradient(90deg, ${accent}22 0%, ${accent}08 40%, transparent 70%)`,
        border: `1px solid ${accent}30`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: '10px',
        padding: '12px 18px',
        display: 'flex', alignItems: 'center', gap: '14px',
        flexWrap: 'wrap',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background .2s ease, border-color .2s ease',
      }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '22px', height: '22px', borderRadius: '50%',
        background: `${accent}25`, color: accent,
        fontSize: '12px', fontWeight: 700,
        transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        transition: 'transform .2s ease',
      }}>▾</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '15px', color: t.text1, fontWeight: 700, letterSpacing: '.02em' }}>{regionName}</span>
        <span style={{ fontSize: '11px', color: t.text3 }}>
          <strong style={{ color: accent, fontFamily: 'monospace' }}>{configuredCount}</strong>
          <span style={{ color: t.text4 }}> / </span>
          <strong style={{ color: t.text2, fontFamily: 'monospace' }}>{list.length}</strong> configured
        </span>
      </div>
      <div style={{ flex: 1 }} />
      {collapsed && (
        <span style={{ fontSize: '10px', color: t.text4, fontStyle: 'italic' }}>click to expand</span>
      )}
    </div>
  )
}

// Per-branch editor card. Partner picker uses partnerOptions (merged default +
// per-branch existing + runtime-added) and can add new partners via
// onAddPartner. No checkbox / no bulk affordance — pure single-branch edit.
function BranchCard({ t, branch, busy, onSave, regionAccent, partnerOptions, onAddPartner, delayMs = 0 }) {
  const [partner,      setPartner]      = useState(branch.logistics_partner || 'BVC')
  const [pickup,  setPickup]  = useState(branch.pickup_time || '')
  const [tat,     setTat]     = useState(branch.delivery_tat_hours || 24)
  const [days,    setDays]    = useState(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat'])
  const [hover,   setHover]   = useState(false)

  // Reset on branch row update (after save)
  useEffect(() => { setPartner(branch.logistics_partner || 'BVC') }, [branch.logistics_partner])
  useEffect(() => { setPickup(branch.pickup_time || '') }, [branch.pickup_time])
  useEffect(() => { setTat(branch.delivery_tat_hours || 24) }, [branch.delivery_tat_hours])
  useEffect(() => { setDays(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat']) }, [branch.pickup_days])

  const dirty = (
    (partner || null)                !== (branch.logistics_partner || null) ||
    (pickup || '')                    !== (branch.pickup_time       || '')   ||
    Number(tat)                       !== Number(branch.delivery_tat_hours || 24)  ||
    JSON.stringify([...days].sort()) !== JSON.stringify([...(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat'])].sort())
  )

  const onSubmit = async () => {
    await onSave(branch.name, {
      partner,
      pickup_time:        pickup,
      delivery_tat_hours: tat,
      pickup_days:        days,
    })
  }

  const onReset = () => {
    setPartner(branch.logistics_partner || 'BVC')
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

  // Live 'next pickup' clock — refreshes every minute so the in-line indicator
  // stays accurate without a full page refetch.
  const [, tickPickup] = useState(0)
  useEffect(() => {
    if (!branch.pickup_time || !(branch.pickup_days || []).length) return
    const id = setInterval(() => tickPickup(x => x + 1), 60000)
    return () => clearInterval(id)
  }, [branch.pickup_time, branch.pickup_days])
  const nextPick = nextPickup(branch.pickup_time, branch.pickup_days)
  const pickColors = { now: t.red, today: t.green, missed: t.orange, tomorrow: t.blue, soon: t.text2, later: t.text4 }
  const pickColor  = pickColors[nextPick?.tier] || t.text4

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
        background: hover
          ? `linear-gradient(180deg, ${accent}10 0%, ${baseBg} 60%)`
          : (configured ? baseBg : `${t.orange}06`),
        // Subtle striped overlay for HUB cards so they stand out from leaf
        // branches at a glance. Pattern is painted on top of the base bg.
        backgroundImage: branch.is_hub
          ? `repeating-linear-gradient(135deg, transparent 0 10px, ${t.gold}06 10px 11px)`
          : 'none',
        border: `1px solid ${hover ? `${accent}55` : (configured ? t.border : `${t.orange}25`)}`,
        borderRadius: '12px',
        boxShadow: hover ? `0 6px 22px ${accent}26` : '0 1px 3px rgba(0,0,0,.15)',
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

      {/* Card header — purely informational (no selection / bulk affordance). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
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
            dirty={partner !== (branch.logistics_partner || null)}
            options={partnerOptions || PARTNERS}
            onAddPartner={(name) => {
              if (onAddPartner) onAddPartner(name)
              setPartner(name)
            }}
          />
        </Row>
        <Row label="Pickup">
          <div>
            <input type="time" value={pickup} onChange={e => setPickup(e.target.value)} disabled={busy}
              style={{ ...inp((pickup || '') !== (branch.pickup_time || '')), width: '100%' }} />
            {nextPick && (
              <div style={{ fontSize: '10px', marginTop: '4px', color: pickColor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{
                  width: '5px', height: '5px', borderRadius: '50%', background: pickColor, display: 'inline-block',
                  ...(nextPick.tier === 'now' || nextPick.tier === 'missed' ? { color: pickColor } : {}),
                }}
                  className={nextPick.tier === 'now' ? 'logi-pulse' : ''} />
                Next pickup · {nextPick.label}
              </div>
            )}
          </div>
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
