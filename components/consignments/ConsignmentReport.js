'use client'

// ConsignmentReport — analytics hub for in-flight consignment movements.
// Architecture mirrors PurchaseReports: sticky filter bar, multi-row KPI cards,
// section nav pills, and drill-down sub-sections rendered conditionally.

import { useState, useEffect, useMemo } from 'react'
import { useApp, useRegionAccess } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt  = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtINR = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0

// Approved + dispatched = visible in tracked-consignment view. Cancelled / received excluded.
const isInFlight = (c) => c.status === 'dispatched' && c.approval_status === 'approved'

const REGION_COLOR = {
  'Andhra Pradesh':    '#5ec1d6',
  'Kerala':            '#3aaa6a',
  'Telangana':         '#c9a84c',
  'Tamil Nadu':        '#e58a3b',
  'Rest of Karnataka': '#9275d5',
  'Bangalore':         '#e05555',
}

const SECTIONS_IN = [
  { key: 'trends',       label: 'Trends',       icon: '↗' },
  { key: 'distribution', label: 'Distribution', icon: '◎' },
  { key: 'branches',     label: 'Branches',     icon: '⬡' },
  { key: 'routes',       label: 'Routes',       icon: '⇉' },
  { key: 'aging',        label: 'Aging',        icon: '⏱' },
  { key: 'untracked',    label: 'Untracked',    icon: '⚠' },
]
const SECTIONS_AT = [
  { key: 'distribution', label: 'Distribution', icon: '◎' },
  { key: 'branches',     label: 'Branches',     icon: '⬡' },
]

