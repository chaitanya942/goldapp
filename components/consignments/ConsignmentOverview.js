'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e8e0d0', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const REGION_COLORS = {
  'Rest of Karnataka': '#c9a84c',
  'Andhra Pradesh':    '#3a8fbf',
  'Telangana':         '#8c5ac8',
  'Kerala':            '#3aaa6a',
}

const fmt    = (n, d = 3) => n != null ? Number(n).toFixed(d) : '—'
const fmtNum = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[+m - 1]} ${y.slice(2)}`
}
const daysFromNow = (d) => {
  if (!d) return null
  return Math.floor((new Date(d).getTime() - Date.now()) / 86400000)
}

function ShipBadge({ date, t }) {
  if (!date) return <span style={{ color: t.text4, fontSize: '11px' }}>—</span>
  const days = daysFromNow(date)
  const label = fmtDate(date)
  if (days < 0)  return <span style={{ fontSize: '11px', color: t.red,    background: `${t.red}18`,    borderRadius: '5px', padding: '2px 8px', fontWeight: 700 }}>⚠ Overdue · {label}</span>
  if (days <= 3) return <span style={{ fontSize: '11px', color: t.red,    background: `${t.red}15`,    borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>🔴 {label} ({days}d)</span>
  if (days <= 7) return <span style={{ fontSize: '11px', color: t.orange,  background: `${t.orange}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>🟠 {label} ({days}d)</span>
  return              <span style={{ fontSize: '11px', color: t.green,  background: `${t.green}12`,  borderRadius: '5px', padding: '2px 8px' }}>{label} ({days}d)</span>
}

function AgeBadge({ days, t }) {
  if (!days && days !== 0) return <span style={{ color: t.text4 }}>—</span>
  const color = days > 14 ? t.red : days > 7 ? t.orange : t.green
  return <span style={{ fontSize: '11px', color, background: `${color}18`, borderRadius: '5px', padding: '2px 8px', fontWeight: 700 }}>{days}d</span>
}

const SORT_OPTIONS = [
  { key: 'gross_wt', label: 'Gross Weight ↓' },
  { key: 'bills',    label: 'Total Bills ↓'  },
  { key: 'older',    label: 'Older Stock ↓'  },
  { key: 'age',      label: 'Oldest Age ↓'   },
  { key: 'urgent',   label: 'Most Urgent'    },
]

