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
//
// Transaction Executives = our in-house pickup squad that services the
// Bangalore HUB → HO leg (each leaf Bangalore branch consolidates at one
// of the 6 hubs first, executives sweep the hubs).
const PARTNERS = ['BVC', 'Transaction Executives']

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

  // Bangalore HUB list — branches with is_hub=true in the Bangalore region.
  // Surfaced to BranchCard so leaf Bangalore branches can pick their hub.
  // Re-derived from `branches` each render so flipping is_hub via SQL +
  // refreshing keeps the picker in sync without a separate fetch.
  const bangaloreHubs = useMemo(
    () => branches
      .filter(b => b.region === 'Bangalore' && b.is_hub)
      .map(b => b.name)
      .sort(),
    [branches]
  )

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

  // Header stats. Bangalore branches don't have pickup/TAT/days (daily
  // executive pickup), so "missing" only flags them if partner is unset
  // or — for leaves — the hub isn't assigned yet.
  const stats = useMemo(() => {
    const total = branches.length
    const withPickup = branches.filter(b => b.region === 'Bangalore' || b.pickup_time).length
    const withTat    = branches.filter(b => b.region === 'Bangalore' || b.delivery_tat_hours).length
    const missingAny = branches.filter(b => {
      if (b.region === 'Bangalore') {
        return !b.logistics_partner || (!b.is_hub && !b.hub_branch_name)
      }
      return !b.pickup_time || !b.delivery_tat_hours || !b.logistics_partner
    }).length
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
  const thL  = { padding: '9px 12px', textAlign: 'left', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' }

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
        <Stat t={t} label="With TAT"            value={`${stats.withTat} / ${stats.total}`}    sub="delivery target set" accent={t.text2}  icon="⇄" />
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
              <FilterChip key={r} t={t} active={region === r} color={t.gold} onClick={() => setRegion(region === r ? '' : r)}>{r}</FilterChip>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center', color: t.text4 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No branches match the current filter.</div>
      ) : (
        Object.entries(grouped).map(([r, list]) => {
          const accent = t.gold
          const collapsed = collapsedRegions.has(r)
          const configuredCount = list.filter(b => {
            if (b.region === 'Bangalore') {
              return !!b.logistics_partner && (b.is_hub || !!b.hub_branch_name)
            }
            return b.logistics_partner && b.pickup_time && b.delivery_tat_hours && (b.pickup_days || []).length
          }).length
          return (
            <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <RegionBanner
                t={t} accent={accent} regionName={r} list={list}
                configuredCount={configuredCount}
                collapsed={collapsed}
                onToggleCollapse={() => toggleRegionCollapsed(r)}
              />
              {!collapsed && (
                <div style={{ ...card, overflow: 'visible' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thL}>Branch</th>
                        {r === 'Bangalore'
                          ? <th style={thL} colSpan={3}>Hub · schedule</th>
                          : <><th style={thL}>Pickup</th><th style={thL}>TAT</th><th style={thL}>Days</th></>}
                        <th style={{ ...thL, textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(b => (
                        <BranchRow
                          key={b.name}
                          t={t}
                          branch={b}
                          busy={busyName === b.name}
                          onSave={saveBranch}
                          regionAccent={accent}
                          partnerOptions={allPartners}
                          onAddPartner={addCustomPartner}
                          bangaloreHubs={bangaloreHubs}
                        />
                      ))}
                    </tbody>
                  </table>
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

// Per-branch editor ROW (table). Same inline editors as the old card — partner
// picker, pickup time, TAT, days, hub — laid out horizontally. Save/Cancel
// appear in the Action cell when the row is dirty.
function BranchRow({ t, branch, busy, onSave, regionAccent, partnerOptions, onAddPartner, bangaloreHubs = [] }) {
  const defaultPartner = branch.region === 'Bangalore' ? 'Transaction Executives' : 'BVC'
  const [partner, setPartner] = useState(branch.logistics_partner || defaultPartner)
  const [pickup,  setPickup]  = useState(branch.pickup_time || '')
  const [tat,     setTat]     = useState(branch.delivery_tat_hours || 24)
  const [days,    setDays]    = useState(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat'])
  const [hub,     setHub]     = useState(branch.hub_branch_name || '')

  const isBangalore  = branch.region === 'Bangalore'
  const showHubField = isBangalore && !branch.is_hub && bangaloreHubs.length > 0

  useEffect(() => { setPartner(branch.logistics_partner || defaultPartner) }, [branch.logistics_partner, defaultPartner])
  useEffect(() => { setPickup(branch.pickup_time || '') }, [branch.pickup_time])
  useEffect(() => { setTat(branch.delivery_tat_hours || 24) }, [branch.delivery_tat_hours])
  useEffect(() => { setDays(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat']) }, [branch.pickup_days])
  useEffect(() => { setHub(branch.hub_branch_name || '') }, [branch.hub_branch_name])

  const partnerDirty = !isBangalore && ((partner || null) !== (branch.logistics_partner || null))
  const scheduleDirty = !isBangalore && (
    (pickup || '')                    !== (branch.pickup_time       || '')   ||
    Number(tat)                       !== Number(branch.delivery_tat_hours || 24)  ||
    JSON.stringify([...days].sort()) !== JSON.stringify([...(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat'])].sort())
  )
  const dirty = partnerDirty || scheduleDirty || (showHubField && (hub || '') !== (branch.hub_branch_name || ''))

  const onSubmit = async () => {
    const patch = { partner }
    if (!isBangalore) { patch.pickup_time = pickup; patch.delivery_tat_hours = tat; patch.pickup_days = days }
    if (showHubField) patch.hub_branch_name = hub
    await onSave(branch.name, patch)
  }
  const onReset = () => {
    setPartner(branch.logistics_partner || defaultPartner)
    setPickup(branch.pickup_time || ''); setTat(branch.delivery_tat_hours || 24)
    setDays(branch.pickup_days || ['Mon','Tue','Wed','Thu','Fri','Sat']); setHub(branch.hub_branch_name || '')
  }

  const accent = regionAccent || t.gold
  const configured = isBangalore
    ? !!branch.logistics_partner && (branch.is_hub || !!branch.hub_branch_name)
    : !!branch.logistics_partner && !!branch.pickup_time && !!branch.delivery_tat_hours && (branch.pickup_days || []).length > 0

  const [, tickPickup] = useState(0)
  useEffect(() => {
    if (!branch.pickup_time || !(branch.pickup_days || []).length) return
    const id = setInterval(() => tickPickup(x => x + 1), 60000)
    return () => clearInterval(id)
  }, [branch.pickup_time, branch.pickup_days])
  const nextPick = nextPickup(branch.pickup_time, branch.pickup_days)
  const pickColors = { now: t.red, today: t.green, missed: t.orange, tomorrow: t.text2, soon: t.text2, later: t.text4 }
  const pickColor  = pickColors[nextPick?.tier] || t.text4

  const td  = { padding: '9px 12px', borderBottom: `1px solid ${t.border}30`, fontSize: '12px', color: t.text1, verticalAlign: 'middle' }
  const inp = (isDirty) => ({ background: t.card, border: `1px solid ${isDirty ? t.gold : t.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '12px', color: t.text1, outline: 'none' })

  return (
    <tr style={{ background: dirty ? `${t.gold}08` : (configured ? 'transparent' : `${t.orange}05`) }}>
      {/* Branch */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: t.text1 }}>{branch.name}</span>
          {branch.is_hub && <span style={{ fontSize: '8px', color: t.gold, background: `${t.gold}15`, border: `1px solid ${t.gold}40`, borderRadius: '3px', padding: '1px 5px', fontWeight: 700, letterSpacing: '.06em' }}>HUB</span>}
          <span title={configured ? 'Fully configured' : 'Some fields are missing'} className={configured ? '' : 'logi-pulse'} style={{ width: '7px', height: '7px', borderRadius: '50%', background: configured ? t.green : t.orange, color: configured ? t.green : t.orange }} />
        </div>
      </td>

      {isBangalore ? (
        <td style={{ ...td }} colSpan={3}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {showHubField ? (
              <select value={hub} onChange={e => setHub(e.target.value)} disabled={busy}
                style={{ ...inp((hub || '') !== (branch.hub_branch_name || '')), minWidth: '160px', cursor: busy ? 'not-allowed' : 'pointer' }}>
                <option value="">— Assign hub —</option>
                {bangaloreHubs.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            ) : branch.is_hub ? (
              <span style={{ fontSize: '11px', color: t.text3, fontWeight: 600 }}>Consolidation hub</span>
            ) : null}
            <span style={{ fontSize: '11px', color: t.text4 }}>◷ Daily pickup — executives sweep this {branch.is_hub ? 'hub' : 'branch'} every day.</span>
          </div>
        </td>
      ) : (
        <>
          {/* Pickup */}
          <td style={{ ...td, minWidth: '128px' }}>
            <input type="time" value={pickup} onChange={e => setPickup(e.target.value)} disabled={busy}
              style={{ ...inp((pickup || '') !== (branch.pickup_time || '')), width: '108px' }} />
            {nextPick && (
              <div style={{ fontSize: '9.5px', marginTop: '3px', color: pickColor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className={nextPick.tier === 'now' ? 'logi-pulse' : ''} style={{ width: '5px', height: '5px', borderRadius: '50%', background: pickColor, color: pickColor, display: 'inline-block' }} />
                {nextPick.label}
              </div>
            )}
          </td>
          {/* TAT */}
          <td style={{ ...td }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[24, 48, 72].map(h => {
                const active = Number(tat) === h
                return (
                  <button key={h} onClick={() => setTat(h)} disabled={busy}
                    style={{ background: active ? t.gold : 'transparent', color: active ? '#1a0a00' : t.text3, border: `1px solid ${active ? t.gold : t.border}`, borderRadius: '5px', padding: '5px 9px', fontSize: '10.5px', fontWeight: active ? 700 : 500, cursor: 'pointer' }}>
                    {h}h
                  </button>
                )
              })}
            </div>
          </td>
          {/* Days */}
          <td style={{ ...td }}>
            <div style={{ display: 'flex', gap: '3px' }}>
              {DAYS.map(d => {
                const active = days.includes(d)
                return (
                  <button key={d} onClick={() => setDays(prev => active ? prev.filter(x => x !== d) : [...prev, d])} disabled={busy} title={d}
                    style={{ background: active ? `${accent}28` : 'transparent', color: active ? accent : t.text4, border: `1px solid ${active ? `${accent}70` : t.border}`, borderRadius: '4px', width: '22px', padding: '4px 0', fontSize: '9.5px', fontWeight: 700, cursor: 'pointer' }}>
                    {d[0]}
                  </button>
                )
              })}
            </div>
          </td>
        </>
      )}

      {/* Action */}
      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
        {dirty ? (
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button onClick={onReset} disabled={busy}
              style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '5px 11px', fontSize: '10px', color: t.text3, cursor: busy ? 'wait' : 'pointer', fontWeight: 600 }}>Cancel</button>
            <button onClick={onSubmit} disabled={busy}
              style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '5px', padding: '5px 15px', fontSize: '10px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', boxShadow: `0 2px 8px ${t.gold}55` }}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        ) : (
          <span style={{ color: t.text4, fontSize: '11px' }}>—</span>
        )}
      </td>
    </tr>
  )
}
