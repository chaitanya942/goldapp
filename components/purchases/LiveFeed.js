'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e0d9cc', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const REFRESH_SECS = 60

function fmtAmt(n)  { return n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—' }
function fmtWt(g)   { return g != null && Number(g) > 0 ? `${Number(g).toFixed(2)}g` : null }
function fmtNum(n)  { return Number(n || 0).toLocaleString('en-IN') }

function fmtTime(t) {
  if (!t) return '—'
  const parts = String(t).split(':')
  if (parts.length < 2) return t
  const h = parseInt(parts[0]), m = parts[1]
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`
}

const STATUS_STYLE = {
  approved: { color: '#3aaa6a', label: 'Approved' },
  rejected: { color: '#e05555', label: 'Rejected' },
  pending:  { color: '#c9981f', label: 'Pending'  },
}

// ── Compute drill-down KPIs from loaded data ─────────────────────────────────
function computeDrilldown(filterType, todayTxns, todayWalkins) {
  if (!filterType) return null

  if (filterType === 'walkin') {
    const totalWt   = todayWalkins.reduce((s, w) => s + (parseFloat(w.gms_weight) || 0), 0)
    const byType    = {}
    const byBranch  = {}
    todayWalkins.forEach(w => {
      const tp = w.item_type || 'Unknown'
      byType[tp]   = (byType[tp]   || 0) + 1
      const br = w.branch_name || 'Unknown'
      byBranch[br] = (byBranch[br] || 0) + 1
    })
    return {
      metrics: [
        { label: 'Total Walk-ins',  value: fmtNum(todayWalkins.length), color: '#3a8fbf' },
        { label: 'Total Gold Wt',   value: fmtWt(totalWt) || '0g',      color: '#c9a84c' },
      ],
      breakdown: { title: 'By Item Type', data: Object.entries(byType).sort((a,b) => b[1]-a[1]).slice(0,6).map(([k,v]) => ({ label: k, value: v, pct: Math.round(v/todayWalkins.length*100) })) },
      branches:  Object.entries(byBranch).sort((a,b) => b[1]-a[1]).slice(0,8).map(([k,v]) => ({ label: k, value: v, unit: 'walk-ins' })),
    }
  }

  const txns = filterType === 'bills' ? todayTxns :
               todayTxns.filter(tx => tx.trxn_status === filterType)

  const totalWt  = txns.reduce((s, tx) => s + (parseFloat(tx.net_weight_g) || 0), 0)
  const totalAmt = txns.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0)
  const avgAmt   = txns.length ? totalAmt / txns.length : 0
  const physical = txns.filter(tx => (tx.type_gold || '').toLowerCase().includes('physical')).length
  const takeover = txns.length - physical

  const byBranch = {}
  const byType   = {}
  const byReason = {}
  txns.forEach(tx => {
    const br = tx.branch_name || 'Unknown'
    if (!byBranch[br]) byBranch[br] = { count: 0, weight: 0, amount: 0 }
    byBranch[br].count++
    byBranch[br].weight += parseFloat(tx.net_weight_g) || 0
    byBranch[br].amount += parseFloat(tx.amount) || 0
    const tp = (tx.type_gold || 'Unknown')
    byType[tp] = (byType[tp] || 0) + 1
    if (tx.txn_rmrk) {
      const r = tx.txn_rmrk.trim()
      byReason[r] = (byReason[r] || 0) + 1
    }
  })

  const metrics = filterType === 'bills'
    ? [
        { label: 'Total Bills',    value: fmtNum(txns.length),    color: '#f0e6c8' },
        { label: 'Total Net Wt',   value: fmtWt(totalWt) || '0g', color: '#c9a84c' },
        { label: 'Total Value',    value: fmtAmt(totalAmt),        color: '#3aaa6a' },
        { label: 'Avg per Bill',   value: fmtAmt(avgAmt),          color: '#c8b89a' },
        { label: 'Physical',       value: fmtNum(physical),        color: '#3a8fbf' },
        { label: 'Takeover',       value: fmtNum(takeover),        color: '#8c5ac8' },
      ]
    : filterType === 'rejected'
    ? [
        { label: 'Rejected Bills', value: fmtNum(txns.length),    color: '#e05555' },
        { label: 'Total Net Wt',   value: fmtWt(totalWt) || '0g', color: '#c9a84c' },
        { label: 'Total Value',    value: fmtAmt(totalAmt),        color: '#c8b89a' },
      ]
    : [
        { label: filterType === 'approved' ? 'Approved Bills' : 'Pending Bills', value: fmtNum(txns.length), color: filterType === 'approved' ? '#3aaa6a' : '#c9981f' },
        { label: 'Total Net Wt',   value: fmtWt(totalWt) || '0g', color: '#c9a84c' },
        { label: 'Total Value',    value: fmtAmt(totalAmt),        color: '#3aaa6a' },
        { label: 'Avg per Bill',   value: fmtAmt(avgAmt),          color: '#c8b89a' },
        { label: 'Physical',       value: fmtNum(physical),        color: '#3a8fbf' },
        { label: 'Takeover',       value: fmtNum(takeover),        color: '#8c5ac8' },
      ]

  const breakdownData = filterType === 'rejected' && Object.keys(byReason).length
    ? { title: 'Rejection Reasons', data: Object.entries(byReason).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v]) => ({ label: k, value: v, pct: Math.round(v/txns.length*100) })) }
    : { title: 'By Gold Type',      data: Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v]) => ({ label: k, value: v, pct: Math.round(v/txns.length*100) })) }

  const branches = Object.entries(byBranch)
    .sort((a,b) => b[1].amount - a[1].amount)
    .slice(0, 8)
    .map(([k,v]) => ({ label: k, value: v.count, amount: v.amount, weight: v.weight }))

  return { metrics, breakdown: breakdownData, branches }
}

export default function LiveFeed() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [countdown, setCountdown]   = useState(REFRESH_SECS)
  const [filterType, setFilterType] = useState('')
  const [search, setSearch]         = useState('')
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
    const interval = setInterval(load, REFRESH_SECS * 1000)
    timerRef.current = setInterval(() => setCountdown(c => c <= 1 ? REFRESH_SECS : c - 1), 1000)
    return () => { clearInterval(interval); clearInterval(timerRef.current) }
  }, [load])

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'80px' }}><GoldSpinner size={32} /></div>

  const { todaySummary: ts, walkinToday, todayTxns = [], todayWalkins = [] } = data || {}

  const timeline = [
    ...todayWalkins.map(w => ({ ...w, _type: 'walkin' })),
    ...todayTxns.map(tx => ({ ...tx, _type: 'txn' })),
  ].sort((a, b) => String(b.time||'').padStart(8,'0').localeCompare(String(a.time||'').padStart(8,'0')))

  const typeFiltered =
    filterType === 'walkin'   ? timeline.filter(i => i._type === 'walkin') :
    filterType === 'bills'    ? timeline.filter(i => i._type === 'txn') :
    filterType === 'approved' ? timeline.filter(i => i._type === 'txn' && i.trxn_status === 'approved') :
    filterType === 'pending'  ? timeline.filter(i => i._type === 'txn' && i.trxn_status === 'pending') :
    filterType === 'rejected' ? timeline.filter(i => i._type === 'txn' && i.trxn_status === 'rejected') :
    timeline

  const filteredTimeline = search.trim()
    ? typeFiltered.filter(i => {
        const q = search.toLowerCase()
        return (i.cust_name||'').toLowerCase().includes(q) || (i.cust_mobile||'').includes(q) ||
               (i.bill_no||'').toLowerCase().includes(q) || (i.branch_name||'').toLowerCase().includes(q)
      })
    : typeFiltered

  const hasFilter  = filterType || search.trim()
  const drilldown  = computeDrilldown(filterType, todayTxns, todayWalkins)

  const kpiCards = [
    { key: 'walkin',   label: 'Walk-ins',       value: walkinToday ?? 0,           color: t.blue   },
    { key: 'bills',    label: 'Bills Submitted', value: ts?.total ?? 0,             color: t.text1  },
    { key: 'approved', label: 'Approved',        value: ts?.approved ?? 0,          color: t.green  },
    { key: 'pending',  label: 'Pending',         value: ts?.pending ?? 0,           color: t.orange },
    { key: 'rejected', label: 'Rejected',        value: ts?.rejected ?? 0,          color: t.red    },
    { key: '',         label: 'Approved Value',  value: fmtAmt(ts?.approved_value), color: t.gold, noFilter: true },
  ]

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  // Max branch value for bar scaling
  const maxBranchVal = drilldown?.branches?.length ? Math.max(...drilldown.branches.map(b => b.amount || b.value)) : 1

  return (
    <div style={{ padding: '0' }}>
      {/* LIVE HEADER */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <div style={{ position:'relative', width:'10px', height:'10px' }}>
            <div style={{ width:'10px', height:'10px', borderRadius:'50%', background:t.green, position:'absolute' }} />
            <div style={{ width:'10px', height:'10px', borderRadius:'50%', background:t.green, position:'absolute', animation:'ping 1.5s cubic-bezier(0,0,.2,1) infinite', opacity:.7 }} />
          </div>
          <span style={{ fontSize:'.72rem', color:t.green, fontWeight:500, letterSpacing:'.06em' }}>LIVE</span>
          <span style={{ fontSize:'.65rem', color:t.text4 }}>·</span>
          <span style={{ fontSize:'.65rem', color:t.text4 }}>
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}` : 'Loading…'}
          </span>
        </div>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          <span style={{ fontSize:'.62rem', color:t.text4 }}>Auto-refresh in {countdown}s</span>
          <button onClick={load} style={{ background:'transparent', border:`1px solid ${t.border}`, borderRadius:'6px', padding:'5px 14px', color:t.text3, fontSize:'.65rem', cursor:'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div style={{ fontSize:'.58rem', color:t.text4, letterSpacing:'.18em', textTransform:'uppercase', marginBottom:'10px' }}>
        Today's Activity · {data?.todayIST}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'10px', marginBottom: filterType ? '16px' : '20px' }}>
        {kpiCards.map(c => {
          const active = !c.noFilter && filterType === c.key
          return (
            <div key={c.label}
              onClick={() => !c.noFilter && setFilterType(f => f === c.key ? '' : c.key)}
              style={{ ...card, padding:'14px 16px', textAlign:'center', cursor:c.noFilter?'default':'pointer',
                border:`1px solid ${active ? c.color : t.border}`, background:active?`${c.color}14`:t.card,
                transition:'all .15s', position:'relative' }}
              onMouseEnter={e => { if (!c.noFilter) e.currentTarget.style.borderColor = c.color }}
              onMouseLeave={e => { if (!c.noFilter) e.currentTarget.style.borderColor = active ? c.color : t.border }}>
              {active && <div style={{ position:'absolute', top:'6px', right:'8px', fontSize:'.5rem', color:c.color, opacity:.6 }}>✕</div>}
              <div style={{ fontSize:'1.3rem', fontWeight:200, color:c.color }}>{c.value}</div>
              <div style={{ fontSize:'.55rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', marginTop:'6px' }}>{c.label}</div>
            </div>
          )
        })}
      </div>

      {/* DRILL-DOWN INSIGHT PANEL */}
      {drilldown && (
        <div style={{ ...card, padding:'18px 20px', marginBottom:'20px', borderColor: kpiCards.find(k=>k.key===filterType)?.color + '40' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px' }}>
            <span style={{ fontSize:'.6rem', color:t.text3, letterSpacing:'.14em', textTransform:'uppercase' }}>
              {kpiCards.find(k=>k.key===filterType)?.label} · Insights
            </span>
          </div>

          {/* Sub-metrics row */}
          <div style={{ display:'flex', gap:'12px', marginBottom:'18px', flexWrap:'wrap' }}>
            {drilldown.metrics.map(m => (
              <div key={m.label} style={{ background:t.card2, borderRadius:'8px', padding:'10px 16px', minWidth:'110px', textAlign:'center' }}>
                <div style={{ fontSize:'1.1rem', fontWeight:200, color:m.color }}>{m.value}</div>
                <div style={{ fontSize:'.55rem', color:t.text3, letterSpacing:'.1em', textTransform:'uppercase', marginTop:'4px' }}>{m.label}</div>
              </div>
            ))}
          </div>

          {/* Breakdown + Branch side by side */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:'16px' }}>
            {/* Left: breakdown (item type / rejection reason) */}
            {drilldown.breakdown.data.length > 0 && (
              <div>
                <div style={{ fontSize:'.55rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:'8px' }}>{drilldown.breakdown.title}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                  {drilldown.breakdown.data.map(d => (
                    <div key={d.label} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <div style={{ flex:1, fontSize:'.65rem', color:t.text2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.label}</div>
                      <div style={{ width:'80px', height:'4px', borderRadius:'2px', background:t.border, flexShrink:0 }}>
                        <div style={{ width:`${d.pct}%`, height:'100%', borderRadius:'2px', background:kpiCards.find(k=>k.key===filterType)?.color }} />
                      </div>
                      <div style={{ fontSize:'.62rem', color:t.text3, width:'28px', textAlign:'right', flexShrink:0 }}>{d.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Right: branch breakdown */}
            {drilldown.branches.length > 0 && (
              <div>
                <div style={{ fontSize:'.55rem', color:t.text4, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:'8px' }}>Branch Breakdown</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                  {drilldown.branches.map(b => {
                    const barPct = Math.round(((b.amount || b.value) / maxBranchVal) * 100)
                    return (
                      <div key={b.label} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <div style={{ width:'140px', fontSize:'.65rem', color:t.text2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:0 }}>{b.label}</div>
                        <div style={{ flex:1, height:'4px', borderRadius:'2px', background:t.border }}>
                          <div style={{ width:`${barPct}%`, height:'100%', borderRadius:'2px', background:kpiCards.find(k=>k.key===filterType)?.color }} />
                        </div>
                        <div style={{ fontSize:'.62rem', color:t.text3, whiteSpace:'nowrap', flexShrink:0 }}>
                          {b.amount != null ? fmtAmt(b.amount) : `${b.value} walk-ins`}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEARCH + CLEAR */}
      <div style={{ display:'flex', gap:'10px', alignItems:'center', marginBottom:'16px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, bill no, branch..."
          style={{ flex:1, background:t.card, border:`1px solid ${t.border}`, borderRadius:'8px', padding:'8px 14px', color:t.text1, fontSize:'.72rem', outline:'none' }} />
        {hasFilter && (
          <button onClick={() => { setFilterType(''); setSearch('') }}
            style={{ background:'transparent', border:`1px solid ${t.red}50`, borderRadius:'8px', padding:'8px 16px', color:t.red, fontSize:'.65rem', cursor:'pointer', whiteSpace:'nowrap' }}>
            ✕ Clear Filter
          </button>
        )}
      </div>

      {/* TIMELINE HEADER */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
        <div style={{ fontSize:'.58rem', color:t.text4, letterSpacing:'.18em', textTransform:'uppercase' }}>
          Today's Timeline {hasFilter ? `— ${filteredTimeline.length} of ${timeline.length} events` : `(${timeline.length} events)`}
        </div>
        {filterType && (
          <div style={{ fontSize:'.6rem', color:t.text3 }}>
            Filtering: <span style={{ color:kpiCards.find(k=>k.key===filterType)?.color }}>{kpiCards.find(k=>k.key===filterType)?.label}</span>
          </div>
        )}
      </div>

      {/* TIMELINE ROWS */}
      {filteredTimeline.length === 0 ? (
        <div style={{ ...card, textAlign:'center', color:t.text4, fontSize:'.75rem', padding:'40px' }}>
          {hasFilter ? 'No events match the current filter' : 'No activity logged yet today'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
          {filteredTimeline.map((item, i) => {
            const isWalkin    = item._type === 'walkin'
            const statusColor = isWalkin
              ? (item.walkin_status === 'sold' ? t.green : t.blue)
              : (STATUS_STYLE[item.trxn_status]?.color || t.text3)
            const netWt = !isWalkin ? fmtWt(item.net_weight_g) : fmtWt(item.gms_weight)

            return (
              <div key={`${item._type}-${item.id}-${i}`} style={{
                ...card, padding:'10px 14px',
                display:'grid',
                gridTemplateColumns:'64px 96px 1fr 90px 180px',
                alignItems:'center', gap:'12px',
                borderLeft:`3px solid ${statusColor}`,
              }}>
                {/* TIME */}
                <div style={{ fontSize:'.7rem', color:t.text2, fontWeight:500, textAlign:'center' }}>{fmtTime(item.time)}</div>

                {/* BADGE */}
                <div>
                  <span style={{ fontSize:'.55rem', padding:'3px 8px', borderRadius:'100px',
                    background:`${statusColor}18`, color:statusColor, border:`1px solid ${statusColor}40`,
                    letterSpacing:'.06em', textTransform:'uppercase', whiteSpace:'nowrap' }}>
                    {isWalkin ? 'Walk-in' : (STATUS_STYLE[item.trxn_status]?.label || item.trxn_status)}
                  </span>
                </div>

                {/* NAME + META */}
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:'.75rem', color:t.text1, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.cust_name || '—'}</div>
                  <div style={{ fontSize:'.62rem', color:t.text3, marginTop:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {item.cust_mobile && <span>{item.cust_mobile}</span>}
                    {item.branch_name && <span style={{ color:t.text4 }}> · {item.branch_name}</span>}
                    {!isWalkin && item.bill_no && <span style={{ color:t.gold, opacity:.55 }}> · {item.bill_no}</span>}
                  </div>
                </div>

                {/* WEIGHT */}
                <div style={{ textAlign:'right' }}>
                  {netWt
                    ? <span style={{ fontSize:'.75rem', color:t.text2, fontWeight:500 }}>{netWt}</span>
                    : <span style={{ fontSize:'.65rem', color:t.text4 }}>—</span>}
                </div>

                {/* AMOUNT + TYPE */}
                <div style={{ textAlign:'right' }}>
                  {isWalkin ? (
                    <>
                      <div style={{ fontSize:'.72rem', color:t.text2 }}>{item.item_type || '—'}</div>
                      {item.walk_reason && <div style={{ fontSize:'.62rem', color:t.text4 }}>{item.walk_reason}</div>}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize:'.78rem', color:t.gold, fontWeight:500 }}>{fmtAmt(item.amount)}</div>
                      <div style={{ fontSize:'.62rem', color:t.text4 }}>
                        {[item.type_gold, item.pymt_mde].filter(Boolean).join(' · ')}
                      </div>
                    </>
                  )}
                  {item.txn_rmrk && <div style={{ fontSize:'.6rem', color:t.red, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.txn_rmrk}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`@keyframes ping { 75%,100% { transform:scale(2); opacity:0; } }`}</style>
    </div>
  )
}
