'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', card3: '#1a1a1a', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e8e0d0', card3: '#f0ebe0', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const REFRESH_SECS = 60

const fmtAmt = n  => n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'
const fmtNum = n  => Number(n || 0).toLocaleString('en-IN')

function fmtTime(t) {
  if (!t) return '—'
  const p = String(t).split(':')
  if (p.length < 2) return t
  const h = parseInt(p[0])
  return `${h % 12 || 12}:${p[1]} ${h >= 12 ? 'PM' : 'AM'}`
}

const STAGE_META = {
  WALKIN:                  { label: 'Walk-in',         color: '#3a8fbf', order: 0, icon: '→' },
  ESTIMATION_PENDING:      { label: 'Valuation',        color: '#c9981f', order: 1, icon: '⚖' },
  KYC_PENDING:             { label: 'KYC',              color: '#8c5ac8', order: 2, icon: '🪪' },
  FINAL_PAYMENT_PENDING:   { label: 'Payment Pending',  color: '#c9a84c', order: 3, icon: '₹' },
  FINAL_PAYMENT_COMPLETED: { label: 'Purchased',        color: '#3aaa6a', order: 4, icon: '✓' },
  WALKOUT:                 { label: 'Walkout',          color: '#e05555', order: 5, icon: '✕' },
}

const STAGE_ORDER_FUNNEL = ['WALKIN', 'ESTIMATION_PENDING', 'KYC_PENDING', 'FINAL_PAYMENT_PENDING', 'FINAL_PAYMENT_COMPLETED']

const STATUS_STYLE = {
  approved: { color: '#3aaa6a', label: 'Approved' },
  rejected: { color: '#e05555', label: 'Rejected' },
  pending:  { color: '#c9981f', label: 'Pending'  },
}

const PMT_COLORS = { cash: '#3aaa6a', bank: '#3a8fbf', cheque: '#c9981f', upi: '#8c5ac8', neft: '#3a8fbf', rtgs: '#3a8fbf', imps: '#3a8fbf' }

