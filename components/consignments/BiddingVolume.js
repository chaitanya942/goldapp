'use client'

// BiddingVolume — daily volume planning view for the bid desk.
//
// Shows the gold expected to be at HO on a given target date so the bid
// desk can decide tomorrow morning's price. Default target = tomorrow.
//
// Two contributions are pooled together:
//   1. Bangalore approved purchases from (target_date - 1) — auto-consolidated
//      at 19:30 IST so they're at HO by target-date morning.
//   2. Outside Bangalore bills currently in_consignment whose computed
//      arrival (dispatched_at + branch.delivery_tat_hours) lands on the
//      target date. A 24h-TAT branch dispatched today shows up under
//      tomorrow's view; a 48h-TAT branch dispatched today moves out to the
//      day-after view, since it won't be at HO by tomorrow morning.

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, REGION_COLORS, useMobile } from '../../lib/consignmentTheme'
import { istToday } from '../../lib/dateIst'

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n, d = 3) => n != null ? Number(n).toFixed(d) : '—'
const fmtNum = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtINR = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[+m - 1]} ${y}`
}
const fmtDateShort = (d) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[+m - 1]}`
}
// Compare YYYY-MM-DD strings — lexicographic order works for the canonical format.
const dateDiff = (a, b) => {
  const A = new Date(a + 'T00:00:00Z').getTime()
  const B = new Date(b + 'T00:00:00Z').getTime()
  return Math.round((A - B) / 86400000)
}
const dateAdd = (d, n) => {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day + n))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

