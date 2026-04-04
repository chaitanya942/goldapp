'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const REFRESH_SECS = 60

function fmtAmt(n) { return n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—' }
function fmtWt(g)  { return g != null ? `${Number(g).toFixed(2)}g` : '—' }
function fmtDate(d){ return d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—' }

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

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [countdown, setCountdown]   = useState(REFRESH_SECS)
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
    // Auto-refresh every 60s
    const interval = setInterval(() => {
      load()
    }, REFRESH_SECS * 1000)
    // Countdown ticker
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

  const { todaySummary: ts, walkinToday, todayTxns = [], todayWalkins = [], pendingGold = [], pendingTotals } = data || {}
  const maxNetWt = Math.max(...pendingGold.map(b => Number(b.net_weight_g) || 0), 1)

  // Merge today's timeline: walk-ins + transactions
  const timeline = [
    ...todayWalkins.map(w => ({ ...w, _type: 'walkin' })),
    ...todayTxns.map(tx => ({ ...tx, _type: 'txn' })),
  ].sort((a, b) => {
    const ta = String(a.time || '').padStart(8, '0')
    const tb = String(b.time || '').padStart(8, '0')
    return tb.localeCompare(ta)  // newest first
  })

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

      {/* TODAY SUMMARY */}
      <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '10px' }}>
        Today's Activity · {data?.todayIST}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '28px' }}>
        {[
          { label: 'Walk-ins',        value: walkinToday ?? 0,          color: t.blue   },
          { label: 'Bills Submitted', value: ts?.total ?? 0,            color: t.text1  },
          { label: 'Approved',        value: ts?.approved ?? 0,         color: t.green  },
          { label: 'Pending',         value: ts?.pending ?? 0,          color: t.orange },
          { label: 'Rejected',        value: ts?.rejected ?? 0,         color: t.red    },
          { label: 'Approved Value',  value: fmtAmt(ts?.approved_value), color: t.gold  },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 200, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '6px' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* PENDING GOLD AT BRANCHES — THE KEY SECTION */}
      <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '10px' }}>
        Gold at Branches (Pending Payment)
        <span style={{ marginLeft: '10px', color: t.orange, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          — {pendingGold.length} branches · {fmtWt(pendingTotals?.total_net_g)} total · {fmtAmt(pendingTotals?.total_value)}
        </span>
      </div>
      <div style={{ ...card, marginBottom: '28px', padding: '0' }}>
        {pendingGold.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: t.text4, fontSize: '.75rem' }}>No pending gold at any branch</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: t.card2 }}>
                  {['Branch', 'Pending Bills', 'Net Weight', 'Gross Weight', 'Pending Value', 'Oldest Bill', 'Weight Bar'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: '.55rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingGold.map((b, i) => {
                  const isOld = Number(b.oldest_days) > 30
                  return (
                    <tr key={b.branch_id || i}
                      style={{ background: isOld ? `${t.red}05` : 'transparent', transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = t.card2}
                      onMouseLeave={e => e.currentTarget.style.background = isOld ? `${t.red}05` : 'transparent'}>
                      <td style={{ padding: '10px 14px', fontSize: '.75rem', fontWeight: 500, color: t.text1, borderBottom: `1px solid ${t.border}20` }}>{b.branch_name || b.branch_id}</td>
                      <td style={{ padding: '10px 14px', fontSize: '.72rem', color: t.orange, textAlign: 'right', borderBottom: `1px solid ${t.border}20` }}>{b.pending_bills}</td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}20` }}>
                        <span style={{ fontSize: '.8rem', fontWeight: 600, color: t.gold }}>{fmtWt(b.net_weight_g)}</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '.72rem', color: t.text3, borderBottom: `1px solid ${t.border}20` }}>{fmtWt(b.gross_weight_g)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '.75rem', fontWeight: 500, color: t.green, borderBottom: `1px solid ${t.border}20` }}>{fmtAmt(b.pending_value)}</td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: '.7rem', color: isOld ? t.red : t.text3 }}>{fmtDate(b.oldest_date)}</div>
                        <div style={{ fontSize: '.62rem', color: isOld ? t.red : t.text4 }}>
                          {b.oldest_days === 0 ? 'Today' : `${b.oldest_days}d ago`}
                          {isOld ? ' ⚠' : ''}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}20`, minWidth: '100px' }}>
                        <div style={{ height: '6px', background: `${t.border}40`, borderRadius: '3px' }}>
                          <div style={{ width: `${Math.round((Number(b.net_weight_g) / maxNetWt) * 100)}%`, height: '100%', background: t.gold, borderRadius: '3px' }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: t.card2 }}>
                  <td style={{ padding: '10px 14px', fontSize: '.68rem', color: t.text3, fontWeight: 500, borderTop: `1px solid ${t.border}` }}>TOTAL</td>
                  <td style={{ padding: '10px 14px', fontSize: '.72rem', color: t.orange, textAlign: 'right', borderTop: `1px solid ${t.border}` }}>{pendingTotals?.total_bills}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${t.border}` }}>
                    <span style={{ fontSize: '.8rem', fontWeight: 600, color: t.gold }}>{fmtWt(pendingTotals?.total_net_g)}</span>
                  </td>
                  <td colSpan={2} style={{ padding: '10px 14px', fontSize: '.75rem', fontWeight: 500, color: t.green, borderTop: `1px solid ${t.border}` }}>{fmtAmt(pendingTotals?.total_value)}</td>
                  <td colSpan={2} style={{ borderTop: `1px solid ${t.border}` }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* TODAY'S TIMELINE */}
      <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '10px' }}>
        Today's Timeline ({timeline.length} events)
      </div>
      {timeline.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: t.text4, fontSize: '.75rem', padding: '40px' }}>
          No activity logged yet today — data will appear here in real-time as branch staff enter it in the CRM
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {timeline.map((item, i) => {
            const isWalkin = item._type === 'walkin'
            const statusColor = isWalkin
              ? (item.walkin_status === 'sold' ? t.green : t.blue)
              : (STATUS_STYLE[item.trxn_status]?.color || t.text3)

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
                    {isWalkin ? 'Walk-in' : item.trxn_status}
                  </span>
                </div>

                {/* DETAILS */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.75rem', color: t.text1, fontWeight: 500 }}>{item.cust_name || '—'}</div>
                  <div style={{ fontSize: '.65rem', color: t.text3, marginTop: '2px' }}>
                    {item.cust_mobile}
                    {item.branch_name && <span style={{ marginLeft: '8px', color: t.text4 }}>· {item.branch_name}</span>}
                  </div>
                </div>

                {/* ITEM-SPECIFIC INFO */}
                {isWalkin ? (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '.7rem', color: t.text2 }}>{item.item_type || '—'}</div>
                    <div style={{ fontSize: '.65rem', color: t.text4 }}>{item.gms_weight ? `${item.gms_weight}g` : ''}{item.walk_reason ? ` · ${item.walk_reason}` : ''}</div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '.75rem', color: t.gold, fontWeight: 500 }}>{fmtAmt(item.amount)}</div>
                    <div style={{ fontSize: '.65rem', color: t.text4 }}>{item.type_gold}{item.pymt_mde ? ` · ${item.pymt_mde}` : ''}</div>
                  </div>
                )}

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
