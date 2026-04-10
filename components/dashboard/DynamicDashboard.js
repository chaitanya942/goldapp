'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts'

const THEMES = {
  dark:  { bg:'#0a0a0a', card:'#111111', card2:'#161616', card3:'#0f0f0f', text1:'#f0e6c8', text2:'#c8b89a', text3:'#9a8a6a', text4:'#6a5a3a', gold:'#c9a84c', border:'#1e1e1e', border2:'#252525', green:'#3aaa6a', red:'#e05555', blue:'#3a8fbf', orange:'#c9981f', purple:'#8c5ac8' },
  light: { bg:'#f5f0e8', card:'#faf7f2', card2:'#f0ebe0', card3:'#e8e2d6', text1:'#1a1208', text2:'#3a2a10', text3:'#7a6a4a', text4:'#9a8a6a', gold:'#9a7228', border:'#e0dace', border2:'#d0c8b8', green:'#2a8a5a', red:'#c03030', blue:'#2a6a9a', orange:'#a07010', purple:'#6a3a9a' },
}

const istNow   = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const istStr   = (d = istNow()) => d.toISOString().split('T')[0]
const daysBack = (n) => { const d = new Date(istNow().getTime() - n * 86400000); return istStr(d) }
const fmt      = (n, dec = 1) => n != null ? Number(n).toFixed(dec) : '—'
const fmtN     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtCr    = (n) => { if (!n || n === 0) return '—'; const cr = n / 1e7; return cr >= 1 ? `₹${cr.toFixed(2)}Cr` : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` }
const fmtDay   = (d) => { if (!d) return ''; const [, m, day] = d.split('-'); return `${day}/${m}` }
const greeting = () => { const h = istNow().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

// ── Shared shimmer skeleton ───────────────────────────────────────────────────
const Shimmer = ({ h = 24, w = '60%', t }) => (
  <div style={{ height: h, width: w, background: `linear-gradient(90deg,${t.border2},${t.border},${t.border2})`, backgroundSize: '200% 100%', borderRadius: 6, animation: 'shimmer 1.5s infinite', opacity: .9 }} />
)

// ── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({ label, value, color, loading, t, border }) {
  return (
    <div style={{ background: t.card3, borderRadius: 12, padding: '16px 18px', border: `1px solid ${border || t.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${color}60,${color}20)`, borderRadius: '12px 12px 0 0' }} />
      {loading
        ? <><Shimmer h={28} w="70%" t={t} /><Shimmer h={11} w="50%" t={t} style={{ marginTop: 8 }} /></>
        : <>
            <div style={{ fontSize: 26, fontWeight: 300, color, letterSpacing: '-.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div style={{ fontSize: 11, color: t.text3, marginTop: 6, lineHeight: 1.3, fontWeight: 500 }}>{label}</div>
          </>
      }
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, icon, color, t, children, onOpen, ctaLabel, delay = 0 }) {
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(() => setVis(true), delay); return () => clearTimeout(id) }, [delay])
  return (
    <div style={{
      background: `linear-gradient(145deg,${t.card},${t.card2})`,
      border: `1px solid ${t.border}`, borderRadius: 20, padding: '24px 28px',
      position: 'relative', overflow: 'hidden',
      opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(14px)',
      transition: 'all .4s cubic-bezier(.34,1.2,.64,1)',
    }}>
      {/* Top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent 5%,${color}70 40%,${color}40 60%,transparent 95%)` }} />
      {/* Background glow orb */}
      <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle,${color}14 0%,transparent 65%)`, pointerEvents: 'none' }} />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: `${color}18`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>{icon}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text1, letterSpacing: '.04em', textTransform: 'uppercase' }}>{title}</div>
        </div>
        {onOpen && (
          <button onClick={onOpen} style={{ padding: '6px 14px', borderRadius: 8, background: `${color}15`, border: `1px solid ${color}35`, color, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all .15s', letterSpacing: '.03em' }}
            onMouseEnter={e => { e.currentTarget.style.background = `${color}28`; e.currentTarget.style.boxShadow = `0 0 14px ${color}28` }}
            onMouseLeave={e => { e.currentTarget.style.background = `${color}15`; e.currentTarget.style.boxShadow = 'none' }}>
            {ctaLabel} →
          </button>
        )}
      </div>
      {/* Divider */}
      <div style={{ height: 1, background: `linear-gradient(90deg,${color}25,transparent)`, margin: '16px 0' }} />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  )
}

// ── Mini bar label ────────────────────────────────────────────────────────────
function MiniBarRow({ label, value, max, color, sub, t }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11.5, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11.5, color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{sub}</span>
      </div>
      <div style={{ height: 4, background: t.border2, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${color},${color}bb)`, borderRadius: 3, transition: 'width .7s cubic-bezier(.34,1.2,.64,1)' }} />
      </div>
    </div>
  )
}

