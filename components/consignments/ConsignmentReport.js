'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', card3: '#1c1c1c', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8', shadow: '0 1px 3px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', card3: '#d8d0c2', text1: '#1a1208', text2: '#5a4a2a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3aa0', shadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06)' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtVal  = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null

const STALE_WARN = 7
const STALE_CRIT = 14
const STATE_ICONS = { Kerala: '🌴', Karnataka: '🏛️', 'Andhra Pradesh': '🌊', Telangana: '⭐' }

const exportCSV = (rows, filename) => {
  const headers = ['App ID','Date','Customer','Branch','State','Gross Wt','Net Wt','Purity','Final Amt','Type','Status','Days Old']
  const lines = [headers.join(','), ...rows.map(p => [
    p.application_id, p.purchase_date, `"${p.customer_name || ''}"`, `"${p.branch_name || ''}"`,
    p.state || '', p.gross_weight, p.net_weight, p.purity, p.final_amount_crm,
    p.transaction_type, p.stock_status, daysSince(p.purchase_date) ?? ''
  ].join(','))]
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}

// ── MINI DONUT ──
function MiniDonut({ a, b, colorA, colorB, size = 56 }) {
  const total = a + b || 1
  const pct = a / total
  const r = 20, cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  const dash = pct * circ
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={colorB} strokeWidth="7" opacity=".3" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={colorA} strokeWidth="7"
        strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4}
        strokeLinecap="round" style={{ transition: 'stroke-dasharray .6s ease' }} />
    </svg>
  )
}

