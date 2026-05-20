'use client'

// ConsignmentReport — in-transit per-branch overview.
// Visual structure mirrors ConsignmentOverview (the "Branch Stock Overview"
// module) — region flashcards + 8-tile KPI strip + search/filter chips +
// grouped or flat sortable table. The only difference is the data source:
// branch_stock_summary RPC called with status=in_consignment (so each row's
// totals reflect bills currently IN FLIGHT, not bills sitting at_branch).
// Bangalore branches are included — the RPC's time-of-day lifecycle takes
// them into and out of in_consignment automatically (19:30 IST → midnight).
//
// At Branch mode used to live here; it has been removed since the
// Branch Stock Overview module already covers it. This page is purely
// the in-transit report now.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp, useRegionAccess } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, REGION_COLORS, useMobile } from '../../lib/consignmentTheme'
import { istToday } from '../../lib/dateIst'

const REGION_ICONS = {
  'Rest of Karnataka': '🏛',
  'Andhra Pradesh':    '🌊',
  'Telangana':         '🌆',
  'Kerala':            '🌴',
  'Bangalore':         '🏙',
}

// Display order for the per-region flash cards. Matches Branch Stock Overview
// with Bangalore appended (it shows up here when the time-of-day lifecycle
// puts today's approved Bangalore bills in flight).
const REGION_ORDER = ['Rest of Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Bangalore']

