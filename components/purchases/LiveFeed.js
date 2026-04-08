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
const PING_CSS = `@keyframes ping{75%,100%{transform:scale(2);opacity:0}}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`

/* ── Tiny reusable components ── */
/* ── Region helper ── */
function deriveRegion(branchName, dbRegion) {
  if (dbRegion) return dbRegion
  const n = (branchName || '').toUpperCase()
  if (n.startsWith('KL-') || n.startsWith('KL ')) return 'Kerala'
  if (n.startsWith('AP-') || n.startsWith('AP ')) return 'Andhra Pradesh'
  if (n.startsWith('TS-') || n.startsWith('TS ')) return 'Telangana'
  return 'Karnataka'
}

function SectionLabel({ children, t }) {
  return (
    <div style={{ fontSize: '.65rem', letterSpacing: '.14em', textTransform: 'uppercase', color: t.text3, marginBottom: 10, fontWeight: 600 }}>
      {children}
    </div>
  )
}

function Card({ children, t, style = {} }) {
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`, borderRadius: 10,
      padding: '18px 20px', ...style,
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
  const [tlFilter,      setTlFilter]      = useState('all')
  const [search,        setSearch]        = useState('')
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
  const branches = data?.branches || []
  const hourly = data?.hourly || []
  const todayTxns = data?.todayTxns || []
  const todayWalkins = data?.todayWalkins || []

  // Derive unique regions from branch data
  const regions = [...new Set(branches.map(b => deriveRegion(b.branch_name, b.region)))].sort()

  // Walkin funnel logic
  const totalWalkins = walkinSummary.total || 0
  const totalBilled = summary.total || 0
  const approved = summary.approved || 0
  const pending = summary.pending || 0
  const notYetBilled = Math.max(0, totalWalkins - totalBilled)

  const isToday = viewDate === todayIST

  /* ── Timeline items ── */
  const timelineItems = (() => {
    const items = []
    todayTxns.forEach(tx => {
      items.push({
        type: 'txn', time: tx.time, id: `txn-${tx.id}`,
        name: tx.cust_name, mobile: tx.cust_mobile, branch: tx.branch_name,
        status: tx.trxn_status, amount: tx.amount, bill: tx.bill_no,
        goldType: tx.type_gold, weight: tx.net_weight_g, payment: tx.pymt_mde, remark: tx.txn_rmrk,
      })
    })
    todayWalkins.forEach(w => {
      items.push({
        type: 'walkin', time: w.time, id: `wk-${w.id}`,
        name: w.cust_name, mobile: w.cust_mobile, branch: w.branch_name,
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
    if (regionFilter && deriveRegion(item.branch, item.region) !== regionFilter) return false
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
        position: 'sticky', top: 0, zIndex: 50, background: `${t.bg}ee`,
        backdropFilter: 'blur(12px)', borderBottom: `1px solid ${t.border}`,
        padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
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
          <OldCrmTab t={t} summary={summary} walkinSummary={walkinSummary}
            totalWalkins={totalWalkins} totalBilled={totalBilled} approved={approved} pending={pending}
            notYetBilled={notYetBilled}
            branches={branches} hourly={hourly} todayWalkins={todayWalkins}
            regionFilter={regionFilter}
            filteredTimeline={filteredTimeline} tlFilter={tlFilter} setTlFilter={setTlFilter}
            search={search} setSearch={setSearch} isToday={isToday} />
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
  notYetBilled, branches, hourly, todayWalkins,
  regionFilter,
  filteredTimeline, tlFilter, setTlFilter, search, setSearch, isToday,
}) {
  const approvedValue = summary.approved_value || 0
  const avgTicket = approved > 0 ? Math.round(approvedValue / approved) : 0
  const goldWalkedIn = walkinSummary.total_gold_wt || 0
  const billedPct = totalWalkins > 0 ? Math.round((totalBilled / totalWalkins) * 100) : 0
  const approvedPctBilled = totalBilled > 0 ? Math.round((approved / totalBilled) * 100) : 0
  const conversionPct = totalWalkins > 0 ? Math.round((approved / totalWalkins) * 100) : 0

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ──────── 1. HERO STRIP ──────── */}
      <div>
        <SectionLabel t={t}>Customer Journey</SectionLabel>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 0, flexWrap: 'wrap', background: t.surface, borderRadius: 14,
          border: `1px solid ${t.border}`, padding: '24px 12px', position: 'relative',
        }}>
          <HeroNum label="Walked In" value={totalWalkins} color={t.blue} t={t} />
          <FlowArrow t={t} pct={billedPct} />
          <HeroNum label="Bills Submitted" value={totalBilled} color={t.gold} t={t} />
          <FlowArrow t={t} pct={approvedPctBilled} />
          <HeroNum label="Approved" value={approved} color={t.green} t={t} />
          <FlowSep t={t} />
          <HeroNum label="Pending" value={pending} color={t.orange} t={t} small />
          <FlowSep t={t} />
          <HeroNum label="Not Billed" value={notYetBilled} color={t.red} t={t} small muted />
        </div>
      </div>

      {/* ──────── 2. CONVERSION FUNNEL ──────── */}
      <div>
        <SectionLabel t={t}>Conversion Funnel</SectionLabel>
        <Card t={t} style={{ padding: '20px 24px' }}>
          <FunnelBar stages={[
            { label: 'Walked In', value: totalWalkins, color: t.blue },
            { label: 'Billed', value: totalBilled, color: t.gold },
            { label: 'Approved', value: approved, color: t.green },
            { label: 'Pending', value: pending, color: t.orange },
          ]} totalWalkins={totalWalkins} notConverted={notYetBilled} t={t} />
          <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
            <Pill label="Walk-to-bill" value={`${billedPct}%`} color={t.gold} bg={t.goldDim} />
            <Pill label="Bill-to-approve" value={`${approvedPctBilled}%`} color={t.green} bg={t.greenDim} />
            <Pill label="Overall conversion" value={`${conversionPct}%`} color={t.blue} bg={t.blueDim} />
          </div>
        </Card>
      </div>

      {/* ──────── 3. METRICS ROW ──────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        <MetricCard t={t} label="Gold Walked In"    value={goldWalkedIn > 0 ? fmtWt(goldWalkedIn) : '—'} color={t.blue}   sub={`${totalWalkins} walk-ins`} />
        <MetricCard t={t} label="Gold Purchased"    value="—"                                              color={t.green}  sub="ornament data pending" dim />
        <MetricCard t={t} label="Gold Pending"      value="—"                                              color={t.orange} sub="ornament data pending" dim />
        <MetricCard t={t} label="Avg Ticket"        value={avgTicket > 0 ? fmtAmt(avgTicket) : '—'}        color={t.text1}  sub={approved > 0 ? `${approved} approved` : 'no sales yet'} />
        <MetricCard t={t} label="Avg Net Weight"    value="—"                                              color={t.text3}  sub="ornament data pending" dim />
        <MetricCard t={t} label="Approved Value"    value={fmtAmt(approvedValue)}                          color={t.gold}   sub={`${approved} transactions`} />
      </div>

      {/* ──────── 4. BRANCH ACTIVITY ──────── */}
      {branches.length > 0 && (
        <div>
          <SectionLabel t={t}>Branch Activity</SectionLabel>
          <BranchTable branches={branches} t={t} regionFilter={regionFilter} />
        </div>
      )}

      {/* ──────── 5. HOURLY PULSE ──────── */}
      <div>
        <SectionLabel t={t}>Hourly Pulse · Bills by Hour</SectionLabel>
        <Card t={t} style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
            {Array.from({ length: 24 }, (_, h) => {
              const hd     = hourly.find(x => Number(x.hour) === h)
              const bills  = hd ? Number(hd.bills)    : 0
              const appr   = hd ? Number(hd.approved) : 0
              const maxH   = Math.max(...hourly.map(x => Number(x.bills) || 0), 1)
              const barH   = bills > 0 ? Math.max(6, (bills / maxH) * 64) : 3
              const isNow  = h === new Date(Date.now() + 5.5*60*60*1000).getUTCHours()
              const isPast = h < new Date(Date.now() + 5.5*60*60*1000).getUTCHours()
              const bg     = isNow ? t.gold : appr > 0 && appr === bills ? t.green : bills > 0 ? t.blue : t.border
              return (
                <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                  title={`${h}:00–${h+1}:00 · ${bills} bills · ${appr} approved`}>
                  <div style={{
                    width: '100%', height: barH, borderRadius: '2px 2px 0 0',
                    background: bg, opacity: isPast || isNow ? 1 : 0.3,
                    transition: 'height .4s ease', position: 'relative',
                  }}>
                    {isNow && <div style={{ position: 'absolute', inset: 0, boxShadow: `0 0 10px ${t.gold}60`, borderRadius: '2px 2px 0 0' }} />}
                    {bills > 0 && appr > 0 && appr < bills && (
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.round((appr/bills)*100)}%`, background: t.green, borderRadius: '0 0 2px 2px' }} />
                    )}
                  </div>
                  {(h % 3 === 0 || isNow) && (
                    <span style={{ fontSize: '.44rem', color: isNow ? t.gold : t.text4, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                      {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            {[{c: t.gold, l: 'Current hour'}, {c: t.green, l: 'All approved'}, {c: t.blue, l: 'Mixed'}, {c: t.border, l: 'No activity'}].map(x => (
              <span key={x.l} style={{ fontSize: '.6rem', color: t.text3, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: x.c, display: 'inline-block', flexShrink: 0 }} />{x.l}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* ──────── 6. WALKIN BREAKDOWN ──────── */}
      {totalWalkins > 0 && (
        <div>
          <SectionLabel t={t}>Walk-in Breakdown</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <WalkinCard t={t} label="Sold" value={walkinSummary.sold || 0} icon="✓" color={t.green} bg={t.greenDim} />
            <WalkinCard t={t} label="Visited, Not Sold" value={walkinSummary.visited_not_sold || 0} icon="✕" color={t.red} bg={t.redDim} />
            <WalkinCard t={t} label="Enquiry" value={walkinSummary.enquiry || 0} icon="?" color={t.blue} bg={t.blueDim} />
            <WalkinCard t={t} label="Planning to Visit" value={walkinSummary.planning_to_visit || 0} icon="↻" color={t.orange} bg={t.orangeDim} />
            <WalkinCard t={t} label="Call Later" value={walkinSummary.call_later || 0} icon="☎" color={t.purple} bg={`${t.purple}20`} />
          </div>
        </div>
      )}

      {/* ──────── 6b. NOT BILLED DETAILS ──────── */}
      {notYetBilled > 0 && todayWalkins.length > 0 && (() => {
        const notBilledWalkins = todayWalkins.filter(w =>
          w.walkin_status !== 'sold' &&
          (!regionFilter || deriveRegion(w.branch_name, w.region) === regionFilter)
        )
        if (!notBilledWalkins.length) return null
        return (
          <div>
            <SectionLabel t={t}>Not Billed — Walk-in Details ({notBilledWalkins.length})</SectionLabel>
            <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px 110px 100px', padding: '9px 16px', borderBottom: `1px solid ${t.border}`, gap: 12 }}>
                {['Customer', 'Mobile', 'Gold Weight', 'Branch', 'Status'].map(h => (
                  <span key={h} style={{ fontSize: '.58rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 500 }}>{h}</span>
                ))}
              </div>
              {notBilledWalkins.slice(0, 40).map((w, i) => {
                const statusColors = {
                  'visited not sold': t.red, 'enquiry': t.blue,
                  'planning to visit': t.orange, 'call later': t.purple,
                }
                const sc = statusColors[w.walkin_status] || t.text3
                return (
                  <div key={w.id || i} style={{
                    display: 'grid', gridTemplateColumns: '1fr 120px 100px 110px 100px',
                    padding: '10px 16px', borderBottom: `1px solid ${t.border}18`,
                    alignItems: 'center', gap: 12,
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = t.card2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div>
                      <div style={{ fontSize: '.75rem', color: t.text1, fontWeight: 500 }}>{w.cust_name || '—'}</div>
                      {w.item_type && <div style={{ fontSize: '.6rem', color: t.text3, marginTop: 2 }}>{w.item_type}</div>}
                    </div>
                    <span style={{ fontSize: '.68rem', color: t.text2, fontFamily: 'ui-monospace, monospace' }}>{w.cust_mobile || '—'}</span>
                    <span style={{ fontSize: '.7rem', color: t.gold, fontFamily: 'ui-monospace, monospace' }}>
                      {w.gms_weight && Number(w.gms_weight) > 0 ? `${Number(w.gms_weight).toFixed(2)}g` : '—'}
                    </span>
                    <span style={{ fontSize: '.65rem', color: t.text2 }}>{w.branch_name || '—'}</span>
                    <span style={{
                      fontSize: '.6rem', padding: '2px 8px', borderRadius: 4, fontWeight: 500,
                      background: `${sc}18`, color: sc, border: `1px solid ${sc}30`,
                      textTransform: 'capitalize', whiteSpace: 'nowrap',
                    }}>
                      {w.walkin_status || 'unknown'}
                    </span>
                  </div>
                )
              })}
              {notBilledWalkins.length > 40 && (
                <div style={{ padding: '10px 16px', fontSize: '.62rem', color: t.text4, textAlign: 'center' }}>
                  Showing 40 of {notBilledWalkins.length} · Use timeline below to see all
                </div>
              )}
            </Card>
          </div>
        )
      })()}

      {/* ──────── 7. LIVE TIMELINE ──────── */}
      <div>
        <SectionLabel t={t}>{isToday ? 'Live Timeline' : 'Timeline'}</SectionLabel>
        <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
          {/* Timeline controls */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
            borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap',
          }}>
            {[['all', 'All'], ['txn', 'Transactions'], ['walkin', 'Walk-ins'], ['approved', 'Approved'], ['pending', 'Pending']].map(([k, l]) => (
              <button key={k} onClick={() => setTlFilter(k)} style={{
                padding: '4px 10px', borderRadius: 5, border: `1px solid ${tlFilter === k ? t.gold : t.border}`,
                background: tlFilter === k ? t.goldDim : 'transparent',
                color: tlFilter === k ? t.gold : t.text3,
                fontSize: '.58rem', cursor: 'pointer', letterSpacing: '.04em',
              }}>
                {l}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <input
              type="text" placeholder="Search name, mobile, branch..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{
                background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6,
                padding: '5px 10px', fontSize: '.62rem', color: t.text2, outline: 'none', width: 180,
                fontFamily: 'ui-monospace, monospace',
              }}
            />
          </div>

          {/* Timeline column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '72px 8px 1fr 130px 120px', gap: '0 14px', padding: '8px 20px', background: t.card2, borderBottom: `1px solid ${t.border}` }}>
            {['Time', '', 'Customer / Branch', 'Weight', 'Amount'].map((h, i) => (
              <span key={i} style={{ fontSize: '.58rem', color: t.text3, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: i >= 3 ? 'right' : i === 0 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>
          {/* Timeline items */}
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {filteredTimeline.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: t.text4, fontSize: '.75rem' }}>
                No events match your filter
              </div>
            ) : filteredTimeline.map((item, i) => (
              <TimelineRow key={item.id} item={item} t={t} isLast={i === filteredTimeline.length - 1} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════ */
/*                      SUB-COMPONENTS                           */
/* ════════════════════════════════════════════════════════════════ */

/* ── Hero Number ── */
function HeroNum({ label, value, color, t, small, muted }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: small ? '0 16px' : '0 24px', opacity: muted ? .65 : 1,
    }}>
      <Mono size={small ? '1.8rem' : '2.4rem'} color={color} weight={200}>
        {fmtNum(value)}
      </Mono>
      <span style={{ fontSize: '.62rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, marginTop: 5, fontWeight: 500 }}>
        {label}
      </span>
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

/* ── Funnel Bar ── */
function FunnelBar({ stages, totalWalkins, notConverted, t }) {
  if (totalWalkins === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {stages.map((s) => {
        const w = totalWalkins > 0 ? Math.max(8, (s.value / totalWalkins) * 100) : 0
        return (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '.58rem', color: t.text3, width: 70, textAlign: 'right', flexShrink: 0 }}>
              {s.label}
            </span>
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={{
                height: 22, width: `${w}%`, background: s.color,
                borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: 8, minWidth: 36, transition: 'width .5s ease',
              }}>
                <span style={{ fontSize: '.62rem', fontWeight: 600, color: '#fff', fontFamily: 'ui-monospace, monospace', textShadow: '0 1px 2px rgba(0,0,0,.3)' }}>
                  {s.value}
                </span>
              </div>
            </div>
          </div>
        )
      })}
      {/* Not converted */}
      {notConverted > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '.58rem', color: t.text3, width: 70, textAlign: 'right', flexShrink: 0 }}>
            Not billed
          </span>
          <div style={{ flex: 1 }}>
            <div style={{
              height: 22, width: `${Math.max(8, (notConverted / totalWalkins) * 100)}%`,
              borderRadius: 4, display: 'flex', alignItems: 'center', paddingLeft: 8,
              border: `1.5px dashed ${t.red}`, background: t.redDim, minWidth: 36,
              transition: 'width .5s ease',
            }}>
              <span style={{ fontSize: '.62rem', fontWeight: 600, color: t.red, fontFamily: 'ui-monospace, monospace' }}>
                {notConverted}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Metric Card ── */
function MetricCard({ t, label, value, color, sub, dim }) {
  return (
    <Card t={t} style={{ padding: '16px 18px', opacity: dim ? 0.5 : 1 }}>
      <span style={{ fontSize: '.6rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 500 }}>{label}</span>
      <div style={{ marginTop: 8 }}>
        <Mono size="1.6rem" color={color} weight={200}>{value}</Mono>
      </div>
      {sub && <span style={{ fontSize: '.62rem', color: t.text4, marginTop: 4, display: 'block' }}>{sub}</span>}
    </Card>
  )
}

/* ── Branch Table ── */
function BranchTable({ branches, t, regionFilter }) {
  const filtered = regionFilter
    ? branches.filter(b => deriveRegion(b.branch_name, b.region) === regionFilter)
    : branches
  const sorted = [...filtered].sort((a, b) => (b.approved || 0) - (a.approved || 0))
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px',
        padding: '10px 20px', borderBottom: `1px solid ${t.border}`, gap: 12, background: t.card2,
      }}>
        {['Branch', 'Approved', 'Pending', 'Rejected'].map((h, i) => (
          <span key={h} style={{ fontSize: '.62rem', letterSpacing: '.1em', textTransform: 'uppercase', color: t.text3, fontWeight: 500, textAlign: i > 0 ? 'center' : 'left' }}>{h}</span>
        ))}
      </div>
      {sorted.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No branch data for this region</div>
      )}
      {sorted.map((b, i) => (
        <div key={b.branch_name || i} style={{
          display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px',
          padding: '11px 20px', borderBottom: i < sorted.length - 1 ? `1px solid ${t.border}` : 'none', gap: 12,
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '.75rem', color: t.text1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {b.branch_name || 'Unknown'}
          </span>
          <div style={{ textAlign: 'center' }}>
            <Mono size=".82rem" color={Number(b.approved) > 0 ? t.green : t.text4}>{b.approved || 0}</Mono>
          </div>
          <div style={{ textAlign: 'center' }}>
            <Mono size=".82rem" color={Number(b.pending) > 0 ? t.orange : t.text4}>{b.pending || 0}</Mono>
          </div>
          <div style={{ textAlign: 'center' }}>
            <Mono size=".82rem" color={Number(b.rejected) > 0 ? t.red : t.text4}>{b.rejected || 0}</Mono>
          </div>
        </div>
      ))}
    </Card>
  )
}


/* ── Walkin Card ── */
function WalkinCard({ t, label, value, icon, color, bg }) {
  return (
    <Card t={t} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '.9rem', color, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <Mono size="1.4rem" color={t.text1} weight={300}>{value}</Mono>
        <div style={{ fontSize: '.62rem', color: t.text3, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 4, fontWeight: 500 }}>
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
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '72px 8px 1fr 130px 120px',
      gap: '0 14px',
      padding: '13px 20px',
      borderBottom: isLast ? 'none' : `1px solid ${t.border}`,
      alignItems: 'center',
      borderLeft: `3px solid ${accentColor}30`,
      transition: 'background .1s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = t.card2}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Time */}
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.68rem', color: t.text3, textAlign: 'right' }}>
        {fmtTime(item.time)}
      </span>
      {/* Dot */}
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor, display: 'block', justifySelf: 'center' }} />
      {/* Main info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.8rem', color: t.text1, fontWeight: 500 }}>{item.name || 'Unknown'}</span>
          <span style={{
            fontSize: '.58rem', padding: '2px 8px', borderRadius: 4,
            background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}30`,
            fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            {isTxn ? (statusStyle.label || item.status) : (item.walkinStatus || 'walk-in')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
          {item.branch && <span style={{ fontSize: '.65rem', color: t.text3 }}>{item.branch}</span>}
          {item.mobile && <span style={{ fontSize: '.62rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>{item.mobile}</span>}
          {isTxn && item.bill && <span style={{ fontSize: '.6rem', color: t.text4 }}>#{item.bill}</span>}
        </div>
      </div>
      {/* Weight */}
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.72rem', color: t.text2, textAlign: 'right' }}>
        {isTxn
          ? (item.weight > 0 ? fmtWt(item.weight) : '—')
          : (item.weight && Number(item.weight) > 0 ? fmtWt(item.weight) : '—')}
      </span>
      {/* Amount */}
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.75rem', color: isTxn ? t.gold : t.text4, textAlign: 'right', fontWeight: isTxn ? 500 : 400 }}>
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
