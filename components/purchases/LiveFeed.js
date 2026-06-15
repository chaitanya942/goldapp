'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useApp, useRegionAccess } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { istToday } from '../../lib/dateIst'
import { getCache, setCache } from '../../lib/moduleCache'

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

const STATUS_STYLE = {
  approved: { color: '#3aaa6a', label: 'Approved' },
  rejected: { color: '#e05555', label: 'Rejected' },
  pending:  { color: '#e09830', label: 'Pending' },
}


const csvSum = str => String(str || '').split(',').reduce((s, v) => { const n = parseFloat(v.trim()); return s + (isNaN(n) ? 0 : n) }, 0)

const csvVals = str => String(str || '').split(',').map(v => parseFloat(v.trim())).filter(n => !isNaN(n))

function wtdAvgPurity(grmsWetCsv, purityCsv) {
  const wts = csvVals(grmsWetCsv)
  const pur = csvVals(purityCsv)
  if (!wts.length || !pur.length) return null
  let totalWt = 0, totalWtdPur = 0
  wts.forEach((w, i) => {
    const p = pur[i] ?? pur[pur.length - 1] // fallback to last if mismatched
    if (w > 0 && p > 0) { totalWt += w; totalWtdPur += w * p }
  })
  return totalWt > 0 ? totalWtdPur / totalWt : null
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
  const isToday = viewDate === todayIST
  const [crmTab,        setCrmTab]        = useState('old')
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
  const load = useCallback(async (date) => {
    const d = date || viewDate
    const seq = ++loadSeqRef.current
    try {
      setLoading(true)
      setLoadError(null)
      const res = await authedFetch(`/api/crm-purchases?action=live&date=${d}`)
      const json = await res.json()
      if (seq !== loadSeqRef.current) return  // superseded by a newer load
      if (json.error) throw new Error(json.error)
      setCache(`livefeed:${d}`, json)
      setData(json)
      setLastUpdated(new Date())
    } catch (e) {
      if (seq !== loadSeqRef.current) return
      console.error('LiveFeed load error:', e)
      setLoadError(e.message)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [viewDate])

  /* ── Auto-refresh ── */
  useEffect(() => {
    load()
    if (!isToday) return  // historical dates: no auto-refresh
    timerRef.current = setInterval(() => load(), REFRESH_SECS * 1000)
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
    const count = (data.todayTxns?.length || 0) + (data.todayWalkins?.length || 0) + (data.newCrmTxns?.length || 0)
    const prev = prevTlCountRef.current
    if (prev > 0 && count > prev) setNewEventCount(count - prev)
    prevTlCountRef.current = count
  }, [data])

  /* ── Derived ── */
  const summary = data?.summary || {}
  const walkinSummary = data?.walkinSummary || {}
  const stages = data?.stages || null
  const todayTxns    = data?.todayTxns    || []
  const todayWalkins = data?.todayWalkins || []
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
  const goldPipeline = data?.goldPipeline || {}
  const kycRows      = data?.kycRows      || []
  const takeoverRows = data?.takeoverRows || []
  const newCrmTxns   = data ? (data.newCrmTxns ?? null) : null  // null = offline
  const newCrmError  = data?.newCrmError || null

  // Region-filtered raw rows
  const rTxns    = regionFilter ? todayTxns.filter(tx => tx.region === regionFilter)   : todayTxns
  const rWalkins = regionFilter ? todayWalkins.filter(w => w.region === regionFilter)  : todayWalkins

  // Mobile sets for cross-table deduplication (region-scoped)
  const rApprovedMobiles = new Set(rTxns.filter(t => t.trxn_status === 'approved').map(t => t.cust_mobile).filter(Boolean))
  const rBilledMobiles   = new Set(rTxns.map(t => t.cust_mobile).filter(Boolean))
  const rKycRows     = regionFilter ? kycRows.filter(r => r.region === regionFilter) : kycRows
  const rKycMobiles  = new Set(rKycRows.map(r => r.mob_num).filter(Boolean))

  // All counts — always derive from row data for consistency
  const totalWalkins = regionFilter ? rWalkins.length : (walkinSummary.total || 0)
  const approved     = regionFilter ? rTxns.filter(t => t.trxn_status === 'approved').length : (summary.approved || 0)
  const pending      = regionFilter ? rTxns.filter(t => t.trxn_status === 'pending').length  : (summary.pending  || 0)
  const rejected     = regionFilter ? rTxns.filter(t => t.trxn_status === 'rejected').length : (summary.rejected || 0)
  const totalBilled  = approved + pending + rejected

  // True rejected (excluding wrong entries that later got approved)
  const trueRejected = regionFilter
    ? rTxns.filter(t => t.trxn_status === 'rejected' && !rApprovedMobiles.has(t.cust_mobile)).length
    : (summary.true_rejected ?? rejected)
  const wrongEntry = regionFilter ? (rejected - trueRejected) : (summary.wrong_entry || 0)

  // Truly unbilled walkins — exclude billed AND KYC-blocked (to avoid weight double-count)
  const notBilledWalkins  = rWalkins.filter(w => !rBilledMobiles.has(w.cust_mobile) && !rKycMobiles.has(w.cust_mobile))
  const notBilledCnt      = regionFilter ? notBilledWalkins.length : (goldPipeline.not_billed_cnt ?? notBilledWalkins.length)
  const crmNotUpdatedCnt  = regionFilter
    ? rWalkins.filter(w => (!w.walkin_status || w.walkin_status === '') && rBilledMobiles.has(w.cust_mobile)).length
    : (goldPipeline.crm_not_updated_cnt || 0)

  const effectiveSummary = regionFilter ? {
    ...summary,
    total: totalBilled, approved, pending, rejected,
    approved_value: rTxns.filter(t => t.trxn_status === 'approved').reduce((s, t) => s + (Number(t.amount) || 0), 0),
  } : summary

  const effectiveWalkinSummary = regionFilter ? {
    total: totalWalkins,
    sold:             rWalkins.filter(w => w.walkin_status === 'sold').length,
    visited_not_sold: rWalkins.filter(w => w.walkin_status === 'visited not sold').length,
    no_update:        rWalkins.filter(w => !w.walkin_status || w.walkin_status === '').length,
    total_gold_wt:    rWalkins.reduce((s, w) => s + (Number(w.gms_weight) || 0), 0).toFixed(2),
    missing_weight_count: rWalkins.filter(w => !w.gms_weight || Number(w.gms_weight) === 0).length,
  } : walkinSummary

  const effectiveGoldPipeline = regionFilter ? {
    walked_in_wt:    rWalkins.reduce((s, w) => s + (Number(w.gms_weight) || 0), 0),
    purchased_wt:    rTxns.filter(t => t.trxn_status === 'approved').reduce((s, t) => s + csvSum(t.grms_wet_csv), 0),
    pending_wt:      rTxns.filter(t => t.trxn_status === 'pending').reduce((s, t)  => s + csvSum(t.grms_wet_csv), 0),
    // Only truly rejected weight (exclude wrong entries that got re-approved)
    rejected_wt:     rTxns.filter(t => t.trxn_status === 'rejected' && !rApprovedMobiles.has(t.cust_mobile)).reduce((s, t) => s + csvSum(t.grms_wet_csv), 0),
    rejected_cnt:    trueRejected,
    wrong_entry_cnt: wrongEntry,
    // Only walkins with no bill at all today
    not_billed_wt:   notBilledWalkins.reduce((s, w) => s + (Number(w.gms_weight) || 0), 0),
    not_billed_cnt:  notBilledCnt,
    crm_not_updated_cnt: crmNotUpdatedCnt,
    // KYC — region-filtered
    kyc_blacklisted_cnt: rKycRows.length,
    kyc_blacklisted_wt:  parseFloat(rKycRows.reduce((s, r) => s + (parseFloat(r.grams) || 0), 0).toFixed(2)),
    kyc_overridden_cnt:  rKycRows.filter(r => rApprovedMobiles.has(r.mob_num)).length,
    physical:  goldPipeline.physical  || {},
    released:  goldPipeline.released  || {},
  } : goldPipeline

  /* ── Timeline items ── */
  const timelineItems = useMemo(() => {
    const items = []
    todayTxns.forEach(tx => {
      items.push({
        type: 'txn', time: tx.time, id: `txn-${tx.id}`,
        name: tx.cust_name, mobile: tx.cust_mobile, branch: tx.branch_name, region: tx.region,
        status: tx.trxn_status, amount: tx.amount, bill: tx.bill_no,
        goldType: tx.type_gold, weight: csvSum(tx.grms_wet_csv), payment: tx.pymt_mde, remark: tx.txn_rmrk,
      })
    })
    todayWalkins.forEach(w => {
      items.push({
        type: 'walkin', time: w.time, id: `wk-${w.id}`,
        name: w.cust_name, mobile: w.cust_mobile, branch: w.branch_name, region: w.region,
        walkinStatus: w.walkin_status, itemType: w.item_type, weight: w.gms_weight,
        reason: w.walk_reason, source: w.source,
      })
    })
    items.sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    return items
  }, [todayTxns, todayWalkins])

  const filteredTimeline = regionFilter
    ? timelineItems.filter(item => item.region === regionFilter)
    : timelineItems

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
        {/* Row 1: label + tabs + date + refresh */}
        <div style={{ padding: isMobile ? '10px 14px' : '11px 24px', display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16 }}>
          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isToday && (
              <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.green, animation: 'ping 1.5s cubic-bezier(0,0,.2,1) infinite', opacity: .6 }} />
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.green }} />
              </span>
            )}
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: isMobile ? '.72rem' : '.82rem', fontWeight: 600, color: t.text1 }}>
              {isMobile ? 'LIVE' : 'LIVE FEED'}
            </span>
          </div>

          {/* CRM tabs */}
          {(canSee('livefeed.old_crm_tab') || canSee('livefeed.new_crm_tab') || canSee('livefeed.combined_tab')) && (
            <div style={{ display: 'flex', background: t.card, borderRadius: 8, border: `1px solid ${t.border}`, overflow: 'hidden' }}>
              {[['old', isMobile ? 'Old' : 'Old CRM'], ['new', isMobile ? 'New' : 'New CRM'], ['combined', 'Both']].filter(([key]) => {
                if (key === 'old')      return canSee('livefeed.old_crm_tab')
                if (key === 'new')      return canSee('livefeed.new_crm_tab')
                if (key === 'combined') return canSee('livefeed.combined_tab')
                return false
              }).map(([key, label]) => (
                <button key={key} onClick={() => { setCrmTab(key); setNewEventCount(0) }} style={{
                  padding: isMobile ? '6px 10px' : '6px 16px', fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase',
                  fontWeight: crmTab === key ? 600 : 400, cursor: 'pointer', border: 'none',
                  background: crmTab === key ? t.gold : 'transparent',
                  color: crmTab === key ? '#000' : t.text3, transition: 'all .2s',
                }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Date picker */}
          {canSee('livefeed.date_picker') && (
            <input type="date" value={viewDate}
              onChange={e => { const nd = e.target.value; setViewDate(nd); setRegionFilter(''); setNewEventCount(0); setData(getCache(`livefeed:${nd}`) ?? null) }}
              style={{ background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '5px 8px', fontSize: '.68rem', fontFamily: 'ui-monospace, monospace', outline: 'none', cursor: 'pointer', maxWidth: isMobile ? 130 : 'none' }}
            />
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
            Historical view — {fmtDate(viewDate)}
          </span>
          <span style={{ fontSize: '.62rem', color: t.text4 }}>Auto-refresh paused · showing data as of end of day</span>
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
        ) : crmTab === 'old' ? (
          <div style={{ opacity: loading && data ? 0.6 : 1, transition: 'opacity .3s' }}>
            <OldCrmTab t={t} isMobile={isMobile} summary={effectiveSummary} walkinSummary={effectiveWalkinSummary}
              totalWalkins={totalWalkins} totalBilled={totalBilled} approved={approved} pending={pending}
              trueRejected={trueRejected} wrongEntry={wrongEntry}
              notBilledCnt={notBilledCnt} notBilledWalkins={notBilledWalkins} crmNotUpdatedCnt={crmNotUpdatedCnt}
              goldPipeline={effectiveGoldPipeline}
              todayTxns={rTxns} todayWalkins={rWalkins}
              allTxns={todayTxns} allWalkins={todayWalkins} allKycRows={kycRows} regions={regions}
              kycRows={regionFilter ? kycRows.filter(r => r.region === regionFilter) : kycRows}
              takeoverRows={takeoverRows}
              regionFilter={regionFilter}
              filteredTimeline={filteredTimeline} isToday={isToday}
              viewDate={viewDate}
              newEventCount={newEventCount} clearNewEvents={() => setNewEventCount(0)} />
          </div>
        ) : crmTab === 'new' ? (
          <div style={{ opacity: loading && data ? 0.6 : 1, transition: 'opacity .3s' }}>
            <NewCrmTab t={t} stages={stages} newCrmTxns={newCrmTxns} newCrmError={newCrmError}
              regionFilter={regionFilter} regions={regions}
              viewDate={viewDate} isToday={isToday}
              newEventCount={newEventCount} clearNewEvents={() => setNewEventCount(0)} />
          </div>
        ) : (
          <div style={{ opacity: loading && data ? 0.6 : 1, transition: 'opacity .3s' }}>
            <CombinedCrmTab
              t={t}
              /* Old CRM props */
              summary={effectiveSummary} walkinSummary={effectiveWalkinSummary}
              totalWalkins={totalWalkins} totalBilled={totalBilled} approved={approved} pending={pending}
              trueRejected={trueRejected} wrongEntry={wrongEntry}
              notBilledCnt={notBilledCnt} notBilledWalkins={notBilledWalkins} crmNotUpdatedCnt={crmNotUpdatedCnt}
              goldPipeline={effectiveGoldPipeline}
              todayTxns={rTxns} todayWalkins={rWalkins}
              allTxns={todayTxns} allWalkins={todayWalkins} allKycRows={kycRows} regions={regions}
              kycRows={regionFilter ? kycRows.filter(r => r.region === regionFilter) : kycRows}
              takeoverRows={takeoverRows}
              regionFilter={regionFilter}
              filteredTimeline={filteredTimeline}
              /* New CRM props */
              stages={stages} newCrmTxns={newCrmTxns} newCrmError={newCrmError}
              /* Shared */
              isToday={isToday} viewDate={viewDate}
              newEventCount={newEventCount} clearNewEvents={() => setNewEventCount(0)} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════ */
/*                       COMBINED TAB                            */
/* ════════════════════════════════════════════════════════════════ */
function CombinedCrmTab({
  t,
  // Old CRM
  summary, walkinSummary,
  totalWalkins, totalBilled, approved, pending,
  trueRejected, wrongEntry,
  notBilledCnt, notBilledWalkins, crmNotUpdatedCnt,
  goldPipeline,
  todayTxns, todayWalkins, allTxns, allWalkins, allKycRows, regions,
  kycRows, takeoverRows, regionFilter,
  filteredTimeline,
  // New CRM
  stages, newCrmTxns, newCrmError,
  // Shared
  isToday, viewDate, newEventCount, clearNewEvents,
}) {
  const approvedValue  = summary?.approved_value || 0
  const newCompleted   = (newCrmTxns || []).filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED')
  const newCompletedVal = newCompleted.reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
  const newTotal        = (newCrmTxns || []).length
  const combinedValue = approvedValue + newCompletedVal

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Combined summary bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12,
        padding: 0, overflow: 'hidden', flexWrap: 'wrap',
        boxShadow: '0 2px 8px rgba(0,0,0,.10)',
      }}>
        {/* Walk-ins (Old CRM) */}
        <div className="sum-bar-item" style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 18px', borderRight:`1px solid ${t.border}`, borderLeft:`3px solid ${t.blue}` }}>
          <span style={{ fontSize:'.75rem', fontFamily:'ui-monospace,monospace', fontWeight:600, color:t.blue }}>{fmtNum(totalWalkins)}</span>
          <span style={{ fontSize:'.58rem', color:t.text4, letterSpacing:'.08em', textTransform:'uppercase' }}>Walk-ins (Old)</span>
        </div>

        {/* Old CRM Billed */}
        <div className="sum-bar-item" style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 18px', borderRight:`1px solid ${t.border}`, borderLeft:`3px solid ${t.gold}` }}>
          <span style={{ fontSize:'.75rem', fontFamily:'ui-monospace,monospace', fontWeight:600, color:t.gold }}>{fmtNum(totalBilled)}</span>
          <span style={{ fontSize:'.58rem', color:t.text4, letterSpacing:'.08em', textTransform:'uppercase' }}>Old CRM Billed</span>
        </div>

        {/* New CRM Total */}
        <div className="sum-bar-item" style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 18px', borderRight:`1px solid ${t.border}`, borderLeft:`3px solid ${t.blue}` }}>
          <span style={{ fontSize:'.75rem', fontFamily:'ui-monospace,monospace', fontWeight:600, color:t.blue }}>{fmtNum(newTotal)}</span>
          <span style={{ fontSize:'.58rem', color:t.text4, letterSpacing:'.08em', textTransform:'uppercase' }}>New CRM Total</span>
        </div>

        {/* Combined Value */}
        <div className="sum-bar-item" style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 18px', borderRight:`1px solid ${t.border}`, borderLeft:`3px solid ${t.green}` }}>
          <span style={{ fontSize:'.75rem', fontFamily:'ui-monospace,monospace', fontWeight:600, color:t.green }}>{fmtAmt(combinedValue)}</span>
          <span style={{ fontSize:'.58rem', color:t.text4, letterSpacing:'.08em', textTransform:'uppercase' }}>Combined Value</span>
        </div>

      </div>

      {/* ── Old CRM section ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 3, height: 20, borderRadius: 2, background: t.gold }} />
          <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: t.gold }}>Old CRM</span>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${t.gold}30,transparent)` }} />
        </div>
        <OldCrmTab
          t={t} summary={summary} walkinSummary={walkinSummary}
          totalWalkins={totalWalkins} totalBilled={totalBilled} approved={approved} pending={pending}
          trueRejected={trueRejected} wrongEntry={wrongEntry}
          notBilledCnt={notBilledCnt} notBilledWalkins={notBilledWalkins} crmNotUpdatedCnt={crmNotUpdatedCnt}
          goldPipeline={goldPipeline}
          todayTxns={todayTxns} todayWalkins={todayWalkins}
          allTxns={allTxns} allWalkins={allWalkins} allKycRows={allKycRows} regions={regions}
          kycRows={kycRows} takeoverRows={takeoverRows} regionFilter={regionFilter}
          filteredTimeline={filteredTimeline} isToday={isToday} viewDate={viewDate}
          newEventCount={newEventCount} clearNewEvents={clearNewEvents} />
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: `linear-gradient(90deg,transparent,${t.border},transparent)` }} />

      {/* ── New CRM section ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 3, height: 20, borderRadius: 2, background: t.blue }} />
          <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: t.blue }}>New CRM</span>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${t.blue}30,transparent)` }} />
        </div>
        <NewCrmTab
          t={t} stages={stages} newCrmTxns={newCrmTxns} newCrmError={newCrmError}
          regionFilter={regionFilter} regions={regions}
          viewDate={viewDate} isToday={isToday}
          newEventCount={newEventCount} clearNewEvents={clearNewEvents} />
      </div>

    </div>
  )
}

/* ════════════════════════════════════════════════════════════════ */
/*                        OLD CRM TAB                            */
/* ════════════════════════════════════════════════════════════════ */
function OldCrmTab({
  t, isMobile, summary, walkinSummary,
  totalWalkins, totalBilled, approved, pending,
  trueRejected, wrongEntry,
  notBilledCnt, notBilledWalkins, crmNotUpdatedCnt,
  goldPipeline,
  todayTxns, todayWalkins, allTxns, allWalkins, allKycRows, regions,
  kycRows, takeoverRows, regionFilter,
  filteredTimeline, isToday,
  newEventCount, clearNewEvents,
}) {
  const { canSee } = useApp()
  const [activeMetric, setActiveMetric] = useState(null)
  const [tlOpen, setTlOpen] = useState(false)
  const [tlSearch, setTlSearch] = useState('')
  const [tlFilter, setTlFilter] = useState('all')
  const toggleMetric = key => setActiveMetric(prev => prev === key ? null : key)


  const approvedValue     = summary.approved_value || 0
  const goldWalkedIn      = parseFloat(goldPipeline?.walked_in_wt)      || parseFloat(walkinSummary.total_gold_wt) || 0
  const goldPurchased     = parseFloat(goldPipeline?.purchased_wt)      || 0
  const goldPending       = parseFloat(goldPipeline?.pending_wt)        || 0
  const goldRejected      = parseFloat(goldPipeline?.rejected_wt)       || 0
  const goldNotBilled     = parseFloat(goldPipeline?.not_billed_wt)     || 0
  const kycBlacklistedCnt = goldPipeline?.kyc_blacklisted_cnt            || 0
  const kycBlacklistedWt  = parseFloat(goldPipeline?.kyc_blacklisted_wt) || 0
  const kycOverriddenCnt  = goldPipeline?.kyc_overridden_cnt             || 0
  const avgGrossWeight    = approved > 0 && goldPurchased > 0 ? goldPurchased / approved : 0
  const billedPct         = totalWalkins > 0 ? Math.round((totalBilled / totalWalkins) * 100) : 0
  const approvedPctBilled = totalBilled  > 0 ? Math.round((approved   / totalBilled)  * 100) : 0
  const conversionPct     = totalWalkins > 0 ? Math.round((approved   / totalWalkins) * 100) : 0
  const physicalApproved  = goldPipeline?.physical?.approved || 0
  const releaseApproved   = goldPipeline?.released?.approved || 0

  // Ghost purchases: approved physical bills with NO walk-in entry for this customer today
  const walkinMobiles  = new Set(todayWalkins.map(w => w.cust_mobile).filter(Boolean))
  const ghostPurchases = todayTxns.filter(t =>
    t.trxn_status === 'approved' &&
    t.type_gold !== 'released' &&
    t.cust_mobile && !walkinMobiles.has(t.cust_mobile)
  )
  const ghostCount = ghostPurchases.length

  const hasData = totalWalkins > 0 || totalBilled > 0

  if (!hasData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
        <span style={{ fontSize: '2rem', opacity: .3 }}>~</span>
        <span style={{ fontSize: '.82rem', color: t.text3 }}>No activity recorded yet</span>
        <span style={{ fontSize: '.62rem', color: t.text4 }}>Data will appear as walk-ins and transactions come in</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ──────── 1. CUSTOMER JOURNEY ──────── */}
      {canSee('livefeed.customer_journey') && <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
        <SectionLabel t={t}>Customer Journey · from Walk-in to Outcome</SectionLabel>

        {/* ── Funnel progress bar ── */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', height:8, borderRadius:100, overflow:'hidden', gap:1, boxShadow:`0 2px 8px rgba(0,0,0,.12)` }}>
            <div style={{ width:`${billedPct}%`, background:`linear-gradient(90deg,${t.blue},${t.gold})`, borderRadius:'100px 0 0 100px', transition:'width .8s ease', boxShadow:`0 0 12px ${t.gold}80`, minWidth: billedPct > 0 ? 4 : 0 }}/>
            <div style={{ width:`${Math.max(conversionPct - billedPct, 0)}%`, background:`linear-gradient(90deg,${t.gold},${t.green})`, transition:'width .8s ease', minWidth: conversionPct > billedPct ? 4 : 0 }}/>
            <div style={{ flex:1, background:t.border, borderRadius:'0 100px 100px 0', opacity:.5 }}/>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, padding:'0 2px' }}>
            <span style={{ fontSize:'.5rem', color:t.blue, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase' }}>Walk-in → Billed: {billedPct}%</span>
            <span style={{ fontSize:'.5rem', color:t.green, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase' }}>Overall conversion: {conversionPct}%</span>
          </div>
        </div>

        {/* ── Main hero panel ── */}
        <div className="lf-hero" style={{
          position:'relative', overflow:'hidden',
          display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 12 : 0, flexWrap: isMobile ? undefined : 'wrap',
          background: `linear-gradient(160deg, ${t.surface} 0%, ${t.card} 50%, ${t.surface} 100%)`,
          borderRadius: 16,
          border: `1px solid ${t.border}`,
          padding: isMobile ? '16px' : '32px 20px 24px',
          boxShadow: `0 8px 32px rgba(0,0,0,.10), 0 1px 0 ${t.border} inset`,
        }}>
          {/* Subtle radial glow top-right */}
          <div style={{ position:'absolute', top:-60, right:-60, width:260, height:260, borderRadius:'50%', background:`radial-gradient(circle, ${t.gold}0a 0%, transparent 70%)`, pointerEvents:'none' }}/>
          {/* Bottom accent line */}
          <div style={{ position:'absolute', bottom:0, left:'10%', right:'10%', height:1, background:`linear-gradient(90deg,transparent,${t.gold}30,transparent)` }}/>

          <HeroNum label="Walked In" value={totalWalkins} color={t.blue} t={t} weight={goldWalkedIn} active={activeMetric==='walkin'} onClick={() => toggleMetric('walkin')} />
          {!isMobile && <FlowArrow t={t} pct={billedPct} />}
          <HeroNum label="Bills Submitted" value={totalBilled} color={t.gold} t={t} weight={goldPurchased+goldPending+goldRejected} active={activeMetric==='billed'} onClick={() => toggleMetric('billed')} />
          {!isMobile && <FlowArrow t={t} pct={approvedPctBilled} />}

          {/* ── Breakdown stage ── */}
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
              <span style={{ fontSize:'.52rem', letterSpacing:'.14em', textTransform:'uppercase', color:'#0a0a0a', fontWeight:900 }}>breakdown of {fmtNum(totalBilled)}</span>
            </div>
            <div style={{ position:'relative', display: isMobile ? 'grid' : 'flex', gridTemplateColumns: isMobile ? '1fr 1fr' : undefined, alignItems: isMobile ? undefined : 'center', gap: isMobile ? 8 : 8 }}>
              {[
                { node: <HeroNum label="Purchased" value={approved} color={t.green} t={t} weight={goldPurchased} active={activeMetric==='purchased'} onClick={() => toggleMetric('purchased')} />, color: t.green },
                { node: <HeroNum label="In Pipeline" value={pending} color={t.orange} t={t} small weight={goldPending} active={activeMetric==='pending'} onClick={() => toggleMetric('pending')} />, color: t.orange },
                { node: <HeroNum label="Bill Rejected" value={trueRejected} color={t.red} t={t} small weight={goldRejected} active={activeMetric==='rejected'} onClick={() => toggleMetric('rejected')} />, color: t.red },
                { node: <HeroNum label="Re-billed & Approved" value={wrongEntry} color={t.orange} t={t} small active={activeMetric==='rebilled'} onClick={() => toggleMetric('rebilled')} />, color: t.orange },
              ].map((item, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {!isMobile && i > 0 && <FlowSep t={t} />}
                  <div style={{
                    background:`linear-gradient(160deg, ${t.card2} 0%, ${t.card} 100%)`,
                    border:`1px solid ${item.color}30`,
                    borderTop:`2px solid ${item.color}70`,
                    borderRadius:14,
                    boxShadow:`0 8px 24px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.10), inset 0 1px 0 ${item.color}18`,
                    transform: isMobile ? 'none' : 'translateY(-5px)',
                    width: isMobile ? '100%' : undefined,
                  }}>
                    {item.node}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <FlowSep t={t} />
          {/* ── Secondary outcomes box ── */}
          <div style={{
            position:'relative',
            background:`linear-gradient(160deg, ${t.bg} 0%, ${t.card} 60%, ${t.bg} 100%)`,
            border:`1px solid ${t.border2}`,
            borderRadius:18,
            boxShadow:`0 4px 20px rgba(0,0,0,.10), inset 0 1px 0 ${t.border}`,
            padding:'18px 12px 10px',
          }}>
            <div style={{ position:'absolute', top:-11, left:'50%', transform:'translateX(-50%)', background:t.card2, border:`1px solid ${t.border2}`, borderRadius:20, padding:'3px 12px', whiteSpace:'nowrap' }}>
              <span style={{ fontSize:'.46rem', letterSpacing:'.12em', textTransform:'uppercase', color:t.text4, fontWeight:700 }}>other outcomes</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              <HeroNum label="KYC Blocked" value={kycBlacklistedCnt} color={t.purple} t={t} small weight={kycBlacklistedWt} active={activeMetric==='kyc_blocked'} onClick={() => toggleMetric('kyc_blocked')} />
              {kycOverriddenCnt > 0 && <FlowSep t={t} />}
              {kycOverriddenCnt > 0 && <HeroNum label="KYC Cleared Later" value={kycOverriddenCnt} color={t.blue} t={t} small active={activeMetric==='kyc_cleared'} onClick={() => toggleMetric('kyc_cleared')} />}
              <FlowSep t={t} />
              <HeroNum label="Left Unbilled" value={notBilledCnt} color={t.text3} t={t} small muted weight={goldNotBilled} active={activeMetric==='unbilled'} onClick={() => toggleMetric('unbilled')} />
            </div>
          </div>
        </div>

        {/* ── Stats ribbon ── */}
        <div style={{ display:'flex', gap:0, marginTop:10, background:t.card, border:`1px solid ${t.border}`, borderRadius:14, overflow:'hidden', flexWrap:'wrap', boxShadow:`0 2px 8px rgba(0,0,0,.08)` }}>
          {[
            { label:'Walk → Bill',          value:`${billedPct}%`,         color:t.gold,   key: null },
            { label:'Bill → Purchase',      value:`${approvedPctBilled}%`, color:t.green,  key: null },
            { label:'Walk-in → Purchase',   value:`${conversionPct}%`,     color:t.blue,   key: null },
            ...(crmNotUpdatedCnt > 0? [{ label:'CRM not updated', value:crmNotUpdatedCnt, color:t.red,    key:'crm_not_updated' }] : []),
          ].map((s, i) => {
            const isActive = activeMetric === s.key
            const clickable = !!s.key
            return (
              <div key={i}
                onClick={clickable ? () => toggleMetric(s.key) : undefined}
                style={{
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  padding:'14px 24px', borderRight:`1px solid ${t.border}`,
                  gap:4, minWidth:110, flex:1,
                  borderTop:`3px solid ${s.color}`,
                  background: isActive ? `${s.color}18` : `linear-gradient(180deg, ${s.color}08 0%, transparent 60%)`,
                  cursor: clickable ? 'pointer' : 'default',
                  transition: 'background .15s',
                  outline: isActive ? `1.5px solid ${s.color}40` : 'none',
                  outlineOffset: -1,
                  position: 'relative',
                }}>
                {clickable && <span style={{ position:'absolute', top:5, right:8, fontSize:'.44rem', color:s.color, opacity:.6, letterSpacing:'.06em' }}>{isActive ? '▲ active' : '▼ click'}</span>}
                <span style={{ fontSize:'1.6rem', fontWeight:200, fontFamily:'ui-monospace,monospace', color:s.color, letterSpacing:'-.04em', lineHeight:1 }}>{s.value}</span>
                <span style={{ fontSize:'.5rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700, marginTop:2 }}>{s.label}</span>
              </div>
            )
          })}
          {activeMetric && (
            <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', padding:'0 16px' }}>
              <button onClick={() => setActiveMetric(null)} style={{ padding:'4px 12px', borderRadius:20, fontSize:'.58rem', cursor:'pointer', border:`1px solid ${t.border}`, background:t.card2, color:t.text3 }}>
                Clear filter ✕
              </button>
            </div>
          )}
        </div>
      </div>}

      {/* ──────── 1b. WALK-IN DISPOSITION ──────── */}
      {canSee('livefeed.customer_journey') && totalWalkins > 0 && (() => {
        // Source: customer_walkin.walkin_status — what staff recorded in the CRM walk-in register
        // This is independent of bills box (transac_tbl) — gaps between the two are the insight
        const wSold     = walkinSummary?.sold             || 0   // walkin_status='sold'
        const wNotSold  = walkinSummary?.visited_not_sold || 0   // walkin_status='visited not sold'
        const wKyc      = kycBlacklistedCnt                      // in rejctd_tbl
        const wNoUpdate = crmNotUpdatedCnt                       // billed but status not set
        const wNoBill   = notBilledCnt                           // no bill + not KYC
        const accounted = wSold + wNotSold + wKyc + wNoUpdate + wNoBill
        const wOther    = Math.max(0, totalWalkins - accounted)

        const segments = [
          { label: 'Marked sold',         sublabel: 'Staff updated status in CRM',    count: wSold,     color: t.green,  key: 'walkin'          },
          { label: 'Visited, not sold',   sublabel: 'Staff marked as not sold',       count: wNotSold,  color: t.orange, key: null              },
          { label: 'KYC blocked',         sublabel: 'Flagged at KYC verification',    count: wKyc,      color: t.purple, key: 'kyc_blocked'     },
          { label: 'Status not updated',  sublabel: 'Billed but CRM not updated',     count: wNoUpdate, color: t.red,    key: 'crm_not_updated' },
          { label: 'Left without bill',   sublabel: 'No transaction raised',          count: wNoBill,   color: t.text4,  key: 'unbilled'        },
          ...(wOther > 0 ? [{ label: 'Other', sublabel: '', count: wOther, color: t.border, key: null }] : []),
        ].filter(s => s.count > 0)

        return (
          <div style={{ position:'relative', background:`linear-gradient(160deg, ${t.bg} 0%, ${t.card} 60%, ${t.bg} 100%)`, border:`1.5px solid ${t.border2}`, borderRadius:20, boxShadow:`0 4px 20px rgba(0,0,0,.10), inset 0 1px 0 ${t.border}`, padding:'22px 16px 16px', marginTop:2 }}>
            {/* ambient glow */}
            <div style={{ position:'absolute', inset:-1, borderRadius:20, background:`radial-gradient(ellipse at 50% 0%, ${t.border2}60 0%, transparent 65%)`, pointerEvents:'none' }}/>
            {/* floating label */}
            <div style={{ position:'absolute', top:-13, left:'50%', transform:'translateX(-50%)', background:t.card2, border:`1px solid ${t.border2}`, borderRadius:20, padding:'4px 16px', whiteSpace:'nowrap', boxShadow:`0 2px 8px rgba(0,0,0,.12)` }}>
              <span style={{ fontSize:'.48rem', letterSpacing:'.14em', textTransform:'uppercase', color:t.text3, fontWeight:700 }}>breakdown of {fmtNum(totalWalkins)} walk-ins</span>
            </div>

            {/* Proportion bar */}
            <div style={{ display:'flex', height:5, borderRadius:100, overflow:'hidden', gap:1, marginBottom:14, position:'relative' }}>
              {segments.map((s, i) => (
                <div key={i} onClick={s.key ? () => toggleMetric(s.key) : undefined} style={{
                  width:`${(s.count / totalWalkins) * 100}%`, background:s.color, minWidth:2,
                  cursor:s.key ? 'pointer' : 'default',
                  opacity: activeMetric && activeMetric !== s.key ? .2 : 1,
                  transition:'opacity .2s',
                  borderRadius: i === 0 ? '100px 0 0 100px' : i === segments.length-1 ? '0 100px 100px 0' : 0,
                }} />
              ))}
            </div>

            {/* Cards row */}
            <div style={{ position:'relative', display:'flex', alignItems:'stretch', gap:8, flexWrap:'wrap' }}>
              {segments.map((s, i) => {
                const isActive = activeMetric === s.key
                return (
                  <div key={i}
                    onClick={s.key ? () => toggleMetric(s.key) : undefined}
                    style={{
                      flex:1, minWidth:100,
                      border:`1px solid ${s.color}25`,
                      borderTop:`2px solid ${isActive ? s.color : s.color + '80'}`,
                      borderRadius:12,
                      boxShadow: isActive
                        ? `0 0 0 1.5px ${s.color}40, 0 8px 24px rgba(0,0,0,.14), inset 0 1px 0 ${s.color}20`
                        : `0 4px 12px rgba(0,0,0,.10), inset 0 1px 0 ${s.color}10`,
                      padding:'12px 14px 10px',
                      cursor: s.key ? 'pointer' : 'default',
                      transform: isActive ? 'translateY(-3px)' : 'translateY(0)',
                      transition:'all .18s ease',
                      background: isActive ? `linear-gradient(160deg, ${s.color}10 0%, ${t.card} 100%)` : `linear-gradient(160deg, ${t.card2} 0%, ${t.card} 100%)`,
                    }}>
                    <div style={{ fontSize:'1.4rem', fontWeight:200, fontFamily:'ui-monospace,monospace', color:s.color, lineHeight:1, letterSpacing:'-.03em' }}>{fmtNum(s.count)}</div>
                    <div style={{ fontSize:'.6rem', fontWeight:600, color:s.color, marginTop:4, letterSpacing:'.02em' }}>{s.label}</div>
                    <div style={{ fontSize:'.5rem', color:t.text4, marginTop:2, lineHeight:1.4 }}>{s.sublabel}</div>
                    <div style={{ marginTop:8, height:2, borderRadius:2, background:t.border, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${Math.round((s.count/totalWalkins)*100)}%`, background:s.color, borderRadius:2, transition:'width .6s ease' }}/>
                    </div>
                    <div style={{ fontSize:'.44rem', color:t.text4, marginTop:3, textAlign:'right' }}>{Math.round((s.count/totalWalkins)*100)}%</div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ──────── 1c. BRANCH PULSE — plain-English insights ──────── */}
      {canSee('livefeed.customer_journey') && totalWalkins > 0 && (() => {
        const wSoldCRM   = walkinSummary?.sold || 0   // what staff marked as sold in CRM walk-in register
        const crmGap     = approved - wSoldCRM         // approved bills vs staff-marked-sold gap
        const walkoutPct = totalWalkins > 0 ? Math.round((notBilledCnt / totalWalkins) * 100) : 0
        const closingRate = totalBilled > 0 ? Math.round((approved / totalBilled) * 100) : 0
        const insights = []

        // 1 — Ghost purchases: billed but not in walk-in register at all
        if (ghostCount > 0) insights.push({
          icon: '👻', color: t.red, metric: 'ghost_purchases',
          headline: `${ghostCount} purchase${ghostCount > 1 ? 's' : ''} with no walk-in entry`,
          detail: `Billed and approved, but no walk-in entry exists. Sale is unregistered in CRM.`,
        })

        // 2 — KEY INSIGHT: CRM register vs actual bills mismatch (beyond ghost)
        if (crmGap > 0) insights.push({
          icon: '⚠', color: t.orange, metric: 'crm_not_updated',
          headline: `${crmGap} walk-in status${crmGap > 1 ? 'es' : ''} not updated`,
          detail: `Walk-in registered + billed & approved, but status never marked "sold" in CRM.`,
        })

        // 2 — Pipeline / follow-up needed
        if (pending > 0) insights.push({
          icon: '🔄', color: t.orange,
          headline: `${pending} bill${pending > 1 ? 's' : ''} in pipeline`,
          detail: `${fmtWt(goldPending)} worth of gold pending approval. Follow up to close before end of day.`,
        })

        // 3 — Walk-out rate signal
        if (walkoutPct >= 40) insights.push({
          icon: '📉', color: t.orange,
          headline: `${walkoutPct}% walk-out rate`,
          detail: `${notBilledCnt} of ${totalWalkins} walk-ins left without a bill. Review branch engagement.`,
        })

        // 4 — KYC blocked
        if (kycBlacklistedCnt > 0) insights.push({
          icon: '🚫', color: t.purple,
          headline: `${kycBlacklistedCnt} customer${kycBlacklistedCnt > 1 ? 's' : ''} KYC flagged`,
          detail: `${kycBlacklistedCnt} walk-in${kycBlacklistedCnt > 1 ? 's' : ''} blocked at KYC today (${fmtWt(kycBlacklistedWt)} held).`,
        })

        // 5 — Takeover (multi-day) cases
        if (releaseApproved > 0) insights.push({
          icon: '🔁', color: t.gold, metric: 'takeover_bills',
          headline: `${releaseApproved} takeover purchase${releaseApproved > 1 ? 's' : ''} completed today`,
          detail: `${releaseApproved} bill${releaseApproved > 1 ? 's' : ''} marked as "released" — customers who pledged gold on an earlier visit and completed final payment today. Click to see original walk-in dates.`,
        })

        // 6 — Strong closing rate
        if (closingRate >= 90) insights.push({
          icon: '💪', color: t.green,
          headline: `${closingRate}% bill-to-purchase rate`,
          detail: `Almost all billed customers are purchasing today. Excellent branch performance.`,
        })

        // 7 — Walk-out low = good
        if (walkoutPct < 40 && walkoutPct > 0) insights.push({
          icon: '✓', color: t.green,
          headline: `${walkoutPct}% walk-out rate`,
          detail: `Only ${notBilledCnt} of ${totalWalkins} customers left without billing. Conversion is healthy.`,
        })

        if (insights.length === 0) return null
        return (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <span style={{ fontSize:'.48rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700, padding:'0 2px' }}>Branch Pulse</span>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {insights.map((ins, i) => (
                <div key={i}
                  onClick={ins.metric ? () => toggleMetric(ins.metric) : undefined}
                  style={{
                    flex:1, minWidth:200,
                    background: activeMetric === ins.metric ? `${ins.color}12` : t.card,
                    border:`1px solid ${activeMetric === ins.metric ? ins.color + '60' : ins.color + '30'}`,
                    borderLeft:`3px solid ${ins.color}`,
                    borderRadius:10,
                    padding:'10px 14px',
                    boxShadow:`0 2px 8px rgba(0,0,0,.08)`,
                    cursor: ins.metric ? 'pointer' : 'default',
                    transition:'background .15s, border .15s',
                    position:'relative',
                  }}>
                  {ins.metric && <span style={{ position:'absolute', top:6, right:8, fontSize:'.44rem', color:ins.color, opacity:.6 }}>{activeMetric === ins.metric ? '▲ active' : '▼ view'}</span>}
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                    <span style={{ fontSize:'.72rem' }}>{ins.icon}</span>
                    <span style={{ fontSize:'.62rem', fontWeight:700, color:ins.color }}>{ins.headline}</span>
                  </div>
                  <div style={{ fontSize:'.56rem', color:t.text3, lineHeight:1.6 }}>{ins.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ──────── 2. GOLD WEIGHT STRIP + REGION TABLE ──────── */}
      {canSee('livefeed.weight_flow') && <div>

        <SectionLabel t={t}>Gold Weight Flow</SectionLabel>
        {/* Compact proportion strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.10)' }}>
          {[
            { key: 'walkin',    label: 'Walked In',    wt: goldWalkedIn,      color: t.blue,   pct: 100 },
            { key: 'purchased', label: 'Purchased',    wt: goldPurchased,     color: t.green,  pct: goldWalkedIn > 0 ? goldPurchased / goldWalkedIn * 100 : 0 },
            { key: 'pending',   label: 'In Pipeline',  wt: goldPending,       color: t.orange, pct: goldWalkedIn > 0 ? goldPending / goldWalkedIn * 100 : 0 },
            { key: 'rejected',  label: 'Rejected Wt',  wt: goldRejected,      color: t.red,    pct: goldWalkedIn > 0 ? goldRejected / goldWalkedIn * 100 : 0 },
            { key: 'kyc_blocked', label: 'KYC Blocked', wt: kycBlacklistedWt, color: t.purple, pct: goldWalkedIn > 0 ? kycBlacklistedWt / goldWalkedIn * 100 : 0 },
            { key: 'unbilled',  label: 'Left Unbilled', wt: goldNotBilled,    color: t.text3,  pct: goldWalkedIn > 0 ? goldNotBilled / goldWalkedIn * 100 : 0 },
          ].map((item, i, arr) => (
            <div key={item.key}
              className="ws-item"
              onClick={() => toggleMetric(item.key)}
              onMouseEnter={e => e.currentTarget.style.background = t.card2}
              onMouseLeave={e => e.currentTarget.style.background = activeMetric === item.key ? `${item.color}0c` : 'transparent'}
              style={{
                flex: 1, minWidth: 'calc(16.667% - 1px)', padding: '12px 14px', cursor: 'pointer',
                borderRight: i < arr.length - 1 ? `1px solid ${t.border}` : 'none',
                borderTop: activeMetric === item.key ? `3px solid ${item.color}` : `3px solid transparent`,
                background: activeMetric === item.key ? `${item.color}0c` : 'transparent',
                transition: 'background .15s, border-top .15s',
              }}>
              <div style={{ fontSize: '.55rem', color: item.color, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: '.95rem', fontFamily: 'ui-monospace,monospace', color: t.text1, fontWeight: 300, marginTop: 4 }}>
                {item.wt > 0 ? fmtWt(item.wt) : '—'}
              </div>
              <div style={{ marginTop: 7, height: 3, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, item.pct)}%`, background: item.color, borderRadius: 2, transition: 'width .6s ease' }} />
              </div>
              <div style={{ fontSize: '.5rem', color: t.text4, marginTop: 3 }}>
                {item.pct > 0 ? `${item.pct.toFixed(0)}% of walked-in` : ''}
              </div>
            </div>
          ))}
        </div>

        {/* Stats + data quality */}
        <div style={{ display: 'flex', gap: 20, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.6rem', color: t.text3 }}>Avg wt/purchase: <strong style={{ color: t.text1, fontFamily: 'ui-monospace,monospace' }}>{avgGrossWeight > 0 ? fmtWt(avgGrossWeight) : '—'}</strong></span>
          <span style={{ fontSize: '.6rem', color: t.text3 }}>Approved value: <strong style={{ color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{fmtAmt(approvedValue)}</strong></span>
          {physicalApproved > 0 && <span style={{ fontSize: '.6rem', color: t.text3 }}>Physical: <strong style={{ color: t.text2 }}>{physicalApproved}</strong></span>}
          {releaseApproved > 0  && <span style={{ fontSize: '.6rem', color: t.text3 }}>Takeover: <strong style={{ color: t.text2 }}>{releaseApproved}</strong></span>}
          <span style={{ fontSize: '.56rem', color: t.text4, marginLeft: 'auto' }}>ⓘ Weights are gross as declared at walk-in · KYC weight excluded from Unbilled</span>
        </div>
      </div>}

      {/* ──────── 3. BRANCH + REGION BREAKDOWN ──────── */}
      {canSee('livefeed.region_breakdown') && !regionFilter && (
        <div className="lf-region" style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {regions && regions.length > 1 && <RegionTable t={t} regions={regions} allTxns={allTxns} allWalkins={allWalkins} allKycRows={allKycRows} />}
        </div>
      )}

      {/* ──────── 4. DETAIL TABLE (shown only when a hero is clicked) ──────── */}
      {canSee('livefeed.detail_table') && activeMetric && (
        <LiveDetail t={t} activeMetric={activeMetric}
          todayTxns={todayTxns} todayWalkins={todayWalkins}
          kycRows={kycRows} notBilledWalkins={notBilledWalkins}
          ghostPurchases={ghostPurchases}
          takeoverRows={takeoverRows} />
      )}

      {/* ──────── 5. LIVE TIMELINE (collapsed by default) ──────── */}
      {canSee('livefeed.timeline') && <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tlOpen ? 10 : 0 }}>
          <SectionLabel t={t}>{isToday ? 'Live Timeline' : 'Timeline'}</SectionLabel>
          <button onClick={() => { setTlOpen(o => !o); clearNewEvents() }} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: '.6rem', cursor: 'pointer',
            border: `1px solid ${newEventCount > 0 ? t.green : t.border}`,
            background: newEventCount > 0 ? `${t.green}14` : t.card,
            color: newEventCount > 0 ? t.green : t.text3,
            marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
            transition: 'all .2s',
          }}>
            {newEventCount > 0 && (
              <span style={{
                background: t.green, color: '#000', borderRadius: 8,
                fontSize: '.52rem', fontWeight: 700, padding: '1px 5px', lineHeight: 1.4,
              }}>+{newEventCount}</span>
            )}
            {tlOpen ? 'Collapse ▲' : 'Expand ▼'}
          </button>
        </div>
        {tlOpen && (
          <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
              {/* Type filter tabs */}
              <div style={{ display: 'flex', background: t.card2, borderRadius: 6, border: `1px solid ${t.border}`, overflow: 'hidden' }}>
                {[['all','All'],['txn','Bills'],['walkin','Walk-ins']].map(([val, lbl]) => (
                  <button key={val} onClick={() => setTlFilter(val)} style={{
                    padding: '4px 10px', fontSize: '.58rem', cursor: 'pointer', border: 'none',
                    background: tlFilter === val ? t.gold : 'transparent',
                    color: tlFilter === val ? '#000' : t.text3,
                    fontWeight: tlFilter === val ? 600 : 400, transition: 'all .15s',
                  }}>{lbl}</button>
                ))}
              </div>
              <input
                type="text" placeholder="Search name, mobile, branch..."
                value={tlSearch} onChange={e => setTlSearch(e.target.value)}
                style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '5px 10px', fontSize: '.62rem', color: t.text2, outline: 'none', flex: 1, minWidth: 0, fontFamily: 'ui-monospace, monospace' }}
              />
              <span style={{ fontSize: '.6rem', color: t.text4, whiteSpace: 'nowrap' }}>{filteredTimeline.filter(item => tlFilter === 'txn' ? item.type === 'txn' : tlFilter === 'walkin' ? item.type === 'walkin' : true).length} events</span>
            </div>
            <div className="tl-row" style={{ display: 'grid', gridTemplateColumns: '70px 28px 1fr 110px 120px', gap: '0 12px', padding: '8px 20px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
              {['Time', '', 'Customer / Branch', 'Weight', 'Amount'].map((h, i) => (
                <span key={i} className={i === 3 ? 'tl-hdr-wt' : i === 4 ? 'tl-hdr-amt' : ''} style={{ fontSize: '.57rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: i >= 3 ? 'right' : i === 0 ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {filteredTimeline.filter(item => {
                if (tlFilter === 'txn'    && item.type !== 'txn')    return false
                if (tlFilter === 'walkin' && item.type !== 'walkin') return false
                if (tlSearch) {
                  const s = tlSearch.toLowerCase()
                  return (item.name||'').toLowerCase().includes(s) || (item.mobile||'').includes(s) || (item.branch||'').toLowerCase().includes(s)
                }
                return true
              }).map((item, i, arr) => (
                <TimelineRow key={item.id} item={item} t={t} isLast={i === arr.length - 1} />
              ))}
            </div>
          </Card>
        )}
      </div>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════ */
/*                      SUB-COMPONENTS                           */
/* ════════════════════════════════════════════════════════════════ */

/* ── Hero Number (clickable) ── */
function HeroNum({ label, value, color, t, small, muted, onClick, active, weight }) {
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
      {weight > 0 && (
        <span style={{
          fontSize: '.55rem', color: active ? `${color}cc` : t.text4,
          fontFamily: 'ui-monospace,monospace', marginTop: 3, letterSpacing: '.04em',
        }}>
          {fmtWt(weight)}
        </span>
      )}
      {active && (
        <span style={{ width: 20, height: 2, borderRadius: 1, background: color, marginTop: 5, display: 'block' }} />
      )}
    </div>
  )
}

/* ── Live Detail Table ── */
function LiveDetail({ t, activeMetric, todayTxns, todayWalkins, kycRows, notBilledWalkins, ghostPurchases = [], takeoverRows = [] }) {
  const [search, setSearch] = useState('')
  const { canSee } = useApp()

  const approvedMobiles = new Set(
    todayTxns.filter(tx => tx.trxn_status === 'approved').map(tx => tx.cust_mobile).filter(Boolean)
  )

  let rows, type, label
  switch (activeMetric) {
    case 'walkin':    rows = todayWalkins; type = 'walkin'; label = `All Walk-ins`; break
    case 'billed':    rows = todayTxns;   type = 'txn';    label = `All Bills Submitted`; break
    case 'purchased': rows = todayTxns.filter(t => t.trxn_status === 'approved'); type = 'txn'; label = `Purchased`; break
    case 'pending':   rows = todayTxns.filter(t => t.trxn_status === 'pending');  type = 'txn'; label = `In Pipeline`; break
    case 'rejected':  rows = todayTxns.filter(t => t.trxn_status === 'rejected' && !approvedMobiles.has(t.cust_mobile)); type = 'txn'; label = `Bill Rejected`; break
    case 'rebilled':  rows = todayTxns.filter(t => t.trxn_status === 'rejected' &&  approvedMobiles.has(t.cust_mobile)); type = 'txn'; label = `Re-billed & Approved`; break
    case 'kyc_blocked': rows = kycRows; type = 'kyc'; label = `KYC Blocked`; break
    case 'kyc_cleared': rows = kycRows.filter(r => approvedMobiles.has(r.mob_num)); type = 'kyc'; label = `KYC Cleared Later`; break
    case 'unbilled':  rows = notBilledWalkins; type = 'walkin'; label = `Left Unbilled`; break
    case 'crm_not_updated': {
      const billedMobiles = new Set(todayTxns.map(tx => tx.cust_mobile).filter(Boolean))
      rows = todayWalkins.filter(w => (!w.walkin_status || w.walkin_status === '') && billedMobiles.has(w.cust_mobile))
      type = 'walkin'; label = 'CRM Not Updated'
      break
    }
    case 'ghost_purchases':  rows = ghostPurchases;   type = 'txn';      label = 'Purchased without Walk-in Entry'; break
    case 'takeover_bills':   rows = takeoverRows;     type = 'takeover'; label = 'Multi-day Takeover Purchases'; break
    default:          rows = todayTxns.filter(t => t.trxn_status === 'approved'); type = 'txn'; label = `Purchased Today`
  }

  const q = search.toLowerCase()
  const filtered = q ? rows.filter(r => {
    if (type === 'txn')      return (r.cust_name||'').toLowerCase().includes(q) || (r.cust_mobile||'').includes(q) || (r.bill_no||'').toLowerCase().includes(q) || (r.branch_name||'').toLowerCase().includes(q)
    if (type === 'walkin')   return (r.cust_name||'').toLowerCase().includes(q) || (r.cust_mobile||'').includes(q) || (r.branch_name||'').toLowerCase().includes(q)
    if (type === 'kyc')      return (r.name||'').toLowerCase().includes(q) || (r.mob_num||'').includes(q)
    if (type === 'checklist') return Object.values(r).some(v => String(v||'').toLowerCase().includes(q))
    if (type === 'takeover') return (r.cust_name||'').toLowerCase().includes(q) || (r.cust_mobile||'').includes(q) || (r.bill_no||'').toLowerCase().includes(q) || (r.branch_name||'').toLowerCase().includes(q)
    return true
  }) : rows

  return (
    <div style={{ animation: 'slideUp .22s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <SectionLabel t={t}>{label} · {filtered.length} records</SectionLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '4px 10px', fontSize: '.62rem', color: t.text2, outline: 'none', width: 160, fontFamily: 'ui-monospace, monospace' }} />
          {canSee('livefeed.csv_export') && <button onClick={() => {
            if (type === 'txn') downloadCSV(`${label}.csv`,
              ['Bill No','Date','Time','Customer','Phone','Branch','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Status','Remarks'],
              filtered, r => [r.bill_no, fmtDate(r.txn_date), r.time, r.cust_name, r.cust_mobile, r.branch_name,
                csvSum(r.grms_wet_csv).toFixed(2), csvSum(r.stnt_wet_csv).toFixed(2),
                csvSum(r.wastag_csv).toFixed(2), csvSum(r.net_wet_csv).toFixed(2),
                wtdAvgPurity(r.grms_wet_csv, r.purity_csv)?.toFixed(1) ?? '',
                csvSum(r.grs_amnt_csv).toFixed(0), r.serv_chr, r.trxn_status, r.txn_rmrk || ''])
            else if (type === 'walkin') downloadCSV(`${label}.csv`,
              ['Time','Customer','Phone','Branch','Gold Wt','Item Type','Walk Reason','Status'],
              filtered, r => [r.time, r.cust_name, r.cust_mobile, r.branch_name, r.gms_weight, r.item_type, r.walk_reason, r.walkin_status])
            else if (type === 'checklist') downloadCSV(`${label}.csv`,
              ['Time','Customer','Phone','Gold (g)','Reason for Selling'],
              filtered, r => [r.time, r.cust_name || '', r.cust_mobile || '', r.grms_sld || '', r.rsn_slgld || ''])
            else if (type === 'takeover') downloadCSV(`${label}.csv`,
              ['Bill No','Date','Time','Customer','Phone','Branch','Amount','Last Visit Date','Days Gap','Status','Remarks'],
              filtered, r => [r.bill_no, fmtDate(r.txn_date), r.time, r.cust_name, r.cust_mobile, r.branch_name,
                r.amount, fmtDate(r.last_walkin_date), r.days_gap ?? '', r.trxn_status, r.txn_rmrk || ''])
            else downloadCSV(`${label}.csv`,
              ['Time','Name','Phone','Branch','Grams','Reason'],
              filtered, r => [r.time, r.name, r.mob_num, r.branch_name, r.grams, r.rej_rsn])
          }} style={{ padding: '4px 12px', borderRadius: 6, fontSize: '.58rem', cursor: 'pointer', border: `1px solid ${t.border}`, background: t.card, color: t.text3, whiteSpace: 'nowrap' }}>
            ↓ CSV
          </button>}
        </div>
      </div>
      {type === 'txn'      && <TxnTable       rows={filtered} t={t} />}
      {type === 'walkin'   && <WalkinTable    rows={filtered} t={t} />}
      {type === 'kyc'      && <KycTable       rows={filtered} t={t} />}
      {type === 'takeover' && <TakeoverTable  rows={filtered} t={t} />}
    </div>
  )
}

/* ── Transaction table (Purchase-Data style) ── */
function TxnTable({ rows, t }) {
  const isMobile = useMobile()
  const cols = ['Bill No','Date','Time','Customer','Phone','Branch','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Status','Remarks']
  const widths = '100px 90px 70px 160px 110px 150px 76px 60px 70px 70px 66px 96px 46px 80px 1fr'
  if (rows.length === 0) return <Card t={t}><div style={{ textAlign: 'center', color: t.text4, fontSize: '.72rem', padding: 16 }}>No records</div></Card>
  if (isMobile) {
    return (
      <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {rows.map((r, i) => {
            const sc = { approved: t.green, pending: t.orange, rejected: t.red }[r.trxn_status] || t.text3
            const netWt = csvSum(r.net_wet_csv)
            const grossAmt = csvSum(r.grs_amnt_csv)
            return (
              <div key={r.id || i} style={{ padding: '11px 14px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', borderLeft: `3px solid ${sc}40` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: '.76rem', color: t.text1, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cust_name || '—'}</span>
                  <span style={{ fontSize: '.56rem', padding: '2px 7px', borderRadius: 4, fontWeight: 700, background: `${sc}18`, color: sc, border: `1px solid ${sc}30`, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{r.trxn_status || '—'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.62rem', color: t.text3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</span>
                  {netWt > 0 && <span style={{ fontSize: '.62rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{netWt.toFixed(2)}g net</span>}
                  {grossAmt > 0 && <span style={{ fontSize: '.64rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>₹{Math.round(grossAmt).toLocaleString('en-IN')}</span>}
                </div>
                <div style={{ fontSize: '.58rem', color: t.text4, marginTop: 3, fontFamily: 'ui-monospace,monospace' }}>
                  {r.bill_no || '—'} · {fmtDate(r.txn_date)} {fmtTime(r.time)}
                  {r.txn_rmrk ? <span style={{ color: t.text3 }}> · {r.txn_rmrk}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    )
  }
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1400 }}>
          <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2, position: 'sticky', top: 0 }}>
            {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {rows.map((r, i) => {
              const sc = { approved: t.green, pending: t.orange, rejected: t.red }[r.trxn_status] || t.text3
              return (
                <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: widths, padding: '10px 16px', borderBottom: `1px solid ${t.border}18`, gap: 8, alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 500 }}>{r.bill_no || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2 }}>{fmtDate(r.txn_date)}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{fmtTime(r.time)}</span>
                  <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cust_name || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{r.cust_mobile || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</span>
                  <span style={{ fontSize: '.68rem', color: t.text1, fontFamily: 'ui-monospace,monospace' }}>{csvSum(r.grms_wet_csv) > 0 ? `${csvSum(r.grms_wet_csv).toFixed(2)}g` : '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text3, fontFamily: 'ui-monospace,monospace' }}>{csvSum(r.stnt_wet_csv) > 0 ? `${csvSum(r.stnt_wet_csv).toFixed(2)}g` : '0g'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text3, fontFamily: 'ui-monospace,monospace' }}>{csvSum(r.wastag_csv) > 0 ? `${csvSum(r.wastag_csv).toFixed(2)}g` : '0g'}</span>
                  <span style={{ fontSize: '.68rem', color: t.text1, fontFamily: 'ui-monospace,monospace' }}>{csvSum(r.net_wet_csv) > 0 ? `${csvSum(r.net_wet_csv).toFixed(2)}g` : '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2 }}>{(() => { const wp = wtdAvgPurity(r.grms_wet_csv, r.purity_csv); return wp ? `${wp.toFixed(1)}` : '—' })()}</span>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{csvSum(r.grs_amnt_csv) > 0 ? `₹${Math.round(csvSum(r.grs_amnt_csv)).toLocaleString('en-IN')}` : '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text3 }}>{r.serv_chr ? `${r.serv_chr}%` : '—'}</span>
                  <span style={{ fontSize: '.58rem', padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: `${sc}18`, color: sc, border: `1px solid ${sc}30`, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{r.trxn_status || '—'}</span>
                  <span style={{ fontSize: '.62rem', color: r.txn_rmrk ? t.text3 : t.text4, fontStyle: r.txn_rmrk ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.txn_rmrk || '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ── Walk-in table ── */
function WalkinTable({ rows, t }) {
  const isMobile = useMobile()
  const cols = ['Time','Customer','Phone','Branch','Gold Wt','Item Type','Walk Reason','Status','Staff Remarks']
  const widths = '70px 160px 110px 140px 70px 100px 140px 100px 1fr'
  if (rows.length === 0) return <Card t={t}><div style={{ textAlign: 'center', color: t.text4, fontSize: '.72rem', padding: 16 }}>No records</div></Card>
  if (isMobile) {
    return (
      <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {rows.map((r, i) => {
            const sc = { sold: t.green, 'visited not sold': t.red, enquiry: t.blue, 'planning to visit': t.orange, 'call later': t.purple }[r.walkin_status] || t.text3
            return (
              <div key={r.id || i} style={{ padding: '11px 14px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', borderLeft: `3px solid ${sc}40` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: '.76rem', color: t.text1, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cust_name || '—'}</span>
                  <span style={{ fontSize: '.56rem', padding: '2px 7px', borderRadius: 4, fontWeight: 700, background: `${sc}18`, color: sc, border: `1px solid ${sc}30`, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{r.walkin_status || 'unknown'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.62rem', color: t.text3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</span>
                  {r.gms_weight > 0 && <span style={{ fontSize: '.62rem', color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{Number(r.gms_weight).toFixed(2)}g</span>}
                  <span style={{ fontSize: '.6rem', color: t.text4, fontFamily: 'ui-monospace,monospace' }}>{fmtTime(r.time)}</span>
                </div>
                {(r.walk_reason || r.item_type) && (
                  <div style={{ fontSize: '.58rem', color: t.text4, marginTop: 3 }}>
                    {[r.item_type, r.walk_reason].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    )
  }
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1100 }}>
          <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2 }}>
            {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {rows.map((r, i) => {
              const sc = { sold: t.green, 'visited not sold': t.red, enquiry: t.blue, 'planning to visit': t.orange, 'call later': t.purple }[r.walkin_status] || t.text3
              return (
                <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: widths, padding: '10px 16px', borderBottom: `1px solid ${t.border}18`, gap: 8, alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{fmtTime(r.time)}</span>
                  <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cust_name || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{r.cust_mobile || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</span>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{r.gms_weight > 0 ? `${Number(r.gms_weight).toFixed(2)}g` : '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text3 }}>{r.item_type || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.walk_reason || '—'}</span>
                  <span style={{ fontSize: '.58rem', padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: `${sc}18`, color: sc, border: `1px solid ${sc}30`, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{r.walkin_status || 'unknown'}</span>
                  <span style={{ fontSize: '.62rem', color: r.cust_rmrks ? t.text2 : t.text4, fontStyle: r.cust_rmrks ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.cust_rmrks || ''}>{r.cust_rmrks || '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ── KYC Blocked table ── */
function KycTable({ rows, t }) {
  const cols = ['Time','Name','Phone','Branch','Grams','Reason']
  const widths = '70px 180px 120px 160px 76px 1fr'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 600 }}>
          <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2 }}>
            {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No records</div>}
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: widths, padding: '10px 16px', borderBottom: `1px solid ${t.border}18`, gap: 8, alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = t.card2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{fmtTime(r.time)}</span>
                <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500 }}>{r.name || '—'}</span>
                <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{r.mob_num || '—'}</span>
                <span style={{ fontSize: '.65rem', color: t.text2 }}>{r.branch_name || '—'}</span>
                <span style={{ fontSize: '.68rem', color: t.purple, fontFamily: 'ui-monospace,monospace' }}>{r.grams > 0 ? `${Number(r.grams).toFixed(2)}g` : '—'}</span>
                <span style={{ fontSize: '.65rem', color: t.text3 }}>{r.rej_rsn || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ── Takeover table ── */
function TakeoverTable({ rows, t }) {
  const cols = ['Bill No','Date','Time','Customer','Phone','Branch','Amount','Last Visit','Days Gap','Status','Remarks']
  const widths = '100px 90px 70px 160px 110px 150px 96px 90px 70px 80px 1fr'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1200 }}>
          <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2, position: 'sticky', top: 0 }}>
            {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No records</div>}
            {rows.map((r, i) => {
              const sc = { approved: t.green, pending: t.orange, rejected: t.red }[r.trxn_status] || t.text3
              const gap = r.days_gap != null ? Number(r.days_gap) : null
              const gapColor = gap == null ? t.text4 : gap === 0 ? t.text4 : gap <= 3 ? t.orange : t.red
              const noVisit = !r.last_walkin_date
              return (
                <div key={r.txn_id || i} style={{ display: 'grid', gridTemplateColumns: widths, padding: '10px 16px', borderBottom: `1px solid ${t.border}18`, gap: 8, alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 500 }}>{r.bill_no || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2 }}>{fmtDate(r.txn_date)}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{fmtTime(r.time)}</span>
                  <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cust_name || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{r.cust_mobile || '—'}</span>
                  <span style={{ fontSize: '.65rem', color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.branch_name || '—'}</span>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{r.amount > 0 ? fmtAmt(r.amount) : '—'}</span>
                  <span style={{ fontSize: '.65rem', color: noVisit ? t.text4 : t.text2, fontStyle: noVisit ? 'italic' : 'normal' }}>
                    {noVisit ? 'No prior visit' : fmtDate(r.last_walkin_date)}
                  </span>
                  <span style={{ fontSize: '.65rem', color: gapColor, fontFamily: 'ui-monospace,monospace', fontWeight: gap > 0 ? 600 : 400 }}>
                    {gap == null ? '—' : gap === 0 ? 'Same day' : `+${gap}d`}
                  </span>
                  <span style={{ fontSize: '.58rem', padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: `${sc}18`, color: sc, border: `1px solid ${sc}30`, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{r.trxn_status || '—'}</span>
                  <span style={{ fontSize: '.62rem', color: r.txn_rmrk ? t.text3 : t.text4, fontStyle: r.txn_rmrk ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.txn_rmrk || '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

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
function RegionTable({ t, regions, allTxns, allWalkins, allKycRows }) {
  const safeTxns    = allTxns    || []
  const safeWalkins = allWalkins || []
  const safeKyc     = allKycRows || []
  const rows = (regions || []).map(r => {
    const rTx  = safeTxns.filter(tx => tx.region === r)
    const rWk  = safeWalkins.filter(w => w.region === r)
    const rApp = rTx.filter(tx => tx.trxn_status === 'approved')
    const rPend= rTx.filter(tx => tx.trxn_status === 'pending')
    const rKyc = safeKyc.filter(k => k.region === r)
    const value = rApp.reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
    const conv  = rWk.length > 0 ? Math.round(rApp.length / rWk.length * 100) : 0
    return { region: r, walkins: rWk.length, billed: rTx.length, purchased: rApp.length, pending: rPend.length, kyc: rKyc.length, value, conv }
  }).sort((a, b) => b.purchased - a.purchased)

  const cols = ['Region', 'Walk-ins', 'Billed', 'Purchased', 'Pending', 'KYC Blocked', 'Value', 'Conversion']
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionLabel t={t}>Region Breakdown</SectionLabel>
        <button onClick={() => downloadCSV('regions.csv', cols, rows, r => [r.region, r.walkins, r.billed, r.purchased, r.pending, r.kyc, r.value, `${r.conv}%`])}
          style={{ padding: '4px 12px', borderRadius: 6, fontSize: '.58rem', cursor: 'pointer', border: `1px solid ${t.border}`, background: t.card, color: t.text3, marginBottom: 12 }}>
          ↓ CSV
        </button>
      </div>
      <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 80px 80px 90px 80px 90px 110px 90px', gap: 8, padding: '8px 16px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
              {cols.map(h => <span key={h} style={{ fontSize: '.56rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</span>)}
            </div>
            {rows.map((r, i) => (
              <div key={r.region} style={{
                display: 'grid', gridTemplateColumns: '140px 80px 80px 90px 80px 90px 110px 90px',
                gap: 8, padding: '11px 16px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', alignItems: 'center',
              }}
                onMouseEnter={e => e.currentTarget.style.background = t.card2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: '.75rem', color: t.text1, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.region}</span>
                <span style={{ fontSize: '.68rem', color: t.blue,   fontFamily: 'ui-monospace,monospace' }}>{r.walkins}</span>
                <span style={{ fontSize: '.68rem', color: t.gold,   fontFamily: 'ui-monospace,monospace' }}>{r.billed}</span>
                <span style={{ fontSize: '.68rem', color: t.green,  fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{r.purchased}</span>
                <span style={{ fontSize: '.68rem', color: t.orange, fontFamily: 'ui-monospace,monospace' }}>{r.pending}</span>
                <span style={{ fontSize: '.68rem', color: t.purple, fontFamily: 'ui-monospace,monospace' }}>{r.kyc || '—'}</span>
                <span style={{ fontSize: '.68rem', color: t.gold,   fontFamily: 'ui-monospace,monospace' }}>{r.value > 0 ? fmtAmt(r.value) : '—'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${r.conv}%`, background: r.conv >= 50 ? t.green : r.conv >= 30 ? t.orange : t.red, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '.6rem', color: t.text3, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{r.conv}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

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
function TimelineRow({ item, t, isLast }) {
  const isMobile = useMobile()
  const isTxn = item.type === 'txn'
  const statusStyle = isTxn ? (STATUS_STYLE[item.status] || {}) : {}
  const accentColor = isTxn ? (statusStyle.color || t.gold) : t.blue
  const goldTypeBadge = isTxn && item.goldType
    ? ({ physical: 'Physical', released: 'Takeover' }[item.goldType] || item.goldType)
    : null
  const wt = isTxn ? item.weight : (item.weight ? Number(item.weight) : 0)
  const statusLabel = isTxn ? (statusStyle.label || item.status) : (item.walkinStatus || 'Walk-in')

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
        {/* Row 1: name + time + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: '.76rem', color: t.text1, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name || 'Unknown'}
          </span>
          <span style={{ fontSize: '.56rem', padding: '2px 7px', borderRadius: 4, background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}35`, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {statusLabel}
          </span>
        </div>
        {/* Row 2: branch + time · weight/amount */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.6rem', color: t.text3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.branch || '—'}
            {goldTypeBadge ? ` · ${goldTypeBadge}` : ''}
            {isTxn && item.bill ? ` · #${item.bill}` : ''}
          </span>
          <span style={{ fontSize: '.6rem', color: t.text4, fontFamily: 'ui-monospace,monospace', flexShrink: 0 }}>{fmtTime(item.time)}</span>
          {wt > 0 && <span style={{ fontSize: '.6rem', color: t.text2, fontFamily: 'ui-monospace,monospace', flexShrink: 0 }}>{fmtWt(wt)}</span>}
          {isTxn && item.amount != null && <span style={{ fontSize: '.62rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 600, flexShrink: 0 }}>{fmtAmt(item.amount)}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="event-row tl-row" style={{
      display: 'grid', gridTemplateColumns: '70px 28px 1fr 110px 120px',
      gap: '0 12px', ...rowBase, alignItems: 'center',
    }}
      onMouseEnter={e => e.currentTarget.style.background = t.card2}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.66rem', color: t.text3, textAlign: 'right', lineHeight: 1 }}>{fmtTime(item.time)}</span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: '.75rem', lineHeight: 1 }}>{isTxn ? '📋' : '🚶'}</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accentColor, display: 'block', boxShadow: `0 0 5px ${accentColor}60` }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.78rem', color: t.text1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{item.name || 'Unknown'}</span>
          <span style={{ fontSize: '.56rem', padding: '2px 7px', borderRadius: 4, background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}35`, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{statusLabel}</span>
          {goldTypeBadge && <span style={{ fontSize: '.52rem', padding: '2px 6px', borderRadius: 4, background: `${t.gold}12`, color: t.gold, border: `1px solid ${t.gold}25`, fontWeight: 600, whiteSpace: 'nowrap' }}>{goldTypeBadge}</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          {item.branch && <span style={{ fontSize: '.62rem', color: t.text3 }}>{item.branch}</span>}
          {item.mobile && <span style={{ fontSize: '.6rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>{item.mobile}</span>}
          {isTxn && item.bill && <span style={{ fontSize: '.58rem', color: t.gold, fontFamily: 'ui-monospace, monospace', opacity: .7 }}>#{item.bill}</span>}
        </div>
      </div>
      <span className="tl-wt" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.72rem', color: wt > 0 ? t.text1 : t.text4, textAlign: 'right', fontWeight: wt > 0 ? 500 : 400 }}>{wt > 0 ? fmtWt(wt) : '—'}</span>
      <span className="tl-amt" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.74rem', color: isTxn && item.amount ? t.gold : t.text4, textAlign: 'right', fontWeight: isTxn && item.amount ? 600 : 400 }}>{isTxn && item.amount != null ? fmtAmt(item.amount) : '—'}</span>
    </div>
  )
}


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

function NewCrmTab({ t, newCrmTxns, newCrmError, regionFilter, regions, isToday, newEventCount, clearNewEvents }) {
  const [activeMetric, setActiveMetric] = useState(null)
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

  // Region filter
  const txns    = regionFilter ? newCrmTxns.filter(tx => tx.region === regionFilter) : newCrmTxns
  const allTxns = newCrmTxns

  // Derived counts
  const walkinTxns     = txns.filter(tx => tx.status === 'WALKIN')
  const estimationTxns = txns.filter(tx => ['ESTIMATION_PENDING','PLEDGE_ESTIMATION_PENDING','REVALUATION_PENDING','SALES_NEGOTIATION_PENDING','QUOTATION_PENDING'].includes(tx.status))
  const kycTxns        = txns.filter(tx => ['KYC_PENDING','BRANCH_KYC_PENDING','PLEDGE_APPROVAL_PENDING'].includes(tx.status))
  const paymentTxns    = txns.filter(tx => ['FINAL_PAYMENT_PENDING','PENNY_DROP_PENDING','RELEASE_PENDING','RELEASE_AGREEMENT_PENDING'].includes(tx.status))
  const completedTxns  = txns.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED')
  const walkoutTxns    = txns.filter(tx => tx.status === 'WALKOUT')
  const inProgressTxns = txns.filter(tx => IN_PROGRESS_STATUSES.includes(tx.status))

  const total      = txns.length
  const inProgress = inProgressTxns.length
  const completed  = completedTxns.length
  const walkout    = walkoutTxns.length

  const completedValue = completedTxns.reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
  // NET weight per stage (net = gross − stone − wastage; the weight ops bid on).
  const netW = (arr) => arr.reduce((s, tx) => s + (Number(tx.net_weight) || 0), 0)
  const totalWt        = netW(txns)
  const completedWt    = netW(completedTxns)
  const inProgressWt   = netW(inProgressTxns)
  const walkoutWt      = netW(walkoutTxns)
  const walkinWt       = netW(walkinTxns)
  const estimationWt   = netW(estimationTxns)
  const kycWt          = netW(kycTxns)
  const paymentWt      = netW(paymentTxns)

  const conversionPct       = total > 0 ? Math.round(completed / total * 100) : 0
  const walkoutRate         = total > 0 ? Math.round(walkout / total * 100) : 0
  const progressedPct       = total > 0 ? Math.round((inProgress + completed) / total * 100) : 0
  const completedOfProgPct  = (inProgress + completed) > 0 ? Math.round(completed / (inProgress + completed) * 100) : 0
  const avgWt               = completed > 0 && completedWt > 0 ? completedWt / completed : 0

  if (!total) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
        <span style={{ fontSize: '2rem', opacity: .3 }}>~</span>
        <span style={{ fontSize: '.82rem', color: t.text3 }}>No activity recorded yet</span>
        <span style={{ fontSize: '.62rem', color: t.text4 }}>Data will appear as transactions come in</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ──────── 1. CUSTOMER JOURNEY ──────── */}
      <div>
        <SectionLabel t={t}>Customer Journey · New CRM</SectionLabel>
        <div className="lf-hero" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexWrap: 'wrap', background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: '28px 16px', boxShadow: `0 4px 20px rgba(0,0,0,.12), inset 0 1px 0 ${t.border}`, backdropFilter: 'blur(4px)' }}>
          <HeroNum label="Total Today"  value={total}      color={t.blue}   t={t} weight={totalWt}      active={activeMetric==='total'}      onClick={() => toggleMetric('total')} />
          <FlowArrow t={t} pct={progressedPct || null} />
          <div style={{
            position:'relative',
            background:`linear-gradient(160deg, ${t.bg} 0%, ${t.card} 60%, ${t.bg} 100%)`,
            border:`1.5px solid ${t.blue}55`,
            borderRadius:22,
            boxShadow:`0 0 0 1px ${t.blue}12, 0 16px 48px ${t.blue}20, 0 4px 16px rgba(0,0,0,.16), inset 0 0 60px ${t.blue}08, inset 0 1px 0 ${t.blue}35`,
            padding:'22px 14px 14px',
          }}>
            <div style={{ position:'absolute', inset:-1, borderRadius:22, background:`radial-gradient(ellipse at 50% 0%, ${t.blue}18 0%, transparent 65%)`, pointerEvents:'none' }}/>
            <div style={{ position:'absolute', inset:0, borderRadius:22, backgroundImage:`radial-gradient(${t.blue}18 1px, transparent 1px)`, backgroundSize:'18px 18px', pointerEvents:'none', opacity:.6 }}/>
            <div style={{ position:'absolute', top:-14, left:'50%', transform:'translateX(-50%)', background:`linear-gradient(90deg,${t.blue}ee,${t.blue}bb)`, borderRadius:20, padding:'4px 14px', boxShadow:`0 4px 14px ${t.blue}55, 0 0 0 1px ${t.blue}30`, whiteSpace:'nowrap' }}>
              <span style={{ fontSize:'.52rem', letterSpacing:'.14em', textTransform:'uppercase', color:'#fff', fontWeight:900 }}>breakdown of {fmtNum(total)}</span>
            </div>
            <div style={{ position:'relative', display:'flex', alignItems:'center', gap:8 }}>
              {[
                { node: <HeroNum label="In Progress" value={inProgress} color={t.orange} t={t} weight={inProgressWt} active={activeMetric==='inprogress'} onClick={() => toggleMetric('inprogress')} />, color: t.orange },
                { node: <HeroNum label="Completed"   value={completed}  color={t.green}  t={t} weight={completedWt}  active={activeMetric==='completed'}  onClick={() => toggleMetric('completed')}  />, color: t.green  },
              ].map((item, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {i > 0 && <FlowArrow t={t} pct={completedOfProgPct || null} />}
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
          <FlowSep t={t} />
          <HeroNum label="At Walk-in"   value={walkinTxns.length}     color={t.blue}   t={t} small weight={walkinWt}   active={activeMetric==='walkin'}     onClick={() => toggleMetric('walkin')} />
          <FlowSep t={t} />
          <HeroNum label="Estimation"   value={estimationTxns.length} color={t.orange} t={t} small weight={estimationWt} active={activeMetric==='estimation'} onClick={() => toggleMetric('estimation')} />
          <FlowSep t={t} />
          <HeroNum label="KYC"          value={kycTxns.length}        color={t.purple} t={t} small weight={kycWt}        active={activeMetric==='kyc'}        onClick={() => toggleMetric('kyc')} />
          <FlowSep t={t} />
          <HeroNum label="Payment Due"  value={paymentTxns.length}    color={t.gold}   t={t} small weight={paymentWt}    active={activeMetric==='payment'}    onClick={() => toggleMetric('payment')} />
          <FlowSep t={t} />
          <HeroNum label="Walkout"      value={walkout}                color={t.red}    t={t} small weight={walkoutWt}  active={activeMetric==='walkout'}    onClick={() => toggleMetric('walkout')} />
        </div>
        {/* ── Stats ribbon ── */}
        <div style={{ display:'flex', gap:0, marginTop:10, background:t.card, border:`1px solid ${t.border}`, borderRadius:14, overflow:'hidden', flexWrap:'wrap', boxShadow:`0 2px 8px rgba(0,0,0,.08)` }}>
          {[
            { label:'Total → Completed', value:`${conversionPct}%`,    color:t.green,  key: null },
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
        <NewCrmDetail t={t} activeMetric={activeMetric} txns={txns} />
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
function NewCrmDetail({ t, activeMetric, txns }) {
  const [search, setSearch] = useState('')

  let rows, label
  switch (activeMetric) {
    case 'total':      rows = txns; label = 'All Transactions'; break
    case 'walkin':     rows = txns.filter(tx => tx.status === 'WALKIN'); label = 'Still at Walk-in'; break
    case 'inprogress': rows = txns.filter(tx => IN_PROGRESS_STATUSES.includes(tx.status)); label = 'In Progress'; break
    case 'completed':  rows = txns.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED'); label = 'Completed'; break
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
                  <span style={{ fontSize: '.68rem', color: t.text1, fontFamily: 'ui-monospace,monospace' }}>{Number(r.gross_weight||0) > 0 ? `${Number(r.gross_weight).toFixed(2)}g` : '—'}</span>
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
    const conv  = rTx.length > 0 ? Math.round(rComp.length / rTx.length * 100) : 0
    return { region: r, total: rTx.length, inProgress: rProg.length, completed: rComp.length, walkout: rWout.length, value, conv }
  }).sort((a, b) => b.completed - a.completed)

  const cols = ['Region', 'Total', 'In Progress', 'Completed', 'Walkout', 'Value', 'Conversion']
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionLabel t={t}>Region Breakdown</SectionLabel>
        <button onClick={() => downloadCSV('new-crm-regions.csv', cols, rows, r => [r.region, r.total, r.inProgress, r.completed, r.walkout, r.value, `${r.conv}%`])}
          style={{ padding: '4px 12px', borderRadius: 6, fontSize: '.58rem', cursor: 'pointer', border: `1px solid ${t.border}`, background: t.card, color: t.text3, marginBottom: 12 }}>
          ↓ CSV
        </button>
      </div>
      <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 70px 100px 90px 80px 110px 90px', gap: 8, padding: '8px 16px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
              {cols.map(h => <span key={h} style={{ fontSize: '.56rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</span>)}
            </div>
            {rows.map((r, i) => (
              <div key={r.region} style={{ display: 'grid', gridTemplateColumns: '140px 70px 100px 90px 80px 110px 90px', gap: 8, padding: '11px 16px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = t.card2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: '.75rem', color: t.text1, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.region}</span>
                <span style={{ fontSize: '.68rem', color: t.blue,   fontFamily: 'ui-monospace,monospace' }}>{r.total}</span>
                <span style={{ fontSize: '.68rem', color: t.orange, fontFamily: 'ui-monospace,monospace' }}>{r.inProgress || '—'}</span>
                <span style={{ fontSize: '.68rem', color: t.green,  fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{r.completed}</span>
                <span style={{ fontSize: '.68rem', color: t.red,    fontFamily: 'ui-monospace,monospace' }}>{r.walkout || '—'}</span>
                <span style={{ fontSize: '.68rem', color: t.gold,   fontFamily: 'ui-monospace,monospace' }}>{r.value > 0 ? fmtAmt(r.value) : '—'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${r.conv}%`, background: r.conv >= 50 ? t.green : r.conv >= 30 ? t.orange : t.red, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '.6rem', color: t.text3, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{r.conv}%</span>
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
