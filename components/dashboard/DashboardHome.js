'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import AnimatedNumber from '../ui/AnimatedNumber'
import LiveTicker from '../ui/LiveTicker'

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
        <div style={{ fontSize:13, color:t.text2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:500 }}>{label}</div>
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
  const { theme, userProfile, canSee, setActiveNav } = useApp()
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

  const [period,        setPeriod]        = useState('mtd')
  const [overviewOpen,  setOverviewOpen]  = useState(false)
  const [selectedRegion, setSelectedRegion] = useState(null)
  const [selectedState,  setSelectedState]  = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [kpis,          setKpis]          = useState(null)
  const [stateData,     setStateData]     = useState([])
  const [topBranches,   setTopBranches]   = useState([])
  const [branchMeta,    setBranchMeta]    = useState([])
  const [regionCounts,  setRegionCounts]  = useState({})
  const [stateCount,    setStateCount]    = useState(0)
  const [heroVis,       setHeroVis]       = useState(false)

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
        supabase.rpc('get_report_kpis', { p_from: todayStr, p_to: todayStr, p_branch: null, p_txn_type: null, p_state: null })
          .then(({ data }) => setTodayKpis(Array.isArray(data) ? data[0] : data))
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
    supabase.from('branches').select('name, region, state').eq('is_active', true).then(({ data }) => {
      if (!data) return
      setBranchMeta(data)
      const rc = {}
      data.forEach(b => { if (b.region) rc[b.region] = (rc[b.region] || 0) + 1 })
      setRegionCounts(rc)
      const states = new Set(data.map(b => b.state).filter(Boolean))
      setStateCount(states.size)
    })
  }, [showPurchase])

  useEffect(() => { if (showPurchase) fetchAll() }, [period, showPurchase, selectedState, selectedRegion]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = async () => {
    setLoading(true)
    setStateData([])
    setTopBranches([])
    const { from, to } = getRange(period)

    if (selectedRegion) {
      const statesInRegion = [...new Set(branchMeta.filter(b => b.region === selectedRegion).map(b => b.state).filter(Boolean))]
      const [stateResults, allStates, branches] = await Promise.all([
        Promise.all(statesInRegion.map(s =>
          supabase.rpc('get_report_kpis', { p_from:from, p_to:to, p_branch:null, p_txn_type:null, p_state:s })
            .then(({data}) => Array.isArray(data) ? data[0] : data)
        )),
        supabase.rpc('get_state_summary', { p_from:from, p_to:to, p_txn_type:null }),
        supabase.rpc('get_branch_summary', { p_from:from, p_to:to, p_txn_type:null, p_state:null }),
      ])
      const valid    = stateResults.filter(Boolean)
      const totalNet = valid.reduce((s,r) => s + Number(r.total_net||0), 0)
      const totalCnt = valid.reduce((s,r) => s + Number(r.total_count||0), 0)
      setKpis({
        total_count:            totalCnt,
        total_net:              totalNet,
        total_value:            valid.reduce((s,r) => s + Number(r.total_value||0), 0),
        physical_count:         valid.reduce((s,r) => s + Number(r.physical_count||0), 0),
        takeover_count:         valid.reduce((s,r) => s + Number(r.takeover_count||0), 0),
        avg_rate_per_gram:      totalNet > 0 ? valid.reduce((s,r) => s + Number(r.total_value||0), 0) / totalNet : 0,
        avg_purity:             totalNet > 0 ? valid.reduce((s,r) => s + Number(r.avg_purity||0)*Number(r.total_net||0), 0) / totalNet : 0,
        avg_net_per_txn:        totalCnt > 0 ? totalNet / totalCnt : 0,
        avg_service_charge_pct: totalNet > 0 ? valid.reduce((s,r) => s + Number(r.avg_service_charge_pct||0)*Number(r.total_net||0), 0) / totalNet : 0,
        branch_count:           valid.filter(r => Number(r.total_count||0) > 0).length,
      })
      const filteredStates = (allStates.data||[]).filter(s => statesInRegion.includes(s.state))
      const branchNamesInRegion = branchMeta.filter(b => b.region === selectedRegion).map(b => b.name)
      setStateData(filteredStates)
      setTopBranches((branches.data||[]).filter(b => branchNamesInRegion.includes(b.branch)).sort((a,b)=>Number(b.total_net||0)-Number(a.total_net||0)).slice(0,7))
    } else {
      const p = { p_from:from, p_to:to, p_branch:null, p_txn_type:null, p_state: selectedState || null }
      const [all, states, branches] = await Promise.all([
        supabase.rpc('get_report_kpis', p),
        supabase.rpc('get_state_summary', { p_from:from, p_to:to, p_txn_type:null }),
        supabase.rpc('get_branch_summary', { p_from:from, p_to:to, p_txn_type:null, p_state: selectedState || null }),
      ])
      if (all.data) setKpis(Array.isArray(all.data)?all.data[0]:all.data)
      const allStateRows = states.data || []
      setStateData(selectedState ? allStateRows.filter(s => s.state === selectedState) : allStateRows)
      if (branches.data) setTopBranches((branches.data||[]).sort((a,b)=>Number(b.total_net||0)-Number(a.total_net||0)).slice(0,7))
    }
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

  const availableRegions = [...new Set(branchMeta.map(b => b.region).filter(Boolean))].sort()
  const availableStates  = selectedRegion
    ? [...new Set(branchMeta.filter(b => b.region === selectedRegion).map(b => b.state).filter(Boolean))].sort()
    : [...new Set(branchMeta.map(b => b.state).filter(Boolean))].sort()

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
    <div style={{ padding: isMobile ? '16px' : '28px 32px' }}>
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
          <div style={{ fontSize:12, color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:24, height:1, background:`linear-gradient(90deg,transparent,${t.gold})`, display:'inline-block' }}/>
            {getGreeting()}, {name}
          </div>
          <div style={{ fontSize:36, fontWeight:200, color:t.text1, lineHeight:1.15, marginBottom:24, letterSpacing:'-.02em' }}>
            Every gram.<br/>
            <span style={{ fontStyle:'italic', color:t.gold, textShadow:`0 0 40px ${t.gold}40` }}>Accounted for.</span>
          </div>
        </div>
      </div>

      {/* ── LIVE RATES ── */}
      <LiveTicker />

      {/* ── MODULE HUB ── */}
      {(() => {
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
              <div onClick={e=>e.stopPropagation()} style={{ display:'flex', gap:3, padding:4, background:t.card, borderRadius:10, border:`1px solid ${t.border}`, boxShadow:'inset 0 1px 3px rgba(0,0,0,.3)', overflowX:'auto', scrollbarWidth:'none', marginBottom:14, WebkitOverflowScrolling:'touch' }}>
                {PERIODS.map(({ key, label }) => (
                  <button key={key} onClick={()=>setPeriod(key)} style={{ padding:'6px 12px', borderRadius:7, border:'none', cursor:'pointer', background:period===key?`linear-gradient(135deg,${t.gold},${t.gold}cc)`:'transparent', color:period===key?'#0a0a0a':t.text3, fontSize:12, fontWeight:period===key?700:500, letterSpacing:'.03em', transition:'all .2s cubic-bezier(.34,1.56,.64,1)', boxShadow:period===key?`0 2px 8px ${t.gold}40`:'none', whiteSpace:'nowrap', flexShrink:0 }}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Region + State filter pills */}
            {overviewOpen && (availableRegions.length > 0 || availableStates.length > 0) && (
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
                {availableRegions.length > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
                    <div style={{ fontSize:9, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', flexShrink:0, fontWeight:600 }}>Region</div>
                    {[null, ...availableRegions].map(r => {
                      const active = r === null ? (!selectedRegion && !selectedState) : selectedRegion === r
                      return (
                        <button key={r||'all'} onClick={() => { setSelectedRegion(r); setSelectedState(null) }}
                          style={{ padding:'4px 10px', borderRadius:20, border:`1px solid ${active ? t.gold+'66' : t.border}`, background: active ? `${t.gold}18` : 'transparent', color: active ? t.gold : t.text4, fontSize:11, fontWeight: active ? 700 : 500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .18s' }}>
                          {r || 'All'}
                        </button>
                      )
                    })}
                  </div>
                )}
                {availableStates.length > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
                    <div style={{ fontSize:9, color:t.text4, letterSpacing:'.1em', textTransform:'uppercase', flexShrink:0, fontWeight:600 }}>State</div>
                    {[null, ...availableStates].map(s => {
                      const active = s === null ? !selectedState : selectedState === s
                      return (
                        <button key={s||'all'} onClick={() => { setSelectedState(s); if (s) setSelectedRegion(null) }}
                          style={{ padding:'4px 10px', borderRadius:20, border:`1px solid ${active ? t.blue+'66' : t.border}`, background: active ? `${t.blue}18` : 'transparent', color: active ? t.blue : t.text4, fontSize:11, fontWeight: active ? 700 : 500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .18s' }}>
                          {s || 'All'}
                        </button>
                      )
                    })}
                  </div>
                )}
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
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
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
                          sub={`${regionCounts[s.state]||0} branches · ${Number(s.txn_count||s.total_count||0).toLocaleString('en-IN')} bills`}
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
                  <div style={panelTitle}>Top Branches</div>
                  <div style={panelMeta}>Net Weight</div>
                </div>
                {loading
                  ? [0,1,2,3,4,5,6].map(i=><div key={i} style={{ height:26, background:`linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize:'200% 100%', borderRadius:4, marginBottom:6, animation:'shimmer 1.5s infinite' }}/>)
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