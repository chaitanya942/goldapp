'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const PAGE_SIZE = 100

export default function BlacklistedCustomers() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [rows, setRows]           = useState([])
  const [total, setTotal]         = useState(0)
  const [reasonDist, setReasonDist] = useState([])
  const [loading, setLoading]     = useState(false)
  const [page, setPage]           = useState(0)
  // Track actual DB columns from first load
  const [columns, setColumns]     = useState([])

  const [search, setSearch]       = useState('')
  const [filterReason, setFilterReason] = useState('')

  const load = useCallback(async (p = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      action: 'blacklisted',
      page: String(p),
      pageSize: String(PAGE_SIZE),
    })
    if (search)       params.set('search', search)
    if (filterReason) params.set('reason', filterReason)

    try {
      const res = await fetch(`/api/crm-purchases?${params}`)
      const d   = await res.json()
      setRows(d.rows || [])
      setTotal(d.total || 0)
      if (d.reasonDist) setReasonDist(d.reasonDist)
      // Derive columns from first row
      if (d.rows?.length > 0 && columns.length === 0) {
        setColumns(Object.keys(d.rows[0]))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search, filterReason, columns.length])

  useEffect(() => { load(0); setPage(0) }, [load])

  const clearFilters = () => { setSearch(''); setFilterReason(''); setPage(0) }

  // Preferred display columns (show these first if they exist, then remaining)
  const PREFERRED = ['id', 'cust_name', 'cust_mobile', 'rej_rsn', 'branch_id', 'date', 'remarks']
  const displayCols = columns.length > 0
    ? [...PREFERRED.filter(c => columns.includes(c)), ...columns.filter(c => !PREFERRED.includes(c))]
    : []

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasFilters = search || filterReason

  const s = {
    wrap:    { padding: '32px', maxWidth: '100%' },
    card:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '20px', marginBottom: '20px' },
    tblWrap: { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:      { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400, whiteSpace: 'nowrap' },
    td:      { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' },
    select:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '.72rem', cursor: 'pointer' },
    input:   { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '.75rem', outline: 'none', width: '240px' },
  }

  // Human-friendly column labels
  const colLabel = c => ({
    cust_name:  'Customer',
    cust_mobile:'Phone',
    rej_rsn:    'Reason',
    branch_id:  'Branch',
    remarks:    'Remarks',
  }[c] || c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))

  const cellStyle = col => {
    if (col === 'rej_rsn') return { ...s.td, color: t.red, maxWidth: '260px', whiteSpace: 'normal', lineHeight: 1.4 }
    if (col === 'cust_name') return { ...s.td, fontWeight: 500 }
    if (col === 'cust_mobile') return { ...s.td, color: t.text3 }
    if (col === 'date') return { ...s.td, color: t.text3 }
    return s.td
  }

  const fmtCell = (col, val) => {
    if (val === null || val === undefined || val === '') return '—'
    if (col === 'date' && typeof val === 'string') {
      try { return new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return val }
    }
    return String(val)
  }

  return (
    <div style={s.wrap}>
      {/* HEADER */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.red, letterSpacing: '.04em' }}>Blacklisted Customers</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>
          Customers flagged in CRM · {total.toLocaleString('en-IN')} records
        </div>
      </div>

      {/* REASON DISTRIBUTION */}
      {reasonDist.length > 0 && (
        <div style={s.card}>
          <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '14px' }}>Blacklist Reasons</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {reasonDist.map(r => (
              <button
                key={r.reason}
                onClick={() => { setFilterReason(filterReason === r.reason ? '' : r.reason); setPage(0) }}
                style={{
                  padding: '6px 14px', borderRadius: '100px', cursor: 'pointer', transition: 'all .15s',
                  background: filterReason === r.reason ? `${t.red}20` : 'transparent',
                  border: `1px solid ${filterReason === r.reason ? t.red : t.border}`,
                  color: filterReason === r.reason ? t.red : t.text3,
                  fontSize: '.65rem',
                }}
              >
                {r.reason} <span style={{ color: t.text4, marginLeft: '4px' }}>({Number(r.count).toLocaleString('en-IN')})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={s.input}
          placeholder="Search customer, phone..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
        />
        {hasFilters && (
          <button onClick={clearFilters} style={{ padding: '5px 12px', borderRadius: '100px', border: `1px solid ${t.red}40`, background: 'transparent', color: t.red, fontSize: '.65rem', cursor: 'pointer' }}>
            ✕ Clear All
          </button>
        )}
      </div>

      {/* PAGINATION INFO */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginBottom: '12px', fontSize: '.7rem', color: t.text3 }}>
        <span>Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total).toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}</span>
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
                {displayCols.length > 0
                  ? displayCols.map(c => <th key={c} style={s.th}>{colLabel(c)}</th>)
                  : <th style={s.th}>Loading columns...</th>
                }
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i} style={{ transition: 'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {displayCols.map(col => (
                    <td key={col} style={cellStyle(col)} title={String(r[col] ?? '')}>
                      {fmtCell(col, r[col])}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(displayCols.length, 1)} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                    {hasFilters ? 'No records match your filters' : 'No blacklisted customers found'}
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