// ── Component ────────────────────────────────────────────────────────────────
export default function ConsignmentReport() {
  const { theme } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  // View mode
  const [mode,           setMode]           = useState('in_consignment') // 'at_branch' | 'in_consignment'

  // Data
  const [consignments,   setConsignments]   = useState([])
  const [inTransitBills, setInTransitBills] = useState([])
  const [atBranchBills,  setAtBranchBills]  = useState([])
  const [branches,       setBranches]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [toast,          setToast]          = useState(null)

  // Filters
  const [fromDate,       setFromDate]       = useState('')
  const [toDate,         setToDate]         = useState('')
  const regionAccess = useRegionAccess()
  const [filterRegion,   setFilterRegion]   = useState(regionAccess.single ? regionAccess.regions[0] : '')

  // Pin filterRegion to the only allowed region whenever scoping is single.
  useEffect(() => {
    if (regionAccess.single && filterRegion !== regionAccess.regions[0]) {
      setFilterRegion(regionAccess.regions[0])
    }
  }, [regionAccess.single, regionAccess.regions, filterRegion])
  const [filterType,     setFilterType]     = useState('')
  const [filterBranch,   setFilterBranch]   = useState('')
  const [search,         setSearch]         = useState('')
  const [activeSection,  setActiveSection]  = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const [cR, bR, sR, abR] = await Promise.all([
        authedFetch('/api/consignments?action=consignments'),
        authedFetch('/api/consignments?action=branches'),
        authedFetch('/api/consignments?action=in_transit_stock'),
        authedFetch('/api/consignments?action=at_branch_stock'),
      ])
      setConsignments(((await cR.json()).data || []).filter(isInFlight))
      setBranches((await bR.json()).data || [])
      setInTransitBills((await sR.json()).data || [])
      setAtBranchBills((await abR.json()).data || [])
    } catch (e) {
      setToast({ msg: e.message || 'Load failed', type: 'error' })
    }
    setLoading(false)
  }

  const branchByName = useMemo(() => {
    const m = {}; branches.forEach(b => { m[b.name] = b }); return m
  }, [branches])

  const regions = useMemo(() => [...new Set(branches.map(b => b.region).filter(Boolean))].sort(), [branches])

  // ── Filtered data (consignment-level + bill-level) ─────────────────────────
  const filteredCons = useMemo(() => consignments.filter(c => {
    const dt = c.dispatched_at || c.created_at
    if (fromDate && (!dt || dt.slice(0, 10) < fromDate)) return false
    if (toDate   && (!dt || dt.slice(0, 10) > toDate))   return false
    if (filterRegion) { if (branchByName[c.branch_name]?.region !== filterRegion) return false }
    if (filterType   && c.movement_type !== filterType)  return false
    if (filterBranch && c.branch_name   !== filterBranch) return false
    if (search) {
      const q = search.toLowerCase()
      if (![c.tmp_prf_no, c.challan_no, c.branch_name, c.dest_branch].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  }), [consignments, fromDate, toDate, filterRegion, filterType, filterBranch, search, branchByName])

  // Source bills depend on tab. In Consignment uses tracked + untracked; At Branch uses purchases.stock_status='at_branch'.
  const sourceBills = mode === 'at_branch' ? atBranchBills : inTransitBills

  const filteredBills = useMemo(() => sourceBills.filter(b => {
    const dt = b.consignment?.dispatched_at || b.consignment?.created_at || b.purchase_date
    if (fromDate && dt && dt.slice(0, 10) < fromDate) return false
    if (toDate   && dt && dt.slice(0, 10) > toDate)   return false
    if (filterRegion) {
      const branchKey = b.current_branch || b.branch_name
      if (branchByName[branchKey]?.region !== filterRegion) return false
    }
    if (filterBranch) {
      const branchKey = b.current_branch || b.branch_name
      if (branchKey !== filterBranch) return false
    }
    if (mode === 'in_consignment' && filterType && b.consignment?.movement_type && b.consignment.movement_type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      const fields = [b.application_id, String(b.sl_no || ''), b.branch_name, b.current_branch, b.customer_name, b.consignment?.tmp_prf_no]
      if (!fields.some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  }), [sourceBills, mode, fromDate, toDate, filterRegion, filterBranch, filterType, search, branchByName])

  // ── Aggregates ─────────────────────────────────────────────────────────────
  const k = useMemo(() => {
    const totalBills    = filteredBills.length
    const totalGross    = filteredBills.reduce((s, b) => s + parseFloat(b.gross_weight || 0), 0)
    const totalNet      = filteredBills.reduce((s, b) => s + parseFloat(b.net_weight || 0), 0)
    const totalValue    = filteredBills.reduce((s, b) => s + parseFloat(b.total_amount || 0), 0)
    const consignmentCount = mode === 'in_consignment' ? filteredCons.length : 0
    const internalCount    = mode === 'in_consignment' ? filteredCons.filter(c => c.movement_type === 'INTERNAL').length : 0
    const externalCount    = mode === 'in_consignment' ? filteredCons.filter(c => c.movement_type === 'EXTERNAL').length : 0
    const untrackedCount   = mode === 'in_consignment' ? filteredBills.filter(b => !b.consignment).length : 0
    const oldestDays = mode === 'in_consignment' && filteredCons.length
      ? Math.max(...filteredCons.map(c => daysSince(c.dispatched_at || c.created_at)))
      : (mode === 'at_branch' && filteredBills.length
          ? Math.max(...filteredBills.map(b => daysSince(b.purchase_date)))
          : 0)
    const avgDays = mode === 'in_consignment' && filteredCons.length
      ? Math.round(filteredCons.reduce((s, c) => s + daysSince(c.dispatched_at || c.created_at), 0) / filteredCons.length)
      : (mode === 'at_branch' && filteredBills.length
          ? Math.round(filteredBills.reduce((s, b) => s + daysSince(b.purchase_date), 0) / filteredBills.length)
          : 0)
    const staleCount = mode === 'in_consignment'
      ? filteredCons.filter(c => daysSince(c.dispatched_at || c.created_at) > 3).length
      : filteredBills.filter(b => daysSince(b.purchase_date) > 7).length
    const avgValuePerConsignment = consignmentCount ? totalValue / consignmentCount : 0
    const avgBillsPerConsignment = consignmentCount ? totalBills / consignmentCount : 0
    return {
      totalBills, totalGross, totalNet, totalValue,
      consignmentCount, internalCount, externalCount,
      untrackedCount, oldestDays, avgDays, staleCount,
      avgValuePerConsignment, avgBillsPerConsignment,
    }
  }, [filteredBills, filteredCons, mode])

  // ── Region rollup ──────────────────────────────────────────────────────────
  // Branch key = current_branch (physical location) when present, else origin branch_name.
  // Matters because INTERNAL transfers update current_branch to the destination hub but keep stock_status='at_branch'.
  const byRegion = useMemo(() => {
    const m = {}
    filteredBills.forEach(b => {
      const branchKey = b.current_branch || b.branch_name
      const region = branchByName[branchKey]?.region || 'Unknown'
      if (!m[region]) m[region] = { region, bills: 0, gross: 0, value: 0, consignments: new Set() }
      m[region].bills += 1
      m[region].gross += parseFloat(b.gross_weight || 0)
      m[region].value += parseFloat(b.total_amount || 0)
      if (b.consignment?.id) m[region].consignments.add(b.consignment.id)
    })
    return Object.values(m)
      .map(x => ({ ...x, consignments: x.consignments.size }))
      .sort((a, b) => b.value - a.value)
  }, [filteredBills, branchByName])

  // ── Branch rollup ──────────────────────────────────────────────────────────
  const byBranch = useMemo(() => {
    const m = {}
    filteredBills.forEach(b => {
      const key = b.current_branch || b.branch_name
      if (!m[key]) {
        m[key] = {
          branch: key,
          region: branchByName[key]?.region || '—',
          bills: 0, gross: 0, value: 0,
          consignmentIds: new Set(), movementTypes: new Set(),
          oldestDispatchedAt: null, untrackedBills: 0,
        }
      }
      m[key].bills += 1
      m[key].gross += parseFloat(b.gross_weight || 0)
      m[key].value += parseFloat(b.total_amount || 0)
      if (b.consignment) {
        m[key].consignmentIds.add(b.consignment.id)
        m[key].movementTypes.add(b.consignment.movement_type)
        const dt = b.consignment.dispatched_at || b.consignment.created_at
        if (dt && (!m[key].oldestDispatchedAt || new Date(dt) < new Date(m[key].oldestDispatchedAt))) {
          m[key].oldestDispatchedAt = dt
        }
      } else { m[key].untrackedBills += 1 }
    })
    return Object.values(m)
      .map(x => ({ ...x, consignments: x.consignmentIds.size }))
      .sort((a, b) => b.value - a.value)
  }, [filteredBills, branchByName])

  // ── Routes (source → destination matrix) ──────────────────────────────────
  const byRoute = useMemo(() => {
    const m = {}
    filteredCons.forEach(c => {
      const dest = c.movement_type === 'INTERNAL' ? c.dest_branch : 'Head Office'
      const key = `${c.branch_name} → ${dest}`
      if (!m[key]) m[key] = { route: key, source: c.branch_name, dest, type: c.movement_type, count: 0, bills: 0, gross: 0, value: 0 }
      m[key].count += 1
      m[key].bills += c.total_bills || 0
      m[key].gross += parseFloat(c.total_gross_wt || c.total_net_wt || 0)
      m[key].value += parseFloat(c.total_amount || 0)
    })
    return Object.values(m).sort((a, b) => b.value - a.value)
  }, [filteredCons])

  // ── Trend (last 30 days) ───────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const map = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      map[key] = { date: key, label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), consignments: 0, bills: 0, gross: 0, value: 0 }
    }
    filteredCons.forEach(c => {
      const key = (c.dispatched_at || c.created_at || '').slice(0, 10)
      if (map[key]) {
        map[key].consignments += 1
        map[key].bills        += c.total_bills || 0
        map[key].gross        += parseFloat(c.total_gross_wt || c.total_net_wt || 0)
        map[key].value        += parseFloat(c.total_amount || 0)
      }
    })
    return Object.values(map)
  }, [filteredCons])

  // ── Aging buckets — different brackets per mode ────────────────────────────
  const agingData = useMemo(() => {
    if (mode === 'at_branch') {
      const buckets = [
        { name: '0-2 days',   count: 0, value: 0, color: '#3aaa6a' },
        { name: '3-7 days',   count: 0, value: 0, color: '#c9a84c' },
        { name: '8-14 days',  count: 0, value: 0, color: '#e58a3b' },
        { name: '15+ days',   count: 0, value: 0, color: '#e05555' },
      ]
      filteredBills.forEach(b => {
        const d = daysSince(b.purchase_date)
        const bucket = d <= 2 ? buckets[0] : d <= 7 ? buckets[1] : d <= 14 ? buckets[2] : buckets[3]
        bucket.count++
        bucket.value += Number(b.total_amount || 0)
      })
      return buckets
    }
    // in_consignment mode — buckets based on dispatch date
    const buckets = [
      { name: '0-1 days',  count: 0, value: 0, color: '#3aaa6a' },
      { name: '2-3 days',  count: 0, value: 0, color: '#c9a84c' },
      { name: '4-7 days',  count: 0, value: 0, color: '#e58a3b' },
      { name: '8+ days',   count: 0, value: 0, color: '#e05555' },
      { name: 'Untracked', count: 0, value: 0, color: '#777' },
    ]
    filteredBills.forEach(b => {
      const dt = b.consignment?.dispatched_at || b.consignment?.created_at
      if (!dt) { buckets[4].count++; buckets[4].value += Number(b.total_amount || 0); return }
      const d = daysSince(dt)
      const bucket = d <= 1 ? buckets[0] : d <= 3 ? buckets[1] : d <= 7 ? buckets[2] : buckets[3]
      bucket.count++
      bucket.value += Number(b.total_amount || 0)
    })
    return buckets
  }, [filteredBills, mode])

  // ── Movement type donut ────────────────────────────────────────────────────
  const movementData = useMemo(() => [
    { name: 'Direct → HO',  value: k.externalCount, color: t.gold },
    { name: 'Branch → Hub', value: k.internalCount, color: '#5ec1d6' },
  ].filter(d => d.value > 0), [k, t])

  // ── Insights (mode-aware) ──────────────────────────────────────────────────
  const insights = useMemo(() => {
    const out = []
    if (!filteredBills.length) return out
    if (mode === 'at_branch') {
      if (byBranch[0]) out.push(`${byBranch[0].branch} holds the most stock: ${byBranch[0].bills} bill${byBranch[0].bills !== 1 ? 's' : ''} worth ${fmtINR(byBranch[0].value)}.`)
      if (k.staleCount > 0) out.push(`${k.staleCount} bill${k.staleCount !== 1 ? 's' : ''} have been at branch > 7 days — consider consigning to clear inventory.`)
      if (k.oldestDays > 14) out.push(`Oldest bill at branch is ${k.oldestDays} days old.`)
      if (byBranch.length > 5) out.push(`Stock spread across ${byBranch.length} branches — top 3 hold ${Math.round((byBranch.slice(0, 3).reduce((s, b) => s + b.value, 0) / k.totalValue) * 100)}% of value.`)
    } else {
      if (byBranch[0]) out.push(`${byBranch[0].branch} has the highest in-flight value: ${fmtINR(byBranch[0].value)} across ${byBranch[0].bills} bill${byBranch[0].bills !== 1 ? 's' : ''}.`)
      if (k.untrackedCount > 0) out.push(`${k.untrackedCount} bill${k.untrackedCount !== 1 ? 's' : ''} marked in-transit have no consignment record.`)
      if (k.staleCount > 0) out.push(`${k.staleCount} consignment${k.staleCount !== 1 ? 's' : ''} dispatched > 3 days ago — review with logistics.`)
      if (k.consignmentCount > 0) {
        const pct = Math.round((k.externalCount / k.consignmentCount) * 100)
        out.push(`${pct}% of tracked consignments are Direct → HO (${k.externalCount}); rest are Branch → Hub (${k.internalCount}).`)
      }
    }
    return out
  }, [filteredBills, byBranch, k, mode])

  const hasFilters = !!(fromDate || toDate || filterRegion || filterType || filterBranch || search)
  const showSection = (key) => !activeSection || activeSection === key

  // ── Quick range setters ────────────────────────────────────────────────────
  const setQuickRange = (days) => {
    const today = new Date()
    const from  = new Date(today); from.setDate(from.getDate() - days + 1)
    setFromDate(from.toISOString().slice(0, 10))
    setToDate(today.toISOString().slice(0, 10))
  }
  const setThisMonth = () => {
    const now = new Date()
    setFromDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
    setToDate(now.toISOString().slice(0, 10))
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '.72rem', outline: 'none', cursor: 'pointer' }
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  // ── Loading / empty ────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><GoldSpinner /></div>

  return (
    <div style={{ padding: isMobile ? '14px 12px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '5px' }}>Analytics</div>
          <div style={{ fontSize: isMobile ? '1.2rem' : '1.6rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em', lineHeight: 1 }}>Consignment Reports</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '5px' }}>
            {mode === 'at_branch'
              ? `${k.totalBills} bill${k.totalBills !== 1 ? 's' : ''} at branch · stock awaiting dispatch`
              : <>
                  {k.totalBills} bill{k.totalBills !== 1 ? 's' : ''} in transit
                  {k.consignmentCount > 0 && ` · ${k.consignmentCount} active consignment${k.consignmentCount !== 1 ? 's' : ''}`}
                  {k.untrackedCount > 0 && <span style={{ color: t.orange }}> · {k.untrackedCount} untracked</span>}
                </>
            }
          </div>
        </div>
        <button onClick={fetchAll} style={{ ...inp, color: t.text2, padding: '6px 14px', fontSize: '11px' }}>⟳ Refresh</button>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '5px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '11px', alignSelf: 'flex-start' }}>
        {[
          { key: 'at_branch',      label: 'At Branch',      hint: 'Stock awaiting dispatch' },
          { key: 'in_consignment', label: 'In Consignment', hint: 'Stock in transit' },
        ].map(m => {
          const active = mode === m.key
          const billCount = m.key === 'at_branch' ? atBranchBills.length : inTransitBills.length
          return (
            <button key={m.key} onClick={() => setMode(m.key)}
              title={m.hint}
              style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: active ? t.gold : 'transparent', color: active ? '#0a0a0a' : t.text3, fontSize: '12px', fontWeight: active ? 600 : 400, letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {m.label}
              <span style={{ fontSize: '10px', opacity: 0.7, fontWeight: 500 }}>{billCount}</span>
            </button>
          )
        })}
      </div>

      {/* Filter bar */}
      <div style={{ ...card, padding: isMobile ? '10px 12px' : '14px 18px' }}>
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', marginBottom: '10px', scrollbarWidth: 'none' }}>
          {[['7D', () => setQuickRange(7)], ['30D', () => setQuickRange(30)], ['90D', () => setQuickRange(90)], ['This Month', setThisMonth], ['All', () => { setFromDate(''); setToDate('') }]].map(([lbl, fn]) => (
            <button key={lbl} onClick={fn} style={{ padding: '5px 12px', borderRadius: '100px', border: `1px solid ${t.border}`, background: 'transparent', color: t.text3, fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: t.text4 }}>From</span>
            <input type="date" style={inp} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: t.text4 }}>To</span>
            <input type="date" style={inp} value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          {/* Region dropdown — hidden when user is restricted to a single region */}
          {!regionAccess.single && (
            <select style={inp} value={filterRegion} onChange={e => setFilterRegion(e.target.value)}>
              <option value="">All Regions</option>
              {(regionAccess.restricted ? regions.filter(r => regionAccess.regions.includes(r.region)) : regions)
                .map(r => <option key={r.region || r} value={r.region || r}>{r.region || r}</option>)}
            </select>
          )}
          <select style={inp} value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
            <option value="">All Branches</option>
            {[...new Set([...consignments.map(c => c.branch_name), ...inTransitBills.map(b => b.branch_name)])]
              .filter(b => !regionAccess.restricted || regionAccess.regions.includes(branchByName[b]?.region))
              .sort()
              .map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select style={inp} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            <option value="EXTERNAL">Direct → HO</option>
            <option value="INTERNAL">Branch → Hub</option>
          </select>
          <input style={{ ...inp, minWidth: '180px' }} placeholder="Search PRF / branch / customer…" value={search} onChange={e => setSearch(e.target.value)} />
          {hasFilters && (
            <button onClick={() => { setFromDate(''); setToDate(''); setFilterRegion(''); setFilterType(''); setFilterBranch(''); setSearch('') }}
              style={{ ...inp, color: t.gold, borderColor: `${t.gold}40`, padding: '8px 14px' }}>Clear all</button>
          )}
        </div>
      </div>

      {/* KPI Row 1: Volume — same shape both modes */}
      <KpiGrid t={t} isMobile={isMobile} cols={4}>
        <Kpi label={mode === 'at_branch' ? 'Bills At Branch' : 'Bills In Transit'} value={fmt(k.totalBills)} sub={mode === 'at_branch' ? 'awaiting dispatch' : 'across consignments + untracked'} color={t.gold} t={t} />
        <Kpi label="Gross Weight"        value={fmtWt(k.totalGross)}    sub="canonical for documents"          color={t.text1} t={t} />
        <Kpi label="Net Weight"          value={fmtWt(k.totalNet)}      sub="net of stone & wastage"           color={t.text2} t={t} />
        <Kpi label="Total Value"         value={fmtINR(k.totalValue)}   sub="aggregate goods value"            color={t.green} t={t} />
      </KpiGrid>

      {/* KPI Row 2: only in_consignment mode (consignment shape doesn't apply to at_branch) */}
      {mode === 'in_consignment' && (
        <KpiGrid t={t} isMobile={isMobile} cols={4}>
          <Kpi label="Active Consignments" value={fmt(k.consignmentCount)} sub={`${k.externalCount} HO · ${k.internalCount} Hub`} color={t.blue}   t={t} />
          <Kpi label="Avg Bills / Consign" value={k.avgBillsPerConsignment.toFixed(1)} sub="bills per dispatch"                  color={t.text2}  t={t} />
          <Kpi label="Avg Value / Consign" value={fmtINR(k.avgValuePerConsignment)}    sub="value per dispatch"                  color={t.text2}  t={t} />
          <Kpi label="Untracked Bills"     value={fmt(k.untrackedCount)}  sub={k.untrackedCount > 0 ? 'no consignment record' : 'all linked'} color={k.untrackedCount > 0 ? t.orange : t.green} t={t} />
        </KpiGrid>
      )}

      {/* KPI Row 3: Aging — labels differ by mode */}
      <KpiGrid t={t} isMobile={isMobile} cols={3}>
        <Kpi label={mode === 'at_branch' ? 'Oldest At Branch' : 'Oldest In Flight'} value={`${k.oldestDays} day${k.oldestDays !== 1 ? 's' : ''}`} sub={mode === 'at_branch' ? (k.oldestDays > 7 ? 'long-staying stock' : 'within window') : (k.oldestDays > 3 ? 'check with logistics' : 'within window')} color={mode === 'at_branch' ? (k.oldestDays > 7 ? t.red : t.text2) : (k.oldestDays > 3 ? t.red : t.text2)} t={t} />
        <Kpi label={mode === 'at_branch' ? 'Avg Days At Branch' : 'Avg Days In Transit'} value={`${k.avgDays} day${k.avgDays !== 1 ? 's' : ''}`} sub={mode === 'at_branch' ? 'across at-branch bills' : 'across active consignments'} color={t.text2} t={t} />
        <Kpi label={mode === 'at_branch' ? 'Stale (>7 days)' : 'Stale (>3 days)'} value={fmt(k.staleCount)} sub={k.staleCount > 0 ? 'past expected window' : 'all on schedule'} color={k.staleCount > 0 ? t.orange : t.green} t={t} />
      </KpiGrid>

      {/* Region pills (clickable filter) — hidden for single-region users (only one option, no value) */}
      {byRegion.length > 0 && !regionAccess.single && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {!regionAccess.restricted && (
            <RegionPill label="ALL"                     bills={k.totalBills} gross={k.totalGross} value={k.totalValue} color={t.gold} active={!filterRegion} onClick={() => setFilterRegion('')} t={t} />
          )}
          {byRegion.map(r => (
            <RegionPill key={r.region} label={r.region.toUpperCase()} bills={r.bills} gross={r.gross} value={r.value} color={REGION_COLOR[r.region] || t.gold} active={filterRegion === r.region} onClick={() => setFilterRegion(filterRegion === r.region ? '' : r.region)} t={t} />
          ))}
        </div>
      )}

      {/* Insights strip */}
      {insights.length > 0 && (
        <div style={{ ...card, padding: '12px 18px' }}>
          <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px' }}>Insights</div>
          {insights.map((s, i) => <div key={i} style={{ fontSize: '12px', color: t.text2, lineHeight: 1.6 }}>· {s}</div>)}
        </div>
      )}

      {/* Section nav (sections differ per mode — at_branch has simpler set) */}
      {(() => {
        const sections = mode === 'at_branch' ? SECTIONS_AT : SECTIONS_IN
        return (
          <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', padding: '6px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '11px' }}>
            <button onClick={() => setActiveSection(null)}
              style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: !activeSection ? t.gold : 'transparent', color: !activeSection ? '#0a0a0a' : t.text3, fontSize: '11px', fontWeight: !activeSection ? 600 : 400, letterSpacing: '.04em', flexShrink: 0 }}>All</button>
            {sections.map(sec => (
              <button key={sec.key} onClick={() => setActiveSection(activeSection === sec.key ? null : sec.key)}
                style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: activeSection === sec.key ? t.gold : 'transparent', color: activeSection === sec.key ? '#0a0a0a' : t.text3, fontSize: '11px', fontWeight: activeSection === sec.key ? 600 : 400, letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <span style={{ fontSize: '13px' }}>{sec.icon}</span>{sec.label}
              </button>
            ))}
          </div>
        )
      })()}

      {/* ── SECTIONS ─────────────────────────────────────────────────────────── */}
      {mode === 'in_consignment' && showSection('trends')       && <SectionTrends       trendData={trendData}     t={t} card={card} />}
      {showSection('distribution') && <SectionDistribution mode={mode} agingData={agingData} movementData={movementData} byRegion={byRegion} t={t} card={card} />}
      {showSection('branches')     && <SectionBranches     byBranch={byBranch}       t={t} card={card} />}
      {mode === 'in_consignment' && showSection('routes')       && <SectionRoutes       byRoute={byRoute}         t={t} card={card} />}
      {mode === 'in_consignment' && showSection('aging')        && <SectionAging        consignments={filteredCons} t={t} card={card} />}
      {mode === 'in_consignment' && showSection('untracked')    && <SectionUntracked    bills={filteredBills}     t={t} card={card} />}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable cards
