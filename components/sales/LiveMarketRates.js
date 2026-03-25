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

export default function LiveMarketRates() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [rates, setRates]           = useState([])
  const [todayRates, setTodayRates] = useState([])
  const [loading, setLoading]       = useState(true)
  const [lastFetch, setLastFetch]   = useState(null)
  const [fetching, setFetching]     = useState(false)
  const [countdown, setCountdown]   = useState(60)
  const canvasKRef  = useRef(null)
  const canvasARef  = useRef(null)
  const canvasTRef  = useRef(null)
  const intervalRef = useRef(null)
  const countRef    = useRef(null)

  useEffect(() => {
    fetchRates()
    intervalRef.current = setInterval(() => { fetchRates(); setCountdown(60) }, 60000)
    countRef.current    = setInterval(() => setCountdown(c => c > 0 ? c - 1 : 0), 1000)
    return () => { clearInterval(intervalRef.current); clearInterval(countRef.current) }
  }, [])

  useEffect(() => {
    if (rates.length > 0) {
      drawMiniChart(canvasKRef.current, rates, 'kalinga_sell_rate', t.gold, t)
      drawMiniChart(canvasARef.current, rates, 'ambica_sell_rate',  t.blue, t)
    }
    if (todayRates.length > 1) drawTodayChart(canvasTRef.current, todayRates, t, theme)
  }, [rates, todayRates, theme])

  async function fetchRates() {
    setFetching(true)
    try {
      const since60 = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const todayStart = new Date(); todayStart.setHours(0,0,0,0)
      const [{ data: recent }, { data: today }] = await Promise.all([
        supabase.from('gold_rates').select('*').gte('fetched_at', since60).order('fetched_at', { ascending: true }),
        supabase.from('gold_rates').select('*').gte('fetched_at', todayStart.toISOString()).order('fetched_at', { ascending: true }),
      ])
      setRates(recent || [])
      setTodayRates(today || [])
      setLastFetch(new Date())
    } finally { setLoading(false); setFetching(false) }
  }

  function drawMiniChart(canvas, data, field, color, t) {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const valid = data.filter(d => d[field] != null)
    if (valid.length < 2) { ctx.clearRect(0,0,W,H); return }

    const vals    = valid.map(d => d[field])
    const times   = valid.map(d => new Date(d.fetched_at).getTime())
    const minV    = Math.min(...vals) - 20
    const maxV    = Math.max(...vals) + 20
    const minT    = Math.min(...times)
    const maxT    = Math.max(...times)
    const range   = maxV - minV || 1
    const tRange  = maxT - minT || 1
    const pad     = { top: 12, bottom: 28, left: 58, right: 12 }
    const cW      = W - pad.left - pad.right
    const cH      = H - pad.top  - pad.bottom

    ctx.clearRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = theme === 'dark' ? '#1a1a1a' : '#d8d0c4'
    ctx.lineWidth   = 1
    for (let i = 0; i <= 3; i++) {
      const y   = pad.top + (cH / 3) * i
      const val = maxV - (range / 3) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
      ctx.fillStyle  = theme === 'dark' ? '#5a4a2a' : '#9a8a6a'
      ctx.font       = '9px monospace'
      ctx.textAlign  = 'right'
      ctx.fillText(Math.round(val).toLocaleString('en-IN'), pad.left - 4, y + 3)
    }

    // Area gradient
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom)
    grad.addColorStop(0, color + '22')
    grad.addColorStop(1, color + '00')

    const getXY = (d) => ({
      x: pad.left + ((new Date(d.fetched_at).getTime() - minT) / tRange) * cW,
      y: pad.top  + ((maxV - d[field]) / range) * cH,
    })

    ctx.beginPath()
    valid.forEach((d, i) => { const {x,y} = getXY(d); i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y) })
    const last = getXY(valid[valid.length - 1])
    ctx.lineTo(last.x, H - pad.bottom)
    ctx.lineTo(pad.left, H - pad.bottom)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth   = 1.5
    ctx.lineJoin    = 'round'
    valid.forEach((d, i) => { const {x,y} = getXY(d); i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y) })
    ctx.stroke()

    // Last dot
    ctx.beginPath()
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()

    // Time labels — only first and last to avoid overlap
    ctx.fillStyle  = theme === 'dark' ? '#5a4a2a' : '#9a8a6a'
    ctx.font       = '9px monospace'
    const fmt2 = (d) => new Date(d.fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    ctx.textAlign = 'left';  ctx.fillText(fmt2(valid[0]),                   pad.left,     H - 8)
    ctx.textAlign = 'right'; ctx.fillText(fmt2(valid[valid.length - 1]),    W - pad.right, H - 8)
    if (valid.length > 4) {
      const mid = valid[Math.floor(valid.length / 2)]
      const mx  = getXY(mid).x
      ctx.textAlign = 'center'; ctx.fillText(fmt2(mid), mx, H - 8)
    }
  }

  function drawTodayChart(canvas, data, t, theme) {
    if (!canvas || data.length < 2) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const kData = data.filter(d => d.kalinga_sell_rate)
    const aData = data.filter(d => d.ambica_sell_rate)
    if (!kData.length && !aData.length) return

    const allV    = [...kData.map(d => d.kalinga_sell_rate), ...aData.map(d => d.ambica_sell_rate)]
    const minV    = Math.min(...allV) - 50
    const maxV    = Math.max(...allV) + 50
    const range   = maxV - minV || 1
    const allT    = data.map(d => new Date(d.fetched_at).getTime())
    const minT    = Math.min(...allT)
    const maxT    = Math.max(...allT)
    const tRange  = maxT - minT || 1
    const pad     = { top: 16, bottom: 32, left: 64, right: 16 }
    const cW      = W - pad.left - pad.right
    const cH      = H - pad.top  - pad.bottom

    ctx.clearRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = theme === 'dark' ? '#1a1a1a' : '#d8d0c4'
    ctx.lineWidth   = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (cH / 4) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
      ctx.fillStyle = theme === 'dark' ? '#5a4a2a' : '#9a8a6a'
      ctx.font      = '9px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(Math.round(maxV - (range/4)*i).toLocaleString('en-IN'), pad.left - 6, y + 3)
    }

    const getXY = (d, field) => ({
      x: pad.left + ((new Date(d.fetched_at).getTime() - minT) / tRange) * cW,
      y: pad.top  + ((maxV - d[field]) / range) * cH,
    })

    const drawLine = (lineData, field, color) => {
      if (lineData.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'
      lineData.forEach((d, i) => { const {x,y} = getXY(d, field); i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y) })
      ctx.stroke()
      const ld = lineData[lineData.length - 1]
      const {x,y} = getXY(ld, field)
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill()
    }

    drawLine(kData, 'kalinga_sell_rate', theme === 'dark' ? '#c9a84c' : '#a07830')
    drawLine(aData, 'ambica_sell_rate',  theme === 'dark' ? '#3a8fbf' : '#2a6a9a')

    // Time labels — evenly spaced, no overlap
    ctx.fillStyle = theme === 'dark' ? '#5a4a2a' : '#9a8a6a'
    ctx.font      = '9px monospace'
    const maxLabels = Math.floor(cW / 60)
    const step      = Math.max(1, Math.floor(data.length / maxLabels))
    data.filter((_, i) => i % step === 0).forEach(d => {
      const x   = pad.left + ((new Date(d.fetched_at).getTime() - minT) / tRange) * cW
      const lbl = new Date(d.fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      ctx.textAlign = 'center'
      ctx.fillText(lbl, x, H - 10)
    })
  }

  const latest     = rates[rates.length - 1]     || null
  const prev       = rates[rates.length - 2]     || null
  const kChange    = latest && prev ? (latest.kalinga_sell_rate || 0) - (prev.kalinga_sell_rate || 0) : 0
  const aChange    = latest && prev ? (latest.ambica_sell_rate  || 0) - (prev.ambica_sell_rate  || 0) : 0
  const kRates     = todayRates.filter(r => r.kalinga_sell_rate).map(r => r.kalinga_sell_rate)
  const aRates     = todayRates.filter(r => r.ambica_sell_rate).map(r => r.ambica_sell_rate)
  const kHigh      = kRates.length ? Math.max(...kRates) : null
  const kLow       = kRates.length ? Math.min(...kRates) : null
  const aHigh      = aRates.length ? Math.max(...aRates) : null
  const aLow       = aRates.length ? Math.min(...aRates) : null
  const kOpen      = kRates[0] || null
  const aOpen      = aRates[0] || null
  const kDayChange = latest?.kalinga_sell_rate && kOpen ? latest.kalinga_sell_rate - kOpen : null
  const aDayChange = latest?.ambica_sell_rate  && aOpen ? latest.ambica_sell_rate  - aOpen : null
  const spread     = latest?.kalinga_sell_rate && latest?.ambica_sell_rate ? latest.kalinga_sell_rate - latest.ambica_sell_rate : null

  const cc = (v) => v > 0 ? t.green : v < 0 ? t.red : t.text3
  const ci = (v) => v > 0 ? '▲' : v < 0 ? '▼' : ''
  const fmtChg = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('en-IN')}`

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Live Market Rates</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '3px' }}>
            Gold sell rates · Kalinga Kawad + Ambicaa · Auto-refreshes every minute
            {lastFetch && <span style={{ marginLeft: '10px', color: t.text4 }}>Updated {fmtTime(lastFetch)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '20px', background: `${t.green}15`, border: `1px solid ${t.green}35` }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.green, display: 'inline-block' }} />
            <span style={{ fontSize: '11px', color: t.green, fontWeight: 600 }}>Live · {countdown}s</span>
          </div>
          <button onClick={() => { fetchRates(); setCountdown(60) }} disabled={fetching}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: fetching ? .7 : 1 }}>
            {fetching ? '⟳' : '⟳'} Refresh
          </button>
        </div>
      </div>

      {/* Rate Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        {[
          { label: 'Kalinga Kawad', sub: 'GOLD 999 IMP WITH GST FOR REF', rate: latest?.kalinga_sell_rate, change: kChange, open: kOpen, high: kHigh, low: kLow, dayChange: kDayChange, color: t.gold, canvasRef: canvasKRef, dataLen: rates.length },
          { label: 'Ambicaa Sales Corpn', sub: 'IND-GOLD[999]-1KG today', rate: latest?.ambica_sell_rate, change: aChange, open: aOpen, high: aHigh, low: aLow, dayChange: aDayChange, color: t.blue, canvasRef: canvasARef, dataLen: rates.filter(r => r.ambica_sell_rate).length },
        ].map(item => (
          <div key={item.label} style={{ ...card, overflow: 'hidden' }}>
            {/* Card header */}
            <div style={{ padding: '14px 18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '11px', color: item.color, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{item.label}</div>
                <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>{item.sub}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: t.text4, background: t.card2, borderRadius: '4px', padding: '2px 7px', letterSpacing: '.08em' }}>SELL</span>
              </div>
            </div>

            {/* Big rate + change */}
            <div style={{ padding: '10px 18px 0', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <div style={{ fontSize: '2.4rem', fontWeight: 200, color: item.color, letterSpacing: '-.01em', lineHeight: 1 }}>
                {loading ? '—' : fmt(item.rate)}
              </div>
              {!loading && item.change !== 0 && (
                <div style={{ fontSize: '13px', color: cc(item.change), fontWeight: 600 }}>
                  {ci(item.change)} {Math.abs(item.change).toLocaleString('en-IN')}
                </div>
              )}
            </div>

            {/* OHLC stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1px', background: t.border, margin: '12px 0 0', borderTop: `1px solid ${t.border}` }}>
              {[
                { label: 'Open',   value: fmt(item.open),     color: t.text1 },
                { label: 'High',   value: fmt(item.high),     color: t.green },
                { label: 'Low',    value: fmt(item.low),      color: t.red },
                { label: 'Change', value: fmtChg(item.dayChange), color: item.dayChange != null ? cc(item.dayChange) : t.text3 },
              ].map(s => (
                <div key={s.label} style={{ background: t.card, padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>{s.label}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Mini chart */}
            <div style={{ padding: '10px 0 0' }}>
              <canvas ref={item.canvasRef} width={600} height={100} style={{ width: '100%', height: '100px' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Spread Bar */}
      {spread != null && (
        <div style={{ ...card, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Spread</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: t.orange }}>{spread > 0 ? '+' : ''}{spread.toLocaleString('en-IN')}</div>
          <div style={{ flex: 1, height: '4px', background: t.border2, borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, Math.abs(spread) / 5)}%`, height: '100%', background: t.orange, borderRadius: '2px' }} />
          </div>
          <div style={{ fontSize: '12px', color: t.text3, whiteSpace: 'nowrap' }}>
            Kalinga is <span style={{ color: spread > 0 ? t.orange : t.blue }}>{spread > 0 ? 'higher' : 'lower'}</span> by ₹{Math.abs(spread).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtTime(latest?.fetched_at)}</div>
        </div>
      )}

      {/* Today's Chart */}
      <div style={{ ...card, padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Today's Rate Movement</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            {[{ color: t.gold, label: 'Kalinga Kawad' }, { color: t.blue, label: 'Ambicaa' }].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '16px', height: '2px', background: l.color, borderRadius: '1px' }} />
                <span style={{ fontSize: '11px', color: t.text3 }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
        {todayRates.length >= 2
          ? <canvas ref={canvasTRef} width={1200} height={200} style={{ width: '100%', height: '200px' }} />
          : <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '12px' }}>Accumulating data... chart appears after a few minutes</div>
        }
      </div>

      {/* History Table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Rate History — Today</div>
          <div style={{ fontSize: '11px', color: t.text4 }}>{todayRates.length} snapshots</div>
        </div>
        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr>
                {['Time', 'Kalinga Kawad', 'Chg', 'Ambicaa', 'Chg', 'Spread'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: i === 0 ? 'left' : 'right', background: t.card2, borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...todayRates].reverse().map((row, i) => {
                const pr   = [...todayRates].reverse()[i + 1]
                const kC   = pr?.kalinga_sell_rate ? row.kalinga_sell_rate - pr.kalinga_sell_rate : null
                const aC   = pr?.ambica_sell_rate  ? row.ambica_sell_rate  - pr.ambica_sell_rate  : null
                const sp   = row.kalinga_sell_rate && row.ambica_sell_rate ? row.kalinga_sell_rate - row.ambica_sell_rate : null
                return (
                  <tr key={row.id}
                    style={{ borderBottom: `1px solid ${t.border}18` }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '8px 14px', fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>{fmtTime(row.fetched_at)}</td>
                    <td style={{ padding: '8px 14px', fontSize: '13px', color: t.gold, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(row.kalinga_sell_rate)}</td>
                    <td style={{ padding: '8px 14px', fontSize: '11px', color: kC != null ? cc(kC) : t.text4, textAlign: 'right', fontFamily: 'monospace' }}>{kC != null ? fmtChg(kC) : '—'}</td>
                    <td style={{ padding: '8px 14px', fontSize: '13px', color: t.blue, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(row.ambica_sell_rate)}</td>
                    <td style={{ padding: '8px 14px', fontSize: '11px', color: aC != null ? cc(aC) : t.text4, textAlign: 'right', fontFamily: 'monospace' }}>{aC != null ? fmtChg(aC) : '—'}</td>
                    <td style={{ padding: '8px 14px', fontSize: '11px', color: t.orange, textAlign: 'right', fontFamily: 'monospace' }}>{sp != null ? fmtChg(sp) : '—'}</td>
                  </tr>
                )
              })}
              {todayRates.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No data yet — rates populate every minute during market hours</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}