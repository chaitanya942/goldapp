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

const REGION_ICONS = {
  'Rest of Karnataka': '🏛',
  'Andhra Pradesh':    '🌊',
  'Telangana':         '🌆',
  'Kerala':            '🌴',
}

const fmt     = (n, d = 3) => n != null ? Number(n).toFixed(d) : '—'
const fmtNum  = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[+m - 1]}`
}
const daysFromNow = (d) => {
  if (!d) return null
  return Math.floor((new Date(d).getTime() - Date.now()) / 86400000)
}
const ageDaysFromDate = (d) => {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

function AgeBadge({ days, t }) {
  if (!days && days !== 0) return <span style={{ color: t.text4 }}>—</span>
  const color = days > 14 ? t.red : days > 7 ? t.orange : t.green
  return (
    <span style={{ fontSize: '11px', color, background: `${color}18`, borderRadius: '5px', padding: '2px 8px', fontWeight: 700 }}>
      {days}d
    </span>
  )
}

const SORT_COLS = [
  { key: 'today_bills',   label: "Today's Bills",   align: 'right'  },
  { key: 'today_net_wt',  label: "Today's Net Wt",  align: 'right'  },
  { key: 'older_bills',   label: 'Pending Bills',   align: 'right'  },
  { key: 'older_net_wt',  label: 'Pending Net Wt',  align: 'right'  },
  { key: 'oldest_age',    label: 'Oldest Bill',     align: 'center' },
]

export default function ConsignmentOverview() {
  const { theme, setActiveNav, canSee } = useApp()
  const t = THEMES[theme]

  const [data,         setData]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [activeRegion, setActiveRegion] = useState(null)
  const [sortKey,      setSortKey]      = useState('older_net_wt')
  const [sortDir,      setSortDir]      = useState(-1)   // -1 = desc, 1 = asc
  const [lastRefresh,  setLastRefresh]  = useState(null)
  const [tick,         setTick]         = useState(0)   // for live clock

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/consignments?action=branch_overview')
    const json = await res.json()
    setData(json.data || [])
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 3 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Live "X min ago" clock
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const minsAgo = lastRefresh ? Math.floor((Date.now() - lastRefresh.getTime()) / 60000) : null

  // ── Column sort toggle ────────────────────────────────────────────────────
  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(-1) }
  }

  // ── Region summary ────────────────────────────────────────────────────────
  const regions = [...new Set(data.map(b => b.region).filter(Boolean))].sort()
  const regionStats = regions.reduce((acc, r) => {
    const bs = data.filter(b => b.region === r)
    acc[r] = {
      branches:    bs.length,
      today_bills: bs.reduce((s, b) => s + (b.today_bills || 0), 0),
      older_bills: bs.reduce((s, b) => s + (b.older_bills || 0), 0),
      gross_wt:    bs.reduce((s, b) => s + b.total_gross_wt, 0),
    }
    return acc
  }, {})

  // ── Filtered + sorted ─────────────────────────────────────────────────────
  const filtered = data
    .filter(b => !activeRegion || b.region === activeRegion)
    .filter(b => !search || b.branch_name.toLowerCase().includes(search.toLowerCase()))
    .slice()
    .sort((a, b) => {
      let av = 0, bv = 0
      if (sortKey === 'today_bills')  { av = a.today_bills  || 0; bv = b.today_bills  || 0 }
      if (sortKey === 'today_net_wt') { av = a.today_net_wt || 0; bv = b.today_net_wt || 0 }
      if (sortKey === 'older_bills')  { av = a.older_bills  || 0; bv = b.older_bills  || 0 }
      if (sortKey === 'older_net_wt') { av = a.older_net_wt || 0; bv = b.older_net_wt || 0 }
      if (sortKey === 'oldest_age')   { av = a.oldest_age_days || 0; bv = b.oldest_age_days || 0 }
      if (sortKey === 'total_net_wt') { av = (a.today_net_wt || 0) + (a.older_net_wt || 0); bv = (b.today_net_wt || 0) + (b.older_net_wt || 0) }
      return (av - bv) * sortDir
    })

  // ── Grand totals ──────────────────────────────────────────────────────────
  const grandToday    = filtered.reduce((s, b) => s + (b.today_bills   || 0), 0)
  const grandTodayWt  = filtered.reduce((s, b) => s + (b.today_net_wt  || 0), 0)
  const grandOlder    = filtered.reduce((s, b) => s + (b.older_bills   || 0), 0)
  const grandOlderWt  = filtered.reduce((s, b) => s + (b.older_net_wt  || 0), 0)

  // ── Styles ────────────────────────────────────────────────────────────────
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span style={{ color: t.text4, fontSize: '10px', marginLeft: '4px' }}>⇅</span>
    return <span style={{ color: t.gold, fontSize: '10px', marginLeft: '4px' }}>{sortDir === -1 ? '↓' : '↑'}</span>
  }

  const thBase = {
    padding: '10px 14px', fontSize: '10px', color: t.text4,
    letterSpacing: '.08em', textTransform: 'uppercase',
    background: t.card2, borderBottom: `1px solid ${t.border}`,
    whiteSpace: 'nowrap', fontWeight: 600, userSelect: 'none',
  }

  return (
    <div style={{ padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Branch Stock Overview</div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: t.green, background: `${t.green}15`, borderRadius: '20px', padding: '3px 10px', fontWeight: 600 }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.green, display: 'inline-block', animation: 'pulse 2s infinite' }} />
              LIVE
            </span>
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            Outside-Bangalore branches ·
            {lastRefresh && (
              <span style={{ color: minsAgo === 0 ? t.green : t.text4, marginLeft: '4px' }}>
                {minsAgo === 0 ? 'just refreshed' : `${minsAgo}m ago`} · {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(activeRegion || search) && (
            <button onClick={() => { setActiveRegion(null); setSearch('') }}
              style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 13px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
              ✕ Clear
            </button>
          )}
          <button onClick={fetchData} disabled={loading}
            style={{ background: loading ? t.card2 : `${t.gold}15`, border: `1px solid ${loading ? t.border : t.gold}40`, borderRadius: '8px', padding: '7px 16px', fontSize: '12px', color: loading ? t.text4 : t.gold, cursor: loading ? 'default' : 'pointer', fontWeight: 600, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Region Flashcards ── */}
      {canSee('element.consignment-overview.region_cards') && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>

          {/* All Regions */}
          <div onClick={() => setActiveRegion(null)}
            style={{ ...card, padding: '14px 18px', cursor: 'pointer', minWidth: '130px', flexShrink: 0,
              borderColor: !activeRegion ? t.gold : t.border,
              background:  !activeRegion ? `${t.gold}10` : t.card,
              borderLeft: !activeRegion ? `3px solid ${t.gold}` : `3px solid transparent`,
              transition: 'all .15s' }}>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>All Regions</div>
            <div style={{ fontSize: '26px', fontWeight: 200, color: !activeRegion ? t.gold : t.text1, lineHeight: 1 }}>{data.length}</div>
            <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>branches</div>
          </div>

          {regions.map(r => {
            const stats = regionStats[r] || {}
            const color = REGION_COLORS[r] || t.text3
            const icon  = REGION_ICONS[r] || '📍'
            const active = activeRegion === r
            return (
              <div key={r} onClick={() => setActiveRegion(active ? null : r)}
                style={{ ...card, padding: '14px 18px', cursor: 'pointer', minWidth: '170px', flexShrink: 0,
                  borderColor: active ? color : t.border,
                  background:  active ? `${color}10` : t.card,
                  borderLeft: `3px solid ${active ? color : 'transparent'}`,
                  transition: 'all .15s' }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = `${color}50`; e.currentTarget.style.borderLeftColor = `${color}80` } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.borderLeftColor = 'transparent' } }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '9px', color: active ? color : t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: active ? 700 : 400 }}>{r}</div>
                  <span style={{ fontSize: '14px' }}>{icon}</span>
                </div>
                <div style={{ fontSize: '26px', fontWeight: 200, color: active ? color : t.text1, lineHeight: 1 }}>{stats.older_bills ?? 0}</div>
                <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px', display: 'flex', gap: '8px' }}>
                  <span>{stats.branches} branches</span>
                  {stats.today_bills > 0 && <span style={{ color, fontWeight: 600 }}>+{stats.today_bills} today</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── KPI Strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '10px' }}>

        {/* Branches */}
        <div style={{ ...card, padding: '14px 18px' }}>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>Branches</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.text1, fontFamily: 'monospace', lineHeight: 1 }}>{filtered.length}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>of {data.length} total</div>
        </div>

        {/* Today group */}
        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.blue}`, background: `${t.blue}08` }}>
          <div style={{ fontSize: '9px', color: t.blue, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Today's Bills</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.blue, fontFamily: 'monospace', lineHeight: 1 }}>{fmtNum(grandToday)}</div>
          <div style={{ fontSize: '10px', color: `${t.blue}80`, marginTop: '4px' }}>purchased today</div>
        </div>

        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.blue}`, background: `${t.blue}08` }}>
          <div style={{ fontSize: '9px', color: t.blue, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Today's Net Wt</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.blue, fontFamily: 'monospace', lineHeight: 1 }}>{fmt(grandTodayWt, 2)}<span style={{ fontSize: '13px', marginLeft: '3px' }}>g</span></div>
          <div style={{ fontSize: '10px', color: `${t.blue}80`, marginTop: '4px' }}>net gold today</div>
        </div>

        {/* Pending group */}
        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.orange}`, background: `${t.orange}08` }}>
          <div style={{ fontSize: '9px', color: t.orange, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Pending Bills</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.orange, fontFamily: 'monospace', lineHeight: 1 }}>{fmtNum(grandOlder)}</div>
          <div style={{ fontSize: '10px', color: `${t.orange}80`, marginTop: '4px' }}>at_branch, pre-today</div>
        </div>

        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.orange}`, background: `${t.orange}08` }}>
          <div style={{ fontSize: '9px', color: t.orange, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>Pending Net Wt</div>
          <div style={{ fontSize: '26px', fontWeight: 200, color: t.orange, fontFamily: 'monospace', lineHeight: 1 }}>{fmt(grandOlderWt, 2)}<span style={{ fontSize: '13px', marginLeft: '3px' }}>g</span></div>
          <div style={{ fontSize: '10px', color: `${t.orange}80`, marginTop: '4px' }}>closing stock</div>
        </div>
      </div>

      {/* ── Search ── */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {canSee('element.consignment-overview.search') && (
          <div style={{ position: 'relative', maxWidth: '280px', flex: 1 }}>
            <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch…"
              style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px 8px 30px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '11px', color: t.text4 }}>
          {filtered.length} of {data.length} branches · click column headers to sort
        </div>
      </div>

      {/* ── Table ── */}
      {canSee('element.consignment-overview.table') && (
        <div style={{ ...card, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '80px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '80px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              {search || activeRegion ? 'No branches match your filter' : 'No stock at any branch'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ ...thBase, width: '36px', textAlign: 'center' }}>#</th>
                    <th style={{ ...thBase }}>Branch</th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'total_net_wt' ? t.gold : t.text4 }}
                        onClick={() => handleSort('total_net_wt')}>
                      Total Net Wt <SortIcon col="total_net_wt" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'center' }}>Pickup</th>

                    {/* Sortable: Today */}
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_bills' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_bills')}>
                      Today's Bills <SortIcon col="today_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_net_wt' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_net_wt')}>
                      Today's Net Wt <SortIcon col="today_net_wt" />
                    </th>

                    {/* Sortable: Pending */}
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_bills' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_bills')}>
                      Pending Bills <SortIcon col="older_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_net_wt' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_net_wt')}>
                      Pending Net Wt <SortIcon col="older_net_wt" />
                    </th>

                    {/* Sortable: Age */}
                    <th style={{ ...thBase, textAlign: 'center', cursor: 'pointer', color: sortKey === 'oldest_age' ? t.red : t.text4 }}
                        onClick={() => handleSort('oldest_age')}>
                      Oldest Bill <SortIcon col="oldest_age" />
                    </th>

                    <th style={{ ...thBase, textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b, i) => {
                    const rColor  = REGION_COLORS[b.region] || t.text3
                    const hasToday  = (b.today_bills  || 0) > 0
                    const hasPending = (b.older_bills || 0) > 0

                    return (
                      <tr key={b.branch_name}
                        style={{ borderBottom: `1px solid ${t.border}20`, transition: 'background .1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                        {/* Rank */}
                        <td style={{ padding: '11px 14px', fontSize: '11px', color: t.text4, textAlign: 'center', fontFamily: 'monospace' }}>{i + 1}</td>

                        {/* Branch */}
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '3px', height: '32px', borderRadius: '2px', background: rColor, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: t.text1 }}>{b.branch_name}</div>
                              <div style={{ fontSize: '10px', color: rColor, marginTop: '2px' }}>{b.region}</div>
                            </div>
                          </div>
                        </td>

                        {/* Total Net Wt */}
                        {(() => {
                          const total = (b.today_net_wt || 0) + (b.older_net_wt || 0)
                          return (
                            <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                              <span style={{ fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>
                                {fmt(total, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                              </span>
                            </td>
                          )
                        })()}

                        {/* Pickup Time */}
                        <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                          {b.pickup_time
                            ? <span style={{ fontSize: '12px', color: t.blue, background: `${t.blue}15`, borderRadius: '5px', padding: '3px 9px', fontWeight: 600 }}>{b.pickup_time}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Today's Bills */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '14px', color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>{b.today_bills}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Today's Net Wt */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '13px', color: t.blue, fontFamily: 'monospace' }}>{fmt(b.today_net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Pending Bills */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '14px', color: t.orange, fontFamily: 'monospace', fontWeight: 700 }}>{b.older_bills}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Pending Net Wt */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '13px', color: t.orange, fontFamily: 'monospace' }}>{fmt(b.older_net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Oldest Bill */}
                        <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                          <AgeBadge days={b.oldest_age_days} t={t} />
                          {b.oldest_date && (
                            <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>{fmtDate(b.oldest_date)}</div>
                          )}
                        </td>

                        {/* Action */}
                        <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                          <button
                            onClick={() => setActiveNav('consignment-data')}
                            style={{ background: `${t.gold}18`, border: `1px solid ${t.gold}50`, borderRadius: '7px', padding: '5px 12px', fontSize: '11px', color: t.gold, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', transition: 'all .1s' }}
                            onMouseEnter={e => { e.currentTarget.style.background = `${t.gold}30`; e.currentTarget.style.borderColor = t.gold }}
                            onMouseLeave={e => { e.currentTarget.style.background = `${t.gold}18`; e.currentTarget.style.borderColor = `${t.gold}50` }}>
                            Move →
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>

                {/* Totals footer */}
                <tfoot>
                  <tr style={{ background: `${t.gold}08`, borderTop: `2px solid ${t.border}` }}>
                    <td colSpan={2} style={{ padding: '11px 14px', fontSize: '11px', color: t.text3, fontWeight: 700, letterSpacing: '.04em' }}>
                      TOTAL · {filtered.length} branch{filtered.length !== 1 ? 'es' : ''}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 700 }}>
                      {fmt(grandTodayWt + grandOlderWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                    </td>
                    <td style={{ padding: '11px 14px' }} />
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: '14px', color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>{grandToday || '—'}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: '13px', color: t.blue, fontFamily: 'monospace' }}>{fmt(grandTodayWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: '14px', color: t.orange, fontFamily: 'monospace', fontWeight: 700 }}>{grandOlder || '—'}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: '13px', color: t.orange, fontFamily: 'monospace' }}>{fmt(grandOlderWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></td>
                    <td colSpan={2} style={{ padding: '11px 14px' }} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Footer note */}
      <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
        Pending = <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>stock_status = at_branch</code> before today · Pickup time editable in Branch Management
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin  { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}