// ─────────────────────────────────────────────────────────────────────────────
function KpiGrid({ t, isMobile, cols, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : `repeat(${cols}, 1fr)`, gap: '1px', background: t.border, borderRadius: '11px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
      {children}
    </div>
  )
}

function Kpi({ label, value, sub, color, t }) {
  return (
    <div style={{ background: t.card, padding: '14px 18px' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '7px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 300, color, lineHeight: 1, fontFamily: 'monospace' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '5px' }}>{sub}</div>}
    </div>
  )
}

function RegionPill({ label, bills, gross, value, color, active, onClick, t }) {
  return (
    <button onClick={onClick}
      style={{ background: active ? `${color}15` : t.card, border: `1px solid ${active ? color : t.border}`, borderRadius: '11px', padding: '12px 16px', cursor: 'pointer', textAlign: 'left', minWidth: '170px', transition: 'all .15s' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 300, color, fontFamily: 'monospace', marginTop: '6px' }}>{fmtWt(gross)}</div>
      <div style={{ fontSize: '10px', color: t.text3, marginTop: '4px' }}>{bills} bill{bills !== 1 ? 's' : ''} · {fmtINR(value)}</div>
    </button>
  )
}

function SectionCard({ title, t, card, children }) {
  return (
    <div style={{ ...card, padding: '14px 18px' }}>
      <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '12px', fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  )
}

function tooltipStyle(t) {
  return { contentStyle: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, color: t.text1, fontSize: 12 } }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

function SectionTrends({ trendData, t, card }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
      <SectionCard title="Daily dispatch trend (last 30 days)" t={t} card={card}>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.gold} stopOpacity={0.4} />
                <stop offset="100%" stopColor={t.gold} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
            <XAxis dataKey="label" tick={{ fill: t.text3, fontSize: 10 }} stroke={t.border} interval="preserveStartEnd" />
            <YAxis tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} allowDecimals={false} />
            <Tooltip {...tooltipStyle(t)} />
            <Legend wrapperStyle={{ fontSize: 11, color: t.text3 }} />
            <Area type="monotone" dataKey="consignments" stroke={t.gold} fill="url(#g1)" name="Consignments" strokeWidth={2} />
            <Line type="monotone" dataKey="bills"        stroke="#5ec1d6" name="Bills" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="Daily value & weight (last 30 days)" t={t} card={card}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
            <XAxis dataKey="label" tick={{ fill: t.text3, fontSize: 10 }} stroke={t.border} interval="preserveStartEnd" />
            <YAxis yAxisId="left"  tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} />
            <Tooltip {...tooltipStyle(t)} />
            <Legend wrapperStyle={{ fontSize: 11, color: t.text3 }} />
            <Line yAxisId="left"  type="monotone" dataKey="value" stroke={t.green} name="Value (₹)"    strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="gross" stroke={t.gold}  name="Gross (g)"   strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

