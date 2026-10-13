'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useApp, useRegionAccess } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { istToday, istLastWeekRange } from '../../lib/dateIst'
import { getCache, setCache } from '../../lib/moduleCache'
import LiveFeedVisuals from './LiveFeedVisuals'

const REFRESH_SECS = 60

const THEMES = {
  dark: {
    bg: '#080808', surface: '#0f0f0f', card: '#141414', card2: '#1c1c1c',
    border: '#2a2a2a', border2: '#383838',
    text1: '#f5edd8', text2: '#d8c8a0', text3: '#a89870', text4: '#6a5a40',
    gold: '#c9a84c', goldDim: '#c9a84c30',
    green: '#3aaa6a', greenDim: '#3aaa6a20',
    red: '#e05555', redDim: '#e0555520',
    blue: '#4a9fdf', blueDim: '#4a9fdf20',
    orange: '#e09830', orangeDim: '#e0983020',
    purple: '#9a6adf',
  },
  light: {
    bg: '#f0ebe0', surface: '#f8f4ec', card: '#faf7f0', card2: '#ede8dc',
    border: '#ddd5c0', border2: '#ccc5b0',
    text1: '#1a1005', text2: '#3a2a10', text3: '#6a5838', text4: '#8a7858',
    gold: '#9a7228', goldDim: '#9a722820',
    green: '#2a8a52', greenDim: '#2a8a5220',
    red: '#c03030', redDim: '#c0303020',
    blue: '#2a6aaa', blueDim: '#2a6aaa20',
    orange: '#a06820', orangeDim: '#a0682020',
    purple: '#6a3aaa',
  }
}

