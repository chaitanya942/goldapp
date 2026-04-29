'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { useApp } from '../../../lib/context'
import { THEMES, STATES, fmt, fmtVal, fmtDate, pct, getStyles, exportReportPDF } from './reportUtils'
import ReportCharts from './ReportCharts'
import ReportDistribution from './ReportDistribution'
import ReportBranches from './ReportBranches'
import ReportCompare from './ReportCompare'
import GoldModal from '../../ui/GoldModal'
import ReportSameDay from './ReportSameDay'
import ReportCrmInsights from './ReportCrmInsights'
import ReportComparePeriods from './ReportComparePeriods'
import ReportUnderperformers from './ReportUnderperformers'

const SECTIONS = [
  { key: 'charts',         label: 'Trends',         icon: '↗' },
  { key: 'distribution',   label: 'Distribution',   icon: '◎' },
  { key: 'branches',       label: 'Branches',       icon: '⬡' },
  { key: 'underperformers',label: 'Underperformers',icon: '⚠' },
  { key: 'sameday',        label: 'Same Day',       icon: '⊙' },
  { key: 'compare',        label: 'Compare',        icon: '⇄' },
  { key: 'crm',            label: 'CRM Insights',   icon: '⚡' },
]

const istNow = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const istStr = (d = istNow()) => d.toISOString().split('T')[0]

const EXPORT_COLS = [
  { key: 'purchase_date',             label: 'Date' },
  { key: 'branch_name',               label: 'Branch' },
  { key: 'customer_name',             label: 'Customer' },
  { key: 'phone_number',              label: 'Phone' },
  { key: 'application_id',            label: 'App ID' },
  { key: 'transaction_type',          label: 'Type' },
  { key: 'gross_weight',              label: 'Gross Wt (g)' },
  { key: 'stone_weight',              label: 'Stone (g)' },
  { key: 'wastage',                   label: 'Wastage (g)' },
  { key: 'net_weight',                label: 'Net Wt (g)' },
  { key: 'purity',                    label: 'Purity (%)' },
  { key: 'total_amount',              label: 'Gross Amt (₹)' },
  { key: 'service_charge_pct',        label: 'Svc %' },
  { key: 'service_charge_amount_crm', label: 'Svc Amt (₹)' },
  { key: 'final_amount_crm',          label: 'Final Amt (₹)' },
  { key: 'stock_status',              label: 'Stock Status' },
]

// ── KPI CARD ──
const DRILL_MAP = {
  'Total Transactions':    { field: 'total_count',          fmt: v => Number(v||0).toLocaleString('en-IN'),  col: 'Bills' },
  'Gross Weight':          { field: 'total_gross',          fmt: v => `${fmt(v)}g`,                          col: 'Gross Wt' },
  'Net Weight':            { field: 'total_net',            fmt: v => `${fmt(v)}g`,                          col: 'Net Wt' },
  'Avg Purity %':          { field: 'avg_purity',           fmt: v => `${Number(v||0).toFixed(2)}%`,         col: 'Avg Purity' },
  'Gross Purchase Value':  { field: 'total_value',          fmt: v => fmtVal(v),                             col: 'Value' },
  'Avg Net Wt / Bill':     { field: 'avg_net_per_txn',      fmt: v => `${fmt(v)}g`,                         col: 'Avg Net Wt' },
  'Avg Service Charge %':  { field: 'avg_service_charge_pct', fmt: v => `${Number(v||0).toFixed(2)}%`,      col: 'Avg Svc %' },
  'Avg Rate / Gram':       { field: 'avg_rate_per_gram',    fmt: v => fmtVal(v),                             col: 'Rate/g' },
  'Transacted Branches':   { field: 'total_count',          fmt: v => Number(v||0).toLocaleString('en-IN'),  col: 'Bills' },
}

function KpiCard({ label, value, sub, color, loading, onClick }) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)',
        transition: 'transform .18s ease, box-shadow .18s ease',
        height: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,0,0,.5), 0 0 0 1px ${color}30`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: '16px', right: '16px', height: '1.5px', background: `linear-gradient(90deg, transparent, ${color}70, transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '.55rem', color: 'var(--text3)', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500 }}>{label}</div>
        {onClick && !loading && <div style={{ fontSize: '9px', color: color, opacity: 0.6, letterSpacing: '.08em' }}>↗ BRANCHES</div>}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        {loading
          ? <div style={{ height: '28px', background: 'var(--border)', borderRadius: '6px', width: '55%', animation: 'shimmer 1.5s infinite' }} />
          : <div style={{ fontSize: '1.45rem', fontWeight: 200, color, letterSpacing: '-.01em', lineHeight: 1 }}>{value ?? '—'}</div>
        }
      </div>
      {sub && !loading && (
        <div style={{ fontSize: '.6rem', color: 'var(--text3)', lineHeight: 1.4 }}>{sub}</div>
      )}
    </div>
  )
}

