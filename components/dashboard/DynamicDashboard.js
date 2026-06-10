'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { triggerSync } from '../../lib/triggerSync'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts'

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { istNow, istStr, istDaysAgo as daysBack } from '../../lib/dateIst'
import ConsignmentOverviewWidget from './ConsignmentOverviewWidget'
import TodaysBookingsWidget from './TodaysBookingsWidget'
import LiveFeedFlashcards from './LiveFeedFlashcards'
import MonthProjection from './MonthProjection'

// ── Date helpers ──────────────────────────────────────────────────────────────
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDay   = (d) => { if (!d) return ''; const [, m, day] = d.split('-'); return `${day}/${m}` }
const fmtDate  = (iso) => { if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}-${MONTHS[+m-1]}-${y}` }
// istNow() is pre-shifted by +5.5h, so getUTCHours() returns the actual IST hour.
const greeting = () => { const h = istNow().getUTCHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

// ── Number formatters ─────────────────────────────────────────────────────────
const fmt    = (n, dec=2) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec }) : '—'
const fmtCr  = (n) => { if (!n) return '—'; const cr = Number(n)/1e7; return cr >= 1 ? `₹${cr.toFixed(2)} Cr` : `₹${Number(n).toLocaleString('en-IN',{maximumFractionDigits:0})}` }
const fmtPct = (n) => n != null ? `${Number(n).toFixed(2)}%` : '—'

function getRange(key) {
  const now = istNow(), y = now.getFullYear(), m = now.getMonth(), today = istStr(now)
  if (key === 'today')     return { from: today, to: today, label: 'Today' }
  if (key === 'yesterday') { const d = istStr(new Date(now - 86400000)); return { from:d, to:d, label:'Yesterday' } }
  if (key === 'week')      { const off = now.getDay()===0?6:now.getDay()-1; return { from:istStr(new Date(now - off*86400000)), to:today, label:'This Week' } }
  if (key === 'mtd')       return { from:`${y}-${String(m+1).padStart(2,'0')}-01`, to:today, label:'Month to Date' }
  if (key === 'prev')      { const pm=m===0?11:m-1, pY=m===0?y-1:y, last=new Date(pY,pm+1,0).getDate(); return { from:`${pY}-${String(pm+1).padStart(2,'0')}-01`, to:`${pY}-${String(pm+1).padStart(2,'0')}-${String(last).padStart(2,'0')}`, label:'Previous Month' } }
  if (key === 'ytd')       { const fy=m>=3?`${y}-04-01`:`${y-1}-04-01`; return { from:fy, to:today, label:'Year to Date (FY)' } }
  return { from:null, to:null, label:'All Time' }
}

const PERIODS = [
  { key:'today', label:'Today' }, { key:'yesterday', label:'Yesterday' },
  { key:'week', label:'This Week' }, { key:'mtd', label:'MTD' },
  { key:'prev', label:'Prev Month' }, { key:'ytd', label:'YTD' },
]
const COLOR_PALETTE = ['#c9a84c','#3aaa6a','#3a8fbf','#8c5ac8','#c9981f','#e05555']

// ── Shared shimmer ────────────────────────────────────────────────────────────
const Shimmer = ({ h=24, w='60%', t }) => (
  <div style={{ height:h, width:w, background:`linear-gradient(90deg,${t.border2},${t.border},${t.border2})`, backgroundSize:'200% 100%', borderRadius:6, animation:'shimmer 1.5s infinite', opacity:.9 }} />
)

// ── Shared mobile hook ────────────────────────────────────────────────────────
function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

// ── KPI card (purchase overview style) ───────────────────────────────────────
function KpiCard({ label, value, sub, color, icon, loading, t, delay=0, compact=false }) {
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(()=>setVis(true),delay); return ()=>clearTimeout(id) }, [delay])
  return (
    <div style={{ background:`linear-gradient(145deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:16, padding: compact ? '14px 16px' : '20px 22px', position:'relative', overflow:'hidden', opacity:vis?1:0, transform:vis?'translateY(0)':'translateY(10px)', transition:'all .25s cubic-bezier(.34,1.56,.64,1)' }}>
      <div style={{ position:'absolute', top:0, left:16, right:16, height:1, background:`linear-gradient(90deg,transparent,${color}80,transparent)` }}/>
      <div style={{ position:'absolute', top:-30, right:-30, width:100, height:100, borderRadius:'50%', background:`radial-gradient(circle,${color}08 0%,transparent 70%)`, pointerEvents:'none' }}/>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: compact ? 10 : 14 }}>
        <div style={{ fontSize: compact ? 10 : 11, color:t.text3, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:600, lineHeight:1.3 }}>{label}</div>
        <div style={{ width: compact ? 26 : 30, height: compact ? 26 : 30, borderRadius:8, background:`${color}18`, border:`1px solid ${color}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize: compact ? '.75rem' : '.9rem', flexShrink:0 }}>{icon}</div>
      </div>
      {loading
        ? <Shimmer h={compact ? 24 : 30} w="60%" t={t} />
        : <div style={{ fontSize: compact ? 22 : 28, fontWeight:200, color, letterSpacing:'-.02em', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{value ?? '—'}</div>
      }
      {sub && !loading && <div style={{ fontSize: compact ? 10 : 12, color:t.text4, marginTop: compact ? 5 : 8, lineHeight:1.4 }}>{sub}</div>}
    </div>
  )
}

// ── Stat row (region / branch tables) ────────────────────────────────────────
function StatRow({ label, value, sub, color, t, bar, barMax, delay=0 }) {
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(()=>setVis(true),delay); return ()=>clearTimeout(id) }, [delay])
  const pct = bar!=null && barMax>0 ? Math.min(100,(bar/barMax)*100) : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:`1px solid ${t.border}25`, opacity:vis?1:0, transform:vis?'translateX(0)':'translateX(-8px)', transition:'all .3s ease' }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, color:t.text2, fontWeight:500, lineHeight:1.3 }}>{label}</div>
        {sub && <div style={{ fontSize:12, color:t.text4, marginTop:2 }}>{sub}</div>}
      </div>
      {bar!=null && barMax>0 && (
        <div style={{ width:56, height:4, background:t.border2, borderRadius:2, overflow:'hidden', flexShrink:0 }}>
          <div style={{ width:vis?`${pct}%`:'0%', height:'100%', background:`linear-gradient(90deg,${color}90,${color})`, borderRadius:2, transition:'width .7s cubic-bezier(.4,0,.2,1)' }}/>
        </div>
      )}
      <div style={{ fontSize:13, fontWeight:600, color, minWidth:64, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{value}</div>
    </div>
  )
}

const EmptyPanel = ({ t }) => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'28px 0', gap:10 }}>
    <div style={{ fontSize:'2rem', opacity:.2 }}>📊</div>
    <div style={{ color:t.text4, fontSize:13 }}>No activity this period</div>
  </div>
)

// ══ PURCHASE INLINE (replaces section + accordion — always open, no title) ═══
function PurchaseInline({ t, setActiveNav, canSee }) {
  const canSeeLive    = canSee('purchase-live')
  const canSeeData    = canSee('purchase-data')
  const canSeeReports = canSee('purchase-reports')

  const showKpiCards       = canSee('element.dashboard.kpi_cards')
  const showPeriodSelector = canSee('element.dashboard.period_selector')
  const showStateTable     = canSee('element.dashboard.state_table')
  const showTopBranches    = canSee('element.dashboard.top_branches')
  const showRegionCards    = canSee('element.dashboard.region_cards')
  const showChart          = canSee('element.reports.charts')
  const visiblePanels      = [showStateTable, showTopBranches].filter(Boolean).length

  const isMobile = useMobile()
  const [period,       setPeriod]       = useState('today')
  const [loading,      setLoading]      = useState(true)
  const [trendLoading, setTrendLoading] = useState(true)
  const [kpis,         setKpis]         = useState(null)
  const [todayKpis,    setTodayKpis]    = useState(null)
  const [stateData,    setStateData]    = useState([])
  const [topBranches,    setTopBranches]    = useState([])
  const [bottomBranches, setBottomBranches] = useState([])
  const [branchMeta,   setBranchMeta]   = useState([])
  const [regionCounts, setRegionCounts] = useState({})
  const [trend,        setTrend]        = useState([])
  const [filterType,      setFilterType]      = useState(null)
  const [filterValue,     setFilterValue]     = useState(null)
  const [branchSearch,    setBranchSearch]    = useState('')
  const [branchDropOpen,  setBranchDropOpen]  = useState(false)
  const [lastRefresh,     setLastRefresh]     = useState(null)
  const [lastSyncAt,      setLastSyncAt]      = useState(null)
  const branchInputRef = useRef(null)
  const branchDropRef  = useRef(null)
  const refreshRef     = useRef(null)

  useEffect(() => {
    if (filterType !== 'branch') { setBranchSearch(''); setBranchDropOpen(false) }
  }, [filterType])

  // Trigger a CRM→Supabase sync every 10s (shared helper coalesces overlapping
  // calls across components) and poll MAX(updated_at) so this panel keeps
  // catching up with LiveFeedFlashcards (which read CRM directly).
  useEffect(() => {
    const fetchLastSync = async () => {
      const { data } = await supabase
        .from('purchases')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
      if (data?.[0]?.updated_at) setLastSyncAt(data[0].updated_at)
    }
    triggerSync()
    fetchLastSync()
    const id = setInterval(() => { triggerSync(); fetchLastSync() }, 10 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (branchDropRef.current && !branchDropRef.current.contains(e.target) &&
          branchInputRef.current && !branchInputRef.current.contains(e.target)) {
        setBranchDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Branch meta (for region color mapping)
  useEffect(() => {
    supabase.from('branches').select('name,region,state,cluster').eq('is_active',true).then(({data})=>{
      if (!data) return
      setBranchMeta(data)
      const rc = {}
      data.forEach(b => { if (b.region) rc[b.region] = (rc[b.region]||0)+1 })
      setRegionCounts(rc)
    })
  }, [])

  // Today KPIs + 14-day trend — re-fetch when region/cluster/branch filter changes
  useEffect(() => {
    const todayStr  = istStr()
    const trendFrom = daysBack(13)

    let p_branch = null
    let p_region_branches = null
    if (filterType === 'branch' && filterValue) p_branch = filterValue
    else if (filterType === 'region'  && filterValue) p_region_branches = branchMeta.filter(b => b.region  === filterValue).map(b => b.name)
    else if (filterType === 'state'   && filterValue) p_region_branches = branchMeta.filter(b => b.state   === filterValue).map(b => b.name)
    else if (filterType === 'cluster' && filterValue) p_region_branches = branchMeta.filter(b => b.cluster === filterValue).map(b => b.name)

    setTrendLoading(true)
    const ps = []
    if (showKpiCards) {
      ps.push(supabase.rpc('get_purchase_aggregates', { p_from_date:todayStr, p_to_date:todayStr, p_branch, p_txn_type:null, p_region_branches, p_single_day:true })
        .then(({data}) => setTodayKpis(data?.kpis || null)))
    }
    if (showChart) {
      ps.push(supabase.rpc('get_purchase_aggregates', { p_from_date:trendFrom, p_to_date:todayStr, p_branch, p_txn_type:null, p_region_branches, p_single_day:false })
        .then(({data}) => setTrend(data?.trend || [])))
    }
    Promise.all(ps).catch(()=>{}).finally(()=>setTrendLoading(false))
  }, [filterType, filterValue, branchMeta]) // eslint-disable-line react-hooks/exhaustive-deps

  // User-driven refetch on period/filter change → loud (show shimmer because
  // conceptually different data is loading).
  useEffect(() => { fetchPeriod(); setLastRefresh(new Date()) }, [period, filterType, filterValue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Background refetch when fresh rows land → silent (keep current numbers
  // visible, swap when new fetch resolves).
  useEffect(() => {
    if (lastSyncAt) { fetchPeriod({ silent: true }); setLastRefresh(new Date()) }
  }, [lastSyncAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 10s on Today + refetch on tab focus/visibility. All
  // silent so the panel doesn't flash shimmer skeletons mid-session.
  useEffect(() => {
    if (period !== 'today') { clearInterval(refreshRef.current); return }
    refreshRef.current = setInterval(() => { fetchPeriod({ silent: true }); setLastRefresh(new Date()) }, 10 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') { fetchPeriod({ silent: true }); setLastRefresh(new Date()) }
    }
    const onFocus = () => { fetchPeriod({ silent: true }); setLastRefresh(new Date()) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(refreshRef.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [period, filterType, filterValue]) // eslint-disable-line react-hooks/exhaustive-deps

  // silent=true → background refresh: keep current numbers/tables visible and
  // swap them in atomically when the new fetch lands. Avoids flashing the
  // shimmer skeletons every 30s. silent=false (default) is for user actions.
  const fetchPeriod = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    const { from, to } = getRange(period)

    let p_branch = null
    let p_region_branches = null
    if (filterType === 'branch' && filterValue) {
      p_branch = filterValue
    } else if (filterType === 'region' && filterValue) {
      p_region_branches = branchMeta.filter(b => b.region === filterValue).map(b => b.name)
    } else if (filterType === 'state' && filterValue) {
      p_region_branches = branchMeta.filter(b => b.state === filterValue).map(b => b.name)
    } else if (filterType === 'cluster' && filterValue) {
      p_region_branches = branchMeta.filter(b => b.cluster === filterValue).map(b => b.name)
    }

    // Single source of truth: Supabase. The earlier CRM-live override
    // returned a wrong NET weight (~30% short) and the regression hit
    // stakeholders. Trust the sync — 10s drift is the accepted tolerance.
    const { data } = await supabase.rpc('get_purchase_aggregates', {
      p_from_date: from, p_to_date: to,
      p_branch, p_txn_type: null,
      p_region_branches: p_region_branches || null,
      p_single_day: from === to,
    })
    if (!data) { if (!silent) setLoading(false); return }

    setKpis(data.kpis || null)
    if (!silent) setLoading(false)

    const branchRows = data.branches || []
    const groupByState = filterType === 'region' || filterType === 'state'
    const groupKey = groupByState ? 'state' : 'region'
    const groupMap = {}
    branchRows.forEach(b => {
      const key = b[groupKey] || 'Unknown'
      if (!groupMap[key]) groupMap[key] = { state: key, total_net: 0, txn_count: 0, branch_count: 0 }
      groupMap[key].total_net += Number(b.total_net || 0)
      groupMap[key].txn_count += Number(b.txn_count || 0)
      groupMap[key].branch_count++
    })
    setStateData(Object.values(groupMap).sort((a, b) => b.total_net - a.total_net))
    const sortedDesc = [...branchRows].sort((a, b) => Number(b.total_net || 0) - Number(a.total_net || 0))
    setTopBranches(sortedDesc.slice(0, 5))
    const activeAsc = sortedDesc.filter(b => Number(b.txn_count || 0) > 0).reverse()
    setBottomBranches(activeAsc.slice(0, 5))
  }

  // Derived
  const branchRegionMap = {}
  branchMeta.forEach(b => { if (b.name&&b.region) branchRegionMap[b.name]=b.region })

  const filterTypeOptions = [
    { key: null,      label: 'All Data' },
    { key: 'region',  label: 'Region'   },
    { key: 'state',   label: 'State'    },
    { key: 'cluster', label: 'Cluster'  },
    { key: 'branch',  label: 'Branch'   },
  ]
  const filterValueOptions = filterType === 'region'
    ? [...new Set(branchMeta.map(b => b.region).filter(Boolean))].sort()
    : filterType === 'state'
    ? [...new Set(branchMeta.map(b => b.state).filter(Boolean))].sort()
    : filterType === 'cluster'
    ? [...new Set(branchMeta.map(b => b.cluster).filter(Boolean))].sort()
    : filterType === 'branch'
    ? [...new Set(branchMeta.map(b => b.name).filter(Boolean))].sort()
    : []
  const orderedRegions = [...new Set([...stateData.filter(s=>s.state).map(s=>s.state), ...Object.keys(regionCounts)])]
  const regionColorMap = {}
  orderedRegions.forEach((r,i) => { regionColorMap[r]=COLOR_PALETTE[i%COLOR_PALETTE.length] })

  const totalBranches = Object.values(regionCounts).reduce((a,b)=>a+b,0)
  const maxStateNet   = Math.max(...stateData.map(s=>Number(s.total_net||0)),1)
  const hasData       = kpis?.total_count > 0
  const hasStateData  = stateData.filter(s=>s.state&&Number(s.total_net||0)>0).length > 0
  const physPct       = hasData ? (kpis.physical_count/kpis.total_count)*100 : 0
  const takePct       = hasData ? (kpis.takeover_count/kpis.total_count)*100 : 0
  const { label:periodLabel, from:pFrom, to:pTo } = getRange(period)
  const dateLabel = pFrom&&pTo ? (pFrom===pTo ? fmtDate(pFrom) : `${fmtDate(pFrom)} — ${fmtDate(pTo)}`) : ''
  const avgWt = trend.filter(d=>Number(d.net_wt||0)>0)
  const avgWtVal = avgWt.length>0 ? avgWt.reduce((s,d)=>s+Number(d.net_wt),0)/avgWt.length : 0

  const panel = { background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:14, padding:'18px 22px' }
  const panelTitle = { fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }
  const panelMeta  = { fontSize:11, color:t.text4 }

  // Button labels itself "Live Feed" when possible, so navigate there
  // first. Fall back to Master Purchase Data, then Reports.
  const openTarget = canSeeLive ? 'purchase-live'
                   : canSeeData ? 'purchase-data'
                   : canSeeReports ? 'purchase-reports'
                   : null
  const openLabel  = canSeeLive ? 'Live Feed'
                   : canSeeData ? 'Master Data'
                   : 'Reports'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* ── MONTH PROJECTION (first thing inside Purchases) ──
            Run Rate + Estimated Month Closure surface here so the projection
            is the lead metric when ops opens this section. Gated by the
            same Live Feed OR Reports access that LiveFeedFlashcards uses. */}
      {(canSee('tab.purchase-data.live') || canSee('purchase-reports')) && (
        <MonthProjection t={t} isMobile={isMobile} />
      )}

      {/* Period selector row */}
      {showPeriodSelector && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <div style={{ display:'flex', gap:3, padding:4, background:t.card, borderRadius:12, border:`1px solid ${t.border}`, overflowX:'auto', scrollbarWidth:'none', flex:1 }}>
              {PERIODS.map(({ key, label }) => (
                <button key={key} onClick={()=>setPeriod(key)} style={{ padding: isMobile ? '7px 12px' : '7px 16px', borderRadius:9, border:'none', cursor:'pointer', background:period===key?`linear-gradient(135deg,${t.gold},${t.gold}cc)`:'transparent', color:period===key?'#0a0a0a':t.text3, fontSize: isMobile ? 11 : 12, fontWeight:period===key?700:500, transition:'all .2s', boxShadow:period===key?`0 2px 8px ${t.gold}40`:'none', whiteSpace:'nowrap', flexShrink:0 }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => { fetchPeriod({ silent: true }); setLastRefresh(new Date()) }}
              title="Refresh data"
              style={{ padding:'7px 10px', borderRadius:9, border:`1px solid ${t.border}`, background:t.card, color:loading?t.gold:t.text3, fontSize:15, cursor:'pointer', flexShrink:0, transition:'color .2s' }}>
              ↻
            </button>
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              {!loading && dateLabel && <div style={{ fontSize:11, color:t.text3, fontStyle:'italic' }}>{dateLabel}</div>}
              {lastRefresh && <div style={{ fontSize:10, color:t.text4 }}>Updated {lastRefresh.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div>}
              {totalBranches > 0 && <div style={{ fontSize:11, color:t.text4, display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:t.green, display:'inline-block', boxShadow:`0 0 5px ${t.green}80` }}/>
                {totalBranches} active branches · {Object.keys(regionCounts).length} regions
              </div>}
            </div>
            {/* Live Feed → button moved to the Today's Feed header above so
                it's reachable without scrolling into this section. See
                LiveFeedFlashcards' liveFeedAction prop. */}
          </div>
        </div>
      )}

      {/* Hierarchical filter */}
      {branchMeta.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:4 }}>
          {/* Row 1: type selector */}
          <div style={{ display:'flex', gap:5, overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
            {filterTypeOptions.map(opt => {
              const active = opt.key === filterType
              return (
                <button key={opt.key||'all'}
                  onClick={() => { setFilterType(opt.key); setFilterValue(null) }}
                  style={{ padding:'4px 12px', borderRadius:20, border:`1px solid ${active ? t.gold+'80' : t.border}`, background: active ? `${t.gold}20` : 'transparent', color: active ? t.gold : t.text4, fontSize:11, fontWeight: active ? 700 : 500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .18s' }}>
                  {opt.label}
                </button>
              )
            })}
          </div>
          {/* Row 2: pill list for region/state/cluster; search dropdown for branch */}
          {filterType === 'branch' ? (
            <div style={{ position:'relative' }}>
              {filterValue ? (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px 5px 12px', borderRadius:20, background:`${t.blue}20`, border:`1px solid ${t.blue}60` }}>
                    <span style={{ fontSize:11, color:t.blue, fontWeight:600 }}>{filterValue}</span>
                    <button onClick={() => { setFilterValue(null); setBranchSearch('') }}
                      style={{ background:'none', border:'none', color:t.blue, cursor:'pointer', fontSize:12, lineHeight:1, padding:'0 0 0 2px', opacity:.7 }}>✕</button>
                  </div>
                  <button onClick={() => { setFilterValue(null); setBranchSearch(''); setBranchDropOpen(true); setTimeout(()=>branchInputRef.current?.focus(),50) }}
                    style={{ fontSize:10, color:t.text4, background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0 }}>
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ position:'relative', maxWidth:280 }}>
                  <input
                    ref={branchInputRef}
                    value={branchSearch}
                    onChange={e => { setBranchSearch(e.target.value); setBranchDropOpen(true) }}
                    onFocus={() => setBranchDropOpen(true)}
                    placeholder="Search branch…"
                    style={{ width:'100%', boxSizing:'border-box', background:t.card, border:`1px solid ${branchDropOpen ? t.blue+'80' : t.border}`, borderRadius:8, padding:'6px 12px', color:t.text1, fontSize:12, outline:'none', transition:'border .15s' }}
                  />
                  {branchDropOpen && (
                    <div ref={branchDropRef}
                      style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, background:t.card, border:`1px solid ${t.border}`, borderRadius:8, zIndex:200, maxHeight:200, overflowY:'auto', boxShadow:'0 8px 24px rgba(0,0,0,.5)' }}>
                      {filterValueOptions.filter(v => !branchSearch || v.toLowerCase().includes(branchSearch.toLowerCase())).map(v => (
                        <button key={v}
                          onMouseDown={e => { e.preventDefault(); setFilterValue(v); setBranchSearch(''); setBranchDropOpen(false) }}
                          style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 12px', background:'none', border:'none', color:t.text2, fontSize:12, cursor:'pointer', borderBottom:`1px solid ${t.border}30` }}
                          onMouseEnter={e => e.currentTarget.style.background = `${t.gold}12`}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                          {v}
                        </button>
                      ))}
                      {filterValueOptions.filter(v => !branchSearch || v.toLowerCase().includes(branchSearch.toLowerCase())).length === 0 && (
                        <div style={{ padding:'10px 12px', fontSize:11, color:t.text4 }}>No branches match</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : filterType && filterValueOptions.length > 0 ? (
            <div style={{ display:'flex', gap:5, overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', paddingLeft:2 }}>
              {filterValueOptions.map(v => {
                const active = v === filterValue
                return (
                  <button key={v}
                    onClick={() => setFilterValue(active ? null : v)}
                    style={{ padding:'3px 10px', borderRadius:20, border:`1px solid ${active ? t.blue+'80' : t.border}`, background: active ? `${t.blue}20` : 'transparent', color: active ? t.blue : t.text4, fontSize:10, fontWeight: active ? 700 : 400, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .18s' }}>
                    {v}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      )}

      {/* 8 KPI cards */}
      {showKpiCards && (
        <>
          {!loading && !hasData && (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 18px', background:`${t.gold}08`, border:`1px solid ${t.gold}20`, borderRadius:10 }}>
              <div style={{ fontSize:'.85rem', opacity:.5 }}>◎</div>
              <div style={{ fontSize:12, color:t.text3 }}>No purchases recorded for <span style={{ color:t.text2, fontWeight:600 }}>{periodLabel}</span>. Try a different period or check back later.</div>
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14 }}>
            <KpiCard t={t} delay={0}   label="Total Bills"          icon="🧾" color={t.gold}   loading={loading} compact={isMobile} value={hasData?Number(kpis.total_count).toLocaleString('en-IN'):'—'} sub={periodLabel}/>
            <KpiCard t={t} delay={60}  label="Total Net Weight"     icon="⚖️" color={t.gold}   loading={loading} compact={isMobile} value={hasData?`${fmt(kpis.total_net)}g`:'—'} sub="Net weight purchased"/>
            <KpiCard t={t} delay={120} label="Gross Purchase Value" icon="₹"  color={t.green}  loading={loading} compact={isMobile} value={hasData?fmtCr(kpis.total_value):'—'} sub="Before service charges"/>
            <KpiCard t={t} delay={180} label="Avg Rate / Gram"      icon="📈" color={t.green}  loading={loading} compact={isMobile} value={hasData&&kpis.avg_rate_per_gram>0?`₹${Number(kpis.avg_rate_per_gram).toLocaleString('en-IN',{maximumFractionDigits:0})}/g`:'—'} sub="Gross value ÷ net weight"/>
          </div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14 }}>
            <KpiCard t={t} delay={240} label="Avg Purity"         icon="✦"  color={t.purple} loading={loading} compact={isMobile} value={hasData?fmtPct(kpis.avg_purity):'—'} sub="Weighted by net weight"/>
            <KpiCard t={t} delay={300} label="Avg Wt / Bill"      icon="◈"  color={t.text2}  loading={loading} compact={isMobile} value={hasData?`${fmt(kpis.avg_net_per_txn)}g`:'—'} sub="Net weight ÷ bills"/>
            <KpiCard t={t} delay={360} label="Avg Service Charge" icon="%"  color={t.red}    loading={loading} compact={isMobile} value={hasData?`${Number(kpis.avg_service_charge_pct||0).toFixed(2)}%`:'—'} sub="Service charge ÷ gross value"/>
            <KpiCard t={t} delay={420} label="Active Branches"    icon="⬡"  color={t.blue}   loading={loading} compact={isMobile} value={hasData?`${kpis.branch_count} / ${totalBranches}`:`— / ${totalBranches}`} sub={hasData?'branches purchased':'No purchases this period'}/>
          </div>
        </>
      )}

      {/* Today strip + trend chart */}
      {showChart && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : (showKpiCards ? '1fr 260px' : '1fr'), gap:16 }}>
          {/* Trend chart */}
          <div style={{ background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:16, padding:'18px 22px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontSize:11, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }}>14-day net weight (g)</div>
              {avgWtVal>0 && !trendLoading && <div style={{ fontSize:11, color:t.text3 }}>avg {fmt(avgWtVal,1)}g/day</div>}
            </div>
            {trendLoading
              ? <Shimmer h={120} w="100%" t={t} />
              : trend.length>0
                ? <div style={{ borderRadius:8, overflow:'hidden' }}>
                    <ResponsiveContainer width="100%" height={120} style={{ outline:'none' }}>
                      <BarChart accessibilityLayer={false} data={trend} barSize={14} margin={{ top:4, right:2, left:2, bottom:0 }}>
                        <defs>
                          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={t.gold} stopOpacity={0.95}/>
                            <stop offset="100%" stopColor={t.gold} stopOpacity={0.45}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 5" stroke={t.border} strokeOpacity={0.8}/>
                        <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize:9, fill:t.text4 }} axisLine={false} tickLine={false} interval={2}/>
                        <YAxis hide domain={[0,'auto']}/>
                        <Tooltip contentStyle={{ background:t.card, border:`1px solid ${t.border}`, borderRadius:10, fontSize:11 }} labelFormatter={fmtDay} formatter={v=>[`${fmt(v,1)}g`,'Net Weight']} cursor={{ fill:`${t.gold}12` }}/>
                        <Bar dataKey="net_wt" fill="url(#barGrad)" radius={[4,4,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                : <div style={{ height:120, display:'flex', alignItems:'center', justifyContent:'center', color:t.text4, fontSize:12 }}>No data this period</div>
            }
            {/* Today strip — mobile only, folded inside chart card */}
            {isMobile && showKpiCards && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginTop:16, paddingTop:14, borderTop:`1px solid ${t.border}` }}>
                {trendLoading
                  ? [0,1,2].map(i=><Shimmer key={i} h={18} w="70%" t={t} />)
                  : [
                      { value: todayKpis?.total_count>0?Number(todayKpis.total_count).toLocaleString('en-IN'):'—', label:'Bills today', color:t.gold },
                      { value: todayKpis?.total_net>0?`${fmt(todayKpis.total_net,1)}g`:'—', label:'Net weight', color:t.green },
                      { value: fmtCr(todayKpis?.total_value), label:'Gross value', color:t.text2 },
                    ].map((s,i)=>(
                      <div key={i}>
                        <div style={{ fontSize:16, fontWeight:200, color:s.color, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{s.value}</div>
                        <div style={{ fontSize:10, color:t.text4, marginTop:3 }}>{s.label}</div>
                      </div>
                    ))
                }
              </div>
            )}
          </div>

          {/* Today's snapshot (desktop only) */}
          {showKpiCards && !isMobile && (
            <div style={{ background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:16, padding:'18px 22px', display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ fontSize:11, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }}>Today's activity</div>
              {trendLoading
                ? [0,1,2].map(i=><Shimmer key={i} h={20} w="80%" t={t} />)
                : <>
                    <div>
                      <div style={{ fontSize:28, fontWeight:200, color:t.gold, fontVariantNumeric:'tabular-nums' }}>{todayKpis?.total_count>0?Number(todayKpis.total_count).toLocaleString('en-IN'):'—'}</div>
                      <div style={{ fontSize:11, color:t.text4, marginTop:3 }}>Bills today</div>
                    </div>
                    <div>
                      <div style={{ fontSize:24, fontWeight:200, color:t.green, fontVariantNumeric:'tabular-nums' }}>{todayKpis?.total_net>0?`${fmt(todayKpis.total_net,1)}g`:'—'}</div>
                      <div style={{ fontSize:11, color:t.text4, marginTop:3 }}>Net weight</div>
                    </div>
                    <div>
                      <div style={{ fontSize:20, fontWeight:200, color:t.text2, fontVariantNumeric:'tabular-nums' }}>{fmtCr(todayKpis?.total_value)}</div>
                      <div style={{ fontSize:11, color:t.text4, marginTop:3 }}>Gross value</div>
                    </div>
                  </>
              }
            </div>
          )}
        </div>
      )}

      {/* Purchase Mix */}
      {showKpiCards && !loading && hasData && (
        <div style={{ background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:14, padding:'18px 22px' }}>
          {isMobile
            ? <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:10 }}>Purchase Mix</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[{color:t.gold,label:'Physical',pct:physPct,count:kpis.physical_count},{color:'#e07820',label:'Takeover',pct:takePct,count:kpis.takeover_count}].map(item=>(
                    <div key={item.label} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:`${item.color}0a`, border:`1px solid ${item.color}25`, borderRadius:10 }}>
                      <div style={{ width:10, height:10, borderRadius:3, background:item.color, boxShadow:`0 0 6px ${item.color}60`, flexShrink:0 }}/>
                      <div>
                        <div style={{ fontSize:12, color:t.text3, fontWeight:500 }}>{item.label}</div>
                        <div style={{ fontSize:18, fontWeight:200, color:item.color, lineHeight:1.1, fontVariantNumeric:'tabular-nums' }}>{item.pct.toFixed(1)}%</div>
                        <div style={{ fontSize:11, color:t.text4 }}>{Number(item.count||0).toLocaleString('en-IN')} bills</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            : <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div style={{ fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }}>Purchase Mix</div>
                <div style={{ display:'flex', gap:20 }}>
                  {[{color:t.gold,label:'Physical',pct:physPct,count:kpis.physical_count},{color:'#e07820',label:'Takeover',pct:takePct,count:kpis.takeover_count}].map(item=>(
                    <div key={item.label} style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <div style={{ width:10, height:10, borderRadius:3, background:item.color, boxShadow:`0 0 6px ${item.color}60` }}/>
                      <span style={{ fontSize:13, color:t.text2, fontWeight:500 }}>{item.label}</span>
                      <span style={{ fontSize:13, color:item.color, fontWeight:700 }}>{item.pct.toFixed(1)}%</span>
                      <span style={{ fontSize:12, color:t.text4 }}>({Number(item.count||0).toLocaleString('en-IN')} bills)</span>
                    </div>
                  ))}
                </div>
              </div>
          }
          <div style={{ display:'flex', height:10, borderRadius:100, overflow:'hidden', gap:2, boxShadow:'inset 0 1px 3px rgba(0,0,0,.3)' }}>
            <div style={{ width:`${physPct}%`, background:`linear-gradient(90deg,${t.gold}aa,${t.gold})`, borderRadius:'100px 0 0 100px', transition:'width .8s cubic-bezier(.4,0,.2,1)', boxShadow:`0 0 10px ${t.gold}50` }}/>
            <div style={{ flex:1, background:'linear-gradient(90deg,#e07820,#c85010)', borderRadius:'0 100px 100px 0', boxShadow:'0 0 10px #e0782050' }}/>
          </div>
        </div>
      )}

      {/* Bottom panels: By Region · Active Branches · Top Branches */}
      {visiblePanels > 0 && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${visiblePanels},1fr)`, gap:16 }}>

          {showStateTable && (
            <div style={panel}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div style={panelTitle}>By Region</div>
                <div style={panelMeta}>Net Weight</div>
              </div>
              {loading
                ? [0,1,2,3,4].map(i=><div key={i} style={{ height:30, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:6, marginBottom:6, animation:'shimmer 1.5s infinite' }}/>)
                : !hasStateData ? <EmptyPanel t={t} />
                  : stateData.filter(s=>s.state&&Number(s.total_net||0)>0).map((s,i)=>(
                      <StatRow key={s.state||i} delay={i*60} label={s.state}
                        sub={`${s.branch_count||0} branches · ${Number(s.txn_count||s.total_count||0).toLocaleString('en-IN')} bills`}
                        value={`${fmt(s.total_net,1)}g`}
                        color={regionColorMap[s.state]||COLOR_PALETTE[i%COLOR_PALETTE.length]} t={t}
                        bar={Number(s.total_net||0)} barMax={maxStateNet}/>
                    ))
              }
            </div>
          )}

          {showTopBranches && (
            <div style={panel}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div style={panelTitle}>Top 5 Branches</div>
                <div style={panelMeta}>Net Weight</div>
              </div>
              {loading
                ? [0,1,2,3,4].map(i=><div key={i} style={{ height:26, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:4, marginBottom:6, animation:'shimmer 1.5s infinite' }}/>)
                : !hasData ? <EmptyPanel t={t} />
                  : topBranches.map((b,i)=>{
                      const region = branchRegionMap[b.branch_name]
                      const color  = regionColorMap[region]||t.green
                      const rankColors = ['#c9a84c','#b0b0b0','#cd7f32']
                      const rankColor  = i < 3 ? rankColors[i] : t.text4
                      return (
                        <div key={b.branch_name} style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:18, fontSize:10, fontWeight:700, color:rankColor, textAlign:'center', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>{i+1}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <StatRow delay={i*50}
                              label={b.branch_name} value={`${fmt(b.total_net,1)}g`}
                              color={color} t={t}
                              bar={Number(b.total_net||0)}
                              barMax={Math.max(...topBranches.map(x=>Number(x.total_net||0)),1)}/>
                          </div>
                        </div>
                      )
                    })
              }
              {/* Bottom 5 — separator + list */}
              {!loading && hasData && bottomBranches.length > 0 && (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'22px 0 14px', paddingTop:14, borderTop:`1px solid ${t.border}` }}>
                    <div style={{ ...panelTitle, color:t.red }}>Bottom 5 Branches</div>
                    <div style={panelMeta}>active only</div>
                  </div>
                  {bottomBranches.map((b,i)=>(
                    <div key={b.branch_name} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:18, fontSize:10, fontWeight:700, color:t.red, textAlign:'center', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>{i+1}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <StatRow delay={i*50}
                          label={b.branch_name} value={`${fmt(b.total_net,1)}g`}
                          color={t.red} t={t}
                          bar={Number(b.total_net||0)}
                          barMax={Math.max(...topBranches.map(x=>Number(x.total_net||0)),1)}/>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// ══ TELESALES SECTION ════════════════════════════════════════════════════════
function TelesalesSection({ t, setActiveNav }) {
  const isMobile = useMobile()
  const [calls,   setCalls]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('telesales_calls')
      .select('call_date,outcome,duration_seconds')
      .gte('call_date', daysBack(13))
      .then(({ data }) => { setCalls(data||[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const todayStr   = istStr()
  const total      = calls.length
  const todayCalls = calls.filter(c=>c.call_date===todayStr).length
  const thisWeek   = calls.filter(c=>c.call_date>=daysBack(6)).length
  const engaged    = calls.filter(c=>(c.duration_seconds||0)>=30).length
  const interested = calls.filter(c=>c.outcome==='interested').length
  const engageRate = total>0 ? Math.round(engaged/total*100) : 0

  const byDate = {}
  calls.forEach(c=>{ if(c.call_date) byDate[c.call_date]=(byDate[c.call_date]||0)+1 })
  const chartData = Array.from({length:14},(_,i)=>{const d=daysBack(13-i);return{date:d,calls:byDate[d]||0}})

  const OUTS       = ['interested','callback','not_interested','no_answer','pending']
  const OUT_COLORS = {interested:'#4ade80',callback:'#60a5fa',not_interested:'#f87171',no_answer:'#94a3b8',pending:'#a78bfa'}
  const OUT_LABELS = {interested:'Interested',callback:'Callback',not_interested:'Not Interested',no_answer:'No Answer',pending:'Pending'}
  const outcomeRows = OUTS.map(o=>({key:o,label:OUT_LABELS[o],count:calls.filter(c=>(c.outcome||'pending')===o).length,color:OUT_COLORS[o]})).filter(o=>o.count>0)
  const maxOutcome = Math.max(...outcomeRows.map(o=>o.count),1)

  const panel = {background:`linear-gradient(135deg,${t.card},${t.card2})`,border:`1px solid ${t.border}`,borderRadius:16,padding:'18px 22px'}

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14 }}>
        <KpiCard label="Today's Calls" icon="◑" color={t.purple} loading={loading} t={t} compact={isMobile} value={String(todayCalls)} delay={0}/>
        <KpiCard label="This Week"     icon="📅" color={t.blue}   loading={loading} t={t} compact={isMobile} value={String(thisWeek)}   delay={60}/>
        <KpiCard label="Engage Rate"   icon="📊" color={t.green}  loading={loading} t={t} compact={isMobile} value={`${engageRate}%`}   delay={120}/>
        <KpiCard label="Interested"    icon="⭐" color="#4ade80"  loading={loading} t={t} compact={isMobile} value={String(interested)}  delay={180}/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 240px', gap: isMobile ? 10 : 14 }}>
        <div style={panel}>
          <div style={{ fontSize:11, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:12 }}>14-day call volume</div>
          {loading ? <Shimmer h={110} w="100%" t={t} />
            : <div style={{ borderRadius:8, overflow:'hidden' }}>
                <ResponsiveContainer width="100%" height={110} style={{ outline:'none' }}>
                  <BarChart accessibilityLayer={false} data={chartData} barSize={13} margin={{top:4,right:2,left:2,bottom:0}}>
                    <defs>
                      <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={t.purple} stopOpacity={0.9}/>
                        <stop offset="100%" stopColor={t.purple} stopOpacity={0.4}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 5" stroke={t.border} strokeOpacity={0.8}/>
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{fontSize:9,fill:t.text4}} axisLine={false} tickLine={false} interval={1}/>
                    <YAxis hide/>
                    <Tooltip contentStyle={{background:t.card,border:`1px solid ${t.border}`,borderRadius:10,fontSize:11}} labelFormatter={fmtDay} formatter={v=>[v,'Calls']} cursor={{fill:`${t.purple}12`}}/>
                    <Bar dataKey="calls" fill="url(#callGrad)" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
          }
        </div>
        <div style={panel}>
          <div style={{ fontSize:11, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:14 }}>Outcome breakdown</div>
          {loading
            ? [0,1,2,3].map(i=><Shimmer key={i} h={18} w="100%" t={t} style={{marginBottom:8}}/>)
            : outcomeRows.map(o=><StatRow key={o.key} label={o.label} value={String(o.count)} color={o.color} t={t} bar={o.count} barMax={maxOutcome}/>)
          }
          <button onClick={()=>setActiveNav('inbound-bot')} style={{ marginTop:16, width:'100%', padding:'8px', borderRadius:8, background:`${t.purple}15`, border:`1px solid ${t.purple}35`, color:t.purple, fontSize:11, fontWeight:600, cursor:'pointer' }}>
            Open Inbound Bot →
          </button>
        </div>
      </div>
    </div>
  )
}

// ══ CONSIGNMENT SECTION ═══════════════════════════════════════════════════════
function ConsignmentSection({ t, setActiveNav, canSee }) {
  const isMobile = useMobile()
  const canSeeOverview = canSee('consignment-overview')
  const showRegion     = canSee('element.consignment-overview.region_cards')
  const showTable      = canSee('element.consignment-overview.table') || canSee('element.consignment-overview.region_cards')

  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!canSeeOverview) { setLoading(false); return }
    authedFetch('/api/consignments?action=branch_overview')
      .then(r=>r.json()).then(json=>{setData(json.data||[]);setLoading(false)}).catch(()=>setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalWeight = data.reduce((s,b)=>s+(b.total_gross_wt||0),0)
  const urgent      = data.filter(b=>b.ship_before&&Math.floor((new Date(b.ship_before).getTime()-Date.now())/86400000)<=3).length
  const regions     = [...new Set(data.map(b=>b.region).filter(Boolean))]
  const regionStats = regions.map(r=>{const bs=data.filter(b=>b.region===r);return{region:r,branches:bs.length,weight:bs.reduce((s,b)=>s+(b.total_gross_wt||0),0)}}).sort((a,b)=>b.weight-a.weight)
  const maxWeight   = Math.max(...regionStats.map(r=>r.weight),1)
  const REGION_COLORS = {'Rest of Karnataka':t.gold,'Andhra Pradesh':t.blue,'Telangana':t.purple,'Kerala':t.green}

  const panel = {background:`linear-gradient(135deg,${t.card},${t.card2})`,border:`1px solid ${t.border}`,borderRadius:16,padding:'18px 22px'}

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {showTable && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(3,1fr)', gap: isMobile ? 10 : 14 }}>
          <KpiCard label="Branches with Stock" icon="📦" color={t.orange} loading={loading} t={t} compact={isMobile} value={String(data.length)} delay={0}/>
          <KpiCard label="Total Gross Weight"  icon="⚖️" color={t.gold}   loading={loading} t={t} compact={isMobile} value={loading?'—':`${fmt(totalWeight,0)}g`} delay={60}/>
          <KpiCard label="Urgent Alerts (≤3d)" icon="⚠️" color={urgent>0?t.red:t.green} loading={loading} t={t} compact={isMobile} value={String(urgent)} delay={120}/>
        </div>
      )}
      {showRegion && (
        <div style={panel}>
          <div style={{ fontSize:11, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:14 }}>Stock by region</div>
          {loading
            ? [0,1,2,3].map(i=><Shimmer key={i} h={22} w="100%" t={t} style={{marginBottom:8}}/>)
            : regionStats.length===0
              ? <div style={{color:t.text4,fontSize:12}}>No data</div>
              : regionStats.map(r=>(
                  <StatRow key={r.region}
                    label={`${r.region} · ${r.branches} branch${r.branches!==1?'es':''}`}
                    value={`${fmt(r.weight,0)}g`}
                    color={REGION_COLORS[r.region]||t.orange} t={t}
                    bar={r.weight} barMax={maxWeight}/>
                ))
          }
          {canSeeOverview && (
            <button onClick={()=>setActiveNav('consignment-overview')} style={{ marginTop:16, width:'100%', padding:'8px', borderRadius:8, background:`${t.orange}15`, border:`1px solid ${t.orange}35`, color:t.orange, fontSize:11, fontWeight:600, cursor:'pointer' }}>
              Open Branch Stock →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ══ ADMIN SECTION ═════════════════════════════════════════════════════════════
function AdminSection({ t, setActiveNav, canSeeUsers, canSeeBranches }) {
  const isMobile = useMobile()
  const [stats,         setStats]        = useState(null)
  const [roleBreakdown, setRoleBreakdown] = useState([])
  const [loading,       setLoading]      = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('user_profiles').select('id,role').eq('is_active',true),
      supabase.from('branches').select('id',{count:'exact',head:true}).eq('is_active',true),
    ]).then(([users,branches])=>{
      setStats({userCount:users.data?.length??0,branchCount:branches.count??0})
      const rm={}
      ;(users.data||[]).forEach(u=>{rm[u.role]=(rm[u.role]||0)+1})
      setRoleBreakdown(Object.entries(rm).map(([role,count])=>({role,count})).sort((a,b)=>b.count-a.count))
      setLoading(false)
    }).catch(()=>setLoading(false))
  }, [])

  const ROLE_COLORS = {super_admin:'#c9a84c',founders_office:'#8c5ac8',admin:'#3a8fbf',manager:'#3aaa6a',branch_staff:'#c9981f',viewer:'#7a6a4a',telesales:'#a078f0'}
  const ROLE_LABELS = {super_admin:'Super Admin',founders_office:"Founder's Office",admin:'Admin',manager:'Manager',branch_staff:'Branch Staff',viewer:'View Only',telesales:'Telesales'}
  const maxRole = Math.max(...roleBreakdown.map(r=>r.count),1)
  const panel = {background:`linear-gradient(135deg,${t.card},${t.card2})`,border:`1px solid ${t.border}`,borderRadius:16,padding:'18px 22px'}

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${[canSeeUsers,canSeeBranches].filter(Boolean).length},1fr)`, gap: isMobile ? 10 : 14 }}>
        {canSeeUsers    && <KpiCard label="Active Users"    icon="👤" color={t.blue}  loading={loading} t={t} compact={isMobile} value={stats?String(stats.userCount):'—'}   delay={0}/>}
        {canSeeBranches && <KpiCard label="Active Branches" icon="⬡"  color={t.green} loading={loading} t={t} compact={isMobile} value={stats?String(stats.branchCount):'—'} delay={60}/>}
      </div>
      {canSeeUsers && (
        <div style={panel}>
          <div style={{ fontSize:11, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:14 }}>Users by role</div>
          {loading ? [0,1,2,3].map(i=><Shimmer key={i} h={18} w="100%" t={t}/>)
            : roleBreakdown.map(r=>(
                <StatRow key={r.role} label={ROLE_LABELS[r.role]||r.role} value={String(r.count)}
                  color={ROLE_COLORS[r.role]||t.text3} t={t} bar={r.count} barMax={maxRole}/>
              ))
          }
          <button onClick={()=>setActiveNav(canSeeUsers?'user-management':'branch-management')} style={{ marginTop:16, width:'100%', padding:'8px', borderRadius:8, background:`${t.blue}15`, border:`1px solid ${t.blue}35`, color:t.blue, fontSize:11, fontWeight:600, cursor:'pointer' }}>
            {canSeeUsers ? 'Open User Management' : 'Open Branches'} →
          </button>
        </div>
      )}
    </div>
  )
}

// ══ RATES SECTION ════════════════════════════════════════════════════════════
function RatesSection({ t, setActiveNav, canSeeRates, canSeeCalTable }) {
  const isMobile = useMobile()
  const [rate,    setRate]    = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const since = new Date(); since.setHours(since.getHours()-2)
    Promise.all([
      supabase.from('gold_rates').select('*').order('fetched_at',{ascending:false}).limit(1),
      supabase.from('gold_rates').select('fetched_at,kalinga_sell_rate').gte('fetched_at',since.toISOString()).order('fetched_at',{ascending:true}),
    ]).then(([latest,hist])=>{
      setRate(latest.data?.[0]||null)
      setHistory((hist.data||[]).map(d=>({time:new Date(d.fetched_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),rate:Number(d.kalinga_sell_rate||0)})))
      setLoading(false)
    }).catch(()=>setLoading(false))
  }, [])

  const rateRows = [
    {label:'Kalinga',value:rate?.kalinga_sell_rate,color:t.gold},
    {label:'Ambica', value:rate?.ambica_sell_rate, color:t.blue},
    {label:'Aamlin', value:rate?.aamlin_sell_rate, color:t.purple},
  ].filter(r=>r.value)

  const panel = {background:`linear-gradient(135deg,${t.card},${t.card2})`,border:`1px solid ${t.border}`,borderRadius:16,padding:'18px 22px'}

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : `repeat(${Math.max(rateRows.length,1)},1fr)`, gap: isMobile ? 10 : 14 }}>
        {loading
          ? [0,1,2].map(i=><KpiCard key={i} label="—" icon="◎" color={t.text3} loading t={t} delay={i*60}/>)
          : rateRows.length>0
            ? rateRows.map((r,i)=><KpiCard key={r.label} label={`${r.label} · /10g`} icon="◎" color={r.color} loading={false} t={t} value={r.value?`₹${Number(r.value).toLocaleString('en-IN',{maximumFractionDigits:0})}`:'—'} delay={i*60}/>)
            : <div style={{color:t.text4,fontSize:12}}>No rate data available</div>
        }
      </div>
      {history.length>1 && (
        <div style={panel}>
          <div style={{ fontSize:11, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:12 }}>Kalinga rate — last 2 hours</div>
          <ResponsiveContainer width="100%" height={80} style={{ outline:'none' }}>
            <LineChart accessibilityLayer={false} data={history} margin={{top:2,right:0,left:0,bottom:0}}>
              <XAxis dataKey="time" tick={{fontSize:9,fill:t.text4}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
              <YAxis hide domain={['auto','auto']}/>
              <Tooltip contentStyle={{background:t.card,border:`1px solid ${t.border}`,borderRadius:10,fontSize:11}} formatter={v=>[`₹${Number(v).toLocaleString('en-IN',{maximumFractionDigits:0})}`,'Rate']}/>
              <Line type="monotone" dataKey="rate" stroke={t.gold} strokeWidth={1.5} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {(canSeeRates||canSeeCalTable) && (
        <button onClick={()=>setActiveNav(canSeeRates?'live-market-rates':'cal-table')} style={{ padding:'8px', borderRadius:9, background:`${t.blue}15`, border:`1px solid ${t.blue}35`, color:t.blue, fontSize:11, fontWeight:600, cursor:'pointer' }}>
          {canSeeRates ? 'Open Live Rates' : 'Open Cal Table'} →
        </button>
      )}
    </div>
  )
}

// ── Collapsible section wrapper ───────────────────────────────────────────────
// Each dashboard section has a clickable header that toggles a chevron and
// collapses its content. Without this, users scroll past Purchases every time
// just to reach Consignments — the toggle keeps the most-used module on top.
function CollapsibleSection({ icon, label, color, t, expanded, onToggle, children }) {
  return (
    <>
      <div onClick={onToggle}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        style={{ display:'flex', alignItems:'center', gap:10, paddingBottom:4, cursor:'pointer', userSelect:'none' }}>
        <div style={{ width:28, height:28, borderRadius:8, background:`${color}18`, border:`1px solid ${color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'.9rem', flexShrink:0 }}>{icon}</div>
        <div style={{ fontSize:11, fontWeight:700, color:t.text3, letterSpacing:'.1em', textTransform:'uppercase' }}>{label}</div>
        <div style={{ flex:1, height:1, background:`linear-gradient(90deg,${color}30,transparent)` }}/>
        <span aria-hidden style={{ fontSize: 12, color: t.text4, transform: expanded ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .2s', padding: '0 4px' }}>▾</span>
      </div>
      {expanded && children}
    </>
  )
}

// ══ MAIN COMPONENT ════════════════════════════════════════════════════════════
export default function DynamicDashboard() {
  const { theme, userProfile, canSee, setActiveNav } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()
  const [heroVis, setHeroVis] = useState(false)
  useEffect(() => { setTimeout(()=>setHeroVis(true), 40) }, [])

  const name = userProfile?.full_name?.split(' ')[0] || 'there'

  const hasPurchase    = canSee('purchase-data') || canSee('purchase-reports')
  const hasTelesales   = canSee('inbound-bot')
  const hasConsignment = canSee('consignment-overview') || canSee('consignment-data') || canSee('consignment-report') || canSee('consignment-summary')
  const hasBidding     = canSee('consignment-bidding')
  const hasAdmin       = canSee('user-management') || canSee('branch-management')
  const hasRates       = canSee('live-market-rates') || canSee('cal-table')
  const hasAnything    = hasPurchase || hasTelesales || hasConsignment || hasBidding || hasAdmin || hasRates

  // Section open/closed state — persisted per device. Defaults to all open
  // so first-time users see everything; their collapse choices stick.
  const [sectionOpen, setSectionOpen] = useState(() => {
    if (typeof window === 'undefined') return { purchase: true, telesales: true, consignment: true, admin: true, rates: true }
    try {
      const raw = window.localStorage.getItem('dynDash.sectionOpen')
      if (raw) return { purchase: true, telesales: true, consignment: true, admin: true, rates: true, ...JSON.parse(raw) }
    } catch {}
    return { purchase: true, telesales: true, consignment: true, admin: true, rates: true }
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('dynDash.sectionOpen', JSON.stringify(sectionOpen)) } catch {}
    }
  }, [sectionOpen])
  const toggleSection = (k) => setSectionOpen(s => ({ ...s, [k]: !s[k] }))

  return (
    <div style={{ padding: isMobile ? '16px' : '28px 32px', display:'flex', flexDirection:'column', gap: isMobile ? 14 : 20, maxWidth: '100%', boxSizing: 'border-box' }}>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      {/* ── Hero greeting ── */}
      <div style={{
        background:`linear-gradient(135deg,${t.card},${t.card2})`,
        border:`1px solid ${t.border}`, borderRadius:20, padding: isMobile ? '18px 16px' : '22px 32px',
        position:'relative', overflow:'hidden',
        opacity:heroVis?1:0, transform:heroVis?'translateY(0)':'translateY(12px)',
        transition:'all .5s cubic-bezier(.34,1.2,.64,1)',
      }}>
        <div style={{ position:'absolute', right:-60, top:-60, width:260, height:260, borderRadius:'50%', background:`radial-gradient(circle,${t.gold}12 0%,transparent 65%)`, pointerEvents:'none' }}/>
        <div style={{ position:'absolute', inset:0, backgroundImage:`radial-gradient(${t.gold}08 1px,transparent 1px)`, backgroundSize:'28px 28px', pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:0, left:'10%', right:'10%', height:1, background:`linear-gradient(90deg,transparent,${t.gold}40,transparent)` }}/>
        <div style={{ position:'relative', zIndex:1, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:11, color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:20, height:1, background:`linear-gradient(90deg,transparent,${t.gold})`, display:'inline-block' }}/>
              {greeting()}, {name}
            </div>
            <div style={{ fontSize:26, fontWeight:200, color:t.text1, lineHeight:1.2, letterSpacing:'-.02em' }}>
              Every gram. <span style={{ fontStyle:'italic', color:t.gold, textShadow:`0 0 30px ${t.gold}40` }}>Accounted for.</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Live Feed flashcards ──
          Anyone with access to Purchase Data → Live tab sees today's
          live snapshot at the top of their dashboard (walk-ins,
          purchases, conversion). Auto-refreshes every 30s. The "Live
          Feed →" button sits in the header (replacing the freshness
          pill) so it's reachable without expanding Purchases. */}
      {canSee('tab.purchase-data.live') && (
        <LiveFeedFlashcards
          t={t} isMobile={isMobile}
          liveFeedAction={canSee('purchase-live') ? {
            label: 'Live Feed',
            onClick: () => setActiveNav('purchase-live'),
          } : null}
        />
      )}

      {/* ── Purchase ── */}
      {hasPurchase && (
        <CollapsibleSection icon="◉" label="Purchases" color={t.gold} t={t} expanded={sectionOpen.purchase} onToggle={() => toggleSection('purchase')}>
          <PurchaseInline t={t} setActiveNav={setActiveNav} canSee={canSee} />
        </CollapsibleSection>
      )}

      {/* ── Telesales ── */}
      {hasTelesales && (
        <CollapsibleSection icon="◑" label="Telesales" color={t.purple} t={t} expanded={sectionOpen.telesales} onToggle={() => toggleSection('telesales')}>
          <TelesalesSection t={t} setActiveNav={setActiveNav} />
        </CollapsibleSection>
      )}

      {/* ── Consignments ──
          Roles with consignment-report permission see the rich region-grouped
          overview (Branch In Stock + In Transit columns) — same widget the
          super-admin dashboard renders. Other consignment roles (branch
          stock / data only) keep the simpler legacy ConsignmentSection. */}
      {hasConsignment && canSee('consignment-report') ? (
        <CollapsibleSection icon="📦" label="Consignment Overview" color={t.orange} t={t} expanded={sectionOpen.consignment} onToggle={() => toggleSection('consignment')}>
          <ConsignmentOverviewWidget t={t} isMobile={isMobile} setActiveNav={setActiveNav} />
          {/* Today's bookings panel — anyone who can see Bidding Volume sees
              today's bids inline on the dashboard. */}
          {canSee('consignment-bidding') && (
            <div style={{ marginTop: 14 }}>
              <TodaysBookingsWidget t={t} isMobile={isMobile} setActiveNav={setActiveNav} />
            </div>
          )}
        </CollapsibleSection>
      ) : hasConsignment ? (
        <CollapsibleSection icon="📦" label="Branch Stock" color={t.orange} t={t} expanded={sectionOpen.consignment} onToggle={() => toggleSection('consignment')}>
          <ConsignmentSection t={t} setActiveNav={setActiveNav} canSee={canSee} />
          {canSee('consignment-bidding') && (
            <div style={{ marginTop: 14 }}>
              <TodaysBookingsWidget t={t} isMobile={isMobile} setActiveNav={setActiveNav} />
            </div>
          )}
        </CollapsibleSection>
      ) : canSee('consignment-bidding') ? (
        // No consignment access but bidding access — still surface today's
        // bookings under its own collapsible section.
        <CollapsibleSection icon="📦" label="Today's Bookings" color={t.purple} t={t} expanded={sectionOpen.consignment} onToggle={() => toggleSection('consignment')}>
          <TodaysBookingsWidget t={t} isMobile={isMobile} setActiveNav={setActiveNav} />
        </CollapsibleSection>
      ) : null}

      {/* ── Admin ── */}
      {hasAdmin && (
        <CollapsibleSection icon="⚙" label="Administration" color={t.blue} t={t} expanded={sectionOpen.admin} onToggle={() => toggleSection('admin')}>
          <AdminSection t={t} setActiveNav={setActiveNav} canSeeUsers={canSee('user-management')} canSeeBranches={canSee('branch-management')} />
        </CollapsibleSection>
      )}

      {/* ── Rates ── */}
      {hasRates && (
        <CollapsibleSection icon="◎" label="Market Rates" color={t.blue} t={t} expanded={sectionOpen.rates} onToggle={() => toggleSection('rates')}>
          <RatesSection t={t} setActiveNav={setActiveNav} canSeeRates={canSee('live-market-rates')} canSeeCalTable={canSee('cal-table')} />
        </CollapsibleSection>
      )}

      {/* ── No access ── */}
      {!hasAnything && (
        <div style={{ textAlign:'center', padding:'60px 40px', background:t.card, borderRadius:18, border:`1px solid ${t.border}` }}>
          <div style={{ fontSize:'2rem', opacity:.15, marginBottom:16 }}>◈</div>
          <div style={{ fontSize:15, color:t.text2, fontWeight:500, marginBottom:8 }}>Your workspace is ready</div>
          <div style={{ fontSize:13, color:t.text4, lineHeight:1.7 }}>Contact your administrator to request access to modules.</div>
        </div>
      )}
    </div>
  )
}
