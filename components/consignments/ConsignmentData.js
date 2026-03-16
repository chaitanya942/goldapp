'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0e0e0e', card: '#141414', card2: '#1a1a1a', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#2a2a2a', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f' },
  light: { bg: '#f5f0e8', card: '#ede8dc', card2: '#e8e0d0', text1: '#2a1f0a', text2: '#6a5a3a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d5cfc0', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtVal  = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Days since a date
const daysSince = (d) => {
  if (!d) return null
  const diff = Date.now() - new Date(d).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// Stale threshold in days
const STALE_DAYS = 7

// CSV export helper
const exportToCSV = (rows, filename) => {
  const headers = ['App ID','Date','Customer','Phone','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Final Amt','Type','Status']
  const lines = [
    headers.join(','),
    ...rows.map(p => [
      p.application_id, p.purchase_date, `"${p.customer_name}"`, p.phone_number,
      p.gross_weight, p.stone_weight, p.wastage, p.net_weight, p.purity,
      p.total_amount, p.service_charge_pct, p.final_amount_crm,
      p.transaction_type, p.stock_status,
    ].join(','))
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function ConsignmentData() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme] || THEMES.dark

  // ── Summary state ──
  const [branchSummary, setBranchSummary]   = useState([])
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [totalKpis, setTotalKpis]           = useState(null)
  const [filterState, setFilterState]       = useState('')
  const [states, setStates]                 = useState([])
  const [viewMode, setViewMode]             = useState('grid')
  const [sortCol, setSortCol]               = useState('net')
  const [sortDir, setSortDir]               = useState('desc')
  const [branchSearch, setBranchSearch]     = useState('')

  // ── Drilldown state ──
  const [selectedBranch, setSelectedBranch]     = useState(null)
  const [purchases, setPurchases]               = useState([])
  const [loadingPurchases, setLoadingPurchases] = useState(false)
  const [page, setPage]                         = useState(0)
  const [totalCount, setTotalCount]             = useState(0)
  const [search, setSearch]                     = useState('')
  const [filterTxn, setFilterTxn]               = useState('')   // NEW: Physical/Takeover filter
  const [dateFrom, setDateFrom]                 = useState('')   // NEW: date range filter
  const [dateTo, setDateTo]                     = useState('')   // NEW: date range filter

  // ── Selection + dispatch state ──
  const [selectedIds, setSelectedIds]   = useState(new Set())
  const [dispatching, setDispatching]   = useState(false)
  const [showConfirm, setShowConfirm]   = useState(false)
  const [exporting, setExporting]       = useState(false)

  const PAGE_SIZE    = 100
  const isSuperAdmin = userProfile?.role === 'super_admin'
  const isManager    = userProfile?.role === 'manager'
  const canDispatch  = isSuperAdmin

  // ── Selection helpers ──
  const toggleSelect    = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSelectAll = ()   => setSelectedIds(selectedIds.size === purchases.length ? new Set() : new Set(purchases.map(p => p.id)))
  const clearSelection  = ()   => setSelectedIds(new Set())

  // ── Sort helper ──
  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }) => sortCol === col
    ? <span style={{ marginLeft: '4px', fontSize: '.55rem' }}>{sortDir === 'desc' ? '▼' : '▲'}</span>
    : <span style={{ marginLeft: '4px', fontSize: '.55rem', opacity: .3 }}>▼</span>

  const sortedSummary = [...branchSummary]
    .filter(b => !branchSearch || b.name.toLowerCase().includes(branchSearch.toLowerCase()))
    .sort((a, b2) => {
      const aVal = a[sortCol] ?? '', bVal = b2[sortCol] ?? ''
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      return sortDir === 'desc' ? Number(bVal) - Number(aVal) : Number(aVal) - Number(bVal)
    })

  // ── Load summary ──
  useEffect(() => { loadSummary() }, [filterState])

  const loadSummary = async () => {
    setLoadingSummary(true)
    const { data } = await supabase.rpc('get_consignment_branch_summary')
    const rows = data || []
    const allStates = [...new Set(rows.map(b => b.state).filter(Boolean))].sort()
    setStates(allStates)
    const filtered = filterState ? rows.filter(b => b.state === filterState) : rows
    const totals = filtered.reduce((acc, b) => ({
      count: acc.count + Number(b.count), gross: acc.gross + Number(b.total_gross),
      net:   acc.net   + Number(b.total_net), value: acc.value + Number(b.total_value),
      branches: acc.branches + 1,
    }), { count: 0, gross: 0, net: 0, value: 0, branches: 0 })
    const summary = filtered.map(b => ({
      name: b.branch_name, state: b.state, region: b.region, cluster: b.cluster,
      count: Number(b.count), gross: Number(b.total_gross), net: Number(b.total_net),
      value: Number(b.total_value), physical: Number(b.physical), takeover: Number(b.takeover),
      oldest_date: b.oldest_date || null,  // NEW: oldest purchase date from RPC
    }))
    setTotalKpis(totals)
    setBranchSummary(summary)
    setLoadingSummary(false)
  }

  // ── Load purchases ──
  useEffect(() => {
    if (selectedBranch) { setPage(0); setTotalCount(0); loadPurchases(0) }
  }, [selectedBranch, search, filterTxn, dateFrom, dateTo])

  useEffect(() => {
    if (selectedBranch) loadPurchases(page)
  }, [page])

  const loadPurchases = useCallback(async (pageNum) => {
    if (!selectedBranch) return
    setLoadingPurchases(true)
    let q = supabase
      .from('purchases')
      .select('*', { count: 'exact' })
      .eq('stock_status', 'at_branch')
      .eq('is_deleted', false)
      .eq('branch_name', selectedBranch.name)
    if (search)     q = q.or(`customer_name.ilike.%${search}%,application_id.ilike.%${search}%`)
    if (filterTxn)  q = q.eq('transaction_type', filterTxn)
    if (dateFrom)   q = q.gte('purchase_date', dateFrom)
    if (dateTo)     q = q.lte('purchase_date', dateTo)
    const from = pageNum * PAGE_SIZE
    const { data, count } = await q.order('purchase_date', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    setPurchases(data || [])
    if (count !== null) setTotalCount(count)
    setLoadingPurchases(false)
  }, [selectedBranch, search, filterTxn, dateFrom, dateTo])

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // ── Dispatch selected ──
  const dispatchSelected = async () => {
    setDispatching(true)
    const ids = [...selectedIds]
    const now = new Date().toISOString()
const { error } = await supabase
  .from('purchases')
  .update({
    stock_status:  'in_consignment',
    dispatched_at: now,
    updated_at:    now,
    updated_by:    userProfile?.email || userProfile?.id || 'unknown'
  })
  .in('id', ids)
    setDispatching(false)
    setShowConfirm(false)
    if (!error) {
      // Optimistically remove dispatched rows from current view
      setPurchases(prev => prev.filter(p => !selectedIds.has(p.id)))
      setTotalCount(prev => prev - ids.length)
      clearSelection()
      // Update branch card KPIs
      const dispatched = purchases.filter(p => ids.includes(p.id))
      const dNet   = dispatched.reduce((s, p) => s + Number(p.net_weight  || 0), 0)
      const dGross = dispatched.reduce((s, p) => s + Number(p.gross_weight || 0), 0)
      const dVal   = dispatched.reduce((s, p) => s + Number(p.total_amount || 0), 0)
      // Update selected branch card in summary
      setBranchSummary(prev => prev.map(b => b.name === selectedBranch.name
        ? { ...b, count: b.count - ids.length, net: b.net - dNet, gross: b.gross - dGross, value: b.value - dVal }
        : b
      ))
      // Update total KPIs
      setTotalKpis(prev => prev ? {
        ...prev, count: prev.count - ids.length, net: prev.net - dNet,
        gross: prev.gross - dGross, value: prev.value - dVal,
      } : prev)
      // Also update selectedBranch so drilldown KPIs reflect new state
      setSelectedBranch(prev => prev ? {
        ...prev, count: prev.count - ids.length, net: prev.net - dNet,
        gross: prev.gross - dGross, value: prev.value - dVal,
      } : prev)
    }
  }

  // ── Export ──
  const handleExport = async () => {
    setExporting(true)
    // If rows selected, export those; otherwise export all for this branch
    if (selectedIds.size > 0) {
      const rows = purchases.filter(p => selectedIds.has(p.id))
      exportToCSV(rows, `${selectedBranch.name}_selected.csv`)
    } else {
      // Fetch all pages for this branch
      let all = []
      let q = supabase.from('purchases').select('*')
        .eq('stock_status', 'at_branch').eq('is_deleted', false).eq('branch_name', selectedBranch.name)
      if (filterTxn) q = q.eq('transaction_type', filterTxn)
      if (dateFrom)  q = q.gte('purchase_date', dateFrom)
      if (dateTo)    q = q.lte('purchase_date', dateTo)
      const { data } = await q.order('purchase_date', { ascending: true })
      all = data || []
      exportToCSV(all, `${selectedBranch.name}_all.csv`)
    }
    setExporting(false)
  }

  // ── Styles ──
  const s = {
    wrap:  { padding: '32px', maxWidth: '100%' },
    card:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '20px', marginBottom: '16px' },
    th:    { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400, whiteSpace: 'nowrap' },
    td:    { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    input: { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '.75rem', outline: 'none' },
    pill:  (active, color) => ({ padding: '5px 14px', borderRadius: '100px', border: `1px solid ${active ? (color || t.gold) : t.border}`, background: active ? `${color || t.gold}18` : 'transparent', color: active ? (color || t.gold) : t.text3, fontSize: '.65rem', cursor: 'pointer' }),
    pgBtn: (dis) => ({ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: dis ? t.text4 : t.text2, cursor: dis ? 'not-allowed' : 'pointer', fontSize: '.7rem' }),
  }

  // ── Stale badge ──
  const StaleBadge = ({ days }) => {
    if (days === null) return null
    const color = days >= 14 ? t.red : days >= STALE_DAYS ? t.orange : t.green
    const label = days >= 14 ? `${days}d ⚠` : days >= STALE_DAYS ? `${days}d` : `${days}d`
    return (
      <span style={{ fontSize: '.58rem', padding: '2px 7px', borderRadius: '4px', background: `${color}20`, color, fontWeight: 500 }}>
        {label}
      </span>
    )
  }

  // ══════════════════════════════════════
  // ── DRILLDOWN VIEW ──
  // ══════════════════════════════════════
  if (selectedBranch) {
    const staleDays = daysSince(selectedBranch.oldest_date)

    return (
      <div style={s.wrap}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <button onClick={() => { setSelectedBranch(null); setSearch(''); setFilterTxn(''); setDateFrom(''); setDateTo(''); clearSelection() }}
            style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 14px', color: t.text3, fontSize: '.7rem', cursor: 'pointer' }}>
            ← Back
          </button>
          <span style={{ fontSize: '.65rem', color: t.text3 }}>Consignment Data</span>
          <span style={{ fontSize: '.65rem', color: t.text4 }}>›</span>
          <span style={{ fontSize: '.65rem', color: t.gold }}>{selectedBranch.name}</span>
          {staleDays !== null && staleDays >= STALE_DAYS && (
            <span style={{ fontSize: '.62rem', color: t.orange, background: `${t.orange}15`, border: `1px solid ${t.orange}40`, borderRadius: '5px', padding: '3px 10px' }}>
              ⚠ Oldest stock: {staleDays} days ago
            </span>
          )}
        </div>

        {/* Branch header */}
        <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, marginBottom: '3px' }}>{selectedBranch.name}</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginBottom: '20px' }}>
          {[selectedBranch.state, selectedBranch.region, selectedBranch.cluster].filter(Boolean).join(' · ')}
        </div>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Records',      value: selectedBranch.count.toLocaleString('en-IN'), color: t.gold  },
            { label: 'Total Gross',  value: `${fmt(selectedBranch.gross)}g`,              color: t.text1 },
            { label: 'Total Net',    value: `${fmt(selectedBranch.net)}g`,                color: t.gold  },
            { label: 'Total Value',  value: fmtVal(selectedBranch.value),                 color: t.green },
            { label: 'Oldest Stock', value: staleDays !== null ? `${staleDays}d ago` : '—', color: staleDays >= 14 ? t.red : staleDays >= STALE_DAYS ? t.orange : t.green },
          ].map(c => (
            <div key={c.label} style={{ ...s.card, textAlign: 'center', padding: '16px', marginBottom: 0 }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 200, color: c.color }}>{c.value}</div>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '5px' }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Dispatch bar */}
        {canDispatch && selectedIds.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', padding: '10px 16px', background: `${t.gold}10`, border: `1px solid ${t.gold}40`, borderRadius: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.75rem', color: t.gold }}>{selectedIds.size} record{selectedIds.size > 1 ? 's' : ''} selected</span>
            <button onClick={() => setShowConfirm(true)}
              style={{ background: t.gold, border: 'none', borderRadius: '6px', padding: '7px 18px', color: '#0e0e0e', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer' }}>
              Mark as In Transit →
            </button>
            <button onClick={() => handleExport()}
              style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 14px', color: t.text2, fontSize: '.72rem', cursor: 'pointer' }}>
              Export Selected
            </button>
            <button onClick={clearSelection}
              style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 14px', color: t.text3, fontSize: '.72rem', cursor: 'pointer' }}>
              Clear
            </button>
          </div>
        )}

        {/* Confirm modal */}
        {showConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '32px', width: '420px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', color: t.text1, marginBottom: '10px' }}>Mark as In Transit?</div>
              <div style={{ fontSize: '.75rem', color: t.text3, marginBottom: '24px', lineHeight: 1.6 }}>
                <span style={{ color: t.gold, fontWeight: 500 }}>{selectedIds.size}</span> record{selectedIds.size > 1 ? 's' : ''} from{' '}
                <span style={{ color: t.gold }}>{selectedBranch.name}</span> will be marked as{' '}
                <span style={{ color: t.blue }}>In Transit</span>. This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button onClick={() => setShowConfirm(false)}
                  style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 24px', color: t.text2, fontSize: '.75rem', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={dispatchSelected} disabled={dispatching}
                  style={{ background: t.gold, border: 'none', borderRadius: '7px', padding: '9px 24px', color: '#0e0e0e', fontSize: '.75rem', fontWeight: 600, cursor: dispatching ? 'wait' : 'pointer' }}>
                  {dispatching ? 'Updating...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <input style={{ ...s.input, width: '240px' }} placeholder="Search customer, app ID..." value={search} onChange={e => setSearch(e.target.value)} />

          {/* Txn type filter */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={s.pill(!filterTxn)}           onClick={() => setFilterTxn('')}>All</button>
            <button style={s.pill(filterTxn==='PHYSICAL', t.gold)} onClick={() => setFilterTxn(filterTxn === 'PHYSICAL' ? '' : 'PHYSICAL')}>Physical</button>
            <button style={s.pill(filterTxn==='TAKEOVER', t.blue)} onClick={() => setFilterTxn(filterTxn === 'TAKEOVER' ? '' : 'TAKEOVER')}>Takeover</button>
          </div>

          {/* Date range */}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ ...s.input, width: '140px', fontSize: '.7rem', cursor: 'pointer' }} />
          <span style={{ fontSize: '.65rem', color: t.text4 }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ ...s.input, width: '140px', fontSize: '.7rem', cursor: 'pointer' }} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
              style={{ background: 'none', border: 'none', color: t.text4, fontSize: '.7rem', cursor: 'pointer' }}>✕ Clear dates</button>
          )}

          {/* Export all */}
          <button onClick={handleExport} disabled={exporting}
            style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 14px', color: t.text2, fontSize: '.7rem', cursor: exporting ? 'wait' : 'pointer' }}>
            {exporting ? 'Exporting...' : '↓ Export CSV'}
          </button>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: '.7rem', color: t.text3 }}>
            Showing {totalCount === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString('en-IN')} of <span style={{ color: t.text1 }}>{totalCount.toLocaleString('en-IN')}</span> records
            {totalCount > PAGE_SIZE && <span style={{ color: t.orange, marginLeft: '8px' }}>· Showing page only — use Export for all records</span>}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button style={s.pgBtn(page === 0)} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>←</button>
            <span style={{ fontSize: '.7rem', color: t.text3 }}>Page {page + 1} of {totalPages || 1}</span>
            <button style={s.pgBtn(page >= totalPages - 1)} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>→</button>
          </div>
        </div>

        {loadingPurchases ? (
          <div style={{ textAlign: 'center', padding: '60px', color: t.text3, fontSize: '.8rem' }}>Loading...</div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {canDispatch && (
                    <th style={{ ...s.th, width: '36px' }}>
                      <input type="checkbox" checked={purchases.length > 0 && selectedIds.size === purchases.length}
                        onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: t.gold }} />
                    </th>
                  )}
                  {['App ID','Date','Customer','Phone','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Final Amt','Type','Age'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchases.map((p, i) => {
                  const age = daysSince(p.purchase_date)
                  const isStale = age !== null && age >= STALE_DAYS
                  return (
                    <tr key={p.id}
                      style={{ background: selectedIds.has(p.id) ? `${t.gold}12` : isStale ? `${t.orange}06` : i % 2 === 0 ? 'transparent' : `${t.border}20`, cursor: canDispatch ? 'pointer' : 'default' }}
                      onClick={canDispatch ? () => toggleSelect(p.id) : undefined}>
                      {canDispatch && (
                        <td style={{ ...s.td, width: '36px' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)}
                            style={{ cursor: 'pointer', accentColor: t.gold }} />
                        </td>
                      )}
                      <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{p.application_id}</td>
                      <td style={s.td}>{fmtDate(p.purchase_date)}</td>
                      <td style={s.td}>{p.customer_name}</td>
                      <td style={{ ...s.td, color: t.text3 }}>{p.phone_number}</td>
                      <td style={s.td}>{fmt(p.gross_weight)}g</td>
                      <td style={s.td}>{fmt(p.stone_weight)}g</td>
                      <td style={s.td}>{fmt(p.wastage)}g</td>
                      <td style={{ ...s.td, color: t.gold }}>{fmt(p.net_weight)}g</td>
                      <td style={s.td}>{fmt(p.purity)}%</td>
                      <td style={s.td}>₹{fmt(p.total_amount)}</td>
                      <td style={s.td}>{fmt(p.service_charge_pct)}%</td>
                      <td style={{ ...s.td, color: t.green }}>₹{fmt(p.final_amount_crm)}</td>
                      <td style={{ ...s.td, fontSize: '.65rem', color: p.transaction_type === 'PHYSICAL' ? t.gold : t.blue }}>{p.transaction_type}</td>
                      <td style={{ ...s.td }}>
                        <StaleBadge days={age} />
                      </td>
                    </tr>
                  )
                })}
                {purchases.length === 0 && (
                  <tr><td colSpan={canDispatch ? 15 : 14} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>No records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════
  // ── SUMMARY VIEW ──
  // ══════════════════════════════════════
  return (
    <div style={s.wrap}>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Consignment Data</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>All purchases at branch — pending dispatch to HO</div>
      </div>

      {/* KPI Cards */}
      {totalKpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Total Records',  value: totalKpis.count.toLocaleString('en-IN'),                                                color: t.gold,  size: '1.6rem' },
            { label: 'Total Gross Wt', value: `${Number(totalKpis.gross).toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`,   color: t.text1, size: '1.2rem' },
            { label: 'Total Net Wt',   value: `${Number(totalKpis.net).toLocaleString('en-IN',   { maximumFractionDigits: 2 })}g`,   color: t.gold,  size: '1.2rem' },
            { label: 'Total Value',    value: `₹${Number(totalKpis.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,   color: t.green, size: '1rem'   },
            { label: 'Branches',       value: totalKpis.branches,                                                                    color: t.blue,  size: '1.6rem' },
          ].map(c => (
            <div key={c.label} style={{ ...s.card, textAlign: 'center', padding: '18px 14px', marginBottom: 0 }}>
              <div style={{ fontSize: c.size, fontWeight: 200, color: c.color, lineHeight: 1.15 }}>{c.value}</div>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* State Filter + Search + View Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={s.pill(!filterState)} onClick={() => setFilterState('')}>All States</button>
          {states.map(st => (
            <button key={st} style={s.pill(filterState === st)} onClick={() => setFilterState(filterState === st ? '' : st)}>{st}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input placeholder="Search branch..." value={branchSearch} onChange={e => setBranchSearch(e.target.value)}
            style={{ ...s.input, width: '180px', padding: '6px 12px' }} />
          <button onClick={() => setViewMode('grid')} style={{ ...s.pill(viewMode === 'grid'), padding: '5px 12px' }}>⊞ Grid</button>
          <button onClick={() => setViewMode('list')} style={{ ...s.pill(viewMode === 'list'), padding: '5px 12px' }}>≡ List</button>
        </div>
      </div>

      {/* Branch View */}
      {loadingSummary ? (
        <div style={{ textAlign: 'center', padding: '60px', color: t.text3, fontSize: '.8rem' }}>Loading...</div>
      ) : branchSummary.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: t.text4, fontSize: '.8rem' }}>No pending consignments</div>
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {sortedSummary.map((b) => {
            const staleDays = daysSince(b.oldest_date)
            const isStale   = staleDays !== null && staleDays >= STALE_DAYS
            const staleColor = staleDays >= 14 ? t.red : t.orange
            return (
              <div key={b.name} onClick={() => setSelectedBranch(b)}
                style={{ ...s.card, cursor: 'pointer', marginBottom: 0, transition: 'border-color .2s, background .2s', borderColor: isStale && staleDays >= 14 ? `${t.red}40` : t.border }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = t.gold; e.currentTarget.style.background = `${t.gold}08` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = isStale && staleDays >= 14 ? `${t.red}40` : t.border; e.currentTarget.style.background = t.card }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontSize: '.82rem', fontWeight: 500, color: t.gold, marginBottom: '3px' }}>{b.name}</div>
                    <div style={{ fontSize: '.6rem', color: t.text3 }}>{[b.state, b.region].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
                    <div style={{ fontSize: '.65rem', color: t.text3, background: t.card2, border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 9px' }}>{b.count} records</div>
                    {isStale && <StaleBadge days={staleDays} />}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ background: t.card2, borderRadius: '6px', padding: '10px' }}>
                    <div style={{ fontSize: '.88rem', color: t.gold, fontWeight: 200 }}>{fmt(b.net)}g</div>
                    <div style={{ fontSize: '.55rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '3px' }}>Net Wt</div>
                  </div>
                  <div style={{ background: t.card2, borderRadius: '6px', padding: '10px' }}>
                    <div style={{ fontSize: '.88rem', color: t.green, fontWeight: 200 }}>{fmtVal(b.value)}</div>
                    <div style={{ fontSize: '.55rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '3px' }}>Value</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: '.62rem', color: t.text3 }}>Physical: <span style={{ color: t.gold }}>{b.physical}</span></span>
                  <span style={{ fontSize: '.62rem', color: t.text3 }}>Takeover: <span style={{ color: t.blue }}>{b.takeover}</span></span>
                  {isStale && <span style={{ fontSize: '.6rem', color: staleColor }}>⏱ {staleDays}d old</span>}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  { label: '#',        col: null    },
                  { label: 'Branch',   col: 'name'  },
                  { label: 'State',    col: null     },
                  { label: 'Region',   col: null     },
                  { label: 'Cluster',  col: null     },
                  { label: 'Records',  col: 'count'  },
                  { label: 'Gross Wt', col: 'gross'  },
                  { label: 'Net Wt',   col: 'net'    },
                  { label: 'Value',    col: 'value'  },
                  { label: 'Oldest',   col: null     },
                ].map(({ label, col }) => (
                  <th key={label} onClick={col ? () => handleSort(col) : undefined}
                    style={{ ...s.th, color: col && sortCol === col ? t.gold : t.text3, cursor: col ? 'pointer' : 'default', userSelect: 'none' }}>
                    {label}{col && <SortIcon col={col} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSummary.map((b, i) => {
                const staleDays = daysSince(b.oldest_date)
                const isStale   = staleDays !== null && staleDays >= STALE_DAYS
                return (
                  <tr key={b.name} onClick={() => setSelectedBranch(b)}
                    style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}20`, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${t.border}20`}>
                    <td style={{ ...s.td, color: t.text4 }}>{i + 1}</td>
                    <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{b.name}</td>
                    <td style={{ ...s.td, color: t.text2 }}>{b.state}</td>
                    <td style={{ ...s.td, color: t.text3 }}>{b.region}</td>
                    <td style={{ ...s.td, color: t.text3 }}>{b.cluster}</td>
                    <td style={{ ...s.td }}>{b.count.toLocaleString('en-IN')}</td>
                    <td style={{ ...s.td }}>{fmt(b.gross)}g</td>
                    <td style={{ ...s.td, color: t.gold }}>{fmt(b.net)}g</td>
                    <td style={{ ...s.td, color: t.green }}>{fmtVal(b.value)}</td>
                    <td style={{ ...s.td }}>{isStale ? <StaleBadge days={staleDays} /> : <span style={{ fontSize: '.65rem', color: t.text4 }}>{staleDays !== null ? `${staleDays}d` : '—'}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}