function fmtDate(d) {
  if (!d) return '—'
  const s = String(d).slice(0, 10)
  const [y, m, day] = s.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day}-${months[parseInt(m) - 1]}-${y}`
}

/* ── Formatters ── */
const fmtAmt = n => n != null ? `\u20b9${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '\u2014'
const fmtNum = n => Number(n || 0).toLocaleString('en-IN')
function fmtTime(t) {
  if (!t) return '\u2014'
  const p = String(t).split(':')
  if (p.length < 2) return t
  const h = parseInt(p[0])
  return `${h % 12 || 12}:${p[1]} ${h >= 12 ? 'PM' : 'AM'}`
}
function fmtWt(g) {
  if (!g && g !== 0) return '\u2014'
  return `${Number(g).toFixed(2)}g`
}

/* ── Ping keyframes (injected once) ── */
const PING_CSS = `
@keyframes ping{75%,100%{transform:scale(2);opacity:0}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulseGlow{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 10px 2px rgba(201,168,76,.18)}}
@keyframes loadBar{0%{transform:translateX(-100%)}60%{transform:translateX(0%)}100%{transform:translateX(100%)}}
@keyframes shimmer{0%{opacity:1}50%{opacity:.55}100%{opacity:1}}
@media(max-width:900px){.ws-item{flex:0 0 33.334%!important;border-bottom:1px solid #2a2a2a}}
@media(max-width:600px){.ws-item{flex:0 0 50%!important}}
.lf-hero>*{flex-shrink:0}
@media(max-width:700px){.lf-hero{padding:16px 8px!important}.sum-bar-item{padding:8px 10px!important}.lf-region{overflow-x:auto}}
@media(max-width:600px){.tl-row{grid-template-columns:70px 28px 1fr!important}.tl-wt,.tl-amt,.tl-hdr-wt,.tl-hdr-amt{display:none!important}}
`

/* ── Tiny reusable components ── */

function SectionLabel({ children, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
      <span style={{ width: 3, height: 14, borderRadius: 2, background: `linear-gradient(180deg, ${t.gold}, ${t.gold}60)`, flexShrink: 0, display: 'block' }} />
      <span style={{ fontSize: '.63rem', letterSpacing: '.15em', textTransform: 'uppercase', color: t.text3, fontWeight: 700 }}>
        {children}
      </span>
    </div>
  )
}

function Card({ children, t, style = {} }) {
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`, borderRadius: 12,
      padding: '18px 20px',
      boxShadow: '0 2px 8px rgba(0,0,0,.12)',
      ...style,
    }}>
      {children}
    </div>
  )
}

function Mono({ children, size = '1.2rem', color, weight = 200, style = {} }) {
  return (
    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: size, fontWeight: weight, color, ...style }}>
      {children}
    </span>
  )
}

/* ── Skeleton placeholder (first load, no cache yet) ── */
function Skel({ t, w = '100%', h = 16, r = 8, style = {} }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: `linear-gradient(90deg, ${t.card} 25%, ${t.card2} 50%, ${t.card} 75%)`,
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite',
      ...style,
    }} />
  )
}

function LiveFeedSkeleton({ t, isMobile }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Skel t={t} h={8} r={100} />
      <Skel t={t} h={isMobile ? 280 : 156} r={16} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[0, 1, 2, 3].map(i => <Skel key={i} t={t} h={74} r={14} style={{ flex: 1, minWidth: 110 }} />)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[0, 1, 2, 3, 4, 5, 6].map(i => <Skel key={i} t={t} h={40} r={8} />)}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════ */
/*                  MAIN COMPONENT                    */
/* ════════════════════════════════════════════════════ */
function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

export default function LiveFeed() {
  const { theme: appTheme, canSee } = useApp()
  const t = THEMES[appTheme] || THEMES.dark
  const isMobile = useMobile()

  const todayIST = istToday()

  const [viewDate,      setViewDate]      = useState(todayIST)
  // 'day' = the single-date picker below (default, live). 'week' = the
  // "Last Week" aggregated view — a Mon–Sun range fetched via from/to
  // instead of a single date. Picking an explicit date always switches
  // back to 'day' so the existing single-day picker stays unchanged.
  const [viewMode,      setViewMode]      = useState('day')
  const [weekRange,     setWeekRange]     = useState(null)   // { from, to } when viewMode === 'week'
  const isToday = viewMode === 'day' && viewDate === todayIST
  const periodLabel = viewMode === 'week' && weekRange
    ? `${fmtDate(weekRange.from)} → ${fmtDate(weekRange.to)}`
    : fmtDate(viewDate)
  const [showVisuals,   setShowVisuals]   = useState(false)
  const regionAccess = useRegionAccess()
  // Default region filter: if user is restricted to a single region, lock to it.
  const [regionFilter,  setRegionFilter]  = useState(regionAccess.single ? regionAccess.regions[0] : '')

  // Pin to allowed region when user is single-region restricted.
  useEffect(() => {
    if (regionAccess.single) setRegionFilter(regionAccess.regions[0])
  }, [regionAccess.single, regionAccess.regions])
  // Seed from the in-memory cache so a re-open paints instantly (stale-while-
  // revalidate) — the load effect still fires a fresh fetch in the background.
  const [data,          setData]          = useState(() => getCache(`livefeed:${todayIST}`) ?? null)
  const [loadError,     setLoadError]     = useState(null)
  const [loading,       setLoading]       = useState(() => !getCache(`livefeed:${todayIST}`))
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [countdown,     setCountdown]     = useState(REFRESH_SECS)

  const timerRef = useRef(null)
  const countRef = useRef(null)
  const prevTlCountRef = useRef(0)
  // Monotonic request id — load() stamps each call and ignores any response
  // whose stamp is stale, so a slow earlier fetch (or a fast date switch)
  // can't overwrite a newer one.
  const loadSeqRef = useRef(0)
  const [newEventCount, setNewEventCount] = useState(0)

  /* ── Load data ── */
  const load = useCallback(async () => {
    const isWeek = viewMode === 'week' && weekRange
    const qs = isWeek ? `from=${weekRange.from}&to=${weekRange.to}` : `date=${viewDate}`
    const cacheKey = isWeek ? `livefeed:week:${weekRange.from}:${weekRange.to}` : `livefeed:${viewDate}`
    const seq = ++loadSeqRef.current
    try {
      setLoading(true)
      setLoadError(null)
      const res = await authedFetch(`/api/crm-purchases?action=live&${qs}`)
      const json = await res.json()
      if (seq !== loadSeqRef.current) return  // superseded by a newer load
      if (json.error) throw new Error(json.error)
      setCache(cacheKey, json)
      setData(json)
      setLastUpdated(new Date())
    } catch (e) {
      if (seq !== loadSeqRef.current) return
      console.error('LiveFeed load error:', e)
      setLoadError(e.message)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [viewDate, viewMode, weekRange])

  /* ── Auto-refresh ── */
  useEffect(() => {
    load()
    if (!isToday) return  // historical dates: no auto-refresh
    timerRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return  // skip backgrounded tabs (heavy 3-DB endpoint)
      load()
    }, REFRESH_SECS * 1000)
    return () => clearInterval(timerRef.current)
  }, [load, isToday])

  useEffect(() => {
    setCountdown(REFRESH_SECS)
    countRef.current = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(countRef.current)
  }, [lastUpdated])

  /* ── New-event detection ── */
  useEffect(() => {
    if (!data) return
    const count = data.newCrmTxns?.length || 0
    const prev = prevTlCountRef.current
    if (prev > 0 && count > prev) setNewEventCount(count - prev)
    prevTlCountRef.current = count
  }, [data])

  /* ── Derived ── */
  const stages = data?.stages || null
  const rawRegions   = data?.allRegions   || []
  // Region scoping: when the user is restricted to specific regions, only show those.
  // When they have just one, the filter row is auto-hidden via the length-check below.
  const regions = regionAccess.restricted
    ? rawRegions.filter(r => regionAccess.regions.includes(r))
    : rawRegions
  // If the active region filter no longer exists in the loaded data (e.g.
  // after switching to a date with different branches), drop back to "All"
  // so the screen doesn't get stuck showing an empty filtered view.
  useEffect(() => {
    if (regionFilter && !regionAccess.single && rawRegions.length && !regions.includes(regionFilter)) {
      setRegionFilter('')
    }
  }, [regionFilter, regionAccess.single, rawRegions.length, regions])
  const newCrmTxns   = data ? (data.newCrmTxns ?? null) : null  // null = offline
  const newCrmCompletedToday = data ? (data.newCrmCompletedToday ?? null) : null  // completed-purchased-today (dashboard basis)
  const newCrmError  = data?.newCrmError || null

  /* ═══ RENDER ═══ */
  return (
    <div style={{ background: t.bg, minHeight: '100vh', color: t.text1, padding: '0 0 40px 0' }}>
      <style>{PING_CSS}</style>

      {/* ── Loading bar (top of screen during refresh) ── */}
      {loading && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 200, overflow: 'hidden', background: 'transparent' }}>
          <div style={{ height: '100%', width: '60%', background: `linear-gradient(90deg, transparent, ${t.gold}, transparent)`, animation: 'loadBar 1.1s ease infinite' }} />
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, background: `${t.bg}f0`,
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: isToday ? `1px solid ${t.border}` : `1px solid ${t.orange}50`,
        boxShadow: isToday ? '0 2px 12px rgba(0,0,0,.15)' : `0 2px 12px ${t.orange}18`,
      }}>
        {/* Row 1: label + tabs + date + refresh. Wraps to a second line
            instead of clipping/overflowing once the toolbar has more
            controls than fit one row (e.g. narrower desktop widths). */}
        <div style={{ padding: isMobile ? '10px 14px' : '11px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: isMobile ? 10 : 16, rowGap: 8 }}>
          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isToday && (
              <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.green, animation: 'ping 1.5s cubic-bezier(0,0,.2,1) infinite', opacity: .6 }} />
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.green }} />
              </span>
            )}
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: isMobile ? '.72rem' : '.82rem', fontWeight: 600, color: t.text1 }}>
              {viewMode === 'week' ? (isMobile ? 'LAST WK' : 'LAST WEEK') : (isMobile ? 'LIVE' : 'LIVE FEED')}
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Date picker — picking an explicit date always drops back to
              single-day mode, even if "Last Week" is currently active. */}
          {canSee('livefeed.date_picker') && (
            <input type="date" value={viewDate}
              onChange={e => { const nd = e.target.value; setViewMode('day'); setWeekRange(null); setViewDate(nd); setRegionFilter(''); setNewEventCount(0); setData(getCache(`livefeed:${nd}`) ?? null) }}
              style={{ background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '5px 8px', fontSize: '.68rem', fontFamily: 'ui-monospace, monospace', outline: 'none', cursor: 'pointer', maxWidth: isMobile ? 130 : 'none' }}
            />
          )}

          {/* Last Week — previous completed Mon–Sun calendar week, aggregated
              into one view (never the current week). Click again to toggle
              back to the single-day picker's current date. */}
          {canSee('livefeed.date_picker') && (
            <button
              onClick={() => {
                if (viewMode === 'week') {
                  setViewMode('day'); setWeekRange(null)
                  setData(getCache(`livefeed:${viewDate}`) ?? null)
                } else {
                  const range = istLastWeekRange()
                  setWeekRange(range); setViewMode('week')
                  setData(getCache(`livefeed:week:${range.from}:${range.to}`) ?? null)
                }
                setRegionFilter(''); setNewEventCount(0)
              }}
              title="Previous completed Monday–Sunday week"
              style={{
                background: viewMode === 'week' ? t.gold : t.card,
                color: viewMode === 'week' ? '#000' : t.text3,
                border: `1px solid ${viewMode === 'week' ? t.gold : t.border}`,
                borderRadius: 6, padding: isMobile ? '5px 8px' : '5px 10px',
                fontSize: '.65rem', fontWeight: viewMode === 'week' ? 700 : 400,
                cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '.02em',
              }}>
              Last Week
            </button>
          )}

          {/* Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {lastUpdated && !isMobile && (
              <span style={{ fontSize: '.58rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>
                {isToday ? `${countdown}s` : 'historical'}
              </span>
            )}
            <button onClick={() => { load(); setCountdown(REFRESH_SECS) }} style={{
              background: t.card, border: `1px solid ${t.border}`, borderRadius: 6,
              padding: isMobile ? '5px 8px' : '5px 10px', fontSize: '.6rem', color: t.text3, cursor: 'pointer',
            }}>
              {isMobile ? '↻' : 'Refresh'}
            </button>
            {/* Visualise toggle — swaps the New-CRM journey into a chart dashboard */}
            {(
              <button onClick={() => setShowVisuals(v => !v)} title="Toggle chart insights" style={{
                background: showVisuals ? t.gold : t.card, border: `1px solid ${showVisuals ? t.gold : t.border}`, borderRadius: 6,
                padding: isMobile ? '5px 8px' : '5px 12px', fontSize: '.6rem', fontWeight: 700,
                color: showVisuals ? '#000' : t.text2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span>📊</span>{!isMobile && (showVisuals ? 'Cards' : 'Visualise')}
              </button>
            )}
          </div>
        </div>

        {/* Row 2 (mobile only): Region filter as scrollable pills */}
        {isMobile && canSee('livefeed.region_filter') && regions.length > 1 && (
          <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            {['', ...regions].map(r => (
              <button key={r || 'all'} onClick={() => setRegionFilter(r)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: '.62rem', cursor: 'pointer', flexShrink: 0,
                border: `1px solid ${regionFilter === r ? t.gold : t.border}`,
                background: regionFilter === r ? `${t.gold}18` : 'transparent',
                color: regionFilter === r ? t.gold : t.text3,
                fontWeight: regionFilter === r ? 600 : 400, transition: 'all .15s', whiteSpace: 'nowrap',
              }}>
                {r || 'All'}
              </button>
            ))}
          </div>
        )}

        {/* Row 2 (desktop): Region filter inline */}
        {!isMobile && canSee('livefeed.region_filter') && regions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 24px 10px' }}>
            <span style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.08em' }}>REGION</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['', ...regions].map(r => (
                <button key={r || 'all'} onClick={() => setRegionFilter(r)} style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: '.62rem', cursor: 'pointer',
                  border: `1px solid ${regionFilter === r ? t.gold : t.border}`,
                  background: regionFilter === r ? `${t.gold}18` : 'transparent',
                  color: regionFilter === r ? t.gold : t.text3,
                  fontWeight: regionFilter === r ? 600 : 400, transition: 'all .15s',
                }}>
                  {r || 'All'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── HISTORICAL BANNER ── */}
      {!isToday && (
        <div style={{
          background: `${t.orange}0d`, borderBottom: `1px solid ${t.orange}30`,
          padding: '8px 28px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: '.75rem', color: t.orange }}>📅</span>
          <span style={{ fontSize: '.68rem', color: t.orange, fontWeight: 600 }}>
            {viewMode === 'week' ? 'Last Week' : 'Historical view'} — {periodLabel}
          </span>
          <span style={{ fontSize: '.62rem', color: t.text4 }}>
            {viewMode === 'week' ? 'Aggregated across the whole week · auto-refresh paused' : 'Auto-refresh paused · showing data as of end of day'}
          </span>
        </div>
      )}

      {/* ── BODY ── */}
      <div style={{ padding: isMobile ? '12px' : '24px 28px' }}>
        {loadError && (
          <div style={{ background: `${t.red}15`, border: `1px solid ${t.red}40`, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: '.72rem', color: t.red, fontFamily: 'ui-monospace, monospace' }}>
            API error: {loadError}
          </div>
        )}
        {loading && !data ? (
          <LiveFeedSkeleton t={t} isMobile={isMobile} />
        ) : (
          <div style={{ opacity: loading && data ? 0.6 : 1, transition: 'opacity .3s' }}>
            <NewCrmTab t={t} stages={stages} newCrmTxns={newCrmTxns} completedToday={newCrmCompletedToday} newCrmError={newCrmError}
              regionFilter={regionFilter} regions={regions}
              viewDate={periodLabel} isToday={isToday}
              showVisuals={showVisuals} onExitVisuals={() => setShowVisuals(false)}
              newEventCount={newEventCount} clearNewEvents={() => setNewEventCount(0)} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════ */
/*                      SUB-COMPONENTS                           */
/* ════════════════════════════════════════════════════════════════ */

/* ── Hero Number (clickable) ── */
function HeroNum({ label, value, color, t, small, muted, onClick, active, weight, grossWt, netWt, noWtCount }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = 'scale(1.05)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: small ? '6px 16px' : '8px 24px', opacity: muted && !active ? .55 : 1,
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 12,
        background: active ? `${color}18` : 'transparent',
        outline: active ? `2px solid ${color}60` : '2px solid transparent',
        boxShadow: active ? `0 0 18px ${color}22` : 'none',
        transition: 'background .18s, outline .18s, box-shadow .18s, transform .15s, opacity .18s',
      }}>
      <Mono size={small ? '1.9rem' : '2.6rem'} color={color} weight={200}>
        {fmtNum(value)}
      </Mono>
      <span style={{
        fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase',
        color: active ? color : t.text3, marginTop: 4,
        fontWeight: active ? 700 : 500,
        transition: 'color .18s',
      }}>
        {label}
      </span>
      {(grossWt != null || netWt != null) ? (
        (((grossWt > 0) || (netWt > 0)) || noWtCount > 0) && (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 3, gap: 1 }}>
            {((grossWt > 0) || (netWt > 0)) && (
              <>
                <span style={{ fontSize: '.66rem', color: active ? color : t.text2, fontFamily: '"SF Mono","Roboto Mono",ui-monospace,monospace', letterSpacing: '.01em', fontWeight: 600 }}>
                  {fmtWt(grossWt || 0)} <span style={{ opacity: .55, fontWeight: 500, fontSize: '.92em' }}>gross</span>
                </span>
                <span style={{ fontSize: '.72rem', color: active ? color : t.text1, fontFamily: '"SF Mono","Roboto Mono",ui-monospace,monospace', letterSpacing: '.01em', fontWeight: 700 }}>
                  {fmtWt(netWt || 0)} <span style={{ opacity: .55, fontWeight: 500, fontSize: '.92em' }}>net</span>
                </span>
              </>
            )}
            {noWtCount > 0 && (
              <span title="Bills with no weight recorded yet (items not weighed)" style={{ fontSize: '.6rem', color: t.red, fontWeight: 700, fontFamily: '"SF Mono","Roboto Mono",ui-monospace,monospace', letterSpacing: '.02em', marginTop: ((grossWt > 0) || (netWt > 0)) ? 3 : 0 }}>
                {noWtCount} no wt
              </span>
            )}
          </span>
        )
      ) : (weight > 0 && (
        <span style={{
          fontSize: '.55rem', color: active ? `${color}cc` : t.text4,
          fontFamily: 'ui-monospace,monospace', marginTop: 3, letterSpacing: '.04em',
        }}>
          {fmtWt(weight)}
        </span>
      ))}
      {active && (
        <span style={{ width: 20, height: 2, borderRadius: 1, background: color, marginTop: 5, display: 'block' }} />
      )}
    </div>
  )
}

/* ── Live Detail Table ── */

/* ── Transaction table (Purchase-Data style) ── */

/* ── Walk-in table ── */

/* ── KYC Blocked table ── */

/* ── Takeover table ── */

/* ── CSV Download ── */
function downloadCSV(filename, headers, rows, extractor) {
  const lines = [headers.join(',')]
  rows.forEach(r => lines.push(extractor(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

/* ── Region Breakdown Table ── */

/* ── Flow Arrow ── */
function FlowArrow({ t, pct }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 4px' }}>
      <span style={{ fontSize: '1.1rem', color: t.text4, lineHeight: 1 }}>{'\u2192'}</span>
      {pct != null && (
        <span style={{ fontSize: '.46rem', color: t.text4, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
          {pct}%
        </span>
      )}
    </div>
  )
}

function FlowSep({ t }) {
  return <div style={{ width: 1, height: 32, background: t.border2, margin: '0 6px' }} />
}

/* ── Timeline Row ── */

/* ════════════════════════════════════════════════════════════════ */
/*                        NEW CRM TAB                            */
/* ════════════════════════════════════════════════════════════════ */

const NEW_CRM_STATUS = {
  WALKIN:                    { label: 'Walk-in',          color: '#4a9fdf' },
  QUOTATION_PENDING:         { label: 'Quotation',        color: '#4a9fdf' },
  ESTIMATION_PENDING:        { label: 'Estimation',       color: '#e09830' },
  PLEDGE_ESTIMATION_PENDING: { label: 'Pledge Est.',      color: '#e09830' },
  REVALUATION_PENDING:       { label: 'Revaluation',      color: '#e09830' },
  SALES_NEGOTIATION_PENDING: { label: 'Negotiation',      color: '#e09830' },
  KYC_PENDING:               { label: 'KYC',              color: '#9a6adf' },
  BRANCH_KYC_PENDING:        { label: 'Branch KYC',       color: '#9a6adf' },
  PLEDGE_APPROVAL_PENDING:   { label: 'Pledge Approval',  color: '#9a6adf' },
  PENNY_DROP_PENDING:        { label: 'Penny Drop',       color: '#c9a84c' },
  FINAL_PAYMENT_PENDING:     { label: 'Payment Due',      color: '#c9a84c' },
  RELEASE_PENDING:           { label: 'Release',          color: '#c9a84c' },
  RELEASE_AGREEMENT_PENDING: { label: 'Release Agmt.',    color: '#c9a84c' },
  FINAL_PAYMENT_COMPLETED:   { label: 'Completed',        color: '#3aaa6a' },
  WALKOUT:                   { label: 'Walkout',          color: '#e05555' },
}
const IN_PROGRESS_STATUSES = [
  'ESTIMATION_PENDING', 'PLEDGE_ESTIMATION_PENDING', 'REVALUATION_PENDING', 'SALES_NEGOTIATION_PENDING',
  'QUOTATION_PENDING',
  'KYC_PENDING', 'BRANCH_KYC_PENDING', 'PLEDGE_APPROVAL_PENDING',
  'PENNY_DROP_PENDING', 'FINAL_PAYMENT_PENDING', 'RELEASE_PENDING', 'RELEASE_AGREEMENT_PENDING',
]
// Journey stage a raw status maps to — shared with the Visualise dashboard.
export function stageOfStatus(status) {
  if (status === 'WALKIN') return 'walkin'
  if (['ESTIMATION_PENDING', 'PLEDGE_ESTIMATION_PENDING', 'REVALUATION_PENDING', 'SALES_NEGOTIATION_PENDING', 'QUOTATION_PENDING'].includes(status)) return 'estimation'
  if (['KYC_PENDING', 'BRANCH_KYC_PENDING', 'PLEDGE_APPROVAL_PENDING'].includes(status)) return 'kyc'
  if (['FINAL_PAYMENT_PENDING', 'PENNY_DROP_PENDING', 'RELEASE_PENDING', 'RELEASE_AGREEMENT_PENDING'].includes(status)) return 'payment'
  if (status === 'FINAL_PAYMENT_COMPLETED') return 'completed'
  if (status === 'WALKOUT') return 'walkout'
  return 'other'
}

function NewCrmTab({ t, newCrmTxns, completedToday, newCrmError, regionFilter, regions, isToday, viewDate, showVisuals, onExitVisuals, newEventCount, clearNewEvents }) {
  const [activeMetric, setActiveMetric] = useState(null)
  const [typeFilter, setTypeFilter] = useState('')   // '' | 'physical' | 'takeover'
  const [tlOpen, setTlOpen] = useState(false)
  const [tlSearch, setTlSearch] = useState('')
  const toggleMetric = key => setActiveMetric(prev => prev === key ? null : key)

  // Offline state (connection failed)
  if (newCrmTxns === null || newCrmTxns === undefined) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', color: t.text4 }}>~</div>
        <span style={{ fontSize: '.88rem', color: t.text2, fontWeight: 300 }}>New CRM Offline</span>
        {newCrmError && (
          <div style={{ background: `${t.red}12`, border: `1px solid ${t.red}30`, borderRadius: 8, padding: '8px 16px', maxWidth: 480, fontFamily: 'ui-monospace,monospace', fontSize: '.62rem', color: t.red, wordBreak: 'break-all', textAlign: 'center' }}>
            {newCrmError}
          </div>
        )}
        <span style={{ fontSize: '.62rem', color: t.text4, maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
          The new PostgreSQL-based CRM is not reporting data at this time.
        </span>
      </div>
    )
  }

  // Region filter, then transaction-type filter (Physical vs Takeover/released gold)
  const regionTxns = regionFilter ? newCrmTxns.filter(tx => tx.region === regionFilter) : newCrmTxns
  const txns    = typeFilter === 'physical' ? regionTxns.filter(tx => tx.transaction_type === 'PHYSICAL_GOLD')
                : typeFilter === 'takeover' ? regionTxns.filter(tx => tx.transaction_type === 'RELEASED_GOLD')
                : regionTxns
  const allTxns = newCrmTxns
  // Bills with no weight in ANY source (items not weighed yet) — weight_source==='none'
  const noWt = (arr) => arr.filter(tx => (Number(tx.net_weight) || 0) === 0 && (Number(tx.gross_weight) || 0) === 0).length

  // Derived counts
  const walkinTxns     = txns.filter(tx => tx.status === 'WALKIN')
  const estimationTxns = txns.filter(tx => ['ESTIMATION_PENDING','PLEDGE_ESTIMATION_PENDING','REVALUATION_PENDING','SALES_NEGOTIATION_PENDING','QUOTATION_PENDING'].includes(tx.status))
  const kycTxns        = txns.filter(tx => ['KYC_PENDING','BRANCH_KYC_PENDING','PLEDGE_APPROVAL_PENDING'].includes(tx.status))
  const paymentTxns    = txns.filter(tx => ['FINAL_PAYMENT_PENDING','PENNY_DROP_PENDING','RELEASE_PENDING','RELEASE_AGREEMENT_PENDING'].includes(tx.status))
  const completedTxns  = txns.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED')
  const walkoutTxns    = txns.filter(tx => tx.status === 'WALKOUT')
  const inProgressTxns = txns.filter(tx => IN_PROGRESS_STATUSES.includes(tx.status))

  // COMPLETED card = PURCHASED today (CRM dashboard basis): bills whose final
  // payment completed today, dated by updated_at — so a bill walked-in earlier
  // but paid today counts here (matches the Case Wise Report). Region + type
  // filtered. Falls back to the created-today completed cohort if the server
  // didn't supply the dataset (offline / cached old payload).
  const ctRegion = completedToday == null ? null
    : (regionFilter ? completedToday.filter(r => r.region === regionFilter) : completedToday)
  const ctSet = ctRegion == null ? null
    : (typeFilter === 'physical' ? ctRegion.filter(r => r.transaction_type === 'PHYSICAL_GOLD')
     : typeFilter === 'takeover' ? ctRegion.filter(r => r.transaction_type === 'RELEASED_GOLD')
     : ctRegion)

  const total      = txns.length
  const inProgress = inProgressTxns.length
  const completed  = ctSet ? ctSet.length : completedTxns.length
  const walkout    = walkoutTxns.length

  const completedValue = completedTxns.reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
  // Both gross and net weight per stage (net = gross − stone − wastage).
  const netW   = (arr) => arr.reduce((s, tx) => s + (Number(tx.net_weight)   || 0), 0)
  const grossW = (arr) => arr.reduce((s, tx) => s + (Number(tx.gross_weight) || 0), 0)
  const totalWt      = netW(txns),           totalGr      = grossW(txns)
  const completedWt  = ctSet ? netW(ctSet) : netW(completedTxns)
  const completedGr  = ctSet ? grossW(ctSet) : grossW(completedTxns)
  const inProgressWt = netW(inProgressTxns), inProgressGr = grossW(inProgressTxns)
  const walkoutWt    = netW(walkoutTxns),    walkoutGr    = grossW(walkoutTxns)
  const walkinWt     = netW(walkinTxns),     walkinGr     = grossW(walkinTxns)
  const estimationWt = netW(estimationTxns), estimationGr = grossW(estimationTxns)
  const kycWt        = netW(kycTxns),        kycGr        = grossW(kycTxns)
  const paymentWt    = netW(paymentTxns),    paymentGr    = grossW(paymentTxns)

  // Walk-in split — New (walked in today) + Re-walk-ins (walked in on an earlier
  // day but came back and CLOSED today, flagged on the completed-today set) =
  // Total walk-ins. Region + type filtered, consistent with the rest of the view.
  const reWalkinSet    = (ctSet || completedTxns || []).filter(r => r.re_walkin)
  const reWalkins      = reWalkinSet.length
  const reWalkinWt     = netW(reWalkinSet),  reWalkinGr  = grossW(reWalkinSet)
  const totalWalkins   = total + reWalkins
  const totalWalkinsWt = totalWt + reWalkinWt, totalWalkinsGr = totalGr + reWalkinGr

  const conversionPct       = total > 0 ? Math.round(completed / total * 100) : 0
  // Weight conversion — completed (net) weight ÷ total (net) weight, mirroring
  // the count-based conversionPct's numerator/denominator pairing above.
  const weightConversionPct = totalWt > 0 ? Math.round(completedWt / totalWt * 100) : 0
  const walkoutRate         = total > 0 ? Math.round(walkout / total * 100) : 0
  const progressedPct       = total > 0 ? Math.round((inProgress + completed) / total * 100) : 0
  const completedOfProgPct  = (inProgress + completed) > 0 ? Math.round(completed / (inProgress + completed) * 100) : 0
  const avgWt               = completed > 0 && completedWt > 0 ? completedWt / completed : 0

  // ── 3-group journey ──────────────────────────────────────────────────────
  // Group 2 = Total purchases (everything that CLOSED today = ctSet), split by
  //   • Same-day  — walked in today AND bought today (fresh completed)
  //   • Old-day   — walked in earlier, bought today (re-walk-ins; all of them closed)
  // Group 3 = Total walk-ins − Total purchases = walk-ins still in the pipeline,
  //   shown as the per-stage split (At Walk-in / Estimation / KYC / Payment / Walkout).
  const totalPurchases = completed
  const oldDayPurch    = reWalkins
  const oldDayPurchWt  = reWalkinWt,  oldDayPurchGr = reWalkinGr
  const sameDayPurch   = Math.max(0, completed   - reWalkins)
  const sameDayPurchWt = Math.max(0, completedWt - reWalkinWt)
  const sameDayPurchGr = Math.max(0, completedGr - reWalkinGr)
  const pendingCount   = Math.max(0, totalWalkins - totalPurchases)

  if (!total) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
        <span style={{ fontSize: '2rem', opacity: .3 }}>~</span>
        <span style={{ fontSize: '.82rem', color: t.text3 }}>No activity recorded yet</span>
        <span style={{ fontSize: '.62rem', color: t.text4 }}>Data will appear as transactions come in</span>
      </div>
    )
  }

  // ── Visualise mode — swap the journey cards for a chart dashboard ──────────
  if (showVisuals) {
    const vStages = [
      { key: 'walkin',     label: 'At Walk-in', count: walkinTxns.length,     wt: walkinWt,     color: t.blue },
      { key: 'estimation', label: 'Estimation', count: estimationTxns.length, wt: estimationWt, color: t.orange },
      { key: 'kyc',        label: 'KYC',        count: kycTxns.length,        wt: kycWt,        color: t.purple },
      { key: 'payment',    label: 'Payment',    count: paymentTxns.length,    wt: paymentWt,    color: t.gold },
      { key: 'completed',  label: 'Completed',  count: completed,             wt: completedWt,  color: t.green },
      { key: 'walkout',    label: 'Walkout',    count: walkout,               wt: walkoutWt,    color: t.red },
    ]
    // Type mix respects the region filter but ignores the type filter (show the real split).
    const physical = regionTxns.filter(tx => tx.transaction_type === 'PHYSICAL_GOLD').length
    const takeover = regionTxns.filter(tx => tx.transaction_type === 'RELEASED_GOLD').length
    // Per-region performance — all regions (for comparison), independent of the region filter.
    const regionRows = (regions || []).map(rg => {
      const inR    = newCrmTxns.filter(tx => tx.region === rg)
      const compRows = (completedToday || []).filter(r => r.region === rg)
      const comp   = compRows.length
      const pend   = inR.filter(tx => IN_PROGRESS_STATUSES.includes(tx.status) || tx.status === 'WALKIN').length
      const walk   = inR.length + comp
      const walkWt = inR.reduce((s, tx) => s + (Number(tx.net_weight) || 0), 0) + compRows.reduce((s, tx) => s + (Number(tx.net_weight) || 0), 0)
      const compWt = compRows.reduce((s, tx) => s + (Number(tx.net_weight) || 0), 0)
      return { region: rg, walkins: walk, completed: comp, pending: pend, conversion: walk ? Math.round(comp / walk * 100) : 0, wtConversion: walkWt ? Math.round(compWt / walkWt * 100) : 0 }
    }).filter(r => r.walkins > 0)
    return (
      <LiveFeedVisuals t={t}
        stages={vStages}
        totals={{ totalWalkins, completed, pendingCount, conversionPct, weightConversionPct, walkoutRate }}
        typeSplit={{ physical, takeover }}
        regionRows={regionRows}
        txns={txns} allTxns={newCrmTxns} stageOf={stageOfStatus}
        viewDate={viewDate} regionFilter={regionFilter}
        onClose={onExitVisuals} />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ──────── 1. CUSTOMER JOURNEY ──────── */}
      <div>
        <SectionLabel t={t}>Customer Journey · New CRM</SectionLabel>
        {/* Transaction-type filter — All / Physical / Takeover (released gold) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.08em' }}>TYPE</span>
          {[
            { key: '',         label: 'All',      n: regionTxns.length },
            { key: 'physical', label: 'Physical', n: regionTxns.filter(tx => tx.transaction_type === 'PHYSICAL_GOLD').length },
            { key: 'takeover', label: 'Takeover', n: regionTxns.filter(tx => tx.transaction_type === 'RELEASED_GOLD').length },
          ].map(o => (
            <button key={o.key || 'all'} onClick={() => setTypeFilter(o.key)} style={{
              padding: '4px 12px', borderRadius: 999, fontSize: '.62rem', cursor: 'pointer',
              border: `1px solid ${typeFilter === o.key ? t.gold : t.border}`,
              background: typeFilter === o.key ? `${t.gold}18` : 'transparent',
              color: typeFilter === o.key ? t.gold : t.text3,
              fontWeight: typeFilter === o.key ? 600 : 400, transition: 'all .15s', whiteSpace: 'nowrap',
            }}>
              {o.label} <span style={{ opacity: .6, fontFamily: 'ui-monospace,monospace' }}>{o.n}</span>
            </button>
          ))}
        </div>
        <div className="lf-hero" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 0, flexWrap: 'nowrap', overflowX: 'auto', background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: '28px 16px', boxShadow: `0 4px 20px rgba(0,0,0,.12), inset 0 1px 0 ${t.border}`, backdropFilter: 'blur(4px)' }}>
          {/* Today's walk-ins — total in the badge, split into Fresh + Re-walk-ins */}
          <div style={{
            position:'relative',
            background:`linear-gradient(160deg, ${t.bg} 0%, ${t.card} 60%, ${t.bg} 100%)`,
            border:`1.5px solid ${t.gold}55`,
            borderRadius:22,
            boxShadow:`0 0 0 1px ${t.gold}12, 0 16px 48px ${t.gold}20, 0 4px 16px rgba(0,0,0,.16), inset 0 0 60px ${t.gold}08, inset 0 1px 0 ${t.gold}35`,
            padding:'22px 14px 14px',
          }}>
            <div style={{ position:'absolute', inset:-1, borderRadius:22, background:`radial-gradient(ellipse at 50% 0%, ${t.gold}18 0%, transparent 65%)`, pointerEvents:'none' }}/>
            <div style={{ position:'absolute', inset:0, borderRadius:22, backgroundImage:`radial-gradient(${t.gold}18 1px, transparent 1px)`, backgroundSize:'18px 18px', pointerEvents:'none', opacity:.6 }}/>
            <div style={{ position:'absolute', top:-14, left:'50%', transform:'translateX(-50%)', background:`linear-gradient(90deg,${t.gold}ee,${t.gold}bb)`, borderRadius:20, padding:'4px 14px', boxShadow:`0 4px 14px ${t.gold}55, 0 0 0 1px ${t.gold}30`, whiteSpace:'nowrap' }}>
              <span style={{ fontSize:'.52rem', letterSpacing:'.14em', textTransform:'uppercase', color:'#fff', fontWeight:900 }}>today's {fmtNum(totalWalkins)} walk-ins</span>
            </div>
            <div style={{ position:'relative', display:'flex', alignItems:'center', gap:8 }}>
              {[
                { node: <HeroNum label="Fresh Walk-ins" value={total}     color={t.blue}   t={t} grossWt={totalGr}    netWt={totalWt}    noWtCount={noWt(txns)} active={activeMetric==='total'} onClick={() => toggleMetric('total')} />, color: t.blue },
                { node: <HeroNum label="Re-walk-ins"    value={reWalkins} color={t.purple} t={t} grossWt={reWalkinGr} netWt={reWalkinWt} active={activeMetric==='rewalkin'} onClick={() => toggleMetric('rewalkin')} />, color: t.purple },
              ].map((item, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {i > 0 && <FlowSep t={t} />}
                  <div style={{
                    background:`linear-gradient(160deg, ${t.card2} 0%, ${t.card} 100%)`,
                    border:`1px solid ${item.color}30`,
                    borderTop:`2px solid ${item.color}70`,
                    borderRadius:14,
                    boxShadow:`0 8px 24px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.10), inset 0 1px 0 ${item.color}18`,
                    transform:'translateY(-5px)',
                  }}>
                    {item.node}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <FlowArrow t={t} pct={totalWalkins > 0 ? Math.round(totalPurchases / totalWalkins * 100) : null} />
          {/* GROUP 2 — Total purchases (closed today): same-day vs old-day walk-in */}
          <div style={{
            position:'relative',
            background:`linear-gradient(160deg, ${t.bg} 0%, ${t.card} 60%, ${t.bg} 100%)`,
            border:`1.5px solid ${t.green}55`,
            borderRadius:22,
            boxShadow:`0 0 0 1px ${t.green}12, 0 16px 48px ${t.green}20, 0 4px 16px rgba(0,0,0,.16), inset 0 0 60px ${t.green}08, inset 0 1px 0 ${t.green}35`,
            padding:'22px 14px 14px',
          }}>
            <div style={{ position:'absolute', inset:-1, borderRadius:22, background:`radial-gradient(ellipse at 50% 0%, ${t.green}18 0%, transparent 65%)`, pointerEvents:'none' }}/>
            <div style={{ position:'absolute', inset:0, borderRadius:22, backgroundImage:`radial-gradient(${t.green}18 1px, transparent 1px)`, backgroundSize:'18px 18px', pointerEvents:'none', opacity:.6 }}/>
            <div style={{ position:'absolute', top:-14, left:'50%', transform:'translateX(-50%)', background:`linear-gradient(90deg,${t.green}ee,${t.green}bb)`, borderRadius:20, padding:'4px 14px', boxShadow:`0 4px 14px ${t.green}55, 0 0 0 1px ${t.green}30`, whiteSpace:'nowrap' }}>
              <span style={{ fontSize:'.52rem', letterSpacing:'.14em', textTransform:'uppercase', color:'#fff', fontWeight:900 }}>today's {fmtNum(totalPurchases)} purchases</span>
            </div>
            <div style={{ position:'relative', display:'flex', alignItems:'center', gap:8 }}>
              {[
                { node: <HeroNum label="Same-day Buy"  value={sameDayPurch} color={t.green}  t={t} grossWt={sameDayPurchGr} netWt={sameDayPurchWt} noWtCount={noWt(completedTxns)} active={activeMetric==='completed'} onClick={() => toggleMetric('completed')} />, color: t.green },
                { node: <HeroNum label="Re-walk-in Buy" value={oldDayPurch} color={t.purple} t={t} grossWt={oldDayPurchGr} netWt={oldDayPurchWt} active={activeMetric==='rewalkin'} onClick={() => toggleMetric('rewalkin')} />, color: t.purple },
              ].map((item, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {i > 0 && <FlowSep t={t} />}
                  <div style={{
                    background:`linear-gradient(160deg, ${t.card2} 0%, ${t.card} 100%)`,
                    border:`1px solid ${item.color}30`,
                    borderTop:`2px solid ${item.color}70`,
                    borderRadius:14,
                    boxShadow:`0 8px 24px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.10), inset 0 1px 0 ${item.color}18`,
                    transform:'translateY(-5px)',
                  }}>
                    {item.node}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <FlowArrow t={t} pct={null} />
          {/* GROUP 3 — Walk-ins − Purchases (still in the pipeline), per-stage split */}
          <div style={{
            position:'relative',
            background:`linear-gradient(160deg, ${t.bg} 0%, ${t.card} 60%, ${t.bg} 100%)`,
            border:`1.5px solid ${t.orange}55`,
            borderRadius:22,
            boxShadow:`0 0 0 1px ${t.orange}12, 0 16px 48px ${t.orange}20, 0 4px 16px rgba(0,0,0,.16), inset 0 0 60px ${t.orange}08, inset 0 1px 0 ${t.orange}35`,
            padding:'22px 14px 14px',
          }}>
            <div style={{ position:'absolute', inset:-1, borderRadius:22, background:`radial-gradient(ellipse at 50% 0%, ${t.orange}18 0%, transparent 65%)`, pointerEvents:'none' }}/>
            <div style={{ position:'absolute', inset:0, borderRadius:22, backgroundImage:`radial-gradient(${t.orange}18 1px, transparent 1px)`, backgroundSize:'18px 18px', pointerEvents:'none', opacity:.6 }}/>
            <div style={{ position:'absolute', top:-14, left:'50%', transform:'translateX(-50%)', background:`linear-gradient(90deg,${t.orange}ee,${t.orange}bb)`, borderRadius:20, padding:'4px 14px', boxShadow:`0 4px 14px ${t.orange}55, 0 0 0 1px ${t.orange}30`, whiteSpace:'nowrap' }}>
              <span style={{ fontSize:'.52rem', letterSpacing:'.14em', textTransform:'uppercase', color:'#fff', fontWeight:900 }}>yet to purchase · {fmtNum(pendingCount)}</span>
            </div>
            <div style={{ position:'relative', display:'flex', alignItems:'center', gap:8 }}>
              {[
                { node: <HeroNum label="At Walk-in"  value={walkinTxns.length}     color={t.blue}   t={t} small grossWt={walkinGr} netWt={walkinWt}         noWtCount={noWt(walkinTxns)}     active={activeMetric==='walkin'}     onClick={() => toggleMetric('walkin')} />, color: t.blue },
                { node: <HeroNum label="Estimation"  value={estimationTxns.length} color={t.orange} t={t} small grossWt={estimationGr} netWt={estimationWt} noWtCount={noWt(estimationTxns)} active={activeMetric==='estimation'} onClick={() => toggleMetric('estimation')} />, color: t.orange },
                { node: <HeroNum label="KYC"         value={kycTxns.length}        color={t.purple} t={t} small grossWt={kycGr} netWt={kycWt}               noWtCount={noWt(kycTxns)}        active={activeMetric==='kyc'}        onClick={() => toggleMetric('kyc')} />, color: t.purple },
                { node: <HeroNum label="Payment Due" value={paymentTxns.length}    color={t.gold}   t={t} small grossWt={paymentGr} netWt={paymentWt}       noWtCount={noWt(paymentTxns)}    active={activeMetric==='payment'}    onClick={() => toggleMetric('payment')} />, color: t.gold },
                { node: <HeroNum label="Walkout"     value={walkout}               color={t.red}    t={t} small grossWt={walkoutGr} netWt={walkoutWt}       noWtCount={noWt(walkoutTxns)}    active={activeMetric==='walkout'}    onClick={() => toggleMetric('walkout')} />, color: t.red },
              ].map((item, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {i > 0 && <FlowSep t={t} />}
                  <div style={{
                    background:`linear-gradient(160deg, ${t.card2} 0%, ${t.card} 100%)`,
                    border:`1px solid ${item.color}30`,
                    borderTop:`2px solid ${item.color}70`,
                    borderRadius:14,
                    boxShadow:`0 8px 24px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.10), inset 0 1px 0 ${item.color}18`,
                    transform:'translateY(-5px)',
                  }}>
                    {item.node}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* ── Stats ribbon ── */}
        <div style={{ display:'flex', gap:0, marginTop:10, background:t.card, border:`1px solid ${t.border}`, borderRadius:14, overflow:'hidden', flexWrap:'wrap', boxShadow:`0 2px 8px rgba(0,0,0,.08)` }}>
          {[
            { label:'Bill Conversion',   value:`${conversionPct}%`,       color:t.green,  key: null },
            { label:'Weight Conversion', value:`${weightConversionPct}%`, color:t.purple, key: null },
            { label:'In Pipeline',       value:fmtNum(inProgress),      color:t.orange, key:'inprogress' },
            { label:'Walkout Rate',      value:`${walkoutRate}%`,        color:walkoutRate >= 40 ? t.red : t.text3, key: walkout > 0 ? 'walkout' : null },
            ...(kycTxns.length > 0 ? [{ label:'KYC Pending', value:kycTxns.length, color:t.purple, key:'kyc' }] : []),
          ].map((s, i) => {
            const isActive = activeMetric === s.key
            const clickable = !!s.key
            return (
              <div key={i} onClick={clickable ? () => toggleMetric(s.key) : undefined}
                style={{
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  padding:'14px 24px', borderRight:`1px solid ${t.border}`,
                  gap:4, minWidth:110, flex:1,
                  borderTop:`3px solid ${s.color}`,
                  background: isActive ? `${s.color}18` : `linear-gradient(180deg, ${s.color}08 0%, transparent 60%)`,
                  cursor: clickable ? 'pointer' : 'default',
                  transition:'background .15s',
                  outline: isActive ? `1.5px solid ${s.color}40` : 'none',
                  outlineOffset: -1, position:'relative',
                }}>
                {clickable && <span style={{ position:'absolute', top:5, right:8, fontSize:'.44rem', color:s.color, opacity:.6 }}>{isActive ? '▲ active' : '▼ click'}</span>}
                <span style={{ fontSize:'1.6rem', fontWeight:200, fontFamily:'ui-monospace,monospace', color:s.color, letterSpacing:'-.04em', lineHeight:1 }}>{s.value}</span>
                <span style={{ fontSize:'.5rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700, marginTop:2 }}>{s.label}</span>
              </div>
            )
          })}
          {activeMetric && (
            <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', padding:'0 16px' }}>
              <button onClick={() => setActiveMetric(null)} style={{ padding:'4px 12px', borderRadius:20, fontSize:'.58rem', cursor:'pointer', border:`1px solid ${t.border}`, background:t.card2, color:t.text3 }}>Clear filter ✕</button>
            </div>
          )}
        </div>
      </div>

      {/* ──────── 1b. TRANSACTION DISPOSITION ──────── */}
      {(() => {
        const segments = [
          { label:'Completed',   sublabel:'Final payment received',          count:completed,         color:t.green,  key:'completed'  },
          { label:'In Progress', sublabel:'In estimation / KYC / payment',   count:inProgress,        color:t.orange, key:'inprogress' },
          { label:'Walkout',     sublabel:'Left without completing',         count:walkout,           color:t.red,    key:'walkout'    },
          { label:'At Walk-in',  sublabel:'Registered, awaiting assessment', count:walkinTxns.length, color:t.blue,   key:'walkin'     },
        ].filter(s => s.count > 0)
        if (segments.length === 0) return null
        return (
          <div style={{ position:'relative', background:`linear-gradient(160deg,${t.bg} 0%,${t.card} 60%,${t.bg} 100%)`, border:`1.5px solid ${t.border2}`, borderRadius:20, boxShadow:`0 4px 20px rgba(0,0,0,.10), inset 0 1px 0 ${t.border}`, padding:'22px 16px 16px' }}>
            <div style={{ position:'absolute', inset:-1, borderRadius:20, background:`radial-gradient(ellipse at 50% 0%,${t.border2}60 0%,transparent 65%)`, pointerEvents:'none' }}/>
            <div style={{ position:'absolute', top:-13, left:'50%', transform:'translateX(-50%)', background:t.card2, border:`1px solid ${t.border2}`, borderRadius:20, padding:'4px 16px', whiteSpace:'nowrap', boxShadow:`0 2px 8px rgba(0,0,0,.12)` }}>
              <span style={{ fontSize:'.48rem', letterSpacing:'.14em', textTransform:'uppercase', color:t.text3, fontWeight:700 }}>breakdown of {fmtNum(total)} transactions</span>
            </div>
            <div style={{ display:'flex', height:5, borderRadius:100, overflow:'hidden', gap:1, marginBottom:14 }}>
              {segments.map((s, i) => (
                <div key={i} onClick={() => toggleMetric(s.key)} style={{ width:`${(s.count/total)*100}%`, background:s.color, minWidth:2, cursor:'pointer', opacity:activeMetric && activeMetric !== s.key ? .2 : 1, transition:'opacity .2s', borderRadius:i===0?'100px 0 0 100px':i===segments.length-1?'0 100px 100px 0':0 }} />
              ))}
            </div>
            <div style={{ display:'flex', alignItems:'stretch', gap:8, flexWrap:'wrap' }}>
              {segments.map((s) => {
                const isActive = activeMetric === s.key
                return (
                  <div key={s.key} onClick={() => toggleMetric(s.key)}
                    style={{ flex:1, minWidth:100, border:`1px solid ${s.color}25`, borderTop:`2px solid ${isActive?s.color:s.color+'80'}`, borderRadius:12, padding:'12px 14px 10px', cursor:'pointer', transform:isActive?'translateY(-3px)':'translateY(0)', transition:'all .18s ease', background:isActive?`linear-gradient(160deg,${s.color}10 0%,${t.card} 100%)`:`linear-gradient(160deg,${t.card2} 0%,${t.card} 100%)`, boxShadow:isActive?`0 0 0 1.5px ${s.color}40,0 8px 24px rgba(0,0,0,.14)`:`0 4px 12px rgba(0,0,0,.10)` }}>
                    <div style={{ fontSize:'1.4rem', fontWeight:200, fontFamily:'ui-monospace,monospace', color:s.color, lineHeight:1, letterSpacing:'-.03em' }}>{fmtNum(s.count)}</div>
                    <div style={{ fontSize:'.6rem', fontWeight:600, color:s.color, marginTop:4 }}>{s.label}</div>
                    <div style={{ fontSize:'.5rem', color:t.text4, marginTop:2, lineHeight:1.4 }}>{s.sublabel}</div>
                    <div style={{ marginTop:8, height:2, borderRadius:2, background:t.border, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${Math.round((s.count/total)*100)}%`, background:s.color, borderRadius:2, transition:'width .6s ease' }}/>
                    </div>
                    <div style={{ fontSize:'.44rem', color:t.text4, marginTop:3, textAlign:'right' }}>{Math.round((s.count/total)*100)}%</div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ──────── 1c. BRANCH PULSE ──────── */}
      {(() => {
        const insights = []
        if (inProgress > 0) insights.push({
          icon:'🔄', color:t.orange, metric:'inprogress',
          headline:`${inProgress} transaction${inProgress>1?'s':''} in pipeline`,
          detail:`${fmtWt(inProgressWt)} gold pending completion. Follow up to close before end of day.`,
        })
        if (walkoutRate >= 40) insights.push({
          icon:'📉', color:t.red, metric:'walkout',
          headline:`${walkoutRate}% walkout rate`,
          detail:`${walkout} of ${total} customers left without completing. Review branch engagement.`,
        })
        if (kycTxns.length > 0) insights.push({
          icon:'🚫', color:t.purple, metric:'kyc',
          headline:`${kycTxns.length} customer${kycTxns.length>1?'s':''} at KYC stage`,
          detail:`${kycTxns.length} transaction${kycTxns.length>1?'s':''} pending KYC verification — follow up to unblock.`,
        })
        if (paymentTxns.length > 0) insights.push({
          icon:'💰', color:t.gold, metric:'payment',
          headline:`${paymentTxns.length} awaiting final payment`,
          detail:`${paymentTxns.length} customer${paymentTxns.length>1?'s':''} ready for disbursement — payment pending.`,
        })
        if (conversionPct >= 80 && completed > 0) insights.push({
          icon:'💪', color:t.green,
          headline:`${conversionPct}% completion rate`,
          detail:`Most customers are completing their transactions today.`,
        })
        if (walkoutRate > 0 && walkoutRate < 20) insights.push({
          icon:'✓', color:t.green,
          headline:`${walkoutRate}% walkout rate`,
          detail:`Only ${walkout} of ${total} customers walked out. Healthy completion rate.`,
        })
        if (insights.length === 0) return null
        return (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <span style={{ fontSize:'.48rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700, padding:'0 2px' }}>Branch Pulse</span>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {insights.map((ins, i) => (
                <div key={i} onClick={ins.metric ? () => toggleMetric(ins.metric) : undefined}
                  style={{ flex:1, minWidth:200, background:activeMetric===ins.metric?`${ins.color}12`:t.card, border:`1px solid ${activeMetric===ins.metric?ins.color+'60':ins.color+'30'}`, borderLeft:`3px solid ${ins.color}`, borderRadius:10, padding:'12px 16px', cursor:ins.metric?'pointer':'default', transition:'all .15s' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                    <span style={{ fontSize:'1rem' }}>{ins.icon}</span>
                    <span style={{ fontSize:'.7rem', fontWeight:600, color:ins.color }}>{ins.headline}</span>
                    {ins.metric && <span style={{ marginLeft:'auto', fontSize:'.48rem', color:ins.color, opacity:.7 }}>▼ view</span>}
                  </div>
                  <div style={{ fontSize:'.6rem', color:t.text3, lineHeight:1.5 }}>{ins.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ──────── 2. GOLD WEIGHT FLOW ──────── */}
      <div>
        <SectionLabel t={t}>Gold Weight Flow</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.10)' }}>
          {[
            { key: 'total',      label: 'Total',       wt: totalWt,      color: t.blue,   pct: 100 },
            { key: 'completed',  label: 'Completed',   wt: completedWt,  color: t.green,  pct: totalWt > 0 ? completedWt / totalWt * 100 : 0 },
            { key: 'inprogress', label: 'In Pipeline', wt: inProgressWt, color: t.orange, pct: totalWt > 0 ? inProgressWt / totalWt * 100 : 0 },
            { key: 'walkin',     label: 'At Walk-in',  wt: walkinWt,     color: t.blue,   pct: totalWt > 0 ? walkinWt / totalWt * 100 : 0 },
            { key: 'walkout',    label: 'Walkout',     wt: walkoutWt,    color: t.red,    pct: totalWt > 0 ? walkoutWt / totalWt * 100 : 0 },
          ].map((item, i, arr) => (
            <div key={item.key}
              className="ws-item"
              onClick={() => toggleMetric(item.key)}
              onMouseEnter={e => e.currentTarget.style.background = t.card2}
              onMouseLeave={e => e.currentTarget.style.background = activeMetric === item.key ? `${item.color}0c` : 'transparent'}
              style={{ flex: 1, minWidth: 'calc(20% - 1px)', padding: '12px 14px', cursor: 'pointer', borderRight: i < arr.length - 1 ? `1px solid ${t.border}` : 'none', borderTop: activeMetric === item.key ? `3px solid ${item.color}` : `3px solid transparent`, background: activeMetric === item.key ? `${item.color}0c` : 'transparent', transition: 'background .15s, border-top .15s' }}>
              <div style={{ fontSize: '.55rem', color: item.color, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: '.95rem', fontFamily: 'ui-monospace,monospace', color: t.text1, fontWeight: 300, marginTop: 4 }}>{item.wt > 0 ? fmtWt(item.wt) : '—'}</div>
              <div style={{ marginTop: 7, height: 3, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, item.pct)}%`, background: item.color, borderRadius: 2, transition: 'width .6s ease' }} />
              </div>
              <div style={{ fontSize: '.5rem', color: t.text4, marginTop: 3 }}>{item.pct > 0 ? `${item.pct.toFixed(0)}% of total` : ''}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.6rem', color: t.text3 }}>Avg wt/completed: <strong style={{ color: t.text1, fontFamily: 'ui-monospace,monospace' }}>{avgWt > 0 ? fmtWt(avgWt) : '—'}</strong></span>
          <span style={{ fontSize: '.6rem', color: t.text3 }}>Completed value: <strong style={{ color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{fmtAmt(completedValue)}</strong></span>
        </div>
      </div>

      {/* ──────── 2b. STAGE PIPELINE ──────── */}
      <NewCrmStagePipeline txns={txns} t={t} toggleMetric={toggleMetric} activeMetric={activeMetric} />

      {/* ──────── 3. REGION BREAKDOWN ──────── */}
      {regions && regions.length > 1 && !regionFilter && (
        <div className="lf-region">
          <NewCrmRegionTable t={t} regions={regions} allTxns={allTxns} />
        </div>
      )}

      {/* ──────── 4. DETAIL TABLE ──────── */}
      {activeMetric && (
        <NewCrmDetail t={t} activeMetric={activeMetric} txns={txns} reWalkins={reWalkinSet} />
      )}

      {/* ──────── 5. LIVE TIMELINE ──────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tlOpen ? 10 : 0 }}>
          <SectionLabel t={t}>{isToday ? 'Live Timeline' : 'Timeline'} · New CRM</SectionLabel>
          <button onClick={() => { setTlOpen(o => !o); clearNewEvents() }} style={{ padding: '4px 12px', borderRadius: 6, fontSize: '.6rem', cursor: 'pointer', border: `1px solid ${newEventCount > 0 ? t.green : t.border}`, background: newEventCount > 0 ? `${t.green}14` : t.card, color: newEventCount > 0 ? t.green : t.text3, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, transition: 'all .2s' }}>
            {newEventCount > 0 && <span style={{ background: t.green, color: '#000', borderRadius: 8, fontSize: '.52rem', fontWeight: 700, padding: '1px 5px', lineHeight: 1.4 }}>+{newEventCount}</span>}
            {tlOpen ? 'Collapse ▲' : 'Expand ▼'}
          </button>
        </div>
        {tlOpen && (
          <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
              <input type="text" placeholder="Search name, mobile, branch..." value={tlSearch} onChange={e => setTlSearch(e.target.value)}
                style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '5px 10px', fontSize: '.62rem', color: t.text2, outline: 'none', width: 220, fontFamily: 'ui-monospace, monospace' }} />
              <span style={{ fontSize: '.6rem', color: t.text4, marginLeft: 4 }}>{tlSearch ? txns.filter(tx => { const s = tlSearch.toLowerCase(); return (tx.cust_name||'').toLowerCase().includes(s) || (tx.cust_mobile||'').includes(s) || (tx.branch_name||'').toLowerCase().includes(s) }).length : txns.length} events</span>
            </div>
            <div className="tl-row" style={{ display: 'grid', gridTemplateColumns: '70px 28px 1fr 110px 120px', gap: '0 12px', padding: '8px 20px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
              {['Time', '', 'Customer / Branch', 'Weight', 'Amount'].map((h, i) => (
                <span key={i} className={i === 3 ? 'tl-hdr-wt' : i === 4 ? 'tl-hdr-amt' : ''} style={{ fontSize: '.57rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: i >= 3 ? 'right' : i === 0 ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {(() => {
                const sorted = [...txns].sort((a, b) => (b.txn_time || '').localeCompare(a.txn_time || ''))
                const visible = tlSearch
                  ? sorted.filter(tx => {
                      const s = tlSearch.toLowerCase()
                      return (tx.cust_name||'').toLowerCase().includes(s) || (tx.cust_mobile||'').includes(s) || (tx.branch_name||'').toLowerCase().includes(s)
                    })
                  : sorted
                return visible.map((tx, i, arr) => (
                  <NewCrmTimelineRow key={tx.id} item={tx} t={t} isLast={i === arr.length - 1} />
                ))
              })()}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

/* ── New CRM Detail Table ── */
function NewCrmDetail({ t, activeMetric, txns, reWalkins }) {
  const [search, setSearch] = useState('')

  let rows, label
  switch (activeMetric) {
    case 'total':      rows = txns; label = 'All Transactions'; break
    case 'rewalkin':   rows = reWalkins || []; label = 'Re-walk-ins · walked in earlier, closed today'; break
    case 'walkin':     rows = txns.filter(tx => tx.status === 'WALKIN'); label = 'Still at Walk-in'; break
    case 'inprogress': rows = txns.filter(tx => IN_PROGRESS_STATUSES.includes(tx.status)); label = 'In Progress'; break
    case 'completed':  rows = txns.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED'); label = 'Same-day Purchases · walked in & bought today'; break
    case 'walkout':    rows = txns.filter(tx => tx.status === 'WALKOUT'); label = 'Walkout'; break
    case 'estimation': rows = txns.filter(tx => ['ESTIMATION_PENDING','PLEDGE_ESTIMATION_PENDING','REVALUATION_PENDING','SALES_NEGOTIATION_PENDING','QUOTATION_PENDING'].includes(tx.status)); label = 'Estimation / Valuation'; break
    case 'kyc':        rows = txns.filter(tx => ['KYC_PENDING','BRANCH_KYC_PENDING','PLEDGE_APPROVAL_PENDING'].includes(tx.status)); label = 'KYC Pending'; break
    case 'payment':    rows = txns.filter(tx => ['FINAL_PAYMENT_PENDING','PENNY_DROP_PENDING','RELEASE_PENDING','RELEASE_AGREEMENT_PENDING'].includes(tx.status)); label = 'Payment Due'; break
    default:           rows = txns.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED'); label = 'Completed'
  }

  const q = search.toLowerCase()
  const filtered = q ? rows.filter(r =>
    (r.cust_name||'').toLowerCase().includes(q) || (r.cust_mobile||'').includes(q) ||
    (r.bill_no||'').toLowerCase().includes(q) || (r.branch_name||'').toLowerCase().includes(q)
  ) : rows

  return (
    <div style={{ animation: 'slideUp .22s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <SectionLabel t={t}>{label} · {filtered.length} records</SectionLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '4px 10px', fontSize: '.62rem', color: t.text2, outline: 'none', width: 160, fontFamily: 'ui-monospace, monospace' }} />
          <button onClick={() => downloadCSV(`${label}.csv`,
            ['Bill No','Date','Time','Customer','Phone','Branch','Gross Wt','Net Wt','Purity','Amount','Status'],
            filtered, r => [r.bill_no, r.txn_date, r.txn_time, r.cust_name, r.cust_mobile, r.branch_name,
              Number(r.gross_weight||0).toFixed(2), Number(r.net_weight||0).toFixed(2),
              r.avg_purity ? Number(r.avg_purity).toFixed(1) : '', Number(r.amount||0).toFixed(0), r.status]
          )} style={{ padding: '4px 12px', borderRadius: 6, fontSize: '.58rem', cursor: 'pointer', border: `1px solid ${t.border}`, background: t.card, color: t.text3, whiteSpace: 'nowrap' }}>
            ↓ CSV
          </button>
        </div>
      </div>
      <NewCrmTxnTable rows={filtered} t={t} />
    </div>
  )
}

/* ── New CRM Transaction Table ── */
function NewCrmTxnTable({ rows, t }) {
  const cols   = ['Bill No','Date','Time','Customer','Phone','Branch','Gross Wt','Net Wt','Purity','Amount','Status']
  const widths = '110px 90px 70px 160px 110px 160px 76px 70px 60px 96px 100px'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1100 }}>
          <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2, position: 'sticky', top: 0 }}>
            {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No records</div>}
            {rows.map((r, i) => {
              const sc = NEW_CRM_STATUS[r.status]?.color || t.text3
              const sl = NEW_CRM_STATUS[r.status]?.label || r.status
              return (
                <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: widths, padding: '10px 16px', borderBottom: `1px solid ${t.border}18`, gap: 8, alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 500 }}>{r.bill_no || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2 }}>{fmtDate(r.txn_date)}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{fmtTime(r.txn_time)}</span>
                  <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cust_name || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{r.cust_mobile || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</span>
                  <span title={r.weight_source === 'lead_approx' ? 'Approx weight declared at walk-in (not yet weighed)' : r.weight_source === 'none' ? 'Items not weighed yet' : ''}
                    style={{ fontSize: '.68rem', color: r.weight_source === 'lead_approx' ? t.text3 : t.text1, fontStyle: r.weight_source === 'lead_approx' ? 'italic' : 'normal', fontFamily: 'ui-monospace,monospace' }}>
                    {Number(r.gross_weight||0) > 0 ? `${r.weight_source === 'lead_approx' ? '~' : ''}${Number(r.gross_weight).toFixed(2)}g` : '—'}</span>
                  <span style={{ fontSize: '.68rem', color: t.text1, fontFamily: 'ui-monospace,monospace' }}>{Number(r.net_weight||0) > 0 ? `${Number(r.net_weight).toFixed(2)}g` : '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2 }}>{r.avg_purity ? `${Number(r.avg_purity).toFixed(1)}` : '—'}</span>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{Number(r.amount||0) > 0 ? fmtAmt(r.amount) : '—'}</span>
                  <span style={{ fontSize: '.58rem', padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: `${sc}18`, color: sc, border: `1px solid ${sc}30`, whiteSpace: 'nowrap' }}>{sl}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ── New CRM Stage Pipeline ── */
function NewCrmStagePipeline({ txns, t, toggleMetric, activeMetric }) {
  const STAGE_DEFS = [
    { key: 'walkin',    label: 'Walk-in',     statuses: ['WALKIN'],                                                                                                             color: t.blue   },
    { key: 'estimation',label: 'Estimation',  statuses: ['ESTIMATION_PENDING','PLEDGE_ESTIMATION_PENDING','REVALUATION_PENDING','SALES_NEGOTIATION_PENDING','QUOTATION_PENDING'], color: t.orange },
    { key: 'kyc',       label: 'KYC',         statuses: ['KYC_PENDING','BRANCH_KYC_PENDING','PLEDGE_APPROVAL_PENDING'],                                                          color: '#8c5ac8' },
    { key: 'payment',   label: 'Payment Due',  statuses: ['FINAL_PAYMENT_PENDING','PENNY_DROP_PENDING','RELEASE_PENDING','RELEASE_AGREEMENT_PENDING'],                            color: t.gold   },
    { key: 'completed', label: 'Completed',   statuses: ['FINAL_PAYMENT_COMPLETED'],                                                                                              color: t.green  },
    { key: 'walkout',   label: 'Walkout',     statuses: ['WALKOUT'],                                                                                                              color: t.red    },
  ]
  const stages = STAGE_DEFS.map(s => ({
    ...s,
    count: txns.filter(tx => s.statuses.includes(tx.status)).length,
    wt:    txns.filter(tx => s.statuses.includes(tx.status)).reduce((sum, tx) => sum + (Number(tx.gross_weight)||0), 0),
  }))
  const maxCount = Math.max(...stages.map(s => s.count), 1)
  const mainFlow = stages.filter(s => s.key !== 'walkout')
  const walkoutS = stages.find(s => s.key === 'walkout')

  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '16px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: '.6rem', color: t.text3, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Stage Pipeline</span>
        <span style={{ fontSize: '.55rem', color: t.text4 }}>click to filter</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
        {mainFlow.map((s, i) => {
          const barH = Math.max(s.count / maxCount * 80, s.count > 0 ? 8 : 2)
          const isActive = activeMetric === s.key
          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div onClick={() => toggleMetric(s.key)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56 }}>
                <span style={{ fontSize: '.65rem', fontFamily: 'ui-monospace,monospace', color: isActive ? s.color : t.text2, fontWeight: isActive ? 700 : 400 }}>{s.count}</span>
                <div style={{ width: '100%', height: barH, borderRadius: 4, background: isActive ? s.color : `${s.color}55`, border: `1px solid ${s.color}${isActive ? 'aa' : '40'}`, transition: 'all .15s' }} />
                <span style={{ fontSize: '.52rem', color: isActive ? s.color : t.text4, textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{s.label}</span>
                {s.wt > 0 && <span style={{ fontSize: '.45rem', color: t.text4, fontFamily: 'ui-monospace,monospace' }}>{fmtWt(s.wt)}</span>}
              </div>
              {i < mainFlow.length - 1 && (
                <div style={{ fontSize: '.7rem', color: t.text4, marginBottom: 24, flexShrink: 0 }}>→</div>
              )}
            </div>
          )
        })}
        {walkoutS && walkoutS.count > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div onClick={() => toggleMetric('walkout')} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56, padding: '6px 8px', borderRadius: 8, background: `${t.red}08`, border: `1px dashed ${t.red}40` }}>
              <span style={{ fontSize: '.65rem', fontFamily: 'ui-monospace,monospace', color: t.red, fontWeight: 700 }}>{walkoutS.count}</span>
              <span style={{ fontSize: '.52rem', color: t.red }}>Walkout</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── New CRM Region Table ── */
function NewCrmRegionTable({ t, regions, allTxns }) {
  const safeTxns = allTxns || []
  const rows = (regions || []).map(r => {
    const rTx   = safeTxns.filter(tx => tx.region === r)
    const rComp = rTx.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED')
    const rProg = rTx.filter(tx => IN_PROGRESS_STATUSES.includes(tx.status))
    const rWout = rTx.filter(tx => tx.status === 'WALKOUT')
    const value = rComp.reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
    const totalWt = rTx.reduce((s, tx) => s + (Number(tx.net_weight) || 0), 0)
    const compWt  = rComp.reduce((s, tx) => s + (Number(tx.net_weight) || 0), 0)
    const conv    = rTx.length > 0 ? Math.round(rComp.length / rTx.length * 100) : 0
    const wtConv  = totalWt > 0 ? Math.round(compWt / totalWt * 100) : 0
    return { region: r, total: rTx.length, inProgress: rProg.length, completed: rComp.length, walkout: rWout.length, value, totalWt, compWt, conv, wtConv }
  }).sort((a, b) => b.completed - a.completed)

  const cols = ['Region', 'Total', 'In Progress', 'Completed', 'Walkout', 'Value', 'Bill Conv', 'Wt Conv']
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionLabel t={t}>Region Breakdown</SectionLabel>
        <button onClick={() => downloadCSV('new-crm-regions.csv', cols, rows, r => [r.region, r.total, r.inProgress, r.completed, r.walkout, r.value, `${r.conv}%`, `${r.wtConv}%`])}
          style={{ padding: '4px 12px', borderRadius: 6, fontSize: '.58rem', cursor: 'pointer', border: `1px solid ${t.border}`, background: t.card, color: t.text3, marginBottom: 12 }}>
          ↓ CSV
        </button>
      </div>
      <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 70px 100px 90px 80px 110px 90px 90px', gap: 8, padding: '8px 16px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
              {cols.map(h => <span key={h} style={{ fontSize: '.56rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</span>)}
            </div>
            {rows.map((r, i) => (
              <div key={r.region} style={{ display: 'grid', gridTemplateColumns: '140px 70px 100px 90px 80px 110px 90px 90px', gap: 8, padding: '11px 16px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = t.card2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: '.75rem', color: t.text1, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.region}</span>
                <span style={{ fontSize: '.68rem', color: t.blue,   fontFamily: 'ui-monospace,monospace' }}>{r.total}</span>
                <span style={{ fontSize: '.68rem', color: t.orange, fontFamily: 'ui-monospace,monospace' }}>{r.inProgress || '—'}</span>
                <span style={{ fontSize: '.68rem', color: t.green,  fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{r.completed}</span>
                <span style={{ fontSize: '.68rem', color: t.red,    fontFamily: 'ui-monospace,monospace' }}>{r.walkout || '—'}</span>
                <span style={{ fontSize: '.68rem', color: t.gold,   fontFamily: 'ui-monospace,monospace' }}>{r.value > 0 ? fmtAmt(r.value) : '—'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={`${r.completed} / ${r.total}`}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${r.conv}%`, background: r.conv >= 50 ? t.green : r.conv >= 30 ? t.orange : t.red, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '.6rem', color: t.text3, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{r.conv}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={`${fmtWt(r.compWt)}g / ${fmtWt(r.totalWt)}g`}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${r.wtConv}%`, background: r.wtConv >= 50 ? t.green : r.wtConv >= 30 ? t.orange : t.red, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '.6rem', color: t.text3, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{r.wtConv}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

/* ── New CRM Timeline Row ── */
function NewCrmTimelineRow({ item, t, isLast }) {
  const isMobile = useMobile()
  const statusStyle = NEW_CRM_STATUS[item.status] || { label: item.status, color: t.text3 }
  const accentColor = statusStyle.color
  const wt = Number(item.gross_weight) || 0
  const isTakeover = (item.transaction_type || '').toUpperCase().includes('RELEASE')

  const rowBase = {
    padding: isMobile ? '10px 14px' : '12px 20px',
    borderBottom: isLast ? 'none' : `1px solid ${t.border}18`,
    borderLeft: `3px solid ${accentColor}40`,
    transition: 'background .12s',
  }

  if (isMobile) {
    return (
      <div style={rowBase}
        onMouseEnter={e => e.currentTarget.style.background = t.card2}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: '.76rem', color: t.text1, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.cust_name || 'Unknown'}</span>
          <span style={{ fontSize: '.56rem', padding: '2px 7px', borderRadius: 4, background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}35`, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{statusStyle.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.6rem', color: t.text3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.branch_name || '—'}{isTakeover ? ' · Takeover' : ''}{item.bill_no ? ` · #${item.bill_no}` : ''}
          </span>
          <span style={{ fontSize: '.6rem', color: t.text4, fontFamily: 'ui-monospace,monospace', flexShrink: 0 }}>{fmtTime(item.txn_time)}</span>
          {wt > 0 && <span style={{ fontSize: '.6rem', color: t.text2, fontFamily: 'ui-monospace,monospace', flexShrink: 0 }}>{fmtWt(wt)}</span>}
          {item.amount && <span style={{ fontSize: '.62rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 600, flexShrink: 0 }}>{fmtAmt(item.amount)}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="tl-row" style={{ display: 'grid', gridTemplateColumns: '70px 28px 1fr 110px 120px', gap: '0 12px', ...rowBase, alignItems: 'center' }}
      onMouseEnter={e => e.currentTarget.style.background = t.card2}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.66rem', color: t.text3, textAlign: 'right', lineHeight: 1 }}>{fmtTime(item.txn_time)}</span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: '.75rem', lineHeight: 1 }}>📋</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accentColor, display: 'block', boxShadow: `0 0 5px ${accentColor}60` }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.78rem', color: t.text1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{item.cust_name || 'Unknown'}</span>
          <span style={{ fontSize: '.56rem', padding: '2px 7px', borderRadius: 4, background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}35`, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{statusStyle.label}</span>
          {isTakeover && <span style={{ fontSize: '.52rem', padding: '2px 6px', borderRadius: 4, background: `${t.gold}12`, color: t.gold, border: `1px solid ${t.gold}25`, fontWeight: 600, whiteSpace: 'nowrap' }}>Takeover</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          {item.branch_name && <span style={{ fontSize: '.62rem', color: t.text3 }}>{item.branch_name}</span>}
          {item.cust_mobile && <span style={{ fontSize: '.6rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>{item.cust_mobile}</span>}
          {item.bill_no && <span style={{ fontSize: '.58rem', color: t.gold, fontFamily: 'ui-monospace, monospace', opacity: .7 }}>#{item.bill_no}</span>}
        </div>
      </div>
      <span className="tl-wt" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.72rem', color: wt > 0 ? t.text1 : t.text4, textAlign: 'right', fontWeight: wt > 0 ? 500 : 400 }}>{wt > 0 ? fmtWt(wt) : '—'}</span>
      <span className="tl-amt" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.74rem', color: item.status === 'FINAL_PAYMENT_COMPLETED' && item.amount ? t.gold : t.text4, textAlign: 'right', fontWeight: item.status === 'FINAL_PAYMENT_COMPLETED' && item.amount ? 600 : 400 }}>{item.amount ? fmtAmt(item.amount) : '—'}</span>
    </div>
  )
}