function Bar({ pct, color, height = 4 }) {
  return (
    <div style={{ height, background: '#ffffff12', borderRadius: height / 2, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${Math.min(100, pct || 0)}%`, background: color, borderRadius: height / 2, transition: 'width .5s ease' }} />
    </div>
  )
}

function SectionLabel({ children, t }) {
  return (
    <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '10px' }}>
      {children}
    </div>
  )
}

export default function LiveFeed() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [countdown,   setCountdown]   = useState(REFRESH_SECS)
  const [search,      setSearch]      = useState('')
  const [tlFilter,    setTlFilter]    = useState('')
  const [crmTab,      setCrmTab]      = useState('old')  // 'old' | 'new'
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/crm-purchases?action=live')
      const d   = await res.json()
      if (!d.error) { setData(d); setLastUpdated(new Date()); setCountdown(REFRESH_SECS) }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const poll = setInterval(load, REFRESH_SECS * 1000)
    const tick = setInterval(() => setCountdown(c => c <= 1 ? REFRESH_SECS : c - 1), 1000)
    timerRef.current = { poll, tick }
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}><GoldSpinner size={32} /></div>

  const {
    summary = {}, walkinSummary = {}, goldPipeline = {},
    stages, branches = [], hourly = [], payments = [],
    todayTxns = [], todayWalkins = [], todayIST,
  } = data || {}

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }

  // Timeline
  const timeline = [
    ...todayWalkins.map(w => ({ ...w, _type: 'walkin' })),
    ...todayTxns.map(tx => ({ ...tx, _type: 'txn' })),
  ].sort((a, b) => String(b.time || '').padStart(8, '0').localeCompare(String(a.time || '').padStart(8, '0')))

  const filteredTl = timeline.filter(i => {
    if (tlFilter === 'walkin')   return i._type === 'walkin'
    if (tlFilter === 'approved') return i._type === 'txn' && i.trxn_status === 'approved'
    if (tlFilter === 'pending')  return i._type === 'txn' && i.trxn_status === 'pending'
    if (tlFilter === 'rejected') return i._type === 'txn' && i.trxn_status === 'rejected'
    return true
  }).filter(i => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (i.cust_name || '').toLowerCase().includes(q) ||
           (i.cust_mobile || '').includes(q) ||
           (i.bill_no || '').toLowerCase().includes(q) ||
           (i.branch_name || '').toLowerCase().includes(q)
  })

  // Gold pipeline numbers
  const walkedInWt  = goldPipeline.walked_in_wt  || 0
  const purchasedWt = goldPipeline.purchased_wt   || 0
  const pendingWt   = goldPipeline.pending_wt     || 0
  const rejectedWt  = goldPipeline.rejected_wt    || 0
  const convRate    = walkedInWt > 0 ? ((purchasedWt / walkedInWt) * 100).toFixed(1) : null

  // Stage funnel
  const maxStageCount = stages
    ? Math.max(1, ...STAGE_ORDER_FUNNEL.map(s => stages[s]?.count || 0))
    : 1

  const maxBranchVal = branches.length ? Math.max(1, ...branches.map(b => Number(b.value) || 0)) : 1
  const maxHourly    = hourly.length   ? Math.max(1, ...hourly.map(h => Number(h.bills)))        : 1
  const currentHour  = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours()
  const totalPmtCount = payments.reduce((s, p) => s + Number(p.count), 0) || 1

  // Sub-tab pill style
  const subTabStyle = (key) => ({
    padding: '5px 16px', borderRadius: '100px', cursor: 'pointer',
    border: `1px solid ${crmTab === key ? t.gold : t.border}`,
    background: crmTab === key ? `${t.gold}14` : 'transparent',
    color: crmTab === key ? t.gold : t.text3,
    fontSize: '.65rem', fontWeight: crmTab === key ? 600 : 400,
    letterSpacing: '.04em', transition: 'all .15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ position: 'relative', width: '10px', height: '10px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: t.green, position: 'absolute' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: t.green, position: 'absolute', animation: 'ping 1.5s cubic-bezier(0,0,.2,1) infinite', opacity: .7 }} />
          </div>
          <span style={{ fontSize: '.72rem', color: t.green, fontWeight: 600, letterSpacing: '.06em' }}>LIVE</span>
          <span style={{ fontSize: '.65rem', color: t.text4 }}>·</span>
          <span style={{ fontSize: '.65rem', color: t.text4 }}>
            {summary.branches_active || 0} branches active · {todayIST}
          </span>
          {lastUpdated && (
            <>
              <span style={{ fontSize: '.65rem', color: t.text4 }}>·</span>
              <span style={{ fontSize: '.65rem', color: t.text4 }}>
                Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '.62rem', color: t.text4 }}>Refresh in {countdown}s</span>
          <button onClick={load} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 14px', color: t.text3, fontSize: '.65rem', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {/* ── CRM SUB-TABS ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: `1px solid ${t.border}`, paddingBottom: '12px' }}>
        <button style={subTabStyle('old')} onClick={() => setCrmTab('old')}>Old CRM</button>
        <button style={subTabStyle('new')} onClick={() => setCrmTab('new')}>
          New CRM
          {!stages && <span style={{ marginLeft: '6px', fontSize: '.55rem', color: t.text4, background: t.card2, borderRadius: '4px', padding: '1px 5px' }}>offline</span>}
        </button>
        <span style={{ fontSize: '.6rem', color: t.text4, marginLeft: '4px' }}>
          {crmTab === 'old' ? '— Old CRM (MySQL): purchase transactions & walk-ins' : '— New CRM (PostgreSQL): customer journey stages'}
        </span>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          OLD CRM TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {crmTab === 'old' && (
        <>
          {/* GOLD PIPELINE */}
          <div style={{ ...card, padding: '16px 20px' }}>
            <SectionLabel t={t}>Gold Pipeline · Today</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: t.border }}>
              {[
                { label: 'Walked In',   wt: walkedInWt,  count: walkinSummary.total || 0,        color: t.blue,   },
                { label: 'In Progress', wt: pendingWt,   count: Number(summary.pending  || 0),   color: t.orange, },
                { label: 'Purchased',   wt: purchasedWt, count: Number(summary.approved || 0),   color: t.green,  },
                { label: 'Walkouts',    wt: rejectedWt,  count: Number(summary.rejected || 0) + Number(walkinSummary.visited_not_sold || 0), color: t.red },
              ].map((p, i) => (
                <div key={p.label} style={{ background: t.card, padding: '14px 16px', position: 'relative' }}>
                  {i < 3 && (
                    <div style={{ position: 'absolute', right: '-8px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '14px', zIndex: 1 }}>›</div>
                  )}
                  <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px' }}>{p.label}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 200, color: p.color, fontFamily: 'monospace' }}>
                    {p.wt > 0 ? `${p.wt.toFixed(2)}g` : p.count}
                  </div>
                  {p.wt > 0 && (
                    <div style={{ fontSize: '.65rem', color: t.text3, marginTop: '2px' }}>{fmtNum(p.count)} {p.count === 1 ? 'customer' : 'customers'}</div>
                  )}
                  {i === 2 && convRate && (
                    <div style={{ fontSize: '.6rem', marginTop: '6px' }}>
                      <span style={{ background: `${t.green}18`, color: t.green, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>{convRate}% conversion</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {walkedInWt > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ height: '6px', background: t.border2, borderRadius: '3px', overflow: 'hidden', display: 'flex', gap: '1px' }}>
                  <div style={{ width: `${(purchasedWt / walkedInWt) * 100}%`, background: t.green, borderRadius: '3px 0 0 3px', transition: 'width .5s' }} />
                  <div style={{ width: `${(pendingWt  / walkedInWt) * 100}%`, background: t.orange }} />
                  <div style={{ width: `${(rejectedWt / walkedInWt) * 100}%`, background: t.red, borderRadius: '0 3px 3px 0' }} />
                </div>
                <div style={{ display: 'flex', gap: '14px', marginTop: '5px' }}>
                  {[
                    { label: 'Purchased',   pct: walkedInWt > 0 ? (purchasedWt / walkedInWt * 100).toFixed(0) : 0, color: t.green  },
                    { label: 'In Progress', pct: walkedInWt > 0 ? (pendingWt   / walkedInWt * 100).toFixed(0) : 0, color: t.orange },
                    { label: 'Walkouts',    pct: walkedInWt > 0 ? (rejectedWt  / walkedInWt * 100).toFixed(0) : 0, color: t.red    },
                  ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: l.color }} />
                      <span style={{ fontSize: '.6rem', color: t.text3 }}>{l.label} {l.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* KPI CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {[
              { label: 'Walk-ins Today',  value: fmtNum(walkinSummary.total || 0),    color: t.blue,   sub: walkedInWt > 0 ? `${walkedInWt.toFixed(1)}g gold walked in` : null },
              { label: 'Bills Submitted', value: fmtNum(summary.total || 0),          color: t.text1,  sub: `${summary.branches_active || 0} branches` },
              { label: 'Approved',        value: fmtNum(summary.approved || 0),       color: t.green,  sub: purchasedWt > 0 ? `${purchasedWt.toFixed(2)}g purchased` : null },
              { label: 'Pending',         value: fmtNum(summary.pending || 0),        color: t.orange, sub: pendingWt > 0 ? `${pendingWt.toFixed(2)}g at table` : null },
              { label: 'Rejected',        value: fmtNum(summary.rejected || 0),       color: t.red,    sub: null },
              { label: 'Approved Value',  value: fmtAmt(summary.approved_value || 0), color: t.gold,   sub: null },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '14px 18px' }}>
                <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>{k.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 200, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: '.6rem', color: t.text3, marginTop: '2px' }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* BRANCH ACTIVITY + PAYMENT SPLIT */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '14px' }}>
            <div style={{ ...card, padding: '16px 20px' }}>
              <SectionLabel t={t}>Branch Activity · Today</SectionLabel>
              {branches.length === 0 ? (
                <div style={{ color: t.text4, fontSize: '.72rem', padding: '20px 0', textAlign: 'center' }}>No branch activity yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {branches.map(b => {
                    const val = Number(b.value) || 0
                    const pct = (val / maxBranchVal) * 100
                    return (
                      <div key={b.branch_name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '130px', fontSize: '.68rem', color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{b.branch_name || '—'}</div>
                        <Bar pct={pct} color={t.gold} height={5} />
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                          <span style={{ fontSize: '.62rem', color: t.green,  minWidth: '16px', textAlign: 'center' }}>{b.approved}</span>
                          <span style={{ fontSize: '.6rem',  color: t.text4 }}>|</span>
                          <span style={{ fontSize: '.62rem', color: t.orange, minWidth: '16px', textAlign: 'center' }}>{b.pending}</span>
                          <span style={{ fontSize: '.6rem',  color: t.text4 }}>|</span>
                          <span style={{ fontSize: '.62rem', color: t.red,    minWidth: '16px', textAlign: 'center' }}>{b.rejected}</span>
                          <span style={{ fontSize: '.6rem',  color: t.text3,  minWidth: '60px', textAlign: 'right' }}>{fmtAmt(val)}</span>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px', paddingTop: '6px', borderTop: `1px solid ${t.border}` }}>
                    {[{ c: t.green, l: 'Approved' }, { c: t.orange, l: 'Pending' }, { c: t.red, l: 'Rejected' }].map(x => (
                      <span key={x.l} style={{ fontSize: '.55rem', color: x.c }}>■ {x.l}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ ...card, padding: '16px 20px', flex: 1 }}>
                <SectionLabel t={t}>Payment Methods · Approved</SectionLabel>
                {payments.length === 0 ? (
                  <div style={{ color: t.text4, fontSize: '.72rem', padding: '10px 0', textAlign: 'center' }}>No payments yet</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {payments.map(p => {
                      const method = (p.method || '').toLowerCase()
                      const color  = PMT_COLORS[method] || t.text3
                      const pct    = (Number(p.count) / totalPmtCount) * 100
                      return (
                        <div key={p.method} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '44px', fontSize: '.62rem', color, textTransform: 'capitalize', fontWeight: 600, flexShrink: 0 }}>{p.method || '—'}</div>
                          <Bar pct={pct} color={color} height={5} />
                          <div style={{ fontSize: '.62rem', color: t.text3, flexShrink: 0, width: '28px', textAlign: 'right' }}>{p.count}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div style={{ ...card, padding: '14px 20px' }}>
                <SectionLabel t={t}>Gold Type</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: 'Physical', value: Number(summary.physical_count || 0), color: t.blue   },
                    { label: 'Takeover', value: Number(summary.takeover_count || 0), color: t.purple },
                  ].map(g => (
                    <div key={g.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.3rem', fontWeight: 200, color: g.color, fontFamily: 'monospace' }}>{fmtNum(g.value)}</div>
                      <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: '3px' }}>{g.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* HOURLY PULSE */}
          {hourly.length > 0 && (
            <div style={{ ...card, padding: '16px 20px' }}>
              <SectionLabel t={t}>Hourly Pulse · Bills Submitted</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '52px' }}>
                {Array.from({ length: 24 }, (_, h) => {
                  const hd    = hourly.find(x => Number(x.hour) === h)
                  const bills = hd ? Number(hd.bills)    : 0
                  const appr  = hd ? Number(hd.approved) : 0
                  const barH  = maxHourly > 0 ? Math.max(2, (bills / maxHourly) * 48) : 2
                  const isNow = h === currentHour
                  const isPast = h < currentHour
                  return (
                    <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }} title={`${h}:00 — ${bills} bills, ${appr} approved`}>
                      <div style={{ width: '100%', height: `${barH}px`, background: isNow ? t.gold : bills > 0 ? (appr === bills ? t.green : t.blue) : t.border2, borderRadius: '2px 2px 0 0', opacity: isPast || isNow ? 1 : 0.35, position: 'relative' }}>
                        {appr > 0 && appr < bills && (
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${(appr / bills) * 100}%`, background: t.green, borderRadius: '0 0 2px 2px', opacity: 0.8 }} />
                        )}
                      </div>
                      {(h % 4 === 0 || isNow) && (
                        <div style={{ fontSize: '.42rem', color: isNow ? t.gold : t.text4, whiteSpace: 'nowrap' }}>
                          {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                {[{ c: t.gold, l: 'Current hour' }, { c: t.green, l: 'All approved' }, { c: t.blue, l: 'Mixed' }, { c: t.border2, l: 'No activity' }].map(x => (
                  <span key={x.l} style={{ fontSize: '.55rem', color: t.text4 }}><span style={{ color: x.c }}>■</span> {x.l}</span>
                ))}
              </div>
            </div>
          )}

          {/* WALK-IN BREAKDOWN */}
          {walkinSummary.total > 0 && (
            <div style={{ ...card, padding: '16px 20px' }}>
              <SectionLabel t={t}>Walk-in Status Breakdown</SectionLabel>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {[
                  { label: 'Sold',              value: walkinSummary.sold              || 0, color: t.green  },
                  { label: 'Visited Not Sold',  value: walkinSummary.visited_not_sold  || 0, color: t.red    },
                  { label: 'Enquiry',           value: walkinSummary.enquiry           || 0, color: t.blue   },
                  { label: 'Planning to Visit', value: walkinSummary.planning_to_visit || 0, color: t.orange },
                  { label: 'Call Later',        value: walkinSummary.call_later        || 0, color: t.purple },
                ].map(s => (
                  <div key={s.label} style={{ background: t.card2, borderRadius: '8px', padding: '10px 16px', minWidth: '110px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 200, color: s.color, fontFamily: 'monospace' }}>{fmtNum(s.value)}</div>
                    <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: '4px', lineHeight: 1.3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LIVE TIMELINE */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[
                  { key: '',         label: 'All',      color: t.text3  },
                  { key: 'walkin',   label: 'Walk-ins', color: t.blue   },
                  { key: 'approved', label: 'Approved', color: t.green  },
                  { key: 'pending',  label: 'Pending',  color: t.orange },
                  { key: 'rejected', label: 'Rejected', color: t.red    },
                ].map(f => (
                  <button key={f.key} onClick={() => setTlFilter(f.key)}
                    style={{ background: tlFilter === f.key ? `${f.color}18` : 'transparent', border: `1px solid ${tlFilter === f.key ? f.color : t.border}`, borderRadius: '100px', padding: '4px 12px', fontSize: '.62rem', color: tlFilter === f.key ? f.color : t.text3, cursor: 'pointer', transition: 'all .1s' }}>
                    {f.label}
                  </button>
                ))}
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search name, phone, bill, branch..."
                style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '5px 12px', fontSize: '.68rem', color: t.text1, outline: 'none', width: '220px' }} />
            </div>
            <div style={{ fontSize: '.58rem', color: t.text4, padding: '6px 16px', letterSpacing: '.1em' }}>
              {filteredTl.length} of {timeline.length} events
            </div>
            {filteredTl.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No events match the filter</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredTl.slice(0, 80).map((item, i) => {
                  const isWalkin    = item._type === 'walkin'
                  const statusColor = isWalkin
                    ? (item.walkin_status === 'sold' ? t.green : t.blue)
                    : (STATUS_STYLE[item.trxn_status]?.color || t.text3)
                  return (
                    <div key={`${item._type}-${item.id}-${i}`} style={{
                      display: 'grid', gridTemplateColumns: '60px 88px 1fr 80px 160px',
                      alignItems: 'center', gap: '10px', padding: '8px 16px',
                      borderBottom: `1px solid ${t.border}18`,
                      borderLeft: `3px solid ${statusColor}`,
                      transition: 'background .1s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = t.card2}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ fontSize: '.68rem', color: t.text3, textAlign: 'center' }}>{fmtTime(item.time)}</div>
                      <div>
                        <span style={{ fontSize: '.55rem', padding: '2px 7px', borderRadius: '100px', background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30`, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                          {isWalkin ? 'Walk-in' : (STATUS_STYLE[item.trxn_status]?.label || item.trxn_status)}
                        </span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '.72rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.cust_name || '—'}</div>
                        <div style={{ fontSize: '.6rem', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.cust_mobile && <span>{item.cust_mobile}</span>}
                          {item.branch_name && <span style={{ color: t.text4 }}> · {item.branch_name}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '.68rem', color: t.text2 }}>
                        {isWalkin
                          ? (item.gms_weight ? `${item.gms_weight}g` : '—')
                          : (item.net_weight_g > 0 ? `${Number(item.net_weight_g).toFixed(2)}g` : '—')}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {isWalkin ? (
                          <div style={{ fontSize: '.65rem', color: t.text3 }}>{item.item_type || '—'}</div>
                        ) : (
                          <>
                            <div style={{ fontSize: '.72rem', color: t.gold, fontWeight: 500 }}>{fmtAmt(item.amount)}</div>
                            <div style={{ fontSize: '.58rem', color: t.text4 }}>{[item.type_gold, item.pymt_mde].filter(Boolean).join(' · ')}</div>
                          </>
                        )}
                        {item.txn_rmrk && <div style={{ fontSize: '.58rem', color: t.red, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.txn_rmrk}</div>}
                      </div>
                    </div>
                  )
                })}
                {filteredTl.length > 80 && (
                  <div style={{ padding: '12px', textAlign: 'center', fontSize: '.65rem', color: t.text4 }}>
                    Showing 80 of {filteredTl.length} events · Use search to narrow down
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          NEW CRM TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {crmTab === 'new' && (
        <>
          {!stages ? (
            <div style={{ ...card, padding: '48px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.2rem', color: t.text4, fontWeight: 200, marginBottom: '8px' }}>New CRM offline</div>
              <div style={{ fontSize: '.72rem', color: t.text4 }}>Could not reach the new CRM database. Check connection and try refreshing.</div>
              <button onClick={load} style={{ marginTop: '16px', background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 18px', color: t.text3, fontSize: '.68rem', cursor: 'pointer' }}>↻ Retry</button>
            </div>
          ) : (
            <>
              {/* STAGE SUMMARY CARDS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                {Object.entries(STAGE_META).map(([key, meta]) => {
                  const d = stages[key] || { count: 0, net_wt: 0 }
                  return (
                    <div key={key} style={{ ...card, padding: '16px 18px', borderLeft: `3px solid ${meta.color}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '.9rem' }}>{meta.icon}</span>
                        <span style={{ fontSize: '.58rem', color: meta.color, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 200, color: meta.color, fontFamily: 'monospace' }}>{fmtNum(d.count)}</div>
                      {d.net_wt > 0 && (
                        <div style={{ fontSize: '.62rem', color: t.text3, marginTop: '3px' }}>{d.net_wt.toFixed(2)}g net weight</div>
                      )}
                      <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '2px' }}>
                        {key === 'WALKIN' && 'Customers who arrived at branch'}
                        {key === 'ESTIMATION_PENDING' && 'Awaiting gold valuation'}
                        {key === 'KYC_PENDING' && 'KYC documents being verified'}
                        {key === 'FINAL_PAYMENT_PENDING' && 'Payment processing in progress'}
                        {key === 'FINAL_PAYMENT_COMPLETED' && 'Transaction closed successfully'}
                        {key === 'WALKOUT' && 'Customers who left without selling'}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* FUNNEL CHART */}
              <div style={{ ...card, padding: '20px 24px' }}>
                <SectionLabel t={t}>Customer Journey Funnel · Today</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {STAGE_ORDER_FUNNEL.map((key, idx) => {
                    const meta  = STAGE_META[key]
                    const d     = stages[key] || { count: 0, net_wt: 0 }
                    const pct   = (d.count / maxStageCount) * 100
                    const prevKey   = idx > 0 ? STAGE_ORDER_FUNNEL[idx - 1] : null
                    const prevCount = prevKey ? (stages[prevKey]?.count || 0) : null
                    const dropPct   = prevCount && prevCount > 0 ? ((prevCount - d.count) / prevCount * 100).toFixed(0) : null
                    return (
                      <div key={key}>
                        {idx > 0 && dropPct !== null && (
                          <div style={{ textAlign: 'center', fontSize: '.6rem', color: Number(dropPct) > 30 ? t.red : t.text4, marginBottom: '4px' }}>
                            ↓ {dropPct}% drop-off
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                          <div style={{ width: '110px', flexShrink: 0 }}>
                            <div style={{ fontSize: '.65rem', color: meta.color, fontWeight: 600 }}>{meta.label}</div>
                          </div>
                          <Bar pct={pct} color={meta.color} height={10} />
                          <div style={{ width: '40px', textAlign: 'right', fontSize: '.78rem', color: t.text1, fontFamily: 'monospace', flexShrink: 0 }}>{d.count}</div>
                          {d.net_wt > 0 && (
                            <div style={{ width: '58px', textAlign: 'right', fontSize: '.6rem', color: t.text3, flexShrink: 0 }}>{d.net_wt.toFixed(2)}g</div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Walkout separately */}
                  {stages.WALKOUT && (
                    <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: '10px', marginTop: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{ width: '110px', flexShrink: 0 }}>
                          <div style={{ fontSize: '.65rem', color: t.red, fontWeight: 600 }}>Walkout ✕</div>
                          <div style={{ fontSize: '.55rem', color: t.text4, marginTop: '1px' }}>Left without selling</div>
                        </div>
                        <Bar pct={(stages.WALKOUT.count / maxStageCount) * 100} color={t.red} height={10} />
                        <div style={{ width: '40px', textAlign: 'right', fontSize: '.78rem', color: t.red, fontFamily: 'monospace', flexShrink: 0 }}>{stages.WALKOUT.count}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Conversion insight */}
                {stages.WALKIN?.count > 0 && stages.FINAL_PAYMENT_COMPLETED?.count >= 0 && (
                  <div style={{ marginTop: '16px', padding: '12px 16px', background: t.card2, borderRadius: '8px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Walk-in → Purchase</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 200, color: t.green, fontFamily: 'monospace' }}>
                        {((stages.FINAL_PAYMENT_COMPLETED.count / stages.WALKIN.count) * 100).toFixed(1)}%
                      </div>
                    </div>
                    {stages.WALKOUT && (
                      <div>
                        <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Walkout Rate</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 200, color: t.red, fontFamily: 'monospace' }}>
                          {((stages.WALKOUT.count / stages.WALKIN.count) * 100).toFixed(1)}%
                        </div>
                      </div>
                    )}
                    {stages.KYC_PENDING && (
                      <div>
                        <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>In KYC Now</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 200, color: t.purple, fontFamily: 'monospace' }}>
                          {stages.KYC_PENDING.count}
                        </div>
                      </div>
                    )}
                    {stages.FINAL_PAYMENT_PENDING && (
                      <div>
                        <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Awaiting Payment</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 200, color: t.gold, fontFamily: 'monospace' }}>
                          {stages.FINAL_PAYMENT_PENDING.count}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <style>{`@keyframes ping { 75%,100% { transform:scale(2); opacity:0; } }`}</style>
    </div>
  )
}