export default function ConsignmentOverview() {
  const { theme, setActiveNav, canSee } = useApp()
  const t = THEMES[theme]

  const [data,         setData]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [activeRegion, setActiveRegion] = useState(null)
  const [sortBy,       setSortBy]       = useState('gross_wt')
  const [lastRefresh,  setLastRefresh]  = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/consignments?action=branch_overview')
    const json = await res.json()
    setData(json.data || [])
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Region summary for flashcards ─────────────────────────────────────────
  const regions = [...new Set(data.map(b => b.region).filter(Boolean))].sort()
  const regionStats = regions.reduce((acc, r) => {
    const bs = data.filter(b => b.region === r)
    acc[r] = {
      branches: bs.length,
      bills:    bs.reduce((s, b) => s + b.total_bills, 0),
      gross_wt: bs.reduce((s, b) => s + b.total_gross_wt, 0),
      urgent:   bs.filter(b => daysFromNow(b.ship_before) !== null && daysFromNow(b.ship_before) <= 3).length,
    }
    return acc
  }, {})

  // ── Filtered + sorted ─────────────────────────────────────────────────────
  const filtered = data
    .filter(b => !activeRegion || b.region === activeRegion)
    .filter(b => !search || b.branch_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'gross_wt') return b.total_gross_wt   - a.total_gross_wt
      if (sortBy === 'bills')    return b.total_bills       - a.total_bills
      if (sortBy === 'older')    return b.older_bills       - a.older_bills
      if (sortBy === 'age')      return b.oldest_age_days   - a.oldest_age_days
      if (sortBy === 'urgent') {
        const da = daysFromNow(a.ship_before) ?? 999
        const db = daysFromNow(b.ship_before) ?? 999
        return da - db
      }
      return 0
    })

  // ── Grand totals ──────────────────────────────────────────────────────────
  const grandBills    = filtered.reduce((s, b) => s + b.total_bills,     0)
  const grandGross    = filtered.reduce((s, b) => s + b.total_gross_wt,  0)
  const grandOlder    = filtered.reduce((s, b) => s + b.older_bills,     0)
  const grandToday    = filtered.reduce((s, b) => s + b.today_bills,     0)
  const maxAge        = filtered.reduce((m, b) => Math.max(m, b.oldest_age_days), 0)
  const urgentBranches = filtered.filter(b => {
    const d = daysFromNow(b.ship_before)
    return d !== null && d <= 3
  }).length

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const inp     = { background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 12px', fontSize: '12px', color: t.text1, outline: 'none' }

  const th = { padding: '9px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600, userSelect: 'none' }

  return (
    <div style={{ padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Branch Stock Overview</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '3px' }}>
            Live stock at all outside-Bangalore branches
            {lastRefresh && <span style={{ color: t.text4 }}> · Refreshed {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(activeRegion || search) && (
            <button onClick={() => { setActiveRegion(null); setSearch('') }}
              style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
              ✕ Clear Filters
            </button>
          )}
          <button onClick={fetchData} disabled={loading}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
            {loading ? '⟳' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Region Flashcards ── */}
      {canSee('element.consignment-overview.region_cards') && <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {/* All Regions card */}
        <div onClick={() => setActiveRegion(null)}
          style={{ ...card, padding: '12px 18px', cursor: 'pointer', minWidth: '130px', flexShrink: 0,
            borderColor: !activeRegion ? t.gold : t.border,
            background:  !activeRegion ? `${t.gold}10` : t.card,
            transition: 'all .15s' }}
          onMouseEnter={e => { if (activeRegion) e.currentTarget.style.borderColor = `${t.gold}60` }}
          onMouseLeave={e => { if (activeRegion) e.currentTarget.style.borderColor = t.border }}>
          <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '5px' }}>All Regions</div>
          <div style={{ fontSize: '20px', fontWeight: 300, color: !activeRegion ? t.gold : t.text1 }}>{data.length}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>branches</div>
        </div>

        {regions.map(r => {
          const stats  = regionStats[r] || {}
          const color  = REGION_COLORS[r] || t.text3
          const active = activeRegion === r
          return (
            <div key={r} onClick={() => setActiveRegion(active ? null : r)}
              style={{ ...card, padding: '12px 18px', cursor: 'pointer', minWidth: '155px', flexShrink: 0,
                borderColor: active ? color : t.border,
                background:  active ? `${color}12` : t.card,
                transition: 'all .15s' }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = `${color}60` }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = t.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '5px' }}>
                <div style={{ fontSize: '10px', color: active ? color : t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: active ? 700 : 400 }}>{r}</div>
                {stats.urgent > 0 && <span style={{ fontSize: '9px', background: `${t.red}20`, color: t.red, borderRadius: '4px', padding: '1px 5px', fontWeight: 700 }}>{stats.urgent} urgent</span>}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 300, color: active ? color : t.text1 }}>{stats.bills ?? 0}</div>
              <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>
                {stats.branches} branch{stats.branches !== 1 ? 'es' : ''} · {fmt(stats.gross_wt, 2)}g
              </div>
            </div>
          )
        })}
      </div>}

      {/* ── Summary KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
        {[
          { label: 'Branches with Stock',  value: filtered.length,                                                             color: t.text1  },
          { label: 'Today\'s Bills',        value: fmtNum(grandToday),                                                          color: t.blue   },
          { label: 'Today\'s Net Wt',       value: `${fmt(filtered.reduce((s,b)=>s+(b.today_net_wt||0),0),2)}g`,               color: t.blue   },
          { label: 'Pending Bills',         value: fmtNum(grandOlder),                                                          color: t.orange },
          { label: 'Pending Net Wt',        value: `${fmt(filtered.reduce((s,b)=>s+(b.older_net_wt||0),0),2)}g`,               color: t.orange },
        ].map(k => (
          <div key={k.label} style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '5px' }}>{k.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 300, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Urgent banner ── */}
      {urgentBranches > 0 && (
        <div style={{ background: `${t.red}12`, border: `1px solid ${t.red}30`, borderRadius: '8px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px' }}>⚠</span>
          <div>
            <span style={{ fontSize: '12px', color: t.red, fontWeight: 600 }}>{urgentBranches} branch{urgentBranches !== 1 ? 'es' : ''} must ship within 3 days or are overdue</span>
            <span style={{ fontSize: '11px', color: t.text3, marginLeft: '8px' }}>Sort by "Most Urgent" to prioritize</span>
          </div>
          <button onClick={() => setSortBy('urgent')} style={{ marginLeft: 'auto', background: t.red, color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>Prioritize</button>
        </div>
      )}

      {/* ── Search + Sort ── */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {canSee('element.consignment-overview.search') && (
          <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '12px', pointerEvents: 'none' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch..."
              style={{ ...inp, paddingLeft: '28px', width: '100%' }} />
          </div>
        )}
        {canSee('element.consignment-overview.sort') && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto', flexWrap: 'wrap' }}>
            {SORT_OPTIONS.map(o => (
              <button key={o.key} onClick={() => setSortBy(o.key)}
                style={{ background: sortBy === o.key ? `${t.gold}20` : 'transparent', border: `1px solid ${sortBy === o.key ? t.gold : t.border2}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: sortBy === o.key ? t.gold : t.text3, cursor: 'pointer', transition: 'all .1s' }}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Table ── */}
      {canSee('element.consignment-overview.table') && <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
            {search || activeRegion ? 'No branches match your filter' : 'No stock at any branch'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th style={{ ...th, width: '32px', textAlign: 'center' }}>#</th>
                  <th style={th}>Branch</th>
                  <th style={{ ...th, textAlign: 'center' }}>Pickup Time</th>
                  <th style={{ ...th, textAlign: 'right' }}>Today's Bills</th>
                  <th style={{ ...th, textAlign: 'right' }}>Today's Net Wt</th>
                  <th style={{ ...th, textAlign: 'right' }}>Pending Bills</th>
                  <th style={{ ...th, textAlign: 'right' }}>Pending Net Wt</th>
                  <th style={{ ...th, textAlign: 'center' }}>Oldest Bill</th>
                  <th style={{ ...th, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b, i) => {
                  const rColor  = REGION_COLORS[b.region] || t.text3
                  const shipDays = daysFromNow(b.ship_before)
                  const rowUrgent = shipDays !== null && shipDays <= 3
                  return (
                    <tr key={b.branch_name}
                      style={{ borderBottom: `1px solid ${t.border}20`, background: rowUrgent ? `${t.red}05` : 'transparent', transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = rowUrgent ? `${t.red}10` : `${t.gold}05`}
                      onMouseLeave={e => e.currentTarget.style.background = rowUrgent ? `${t.red}05` : 'transparent'}>

                      {/* Rank */}
                      <td style={{ padding: '10px 14px', fontSize: '11px', color: t.text4, textAlign: 'center' }}>{i + 1}</td>

                      {/* Branch */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: t.text1 }}>{b.branch_name}</div>
                        <span style={{ fontSize: '10px', color: rColor, background: `${rColor}15`, borderRadius: '4px', padding: '1px 6px', marginTop: '3px', display: 'inline-block' }}>{b.region}</span>
                      </td>

                      {/* Pickup Time */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {b.pickup_time
                          ? <span style={{ fontSize: '12px', color: t.blue, background: `${t.blue}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>{b.pickup_time}</span>
                          : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                      </td>

                      {/* Today's Bills */}
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        {b.today_bills > 0
                          ? <span style={{ fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 600 }}>{b.today_bills}</span>
                          : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                      </td>

                      {/* Today's Net Wt */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '12px', color: b.today_net_wt > 0 ? t.blue : t.text4, fontFamily: 'monospace' }}>
                        {b.today_net_wt > 0 ? `${fmt(b.today_net_wt, 2)}g` : '—'}
                      </td>

                      {/* Pending Bills */}
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <span style={{ fontSize: '13px', color: b.older_bills > 0 ? t.orange : t.text4, fontFamily: 'monospace', fontWeight: b.older_bills > 0 ? 600 : 400 }}>
                          {b.older_bills > 0 ? b.older_bills : '—'}
                        </span>
                      </td>

                      {/* Pending Net Wt */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '12px', color: b.older_net_wt > 0 ? t.orange : t.text4, fontFamily: 'monospace', fontWeight: b.older_net_wt > 0 ? 600 : 400 }}>
                        {b.older_net_wt > 0 ? `${fmt(b.older_net_wt, 2)}g` : '—'}
                      </td>

                      {/* Oldest Bill Age */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <AgeBadge days={b.oldest_age_days} t={t} />
                        {b.oldest_date && <div style={{ fontSize: '9px', color: t.text4, marginTop: '3px' }}>{fmtDate(b.oldest_date)}</div>}
                      </td>

                      {/* Action */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button
                          onClick={() => setActiveNav('consignment-data')}
                          style={{ background: `${t.gold}15`, border: `1px solid ${t.gold}40`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: t.gold, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          Move →
                        </button>
                      </td>
                    </tr>
                  )
                })}

                {/* Totals row */}
                <tr style={{ background: t.card2, borderTop: `2px solid ${t.border}` }}>
                  <td colSpan={2} style={{ padding: '10px 14px', fontSize: '11px', color: t.text3, fontWeight: 600 }}>
                    TOTAL — {filtered.length} branch{filtered.length !== 1 ? 'es' : ''}
                  </td>
                  <td style={{ padding: '10px 14px' }} />
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>{grandToday || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 600 }}>{fmt(filtered.reduce((s,b)=>s+(b.today_net_wt||0),0),2)}g</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '13px', color: t.orange, fontFamily: 'monospace', fontWeight: 700 }}>{grandOlder || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '13px', color: t.orange, fontFamily: 'monospace', fontWeight: 600 }}>{fmt(filtered.reduce((s,b)=>s+(b.older_net_wt||0),0),2)}g</td>
                  <td colSpan={2} style={{ padding: '10px 14px' }} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>}

      {/* Ship Before note */}
      <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
        * Pending = purchases with stock_status <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>at_branch</code> from before today · Pickup time editable per branch in Branch Management
      </div>

    </div>
  )
}
