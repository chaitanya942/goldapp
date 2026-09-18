'use client'

// TodaysBookingsWidget — compact dashboard panel comparing today's bookings
// (cal_quotas rows whose created_at falls on today IST) against yesterday's,
// so ops can immediately see whether the day's bidding activity is ahead or
// behind. Two summary cards (Today / Yesterday: bookings · weight · value)
// up top, then the same detailed Party · Bid Weight · Bid Rate table for
// today's bookings underneath. Anyone who can see the Bidding Volume module
// (canSee('consignment-bidding')) sees this.
//
// Data source: /api/consignments?action=bidding_bookings&bidding_date=YYYY-MM-DD
// (same endpoint the Bidding Volume module's Bookings tab reads from) — called
// once for today and once for yesterday.

import { useEffect, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { istToday, istDaysAgo } from '../../lib/dateIst'

const fmtWt   = (g) => `${Number(g || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`
// Bid rate is ₹ per gram — keep full integer precision (no Cr/L compression)
// so ops sees the exact rate they bid at.
const fmtRate = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`
const fmtAmt  = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`

// Live (non-cancelled) rows from the bidding_bookings response, tolerant of
// a few historical response shapes.
const liveRows = (j) => {
  const raw = Array.isArray(j.data?.bookings) ? j.data.bookings
            : Array.isArray(j.bookings)      ? j.bookings
            : Array.isArray(j.rows)          ? j.rows
            : Array.isArray(j.data)          ? j.data
            : []
  return raw.filter(b => b.status !== 'cancelled')
}

// Aggregate a day's rows into the three comparable metrics. Value is
// Σ(weight × rate) since rate is a per-gram price, not a total.
const summarize = (rows) => {
  const count  = (rows || []).length
  const weight = (rows || []).reduce((s, r) => s + (Number(r.weight) || 0), 0)
  const value  = (rows || []).reduce((s, r) => s + (Number(r.weight) || 0) * (Number(r.rate) || 0), 0)
  return { count, weight, value }
}

// % change of curr vs prev — null when there's nothing meaningful to compare
// (both zero), so the badge can be omitted instead of showing "0%".
const pctDelta = (curr, prev) => {
  if (prev > 0) return Math.round((curr - prev) / prev * 100)
  if (curr > 0) return 100
  return null
}

export default function TodaysBookingsWidget({ t, isMobile, setActiveNav }) {
  const [todayRows, setTodayRows] = useState(null)
  const [yestRows,  setYestRows]  = useState(null)
  const [loadErr,   setLoadErr]   = useState(null)

  useEffect(() => {
    let cancelled = false
    const today     = istToday()
    const yesterday = istDaysAgo(1)
    const fetchDay = (d) => authedFetch(`/api/consignments?action=bidding_bookings&bidding_date=${d}`)
      .then(r => r.json())
      .then(j => { if (j.error) throw new Error(j.error); return liveRows(j) })

    Promise.all([fetchDay(today), fetchDay(yesterday)])
      .then(([t, y]) => { if (!cancelled) { setTodayRows(t); setYestRows(y) } })
      .catch(e => { if (!cancelled) setLoadErr(e?.message || 'Load failed') })
    return () => { cancelled = true }
  }, [])

  const rows = todayRows  // detail table below stays today-only, as before
  const todaySum = summarize(todayRows)
  const yestSum  = summarize(yestRows)
  const avgRate  = todaySum.weight > 0 ? todaySum.value / todaySum.weight : 0

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, overflow: 'hidden' }
  const loading = todayRows == null && yestRows == null && !loadErr

  if (loading) {
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
          ⚠ Couldn't load bookings — {loadErr}
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
          Bookings
        </span>
        <span style={{ fontSize: 10, color: t.text4, marginLeft: 4 }}>
          · today vs yesterday
        </span>
        {setActiveNav && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: t.text4 }}>open →</span>
        )}
      </div>

      {/* Today vs Yesterday comparison */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, padding: '14px' }}>
        <CompareCard t={t} label="Today" accent={t.gold} sum={todaySum}
          deltaCount={pctDelta(todaySum.count,  yestSum.count)}
          deltaWeight={pctDelta(todaySum.weight, yestSum.weight)}
          deltaValue={pctDelta(todaySum.value,  yestSum.value)} />
        <CompareCard t={t} label="Yesterday" accent={t.text3} sum={yestSum} />
      </div>

      {/* Today's booking detail — Party · Bid Weight · Bid Rate */}
      {rows.length === 0 ? (
        <div style={{ padding: '4px 16px 20px', textAlign: 'center', color: t.text4, fontSize: 12 }}>
          No bookings placed today yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle(t, 'left')}>Party</th>
                <th style={thStyle(t, 'right')}>Bid Weight</th>
                <th style={thStyle(t, 'right')}>Bid Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${t.border}25` }}>
                  <td style={tdStyle(t, 'left', { fontWeight: 600, color: t.text1 })}>
                    {r.party || '—'}
                    {r.is_kl && <span style={{ marginLeft: 6, fontSize: 9, color: t.green, background: `${t.green}18`, padding: '1px 5px', borderRadius: 3, fontWeight: 700, letterSpacing: '.04em' }}>KL</span>}
                  </td>
                  <td style={tdStyle(t, 'right', { color: t.gold, fontFamily: 'monospace', fontWeight: 600 })}>{fmtWt(r.weight)}</td>
                  <td style={tdStyle(t, 'right', { color: t.text2, fontFamily: 'monospace' })}>{fmtRate(r.rate)}<span style={{ color: t.text4, fontSize: 10, marginLeft: 2 }}>/g</span></td>
                </tr>
              ))}
              {/* Totals — weight totals; rate is a weighted average tagged "avg" so it
                  doesn't read as a sum. */}
              <tr style={{ background: `${t.gold}10`, borderTop: `1px solid ${t.gold}40` }}>
                <td style={tdStyle(t, 'left', { color: t.gold, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: 11 })}>
                  Total
                </td>
                <td style={tdStyle(t, 'right', { color: t.gold, fontFamily: 'monospace', fontWeight: 800 })}>{fmtWt(todaySum.weight)}</td>
                <td style={tdStyle(t, 'right', { color: t.green, fontFamily: 'monospace', fontWeight: 800 })}>
                  <span style={{ color: t.text4, fontSize: 10, fontWeight: 600, marginRight: 3 }}>avg</span>
                  {fmtRate(avgRate)}<span style={{ color: t.text4, fontSize: 10, marginLeft: 2 }}>/g</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// One day's summary card — Bookings · Weight · Value, with an optional
// delta badge (vs the other card) next to each figure.
function CompareCard({ t, label, accent, sum, deltaCount, deltaWeight, deltaValue }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '12px 14px', borderRadius: 10, background: `${accent}0a`, border: `1px solid ${accent}30` }}>
      <div style={{ fontSize: 10, color: accent, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 9 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <StatRow t={t} label="Bookings" value={sum.count.toLocaleString('en-IN')} delta={deltaCount} />
        <StatRow t={t} label="Weight"   value={fmtWt(sum.weight)} delta={deltaWeight} />
        <StatRow t={t} label="Value"    value={fmtAmt(sum.value)} delta={deltaValue} />
      </div>
    </div>
  )
}

function StatRow({ t, label, value, delta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: t.text3 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 13, color: t.text1, fontWeight: 700, fontFamily: 'monospace' }}>{value}</span>
        {delta != null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: delta >= 0 ? t.green : t.red }}>
            {delta >= 0 ? '▲' : '▼'}{Math.abs(delta)}%
          </span>
        )}
      </span>
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
