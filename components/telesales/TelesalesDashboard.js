'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, CartesianGrid, Sector,
} from 'recharts'

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmtDur = (s) => {
  if (!s && s !== 0) return '—'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${String(sec).padStart(2, '0')}`
}
const fmtDate = (d) => { if (!d) return ''; const [,mm,dd] = d.split('-'); return `${dd}/${mm}` }
const today = () => {
  const now = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000)
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`
}
const daysAgo = (n) => {
  const d = new Date(new Date().getTime() + 5.5*60*60*1000 - n*86400000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}

const OUTCOME_COLORS = { interested: '#4ade80', callback: '#60a5fa', not_interested: '#f87171', no_answer: '#94a3b8', wrong_number: '#fb923c', pending: '#a78bfa' }
const OUTCOME_LABELS = { interested: 'Interested', callback: 'Callback', not_interested: 'Not Interested', no_answer: 'No Answer', wrong_number: 'Wrong Number', pending: 'Pending' }

// ── Active donut sector (expanded on hover) ───────────────────────────────────
const ActiveShape = ({ cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, value, percent }) => (
  <g>
    <Sector cx={cx} cy={cy} innerRadius={innerRadius - 4} outerRadius={outerRadius + 8}
      startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="none" />
    <text x={cx} y={cy - 10} textAnchor="middle" fill={fill} fontSize={22} fontWeight={200}>{value}</text>
    <text x={cx} y={cy + 12} textAnchor="middle" fill="#9a8a6a" fontSize={11}>{payload.name}</text>
    <text x={cx} y={cy + 27} textAnchor="middle" fill="#6a5a3a" fontSize={10}>{(percent * 100).toFixed(0)}%</text>
  </g>
)

export default function TelesalesDashboard() {
  const { theme, setActiveNav } = useApp()
  const t = THEMES[theme]

  const [calls,        setCalls]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [activeSlice,  setActiveSlice]  = useState(0)
  // activeFilter: null | { type: 'outcome'|'today'|'week'|'disp'|'hour', value }
  const [activeFilter, setActiveFilter] = useState(null)

  useEffect(() => {
    supabase.from('telesales_calls')
      .select('id,call_date,call_time,duration_seconds,outcome,language,call_disposition,system_disposition,customer_name,customer_number')
      .order('call_date', { ascending: false }).order('call_time', { ascending: false })
      .then(({ data }) => { setCalls(data || []); setLoading(false) })
  }, [])

  const todayStr    = today()
  const thisWeekStr = daysAgo(7)
  const lastWeekStr = daysAgo(14)

  const total         = calls.length
  const todayCalls    = calls.filter(c => c.call_date === todayStr).length
  const thisWeekCalls = calls.filter(c => c.call_date >= thisWeekStr).length
  const lastWeekCalls = calls.filter(c => c.call_date >= lastWeekStr && c.call_date < thisWeekStr).length
  const weekChange    = lastWeekCalls > 0 ? (((thisWeekCalls - lastWeekCalls) / lastWeekCalls) * 100).toFixed(0) : null
  const interested    = calls.filter(c => c.outcome === 'interested').length
  const callbacks     = calls.filter(c => c.outcome === 'callback').length
  const notInt        = calls.filter(c => c.outcome === 'not_interested').length
  const noAnswer      = calls.filter(c => c.outcome === 'no_answer').length
  const pending       = calls.filter(c => !c.outcome || c.outcome === 'pending').length
  const totalDur      = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0)
  const avgDur        = total > 0 ? Math.round(totalDur / total) : 0
  const engaged       = calls.filter(c => (c.duration_seconds || 0) >= 30).length
  const engageRate    = total > 0 ? ((engaged / total) * 100).toFixed(0) : 0
  const convRate      = total > 0 ? ((interested / total) * 100).toFixed(1) : '0.0'

  // ── Chart data ────────────────────────────────────────────────────────────────
  const callsByDate = (() => {
    const map = {}
    calls.forEach(c => { if (c.call_date) map[c.call_date] = (map[c.call_date] || 0) + 1 })
    return Object.entries(map).sort(([a],[b]) => a>b?1:-1).slice(-14)
      .map(([date, count]) => ({ date: fmtDate(date), rawDate: date, count }))
  })()

  const callsByHour = (() => {
    const map = {}
    for (let i = 0; i < 24; i++) map[i] = 0
    calls.forEach(c => { if (c.call_time) { const h = parseInt(c.call_time.slice(0,2)); if (!isNaN(h)) map[h]++ } })
    return Object.entries(map).map(([h, count]) => ({ hour: String(h).padStart(2,'0') + ':00', h: +h, count }))
  })()

  // Always include pending in donut
  const outcomeDist = Object.entries(OUTCOME_LABELS).map(([key, label]) => ({
    name: label, key, value: calls.filter(c => (c.outcome || 'pending') === key).length, color: OUTCOME_COLORS[key],
  })).filter(d => d.value > 0)

  const dispositionMap = {}
  calls.forEach(c => { const d = c.system_disposition || c.call_disposition; if (d) dispositionMap[d] = (dispositionMap[d] || 0) + 1 })
  const topDispositions = Object.entries(dispositionMap).sort(([,a],[,b]) => b-a).slice(0, 8)
    .map(([name, count]) => ({ name, count, pct: total > 0 ? +((count/total)*100).toFixed(0) : 0 }))
  const maxDisp = topDispositions[0]?.count || 1

  const durationByDate = (() => {
    const map = {}
    calls.forEach(c => {
      if (!c.call_date || !c.duration_seconds) return
      if (!map[c.call_date]) map[c.call_date] = { total: 0, count: 0 }
      map[c.call_date].total += c.duration_seconds; map[c.call_date].count++
    })
    return Object.entries(map).sort(([a],[b]) => a>b?1:-1).slice(-7)
      .map(([date, { total, count }]) => ({ date: fmtDate(date), avg: Math.round(total / count) }))
  })()

  const langMap = {}
  calls.forEach(c => { const l = c.language || 'Unknown'; langMap[l] = (langMap[l] || 0) + 1 })
  const langData = Object.entries(langMap).sort(([,a],[,b]) => b-a)

  // ── Filtered recent calls based on activeFilter ───────────────────────────────
  const filteredCalls = (() => {
    if (!activeFilter) return calls.slice(0, 8)
    let result = calls
    if (activeFilter.type === 'outcome')  result = calls.filter(c => (c.outcome || 'pending') === activeFilter.value)
    if (activeFilter.type === 'today')    result = calls.filter(c => c.call_date === todayStr)
    if (activeFilter.type === 'week')     result = calls.filter(c => c.call_date >= thisWeekStr)
    if (activeFilter.type === 'disp')     result = calls.filter(c => (c.system_disposition || c.call_disposition) === activeFilter.value)
    if (activeFilter.type === 'hour')     result = calls.filter(c => c.call_time && parseInt(c.call_time.slice(0,2)) === activeFilter.value)
    if (activeFilter.type === 'engage')   result = calls.filter(c => (c.duration_seconds || 0) >= 30)
    return result.slice(0, 20)
  })()

  const toggleFilter = (type, value) => {
    setActiveFilter(f => f?.type === type && f?.value === value ? null : { type, value })
  }

  const s = {
    card:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px 24px' },
    label: { fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, marginBottom: '14px', display: 'block' },
  }

  const TT = ({ active, payload, label, fmt }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>
        <div style={{ color: t.text3, marginBottom: '3px' }}>{label}</div>
        {payload.map((p, i) => <div key={i} style={{ color: p.color || t.gold, fontWeight: 600 }}>{fmt ? fmt(p.value) : p.value}</div>)}
      </div>
    )
  }

  const peakHour = callsByHour.reduce((a, b) => a.count > b.count ? a : b, { count: 0 })

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>Loading telesales data...</div>

  return (
    <div style={{ padding: '28px 32px', maxWidth: '100%' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.5rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Telesales Overview</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Gnani AI · Inbound Bot Performance · {total} total calls</div>
        </div>
        <button onClick={() => setActiveNav('inbound-bot')}
          style={{ background: t.purple, border: 'none', borderRadius: '8px', padding: '8px 18px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
          Open Call Log →
        </button>
      </div>

      {/* ── KPI Row — all clickable ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '10px', marginBottom: '18px' }}>
        {[
          { label: "Today's Calls",  value: todayCalls,       color: t.gold,    sub: 'vs yesterday',                        filter: { type: 'today' } },
          { label: 'This Week',      value: thisWeekCalls,    color: t.purple,  sub: weekChange != null ? `${weekChange > 0 ? '+' : ''}${weekChange}% vs last week` : 'first week', filter: { type: 'week' } },
          { label: 'Engage Rate',    value: `${engageRate}%`, color: t.blue,    sub: `${engaged} calls ≥30s`,               filter: { type: 'engage' } },
          { label: 'Interested',     value: interested,       color: t.green,   sub: `${convRate}% conv. rate`,             filter: { type: 'outcome', value: 'interested' } },
          { label: 'Callbacks',      value: callbacks,        color: t.blue,    sub: 'scheduled',                           filter: { type: 'outcome', value: 'callback' } },
          { label: 'Not Interested', value: notInt,           color: t.red,     sub: `${total > 0 ? ((notInt/total)*100).toFixed(0) : 0}% of total`, filter: { type: 'outcome', value: 'not_interested' } },
          { label: 'Avg Duration',   value: fmtDur(avgDur),   color: t.text1,   sub: fmtDur(totalDur) + ' total',          filter: null },
          { label: 'Pending Review', value: pending,          color: t.orange,  sub: `${total > 0 ? ((pending/total)*100).toFixed(0) : 0}% unreviewed`, filter: { type: 'outcome', value: 'pending' } },
        ].map(k => {
          const isActive = activeFilter?.type === k.filter?.type && activeFilter?.value === k.filter?.value
          return (
            <div key={k.label}
              onClick={() => k.filter && toggleFilter(k.filter.type, k.filter.value)}
              style={{ ...s.card, textAlign: 'center', padding: '14px 10px', cursor: k.filter ? 'pointer' : 'default',
                border: `1px solid ${isActive ? k.color : t.border}`,
                background: isActive ? `${k.color}12` : t.card,
                transform: isActive ? 'translateY(-2px)' : 'none',
                transition: 'all .15s', boxShadow: isActive ? `0 4px 16px ${k.color}20` : 'none' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 200, color: k.color, lineHeight: 1.1, marginBottom: '4px' }}>{k.value}</div>
              <div style={{ fontSize: '10px', color: isActive ? k.color : t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px', fontWeight: 600 }}>{k.label}</div>
              <div style={{ fontSize: '10px', color: t.text4 }}>{k.sub}</div>
              {k.filter && <div style={{ fontSize: '9px', color: isActive ? k.color : t.text4, marginTop: '4px', opacity: isActive ? 1 : 0.5 }}>{isActive ? '✕ clear filter' : 'click to filter'}</div>}
            </div>
          )
        })}
      </div>

      {/* ── Row 1: Calls/Day + Donut ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px', marginBottom: '14px' }}>

        <div style={s.card}>
          <span style={s.label}>Calls Per Day — Last 14 Days <span style={{ color: t.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(click bar to filter)</span></span>
          {callsByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={185}>
              <BarChart accessibilityLayer={false} data={callsByDate} barSize={16}
                onClick={d => d?.activePayload && toggleFilter('date', d.activePayload[0]?.payload?.rawDate)}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${t.border2}60`} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<TT />} cursor={{ fill: t.border2, opacity: 0.25, stroke: 'none' }} />
                <Bar dataKey="count" name="Calls" radius={[4,4,0,0]}>
                  {callsByDate.map((e, i) => (
                    <Cell key={i} fill={activeFilter?.type === 'date' && activeFilter?.value === e.rawDate ? t.gold : t.purple}
                      cursor="pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: 'center', color: t.text4, padding: '70px 0', fontSize: '12px' }}>No data yet</div>}
        </div>

        {/* Interactive Donut */}
        <div style={s.card}>
          <span style={s.label}>Outcome Breakdown <span style={{ color: t.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(click to filter)</span></span>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart accessibilityLayer={false}>
              <Pie data={outcomeDist} cx="50%" cy="50%" innerRadius={50} outerRadius={78}
                dataKey="value" paddingAngle={2} stroke="none"
                activeIndex={activeSlice}
                activeShape={<ActiveShape />}
                onMouseEnter={(_, i) => setActiveSlice(i)}
                onClick={(_, i) => { setActiveSlice(i); toggleFilter('outcome', outcomeDist[i].key) }}
                style={{ cursor: 'pointer' }}>
                {outcomeDist.map((e, i) => (
                  <Cell key={i} fill={e.color}
                    opacity={activeFilter?.type === 'outcome' && activeFilter?.value !== e.key ? 0.3 : 1} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
            {outcomeDist.map((d, i) => {
              const isActive = activeFilter?.type === 'outcome' && activeFilter?.value === d.key
              return (
                <div key={d.key} onClick={() => { setActiveSlice(i); toggleFilter('outcome', d.key) }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer',
                    background: isActive ? `${d.color}18` : 'transparent',
                    border: `1px solid ${isActive ? d.color + '40' : 'transparent'}`,
                    transition: 'all .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${d.color}10`; setActiveSlice(i) }}
                  onMouseLeave={e => e.currentTarget.style.background = isActive ? `${d.color}18` : 'transparent'}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: isActive ? t.text1 : t.text3 }}>{d.name}</span>
                  </div>
                  <span style={{ fontSize: '11px', color: isActive ? d.color : t.text2, fontWeight: isActive ? 700 : 400 }}>{d.value}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Row 2: Peak Hours + Avg Duration + Language ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.9fr', gap: '14px', marginBottom: '14px' }}>

        <div style={s.card}>
          <span style={s.label}>Peak Call Hours <span style={{ color: t.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(click to filter)</span></span>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart accessibilityLayer={false} data={callsByHour} barSize={8}
              onClick={d => d?.activePayload && toggleFilter('hour', d.activePayload[0]?.payload?.h)}>
              <XAxis dataKey="hour" tick={{ fill: t.text4, fontSize: 9 }} axisLine={false} tickLine={false}
                tickFormatter={v => v.slice(0,2)} interval={2} />
              <YAxis hide />
              <Tooltip content={<TT />} cursor={{ fill: t.border2, opacity: 0.25, stroke: 'none' }} />
              <Bar dataKey="count" name="Calls" radius={[3,3,0,0]}>
                {callsByHour.map((e, i) => (
                  <Cell key={i} cursor="pointer"
                    fill={activeFilter?.type === 'hour' && activeFilter?.value === e.h ? t.gold
                         : e.h === peakHour.h && e.count > 0 ? `${t.gold}90`
                         : t.purple} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {peakHour.count > 0 && (
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '6px', textAlign: 'center' }}>
              Peak: <span style={{ color: t.gold, fontWeight: 600 }}>{peakHour.hour}</span> · {peakHour.count} calls
            </div>
          )}
        </div>

        <div style={s.card}>
          <span style={s.label}>Avg Duration / Day</span>
          {durationByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart accessibilityLayer={false} data={durationByDate}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${t.border2}60`} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.floor(v/60)}m`} />
                <Tooltip content={<TT fmt={fmtDur} />} cursor={{ stroke: `${t.border2}80`, strokeWidth: 1 }} />
                <Line type="monotone" dataKey="avg" stroke={t.gold} strokeWidth={2}
                  dot={{ fill: t.gold, r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: t.gold, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: 'center', color: t.text4, padding: '55px 0', fontSize: '12px' }}>No duration data</div>}
        </div>

        <div style={s.card}>
          <span style={s.label}>Language Split</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {langData.map(([lang, count]) => {
              const pct   = total > 0 ? +((count/total)*100).toFixed(0) : 0
              const color = lang === 'Kannada' ? t.gold : lang === 'Malayalam' ? t.green : lang === 'Telugu' ? t.blue : t.text3
              return (
                <div key={lang}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <span style={{ fontSize: '12px', color, fontWeight: 500 }}>{lang}</span>
                    <span style={{ fontSize: '11px', color: t.text3 }}>{count} · {pct}%</span>
                  </div>
                  <div style={{ height: '5px', background: t.border2, borderRadius: '3px' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width .5s ease' }} />
                  </div>
                </div>
              )
            })}
            {langData.length === 0 && <div style={{ color: t.text4, fontSize: '12px' }}>—</div>}
          </div>
        </div>
      </div>

      {/* ── Top Dispositions — clickable ── */}
      <div style={{ ...s.card, marginBottom: '14px' }}>
        <span style={s.label}>Top Bot Dispositions <span style={{ color: t.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(click to filter)</span></span>
        {topDispositions.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 32px' }}>
            {topDispositions.map(d => {
              const isActive = activeFilter?.type === 'disp' && activeFilter?.value === d.name
              return (
                <div key={d.name} onClick={() => toggleFilter('disp', d.name)}
                  style={{ cursor: 'pointer', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${isActive ? t.purple + '60' : 'transparent'}`,
                    background: isActive ? `${t.purple}12` : 'transparent', transition: 'all .12s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <span style={{ fontSize: '11px', color: isActive ? t.text1 : t.text2, fontFamily: 'monospace', fontWeight: isActive ? 600 : 400 }}>{d.name}</span>
                    <span style={{ fontSize: '11px', color: isActive ? t.purple : t.text3 }}>{d.count} · {d.pct}%</span>
                  </div>
                  <div style={{ height: '4px', background: t.border2, borderRadius: '2px' }}>
                    <div style={{ width: `${(d.count / maxDisp) * 100}%`, height: '100%', borderRadius: '2px', transition: 'width .4s',
                      background: isActive ? t.purple : t.purple, opacity: isActive ? 1 : 0.5 + (d.count / maxDisp) * 0.5 }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : <div style={{ color: t.text4, fontSize: '12px' }}>No disposition data yet</div>}
      </div>

      {/* ── Filtered Recent Calls ── */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ ...s.label, marginBottom: 0 }}>
              {activeFilter ? 'Filtered Calls' : 'Recent Calls'}
            </span>
            {activeFilter && (
              <span style={{ fontSize: '11px', background: `${t.purple}18`, border: `1px solid ${t.purple}40`, borderRadius: '20px', padding: '2px 10px', color: t.purple }}>
                {filteredCalls.length} results
                <button onClick={() => setActiveFilter(null)}
                  style={{ background: 'none', border: 'none', color: t.purple, cursor: 'pointer', marginLeft: '6px', fontSize: '12px', padding: 0, lineHeight: 1 }}>✕</button>
              </span>
            )}
          </div>
          <button onClick={() => setActiveNav('inbound-bot')}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 12px', color: t.text3, fontSize: '11px', cursor: 'pointer' }}>
            View all →
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Date', 'Time', 'Number', 'Customer', 'Language', 'Duration', 'Disposition', 'Outcome'].map(h => (
                <th key={h} style={{ padding: '6px 12px', fontSize: '10px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', textAlign: 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredCalls.length === 0
              ? <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No calls match this filter</td></tr>
              : filteredCalls.map(c => {
                  const outColor = OUTCOME_COLORS[c.outcome] || t.text4
                  return (
                    <tr key={c.id} onClick={() => setActiveNav('inbound-bot')} style={{ cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text2 }}>{c.call_date}</td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text3 }}>{c.call_time?.slice(0,5) || '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, fontWeight: 500 }}>{c.customer_number}</td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text2 }}>{c.customer_name || '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text3 }}>{c.language || '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text1 }}>{fmtDur(c.duration_seconds)}</td>
                      <td style={{ padding: '9px 12px' }}>
                        {c.system_disposition
                          ? <span style={{ fontSize: '10px', color: t.blue, background: `${t.blue}12`, border: `1px solid ${t.blue}25`, borderRadius: '4px', padding: '2px 7px', fontFamily: 'monospace' }}>{c.system_disposition}</span>
                          : <span style={{ fontSize: '12px', color: t.text4 }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {c.outcome && c.outcome !== 'pending'
                          ? <span style={{ fontSize: '10px', color: outColor, background: `${outColor}15`, border: `1px solid ${outColor}30`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>{OUTCOME_LABELS[c.outcome]}</span>
                          : <span style={{ fontSize: '10px', color: t.text4 }}>Pending</span>}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
