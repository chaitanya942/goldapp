'use client'

// EOD Branch Stock Report — how much gold was lying AT each branch at end of
// day (10 PM IST cutoff), and which cases (bills) those were, for any captured
// date. Backed by a frozen daily snapshot (eod_branch_stock_snapshots +
// _items, written by the cron at 22:00 IST). At-branch only — not yet
// dispatched. One day at a time.

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, REGION_COLORS, useMobile } from '../../lib/consignmentTheme'

const REGION_ICONS = {
  'Rest of Karnataka': '🏛',
  'Kerala':            '🌴',
  'Andhra Pradesh':    '🌊',
  'Telangana':         '🏯',
  'Bangalore':         '🏙',
}
const REGION_ORDER = ['Rest of Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Bangalore']

const fmtWt  = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtINR = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
const fmtWtCard = (g) => ({ value: Number(g || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), unit: 'g' })
const fmtDate = (yyyymmdd) => yyyymmdd
  ? new Date(yyyymmdd + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'
const fmtCellDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day}-${months[+m - 1]}-${y}`
}

export default function EodBranchStockReport() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isMobile = useMobile()
  const isAdmin  = ['super_admin', 'founders_office', 'admin'].includes(userProfile?.role)

  const [snapshot,     setSnapshot]     = useState(null)
  const [available,    setAvailable]    = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [generating,   setGenerating]   = useState(false)
  const [toast,        setToast]        = useState(null)
  const [search,       setSearch]       = useState('')
  const [activeRegion, setActiveRegion] = useState(null)
  // Per-branch drill-down: branch_name → { loading, items } | undefined.
  const [openBranch,   setOpenBranch]   = useState(null)
  const [branchCases,  setBranchCases]  = useState({})
  const [sortKey,      setSortKey]      = useState('net_wt')
  const [sortDir,      setSortDir]      = useState(-1)

  const fetchList = useCallback(async () => {
    const res = await authedFetch('/api/eod-branch-snapshot?list=1')
    const j   = await res.json().catch(() => ({}))
    setAvailable(j.list || [])
    return j.list || []
  }, [])

  const fetchSnapshot = useCallback(async (date) => {
    setLoading(true)
    setOpenBranch(null)
    const url = date ? `/api/eod-branch-snapshot?date=${date}` : '/api/eod-branch-snapshot'
    const res = await authedFetch(url)
    if (res.status === 404) { setSnapshot(null); setSelectedDate(date || null); setLoading(false); return }
    const j = await res.json().catch(() => ({}))
    setSnapshot(j.snapshot || null)
    setSelectedDate(j.snapshot?.snapshot_date || date || null)
    setLoading(false)
  }, [])

  useEffect(() => {
    (async () => {
      const list = await fetchList()
      await fetchSnapshot(list[0]?.snapshot_date || null)
    })()
  }, [fetchList, fetchSnapshot])

  const generateNow = async () => {
    setGenerating(true)
    try {
      const res = await authedFetch('/api/eod-branch-snapshot', { method: 'POST' })
      const j   = await res.json().catch(() => ({}))
      if (!res.ok || j.error) { setToast({ msg: j.error || 'Snapshot failed', type: 'error', key: Date.now() }); return }
      setToast({ msg: 'Snapshot captured for today.', type: 'success', key: Date.now() })
      setBranchCases({})
      await fetchList()
      await fetchSnapshot(j.snapshot?.snapshot_date || null)
    } finally { setGenerating(false) }
  }

  // ── Region cards — dynamic from the snapshot's by_region map ──────────────
  const regions = useMemo(() => {
    const present = Object.keys(snapshot?.by_region || {})
    return [
      ...REGION_ORDER.filter(r => present.includes(r)),
      ...present.filter(r => !REGION_ORDER.includes(r)).sort(),
    ]
  }, [snapshot])

  // ── Branch rows (filtered by region card + search, sorted) ───────────────
  const branchRows = useMemo(() => {
    const rows = snapshot?.by_branch || []
    const q = search.trim().toLowerCase()
    return rows
      .filter(b => !activeRegion || b.region === activeRegion)
      .filter(b => !q || (b.branch_name || '').toLowerCase().includes(q) || (b.region || '').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (sortKey === 'branch_name') return (a.branch_name || '').localeCompare(b.branch_name || '') * sortDir
        if (sortKey === 'region')      return (a.region || '').localeCompare(b.region || '') * sortDir
        return ((Number(a[sortKey]) || 0) - (Number(b[sortKey]) || 0)) * sortDir
      })
  }, [snapshot, activeRegion, search, sortKey, sortDir])

  const totals = useMemo(() => branchRows.reduce((acc, b) => ({
    bills:     acc.bills     + Number(b.bills     || 0),
    gross_wt:  acc.gross_wt  + Number(b.gross_wt  || 0),
    net_wt:    acc.net_wt    + Number(b.net_wt    || 0),
    gross_amt: acc.gross_amt + Number(b.gross_amt || 0),
  }), { bills: 0, gross_wt: 0, net_wt: 0, gross_amt: 0 }), [branchRows])

  const handleSort = (k) => { if (sortKey === k) setSortDir(d => -d); else { setSortKey(k); setSortDir(-1) } }

  const toggleBranch = async (branch) => {
    if (openBranch === branch) { setOpenBranch(null); return }
    setOpenBranch(branch)
    if (!branchCases[branch]) {
      setBranchCases(prev => ({ ...prev, [branch]: { loading: true, items: [] } }))
      const res = await authedFetch(`/api/eod-branch-snapshot?date=${selectedDate}&branch=${encodeURIComponent(branch)}`)
      const j   = await res.json().catch(() => ({}))
      setBranchCases(prev => ({ ...prev, [branch]: { loading: false, items: j.items || [] } }))
    }
  }

  const exportCsv = () => {
    const cols = [['branch_name','Branch'],['region','Region'],['bills','Bills'],['gross_wt','Gross Wt (g)'],['net_wt','Net Wt (g)'],['gross_amt','Value']]
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const lines = [cols.map(c => esc(c[1])).join(',')]
    for (const b of branchRows) lines.push(cols.map(c => esc(b[c[0]])).join(','))
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `EOD_Branch_Stock_${selectedDate || 'latest'}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // ── Styles ──
  const s = {
    wrap:  { display: 'flex', flexDirection: 'column', gap: '14px' },
    title: { fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:   { fontSize: '11px', color: t.text3 },
    card:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    select:{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 11px', color: t.text1, fontSize: '12px', cursor: 'pointer', outline: 'none' },
    btnOut:{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 13px', fontSize: '11px', color: t.text3, cursor: 'pointer', fontWeight: 600 },
    btnGold:{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', letterSpacing: '.04em' },
    input: { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '12px', outline: 'none' },
    th:    (a) => ({ padding: '11px 14px', textAlign: a || 'left', fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }),
    td:    (a) => ({ padding: '10px 14px', textAlign: a || 'left', fontSize: '12px', color: t.text2, whiteSpace: 'nowrap' }),
  }
  const SortIcon = ({ col }) => <span style={{ marginLeft: 4, fontSize: '8px', color: sortKey === col ? t.gold : t.text4 }}>{sortKey === col ? (sortDir === -1 ? '↓' : '↑') : '⇅'}</span>

  const total = snapshot?.total || {}

  return (
    <div style={s.wrap}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={s.title}>EOD Branch Stock Report</div>
          <div style={{ ...s.sub, marginTop: '3px' }}>
            Gold lying at branch as of {selectedDate ? fmtDate(selectedDate) : '—'} · snapshot frozen 10 PM IST · at-branch (not yet dispatched)
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selectedDate || ''} onChange={e => fetchSnapshot(e.target.value || null)} style={s.select} disabled={!available.length}>
            {available.length === 0 && <option value="">No snapshots yet</option>}
            {available.map(a => <option key={a.snapshot_date} value={a.snapshot_date}>{fmtDate(a.snapshot_date)}</option>)}
          </select>
          {isAdmin && (
            <button onClick={generateNow} disabled={generating} style={{ ...s.btnGold, opacity: generating ? .6 : 1 }}>
              {generating ? 'Generating…' : 'Generate Now'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : !snapshot ? (
        <div style={{ ...s.card, padding: '60px 20px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>
          No snapshot for this date yet.{isAdmin ? ' Click “Generate Now” to capture the current at-branch stock.' : ' The 10 PM cron will create it tonight.'}
        </div>
      ) : (
        <>
          {/* ── Region hero cards ── */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            {/* All Regions */}
            {(() => {
              const w = fmtWtCard(total.net_wt)
              const isActive = !activeRegion
              return (
                <div onClick={() => setActiveRegion(null)}
                  style={{
                    background: isActive ? `linear-gradient(145deg, ${t.gold}18, ${t.gold}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                    border: `1px solid ${isActive ? t.gold + '60' : t.border}`, borderLeft: `4px solid ${isActive ? t.gold : t.text4 + '30'}`,
                    borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', minWidth: '180px', flexShrink: 0,
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ fontSize: '9px', color: isActive ? t.gold : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>All Regions</div>
                    <span style={{ fontSize: '15px', opacity: isActive ? 1 : 0.5 }}>🌐</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                    <span style={{ fontSize: '26px', fontWeight: 300, color: isActive ? t.gold : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: isActive ? t.gold : t.text3 }}>{w.unit}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span><strong style={{ color: t.text2 }}>{total.branches || 0}</strong> branch{(total.branches || 0) === 1 ? '' : 'es'}</span>
                    <span style={{ color: t.border2 }}>·</span>
                    <span><strong style={{ color: t.text2 }}>{total.bills || 0}</strong> bills</span>
                  </div>
                </div>
              )
            })()}
            {regions.map(r => {
              const stats = snapshot.by_region[r] || {}
              const color = REGION_COLORS[r] || t.text3
              const icon  = REGION_ICONS[r] || '📍'
              const active = activeRegion === r
              const w = fmtWtCard(stats.net_wt)
              return (
                <div key={r} onClick={() => setActiveRegion(active ? null : r)}
                  style={{
                    background: active ? `linear-gradient(145deg, ${color}18, ${color}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                    border: `1px solid ${active ? color + '60' : t.border}`, borderLeft: `4px solid ${active ? color : color + '30'}`,
                    borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', minWidth: '200px', flexShrink: 0,
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ fontSize: '9px', color: active ? color : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</div>
                    <span style={{ fontSize: '15px', opacity: active ? 1 : 0.6, flexShrink: 0, marginLeft: '6px' }}>{icon}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                    <span style={{ fontSize: '26px', fontWeight: 300, color: active ? color : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: active ? color : t.text3 }}>{w.unit}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span><strong style={{ color: t.text2 }}>{stats.branches || 0}</strong> branch{(stats.branches || 0) === 1 ? '' : 'es'}</span>
                    <span style={{ color: t.border2 }}>·</span>
                    <span><strong style={{ color: t.text2 }}>{stats.bills || 0}</strong> bills</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch or region…" style={{ ...s.input, flex: 1, minWidth: '220px' }} />
            <span style={{ fontSize: '11px', color: t.text4 }}>{branchRows.length} branch{branchRows.length === 1 ? '' : 'es'}</span>
            <button onClick={exportCsv} disabled={!branchRows.length} style={{ ...s.btnOut, color: branchRows.length ? t.gold : t.text4, borderColor: branchRows.length ? `${t.gold}50` : t.border }}>↓ CSV</button>
          </div>

          {/* Branch table — click a row to drill into its cases */}
          <div style={{ ...s.card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: t.card2 || t.card, borderBottom: `1px solid ${t.border}` }}>
                  <th style={s.th('left')}  onClick={() => handleSort('branch_name')}>Branch<SortIcon col="branch_name" /></th>
                  <th style={s.th('left')}  onClick={() => handleSort('region')}>Region<SortIcon col="region" /></th>
                  <th style={s.th('right')} onClick={() => handleSort('bills')}>Bills<SortIcon col="bills" /></th>
                  <th style={s.th('right')} onClick={() => handleSort('gross_wt')}>Gross Wt (g)<SortIcon col="gross_wt" /></th>
                  <th style={s.th('right')} onClick={() => handleSort('net_wt')}>Net Wt (g)<SortIcon col="net_wt" /></th>
                  <th style={s.th('right')} onClick={() => handleSort('gross_amt')}>Value<SortIcon col="gross_amt" /></th>
                  <th style={s.th('center')}>Cases</th>
                </tr>
                <tr style={{ background: `${t.gold}0c`, borderBottom: `1px solid ${t.gold}40` }}>
                  <td style={{ ...s.td('left'), color: t.gold, fontWeight: 700, letterSpacing: '.04em' }}>Σ TOTALS</td>
                  <td style={s.td('left')} />
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text1, fontWeight: 700 }}>{totals.bills}</td>
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2, fontWeight: 600 }}>{fmtWt(totals.gross_wt)}</td>
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.gold, fontWeight: 700 }}>{fmtWt(totals.net_wt)}</td>
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.blue, fontWeight: 700 }}>{fmtINR(totals.gross_amt)}</td>
                  <td style={s.td('center')} />
                </tr>
              </thead>
              <tbody>
                {branchRows.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...s.td('center'), textAlign: 'center', color: t.text4, padding: '48px' }}>
                    {search || activeRegion ? 'No branches match' : 'No branch held stock at EOD on this date'}
                  </td></tr>
                ) : branchRows.map((b, i) => {
                  const expanded = openBranch === b.branch_name
                  const cases = branchCases[b.branch_name]
                  const rColor = REGION_COLORS[b.region] || t.text3
                  return (
                    <Fragment key={b.branch_name || i}>
                      <tr style={{ borderBottom: `1px solid ${t.border}25`, background: expanded ? `${t.gold}0a` : (i % 2 ? `${t.card2}30` : 'transparent'), cursor: 'pointer' }}
                        onClick={() => toggleBranch(b.branch_name)}>
                        <td style={{ ...s.td('left'), color: t.text1, fontWeight: 600 }}>{b.branch_name || '—'}</td>
                        <td style={{ ...s.td('left'), color: rColor }}>{b.region || '—'}</td>
                        <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{b.bills || 0}</td>
                        <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2 }}>{fmtWt(b.gross_wt)}</td>
                        <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtWt(b.net_wt)}</td>
                        <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2 }}>{fmtINR(b.gross_amt)}</td>
                        <td style={{ ...s.td('center'), color: expanded ? t.gold : t.text4, fontWeight: 700 }}>{expanded ? '▾' : '▸'}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, background: `${t.card2}40` }}>
                            <div style={{ padding: '4px 14px 12px 28px' }}>
                              {cases?.loading ? (
                                <div style={{ padding: '20px', textAlign: 'center', color: t.text4, fontSize: '11px' }}>Loading cases…</div>
                              ) : !cases?.items?.length ? (
                                <div style={{ padding: '16px', color: t.text4, fontSize: '11px' }}>No cases recorded.</div>
                              ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                                  <thead>
                                    <tr style={{ color: t.text4 }}>
                                      <th style={{ ...s.th('left'),  cursor: 'default' }}>App ID</th>
                                      <th style={{ ...s.th('left'),  cursor: 'default' }}>Customer</th>
                                      <th style={{ ...s.th('left'),  cursor: 'default' }}>Purchase</th>
                                      <th style={{ ...s.th('right'), cursor: 'default' }}>Gross (g)</th>
                                      <th style={{ ...s.th('right'), cursor: 'default' }}>Net (g)</th>
                                      <th style={{ ...s.th('right'), cursor: 'default' }}>Value</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {cases.items.map((c, j) => (
                                      <tr key={c.application_id || j} style={{ borderTop: `1px solid ${t.border}20` }}>
                                        <td style={{ ...s.td('left'), fontFamily: 'monospace', color: t.gold }}>{c.application_id || '—'}</td>
                                        <td style={{ ...s.td('left'), color: t.text1 }}>{c.customer_name || '—'}</td>
                                        <td style={{ ...s.td('left'), color: t.text3 }}>{fmtCellDate(c.purchase_date)}</td>
                                        <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2 }}>{fmtWt(c.gross_weight)}</td>
                                        <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.gold }}>{fmtWt(c.net_weight)}</td>
                                        <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2 }}>{fmtINR(c.total_amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
            Frozen daily at 10 PM IST · at-branch only (not yet dispatched) · click a branch to see its cases · starts 13-Jun-2026
          </div>
        </>
      )}
    </div>
  )
}
