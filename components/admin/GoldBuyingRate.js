'use client'

// GoldBuyingRate — admin submodule showing the latest live buying rates per
// state from the new-CRM `GoldRate` table. Designed as ops's at-a-glance
// reference: large prominent 22k/24k numbers, per-state cards, freshness
// indicator turning amber/red if the feeder stalls.
//
// Data source: GET /api/gold-rates (cached 15s server-side). Polls every 30s
// client-side; that combined with the cache means the UI is at most ~15s
// behind the new CRM feeder.

import { useState, useEffect, useRef } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

const REGION_ICONS = {
  'Karnataka':       '🏛',
  'Kerala':          '🌴',
  'Andhra Pradesh':  '🌊',
  'Telangana':       '🌆',
}
const REGION_ACCENT = {
  'Karnataka':       '#c9a84c',
  'Kerala':          '#3aaa6a',
  'Andhra Pradesh':  '#3a8fbf',
  'Telangana':       '#8c5ac8',
}

const REFRESH_SECS = 30

const fmtINR = (n) => {
  const num = Number(n) || 0
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const fmtINRRound = (n) => {
  const num = Number(n) || 0
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}
const fmtAge = (ms) => {
  if (ms < 60_000)         return `${Math.floor(ms / 1000)}s ago`
  if (ms < 60 * 60_000)    return `${Math.floor(ms / 60_000)}m ago`
  return `${Math.floor(ms / (60 * 60_000))}h ago`
}

export default function GoldBuyingRate() {
  const { theme } = useApp()
  const dark = theme === 'dark'

  // Theme tokens — match the project's palette so this page sits naturally
  // alongside the rest of the admin module.
  const t = dark ? {
    bg: '#0a0a0a', panel: '#141210', panel2: '#1a1612', border: '#2a2520',
    text1: '#f0e6c8', text2: '#c8b890', text3: '#7a6a4a', text4: '#5a4a2a',
    gold: '#c9a84c', goldDim: 'rgba(201,168,76,.12)',
    green: '#3aaa6a', orange: '#e58a3b', red: '#e05555',
  } : {
    bg: '#f5f0e8', panel: '#fffdf7', panel2: '#f8f3e6', border: '#e0d8c4',
    text1: '#1a1208', text2: '#3a2e18', text3: '#7a6a4a', text4: '#a09070',
    gold: '#9a7228', goldDim: 'rgba(154,114,40,.12)',
    green: '#2a8a4a', orange: '#c56a1a', red: '#c54545',
  }

  const [rates,       setRates]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error,       setError]       = useState(null)
  const [nowTick,     setNowTick]     = useState(0)   // 1s tick to drive age counters
  const timerRef = useRef(null)

  const load = async () => {
    try {
      const res  = await authedFetch('/api/gold-rates')
      const json = await res.json()
      if (json.error) {
        setError(json.error)
      } else {
        setRates(json.rates || [])
        setLastUpdated(new Date())
        setError(null)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, REFRESH_SECS * 1000)
    return () => clearInterval(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick every second so the per-card freshness counters advance smoothly
  // and the colour flips the moment a row goes stale.
  useEffect(() => {
    const id = setInterval(() => setNowTick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Overall page-level "last polled" — separate from per-rate "last updated
  // by feeder", because those are different concepts.
  const pollAge = lastUpdated ? Date.now() - lastUpdated.getTime() : null
  const pollLabel = !lastUpdated
    ? 'loading…'
    : pollAge < 5_000 ? 'just now'
    : `${Math.floor(pollAge / 1000)}s ago`

  // Sort: canonical region order (matches the rest of the app).
  const REGION_ORDER = ['Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana']
  const sortedRates = [...rates].sort((a, b) => {
    const ai = REGION_ORDER.indexOf(a.state)
    const bi = REGION_ORDER.indexOf(b.state)
    if (ai === -1 && bi === -1) return (a.state || '').localeCompare(b.state || '')
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return (
    <div style={{ padding: '24px 22px 60px', minHeight: '100vh', background: t.bg }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>
              Gold Buying Rate
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: t.green, background: `${t.green}15`, border: `1px solid ${t.green}30`, borderRadius: 20, padding: '3px 10px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.green, display: 'inline-block', animation: 'gbrPulse 1.8s infinite' }}/>
              Live
            </span>
          </div>
          <div style={{ fontSize: 12, color: t.text3, marginTop: 6 }}>
            Latest buying rate per state · Source: New CRM · Refreshes every {REFRESH_SECS}s
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: t.text4 }}>Updated <span style={{ color: t.text2, fontVariantNumeric: 'tabular-nums' }}>{pollLabel}</span></span>
          <button
            onClick={load}
            disabled={loading}
            style={{
              background: loading ? t.panel2 : `${t.gold}15`,
              border: `1px solid ${loading ? t.border : t.gold}40`,
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12,
              color: loading ? t.text4 : t.gold,
              cursor: loading ? 'default' : 'pointer',
              fontWeight: 600,
              transition: 'all .15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            <span style={{ display: 'inline-block', animation: loading ? 'gbrSpin 1s linear infinite' : 'none', fontSize: 13 }}>⟳</span>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderLeft: `4px solid ${t.red}`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: t.red, fontSize: 13 }}>
          <strong>Couldn't load rates:</strong> {error}
        </div>
      )}

      {/* ── Rate cards grid ───────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 18,
      }}>
        {loading && rates.length === 0
          ? [0, 1, 2, 3].map(i => <SkeletonCard key={i} t={t} delay={i * 80}/>)
          : sortedRates.length === 0 && !error
            ? <EmptyState t={t} />
            : sortedRates.map((r, idx) => (
                <RateCard key={r.state_id || idx} rate={r} t={t} delay={idx * 90} nowTick={nowTick}/>
              ))
        }
      </div>

      <style>{`
        @keyframes gbrPulse  { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: .4; transform: scale(1.5) } }
        @keyframes gbrSpin   { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        @keyframes gbrCardIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes gbrShimmer{ 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
      `}</style>
    </div>
  )
}

// ── Per-state rate card ───────────────────────────────────────────────────
function RateCard({ rate, t, delay, nowTick }) {  // eslint-disable-line no-unused-vars
  // nowTick is referenced just to make React re-render every second so the
  // age label and stale-color update without waiting on parent state changes.
  const accent = REGION_ACCENT[rate.state] || t.gold
  const icon   = REGION_ICONS[rate.state]  || '📍'

  const ageMs   = rate.created_at ? Date.now() - new Date(rate.created_at).getTime() : null
  const fresh   = ageMs != null && ageMs < 5 * 60_000
  const stale   = ageMs != null && ageMs > 30 * 60_000
  const ageColor = stale ? t.red : fresh ? t.green : t.orange
  const ageLabel = ageMs != null ? fmtAge(ageMs) : '—'

  return (
    <div style={{
      background: `linear-gradient(155deg, ${t.panel} 0%, ${t.panel2} 100%)`,
      border: `1px solid ${t.border}`,
      borderTop: `3px solid ${accent}`,
      borderRadius: 14,
      padding: '22px 22px 18px',
      position: 'relative',
      overflow: 'hidden',
      animation: `gbrCardIn .4s cubic-bezier(.34,1.2,.64,1) ${delay}ms backwards`,
      boxShadow: '0 1px 3px rgba(0,0,0,.18)',
    }}>
      {/* Soft accent glow in the top-right corner */}
      <div aria-hidden style={{
        position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}18 0%, transparent 70%)`, pointerEvents: 'none',
      }}/>

      {/* Header: state + freshness */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <div style={{ fontSize: 13, color: t.text1, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
            {rate.state || rate.state_id || 'Unknown'}
          </div>
        </div>
        <div title={`Feeder last wrote ${ageLabel}`} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: ageColor, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ageColor, boxShadow: fresh ? `0 0 6px ${ageColor}` : 'none' }}/>
          {ageLabel}
        </div>
      </div>

      {/* Main: 22K and 24K side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16, position: 'relative' }}>
        <RateBlock label="22 Karat" value={rate.rate_22k} margin={rate.margin_22k} accent={accent} t={t} primary/>
        <RateBlock label="24 Karat" value={rate.rate_24k} margin={rate.margin_24k} accent={accent} t={t}/>
      </div>

      {/* Sub-rates: lower-purity bands */}
      <div style={{ display: 'flex', gap: 14, paddingTop: 14, borderTop: `1px solid ${t.border}`, fontSize: 11, color: t.text3, flexWrap: 'wrap' }}>
        <SubRate label="17–21 K" value={rate.rate_17_21k} t={t}/>
        <SubRate label="14–17 K" value={rate.rate_14_17k} t={t}/>
      </div>
    </div>
  )
}

// Big rate block (22K or 24K)
function RateBlock({ label, value, margin, accent, t, primary }) {
  const showMargin = margin && margin !== 0
  return (
    <div>
      <div style={{ fontSize: 10, color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: primary ? 26 : 22,
        fontWeight: 300,
        color: accent,
        fontFamily: 'monospace',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-.02em',
        lineHeight: 1.05,
      }}>
        {fmtINR(value)}
      </div>
      <div style={{ fontSize: 10, color: t.text4, marginTop: 4 }}>
        per gram{showMargin ? ` · margin ${margin > 0 ? '+' : ''}${fmtINRRound(margin)}` : ''}
      </div>
    </div>
  )
}

function SubRate({ label, value, t }) {
  if (!value || value === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: t.text4 }}>{label}</span>
      <span style={{ color: t.text2, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>{fmtINRRound(value)}</span>
    </div>
  )
}

function SkeletonCard({ t, delay }) {
  return (
    <div style={{
      background: t.panel, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: '22px', minHeight: 200,
      animation: `gbrCardIn .35s ease ${delay}ms backwards`,
    }}>
      {[60, 30, 80, 50].map((w, i) => (
        <div key={i} style={{
          height: i === 1 ? 28 : 14, width: `${w}%`, marginBottom: 12,
          background: `linear-gradient(90deg, ${t.border} 0%, ${t.panel2} 50%, ${t.border} 100%)`,
          backgroundSize: '200% 100%',
          animation: 'gbrShimmer 1.5s infinite',
          borderRadius: 4,
        }}/>
      ))}
    </div>
  )
}

function EmptyState({ t }) {
  return (
    <div style={{ gridColumn: '1 / -1', padding: '60px 20px', textAlign: 'center', color: t.text4 }}>
      <div style={{ fontSize: 36, opacity: .3, marginBottom: 12 }}>⚖️</div>
      <div style={{ fontSize: 14, color: t.text3 }}>No rates available right now.</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>The new-CRM rate feeder may not be running.</div>
    </div>
  )
}
