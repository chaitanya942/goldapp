'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

// Purity bands as stored in the NEW-CRM GoldRate table. Labels mirror the DB
// semantics (karat bands) — no invented buckets.
const BANDS = [
  { key: 'rate_24k',    label: '24K',      sub: '99.9%',   primary: false },
  { key: 'rate_22k',    label: '22K',      sub: '91.6%',   primary: true  },
  { key: 'rate_17_21k', label: '17–21K',   sub: '71–87%',  primary: false },
  { key: 'rate_14_17k', label: '14–17K',   sub: '58–71%',  primary: false },
]

const fmt = (n) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)))
  ? '—'
  : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })

function fmtWhen(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  } catch { return null }
}

export default function LiveRates() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [rates,   setRates]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const r = await authedFetch('/api/purchases/live-rates')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load rates')
      setRates(Array.isArray(j.rates) ? j.rates : [])
      setFetchedAt(j.fetched_at || null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>Live Gold Rates</div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: t.gold, background: `${t.gold}15`, borderRadius: 20, padding: '3px 10px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.gold, display: 'inline-block' }} />
              per gram · ₹
            </span>
          </div>
          <div style={{ fontSize: 11, color: t.text3, marginTop: 4 }}>
            Buying rates by state — the rate operations set in the CRM, applied to every estimation.
            {fetchedAt && <span style={{ color: t.text4 }}>{' '}· fetched {fmtWhen(fetchedAt)}</span>}
          </div>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 12, color: t.text2, cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
          <span style={{ display: 'inline-block', animation: loading ? 'lr-spin 1s linear infinite' : 'none', fontSize: 13 }}>⟳</span>
          Refresh
        </button>
      </div>

      {/* ── States ── */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: t.text3, fontSize: 13 }}>Loading live rates…</div>
      ) : error ? (
        <div style={{ ...cardStyle(t), padding: '20px 24px', borderColor: `${t.red}55`, background: `${t.red}08` }}>
          <div style={{ fontSize: 13, color: t.red, fontWeight: 700, marginBottom: 6 }}>Could not load live rates</div>
          <div style={{ fontSize: 12, color: t.text2 }}>{error}</div>
          <button onClick={() => load()} style={{ marginTop: 12, background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '6px 14px', fontSize: 11, color: t.text2, cursor: 'pointer' }}>Retry</button>
        </div>
      ) : rates.length === 0 ? (
        <div style={{ ...cardStyle(t), padding: 40, textAlign: 'center', color: t.text3, fontSize: 13 }}>No rates configured in the CRM yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {rates.map((r, i) => {
            const when = fmtWhen(r.updated_at)
            return (
              <div key={r.state || i} style={{ ...cardStyle(t), padding: '16px 18px 6px', overflow: 'hidden' }}>
                {/* State header */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: t.text1, letterSpacing: '.01em' }}>{r.state || '—'}</span>
                    {r.code && <span style={{ fontSize: 10, fontWeight: 700, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>{r.code}</span>}
                  </div>
                  {r.is_offline && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: t.orange || '#d98a00', background: `${t.orange || '#d98a00'}18`, borderRadius: 20, padding: '2px 8px', letterSpacing: '.04em', textTransform: 'uppercase' }}>Offline</span>
                  )}
                </div>

                {/* Purity rows */}
                {BANDS.map(b => {
                  const val = r[b.key]
                  const has = val !== null && val !== undefined && Number(val) > 0
                  return (
                    <div key={b.key} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 12px', marginBottom: 6, borderRadius: 9,
                      background: b.primary ? `${t.gold}12` : t.card2,
                      border: `1px solid ${b.primary ? `${t.gold}33` : t.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: b.primary ? t.gold : t.text2, letterSpacing: '.02em' }}>{b.label}</span>
                        <span style={{ fontSize: 9.5, color: t.text4 }}>{b.sub}</span>
                      </div>
                      <div style={{ fontSize: b.primary ? 16 : 14, fontWeight: 800, color: has ? t.text1 : t.text4, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
                        {has && <span style={{ fontSize: 11, color: t.text4, fontWeight: 600, marginRight: 1 }}>₹</span>}
                        {fmt(val)}
                        {has && <span style={{ fontSize: 9.5, color: t.text4, fontWeight: 600 }}>/g</span>}
                      </div>
                    </div>
                  )
                })}

                {/* Footer: margin (only when set) + source date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 2px 6px', borderTop: `1px solid ${t.border}`, marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: t.text4 }}>
                    {Number(r.margin_24k) ? <>margin <b style={{ color: t.text3, fontFamily: 'monospace' }}>₹{fmt(r.margin_24k)}</b></> : <span style={{ color: t.text4 }}>from CRM GoldRate</span>}
                  </span>
                  {when && <span style={{ fontSize: 10, color: t.text4 }}>CRM · {when}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`@keyframes lr-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function cardStyle(t) {
  return { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14 }
}
