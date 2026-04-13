'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

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

function Pill({ label, value, color, bg }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
      borderRadius: 20, background: bg, fontSize: '.62rem', color, fontWeight: 500,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}: {value}
    </span>
  )
}

/* ════════════════════════════════════════════════════ */
/*                  MAIN COMPONENT                    */
/* ════════════════════════════════════════════════════ */
export default function LiveFeed() {
  const { theme: appTheme, canSee } = useApp()
  const t = THEMES[appTheme] || THEMES.dark

  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [viewDate,      setViewDate]      = useState(todayIST)
  const isToday = viewDate === todayIST
  const [crmTab,        setCrmTab]        = useState('old')
  const [regionFilter,  setRegionFilter]  = useState('')   // '' = all regions
  const [data,          setData]          = useState(null)
  const [loadError,     setLoadError]     = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [countdown,     setCountdown]     = useState(REFRESH_SECS)

  const timerRef = useRef(null)
  const countRef = useRef(null)
  const prevTlCountRef = useRef(0)
  const [newEventCount, setNewEventCount] = useState(0)

  /* ── Load data ── */
  const load = useCallback(async (date) => {
    const d = date || viewDate
    try {
      setLoading(true)
      setLoadError(null)
      const res = await fetch(`/api/crm-purchases?action=live&date=${d}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      setLastUpdated(new Date())
    } catch (e) {
      console.error('LiveFeed load error:', e)
      setLoadError(e.message)
    } finally {
      setLoading(false)
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
  const regions      = data?.allRegions   || []
  const goldPipeline = data?.goldPipeline || {}
  const kycRows      = data?.kycRows      || []
  const takeoverRows = data?.takeoverRows || []
  const hourlyData   = data?.hourly       || []
  const branchData   = data?.branches     || []
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
    // not_billed already excludes KYC blocked (computed above via notBilledWalkins)
    kyc_checklist_cnt:   goldPipeline.kyc_checklist_cnt || 0,
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
        padding: '11px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isToday && (
            <span style={{ position: 'relative', width: 8, height: 8 }}>
              <span style={{
                position: 'absolute', inset: 0, borderRadius: '50%', background: t.green,
                animation: 'ping 1.5s cubic-bezier(0,0,.2,1) infinite', opacity: .6,
              }} />
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.green }} />
            </span>
          )}
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.82rem', fontWeight: 600, color: t.text1 }}>
            LIVE FEED
          </span>
        </div>

        {/* Date picker */}
        {canSee('livefeed.date_picker') && (
          <input
            type="date"
            value={viewDate}
            onChange={e => { setViewDate(e.target.value); setRegionFilter(''); setNewEventCount(0); load(e.target.value) }}
            style={{
              background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 6,
              padding: '5px 10px', fontSize: '.72rem', fontFamily: 'ui-monospace, monospace',
              outline: 'none', cursor: 'pointer',
            }}
          />
        )}

        {/* CRM tabs */}
        {(canSee('livefeed.old_crm_tab') || canSee('livefeed.new_crm_tab') || canSee('livefeed.combined_tab')) && (
          <div style={{ display: 'flex', background: t.card, borderRadius: 8, border: `1px solid ${t.border}`, overflow: 'hidden' }}>
            {[['old', 'Old CRM'], ['new', 'New CRM'], ['combined', 'Both']].filter(([key]) => {
              if (key === 'old')      return canSee('livefeed.old_crm_tab')
              if (key === 'new')      return canSee('livefeed.new_crm_tab')
              if (key === 'combined') return canSee('livefeed.combined_tab')
              return false
            }).map(([key, label]) => (
              <button key={key} onClick={() => { setCrmTab(key); setNewEventCount(0) }} style={{
                padding: '6px 16px', fontSize: '.62rem', letterSpacing: '.08em', textTransform: 'uppercase',
                fontWeight: crmTab === key ? 600 : 400, cursor: 'pointer', border: 'none',
                background: crmTab === key ? t.gold : 'transparent',
                color: crmTab === key ? '#000' : t.text3,
                transition: 'all .2s',
              }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Region filter */}
        {canSee('livefeed.region_filter') && regions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.08em' }}>REGION</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['', ...regions].map(r => (
                <button key={r || 'all'} onClick={() => setRegionFilter(r)} style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: '.62rem', cursor: 'pointer',
                  border: `1px solid ${regionFilter === r ? t.gold : t.border}`,
                  background: regionFilter === r ? `${t.gold}18` : 'transparent',
                  color: regionFilter === r ? t.gold : t.text3,
                  fontWeight: regionFilter === r ? 600 : 400,
                  transition: 'all .15s',
                }}>
                  {r || 'All'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Refresh info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastUpdated && (
            <span style={{ fontSize: '.58rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>
              {isToday ? `${countdown}s` : 'historical'}
            </span>
          )}
          <button onClick={() => { load(); setCountdown(REFRESH_SECS) }} style={{
            background: t.card, border: `1px solid ${t.border}`, borderRadius: 6,
            padding: '5px 10px', fontSize: '.6rem', color: t.text3, cursor: 'pointer',
          }}>
            Refresh
          </button>
        </div>
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
      <div style={{ padding: '24px 28px' }}>
        {loadError && (
          <div style={{ background: `${t.red}15`, border: `1px solid ${t.red}40`, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: '.72rem', color: t.red, fontFamily: 'ui-monospace, monospace' }}>
            API error: {loadError}
          </div>
        )}
        {loading && !data ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
            <GoldSpinner size={40} />
            <span style={{ fontSize: '.72rem', color: t.text3 }}>Loading live data...</span>
          </div>
        ) : crmTab === 'old' ? (
          <div style={{ opacity: loading && data ? 0.6 : 1, transition: 'opacity .3s' }}>
            <OldCrmTab t={t} summary={effectiveSummary} walkinSummary={effectiveWalkinSummary}
              totalWalkins={totalWalkins} totalBilled={totalBilled} approved={approved} pending={pending}
              trueRejected={trueRejected} wrongEntry={wrongEntry}
              notBilledCnt={notBilledCnt} notBilledWalkins={notBilledWalkins} crmNotUpdatedCnt={crmNotUpdatedCnt}
              goldPipeline={effectiveGoldPipeline}
              todayTxns={rTxns} todayWalkins={rWalkins}
              allTxns={todayTxns} allWalkins={todayWalkins} allKycRows={kycRows} regions={regions}
              kycRows={regionFilter ? kycRows.filter(r => r.region === regionFilter) : kycRows}
              takeoverRows={takeoverRows} hourlyData={hourlyData} branchData={branchData}
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
              takeoverRows={takeoverRows} hourlyData={hourlyData} branchData={branchData}
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
  kycRows, takeoverRows, hourlyData, branchData, regionFilter,
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
          kycRows={kycRows} takeoverRows={takeoverRows} hourlyData={hourlyData} branchData={branchData} regionFilter={regionFilter}
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
  t, summary, walkinSummary,
  totalWalkins, totalBilled, approved, pending,
  trueRejected, wrongEntry,
  notBilledCnt, notBilledWalkins, crmNotUpdatedCnt,
  goldPipeline,
  todayTxns, todayWalkins, allTxns, allWalkins, allKycRows, regions,
  kycRows, takeoverRows, hourlyData, branchData, regionFilter,
  filteredTimeline, isToday,
  newEventCount, clearNewEvents,
}) {
  const { canSee } = useApp()
  const [activeMetric, setActiveMetric] = useState(null)
  const [tlSearch, setTlSearch]         = useState('')
  const [tlFilter, setTlFilter]         = useState('all')
  const toggleMetric = key => setActiveMetric(prev => prev === key ? null : key)

  const approvedValue     = summary.approved_value || 0
  const goldPending       = parseFloat(goldPipeline?.pending_wt)        || 0
  const kycBlacklistedCnt = goldPipeline?.kyc_blacklisted_cnt            || 0
  const kycBlacklistedWt  = parseFloat(goldPipeline?.kyc_blacklisted_wt) || 0
  const kycChecklistRows  = goldPipeline?.kyc_checklist_rows             || []
  const releaseApproved   = goldPipeline?.released?.approved             || 0

  const conversionPct  = totalWalkins > 0 ? Math.round(approved  / totalWalkins * 100) : 0
  const billedPct      = totalWalkins > 0 ? Math.round(totalBilled / totalWalkins * 100) : 0
  const approvedPct    = totalBilled  > 0 ? Math.round(approved  / totalBilled  * 100) : 0

  // Ghost purchases: approved physical bills with no walk-in entry
  const walkinMobiles  = new Set(todayWalkins.map(w => w.cust_mobile).filter(Boolean))
  const ghostPurchases = todayTxns.filter(tx =>
    tx.trxn_status === 'approved' && tx.type_gold !== 'released' &&
    tx.cust_mobile && !walkinMobiles.has(tx.cust_mobile)
  )
  const ghostCount = ghostPurchases.length

  const hasData = totalWalkins > 0 || totalBilled > 0
  if (!hasData) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:300, gap:12 }}>
      <span style={{ fontSize:'2rem', opacity:.3 }}>~</span>
      <span style={{ fontSize:'.82rem', color:t.text3 }}>No activity recorded yet</span>
      <span style={{ fontSize:'.62rem', color:t.text4 }}>Data will appear as walk-ins and transactions come in</span>
    </div>
  )

  // Exceptions — only actionable, attention-needed items
  const exceptions = []
  if (ghostCount > 0) exceptions.push({
    key:'ghost_purchases', icon:'👻', color:t.red, urgent:true,
    headline:`${ghostCount} purchase${ghostCount>1?'s':''} with no walk-in entry`,
    sub:`Customers bought gold but never filled the walk-in register`,
  })
  if (pending > 0) exceptions.push({
    key:'pending', icon:'⏳', color:t.orange, urgent:pending>=5,
    headline:`${pending} bill${pending>1?'s':''} pending closure`,
    sub:`${fmtWt(goldPending)} in pipeline — needs follow-up before end of day`,
  })
  if (crmNotUpdatedCnt > 0) exceptions.push({
    key:'crm_not_updated', icon:'⚠', color:t.orange, urgent:false,
    headline:`${crmNotUpdatedCnt} walk-in status${crmNotUpdatedCnt>1?'es':''} not updated`,
    sub:`Customers were billed but the CRM register status was not set`,
  })
  if (kycBlacklistedCnt > 0) exceptions.push({
    key:'kyc_blocked', icon:'🚫', color:'#8c5ac8', urgent:false,
    headline:`${kycBlacklistedCnt} customer${kycBlacklistedCnt>1?'s':''} KYC flagged`,
    sub:`${fmtWt(kycBlacklistedWt)} held at KYC verification today`,
  })
  if (notBilledCnt >= 3) exceptions.push({
    key:'unbilled', icon:'🚶', color:t.text3, urgent:false,
    headline:`${notBilledCnt} walk-ins left without billing`,
    sub:`Customers who came in but no transaction was raised`,
  })
  if (releaseApproved > 0) exceptions.push({
    key:'takeover_bills', icon:'🔁', color:t.gold, urgent:false,
    headline:`${releaseApproved} takeover${releaseApproved>1?'s':''} completed today`,
    sub:`Multi-day gold pledges that completed final payment today — click to see original visit dates`,
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* ── 1. TODAY'S PULSE ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr) auto', gap:8, alignItems:'stretch' }}>
        {[
          { label:'Walk-ins',  value:totalWalkins, color:t.blue,   sub:null,                               key:'walkin'    },
          { label:'Bills',     value:totalBilled,  color:t.gold,   sub:null,                               key:'billed'    },
          { label:'Approved',  value:approved,     color:t.green,  sub:fmtAmt(approvedValue),              key:'purchased' },
          { label:'Pending',   value:pending,      color:t.orange, sub:goldPending>0?fmtWt(goldPending):null, key:'pending' },
          { label:'Rejected',  value:trueRejected, color:t.red,    sub:null,                               key:'rejected'  },
        ].map(item => (
          <div key={item.key} onClick={() => toggleMetric(item.key)} style={{
            background:activeMetric===item.key?`${item.color}12`:t.card,
            border:`1px solid ${activeMetric===item.key?item.color+'50':t.border}`,
            borderTop:`3px solid ${item.color}`,
            borderRadius:10, padding:'14px 16px', cursor:'pointer',
            transition:'all .15s', display:'flex', flexDirection:'column', gap:4,
          }}
            onMouseEnter={e => { if (activeMetric!==item.key) e.currentTarget.style.background=t.card2 }}
            onMouseLeave={e => { if (activeMetric!==item.key) e.currentTarget.style.background=t.card }}>
            <span style={{ fontSize:'1.8rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:item.color, lineHeight:1, letterSpacing:'-.03em' }}>{fmtNum(item.value)}</span>
            <span style={{ fontSize:'.52rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700 }}>{item.label}</span>
            {item.sub && <span style={{ fontSize:'.6rem', color:item.color, fontFamily:'ui-monospace,monospace', opacity:.8 }}>{item.sub}</span>}
          </div>
        ))}
        {/* Conversion % */}
        <div style={{ background:t.card, border:`1px solid ${t.border}`, borderTop:`3px solid ${conversionPct>=50?t.green:t.orange}`, borderRadius:10, padding:'14px 16px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minWidth:84, gap:4 }}>
          <span style={{ fontSize:'1.8rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:conversionPct>=50?t.green:t.orange, lineHeight:1 }}>{conversionPct}%</span>
          <span style={{ fontSize:'.52rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700, textAlign:'center' }}>Conversion</span>
          <span style={{ fontSize:'.48rem', color:t.text4 }}>{billedPct}% billed</span>
        </div>
      </div>

      {/* ── 2. EXCEPTIONS (Needs Attention) ── */}
      {exceptions.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:'.48rem', color:t.text4, letterSpacing:'.14em', textTransform:'uppercase', fontWeight:700 }}>Needs Attention</span>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:8 }}>
            {exceptions.map(ex => (
              <div key={ex.key} onClick={() => toggleMetric(ex.key)} style={{
                background:activeMetric===ex.key?`${ex.color}10`:t.card,
                border:`1px solid ${activeMetric===ex.key?ex.color+'50':ex.color+'25'}`,
                borderLeft:`3px solid ${ex.color}`,
                borderRadius:9, padding:'10px 14px', cursor:'pointer', transition:'all .15s', position:'relative',
              }}>
                {ex.urgent && <div style={{ position:'absolute', top:8, right:10, width:6, height:6, borderRadius:'50%', background:ex.color, boxShadow:`0 0 6px ${ex.color}` }} />}
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                  <span style={{ fontSize:'.7rem' }}>{ex.icon}</span>
                  <span style={{ fontSize:'.63rem', fontWeight:700, color:ex.color, lineHeight:1.3 }}>{ex.headline}</span>
                </div>
                <div style={{ fontSize:'.55rem', color:t.text4, lineHeight:1.5 }}>{ex.sub}</div>
                <div style={{ fontSize:'.48rem', color:ex.color, marginTop:4, opacity:.7 }}>{activeMetric===ex.key?'▲ showing':'▼ click to see'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. FUNNEL ── */}
      {canSee('livefeed.customer_journey') && (
        <div style={{ background:t.card, border:`1px solid ${t.border}`, borderRadius:12, padding:'20px 24px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:0, flexWrap:'wrap' }}>
            {/* Walk-in */}
            <div onClick={() => toggleMetric('walkin')} style={{ cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:6, padding:'8px 20px', borderRadius:12, background:activeMetric==='walkin'?`${t.blue}12`:'transparent', border:`1px solid ${activeMetric==='walkin'?t.blue+'50':'transparent'}`, transition:'all .15s' }}>
              <span style={{ fontSize:'2rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:t.blue, lineHeight:1 }}>{fmtNum(totalWalkins)}</span>
              <span style={{ fontSize:'.55rem', color:t.text4, letterSpacing:'.1em', textTransform:'uppercase' }}>Walked In</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:'0 10px' }}>
              <span style={{ fontSize:'.5rem', color:t.text4 }}>{billedPct}%</span>
              <div style={{ width:36, height:1, background:`linear-gradient(90deg,${t.blue},${t.gold})` }} />
            </div>
            {/* Billed */}
            <div onClick={() => toggleMetric('billed')} style={{ cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:6, padding:'8px 20px', borderRadius:12, background:activeMetric==='billed'?`${t.gold}12`:'transparent', border:`1px solid ${activeMetric==='billed'?t.gold+'50':'transparent'}`, transition:'all .15s' }}>
              <span style={{ fontSize:'2rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:t.gold, lineHeight:1 }}>{fmtNum(totalBilled)}</span>
              <span style={{ fontSize:'.55rem', color:t.text4, letterSpacing:'.1em', textTransform:'uppercase' }}>Bills Submitted</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:'0 10px' }}>
              <span style={{ fontSize:'.5rem', color:t.text4 }}>{approvedPct}%</span>
              <div style={{ width:36, height:1, background:`linear-gradient(90deg,${t.gold},${t.green})` }} />
            </div>
            {/* Approved */}
            <div onClick={() => toggleMetric('purchased')} style={{ cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:6, padding:'8px 20px', borderRadius:12, background:activeMetric==='purchased'?`${t.green}12`:'transparent', border:`1px solid ${activeMetric==='purchased'?t.green+'50':'transparent'}`, transition:'all .15s' }}>
              <span style={{ fontSize:'2rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:t.green, lineHeight:1 }}>{fmtNum(approved)}</span>
              <span style={{ fontSize:'.55rem', color:t.text4, letterSpacing:'.1em', textTransform:'uppercase' }}>Approved</span>
              {approvedValue > 0 && <span style={{ fontSize:'.6rem', color:t.gold, fontFamily:'ui-monospace,monospace' }}>{fmtAmt(approvedValue)}</span>}
            </div>
            {/* Divider */}
            <div style={{ width:1, height:40, background:t.border, margin:'0 16px' }} />
            {/* Pending */}
            <div onClick={() => toggleMetric('pending')} style={{ cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'8px 14px', borderRadius:10, background:activeMetric==='pending'?`${t.orange}12`:'transparent', border:`1px solid ${activeMetric==='pending'?t.orange+'50':'transparent'}`, transition:'all .15s' }}>
              <span style={{ fontSize:'1.4rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:t.orange, lineHeight:1 }}>{fmtNum(pending)}</span>
              <span style={{ fontSize:'.52rem', color:t.text4, letterSpacing:'.08em', textTransform:'uppercase' }}>Pending</span>
            </div>
            {/* Rejected */}
            <div onClick={() => toggleMetric('rejected')} style={{ cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'8px 14px', borderRadius:10, background:activeMetric==='rejected'?`${t.red}12`:'transparent', border:`1px solid ${activeMetric==='rejected'?t.red+'50':'transparent'}`, transition:'all .15s' }}>
              <span style={{ fontSize:'1.4rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:t.red, lineHeight:1 }}>{fmtNum(trueRejected)}</span>
              <span style={{ fontSize:'.52rem', color:t.text4, letterSpacing:'.08em', textTransform:'uppercase' }}>Rejected</span>
            </div>
          </div>
          {activeMetric && (
            <div style={{ display:'flex', justifyContent:'center', marginTop:12 }}>
              <button onClick={() => setActiveMetric(null)} style={{ padding:'3px 12px', borderRadius:20, fontSize:'.58rem', cursor:'pointer', border:`1px solid ${t.border}`, background:t.card2, color:t.text3 }}>
                Clear ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 4. DETAIL TABLE ── */}
      {canSee('livefeed.detail_table') && activeMetric && (
        <LiveDetail t={t} activeMetric={activeMetric}
          todayTxns={todayTxns} todayWalkins={todayWalkins}
          kycRows={kycRows} notBilledWalkins={notBilledWalkins}
          kycChecklistRows={kycChecklistRows}
          ghostPurchases={ghostPurchases}
          takeoverRows={takeoverRows} />
      )}

      {/* ── 5. LIVE TIMELINE (always open) ── */}
      {canSee('livefeed.timeline') && (
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <SectionLabel t={t}>{isToday?'Live Timeline':'Timeline'}</SectionLabel>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {newEventCount > 0 && (
                <span onClick={clearNewEvents} style={{ background:t.green, color:'#000', borderRadius:10, fontSize:'.52rem', fontWeight:700, padding:'2px 8px', lineHeight:1.5, cursor:'pointer' }}>
                  +{newEventCount} new
                </span>
              )}
              <div style={{ display:'flex', background:t.card2, borderRadius:6, border:`1px solid ${t.border}`, overflow:'hidden' }}>
                {[['all','All'],['txn','Bills'],['walkin','Walk-ins']].map(([val,lbl]) => (
                  <button key={val} onClick={() => setTlFilter(val)} style={{
                    padding:'4px 10px', fontSize:'.58rem', cursor:'pointer', border:'none',
                    background:tlFilter===val?t.gold:'transparent', color:tlFilter===val?'#000':t.text3,
                    fontWeight:tlFilter===val?600:400, transition:'all .15s',
                  }}>{lbl}</button>
                ))}
              </div>
              <input type="text" placeholder="Search name, mobile, branch..." value={tlSearch} onChange={e => setTlSearch(e.target.value)}
                style={{ background:t.card2, border:`1px solid ${t.border}`, borderRadius:6, padding:'5px 10px', fontSize:'.62rem', color:t.text2, outline:'none', width:180, fontFamily:'ui-monospace,monospace' }} />
            </div>
          </div>
          <Card t={t} style={{ padding:0, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'70px 28px 1fr 110px 120px', gap:'0 12px', padding:'8px 20px', background:t.card2, borderBottom:`1px solid ${t.border}` }}>
              {['Time','','Customer / Branch','Weight','Amount'].map((h,i) => (
                <span key={i} style={{ fontSize:'.57rem', color:t.text3, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', textAlign:i>=3?'right':i===0?'right':'left' }}>{h}</span>
              ))}
            </div>
            <div style={{ maxHeight:520, overflowY:'auto' }}>
              {filteredTimeline.filter(item => {
                if (tlFilter==='txn'    && item.type!=='txn')    return false
                if (tlFilter==='walkin' && item.type!=='walkin') return false
                if (tlSearch) {
                  const s = tlSearch.toLowerCase()
                  return (item.name||'').toLowerCase().includes(s)||(item.mobile||'').includes(s)||(item.branch||'').toLowerCase().includes(s)
                }
                return true
              }).map((item,i,arr) => (
                <TimelineRow key={item.id} item={item} t={t} isLast={i===arr.length-1} />
              ))}
              {filteredTimeline.length===0 && <div style={{ padding:32, textAlign:'center', color:t.text4, fontSize:'.72rem' }}>No events yet</div>}
            </div>
          </Card>
        </div>
      )}

    </div>
  )
}


/* ════════════════════════════════════════════════════════════════ */
/*                      SUB-COMPONENTS                           */
/* ════════════════════════════════════════════════════════════════ */

/* ── Hero Number (clickable) ── */
function HeroNum({ label, value, color, t, small, muted, onClick, active, weight, breakdown }) {
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
      {breakdown && (
        <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:6, padding:'3px 7px', background:t.card2, border:`1px solid ${t.border}`, borderRadius:5 }}>
          {breakdown.map((item, i) => (
            <span key={i} style={{ display:'flex', alignItems:'center', gap:3 }}>
              {i > 0 && <span style={{ color:t.border2, fontSize:'.45rem' }}>|</span>}
              <span style={{ fontSize:'.58rem', fontFamily:'ui-monospace,monospace', fontWeight:700, color:item.color }}>{item.value}</span>
              <span style={{ fontSize:'.45rem', color:t.text4 }}>{item.label}</span>
            </span>
          ))}
        </div>
      )}
      {active && (
        <span style={{ width: 20, height: 2, borderRadius: 1, background: color, marginTop: 5, display: 'block' }} />
      )}
    </div>
  )
}

/* ── Live Detail Table ── */
function LiveDetail({ t, activeMetric, todayTxns, todayWalkins, kycRows, notBilledWalkins, kycChecklistRows = [], ghostPurchases = [], takeoverRows = [] }) {
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
    case 'kyc_checklist':    rows = kycChecklistRows; type = 'checklist'; label = 'KYC Checklist'; break
    case 'ghost_purchases':  rows = ghostPurchases;   type = 'txn';      label = 'Purchased — No Walk-in Entry'; break
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
      {type === 'checklist' && <ChecklistTable rows={filtered} t={t} />}
      {type === 'takeover' && <TakeoverTable  rows={filtered} t={t} />}
    </div>
  )
}

/* ── Transaction table (Purchase-Data style) ── */
function TxnTable({ rows, t }) {
  const cols = ['Bill No','Date','Time','Customer','Phone','Branch','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Status','Remarks']
  const widths = '100px 90px 70px 160px 110px 150px 76px 60px 70px 70px 66px 96px 46px 80px 1fr'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1400 }}>
          <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2, position: 'sticky', top: 0 }}>
            {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No records</div>}
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
  const cols = ['Time','Customer','Phone','Branch','Gold Wt','Item Type','Walk Reason','Status','Staff Remarks']
  const widths = '70px 160px 110px 140px 70px 100px 140px 100px 1fr'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1100 }}>
          <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2 }}>
            {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No records</div>}
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
    </Card>
  )
}

/* ── KYC Checklist table ── */
function ChecklistTable({ rows, t }) {
  if (rows.length === 0) return (
    <Card t={t} style={{ padding: 32, textAlign: 'center' }}>
      <span style={{ fontSize: '.72rem', color: t.text4 }}>No records</span>
    </Card>
  )
  // Column presence — chklist_tbl joined with customer_tbl gives cust_name + cust_mobile
  const sample = rows[0]
  const nameCol    = ['cust_name','name','customer_name','custname'].find(k => k in sample)
  const mobileCol  = ['cust_mobile','mob_num','mobile','mobile_no','phone'].find(k => k in sample)
  const timeCol    = ['time','entry_time','created_time'].find(k => k in sample)

  const cols = ['Time', 'Customer', 'Phone', 'Gold (g)', 'Reason for Selling']
  const widths = '80px 220px 130px 80px 1fr'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: widths, padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 8, background: t.card2 }}>
        {cols.map(h => <span key={h} style={{ fontSize: '.56rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 600 }}>{h}</span>)}
      </div>
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: widths, padding: '10px 16px', borderBottom: `1px solid ${t.border}18`, gap: 8, alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = t.card2}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{timeCol ? fmtTime(r[timeCol]) : '—'}</span>
            <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameCol ? (r[nameCol] || '—') : '—'}</span>
            <span style={{ fontSize: '.65rem', color: t.text2, fontFamily: 'ui-monospace,monospace' }}>{mobileCol ? (r[mobileCol] || '—') : '—'}</span>
            <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{r.grms_sld ? `${Number(r.grms_sld).toFixed(2)}g` : '—'}</span>
            <span style={{ fontSize: '.65rem', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rsn_slgld || '—'}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ── Hourly Activity Chart ── */
function HourlyChart({ hourly, t, isToday }) {
  const HOURS = Array.from({ length: 15 }, (_, i) => i + 7)  // 7am–9pm
  const hourMap = {}
  ;(hourly || []).forEach(h => { hourMap[Number(h.hour)] = h })

  const data = HOURS.map(h => {
    const d = hourMap[h] || {}
    const bills    = Number(d.bills)    || 0
    const approved = Number(d.approved) || 0
    const rejected = Number(d.rejected) || 0
    const pending  = Math.max(0, bills - approved - rejected)
    return { hour: h, bills, approved, rejected, pending }
  })

  const maxBills  = Math.max(...data.map(d => d.bills), 1)
  const totalToday = data.reduce((s, d) => s + d.bills, 0)
  const peakHour  = data.reduce((best, d) => d.bills > (best?.bills || 0) ? d : best, null)
  const nowHour   = isToday ? new Date(Date.now() + 5.5 * 60 * 60 * 1000).getHours() : -1
  const fmtH      = h => `${h % 12 || 12}${h >= 12 ? 'p' : 'a'}`

  return (
    <div style={{
      background: `linear-gradient(160deg,${t.surface} 0%,${t.card} 100%)`,
      border: `1px solid ${t.border}`, borderRadius: 16,
      padding: '18px 20px 14px',
      boxShadow: '0 4px 16px rgba(0,0,0,.10)',
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <SectionLabel t={t}>Hourly Activity</SectionLabel>
        {peakHour?.bills > 0 && (
          <span style={{ fontSize:'.56rem', color:t.text4 }}>
            Peak <span style={{ color:t.gold, fontWeight:700 }}>{fmtH(peakHour.hour)}</span>
            {' '}· <span style={{ color:t.green, fontFamily:'ui-monospace,monospace' }}>{peakHour.approved}</span> approved
          </span>
        )}
      </div>

      {/* Bar chart */}
      <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:100 }}>
        {data.map(d => {
          const isCur  = d.hour === nowHour
          const isPeak = d.bills === maxBills && d.bills > 0
          const pct    = (d.bills / maxBills) * 100

          return (
            <div key={d.hour} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              {d.bills > 0 && (
                <span style={{ fontSize:'.44rem', color: isCur ? t.gold : isPeak ? t.text2 : t.text4, fontFamily:'ui-monospace,monospace', lineHeight:1 }}>{d.bills}</span>
              )}
              <div style={{ width:'100%', flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                <div style={{
                  width:'100%', height:`${pct}%`, minHeight: d.bills > 0 ? 3 : 0,
                  borderRadius:'3px 3px 0 0', overflow:'hidden',
                  outline: isCur ? `1.5px solid ${t.gold}` : 'none',
                  outlineOffset: 1,
                  transition:'height .7s cubic-bezier(.4,0,.2,1)',
                  display:'flex', flexDirection:'column',
                }}>
                  {d.rejected > 0 && <div style={{ flex: d.rejected, background: t.red }} />}
                  {d.pending  > 0 && <div style={{ flex: d.pending,  background: t.orange }} />}
                  {d.approved > 0 && <div style={{ flex: d.approved, background: d.bills === maxBills ? `linear-gradient(180deg,${t.green},${t.green}cc)` : t.green }} />}
                  {d.bills === 0   && <div style={{ flex:1, background: t.border, opacity:.4 }} />}
                </div>
              </div>
              <span style={{ fontSize:'.44rem', color: isCur ? t.gold : t.text4, fontWeight: isCur ? 700 : 400, lineHeight:1 }}>{fmtH(d.hour)}</span>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:14, marginTop:10, paddingTop:10, borderTop:`1px solid ${t.border}`, alignItems:'center' }}>
        {[[t.green,'Approved'],[t.orange,'Pending'],[t.red,'Rejected']].map(([c,l]) => (
          <span key={l} style={{ display:'flex', alignItems:'center', gap:4, fontSize:'.52rem', color:t.text4 }}>
            <span style={{ width:8, height:8, borderRadius:2, background:c, display:'block' }} />{l}
          </span>
        ))}
        {totalToday > 0 && <span style={{ marginLeft:'auto', fontSize:'.52rem', color:t.text4 }}>{totalToday} total bills today</span>}
      </div>
    </div>
  )
}

/* ── Payment Mode Breakdown ── */
function PaymentModeStrip({ txns, t }) {
  const approved = (txns || []).filter(tx => tx.trxn_status === 'approved')
  const total    = approved.length
  if (total === 0) return (
    <div style={{ background:`linear-gradient(160deg,${t.surface} 0%,${t.card} 100%)`, border:`1px solid ${t.border}`, borderRadius:16, padding:'18px 20px', boxShadow:'0 4px 16px rgba(0,0,0,.10)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <span style={{ fontSize:'.72rem', color:t.text4 }}>No payments recorded yet</span>
    </div>
  )

  const modeCounts = {}
  approved.forEach(tx => {
    const m = (tx.pymt_mde || 'Unknown').trim()
    modeCounts[m] = (modeCounts[m] || 0) + 1
  })

  const palette = { cash:t.green, upi:t.blue, neft:t.gold, cheque:t.purple, card:t.orange, rtgs:t.text2, online:t.blue }
  const modeColor = m => palette[m.toLowerCase()] || t.text3

  const modes = Object.entries(modeCounts)
    .sort((a,b) => b[1]-a[1])
    .map(([mode,count]) => ({ mode, count, pct: Math.round(count/total*100) }))

  return (
    <div style={{
      background:`linear-gradient(160deg,${t.surface} 0%,${t.card} 100%)`,
      border:`1px solid ${t.border}`, borderRadius:16,
      padding:'18px 20px 14px',
      boxShadow:'0 4px 16px rgba(0,0,0,.10)',
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <SectionLabel t={t}>Payment Modes</SectionLabel>
        <span style={{ fontSize:'.56rem', color:t.text4 }}>{total} approved bills</span>
      </div>

      {/* Proportional bar */}
      <div style={{ display:'flex', height:8, borderRadius:100, overflow:'hidden', gap:1, marginBottom:16, boxShadow:'inset 0 1px 3px rgba(0,0,0,.2)' }}>
        {modes.map(m => (
          <div key={m.mode} style={{ width:`${m.pct}%`, background:modeColor(m.mode), minWidth:3, transition:'width .7s ease' }} />
        ))}
      </div>

      {/* Mode list */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {modes.map(m => (
          <div key={m.mode} style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:8, height:8, borderRadius:2, background:modeColor(m.mode), flexShrink:0 }} />
            <span style={{ fontSize:'.65rem', color:t.text2, textTransform:'capitalize', flex:1 }}>{m.mode}</span>
            <span style={{ fontSize:'.7rem', fontFamily:'ui-monospace,monospace', fontWeight:600, color:modeColor(m.mode) }}>{m.count}</span>
            <span style={{ fontSize:'.55rem', color:t.text4, width:30, textAlign:'right' }}>{m.pct}%</span>
            <div style={{ width:56, height:4, borderRadius:2, background:t.border, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${m.pct}%`, background:modeColor(m.mode), transition:'width .7s ease', borderRadius:2 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Walk-in Intelligence (Source + Reason breakdown) ── */
function WalkinIntelligence({ walkins, t }) {
  const buildBreakdown = (arr, key) => {
    const counts = {}
    arr.forEach(w => { const v = w[key] || '(not set)'; counts[v] = (counts[v]||0)+1 })
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8)
  }
  const total       = walkins.length
  const sources     = buildBreakdown(walkins, 'source')
  const reasons     = buildBreakdown(walkins, 'walk_reason')

  if (sources.length === 0 && reasons.length === 0) return null

  const sourceColors = ['#c9a84c','#4a9fdf','#3aaa6a','#e09830','#9a6adf','#e05555','#5abcdf','#df8a5a']

  const MiniBar = ({ items, total: tot, colors }) => (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {/* Proportional bar */}
      <div style={{ display:'flex', height:6, borderRadius:100, overflow:'hidden', gap:1, marginBottom:4 }}>
        {items.map(([k,v],i) => (
          <div key={k} style={{ width:`${Math.round(v/tot*100)}%`, background:colors[i%colors.length], minWidth:3, transition:'width .7s ease' }} />
        ))}
      </div>
      {items.map(([k,v],i) => (
        <div key={k} style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:7, height:7, borderRadius:2, background:colors[i%colors.length], flexShrink:0 }} />
          <span style={{ fontSize:'.62rem', color:t.text2, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={k}>{k}</span>
          <span style={{ fontSize:'.65rem', fontFamily:'ui-monospace,monospace', fontWeight:600, color:colors[i%colors.length] }}>{v}</span>
          <span style={{ fontSize:'.52rem', color:t.text4, width:28, textAlign:'right' }}>{Math.round(v/tot*100)}%</span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
      {sources.length > 0 && (
        <div style={{ background:`linear-gradient(160deg,${t.surface} 0%,${t.card} 100%)`, border:`1px solid ${t.border}`, borderRadius:16, padding:'18px 20px 14px', boxShadow:'0 4px 16px rgba(0,0,0,.10)' }}>
          <SectionLabel t={t}>Walk-in Source</SectionLabel>
          <MiniBar items={sources} total={total} colors={sourceColors} />
        </div>
      )}
      {reasons.length > 0 && (
        <div style={{ background:`linear-gradient(160deg,${t.surface} 0%,${t.card} 100%)`, border:`1px solid ${t.border}`, borderRadius:16, padding:'18px 20px 14px', boxShadow:'0 4px 16px rgba(0,0,0,.10)' }}>
          <SectionLabel t={t}>Walk-in Reason</SectionLabel>
          <MiniBar items={reasons} total={total} colors={['#4a9fdf','#c9a84c','#3aaa6a','#9a6adf','#e09830','#e05555','#5abcdf','#df8a5a']} />
        </div>
      )}
    </div>
  )
}

/* ── Branch Performance Table ── */
function BranchTable({ t, branchData, allWalkins }) {
  // Walk-in counts per branch_id from today's walk-ins
  const wkMap = {}
  ;(allWalkins || []).forEach(w => {
    if (w.branch_id) wkMap[String(w.branch_id)] = (wkMap[String(w.branch_id)] || 0) + 1
  })

  const rows = (branchData || [])
    .map(b => ({
      name:     b.branch_name || '—',
      walkins:  wkMap[String(b.branch_id)] || 0,
      bills:    Number(b.bills)    || 0,
      approved: Number(b.approved) || 0,
      pending:  Number(b.pending)  || 0,
      rejected: Number(b.rejected) || 0,
      value:    Number(b.value)    || 0,
    }))
    .sort((a,b) => b.approved - a.approved)

  if (rows.length === 0) return null
  const maxApproved = Math.max(...rows.map(r => r.approved), 1)

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <SectionLabel t={t}>Branch Performance Today</SectionLabel>
        <button onClick={() => downloadCSV('branches.csv',
          ['Branch','Walk-ins','Bills','Approved','Pending','Rejected','Value'],
          rows, r => [r.name, r.walkins, r.bills, r.approved, r.pending, r.rejected, r.value])}
          style={{ padding:'4px 12px', borderRadius:6, fontSize:'.58rem', cursor:'pointer', border:`1px solid ${t.border}`, background:t.card, color:t.text3, marginBottom:12 }}>
          ↓ CSV
        </button>
      </div>
      <Card t={t} style={{ padding:0, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <div style={{ minWidth:700 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 70px 70px 80px 70px 70px 110px 130px', gap:8, padding:'8px 16px', background:t.card2, borderBottom:`1px solid ${t.border}` }}>
              {['Branch','Walk-ins','Bills','Approved','Pending','Rejected','Value','Conversion'].map(h => (
                <span key={h} style={{ fontSize:'.56rem', color:t.text3, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase' }}>{h}</span>
              ))}
            </div>
            {rows.map((r, i) => {
              const conv = r.walkins > 0 ? Math.round(r.approved/r.walkins*100) : (r.bills > 0 ? Math.round(r.approved/r.bills*100) : 0)
              const convColor = conv >= 60 ? t.green : conv >= 35 ? t.orange : t.red
              return (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 70px 70px 80px 70px 70px 110px 130px', gap:8, padding:'11px 16px', borderBottom: i < rows.length-1 ? `1px solid ${t.border}18` : 'none', alignItems:'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                    <div style={{ width:3, height:20, borderRadius:2, background:`linear-gradient(180deg,${t.gold},${t.gold}60)`, flexShrink:0 }} />
                    <span style={{ fontSize:'.72rem', color:t.text1, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</span>
                  </div>
                  <span style={{ fontSize:'.68rem', color:t.blue,   fontFamily:'ui-monospace,monospace' }}>{r.walkins || '—'}</span>
                  <span style={{ fontSize:'.68rem', color:t.text2,  fontFamily:'ui-monospace,monospace' }}>{r.bills}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ flex:1, height:4, borderRadius:2, background:t.border, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${Math.round(r.approved/maxApproved*100)}%`, background:t.green, borderRadius:2, transition:'width .6s ease' }} />
                    </div>
                    <span style={{ fontSize:'.68rem', color:t.green, fontFamily:'ui-monospace,monospace', fontWeight:600, minWidth:18, textAlign:'right' }}>{r.approved}</span>
                  </div>
                  <span style={{ fontSize:'.68rem', color:t.orange, fontFamily:'ui-monospace,monospace' }}>{r.pending || '—'}</span>
                  <span style={{ fontSize:'.68rem', color:t.red,    fontFamily:'ui-monospace,monospace' }}>{r.rejected || '—'}</span>
                  <span style={{ fontSize:'.68rem', color:t.gold,   fontFamily:'ui-monospace,monospace' }}>{r.value > 0 ? fmtAmt(r.value) : '—'}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ flex:1, height:5, borderRadius:2, background:t.border, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${conv}%`, background:convColor, borderRadius:2, transition:'width .6s ease' }} />
                    </div>
                    <span style={{ fontSize:'.62rem', color:convColor, fontFamily:'ui-monospace,monospace', fontWeight:600, minWidth:30, textAlign:'right' }}>{conv}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>
    </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px 80px 90px 110px 90px', gap: 8, padding: '8px 16px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
          {cols.map(h => <span key={h} style={{ fontSize: '.56rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</span>)}
        </div>
        {rows.map((r, i) => (
          <div key={r.region} style={{
            display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px 80px 90px 110px 90px',
            gap: 8, padding: '11px 16px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', alignItems: 'center',
          }}
            onMouseEnter={e => e.currentTarget.style.background = t.card2}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span style={{ fontSize: '.75rem', color: t.text1, fontWeight: 600 }}>{r.region}</span>
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
  const isTxn = item.type === 'txn'
  const statusStyle = isTxn ? (STATUS_STYLE[item.status] || {}) : {}
  const accentColor = isTxn ? (statusStyle.color || t.gold) : t.blue
  const typeIcon = isTxn ? '📋' : '🚶'
  const goldTypeBadge = isTxn && item.goldType
    ? ({ physical: 'Physical', released: 'Takeover' }[item.goldType] || item.goldType)
    : null
  const wt = isTxn ? item.weight : (item.weight ? Number(item.weight) : 0)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '70px 28px 1fr 110px 120px',
      gap: '0 12px',
      padding: '12px 20px',
      borderBottom: isLast ? 'none' : `1px solid ${t.border}18`,
      alignItems: 'center',
      borderLeft: `3px solid ${accentColor}40`,
      transition: 'background .12s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = t.card2}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Time */}
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.66rem', color: t.text3, textAlign: 'right', lineHeight: 1 }}>
        {fmtTime(item.time)}
      </span>
      {/* Type icon + dot */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: '.75rem', lineHeight: 1 }}>{typeIcon}</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accentColor, display: 'block', boxShadow: `0 0 5px ${accentColor}60` }} />
      </div>
      {/* Main info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.78rem', color: t.text1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
            {item.name || 'Unknown'}
          </span>
          <span style={{
            fontSize: '.56rem', padding: '2px 7px', borderRadius: 4,
            background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}35`,
            fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            {isTxn ? (statusStyle.label || item.status) : (item.walkinStatus || 'walk-in')}
          </span>
          {goldTypeBadge && (
            <span style={{
              fontSize: '.52rem', padding: '2px 6px', borderRadius: 4,
              background: `${t.gold}12`, color: t.gold, border: `1px solid ${t.gold}25`,
              fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {goldTypeBadge}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          {item.branch && <span style={{ fontSize: '.62rem', color: t.text3 }}>{item.branch}</span>}
          {item.mobile && <span style={{ fontSize: '.6rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>{item.mobile}</span>}
          {isTxn && item.bill && (
            <span style={{ fontSize: '.58rem', color: t.gold, fontFamily: 'ui-monospace, monospace', opacity: .7 }}>#{item.bill}</span>
          )}
        </div>
      </div>
      {/* Weight */}
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.72rem', color: wt > 0 ? t.text1 : t.text4, textAlign: 'right', fontWeight: wt > 0 ? 500 : 400 }}>
        {wt > 0 ? fmtWt(wt) : '—'}
      </span>
      {/* Amount */}
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.74rem', color: isTxn && item.amount ? t.gold : t.text4, textAlign: 'right', fontWeight: isTxn && item.amount ? 600 : 400 }}>
        {isTxn && item.amount != null ? fmtAmt(item.amount) : '—'}
      </span>
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
  const [tlSearch, setTlSearch]         = useState('')
  const toggleMetric = key => setActiveMetric(prev => prev === key ? null : key)

  // Offline state
  if (newCrmTxns === null || newCrmTxns === undefined) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:360, gap:16 }}>
        <div style={{ width:64, height:64, borderRadius:16, background:t.card, border:`1px solid ${t.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.6rem', color:t.text4 }}>~</div>
        <span style={{ fontSize:'.88rem', color:t.text2, fontWeight:300 }}>New CRM Offline</span>
        {newCrmError && (
          <div style={{ background:`${t.red}12`, border:`1px solid ${t.red}30`, borderRadius:8, padding:'8px 16px', maxWidth:480, fontFamily:'ui-monospace,monospace', fontSize:'.62rem', color:t.red, wordBreak:'break-all', textAlign:'center' }}>
            {newCrmError}
          </div>
        )}
        <span style={{ fontSize:'.62rem', color:t.text4, maxWidth:320, textAlign:'center', lineHeight:1.6 }}>
          The new PostgreSQL-based CRM is not reporting data at this time.
        </span>
      </div>
    )
  }

  const txns = regionFilter ? newCrmTxns.filter(tx => tx.region === regionFilter) : newCrmTxns

  const completedTxns   = txns.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED')
  const walkoutTxns     = txns.filter(tx => tx.status === 'WALKOUT')
  const inProgressTxns  = txns.filter(tx => IN_PROGRESS_STATUSES.includes(tx.status))
  const walkinStageTxns = txns.filter(tx => tx.status === 'WALKIN')
  const estimationTxns  = txns.filter(tx => ['ESTIMATION_PENDING','PLEDGE_ESTIMATION_PENDING','REVALUATION_PENDING','SALES_NEGOTIATION_PENDING','QUOTATION_PENDING'].includes(tx.status))
  const kycPendingTxns  = txns.filter(tx => ['KYC_PENDING','BRANCH_KYC_PENDING','PLEDGE_APPROVAL_PENDING'].includes(tx.status))
  const paymentDueTxns  = txns.filter(tx => ['FINAL_PAYMENT_PENDING','PENNY_DROP_PENDING','RELEASE_PENDING','RELEASE_AGREEMENT_PENDING'].includes(tx.status))

  const total          = txns.length
  const completed      = completedTxns.length
  const inProgress     = inProgressTxns.length
  const walkout        = walkoutTxns.length
  const completedValue = completedTxns.reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
  const walkoutValue   = walkoutTxns.reduce((s,  tx) => s + (Number(tx.amount) || 0), 0)
  const conversionPct  = total > 0 ? Math.round(completed / total * 100) : 0

  if (!total) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:300, gap:12 }}>
      <span style={{ fontSize:'2rem', opacity:.3 }}>~</span>
      <span style={{ fontSize:'.82rem', color:t.text3 }}>No activity recorded yet</span>
      <span style={{ fontSize:'.62rem', color:t.text4 }}>Data will appear as transactions come in</span>
    </div>
  )

  // Exceptions — actionable only
  const exceptions = []
  if (paymentDueTxns.length > 0) exceptions.push({
    key:'payment', icon:'💳', color:t.gold, urgent:true,
    headline:`${paymentDueTxns.length} customer${paymentDueTxns.length>1?'s':''} ready to pay`,
    sub:`Final payment pending — follow up to close before end of day`,
  })
  if (walkinStageTxns.length > 0) exceptions.push({
    key:'walkin', icon:'🪑', color:t.blue, urgent:false,
    headline:`${walkinStageTxns.length} still at walk-in stage`,
    sub:`Not yet progressed to estimation`,
  })
  if (walkout > 0) exceptions.push({
    key:'walkout', icon:'🚶', color:t.red, urgent:walkoutValue>50000,
    headline:`${walkout} walkout${walkout>1?'s':''}${walkoutValue>0?` · ${fmtAmt(walkoutValue)} lost`:''}`,
    sub:`Customers who left without completing the transaction`,
  })
  if (kycPendingTxns.length > 0) exceptions.push({
    key:'kyc', icon:'📋', color:'#8c5ac8', urgent:false,
    headline:`${kycPendingTxns.length} waiting for KYC clearance`,
    sub:`KYC verification in progress`,
  })

  // Pipeline stages
  const PIPELINE = [
    { key:'walkin',     label:'Walk-in',     count:walkinStageTxns.length,  color:t.blue    },
    { key:'estimation', label:'Estimation',  count:estimationTxns.length,   color:t.orange  },
    { key:'kyc',        label:'KYC',         count:kycPendingTxns.length,   color:'#8c5ac8' },
    { key:'payment',    label:'Payment Due', count:paymentDueTxns.length,   color:t.gold    },
    { key:'completed',  label:'Completed',   count:completed,               color:t.green   },
  ]

  const sorted = [...txns].sort((a, b) => (b.txn_time || '').localeCompare(a.txn_time || ''))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* ── 1. TODAY'S PULSE ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr) auto', gap:8, alignItems:'stretch' }}>
        {[
          { label:'Total',       value:total,     color:t.blue,   sub:null,                                        key:'total'      },
          { label:'In Progress', value:inProgress, color:t.orange, sub:null,                                       key:'inprogress' },
          { label:'Completed',   value:completed,  color:t.green,  sub:fmtAmt(completedValue),                    key:'completed'  },
          { label:'Walkout',     value:walkout,    color:t.red,    sub:walkoutValue>0?fmtAmt(walkoutValue):null,   key:'walkout'    },
        ].map(item => (
          <div key={item.key} onClick={() => toggleMetric(item.key)} style={{
            background:activeMetric===item.key?`${item.color}12`:t.card,
            border:`1px solid ${activeMetric===item.key?item.color+'50':t.border}`,
            borderTop:`3px solid ${item.color}`,
            borderRadius:10, padding:'14px 16px', cursor:'pointer',
            transition:'all .15s', display:'flex', flexDirection:'column', gap:4,
          }}
            onMouseEnter={e => { if (activeMetric!==item.key) e.currentTarget.style.background=t.card2 }}
            onMouseLeave={e => { if (activeMetric!==item.key) e.currentTarget.style.background=t.card }}>
            <span style={{ fontSize:'1.8rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:item.color, lineHeight:1, letterSpacing:'-.03em' }}>{fmtNum(item.value)}</span>
            <span style={{ fontSize:'.52rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700 }}>{item.label}</span>
            {item.sub && <span style={{ fontSize:'.6rem', color:item.color, fontFamily:'ui-monospace,monospace', opacity:.8 }}>{item.sub}</span>}
          </div>
        ))}
        {/* Conversion */}
        <div style={{ background:t.card, border:`1px solid ${t.border}`, borderTop:`3px solid ${conversionPct>=50?t.green:t.orange}`, borderRadius:10, padding:'14px 16px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minWidth:84, gap:4 }}>
          <span style={{ fontSize:'1.8rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:conversionPct>=50?t.green:t.orange, lineHeight:1 }}>{conversionPct}%</span>
          <span style={{ fontSize:'.52rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700, textAlign:'center' }}>Conversion</span>
        </div>
      </div>

      {/* ── 2. EXCEPTIONS ── */}
      {exceptions.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:'.48rem', color:t.text4, letterSpacing:'.14em', textTransform:'uppercase', fontWeight:700 }}>Needs Attention</span>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:8 }}>
            {exceptions.map(ex => (
              <div key={ex.key} onClick={() => toggleMetric(ex.key)} style={{
                background:activeMetric===ex.key?`${ex.color}10`:t.card,
                border:`1px solid ${activeMetric===ex.key?ex.color+'50':ex.color+'25'}`,
                borderLeft:`3px solid ${ex.color}`,
                borderRadius:9, padding:'10px 14px', cursor:'pointer', transition:'all .15s', position:'relative',
              }}>
                {ex.urgent && <div style={{ position:'absolute', top:8, right:10, width:6, height:6, borderRadius:'50%', background:ex.color, boxShadow:`0 0 6px ${ex.color}` }} />}
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                  <span style={{ fontSize:'.7rem' }}>{ex.icon}</span>
                  <span style={{ fontSize:'.63rem', fontWeight:700, color:ex.color, lineHeight:1.3 }}>{ex.headline}</span>
                </div>
                <div style={{ fontSize:'.55rem', color:t.text4, lineHeight:1.5 }}>{ex.sub}</div>
                <div style={{ fontSize:'.48rem', color:ex.color, marginTop:4, opacity:.7 }}>{activeMetric===ex.key?'▲ showing':'▼ click to see'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. PIPELINE ── */}
      <div style={{ background:t.card, border:`1px solid ${t.border}`, borderRadius:12, padding:'20px 24px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:0, flexWrap:'wrap' }}>
          {PIPELINE.map((stage, i) => (
            <div key={stage.key} style={{ display:'flex', alignItems:'center', gap:0 }}>
              <div onClick={() => toggleMetric(stage.key)} style={{
                cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                padding:'8px 16px', borderRadius:12, transition:'all .15s',
                background:activeMetric===stage.key?`${stage.color}12`:'transparent',
                border:`1px solid ${activeMetric===stage.key?stage.color+'50':'transparent'}`,
                opacity:stage.count===0?.35:1,
              }}>
                <span style={{ fontSize:'1.8rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:stage.color, lineHeight:1 }}>{stage.count}</span>
                <span style={{ fontSize:'.52rem', color:t.text4, letterSpacing:'.08em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{stage.label}</span>
              </div>
              {i < PIPELINE.length-1 && (
                <div style={{ padding:'0 4px' }}>
                  <div style={{ width:28, height:1, background:`linear-gradient(90deg,${stage.color}50,${PIPELINE[i+1].color}50)` }} />
                </div>
              )}
            </div>
          ))}
          {walkout > 0 && (
            <>
              <div style={{ width:1, height:36, background:t.border, margin:'0 14px' }} />
              <div onClick={() => toggleMetric('walkout')} style={{
                cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                padding:'8px 14px', borderRadius:10, transition:'all .15s',
                background:activeMetric==='walkout'?`${t.red}12`:t.card2,
                border:`1px dashed ${t.red}40`,
              }}>
                <span style={{ fontSize:'1.4rem', fontFamily:'ui-monospace,monospace', fontWeight:200, color:t.red, lineHeight:1 }}>{walkout}</span>
                <span style={{ fontSize:'.5rem', color:t.red, letterSpacing:'.08em', textTransform:'uppercase' }}>Walkout</span>
              </div>
            </>
          )}
        </div>
        {activeMetric && (
          <div style={{ display:'flex', justifyContent:'center', marginTop:12 }}>
            <button onClick={() => setActiveMetric(null)} style={{ padding:'3px 12px', borderRadius:20, fontSize:'.58rem', cursor:'pointer', border:`1px solid ${t.border}`, background:t.card2, color:t.text3 }}>
              Clear ✕
            </button>
          </div>
        )}
      </div>

      {/* ── 4. DETAIL TABLE ── */}
      {activeMetric && (
        <NewCrmDetail t={t} activeMetric={activeMetric} txns={txns} />
      )}

      {/* ── 5. LIVE TIMELINE (always open) ── */}
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <SectionLabel t={t}>{isToday?'Live Timeline':'Timeline'} · New CRM</SectionLabel>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {newEventCount > 0 && (
              <span onClick={clearNewEvents} style={{ background:t.green, color:'#000', borderRadius:10, fontSize:'.52rem', fontWeight:700, padding:'2px 8px', lineHeight:1.5, cursor:'pointer' }}>
                +{newEventCount} new
              </span>
            )}
            <input type="text" placeholder="Search..." value={tlSearch} onChange={e => setTlSearch(e.target.value)}
              style={{ background:t.card2, border:`1px solid ${t.border}`, borderRadius:6, padding:'5px 10px', fontSize:'.62rem', color:t.text2, outline:'none', width:180, fontFamily:'ui-monospace,monospace' }} />
          </div>
        </div>
        <Card t={t} style={{ padding:0, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'70px 28px 1fr 110px 120px', gap:'0 12px', padding:'8px 20px', background:t.card2, borderBottom:`1px solid ${t.border}` }}>
            {['Time','','Customer / Branch','Weight','Amount'].map((h,i) => (
              <span key={i} style={{ fontSize:'.57rem', color:t.text3, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', textAlign:i>=3?'right':i===0?'right':'left' }}>{h}</span>
            ))}
          </div>
          <div style={{ maxHeight:520, overflowY:'auto' }}>
            {sorted.filter(tx => {
              if (!tlSearch) return true
              const s = tlSearch.toLowerCase()
              return (tx.cust_name||'').toLowerCase().includes(s)||(tx.cust_mobile||'').includes(s)||(tx.branch_name||'').toLowerCase().includes(s)
            }).map((tx,i,arr) => (
              <NewCrmTimelineRow key={tx.id} item={tx} t={t} isLast={i===arr.length-1} />
            ))}
            {sorted.length===0 && <div style={{ padding:32, textAlign:'center', color:t.text4, fontSize:'.72rem' }}>No events yet</div>}
          </div>
        </Card>
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

/* ── New CRM Hourly Chart ── */
function NewCrmHourlyChart({ txns, t, isToday }) {
  const hours = {}
  for (let h = 7; h <= 21; h++) hours[h] = { completed: 0, inprogress: 0, walkout: 0 }
  for (const tx of txns) {
    const h = parseInt((tx.txn_time || '00:00:00').split(':')[0])
    const key = Math.min(Math.max(h, 7), 21)
    if (tx.status === 'FINAL_PAYMENT_COMPLETED') hours[key].completed++
    else if (tx.status === 'WALKOUT') hours[key].walkout++
    else hours[key].inprogress++
  }
  const hArr = Object.entries(hours).map(([h, v]) => ({ h: parseInt(h), ...v, total: v.completed + v.inprogress + v.walkout }))
  const maxVal = Math.max(...hArr.map(h => h.total), 1)
  const peakH  = hArr.reduce((b, h) => h.total > b.total ? h : b, hArr[0])
  const nowHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours()
  const hLabel = h => h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '.6rem', color: t.text3, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Hourly Activity</span>
        {peakH.total > 0 && <span style={{ fontSize: '.58rem', color: t.text4 }}>peak <strong style={{ color: t.gold }}>{hLabel(peakH.h)}</strong> · {peakH.total}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
        {hArr.map(({ h, completed, inprogress, walkout, total }) => {
          const barH = maxVal > 0 ? Math.max(total / maxVal * 56, total > 0 ? 4 : 0) : 0
          const isCurrent = isToday && h === nowHour
          return (
            <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              {total > 0 && <span style={{ fontSize: '.42rem', color: isCurrent ? t.gold : t.text4, fontFamily: 'ui-monospace,monospace', lineHeight: 1 }}>{total}</span>}
              <div style={{ width: '100%', height: barH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: '3px 3px 0 0', overflow: 'hidden', outline: isCurrent ? `1.5px solid ${t.gold}` : 'none', outlineOffset: 1 }}>
                {walkout > 0   && <div style={{ width: '100%', flex: walkout,    background: t.red }} />}
                {inprogress > 0 && <div style={{ width: '100%', flex: inprogress, background: t.orange }} />}
                {completed > 0  && <div style={{ width: '100%', flex: completed,  background: t.green }} />}
                {total === 0    && <div style={{ width: '100%', height: 2, background: t.border, borderRadius: 2 }} />}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
        {hArr.map(({ h }) => (
          <div key={h} style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: '.38rem', color: isToday && h === nowHour ? t.gold : t.text4 }}>{hLabel(h)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
        {[['Completed', t.green], ['In Progress', t.orange], ['Walkout', t.red]].map(([l, c]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 6, height: 6, borderRadius: 1, background: c }} />
            <span style={{ fontSize: '.48rem', color: t.text4 }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── New CRM Transaction Type Strip ── */
function NewCrmTxnTypeStrip({ txns, t }) {
  const physical  = txns.filter(tx => !(tx.transaction_type || '').toUpperCase().includes('RELEASE'))
  const takeover  = txns.filter(tx =>  (tx.transaction_type || '').toUpperCase().includes('RELEASE'))
  const physDone  = physical.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED')
  const tkoDone   = takeover.filter(tx => tx.status === 'FINAL_PAYMENT_COMPLETED')
  const physVal   = physDone.reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
  const tkoVal    = tkoDone.reduce((s,  tx) => s + (Number(tx.amount) || 0), 0)
  const physConv  = physical.length > 0 ? Math.round(physDone.length / physical.length * 100) : 0
  const tkoConv   = takeover.length > 0 ? Math.round(tkoDone.length  / takeover.length  * 100) : 0
  const total     = txns.length
  const physPct   = total > 0 ? Math.round(physical.length / total * 100) : 0
  const tkoPct    = total > 0 ? Math.round(takeover.length / total * 100) : 0

  const items = [
    { label: 'Physical',  count: physical.length, done: physDone.length, value: physVal, conv: physConv, pct: physPct, color: t.blue },
    { label: 'Takeover',  count: takeover.length, done: tkoDone.length,  value: tkoVal,  conv: tkoConv,  pct: tkoPct,  color: t.gold },
  ]
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: '.6rem', color: t.text3, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Transaction Type</span>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
        {items.map(item => item.count > 0 && (
          <div key={item.label} style={{ flex: item.count, background: item.color, opacity: .75 }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {items.map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: item.count === 0 ? .35 : 1 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
            <span style={{ fontSize: '.65rem', color: t.text2, flex: 1 }}>{item.label}</span>
            <span style={{ fontSize: '.6rem', fontFamily: 'ui-monospace,monospace', color: item.color, fontWeight: 600, minWidth: 24, textAlign: 'right' }}>{item.count}</span>
            <span style={{ fontSize: '.55rem', color: t.text4, minWidth: 28, textAlign: 'right' }}>{item.pct}%</span>
            <div style={{ width: 40, height: 3, borderRadius: 2, background: t.border, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ height: '100%', width: `${item.conv}%`, background: item.conv >= 50 ? t.green : t.orange, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: '.55rem', color: t.text4, minWidth: 28, textAlign: 'right' }}>{item.conv}%</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.filter(i => i.value > 0).map(item => (
          <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '.55rem', color: t.text4 }}>{item.label} value</span>
            <span style={{ fontSize: '.6rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{fmtAmt(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
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

/* ── New CRM Branch Performance Table ── */
function NewCrmBranchTable({ txns, t }) {
  const map = {}
  for (const tx of txns) {
    const b = (tx.branch_name || 'Unknown').trim()
    if (!map[b]) map[b] = { name: b, total: 0, completed: 0, inprogress: 0, walkout: 0, value: 0 }
    map[b].total++
    if (tx.status === 'FINAL_PAYMENT_COMPLETED') { map[b].completed++; map[b].value += Number(tx.amount) || 0 }
    else if (tx.status === 'WALKOUT') map[b].walkout++
    else if (IN_PROGRESS_STATUSES.includes(tx.status)) map[b].inprogress++
  }
  const rows = Object.values(map).sort((a, b) => b.completed - a.completed)
  if (!rows.length) return null
  const maxComp = Math.max(...rows.map(r => r.completed), 1)
  const cols = ['Branch', 'Total', 'In Prog', 'Completed', 'Walkout', 'Value', 'Conv %']
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionLabel t={t}>Branch Performance · New CRM</SectionLabel>
        <button onClick={() => downloadCSV('new-crm-branches.csv', cols, rows, r => [r.name, r.total, r.inprogress, r.completed, r.walkout, r.value.toFixed(0), `${r.total > 0 ? Math.round(r.completed/r.total*100) : 0}%`])}
          style={{ padding: '4px 12px', borderRadius: 6, fontSize: '.58rem', cursor: 'pointer', border: `1px solid ${t.border}`, background: t.card, color: t.text3 }}>
          ↓ CSV
        </button>
      </div>
      <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px 110px 70px 110px 80px', gap: 8, padding: '8px 16px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
              {cols.map(h => <span key={h} style={{ fontSize: '.56rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</span>)}
            </div>
            {rows.map((r, i) => {
              const conv = r.total > 0 ? Math.round(r.completed / r.total * 100) : 0
              return (
                <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px 110px 70px 110px 80px', gap: 8, padding: '10px 16px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.card2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ fontSize: '.68rem', color: t.blue, fontFamily: 'ui-monospace,monospace' }}>{r.total}</span>
                  <span style={{ fontSize: '.68rem', color: t.orange, fontFamily: 'ui-monospace,monospace' }}>{r.inprogress || '—'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '.68rem', color: t.green, fontFamily: 'ui-monospace,monospace', fontWeight: 600, minWidth: 20 }}>{r.completed}</span>
                    <div style={{ flex: 1, height: 3, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${r.completed / maxComp * 100}%`, background: t.green, borderRadius: 2 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: '.68rem', color: t.red, fontFamily: 'ui-monospace,monospace' }}>{r.walkout || '—'}</span>
                  <span style={{ fontSize: '.68rem', color: t.gold, fontFamily: 'ui-monospace,monospace' }}>{r.value > 0 ? fmtAmt(r.value) : '—'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${conv}%`, background: conv >= 50 ? t.green : conv >= 30 ? t.orange : t.red, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: '.6rem', color: t.text3, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{conv}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 100px 90px 80px 110px 90px', gap: 8, padding: '8px 16px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
          {cols.map(h => <span key={h} style={{ fontSize: '.56rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</span>)}
        </div>
        {rows.map((r, i) => (
          <div key={r.region} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 100px 90px 80px 110px 90px', gap: 8, padding: '11px 16px', borderBottom: i < rows.length - 1 ? `1px solid ${t.border}18` : 'none', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = t.card2}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span style={{ fontSize: '.75rem', color: t.text1, fontWeight: 600 }}>{r.region}</span>
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
      </Card>
    </div>
  )
}

/* ── New CRM Timeline Row ── */
function NewCrmTimelineRow({ item, t, isLast }) {
  const statusStyle = NEW_CRM_STATUS[item.status] || { label: item.status, color: t.text3 }
  const accentColor = statusStyle.color
  const wt = Number(item.gross_weight) || 0
  const isTakeover = (item.transaction_type || '').toUpperCase().includes('RELEASE')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '70px 28px 1fr 110px 120px', gap: '0 12px', padding: '12px 20px', borderBottom: isLast ? 'none' : `1px solid ${t.border}18`, alignItems: 'center', borderLeft: `3px solid ${accentColor}40`, transition: 'background .12s' }}
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
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.72rem', color: wt > 0 ? t.text1 : t.text4, textAlign: 'right', fontWeight: wt > 0 ? 500 : 400 }}>{wt > 0 ? fmtWt(wt) : '—'}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.74rem', color: item.status === 'FINAL_PAYMENT_COMPLETED' && item.amount ? t.gold : t.text4, textAlign: 'right', fontWeight: item.status === 'FINAL_PAYMENT_COMPLETED' && item.amount ? 600 : 400 }}>{item.amount ? fmtAmt(item.amount) : '—'}</span>
    </div>
  )
}
