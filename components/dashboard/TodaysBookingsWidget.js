'use client'

// TodaysBookingsWidget — compact dashboard panel showing the day's bookings
// (cal_quotas rows whose created_at falls on today IST). Three columns:
// Party · Bid Weight · Bid Amount, plus a totals row. Nothing else — kept
// deliberately minimal as a glance-only widget. Anyone who can see the
// Bidding Volume module (canSee('consignment-bidding')) sees this.
//
// Data source: /api/consignments?action=bidding_bookings&bidding_date=YYYY-MM-DD
// (same endpoint the Bidding Volume module's Bookings tab reads from).

import { useEffect, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { istToday } from '../../lib/dateIst'

const fmtWt  = (g) => `${Number(g || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`
const fmtAmt = (n) => {
  const v = Number(n || 0)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

export default function TodaysBookingsWidget({ t, isMobile, setActiveNav }) {
  const [rows,    setRows]    = useState(null)
  const [loadErr, setLoadErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    const today = istToday()
    authedFetch(`/api/consignments?action=bidding_bookings&bidding_date=${today}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j.error) { setLoadErr(j.error); return }
        // API returns { data: { bookings: [...], ... } }. Be defensive against
        // older shapes too (top-level bookings/rows) — but always coerce to
        // an array before calling .filter() so a wrapper object can't 500 us.
        const raw = Array.isArray(j.data?.bookings) ? j.data.bookings
                  : Array.isArray(j.bookings)      ? j.bookings
                  : Array.isArray(j.rows)          ? j.rows
                  : Array.isArray(j.data)          ? j.data
                  : []
        // Drop cancelled bookings — totals should reflect what's live.
        const live = raw.filter(b => b.status !== 'cancelled')
        setRows(live)
      })
      .catch(e => { if (!cancelled) setLoadErr(e?.message || 'Load failed') })
    return () => { cancelled = true }
  }, [])

  // Totals over the visible (non-cancelled) rows.
  const totalWt  = (rows || []).reduce((s, r) => s + (Number(r.weight) || 0), 0)
  const totalAmt = (rows || []).reduce((s, r) => s + (Number(r.weight) || 0) * (Number(r.rate) || 0), 0)

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, overflow: 'hidden' }

  if (rows == null && !loadErr) {
    return (
      <div style={{ ...card, padding: '20px', minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${t.border}`, borderTopColor: t.purple, animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (loadErr) {
    return (
      <div style={{ ...card, padding: '14px 16px', borderColor: `${t.red}40`, background: `${t.red}08` }}>
        <div style={{ fontSize: 12, color: t.red, fontWeight: 600 }}>
          ⚠ Couldn't load today's bookings — {loadErr}
        </div>
      </div>
    )
  }

  return (
    <div style={card}>
      {/* Header */}
      <div onClick={setActiveNav ? () => setActiveNav('consignment-bidding') : undefined}
        title={setActiveNav ? 'Open Bidding Volume' : ''}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 14px',
          background: `linear-gradient(90deg, ${t.purple}12, transparent)`,
          borderBottom: `1px solid ${t.border}`,
          cursor: setActiveNav ? 'pointer' : 'default',
        }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: t.purple }} />
        <span style={{ fontSize: 11, color: t.purple, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          Today's Bookings
        </span>
        <span style={{ fontSize: 10, color: t.text4, marginLeft: 4 }}>
          · {rows.length} booking{rows.length === 1 ? '' : 's'}
        </span>
        {setActiveNav && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: t.text4 }}>open →</span>
        )}
      </div>

      {/* Body */}
      {rows.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: t.text4, fontSize: 12 }}>
          No bookings placed today yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle(t, 'left')}>Party</th>
                <th style={thStyle(t, 'right')}>Bid Weight</th>
                <th style={thStyle(t, 'right')}>Bid Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const amt = (Number(r.weight) || 0) * (Number(r.rate) || 0)
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${t.border}25` }}>
                    <td style={tdStyle(t, 'left', { fontWeight: 600, color: t.text1 })}>
                      {r.party || '—'}
                      {r.is_kl && <span style={{ marginLeft: 6, fontSize: 9, color: t.green, background: `${t.green}18`, padding: '1px 5px', borderRadius: 3, fontWeight: 700, letterSpacing: '.04em' }}>KL</span>}
                    </td>
                    <td style={tdStyle(t, 'right', { color: t.gold, fontFamily: 'monospace', fontWeight: 600 })}>{fmtWt(r.weight)}</td>
                    <td style={tdStyle(t, 'right', { color: t.text2, fontFamily: 'monospace' })}>{fmtAmt(amt)}</td>
                  </tr>
                )
              })}
              {/* Totals */}
              <tr style={{ background: `${t.gold}10`, borderTop: `1px solid ${t.gold}40` }}>
                <td style={tdStyle(t, 'left', { color: t.gold, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: 11 })}>
                  Total
                </td>
                <td style={tdStyle(t, 'right', { color: t.gold, fontFamily: 'monospace', fontWeight: 800 })}>{fmtWt(totalWt)}</td>
                <td style={tdStyle(t, 'right', { color: t.green, fontFamily: 'monospace', fontWeight: 800 })}>{fmtAmt(totalAmt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function thStyle(t, align) {
  return {
    padding: '9px 12px', fontSize: 10, color: t.text4,
    letterSpacing: '.08em', textTransform: 'uppercase', textAlign: align,
    background: t.card2, borderBottom: `1px solid ${t.border}`,
    whiteSpace: 'nowrap', fontWeight: 700, userSelect: 'none',
  }
}

function tdStyle(t, align, extra = {}) {
  return {
    padding: '9px 12px', fontSize: 12, color: t.text2,
    textAlign: align, whiteSpace: 'nowrap',
    ...extra,
  }
}
