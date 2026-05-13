'use client'

// LiveFeedFlashcards — at-a-glance today's live feed snapshot for the
// dashboards. Three KPI tiles for management: walk-ins (count + weight),
// purchases (count + weight), and walk-in → purchase conversion %.
//
// Data source matches the Live Feed page so the numbers stay coherent.
// Auto-refreshes every 30s when mounted. Mobile-first: 3-column compact
// grid that comfortably fits a 360px viewport.

import { useState, useEffect, useCallback, useRef } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { istToday } from '../../lib/dateIst'

const REFRESH_SECS = 10

export default function LiveFeedFlashcards({ t, isMobile }) {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const today = istToday()
      const res = await authedFetch(`/api/crm-purchases?action=live&date=${today}`)
      const json = await res.json()
      if (!json.error) {
        setData(json)
        setLastUpdated(new Date())
      }
    } catch {
      // silent — keep the last successful payload visible
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, REFRESH_SECS * 1000)
    return () => clearInterval(timerRef.current)
  }, [load])

  // ── Derived metrics — keep keys aligned with the Live Feed page ──────────
  const walkinCount    = data?.walkinSummary?.total                       || 0
  const walkinWt       = parseFloat(data?.goldPipeline?.walked_in_wt)     || 0
  const purchasedCount = data?.summary?.approved                          || 0
  const purchasedWt    = parseFloat(data?.goldPipeline?.purchased_wt)     || 0
  const conversionPct  = walkinCount > 0 ? Math.round((purchasedCount / walkinCount) * 100) : 0

  const minsAgo = lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 60000) : null
  const liveLabel = !lastUpdated ? 'loading…' : minsAgo === 0 ? 'just now' : `${minsAgo}m ago`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Section label with LIVE indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 2 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${t.green}18`, border: `1px solid ${t.green}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: t.green, animation: 'lfPulse 1.6s infinite' }}/>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>Today's Feed</div>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${t.green}30,transparent)` }}/>
        <span style={{ fontSize: 10, color: t.text4, fontFamily: 'monospace' }} title={`Refreshes every ${REFRESH_SECS}s`}>{liveLabel}</span>
      </div>

      {/* 3-column flashcard grid — comfortably fits 360px+. On very narrow
          viewports (<340px) it'll wrap naturally via the auto-fit min. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(3, minmax(160px, 1fr))',
        gap: isMobile ? 8 : 10,
      }}>
        <FlashCard
          t={t} accent={t.blue}
          label="Walked In"
          value={walkinCount}
          unit={null}
          sub={walkinWt > 0 ? `${fmtWt(walkinWt)} gold` : 'no weight yet'}
          loading={loading && !data}
          isMobile={isMobile}
        />
        <FlashCard
          t={t} accent={t.gold}
          label="Purchased"
          value={purchasedCount}
          unit={null}
          sub={purchasedWt > 0 ? `${fmtWt(purchasedWt)} gold` : '—'}
          loading={loading && !data}
          isMobile={isMobile}
        />
        <FlashCard
          t={t} accent={conversionPct >= 50 ? t.green : conversionPct >= 25 ? t.gold : t.orange || t.red}
          label="Conversion"
          value={conversionPct}
          unit="%"
          sub={walkinCount > 0 ? `${purchasedCount} / ${walkinCount}` : 'awaiting walk-ins'}
          loading={loading && !data}
          isMobile={isMobile}
          progress={Math.min(100, conversionPct)}
        />
      </div>

      <style>{`
        @keyframes lfPulse { 0%, 100% { opacity: 1; transform: scale(1) } 50% { opacity: .4; transform: scale(1.4) } }
        @keyframes lfCountUp { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
    </div>
  )
}

function FlashCard({ t, accent, label, value, unit, sub, loading, isMobile, progress }) {
  const [vis, setVis] = useState(false)
  useEffect(() => { const id = setTimeout(() => setVis(true), 40); return () => clearTimeout(id) }, [])
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: `linear-gradient(155deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
      border: `1px solid ${t.border}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 12,
      padding: isMobile ? '11px 12px' : '14px 16px',
      transition: 'transform .2s ease, box-shadow .2s ease',
    }}>
      {/* Soft corner glow */}
      <div aria-hidden style={{
        position: 'absolute', top: -30, right: -30, width: 90, height: 90, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}15 0%, transparent 70%)`, pointerEvents: 'none',
      }}/>

      <div style={{ fontSize: isMobile ? 9 : 9.5, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: isMobile ? 6 : 8 }}>{label}</div>

      {loading
        ? <div style={{ height: isMobile ? 22 : 28, width: '60%', background: t.border, borderRadius: 4, animation: 'lfPulse 1.4s infinite' }}/>
        : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, animation: 'lfCountUp .35s ease' }}>
            <span style={{
              fontSize: isMobile ? 22 : 26,
              fontWeight: 200,
              color: accent,
              fontFamily: 'monospace',
              lineHeight: 1,
              letterSpacing: '-.02em',
              fontVariantNumeric: 'tabular-nums',
            }}>{value}</span>
            {unit && <span style={{ fontSize: isMobile ? 13 : 14, color: accent, fontWeight: 500, opacity: 0.7 }}>{unit}</span>}
          </div>
        )
      }

      {sub && !loading && (
        <div style={{ fontSize: isMobile ? 9.5 : 10, color: t.text4, marginTop: isMobile ? 5 : 7, lineHeight: 1.35 }}>{sub}</div>
      )}

      {/* Progress bar for the Conversion tile */}
      {progress != null && !loading && (
        <div style={{ marginTop: isMobile ? 6 : 8, height: 3, background: `${accent}15`, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: vis ? `${progress}%` : '0%',
            height: '100%',
            background: `linear-gradient(90deg, ${accent}80, ${accent})`,
            transition: 'width .6s cubic-bezier(.4,0,.2,1)',
            boxShadow: `0 0 6px ${accent}60`,
          }}/>
        </div>
      )}
    </div>
  )
}

// Mini weight formatter — switches to kg above 1000g for compactness.
function fmtWt(g) {
  const n = Number(g || 0)
  if (n >= 1000) return `${(n / 1000).toFixed(2)} kg`
  return `${n.toFixed(0)} g`
}
