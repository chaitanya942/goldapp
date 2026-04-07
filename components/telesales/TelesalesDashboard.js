'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, CartesianGrid,
} from 'recharts'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#f0ebe0', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

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

const OUTCOME_COLORS  = { interested: '#3aaa6a', callback: '#3a8fbf', not_interested: '#e05555', no_answer: '#9a8a6a', wrong_number: '#c9981f', pending: '#3a3a3a' }
const OUTCOME_LABELS  = { interested: 'Interested', callback: 'Callback', not_interested: 'Not Interested', no_answer: 'No Answer', wrong_number: 'Wrong Number', pending: 'Pending' }

export default function TelesalesDashboard() {
  const { theme, setActiveNav } = useApp()
  const t = THEMES[theme]
  const [calls,   setCalls]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('telesales_calls')
      .select('id,call_date,call_time,duration_seconds,outcome,language,call_disposition,system_disposition,customer_name,customer_number')
      .order('call_date', { ascending: false }).order('call_time', { ascending: false })
      .then(({ data }) => { setCalls(data || []); setLoading(false) })
  }, [])

  // ── KPIs ──────────────────────────────────────────────────────────────────────
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
  const engaged       = calls.filter(c => (c.duration_seconds || 0) >= 30).length  // >30s = real engagement
  const engageRate    = total > 0 ? ((engaged / total) * 100).toFixed(0) : 0
  const convRate      = total > 0 ? ((interested / total) * 100).toFixed(1) : '0.0'

  // ── Calls by date (last 14 days) ──────────────────────────────────────────────
  const callsByDate = (() => {
    const map = {}
    calls.forEach(c => { if (c.call_date) map[c.call_date] = (map[c.call_date] || 0) + 1 })
    return Object.entries(map).sort(([a],[b]) => a>b?1:-1).slice(-14)
      .map(([date, count]) => ({ date: fmtDate(date), count }))
  })()

  // ── Calls by hour (heatmap bar) ────────────────────────────────────────────────
  const callsByHour = (() => {
    const map = {}
    for (let i = 0; i < 24; i++) map[i] = 0
    calls.forEach(c => {
      if (!c.call_time) return
      const h = parseInt(c.call_time.slice(0, 2))
      if (!isNaN(h)) map[h] = (map[h] || 0) + 1
    })
    return Object.entries(map).map(([h, count]) => ({ hour: `${h.padStart ? h : String(h).padStart(2,'0')}:00`, count }))
  })()

  // ── Outcome distribution ──────────────────────────────────────────────────────
  const outcomeDist = Object.entries(OUTCOME_LABELS).map(([key, label]) => ({
    name: label, value: calls.filter(c => (c.outcome || 'pending') === key).length, color: OUTCOME_COLORS[key],
  })).filter(d => d.value > 0)

  // ── Top dispositions ──────────────────────────────────────────────────────────
  const dispositionMap = {}
  calls.forEach(c => { const d = c.system_disposition || c.call_disposition; if (d) dispositionMap[d] = (dispositionMap[d] || 0) + 1 })
  const topDispositions = Object.entries(dispositionMap).sort(([,a],[,b]) => b-a).slice(0, 7)
    .map(([name, count]) => ({ name, count, pct: total > 0 ? +((count/total)*100).toFixed(0) : 0 }))
  const maxDisp = topDispositions[0]?.count || 1

  // ── Avg duration by date (last 7 days) ────────────────────────────────────────
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

  // ── Language breakdown ────────────────────────────────────────────────────────
  const langMap = {}
  calls.forEach(c => { const l = c.language || 'Unknown'; langMap[l] = (langMap[l] || 0) + 1 })
  const langData = Object.entries(langMap).sort(([,a],[,b]) => b-a)

  const recent = calls.slice(0, 5)

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

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>Loading telesales data...</div>

  return (
    <div style={{ padding: '32px', maxWidth: '100%' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '1.5rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Telesales Overview</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Gnani AI · Inbound Bot Performance · {total} total calls</div>
        </div>
        <button onClick={() => setActiveNav('inbound-bot')}
          style={{ background: t.purple, border: 'none', borderRadius: '8px', padding: '8px 18px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', letterSpacing: '.02em' }}>
          Open Call Log →
        </button>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: "Today's Calls",  value: todayCalls,          color: t.gold,    sub: 'vs yesterday' },
          { label: 'This Week',      value: thisWeekCalls,       color: t.purple,  sub: weekChange !== null ? `${weekChange > 0 ? '+' : ''}${weekChange}% vs last week` : 'first week' },
          { label: 'Engage Rate',    value: `${engageRate}%`,    color: t.blue,    sub: `${engaged} calls ≥30s` },
          { label: 'Interested',     value: interested,          color: t.green,   sub: `${convRate}% conv. rate` },
          { label: 'Callbacks',      value: callbacks,           color: '#3a8fbf', sub: 'scheduled' },
          { label: 'Not Interested', value: notInt,              color: t.red,     sub: `${total > 0 ? ((notInt/total)*100).toFixed(0) : 0}% of total` },
          { label: 'Avg Duration',   value: fmtDur(avgDur),      color: t.text1,   sub: fmtDur(totalDur) + ' total' },
          { label: 'Pending Review', value: pending,             color: t.orange,  sub: `${total > 0 ? ((pending/total)*100).toFixed(0) : 0}% unreviewed` },
        ].map(k => (
          <div key={k.label} style={{ ...s.card, textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 200, color: k.color, lineHeight: 1.1, marginBottom: '4px' }}>{k.value}</div>
            <div style={{ fontSize: '10px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px', fontWeight: 600 }}>{k.label}</div>
            <div style={{ fontSize: '10px', color: t.text4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Row 1: Calls/Day + Outcome Donut ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px', marginBottom: '14px' }}>

        <div style={s.card}>
          <span style={s.label}>Calls Per Day — Last 14 Days</span>
          {callsByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={callsByDate} barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${t.border2}60`} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<TT />} cursor={{ fill: `${t.border2}50` }} />
                <Bar dataKey="count" name="Calls" fill={t.purple} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: 'center', color: t.text4, padding: '70px 0', fontSize: '12px' }}>No data yet</div>}
        </div>

        <div style={s.card}>
          <span style={s.label}>Outcome Breakdown</span>
          {outcomeDist.some(d => d.color !== OUTCOME_COLORS.pending) ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={outcomeDist} cx="50%" cy="50%" innerRadius={44} outerRadius={68} dataKey="value" paddingAngle={2}>
                    {outcomeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={v => [v, '']} contentStyle={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', fontSize: '12px', color: t.text1 }} cursor={false} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '8px' }}>
                {outcomeDist.filter(d => d.color !== OUTCOME_COLORS.pending).map(d => (
                  <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: d.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '11px', color: t.text3 }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: t.text1, fontWeight: 600 }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: '2rem', fontWeight: 200, color: t.orange, marginBottom: '6px' }}>{pending}</div>
              <div style={{ fontSize: '11px', color: t.text4, marginBottom: '10px' }}>All calls pending review</div>
              <div style={{ fontSize: '10px', color: t.text4, lineHeight: 1.6 }}>Open the call log, listen to recordings and mark outcomes to see the breakdown chart.</div>
              <button onClick={() => setActiveNav('inbound-bot')}
                style={{ marginTop: '12px', background: 'transparent', border: `1px solid ${t.purple}50`, borderRadius: '6px', padding: '5px 14px', color: t.purple, fontSize: '11px', cursor: 'pointer' }}>
                Review Calls →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Calls by Hour + Avg Duration + Top Dispositions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.2fr', gap: '14px', marginBottom: '14px' }}>

        {/* Calls by Hour */}
        <div style={s.card}>
          <span style={s.label}>Peak Call Hours</span>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={callsByHour} barSize={8}>
              <XAxis dataKey="hour" tick={{ fill: t.text4, fontSize: 9 }} axisLine={false} tickLine={false}
                tickFormatter={v => v.slice(0,2)} interval={2} />
              <YAxis hide />
              <Tooltip content={<TT />} cursor={{ fill: `${t.border2}50` }} />
              <Bar dataKey="count" name="Calls" radius={[3,3,0,0]}
                fill="url(#hourGrad)">
                {callsByHour.map((e, i) => (
                  <Cell key={i} fill={e.count === Math.max(...callsByHour.map(h => h.count)) ? t.gold : t.purple} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {callsByHour.length > 0 && (() => {
            const peak = callsByHour.reduce((a, b) => a.count > b.count ? a : b)
            return peak.count > 0 ? (
              <div style={{ fontSize: '11px', color: t.text3, marginTop: '8px', textAlign: 'center' }}>
                Peak: <span style={{ color: t.gold, fontWeight: 600 }}>{peak.hour}</span> · {peak.count} calls
              </div>
            ) : null
          })()}
        </div>

        {/* Avg Duration Trend */}
        <div style={s.card}>
          <span style={s.label}>Avg Duration / Day</span>
          {durationByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={durationByDate}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${t.border2}60`} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.floor(v/60)}m`} />
                <Tooltip content={<TT fmt={fmtDur} />} cursor={{ stroke: `${t.border2}80`, strokeWidth: 1 }} />
                <Line type="monotone" dataKey="avg" stroke={t.gold} strokeWidth={2} dot={{ fill: t.gold, r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: t.gold }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: 'center', color: t.text4, padding: '55px 0', fontSize: '12px' }}>No duration data</div>}
        </div>

        {/* Language */}
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

      {/* ── Row 3: Top Dispositions ── */}
      <div style={{ ...s.card, marginBottom: '14px' }}>
        <span style={s.label}>Top Bot Dispositions</span>
        {topDispositions.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 32px' }}>
            {topDispositions.map(d => (
              <div key={d.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', color: t.text2, fontFamily: 'monospace', letterSpacing: '.02em' }}>{d.name}</span>
                  <span style={{ fontSize: '11px', color: t.text3 }}>{d.count} · {d.pct}%</span>
                </div>
                <div style={{ height: '4px', background: t.border2, borderRadius: '2px' }}>
                  <div style={{ width: `${(d.count / maxDisp) * 100}%`, height: '100%', background: t.purple, borderRadius: '2px', opacity: 0.6 + (d.count / maxDisp) * 0.4 }} />
                </div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: t.text4, fontSize: '12px' }}>No disposition data yet</div>}
      </div>

      {/* ── Recent Calls ── */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span style={{ ...s.label, marginBottom: 0 }}>Recent Calls</span>
          <button onClick={() => setActiveNav('inbound-bot')} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 12px', color: t.text3, fontSize: '11px', cursor: 'pointer' }}>
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
            {recent.length === 0
              ? <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No calls yet</td></tr>
              : recent.map(c => {
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
