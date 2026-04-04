'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Badge from '../ui/Badge'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const PMT_COLORS = { bank: 'blue', cheque: 'orange', cash: 'green', upi: 'purple' }
const PAGE_SIZE = 100

export default function PendingBills() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [rows, setRows]         = useState([])
  const [total, setTotal]       = useState(0)
  const [branches, setBranches] = useState([])
  const [loading, setLoading]   = useState(false)
  const [page, setPage]         = useState(0)

  const [search, setSearch]           = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterPmt, setFilterPmt]     = useState('')
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
      action: 'pending',
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
      const filteredRows = filterPmt
        ? (d.rows || []).filter(r => (r.pymt_mde || '').toLowerCase() === filterPmt)
        : (d.rows || [])
      setRows(filteredRows)
      setTotal(d.total || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search, filterBranch, filterPmt, fromDate, toDate])

  useEffect(() => { load(0); setPage(0) }, [load])

  const clearFilters = () => {
    setSearch(''); setFilterBranch(''); setFilterPmt(''); setFromDate(''); setToDate(''); setPage(0)
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const fmt     = n => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasFilters = search || filterBranch || filterPmt || fromDate || toDate

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
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Pending Bills</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>
          Bills awaiting approval in CRM · {total.toLocaleString('en-IN')} records
        </div>
      </div>

      {/* PAYMENT METHOD PILLS */}
      <div style={s.card}>
        <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '12px' }}>Filter by Payment Method</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['bank', 'cheque', 'cash', 'upi'].map(pmt => (
            <button
              key={pmt}
              onClick={() => { setFilterPmt(filterPmt === pmt ? '' : pmt); setPage(0) }}
              style={{
                padding: '6px 16px', borderRadius: '100px', cursor: 'pointer', transition: 'all .15s', textTransform: 'capitalize',
                background: filterPmt === pmt ? `${t.gold}20` : 'transparent',
                border: `1px solid ${filterPmt === pmt ? t.gold : t.border}`,
                color: filterPmt === pmt ? t.gold : t.text3,
                fontSize: '.65rem',
              }}
            >
              {pmt}
            </button>
          ))}
        </div>
      </div>

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={s.input}
          placeholder="Search customer, bill no, phone..."
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
        <span>Showing {rows.length} of {total.toLocaleString('en-IN')} records{filterPmt ? ` (${filterPmt} filtered client-side)` : ''}</span>
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
                {['Bill No', 'Date', 'Customer', 'Phone', 'Branch', 'Type', 'Amount (₹)', 'Payment Method', 'Pmt Status', 'Remark'].map(h =>
                  <th key={h} style={s.th}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ transition: 'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{r.bill_no || '—'}</td>
                  <td style={s.td}>{fmtDate(r.date)}</td>
                  <td style={s.td}>{r.cust_name}</td>
                  <td style={{ ...s.td, color: t.text3 }}>{r.cust_mobile}</td>
                  <td style={{ ...s.td, color: t.text2 }}>{r.branch_name || r.branch_id}</td>
                  <td style={s.td}>
                    <Badge label={r.type_gold || '—'} color={r.type_gold === 'physical' ? 'blue' : 'purple'} />
                  </td>
                  <td style={{ ...s.td, fontWeight: 500 }}>₹{fmt(r.finl_amnt)}</td>
                  <td style={s.td}>
                    {r.pymt_mde ? (
                      <Badge label={r.pymt_mde} color={PMT_COLORS[r.pymt_mde?.toLowerCase()] || 'dim'} />
                    ) : '—'}
                  </td>
                  <td style={s.td}>
                    {r.pmt_status ? (
                      <Badge label={r.pmt_status} color={r.pmt_status === 'paid' ? 'green' : 'orange'} />
                    ) : '—'}
                  </td>
                  <td style={{ ...s.td, maxWidth: '200px', whiteSpace: 'normal', lineHeight: 1.4 }}>
                    {r.txn_rmrk ? <span style={{ color: t.text3, fontSize: '.68rem' }}>{r.txn_rmrk}</span> : <span style={{ color: t.text4 }}>—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                    {hasFilters ? 'No records match your filters' : 'No pending bills found'}
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