// ══ PURCHASE SECTION ══════════════════════════════════════════════════════════
function PurchaseSection({ t, setActiveNav, canSee }) {
  const canSeeData    = canSee('purchase-data')
  const canSeeReports = canSee('purchase-reports')
  const showKpis      = canSee('element.dashboard.kpi_cards')
  const showChart     = canSee('element.reports.charts')
  const showBranches  = canSee('element.dashboard.top_branches')
  const showBranchTable = canSeeReports && canSee('element.reports.branch_table')
  const showStateTable  = canSeeReports && canSee('element.dashboard.state_table')
  const hasWidgets    = showKpis || showChart || showBranches || showBranchTable || showStateTable

  const [todayKpis, setTodayKpis] = useState(null)
  const [mtdKpis,   setMtdKpis]   = useState(null)
  const [trend,     setTrend]     = useState([])
  const [branches,  setBranches]  = useState([])
  const [stateData, setStateData] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    if (!hasWidgets) { setLoading(false); return }
    const now       = istNow()
    const todayStr  = istStr()
    const mtdFrom   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const trendFrom = daysBack(13)
    const p0   = { p_from: todayStr, p_to: todayStr, p_branch: null, p_txn_type: null, p_state: null }
    const pMtd = { p_from: mtdFrom,  p_to: todayStr, p_branch: null, p_txn_type: null, p_state: null }
    const fetches = []
    if (showKpis) {
      fetches.push(
        supabase.rpc('get_report_kpis', p0).then(({ data }) => setTodayKpis(Array.isArray(data) ? data[0] : data)),
        supabase.rpc('get_report_kpis', pMtd).then(({ data }) => setMtdKpis(Array.isArray(data) ? data[0] : data)),
      )
    }
    if (showChart) {
      fetches.push(
        supabase.rpc('get_daily_trend', { p_from: trendFrom, p_to: todayStr, p_branch: null, p_txn_type: null, p_state: null })
          .then(({ data }) => setTrend(data || [])),
      )
    }
    if (showBranches || showBranchTable) {
      fetches.push(
        supabase.rpc('get_branch_summary', { p_from: mtdFrom, p_to: todayStr, p_txn_type: null, p_state: null })
          .then(({ data }) => setBranches((data || []).sort((a, b) => Number(b.total_net || 0) - Number(a.total_net || 0)).slice(0, 8))),
      )
    }
    if (showStateTable) {
      fetches.push(
        supabase.rpc('get_state_summary', { p_from: mtdFrom, p_to: todayStr, p_txn_type: null })
          .then(({ data }) => setStateData((data || []).filter(s => s.state && Number(s.total_net || 0) > 0))),
      )
    }
    Promise.all(fetches).catch(() => {}).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const maxBranch = Math.max(...branches.map(b => Number(b.total_net || 0)), 1)
  const maxState  = Math.max(...stateData.map(s => Number(s.total_net || 0)), 1)
  const openTarget = canSeeData ? 'purchase-data' : canSeeReports ? 'purchase-reports' : null
  const avgWt = trend.length > 0
    ? trend.reduce((s, d) => s + Number(d.net_wt || 0), 0) / trend.filter(d => Number(d.net_wt || 0) > 0).length
    : 0

  return (
    <Section title="Purchase Overview" icon="◉" color={t.gold} t={t} delay={100}
      onOpen={openTarget ? () => setActiveNav(openTarget) : null}
      ctaLabel={canSeeData ? 'Open Purchase Data' : 'Open Reports'}
    >
      {!hasWidgets ? (
        <div style={{ padding: '10px 0', fontSize: 12, color: t.text4 }}>No dashboard widgets configured for this role.</div>
      ) : (
        <>
          {/* KPI grid */}
          {showKpis && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
              <KpiTile label="Today's Bills"   value={fmtN(todayKpis?.total_count)}    color={t.gold}  loading={loading} t={t} />
              <KpiTile label="Today's Weight"  value={todayKpis?.total_net > 0 ? `${fmt(todayKpis.total_net)}g` : '—'} color={t.gold} loading={loading} t={t} />
              <KpiTile label="MTD Bills"       value={fmtN(mtdKpis?.total_count)}      color={t.green} loading={loading} t={t} />
              <KpiTile label="MTD Value"       value={fmtCr(mtdKpis?.total_value)}     color={t.green} loading={loading} t={t} />
            </div>
          )}

          {/* Chart + branches/state row */}
          {(showChart || showBranches || showBranchTable || showStateTable) && (
            <div style={{ display: 'grid', gridTemplateColumns: showChart ? '1fr 280px' : '1fr', gap: 24 }}>
              {/* Left: trend chart */}
              {showChart && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>14-day net weight (g)</div>
                    {avgWt > 0 && !loading && (
                      <div style={{ fontSize: 10, color: t.text3 }}>avg {fmt(avgWt)}g/day</div>
                    )}
                  </div>
                  {loading
                    ? <Shimmer h={140} w="100%" t={t} />
                    : trend.length > 0
                      ? <div style={{ borderRadius: 10, overflow: 'hidden' }}>
                          <ResponsiveContainer width="100%" height={140}>
                            <BarChart data={trend} barSize={14} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                              <defs>
                                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={t.gold} stopOpacity={0.95} />
                                  <stop offset="100%" stopColor={t.gold} stopOpacity={0.45} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid vertical={false} strokeDasharray="3 5" stroke={t.border} strokeOpacity={0.8} />
                              <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 9, fill: t.text4 }} axisLine={false} tickLine={false} interval={1} />
                              <YAxis hide domain={[0, 'auto']} />
                              <Tooltip
                                contentStyle={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}
                                labelFormatter={fmtDay}
                                formatter={v => [`${fmt(v)}g`, 'Net Weight']}
                                cursor={{ fill: `${t.gold}12` }}
                              />
                              <Bar dataKey="net_wt" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      : <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: 12 }}>No data this period</div>
                  }
                </div>
              )}

              {/* Right: branches or state */}
              {(showBranches || showBranchTable || showStateTable) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Top branches (weight) */}
                  {(showBranches || showBranchTable) && (
                    <div>
                      <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14, fontWeight: 600 }}>
                        Top branches · MTD weight
                      </div>
                      {loading
                        ? [0,1,2,3,4,5].map(i => <div key={i} style={{ marginBottom: 11 }}><Shimmer h={20} w="100%" t={t} /></div>)
                        : branches.length === 0
                          ? <div style={{ color: t.text4, fontSize: 12 }}>No data this month</div>
                          : branches.slice(0, 6).map((b, i) => (
                              <MiniBarRow key={b.branch_name}
                                label={`${i + 1}. ${b.branch_name}`}
                                value={Number(b.total_net || 0)} max={maxBranch}
                                color={t.gold} sub={`${fmt(b.total_net)}g`} t={t}
                              />
                            ))
                      }
                    </div>
                  )}

                  {/* State breakdown */}
                  {showStateTable && stateData.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14, fontWeight: 600 }}>
                        State breakdown · MTD weight
                      </div>
                      {loading
                        ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 11 }}><Shimmer h={20} w="100%" t={t} /></div>)
                        : stateData.map(s => (
                            <MiniBarRow key={s.state}
                              label={s.state}
                              value={Number(s.total_net || 0)} max={maxState}
                              color={t.blue} sub={`${fmt(s.total_net)}g`} t={t}
                            />
                          ))
                      }
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  )
}

