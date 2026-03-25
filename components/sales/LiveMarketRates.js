'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'

export default function LiveMarketRates() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [rates, setRates]           = useState([])       // last 60 mins of rates
  const [todayRates, setTodayRates] = useState([])       // all of today
  const [loading, setLoading]       = useState(true)
  const [lastFetch, setLastFetch]   = useState(null)
  const [fetching, setFetching]     = useState(false)
  const [countdown, setCountdown]   = useState(60)
  const canvasKRef = useRef(null)
  const canvasARef = useRef(null)
  const intervalRef = useRef(null)
  const countdownRef = useRef(null)

  useEffect(() => {
    fetchRates()
    // Auto refresh every 60 seconds
    intervalRef.current = setInterval(() => {
      fetchRates()
      setCountdown(60)
    }, 60000)
    // Countdown timer
    countdownRef.current = setInterval(() => {
      setCountdown(c => c > 0 ? c - 1 : 0)
    }, 1000)
    return () => {
      clearInterval(intervalRef.current)
      clearInterval(countdownRef.current)
    }
  }, [])

  useEffect(() => {
    if (rates.length > 0) {
      drawChart(canvasKRef.current, rates, 'kalinga_sell_rate', t.gold)
      drawChart(canvasARef.current, rates, 'ambica_sell_rate', t.blue)
    }
  }, [rates, theme])

  async function fetchRates() {
    setFetching(true)
    try {
      // Last 60 minutes
      const since60 = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { data: recent } = await supabase
        .from('gold_rates')
        .select('*')
        .gte('fetched_at', since60)
        .order('fetched_at', { ascending: true })

      // All of today
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { data: today } = await supabase
        .from('gold_rates')
        .select('*')
        .gte('fetched_at', todayStart.toISOString())
        .order('fetched_at', { ascending: true })

      setRates(recent || [])
      setTodayRates(today || [])
      setLastFetch(new Date())
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }

  function drawChart(canvas, data, field, color) {
    if (!canvas) return
    const ctx    = canvas.getContext('2d')
    const W      = canvas.width
    const H      = canvas.height
    const valid  = data.filter(d => d[field] != null)
    if (valid.length < 2) {
      ctx.clearRect(0, 0, W, H)
      return
    }

    const values  = valid.map(d => d[field])
    const times   = valid.map(d => new Date(d.fetched_at).getTime())
    const minVal  = Math.min(...values) - 50
    const maxVal  = Math.max(...values) + 50
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    const range   = maxVal - minVal || 1
    const timeRange = maxTime - minTime || 1

    const pad = { top: 20, bottom: 30, left: 60, right: 20 }
    const chartW = W - pad.left - pad.right
    const chartH = H - pad.top - pad.bottom

    ctx.clearRect(0, 0, W, H)

    // Background
    const bgGrad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom)
    bgGrad.addColorStop(0, color + '18')
    bgGrad.addColorStop(1, color + '00')

    // Grid lines
    ctx.strokeStyle = theme === 'dark' ? '#1e1e1e' : '#d0c8b8'
    ctx.lineWidth   = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
      const val = maxVal - (range / 4) * i
      ctx.fillStyle = theme === 'dark' ? '#6a5a3a' : '#9a8a6a'
      ctx.font      = '10px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(Math.round(val).toLocaleString('en-IN'), pad.left - 6, y + 4)
    }

    // Area fill
    ctx.beginPath()
    valid.forEach((d, i) => {
      const x = pad.left + ((new Date(d.fetched_at).getTime() - minTime) / timeRange) * chartW
      const y = pad.top  + ((maxVal - d[field]) / range) * chartH
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    const lastX = pad.left + ((times[times.length - 1] - minTime) / timeRange) * chartW
    ctx.lineTo(lastX, H - pad.bottom)
    ctx.lineTo(pad.left, H - pad.bottom)
    ctx.closePath()
    ctx.fillStyle = bgGrad
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth   = 2
    ctx.lineJoin    = 'round'
    valid.forEach((d, i) => {
      const x = pad.left + ((new Date(d.fetched_at).getTime() - minTime) / timeRange) * chartW
      const y = pad.top  + ((maxVal - d[field]) / range) * chartH
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Last point dot
    const lastD = valid[valid.length - 1]
    const lx    = pad.left + ((new Date(lastD.fetched_at).getTime() - minTime) / timeRange) * chartW
    const ly    = pad.top  + ((maxVal - lastD[field]) / range) * chartH
    ctx.beginPath()
    ctx.arc(lx, ly, 4, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()

    // Time labels
    ctx.fillStyle  = theme === 'dark' ? '#6a5a3a' : '#9a8a6a'
    ctx.font       = '10px sans-serif'
    ctx.textAlign  = 'center'
    const labelCount = Math.min(6, valid.length)
    const step       = Math.floor(valid.length / labelCount)
    for (let i = 0; i < valid.length; i += step) {
      const d  = valid[i]
      const x  = pad.left + ((new Date(d.fetched_at).getTime() - minTime) / timeRange) * chartW
      const lbl = new Date(d.fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      ctx.fillText(lbl, x, H - 8)
    }
  }

  // Current rates (latest entry)
  const latest       = rates[rates.length - 1] || null
  const prev         = rates[rates.length - 2] || null
  const kChange      = latest && prev ? latest.kalinga_sell_rate - prev.kalinga_sell_rate : 0
  const aChange      = latest && prev ? latest.ambica_sell_rate  - prev.ambica_sell_rate  : 0

  // Today stats
  const kRates       = todayRates.filter(r => r.kalinga_sell_rate).map(r => r.kalinga_sell_rate)
  const aRates       = todayRates.filter(r => r.ambica_sell_rate).map(r => r.ambica_sell_rate)
  const kHigh        = kRates.length ? Math.max(...kRates) : null
  const kLow         = kRates.length ? Math.min(...kRates) : null
  const aHigh        = aRates.length ? Math.max(...aRates) : null
  const aLow         = aRates.length ? Math.min(...aRates) : null
  const kOpen        = kRates[0] || null
  const aOpen        = aRates[0] || null
  const kDayChange   = latest?.kalinga_sell_rate && kOpen ? latest.kalinga_sell_rate - kOpen : null
  const aDayChange   = latest?.ambica_sell_rate  && aOpen ? latest.ambica_sell_rate  - aOpen : null

  const s = {
    card:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px 24px', marginBottom: '16px' },
    label:   { fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 },
    btnGold: { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
    btnOut:  { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 16px', fontSize: '12px', cursor: 'pointer' },
  }

  const changeColor = (v) => v > 0 ? t.green : v < 0 ? t.red : t.text3
  const changeIcon  = (v) => v > 0 ? '▲' : v < 0 ? '▼' : '—'

  return (
    <div style={{ padding: '32px', maxWidth: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Live Market Rates</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>
            Gold sell rates · Kalinga Kawad + Ambicaa · Auto-refreshes every minute
            {lastFetch && <span style={{ marginLeft: '10px', color: t.text4 }}>Last updated: {fmtTime(lastFetch)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Countdown ring */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', background: `${t.green}15`, border: `1px solid ${t.green}40` }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: t.green, display: 'inline-block', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: '12px', color: t.green, fontWeight: 600 }}>Live · {countdown}s</span>
          </div>
          <button onClick={() => { fetchRates(); setCountdown(60) }} disabled={fetching}
            style={{ ...s.btnGold, opacity: fetching ? .7 : 1 }}>
            {fetching ? '⟳ Fetching...' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* Live Rate Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        {/* Kalinga Kawad */}
        <div style={{ ...s.card, marginBottom: 0, border: `1px solid ${t.gold}30`, background: `linear-gradient(135deg, ${t.card} 0%, ${t.gold}08 100%)` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ ...s.label, color: t.gold }}>Kalinga Kawad</div>
              <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>GOLD 999 IMP WITH GST FOR REF</div>
            </div>
            <div style={{ fontSize: '11px', color: t.text4, background: t.card2, borderRadius: '6px', padding: '3px 8px' }}>SELL</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '2.8rem', fontWeight: 200, color: t.gold, lineHeight: 1 }}>
              {loading ? '—' : fmt(latest?.kalinga_sell_rate)}
            </div>
            {!loading && kChange !== 0 && (
              <div style={{ fontSize: '14px', color: changeColor(kChange), fontWeight: 600, marginBottom: '6px' }}>
                {changeIcon(kChange)} {Math.abs(kChange).toLocaleString('en-IN')}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {[
              { label: 'Open',   value: fmt(kOpen) },
              { label: 'High',   value: fmt(kHigh), color: t.green },
              { label: 'Low',    value: fmt(kLow),  color: t.red },
              { label: 'Change', value: kDayChange != null ? `${kDayChange > 0 ? '+' : ''}${kDayChange.toLocaleString('en-IN')}` : '—', color: kDayChange != null ? changeColor(kDayChange) : t.text3 },
            ].map(item => (
              <div key={item.label} style={{ background: t.card2, borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: t.text4, marginBottom: '3px', letterSpacing: '.08em', textTransform: 'uppercase' }}>{item.label}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: item.color || t.text1 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Ambicaa */}
        <div style={{ ...s.card, marginBottom: 0, border: `1px solid ${t.blue}30`, background: `linear-gradient(135deg, ${t.card} 0%, ${t.blue}08 100%)` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ ...s.label, color: t.blue }}>Ambicaa Sales Corpn</div>
              <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>IND-GOLD[999]-1KG today</div>
            </div>
            <div style={{ fontSize: '11px', color: t.text4, background: t.card2, borderRadius: '6px', padding: '3px 8px' }}>SELL</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '2.8rem', fontWeight: 200, color: t.blue, lineHeight: 1 }}>
              {loading ? '—' : fmt(latest?.ambica_sell_rate)}
            </div>
            {!loading && aChange !== 0 && (
              <div style={{ fontSize: '14px', color: changeColor(aChange), fontWeight: 600, marginBottom: '6px' }}>
                {changeIcon(aChange)} {Math.abs(aChange).toLocaleString('en-IN')}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {[
              { label: 'Open',   value: fmt(aOpen) },
              { label: 'High',   value: fmt(aHigh), color: t.green },
              { label: 'Low',    value: fmt(aLow),  color: t.red },
              { label: 'Change', value: aDayChange != null ? `${aDayChange > 0 ? '+' : ''}${aDayChange.toLocaleString('en-IN')}` : '—', color: aDayChange != null ? changeColor(aDayChange) : t.text3 },
            ].map(item => (
              <div key={item.label} style={{ background: t.card2, borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: t.text4, marginBottom: '3px', letterSpacing: '.08em', textTransform: 'uppercase' }}>{item.label}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: item.color || t.text1 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Spread */}
      {latest?.kalinga_sell_rate && latest?.ambica_sell_rate && (
        <div style={{ ...s.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px' }}>
          <div style={{ fontSize: '12px', color: t.text3 }}>Spread (Kalinga − Ambicaa)</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: t.orange }}>
            {(latest.kalinga_sell_rate - latest.ambica_sell_rate > 0 ? '+' : '')}
            {(latest.kalinga_sell_rate - latest.ambica_sell_rate).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '12px', color: t.text3 }}>
            Kalinga is {latest.kalinga_sell_rate > latest.ambica_sell_rate ? 'higher' : 'lower'} by ₹{Math.abs(latest.kalinga_sell_rate - latest.ambica_sell_rate).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '12px', color: t.text4 }}>As of {fmtTime(latest?.fetched_at)}</div>
        </div>
      )}

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ ...s.label, color: t.gold }}>Kalinga Kawad — Last 60 min</div>
            <div style={{ fontSize: '11px', color: t.text4 }}>{rates.length} data points</div>
          </div>
          <canvas ref={canvasKRef} width={500} height={180} style={{ width: '100%', height: '180px' }} />
        </div>
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ ...s.label, color: t.blue }}>Ambicaa — Last 60 min</div>
            <div style={{ fontSize: '11px', color: t.text4 }}>{rates.filter(r => r.ambica_sell_rate).length} data points</div>
          </div>
          <canvas ref={canvasARef} width={500} height={180} style={{ width: '100%', height: '180px' }} />
        </div>
      </div>

      {/* Today's full chart — both on same chart */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={s.label}>Today's Rate Movement</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '2px', background: t.gold, borderRadius: '1px' }} />
              <span style={{ fontSize: '11px', color: t.text3 }}>Kalinga Kawad</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '2px', background: t.blue, borderRadius: '1px' }} />
              <span style={{ fontSize: '11px', color: t.text3 }}>Ambicaa</span>
            </div>
          </div>
        </div>
        <TodayChart data={todayRates} t={t} theme={theme} />
      </div>

      {/* Rate History Table */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={s.label}>Rate History — Today</div>
          <div style={{ fontSize: '11px', color: t.text4 }}>{todayRates.length} snapshots</div>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr>
                {['Time', 'Kalinga Kawad', 'Chg', 'Ambicaa', 'Chg', 'Spread'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Time' ? 'left' : 'right', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...todayRates].reverse().map((row, i) => {
                const prevRow = [...todayRates].reverse()[i + 1]
                const kChg   = prevRow?.kalinga_sell_rate ? row.kalinga_sell_rate - prevRow.kalinga_sell_rate : null
                const aChg   = prevRow?.ambica_sell_rate  ? row.ambica_sell_rate  - prevRow.ambica_sell_rate  : null
                const spread = row.kalinga_sell_rate && row.ambica_sell_rate ? row.kalinga_sell_rate - row.ambica_sell_rate : null
                return (
                  <tr key={row.id} style={{ borderBottom: `1px solid ${t.border}20` }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '9px 14px', fontSize: '13px', color: t.text2 }}>{fmtTime(row.fetched_at)}</td>
                    <td style={{ padding: '9px 14px', fontSize: '13px', color: t.gold, textAlign: 'right', fontWeight: 500 }}>{fmt(row.kalinga_sell_rate)}</td>
                    <td style={{ padding: '9px 14px', fontSize: '12px', color: kChg != null ? changeColor(kChg) : t.text4, textAlign: 'right' }}>
                      {kChg != null ? `${kChg > 0 ? '+' : ''}${kChg}` : '—'}
                    </td>
                    <td style={{ padding: '9px 14px', fontSize: '13px', color: t.blue, textAlign: 'right', fontWeight: 500 }}>{fmt(row.ambica_sell_rate)}</td>
                    <td style={{ padding: '9px 14px', fontSize: '12px', color: aChg != null ? changeColor(aChg) : t.text4, textAlign: 'right' }}>
                      {aChg != null ? `${aChg > 0 ? '+' : ''}${aChg}` : '—'}
                    </td>
                    <td style={{ padding: '9px 14px', fontSize: '12px', color: t.orange, textAlign: 'right' }}>
                      {spread != null ? (spread > 0 ? '+' : '') + spread.toLocaleString('en-IN') : '—'}
                    </td>
                  </tr>
                )
              })}
              {todayRates.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No data yet today — rates populate every minute during market hours</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Combined today chart component
function TodayChart({ data, t, theme }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || data.length < 2) return
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    const W      = canvas.width
    const H      = canvas.height

    const kData = data.filter(d => d.kalinga_sell_rate)
    const aData = data.filter(d => d.ambica_sell_rate)
    if (!kData.length && !aData.length) return

    const allVals  = [...kData.map(d => d.kalinga_sell_rate), ...aData.map(d => d.ambica_sell_rate)]
    const minVal   = Math.min(...allVals) - 100
    const maxVal   = Math.max(...allVals) + 100
    const range    = maxVal - minVal || 1
    const allTimes = data.map(d => new Date(d.fetched_at).getTime())
    const minTime  = Math.min(...allTimes)
    const maxTime  = Math.max(...allTimes)
    const timeRange = maxTime - minTime || 1

    const pad = { top: 20, bottom: 30, left: 70, right: 20 }
    const chartW = W - pad.left - pad.right
    const chartH = H - pad.top  - pad.bottom

    ctx.clearRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = theme === 'dark' ? '#1e1e1e' : '#d0c8b8'
    ctx.lineWidth   = 1
    for (let i = 0; i <= 4; i++) {
      const y   = pad.top + (chartH / 4) * i
      const val = maxVal - (range / 4) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
      ctx.fillStyle  = theme === 'dark' ? '#6a5a3a' : '#9a8a6a'
      ctx.font       = '10px sans-serif'
      ctx.textAlign  = 'right'
      ctx.fillText(Math.round(val).toLocaleString('en-IN'), pad.left - 6, y + 4)
    }

    // Draw both lines
    const drawLine = (lineData, field, color) => {
      if (lineData.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth   = 2
      ctx.lineJoin    = 'round'
      lineData.forEach((d, i) => {
        const x = pad.left + ((new Date(d.fetched_at).getTime() - minTime) / timeRange) * chartW
        const y = pad.top  + ((maxVal - d[field]) / range) * chartH
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()
      // Last dot
      const last = lineData[lineData.length - 1]
      const lx   = pad.left + ((new Date(last.fetched_at).getTime() - minTime) / timeRange) * chartW
      const ly   = pad.top  + ((maxVal - last[field]) / range) * chartH
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
    }

    drawLine(kData, 'kalinga_sell_rate', theme === 'dark' ? '#c9a84c' : '#a07830')
    drawLine(aData, 'ambica_sell_rate',  theme === 'dark' ? '#3a8fbf' : '#2a6a9a')

    // Time labels
    ctx.fillStyle  = theme === 'dark' ? '#6a5a3a' : '#9a8a6a'
    ctx.font       = '10px sans-serif'
    ctx.textAlign  = 'center'
    const step = Math.max(1, Math.floor(data.length / 8))
    for (let i = 0; i < data.length; i += step) {
      const x   = pad.left + ((new Date(data[i].fetched_at).getTime() - minTime) / timeRange) * chartW
      const lbl = new Date(data[i].fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      ctx.fillText(lbl, x, H - 8)
    }
  }, [data, theme])

  if (data.length < 2) {
    return (
      <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '13px' }}>
        Not enough data yet — chart will appear as rates accumulate through the day
      </div>
    )
  }

  return <canvas ref={canvasRef} width={1000} height={220} style={{ width: '100%', height: '220px' }} />
}