// ── Component ────────────────────────────────────────────────────────────────
export default function BiddingVolume() {
  const { theme } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const today    = istToday()
  const tomorrow = dateAdd(today, 1)

  const [arrivalDate, setArrivalDate] = useState(tomorrow)
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [expanded,    setExpanded]    = useState(() => new Set(['bangalore', 'in_transit']))

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const r = await authedFetch(`/api/consignments?action=bidding_volume&date=${arrivalDate}`)
      const j = await r.json()
      if (!r.ok || j.error) { setError(j.error || `HTTP ${r.status}`); setData(null); return }
      setData(j.data)
    } catch (e) {
      setError(String(e?.message || e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [arrivalDate])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleSection = (k) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  // ── Date label helpers ─────────────────────────────────────────────────────
  const dayDiff = dateDiff(arrivalDate, today)
  const dayLabel = dayDiff === 0 ? 'today'
    : dayDiff === 1 ? 'tomorrow'
    : dayDiff === -1 ? 'yesterday'
    : dayDiff > 0 ? `in ${dayDiff} days`
    : `${Math.abs(dayDiff)} days ago`

  // Quick-select chips for common arrival dates.
  const presets = [
    { id: 'today',     label: 'Today',     date: today },
    { id: 'tomorrow',  label: 'Tomorrow',  date: tomorrow },
    { id: 'plus2',     label: '+2 days',   date: dateAdd(today, 2) },
    { id: 'plus3',     label: '+3 days',   date: dateAdd(today, 3) },
  ]
  const activePreset = presets.find(p => p.date === arrivalDate)?.id

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  // ── Loading / empty / error ────────────────────────────────────────────────
  if (loading && !data) return <div style={{ padding: 80, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 720 }}>
        <div style={{ ...card, padding: '20px 24px', borderColor: `${t.red}55`, background: `${t.red}08` }}>
          <div style={{ fontSize: '13px', color: t.red, fontWeight: 700, marginBottom: 6 }}>Could not load bidding volume</div>
          <div style={{ fontSize: '12px', color: t.text2 }}>{error}</div>
        </div>
      </div>
    )
  }

  const total = data?.grand_total || { bills: 0, gross_wt: 0, net_wt: 0, amount: 0 }
  const bang  = data?.bangalore   || { branches: [], total: { bills: 0, gross_wt: 0, net_wt: 0, amount: 0 } }
  const inT   = data?.in_transit  || { branches: [], total: { bills: 0, gross_wt: 0, net_wt: 0, amount: 0 } }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Bidding Volume</div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: t.gold, background: `${t.gold}15`, borderRadius: '20px', padding: '3px 10px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.gold, display: 'inline-block' }} />
              {dayLabel}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            Gold expected at HO on <strong style={{ color: t.text1 }}>{fmtDate(arrivalDate)}</strong> · for bid desk planning
          </div>
        </div>
        <button onClick={() => fetchData()} disabled={loading}
          style={{ background: loading ? t.card2 : `${t.gold}15`, border: `1px solid ${loading ? t.border : `${t.gold}40`}`, borderRadius: '8px', padding: '7px 16px', fontSize: '12px', color: loading ? t.text4 : t.gold, cursor: loading ? 'default' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Date controls ── */}
      <div style={{ ...card, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, ${t.gold}40 0%, transparent 60%)`, pointerEvents: 'none' }} />
        <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Arrival</span>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {presets.map(p => {
            const active = activePreset === p.id
            return (
              <button key={p.id}
                onClick={() => setArrivalDate(p.date)}
                style={{
                  background:   active ? `${t.gold}22` : 'transparent',
                  color:        active ? t.gold : t.text3,
                  border:       `1px solid ${active ? `${t.gold}70` : 'transparent'}`,
                  borderRadius: '99px',
                  padding:      '4px 11px',
                  fontSize:     '10.5px',
                  fontWeight:   active ? 700 : 500,
                  cursor:       'pointer',
                  transition:   'all .12s',
                  whiteSpace:   'nowrap',
                  letterSpacing:'.02em',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${t.text4}10` }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                {p.label}
              </button>
            )
          })}
        </div>
        <span style={{ width: 1, height: 18, background: t.border }} />
        <input type="date" value={arrivalDate} onChange={e => setArrivalDate(e.target.value)}
          style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
          <div style={{ fontSize: '11px', color: t.text4, fontFamily: 'monospace', letterSpacing: '.04em' }}>
            Bangalore source date <strong style={{ color: t.text2 }}>{data?.bangalore_purchase_date ? fmtDateShort(data.bangalore_purchase_date) : '—'}</strong>
          </div>
        </div>
      </div>

      {/* ── KPI strip — totals across the pool ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px' }}>
        <KpiCard label="Total Bills"      value={fmtNum(total.bills)}              accent={t.text1}  card={card} t={t} icon="◧" />
        <KpiCard label="Net Weight"       value={`${fmt(total.net_wt, 2)} g`}       accent={t.gold}   card={card} t={t} icon="⚖" big />
        <KpiCard label="Gross Weight"     value={`${fmt(total.gross_wt, 2)} g`}     accent={t.text2}  card={card} t={t} icon="◯" />
        <KpiCard label="Value"            value={fmtINR(total.amount)}              accent={t.blue}   card={card} t={t} icon="₹" />
      </div>

      {/* ── Bangalore section ── */}
      <Section
        t={t} card={card}
        title="Bangalore Purchases"
        subtitle={`Auto-consolidated at 19:30 IST · purchase date ${fmtDateShort(data?.bangalore_purchase_date || '')}`}
        accent={t.red}
        total={bang.total}
        branches={bang.branches}
        expanded={expanded.has('bangalore')}
        onToggle={() => toggleSection('bangalore')}
        emptyHint="No approved Bangalore purchases for the source date."
        showTat={false}
      />

      {/* ── In-Transit section ── */}
      <Section
        t={t} card={card}
        title="Outside-Bangalore In Transit"
        subtitle={`Arriving at HO on ${fmtDateShort(arrivalDate)} per branch TAT`}
        accent={t.blue}
        total={inT.total}
        branches={inT.branches}
        expanded={expanded.has('in_transit')}
        onToggle={() => toggleSection('in_transit')}
        emptyHint="No outstation bills are scheduled to arrive on this date."
        showTat
      />

      <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
        Arrival = <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>dispatched_at + branch.delivery_tat_hours</code>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }
      `}</style>
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, accent, card, t, icon, big = false }) {
  return (
    <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${accent}`, position: 'relative' }}>
      <div style={{ position: 'absolute', right: 14, top: 14, fontSize: '14px', opacity: 0.18 }}>{icon}</div>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: big ? '28px' : '24px', fontWeight: 200, color: accent, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.01em' }}>{value}</div>
    </div>
  )
}

