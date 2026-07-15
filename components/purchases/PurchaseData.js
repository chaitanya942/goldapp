'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import Badge from '../ui/Badge'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { istNow, istStr } from '../../lib/dateIst'
import { getCache, setCache } from '../../lib/moduleCache'
import { appIdVariants } from '../../lib/appIdSearch'

// Cache key for a page query — covers every input that changes the result set,
// so a re-open with the same filters paints instantly from memory.
function pageCacheKey(p) {
  return `pd:page:${p.page}|${p.search}|${p.filterCrmStatus}|${p.filterCrmSource}|${p.filterStatus}|${p.filterBranch}|${p.filterTxn}|${p.fromDate}|${p.toDate}|${p.dispatchedFrom}|${p.dispatchedTo}|${p.sortCol}|${p.sortDir}`
}
// Default (no-filter, page 0) key — what the user sees when they first open
// the module. Seeding state from this makes the common re-open instant.
const DEFAULT_PAGE_KEY = pageCacheKey({
  page: 0, search: '', filterCrmStatus: '', filterCrmSource: '', filterStatus: '',
  filterBranch: '', filterTxn: '', fromDate: '', toDate: '', dispatchedFrom: '',
  dispatchedTo: '', sortCol: 'purchase_date', sortDir: 'desc',
})

const STATUS_COLORS = {
  at_branch:        { color: '#3a8fbf', label: 'At Branch' },
  at_ho:            { color: '#3aaa6a', label: 'At HO' },
  in_consignment:   { color: '#c9981f', label: 'In Transit' },
  sent_for_melting: { color: '#bf5a3a', label: 'Melting' },
  melted:           { color: '#8c5ac8', label: 'Melted' },
  sold:             { color: '#888888', label: 'Sold' },
}

const CRM_STATUS = {
  approved: { label: 'Approved', color: 'green'  },
  pending:  { label: 'Pending',  color: 'orange' },
  rejected: { label: 'Rejected', color: 'red'    },
}

const CRM_SOURCE = {
  old_crm: { label: 'Old CRM', color: 'dim'    },
  new_crm: { label: 'NEW CRM', color: 'purple' },
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
  { key: 'id_proof_types',            label: 'ID Type' },
  { key: 'id_proof_numbers',          label: 'ID Number' },
  { key: 'bank_name',                 label: 'Bank' },
  { key: 'payment_reference',         label: 'Payment Ref' },
  { key: 'dispatched_at',             label: 'In Consignment Since' },
  { key: 'received_at',               label: 'Received At HO' },
  { key: 'booked_at',                 label: 'Booking Date' },
]

// Columns that are TIMESTAMPTZ in the DB — we export them date-only (IST,
// YYYY-MM-DD) so Excel/Sheets recognise them as dates and the date filter
// works. Keeping the time component made the filter treat the whole cell
// as text. transaction_time stays untouched (it's a clock time, not a date).
const DATE_ONLY_EXPORT_KEYS = new Set(['dispatched_at', 'received_at', 'booked_at'])
const toIstDateOnly = (v) => {
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return v   // already plain date
  const d = new Date(v)
  return isNaN(d) ? v : d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}
const exportCell = (r, key) => {
  const raw = r[key]
  if (DATE_ONLY_EXPORT_KEYS.has(key)) return toIstDateOnly(raw)
  return raw ?? ''
}

function exportCSV(rows, filename) {
  const header = EXPORT_COLS.map(c => c.label).join(',')
  const body   = rows.map(r =>
    EXPORT_COLS.map(c => {
      const v = exportCell(r, c.key)
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
    ...rows.map(r => EXPORT_COLS.map(c => exportCell(r, c.key)))
  ]
  const ws = window.XLSX.utils.aoa_to_sheet(data)
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Purchases')
  window.XLSX.writeFile(wb, filename)
}

// ── SKELETON PLACEHOLDERS (first load, no cache yet) ────────────────────────
function Skel({ t, h = 16, w = '100%', r = 8, style = {} }) {
  return (
    <div style={{
      height: h, width: w, borderRadius: r, flexShrink: 0,
      background: `linear-gradient(90deg, ${t.card} 25%, ${t.border} 50%, ${t.card} 75%)`,
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite',
      ...style,
    }} />
  )
}

function PurchaseDataSkeleton({ t }) {
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: '10px', overflow: 'hidden' }}>
      <Skel t={t} h={40} r={0} />
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} style={{ padding: '9px 14px', borderTop: `1px solid ${t.border}40` }}>
          <Skel t={t} h={18} r={5} />
        </div>
      ))}
    </div>
  )
}

