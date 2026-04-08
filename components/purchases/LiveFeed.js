'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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

const STAGE_META = {
  WALKIN:                  { label: 'Walk-in',        color: '#4a9fdf', order: 0, icon: '\u2192' },
  ESTIMATION_PENDING:      { label: 'Valuation',      color: '#e09830', order: 1, icon: '\u2696' },
  KYC_PENDING:             { label: 'KYC',            color: '#9a6adf', order: 2, icon: '\ud83e\udea3' },
  FINAL_PAYMENT_PENDING:   { label: 'Payment Due',    color: '#c9a84c', order: 3, icon: '\u20b9' },
  FINAL_PAYMENT_COMPLETED: { label: 'Purchased',      color: '#3aaa6a', order: 4, icon: '\u2713' },
  WALKOUT:                 { label: 'Walkout',        color: '#e05555', order: 5, icon: '\u2715' },
}
const STAGE_ORDER_FUNNEL = ['WALKIN', 'ESTIMATION_PENDING', 'KYC_PENDING', 'FINAL_PAYMENT_PENDING', 'FINAL_PAYMENT_COMPLETED']

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
  const { theme: appTheme } = useApp()
  const t = THEMES[appTheme] || THEMES.dark

  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [viewDate,      setViewDate]      = useState(todayIST)
  const [crmTab,        setCrmTab]        = useState('old')
  const [tlFilter,      setTlFilter]      = useState('all') // kept for filteredTimeline
  const [search,        setSearch]        = useState('')   // kept for filteredTimeline
  const [regionFilter,  setRegionFilter]  = useState('')   // '' = all regions
  const [data,          setData]          = useState(null)
  const [loadError,     setLoadError]     = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [countdown,     setCountdown]     = useState(REFRESH_SECS)

  const timerRef = useRef(null)
  const countRef = useRef(null)

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
    timerRef.current = setInterval(() => load(), REFRESH_SECS * 1000)
    return () => clearInterval(timerRef.current)
  }, [load])

  useEffect(() => {
    setCountdown(REFRESH_SECS)
    countRef.current = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(countRef.current)
  }, [lastUpdated])

  /* ── Derived ── */
  const summary = data?.summary || {}
  const walkinSummary = data?.walkinSummary || {}
  const stages = data?.stages || null
  const todayTxns   = data?.todayTxns   || []
  const todayWalkins = data?.todayWalkins || []
  const regions     = data?.allRegions  || []
  const goldPipeline = data?.goldPipeline || {}
  const kycRows      = data?.kycRows      || []

  const isToday = viewDate === todayIST

  // Region-filtered raw rows
  const rTxns    = regionFilter ? todayTxns.filter(tx => tx.region === regionFilter)   : todayTxns
  const rWalkins = regionFilter ? todayWalkins.filter(w => w.region === regionFilter)  : todayWalkins

  // Mobile sets for cross-table deduplication (region-scoped)
  const rApprovedMobiles = new Set(rTxns.filter(t => t.trxn_status === 'approved').map(t => t.cust_mobile).filter(Boolean))
  const rBilledMobiles   = new Set(rTxns.map(t => t.cust_mobile).filter(Boolean))
  const rKycMobiles      = new Set(
    (regionFilter ? kycRows.filter(r => r.region === regionFilter) : kycRows).map(r => r.mob_num).filter(Boolean)
  )

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
    // KYC — region-filtered via branh_id→region mapping
    kyc_blacklisted_cnt: kycRows.filter(r => r.region === regionFilter).length,
    kyc_blacklisted_wt:  parseFloat(kycRows.filter(r => r.region === regionFilter).reduce((s, r) => s + (parseFloat(r.grams) || 0), 0).toFixed(2)),
    kyc_overridden_cnt:  kycRows.filter(r => r.region === regionFilter && rApprovedMobiles.has(r.mob_num)).length,
    // not_billed already excludes KYC blocked (computed above via notBilledWalkins)
    kyc_checklist_cnt:   goldPipeline.kyc_checklist_cnt || 0,
    physical:  goldPipeline.physical  || {},
    released:  goldPipeline.released  || {},
  } : goldPipeline

  /* ── Timeline items ── */
  const timelineItems = (() => {
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
  })()

  const filteredTimeline = timelineItems.filter(item => {
    if (tlFilter === 'txn' && item.type !== 'txn') return false
    if (tlFilter === 'walkin' && item.type !== 'walkin') return false
    if (tlFilter === 'approved' && !(item.type === 'txn' && item.status === 'approved')) return false
    if (tlFilter === 'pending' && !(item.type === 'txn' && item.status === 'pending')) return false
    if (regionFilter && item.region !== regionFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return (item.name || '').toLowerCase().includes(s) ||
        (item.mobile || '').includes(s) ||
        (item.branch || '').toLowerCase().includes(s) ||
        (item.bill || '').toLowerCase().includes(s)
    }
    return true
  })

  /* ═══ RENDER ═══ */
  return (
    <div style={{ background: t.bg, minHeight: '100vh', color: t.text1, padding: '0 0 40px 0' }}>
      <style>{PING_CSS}</style>

      {/* ── TOP BAR ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, background: `${t.bg}f0`,
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${t.border}`,
        boxShadow: '0 2px 12px rgba(0,0,0,.15)',
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
        <input
          type="date"
          value={viewDate}
          onChange={e => { setViewDate(e.target.value); load(e.target.value) }}
          style={{
            background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 6,
            padding: '5px 10px', fontSize: '.72rem', fontFamily: 'ui-monospace, monospace',
            outline: 'none', cursor: 'pointer',
          }}
        />

        {/* CRM tabs */}
        <div style={{ display: 'flex', background: t.card, borderRadius: 8, border: `1px solid ${t.border}`, overflow: 'hidden' }}>
          {[['old', 'Old CRM'], ['new', 'New CRM']].map(([key, label]) => (
            <button key={key} onClick={() => setCrmTab(key)} style={{
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

        {/* Region filter */}
        {regions.length > 1 && (
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
          <OldCrmTab t={t} summary={effectiveSummary} walkinSummary={effectiveWalkinSummary}
            totalWalkins={totalWalkins} totalBilled={totalBilled} approved={approved} pending={pending}
            trueRejected={trueRejected} wrongEntry={wrongEntry}
            notBilledCnt={notBilledCnt} notBilledWalkins={notBilledWalkins} crmNotUpdatedCnt={crmNotUpdatedCnt}
            goldPipeline={effectiveGoldPipeline}
            todayTxns={rTxns} todayWalkins={rWalkins}
            kycRows={regionFilter ? kycRows.filter(r => r.region === regionFilter) : kycRows}
            regionFilter={regionFilter}
            filteredTimeline={filteredTimeline} isToday={isToday} />
        ) : (
          <NewCrmTab t={t} stages={stages} />
        )}
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
  todayTxns, todayWalkins, kycRows,
  filteredTimeline, isToday,
}) {
  const [activeMetric, setActiveMetric] = useState(null)
  const [tlOpen, setTlOpen] = useState(false)
  const [tlSearch, setTlSearch] = useState('')
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
  const kycChecklistCnt   = goldPipeline?.kyc_checklist_cnt              || 0
  const missingWeightCnt  = walkinSummary.missing_weight_count          || 0
  const avgGrossWeight    = approved > 0 && goldPurchased > 0 ? goldPurchased / approved : 0
  const billedPct         = totalWalkins > 0 ? Math.round((totalBilled / totalWalkins) * 100) : 0
  const approvedPctBilled = totalBilled  > 0 ? Math.round((approved   / totalBilled)  * 100) : 0
  const conversionPct     = totalWalkins > 0 ? Math.round((approved   / totalWalkins) * 100) : 0
  const physicalApproved  = goldPipeline?.physical?.approved || 0
  const releaseApproved   = goldPipeline?.released?.approved || 0
  const physicalPending   = goldPipeline?.physical?.pending  || 0
  const releasePending    = goldPipeline?.released?.pending  || 0

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
      <div>
        <SectionLabel t={t}>Customer Journey · from Walk-in to Outcome</SectionLabel>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 0, flexWrap: 'wrap', background: t.surface, borderRadius: 16,
          border: `1px solid ${t.border}`, padding: '28px 16px',
          boxShadow: `0 4px 20px rgba(0,0,0,.12), inset 0 1px 0 ${t.border}`,
          backdropFilter: 'blur(4px)',
        }}>
          <HeroNum label="Walked In" value={totalWalkins} color={t.blue} t={t} active={activeMetric==='walkin'} onClick={() => toggleMetric('walkin')} />
          <FlowArrow t={t} pct={billedPct} />
          <HeroNum label="Bills Submitted" value={totalBilled} color={t.gold} t={t} active={activeMetric==='billed'} onClick={() => toggleMetric('billed')} />
          <FlowArrow t={t} pct={approvedPctBilled} />
          <HeroNum label="Purchased" value={approved} color={t.green} t={t} active={activeMetric==='purchased'} onClick={() => toggleMetric('purchased')} />
          <FlowSep t={t} />
          <HeroNum label="In Pipeline" value={pending} color={t.orange} t={t} small active={activeMetric==='pending'} onClick={() => toggleMetric('pending')} />
          <FlowSep t={t} />
          <HeroNum label="Bill Rejected" value={trueRejected} color={t.red} t={t} small active={activeMetric==='rejected'} onClick={() => toggleMetric('rejected')} />
          <FlowSep t={t} />
          <HeroNum label="Re-billed & Approved" value={wrongEntry} color={t.orange} t={t} small active={activeMetric==='rebilled'} onClick={() => toggleMetric('rebilled')} />
          <FlowSep t={t} />
          <HeroNum label="KYC Blocked" value={kycBlacklistedCnt} color={t.purple} t={t} small active={activeMetric==='kyc_blocked'} onClick={() => toggleMetric('kyc_blocked')} />
          <FlowSep t={t} />
          <HeroNum label="KYC Cleared Later" value={kycOverriddenCnt} color={t.blue} t={t} small active={activeMetric==='kyc_cleared'} onClick={() => toggleMetric('kyc_cleared')} />
          <FlowSep t={t} />
          <HeroNum label="Left Unbilled" value={notBilledCnt} color={t.text3} t={t} small muted active={activeMetric==='unbilled'} onClick={() => toggleMetric('unbilled')} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <Pill label="Walk→Bill" value={`${billedPct}%`} color={t.gold} bg={t.goldDim} />
          <Pill label="Bill→Purchase" value={`${approvedPctBilled}%`} color={t.green} bg={t.greenDim} />
          <Pill label="Overall conversion" value={`${conversionPct}%`} color={t.blue} bg={t.blueDim} />
          {wrongEntry > 0 && <Pill label="Wrong entries resubmitted" value={wrongEntry} color={t.orange} bg={t.orangeDim} />}
          {crmNotUpdatedCnt > 0 && <Pill label="CRM not updated" value={crmNotUpdatedCnt} color={t.text3} bg={t.card2} />}
          {kycChecklistCnt > 0 && <Pill label="KYC checklist done" value={kycChecklistCnt} color={t.text3} bg={t.card2} />}
          {activeMetric && (
            <button onClick={() => setActiveMetric(null)} style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 20, fontSize: '.58rem', cursor: 'pointer', border: `1px solid ${t.border}`, background: t.card2, color: t.text3 }}>
              Clear filter ✕
            </button>
          )}
        </div>
      </div>


      {/* ──────── 2. GOLD WEIGHT FLOW ──────── */}
      <div>
        <SectionLabel t={t}>Gold Weight Flow</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
          <MetricCard t={t} label="Walked In" color={t.blue}
            value={goldWalkedIn > 0 ? fmtWt(goldWalkedIn) : '—'}
            sub={missingWeightCnt > 0 ? `${missingWeightCnt} walkins missing wt` : `${totalWalkins} walk-ins`}
            bar={100}
            active={activeMetric === 'walkin'} onClick={() => toggleMetric('walkin')} />
          <MetricCard t={t} label="Purchased" color={t.green}
            value={goldPurchased > 0 ? fmtWt(goldPurchased) : '—'}
            sub={`${approved} bills · ${physicalApproved} physical · ${releaseApproved} takeover`}
            bar={goldWalkedIn > 0 ? (goldPurchased / goldWalkedIn) * 100 : 0}
            active={activeMetric === 'purchased'} onClick={() => toggleMetric('purchased')} />
          <MetricCard t={t} label="In Pipeline" color={t.orange}
            value={goldPending > 0 ? fmtWt(goldPending) : '—'}
            sub={`${pending} bills · ${physicalPending} physical · ${releasePending} takeover`}
            bar={goldWalkedIn > 0 ? (goldPending / goldWalkedIn) * 100 : 0}
            active={activeMetric === 'pending'} onClick={() => toggleMetric('pending')} />
          <MetricCard t={t} label="Bill Rejected Wt" color={t.red}
            value={goldRejected > 0 ? fmtWt(goldRejected) : '—'}
            sub={wrongEntry > 0 ? `${trueRejected} rejected · ${wrongEntry} wrong entries` : `${trueRejected} bills rejected`}
            bar={goldWalkedIn > 0 ? (goldRejected / goldWalkedIn) * 100 : 0}
            active={activeMetric === 'rejected'} onClick={() => toggleMetric('rejected')} />
          <MetricCard t={t} label="KYC Blocked Wt" color={t.purple}
            value={kycBlacklistedWt > 0 ? fmtWt(kycBlacklistedWt) : '—'}
            sub={`${kycBlacklistedCnt} customers blocked`}
            bar={goldWalkedIn > 0 ? (kycBlacklistedWt / goldWalkedIn) * 100 : 0}
            active={activeMetric === 'kyc_blocked'} onClick={() => toggleMetric('kyc_blocked')} />
          <MetricCard t={t} label="Left Unbilled Wt" color={t.text3}
            value={goldNotBilled > 0 ? fmtWt(goldNotBilled) : '—'}
            sub={crmNotUpdatedCnt > 0 ? `${notBilledCnt} unbilled · ${crmNotUpdatedCnt} CRM not updated` : `${notBilledCnt} left without billing`}
            bar={goldWalkedIn > 0 ? (goldNotBilled / goldWalkedIn) * 100 : 0}
            active={activeMetric === 'unbilled'} onClick={() => toggleMetric('unbilled')} />
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', padding: '6px 14px', background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '.6rem', color: t.text3 }}>Avg gross weight per purchase:</span>
          <span style={{ fontSize: '.72rem', color: t.text1, fontFamily: 'ui-monospace,monospace', fontWeight: 500 }}>{avgGrossWeight > 0 ? fmtWt(avgGrossWeight) : '—'}</span>
          <span style={{ fontSize: '.6rem', color: t.text3, marginLeft: 16 }}>Approved value:</span>
          <span style={{ fontSize: '.72rem', color: t.gold, fontFamily: 'ui-monospace,monospace', fontWeight: 500 }}>{fmtAmt(approvedValue)}</span>
        </div>

        {/* Data quality note */}
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 8,
          background: `${t.orange}0e`, border: `1px solid ${t.orange}30`,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ color: t.orange, fontSize: '.75rem', flexShrink: 0, marginTop: 1 }}>ⓘ</span>
          <div style={{ fontSize: '.62rem', color: t.text3, lineHeight: 1.7 }}>
            <strong style={{ color: t.text2 }}>Data quality notes —</strong>{' '}
            All weights are <strong>gross weights</strong> as declared by the customer at walk-in registration; actual weighed gold may differ slightly.{' '}
            <strong>KYC Blocked</strong> weight comes from a separate KYC system (not walk-in registration) and is excluded from Left Unbilled to avoid double-counting.{' '}
            A small number of walkins may not match to a bill due to missing or mismatched mobile numbers in the CRM.
          </div>
        </div>
      </div>

      {/* ──────── 3. WALKIN STATUS ──────── */}
      {totalWalkins > 0 && (
        <div>
          <SectionLabel t={t}>Walk-in Status (from CRM)</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <WalkinCard t={t} label="Sold (CRM updated)" value={walkinSummary.sold || 0} icon="✓" color={t.green} bg={t.greenDim} />
            <WalkinCard t={t} label="Visited, Not Sold" value={walkinSummary.visited_not_sold || 0} icon="✕" color={t.red} bg={t.redDim} />
            <WalkinCard t={t} label="Status Not Updated" value={walkinSummary.no_update || 0} icon="~" color={t.text3} bg={t.card2} />
          </div>
          {(walkinSummary.no_update || 0) > 0 && (
            <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 6, padding: '4px 8px' }}>
              {walkinSummary.no_update} walk-ins have no status update yet — could be still in branch, or CRM not updated after visit
            </div>
          )}
        </div>
      )}

      {/* ──────── 4. GOLD WEIGHT FLOW ──────── */}
      {/* (already rendered above — moved inline) */}

      {/* ──────── 4. DETAIL TABLE (shown only when a hero is clicked) ──────── */}
      {activeMetric && (
        <LiveDetail t={t} activeMetric={activeMetric}
          todayTxns={todayTxns} todayWalkins={todayWalkins}
          kycRows={kycRows} notBilledWalkins={notBilledWalkins} />
      )}

      {/* ──────── 5. LIVE TIMELINE (collapsed by default) ──────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tlOpen ? 10 : 0 }}>
          <SectionLabel t={t}>{isToday ? 'Live Timeline' : 'Timeline'}</SectionLabel>
          <button onClick={() => setTlOpen(o => !o)} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: '.6rem', cursor: 'pointer',
            border: `1px solid ${t.border}`, background: t.card, color: t.text3, marginBottom: 10,
          }}>
            {tlOpen ? 'Collapse ▲' : 'Expand ▼'}
          </button>
        </div>
        {tlOpen && (
          <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${t.border}` }}>
              <input
                type="text" placeholder="Search name, mobile, branch..."
                value={tlSearch} onChange={e => setTlSearch(e.target.value)}
                style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '5px 10px', fontSize: '.62rem', color: t.text2, outline: 'none', width: 200, fontFamily: 'ui-monospace, monospace' }}
              />
              <span style={{ fontSize: '.6rem', color: t.text4 }}>{filteredTimeline.length} events</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 28px 1fr 110px 120px', gap: '0 12px', padding: '8px 20px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
              {['Time', '', 'Customer / Branch', 'Weight', 'Amount'].map((h, i) => (
                <span key={i} style={{ fontSize: '.57rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: i >= 3 ? 'right' : i === 0 ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {filteredTimeline.filter(item => {
                if (!tlSearch) return true
                const s = tlSearch.toLowerCase()
                return (item.name||'').toLowerCase().includes(s) || (item.mobile||'').includes(s) || (item.branch||'').toLowerCase().includes(s)
              }).map((item, i, arr) => (
                <TimelineRow key={item.id} item={item} t={t} isLast={i === arr.length - 1} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════ */
/*                      SUB-COMPONENTS                           */
/* ════════════════════════════════════════════════════════════════ */

/* ── Hero Number (clickable) ── */
function HeroNum({ label, value, color, t, small, muted, onClick, active }) {
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
      <Mono size={small ? '1.9rem' : '2.6rem'} color={active ? color : color} weight={200}>
        {fmtNum(value)}
      </Mono>
      <span style={{
        fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase',
        color: active ? color : t.text3, marginTop: 6,
        fontWeight: active ? 700 : 500,
        transition: 'color .18s',
      }}>
        {label}
      </span>
      {active && (
        <span style={{ width: 20, height: 2, borderRadius: 1, background: color, marginTop: 6, display: 'block' }} />
      )}
    </div>
  )
}

