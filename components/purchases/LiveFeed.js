'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const REFRESH_SECS = 60

const THEMES = {
  dark: {
    bg: '#080808', surface: '#0f0f0f', card: '#141414', card2: '#1a1a1a',
    border: '#222222', border2: '#2a2a2a',
    text1: '#f0e8d8', text2: '#c8b898', text3: '#8a7a5a', text4: '#4a3a2a',
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
    text1: '#1a1005', text2: '#3a2a10', text3: '#7a6a48', text4: '#9a8a68',
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

const PMT_COLORS = { cash: '#3aaa6a', bank: '#4a9fdf', cheque: '#e09830', upi: '#9a6adf', neft: '#4a9fdf', rtgs: '#4a9fdf', imps: '#4a9fdf' }

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
function Bar({ pct, color, height = 4, bg }) {
  return (
    <div style={{ height, background: bg || '#ffffff12', borderRadius: height / 2, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${Math.min(100, pct || 0)}%`, background: color, borderRadius: height / 2, transition: 'width .6s ease' }} />
    </div>
  )
}

function SectionLabel({ children, t }) {
  return (
    <div style={{ fontSize: '.52rem', letterSpacing: '.18em', textTransform: 'uppercase', color: t.text4, marginBottom: 10, fontWeight: 500 }}>
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

  const [viewDate, setViewDate] = useState(todayIST)
  const [crmTab, setCrmTab] = useState('old')
  const [tlFilter, setTlFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_SECS)

  const timerRef = useRef(null)
  const countRef = useRef(null)

  /* ── Load data ── */
  const load = useCallback(async (date) => {
    const d = date || viewDate
    try {
      setLoading(true)
      const res = await fetch(`/api/crm-purchases?action=live&date=${d}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      setLastUpdated(new Date())
    } catch (e) {
      console.error('LiveFeed load error:', e)
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
  const payments = data?.payments || []
  const todayTxns = data?.todayTxns || []
  const todayWalkins = data?.todayWalkins || []

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
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        {loading && !data ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
            <GoldSpinner size={40} />
            <span style={{ fontSize: '.72rem', color: t.text3 }}>Loading live data...</span>
          </div>
        ) : crmTab === 'old' ? (
          <OldCrmTab t={t} summary={summary} walkinSummary={walkinSummary}
            totalWalkins={totalWalkins} totalBilled={totalBilled} approved={approved} pending={pending}
            notYetBilled={notYetBilled}
            branches={branches} hourly={hourly} payments={payments}
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
  notYetBilled, branches, hourly, payments,
  filteredTimeline, tlFilter, setTlFilter, search, setSearch, isToday,
}) {
  const approvedValue = summary.approved_value || 0
  const avgTicket = approved > 0 ? Math.round(approvedValue / approved) : 0
  const goldWalkedIn = walkinSummary.total_gold_wt || 0
  const physicalCount = summary.physical_count || 0
  const takeoverCount = summary.takeover_count || 0
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <MetricCard t={t} label="Approved Value" value={fmtAmt(approvedValue)} color={t.gold} sub={`${approved} transactions`} />
        <MetricCard t={t} label="Average Ticket" value={fmtAmt(avgTicket)} color={t.text2} sub={approved > 0 ? `across ${approved} approved` : 'no approved txns'} />
        <MetricCard t={t} label="Gold Walked In" value={fmtWt(goldWalkedIn)} color={t.gold}
          sub={`from ${totalWalkins} walk-ins`} />
      </div>

      {/* ──────── 4. BRANCH ACTIVITY ──────── */}
      {branches.length > 0 && (
        <div>
          <SectionLabel t={t}>Branch Activity</SectionLabel>
          <BranchTable branches={branches} t={t} />
        </div>
      )}

      {/* ──────── 5. TWO COLUMNS ──────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {/* Payment methods */}
        <div>
          <SectionLabel t={t}>Payment Methods</SectionLabel>
          <Card t={t}>
            {payments.length > 0 ? payments.map(pm => {
              const maxVal = Math.max(...payments.map(p => p.value || 0), 1)
              return (
                <div key={pm.method} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '.62rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                      {pm.method || 'Unknown'}
                    </span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.68rem', color: t.text2 }}>
                      {fmtAmt(pm.value)} <span style={{ color: t.text4, fontSize: '.58rem' }}>({pm.count})</span>
                    </span>
                  </div>
                  <Bar pct={(pm.value / maxVal) * 100} color={PMT_COLORS[(pm.method || '').toLowerCase()] || t.gold} height={5} bg={t.border} />
                </div>
              )
            }) : <EmptySmall t={t} msg="No payments" />}
          </Card>
        </div>

        {/* Gold type + Hourly */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Gold type */}
          <div>
            <SectionLabel t={t}>Gold Type</SectionLabel>
            <Card t={t}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <DonutMini physical={physicalCount} takeover={takeoverCount} t={t} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.gold }} />
                    <span style={{ fontSize: '.68rem', color: t.text2 }}>Physical: <Mono size=".78rem" color={t.text1}>{physicalCount}</Mono></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.purple }} />
                    <span style={{ fontSize: '.68rem', color: t.text2 }}>Takeover: <Mono size=".78rem" color={t.text1}>{takeoverCount}</Mono></span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Hourly pulse */}
          {hourly.length > 0 && (
            <div>
              <SectionLabel t={t}>Hourly Pulse</SectionLabel>
              <Card t={t}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
                  {hourly.map(h => {
                    const maxH = Math.max(...hourly.map(x => x.bills || 0), 1)
                    const ht = Math.max(4, ((h.bills || 0) / maxH) * 56)
                    return (
                      <div key={h.hour} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 2 }}>
                        <div style={{
                          width: '100%', maxWidth: 22, height: ht, borderRadius: 3,
                          background: (h.approved || 0) > 0 ? t.green : (h.bills || 0) > 0 ? t.gold : t.border,
                          transition: 'height .4s ease',
                        }} />
                        <span style={{ fontSize: '.42rem', color: t.text4, fontFamily: 'ui-monospace, monospace' }}>
                          {h.hour % 12 || 12}{h.hour >= 12 ? 'p' : 'a'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* ──────── 6. WALKIN BREAKDOWN ──────── */}
      {totalWalkins > 0 && (
        <div>
          <SectionLabel t={t}>Walk-in Breakdown</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <WalkinCard t={t} label="Sold" value={walkinSummary.sold || 0} icon="\u2713" color={t.green} bg={t.greenDim} />
            <WalkinCard t={t} label="Visited, Not Sold" value={walkinSummary.visited_not_sold || 0} icon="\u2715" color={t.red} bg={t.redDim} />
            <WalkinCard t={t} label="Enquiry" value={walkinSummary.enquiry || 0} icon="?" color={t.blue} bg={t.blueDim} />
            <WalkinCard t={t} label="Planning to Visit" value={walkinSummary.planning_to_visit || 0} icon="\u21bb" color={t.orange} bg={t.orangeDim} />
            <WalkinCard t={t} label="Call Later" value={walkinSummary.call_later || 0} icon="\u260e" color={t.purple} bg={`${t.purple}20`} />
          </div>
        </div>
      )}

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

          {/* Timeline items */}
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {filteredTimeline.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>
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
      padding: small ? '0 14px' : '0 20px', opacity: muted ? .7 : 1,
    }}>
      <Mono size={small ? '1.6rem' : '2.2rem'} color={color} weight={200}>
        {fmtNum(value)}
      </Mono>
      <span style={{ fontSize: '.52rem', letterSpacing: '.12em', textTransform: 'uppercase', color: t.text4, marginTop: 4 }}>
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
function MetricCard({ t, label, value, color, sub }) {
  return (
    <Card t={t} style={{ padding: '18px 20px' }}>
      <span style={{ fontSize: '.52rem', letterSpacing: '.14em', textTransform: 'uppercase', color: t.text4 }}>{label}</span>
      <div style={{ marginTop: 6 }}>
        <Mono size="1.8rem" color={color} weight={200}>{value}</Mono>
      </div>
      {sub && <span style={{ fontSize: '.58rem', color: t.text4, marginTop: 4, display: 'block' }}>{sub}</span>}
    </Card>
  )
}

/* ── Branch Table ── */
function BranchTable({ branches, t }) {
  const maxVal = Math.max(...branches.map(b => b.value || 0), 1)
  const sorted = [...branches].sort((a, b) => (b.value || 0) - (a.value || 0))
  return (
    <Card t={t} style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1.5fr 60px 60px 60px 1.4fr',
        padding: '10px 16px', borderBottom: `1px solid ${t.border}`, gap: 8,
      }}>
        {['Branch', 'Appr.', 'Pend.', 'Rej.', 'Value'].map(h => (
          <span key={h} style={{ fontSize: '.48rem', letterSpacing: '.14em', textTransform: 'uppercase', color: t.text4 }}>{h}</span>
        ))}
      </div>
      {sorted.map((b, i) => (
        <div key={b.branch_name || i} style={{
          display: 'grid', gridTemplateColumns: '1.5fr 60px 60px 60px 1.4fr',
          padding: '8px 16px', borderBottom: `1px solid ${t.border}`, gap: 8,
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '.68rem', color: t.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {b.branch_name || 'Unknown'}
          </span>
          <Mono size=".72rem" color={t.green}>{b.approved || 0}</Mono>
          <Mono size=".72rem" color={t.orange}>{b.pending || 0}</Mono>
          <Mono size=".72rem" color={b.rejected ? t.red : t.text4}>{b.rejected || 0}</Mono>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bar pct={((b.value || 0) / maxVal) * 100} color={t.gold} height={6} bg={t.border} />
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.58rem', color: t.text3, whiteSpace: 'nowrap' }}>
              {fmtAmt(b.value)}
            </span>
          </div>
        </div>
      ))}
    </Card>
  )
}

/* ── Mini Donut (SVG) ── */
function DonutMini({ physical, takeover, t }) {
  const total = physical + takeover
  if (total === 0) return <div style={{ width: 52, height: 52 }} />
  const physPct = physical / total
  const r = 20
  const circ = 2 * Math.PI * r
  const physLen = physPct * circ
  return (
    <svg width={52} height={52} viewBox="0 0 52 52">
      <circle cx="26" cy="26" r={r} fill="none" stroke={t.purple} strokeWidth="6" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={t.gold} strokeWidth="6"
        strokeDasharray={`${physLen} ${circ - physLen}`}
        strokeDashoffset={circ * 0.25}
        strokeLinecap="round"
      />
      <text x="26" y="28" textAnchor="middle" fontSize="9" fill={t.text3} fontFamily="ui-monospace, monospace">
        {total}
      </text>
    </svg>
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
        <Mono size="1.2rem" color={t.text1} weight={300}>{value}</Mono>
        <div style={{ fontSize: '.52rem', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2 }}>
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
  const dotColor = isTxn ? (statusStyle.color || t.gold) : t.blue
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '10px 16px',
      borderBottom: isLast ? 'none' : `1px solid ${t.border}`,
      animation: 'fadeIn .3s ease',
    }}>
      {/* Time + dot */}
      <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.6rem', color: t.text3 }}>
          {fmtTime(item.time)}
        </span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
      </div>
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500 }}>{item.name || 'Unknown'}</span>
          {isTxn && item.status && (
            <span style={{
              fontSize: '.48rem', padding: '1px 6px', borderRadius: 3, letterSpacing: '.06em',
              textTransform: 'uppercase', fontWeight: 600,
              background: `${statusStyle.color}20`, color: statusStyle.color,
            }}>
              {statusStyle.label}
            </span>
          )}
          {!isTxn && item.walkinStatus && (
            <span style={{
              fontSize: '.48rem', padding: '1px 6px', borderRadius: 3, letterSpacing: '.06em',
              textTransform: 'uppercase', fontWeight: 500,
              background: t.blueDim, color: t.blue,
            }}>
              {item.walkinStatus}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
          {item.branch && (
            <span style={{ fontSize: '.58rem', color: t.text4 }}>{item.branch}</span>
          )}
          {isTxn && item.amount != null && (
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.62rem', color: t.gold }}>
              {fmtAmt(item.amount)}
            </span>
          )}
          {isTxn && item.bill && (
            <span style={{ fontSize: '.54rem', color: t.text4 }}>#{item.bill}</span>
          )}
          {!isTxn && item.weight != null && Number(item.weight) > 0 && (
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.62rem', color: t.gold }}>
              {fmtWt(item.weight)}
            </span>
          )}
          {item.mobile && (
            <span style={{ fontSize: '.54rem', color: t.text4 }}>{item.mobile}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Empty small state ── */
function EmptySmall({ t, msg }) {
  return (
    <div style={{ padding: 16, textAlign: 'center', color: t.text4, fontSize: '.62rem' }}>{msg}</div>
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
