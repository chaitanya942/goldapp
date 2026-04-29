'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import AnimatedNumber from '../ui/AnimatedNumber'
import LiveTicker from '../ui/LiveTicker'
import { getVisibleModules } from '../../lib/modules'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', card3: '#1c1c1c', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8', shadow: '0 2px 8px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.03)' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#f0ebe0', card3: '#e8e2d6', text1: '#1a1208', text2: '#3a2a10', text3: '#6a5a3a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#d5cfc0', green: '#1e7a4a', red: '#c03030', blue: '#1e6a9a', orange: '#9a6810', purple: '#6a3a9a', shadow: '0 2px 8px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.8)' },
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const istNow  = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const istStr  = (d = istNow()) => d.toISOString().split('T')[0]
const fmtDate = (iso) => { if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}-${MONTHS[+m-1]}-${y}` }
const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtCr   = (n) => { if (n == null) return '—'; const cr = Number(n)/1e7; return cr >= 1 ? `₹${cr.toFixed(2)} Cr` : `₹${Number(n).toLocaleString('en-IN',{maximumFractionDigits:0})}` }
const fmtPct  = (n) => n != null ? `${Number(n).toFixed(2)}%` : '—'

function getGreeting() { const h = istNow().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

function getRange(key) {
  const now = istNow(), y = now.getFullYear(), m = now.getMonth(), today = istStr(now)
  if (key === 'today')     return { from: today, to: today, label: 'Today' }
  if (key === 'yesterday') { const d = istStr(new Date(now - 86400000)); return { from: d, to: d, label: 'Yesterday' } }
  if (key === 'week')      { const off = now.getDay()===0?6:now.getDay()-1; return { from: istStr(new Date(now - off*86400000)), to: today, label: 'This Week' } }
  if (key === 'mtd')       return { from: `${y}-${String(m+1).padStart(2,'0')}-01`, to: today, label: 'Month to Date' }
  if (key === 'prev')      { const pm=m===0?11:m-1, pY=m===0?y-1:y, last=new Date(pY,pm+1,0).getDate(); return { from:`${pY}-${String(pm+1).padStart(2,'0')}-01`, to:`${pY}-${String(pm+1).padStart(2,'0')}-${String(last).padStart(2,'0')}`, label:'Previous Month' } }
  if (key === 'ytd')       { const fy=m>=3?`${y}-04-01`:`${y-1}-04-01`; return { from:fy, to:today, label:'Year to Date (FY)' } }
  return { from: null, to: null, label: 'All Time' }
}

function KpiCard({ label, value, sub, color, icon, loading, t, delay=0, compact=false }) {
  const [hov, setHov] = useState(false)
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(()=>setVis(true), delay); return ()=>clearTimeout(id) }, [delay])
  return (
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{
      background: `linear-gradient(145deg,${t.card},${t.card2})`,
      border: `1px solid ${hov?color+'55':t.border}`,
      borderRadius: compact ? 12 : 16, padding: compact ? '12px 14px' : '20px 22px',
      position: 'relative', overflow: 'hidden',
      boxShadow: hov ? `${t.shadow},0 0 0 1px ${color}25` : t.shadow,
      transform: hov ? 'translateY(-2px)' : vis ? 'translateY(0)' : 'translateY(10px)',
      opacity: vis ? 1 : 0, transition: 'all .25s cubic-bezier(.34,1.56,.64,1)',
    }}>
      <div style={{ position:'absolute', top:0, left:16, right:16, height:1, background:`linear-gradient(90deg,transparent,${color}80,transparent)` }}/>
      <div style={{ position:'absolute', top:-30, right:-30, width:100, height:100, borderRadius:'50%', background:`radial-gradient(circle,${color}${hov?'18':'08'} 0%,transparent 70%)`, pointerEvents:'none' }}/>
      <div style={{ position:'absolute', right:12, bottom:8, fontSize:'3rem', opacity:hov?.08:.04, userSelect:'none' }}>{icon}</div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: compact ? 8 : 14 }}>
        <div style={{ fontSize: compact ? 10 : 11, color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }}>{label}</div>
        {!compact && <div style={{ width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${color}22,${color}10)`, border:`1px solid ${color}28`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', flexShrink:0 }}>{icon}</div>}
      </div>
      {loading
        ? <div style={{ height: compact ? 24 : 32, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:8, width:'60%', animation:'shimmer 1.5s infinite' }}/>
        : <div style={{ fontSize: compact ? 22 : 28, fontWeight:200, color, letterSpacing:'-.02em', lineHeight:1, fontVariantNumeric:'tabular-nums', animation:'countUp 0.5s ease' }}>{value ?? '—'}</div>
      }
      {sub && !loading && !compact && <div style={{ fontSize:12, color:t.text4, marginTop:9, lineHeight:1.4 }}>{sub}</div>}
    </div>
  )
}

