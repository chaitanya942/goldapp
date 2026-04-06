'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e0d9cc', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const REFRESH_SECS = 60

function fmtAmt(n) { return n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—' }
function fmtWt(g)  { return g != null && Number(g) > 0 ? `${Number(g).toFixed(2)}g` : null }

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

export default function LiveFeed() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [countdown, setCountdown]   = useState(REFRESH_SECS)
  const [filterType, setFilterType] = useState('')   // '', 'walkin', 'bills', 'approved', 'pending', 'rejected'
  const [search, setSearch]         = useState('')
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/crm-purchases?action=live')
      const d   = await res.json()
      if (!d.error) {
        setData(d)
        setLastUpdated(new Date())
        setCountdown(REFRESH_SECS)
      }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, REFRESH_SECS * 1000)
    timerRef.current = setInterval(() => {
      setCountdown(c => (c <= 1 ? REFRESH_SECS : c - 1))
    }, 1000)
    return () => { clearInterval(interval); clearInterval(timerRef.current) }
  }, [load])

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px 20px' }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
      <GoldSpinner size={32} />
    </div>
  )

  const { todaySummary: ts, walkinToday, todayTxns = [], todayWalkins = [] } = data || {}

  // Merge & sort timeline
  const timeline = [
    ...todayWalkins.map(w => ({ ...w, _type: 'walkin' })),
    ...todayTxns.map(tx => ({ ...tx, _type: 'txn' })),
  ].sort((a, b) => {
    const ta = String(a.time || '').padStart(8, '0')
    const tb = String(b.time || '').padStart(8, '0')
    return tb.localeCompare(ta)
  })

  // Apply KPI filter
  const typeFiltered = filterType === 'walkin'   ? timeline.filter(i => i._type === 'walkin') :
                       filterType === 'bills'    ? timeline.filter(i => i._type === 'txn') :
                       filterType === 'approved' ? timeline.filter(i => i._type === 'txn' && i.trxn_status === 'approved') :
                       filterType === 'pending'  ? timeline.filter(i => i._type === 'txn' && i.trxn_status === 'pending') :
                       filterType === 'rejected' ? timeline.filter(i => i._type === 'txn' && i.trxn_status === 'rejected') :
                       timeline

  // Apply search
  const filteredTimeline = search.trim()
    ? typeFiltered.filter(i => {
        const q = search.toLowerCase()
        return (i.cust_name  || '').toLowerCase().includes(q) ||
               (i.cust_mobile|| '').includes(q) ||
               (i.bill_no    || '').toLowerCase().includes(q) ||
               (i.branch_name|| '').toLowerCase().includes(q)
      })
    : typeFiltered

  const toggleFilter = (key) => setFilterType(f => f === key ? '' : key)
  const hasFilter = filterType || search.trim()

  // KPI card definitions
  const kpiCards = [
    { key: 'walkin',   label: 'Walk-ins',        value: walkinToday ?? 0,           color: t.blue   },
    { key: 'bills',    label: 'Bills Submitted',  value: ts?.total ?? 0,             color: t.text1  },
    { key: 'approved', label: 'Approved',         value: ts?.approved ?? 0,          color: t.green  },
    { key: 'pending',  label: 'Pending',          value: ts?.pending ?? 0,           color: t.orange },
    { key: 'rejected', label: 'Rejected',         value: ts?.rejected ?? 0,          color: t.red    },
    { key: '',         label: 'Approved Value',   value: fmtAmt(ts?.approved_value), color: t.gold, noFilter: true },
  ]

  return (
    <div style={{ padding: '0' }}>
      {/* LIVE HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '10px', height: '10px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: t.green, position: 'absolute' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: t.green, position: 'absolute', animation: 'ping 1.5s cubic-bezier(0,0,.2,1) infinite', opacity: .7 }} />
          </div>
          <span style={{ fontSize: '.72rem', color: t.green, fontWeight: 500, letterSpacing: '.06em' }}>LIVE</span>
          <span style={{ fontSize: '.65rem', color: t.text4 }}>·</span>
          <span style={{ fontSize: '.65rem', color: t.text4 }}>
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Loading…'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '.62rem', color: t.text4 }}>Auto-refresh in {countdown}s</span>
          <button onClick={load} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 14px', color: t.text3, fontSize: '.65rem', cursor: 'pointer' }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* TODAY SUMMARY — clickable KPI cards */}
      <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '10px' }}>
        Today's Activity · {data?.todayIST}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {kpiCards.map(c => {
          const active = !c.noFilter && filterType === c.key
          return (
            <div key={c.label}
              onClick={() => !c.noFilter && toggleFilter(c.key)}
              style={{
                ...card, padding: '14px 16px', textAlign: 'center',
                cursor: c.noFilter ? 'default' : 'pointer',
                border: `1px solid ${active ? c.color : t.border}`,
                background: active ? `${c.color}14` : t.card,
                transition: 'all .15s',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!c.noFilter) e.currentTarget.style.borderColor = c.color }}
              onMouseLeave={e => { if (!c.noFilter) e.currentTarget.style.borderColor = active ? c.color : t.border }}
            >
              {active && (
                <div style={{ position: 'absolute', top: '6px', right: '8px', fontSize: '.5rem', color: c.color, opacity: .7 }}>✕</div>
              )}
              <div style={{ fontSize: '1.3rem', fontWeight: 200, color: c.color }}>{c.value}</div>
              <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '6px' }}>{c.label}</div>
            </div>
          )
        })}
      </div>

      {/* SEARCH + FILTER BAR */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, bill no, branch..."
          style={{
            flex: 1, background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px',
            padding: '8px 14px', color: t.text1, fontSize: '.72rem', outline: 'none',
          }}
        />
        {hasFilter && (
          <button
            onClick={() => { setFilterType(''); setSearch('') }}
            style={{ background: 'transparent', border: `1px solid ${t.red}50`, borderRadius: '8px', padding: '8px 16px', color: t.red, fontSize: '.65rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ✕ Clear Filter
          </button>
        )}
      </div>

      {/* TODAY'S TIMELINE */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.18em', textTransform: 'uppercase' }}>
          Today's Timeline
          {hasFilter
            ? ` — ${filteredTimeline.length} of ${timeline.length} events`
            : ` (${timeline.length} events)`}
        </div>
        {filterType && (
          <div style={{ fontSize: '.6rem', color: t.text3 }}>
            Filtering: <span style={{ color: kpiCards.find(k => k.key === filterType)?.color }}>{kpiCards.find(k => k.key === filterType)?.label}</span>
          </div>
        )}
      </div>

      {filteredTimeline.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: t.text4, fontSize: '.75rem', padding: '40px' }}>
          {hasFilter ? 'No events match the current filter' : 'No activity logged yet today'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filteredTimeline.map((item, i) => {
            const isWalkin = item._type === 'walkin'
            const statusColor = isWalkin
              ? (item.walkin_status === 'sold' ? t.green : t.blue)
              : (STATUS_STYLE[item.trxn_status]?.color || t.text3)
            const wt = !isWalkin ? fmtWt(item.net_weight_g) : (item.gms_weight ? `${item.gms_weight}g` : null)

            return (
              <div key={`${item._type}-${item.id}-${i}`} style={{
                ...card, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: '14px',
                borderLeft: `3px solid ${statusColor}`,
              }}>
                {/* TIME */}
                <div style={{ width: '60px', flexShrink: 0, textAlign: 'center' }}>
                  <div style={{ fontSize: '.72rem', color: t.text2, fontWeight: 500 }}>{fmtTime(item.time)}</div>
                </div>

                {/* TYPE BADGE */}
                <div style={{ flexShrink: 0 }}>
                  <span style={{
                    fontSize: '.55rem', padding: '2px 8px', borderRadius: '100px',
                    background: isWalkin ? `${t.blue}18` : `${statusColor}18`,
                    color: isWalkin ? t.blue : statusColor,
                    border: `1px solid ${isWalkin ? t.blue : statusColor}40`,
                    letterSpacing: '.08em', textTransform: 'uppercase',
                  }}>
                    {isWalkin ? 'Walk-in' : (STATUS_STYLE[item.trxn_status]?.label || item.trxn_status)}
                  </span>
                </div>

                {/* DETAILS */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.75rem', color: t.text1, fontWeight: 500 }}>{item.cust_name || '—'}</div>
                  <div style={{ fontSize: '.65rem', color: t.text3, marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {item.cust_mobile && <span>{item.cust_mobile}</span>}
                    {item.branch_name && <span style={{ color: t.text4 }}>· {item.branch_name}</span>}
                    {!isWalkin && item.bill_no && <span style={{ color: t.gold, opacity: .6 }}>· {item.bill_no}</span>}
                  </div>
                </div>

                {/* RIGHT SIDE */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {isWalkin ? (
                    <>
                      <div style={{ fontSize: '.7rem', color: t.text2 }}>{item.item_type || '—'}</div>
                      <div style={{ fontSize: '.65rem', color: t.text4 }}>
                        {wt && <span>{wt}</span>}
                        {item.walk_reason && <span>{wt ? ' · ' : ''}{item.walk_reason}</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '.75rem', color: t.gold, fontWeight: 500 }}>{fmtAmt(item.amount)}</div>
                      <div style={{ fontSize: '.65rem', color: t.text4, display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                        {wt && <span style={{ color: t.text3 }}>{wt}</span>}
                        {item.type_gold && <span>{wt ? '·' : ''} {item.type_gold}</span>}
                        {item.pymt_mde && <span>· {item.pymt_mde}</span>}
                      </div>
                    </>
                  )}
                </div>

                {/* REJECTION REMARK */}
                {item.txn_rmrk && (
                  <div style={{ fontSize: '.65rem', color: t.red, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {item.txn_rmrk}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
