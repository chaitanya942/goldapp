'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import { useAamlinRate } from '../../hooks/useAamlinRate'

/* ───────────────────────────────────────────── */
const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

/* ───────────────────────────────────────────── */
const fmt     = n => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtTime = d => d ? new Date(d).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'
const fmtChg  = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('en-IN')}`
const cc      = (v, t) => v > 0 ? t.green : v < 0 ? t.red : t.text3
const ci      = v => v > 0 ? '▲' : v < 0 ? '▼' : '—'

/* ───────────────────────────────────────────── */
function isMarketOpen() {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay()
  const minutes = ist.getHours() * 60 + ist.getMinutes()
  return day >= 1 && day <= 5 && minutes >= 540 && minutes < 1140
}

/* ───────────────────────────────────────────── */
function drawChart(canvas, data, fields, colors, theme) {
  if (!canvas || data.length < 2) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1

  const W = canvas.offsetWidth * dpr
  const H = canvas.offsetHeight * dpr

  canvas.width = W
  canvas.height = H

  ctx.scale(dpr, dpr)

  const width = canvas.offsetWidth
  const height = canvas.offsetHeight

  const values = fields.flatMap(f =>
    data.filter(d => d[f] != null).map(d => d[f])
  )

  if (values.length < 2) {
    ctx.clearRect(0, 0, width, height)
    return
  }

  const min = Math.min(...values) - 30
  const max = Math.max(...values) + 30
  const range = max - min || 1

  const times = data.map(d => new Date(d.fetched_at).getTime())
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const tRange = maxT - minT || 1

  const pad = { top: 12, bottom: 24, left: 64, right: 10 }
  const cW = width - pad.left - pad.right
  const cH = height - pad.top - pad.bottom

  ctx.clearRect(0, 0, width, height)

  const getXY = (d, field) => ({
    x: pad.left + ((new Date(d.fetched_at).getTime() - minT) / tRange) * cW,
    y: pad.top + ((max - d[field]) / range) * cH,
  })

  fields.forEach((field, i) => {
    const color = colors[i]
    const valid = data.filter(d => d[field] != null)
    if (valid.length < 2) return

    ctx.beginPath()
    valid.forEach((d, idx) => {
      const { x, y } = getXY(d, field)
      idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
  })
}

/* ───────────────────────────────────────────── */
export default function LiveMarketRates() {

  /* SAFE THEME */
  let theme = 'dark'
  try { theme = useApp()?.theme || 'dark' } catch {}

  const t = THEMES[theme] || THEMES.dark

  /* SAFE AAMLIN */
  let aamlinLive = null
  let aamlinLiveStatus = 'error'
  try {
    const res = useAamlinRate()
    aamlinLive = res?.rate ?? null
    aamlinLiveStatus = res?.status ?? 'error'
  } catch {}

  const [rates, setRates] = useState([])
  const [todayRates, setTodayRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [fetchError, setFetchError] = useState(null)

  const kRef = useRef(null)
  const aRef = useRef(null)
  const mRef = useRef(null)
  const tRef = useRef(null)

  /* ───────────────────────────────────────────── */
  const fetchRates = useCallback(async () => {
    setFetching(true)
    setFetchError(null)

    try {
      const since60 = new Date(Date.now() - 3600000).toISOString()
      const todayStart = new Date()
      todayStart.setHours(0,0,0,0)

      const [r1, r2] = await Promise.all([
        supabase.from('gold_rates').select('*').gte('fetched_at', since60).order('fetched_at', { ascending: true }),
        supabase.from('gold_rates').select('*').gte('fetched_at', todayStart.toISOString()).order('fetched_at', { ascending: true }),
      ])

      if (r1.error) throw r1.error

      setRates(r1.data || [])
      setTodayRates(r2.data || [])
      setLastFetch(new Date())

    } catch (err) {
      setFetchError(err.message)
    } finally {
      setLoading(false)
      setFetching(false)
    }
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
    if (rates.length >= 2) {
      drawChart(kRef.current, rates, ['kalinga_sell_rate'], [t.gold], theme)
      drawChart(aRef.current, rates, ['ambica_sell_rate'], [t.blue], theme)
      drawChart(mRef.current, rates, ['aamlin_sell_rate'], [t.purple], theme)
    }
    if (todayRates.length >= 2) {
      drawChart(tRef.current, todayRates,
        ['kalinga_sell_rate','ambica_sell_rate','aamlin_sell_rate'],
        [t.gold, t.blue, t.purple],
        theme)
    }
  }, [rates, todayRates, theme])

  /* ───────────────────────────────────────────── */
  const latest = rates[rates.length - 1] || null

  return (
    <div style={{ padding: 20, background: t.bg, color: t.text1 }}>
      <h2>Live Market Rates</h2>

      {fetchError && <p style={{ color: t.red }}>⚠ {fetchError}</p>}

      <button onClick={handleRefresh}>
        {fetching ? 'Fetching...' : 'Refresh'}
      </button>

      {latest && (
        <div style={{ marginTop: 20 }}>
          <p>Kalinga: ₹ {fmt(latest.kalinga_sell_rate)}</p>
          <p>Ambica: ₹ {fmt(latest.ambica_sell_rate)}</p>
          <p>Aamlin: ₹ {fmt(latest.aamlin_sell_rate)}</p>
          <p>{fmtTime(latest.fetched_at)}</p>
        </div>
      )}

      <canvas ref={tRef} style={{ width: '100%', height: 200 }} />

    </div>
  )
}