function StatRow({ label, value, sub, color, t, bar, barMax, delay=0 }) {
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(()=>setVis(true), delay); return ()=>clearTimeout(id) }, [delay])
  const pct = bar!=null && barMax>0 ? Math.min(100,(bar/barMax)*100) : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:`1px solid ${t.border}25`, opacity:vis?1:0, transform:vis?'translateX(0)':'translateX(-8px)', transition:'all .3s ease' }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, color:t.text2, fontWeight:500, lineHeight:1.3 }}>{label}</div>
        {sub && <div style={{ fontSize:12, color:t.text4, marginTop:2, lineHeight:1.3 }}>{sub}</div>}
      </div>
      {bar!=null && barMax>0 && (
        <div style={{ width:56, height:4, background:t.border2, borderRadius:2, overflow:'hidden', flexShrink:0 }}>
          <div style={{ width:vis?`${pct}%`:'0%', height:'100%', background:`linear-gradient(90deg,${color}90,${color})`, borderRadius:2, transition:'width .7s cubic-bezier(.4,0,.2,1)', boxShadow:`0 0 4px ${color}60` }}/>
        </div>
      )}
      <div style={{ fontSize:13, fontWeight:600, color, minWidth:64, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{value}</div>
    </div>
  )
}

const PERIODS = [
  { key:'today', label:'Today' }, { key:'yesterday', label:'Yesterday' },
  { key:'week', label:'This Week' }, { key:'mtd', label:'MTD' },
  { key:'prev', label:'Prev Month' }, { key:'ytd', label:'YTD' },
]

const EmptyPanel = ({ t }) => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'28px 0', gap:10 }}>
    <div style={{ fontSize:'2rem', opacity:.2 }}>📊</div>
    <div style={{ color:t.text4, fontSize:13 }}>No activity this period</div>
  </div>
)

// ── Module summary card ────────────────────────────────────────────────────────
function ModuleCard({ icon, label, color, metrics, cta, onClick, loading, t, delay = 0, compact = false }) {
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => { const id = setTimeout(() => setVis(true), delay); return () => clearTimeout(id) }, [delay])
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: `linear-gradient(145deg,${t.card},${t.card2})`,
        border: `1px solid ${hov ? color + '60' : t.border}`,
        borderRadius: compact ? 12 : 16, padding: compact ? '14px 14px' : '18px 20px', cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
        boxShadow: hov ? `0 4px 20px ${color}20, inset 0 1px 0 rgba(255,255,255,.04)` : '0 2px 8px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.03)',
        transform: hov ? 'translateY(-2px)' : vis ? 'translateY(0)' : 'translateY(12px)',
        opacity: vis ? 1 : 0, transition: 'all .28s cubic-bezier(.34,1.4,.64,1)',
      }}
    >
      <div style={{ position: 'absolute', top: -24, right: -24, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle,${color}${hov ? '18' : '08'} 0%,transparent 70%)`, pointerEvents: 'none', transition: 'all .3s' }} />
      <div style={{ position: 'absolute', top: 0, left: 16, right: 16, height: 1, background: `linear-gradient(90deg,transparent,${color}60,transparent)` }} />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 10 : 14 }}>
        <div style={{ width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: 8, background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? '.85rem' : '1rem', flexShrink: 0 }}>{icon}</div>
        <div style={{ fontSize: compact ? 11 : 12, color: t.text3, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, flex: 1, lineHeight: 1.2 }}>{label}</div>
        {!compact && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={hov ? color : t.text4} strokeWidth="2" strokeLinecap="round" style={{ transition: 'stroke .2s', transform: hov ? 'translateX(2px)' : 'none' }}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>}
      </div>
      {/* Metrics */}
      <div style={{ display: 'flex', gap: compact ? 10 : 16, flexWrap: 'wrap' }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ minWidth: compact ? 48 : 64 }}>
            {loading
              ? <div style={{ height: compact ? 18 : 22, width: compact ? 44 : 56, background: `linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize: '200% 100%', borderRadius: 6, animation: 'shimmer 1.5s infinite' }} />
              : <div style={{ fontSize: compact ? 17 : 20, fontWeight: 200, color, letterSpacing: '-.01em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{m.value ?? '—'}</div>
            }
            <div style={{ fontSize: compact ? 10 : 11, color: t.text4, marginTop: 3, lineHeight: 1.3 }}>{m.label}</div>
          </div>
        ))}
      </div>
      {/* CTA */}
      {cta && !compact && (
        <div style={{ marginTop: 14, fontSize: 12, color: hov ? color : t.text4, fontWeight: hov ? 600 : 400, transition: 'all .2s', letterSpacing: '.02em' }}>
          {cta} →
        </div>
      )}
    </div>
  )
}

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