/* ── Live Detail Table ── */
function LiveDetail({ t, activeMetric, todayTxns, todayWalkins, kycRows, notBilledWalkins }) {
  const [search, setSearch] = useState('')

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
    default:          rows = todayTxns.filter(t => t.trxn_status === 'approved'); type = 'txn'; label = `Purchased Today`
  }

  const q = search.toLowerCase()
  const filtered = q ? rows.filter(r => {
    if (type === 'txn')    return (r.cust_name||'').toLowerCase().includes(q) || (r.cust_mobile||'').includes(q) || (r.bill_no||'').toLowerCase().includes(q) || (r.branch_name||'').toLowerCase().includes(q)
    if (type === 'walkin') return (r.cust_name||'').toLowerCase().includes(q) || (r.cust_mobile||'').includes(q) || (r.branch_name||'').toLowerCase().includes(q)
    if (type === 'kyc')    return (r.name||'').toLowerCase().includes(q) || (r.mob_num||'').includes(q)
    return true
  }) : rows

  return (
    <div style={{ animation: 'slideUp .22s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionLabel t={t}>{label} · {filtered.length} records</SectionLabel>
        <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '4px 10px', fontSize: '.62rem', color: t.text2, outline: 'none', width: 170, fontFamily: 'ui-monospace, monospace' }} />
      </div>
      {type === 'txn'    && <TxnTable    rows={filtered} t={t} />}
      {type === 'walkin' && <WalkinTable rows={filtered} t={t} />}
      {type === 'kyc'    && <KycTable    rows={filtered} t={t} />}
    </div>
  )
}

