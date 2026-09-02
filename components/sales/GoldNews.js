'use client'

// components/sales/GoldNews.js
// Read-only Gold News screen (V1). Lives under Sales, alongside Cal Table and
// Live Market Rates. Reads ONLY from /api/gold-news (a standalone route backed
// by an external news provider). No Supabase, CRM, consignment or cron coupling.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', goldDim: '#c9a84c22', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e0d9cc', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', goldDim: '#9a722822', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a' },
}

// Category chips — ids match the server's CATEGORIES keys in /api/gold-news.
const CATEGORIES = [
  { id: 'latest',        label: 'Latest' },
  { id: 'india',         label: 'India' },
  { id: 'global',        label: 'Global' },
  { id: 'fed_macro',     label: 'Fed & Macro' },
  { id: 'central_banks', label: 'Central Banks' },
  { id: 'recycling',     label: 'Gold Recycling' },
]

function timeAgo(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function fmtPublished(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const ERROR_COPY = {
  not_configured: 'Gold News is not configured yet. A GOLD_NEWS_API_KEY must be set on the server to enable this feed.',
  rate_limited:   'The news provider is rate-limited right now. Please try again in a few minutes.',
  provider_error: 'Could not reach the news provider. Please try again shortly.',
}

export default function GoldNews() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [category, setCategory] = useState('latest')
  // Per-category cache so switching chips shows instantly and background
  // refresh never blanks the screen (stale-while-revalidate).
  const cacheRef = useRef({}) // { [cat]: { articles, updated_at, error } }
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [nowTick, setNowTick] = useState(0)
  const reqId = useRef(0)

  const load = useCallback(async (cat, { silent = false } = {}) => {
    const id = ++reqId.current
    if (!silent && !cacheRef.current[cat]) setLoading(true)
    try {
      const res = await authedFetch(`/api/gold-news?category=${encodeURIComponent(cat)}`)
      const json = await res.json()
      if (id !== reqId.current) return // a newer request superseded this one
      cacheRef.current[cat] = json
      setPayload(json)
    } catch {
      if (id !== reqId.current) return
      // Network-level failure — surface a graceful error, keep any prior cache.
      const prev = cacheRef.current[cat]
      setPayload(prev || { articles: [], updated_at: null, error: 'provider_error' })
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  // Load on category change — paint cache immediately, then revalidate.
  useEffect(() => {
    const cached = cacheRef.current[category]
    if (cached) { setPayload(cached); setLoading(false); load(category, { silent: true }) }
    else load(category)
  }, [category, load])

  // Re-tick "updated X ago" every 30s without refetching.
  useEffect(() => {
    const iv = setInterval(() => setNowTick(n => n + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  const articles = payload?.articles || []
  const error    = payload?.error || null
  const updatedAt = payload?.updated_at || null

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>Gold News</h1>
          <p style={{ margin: '4px 0 0', fontSize: '.82rem', color: t.text3 }}>Latest developments affecting gold markets</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {updatedAt && (
            <span
              title={new Date(updatedAt).toLocaleString('en-IN')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.68rem', color: t.text3, background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 20, padding: '4px 10px' }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.green, boxShadow: `0 0 6px ${t.green}` }} />
              Updated {timeAgo(updatedAt)}{/* nowTick forces re-render */}<span style={{ display: 'none' }}>{nowTick}</span>
            </span>
          )}
          <button
            onClick={() => load(category, { silent: false })}
            style={{ fontSize: '.72rem', color: t.text2, background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Category chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {CATEGORIES.map(c => {
          const active = c.id === category
          return (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              style={{
                fontSize: '.74rem', fontWeight: active ? 600 : 400,
                color: active ? (theme === 'dark' ? '#1a0a00' : '#fff') : t.text2,
                background: active ? t.gold : t.card2,
                border: `1px solid ${active ? t.gold : t.border2}`,
                borderRadius: 20, padding: '6px 14px', cursor: 'pointer', transition: 'all .15s',
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {/* Body */}
      {loading && articles.length === 0 ? (
        <SkeletonList t={t} />
      ) : articles.length === 0 ? (
        <EmptyState t={t} error={error} onRetry={() => load(category, { silent: false })} />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {payload?.stale && (
            <div style={{ fontSize: '.68rem', color: t.text3, background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 8, padding: '6px 10px' }}>
              Showing the last successful update — the provider is temporarily unavailable.
            </div>
          )}
          {articles.map(a => <NewsCard key={a.id} a={a} t={t} categoryLabel={CATEGORIES.find(c => c.id === category)?.label} />)}
        </div>
      )}
    </div>
  )
}

function NewsCard({ a, t, categoryLabel }) {
  const Wrapper = a.url ? 'a' : 'div'
  const wrapperProps = a.url ? { href: a.url, target: '_blank', rel: 'noopener noreferrer' } : {}
  return (
    <Wrapper
      {...wrapperProps}
      style={{
        display: 'block', textDecoration: 'none',
        background: t.card, border: `1px solid ${t.border}`, borderRadius: 12,
        padding: 16, transition: 'border-color .15s, transform .15s', cursor: a.url ? 'pointer' : 'default',
      }}
      onMouseEnter={e => { if (a.url) e.currentTarget.style.borderColor = t.gold }}
      onMouseLeave={e => { if (a.url) e.currentTarget.style.borderColor = t.border }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {a.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={a.image} alt=""
            style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: `1px solid ${t.border2}` }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.62rem', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: t.gold, background: t.goldDim, borderRadius: 5, padding: '2px 7px' }}>
              {categoryLabel || 'News'}
            </span>
            <span style={{ fontSize: '.68rem', color: t.text3 }}>{a.source}</span>
            {a.published_at && <span style={{ fontSize: '.68rem', color: t.text4 }}>· {fmtPublished(a.published_at)}</span>}
          </div>
          <div style={{ fontSize: '.95rem', fontWeight: 600, color: t.text1, lineHeight: 1.35, marginBottom: 5 }}>{a.title}</div>
          {a.description && (
            <div style={{ fontSize: '.8rem', color: t.text2, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {a.description}
            </div>
          )}
          {a.url && <div style={{ fontSize: '.68rem', color: t.blue, marginTop: 8 }}>Read full article ↗</div>}
        </div>
      </div>
    </Wrapper>
  )
}

function SkeletonList({ t }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: 16, display: 'flex', gap: 14 }}>
          <div style={{ width: 92, height: 92, borderRadius: 8, background: t.card2, flexShrink: 0, animation: 'goldNewsPulse 1.4s ease-in-out infinite' }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 10, width: '30%', borderRadius: 4, background: t.card2, marginBottom: 10, animation: 'goldNewsPulse 1.4s ease-in-out infinite' }} />
            <div style={{ height: 14, width: '85%', borderRadius: 4, background: t.card2, marginBottom: 8, animation: 'goldNewsPulse 1.4s ease-in-out infinite' }} />
            <div style={{ height: 10, width: '70%', borderRadius: 4, background: t.card2, animation: 'goldNewsPulse 1.4s ease-in-out infinite' }} />
          </div>
        </div>
      ))}
      <style>{`@keyframes goldNewsPulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }`}</style>
    </div>
  )
}

function EmptyState({ t, error, onRetry }) {
  const msg = error ? (ERROR_COPY[error] || ERROR_COPY.provider_error) : 'No news found for this category right now.'
  return (
    <div style={{ textAlign: 'center', padding: '56px 24px', background: t.card, border: `1px dashed ${t.border2}`, borderRadius: 12 }}>
      <div style={{ fontSize: '2rem', opacity: 0.4, marginBottom: 10 }}>📰</div>
      <div style={{ fontSize: '.85rem', color: t.text2, maxWidth: 420, margin: '0 auto 14px', lineHeight: 1.5 }}>{msg}</div>
      <button
        onClick={onRetry}
        style={{ fontSize: '.74rem', color: t.text1, background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  )
}