// ══ TELESALES SECTION ════════════════════════════════════════════════════════
// No element-level keys defined for inbound-bot — all widgets shown when section is visible
function TelesalesSection({ t, setActiveNav }) {
  const [calls,   setCalls]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('telesales_calls')
      .select('call_date,outcome,duration_seconds')
      .gte('call_date', daysBack(13))
      .then(({ data }) => { setCalls(data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const todayStr     = istStr()
  const total        = calls.length
  const todayCalls   = calls.filter(c => c.call_date === todayStr).length
  const thisWeek     = calls.filter(c => c.call_date >= daysBack(6)).length
  const engaged      = calls.filter(c => (c.duration_seconds || 0) >= 30).length
  const interested   = calls.filter(c => c.outcome === 'interested').length
  const engageRate   = total > 0 ? Math.round(engaged / total * 100) : 0

  const byDate = {}
  calls.forEach(c => { if (c.call_date) byDate[c.call_date] = (byDate[c.call_date] || 0) + 1 })
  const chartData = Array.from({ length: 14 }, (_, i) => {
    const d = daysBack(13 - i)
    return { date: d, calls: byDate[d] || 0 }
  })

  const OUTS       = ['interested', 'callback', 'not_interested', 'no_answer', 'pending']
  const OUT_COLORS = { interested: '#4ade80', callback: '#60a5fa', not_interested: '#f87171', no_answer: '#94a3b8', pending: '#a78bfa' }
  const OUT_LABELS = { interested: 'Interested', callback: 'Callback', not_interested: 'Not Interested', no_answer: 'No Answer', pending: 'Pending' }
  const outcomeRows = OUTS
    .map(o => ({ key: o, label: OUT_LABELS[o], count: calls.filter(c => (c.outcome || 'pending') === o).length, color: OUT_COLORS[o] }))
    .filter(o => o.count > 0)
  const maxOutcome = Math.max(...outcomeRows.map(o => o.count), 1)

  return (
    <Section title="Telesales" icon="◑" color={t.purple} t={t} delay={200}
      onOpen={() => setActiveNav('inbound-bot')} ctaLabel="Open Inbound Bot"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        <KpiTile label="Today's Calls" value={String(todayCalls)} color={t.purple} loading={loading} t={t} />
        <KpiTile label="This Week"     value={String(thisWeek)}   color={t.blue}   loading={loading} t={t} />
        <KpiTile label="Engage Rate"   value={`${engageRate}%`}   color={t.green}  loading={loading} t={t} />
        <KpiTile label="Interested"    value={String(interested)}  color="#4ade80"  loading={loading} t={t} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20 }}>
        <div>
          <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>14-day call volume</div>
          {loading
            ? <Shimmer h={100} w="100%" t={t} />
            : <ResponsiveContainer width="100%" height={100}>
                <BarChart data={chartData} barSize={10} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="2 4" stroke={t.border} />
                  <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 9, fill: t.text4 }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDay} formatter={v => [v, 'Calls']} cursor={{ fill: `${t.purple}10` }} />
                  <Bar dataKey="calls" fill={t.purple} radius={[3, 3, 0, 0]} opacity={.8} />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
        <div>
          <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>Outcome breakdown</div>
          {loading
            ? [0,1,2,3].map(i => <Shimmer key={i} h={18} w="100%" t={t} />)
            : outcomeRows.map(o => <MiniBarRow key={o.key} label={o.label} value={o.count} max={maxOutcome} color={o.color} sub={String(o.count)} t={t} />)
          }
        </div>
      </div>
    </Section>
  )
}