export default function PurchaseData() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isSuperAdmin = userProfile?.role === 'super_admin'
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Seed from the in-memory cache (stale-while-revalidate) so a re-open of the
  // module paints instantly; the load effect still refreshes in the background.
  const cachedPage = getCache(DEFAULT_PAGE_KEY)
  const [purchases, setPurchases]     = useState(cachedPage?.purchases ?? [])
  const [allBranches, setAllBranches] = useState([])
  const [loading, setLoading]         = useState(!cachedPage)
  const [exporting, setExporting]     = useState(false)
  const [search, setSearch]           = useState('')   // debounced — drives the query
  const [searchInput, setSearchInput] = useState('')   // immediate — bound to the input
  const [filterCrmStatus, setFilterCrmStatus] = useState('')
  const [filterCrmSource, setFilterCrmSource] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterTxn, setFilterTxn]     = useState('')
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')
  // Separate filter for purchases.dispatched_at — the moment a bill
  // transitioned at_branch → in_consignment. Useful when you want to
  // narrow 'all bills currently in transit' down to a specific dispatch
  // day, rather than filtering by purchase_date.
  const [dispatchedFrom, setDispatchedFrom] = useState('')
  const [dispatchedTo,   setDispatchedTo]   = useState('')

  const [page, setPage]             = useState(0)
  const [totalCount, setTotalCount] = useState(cachedPage?.totalCount ?? 0)
  const PAGE_SIZE = 100

  const [sortCol, setSortCol] = useState('purchase_date')
  const [sortDir, setSortDir] = useState('desc')

  const [kpis, setKpis] = useState(() => getCache('pd:kpis:') ?? null)
  const [bothCrmIds, setBothCrmIds] = useState(cachedPage?.bothCrmIds ?? new Set())
  const [loadError, setLoadError]   = useState(null)
  // Bumped by load() to force a reload even when page/filters are unchanged
  // (e.g. after a delete). Drives the page + KPI effects.
  const [refreshNonce, setRefreshNonce] = useState(0)
  // Monotonic request id — loadPage stamps each call and ignores any
  // response whose stamp is stale, so a slow earlier query can't overwrite
  // a newer one when filters are typed quickly.
  const reqSeqRef = useRef(0)

  const [selectedIds, setSelectedIds]             = useState(new Set())
  const [hoveredId, setHoveredId]                 = useState(null)
  // Set by the Supabase Realtime subscription when a row changes in the
  // `purchases` table while the user is viewing — drives a "refresh" nudge.
  const [hasLiveUpdate, setHasLiveUpdate]         = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteAllMode, setDeleteAllMode]         = useState(false)
  const [deleting, setDeleting]                   = useState(false)

  useEffect(() => {
    supabase.from('branches').select('name').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setAllBranches(data.map(b => b.name)) })
  }, [])

  // Supabase Realtime — any insert/update/delete on `purchases` (e.g. the
  // 60s CRM sync landing new bills) flips on a "new data" nudge instead of
  // silently mutating the page the user is reading/filtering/scrolling.
  // Requires: `alter publication supabase_realtime add table purchases;`
  useEffect(() => {
    const channel = supabase
      .channel('purchases-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' },
        () => setHasLiveUpdate(true))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Debounce the search box — commit to `search` (which drives the query)
  // 300 ms after the last keystroke instead of firing a query per key.
  useEffect(() => {
    const id = setTimeout(() => { setSearch(searchInput); setPage(0) }, 300)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => { loadPage(page) }, [page, search, filterCrmStatus, filterCrmSource, filterStatus, filterBranch, filterTxn, fromDate, toDate, dispatchedFrom, dispatchedTo, sortCol, sortDir, refreshNonce])
  useEffect(() => { loadKpis(filterCrmStatus) }, [filterCrmStatus, refreshNonce])

  const loadKpis = async (crmStatus = '') => {
    const { data } = await supabase.rpc('get_purchase_kpis', { p_crm_status: crmStatus || null })
    if (data) { setCache(`pd:kpis:${crmStatus}`, data); setKpis(data) }
  }

  // withCount=true asks Postgres for an exact COUNT — the expensive part of a
  // paginated query. Callers that only need rows (export, delete, forward
  // pagination) leave it off.
  const buildQuery = (withCount = false) => {
    let q = withCount
      ? supabase.from('purchases').select('*', { count: 'exact' })
      : supabase.from('purchases').select('*')
    q = q.eq('is_deleted', false).neq('crm_status', 'deleted')
    if (search) {
      // Hyphen-insensitive on application_id: expand the term into WGKA-XXXX /
      // WGKAXXXX variants so new- and old-CRM ids both match regardless of how
      // the user types the hyphen.
      const appIdOr = appIdVariants(search).map(v => `application_id.ilike.%${v}%`).join(',')
      q = q.or(`customer_name.ilike.%${search}%,${appIdOr},branch_name.ilike.%${search}%`)
    }
    if (filterCrmStatus)   q = q.eq('crm_status', filterCrmStatus)
    if (filterCrmSource)   q = q.eq('crm_source', filterCrmSource)
    if (filterStatus)      q = q.eq('stock_status', filterStatus)
    if (filterBranch) q = q.eq('branch_name', filterBranch)
    if (filterTxn)    q = q.eq('transaction_type', filterTxn)
    if (fromDate)     q = q.gte('purchase_date', fromDate)
    if (toDate)       q = q.lte('purchase_date', toDate)
    // dispatched_at is a TIMESTAMPTZ, so wrap the user's YYYY-MM-DD strings in
    // IST day-bounds to make the range inclusive of the chosen days.
    if (dispatchedFrom) q = q.gte('dispatched_at', `${dispatchedFrom}T00:00:00+05:30`)
    if (dispatchedTo)   q = q.lte('dispatched_at', `${dispatchedTo}T23:59:59+05:30`)
    return q
  }

  const loadPage = async (pageNum) => {
    const seq = ++reqSeqRef.current        // stamp this request
    setLoading(true)
    setLoadError(null)
    const from = pageNum * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1
    const asc  = sortDir === 'asc'
    // Only ask for an exact COUNT on page 0. Every filter change resets to
    // page 0, so the count is always fresh there; plain forward pagination
    // reuses it — the filtered set hasn't changed, so re-counting is wasted.
    const withCount = pageNum === 0
    let q = buildQuery(withCount).order(sortCol, { ascending: asc, nullsFirst: false })
    if (sortCol !== 'transaction_time') q = q.order('transaction_time', { ascending: false, nullsFirst: false })
    const { data, count, error } = await q.range(from, to)
    if (seq !== reqSeqRef.current) return   // a newer request superseded this one — drop it
    if (error) {
      setLoadError(error.message || 'Failed to load purchases')
      setLoading(false)
      return
    }
    const cacheKey      = pageCacheKey({ page: pageNum, search, filterCrmStatus, filterCrmSource, filterStatus, filterBranch, filterTxn, fromDate, toDate, dispatchedFrom, dispatchedTo, sortCol, sortDir })
    const resolvedCount = (count !== null && count !== undefined) ? count : totalCount
    setPurchases(data || [])
    if (count !== null && count !== undefined) setTotalCount(count)
    setSelectedIds(new Set())
    // Reveal the table now — don't make the user wait on the secondary
    // "Both CRMs" badge query below.
    setLoading(false)
    setCache(cacheKey, { purchases: data || [], totalCount: resolvedCount, bothCrmIds: new Set() })

    // Flag application_ids that genuinely exist in BOTH CRMs — i.e. the set
    // of distinct crm_source values for that id has size > 1. Runs after the
    // table is already visible.
    const ids = (data || []).map(r => r.application_id).filter(Boolean)
    if (ids.length) {
      const { data: both } = await supabase
        .from('purchases')
        .select('application_id, crm_source')
        .in('application_id', ids)
        .eq('is_deleted', false)
        .neq('crm_status', 'deleted')
      if (seq !== reqSeqRef.current) return
      if (both) {
        const sources = {}
        both.forEach(r => {
          ;(sources[r.application_id] ||= new Set()).add(r.crm_source)
        })
        const bothSet = new Set(Object.keys(sources).filter(id => sources[id].size > 1))
        setBothCrmIds(bothSet)
        setCache(cacheKey, { purchases: data || [], totalCount: resolvedCount, bothCrmIds: bothSet })
      }
    }
  }

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    // New column → default to descending (most-recent / largest first) —
    // ascending on a date column jumps to the oldest record, never useful.
    else { setSortCol(col); setSortDir('desc') }
    setPage(0)
  }

  // Force a reload without changing page/filters (used after deletes).
  // setPage(0) + the nonce bump make the page effect fire exactly once;
  // the KPI effect also keys off refreshNonce.
  const load = () => { setPage(0); setRefreshNonce(n => n + 1); setHasLiveUpdate(false) }

  // Quick filter functions
  const setToday = () => { const d = istStr(); setFromDate(d); setToDate(d); setPage(0) }
  const setYesterday = () => { const d = istNow(); d.setDate(d.getDate() - 1); const s = istStr(d); setFromDate(s); setToDate(s); setPage(0) }
  const setThisWeek = () => { const to = istNow(); const fr = istNow(); fr.setDate(fr.getDate() - 7); setToDate(istStr(to)); setFromDate(istStr(fr)); setPage(0) }
  const setThisMonth = () => { const now = istNow(); setFromDate(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`); setToDate(istStr(now)); setPage(0) }
  const clearFilters = () => { setFromDate(''); setToDate(''); setDispatchedFrom(''); setDispatchedTo(''); setFilterBranch(''); setFilterStatus(''); setFilterTxn(''); setSearch(''); setSearchInput(''); setFilterCrmStatus(''); setFilterCrmSource(''); setPage(0) }

  const handleExport = async (format) => {
    setExporting(true)
    try {
      let allRows = [], from = 0
      const CHUNK = 1000
      while (true) {
        const { data } = await buildQuery()
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
        const { data } = await buildQuery().select('id').limit(500)
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
  // Compact timestamp for the 'In Consignment Since' column.
  // Renders date + 24h time together, e.g. '08 May, 14:59'.
  const fmtDispatched = (d) => d ? new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '—'

  const totalPages          = Math.ceil(totalCount / PAGE_SIZE)
  const allPageSelected     = purchases.length > 0 && purchases.every(p => selectedIds.has(p.id))

  const s = {
    wrap:           { padding: isMobile ? '16px' : '32px', maxWidth: '100%' },
    header:         { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '10px' },
    title:          { fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' },
    sub:            { fontSize: '.72rem', color: t.text3, marginTop: '4px' },
    btnGold:        { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnOutline:     { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnSmall:       { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 14px', fontSize: '.68rem', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all .15s' },
    btnDanger:      { background: 'transparent', color: t.red, border: `1px solid ${t.red}60`, borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer', transition: 'background .2s' },
    btnDangerSolid: { background: t.red, color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    card:           { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', marginBottom: '24px' },
    tblWrap:        { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:             { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 },
    td:             { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    select:         { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '.72rem', cursor: 'pointer' },
    input:          { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '.75rem', outline: 'none', width: isMobile ? '100%' : '240px' },
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
            ? <>Permanently deletes <strong>ALL {totalCount.toLocaleString('en-IN')}</strong> purchase records{(filterBranch || filterStatus || search || filterCrmStatus || filterCrmSource || filterTxn || fromDate || toDate || dispatchedFrom || dispatchedTo) ? ' matching current filters' : ''}.<br />This cannot be undone.</>
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
          <div style={s.sub}>
            Live from CRM · {totalCount.toLocaleString('en-IN')} records
            {kpis?.min_date ? ` · ${(() => { const f = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); return kpis.min_date === kpis.max_date ? f(kpis.min_date) : `${f(kpis.min_date)} – ${f(kpis.max_date)}` })()}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* "Delete All" mass-delete removed — data is CRM-synced and auto-maintained.
              Per-row "Delete N Selected" is kept below for targeted cleanup. */}
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
      {!kpis && loading && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '14px', marginBottom: '28px' }}>
          {Array.from({ length: 8 }).map((_, i) => <Skel key={i} t={t} h={92} r={10} />)}
        </div>
      )}
      {kpis && (() => {
        const inr   = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
        const grams = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`
        // Primary = money / weight (what the business is actually tracking); given
        // visual priority. Secondary = counts, shown smaller and muted below.
        const primary = [
          { label: 'Total Value',    value: inr(kpis.total_value),   color: t.green },
          { label: 'Total Gross Wt', value: grams(kpis.total_gross), color: t.text1 },
          { label: 'Total Net Wt',   value: grams(kpis.total_net),   color: t.gold  },
        ]
        const secondary = [
          { label: 'Total Records', value: Number(kpis.total_count).toLocaleString('en-IN'),    color: t.gold    },
          { label: 'Physical',      value: Number(kpis.physical_count).toLocaleString('en-IN'), color: '#7eb8d4' },
          { label: 'Takeover',      value: Number(kpis.takeover_count).toLocaleString('en-IN'), color: '#c9981f' },
          { label: 'Branches',      value: Number(kpis.branch_count).toLocaleString('en-IN'),   color: '#7eb8d4' },
        ]
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '14px', marginBottom: '14px' }}>
              {primary.map(c => (
                <div key={c.label} style={{ ...s.card, textAlign: 'center', padding: '22px 16px', marginBottom: 0 }}>
                  <div style={{ fontSize: 'clamp(1.2rem, 2.4vw, 1.7rem)', fontWeight: 200, color: c.color, lineHeight: 1.1, letterSpacing: '-.01em' }}>{c.value}</div>
                  <div style={{ fontSize: '.62rem', color: t.text3, letterSpacing: '.13em', textTransform: 'uppercase', marginTop: '8px' }}>{c.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
              {secondary.map(c => (
                <div key={c.label} style={{ ...s.card, textAlign: 'center', padding: '14px 12px', marginBottom: 0 }}>
                  <div style={{ fontSize: '1.35rem', fontWeight: 200, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
                  <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>{c.label}</div>
                </div>
              ))}
            </div>
          </>
        )
      })()}

      {/* FILTER CHIPS — CRM source · status · quick dates, condensed to one row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { key: '',        label: 'All Sources' },
          { key: 'old_crm', label: 'Old CRM' },
          { key: 'new_crm', label: 'NEW CRM' },
        ].map(({ key, label }) => {
          const active = filterCrmSource === key
          const accent = key === 'new_crm' ? t.purple : key === 'old_crm' ? t.text3 : t.gold
          return (
            <button key={key}
              onClick={() => { setFilterCrmSource(key); setPage(0) }}
              style={{
                padding: '5px 16px', borderRadius: '100px',
                border: `1px solid ${active ? accent : t.border}`,
                background: active ? `${accent}18` : 'transparent',
                color: active ? accent : t.text3,
                fontSize: '.68rem', fontWeight: active ? 600 : 400,
                letterSpacing: '.05em', cursor: 'pointer', transition: 'all .15s',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text3 } }}
            >
              {label}
            </button>
          )
        })}
        <div style={{ width: '1px', height: '18px', background: t.border, margin: '0 6px', flexShrink: 0 }} />
        {[
          { key: '',         label: 'All Data' },
          { key: 'approved', label: 'Approved' },
          { key: 'pending',  label: 'Pending'  },
          { key: 'rejected', label: 'Rejected' },
        ].map(({ key, label }) => {
          const active = filterCrmStatus === key
          const accent = key === 'approved' ? t.green : key === 'pending' ? t.orange : key === 'rejected' ? t.red : t.gold
          return (
            <button key={key}
              onClick={() => { setFilterCrmStatus(key); setPage(0) }}
              style={{
                padding: '5px 16px',
                borderRadius: '100px',
                border: `1px solid ${active ? accent : t.border}`,
                background: active ? `${accent}18` : 'transparent',
                color: active ? accent : t.text3,
                fontSize: '.68rem',
                fontWeight: active ? 600 : 400,
                letterSpacing: '.05em',
                cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text3 } }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={s.input} placeholder="Search customer, app ID, branch..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title="Filter by purchase date (when the bill was sold to White Gold)">
          <span style={{ fontSize: '.68rem', color: t.text4 }}>Purchase</span>
          <input type="date" style={{ ...s.select, width: 'auto' }} value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0) }} />
          <span style={{ fontSize: '.68rem', color: t.text4 }}>→</span>
          <input type="date" style={{ ...s.select, width: 'auto' }} value={toDate} onChange={e => { setToDate(e.target.value); setPage(0) }} />
        </div>
        {/* Quick date shortcuts — sit beside the Purchase range since they set it */}
        {[
          ['Today', setToday],
          ['Yesterday', setYesterday],
          ['This Week', setThisWeek],
          ['This Month', setThisMonth],
        ].map(([label, fn]) => (
          <button key={label} onClick={fn}
            style={{ padding: '6px 12px', borderRadius: '100px', border: `1px solid ${t.border}`, background: 'transparent', color: t.text3, fontSize: '.65rem', cursor: 'pointer', transition: 'all .15s', letterSpacing: '.04em' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = t.gold; e.currentTarget.style.color = t.gold }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text3 }}>
            {label}
          </button>
        ))}
        {(fromDate || toDate || filterBranch || filterStatus || filterTxn || search || filterCrmStatus || filterCrmSource) && (
          <button onClick={clearFilters}
            style={{ padding: '6px 12px', borderRadius: '100px', border: `1px solid ${t.red}40`, background: 'transparent', color: t.red, fontSize: '.65rem', cursor: 'pointer' }}>
            Clear all
          </button>
        )}
        {/* Dispatched-date filter and CSV export removed — Excel is the only export,
            and it sits at the right end of the filter row where Dispatched used to be. */}
        <button style={{ ...s.btnSmall, marginLeft: 'auto' }} disabled={exporting} onClick={() => handleExport('xlsx')}
          onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60` }}
          onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border }}>
          {exporting ? '...' : '↓ Excel'}
        </button>
      </div>

      {/* PAGINATION INFO */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginBottom: '12px', fontSize: '.7rem', color: t.text3 }}>
        {hasLiveUpdate && (
          <button onClick={load}
            style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '100px', cursor: 'pointer', border: `1px solid ${t.green}66`, background: `${t.green}1a`, color: t.green, fontSize: '.66rem', fontWeight: 600, letterSpacing: '.02em' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.green }} />
            New data synced — refresh
          </button>
        )}
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

      {/* LOAD ERROR */}
      {loadError && !loading && (
        <div style={{
          background: `${t.red}12`, border: `1px solid ${t.red}40`, borderRadius: '8px',
          padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '.74rem', color: t.red }}>
            ⚠ Couldn't load purchases — {loadError}
          </span>
          <button style={{ ...s.btnSmall, color: t.red, borderColor: `${t.red}60` }} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* TABLE / CARDS */}
      {loading && purchases.length === 0 ? (
        <PurchaseDataSkeleton t={t} isMobile={isMobile} />
      ) : (
      <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .2s', pointerEvents: loading ? 'none' : 'auto' }}>
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {purchases.length === 0 ? (
            <div style={{ textAlign: 'center', color: t.text4, padding: '48px', fontSize: '.75rem' }}>
              {(search || filterStatus || filterBranch || filterCrmStatus || filterTxn || fromDate || toDate || dispatchedFrom || dispatchedTo) ? 'No records match your filters' : 'No purchase data yet. Syncing from CRM in the background.'}
            </div>
          ) : purchases.map((p) => {
            const status = STATUS_COLORS[p.stock_status] || { color: t.text3, label: p.stock_status }
            const cs = CRM_STATUS[p.crm_status?.toLowerCase()] || { label: p.crm_status || 'approved', color: 'green' }
            return (
              <div key={p.id} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '.78rem', fontWeight: 600, color: t.gold }}>{p.application_id}</div>
                    <div style={{ fontSize: '.68rem', color: t.text3, marginTop: '2px' }}>{fmtDate(p.purchase_date)} · {fmtTime(p.transaction_time)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <span style={{ fontSize: '.6rem', padding: '2px 8px', borderRadius: '100px', background: `${status.color}20`, color: status.color, border: `1px solid ${status.color}40` }}>{status.label}</span>
                    <span style={{ fontSize: '.6rem', padding: '2px 8px', borderRadius: '100px', background: p.transaction_type === 'TAKEOVER' ? `${t.purple}20` : `${t.gold}20`, color: p.transaction_type === 'TAKEOVER' ? t.purple : t.gold, border: `1px solid ${p.transaction_type === 'TAKEOVER' ? t.purple : t.gold}40` }}>{p.transaction_type}</span>
                  </div>
                </div>
                <div style={{ fontSize: '.75rem', color: t.text1, marginBottom: '4px' }}>{p.customer_name}</div>
                <div style={{ fontSize: '.68rem', color: t.text3, marginBottom: '10px' }}>{p.branch_name}{p.phone_number ? ` · ${p.phone_number}` : ''}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '.68rem' }}>
                  <div>
                    <div style={{ color: t.text4, fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em' }}>Net Wt</div>
                    <div style={{ color: t.text1, fontWeight: 500 }}>{p.net_weight}g</div>
                  </div>
                  <div>
                    <div style={{ color: t.text4, fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em' }}>Purity</div>
                    <div style={{ color: t.text2 }}>{p.purity}%</div>
                  </div>
                  <div>
                    <div style={{ color: t.text4, fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em' }}>Final Amt</div>
                    <div style={{ color: t.green, fontWeight: 600 }}>₹{fmt(p.final_amount_crm)}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
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
                {[
                  { label: 'App ID',    col: 'application_id' },
                  { label: 'Date',      col: 'purchase_date' },
                  { label: 'Time',      col: 'transaction_time' },
                  { label: 'Customer',  col: 'customer_name' },
                  { label: 'Phone',     col: null },
                  { label: 'Branch',    col: 'branch_name' },
                  { label: 'Gross Wt',  col: 'gross_weight' },
                  { label: 'Stone',     col: null },
                  { label: 'Wastage',   col: null },
                  { label: 'Net Wt',    col: 'net_weight' },
                  { label: 'Purity',    col: 'purity' },
                  { label: 'Gross Amt', col: 'total_amount' },
                  { label: 'Svc%',      col: null },
                  { label: 'Svc Amt',   col: null },
                  { label: 'Final Amt', col: 'final_amount_crm' },
                  { label: 'Type',      col: 'transaction_type' },
                  { label: 'Status',               col: 'stock_status' },
                  { label: 'ID Type',              col: 'id_proof_types' },
                  { label: 'ID Number',            col: 'id_proof_numbers' },
                  { label: 'Bank',                 col: 'bank_name' },
                  { label: 'Payment Ref',          col: 'payment_reference' },
                  { label: 'In Consignment Since', col: 'dispatched_at' },
                  { label: 'Received At HO',       col: 'received_at' },
                  { label: 'CRM',                  col: 'crm_status' },
                  { label: 'Booking',              col: 'booking_id' },
                  { label: 'Booking Date',         col: 'booked_at' },
                ].map(({ label, col }) => (
                  <th key={label}
                    onClick={col ? () => handleSort(col) : undefined}
                    style={{ ...s.th, cursor: col ? 'pointer' : 'default', userSelect: 'none' }}
                    onMouseEnter={col ? e => { e.currentTarget.style.color = t.gold } : undefined}
                    onMouseLeave={col ? e => { e.currentTarget.style.color = t.text3 } : undefined}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {label}
                      {col && (
                        <span style={{ opacity: sortCol === col ? 1 : 0.3, fontSize: '.55rem', lineHeight: 1 }}>
                          {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const status     = STATUS_COLORS[p.stock_status] || { color: t.text3, label: p.stock_status }
                const isSelected = selectedIds.has(p.id)
                const isHovered  = hoveredId === p.id
                return (
                  <tr key={p.id}
                    onMouseEnter={() => setHoveredId(p.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                    background: isSelected ? `${t.gold}12` : isHovered ? `${t.text1}08` : 'transparent',
                    outline: isSelected ? `1px solid ${t.gold}30` : 'none',
                    transition: 'background .12s',
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
                    <td style={s.td}>
                      <Badge label={p.transaction_type} color={p.transaction_type === 'TAKEOVER' ? 'purple' : 'gold'} />
                    </td>
                    <td style={s.td}>
                      <Badge
                        label={status.label}
                        color={
                          p.stock_status === 'at_ho' ? 'green' :
                          p.stock_status === 'at_branch' ? 'blue' :
                          p.stock_status === 'in_consignment' ? 'orange' :
                          p.stock_status === 'sent_for_melting' ? 'red' :
                          p.stock_status === 'melted' ? 'purple' : 'dim'
                        }
                      />
                    </td>
                    <td style={{ ...s.td, color: t.text3, fontSize: '.68rem', whiteSpace: 'normal', maxWidth: '160px' }}>{p.id_proof_types || <span style={{ color: t.text4 }}>—</span>}</td>
                    <td style={{ ...s.td, color: t.text2, fontFamily: 'monospace', fontSize: '.68rem', whiteSpace: 'normal', maxWidth: '200px', wordBreak: 'break-all' }}>{p.id_proof_numbers || <span style={{ color: t.text4 }}>—</span>}</td>
                    <td style={{ ...s.td, color: t.text2 }}>{p.bank_name || <span style={{ color: t.text4 }}>—</span>}</td>
                    <td style={{ ...s.td, color: t.text2, fontFamily: 'monospace', fontSize: '.68rem' }}>{p.payment_reference || <span style={{ color: t.text4 }}>—</span>}</td>
                    {/* purchases.dispatched_at — stamped at consignment approval, the
                        moment this bill transitioned at_branch → in_consignment.
                        Cleared when the consignment is cancelled and the bill
                        returns to at_branch. */}
                    <td style={{ ...s.td, color: p.dispatched_at ? t.text2 : t.text4, fontSize: '.68rem', whiteSpace: 'nowrap' }}>
                      {fmtDispatched(p.dispatched_at)}
                    </td>
                    {/* purchases.received_at — stamped on consignment receive at HO,
                        the moment this bill transitioned in_consignment → at_ho.
                        Cleared if the consignment is later cancelled. */}
                    <td style={{ ...s.td, color: p.received_at ? t.text2 : t.text4, fontSize: '.68rem', whiteSpace: 'nowrap' }}>
                      {fmtDispatched(p.received_at)}
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: '4px', flexDirection: 'column' }}>
                        {(() => {
                          const cs = CRM_STATUS[p.crm_status?.toLowerCase()] || { label: p.crm_status || 'approved', color: 'green' }
                          return <Badge label={cs.label} color={cs.color} />
                        })()}
                        {p.crm_source === 'new_crm' && <Badge label="NEW CRM" color="purple" />}
                        {bothCrmIds.has(p.application_id) && <Badge label="Both CRMs" color="gold" />}
                      </div>
                    </td>
                    {/* Booking status — a bill counts as "booked" when either:
                        - it's linked to a cal_quotas booking (purchases.booking_id), OR
                        - the EOD audit attributed it to gain (audit_consumed_at).
                        Both states mean "accounted for, not eligible for bidding".
                        Tooltip distinguishes the source. */}
                    <td style={s.td}>
                      {p.booking_id ? (
                        <span title={`Linked to a customer booking (booking_id: ${p.booking_id})`}>
                          <Badge label="Booked" color="blue" />
                        </span>
                      ) : p.audit_consumed_at ? (
                        <span title={`Audit-consumed on ${fmtDate(p.audit_consumed_at)} — attributed to ${p.audit_attributed_to || 'gain'}`}>
                          <Badge label="Booked" color="blue" />
                        </span>
                      ) : (
                        <span style={{ color: t.text4 }}>—</span>
                      )}
                    </td>
                    {/* purchases.booked_at — stamped when the bill was
                        attached to a cal_quotas booking. Blank for unbooked
                        bills (and for gain-attributed ones, which have no
                        booking row). */}
                    <td style={{ ...s.td, color: p.booked_at ? t.text2 : t.text4, fontSize: '.68rem', whiteSpace: 'nowrap' }}>
                      {fmtDispatched(p.booked_at)}
                    </td>
                  </tr>
                )
              })}
              {purchases.length === 0 && (
                <tr><td colSpan={isSuperAdmin ? 27 : 26} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                  {(search || filterStatus || filterBranch || filterCrmStatus || filterTxn || fromDate || toDate || dispatchedFrom || dispatchedTo) ? 'No records match your filters' : 'No purchase data yet. Syncing from CRM in the background.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      </div>
      )}
    </div>
  )
}