function SectionDistribution({ mode, agingData, movementData, byRegion, t, card }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '12px' }}>
      <SectionCard title={mode === 'at_branch' ? 'Aging buckets (days at branch)' : 'Aging buckets (days in transit)'} t={t} card={card}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={agingData}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
            <XAxis dataKey="name" tick={{ fill: t.text3, fontSize: 10 }} stroke={t.border} />
            <YAxis tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} allowDecimals={false} />
            <Tooltip {...tooltipStyle(t)} />
            <Bar dataKey="count" name="Bills" radius={[4, 4, 0, 0]}>
              {agingData.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {mode === 'in_consignment' && (
        <SectionCard title="Movement type split" t={t} card={card}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={movementData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {movementData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip {...tooltipStyle(t)} />
              <Legend wrapperStyle={{ fontSize: 11, color: t.text3 }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      <SectionCard title={mode === 'at_branch' ? 'By region — bills at branch' : 'By region — bills in flight'} t={t} card={card}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={byRegion} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
            <XAxis type="number" tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} allowDecimals={false} />
            <YAxis type="category" dataKey="region" tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} width={120} />
            <Tooltip {...tooltipStyle(t)} />
            <Bar dataKey="bills" name="Bills" radius={[0, 4, 4, 0]}>
              {byRegion.map((e, i) => <Cell key={i} fill={REGION_COLOR[e.region] || t.gold} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

function SectionBranches({ byBranch, t, card }) {
  const max = byBranch[0]?.value || 1
  return (
    <SectionCard title={`Branches — ${byBranch.length}`} t={t} card={card}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['#', 'Branch', 'Region', 'Bills', 'Gross', 'Value', 'Consignments', 'Untracked', 'Oldest'].map(h =>
              <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: ['Bills', 'Gross', 'Value', 'Consignments', 'Untracked', 'Oldest'].includes(h) ? 'right' : 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {byBranch.map((r, i) => {
            const oldDays = r.oldestDispatchedAt ? daysSince(r.oldestDispatchedAt) : null
            const oldColor = oldDays == null ? t.text4 : oldDays > 7 ? t.red : oldDays > 3 ? t.orange : t.text2
            const pct = r.value > 0 ? (r.value / max) * 100 : 0
            return (
              <tr key={r.branch} style={{ borderBottom: `1px solid ${t.border}20` }}>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text4 }}>{i + 1}</td>
                <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, fontWeight: 600, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${t.gold}10, transparent)`, pointerEvents: 'none' }} />
                  <span style={{ position: 'relative' }}>{r.branch}</span>
                </td>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: REGION_COLOR[r.region] || t.text3 }}>{r.region}</td>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text2, textAlign: 'right' }}>{fmt(r.bills)}</td>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtWt(r.gross)}</td>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>{fmtINR(r.value)}</td>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text2, textAlign: 'right' }}>{r.consignments || '—'}</td>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: r.untrackedBills > 0 ? t.orange : t.text4, textAlign: 'right', fontWeight: r.untrackedBills > 0 ? 600 : 400 }}>{r.untrackedBills || '—'}</td>
                <td style={{ padding: '9px 12px', fontSize: '11px', color: oldColor, textAlign: 'right' }}>{oldDays != null ? `${oldDays}d` : '—'}</td>
              </tr>
            )
          })}
          {byBranch.length === 0 && (
            <tr><td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No bills in transit match the filters.</td></tr>
          )}
        </tbody>
      </table>
    </SectionCard>
  )
}

function SectionRoutes({ byRoute, t, card }) {
  if (byRoute.length === 0) {
    return <SectionCard title="Routes" t={t} card={card}><div style={{ padding: '20px 0', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No active routes — create a consignment to see flow patterns.</div></SectionCard>
  }
  return (
    <SectionCard title={`Routes — ${byRoute.length}`} t={t} card={card}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Source', 'Destination', 'Type', 'Consignments', 'Bills', 'Gross', 'Value'].map(h =>
              <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: ['Consignments', 'Bills', 'Gross', 'Value'].includes(h) ? 'right' : 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {byRoute.map(r => (
            <tr key={r.route} style={{ borderBottom: `1px solid ${t.border}20` }}>
              <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, fontWeight: 600 }}>{r.source}</td>
              <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text1 }}>{r.dest}</td>
              <td style={{ padding: '9px 12px', fontSize: '10px', color: r.type === 'INTERNAL' ? '#5ec1d6' : t.gold }}>
                <span style={{ background: `${r.type === 'INTERNAL' ? '#5ec1d6' : t.gold}15`, padding: '2px 8px', borderRadius: 4 }}>{r.type === 'INTERNAL' ? 'Via Hub' : 'Direct → HO'}</span>
              </td>
              <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text2, textAlign: 'right' }}>{r.count}</td>
              <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text2, textAlign: 'right' }}>{fmt(r.bills)}</td>
              <td style={{ padding: '9px 12px', fontSize: '11px', color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(r.gross)}</td>
              <td style={{ padding: '9px 12px', fontSize: '11px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>{fmtINR(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  )
}

function SectionAging({ consignments, t, card }) {
  const sorted = [...consignments].sort((a, b) => {
    const da = new Date(a.dispatched_at || a.created_at).getTime()
    const db = new Date(b.dispatched_at || b.created_at).getTime()
    return da - db
  })
  return (
    <SectionCard title={`Aging — oldest first (${sorted.length})`} t={t} card={card}>
      {sorted.length === 0 && (
        <div style={{ padding: '20px 0', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No active consignments to age.</div>
      )}
      {sorted.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['PRF #', 'Source → Dest', 'Type', 'Bills', 'Value', 'Dispatched', 'Days'].map(h =>
                <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: ['Bills', 'Value', 'Days'].includes(h) ? 'right' : 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map(c => {
              const d = daysSince(c.dispatched_at || c.created_at)
              const color = d > 7 ? t.red : d > 3 ? t.orange : t.text2
              const isInternal = c.movement_type === 'INTERNAL'
              return (
                <tr key={c.id} style={{ borderBottom: `1px solid ${t.border}20` }}>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.gold, fontFamily: 'monospace' }}>{c.tmp_prf_no}</td>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text2 }}>{c.branch_name} → {isInternal ? c.dest_branch : 'HO'}</td>
                  <td style={{ padding: '9px 12px', fontSize: '10px', color: isInternal ? '#5ec1d6' : t.gold }}>
                    <span style={{ background: `${isInternal ? '#5ec1d6' : t.gold}15`, padding: '2px 8px', borderRadius: 4 }}>{isInternal ? 'Hub' : 'HO'}</span>
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.blue, fontFamily: 'monospace', textAlign: 'right' }}>{fmtINR(c.total_amount)}</td>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text3 }}>{fmtDate(c.dispatched_at)}</td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color, textAlign: 'right', fontWeight: 600 }}>{d}d</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}

function SectionUntracked({ bills, t, card }) {
  const u = bills.filter(b => !b.consignment)
  if (u.length === 0) {
    return <SectionCard title="Untracked Bills In Transit" t={t} card={card}><div style={{ padding: '20px 0', textAlign: 'center', color: t.green, fontSize: '12px' }}>✓ All in-transit bills are linked to a consignment record.</div></SectionCard>
  }
  return (
    <div style={{ ...card, padding: 0, borderColor: `${t.orange}60`, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', background: `${t.orange}10`, borderBottom: `1px solid ${t.border}` }}>
        <div style={{ fontSize: '12px', color: t.orange, fontWeight: 600, letterSpacing: '.04em' }}>{u.length} bill{u.length !== 1 ? 's' : ''} in transit without a consignment record</div>
        <div style={{ fontSize: '10px', color: t.text3, marginTop: '4px' }}>Marked stock_status='in_consignment' but no dispatched consignment links them. Either create a consignment or revert the status.</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['App ID', 'Branch', 'Customer', 'Date', 'Gross', 'Net', 'Value'].map(h =>
              <th key={h} style={{ padding: '8px 12px', fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: ['Gross', 'Net', 'Value'].includes(h) ? 'right' : 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {u.slice(0, 200).map(b => (
            <tr key={b.id} style={{ borderBottom: `1px solid ${t.border}20` }}>
              <td style={{ padding: '8px 12px', fontSize: '11px', color: t.gold, fontFamily: 'monospace' }}>{b.application_id || b.sl_no || '—'}</td>
              <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text1 }}>{b.branch_name}</td>
              <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text2 }}>{b.customer_name || '—'}</td>
              <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text3 }}>{fmtDate(b.purchase_date)}</td>
              <td style={{ padding: '8px 12px', fontSize: '11px', color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(b.gross_weight)}</td>
              <td style={{ padding: '8px 12px', fontSize: '11px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(b.net_weight)}</td>
              <td style={{ padding: '8px 12px', fontSize: '11px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>{fmtINR(b.total_amount)}</td>
            </tr>
          ))}
          {u.length > 200 && (
            <tr><td colSpan={7} style={{ padding: '12px', textAlign: 'center', color: t.text4, fontSize: '11px' }}>Showing first 200 — apply a filter to narrow down further.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