// ══ CONSIGNMENT SECTION ═══════════════════════════════════════════════════════
// Element keys used:
//   element.consignment-overview.region_cards → region summary bars
//   element.consignment-overview.table        → KPI tiles (total branches, weight, urgent)
function ConsignmentSection({ t, setActiveNav, canSee }) {
  const canSeeOverview = canSee('consignment-overview')
  const showKpis       = canSee('element.consignment-overview.table') || canSee('element.consignment-overview.region_cards')
  const showRegion     = canSee('element.consignment-overview.region_cards')
  const hasWidgets     = canSeeOverview && (showKpis || showRegion)

  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!canSeeOverview) { setLoading(false); return }
    fetch('/api/consignments?action=branch_overview')
      .then(r => r.json())
      .then(json => { setData(json.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalBranches = data.length
  const totalWeight   = data.reduce((s, b) => s + (b.total_gross_wt || 0), 0)
  const urgent        = data.filter(b => {
    if (!b.ship_before) return false
    return Math.floor((new Date(b.ship_before).getTime() - Date.now()) / 86400000) <= 3
  }).length

  const regions = [...new Set(data.map(b => b.region).filter(Boolean))]
  const regionStats = regions.map(r => {
    const bs = data.filter(b => b.region === r)
    return { region: r, branches: bs.length, weight: bs.reduce((s, b) => s + (b.total_gross_wt || 0), 0) }
  }).sort((a, b) => b.weight - a.weight)
  const maxWeight = Math.max(...regionStats.map(r => r.weight), 1)
  const REGION_COLORS = { 'Rest of Karnataka': t.gold, 'Andhra Pradesh': t.blue, 'Telangana': t.purple, 'Kerala': t.green }

  return (
    <Section title="Branch Stock" icon="📦" color={t.orange} t={t} delay={300}
      onOpen={canSeeOverview ? () => setActiveNav('consignment-overview') : null}
      ctaLabel="Open Branch Stock"
    >
      {!hasWidgets ? (
        <div style={{ padding: '10px 0', fontSize: 12, color: t.text4 }}>No dashboard widgets configured for this role.</div>
      ) : (
        <>
          {showKpis && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: showRegion ? 20 : 0 }}>
              <KpiTile label="Branches with Stock" value={String(totalBranches)} color={t.orange} loading={loading} t={t} />
              <KpiTile label="Total Gross Weight"  value={loading ? '—' : `${fmt(totalWeight, 0)}g`} color={t.gold} loading={loading} t={t} />
              <KpiTile label="Urgent Alerts (≤3d)" value={String(urgent)} color={urgent > 0 ? t.red : t.green} loading={loading} t={t} border={urgent > 0 ? `${t.red}40` : undefined} />
            </div>
          )}
          {showRegion && (
            <div>
              <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>Stock by region</div>
              {loading
                ? [0,1,2,3].map(i => <Shimmer key={i} h={22} w="100%" t={t} />)
                : regionStats.length === 0
                  ? <div style={{ color: t.text4, fontSize: 12 }}>No data</div>
                  : regionStats.map(r => (
                      <MiniBarRow key={r.region}
                        label={`${r.region} · ${r.branches} branch${r.branches !== 1 ? 'es' : ''}`}
                        value={r.weight} max={maxWeight}
                        color={REGION_COLORS[r.region] || t.orange}
                        sub={`${fmt(r.weight, 0)}g`}
                        t={t}
                      />
                    ))
              }
            </div>
          )}
        </>
      )}
    </Section>
  )
}

