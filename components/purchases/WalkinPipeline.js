'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Badge from '../ui/Badge'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const STATUS_COLORS = {
  'visited not sold':  'red',
  'enquiry':           'blue',
  'planning to visit': 'orange',
  'call later':        'purple',
}

const PAGE_SIZE = 100

export default function WalkinPipeline() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [rows, setRows]           = useState([])
  const [total, setTotal]         = useState(0)
  const [branchStats, setBranchStats] = useState([])
  const [reasonDist, setReasonDist]   = useState([])
  const [branches, setBranches]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [page, setPage]           = useState(0)
  const [showStats, setShowStats] = useState(true)

  const [search, setSearch]           = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [fromDate, setFromDate]       = useState('')
  const [toDate, setToDate]           = useState('')

  useEffect(() => {
    fetch('/api/crm-purchases?action=branches')
      .then(r => r.json())
      .then(d => { if (d.branches) setBranches(d.branches) })
  }, [])

  const load = useCallback(async (p = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      action: 'walkin',
      page: String(p),
      pageSize: String(PAGE_SIZE),
    })
    if (search)       params.set('search', search)
    if (filterBranch) params.set('branch', filterBranch)
    if (fromDate)     params.set('from', fromDate)
    if (toDate)       params.set('to', toDate)

    try {
      const res = await fetch(`/api/crm-purchases?${params}`)
      const d   = await res.json()
      const filteredRows = filterStatus
        ? (d.rows || []).filter(r => r.walkin_status === filterStatus)
        : (d.rows || [])
      setRows(filteredRows)
      setTotal(d.total || 0)
      if (d.branchStats) setBranchStats(d.branchStats)
      if (d.reasonDist)  setReasonDist(d.reasonDist)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search, filterBranch, filterStatus, fromDate, toDate])

  useEffect(() => { load(0); setPage(0) }, [load])

  const clearFilters = () => {
    setSearch(''); setFilterBranch(''); setFilterStatus(''); setFromDate(''); setToDate(''); setPage(0)
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasFilters = search || filterBranch || filterStatus || fromDate || toDate

  // Compute conversion stats totals
  const totalWalkin = branchStats.reduce((s, b) => s + Number(b.total_walkin), 0)
  const totalSold   = branchStats.reduce((s, b) => s + Number(b.sold_count), 0)
  const overallConv = totalWalkin > 0 ? ((totalSold / totalWalkin) * 100).toFixed(1) : '0.0'

  const s = {
    wrap:    { padding: '32px', maxWidth: '100%' },
    card:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '20px', marginBottom: '20px' },
    tblWrap: { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:      { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400, whiteSpace: 'nowrap' },
    td:      { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    select:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '.72rem', cursor: 'pointer' },
    input:   { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '.75rem', outline: 'none', width: '240px' },
  }

  return (
    <div style={s.wrap}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Walk-in Pipeline</div>
          <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>
            Active pipeline from CRM · {total.toLocaleString('en-IN')} records
          </div>
        </div>
        <button
          onClick={() => setShowStats(v => !v)}
          style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 16px', color: t.text3, fontSize: '.68rem', cursor: 'pointer' }}
        >
          {showStats ? 'Hide Stats' : 'Show Stats'}
        </button>
      </div>

      {/* STATS PANELS */}
      {showStats && (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '16px' }}>
            <div style={{ ...s.card, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 200, color: t.gold }}>{total.toLocaleString('en-IN')}</div>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>Active Pipeline</div>
            </div>
            <div style={{ ...s.card, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 200, color: t.green }}>{totalSold.toLocaleString('en-IN')}</div>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>Converted (All Time)</div>
            </div>
            <div style={{ ...s.card, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 200, color: overallConv >= 30 ? t.green : t.orange }}>{overallConv}%</div>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>Overall Conversion Rate</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            {/* Branch conversion table */}
            <div style={s.card}>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '14px' }}>Conversion by Branch (Top 15)</div>
              <div style={{ overflowY: 'auto', maxHeight: '260px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Branch', 'Walk-ins', 'Sold', 'Conv%'].map(h =>
                        <th key={h} style={{ ...s.th, fontSize: '.55rem', padding: '6px 10px' }}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {branchStats.slice(0, 15).map(b => {
                      const conv = b.total_walkin > 0 ? ((Number(b.sold_count) / Number(b.total_walkin)) * 100).toFixed(0) : 0
                      return (
                        <tr key={b.branch_id || b.brnch_name}>
                          <td style={{ ...s.td, padding: '7px 10px', fontSize: '.68rem' }}>{b.branch_name || b.branch_id}</td>
                          <td style={{ ...s.td, padding: '7px 10px', fontSize: '.68rem', color: t.text3 }}>{Number(b.total_walkin).toLocaleString('en-IN')}</td>
                          <td style={{ ...s.td, padding: '7px 10px', fontSize: '.68rem', color: t.green }}>{Number(b.sold_count).toLocaleString('en-IN')}</td>
                          <td style={{ ...s.td, padding: '7px 10px', fontSize: '.68rem', color: Number(conv) >= 30 ? t.green : t.orange, fontWeight: 500 }}>{conv}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Walk reason distribution */}
            <div style={s.card}>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '14px' }}>Walk-in Reasons</div>
              {reasonDist.map((r, i) => {
                const max = reasonDist[0]?.count || 1
                const pct = Math.round((Number(r.count) / Number(max)) * 100)
                return (
                  <div key={i} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '.7rem', color: t.text2 }}>{r.reason}</span>
                      <span style={{ fontSize: '.7rem', color: t.text3 }}>{Number(r.count).toLocaleString('en-IN')}</span>
                    </div>
                    <div style={{ height: '4px', background: `${t.border}60`, borderRadius: '2px' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: t.gold, borderRadius: '2px', transition: 'width .4s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* STATUS FILTER PILLS */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {Object.keys(STATUS_COLORS).map(st => (
          <button
            key={st}
            onClick={() => { setFilterStatus(filterStatus === st ? '' : st); setPage(0) }}
            style={{
              padding: '5px 14px', borderRadius: '100px', cursor: 'pointer', transition: 'all .15s',
              background: filterStatus === st ? `${t.gold}20` : 'transparent',
              border: `1px solid ${filterStatus === st ? t.gold : t.border}`,
              color: filterStatus === st ? t.gold : t.text3,
              fontSize: '.65rem', textTransform: 'capitalize',
            }}
          >
            {st}
          </button>
        ))}
      </div>

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={s.input}
          placeholder="Search customer, phone..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
        />
        <select style={s.select} value={filterBranch} onChange={e => { setFilterBranch(e.target.value); setPage(0) }}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.brnch_id} value={b.brnch_id}>{b.brnch_name}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '.68rem', color: t.text4 }}>From</span>
          <input type="date" style={{ ...s.select, width: 'auto' }} value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0) }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '.68rem', color: t.text4 }}>To</span>
          <input type="date" style={{ ...s.select, width: 'auto' }} value={toDate} onChange={e => { setToDate(e.target.value); setPage(0) }} />
        </div>
        {hasFilters && (
          <button onClick={clearFilters} style={{ padding: '5px 12px', borderRadius: '100px', border: `1px solid ${t.red}40`, background: 'transparent', color: t.red, fontSize: '.65rem', cursor: 'pointer' }}>
            ✕ Clear All
          </button>
        )}
      </div>

      {/* PAGINATION INFO */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginBottom: '12px', fontSize: '.7rem', color: t.text3 }}>
        <span>Showing {rows.length} of {total.toLocaleString('en-IN')} records</span>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button onClick={() => { const p = Math.max(0, page - 1); setPage(p); load(p) }} disabled={page === 0}
            style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: page === 0 ? t.text4 : t.text2, cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: '.7rem' }}>←</button>
          <span>Page {page + 1} of {totalPages || 1}</span>
          <button onClick={() => { const p = Math.min(totalPages - 1, page + 1); setPage(p); load(p) }} disabled={page >= totalPages - 1}
            style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: page >= totalPages - 1 ? t.text4 : t.text2, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: '.7rem' }}>→</button>
        </span>
      </div>

      {/* TABLE */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}><GoldSpinner size={32} /></div>
      ) : (
        <div style={s.tblWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Customer', 'Phone', 'Branch', 'Item Type', 'Weight (g)', 'Walk Reason', 'Source', 'Status'].map(h =>
                  <th key={h} style={s.th}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ transition: 'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={s.td}>{fmtDate(r.date)}</td>
                  <td style={{ ...s.td, fontWeight: 500 }}>{r.cust_name}</td>
                  <td style={{ ...s.td, color: t.text3 }}>{r.cust_mobile}</td>
                  <td style={{ ...s.td, color: t.text2 }}>{r.branch_name || r.branch_id}</td>
                  <td style={s.td}>{r.item_type || '—'}</td>
                  <td style={s.td}>{r.gms_weight ? `${r.gms_weight}g` : '—'}</td>
                  <td style={{ ...s.td, maxWidth: '200px', whiteSpace: 'normal', lineHeight: 1.4 }}>
                    {r.walk_reason ? <span style={{ color: t.orange, fontSize: '.68rem' }}>{r.walk_reason}</span> : <span style={{ color: t.text4 }}>—</span>}
                  </td>
                  <td style={{ ...s.td, color: t.text3 }}>{r.source || '—'}</td>
                  <td style={s.td}>
                    <Badge label={r.walkin_status} color={STATUS_COLORS[r.walkin_status] || 'dim'} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                    {hasFilters ? 'No records match your filters' : 'No pipeline records found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