/* ── Transaction table (Purchase-Data style) ── */
function TxnTable({ rows, t }) {
  const cols = ['Bill No','Date','Time','Customer','Phone','Branch','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Status']
  const widths = '100px 90px 70px 160px 110px 160px 76px 60px 70px 70px 66px 96px 46px 80px'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1260 }}>
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
  const cols = ['Time','Customer','Phone','Branch','Gold Wt','Item Type','Walk Reason','Status']
  const widths = '70px 180px 120px 160px 76px 110px 1fr 110px'
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
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
            </div>
          )
        })}
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

/* ── Metric Card ── */
function MetricCard({ t, label, value, color, sub, dim, bar, onClick, active }) {
  return (
    <Card t={t} style={{
      padding: '0', opacity: dim ? 0.5 : 1, overflow: 'hidden',
      borderTop: `3px solid ${active ? color : `${color}70`}`,
      outline: active ? `2px solid ${color}50` : '2px solid transparent',
      boxShadow: active ? `0 0 16px ${color}20, 0 2px 8px rgba(0,0,0,.12)` : '0 2px 8px rgba(0,0,0,.12)',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'outline .15s, box-shadow .15s',
    }}>
      <div
        style={{ padding: '14px 16px 12px' }}
        onMouseEnter={e => { if (onClick) e.currentTarget.parentElement.style.transform = 'translateY(-1px)' }}
        onMouseLeave={e => { if (onClick) e.currentTarget.parentElement.style.transform = 'translateY(0)' }}
        onClick={onClick}
      >
        <span style={{ fontSize: '.58rem', letterSpacing: '.12em', textTransform: 'uppercase', color: active ? color : t.text3, fontWeight: 600 }}>{label}</span>
        <div style={{ marginTop: 8 }}>
          <Mono size="1.55rem" color={color} weight={200}>{value}</Mono>
        </div>
        {sub && <span style={{ fontSize: '.6rem', color: t.text4, marginTop: 5, display: 'block', lineHeight: 1.5 }}>{sub}</span>}
        {bar != null && bar > 0 && (
          <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: t.border, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, bar)}%`, background: `${color}90`, borderRadius: 2, transition: 'width .5s ease' }} />
          </div>
        )}
        {active && <span style={{ display: 'block', marginTop: 6, fontSize: '.52rem', color, letterSpacing: '.08em', fontWeight: 700 }}>▼ showing below</span>}
      </div>
    </Card>
  )
}



/* ── Walkin Card ── */
function WalkinCard({ t, label, value, icon, color, bg }) {
  return (
    <Card t={t} style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, background: bg,
        border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1rem', color, flexShrink: 0,
        boxShadow: `0 2px 8px ${color}18`,
      }}>
        {icon}
      </div>
      <div>
        <Mono size="1.6rem" color={color} weight={200}>{value}</Mono>
        <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 4, fontWeight: 600 }}>
          {label}
        </div>
      </div>
    </Card>
  )
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
function NewCrmTab({ t, stages }) {
  if (!stages) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: 360, gap: 16,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, background: t.card,
          border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.6rem', color: t.text4,
        }}>
          ~
        </div>
        <span style={{ fontSize: '.88rem', color: t.text2, fontWeight: 300 }}>New CRM Offline</span>
        <span style={{ fontSize: '.62rem', color: t.text4, maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
          The new PostgreSQL-based CRM is not reporting data at this time.
          This tab will activate automatically when stage data becomes available.
        </span>
        <div style={{
          marginTop: 8, padding: '8px 20px', borderRadius: 8, background: t.card,
          border: `1px solid ${t.border}`, fontSize: '.58rem', color: t.text3,
        }}>
          Expected stages: Walk-in {'\u2192'} Valuation {'\u2192'} KYC {'\u2192'} Payment {'\u2192'} Completed
        </div>
      </div>
    )
  }

  // Build stage data
  const stageData = STAGE_ORDER_FUNNEL.map(key => ({
    key,
    ...(STAGE_META[key] || {}),
    count: stages[key]?.count || 0,
    netWt: stages[key]?.net_wt || 0,
  }))
  const walkoutData = {
    key: 'WALKOUT',
    ...STAGE_META.WALKOUT,
    count: stages.WALKOUT?.count || 0,
    netWt: stages.WALKOUT?.net_wt || 0,
  }
  const maxCount = Math.max(...stageData.map(s => s.count), walkoutData.count, 1)
  const totalNew = stageData.reduce((s, d) => s + d.count, 0) + walkoutData.count

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <MetricCard t={t} label="Total in Pipeline" value={fmtNum(totalNew)} color={t.blue} sub="across all stages" />
        <MetricCard t={t} label="Completed" value={fmtNum(stageData.find(s => s.key === 'FINAL_PAYMENT_COMPLETED')?.count || 0)}
          color={t.green} sub="payments done" />
        <MetricCard t={t} label="Walkouts" value={fmtNum(walkoutData.count)} color={t.red} sub="lost customers" />
      </div>

      {/* Stage funnel */}
      <div>
        <SectionLabel t={t}>Stage Funnel</SectionLabel>
        <Card t={t} style={{ padding: '20px 24px' }}>
          {stageData.map((s, i) => {
            const w = maxCount > 0 ? Math.max(8, (s.count / maxCount) * 100) : 0
            const prevCount = i > 0 ? stageData[i - 1].count : null
            const convPct = prevCount && prevCount > 0 ? Math.round((s.count / prevCount) * 100) : null
            return (
              <div key={s.key}>
                {i > 0 && convPct != null && (
                  <div style={{
                    textAlign: 'center', fontSize: '.46rem', color: t.text4,
                    fontFamily: 'ui-monospace, monospace', padding: '2px 0', letterSpacing: '.06em',
                  }}>
                    {'\u2193'} {convPct}% conversion
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
                  <span style={{ fontSize: '.8rem', width: 20, textAlign: 'center' }}>{s.icon}</span>
                  <span style={{ fontSize: '.58rem', color: t.text3, width: 90, flexShrink: 0 }}>{s.label}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      height: 24, width: `${w}%`, background: s.color, borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                      minWidth: 40, transition: 'width .5s ease',
                    }}>
                      <span style={{ fontSize: '.64rem', fontWeight: 600, color: '#fff', fontFamily: 'ui-monospace, monospace', textShadow: '0 1px 2px rgba(0,0,0,.3)' }}>
                        {s.count}
                      </span>
                    </div>
                  </div>
                  {s.netWt > 0 && (
                    <span style={{ fontSize: '.54rem', color: t.text4, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                      {fmtWt(s.netWt)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {/* Walkout */}
          {walkoutData.count > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${t.border2}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '.8rem', width: 20, textAlign: 'center' }}>{walkoutData.icon}</span>
                <span style={{ fontSize: '.58rem', color: t.text3, width: 90, flexShrink: 0 }}>{walkoutData.label}</span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    height: 24, width: `${Math.max(8, (walkoutData.count / maxCount) * 100)}%`,
                    borderRadius: 4, display: 'flex', alignItems: 'center', paddingLeft: 8,
                    border: `1.5px dashed ${t.red}`, background: t.redDim, minWidth: 40,
                  }}>
                    <span style={{ fontSize: '.64rem', fontWeight: 600, color: t.red, fontFamily: 'ui-monospace, monospace' }}>
                      {walkoutData.count}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Stage detail cards */}
      <div>
        <SectionLabel t={t}>Stage Details</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[...stageData, walkoutData].map(s => (
            <Card key={s.key} t={t} style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 6, background: `${s.color}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '.78rem', color: s.color,
                }}>
                  {s.icon}
                </span>
                <span style={{ fontSize: '.56rem', color: t.text3, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  {s.label}
                </span>
              </div>
              <Mono size="1.4rem" color={t.text1} weight={200}>{s.count}</Mono>
              {s.netWt > 0 && (
                <div style={{ marginTop: 4, fontSize: '.56rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>
                  {fmtWt(s.netWt)} gold
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