// ── Section — header + per-branch list ───────────────────────────────────────
function Section({ t, card, title, subtitle, accent, total, branches, expanded, onToggle, emptyHint, showTat }) {
  const isEmpty = !branches || branches.length === 0
  return (
    <div style={{ ...card, overflow: 'hidden', borderTop: `3px solid ${accent}` }}>
      <div onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '14px 18px', cursor: 'pointer',
          background: `linear-gradient(90deg, ${accent}10, transparent 70%)`,
          borderBottom: expanded ? `1px solid ${t.border}` : 'none',
          userSelect: 'none',
        }}>
        <span style={{
          width: '20px', height: '20px', borderRadius: '50%',
          background: `${accent}25`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 700,
          transform: expanded ? 'rotate(0)' : 'rotate(-90deg)',
          transition: 'transform .2s',
        }}>▾</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 700, color: t.text1, letterSpacing: '-.005em' }}>{title}</div>
          <div style={{ fontSize: '10.5px', color: t.text4, marginTop: '2px' }}>{subtitle}</div>
        </div>
        {/* Roll-up stats */}
        <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Net Wt</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: accent, fontFamily: 'monospace', lineHeight: 1.2 }}>
              {fmt(total.net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Bills</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: t.text1, fontFamily: 'monospace', lineHeight: 1.2 }}>{total.bills || '—'}</div>
          </div>
        </div>
      </div>

      {expanded && (
        isEmpty ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>{emptyHint}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: `${t.text4}05` }}>
                {['Branch', 'Region', ...(showTat ? ['TAT'] : []), 'Bills', 'Gross Wt', 'Net Wt', 'Value'].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', fontSize: '9.5px', color: t.text4,
                    letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700,
                    textAlign: ['Bills', 'Gross Wt', 'Net Wt', 'Value'].includes(h) ? 'right' : 'left',
                    borderBottom: `1px solid ${t.border}`,
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branches.map((b, i) => {
                const rColor = REGION_COLORS[b.region] || t.text3
                return (
                  <tr key={b.branch_name} style={{ borderBottom: i < branches.length - 1 ? `1px solid ${t.border}30` : 'none' }}>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', color: t.text1, fontWeight: 600, borderLeft: `3px solid ${rColor}80` }}>{b.branch_name}</td>
                    <td style={{ padding: '10px 14px', fontSize: '11px', color: rColor }}>{b.region}</td>
                    {showTat && (
                      <td style={{ padding: '10px 14px', fontSize: '11px' }}>
                        <span style={{ color: t.text2, background: `${t.text4}15`, borderRadius: '4px', padding: '2px 8px', fontFamily: 'monospace', fontWeight: 600 }}>
                          {b.tat_hours ? `${b.tat_hours}h` : '—'}
                        </span>
                      </td>
                    )}
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600, textAlign: 'right' }}>{b.total_bills}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text2, fontFamily: 'monospace', textAlign: 'right' }}>{fmt(b.total_gross_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 600, textAlign: 'right' }}>{fmt(b.total_net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></td>
                    <td style={{ padding: '10px 14px', fontSize: '11px', color: t.blue, fontFamily: 'monospace', textAlign: 'right' }}>{fmtINR(b.total_amount)}</td>
                  </tr>
                )
              })}
              {/* Totals row */}
              <tr style={{ background: `${accent}10`, borderTop: `2px solid ${accent}40` }}>
                <td colSpan={showTat ? 3 : 2} style={{ padding: '10px 14px', fontSize: '10px', color: t.text2, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  Σ Totals · {branches.length}
                </td>
                <td style={{ padding: '10px 14px', fontSize: '13px', color: accent, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>{total.bills}</td>
                <td style={{ padding: '10px 14px', fontSize: '12px', color: accent, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>{fmt(total.gross_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></td>
                <td style={{ padding: '10px 14px', fontSize: '13px', color: accent, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>{fmt(total.net_wt, 2)}<span style={{ fontSize: '10px', marginLeft: '2px' }}>g</span></td>
                <td style={{ padding: '10px 14px', fontSize: '11px', color: accent, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>{fmtINR(total.amount)}</td>
              </tr>
            </tbody>
          </table>
        )
      )}
    </div>
  )
}
