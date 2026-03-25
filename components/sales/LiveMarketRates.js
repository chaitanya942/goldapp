'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
const fmtChg  = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('en-IN')}`
const cc      = (v, t) => v > 0 ? t.green : v < 0 ? t.red : t.text3
const ci      = (v) => v > 0 ? '▲' : v < 0 ? '▼' : '—'

function isMarketOpen() {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day  = ist.getDay(), h = ist.getHours(), m = ist.getMinutes()
  return day >= 1 && day <= 5 && (h * 60 + m) >= 540 && (h * 60 + m) < 1140
}

function drawChart(canvas, data, fields, colors, theme) {
  if (!canvas || data.length < 2) return
  const ctx  = canvas.getContext('2d')
  const dpr  = window.devicePixelRatio || 1
  const W    = canvas.offsetWidth * dpr
  const H    = canvas.offsetHeight * dpr
  canvas.width  = W
  canvas.height = H
  ctx.scale(dpr, dpr)
  const cW2 = canvas.offsetWidth
  const cH2 = canvas.offsetHeight

  const allValid = fields.flatMap(f => data.filter(d => d[f] != null).map(d => d[f]))
  if (allValid.length < 2) { ctx.clearRect(0, 0, cW2, cH2); return }

  const minV   = Math.min(...allValid) - 30
  const maxV   = Math.max(...allValid) + 30
  const range  = maxV - minV || 1
  const allT   = data.map(d => new Date(d.fetched_at).getTime())
  const minT   = Math.min(...allT), maxT = Math.max(...allT)
  const tRange = maxT - minT || 1
  const pad    = { top: 12, bottom: 24, left: 64, right: 10 }
  const cW     = cW2 - pad.left - pad.right
  const cH     = cH2 - pad.top  - pad.bottom

  ctx.clearRect(0, 0, cW2, cH2)

  // Grid lines
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + (cH / 3) * i
    ctx.strokeStyle = theme === 'dark' ? '#1c1c1c' : '#d5cdc0'
    ctx.lineWidth = 1; ctx.setLineDash([2, 4])
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(cW2 - pad.right, y); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = theme === 'dark' ? '#5a4a2a' : '#8a7a5a'
    ctx.font = '9px monospace'; ctx.textAlign = 'right'
    ctx.fillText(Math.round(maxV - (range / 3) * i).toLocaleString('en-IN'), pad.left - 4, y + 3)
  }

  const getXY = (d, field) => ({
    x: pad.left + ((new Date(d.fetched_at).getTime() - minT) / tRange) * cW,
    y: pad.top  + ((maxV - d[field]) / range) * cH,
  })

  fields.forEach((field, fi) => {
    const color = colors[fi]
    const valid = data.filter(d => d[field] != null)
    if (valid.length < 2) return

    // Area
    const grad = ctx.createLinearGradient(0, pad.top, 0, cH2 - pad.bottom)
    grad.addColorStop(0, color + (fi === 0 ? '22' : '14'))
    grad.addColorStop(1, color + '00')
    ctx.beginPath()
    valid.forEach((d, i) => { const {x,y} = getXY(d, field); i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y) })
    const lp = getXY(valid[valid.length-1], field)
    ctx.lineTo(lp.x, cH2 - pad.bottom); ctx.lineTo(getXY(valid[0], field).x, cH2 - pad.bottom)
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill()

    // Line
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
    valid.forEach((d, i) => { const {x,y} = getXY(d, field); i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y) })
    ctx.stroke()

    // Dot
    ctx.beginPath(); ctx.arc(lp.x, lp.y, 3, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill()
  })

  // Time labels
  const maxLabels = Math.max(2, Math.floor(cW / 70))
  const step = Math.max(1, Math.floor(data.length / maxLabels))
  ctx.fillStyle = theme === 'dark' ? '#5a4a2a' : '#8a7a5a'
  ctx.font = '9px monospace'
  for (let i = 0; i < data.length; i += step) {
    const x   = pad.left + ((new Date(data[i].fetched_at).getTime() - minT) / tRange) * cW
    const lbl = new Date(data[i].fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    ctx.textAlign = i === 0 ? 'left' : (i + step >= data.length ? 'right' : 'center')
    ctx.fillText(lbl, x, cH2 - 6)
  }
}

export default function LiveMarketRates() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [rates,      setRates]      = useState([])
  const [todayRates, setTodayRates] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [lastFetch,  setLastFetch]  = useState(null)
  const [fetching,   setFetching]   = useState(false)
  const [countdown,  setCountdown]  = useState(60)
  const [fetchError, setFetchError] = useState(null)

  const kRef = useRef(null)
  const aRef = useRef(null)
  const mRef = useRef(null)
  const tRef = useRef(null)

  const fetchRates = useCallback(async () => {
    setFetching(true); setFetchError(null)
    try {
      const since60    = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const todayStart = new Date(); todayStart.setHours(0,0,0,0)
      const [r1, r2] = await Promise.all([
        supabase.from('gold_rates').select('*').gte('fetched_at', since60).order('fetched_at', { ascending: true }),
        supabase.from('gold_rates').select('*').gte('fetched_at', todayStart.toISOString()).order('fetched_at', { ascending: true }),
      ])
      if (r1.error) throw r1.error
      setRates(r1.data || [])
      setTodayRates(r2.data || [])
      setLastFetch(new Date())
    } catch (err) { setFetchError(err.message) }
    finally { setLoading(false); setFetching(false) }
  }, [])

  const handleRefresh = useCallback(async () => {
    setFetching(true)
    try { await fetch('/api/fetch-gold-rates') } catch {}
    await fetchRates()
    setCountdown(60)
  }, [fetchRates])

  useEffect(() => {
    fetchRates()
    const di = setInterval(fetchRates, 60000)
    const ci = setInterval(() => setCountdown(c => c > 0 ? c - 1 : 0), 1000)
    return () => { clearInterval(di); clearInterval(ci) }
  }, [fetchRates])

  useEffect(() => {
    const gold   = theme === 'dark' ? '#c9a84c' : '#a07830'
    const blue   = theme === 'dark' ? '#3a8fbf' : '#2a6a9a'
    const purple = theme === 'dark' ? '#8c5ac8' : '#6a3a9a'
    if (rates.length >= 2) {
      drawChart(kRef.current, rates, ['kalinga_sell_rate'], [gold],   theme)
      drawChart(aRef.current, rates, ['ambica_sell_rate'],  [blue],   theme)
      drawChart(mRef.current, rates, ['aamlin_sell_rate'],  [purple], theme)
    }
    if (todayRates.length >= 2) {
      drawChart(tRef.current, todayRates, ['kalinga_sell_rate','ambica_sell_rate','aamlin_sell_rate'], [gold, blue, purple], theme)
    }
  }, [rates, todayRates, theme])

  // Stats
  const latest  = rates[rates.length - 1] || null
  const prev    = rates[rates.length - 2] || null

  const stat = (field) => {
    const vals    = todayRates.filter(r => r[field]).map(r => r[field])
    const change  = latest && prev ? (latest[field]||0) - (prev[field]||0) : 0
    const dayChg  = latest?.[field] && vals[0] ? latest[field] - vals[0] : null
    const trend   = vals.length >= 5 ? vals[vals.length-1] - vals[vals.length-5] : 0
    return { change, dayChg, trend, high: vals.length ? Math.max(...vals) : null, low: vals.length ? Math.min(...vals) : null, open: vals[0] || null }
  }

  const kStat = stat('kalinga_sell_rate')
  const aStat = stat('ambica_sell_rate')
  const mStat = stat('aamlin_sell_rate')

  const spread_ka = latest?.kalinga_sell_rate && latest?.ambica_sell_rate ? latest.kalinga_sell_rate - latest.ambica_sell_rate : null
  const spread_km = latest?.kalinga_sell_rate && latest?.aamlin_sell_rate ? latest.kalinga_sell_rate - latest.aamlin_sell_rate : null
  const marketOpen = isMarketOpen()

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }

  const RateCard = ({ label, sub, rate, s, color, canvasRef }) => (
    <div style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '13px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '11px', color, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{label}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '1px' }}>{sub}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {s.trend !== 0 && (
            <div style={{ fontSize: '10px', color: cc(s.trend, t), background: `${cc(s.trend, t)}18`, borderRadius: '4px', padding: '2px 6px', fontWeight: 600 }}>
              {ci(s.trend)} 5m
            </div>
          )}
          <div style={{ fontSize: '10px', color: t.text4, background: t.card2, borderRadius: '4px', padding: '2px 7px' }}>SELL</div>
        </div>
      </div>
      <div style={{ padding: '0 16px 10px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <div style={{ fontSize: '2rem', fontWeight: 200, color, lineHeight: 1, fontFamily: 'monospace' }}>
          {loading ? '—' : fmt(rate)}
        </div>
        {!loading && s.change !== 0 && (
          <div style={{ fontSize: '12px', color: cc(s.change, t), fontWeight: 600 }}>
            {ci(s.change)} {Math.abs(s.change).toLocaleString('en-IN')}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderTop: `1px solid ${t.border}` }}>
        {[
          { label: 'Open',   value: fmt(s.open),   color: t.text2 },
          { label: 'High',   value: fmt(s.high),   color: t.green },
          { label: 'Low',    value: fmt(s.low),    color: t.red },
          { label: 'Change', value: fmtChg(s.dayChg), color: s.dayChg != null ? cc(s.dayChg, t) : t.text3 },
        ].map((item, i) => (
          <div key={item.label} style={{ padding: '7px 0', textAlign: 'center', borderRight: i < 3 ? `1px solid ${t.border}` : 'none' }}>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '2px' }}>{item.label}</div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: item.color, fontFamily: 'monospace' }}>{item.value}</div>
          </div>
        ))}
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height: '88px', display: 'block' }} />
    </div>
  )

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Live Market Rates</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>Kalinga Kawad · Ambicaa · Aamlin Spot</span>
            <span style={{ color: t.border2 }}>·</span>
            <span style={{ color: marketOpen ? t.green : t.orange }}>
              {marketOpen ? '● Market Open' : '○ Market Closed'} (9AM–7PM IST, Mon–Fri)
            </span>
            {lastFetch && <span style={{ color: t.text4 }}>· Updated {fmtTime(lastFetch)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {fetchError && <span style={{ fontSize: '11px', color: t.red }}>⚠ {fetchError}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '20px', background: `${marketOpen ? t.green : t.orange}15`, border: `1px solid ${marketOpen ? t.green : t.orange}35` }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: marketOpen ? t.green : t.orange, display: 'inline-block' }} />
            <span style={{ fontSize: '11px', color: marketOpen ? t.green : t.orange, fontWeight: 600 }}>Live · {countdown}s</span>
          </div>
          <button onClick={handleRefresh} disabled={fetching}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: fetching ? 'not-allowed' : 'pointer', opacity: fetching ? .6 : 1, display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ display: 'inline-block', animation: fetching ? 'spin 1s linear infinite' : 'none' }}>⟳</span>
            {fetching ? 'Fetching...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Ticker Bar */}
      {latest && (
        <div style={{ ...card, padding: '10px 18px', background: t.card2, display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
          {[
            { label: 'KALINGA KAWAD', rate: latest.kalinga_sell_rate, change: kStat.change, color: t.gold },
            { label: 'AMBICAA',       rate: latest.ambica_sell_rate,  change: aStat.change, color: t.blue },
            { label: 'AAMLIN SPOT',   rate: latest.aamlin_sell_rate,  change: mStat.change, color: t.purple },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em' }}>{item.label}</span>
              <span style={{ fontSize: '15px', fontWeight: 600, color: item.color, fontFamily: 'monospace' }}>{fmt(item.rate)}</span>
              {item.change !== 0 && (
                <span style={{ fontSize: '11px', color: cc(item.change, t), fontWeight: 600 }}>
                  {ci(item.change)} {Math.abs(item.change).toLocaleString('en-IN')}
                </span>
              )}
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '20px', alignItems: 'center' }}>
            {spread_ka != null && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: t.text4 }}>K−A</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: t.orange, fontFamily: 'monospace' }}>{spread_ka > 0 ? '+' : ''}{spread_ka.toLocaleString('en-IN')}</span>
              </div>
            )}
            {spread_km != null && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: t.text4 }}>K−M</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: t.purple, fontFamily: 'monospace' }}>{spread_km > 0 ? '+' : ''}{spread_km.toLocaleString('en-IN')}</span>
              </div>
            )}
            <span style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace' }}>{fmtTime(latest.fetched_at)}</span>
          </div>
        </div>
      )}

      {/* Three Rate Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <RateCard label="Kalinga Kawad"    sub="GOLD 999 IMP WITH GST FOR REF" rate={latest?.kalinga_sell_rate} s={kStat} color={t.gold}   canvasRef={kRef} />
        <RateCard label="Ambicaa Sales Corpn" sub="IND-GOLD[999]-1KG today"   rate={latest?.ambica_sell_rate}  s={aStat} color={t.blue}   canvasRef={aRef} />
        <RateCard label="Aamlin Spot"      sub="Gold 999 IND"                  rate={latest?.aamlin_sell_rate}  s={mStat} color={t.purple} canvasRef={mRef} />
      </div>

      {/* Today's Combined Chart */}
      <div style={{ ...card, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>
            Today's Rate Movement
            <span style={{ marginLeft: '8px', fontWeight: 400, color: t.text4 }}>{todayRates.length} data points</span>
          </div>
          <div style={{ display: 'flex', gap: '14px' }}>
            {[{ color: t.gold, label: 'Kalinga' }, { color: t.blue, label: 'Ambicaa' }, { color: t.purple, label: 'Aamlin' }].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '14px', height: '2px', background: l.color, borderRadius: '1px' }} />
                <span style={{ fontSize: '11px', color: t.text3 }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
        {todayRates.length >= 2
          ? <canvas ref={tRef} style={{ width: '100%', height: '190px', display: 'block' }} />
          : <div style={{ height: '190px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '12px' }}>Accumulating data — chart appears after a few minutes</div>
        }
      </div>

      {/* History Table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Rate History — Today</div>
          <div style={{ fontSize: '11px', color: t.text4 }}>{todayRates.length} snapshots</div>
        </div>
        <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {['Time', 'Kalinga Kawad', 'Δ', 'Ambicaa', 'Δ', 'Aamlin', 'Δ', 'K−A', 'K−M'].map((h, i) => (
                  <th key={h+i} style={{ padding: '7px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: i === 0 ? 'left' : 'right', background: t.card2, borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...todayRates].reverse().map((row, i, arr) => {
                const pr  = arr[i + 1]
                const kC  = pr?.kalinga_sell_rate ? row.kalinga_sell_rate - pr.kalinga_sell_rate : null
                const aC  = pr?.ambica_sell_rate  ? row.ambica_sell_rate  - pr.ambica_sell_rate  : null
                const mC  = pr?.aamlin_sell_rate  ? row.aamlin_sell_rate  - pr.aamlin_sell_rate  : null
                const ska = row.kalinga_sell_rate && row.ambica_sell_rate ? row.kalinga_sell_rate - row.ambica_sell_rate : null
                const skm = row.kalinga_sell_rate && row.aamlin_sell_rate ? row.kalinga_sell_rate - row.aamlin_sell_rate : null
                return (
                  <tr key={row.id} style={{ borderBottom: `1px solid ${t.border}15`, transition: 'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '7px 12px', fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>{fmtTime(row.fetched_at)}</td>
                    <td style={{ padding: '7px 12px', fontSize: '12px', color: t.gold,   textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(row.kalinga_sell_rate)}</td>
                    <td style={{ padding: '7px 12px', fontSize: '11px', color: kC != null ? cc(kC, t) : t.text4, textAlign: 'right', fontFamily: 'monospace' }}>{kC != null ? fmtChg(kC) : '—'}</td>
                    <td style={{ padding: '7px 12px', fontSize: '12px', color: t.blue,   textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(row.ambica_sell_rate)}</td>
                    <td style={{ padding: '7px 12px', fontSize: '11px', color: aC != null ? cc(aC, t) : t.text4, textAlign: 'right', fontFamily: 'monospace' }}>{aC != null ? fmtChg(aC) : '—'}</td>
                    <td style={{ padding: '7px 12px', fontSize: '12px', color: t.purple, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(row.aamlin_sell_rate)}</td>
                    <td style={{ padding: '7px 12px', fontSize: '11px', color: mC != null ? cc(mC, t) : t.text4, textAlign: 'right', fontFamily: 'monospace' }}>{mC != null ? fmtChg(mC) : '—'}</td>
                    <td style={{ padding: '7px 12px', fontSize: '11px', color: t.orange, textAlign: 'right', fontFamily: 'monospace' }}>{ska != null ? fmtChg(ska) : '—'}</td>
                    <td style={{ padding: '7px 12px', fontSize: '11px', color: t.purple, textAlign: 'right', fontFamily: 'monospace' }}>{skm != null ? fmtChg(skm) : '—'}</td>
                  </tr>
                )
              })}
              {todayRates.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '28px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No data yet — rates populate every minute during market hours (9AM–7PM IST)</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}