// ══ ADMIN SECTION ═════════════════════════════════════════════════════════════
function AdminSection({ t, setActiveNav, canSeeUsers, canSeeBranches }) {
  const [stats,         setStats]        = useState(null)
  const [roleBreakdown, setRoleBreakdown] = useState([])
  const [loading,       setLoading]      = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('user_profiles').select('id,role').eq('is_active', true),
      supabase.from('branches').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ]).then(([users, branches]) => {
      setStats({ userCount: users.data?.length ?? 0, branchCount: branches.count ?? 0 })
      const roleMap = {}
      ;(users.data || []).forEach(u => { roleMap[u.role] = (roleMap[u.role] || 0) + 1 })
      setRoleBreakdown(Object.entries(roleMap).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const ROLE_COLORS = { super_admin: '#c9a84c', founders_office: '#8c5ac8', admin: '#3a8fbf', manager: '#3aaa6a', branch_staff: '#c9981f', viewer: '#7a6a4a', telesales: '#a078f0' }
  const ROLE_LABELS = { super_admin: 'Super Admin', founders_office: "Founder's Office", admin: 'Admin', manager: 'Manager', branch_staff: 'Branch Staff', viewer: 'View Only', telesales: 'Telesales' }
  const maxRole = Math.max(...roleBreakdown.map(r => r.count), 1)

  return (
    <Section title="Administration" icon="⚙" color={t.blue} t={t} delay={400}
      onOpen={canSeeUsers ? () => setActiveNav('user-management') : () => setActiveNav('branch-management')}
      ctaLabel={canSeeUsers ? 'Open User Management' : 'Open Branches'}
    >
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${[canSeeUsers, canSeeBranches].filter(Boolean).length},1fr)`, gap: 12, marginBottom: 20 }}>
        {canSeeUsers    && <KpiTile label="Active Users"    value={stats ? String(stats.userCount)   : '—'} color={t.blue}  loading={loading} t={t} />}
        {canSeeBranches && <KpiTile label="Active Branches" value={stats ? String(stats.branchCount) : '—'} color={t.green} loading={loading} t={t} />}
      </div>
      {canSeeUsers && (
        <div>
          <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>Users by role</div>
          {loading
            ? [0,1,2,3].map(i => <Shimmer key={i} h={18} w="100%" t={t} />)
            : roleBreakdown.map(r => (
                <MiniBarRow key={r.role}
                  label={ROLE_LABELS[r.role] || r.role}
                  value={r.count} max={maxRole}
                  color={ROLE_COLORS[r.role] || t.text3}
                  sub={String(r.count)}
                  t={t}
                />
              ))
          }
        </div>
      )}
    </Section>
  )
}

// ══ RATES SECTION ════════════════════════════════════════════════════════════
function RatesSection({ t, setActiveNav, canSeeRates, canSeeCalTable }) {
  const [rate,    setRate]    = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const since = new Date(); since.setHours(since.getHours() - 2)
    Promise.all([
      supabase.from('gold_rates').select('*').order('fetched_at', { ascending: false }).limit(1),
      supabase.from('gold_rates').select('fetched_at,kalinga_sell_rate').gte('fetched_at', since.toISOString()).order('fetched_at', { ascending: true }),
    ]).then(([latest, hist]) => {
      setRate(latest.data?.[0] || null)
      setHistory((hist.data || []).map(d => ({
        time: new Date(d.fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        rate: Number(d.kalinga_sell_rate || 0),
      })))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const rateRows = [
    { label: 'Kalinga',  value: rate?.kalinga_sell_rate, color: t.gold   },
    { label: 'Ambica',   value: rate?.ambica_sell_rate,  color: t.blue   },
    { label: 'Aamlin',   value: rate?.aamlin_sell_rate,  color: t.purple },
  ].filter(r => r.value)

  return (
    <Section title="Market Rates" icon="◎" color={t.blue} t={t} delay={500}
      onOpen={canSeeRates ? () => setActiveNav('live-market-rates') : () => setActiveNav('cal-table')}
      ctaLabel={canSeeRates ? 'Open Live Rates' : 'Open Cal Table'}
    >
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(rateRows.length, 1)},1fr)`, gap: 12, marginBottom: rateRows.length > 0 ? 20 : 0 }}>
        {loading
          ? [0,1,2].map(i => <KpiTile key={i} label="—" value="—" color={t.text3} loading={true} t={t} />)
          : rateRows.length > 0
            ? rateRows.map(r => (
                <KpiTile key={r.label} label={`${r.label} · /10g`} value={r.value ? `₹${Number(r.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'} color={r.color} loading={false} t={t} />
              ))
            : <div style={{ color: t.text4, fontSize: 12 }}>No rate data available</div>
        }
      </div>
      {history.length > 1 && (
        <div>
          <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>Kalinga rate — last 2 hours</div>
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={history} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: t.text4 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 11 }} formatter={v => [`₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, 'Rate']} />
              <Line type="monotone" dataKey="rate" stroke={t.gold} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  )
}

// ══ MAIN COMPONENT ════════════════════════════════════════════════════════════
export default function DynamicDashboard() {
  const { theme, userProfile, canSee, setActiveNav } = useApp()
  const t = THEMES[theme]
  const [heroVis, setHeroVis] = useState(false)
  useEffect(() => { setTimeout(() => setHeroVis(true), 40) }, [])

  const name = userProfile?.full_name?.split(' ')[0] || 'there'

  const hasPurchase    = canSee('purchase-data') || canSee('purchase-reports')
  const hasTelesales   = canSee('inbound-bot')
  const hasConsignment = canSee('consignment-overview') || canSee('consignment-data') || canSee('consignment-report') || canSee('consignment-summary')
  const hasAdmin       = canSee('user-management') || canSee('branch-management')
  const hasRates       = canSee('live-market-rates') || canSee('cal-table')
  const hasAnything    = hasPurchase || hasTelesales || hasConsignment || hasAdmin || hasRates

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
      `}</style>

      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(135deg,${t.card},${t.card2})`,
        border: `1px solid ${t.border}`, borderRadius: 20, padding: '24px 36px',
        position: 'relative', overflow: 'hidden',
        opacity: heroVis ? 1 : 0, transform: heroVis ? 'translateY(0)' : 'translateY(12px)',
        transition: 'all .5s cubic-bezier(.34,1.2,.64,1)',
      }}>
        <div style={{ position: 'absolute', right: -60, top: -60, width: 280, height: 280, borderRadius: '50%', background: `radial-gradient(circle,${t.gold}12 0%,transparent 65%)`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(${t.gold}08 1px,transparent 1px)`, backgroundSize: '28px 28px', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, left: '10%', right: '10%', height: 1, background: `linear-gradient(90deg,transparent,${t.gold}40,transparent)` }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: 11, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 20, height: 1, background: `linear-gradient(90deg,transparent,${t.gold})`, display: 'inline-block' }} />
            {greeting()}, {name}
          </div>
          <div style={{ fontSize: 30, fontWeight: 200, color: t.text1, lineHeight: 1.2, letterSpacing: '-.02em' }}>
            Every gram.<br />
            <span style={{ fontStyle: 'italic', color: t.gold, textShadow: `0 0 40px ${t.gold}40` }}>Accounted for.</span>
          </div>
        </div>
      </div>

      {/* ── Dynamic sections — each driven by element-level permissions ── */}
      {hasPurchase    && <PurchaseSection    t={t} setActiveNav={setActiveNav} canSee={canSee} />}
      {hasTelesales   && <TelesalesSection   t={t} setActiveNav={setActiveNav} />}
      {hasConsignment && <ConsignmentSection t={t} setActiveNav={setActiveNav} canSee={canSee} />}
      {hasAdmin       && <AdminSection       t={t} setActiveNav={setActiveNav} canSeeUsers={canSee('user-management')} canSeeBranches={canSee('branch-management')} />}
      {hasRates       && <RatesSection       t={t} setActiveNav={setActiveNav} canSeeRates={canSee('live-market-rates')} canSeeCalTable={canSee('cal-table')} />}

      {/* ── No access ── */}
      {!hasAnything && (
        <div style={{ textAlign: 'center', padding: '60px 40px', background: t.card, borderRadius: 18, border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '2rem', opacity: .15, marginBottom: 16 }}>◈</div>
          <div style={{ fontSize: 15, color: t.text2, fontWeight: 500, marginBottom: 8 }}>Your workspace is ready</div>
          <div style={{ fontSize: 13, color: t.text4, lineHeight: 1.7 }}>Contact your administrator to request access to modules.</div>
        </div>
      )}
    </div>
  )
}
