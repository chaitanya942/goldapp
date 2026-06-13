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

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useApp, useRegionAccess } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, REGION_COLORS, useMobile } from '../../lib/consignmentTheme'
import { istToday, addWorkingDaysSkipSunday, istDateStr } from '../../lib/dateIst'
import { getCache, setCache } from '../../lib/moduleCache'

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
  const { theme, branches } = useApp()
  const regionAccess = useRegionAccess()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const [loadError,    setLoadError]    = useState(null)
  const [search,       setSearch]       = useState('')
  // Multi-select region filter. Empty Set = "All regions" (no filter).
  // Clicking the "All regions" card clears the Set; clicking individual
  // region cards toggles them in/out of the Set. CSV + PNG exports honour
  // the same filter via filteredBranchRows / filteredCaseRows.
  const [activeRegions, setActiveRegions] = useState(() => new Set())
  const toggleRegion = (r) => setActiveRegions(prev => {
    const next = new Set(prev)
    if (next.has(r)) next.delete(r); else next.add(r)
    return next
  })
  const clearRegions = () => setActiveRegions(new Set())
  // Convenience flags for the old `activeRegion ? ...` patterns.
  const hasRegionFilter = activeRegions.size > 0
  // Default sort: total net weight desc (largest exposures first).
  const [sortKey,      setSortKey]      = useState('total_net_wt')
  const [sortDir,      setSortDir]      = useState(-1)
  const [lastRefresh,  setLastRefresh]  = useState(null)
  const [tick,         setTick]         = useState(0)
  const [toast,        setToast]        = useState(null)
  // 'branch' = per-branch rollup of the movements in the selected window
  // 'case'   = bill-level rows. Choice is persisted per device.
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'branch'
    const v = window.localStorage.getItem('cnsrpt.viewMode')
    if (v === 'case') return 'case'
    return 'branch'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('cnsrpt.viewMode', viewMode)
  }, [viewMode])
  // Movements data — every bill dispatched in the selected window, regardless
  // of its current stock_status (so received / melted bills still appear when
  // their dispatch date matches). Drives BOTH views.
  const [caseData,       setCaseData]       = useState([])
  const [caseLoading,    setCaseLoading]    = useState(true)
  const [caseLoaded,     setCaseLoaded]     = useState(false)
  // Date filter on purchases.dispatched_at — primary axis of this module.
  // Defaults to 'today' since that's the most common ops question
  // ("what moved today"). 'custom' uses caseSinceFrom/To verbatim.
  const [caseSinceQuick, setCaseSinceQuick] = useState('today')
  const [caseSinceFrom,  setCaseSinceFrom]  = useState('')
  const [caseSinceTo,    setCaseSinceTo]    = useState('')
  // Secondary filter on the DERIVED expected_delivery_date (dispatch +
  // working-day TAT). Client-side only — the server doesn't compute it.
  // Defaults to 'all' so it never narrows the view until ops opts in.
  const [expDelivQuick, setExpDelivQuick] = useState('all')
  const [expDelivFrom,  setExpDelivFrom]  = useState('')
  const [expDelivTo,    setExpDelivTo]    = useState('')
  const [caseSortKey,    setCaseSortKey]    = useState('consignment_created_at')
  const [caseSortDir,    setCaseSortDir]    = useState(-1)
  // Pagination — large filter results (e.g. "All" on 1000+ bills) become a
  // long scroll; cap visible at casePageSize and let ops page through.
  const [casePage,        setCasePage]      = useState(1)
  const [casePageSize,    setCasePageSize]  = useState(100)
  // Bill journey modal — opens when ops clicks an App ID; fetched lazily.
  // { purchase_id, application_id, loading, rows, error } | null
  const [journeyTarget,   setJourneyTarget] = useState(null)

  // Resolve the active date window. Quick chips set a relative range; the
  // date inputs flip to 'custom' and use caseSinceFrom/To verbatim. Defined
  // here (not below) so fetchMovements can use it as a dependency.
  const caseSinceRange = useMemo(() => {
    if (caseSinceQuick === 'custom') return { from: caseSinceFrom || null, to: caseSinceTo || null }
    const today = istToday()
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
    return { from: null, to: null }  // 'all'
  }, [caseSinceQuick, caseSinceFrom, caseSinceTo])

  // Expected-delivery window. Forward-looking presets (today / tomorrow /
  // next 7d) since the question here is "what's due to land when". 'all'
  // and 'custom' mirror the consignment-date filter.
  const expDelivRange = useMemo(() => {
    if (expDelivQuick === 'custom') return { from: expDelivFrom || null, to: expDelivTo || null }
    const today = istToday()
    if (expDelivQuick === 'today') return { from: today, to: today }
    if (expDelivQuick === 'tomorrow') {
      const d = new Date(today); d.setDate(d.getDate() + 1)
      const tm = d.toISOString().slice(0, 10)
      return { from: tm, to: tm }
    }
    if (expDelivQuick === 'next7') {
      const d = new Date(today); d.setDate(d.getDate() + 6)
      return { from: today, to: d.toISOString().slice(0, 10) }
    }
    return { from: null, to: null }  // 'all'
  }, [expDelivQuick, expDelivFrom, expDelivTo])

  // True when a row's expected_delivery_date falls inside the active
  // expected-delivery window. A row with no expected date is excluded only
  // when the filter is active (so 'all' keeps everything).
  const expDelivMatch = (expDate) => {
    if (!expDelivRange.from && !expDelivRange.to) return true
    if (!expDate) return false
    if (expDelivRange.from && expDate < expDelivRange.from) return false
    if (expDelivRange.to   && expDate > expDelivRange.to)   return false
    return true
  }

  // Fetch every bill dispatched in the selected window — drives both the
  // case-wise and branch-wise views. The API returns ALL dispatched bills in
  // the window (in transit / received / melted), not just currently-in-flight.
  const fetchMovements = useCallback(async (range, silent = false) => {
    if (!silent) setCaseLoading(true)
    try {
      const params = new URLSearchParams({ action: 'in_transit_stock' })
      if (range?.from) params.set('from', range.from)
      if (range?.to)   params.set('to',   range.to)
      const cacheKey = `cr:movements:${range?.from || ''}|${range?.to || ''}`
      const res  = await authedFetch(`/api/consignments?${params}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      const next = json.data || []
      setCache(cacheKey, next)
      setCaseData(next)
      setCaseLoaded(true)
      setLastRefresh(new Date())
      setLoadError(null)
    } catch (e) {
      console.error('[consignment-report] movements fetch failed:', e)
      setLoadError(e?.message || 'Load failed')
    }
    if (!silent) setCaseLoading(false)
  }, [])

  // Fetch whenever the date window changes; seed from cache for the new key
  // so the screen never blanks while the new range loads.
  useEffect(() => {
    const cacheKey = `cr:movements:${caseSinceRange.from || ''}|${caseSinceRange.to || ''}`
    const cached   = getCache(cacheKey)
    if (cached) { setCaseData(cached); setCaseLoaded(true) }
    fetchMovements(caseSinceRange, !!cached)
    // Backup poll every 3 min for the active window (silent — UI keeps the
    // current rows visible). Useful when ops sits on "today" — new dispatches
    // land within the poll interval.
    const interval = setInterval(() => fetchMovements(caseSinceRange, true), 3 * 60 * 1000)
    return () => clearInterval(interval)
  }, [caseSinceRange, fetchMovements])

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

  // CSV export of the current branch-wise view (one row per branch+date).
  function exportCsv(rows) {
    const csvEscape = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = [
      'Consignment Date', 'Branch', 'Region',
      'No of Bills', 'Gross (g)', 'Net (g)',
      'Amount', 'TAT (hours)', 'Expected Delivery Date',
    ]
    const lines = [headers.map(csvEscape).join(',')]
    for (const g of rows) {
      lines.push([
        g.consignment_date || '',
        g.branch_name || '',
        g.region || '',
        g.bills || 0,
        Number(g.gross_weight || 0).toFixed(2),
        Number(g.net_weight   || 0).toFixed(2),
        Number(g.total_amount || 0).toFixed(2),
        g.delivery_tat_hours || 24,
        g.expected_delivery_date || '',
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

  // Always display weights in grams (no kg conversion). Comma-grouped, 2-dp
  // so ops see sub-gram precision on the headline cards.
  const fmtWtCard = (g) => ({
    value: Number(g || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    unit: 'g',
  })

  // Pre-lowered search term — shared by all filter passes below.
  const searchQ = useMemo(() => (search || '').toLowerCase(), [search])

  // ── Region discovery. DYNAMIC: the base set is every region present in the
  //     active branches table (from context) — so Bangalore and any future
  //     region appear as permanent cards even on a day with zero dispatches,
  //     without hardcoding a list. Regions seen in the data are merged in too
  //     (defensive, in case a bill's region isn't in the branch map yet).
  //     Known regions sort by REGION_ORDER; unknown ones alphabetically.
  //     Region-restricted users only see their allowed set.
  const regions = useMemo(() => {
    const branchRegions = [...new Set(Object.values(branches || {}).map(b => b?.region).filter(Boolean))]
    const dataRegions   = [...new Set(caseData.map(b => b.region).filter(Boolean))]
    const all = [...new Set([...branchRegions, ...dataRegions])]
    const visible = regionAccess.restricted
      ? all.filter(r => regionAccess.regions.includes(r))
      : all
    return [
      ...REGION_ORDER.filter(r => visible.includes(r)),
      ...visible.filter(r => !REGION_ORDER.includes(r)).sort(),
    ]
  }, [branches, caseData, regionAccess.restricted, regionAccess.regions])

  // Map branch_name → region for callers that don't have the bill row handy
  // (kept for backwards compatibility with the case-row filter logic).
  const branchToRegion = useMemo(() =>
    caseData.reduce((acc, b) => { if (b.branch_name && b.region) acc[b.branch_name] = b.region; return acc }, {})
  , [caseData])

  // ── Branch-wise aggregated rows ────────────────────────────────────────────
  // The branch-wise view now groups in-transit bills by (branch, consignment
  // date) so ops can see at a glance "what UDUPI dispatched on 19 May" as a
  // single line item. Driven by caseData (same source the case-wise view uses)
  // so both tables stay in lockstep.
  //
  // Expected delivery: dispatched_at + 1 IST day. Branches across India share
  // a roughly next-day delivery to HO via BVC; refine later if pickup_time +
  // distance need to drive it per-branch.
  const branchAggregated = useMemo(() => {
    const groups = new Map()
    for (const r of caseData) {
      const branch = r.branch_name || '—'
      // Axis = the consignment's CREATION date (falls back to the bill's
      // dispatch date for any legacy row without a consignment link).
      const axisTs = r.consignment_created_at || r.dispatched_at
      const date = axisTs
        ? new Date(axisTs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        : null   // YYYY-MM-DD
      const key = `${date || '∅'}|${branch}`
      let g = groups.get(key)
      if (!g) {
        g = {
          key,
          consignment_date: date,
          branch_name:      branch,
          region:           branchToRegion[branch] || null,
          bills:            0,
          gross_weight:     0,
          stone_weight:     0,
          wastage:          0,
          net_weight:       0,
          total_amount:     0,
          svc_charge:       0,
        }
        groups.set(key, g)
      }
      g.bills        += 1
      g.gross_weight += Number(r.gross_weight || 0)
      g.stone_weight += Number(r.stone_weight || 0)
      g.wastage      += Number(r.wastage      || 0)
      g.net_weight   += Number(r.net_weight   || 0)
      g.total_amount += Number(r.total_amount || 0)
      g.svc_charge   += Number(r.service_charge_amount_crm || 0)
    }
    // Per-branch TAT lookup — pulled from the bill rows so we don't need a
    // separate /branches fetch. 24h-TAT branches deliver next IST day,
    // 48h-TAT branches the day after, etc. Default to 24h if the API
    // didn't return delivery_tat_hours (rare — usually means stale row).
    const tatByBranch = {}
    for (const r of caseData) {
      if (r.branch_name && r.delivery_tat_hours != null) {
        tatByBranch[r.branch_name] = Number(r.delivery_tat_hours)
      }
    }
    // Expected delivery — dispatch IST day + ceil(TAT_hours / 24) working
    // days, skipping Sundays (logistics partner is off Sundays). So a 48h-TAT
    // branch dispatching Saturday lands Tuesday, not Monday.
    for (const g of groups.values()) {
      if (!g.consignment_date) { g.expected_delivery_date = null; continue }
      const tatHours  = tatByBranch[g.branch_name] || 24
      const workDays  = Math.max(1, Math.ceil(tatHours / 24))
      g.expected_delivery_date = addWorkingDaysSkipSunday(g.consignment_date, workDays)
      g.delivery_tat_hours = tatHours   // surface on the row for the cell badge
    }
    return Array.from(groups.values())
  }, [caseData, branchToRegion])

  const filteredBranchRows = useMemo(() => {
    return branchAggregated
      .filter(g => !hasRegionFilter || activeRegions.has(g.region))
      .filter(g => !searchQ || (g.branch_name || '').toLowerCase().includes(searchQ) || (g.region || '').toLowerCase().includes(searchQ))
      .filter(g => {
        // Same "Consignment Date" filter the case-wise view uses.
        if (caseSinceRange.from || caseSinceRange.to) {
          if (!g.consignment_date) return false
          if (caseSinceRange.from && g.consignment_date < caseSinceRange.from) return false
          if (caseSinceRange.to   && g.consignment_date > caseSinceRange.to)   return false
        }
        return true
      })
      .filter(g => expDelivMatch(g.expected_delivery_date))
      .slice()
      .sort((a, b) => {
        let av, bv
        switch (sortKey) {
          case 'branch_name':           av = a.branch_name || ''; bv = b.branch_name || ''; return av.localeCompare(bv) * sortDir
          case 'bills':                 av = a.bills;        bv = b.bills;        break
          case 'gross_weight':          av = a.gross_weight; bv = b.gross_weight; break
          case 'stone_weight':          av = a.stone_weight; bv = b.stone_weight; break
          case 'wastage':               av = a.wastage;      bv = b.wastage;      break
          case 'net_weight':
          case 'total_net_wt':          av = a.net_weight;   bv = b.net_weight;   break
          case 'total_amount':          av = a.total_amount; bv = b.total_amount; break
          case 'svc_charge':            av = a.svc_charge;   bv = b.svc_charge;   break
          case 'expected_delivery_date':av = a.expected_delivery_date || ''; bv = b.expected_delivery_date || ''; return av.localeCompare(bv) * sortDir
          case 'consignment_date':
          default:                      av = a.consignment_date || ''; bv = b.consignment_date || ''; return av.localeCompare(bv) * sortDir
        }
        return (av - bv) * sortDir
      })
  }, [branchAggregated, activeRegions, hasRegionFilter, searchQ, caseSinceRange, expDelivRange, sortKey, sortDir])

  const filteredCaseRows = useMemo(() => caseData
    .filter(r => {
      // Date filter on the consignment CREATION date (the bill's owning
      // consignment), compared against the IST calendar day. Falls back to
      // the bill's dispatch date for any legacy row without a link.
      if (caseSinceRange.from || caseSinceRange.to) {
        const axisTs = r.consignment_created_at || r.dispatched_at
        if (!axisTs) return false
        const day = new Date(axisTs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        if (caseSinceRange.from && day < caseSinceRange.from) return false
        if (caseSinceRange.to   && day > caseSinceRange.to)   return false
      }
      // Region chip filters by source branch's region (multi-select).
      if (hasRegionFilter && !activeRegions.has(branchToRegion[r.branch_name])) return false
      // Search across application_id / customer / branch.
      if (searchQ) {
        const hay = `${r.application_id || ''} ${r.customer_name || ''} ${r.branch_name || ''}`.toLowerCase()
        if (!hay.includes(searchQ)) return false
      }
      return true
    })
    // Decorate every row with expected_delivery_date so the column can sort
    // and render off a single source of truth. Logic mirrors the branch-wise
    // computation: dispatch IST day + ceil(TAT_hours / 24) working days,
    // skipping Sundays. Defaults to 24h TAT if the row didn't return one.
    .map(r => {
      const tatHours     = Number(r.delivery_tat_hours) || 24
      const workDays     = Math.max(1, Math.ceil(tatHours / 24))
      const dispatchDate = r.dispatched_at ? istDateStr(new Date(r.dispatched_at)) : null
      const expDate      = dispatchDate ? addWorkingDaysSkipSunday(dispatchDate, workDays) : null
      return { ...r, expected_delivery_date: expDate, _tat_hours_effective: tatHours }
    })
    // Expected-delivery filter applied AFTER decoration (the date is derived
    // in the map above, so it can't be filtered before this point).
    .filter(r => expDelivMatch(r.expected_delivery_date))
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
  , [caseData, caseSinceRange, expDelivRange, activeRegions, hasRegionFilter, searchQ, branchToRegion, caseSortKey, caseSortDir])

  function handleCaseSort(key) {
    if (caseSortKey === key) setCaseSortDir(d => d * -1)
    else { setCaseSortKey(key); setCaseSortDir(-1) }
  }

  // PNG export — POSTs the currently-filtered rows to the server, which
  // renders them via @napi-rs/canvas and streams back a JPEG. The two views
  // share the endpoint; the layout switches on viewMode (case = per-bill
  // App ID, branch = aggregated No of Bills).
  function activeFilterLabel() {
    if (caseSinceQuick === 'all')       return 'All dates'
    if (caseSinceQuick === 'today')     return 'Today'
    if (caseSinceQuick === 'yesterday') return 'Yesterday'
    if (caseSinceQuick === 'last7')     return 'Last 7 days'
    if (caseSinceQuick === 'custom' && (caseSinceFrom || caseSinceTo)) {
      return `${caseSinceFrom || '…'} → ${caseSinceTo || '…'}`
    }
    return 'All dates'
  }
  async function downloadJpg() {
    const rows = viewMode === 'branch' ? filteredBranchRows : filteredCaseRows
    if (rows.length === 0) {
      setToast({ msg: 'Nothing to export — empty filter.', type: 'error' })
      return
    }
    setToast({ msg: 'Generating image…', type: 'info' })
    try {
      const res = await authedFetch('/api/consignment-in-transit-jpg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewMode,
          rows,
          meta: { filter_label: activeFilterLabel(), region: hasRegionFilter ? [...activeRegions].join(' + ') : null },
        }),
      })
      if (!res.ok) {
        let msg = `Download failed: ${res.status}`
        try { const j = await res.json(); if (j.error) msg = j.error } catch {}
        setToast({ msg, type: 'error' })
        return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `ConsignmentReport_${viewMode}_${istToday()}.png`
      a.click()
      URL.revokeObjectURL(a.href)
      setToast({ msg: 'Image ready.', type: 'success' })
    } catch (e) {
      setToast({ msg: e.message || 'Image export failed', type: 'error' })
    }
  }

  // Open the bill journey modal for an application_id and fetch its history.
  // The backend already exposes `bill_journey` — one consignment per row,
  // ordered earliest first, with status + EWB/IRN + timestamps.
  async function openJourney(purchaseId, applicationId) {
    setJourneyTarget({ purchase_id: purchaseId, application_id: applicationId, loading: true, rows: null, error: null })
    try {
      const res  = await authedFetch(`/api/consignments?action=bill_journey&purchase_id=${purchaseId}`)
      const json = await res.json()
      setJourneyTarget(prev => prev && prev.purchase_id === purchaseId
        ? { ...prev, loading: false, rows: json.data || [], error: json.error || null }
        : prev)
    } catch (e) {
      setJourneyTarget(prev => prev && prev.purchase_id === purchaseId
        ? { ...prev, loading: false, rows: [], error: e.message }
        : prev)
    }
  }

  // Reset to page 1 whenever the filter set changes so ops aren't stuck on
  // page 5 of a result set that only has 2 pages now.
  useEffect(() => { setCasePage(1) }, [caseSinceQuick, caseSinceFrom, caseSinceTo, expDelivQuick, expDelivFrom, expDelivTo, activeRegions, search, caseSortKey, caseSortDir])

  // Σ totals across the visible case rows — drives the totals row pinned
  // beneath the headers. Note: Svc % can't be summed (it's a per-bill rate),
  // so we show a weighted average instead — Σ(svc_amt) / Σ(gross_amt) × 100.
  const caseTotals = useMemo(() => filteredCaseRows.reduce((acc, r) => {
    acc.bills        += 1
    acc.gross_weight += Number(r.gross_weight || 0)
    acc.stone_weight += Number(r.stone_weight || 0)
    acc.wastage      += Number(r.wastage      || 0)
    acc.net_weight   += Number(r.net_weight   || 0)
    acc.gross_amt    += Number(r.total_amount || 0)
    acc.svc_amt      += Number(r.service_charge_amount_crm || 0)
    acc.final_amt    += Number(r.final_amount_crm || 0)
    return acc
  }, { bills: 0, gross_weight: 0, stone_weight: 0, wastage: 0, net_weight: 0, gross_amt: 0, svc_amt: 0, final_amt: 0 })
  , [filteredCaseRows])
  const caseAvgSvcPct = caseTotals.gross_amt > 0
    ? (caseTotals.svc_amt / caseTotals.gross_amt) * 100
    : 0

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
      ['net_weight',                'Net Wt (g)'],
      ['total_amount',              'Gross Amt'],
      ['consignment_created_at',    'Consignment Date'],
      ['booked_at',                 'Booking Date'],
      ['expected_delivery_date',    'Expected Delivery'],
    ]
    const lines = [cols.map(([, l]) => csvEscape(l)).join(',')]
    for (const r of rows) {
      lines.push(cols.map(([k]) => {
        if (k === 'consignment_created_at' || k === 'booked_at') return r[k] ? new Date(r[k]).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : ''
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

  // ── Region card stats — derived from the *date-filtered* caseData (not the
  //     region-filtered rows). That way clicking "Rest of Karnataka" filters
  //     the table below but each region card keeps showing its own region's
  //     totals for the date window. "All Regions" stays at the grand total.
  const regionStatsView = useMemo(() => regions.reduce((acc, r) => {
    const rows        = caseData.filter(row => row.region === r)
    const branchNames = new Set(rows.map(row => row.branch_name))
    acc[r] = {
      branches:        branchNames.size,
      active_branches: branchNames.size,
      total_bills:     rows.length,
      total_net_wt:    rows.reduce((s, row) => s + Number(row.net_weight || 0), 0),
    }
    return acc
  }, {}), [regions, caseData])

  const allStatsView = useMemo(() => ({
    allBills:       caseData.length,
    allNetWt:       caseData.reduce((s, r) => s + Number(r.net_weight || 0), 0),
    activeBranches: new Set(caseData.map(r => r.branch_name)).size,
    totalBranches:  new Set(caseData.map(r => r.branch_name)).size,
  }), [caseData])

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>

      {/* Top loading bar — visible the whole time a fetch is in flight.
          Lets ops see that a date change is processing, instead of staring
          at stale data and wondering. */}
      {caseLoading && caseLoaded && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 200, overflow: 'hidden', background: 'transparent', pointerEvents: 'none' }}>
          <div style={{ height: '100%', width: '60%', background: `linear-gradient(90deg, transparent, ${t.gold}, transparent)`, animation: 'cnsrptLoadBar 1.1s ease infinite' }} />
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Consignment Report</div>
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            Consignments created on {activeFilterLabel().toLowerCase()} · {viewMode === 'branch' ? 'per-branch rollup' : 'bill-level'}
            {caseLoading
              ? <span style={{ color: t.gold, marginLeft: '6px' }}>· loading…</span>
              : lastRefresh && (
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
          {(hasRegionFilter || search) && (
            <button onClick={() => { clearRegions(); setSearch('') }}
              style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 13px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
              Clear
            </button>
          )}
          <button
            onClick={() => fetchMovements(caseSinceRange)}
            disabled={caseLoading}
            style={{ background: caseLoading ? t.card2 : `${t.gold}15`, border: `1px solid ${caseLoading ? t.border : t.gold}40`, borderRadius: '8px', padding: '7px 16px', fontSize: '12px', color: caseLoading ? t.text4 : t.gold, cursor: caseLoading ? 'default' : 'pointer', fontWeight: 600, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', animation: caseLoading ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
            {caseLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Load error banner — surfaces the json.error payload + network
           failures that used to be silently swallowed into an empty table. */}
      {loadError && (
        <div style={{
          background: `${t.red}12`, border: `1px solid ${t.red}40`,
          borderLeft: `4px solid ${t.red}`, borderRadius: '8px',
          padding: '10px 14px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '12px', color: t.red, fontWeight: 600 }}>
            ⚠ Couldn't load report — {loadError}
          </span>
          <button onClick={() => fetchMovements(caseSinceRange)}
            style={{ background: 'transparent', border: `1px solid ${t.red}80`, color: t.red, borderRadius: '6px', padding: '5px 12px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )}

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
            const { allBills, allNetWt, activeBranches, totalBranches } = allStatsView
            const w = fmtWtCard(allNetWt)
            const isActive = !hasRegionFilter
            return (
              <div onClick={clearRegions}
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
                  <span title={`${activeBranches} branches dispatched in this window`}>
                    <strong style={{ color: t.text2 }}>{activeBranches}</strong> branch{activeBranches === 1 ? '' : 'es'}
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{allBills}</strong> bills</span>
                </div>
              </div>
            )
          })()}

          {regions.map(r => {
            const stats  = regionStatsView[r] || {}
            const color  = REGION_COLORS[r] || t.text3
            const icon   = REGION_ICONS[r] || '📍'
            const active = activeRegions.has(r)
            const w      = fmtWtCard(stats.total_net_wt)
            return (
              <div key={r} onClick={() => toggleRegion(r)}
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
                  <span title={`${stats.active_branches || 0} branches in this region dispatched in this window`}>
                    <strong style={{ color: t.text2 }}>{stats.active_branches || 0}</strong> branch{(stats.active_branches || 0) === 1 ? '' : 'es'}
                  </span>
                  <span style={{ color: t.border2 }}>·</span>
                  <span><strong style={{ color: t.text2 }}>{stats.total_bills || 0}</strong> bills</span>
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

        {/* Consignment Date filter — same chips for both branch-wise and
            case-wise so ops gets one consistent vocabulary. Drives the
            caseSinceRange that both filteredCaseRows and filteredBranchRows
            consume. */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>Consignment date</span>
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

        {/* Expected Delivery filter — narrows BOTH views by the derived
            expected_delivery_date (dispatch + working-day TAT). Independent
            of the consignment-date filter; the two AND together. */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>Expected delivery</span>
            {[
              { key: 'all',      label: 'All' },
              { key: 'today',    label: 'Today' },
              { key: 'tomorrow', label: 'Tomorrow' },
              { key: 'next7',    label: 'Next 7d' },
            ].map(q => {
              const active = expDelivQuick === q.key
              return (
                <button key={q.key}
                  onClick={() => { setExpDelivQuick(q.key); setExpDelivFrom(''); setExpDelivTo('') }}
                  style={{
                    padding: '5px 11px', borderRadius: '6px',
                    background: active ? `${t.green}18` : 'transparent',
                    border: `1px solid ${active ? `${t.green}80` : t.border2}`,
                    color: active ? t.green : t.text3,
                    fontSize: '11px', fontWeight: active ? 700 : 500,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                  {q.label}
                </button>
              )
            })}
            <input type="date" value={expDelivFrom}
              onChange={e => { setExpDelivFrom(e.target.value); setExpDelivQuick('custom') }}
              style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '6px', padding: '5px 7px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
            <span style={{ color: t.text4 }}>→</span>
            <input type="date" value={expDelivTo}
              onChange={e => { setExpDelivTo(e.target.value); setExpDelivQuick('custom') }}
              style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '6px', padding: '5px 7px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
        </div>

        <div style={{ marginLeft: isMobile ? 0 : 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: t.text4 }}>
            {viewMode === 'case'
              ? `${filteredCaseRows.length} of ${caseData.length} bills`
              : `${filteredBranchRows.length} of ${branchAggregated.length} rows`}
          </span>
          <button onClick={() => (viewMode === 'branch' ? exportCsv(filteredBranchRows) : exportCaseCsv(filteredCaseRows))}
            title="Download the current view as CSV"
            style={{
              padding: '6px 12px', borderRadius: '6px',
              background: 'transparent', border: `1px solid ${t.border2}`,
              color: t.text2, fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px',
            }}>
            ↓ CSV
          </button>
          <button onClick={downloadJpg}
            title={`Download the current view as PNG (${viewMode === 'branch' ? 'branch-wise rows' : 'per-bill rows'})`}
            style={{
              padding: '6px 12px', borderRadius: '6px',
              background: `${t.gold}10`, border: `1px solid ${t.gold}50`,
              color: t.gold, fontSize: '11px', fontWeight: 700,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px',
            }}>
            ↓ PNG
          </button>
        </div>
      </div>

      {/* ── Branch-wise table — per-branch rollup of bills in flight ── */}
      {viewMode === 'branch' && (
        <div style={{ ...card, overflow: 'hidden', opacity: (caseLoading && caseLoaded) ? 0.55 : 1, transition: 'opacity .2s', pointerEvents: (caseLoading && caseLoaded) ? 'none' : 'auto' }}>
          {(caseLoading && !caseLoaded) ? (
            <div style={{ padding: '80px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
          ) : filteredBranchRows.length === 0 ? (
            <div style={{ padding: '80px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              {search || hasRegionFilter ? 'No rows match your filter' : `No consignments created in ${activeFilterLabel().toLowerCase()}`}
            </div>
          ) : (() => {
            // New branch-wise view: bills grouped by (branch + dispatched date)
            // so UDUPI on 19 May and UDUPI on 20 May appear as distinct lines.
            // Matches the case-wise table's density + typography for visual
            // consistency between the two view modes.
            const padBranch = '11px 14px'
            const tdL = { padding: padBranch, verticalAlign: 'middle', fontSize: '13px', textAlign: 'left' }
            const tdR = { padding: padBranch, verticalAlign: 'middle', fontSize: '13px', textAlign: 'right', fontFamily: 'monospace' }
            const tdC = { padding: padBranch, verticalAlign: 'middle', fontSize: '13px', textAlign: 'center', fontFamily: 'monospace' }
            const th  = (col) => ({
              padding: '11px 14px', fontSize: '10.5px', color: sortKey === col.k ? t.gold : t.text4,
              letterSpacing: '.04em', textTransform: 'uppercase',
              background: t.card2, borderBottom: `1px solid ${t.border}`,
              whiteSpace: 'nowrap', fontWeight: 600, userSelect: 'none',
              verticalAlign: 'middle', textAlign: col.a, cursor: 'pointer',
              position: 'sticky', top: 0, zIndex: 2,
              // Per-column left-padding override so a sparser column (e.g.
              // Expected Delivery) can sit visually away from the dense
              // numeric column to its left.
              ...(col.padLeft ? { paddingLeft: col.padLeft } : null),
            })
            const fmtAmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
            const fmtWt  = (n) => n != null ? Number(n).toFixed(2) : '—'
            // DD-MMM-YYYY (e.g. "23-May-2026") — same format the case-wise
            // view uses so the two tables read identically.
            const fmtCellDate = (d) => {
              if (!d) return '—'
              const [y, m, day] = d.split('-')
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              return `${day}-${months[+m - 1]}-${y}`
            }
            const totals = filteredBranchRows.reduce((acc, g) => {
              acc.bills        += g.bills
              acc.gross_weight += g.gross_weight
              acc.net_weight   += g.net_weight
              acc.total_amount += g.total_amount
              return acc
            }, { bills: 0, gross_weight: 0, net_weight: 0, total_amount: 0 })
            return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    {[
                      { k: 'consignment_date',       l: 'Consignment Date',  a: 'left'   },
                      { k: 'branch_name',            l: 'Branch',            a: 'left'   },
                      { k: 'bills',                  l: 'No of Bills',       a: 'right'  },
                      { k: 'gross_weight',           l: 'Gross Wt (g)',      a: 'right'  },
                      { k: 'net_weight',             l: 'Net Wt (g)',        a: 'right'  },
                      { k: 'total_amount',           l: 'Amount',            a: 'right'  },
                      { k: 'expected_delivery_date', l: 'Expected Delivery', a: 'center', padLeft: 32 },
                    ].map(col => {
                      // Sort arrow on the leading side for right-aligned columns
                      // so the label sits flush with the values below. Same
                      // pattern the case-wise table uses.
                      const arrow = (
                        <span style={{ color: sortKey === col.k ? t.gold : t.text4, fontSize: '10px' }}>
                          {sortKey === col.k ? (sortDir === -1 ? '↓' : '↑') : '⇅'}
                        </span>
                      )
                      return (
                        <th key={col.k} onClick={() => handleSort(col.k)} style={th(col)}>
                          {col.a === 'right'
                            ? <><span style={{ marginRight: '3px' }}>{arrow}</span>{col.l}</>
                            : <>{col.l}<span style={{ marginLeft: '3px' }}>{arrow}</span></>}
                        </th>
                      )
                    })}
                  </tr>
                  {/* Σ TOTALS — pinned just under the headers. Row count is
                      inlined with the Σ label in the first cell so col 2 stays
                      clean for the actual branch / total summary. */}
                  <tr style={{ background: `${t.gold}0c`, borderBottom: `1px solid ${t.gold}40` }}>
                    <td style={{ ...tdL, color: t.gold, fontWeight: 700, letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
                      Σ TOTALS
                      <span style={{ color: t.text3, fontWeight: 500, marginLeft: 8, letterSpacing: 0, fontSize: '11px' }}>
                        · {filteredBranchRows.length} row{filteredBranchRows.length === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td style={tdL} />
                    <td style={{ ...tdR, color: t.gold,  fontWeight: 700 }}>{totals.bills}</td>
                    <td style={{ ...tdR, color: t.text2, fontWeight: 600 }}>{fmtWt(totals.gross_weight)}</td>
                    <td style={{ ...tdR, color: t.gold,  fontWeight: 700 }}>{fmtWt(totals.net_weight)}</td>
                    <td style={{ ...tdR, color: t.text2, fontWeight: 600 }}>{fmtAmt(totals.total_amount)}</td>
                    <td style={{ ...tdC, paddingLeft: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {filteredBranchRows.map((g, i) => {
                    const zebra = i % 2 === 0 ? 'transparent' : `${t.card2}30`
                    const rColor = REGION_COLORS[g.region] || t.text3
                    return (
                      <tr key={g.key}
                        style={{ borderBottom: `1px solid ${t.border}25`, background: zebra, transition: 'background .12s ease' }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${t.gold}0e` }}
                        onMouseLeave={e => { e.currentTarget.style.background = zebra }}>
                        <td style={{ ...tdL, color: t.gold, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtCellDate(g.consignment_date)}</td>
                        <td style={tdL}>
                          <div style={{ color: t.text1, fontWeight: 600 }}>{g.branch_name}</div>
                          {g.region && <div style={{ fontSize: '11px', color: rColor, marginTop: 1 }}>{g.region}</div>}
                        </td>
                        <td style={{ ...tdR, color: t.gold, fontWeight: 600 }}>{g.bills}</td>
                        <td style={{ ...tdR, color: t.text2 }}>{fmtWt(g.gross_weight)}</td>
                        <td style={{ ...tdR, color: t.gold, fontWeight: 600 }}>{fmtWt(g.net_weight)}</td>
                        <td style={{ ...tdR, color: t.text2 }}>{fmtAmt(g.total_amount)}</td>
                        <td style={{ ...tdC, color: t.green, whiteSpace: 'nowrap', paddingLeft: 32 }}>
                          {fmtCellDate(g.expected_delivery_date)}
                          {g.delivery_tat_hours > 24 && (
                            <span style={{ marginLeft: 6, fontSize: 9, color: t.orange, background: `${t.orange}18`, borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: '.04em' }}>
                              {g.delivery_tat_hours}h
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )
          })()}
        </div>
      )}

      {/* ── Case-wise table — bill-level rows for in-transit stock. Same column
          set the Purchase Data module exposes, filtered by when each bill went
          into transit (purchases.dispatched_at). Sortable; CSV-exportable. ── */}
      {viewMode === 'case' && (
        <div style={{ ...card, overflow: 'hidden', opacity: (caseLoading && caseLoaded) ? 0.55 : 1, transition: 'opacity .2s', pointerEvents: (caseLoading && caseLoaded) ? 'none' : 'auto' }}>
          {caseLoading && !caseLoaded ? (
            <div style={{ padding: '80px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
          ) : filteredCaseRows.length === 0 ? (
            <div style={{ padding: '80px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
              {caseData.length === 0 ? `No consignments created in ${activeFilterLabel().toLowerCase()}` : 'No bills match your filter'}
            </div>
          ) : (() => {
            // Case-wise table — tighter than the branch-wise rollup so all 14
            // columns fit a 1440px+ viewport without horizontal scroll. Smaller
            // viewports still get the overflow-x scroll fallback below.
            // Bumped cell + header font sizes so the 9-column table fills
            // wide viewports comfortably without giant gaps between columns.
            const caseTdPad = '11px 14px'
            const caseTd    = { padding: caseTdPad, verticalAlign: 'middle', fontSize: '13px' }
            const caseTdL   = { ...caseTd, textAlign: 'left' }
            const caseTdR   = { ...caseTd, textAlign: 'right', fontFamily: 'monospace' }
            const caseTdC   = { ...caseTd, textAlign: 'center', fontFamily: 'monospace' }
            const caseTh    = (col) => ({
              padding: '11px 14px', fontSize: '10.5px', color: caseSortKey === col.k ? t.gold : t.text4,
              letterSpacing: '.04em', textTransform: 'uppercase',
              background: t.card2, borderBottom: `1px solid ${t.border}`,
              whiteSpace: 'nowrap', fontWeight: 600, userSelect: 'none',
              verticalAlign: 'middle', textAlign: col.a, cursor: 'pointer',
              position: 'sticky', top: 0, zIndex: 2,                        // stays put while you scroll the page
            })
            const fmtAmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
            const fmtWt  = (n) => n != null ? Number(n).toFixed(2) : '—'
            // DD-MMM-YYYY (e.g. "23-May-2026") — same format the branch-wise
            // view uses so the two tables read identically for dates.
            const fmtCellDate = (d) => {
              if (!d) return '—'
              const [y, m, day] = d.split('-')
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              return `${day}-${months[+m - 1]}-${y}`
            }
            return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    {[
                      { k: 'application_id',            l: 'App ID',     a: 'left'  },
                      { k: 'purchase_date',             l: 'Purchase',   a: 'left'  },
                      { k: 'customer_name',             l: 'Customer',   a: 'left'  },
                      { k: 'branch_name',               l: 'Branch',     a: 'left'  },
                      { k: 'gross_weight',              l: 'Gross (g)',  a: 'right' },
                      { k: 'net_weight',                l: 'Net (g)',    a: 'right' },
                      { k: 'total_amount',              l: 'Gross Amt',  a: 'right' },
                      { k: 'consignment_created_at',    l: 'Consignment Date', a: 'center' },
                      { k: 'booked_at',                 l: 'Booking Date', a: 'center' },
                      { k: 'expected_delivery_date',    l: 'Expected Delivery', a: 'center' },
                    ].map(col => {
                      // Put the sort arrow on the *leading* side of the label
                      // — right-aligned columns get the arrow before the label
                      // so the label text still sits flush at the column's
                      // right edge, lined up with the right-aligned values
                      // below. Left-aligned columns keep the arrow after the
                      // label so the label sits flush at the left edge.
                      const arrow = (
                        <span style={{ color: caseSortKey === col.k ? t.gold : t.text4, fontSize: '9px' }}>
                          {caseSortKey === col.k ? (caseSortDir === -1 ? '↓' : '↑') : '⇅'}
                        </span>
                      )
                      return (
                        <th key={col.k} onClick={() => handleCaseSort(col.k)} style={caseTh(col)}>
                          {col.a === 'right'
                            ? <><span style={{ marginRight: '3px' }}>{arrow}</span>{col.l}</>
                            : <>{col.l}<span style={{ marginLeft: '3px' }}>{arrow}</span></>}
                        </th>
                      )
                    })}
                  </tr>
                  {/* Σ TOTALS — pinned just under the headers. Sums across
                      the currently-filtered rows; Svc % is a weighted avg
                      since percentages don't sum meaningfully. */}
                  <tr style={{ background: `${t.gold}0c`, borderBottom: `1px solid ${t.gold}40` }}>
                    <td style={{ ...caseTdL, color: t.gold, fontWeight: 700, letterSpacing: '.04em', whiteSpace: 'nowrap' }}>Σ TOTALS</td>
                    <td style={caseTdL} />
                    <td style={{ ...caseTdL, color: t.text3, fontSize: '10px' }}>{caseTotals.bills} bill{caseTotals.bills === 1 ? '' : 's'}</td>
                    <td style={caseTdL} />
                    <td style={{ ...caseTdR, color: t.text2, fontWeight: 600 }}>{fmtWt(caseTotals.gross_weight)}</td>
                    <td style={{ ...caseTdR, color: t.gold,  fontWeight: 700 }}>{fmtWt(caseTotals.net_weight)}</td>
                    <td style={{ ...caseTdR, color: t.text2, fontWeight: 600 }}>{fmtAmt(caseTotals.gross_amt)}</td>
                    <td style={caseTdL} />
                    <td style={caseTdL} />
                    <td style={caseTdL} />
                  </tr>
                </thead>
                <tbody>
                  {filteredCaseRows.slice((casePage - 1) * casePageSize, casePage * casePageSize).map((r, i) => {
                    // Light zebra striping — even rows get a hair-thin tint.
                    // No CSS class (avoids the position: relative bug); inline
                    // backgroundColor with a hover overlay via onMouseEnter.
                    const zebraBg = i % 2 === 0 ? 'transparent' : `${t.card2}30`
                    return (
                      <tr key={r.id || i}
                        style={{ borderBottom: `1px solid ${t.border}25`, background: zebraBg, transition: 'background .12s ease' }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${t.gold}0e` }}
                        onMouseLeave={e => { e.currentTarget.style.background = zebraBg }}>
                        <td style={{ ...caseTdL, whiteSpace: 'nowrap' }}>
                          <span
                            onClick={() => openJourney(r.id, r.application_id)}
                            title="View this bill's consignment journey"
                            style={{ color: t.gold, fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer', borderBottom: `1px dashed ${t.gold}50` }}>
                            {r.application_id || '—'}
                          </span>
                        </td>
                        <td style={{ ...caseTdL, color: t.text2, whiteSpace: 'nowrap' }}>{r.purchase_date ? fmtDate(r.purchase_date) : '—'}</td>
                        <td style={{ ...caseTdL, color: t.text1 }}>{r.customer_name || '—'}</td>
                        <td style={{ ...caseTdL, color: t.text2, whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</td>
                        <td style={{ ...caseTdR, color: t.text2 }}>{fmtWt(r.gross_weight)}</td>
                        <td style={{ ...caseTdR, color: t.gold, fontWeight: 600 }}>{fmtWt(r.net_weight)}</td>
                        <td style={{ ...caseTdR, color: t.text2 }}>{fmtAmt(r.total_amount)}</td>
                        <td style={{ ...caseTdC, color: t.text2, whiteSpace: 'nowrap' }}>
                          {r.consignment_created_at
                            ? new Date(r.consignment_created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
                            : '—'}
                        </td>
                        <td style={{ ...caseTdC, color: r.booked_at ? t.text2 : t.text4, whiteSpace: 'nowrap' }}>
                          {r.booked_at
                            ? new Date(r.booked_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
                            : '—'}
                        </td>
                        <td style={{ ...caseTdC, color: t.green, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {fmtCellDate(r.expected_delivery_date)}
                          {r._tat_hours_effective > 24 && (
                            <span style={{ marginLeft: 6, fontSize: 9, color: t.orange, background: `${t.orange}18`, borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: '.04em' }}>
                              {r._tat_hours_effective}h
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )
          })()}
          {/* Pagination — only when there are more rows than one page can hold. */}
          {filteredCaseRows.length > casePageSize && (() => {
            const totalPages = Math.ceil(filteredCaseRows.length / casePageSize)
            const first = (casePage - 1) * casePageSize + 1
            const last  = Math.min(casePage * casePageSize, filteredCaseRows.length)
            const btn = (label, disabled, onClick, primary = false) => (
              <button onClick={onClick} disabled={disabled}
                style={{
                  background: disabled ? 'transparent' : (primary ? `${t.gold}15` : t.card2),
                  border: `1px solid ${disabled ? t.border : (primary ? `${t.gold}50` : t.border2)}`,
                  color: disabled ? t.text4 : (primary ? t.gold : t.text2),
                  borderRadius: 6, padding: '5px 11px', fontSize: 11, fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}>{label}</button>
            )
            return (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderTop: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, color: t.text3 }}>
                  Showing <strong style={{ color: t.text1 }}>{first}–{last}</strong> of <strong style={{ color: t.text1 }}>{filteredCaseRows.length}</strong> bills
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: t.text4, marginRight: 4 }}>Per page</span>
                  {[50, 100, 200].map(n => (
                    <button key={n} onClick={() => { setCasePageSize(n); setCasePage(1) }}
                      style={{
                        background: n === casePageSize ? `${t.gold}18` : 'transparent',
                        border: `1px solid ${n === casePageSize ? `${t.gold}60` : t.border2}`,
                        color: n === casePageSize ? t.gold : t.text3,
                        borderRadius: 5, padding: '3px 9px', fontSize: 10.5,
                        fontWeight: n === casePageSize ? 700 : 500, cursor: 'pointer',
                      }}>{n}</button>
                  ))}
                  <span style={{ width: 1, height: 14, background: t.border, margin: '0 4px' }} />
                  {btn('← Prev', casePage === 1, () => setCasePage(p => Math.max(1, p - 1)))}
                  <span style={{ fontSize: 11, color: t.text2, fontFamily: 'monospace', minWidth: 64, textAlign: 'center' }}>
                    Page <strong style={{ color: t.gold }}>{casePage}</strong> / {totalPages}
                  </span>
                  {btn('Next →', casePage === totalPages, () => setCasePage(p => Math.min(totalPages, p + 1)), true)}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Footer note */}
      <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
        Permanent ledger of consignments created (approved onward, excludes cancelled) · &quot;Consignment date&quot; = <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>consignments.created_at</code> (IST) · persists after receipt
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Bill journey modal — every consignment a given bill has been part of,
          earliest first. Triggered by clicking an App ID in the case-wise table. */}
      {journeyTarget && typeof document !== 'undefined' && createPortal((
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}
          onClick={() => setJourneyTarget(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Bill journey</div>
                <div style={{ fontSize: '15px', color: t.gold, fontFamily: 'monospace', fontWeight: 700 }}>{journeyTarget.application_id}</div>
              </div>
              <button onClick={() => setJourneyTarget(null)} aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '14px 22px', flex: 1, overflowY: 'auto' }}>
              {journeyTarget.loading ? (
                <div style={{ padding: '40px 0', textAlign: 'center' }}><GoldSpinner size={24} /></div>
              ) : journeyTarget.error ? (
                <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: 7, padding: '10px 14px', fontSize: 12, color: t.red }}>{journeyTarget.error}</div>
              ) : !journeyTarget.rows || journeyTarget.rows.length === 0 ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: t.text4, fontSize: 12 }}>This bill hasn't been part of any consignment yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {journeyTarget.rows.map((j, i) => {
                    const isInternal = j.movement_type === 'INTERNAL'
                    const dest = isInternal ? (j.dest || 'Hub') : 'Head Office'
                    const docNo = j.eway_bill_no || j.irn || ''
                    const stripeColor = j.status === 'cancelled' ? t.red
                                      : j.status === 'received'  ? t.green
                                      : j.received_at            ? t.green
                                      : t.gold
                    return (
                      <div key={`${j.consignment_id || i}`} style={{ background: t.card2, border: `1px solid ${t.border}`, borderLeft: `3px solid ${stripeColor}`, borderRadius: 8, padding: '11px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: t.gold, fontFamily: 'monospace', fontWeight: 700 }}>{j.tmp_prf_no || '—'}</span>
                          <span style={{ fontSize: 9, color: isInternal ? t.purple : t.orange, background: `${isInternal ? t.purple : t.orange}15`, borderRadius: 4, padding: '2px 7px', fontWeight: 700, letterSpacing: '.04em' }}>
                            {isInternal ? 'BRANCH → HUB' : 'BRANCH → HO'}
                          </span>
                          <span style={{ fontSize: 9, color: stripeColor, background: `${stripeColor}15`, borderRadius: 4, padding: '2px 7px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{j.status}</span>
                        </div>
                        <div style={{ fontSize: 12, color: t.text2, marginTop: 6 }}>
                          <strong style={{ color: t.text1 }}>{j.source || '—'}</strong>
                          <span style={{ color: t.text4, margin: '0 6px' }}>→</span>
                          <span>{dest}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10, color: t.text4, fontFamily: 'monospace', flexWrap: 'wrap' }}>
                          <span>Created {j.created_at ? new Date(j.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                          {j.received_at && <span style={{ color: t.green }}>Received {new Date(j.received_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                          {j.short_reason && <span style={{ color: t.red }}>Short: {j.short_reason}</span>}
                          {docNo && <span style={{ color: t.text3 }}>· {j.eway_bill_no ? 'EWB' : 'IRN'} {String(docNo).slice(0, 14)}{String(docNo).length > 14 ? '…' : ''}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: '11px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setJourneyTarget(null)}
                style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 6, padding: '7px 16px', fontSize: 11, color: t.text3, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin  { to{transform:rotate(360deg)} }
        @keyframes cnsrptLoadBar {
          0%   { transform: translateX(-100%) }
          60%  { transform: translateX(0%)    }
          100% { transform: translateX(100%)  }
        }
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