export default function DashboardHome() {
  const { theme, userProfile, canSee, setActiveNav, openMobileMenuWithModule } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const showPurchase       = canSee('purchase-data') || canSee('purchase-reports')
  const showKpiCards       = canSee('element.dashboard.kpi_cards')
  const showPeriodSelector = canSee('element.dashboard.period_selector')
  const showStateTable     = canSee('element.dashboard.state_table')
  const showTopBranches    = canSee('element.dashboard.top_branches')
  const showRegionCards    = canSee('element.dashboard.region_cards')
  const visiblePanels      = [showStateTable, showTopBranches].filter(Boolean).length

  const COLOR_PALETTE = [t.gold, t.green, t.blue, t.purple, t.orange, t.red]

  const [period,        setPeriod]        = useState('today')
  const [overviewOpen,  setOverviewOpen]  = useState(false)
  const [filterType,     setFilterType]     = useState(null)
  const [filterValue,    setFilterValue]    = useState(null)
  const [branchSearch,   setBranchSearch]   = useState('')
  const [branchDropOpen, setBranchDropOpen] = useState(false)
  const branchInputRef = useRef(null)
  const branchDropRef  = useRef(null)
  const [lastSyncAt,   setLastSyncAt]   = useState(null)

  useEffect(() => {
    if (filterType !== 'branch') { setBranchSearch(''); setBranchDropOpen(false) }
  }, [filterType])

  // Fire-and-forget sync on mount + poll MAX(updated_at) for freshness display.
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
    const handler = (e) => {
      if (branchDropRef.current && !branchDropRef.current.contains(e.target) &&
          branchInputRef.current && !branchInputRef.current.contains(e.target)) {
        setBranchDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const [loading,       setLoading]       = useState(true)
  const [kpis,          setKpis]          = useState(null)
  const [stateData,     setStateData]     = useState([])
  const [topBranches,    setTopBranches]    = useState([])
  const [bottomBranches, setBottomBranches] = useState([])
  const [branchMeta,    setBranchMeta]    = useState([])
  const [regionCounts,  setRegionCounts]  = useState({})
  const [stateCount,    setStateCount]    = useState(0)
  const [heroVis,       setHeroVis]       = useState(false)
  const [lastRefresh,   setLastRefresh]   = useState(null)
  const refreshRef = useRef(null)

  // ── Module hub data ──────────────────────────────────────────────────────────
  const [hubLoading,     setHubLoading]     = useState(true)
  const [todayKpis,      setTodayKpis]      = useState(null)
  const [telesalesStats, setTelesalesStats] = useState(null)
  const [consignStats,   setConsignStats]   = useState(null)
  const [adminStats,     setAdminStats]     = useState(null)

  useEffect(() => { setTimeout(()=>setHeroVis(true), 50) }, [])

  // Fetch all module-card data in parallel, once on mount
  useEffect(() => {
    const todayStr = istStr()
    const ps = []

    if (canSee('purchase-data') || canSee('purchase-reports')) {
      ps.push(
        supabase.rpc('get_purchase_aggregates', { p_from_date: todayStr, p_to_date: todayStr, p_branch: null, p_txn_type: null, p_region_branches: null, p_single_day: true })
          .then(({ data }) => setTodayKpis(data?.kpis || null))
          .catch(() => {})
      )
    }
    if (canSee('inbound-bot')) {
      ps.push(
        supabase.from('telesales_calls').select('outcome,duration_seconds').gte('call_date', todayStr)
          .then(({ data }) => {
            if (!data) return
            const total    = data.length
            const engaged  = data.filter(c => (c.duration_seconds || 0) >= 30).length
            const interest = data.filter(c => c.outcome === 'interested').length
            setTelesalesStats({ total, engaged, interested: interest, engageRate: total > 0 ? Math.round(engaged / total * 100) : 0 })
          }).catch(() => {})
      )
    }
    if (canSee('consignment-overview')) {
      ps.push(
        fetch('/api/consignments?action=branch_overview')
          .then(r => r.json())
          .then(json => {
            const rows = json.data || []
            const totalBranches = rows.length
            const totalWeight   = rows.reduce((s, b) => s + (b.total_gross_wt || 0), 0)
            const urgent = rows.filter(b => {
              if (!b.ship_before) return false
              const days = Math.floor((new Date(b.ship_before).getTime() - Date.now()) / 86400000)
              return days <= 3
            }).length
            setConsignStats({ totalBranches, totalWeight, urgent })
          }).catch(() => {})
      )
    }
    if (canSee('user-management') || canSee('branch-management')) {
      ps.push(
        Promise.all([
          supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
          supabase.from('branches').select('id', { count: 'exact', head: true }).eq('is_active', true),
        ]).then(([u, b]) => setAdminStats({ userCount: u.count ?? 0, branchCount: b.count ?? 0 }))
          .catch(() => {})
      )
    }

    Promise.all(ps).finally(() => setHubLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showPurchase) return
    supabase.from('branches').select('name, region, state, cluster').eq('is_active', true).then(({ data }) => {
      if (!data) return
      setBranchMeta(data)
      const rc = {}
      data.forEach(b => { if (b.region) rc[b.region] = (rc[b.region] || 0) + 1 })
      setRegionCounts(rc)
      const states = new Set(data.map(b => b.state).filter(Boolean))
      setStateCount(states.size)
    })
  }, [showPurchase])

  useEffect(() => { if (showPurchase) { fetchAll(); setLastRefresh(new Date()) } }, [period, showPurchase, filterType, filterValue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 3 minutes when viewing Today
  useEffect(() => {
    if (!showPurchase || period !== 'today') { clearInterval(refreshRef.current); return }
    refreshRef.current = setInterval(() => { fetchAll(); setLastRefresh(new Date()) }, 3 * 60 * 1000)
    return () => clearInterval(refreshRef.current)
  }, [showPurchase, period, filterType, filterValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = async () => {
    setLoading(true)
    setStateData([])
    setTopBranches([])
    setBottomBranches([])
    const { from, to } = getRange(period)

    // Build filter params — all routes use get_purchase_aggregates for consistent data
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

    const { data } = await supabase.rpc('get_purchase_aggregates', {
      p_from_date: from, p_to_date: to,
      p_branch, p_txn_type: null,
      p_region_branches: p_region_branches || null,
      p_single_day: from === to,
    })

    if (!data) { setLoading(false); return }
    setKpis(data.kpis || null)

    // Group breakdown by region (all/cluster/branch) or by state (when region/state is selected)
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
    // Top 5 (descending net wt) + Bottom 5 (ascending net wt, only branches with at least 1 txn).
    // Excluding zero-txn branches keeps "Bottom" meaningful — otherwise bottom is just inactive ones.
    const sortedDesc = [...branchRows].sort((a, b) => Number(b.total_net || 0) - Number(a.total_net || 0))
    setTopBranches(sortedDesc.slice(0, 5))
    const activeAsc = sortedDesc.filter(b => Number(b.txn_count || 0) > 0).reverse()
    setBottomBranches(activeAsc.slice(0, 5))
    setLoading(false)
  }

  const name          = userProfile?.full_name?.split(' ')[0] || 'there'
  const { label: periodLabel, from: pFrom, to: pTo } = getRange(period)
  const totalBranches = Object.values(regionCounts).reduce((a,b)=>a+b,0)

  const regionColorMap = {}
  const orderedRegions = stateData.filter(s=>s.state).map(s=>s.state)
  Object.keys(regionCounts).forEach(r => { if (!orderedRegions.includes(r)) orderedRegions.push(r) })
  orderedRegions.forEach((region, i) => { regionColorMap[region] = COLOR_PALETTE[i % COLOR_PALETTE.length] })

  const branchRegionMap = {}
  branchMeta.forEach(b => { if (b.name && b.region) branchRegionMap[b.name] = b.region })

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

  const maxStateNet  = Math.max(...stateData.map(s=>Number(s.total_net||0)), 1)
  const hasData      = kpis?.total_count > 0
  const hasStateData = stateData.filter(s=>s.state && Number(s.total_net||0)>0).length > 0
  const physPct      = hasData ? (kpis.physical_count/kpis.total_count)*100 : 0
  const takePct      = hasData ? (kpis.takeover_count/kpis.total_count)*100 : 0
  const dateLabel    = pFrom&&pTo ? (pFrom===pTo ? fmtDate(pFrom) : `${fmtDate(pFrom)} — ${fmtDate(pTo)}`) : ''

  const panel = {
    background:`linear-gradient(145deg,${t.card},${t.card2})`,
    border:`1px solid ${t.border}`, borderRadius:16, padding:'20px 22px',
    boxShadow: t.shadow,
  }
  const panelTitle = { fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600 }
  const panelMeta  = { fontSize:12, color:t.text4 }

  return (
    <div style={{ padding: isMobile ? '16px' : '28px 32px', maxWidth: '100%', boxSizing: 'border-box' }}>
      <style>{`
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes pglow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.25)}}
        .overview-body {
          display: grid;
          grid-template-rows: 1fr;
          transition: grid-template-rows .35s cubic-bezier(.4,0,.2,1), opacity .3s ease;
          overflow: hidden;
        }
        .overview-body.collapsed {
          grid-template-rows: 0fr;
          opacity: 0;
        }
        .overview-body > div { min-height: 0; }
      `}</style>

      {/* ── HERO ── */}
      <div style={{ background:`linear-gradient(135deg,${t.card},${t.card2} 60%,${t.card})`, border:`1px solid ${t.border}`, borderRadius:20, padding: isMobile ? '18px 16px' : '28px 44px', marginBottom:20, position:'relative', overflow:'hidden', boxShadow:`${t.shadow},inset 0 1px 0 rgba(255,255,255,.04)`, opacity:heroVis?1:0, transform:heroVis?'translateY(0)':'translateY(16px)', transition:'all .6s cubic-bezier(.34,1.2,.64,1)' }}>
        <div style={{ position:'absolute', right:-80, top:-80, width:320, height:320, borderRadius:'50%', background:`radial-gradient(circle,${t.gold}12 0%,transparent 65%)`, pointerEvents:'none' }}/>
        <div style={{ position:'absolute', inset:0, backgroundImage:`radial-gradient(${t.gold}08 1px,transparent 1px)`, backgroundSize:'28px 28px', pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:0, left:'10%', right:'10%', height:1, background:`linear-gradient(90deg,transparent,${t.gold}40,transparent)` }}/>
        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{ fontSize:12, color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ width:24, height:1, background:`linear-gradient(90deg,transparent,${t.gold})`, display:'inline-block' }}/>
            {getGreeting()}, {name}
            {lastSyncAt && (() => {
              const ageMs  = Date.now() - new Date(lastSyncAt).getTime()
              const ageMin = Math.floor(ageMs / 60000)
              const ageSec = Math.floor(ageMs / 1000)
              const fresh  = ageMs < 5 * 60 * 1000
              const stale  = ageMs > 15 * 60 * 1000
              const color  = stale ? t.red : fresh ? t.green : t.text3
              const label  = ageSec < 60 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin/60)}h ago`
              return (
                <span style={{ display:'flex', alignItems:'center', gap:5, color, textTransform:'none', letterSpacing:'.02em', fontSize:11 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:color, boxShadow: fresh ? `0 0 6px ${color}` : 'none' }} />
                  Synced {label}
                </span>
              )
            })()}
          </div>
          <div style={{ fontSize:36, fontWeight:200, color:t.text1, lineHeight:1.15, marginBottom:24, letterSpacing:'-.02em' }}>
            Every gram.<br/>
            <span style={{ fontStyle:'italic', color:t.gold, textShadow:`0 0 40px ${t.gold}40` }}>Accounted for.</span>
          </div>
        </div>
      </div>

      {/* ── LIVE RATES ── */}
      <LiveTicker />

      {/* ── MOBILE MODULE GRID — clean grouped-by-module view (role-aware) ── */}
      {isMobile && (() => {
        const visibleModules = getVisibleModules(canSee)
        if (visibleModules.length === 0) return null
        const tapModule = (m) => {
          if (m.comingSoon) { openMobileMenuWithModule(m.id); return }
          if (m.visibleTabs.length === 1) { setActiveNav(m.visibleTabs[0].id); return }
          openMobileMenuWithModule(m.id)
        }
        return (
          <div style={{ marginTop: 8, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Your Modules</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {visibleModules.map((m, i) => (
                <button key={m.id} onClick={() => tapModule(m)}
                  style={{
                    background: `linear-gradient(135deg, ${m.color}10, ${t.card2})`,
                    border: `1px solid ${m.color}25`, borderRadius: 14, padding: '14px 14px',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
                    cursor: 'pointer', textAlign: 'left',
                    opacity: m.comingSoon ? 0.7 : 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'transform .15s, border-color .15s',
                  }}
                  onTouchStart={e => e.currentTarget.style.transform = 'scale(0.98)'}
                  onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${m.color}25`, border: `1px solid ${m.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{m.icon}</div>
                    {m.comingSoon && <div style={{ fontSize: 9, padding: '2px 6px', background: `${t.text4}25`, color: t.text3, borderRadius: 4, fontWeight: 600 }}>SOON</div>}
                  </div>
                  <div style={{ fontSize: 13, color: t.text1, fontWeight: 600, lineHeight: 1.2 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: t.text3 }}>
                    {m.comingSoon ? 'Coming soon' : `${m.visibleTabs.length} section${m.visibleTabs.length !== 1 ? 's' : ''}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── DESKTOP MODULE HUB (per-page cards with stats) ── */}
      {!isMobile && (() => {
        const cards = [
          canSee('purchase-data') && {
            id: 'purchase-data', icon: '◉', label: 'Purchase Data', color: t.gold,
            metrics: [
              { label: "Today's Bills",  value: todayKpis?.total_count > 0 ? Number(todayKpis.total_count).toLocaleString('en-IN') : '—' },
              { label: 'Net Weight',     value: todayKpis?.total_net > 0 ? `${Number(todayKpis.total_net).toFixed(1)}g` : '—' },
            ],
            cta: 'Open Purchase Data',
          },
          canSee('purchase-reports') && {
            id: 'purchase-reports', icon: '📈', label: 'Purchase Reports', color: t.green,
            metrics: [
              { label: 'MTD Bills',  value: kpis?.total_count > 0 ? Number(kpis.total_count).toLocaleString('en-IN') : '—' },
              { label: 'MTD Value',  value: kpis?.total_value > 0 ? (Number(kpis.total_value)/1e7 >= 1 ? `₹${(Number(kpis.total_value)/1e7).toFixed(1)}Cr` : `₹${Number(kpis.total_value).toLocaleString('en-IN',{maximumFractionDigits:0})}`) : '—' },
            ],
            cta: 'Open Reports',
          },
          canSee('consignment-overview') && {
            id: 'consignment-overview', icon: '📦', label: 'Branch Stock', color: t.orange,
            metrics: [
              { label: 'Branches with Stock', value: consignStats ? String(consignStats.totalBranches) : '—' },
              { label: 'Urgent Alerts',       value: consignStats ? String(consignStats.urgent) : '—' },
            ],
            cta: 'Open Branch Stock',
          },
          (canSee('consignment-data') || canSee('consignment-report') || canSee('consignment-summary')) && !canSee('consignment-overview') && {
            id: 'consignment-data', icon: '📦', label: 'Consignments', color: t.orange,
            metrics: [{ label: 'Data & Reports', value: '→' }],
            cta: 'Open Consignments',
          },
          canSee('inbound-bot') && {
            id: 'inbound-bot', icon: '◑', label: 'Telesales', color: t.purple,
            metrics: [
              { label: "Today's Calls",  value: telesalesStats ? String(telesalesStats.total) : '—' },
              { label: 'Engagement',     value: telesalesStats ? `${telesalesStats.engageRate}%` : '—' },
              { label: 'Interested',     value: telesalesStats ? String(telesalesStats.interested) : '—' },
            ],
            cta: 'Open Inbound Bot',
          },
          canSee('live-market-rates') && {
            id: 'live-market-rates', icon: '◎', label: 'Market Rates', color: t.blue,
            metrics: [{ label: 'Live gold rates', value: '24K / 22K / 18K' }],
            cta: 'Open Market Rates',
          },
          canSee('cal-table') && {
            id: 'cal-table', icon: '⊛', label: 'Cal Table', color: t.text2,
            metrics: [{ label: 'Sales pricing calculator', value: '→' }],
            cta: 'Open Cal Table',
          },
          (canSee('user-management') || canSee('branch-management')) && {
            id: 'user-management', icon: '⚙', label: 'Administration', color: t.red,
            metrics: [
              { label: 'Active Users',    value: adminStats ? String(adminStats.userCount) : '—' },
              { label: 'Active Branches', value: adminStats ? String(adminStats.branchCount) : '—' },
            ],
            cta: canSee('user-management') ? 'Open User Management' : 'Open Branch Management',
          },
        ].filter(Boolean)

        if (cards.length === 0) return (
          <div style={{ marginTop: 8, background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:20, padding:'40px 44px', boxShadow:t.shadow, textAlign:'center' }}>
            <div style={{ fontSize:'2rem', opacity:.15, marginBottom:16 }}>◈</div>
            <div style={{ fontSize:15, color:t.text2, fontWeight:500, marginBottom:8 }}>Your workspace is ready</div>
            <div style={{ fontSize:13, color:t.text4, lineHeight:1.7 }}>
              The modules available to your role will appear here.<br />
              Contact your administrator if you need access to additional sections.
            </div>
          </div>
        )

        const cols = isMobile ? (cards.length === 1 ? 1 : 2) : (cards.length === 1 ? 1 : cards.length === 2 ? 2 : cards.length <= 4 ? 2 : 3)
        return (
          <div style={{ marginTop: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>Your Modules</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
              {cards.map((card, i) => (
                <ModuleCard
                  key={card.id}
                  icon={card.icon} label={card.label} color={card.color}
                  metrics={card.metrics} cta={card.cta}
                  onClick={() => setActiveNav(card.id)}
                  loading={hubLoading}
                  t={t} delay={i * 60} compact={isMobile}
                />
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── PURCHASE OVERVIEW ── */}
      {showPurchase && <div style={{ marginTop: 8, border:`1px solid ${t.border2}`, borderRadius:20, background:`linear-gradient(160deg,${t.card2},${t.card3})`, boxShadow:`${t.shadow},inset 0 1px 0 rgba(255,255,255,.03)`, position:'relative', overflow:'hidden', transition:'all .35s ease' }}>
        <div style={{ position:'absolute', top:0, left:0, width:160, height:160, background:`radial-gradient(circle at top left,${t.gold}08,transparent 70%)`, pointerEvents:'none' }}/>

        {/* ── Clickable Header ── */}
        <div
          onClick={() => setOverviewOpen(o => !o)}
          style={{ display:'flex', alignItems:'center', gap: isMobile ? 8 : 14, padding: overviewOpen ? (isMobile ? '14px 16px' : '20px 24px') : (isMobile ? '10px 16px' : '12px 24px'), flexWrap:'wrap', position:'relative', zIndex:1, cursor:'pointer', userSelect:'none', borderBottom: overviewOpen ? `1px solid ${t.border}` : 'none', transition:'border .35s ease' }}
        >
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:3, height:20, borderRadius:2, background:`linear-gradient(180deg,${t.gold},${t.gold}40)`, boxShadow:`0 0 8px ${t.gold}60` }}/>
            <div style={{ fontSize:14, color:t.text2, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700 }}>Purchase Overview</div>
          </div>

          {overviewOpen && !isMobile && <>
            {/* Period tabs — desktop only in header */}
            {showPeriodSelector && <div onClick={e=>e.stopPropagation()} style={{ display:'flex', gap:3, padding:4, background:t.card, borderRadius:10, border:`1px solid ${t.border}`, boxShadow:'inset 0 1px 3px rgba(0,0,0,.3)' }}>
              {PERIODS.map(({ key, label }) => (
                <button key={key} onClick={()=>setPeriod(key)} style={{ padding:'6px 14px', borderRadius:7, border:'none', cursor:'pointer', background:period===key?`linear-gradient(135deg,${t.gold},${t.gold}cc)`:'transparent', color:period===key?'#0a0a0a':t.text3, fontSize:12, fontWeight:period===key?700:500, letterSpacing:'.03em', transition:'all .2s cubic-bezier(.34,1.56,.64,1)', boxShadow:period===key?`0 2px 8px ${t.gold}40`:'none', whiteSpace:'nowrap' }}>
                  {label}
                </button>
              ))}
            </div>}
            {showPeriodSelector && <div style={{ fontSize:12, color:t.text3, fontStyle:'italic' }}>{!loading && dateLabel}</div>}
            <button onClick={e => { e.stopPropagation(); fetchAll(); setLastRefresh(new Date()) }}
              style={{ padding:'5px 10px', borderRadius:7, border:`1px solid ${t.border}`, background:t.card, color:t.text3, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap' }}>
              ↻{lastRefresh && <span style={{ fontSize:10, color:t.text4 }}>{lastRefresh.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span>}
            </button>
            {totalBranches > 0 && <div style={{ fontSize:11, color:t.text4, display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:t.green, display:'inline-block', boxShadow:`0 0 5px ${t.green}80` }}/>
              {totalBranches} active branches · {Object.keys(regionCounts).length} regions
            </div>}
          </>}

          {/* Chevron */}
          <div style={{ marginLeft:'auto', width:28, height:28, borderRadius:8, background:`${t.gold}12`, border:`1px solid ${t.gold}28`, display:'flex', alignItems:'center', justifyContent:'center', color:t.gold, fontSize:11, transition:'transform .35s cubic-bezier(.4,0,.2,1)', transform: overviewOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            ▼
          </div>
        </div>

        {/* ── Collapsible body ── */}
        <div className={`overview-body${overviewOpen ? '' : ' collapsed'}`}>
          <div style={{ padding: overviewOpen ? (isMobile ? '16px 14px 20px' : '24px 24px 28px') : '0' }}>

            {/* Period selector — mobile only, own scrollable row */}
            {isMobile && showPeriodSelector && overviewOpen && (
              <div onClick={e=>e.stopPropagation()} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:14 }}>
                <div style={{ display:'flex', gap:3, padding:4, background:t.card, borderRadius:10, border:`1px solid ${t.border}`, boxShadow:'inset 0 1px 3px rgba(0,0,0,.3)', overflowX:'auto', scrollbarWidth:'none', flex:1, WebkitOverflowScrolling:'touch' }}>
                  {PERIODS.map(({ key, label }) => (
                    <button key={key} onClick={()=>setPeriod(key)} style={{ padding:'6px 12px', borderRadius:7, border:'none', cursor:'pointer', background:period===key?`linear-gradient(135deg,${t.gold},${t.gold}cc)`:'transparent', color:period===key?'#0a0a0a':t.text3, fontSize:12, fontWeight:period===key?700:500, letterSpacing:'.03em', transition:'all .2s cubic-bezier(.34,1.56,.64,1)', boxShadow:period===key?`0 2px 8px ${t.gold}40`:'none', whiteSpace:'nowrap', flexShrink:0 }}>
                      {label}
                    </button>
                  ))}
                </div>
                <button onClick={() => { fetchAll(); setLastRefresh(new Date()) }}
                  style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${t.border}`, background:t.card, color:loading?t.gold:t.text3, fontSize:14, cursor:'pointer', flexShrink:0, transition:'color .2s' }}>
                  ↻
                </button>
              </div>
            )}

            {/* Hierarchical filter */}
            {overviewOpen && branchMeta.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
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
                {/* Row 2: search dropdown for branch; pills for everything else */}
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

            {/* KPI Rows — gated by element.dashboard.kpi_cards */}
            {showKpiCards && <>
              {/* KPI Row 1 */}
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14, marginBottom: isMobile ? 10 : 14 }}>
                <KpiCard t={t} delay={0}   label="Total Bills"          icon="🧾" color={t.gold}  loading={loading} value={hasData?Number(kpis.total_count).toLocaleString('en-IN'):'—'} sub={periodLabel} compact={isMobile}/>
                <KpiCard t={t} delay={60}  label="Total Net Weight"     icon="⚖️" color={t.gold}  loading={loading} value={hasData?`${fmt(kpis.total_net)}g`:'—'} sub="Net weight purchased" compact={isMobile}/>
                <KpiCard t={t} delay={120} label="Gross Purchase Value" icon="₹"  color={t.green} loading={loading} value={hasData?fmtCr(kpis.total_value):'—'} sub="Before service charges" compact={isMobile}/>
                <KpiCard t={t} delay={180} label="Avg Rate / Gram"      icon="📈" color={t.green} loading={loading} value={hasData&&kpis.avg_rate_per_gram>0?`₹${Number(kpis.avg_rate_per_gram).toLocaleString('en-IN',{maximumFractionDigits:0})}/g`:'—'} sub="Gross value ÷ net weight" compact={isMobile}/>
              </div>

              {/* KPI Row 2 */}
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: isMobile ? 10 : 14, marginBottom: isMobile ? 14 : 22 }}>
                <KpiCard t={t} delay={240} label="Avg Purity"         icon="✦" color={t.purple} loading={loading} value={hasData?fmtPct(kpis.avg_purity):'—'} sub="Weighted by net weight" compact={isMobile}/>
                <KpiCard t={t} delay={300} label="Avg Wt / Bill"      icon="◈" color={t.text2}  loading={loading} value={hasData?`${fmt(kpis.avg_net_per_txn)}g`:'—'} sub="Net weight ÷ bills" compact={isMobile}/>
                <KpiCard t={t} delay={360} label="Avg Service Charge" icon="%" color={t.red}    loading={loading} value={hasData?`${Number(kpis.avg_service_charge_pct||0).toFixed(2)}%`:'—'} sub="Service charge ÷ gross value" compact={isMobile}/>
                <KpiCard t={t} delay={420} label="Active Branches"    icon="⬡" color={t.blue}   loading={loading} value={hasData?`${kpis.branch_count} / ${totalBranches}`:`— / ${totalBranches}`} sub={hasData?'branches purchased this period':'No purchases this period'} compact={isMobile}/>
              </div>

              {/* Purchase Mix */}
              {!loading && hasData && (
                <div style={{ background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:14, padding:'18px 22px', marginBottom:22 }}>
                  {isMobile
                    ? <div style={{ marginBottom:14 }}>
                        <div style={{ fontSize:13, color:t.text2, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, marginBottom:10 }}>Purchase Mix</div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                          {[{ color:t.gold, label:'Physical', pct:physPct, count:kpis.physical_count },{ color:'#e07820', label:'Takeover', pct:takePct, count:kpis.takeover_count }].map(item=>(
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
                          {[{ color:t.gold, label:'Physical', pct:physPct, count:kpis.physical_count },{ color:'#e07820', label:'Takeover', pct:takePct, count:kpis.takeover_count }].map(item=>(
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
                  <div style={{ display:'flex', height:10, borderRadius:100, overflow:'hidden', gap:2, boxShadow:'inset 0 1px 3px rgba(0,0,0,.4)' }}>
                    <div style={{ width:`${physPct}%`, background:`linear-gradient(90deg,${t.gold}aa,${t.gold})`, borderRadius:'100px 0 0 100px', transition:'width .8s cubic-bezier(.4,0,.2,1)', boxShadow:`0 0 10px ${t.gold}50` }}/>
                    <div style={{ flex:1, background:'linear-gradient(90deg,#e07820,#c85010)', borderRadius:'0 100px 100px 0', boxShadow:'0 0 10px #e0782050' }}/>
                  </div>
                </div>
              )}
            </>}

            {/* Bottom panels grid — only visible panels */}
            {visiblePanels > 0 && <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${visiblePanels},1fr)`, gap:16 }}>

              {/* By Region */}
              {showStateTable && <div style={panel}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <div style={panelTitle}>By Region</div>
                  <div style={panelMeta}>Net Weight</div>
                </div>
                {loading
                  ? [0,1,2,3,4].map(i=><div key={i} style={{ height:30, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:6, marginBottom:6, animation:'shimmer 1.5s infinite' }}/>)
                  : !hasStateData
                    ? <EmptyPanel t={t} />
                    : stateData.filter(s=>s.state && Number(s.total_net||0)>0).map((s,i)=>(
                        <StatRow key={s.state||i} delay={i*60}
                          label={s.state}
                          sub={`${s.branch_count||0} branches · ${Number(s.txn_count||s.total_count||0).toLocaleString('en-IN')} bills`}
                          value={`${fmt(s.total_net)}g`}
                          color={regionColorMap[s.state] || COLOR_PALETTE[i % COLOR_PALETTE.length]}
                          t={t}
                          bar={Number(s.total_net||0)} barMax={maxStateNet}/>
                      ))
                }
              </div>}


              {/* Top Branches */}
              {showTopBranches && <div style={panel}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <div style={panelTitle}>Top 5 Branches</div>
                  <div style={panelMeta}>Net Weight</div>
                </div>
                {loading
                  ? [0,1,2,3,4].map(i=><div key={i} style={{ height:26, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:4, marginBottom:6, animation:'shimmer 1.5s infinite' }}/>)
                  : !hasData
                    ? <EmptyPanel t={t} />
                    : topBranches.map((b,i)=>{
                        const region = branchRegionMap[b.branch_name]
                        const color  = regionColorMap[region] || t.green
                        return (
                          <StatRow key={b.branch_name} delay={i*50}
                            label={b.branch_name}
                            value={`${fmt(b.total_net)}g`}
                            color={color} t={t}
                            bar={Number(b.total_net||0)}
                            barMax={Math.max(...topBranches.map(x=>Number(x.total_net||0)),1)}/>
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
                      <StatRow key={b.branch_name} delay={i*50}
                        label={b.branch_name}
                        value={`${fmt(b.total_net)}g`}
                        color={t.red} t={t}
                        bar={Number(b.total_net||0)}
                        barMax={Math.max(...topBranches.map(x=>Number(x.total_net||0)),1)}/>
                    ))}
                  </>
                )}
              </div>}

            </div>}
          </div>
        </div>
      </div>}

      {/* ── ROADMAP ── */}
      <div style={{ marginTop:20, background:`linear-gradient(135deg,${t.card},${t.card2})`, border:`1px solid ${t.border}`, borderRadius:16, padding:'20px 28px', boxShadow:t.shadow }}>
        <div style={{ fontSize:12, color:t.text3, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:600, marginBottom:14 }}>Roadmap</div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {[
            { label:'Melting',          phase:'Phase 2', color:t.orange },
            { label:'Sales',            phase:'Phase 3', color:t.purple },
            { label:'ClawdBot AI',      phase:'Phase 4', color:t.blue   },
            { label:'Advanced Reports', phase:'Phase 5', color:t.green  },
          ].map(item=>(
            <div key={item.label} style={{ padding:'9px 18px', borderRadius:10, background:`linear-gradient(135deg,${item.color}14,${item.color}07)`, border:`1px solid ${item.color}32`, display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:13, color:item.color, fontWeight:600 }}>{item.label}</span>
              <span style={{ fontSize:11, color:t.text4, padding:'2px 8px', borderRadius:100, background:t.card2, border:`1px solid ${t.border}` }}>{item.phase}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
} 