const fmt     = (n, d = 3) => n != null ? Number(n).toFixed(d) : '—'
const fmtNum  = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtINR  = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[+m - 1]}`
}

function AgeBadge({ days, t }) {
  if (!days && days !== 0) return <span style={{ color: t.text4 }}>—</span>
  const color = days > 7 ? t.red : days > 3 ? t.orange : t.green
  return (
    <span style={{ fontSize: '11px', color, background: `${color}18`, borderRadius: '5px', padding: '2px 8px', fontWeight: 700 }}>
      {days}d
    </span>
  )
}

export default function ConsignmentReport() {
  const { theme } = useApp()
  const regionAccess = useRegionAccess()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const [data,         setData]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [activeRegion, setActiveRegion] = useState(null)
  // Default sort: total net weight desc (largest in-flight exposures first).
  const [sortKey,      setSortKey]      = useState('total_net_wt')
  const [sortDir,      setSortDir]      = useState(-1)
  const [quickFilter,  setQuickFilter]  = useState('all')
  const [lastRefresh,  setLastRefresh]  = useState(null)
  const [tick,         setTick]         = useState(0)
  const [toast,        setToast]        = useState(null)
  // 'branch' (per-branch rollup of in-transit stock, the original view) vs
  // 'case' (bill-level rows from purchases.stock_status='in_consignment',
  // filterable by when each bill went into transit). Choice is persisted per
  // device. Old 'grouped'/'flat' values (from the previous flat-only vs
  // collapsible-regions toggle) migrate to 'branch' — the branch-wise table
  // is flat-only now.
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'branch'
    const v = window.localStorage.getItem('cnsrpt.viewMode')
    if (v === 'case') return 'case'
    return 'branch'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('cnsrpt.viewMode', viewMode)
  }, [viewMode])
  const [collapsedRegions, setCollapsedRegions] = useState(() => new Set())
  // Track new-arrival rows for the pulse animation — branches whose today_bills
  // count rose since the last poll flash briefly so the operator notices
  // without having to scan every row.
  const [recentlyChanged, setRecentlyChanged] = useState(() => new Set())
  const prevTodayRef = useRef(new Map())

  // Case-wise view — bill-level rows from purchases (stock_status='in_consignment').
  // Loaded lazily the first time the user switches to 'case' mode so the
  // branch-wise rollup doesn't pay for 1000s of unused rows.
  const [caseData,       setCaseData]       = useState([])
  const [caseLoading,    setCaseLoading]    = useState(false)
  const [caseLoaded,     setCaseLoaded]     = useState(false)
  // "Consignment since" date filter — applied client-side to purchases.dispatched_at
  // (the moment a bill transitioned at_branch → in_consignment). Default: all.
  const [caseSinceQuick, setCaseSinceQuick] = useState('all')
  const [caseSinceFrom,  setCaseSinceFrom]  = useState('')
  const [caseSinceTo,    setCaseSinceTo]    = useState('')
  const [caseSortKey,    setCaseSortKey]    = useState('dispatched_at')
  const [caseSortDir,    setCaseSortDir]    = useState(-1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Same RPC the dashboard's Consignment Overview reads — branch-level
      // roll-up for status=in_consignment. include_bangalore=true so the
      // 19:30+ IST Bangalore lifecycle window appears here too.
      const res  = await authedFetch('/api/consignments?action=branch_overview&status=in_consignment&include_bangalore=true')
      const json = await res.json()
      const next = json.data || []
      // Detect branches whose today_bills count rose since the last poll —
      // flash them briefly. undefined sentinel so first load doesn't light
      // every branch and a 0 → 1 transition still pulses.
      const prev = prevTodayRef.current
      const isFirstLoad = prev.size === 0
      const justChanged = new Set()
      for (const row of next) {
        const before = prev.get(row.branch_name)
        const now = row.today_bills || 0
        if (!isFirstLoad && before != null && now > before) {
          justChanged.add(row.branch_name)
        }
        prev.set(row.branch_name, now)
      }
      if (justChanged.size) {
        setRecentlyChanged(justChanged)
        setTimeout(() => setRecentlyChanged(new Set()), 6000)
      }
      setData(next)
      setLastRefresh(new Date())
    } catch (e) {
      setToast({ msg: e.message || 'Load failed', type: 'error' })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 3 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Bill-level fetch — populates the case-wise view. Same endpoint Consignment
  // Data uses; we ask for it on the first switch to 'case' and refresh from
  // the Refresh button thereafter.
  const fetchCaseData = useCallback(async () => {
    setCaseLoading(true)
    try {
      const res  = await authedFetch('/api/consignments?action=in_transit_stock')
      const json = await res.json()
      setCaseData(json.data || [])
      setCaseLoaded(true)
      setLastRefresh(new Date())
    } catch (e) {
      setToast({ msg: e.message || 'Load failed', type: 'error' })
    }
    setCaseLoading(false)
  }, [])

  useEffect(() => {
    if (viewMode === 'case' && !caseLoaded) fetchCaseData()
  }, [viewMode, caseLoaded, fetchCaseData])

  // Live "X min ago" clock
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const minsAgo = lastRefresh ? Math.floor((Date.now() - lastRefresh.getTime()) / 60000) : null

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(-1) }
  }

  // CSV export of the current (filtered + sorted) view.
  function exportCsv(rows) {
    const csvEscape = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = [
      'Branch','Region','Total Net Wt (g)',
      "Today's Bills","Today's Net Wt (g)","Today's Value (₹)",
      'In-Flight Bills','In-Flight Net Wt (g)','In-Flight Value (₹)',
      'Oldest Bill (days)','Oldest Bill Date','Total Gross Wt (g)',
    ]
    const lines = [headers.map(csvEscape).join(',')]
    for (const b of rows) {
      const totalNet = (Number(b.today_net_wt || 0) + Number(b.older_net_wt || 0)).toFixed(3)
      lines.push([
        b.branch_name, b.region, totalNet,
        b.today_bills || 0, Number(b.today_net_wt || 0).toFixed(3), Number(b.today_gross_value || 0).toFixed(2),
        b.older_bills || 0, Number(b.older_net_wt || 0).toFixed(3), Number(b.older_gross_value || 0).toFixed(2),
        b.oldest_age_days != null ? b.oldest_age_days : '', b.oldest_date || '',
        Number(b.total_gross_wt || 0).toFixed(3),
      ].map(csvEscape).join(','))
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `consignment-in-transit_${istToday()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Region summary ────────────────────────────────────────────────────────
  const allRegions = [...new Set(data.map(b => b.region).filter(Boolean))]
  const regions = [
    ...REGION_ORDER.filter(r => allRegions.includes(r)),
    ...allRegions.filter(r => !REGION_ORDER.includes(r)).sort(),
  ]
  const regionStats = regions.reduce((acc, r) => {
    const bs = data.filter(b => b.region === r)
    const today_bills  = bs.reduce((s, b) => s + (b.today_bills   || 0), 0)
    const older_bills  = bs.reduce((s, b) => s + (b.older_bills   || 0), 0)
    const today_net_wt = bs.reduce((s, b) => s + (b.today_net_wt  || 0), 0)
    const older_net_wt = bs.reduce((s, b) => s + (b.older_net_wt  || 0), 0)
    acc[r] = {
      branches:     bs.length,
      active_branches: bs.filter(b => (b.today_bills || 0) + (b.older_bills || 0) > 0).length,
      today_bills, older_bills, today_net_wt, older_net_wt,
      total_bills:  today_bills + older_bills,
      total_net_wt: today_net_wt + older_net_wt,
      gross_wt:     bs.reduce((s, b) => s + (b.total_gross_wt || 0), 0),
    }
    return acc
  }, {})

  // Always display weights in grams (no kg conversion). Comma-grouped.
  const fmtWtCard = (g) => ({
    value: Math.round(Number(g || 0)).toLocaleString('en-IN'),
    unit: 'g',
  })

  // ── Filtered + sorted ─────────────────────────────────────────────────────
  const searchQ = (search || '').toLowerCase()
  const filtered = data
    // Hide branches with zero in-flight stock — keeps the table focused.
    .filter(b => ((b.today_net_wt || 0) + (b.older_net_wt || 0)) > 0)
    .filter(b => !activeRegion || b.region === activeRegion)
    .filter(b => !searchQ || (b.branch_name || '').toLowerCase().includes(searchQ) || (b.region || '').toLowerCase().includes(searchQ))
    .filter(b => {
      // Quick-filter chips — operations questions, not data dimensions.
      const age = b.oldest_age_days || 0
      switch (quickFilter) {
        case 'overdue':       return age > 7
        case 'watch':         return age > 3 && age <= 7
        case 'today_active':  return (b.today_bills || 0) > 0
        case 'all':
        default:              return true
      }
    })
    .slice()
    .sort((a, b) => {
      let av = 0, bv = 0
      if (sortKey === 'branch_name')        { av = a.branch_name || ''; bv = b.branch_name || ''; return av.localeCompare(bv) * sortDir }
      if (sortKey === 'today_bills')        { av = a.today_bills  || 0; bv = b.today_bills  || 0 }
      if (sortKey === 'today_net_wt')       { av = a.today_net_wt || 0; bv = b.today_net_wt || 0 }
      if (sortKey === 'today_gross_value')  { av = a.today_gross_value || 0; bv = b.today_gross_value || 0 }
      if (sortKey === 'older_bills')        { av = a.older_bills  || 0; bv = b.older_bills  || 0 }
      if (sortKey === 'older_net_wt')       { av = a.older_net_wt || 0; bv = b.older_net_wt || 0 }
      if (sortKey === 'older_gross_value')  { av = a.older_gross_value || 0; bv = b.older_gross_value || 0 }
      if (sortKey === 'oldest_age')         { av = a.oldest_age_days || 0; bv = b.oldest_age_days || 0 }
      if (sortKey === 'total_net_wt')       { av = (a.today_net_wt || 0) + (a.older_net_wt || 0); bv = (b.today_net_wt || 0) + (b.older_net_wt || 0) }
      if (sortKey === 'total_bills')        { av = (a.today_bills  || 0) + (a.older_bills  || 0); bv = (b.today_bills  || 0) + (b.older_bills  || 0) }
      return (av - bv) * sortDir
    })

  // ── Case-wise filtering + sorting ──────────────────────────────────────────
  // Resolve the active "consignment since" window. Quick chips set a relative
  // range; the date inputs flip to 'custom' and use caseSinceFrom/To verbatim.
  // todayIst() returns YYYY-MM-DD in IST so this matches the branch's day.
  const caseSinceRange = (() => {
    if (caseSinceQuick === 'custom') return { from: caseSinceFrom || null, to: caseSinceTo || null }
    const today = istToday()                                     // YYYY-MM-DD (IST)
    if (caseSinceQuick === 'today')     return { from: today, to: today }
    if (caseSinceQuick === 'yesterday') {
      const d = new Date(today); d.setDate(d.getDate() - 1)
      const y = d.toISOString().slice(0, 10)
      return { from: y, to: y }
    }
    if (caseSinceQuick === 'last7') {
      const d = new Date(today); d.setDate(d.getDate() - 6)
      return { from: d.toISOString().slice(0, 10), to: today }
    }
    return { from: null, to: null }                              // 'all'
  })()

  // Map branch_name → region using the branch_overview rollup we already
  // loaded for the branch-wise view. Lets the region flashcards filter
  // case-wise rows too without a second branches lookup.
  const branchToRegion = data.reduce((acc, b) => { acc[b.branch_name] = b.region; return acc }, {})

  const filteredCaseRows = caseData
    .filter(r => {
      // Date filter on dispatched_at (the bill's at_branch → in_consignment
      // transition timestamp). Compare against the IST calendar day so the
      // 19:30 cutover for Bangalore doesn't bleed into yesterday.
      if (caseSinceRange.from || caseSinceRange.to) {
        if (!r.dispatched_at) return false
        const day = new Date(r.dispatched_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        if (caseSinceRange.from && day < caseSinceRange.from) return false
        if (caseSinceRange.to   && day > caseSinceRange.to)   return false
      }
      // Region chip filters by source branch's region.
      if (activeRegion && branchToRegion[r.branch_name] !== activeRegion) return false
      // Search across application_id / customer / branch.
      if (searchQ) {
        const hay = `${r.application_id || ''} ${r.customer_name || ''} ${r.branch_name || ''}`.toLowerCase()
        if (!hay.includes(searchQ)) return false
      }
      return true
    })
    .slice()
    .sort((a, b) => {
      const dir = caseSortDir
      const av = a?.[caseSortKey]
      const bv = b?.[caseSortKey]
      if (av == null && bv == null) return 0
      if (av == null) return  1 * dir          // nulls land last desc, first asc — feels right for ops
      if (bv == null) return -1 * dir
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })

  function handleCaseSort(key) {
    if (caseSortKey === key) setCaseSortDir(d => d * -1)
    else { setCaseSortKey(key); setCaseSortDir(-1) }
  }

  function exportCaseCsv(rows) {
    const csvEscape = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const cols = [
      ['application_id',            'Application ID'],
      ['purchase_date',             'Purchase Date'],
      ['customer_name',             'Customer'],
      ['branch_name',               'Branch'],
      ['gross_weight',              'Gross Wt (g)'],
      ['stone_weight',              'Stone (g)'],
      ['wastage',                   'Wastage (g)'],
      ['net_weight',                'Net Wt (g)'],
      ['total_amount',              'Gross Amt'],
      ['service_charge_pct',        'Svc %'],
      ['service_charge_amount_crm', 'Svc Amt'],
      ['final_amount_crm',          'Final Amt'],
      ['transaction_type',          'Type'],
      ['dispatched_at',             'Consignment Created On'],
    ]
    const lines = [cols.map(([, l]) => csvEscape(l)).join(',')]
    for (const r of rows) {
      lines.push(cols.map(([k]) => {
        if (k === 'dispatched_at') return r[k] ? new Date(r[k]).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : ''
        return csvEscape(r[k])
      }).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `consignment-bills_${istToday()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Group filtered rows by region for the collapsible card view.
  const groupedByRegion = regions
    .map(r => ({ region: r, branches: filtered.filter(b => b.region === r) }))
    .filter(g => g.branches.length > 0)

  function toggleRegionCollapsed(r) {
    setCollapsedRegions(prev => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r)
      else             next.add(r)
      return next
    })
  }

  // ── Grand totals (over filtered rows) ─────────────────────────────────────
  const grandToday    = filtered.reduce((s, b) => s + (b.today_bills        || 0), 0)
  const grandTodayWt  = filtered.reduce((s, b) => s + (b.today_net_wt       || 0), 0)
  const grandTodayVal = filtered.reduce((s, b) => s + (b.today_gross_value  || 0), 0)
  const grandOlder    = filtered.reduce((s, b) => s + (b.older_bills        || 0), 0)
  const grandOlderWt  = filtered.reduce((s, b) => s + (b.older_net_wt       || 0), 0)
  const grandOlderVal = filtered.reduce((s, b) => s + (b.older_gross_value  || 0), 0)
  const grandGrossWt  = filtered.reduce((s, b) => s + (b.total_gross_wt     || 0), 0)

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span style={{ color: t.text4, fontSize: '10px', marginLeft: '4px' }}>⇅</span>
    return <span style={{ color: t.gold, fontSize: '10px', marginLeft: '4px' }}>{sortDir === -1 ? '↓' : '↑'}</span>
  }

  // Shared table cell padding. Headers and body cells use the SAME horizontal
  // padding so column content lines up edge-to-edge — earlier the 9px/10px
  // vertical mismatch combined with default verticalAlign read as misaligned.
  const thBase = {
    padding: '10px 12px', fontSize: '10px', color: t.text4,
    letterSpacing: '.06em', textTransform: 'uppercase',
    background: t.card2, borderBottom: `1px solid ${t.border}`,
    whiteSpace: 'nowrap', fontWeight: 600, userSelect: 'none',
    verticalAlign: 'middle',
  }
  const tdPad = '10px 12px'

  // ── Region card stats — driven by the active view ──────────────────────────
  // Branch-wise: per-branch rollup (unchanged). Case-wise: aggregate over the
  // currently-filtered bill rows so the "Consignment created on" date filter
  // also drives the headline cards (otherwise the cards lie when the table is
  // filtered to today / yesterday / a custom range).
  const regionStatsView = viewMode === 'case'
    ? regions.reduce((acc, r) => {
        const rows         = filteredCaseRows.filter(row => branchToRegion[row.branch_name] === r)
        const branchNames  = new Set(rows.map(row => row.branch_name))
        const totalBranches = data.filter(b => b.region === r).length
        acc[r] = {
          branches:        totalBranches,
          active_branches: branchNames.size,
          total_bills:     rows.length,
          total_net_wt:    rows.reduce((s, row) => s + Number(row.net_weight || 0), 0),
          today_bills:     0,  // 'today' is no longer a separate axis once the date filter takes over
        }
        return acc
      }, {})
    : regionStats

  const allStatsView = viewMode === 'case'
    ? {
        allBills:       filteredCaseRows.length,
        allNetWt:       filteredCaseRows.reduce((s, r) => s + Number(r.net_weight || 0), 0),
        allTodayBills:  0,
        activeBranches: new Set(filteredCaseRows.map(r => r.branch_name)).size,
        totalBranches:  data.length,
      }
    : {
        allBills:       data.reduce((s, b) => s + (b.today_bills || 0) + (b.older_bills || 0), 0),
        allNetWt:       data.reduce((s, b) => s + (b.today_net_wt || 0) + (b.older_net_wt || 0), 0),
        allTodayBills:  data.reduce((s, b) => s + (b.today_bills || 0), 0),
        activeBranches: data.filter(b => ((b.today_net_wt || 0) + (b.older_net_wt || 0)) > 0).length,
        totalBranches:  data.length,
      }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Consignment Report</div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: t.blue, background: `${t.blue}15`, borderRadius: '20px', padding: '3px 10px', fontWeight: 600 }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.blue, display: 'inline-block', animation: 'pulse 2s infinite' }} />
              IN TRANSIT
            </span>
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            Bills currently in flight · branch-level roll-up
            {lastRefresh && (
              <span style={{ color: minsAgo === 0 ? t.green : t.text4, marginLeft: '6px' }}>
                · {minsAgo === 0 ? 'just refreshed' : `${minsAgo}m ago`} · {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* View-mode segmented toggle */}
          <div style={{ display: 'inline-flex', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '2px' }}>
            {[
              { key: 'branch', label: 'Branch-wise', icon: '⬡' },
              { key: 'case',   label: 'Case-wise',   icon: '☰' },
            ].map(v => {
              const active = viewMode === v.key
              return (
                <button key={v.key} onClick={() => setViewMode(v.key)}
                  title={v.key === 'branch' ? 'Per-branch rollup of all bills currently in transit' : 'Bill-level rows, filterable by when each bill went into transit'}
                  style={{
                    background: active ? `${t.gold}20` : 'transparent',
                    color: active ? t.gold : t.text3,
                    border: 'none', borderRadius: '6px',
                    padding: '5px 11px', fontSize: '11px', fontWeight: 600,
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px',
                    transition: 'all .12s',
                  }}>
                  <span style={{ fontSize: '12px' }}>{v.icon}</span>{v.label}
                </button>
              )
            })}
          </div>
          {(activeRegion || search) && (
            <button onClick={() => { setActiveRegion(null); setSearch('') }}
              style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 13px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
              Clear
            </button>
          )}
          <button
            onClick={() => (viewMode === 'case' ? fetchCaseData() : fetchData())}
            disabled={viewMode === 'case' ? caseLoading : loading}
            style={{ background: (viewMode === 'case' ? caseLoading : loading) ? t.card2 : `${t.gold}15`, border: `1px solid ${(viewMode === 'case' ? caseLoading : loading) ? t.border : t.gold}40`, borderRadius: '8px', padding: '7px 16px', fontSize: '12px', color: (viewMode === 'case' ? caseLoading : loading) ? t.text4 : t.gold, cursor: (viewMode === 'case' ? caseLoading : loading) ? 'default' : 'pointer', fontWeight: 600, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', animation: (viewMode === 'case' ? caseLoading : loading) ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
            {(viewMode === 'case' ? caseLoading : loading) ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Region Flashcards ── */}
      {!regionAccess.single && (
        <div style={{
          display: 'flex', gap: '10px',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          overflowX: isMobile ? 'auto' : 'visible',
          scrollSnapType: isMobile ? 'x mandatory' : 'none',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          margin: isMobile ? '0 -16px' : 0,
          padding: isMobile ? '0 16px 4px' : 0,
        }}>

          {/* All Regions card — hidden for region-restricted users */}
          {!regionAccess.restricted && (() => {
            const { allBills, allNetWt, allTodayBills, activeBranches, totalBranches } = allStatsView
            const w = fmtWtCard(allNetWt)
            const isActive = !activeRegion
            return (
              <div onClick={() => setActiveRegion(null)}
                style={{
                  background: isActive ? `linear-gradient(145deg, ${t.gold}18, ${t.gold}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                  border: `1px solid ${isActive ? t.gold + '60' : t.border}`,
                  borderLeft: `4px solid ${isActive ? t.gold : t.text4 + '30'}`,
                  borderRadius: '12px', padding: '16px 18px',
                  cursor: 'pointer', minWidth: '180px',
                  flexShrink: 0, scrollSnapAlign: 'start',
                  transition: 'all .2s',
                  boxShadow: isActive ? `0 4px 16px ${t.gold}20` : '0 1px 3px rgba(0,0,0,.2)',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '9px', color: isActive ? t.gold : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>All Regions</div>
                  <span style={{ fontSize: '15px', opacity: isActive ? 1 : 0.5 }}>🌐</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                  <span style={{ fontSize: '26px', fontWeight: 300, color: isActive ? t.gold : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: isActive ? t.gold : t.text3 }}>{w.unit}</span>
                </div>
                <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span title={`${activeBranches} of ${totalBranches} branches currently have bills in flight`}>
                    <strong style={{ color: t.text2 }}>{activeBranches}</strong>/{totalBranches} branches
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{allBills}</strong> bills</span>
                  {allTodayBills > 0 && <><span style={{ color: t.border2 }}>·</span><span style={{ color: t.green, fontWeight: 600 }}>+{allTodayBills} today</span></>}
                </div>
              </div>
            )
          })()}

          {regions.map(r => {
            const stats  = regionStatsView[r] || {}
            const color  = REGION_COLORS[r] || t.text3
            const icon   = REGION_ICONS[r] || '📍'
            const active = activeRegion === r
            const w      = fmtWtCard(stats.total_net_wt)
            return (
              <div key={r} onClick={() => setActiveRegion(active ? null : r)}
                style={{
                  background: active ? `linear-gradient(145deg, ${color}18, ${color}06)` : `linear-gradient(145deg, ${t.card}, ${t.card2})`,
                  border: `1px solid ${active ? color + '60' : t.border}`,
                  borderLeft: `4px solid ${active ? color : color + '30'}`,
                  borderRadius: '12px', padding: '16px 18px',
                  cursor: 'pointer', minWidth: '210px',
                  flexShrink: 0, scrollSnapAlign: 'start',
                  transition: 'all .2s',
                  boxShadow: active ? `0 4px 16px ${color}20` : '0 1px 3px rgba(0,0,0,.2)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.transform = 'translateY(0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '9px', color: active ? color : t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</div>
                  <span style={{ fontSize: '15px', opacity: active ? 1 : 0.6, flexShrink: 0, marginLeft: '6px' }}>{icon}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', lineHeight: 1, marginBottom: '6px' }}>
                  <span style={{ fontSize: '26px', fontWeight: 300, color: active ? color : t.text1, fontFamily: 'monospace' }}>{w.value}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: active ? color : t.text3 }}>{w.unit}</span>
                </div>
                <div style={{ fontSize: '10px', color: t.text4, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span title={`${stats.active_branches || 0} of ${stats.branches || 0} branches in this region currently have bills in flight`}>
                    <strong style={{ color: t.text2 }}>{stats.active_branches || 0}</strong>/{stats.branches || 0} branches
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{stats.total_bills || 0}</strong> bills</span>
                  {stats.today_bills > 0 && <><span style={{ color: t.border2 }}>·</span><span style={{ color: t.green, fontWeight: 600 }}>+{stats.today_bills} today</span></>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Search + quick filters + CSV export ── */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', maxWidth: isMobile ? '100%' : '260px', flex: 1, minWidth: isMobile ? '100%' : 'auto' }}>
          <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch or region…"
            style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px 8px 30px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
        </div>

        {/* Branch mode: operations age-based quick filters */}
        {viewMode === 'branch' && (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {[
              { key: 'all',          label: 'All',           color: t.text2  },
              { key: 'overdue',      label: 'Overdue >7d',   color: t.red    },
              { key: 'watch',        label: 'Watch 4-7d',    color: t.orange },
              { key: 'today_active', label: 'Active today',  color: t.blue   },
            ].map(q => {
              const active = quickFilter === q.key
              return (
                <button key={q.key}
                  onClick={() => setQuickFilter(q.key)}
                  style={{
                    padding: '6px 12px', borderRadius: '6px',
                    background: active ? `${q.color}18` : 'transparent',
                    border: `1px solid ${active ? `${q.color}80` : t.border2}`,
                    color: active ? q.color : t.text3,
                    fontSize: '11px', fontWeight: active ? 700 : 500, letterSpacing: '.02em',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    transition: 'all .12s',
                  }}>
                  {q.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Case mode: "consignment since" date filter — chips + custom range */}
        {viewMode === 'case' && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>Consignment created on</span>
            {[
              { key: 'all',       label: 'All' },
              { key: 'today',     label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'last7',     label: 'Last 7d' },
            ].map(q => {
              const active = caseSinceQuick === q.key
              return (
                <button key={q.key}
                  onClick={() => { setCaseSinceQuick(q.key); setCaseSinceFrom(''); setCaseSinceTo('') }}
                  style={{
                    padding: '5px 11px', borderRadius: '6px',
                    background: active ? `${t.blue}18` : 'transparent',
                    border: `1px solid ${active ? `${t.blue}80` : t.border2}`,
                    color: active ? t.blue : t.text3,
                    fontSize: '11px', fontWeight: active ? 700 : 500,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                  {q.label}
                </button>
              )
            })}
            <input type="date" value={caseSinceFrom}
              onChange={e => { setCaseSinceFrom(e.target.value); setCaseSinceQuick('custom') }}
              style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '6px', padding: '5px 7px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
            <span style={{ color: t.text4 }}>→</span>
            <input type="date" value={caseSinceTo}
              onChange={e => { setCaseSinceTo(e.target.value); setCaseSinceQuick('custom') }}
              style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '6px', padding: '5px 7px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
          </div>
        )}

        <div style={{ marginLeft: isMobile ? 0 : 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: t.text4 }}>
            {viewMode === 'case'
              ? `${filteredCaseRows.length} of ${caseData.length} bills`
              : `${filtered.length} of ${data.length}${isMobile ? ' · swipe' : ''}`}
          </span>
          {viewMode === 'branch' && (
            <button onClick={() => exportCsv(filtered)} title="Download the current view as CSV"
              style={{
                padding: '6px 12px', borderRadius: '6px',
                background: 'transparent', border: `1px solid ${t.border2}`,
                color: t.text2, fontSize: '11px', fontWeight: 600,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px',
              }}>
              ↓ CSV
            </button>
          )}
          {viewMode === 'case' && (
            <button onClick={() => exportCaseCsv(filteredCaseRows)} title="Download the current bill list as CSV"
              style={{
                padding: '6px 12px', borderRadius: '6px',
                background: 'transparent', border: `1px solid ${t.border2}`,
                color: t.text2, fontSize: '11px', fontWeight: 600,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px',
              }}>
              ↓ CSV
            </button>
          )}
        </div>
      </div>

      {/* ── Branch-wise table — per-branch rollup of bills in flight ── */}
      {viewMode === 'branch' && (
        <div style={{ ...card, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '80px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '80px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              {search || activeRegion ? 'No branches match your filter' : 'No bills currently in transit'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, cursor: 'pointer', color: sortKey === 'branch_name' ? t.gold : t.text4, paddingLeft: '7px', textAlign: 'left' }}
                        onClick={() => handleSort('branch_name')}>
                      Branch <SortIcon col="branch_name" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'total_bills' ? t.gold : t.text4 }}
                        onClick={() => handleSort('total_bills')}
                        title="Today's bills + older in-flight bills">
                      Total Bills <SortIcon col="total_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'total_net_wt' ? t.gold : t.text4 }}
                        onClick={() => handleSort('total_net_wt')}>
                      Total Net Wt <SortIcon col="total_net_wt" />
                    </th>

                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_bills' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_bills')}>
                      Today's Bills <SortIcon col="today_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_net_wt' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_net_wt')}>
                      Today's Net Wt <SortIcon col="today_net_wt" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'today_gross_value' ? t.blue : t.text4 }}
                        onClick={() => handleSort('today_gross_value')}>
                      Today's Value <SortIcon col="today_gross_value" />
                    </th>

                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_bills' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_bills')}>
                      In-Flight Bills <SortIcon col="older_bills" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_net_wt' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_net_wt')}>
                      In-Flight Net Wt <SortIcon col="older_net_wt" />
                    </th>
                    <th style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'older_gross_value' ? t.orange : t.text4 }}
                        onClick={() => handleSort('older_gross_value')}>
                      In-Flight Value <SortIcon col="older_gross_value" />
                    </th>

                    <th style={{ ...thBase, textAlign: 'center', cursor: 'pointer', color: sortKey === 'oldest_age' ? t.red : t.text4 }}
                        onClick={() => handleSort('oldest_age')}>
                      Oldest Bill <SortIcon col="oldest_age" />
                    </th>
                  </tr>

                  {/* Totals row pinned to the top inside <thead>. */}
                  <tr style={{ background: `${t.gold}14`, borderTop: `1px solid ${t.border}`, borderBottom: `2px solid ${t.gold}40` }}>
                    <td style={{ padding: '8px 8px 8px 7px', fontSize: '10px', color: t.text2, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: `${t.gold}14`, whiteSpace: 'nowrap' }}>
                      Σ Totals · {filtered.length}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {(grandToday + grandOlder) || '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '12px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {fmt(grandTodayWt + grandOlderWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandToday || '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '12px', color: t.blue, fontFamily: 'monospace', fontWeight: 600, background: `${t.gold}14` }}>
                      {fmt(grandTodayWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '11px', color: t.blue, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandTodayVal ? fmtINR(grandTodayVal) : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '13px', color: t.orange, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandOlder || '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '12px', color: t.orange, fontFamily: 'monospace', fontWeight: 600, background: `${t.gold}14` }}>
                      {fmt(grandOlderWt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: '11px', color: t.orange, fontFamily: 'monospace', fontWeight: 700, background: `${t.gold}14` }}>
                      {grandOlderVal ? fmtINR(grandOlderVal) : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', background: `${t.gold}14` }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => {
                    const rColor  = REGION_COLORS[b.region] || t.text3
                    const hasToday  = (b.today_bills  || 0) > 0
                    const hasPending = (b.older_bills || 0) > 0
                    const ageDays = b.oldest_age_days || 0
                    const urgentTier = ageDays > 7 ? 'overdue' : ageDays > 3 ? 'watch' : null
                    const urgentBg   = urgentTier === 'overdue' ? `${t.red}06`
                                     : urgentTier === 'watch'   ? `${t.orange}06`
                                     : 'transparent'
                    const stripeColor = urgentTier === 'overdue' ? t.red
                                      : urgentTier === 'watch'   ? t.orange
                                      : rColor
                    const glowColor = urgentTier === 'overdue' ? t.red
                                    : urgentTier === 'watch'   ? t.orange
                                    : t.gold
                    return (
                      <tr key={b.branch_name} className="cnsrpt-flat-row" style={{ borderBottom: `1px solid ${t.border}20`, background: urgentBg, ['--cnsrpt-glow']: glowColor, ['--cnsrpt-stripe']: stripeColor }}>
                        <td className="cnsrpt-branch-cell">
                          <div className="cnsrpt-branch-name" style={{ color: t.text1 }}>{b.branch_name}</div>
                          <div className="cnsrpt-branch-region" style={{ color: rColor }}>{b.region}</div>
                        </td>

                        {/* Total Bills */}
                        {(() => {
                          const totalBills = (b.today_bills || 0) + (b.older_bills || 0)
                          return (
                            <td style={{ padding: tdPad, textAlign: 'right' }}>
                              {totalBills
                                ? <span style={{ fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{totalBills}</span>
                                : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                            </td>
                          )
                        })()}

                        {/* Total Net Wt */}
                        {(() => {
                          const total = (b.today_net_wt || 0) + (b.older_net_wt || 0)
                          return (
                            <td style={{ padding: tdPad, textAlign: 'right' }}>
                              <span style={{ fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>
                                {fmt(total, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
                              </span>
                            </td>
                          )
                        })()}

                        {/* Today's Bills */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '13px', color: t.blue, fontFamily: 'monospace', fontWeight: 600 }}>{b.today_bills}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Today's Net Wt */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '13px', color: t.blue, fontFamily: 'monospace' }}>{fmt(b.today_net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Today's Value */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasToday
                            ? <span style={{ fontSize: '12px', color: t.blue, fontFamily: 'monospace' }}>{fmtINR(b.today_gross_value)}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* In-Flight Bills */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '14px', color: t.orange, fontFamily: 'monospace', fontWeight: 700 }}>{b.older_bills}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* In-Flight Net Wt */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '13px', color: t.orange, fontFamily: 'monospace' }}>{fmt(b.older_net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* In-Flight Value */}
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {hasPending
                            ? <span style={{ fontSize: '12px', color: t.orange, fontFamily: 'monospace' }}>{fmtINR(b.older_gross_value)}</span>
                            : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                        </td>

                        {/* Oldest Bill */}
                        <td style={{ padding: tdPad, textAlign: 'center' }}>
                          <AgeBadge days={b.oldest_age_days} t={t} />
                          {b.oldest_date && (
                            <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>{fmtDate(b.oldest_date)}</div>
                          )}
                        </td>

                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Case-wise table — bill-level rows for in-transit stock. Same column
          set the Purchase Data module exposes, filtered by when each bill went
          into transit (purchases.dispatched_at). Sortable; CSV-exportable. ── */}
      {viewMode === 'case' && (
        <div style={{ ...card, overflow: 'hidden' }}>
          {caseLoading && !caseLoaded ? (
            <div style={{ padding: '80px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
          ) : filteredCaseRows.length === 0 ? (
            <div style={{ padding: '80px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              {caseData.length === 0 ? 'No bills currently in transit' : 'No bills match your filter'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr>
                    {[
                      { k: 'application_id',            l: 'App ID',            a: 'left'  },
                      { k: 'purchase_date',             l: 'Purchase',          a: 'left'  },
                      { k: 'customer_name',             l: 'Customer',          a: 'left'  },
                      { k: 'branch_name',               l: 'Branch',            a: 'left'  },
                      { k: 'gross_weight',              l: 'Gross (g)',         a: 'right' },
                      { k: 'stone_weight',              l: 'Stone (g)',         a: 'right' },
                      { k: 'wastage',                   l: 'Wastage (g)',       a: 'right' },
                      { k: 'net_weight',                l: 'Net (g)',           a: 'right' },
                      { k: 'total_amount',              l: 'Gross Amt',         a: 'right' },
                      { k: 'service_charge_pct',        l: 'Svc %',             a: 'right' },
                      { k: 'service_charge_amount_crm', l: 'Svc Amt',           a: 'right' },
                      { k: 'final_amount_crm',          l: 'Final Amt',         a: 'right' },
                      { k: 'transaction_type',          l: 'Type',              a: 'left'  },
                      { k: 'dispatched_at',             l: 'Consignment Created On', a: 'left'  },
                    ].map(col => (
                      <th key={col.k}
                        onClick={() => handleCaseSort(col.k)}
                        style={{
                          ...thBase,
                          padding: '10px 12px',                            // match td exactly so header text and cell text line up
                          verticalAlign: 'middle',
                          cursor: 'pointer',
                          textAlign: col.a,
                          color: caseSortKey === col.k ? t.gold : t.text4,
                        }}>
                        {col.l}
                        <span style={{ color: caseSortKey === col.k ? t.gold : t.text4, fontSize: '10px', marginLeft: '4px' }}>
                          {caseSortKey === col.k ? (caseSortDir === -1 ? '↓' : '↑') : '⇅'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCaseRows.map((r, i) => {
                    // Shared baseline so every body cell has EXACTLY the same
                    // padding/alignment as the header. We dropped the
                    // .cnsrpt-row class here — its `position: relative` on a
                    // <tr> was non-standard and Chrome was inflating the row
                    // box, making cells visually shift relative to the header.
                    const tdL = { padding: tdPad, verticalAlign: 'middle', textAlign: 'left' }
                    const tdR = { padding: tdPad, verticalAlign: 'middle', textAlign: 'right', fontFamily: 'monospace' }
                    return (
                      <tr key={r.id || i} style={{ borderBottom: `1px solid ${t.border}25` }}>
                        <td style={{ ...tdL, color: t.gold, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.application_id || '—'}</td>
                        <td style={{ ...tdL, color: t.text2, whiteSpace: 'nowrap' }}>{r.purchase_date ? fmtDate(r.purchase_date) : '—'}</td>
                        <td style={{ ...tdL, color: t.text1 }}>{r.customer_name || '—'}</td>
                        <td style={{ ...tdL, color: t.text2, whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</td>
                        <td style={{ ...tdR, color: t.text2 }}>{r.gross_weight != null ? Number(r.gross_weight).toFixed(3) : '—'}</td>
                        <td style={{ ...tdR, color: t.text3 }}>{r.stone_weight != null ? Number(r.stone_weight).toFixed(3) : '—'}</td>
                        <td style={{ ...tdR, color: t.text3 }}>{r.wastage != null ? Number(r.wastage).toFixed(3) : '—'}</td>
                        <td style={{ ...tdR, color: t.gold, fontWeight: 600 }}>{r.net_weight != null ? Number(r.net_weight).toFixed(3) : '—'}</td>
                        <td style={{ ...tdR, color: t.text2 }}>{r.total_amount != null ? `₹${Math.round(r.total_amount).toLocaleString('en-IN')}` : '—'}</td>
                        <td style={{ ...tdR, color: t.text3 }}>{r.service_charge_pct != null ? `${Number(r.service_charge_pct).toFixed(2)}%` : '—'}</td>
                        <td style={{ ...tdR, color: t.text3 }}>{r.service_charge_amount_crm != null ? `₹${Math.round(r.service_charge_amount_crm).toLocaleString('en-IN')}` : '—'}</td>
                        <td style={{ ...tdR, color: t.green, fontWeight: 600 }}>{r.final_amount_crm != null ? `₹${Math.round(r.final_amount_crm).toLocaleString('en-IN')}` : '—'}</td>
                        <td style={tdL}>
                          {r.transaction_type ? (
                            <span style={{
                              fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                              background: r.transaction_type === 'TAKEOVER' ? `${t.purple}18` : `${t.gold}18`,
                              color:      r.transaction_type === 'TAKEOVER' ? t.purple : t.gold,
                              fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap',
                            }}>{r.transaction_type}</span>
                          ) : <span style={{ color: t.text4 }}>—</span>}
                        </td>
                        <td style={{ ...tdL, color: t.text2, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {r.dispatched_at
                            ? new Date(r.dispatched_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Footer note */}
      <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
        {viewMode === 'case'
          ? <>Case-wise = <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>purchases.stock_status = in_consignment</code> · &quot;Consignment created on&quot; filters by <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>dispatched_at</code> (IST)</>
          : <>In-Flight = <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>stock_status = in_consignment</code> before today · Age alert: &gt;3d orange, &gt;7d red</>}
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin  { to{transform:rotate(360deg)} }
        .cnsrpt-flat-row { transition: background .15s ease, box-shadow .25s ease; }
        .cnsrpt-flat-row:hover {
          background: color-mix(in srgb, var(--cnsrpt-glow) 6%, transparent) !important;
          box-shadow:
            inset 3px 0 0 var(--cnsrpt-glow),
            0 6px 18px color-mix(in srgb, var(--cnsrpt-glow) 18%, transparent);
        }
        .cnsrpt-branch-cell {
          padding: 10px 8px 10px 7px;
          box-shadow: inset 3px 0 0 var(--cnsrpt-stripe);
          vertical-align: middle;
        }
        .cnsrpt-branch-name { font-size: 13px; font-weight: 600; white-space: nowrap; }
        .cnsrpt-branch-region { font-size: 10px; margin-top: 1px; }
        @keyframes cnsrptShimmer {
          0%   { background-position: -120% 0 }
          100% { background-position: 220% 0 }
        }
        @keyframes cnsrptGlow {
          0%,100% { box-shadow: 0 0 0 1px transparent }
          50%     { box-shadow: 0 0 0 2px rgba(201,168,76,.35) }
        }
        .cnsrpt-row { position: relative; overflow: hidden; }
        .cnsrpt-row::before {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,.04) 50%, transparent 65%);
          background-size: 200% 100%;
          opacity: 0; pointer-events: none;
          transition: opacity .15s;
        }
        .cnsrpt-row:hover::before {
          opacity: 1;
          animation: cnsrptShimmer 1.2s ease-out 1;
        }
        .cnsrpt-row:hover { background: rgba(201,168,76,.04) !important; }
        .cnsrpt-row-fresh { animation: cnsrptGlow 2.4s ease-in-out 2; }
      `}</style>
    </div>
  )
}
