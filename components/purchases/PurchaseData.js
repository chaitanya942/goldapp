'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const STATUS_COLORS = {
  at_branch:        { color: '#3a8fbf', label: 'At Branch' },
  at_ho:            { color: '#3aaa6a', label: 'At HO' },
  in_consignment:   { color: '#c9981f', label: 'In Transit' },
  sent_for_melting: { color: '#bf5a3a', label: 'Melting' },
  melted:           { color: '#8c5ac8', label: 'Melted' },
  sold:             { color: '#888888', label: 'Sold' },
}

function fmtTime(t) {
  if (!t) return '—'
  const parts = String(t).split(':')
  if (parts.length < 2) return t
  const h = parseInt(parts[0])
  const m = parts[1]
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m} ${ampm}`
}

// ── DATE HELPERS ────────────────────────────────────────────────────────────
const istNow = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const istStr = (d = istNow()) => d.toISOString().split('T')[0]

// ── EXPORT HELPERS ──────────────────────────────────────────────────────────
const EXPORT_COLS = [
  { key: 'application_id',            label: 'App ID' },
  { key: 'purchase_date',             label: 'Date' },
  { key: 'transaction_time',          label: 'Time' },
  { key: 'customer_name',             label: 'Customer' },
  { key: 'phone_number',              label: 'Phone' },
  { key: 'branch_name',               label: 'Branch' },
  { key: 'gross_weight',              label: 'Gross Wt (g)' },
  { key: 'stone_weight',              label: 'Stone (g)' },
  { key: 'wastage',                   label: 'Wastage (g)' },
  { key: 'net_weight',                label: 'Net Wt (g)' },
  { key: 'purity',                    label: 'Purity (%)' },
  { key: 'total_amount',              label: 'Gross Amt (₹)' },
  { key: 'service_charge_pct',        label: 'Svc %' },
  { key: 'service_charge_amount_crm', label: 'Svc Amt (₹)' },
  { key: 'final_amount_crm',          label: 'Final Amt (₹)' },
  { key: 'transaction_type',          label: 'Type' },
  { key: 'stock_status',              label: 'Status' },
]

function exportCSV(rows, filename) {
  const header = EXPORT_COLS.map(c => c.label).join(',')
  const body   = rows.map(r =>
    EXPORT_COLS.map(c => {
      const v = r[c.key] ?? ''
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : v
    }).join(',')
  ).join('\n')
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script'); s.src = src
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

async function exportXLSX(rows, filename) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js')
  const data = [
    EXPORT_COLS.map(c => c.label),
    ...rows.map(r => EXPORT_COLS.map(c => r[c.key] ?? ''))
  ]
  const ws = window.XLSX.utils.aoa_to_sheet(data)
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Purchases')
  window.XLSX.writeFile(wb, filename)
}

export default function PurchaseData() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme]
  const isSuperAdmin = userProfile?.role === 'super_admin'

  const [purchases, setPurchases]     = useState([])
  const [allBranches, setAllBranches] = useState([])
  const [loading, setLoading]         = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterTxn, setFilterTxn]     = useState('')
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')

  const [page, setPage]             = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const PAGE_SIZE = 100

  const [kpis, setKpis] = useState(null)

  const [selectedIds, setSelectedIds]             = useState(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteAllMode, setDeleteAllMode]         = useState(false)
  const [deleting, setDeleting]                   = useState(false)

  useEffect(() => {
    supabase.from('branches').select('name').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setAllBranches(data.map(b => b.name)) })
    loadKpis()
    loadPage(0)
  }, [])

  useEffect(() => { loadPage(page) }, [page, search, filterStatus, filterBranch, filterTxn, fromDate, toDate])

  const loadKpis = async () => {
    const { data } = await supabase.rpc('get_purchase_kpis')
    if (data) setKpis(data)
  }

  const buildQuery = (forExport = false) => {
    let q = forExport
      ? supabase.from('purchases').select('*')
      : supabase.from('purchases').select('*', { count: 'exact' })
    q = q.eq('is_deleted', false)
    if (search)       q = q.or(`customer_name.ilike.%${search}%,application_id.ilike.%${search}%,branch_name.ilike.%${search}%`)
    if (filterStatus) q = q.eq('stock_status', filterStatus)
    if (filterBranch) q = q.eq('branch_name', filterBranch)
    if (filterTxn)    q = q.eq('transaction_type', filterTxn)
    if (fromDate)     q = q.gte('purchase_date', fromDate)
    if (toDate)       q = q.lte('purchase_date', toDate)
    return q
  }

  const loadPage = async (pageNum) => {
    setLoading(true)
    const from = pageNum * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1
    const { data, count } = await buildQuery()
      .order('purchase_date', { ascending: false })
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(from, to)
    if (data) setPurchases(data)
    if (count !== null) setTotalCount(count)
    setSelectedIds(new Set())
    setLoading(false)
  }

  const load = () => { setPage(0); loadKpis(); loadPage(0) }

  // Quick filter functions
  const setToday = () => { const d = istStr(); setFromDate(d); setToDate(d); setPage(0) }
  const setYesterday = () => { const d = istNow(); d.setDate(d.getDate() - 1); const s = istStr(d); setFromDate(s); setToDate(s); setPage(0) }
  const setThisWeek = () => { const to = istNow(); const fr = istNow(); fr.setDate(fr.getDate() - 7); setToDate(istStr(to)); setFromDate(istStr(fr)); setPage(0) }
  const setThisMonth = () => { const now = istNow(); setFromDate(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`); setToDate(istStr(now)); setPage(0) }
  const clearFilters = () => { setFromDate(''); setToDate(''); setFilterBranch(''); setFilterStatus(''); setFilterTxn(''); setSearch(''); setPage(0) }

  const handleExport = async (format) => {
    setExporting(true)
    try {
      let allRows = [], from = 0
      const CHUNK = 1000
      while (true) {
        const { data } = await buildQuery(true)
          .order('purchase_date', { ascending: false })
          .range(from, from + CHUNK - 1)
        if (!data || data.length === 0) break
        allRows = [...allRows, ...data]
        if (data.length < CHUNK) break
        from += CHUNK
      }
      const ts       = new Date().toISOString().slice(0, 10)
      const suffix   = filterBranch ? `_${filterBranch}` : ''
      const filename = `purchases${suffix}_${ts}`
      if (format === 'csv')  exportCSV(allRows, `${filename}.csv`)
      if (format === 'xlsx') await exportXLSX(allRows, `${filename}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  const toggleRow = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleAll = () => {
    if (purchases.length > 0 && purchases.every(p => selectedIds.has(p.id))) setSelectedIds(new Set())
    else setSelectedIds(new Set(purchases.map(p => p.id)))
  }

  const handleDeleteSelected = async () => {
    setDeleting(true)
    if (deleteAllMode) {
      while (true) {
        const { data } = await buildQuery(true).select('id').limit(500)
        if (!data || data.length === 0) break
        const ids = data.map(r => r.id)
        for (let i = 0; i < ids.length; i += 100)
          await supabase.from('purchases').update({ is_deleted: true }).in('id', ids.slice(i, i + 100))
        if (ids.length < 500) break
      }
    } else {
      const ids = [...selectedIds]
      for (let i = 0; i < ids.length; i += 100)
        await supabase.from('purchases').update({ is_deleted: true }).in('id', ids.slice(i, i + 100))
    }
    setShowDeleteConfirm(false); setDeleteAllMode(false); setDeleting(false); load()
  }

  const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const totalPages          = Math.ceil(totalCount / PAGE_SIZE)
  const allPageSelected     = purchases.length > 0 && purchases.every(p => selectedIds.has(p.id))

  const s = {
    wrap:           { padding: '32px', maxWidth: '100%' },
    header:         { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
    title:          { fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' },
    sub:            { fontSize: '.72rem', color: t.text3, marginTop: '4px' },
    btnGold:        { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnOutline:     { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnSmall:       { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 14px', fontSize: '.68rem', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all .15s' },
    btnDanger:      { background: 'transparent', color: t.red, border: `1px solid ${t.red}60`, borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer', transition: 'background .2s' },
    btnDangerSolid: { background: t.red, color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    card:           { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', marginBottom: '24px' },
    tblWrap:        { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:             { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400, whiteSpace: 'nowrap' },
    td:             { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    select:         { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '.72rem', cursor: 'pointer' },
    input:          { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '.75rem', outline: 'none', width: '240px' },
    checkbox:       { width: '15px', height: '15px', accentColor: t.gold, cursor: 'pointer' },
  }

  // ── DELETE MODAL ──
  const DeleteModal = () => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: t.card, border: `1px solid ${t.red}40`, borderRadius: '14px', padding: '36px', maxWidth: '420px', width: '90%', boxShadow: `0 0 60px ${t.red}18` }}>
        <div style={{ fontSize: '1.4rem', marginBottom: '12px', textAlign: 'center' }}>⚠</div>
        <div style={{ fontSize: '1rem', color: t.text1, fontWeight: 400, textAlign: 'center', marginBottom: '8px' }}>
          {deleteAllMode ? `Delete ALL ${totalCount.toLocaleString('en-IN')} records?` : `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'record' : 'records'}?`}
        </div>
        <div style={{ fontSize: '.72rem', color: t.red, textAlign: 'center', marginBottom: '28px', lineHeight: 1.7 }}>
          {deleteAllMode
            ? <>Permanently deletes <strong>ALL {totalCount.toLocaleString('en-IN')}</strong> purchase records{(filterBranch || filterStatus || search) ? ' matching current filters' : ''}.<br />This cannot be undone.</>
            : <>Permanently deletes <strong>{selectedIds.size}</strong> purchase {selectedIds.size === 1 ? 'record' : 'records'}.<br />This cannot be undone.</>}
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button style={s.btnOutline} onClick={() => { setShowDeleteConfirm(false); setDeleteAllMode(false) }} disabled={deleting}>Cancel</button>
          <button style={s.btnDangerSolid} onClick={handleDeleteSelected} disabled={deleting}>
            {deleting ? 'Deleting...' : deleteAllMode ? `Delete All ${totalCount.toLocaleString('en-IN')} Records` : `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'Record' : 'Records'}`}
          </button>
        </div>
      </div>
    </div>
  )

  // ── MAIN VIEW ──
  return (
    <div style={s.wrap}>
      {showDeleteConfirm && <DeleteModal />}

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <div style={s.title}>Purchase Data</div>
          <div style={s.sub}>Live data synced from CRM · {totalCount.toLocaleString('en-IN')} records</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {isSuperAdmin && totalCount > 0 && (
            <button style={{ ...s.btnDanger, borderColor: `${t.red}80` }}
              onClick={() => { setDeleteAllMode(true); setShowDeleteConfirm(true) }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.red}15` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              🗑 Delete All {totalCount.toLocaleString('en-IN')}
            </button>
          )}
          {isSuperAdmin && selectedIds.size > 0 && (
            <button style={s.btnDanger}
              onClick={() => { setDeleteAllMode(false); setShowDeleteConfirm(true) }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.red}15` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              🗑 Delete {selectedIds.size} Selected
            </button>
          )}
        </div>
      </div>

      {/* KPI CARDS */}
      {kpis && (() => {
        const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
        const dateRange = kpis.min_date
          ? (kpis.min_date === kpis.max_date ? fmtD(kpis.min_date) : `${fmtD(kpis.min_date)} — ${fmtD(kpis.max_date)}`)
          : '—'
        const cards = [
          { label: 'Total Records',  value: Number(kpis.total_count).toLocaleString('en-IN'),                                                     color: t.gold,    size: '1.8rem' },
          { label: 'Date Range',     value: dateRange,                                                                                            color: t.text2,   size: '.85rem' },
          { label: 'Branches',       value: Number(kpis.branch_count),                                                                            color: '#7eb8d4', size: '1.8rem' },
          { label: 'Total Gross Wt', value: `${Number(kpis.total_gross).toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`,                 color: t.text1,   size: '1.2rem' },
          { label: 'Total Net Wt',   value: `${Number(kpis.total_net).toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`,                   color: t.gold,    size: '1.2rem' },
          { label: 'Total Value',    value: `₹${Number(kpis.total_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,                 color: t.green,   size: '1rem'   },
          { label: 'Physical',       value: Number(kpis.physical_count).toLocaleString('en-IN'),                                                  color: '#7eb8d4', size: '1.8rem' },
          { label: 'Takeover',       value: Number(kpis.takeover_count).toLocaleString('en-IN'),                                                  color: '#c9981f', size: '1.8rem' },
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '28px' }}>
            {cards.map(c => (
              <div key={c.label} style={{ ...s.card, textAlign: 'center', padding: '20px 16px', marginBottom: 0 }}>
                <div style={{ fontSize: c.size, fontWeight: 200, color: c.color, lineHeight: 1.15 }}>{c.value}</div>
                <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>{c.label}</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* QUICK FILTERS */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          ['Today', setToday],
          ['Yesterday', setYesterday],
          ['This Week', setThisWeek],
          ['This Month', setThisMonth],
        ].map(([label, fn]) => (
          <button key={label} onClick={fn}
            style={{ padding: '5px 12px', borderRadius: '100px', border: `1px solid ${t.border}`, background: 'transparent', color: t.text3, fontSize: '.65rem', cursor: 'pointer', transition: 'all .15s', letterSpacing: '.04em' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = t.gold; e.currentTarget.style.color = t.gold }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text3 }}>
            {label}
          </button>
        ))}
        {(fromDate || toDate || filterBranch || filterStatus || filterTxn || search) && (
          <button onClick={clearFilters}
            style={{ padding: '5px 12px', borderRadius: '100px', border: `1px solid ${t.red}40`, background: 'transparent', color: t.red, fontSize: '.65rem', cursor: 'pointer', marginLeft: '8px' }}>
            ✕ Clear All
          </button>
        )}
      </div>

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={s.input} placeholder="Search customer, app ID, branch..." value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />
        <select style={s.select} value={filterBranch} onChange={e => { setFilterBranch(e.target.value); setPage(0) }}>
          <option value="">All Branches</option>
          {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select style={s.select} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0) }}>
          <option value="">All Status</option>
          {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select style={s.select} value={filterTxn} onChange={e => { setFilterTxn(e.target.value); setPage(0) }}>
          <option value="">All Types</option>
          <option value="PHYSICAL">Physical</option>
          <option value="TAKEOVER">Takeover</option>
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '.68rem', color: t.text4 }}>From</span>
          <input type="date" style={{ ...s.select, width: 'auto' }} value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0) }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '.68rem', color: t.text4 }}>To</span>
          <input type="date" style={{ ...s.select, width: 'auto' }} value={toDate} onChange={e => { setToDate(e.target.value); setPage(0) }} />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button style={s.btnSmall} disabled={exporting} onClick={() => handleExport('csv')}
            onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60` }}
            onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border }}>
            {exporting ? '...' : '↓ CSV'}
          </button>
          <button style={s.btnSmall} disabled={exporting} onClick={() => handleExport('xlsx')}
            onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60` }}
            onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border }}>
            {exporting ? '...' : '↓ Excel'}
          </button>
        </div>
      </div>

      {/* PAGINATION INFO */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginBottom: '12px', fontSize: '.7rem', color: t.text3 }}>
        {selectedIds.size > 0 && <span style={{ color: t.gold }}>{selectedIds.size} selected</span>}
        <span>Showing {totalCount === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString('en-IN')} of {totalCount.toLocaleString('en-IN')} records</span>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: page === 0 ? t.text4 : t.text2, cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: '.7rem' }}>←</button>
          <span>Page {page + 1} of {totalPages || 1}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
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
                {isSuperAdmin && (
                  <th style={{ ...s.th, width: '40px', textAlign: 'center' }}>
                    <input type="checkbox" style={s.checkbox} checked={allPageSelected} onChange={toggleAll} />
                  </th>
                )}
                {['App ID','Date','Time','Customer','Phone','Branch','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Svc Amt','Final Amt','Type','Status'].map(h =>
                  <th key={h} style={s.th}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const status     = STATUS_COLORS[p.stock_status] || { color: t.text3, label: p.stock_status }
                const isSelected = selectedIds.has(p.id)
                return (
                  <tr key={p.id} style={{
                    background: isSelected ? `${t.gold}12` : 'transparent',
                    outline: isSelected ? `1px solid ${t.gold}30` : 'none',
                  }}>
                    {isSuperAdmin && (
                      <td style={{ ...s.td, textAlign: 'center', padding: '10px 8px' }}>
                        <input type="checkbox" style={s.checkbox} checked={isSelected} onChange={() => toggleRow(p.id)} />
                      </td>
                    )}
                    <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{p.application_id}</td>
                    <td style={s.td}>{fmtDate(p.purchase_date)}</td>
                    <td style={{ ...s.td, color: t.text3, fontSize: '.68rem' }}>{fmtTime(p.transaction_time)}</td>
                    <td style={s.td}>{p.customer_name}</td>
                    <td style={{ ...s.td, color: t.text3 }}>{p.phone_number}</td>
                    <td style={{ ...s.td, color: t.text2 }}>{p.branch_name}</td>
                    <td style={s.td}>{p.gross_weight}g</td>
                    <td style={s.td}>{p.stone_weight}g</td>
                    <td style={s.td}>{p.wastage}g</td>
                    <td style={s.td}>{p.net_weight}g</td>
                    <td style={s.td}>{p.purity}%</td>
                    <td style={s.td}>₹{fmt(p.total_amount)}</td>
                    <td style={s.td}>{p.service_charge_pct}%</td>
                    <td style={s.td}>₹{fmt(p.service_charge_amount_crm)}</td>
                    <td style={{ ...s.td, fontWeight: 500 }}>₹{fmt(p.final_amount_crm)}</td>
                    <td style={{ ...s.td, fontSize: '.65rem', color: t.text3 }}>{p.transaction_type}</td>
                    <td style={s.td}>
                      <span style={{ fontSize: '.62rem', color: status.color, background: `${status.color}18`, border: `1px solid ${status.color}40`, borderRadius: '4px', padding: '2px 7px', whiteSpace: 'nowrap' }}>{status.label}</span>
                    </td>
                  </tr>
                )
              })}
              {purchases.length === 0 && (
                <tr><td colSpan={isSuperAdmin ? 18 : 17} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                  {search || filterStatus || filterBranch ? 'No records match your filters' : 'No data yet — click ⟳ Sync CRM in the topbar to pull latest data'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}