// ── FLOW BAR ──
function FlowBar({ atBranch, inTransit, t }) {
  const total = atBranch + inTransit || 1
  const aPct  = (atBranch   / total * 100).toFixed(1)
  const iPct  = (inTransit  / total * 100).toFixed(1)
  return (
    <div>
      <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
        <div style={{ width: `${aPct}%`, background: t.blue,   transition: 'width .6s ease' }} />
        <div style={{ width: `${iPct}%`, background: t.orange, transition: 'width .6s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '.58rem', color: t.blue }}>At Branch {aPct}%</span>
        <span style={{ fontSize: '.58rem', color: t.orange }}>In Transit {iPct}%</span>
      </div>
    </div>
  )
}

// ── STALE BADGE ──
function StaleBadge({ days, t }) {
  if (days === null) return null
  const color = days >= STALE_CRIT ? t.red : days >= STALE_WARN ? t.orange : t.green
  return <span style={{ fontSize: '.58rem', padding: '2px 7px', borderRadius: '4px', background: `${color}20`, color, fontWeight: 500 }}>{days}d</span>
}

// ── SPARKLINE ──
function Sparkline({ values, color, width = 80, height = 28 }) {
  if (!values || values.length < 2) return null
  const max = Math.max(...values, 1), min = 0, range = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`).join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
    </svg>
  )
}

// ── KPI CARD ──
function KpiCard({ label, value, sub, color, icon, t }) {
  return (
    <div style={{ background: t.card2, borderRadius: '10px', padding: '14px 16px', border: `1px solid ${t.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ fontSize: '.52rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.12em' }}>{label}</div>
        {icon && <span style={{ fontSize: '.85rem', opacity: .6 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 200, color, lineHeight: 1, marginBottom: sub ? '4px' : 0 }}>{value}</div>
      {sub && <div style={{ fontSize: '.6rem', color: t.text4 }}>{sub}</div>}
    </div>
  )
}

// ── STATE CARD ──
function StateCard({ st, branches, t, onClick, isActive }) {
  const [hov, setHov] = useState(false)
  const staleBranches = branches.filter(b => b.state === st.state && daysSince(b.oldest_date) >= STALE_WARN).length
  const critBranches  = branches.filter(b => b.state === st.state && daysSince(b.oldest_date) >= STALE_CRIT).length
  const totalNet = Number(st.at_branch_net || 0) + Number(st.in_consignment_net || 0)
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: t.card, border: `1px solid ${isActive ? t.gold : hov ? t.gold : critBranches > 0 ? `${t.red}50` : t.border}`, borderRadius: '14px', padding: '18px 20px', cursor: 'pointer', boxShadow: hov ? `0 4px 24px rgba(0,0,0,.5)` : t.shadow, transition: 'all .2s', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-20px', right: '-10px', fontSize: '4rem', opacity: .04, pointerEvents: 'none' }}>{STATE_ICONS[st.state] || '📍'}</div>
      {isActive && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${t.gold}, transparent)` }} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '.65rem', marginBottom: '3px' }}>{STATE_ICONS[st.state] || '📍'}</div>
          <div style={{ fontSize: '.85rem', color: t.gold, fontWeight: 600 }}>{st.state}</div>
          <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '2px' }}>{st.branch_count || 0} branches</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <div style={{ fontSize: '.62rem', color: t.text3, background: t.card2, border: `1px solid ${t.border}`, borderRadius: '5px', padding: '2px 8px' }}>
            {(Number(st.at_branch_count || 0) + Number(st.in_consignment_count || 0)).toLocaleString('en-IN')} bills
          </div>
          {critBranches > 0 && <div style={{ fontSize: '.58rem', color: t.red, background: `${t.red}15`, borderRadius: '4px', padding: '2px 7px' }}>⚠ {critBranches} stale</div>}
        </div>
      </div>

      <FlowBar atBranch={Number(st.at_branch_net || 0)} inTransit={Number(st.in_consignment_net || 0)} t={t} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
        <div style={{ padding: '8px 10px', background: `${t.blue}10`, borderRadius: '7px', border: `1px solid ${t.blue}20` }}>
          <div style={{ fontSize: '.88rem', fontWeight: 200, color: t.blue }}>{fmt(st.at_branch_net)}<span style={{ fontSize: '.58rem' }}>g</span></div>
          <div style={{ fontSize: '.52rem', color: t.text4, marginTop: '2px', letterSpacing: '.08em' }}>AT BRANCH · {Number(st.at_branch_count || 0).toLocaleString('en-IN')} bills</div>
        </div>
        <div style={{ padding: '8px 10px', background: `${t.orange}10`, borderRadius: '7px', border: `1px solid ${t.orange}20` }}>
          <div style={{ fontSize: '.88rem', fontWeight: 200, color: t.orange }}>{fmt(st.in_consignment_net)}<span style={{ fontSize: '.58rem' }}>g</span></div>
          <div style={{ fontSize: '.52rem', color: t.text4, marginTop: '2px', letterSpacing: '.08em' }}>IN TRANSIT · {Number(st.in_consignment_count || 0).toLocaleString('en-IN')} bills</div>
        </div>
      </div>

      <div style={{ marginTop: '10px', fontSize: '.6rem', color: hov || isActive ? t.gold : t.text4, transition: 'color .2s' }}>
        {isActive ? 'Viewing branches ↓' : 'Click to drill in →'}
      </div>
    </div>
  )
}

// ── BRANCH ROW ──
function BranchRow({ b, t, onClick, isActive }) {
  const [hov, setHov] = useState(false)
  const staleDays = daysSince(b.oldest_date)
  const transitPct = (Number(b.in_consignment_net || 0) / (Number(b.at_branch_net || 0) + Number(b.in_consignment_net || 0) || 1) * 100).toFixed(0)
  return (
    <tr onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: isActive ? `${t.gold}08` : hov ? `${t.gold}06` : 'transparent', cursor: 'pointer', transition: 'background .12s', borderLeft: isActive ? `2px solid ${t.gold}` : '2px solid transparent' }}>
      <td style={{ padding: '10px 14px', fontSize: '.75rem', color: t.gold, fontWeight: 500, whiteSpace: 'nowrap' }}>{b.branch_name}</td>
      <td style={{ padding: '10px 14px', fontSize: '.68rem', color: t.text3, whiteSpace: 'nowrap' }}>{b.region || '—'}</td>
      <td style={{ padding: '10px 14px', fontSize: '.72rem', color: t.blue, whiteSpace: 'nowrap' }}>{Number(b.at_branch_count || 0).toLocaleString('en-IN')}</td>
      <td style={{ padding: '10px 14px', fontSize: '.72rem', color: t.blue, whiteSpace: 'nowrap' }}>{fmt(b.at_branch_net)}g</td>
      <td style={{ padding: '10px 14px', fontSize: '.72rem', color: t.orange, whiteSpace: 'nowrap' }}>{Number(b.in_consignment_count || 0).toLocaleString('en-IN')}</td>
      <td style={{ padding: '10px 14px', fontSize: '.72rem', color: t.orange, whiteSpace: 'nowrap' }}>{fmt(b.in_consignment_net)}g</td>
      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
        <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: t.border, overflow: 'hidden' }}>
          <div style={{ width: `${transitPct}%`, height: '100%', background: t.orange, borderRadius: '2px' }} />
        </div>
      </td>
      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}><StaleBadge days={staleDays} t={t} /></td>
    </tr>
  )
}

// ══════════════════════════════
// ── MAIN COMPONENT ──
// ══════════════════════════════
export default function ConsignmentReport() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  // ── Data ──
  const [kpis, setKpis]               = useState(null)
  const [branchData, setBranchData]   = useState([])  // raw from RPC + oldest_date
  const [stateSummary, setStateSummary] = useState([])
  const [purchases, setPurchases]     = useState([])
  const [totalCount, setTotalCount]   = useState(0)

  // ── Loading ──
  const [loadingKpis, setLoadingKpis]         = useState(true)
  const [loadingSummary, setLoadingSummary]   = useState(true)
  const [loadingTable, setLoadingTable]       = useState(false)

  // ── Drill ──
  const [drillState, setDrillState]   = useState(null)
  const [drillBranch, setDrillBranch] = useState(null)

  // ── Table filters ──
  const [filterStatus, setFilterStatus] = useState('')
  const [filterTxn, setFilterTxn]       = useState('')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(0)
  const [sortCol, setSortCol]           = useState('purchase_date')
  const [sortDir, setSortDir]           = useState('asc')
  const [exporting, setExporting]       = useState(false)

  const PAGE_SIZE  = 100
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // ── Load on mount ──
  useEffect(() => { loadKpis(); loadSummary() }, [])

  // ── Reload table when filters change ──
  useEffect(() => { setPage(0); loadTable(0) }, [drillState, drillBranch, filterStatus, filterTxn, dateFrom, dateTo, search, sortCol, sortDir])
  useEffect(() => { loadTable(page) }, [page])

  const loadKpis = async () => {
    setLoadingKpis(true)
    const { data } = await supabase.rpc('get_consignment_report_kpis')
    if (data) setKpis(data)
    setLoadingKpis(false)
  }

  const loadSummary = async () => {
    setLoadingSummary(true)
    const [{ data: statusData }, { data: oldestData }] = await Promise.all([
      supabase.rpc('get_consignment_branch_status_summary'),
      // Get oldest purchase date per branch for stale indicator
      supabase.from('purchases')
        .select('branch_name, purchase_date')
        .in('stock_status', ['at_branch', 'in_consignment'])
        .eq('is_deleted', false)
        .order('purchase_date', { ascending: true }),
    ])

    const rows = statusData || []

    // Build oldest_date map
    const oldestMap = {}
    ;(oldestData || []).forEach(p => {
      if (!oldestMap[p.branch_name]) oldestMap[p.branch_name] = p.purchase_date
    })

    // Enrich branch data with oldest_date + region
    const { data: branchMeta } = await supabase.from('branches').select('name, region, cluster').eq('model_type', 'outside_bangalore')
    const metaMap = {}
    ;(branchMeta || []).forEach(b => { metaMap[b.name] = b })

    const enriched = rows.map(b => ({
      ...b,
      oldest_date: oldestMap[b.branch_name] || null,
      region:  metaMap[b.branch_name]?.region  || null,
      cluster: metaMap[b.branch_name]?.cluster || null,
    }))

    setBranchData(enriched)

    // Build state summary
    const stateMap = {}
    enriched.forEach(b => {
      if (!stateMap[b.state]) stateMap[b.state] = { state: b.state, at_branch_count: 0, at_branch_net: 0, in_consignment_count: 0, in_consignment_net: 0, branch_count: 0 }
      stateMap[b.state].at_branch_count      += Number(b.at_branch_count || 0)
      stateMap[b.state].at_branch_net        += Number(b.at_branch_net || 0)
      stateMap[b.state].in_consignment_count += Number(b.in_consignment_count || 0)
      stateMap[b.state].in_consignment_net   += Number(b.in_consignment_net || 0)
      stateMap[b.state].branch_count         += 1
    })
    setStateSummary(Object.values(stateMap).sort((a, b) => b.at_branch_net - a.at_branch_net))
    setLoadingSummary(false)
  }

  const loadTable = async (pageNum) => {
    setLoadingTable(true)

    // Build branch filter
    let branchNames = null
    if (drillBranch) {
      branchNames = [drillBranch]
    } else if (drillState) {
      const { data } = await supabase.from('branches').select('name').eq('model_type', 'outside_bangalore').eq('state', drillState).eq('is_active', true)
      branchNames = (data || []).map(b => b.name)
    } else {
      const { data } = await supabase.from('branches').select('name').eq('model_type', 'outside_bangalore').eq('is_active', true)
      branchNames = (data || []).map(b => b.name)
    }

    if (!branchNames || !branchNames.length) { setPurchases([]); setTotalCount(0); setLoadingTable(false); return }

    let q = supabase.from('purchases').select('*', { count: 'exact' })
      .in('stock_status', filterStatus ? [filterStatus] : ['at_branch', 'in_consignment'])
      .eq('is_deleted', false)
      .in('branch_name', branchNames)

    if (filterTxn)  q = q.eq('transaction_type', filterTxn)
    if (dateFrom)   q = q.gte('purchase_date', dateFrom)
    if (dateTo)     q = q.lte('purchase_date', dateTo)
    if (search)     q = q.or(`customer_name.ilike.%${search}%,application_id.ilike.%${search}%,branch_name.ilike.%${search}%`)

    const from = pageNum * PAGE_SIZE
    const { data, count } = await q.order(sortCol, { ascending: sortDir === 'asc' }).range(from, from + PAGE_SIZE - 1)
    setPurchases(data || [])
    if (count !== null) setTotalCount(count)
    setLoadingTable(false)
  }

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const handleExport = async () => {
    setExporting(true)
    let branchNames = null
    if (drillBranch) { branchNames = [drillBranch] }
    else if (drillState) { const { data } = await supabase.from('branches').select('name').eq('model_type', 'outside_bangalore').eq('state', drillState).eq('is_active', true); branchNames = (data || []).map(b => b.name) }
    else { const { data } = await supabase.from('branches').select('name').eq('model_type', 'outside_bangalore').eq('is_active', true); branchNames = (data || []).map(b => b.name) }
    let q = supabase.from('purchases').select('*')
      .in('stock_status', filterStatus ? [filterStatus] : ['at_branch', 'in_consignment'])
      .eq('is_deleted', false).in('branch_name', branchNames || [])
    if (filterTxn) q = q.eq('transaction_type', filterTxn)
    if (dateFrom)  q = q.gte('purchase_date', dateFrom)
    if (dateTo)    q = q.lte('purchase_date', dateTo)
    if (search)    q = q.or(`customer_name.ilike.%${search}%,application_id.ilike.%${search}%,branch_name.ilike.%${search}%`)
    const { data } = await q.order('purchase_date', { ascending: true })
    exportCSV(data || [], `consignment_${drillBranch || drillState || 'all'}.csv`)
    setExporting(false)
  }

  // ── Derived stats ──
  const staleBranches = branchData.filter(b => daysSince(b.oldest_date) >= STALE_WARN)
  const critBranches  = branchData.filter(b => daysSince(b.oldest_date) >= STALE_CRIT)
  const filteredBranches = drillState ? branchData.filter(b => b.state === drillState) : branchData
  const totalNet = Number(kpis?.at_branch?.net || 0) + Number(kpis?.in_consignment?.net || 0)
  const transitRatio = totalNet > 0 ? (Number(kpis?.in_consignment?.net || 0) / totalNet * 100).toFixed(1) : 0

  const SortIcon = ({ col }) => (
    <span style={{ marginLeft: '4px', fontSize: '.5rem', opacity: sortCol === col ? 1 : .25 }}>
      {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
    </span>
  )

  const th = { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
  const td = { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}18`, whiteSpace: 'nowrap' }
  const inp = { background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '.72rem', outline: 'none' }
  const pill = (active, color) => ({ padding: '5px 14px', borderRadius: '100px', border: `1px solid ${active ? (color || t.gold) : t.border}`, background: active ? `${color || t.gold}18` : 'transparent', color: active ? (color || t.gold) : t.text3, fontSize: '.65rem', cursor: 'pointer' })

  return (
    <div style={{ padding: '28px 32px' }}>
      <style>{`@keyframes shimmer{0%,100%{opacity:.5}50%{opacity:.9}}`}</style>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '6px' }}>Stock Flow</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em', lineHeight: 1 }}>Consignment Report</div>
          <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '6px' }}>Outside-Bangalore branches · At Branch + In Transit</div>
        </div>
        {critBranches.length > 0 && (
          <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '.85rem' }}>⚠️</span>
            <div>
              <div style={{ fontSize: '.72rem', color: t.red, fontWeight: 500 }}>{critBranches.length} branches with stale stock</div>
              <div style={{ fontSize: '.6rem', color: t.text3 }}>Stock sitting &gt;{STALE_CRIT} days — needs urgent dispatch</div>
            </div>
          </div>
        )}
      </div>

      {/* ── TOP KPI ROW ── */}
      {loadingKpis ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '24px' }}>
          {[...Array(6)].map((_, i) => <div key={i} style={{ height: '80px', background: t.card, borderRadius: '10px', border: `1px solid ${t.border}`, animation: 'shimmer 1.5s infinite' }} />)}
        </div>
      ) : kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '24px' }}>
          <KpiCard label="At Branch — Bills"     value={Number(kpis.at_branch?.count || 0).toLocaleString('en-IN')}         color={t.blue}   icon="📦" t={t} sub={`${Number(kpis.at_branch?.branches || 0)} branches`} />
          <KpiCard label="At Branch — Net Wt"    value={`${fmt(kpis.at_branch?.net)}g`}                                      color={t.blue}   t={t} />
          <KpiCard label="At Branch — Value"     value={fmtVal(kpis.at_branch?.value)}                                       color={t.green}  t={t} />
          <KpiCard label="In Transit — Bills"    value={Number(kpis.in_consignment?.count || 0).toLocaleString('en-IN')}     color={t.orange} icon="🚚" t={t} sub={`${Number(kpis.in_consignment?.branches || 0)} branches`} />
          <KpiCard label="In Transit — Net Wt"   value={`${fmt(kpis.in_consignment?.net)}g`}                                 color={t.orange} t={t} />
          <KpiCard label="Transit Ratio"         value={`${transitRatio}%`}                                                  color={transitRatio > 50 ? t.green : t.orange} t={t} sub="of total net wt dispatched" />
        </div>
      )}

      {/* ── SUMMARY STRIP ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '24px' }}>
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ fontSize: '.52rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Stock Flow</div>
          {kpis && <FlowBar atBranch={Number(kpis.at_branch?.net || 0)} inTransit={Number(kpis.in_consignment?.net || 0)} t={t} />}
        </div>
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ fontSize: '.52rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Stale Stock</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <div><div style={{ fontSize: '1.2rem', fontWeight: 200, color: t.orange }}>{staleBranches.length}</div><div style={{ fontSize: '.55rem', color: t.text4 }}>&gt;{STALE_WARN}d</div></div>
            <div><div style={{ fontSize: '1.2rem', fontWeight: 200, color: t.red }}>{critBranches.length}</div><div style={{ fontSize: '.55rem', color: t.text4 }}>&gt;{STALE_CRIT}d</div></div>
          </div>
        </div>
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ fontSize: '.52rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Active Branches</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 200, color: t.blue }}>{branchData.length}</div>
          <div style={{ fontSize: '.6rem', color: t.text4 }}>{stateSummary.length} states</div>
        </div>
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ fontSize: '.52rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Total Net Wt</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 200, color: t.gold }}>{fmt(totalNet)}g</div>
          <div style={{ fontSize: '.6rem', color: t.text4 }}>{fmtVal(Number(kpis?.at_branch?.value || 0) + Number(kpis?.in_consignment?.value || 0))} total value</div>
        </div>
      </div>

      {/* ── STATE CARDS ── */}
      {!loadingSummary && stateSummary.length > 0 && (
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '20px 24px', marginBottom: '20px', boxShadow: t.shadow }}>

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
            <button onClick={() => { setDrillState(null); setDrillBranch(null) }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '.65rem', color: drillState ? t.text3 : t.gold, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: drillState ? 400 : 600 }}>
              All States
            </button>
            {drillState && <>
              <span style={{ color: t.text4, fontSize: '.7rem' }}>›</span>
              <button onClick={() => setDrillBranch(null)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '.65rem', color: drillBranch ? t.text3 : t.gold, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: drillBranch ? 400 : 600 }}>
                {STATE_ICONS[drillState]} {drillState}
              </button>
            </>}
            {drillBranch && <>
              <span style={{ color: t.text4, fontSize: '.7rem' }}>›</span>
              <span style={{ fontSize: '.65rem', color: t.gold, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>{drillBranch}</span>
            </>}
          </div>

          {/* State cards */}
          {!drillState && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {stateSummary.map(st => (
                <StateCard key={st.state} st={st} branches={branchData} t={t}
                  isActive={drillState === st.state}
                  onClick={() => { setDrillState(st.state); setDrillBranch(null) }} />
              ))}
            </div>
          )}

          {/* Branch table */}
          {drillState && !drillBranch && (
            <div style={{ overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Branch','Region','At Branch Bills','At Branch Net Wt','In Transit Bills','In Transit Net Wt','Transit %','Oldest'].map(h => (
                      <th key={h} style={{ ...th, cursor: 'default' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBranches
                    .sort((a, b) => Number(b.at_branch_net || 0) - Number(a.at_branch_net || 0))
                    .map((b, i) => (
                      <BranchRow key={b.branch_name} b={b} t={t}
                        isActive={drillBranch === b.branch_name}
                        onClick={() => setDrillBranch(b.branch_name)} />
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {drillBranch && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: `${t.gold}08`, borderRadius: '8px', border: `1px solid ${t.gold}20` }}>
              <span style={{ fontSize: '.68rem', color: t.text2 }}>
                Showing all bills for <span style={{ color: t.gold, fontWeight: 500 }}>{drillBranch}</span> in the table below
              </span>
              <button onClick={() => setDrillBranch(null)}
                style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 12px', color: t.text3, cursor: 'pointer', fontSize: '.65rem' }}>
                ← Back to {drillState}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── TABLE CONTROLS ── */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input style={{ ...inp, width: '230px' }} placeholder="Search customer, app ID, branch..." value={search} onChange={e => setSearch(e.target.value)} />

        {/* Status filter */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button style={pill(!filterStatus)}                         onClick={() => setFilterStatus('')}>All</button>
          <button style={pill(filterStatus === 'at_branch', t.blue)}  onClick={() => setFilterStatus(filterStatus === 'at_branch' ? '' : 'at_branch')}>At Branch</button>
          <button style={pill(filterStatus === 'in_consignment', t.orange)} onClick={() => setFilterStatus(filterStatus === 'in_consignment' ? '' : 'in_consignment')}>In Transit</button>
        </div>

        {/* Txn type */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button style={pill(filterTxn === 'PHYSICAL', t.gold)} onClick={() => setFilterTxn(filterTxn === 'PHYSICAL' ? '' : 'PHYSICAL')}>Physical</button>
          <button style={pill(filterTxn === 'TAKEOVER', t.blue)} onClick={() => setFilterTxn(filterTxn === 'TAKEOVER' ? '' : 'TAKEOVER')}>Takeover</button>
        </div>

        {/* Date range */}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, fontSize: '.7rem', cursor: 'pointer' }} />
        <span style={{ fontSize: '.65rem', color: t.text4 }}>to</span>
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={{ ...inp, fontSize: '.7rem', cursor: 'pointer' }} />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} style={{ background: 'none', border: 'none', color: t.text4, fontSize: '.7rem', cursor: 'pointer' }}>✕</button>}

        {/* Export */}
        <button onClick={handleExport} disabled={exporting}
          style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 16px', color: t.text2, fontSize: '.7rem', cursor: exporting ? 'wait' : 'pointer' }}>
          {exporting ? 'Exporting...' : '↓ Export CSV'}
        </button>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontSize: '.68rem', color: t.text3 }}>
          {totalCount === 0 ? 'No records' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString('en-IN')} of ${totalCount.toLocaleString('en-IN')} records`}
          {totalCount > PAGE_SIZE && <span style={{ color: t.orange, marginLeft: '8px' }}>· Use Export for all</span>}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
            style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 12px', color: t.text3, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? .4 : 1, fontSize: '.7rem' }}>←</button>
          <span style={{ fontSize: '.68rem', color: t.text3 }}>Page {page + 1} / {totalPages || 1}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 12px', color: t.text3, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? .4 : 1, fontSize: '.7rem' }}>→</button>
        </div>
      </div>

      {/* ── TABLE ── */}
      {loadingTable ? (
        <div style={{ textAlign: 'center', padding: '80px', color: t.text4, fontSize: '.75rem', letterSpacing: '.1em' }}>Loading records...</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '12px', border: `1px solid ${t.border}`, boxShadow: t.shadow }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  { label: 'App ID',    col: 'application_id'   },
                  { label: 'Date',      col: 'purchase_date'    },
                  { label: 'Customer',  col: 'customer_name'    },
                  { label: 'Branch',    col: 'branch_name'      },
                  { label: 'Gross Wt',  col: 'gross_weight'     },
                  { label: 'Net Wt',    col: 'net_weight'       },
                  { label: 'Purity',    col: 'purity'           },
                  { label: 'Final Amt', col: 'final_amount_crm' },
                  { label: 'Type',      col: 'transaction_type' },
                  { label: 'Status',    col: 'stock_status'     },
                  { label: 'Age',       col: null               },
                ].map(({ label, col }) => (
                  <th key={label} onClick={col ? () => handleSort(col) : undefined}
                    style={{ ...th, color: col && sortCol === col ? t.gold : t.text3, cursor: col ? 'pointer' : 'default' }}>
                    {label}{col && <SortIcon col={col} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map((p, i) => {
                const age        = daysSince(p.purchase_date)
                const ageColor   = age == null ? t.text4 : age >= STALE_CRIT ? t.red : age >= STALE_WARN ? t.orange : t.green
                const isStale    = age != null && age >= STALE_WARN
                const statusColor = p.stock_status === 'at_branch' ? t.blue : t.orange
                const statusLabel = p.stock_status === 'at_branch' ? 'At Branch' : 'In Transit'
                return (
                  <tr key={p.id}
                    style={{ background: isStale && age >= STALE_CRIT ? `${t.red}05` : i % 2 === 0 ? 'transparent' : `${t.border}12`, transition: 'background .12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                    onMouseLeave={e => e.currentTarget.style.background = isStale && age >= STALE_CRIT ? `${t.red}05` : i % 2 === 0 ? 'transparent' : `${t.border}12`}>
                    <td style={{ ...td, color: t.gold, fontWeight: 500, fontFamily: 'monospace' }}>{p.application_id}</td>
                    <td style={{ ...td, color: t.text2 }}>{fmtDate(p.purchase_date)}</td>
                    <td style={{ ...td, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.customer_name}</td>
                    <td style={{ ...td, color: t.text2 }}>{p.branch_name}</td>
                    <td style={td}>{fmt(p.gross_weight)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                    <td style={{ ...td, color: t.gold }}>{fmt(p.net_weight)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                    <td style={td}>{fmt(p.purity)}<span style={{ fontSize: '.62rem', color: t.text4 }}>%</span></td>
                    <td style={{ ...td, color: t.green }}>{fmtVal(p.final_amount_crm)}</td>
                    <td style={td}>
                      <span style={{ fontSize: '.65rem', padding: '2px 8px', borderRadius: '100px', background: `${p.transaction_type === 'PHYSICAL' ? t.gold : t.blue}18`, color: p.transaction_type === 'PHYSICAL' ? t.gold : t.blue }}>
                        {p.transaction_type}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: '.65rem', padding: '3px 9px', borderRadius: '100px', background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                        {statusLabel}
                      </span>
                    </td>
                    <td style={{ ...td, color: ageColor, fontWeight: age >= STALE_CRIT ? 600 : 400 }}>
                      {age != null ? `${age}d` : '—'}
                    </td>
                  </tr>
                )
              })}
              {purchases.length === 0 && (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: t.text4, padding: '60px' }}>No records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}