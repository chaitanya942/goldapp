'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, CartesianGrid, Legend,
} from 'recharts'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#f0ebe0', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmtDuration = (s) => {
  if (!s && s !== 0) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${String(sec).padStart(2, '0')}`
}

const fmtDate = (d) => {
  if (!d) return ''
  const [, mm, dd] = d.split('-')
  return `${dd}/${mm}`
}

const OUTCOME_COLORS = {
  interested:     '#3aaa6a',
  callback:       '#3a8fbf',
  not_interested: '#e05555',
  no_answer:      '#9a8a6a',
  wrong_number:   '#c9981f',
  pending:        '#6a5a3a',
}

const OUTCOME_LABELS = {
  interested:     'Interested',
  callback:       'Callback',
  not_interested: 'Not Interested',
  no_answer:      'No Answer',
  wrong_number:   'Wrong Number',
  pending:        'Pending',
}

export default function TelesalesDashboard() {
  const { theme, setActiveNav } = useApp()
  const t = THEMES[theme]

  const [calls,   setCalls]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const { data } = await supabase
        .from('telesales_calls')
        .select('id,call_date,call_time,duration_seconds,outcome,language,call_disposition,system_disposition,customer_name,customer_number')
        .order('call_date', { ascending: false })
        .order('call_time', { ascending: false })
      setCalls(data || [])
      setLoading(false)
    }
    fetchData()
  }, [])

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const total          = calls.length
  const pending        = calls.filter(c => !c.outcome || c.outcome === 'pending').length
  const interested     = calls.filter(c => c.outcome === 'interested').length
  const callbacks      = calls.filter(c => c.outcome === 'callback').length
  const notInterested  = calls.filter(c => c.outcome === 'not_interested').length
  const noAnswer       = calls.filter(c => c.outcome === 'no_answer').length
  const totalDuration  = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0)
  const avgDuration    = total > 0 ? Math.round(totalDuration / total) : 0
  const convRate       = total > 0 ? ((interested / total) * 100).toFixed(1) : '0.0'

  // ── Calls by date (last 14 days) ─────────────────────────────────────────────
  const callsByDate = (() => {
    const map = {}
    calls.forEach(c => { if (c.call_date) map[c.call_date] = (map[c.call_date] || 0) + 1 })
    const sorted = Object.entries(map).sort(([a], [b]) => a > b ? 1 : -1).slice(-14)
    return sorted.map(([date, count]) => ({ date: fmtDate(date), count }))
  })()

  // ── Outcome distribution ─────────────────────────────────────────────────────
  const outcomeDist = Object.entries(OUTCOME_LABELS).map(([key, label]) => ({
    name:  label,
    value: calls.filter(c => (c.outcome || 'pending') === key).length,
    color: OUTCOME_COLORS[key],
  })).filter(d => d.value > 0)

  // ── Top dispositions ─────────────────────────────────────────────────────────
  const dispositionMap = {}
  calls.forEach(c => {
    const d = c.system_disposition || c.call_disposition
    if (d) dispositionMap[d] = (dispositionMap[d] || 0) + 1
  })
  const topDispositions = Object.entries(dispositionMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([name, count]) => ({ name, count, pct: total > 0 ? ((count / total) * 100).toFixed(0) : 0 }))

  // ── Language breakdown ────────────────────────────────────────────────────────
  const langMap = {}
  calls.forEach(c => { const l = c.language || 'Unknown'; langMap[l] = (langMap[l] || 0) + 1 })
  const langData = Object.entries(langMap).sort(([,a],[,b]) => b-a)

  // ── Avg duration by date (last 7 days) ────────────────────────────────────────
  const durationByDate = (() => {
    const map = {}
    calls.forEach(c => {
      if (!c.call_date || !c.duration_seconds) return
      if (!map[c.call_date]) map[c.call_date] = { total: 0, count: 0 }
      map[c.call_date].total += c.duration_seconds
      map[c.call_date].count++
    })
    return Object.entries(map)
      .sort(([a], [b]) => a > b ? 1 : -1).slice(-7)
      .map(([date, { total, count }]) => ({ date: fmtDate(date), avg: Math.round(total / count) }))
  })()

  // ── Recent calls (last 5) ─────────────────────────────────────────────────────
  const recent = calls.slice(0, 5)

  const s = {
    card:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px 24px' },
    label:   { fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 },
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: t.text1 }}>
        <div style={{ color: t.text3, marginBottom: '2px' }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color || t.gold }}>{p.name}: <b>{p.value}</b></div>
        ))}
      </div>
    )
  }

  if (loading) return (
    <div style={{ padding: '48px', textAlign: 'center', color: t.text4 }}>Loading telesales data...</div>
  )

  return (
    <div style={{ padding: '32px', maxWidth: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '1.5rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Telesales Overview</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Gnani AI · Inbound Bot Performance</div>
        </div>
        <button onClick={() => setActiveNav('inbound-bot')}
          style={{ background: t.purple, border: 'none', borderRadius: '8px', padding: '8px 18px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
          Open Call Log →
        </button>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Total Calls',     value: total,                  color: t.gold,   sub: 'all time' },
          { label: 'Pending Review',  value: pending,                color: t.orange, sub: `${total > 0 ? ((pending/total)*100).toFixed(0) : 0}% of total` },
          { label: 'Interested',      value: interested,             color: t.green,  sub: `${convRate}% conv. rate` },
          { label: 'Callbacks',       value: callbacks,              color: t.blue,   sub: 'scheduled' },
          { label: 'Not Interested',  value: notInterested,          color: t.red,    sub: `${total > 0 ? ((notInterested/total)*100).toFixed(0) : 0}%` },
          { label: 'No Answer',       value: noAnswer,               color: t.text3,  sub: 'unanswered' },
          { label: 'Avg Duration',    value: fmtDuration(avgDuration), color: t.text1, sub: `${fmtDuration(totalDuration)} total` },
        ].map(k => (
          <div key={k.label} style={{ ...s.card, textAlign: 'center', padding: '16px 12px' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 200, color: k.color, lineHeight: 1.1, marginBottom: '4px' }}>{k.value}</div>
            <div style={{ ...s.label, fontSize: '10px', marginBottom: '4px' }}>{k.label}</div>
            <div style={{ fontSize: '10px', color: t.text4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Charts Row 1: Calls by Date + Outcome Pie ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>

        {/* Calls Over Time */}
        <div style={s.card}>
          <div style={{ ...s.label, marginBottom: '16px' }}>Calls Per Day (Last 14 Days)</div>
          {callsByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={callsByDate} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${t.border2}80`} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Calls" fill={t.purple} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', color: t.text4, padding: '60px 0', fontSize: '12px' }}>No data yet</div>
          )}
        </div>

        {/* Outcome Donut */}
        <div style={s.card}>
          <div style={{ ...s.label, marginBottom: '16px' }}>Outcome Breakdown</div>
          {outcomeDist.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={outcomeDist} cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                    dataKey="value" paddingAngle={2}>
                    {outcomeDist.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                {outcomeDist.map(d => (
                  <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: d.color }} />
                      <span style={{ color: t.text3 }}>{d.name}</span>
                    </div>
                    <span style={{ color: t.text1, fontWeight: 600 }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: t.text4, padding: '60px 0', fontSize: '12px' }}>No outcomes marked yet</div>
          )}
        </div>
      </div>

      {/* ── Charts Row 2: Avg Duration + Dispositions + Language ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 0.8fr', gap: '16px', marginBottom: '16px' }}>

        {/* Avg Duration Trend */}
        <div style={s.card}>
          <div style={{ ...s.label, marginBottom: '16px' }}>Avg Duration / Day (Last 7 Days)</div>
          {durationByDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={durationByDate}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${t.border2}80`} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: t.text4, fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `${Math.floor(v/60)}m`} />
                <Tooltip content={<CustomTooltip />} formatter={(v) => [fmtDuration(v), 'Avg duration']} />
                <Line type="monotone" dataKey="avg" stroke={t.gold} strokeWidth={2} dot={{ fill: t.gold, r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', color: t.text4, padding: '50px 0', fontSize: '12px' }}>No duration data</div>
          )}
        </div>

        {/* Top Dispositions */}
        <div style={s.card}>
          <div style={{ ...s.label, marginBottom: '16px' }}>Top Bot Dispositions</div>
          {topDispositions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {topDispositions.map(d => (
                <div key={d.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: t.text2, fontFamily: 'monospace' }}>{d.name}</span>
                    <span style={{ fontSize: '11px', color: t.text3 }}>{d.count} · {d.pct}%</span>
                  </div>
                  <div style={{ height: '4px', background: t.border2, borderRadius: '2px' }}>
                    <div style={{ width: `${d.pct}%`, height: '100%', background: t.purple, borderRadius: '2px', transition: 'width .4s' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: t.text4, padding: '40px 0', fontSize: '12px' }}>No disposition data</div>
          )}
        </div>

        {/* Language Breakdown */}
        <div style={s.card}>
          <div style={{ ...s.label, marginBottom: '16px' }}>Language</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {langData.map(([lang, count]) => {
              const pct = total > 0 ? ((count / total) * 100).toFixed(0) : 0
              const color = lang === 'Kannada' ? t.gold : lang === 'Malayalam' ? t.green : lang === 'Telugu' ? t.blue : t.text3
              return (
                <div key={lang}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color }}>{lang}</span>
                    <span style={{ fontSize: '11px', color: t.text3 }}>{count} · {pct}%</span>
                  </div>
                  <div style={{ height: '4px', background: t.border2, borderRadius: '2px' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px' }} />
                  </div>
                </div>
              )
            })}
            {langData.length === 0 && <div style={{ textAlign: 'center', color: t.text4, fontSize: '12px', padding: '20px 0' }}>—</div>}
          </div>
        </div>
      </div>

      {/* ── Recent Calls ── */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={s.label}>Recent Calls</div>
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
            {recent.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No recent calls</td></tr>
            ) : recent.map(c => {
              const outColor = OUTCOME_COLORS[c.outcome] || t.text4
              return (
                <tr key={c.id} style={{ cursor: 'pointer' }}
                  onClick={() => setActiveNav('inbound-bot')}
                  onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text2 }}>{c.call_date}</td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text3 }}>{c.call_time?.slice(0,5) || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: t.gold, fontWeight: 500 }}>{c.customer_number}</td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text2 }}>{c.customer_name || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text3 }}>{c.language || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: t.text1 }}>{fmtDuration(c.duration_seconds)}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {c.system_disposition
                      ? <span style={{ fontSize: '10px', color: '#3a8fbf', background: '#3a8fbf18', border: '1px solid #3a8fbf25', borderRadius: '4px', padding: '2px 7px' }}>{c.system_disposition}</span>
                      : <span style={{ fontSize: '12px', color: t.text4 }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {c.outcome && c.outcome !== 'pending'
                      ? <span style={{ fontSize: '10px', color: outColor, background: `${outColor}18`, border: `1px solid ${outColor}30`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>{OUTCOME_LABELS[c.outcome]}</span>
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