const autoSize = (str) => {
  const len = String(str).length
  if (len > 12) return '.85rem'
  if (len > 9)  return '1rem'
  if (len > 6)  return '1.15rem'
  return '1.3rem'
}

// ── SPLIT CARD (count OR weight) ──
function SplitCard({ title, leftLabel, leftValue, leftColor, leftSub, rightLabel, rightValue, rightColor, rightSub, loading, t }) {
  const lv = Number(leftValue)  || 0
  const rv = Number(rightValue) || 0
  return (
    <div
      style={{
        background: t.card,
        border: `1px solid ${t.border}`,
        borderRadius: '12px',
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)',
        transition: 'transform .18s ease, box-shadow .18s ease',
        height: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,0,0,.5), 0 0 0 1px ${leftColor}30`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: '16px', right: '16px', height: '1.5px', background: `linear-gradient(90deg, transparent, ${leftColor}70, transparent)` }} />
      <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500 }}>{title}</div>

      {loading ? (
        <div style={{ height: '28px', background: t.border, borderRadius: '6px', width: '55%', animation: 'shimmer 1.5s infinite' }} />
      ) : (
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: autoSize(leftValue), fontWeight: 200, color: leftColor, lineHeight: 1 }}>{leftValue}</div>
            <div style={{ fontSize: '.6rem', color: leftColor, marginTop: '3px', fontWeight: 500 }}>{leftSub}</div>
          </div>
          <div style={{ width: '1px', height: '32px', background: t.border, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: autoSize(rightValue), fontWeight: 200, color: rightColor, lineHeight: 1 }}>{rightValue}</div>
            <div style={{ fontSize: '.6rem', color: rightColor, marginTop: '3px', fontWeight: 500 }}>{rightSub}</div>
          </div>
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', height: '3px', borderRadius: '2px', overflow: 'hidden', gap: '2px' }}>
          <div style={{ flex: lv, background: leftColor,  borderRadius: '2px', transition: 'flex .5s' }} />
          <div style={{ flex: rv, background: rightColor, borderRadius: '2px', transition: 'flex .5s' }} />
        </div>
      )}
    </div>
  )
}

// ── FILTER CHIP ──
function FilterChip({ label, onRemove, color }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '100px', background: `${color}15`, border: `1px solid ${color}40`, fontSize: '.62rem', color }}>
      {label}
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 0, lineHeight: 1, fontSize: '.75rem' }}>✕</button>
    </div>
  )
}

// ── MAIN ──
const SECTION_KEY_MAP = {
  charts:       'element.reports.charts',
  distribution: 'element.reports.distribution',
  branches:     'element.reports.branch_table',
  sameday:      'element.reports.same_day',
  compare:      'element.reports.period_compare',
  crm:          'element.reports.crm_insights',
}

export default function PurchaseReports() {
  const { theme, canSee, syncVersion } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const s = getStyles(t)

  const cssVars = {
    '--bg': t.bg, '--card': t.card, '--card2': t.card2,
    '--text1': t.text1, '--text2': t.text2, '--text3': t.text3, '--text4': t.text4,
    '--gold': t.gold, '--border': t.border, '--border2': t.border2 || t.border,
    '--green': t.green, '--red': t.red, '--blue': t.blue,
  }

  const _now = istNow()
  const _mtdFrom = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-01`
  const [fromDate,      setFromDate]      = useState(_mtdFrom)
  const [toDate,        setToDate]        = useState(istStr(_now))
  const [filterBranch,  setFilterBranch]  = useState('')
  const [filterTxn,     setFilterTxn]     = useState('')
  const [filterRegion,  setFilterRegion]  = useState('')
  const [kpis,          setKpis]          = useState(null)
  const [trend,         setTrend]         = useState([])
  const [monthly,       setMonthly]       = useState([])
  const [branchData,    setBranchData]    = useState([])
  const [stateData,     setStateData]     = useState([])
  const [dowData,       setDowData]       = useState([])
  const [purityDist,    setPurityDist]    = useState([])
  const [weightBuckets, setWeightBuckets] = useState([])
  const [regionSplit,   setRegionSplit]   = useState([])
  const [monthHalf,     setMonthHalf]     = useState([])
  const [timeOfDay,     setTimeOfDay]     = useState([])
  const [topBills,      setTopBills]      = useState([])
  const [branches,      setBranches]      = useState([])
  const [allBranchMeta, setAllBranchMeta] = useState([])
  const [regions,       setRegions]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [activeSection, setActiveSection] = useState(null)
  const [exporting,     setExporting]     = useState(false)
  const [selectedKpi,   setSelectedKpi]   = useState(null)
  const [hourlyTrend,   setHourlyTrend]   = useState([])
  const [error,         setError]         = useState(null)
  const [isMobile,      setIsMobile]      = useState(false)
  const [lastSyncAt,    setLastSyncAt]    = useState(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Fire-and-forget sync on mount so reports reflect latest CRM state.
  // Then poll MAX(updated_at) every 30s to surface "Last synced" freshness.
  useEffect(() => {
    fetch('/api/sync-purchases?days=2', { method: 'POST' }).catch(() => null)
    const fetchLastSync = async () => {
      const { data } = await supabase
        .from('purchases')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
      if (data?.[0]?.updated_at) setLastSyncAt(data[0].updated_at)
    }
    fetchLastSync()
    const id = setInterval(fetchLastSync, 30 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    supabase.from('branches').select('name, region').order('name').then(({ data }) => {
      if (data) {
        setBranches(data.map(b => b.name))
        const uniqueRegions = [...new Set(data.map(b => b.region).filter(Boolean))].sort()
        setRegions(uniqueRegions)
      }
    })
  }, [])

  useEffect(() => { fetchAll() }, [fromDate, toDate, filterBranch, filterTxn, filterRegion, syncVersion])

  const fetchAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const isSingleDay = fromDate && toDate && fromDate === toDate

      // Branch metadata: resolve region filter + populate allBranchMeta for export
      const { data: branchMeta } = await supabase.from('branches').select('name, region, state, cluster')
      setAllBranchMeta(branchMeta || [])

      let regionBranchNames = null
      if (filterRegion) {
        regionBranchNames = (branchMeta || []).filter(b => b.region === filterRegion).map(b => b.name)
      }

      const params = new URLSearchParams()
      if (fromDate)          params.set('from', fromDate)
      if (toDate)            params.set('to', toDate)
      if (filterBranch)      params.set('branch', filterBranch)
      if (filterTxn)         params.set('txn_type', filterTxn)
      if (regionBranchNames) params.set('region_branches', regionBranchNames.join(','))
      if (isSingleDay)       params.set('single_day', 'true')

      const res = await fetch(`/api/report-aggregates?${params}`)
      if (!res.ok) throw new Error(`Aggregates API error: ${res.status}`)
      const agg = await res.json()
      if (agg.error) throw new Error(agg.error)

      if (agg.empty || !agg.kpis) {
        setKpis(null); setTrend([]); setBranchData([]); setStateData([])
        setMonthly([]); setDowData([]); setPurityDist([]); setWeightBuckets([])
        setRegionSplit([]); setMonthHalf([]); setTimeOfDay([]); setTopBills([])
        setHourlyTrend([])
        setLoading(false)
        return
      }

      setKpis(agg.kpis)
      setTrend(agg.trend)
      setMonthly(agg.monthly)
      setBranchData(agg.branchData)
      setStateData([])
      setDowData(agg.dowData)
      setPurityDist(agg.purityDist)
      setWeightBuckets(agg.weightBuckets)
      setRegionSplit(agg.regionSplit)
      setMonthHalf(agg.monthHalf)
      setTimeOfDay(agg.timeOfDay)
      setTopBills(agg.topBills)
      setHourlyTrend(agg.hourlyTrend)
      setLoading(false)
    } catch (err) {
      console.error('Error fetching report data:', err)
      setError(err.message || 'Failed to load report data.')
      setLoading(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      // Resolve region filter to branch names
      let exportRegionBranches = null
      if (filterRegion) {
        const { data: bMeta } = await supabase.from('branches').select('name, region')
        exportRegionBranches = (bMeta || []).filter(b => b.region === filterRegion).map(b => b.name)
      }

      let allRows = [], from = 0
      const CHUNK = 1000
      while (true) {
        let q = supabase.from('purchases').select('*').eq('is_deleted', false).eq('crm_status', 'approved')
        if (fromDate)             q = q.gte('purchase_date', fromDate)
        if (toDate)               q = q.lte('purchase_date', toDate)
        if (filterBranch)         q = q.eq('branch_name', filterBranch)
        if (filterTxn)            q = q.eq('transaction_type', filterTxn)
        if (exportRegionBranches) q = q.in('branch_name', exportRegionBranches)
        q = q.order('purchase_date', { ascending: true }).range(from, from + CHUNK - 1)
        const { data } = await q
        if (!data || data.length === 0) break
        allRows = [...allRows, ...data]
        if (data.length < CHUNK) break
        from += CHUNK
      }
      const ts       = new Date().toISOString().slice(0, 10)
      const tag      = filterBranch ? `_${filterBranch}` : filterRegion ? `_${filterRegion}` : ''
      const filename = `purchase_report${tag}_${ts}.pdf`
      const meta = {
        dateRange: kpis?.min_date ? `${fmtDate(kpis.min_date)} — ${fmtDate(kpis.max_date)}` : 'All time',
        kpis: [
          { label: 'Total Transactions', value: Number(kpis?.total_count || 0).toLocaleString('en-IN') },
          { label: 'Net Weight',         value: `${fmt(kpis?.total_net)}g` },
          { label: 'Avg Purity',         value: `${Number(kpis?.avg_purity || 0).toFixed(2)}%` },
          { label: 'Gross Value',        value: fmtVal(kpis?.total_value) },
          { label: 'Avg Rate/g',         value: fmtVal(kpis?.avg_rate_per_gram) },
          { label: 'Branches',           value: Number(kpis?.branch_count || 0).toLocaleString('en-IN') },
        ],
      }
      await exportReportPDF(allRows, EXPORT_COLS, filename, meta)
    } finally {
      setExporting(false)
    }
  }

  const setToday      = () => { const d = istStr(); setFromDate(d); setToDate(d) }
  const setYesterday  = () => { const d = istNow(); d.setDate(d.getDate() - 1); const s2 = istStr(d); setFromDate(s2); setToDate(s2) }
  const setQuickRange = (days) => { const to = istNow(); const fr = istNow(); fr.setDate(fr.getDate() - days); setToDate(istStr(to)); setFromDate(istStr(fr)) }
  const setThisMonth  = () => { const now = istNow(); setFromDate(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`); setToDate(istStr(now)) }

  const hasFilters    = fromDate || toDate || filterBranch || filterTxn || filterRegion
  const canSeeSection = (key) => canSee(SECTION_KEY_MAP[key] ?? key)
  const showSection   = (key) => canSeeSection(key) && (!activeSection || activeSection === key)
  const visibleSections = SECTIONS.filter(sec => canSeeSection(sec.key))

  const k = kpis

  // computed
  const phTotal  = (Number(k?.physical_count) || 0) + (Number(k?.takeover_count) || 0)
  const phPct    = phTotal > 0 ? ((Number(k?.physical_count) / phTotal) * 100).toFixed(1) : '0.0'
  const tkPct    = phTotal > 0 ? ((Number(k?.takeover_count) / phTotal) * 100).toFixed(1) : '0.0'
  const nwTotal  = (Number(k?.physical_net) || 0) + (Number(k?.takeover_net) || 0)
  const phNwPct  = nwTotal > 0 ? ((Number(k?.physical_net) / nwTotal) * 100).toFixed(1) : '0.0'
  const tkNwPct  = nwTotal > 0 ? ((Number(k?.takeover_net) / nwTotal) * 100).toFixed(1) : '0.0'

  const inp = {
    background: t.card2, border: `1px solid ${t.border}`,
    borderRadius: '8px', padding: '8px 12px', color: t.text1,
    fontSize: '.72rem', outline: 'none', cursor: 'pointer',
  }
  const btnSmall = {
    background: 'transparent', color: t.text3,
    border: `1px solid ${t.border}`,
    borderRadius: '6px', padding: '6px 14px',
    fontSize: '.65rem', letterSpacing: '.06em', textTransform: 'uppercase',
    cursor: 'pointer', transition: 'all .15s',
  }

  const gridRow4  = { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px', marginBottom: '10px', alignItems: 'stretch' }
  const gridRow5  = { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: '10px', marginBottom: '10px', alignItems: 'stretch' }
  const gridRow5b = { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: '10px', marginBottom: isMobile ? '16px' : '28px', alignItems: 'stretch' }

  return (
    <div style={{ padding: isMobile ? '14px 12px' : '28px 32px', maxWidth: '100%', ...cssVars }}>
      <style>{`
        @keyframes shimmer { 0%{opacity:.4} 50%{opacity:.8} 100%{opacity:.4} }
        .pr-pill:hover { border-color: var(--gold) !important; color: var(--gold) !important; }
        .exp-btn:hover { color: var(--gold) !important; border-color: var(--gold) !important; }
      `}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', gap: '12px', marginBottom: isMobile ? '14px' : '24px' }}>
        <div>
          {!isMobile && <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '6px' }}>Analytics</div>}
          <div style={{ fontSize: isMobile ? '1.2rem' : '1.7rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em', lineHeight: 1 }}>Purchase Reports</div>
          <div style={{ fontSize: '.65rem', color: t.text3, marginTop: '5px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{k?.min_date ? `${fmtDate(k.min_date)} — ${fmtDate(k.max_date)}` : 'All time data'}</span>
            {lastSyncAt && (() => {
              const ageMs   = Date.now() - new Date(lastSyncAt).getTime()
              const ageMin  = Math.floor(ageMs / 60000)
              const ageSec  = Math.floor(ageMs / 1000)
              const fresh   = ageMs < 5 * 60 * 1000
              const stale   = ageMs > 15 * 60 * 1000
              const color   = stale ? t.red : fresh ? t.green : t.text3
              const label   = ageSec < 60 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin/60)}h ago`
              return (
                <span style={{ color, display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: fresh ? `0 0 6px ${color}` : 'none', animation: fresh ? 'pulse 2s infinite' : 'none' }} />
                  Last synced {label}
                </span>
              )
            })()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="exp-btn" style={btnSmall} disabled={exporting} onClick={handleExport}>
            {exporting ? 'Generating...' : '↓ PDF'}
          </button>
          {hasFilters && (
            <button
              onClick={() => { setFromDate(''); setToDate(''); setFilterBranch(''); setFilterTxn(''); setFilterRegion('') }}
              style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 16px', color: t.text3, fontSize: '.7rem', cursor: 'pointer' }}
            >
              ✕ Clear All
            </button>
          )}
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: isMobile ? '12px 14px' : '16px 20px', marginBottom: isMobile ? '14px' : '24px', boxShadow: t.shadow }}>
        {/* Quick range pills — horizontal scroll on mobile */}
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', scrollbarWidth: 'none', marginBottom: '10px', paddingBottom: '2px' }}>
          {[
            ['Today',      setToday],
            ['Yesterday',  setYesterday],
            ['7D',         () => setQuickRange(7)],
            ['30D',        () => setQuickRange(30)],
            ['90D',        () => setQuickRange(90)],
            ['This Month', setThisMonth],
          ].map(([lbl, fn]) => (
            <button key={lbl} onClick={fn} className="pr-pill"
              style={{ padding: '5px 12px', borderRadius: '100px', border: `1px solid ${t.border}`, background: 'transparent', color: t.text3, fontSize: '.63rem', cursor: 'pointer', transition: 'all .15s', letterSpacing: '.04em', flexShrink: 0 }}>
              {lbl}
            </button>
          ))}
        </div>
        {/* Date + select controls */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '.6rem', color: t.text4 }}>From</span>
            <input type="date" style={inp} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '.6rem', color: t.text4 }}>To</span>
            <input type="date" style={inp} value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <select style={inp} value={filterRegion} onChange={e => setFilterRegion(e.target.value)}>
            <option value="">All Regions</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select style={inp} value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select style={inp} value={filterTxn} onChange={e => setFilterTxn(e.target.value)}>
            <option value="">All Types</option>
            <option value="PHYSICAL">Physical</option>
            <option value="TAKEOVER">Takeover</option>
          </select>
        </div>
        {hasFilters && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
            {filterRegion && <FilterChip label={filterRegion} onRemove={() => setFilterRegion('')} color={t.blue}   />}
            {filterBranch && <FilterChip label={filterBranch} onRemove={() => setFilterBranch('')} color={t.gold}   />}
            {filterTxn    && <FilterChip label={filterTxn}    onRemove={() => setFilterTxn('')}    color={t.purple} />}
            {(fromDate || toDate) && (
              <FilterChip
                label={`${fromDate ? fmtDate(fromDate) : '…'} → ${toDate ? fmtDate(toDate) : '…'}`}
                onRemove={() => { setFromDate(''); setToDate('') }}
                color={t.green}
              />
            )}
          </div>
        )}
      </div>

      {/* ROW 1 — Volume (4 cols) */}
      <div style={gridRow4}>
        <KpiCard label="Total Transactions"    color={t.gold}  loading={loading}
          value={Number(k?.total_count || 0).toLocaleString('en-IN')} />
        <KpiCard label="Gross Weight"          color={t.text1} loading={loading}
          value={`${fmt(k?.total_gross)}g`} />
        <KpiCard label="Avg Stone & Wastage / Bill" color={t.text2} loading={loading}
          value={`${fmt(k?.avg_stone_wastage_bill)}g`}
          sub="avg deduction per transaction" />
        <KpiCard label="Net Weight"            color={t.gold}  loading={loading}
          value={`${fmt(k?.total_net)}g`} />
      </div>

      {/* ROW 2 — Quality + Split (5 cols) */}
      <div style={gridRow5}>
        <KpiCard label="Stone & Wastage %" color={t.orange} loading={loading}
          value={`${Number(k?.stone_wastage_pct || 0).toFixed(2)}%`}
          sub="of gross weight" />
        <KpiCard label="Avg Purity %" color={t.purple} loading={loading}
          value={`${Number(k?.avg_purity || 0).toFixed(2)}%`}
          sub="weighted by net weight" />
        <SplitCard
          title="Physical & Takeover — Bills"
          leftLabel="Physical"  leftValue={Number(k?.physical_count || 0).toLocaleString('en-IN')}  leftColor={t.gold}  leftSub={`Physical · ${phPct}%`}
          rightLabel="Takeover" rightValue={Number(k?.takeover_count || 0).toLocaleString('en-IN')} rightColor={t.blue} rightSub={`Takeover · ${tkPct}%`}
          loading={loading} t={t}
        />
        <SplitCard
          title="Physical & Takeover — Net Wt"
          leftLabel="Physical"  leftValue={`${fmt(k?.physical_net)}g`}  leftColor={t.gold}  leftSub={`Physical · ${phNwPct}%`}
          rightLabel="Takeover" rightValue={`${fmt(k?.takeover_net)}g`} rightColor={t.blue} rightSub={`Takeover · ${tkNwPct}%`}
          loading={loading} t={t}
        />
        <KpiCard label="Avg Net Wt / Bill" color={t.blue} loading={loading}
          value={`${fmt(k?.avg_net_per_txn)}g`} />
      </div>

      {/* ROW 3 — Value (5 cols) */}
      <div style={gridRow5b}>
        <KpiCard label="Avg Service Charge %" color={t.text2} loading={loading}
          value={`${Number(k?.avg_service_charge_pct || 0).toFixed(2)}%`} />
        <KpiCard label="Gross Purchase Value" color={t.green} loading={loading}
          value={fmtVal(k?.total_value)} />
        <KpiCard label="Avg Rate / Gram" color={t.green} loading={loading}
          value={fmtVal(k?.avg_rate_per_gram)}
          sub="gross value ÷ net weight" />
        <KpiCard label="Transacted Branches" color={t.blue} loading={loading}
          value={Number(k?.branch_count || 0).toLocaleString('en-IN')} />
        <KpiCard label="Business Days" color={t.text2} loading={loading}
          value={Number(k?.business_days || 0).toLocaleString('en-IN')}
          sub="unique trading days" />
      </div>

      {/* SECTION NAV */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: isMobile ? '14px' : '24px', padding: '5px', background: t.card, borderRadius: '12px', border: `1px solid ${t.border}`, width: isMobile ? '100%' : 'fit-content', overflowX: 'auto', scrollbarWidth: 'none', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }}>
        <button
          onClick={() => setActiveSection(null)}
          style={{ padding: isMobile ? '6px 12px' : '7px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: !activeSection ? t.gold : 'transparent', color: !activeSection ? '#0a0a0a' : t.text3, fontSize: '.65rem', fontWeight: !activeSection ? 600 : 400, letterSpacing: '.03em', transition: 'all .2s ease', flexShrink: 0 }}
        >
          All
        </button>
        {visibleSections.map(sec => (
          <button
            key={sec.key}
            onClick={() => setActiveSection(activeSection === sec.key ? null : sec.key)}
            style={{ padding: isMobile ? '6px 12px' : '7px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: activeSection === sec.key ? t.gold : 'transparent', color: activeSection === sec.key ? '#0a0a0a' : t.text3, fontSize: '.65rem', fontWeight: activeSection === sec.key ? 600 : 400, letterSpacing: '.03em', transition: 'all .2s ease', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
          >
            <span style={{ fontSize: '.72rem' }}>{sec.icon}</span>{sec.label}
          </button>
        ))}
      </div>

      {/* ERROR MESSAGE */}
      {error && (
        <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '12px', padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ fontSize: '.9rem', color: t.red, fontWeight: 600, marginBottom: '8px' }}>⚠ Error Loading Reports</div>
          <div style={{ fontSize: '.75rem', color: t.text2, marginBottom: '12px' }}>{error}</div>
          <div style={{ fontSize: '.7rem', color: t.text3, lineHeight: 1.6 }}>
            Check your Supabase connection and environment variables. Refresh the page to retry.
          </div>
        </div>
      )}

      {/* GA-STYLE COMPARE — always visible at top of sections (skipped when drilling into a single section) */}
      {!loading && !error && !activeSection && (
        <div style={{ marginBottom: '14px' }}>
          <ReportComparePeriods t={t} isMobile={isMobile} fromDate={fromDate} toDate={toDate} filterBranch={filterBranch} filterRegion={filterRegion} filterTxn={filterTxn} branches={allBranchMeta} />
        </div>
      )}

      {/* SECTIONS */}
      {!loading && !error && (
        <>
          {showSection('charts')          && <ReportCharts          trend={trend} monthly={monthly} dowData={dowData} hourlyTrend={hourlyTrend} isSingleDay={fromDate && toDate && fromDate === toDate} t={t} fromDate={fromDate} filterBranch={filterBranch} filterTxn={filterTxn} />}
          {showSection('distribution')    && <ReportDistribution    kpis={kpis} purityDist={purityDist} weightBuckets={weightBuckets} regionSplit={regionSplit} monthHalf={monthHalf} timeOfDay={timeOfDay} t={t} />}
          {showSection('branches')        && <ReportBranches        branchData={branchData} allBranchMeta={allBranchMeta} stateData={stateData} topBills={topBills} fromDate={fromDate} toDate={toDate} filterTxn={filterTxn} t={t} />}
          {showSection('underperformers') && <ReportUnderperformers t={t} isMobile={isMobile} filterRegion={filterRegion} branches={allBranchMeta} />}
          {showSection('sameday')         && <ReportSameDay         t={t} />}
          {showSection('compare')         && <ReportCompare         t={t} />}
          {showSection('crm')             && <ReportCrmInsights     t={t} />}
        </>
      )}

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', height: '200px', animation: 'shimmer 1.5s infinite' }} />
          ))}
        </div>
      )}

      {/* KPI Drill-Down Modal */}
      {selectedKpi && (() => {
        const drill = DRILL_MAP[selectedKpi]
        if (!drill || !branchData.length) return null
        const sorted = [...branchData]
          .filter(b => b[drill.field] != null && Number(b[drill.field]) > 0)
          .sort((a, b) => Number(b[drill.field] || 0) - Number(a[drill.field] || 0))
        const maxVal = Number(sorted[0]?.[drill.field] || 0)
        return (
          <GoldModal open={true} onClose={() => setSelectedKpi(null)} title={selectedKpi} width={520}>
            <div style={{ fontSize: 10, color: t.text3, letterSpacing: '.1em', marginBottom: 16 }}>
              BRANCH BREAKDOWN — {sorted.length} BRANCHES
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sorted.map((b, i) => {
                const val = Number(b[drill.field] || 0)
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0
                return (
                  <div key={b.branch_name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 10, color: t.text3, width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#e8d9b0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.branch_name}</span>
                        <span style={{ fontSize: 11, color: '#C9A84C', fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 8 }}>{drill.fmt(b[drill.field])}</span>
                      </div>
                      <div style={{ height: 3, background: 'rgba(201,168,76,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #8B6914, #FFD700)', borderRadius: 2, transition: 'width .6s ease' }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </GoldModal>
        )
      })()}
    </div>
  )
}