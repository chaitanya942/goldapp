'use client'

// BiddingVolume — action surface for the ops bid desk.
//
// On a target arrival date (default = tomorrow), this view shows:
//   1. INCOMING — total grams expected at HO (Bangalore today + outside
//      in-transit arriving on the target). Read-only.
//   2. BOOKED   — sum of active bookings (status != cancelled) for that
//      date, sourced from cal_quotas. Bookings created here also appear
//      in Sales → Cal Table → Quotas tab on the same date.
//   3. AVAILABLE — INCOMING − BOOKED. Turns red when negative (over-
//      booked) but the booking still goes through per spec.
//
// Booking flow:
//   Ops creates a booking (party + weight + ₹/g + optional purity/notes).
//   Status starts at 'booked'. Accounts confirms → 'confirmed'. When the
//   gold arrives and is handed over → 'fulfilled'. Either side can
//   cancel before fulfilment.
//
// Existing sources (Bangalore / In-Transit breakdown) are demoted to a
// collapsed section at the bottom since the primary use case is the
// booking ledger now.

import { useState, useEffect, useCallback, useMemo } from 'react'
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
const fmtTS = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const STATUS_META = {
  booked:    { label: 'Booked',    color: '#c9a84c' },  // gold
  confirmed: { label: 'Confirmed', color: '#3a8fbf' },  // blue
  fulfilled: { label: 'Fulfilled', color: '#3aaa6a' },  // green
  cancelled: { label: 'Cancelled', color: '#e05555' },  // red
}

// ── Component ────────────────────────────────────────────────────────────────
export default function BiddingVolume() {
  const { theme } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const today    = istToday()
  const tomorrow = dateAdd(today, 1)

  const [arrivalDate,  setArrivalDate]  = useState(tomorrow)
  const [supply,       setSupply]       = useState(null)
  const [bookingsResp, setBookingsResp] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [sourcesOpen,  setSourcesOpen]  = useState(false)
  const [showBookModal, setShowBookModal] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [toast,        setToast]        = useState(null)

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [supR, bkR] = await Promise.all([
        authedFetch(`/api/consignments?action=bidding_volume&date=${arrivalDate}`),
        authedFetch(`/api/consignments?action=bidding_bookings&date=${arrivalDate}`),
      ])
      const supJ = await supR.json()
      const bkJ  = await bkR.json()
      if (!supR.ok || supJ.error) throw new Error(supJ.error || `Supply HTTP ${supR.status}`)
      if (!bkR.ok  || bkJ.error)  throw new Error(bkJ.error  || `Bookings HTTP ${bkR.status}`)
      setSupply(supJ.data)
      setBookingsResp(bkJ.data)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [arrivalDate])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Derived numbers ────────────────────────────────────────────────────────
  const incomingNetWt   = supply?.grand_total?.net_wt    || 0
  const incomingGrossWt = supply?.grand_total?.gross_wt  || 0
  const incomingBills   = supply?.grand_total?.bills     || 0

  const bookings        = bookingsResp?.bookings || []
  const activeBookings  = useMemo(() => bookings.filter(b => b.status !== 'cancelled'), [bookings])
  const bookedQty       = bookingsResp?.active_qty_grams || 0
  const bookedValue     = bookingsResp?.active_value     || 0
  const availableQty    = incomingNetWt - bookedQty
  const overbooked      = availableQty < 0
  const bookedPct       = incomingNetWt > 0 ? Math.min(100, (bookedQty / incomingNetWt) * 100) : 0

  // ── Date label ─────────────────────────────────────────────────────────────
  const dayDiff = dateDiff(arrivalDate, today)
  const dayLabel = dayDiff === 0 ? 'today'
    : dayDiff === 1 ? 'tomorrow'
    : dayDiff === -1 ? 'yesterday'
    : dayDiff > 0 ? `in ${dayDiff} days`
    : `${Math.abs(dayDiff)} days ago`

  const presets = [
    { id: 'today',     label: 'Today',     date: today },
    { id: 'tomorrow',  label: 'Tomorrow',  date: tomorrow },
    { id: 'plus2',     label: '+2 days',   date: dateAdd(today, 2) },
    { id: 'plus3',     label: '+3 days',   date: dateAdd(today, 3) },
  ]
  const activePreset = presets.find(p => p.date === arrivalDate)?.id

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type, key: Date.now() })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createBooking = async (payload) => {
    const r = await authedFetch('/api/consignments?action=create_booking', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, date: arrivalDate }),
    })
    const j = await r.json()
    if (!r.ok || j.error) { showToast(j.error || 'Booking failed', 'error'); return false }
    showToast('Booking created.', 'success')
    setShowBookModal(false)
    fetchAll(true)
    return true
  }

  const updateStatus = async (id, status, reason) => {
    const r = await authedFetch('/api/consignments?action=update_booking_status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, reason }),
    })
    const j = await r.json()
    if (!r.ok || j.error) { showToast(j.error || 'Update failed', 'error'); return false }
    showToast(`Marked ${status}.`, 'success')
    fetchAll(true)
    return true
  }

  // ── Loading / error ────────────────────────────────────────────────────────
  if (loading && !supply) return <div style={{ padding: 80, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 720 }}>
        <div style={{ ...card, padding: '20px 24px', borderColor: `${t.red}55`, background: `${t.red}08` }}>
          <div style={{ fontSize: '13px', color: t.red, fontWeight: 700, marginBottom: 6 }}>Could not load bidding data</div>
          <div style={{ fontSize: '12px', color: t.text2 }}>{error}</div>
          <button onClick={() => fetchAll()} style={{ marginTop: 12, background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '6px 14px', fontSize: 11, color: t.text2, cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    )
  }

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
            Book against gold expected at HO on <strong style={{ color: t.text1 }}>{fmtDate(arrivalDate)}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => fetchAll()} disabled={loading}
            style={{ background: loading ? t.card2 : 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: loading ? t.text4 : t.text2, cursor: loading ? 'default' : 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
            Refresh
          </button>
          <button onClick={() => setShowBookModal(true)}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', boxShadow: `0 1px 4px ${t.gold}50` }}>
            + New Booking
          </button>
        </div>
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
                  whiteSpace:   'nowrap',
                  letterSpacing:'.02em',
                }}>
                {p.label}
              </button>
            )
          })}
        </div>
        <span style={{ width: 1, height: 18, background: t.border }} />
        <input type="date" value={arrivalDate} onChange={e => setArrivalDate(e.target.value)}
          style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: '11px', color: t.text4, fontFamily: 'monospace', letterSpacing: '.04em' }}>
          Bangalore source date <strong style={{ color: t.text2 }}>{supply?.bangalore_purchase_date ? fmtDateShort(supply.bangalore_purchase_date) : '—'}</strong>
        </div>
      </div>

      {/* ── Worksheet KPI strip — Incoming / Booked / Available / Value ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px' }}>
        <KpiCard label="Incoming Net Wt" value={`${fmt(incomingNetWt, 2)} g`} sub={`${incomingBills} bill${incomingBills === 1 ? '' : 's'} · gross ${fmt(incomingGrossWt, 2)} g`} accent={t.gold} card={card} t={t} />
        <KpiCard label="Booked" value={`${fmt(bookedQty, 2)} g`} sub={`${activeBookings.length} booking${activeBookings.length === 1 ? '' : 's'} · ${fmtINR(bookedValue)}`} accent={t.blue} card={card} t={t} />
        <KpiCard
          label={overbooked ? 'Overbooked' : 'Available'}
          value={`${overbooked ? '−' : ''}${fmt(Math.abs(availableQty), 2)} g`}
          sub={overbooked
            ? `${fmt(Math.abs(availableQty), 2)} g over the incoming pool`
            : `${incomingNetWt > 0 ? Math.round(100 - bookedPct) : 0}% of incoming free`}
          accent={overbooked ? t.red : t.green} card={card} t={t}
          pulse={overbooked} />
        {/* Bidding progress bar takes the 4th slot — visual sense of booked ratio */}
        <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.purple}`, position: 'relative' }}>
          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 700 }}>Bid Progress</div>
          <div style={{ position: 'relative', height: 10, background: `${t.border}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${Math.min(100, bookedPct)}%`,
              background: `linear-gradient(90deg, ${t.blue} 0%, ${overbooked ? t.red : t.green} 100%)`,
              transition: 'width .4s ease',
            }} />
          </div>
          <div style={{ marginTop: 6, fontSize: '11px', color: t.text3, display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
            <span>{Math.round(bookedPct)}% booked</span>
            <span style={{ color: overbooked ? t.red : t.text3 }}>{Math.max(0, Math.round(100 - bookedPct))}% free</span>
          </div>
        </div>
      </div>

      {overbooked && (
        <div style={{ ...card, padding: '10px 16px', borderColor: `${t.red}55`, background: `${t.red}10`, fontSize: '12px', color: t.red, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          Bookings exceed expected incoming by <strong>{fmt(Math.abs(availableQty), 2)} g</strong>. Consider deferring some or sourcing additional supply.
        </div>
      )}

      {/* ── Bookings list ── */}
      <BookingsList
        t={t} card={card}
        bookings={bookings}
        onUpdateStatus={updateStatus}
        onRequestCancel={(b) => setCancelTarget(b)}
        onCreate={() => setShowBookModal(true)}
      />

      {/* ── Sources (collapsed) — incoming volume breakdown by branch ── */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div onClick={() => setSourcesOpen(o => !o)}
          style={{ padding: '12px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, userSelect: 'none', borderBottom: sourcesOpen ? `1px solid ${t.border}` : 'none' }}>
          <span style={{
            width: 18, height: 18, borderRadius: '50%',
            background: `${t.gold}25`, color: t.gold,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
            transform: sourcesOpen ? 'rotate(0)' : 'rotate(-90deg)',
            transition: 'transform .2s',
          }}>▾</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: t.text1 }}>Incoming Sources</div>
            <div style={{ fontSize: '10.5px', color: t.text4, marginTop: 2 }}>
              Bangalore today + outside in-transit (arrival per branch TAT)
            </div>
          </div>
          <span style={{ fontSize: '11px', color: t.text3, fontFamily: 'monospace' }}>
            {fmt(incomingNetWt, 2)} g · {incomingBills} bills
          </span>
        </div>
        {sourcesOpen && supply && (
          <SourcesSection t={t} supply={supply} />
        )}
      </div>

      <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
        Bookings stored in <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>cal_quotas</code> — also visible in Sales → Cal Table → Quotas on the same date.
      </div>

      {/* ── New Booking modal ── */}
      {showBookModal && (
        <BookingModal
          t={t}
          arrivalDate={arrivalDate}
          incomingNetWt={incomingNetWt}
          bookedQty={bookedQty}
          onSubmit={createBooking}
          onClose={() => setShowBookModal(false)}
        />
      )}

      {/* ── Cancel booking modal ── */}
      {cancelTarget && (
        <CancelModal
          t={t}
          booking={cancelTarget}
          onConfirm={async (reason) => {
            const ok = await updateStatus(cancelTarget.id, 'cancelled', reason)
            if (ok) setCancelTarget(null)
          }}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 100,
          background: toast.type === 'error' ? t.red : toast.type === 'success' ? t.green : t.card,
          color: '#fff',
          padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,.25)',
        }}>{toast.msg}</div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }
      `}</style>
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent, card, t, pulse = false }) {
  return (
    <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${accent}`, position: 'relative' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 200, color: accent, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.01em', animation: pulse ? 'pulse 1.4s infinite' : 'none' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ── Bookings list ────────────────────────────────────────────────────────────
function BookingsList({ t, card, bookings, onUpdateStatus, onRequestCancel, onCreate }) {
  const [hideCancelled, setHideCancelled] = useState(true)
  const visible = hideCancelled ? bookings.filter(b => b.status !== 'cancelled') : bookings

  if (bookings.length === 0) {
    return (
      <div style={{ ...card, padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', color: t.text1, fontWeight: 600 }}>No bookings yet for this date</div>
        <div style={{ fontSize: '11.5px', color: t.text4, marginTop: 6, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
          Use “+ New Booking” to commit a portion of the incoming pool to a buyer. Bookings created here also appear in the Sales → Cal Table → Quotas tab for allocation.
        </div>
        <button onClick={onCreate} style={{ marginTop: 16, background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ New Booking</button>
      </div>
    )
  }

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: t.text1 }}>Bookings <span style={{ color: t.text4, fontWeight: 500 }}>({visible.length})</span></div>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: t.text3, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideCancelled} onChange={e => setHideCancelled(e.target.checked)} />
          Hide cancelled
        </label>
      </div>
      <div>
        {visible.map((b, i) => (
          <BookingRow
            key={b.id} b={b} t={t}
            isLast={i === visible.length - 1}
            onUpdateStatus={onUpdateStatus}
            onRequestCancel={onRequestCancel}
          />
        ))}
      </div>
    </div>
  )
}

function BookingRow({ b, t, isLast, onUpdateStatus, onRequestCancel }) {
  const meta = STATUS_META[b.status] || STATUS_META.booked
  const isCancelled = b.status === 'cancelled'
  const isFulfilled = b.status === 'fulfilled'
  const isTerminal  = isCancelled || isFulfilled
  const total = Number(b.weight || 0) * Number(b.rate || 0)
  return (
    <div style={{
      padding: '14px 18px',
      borderBottom: isLast ? 'none' : `1px solid ${t.border}40`,
      borderLeft: `3px solid ${meta.color}`,
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1.6fr) repeat(3, minmax(70px, 0.9fr)) minmax(110px, 1fr) auto',
      gap: 14,
      alignItems: 'center',
      background: isCancelled ? `${t.text4}06` : 'transparent',
      opacity: isCancelled ? 0.7 : 1,
    }}>
      {/* Party + audit */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '13.5px', color: t.text1, fontWeight: 700, letterSpacing: '-.005em' }}>{b.party}</div>
        <div style={{ fontSize: '10px', color: t.text4, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {b.purity && <span style={{ color: t.gold, fontWeight: 600 }}>{b.purity}</span>}
          {b.is_kl && <span style={{ color: t.purple, fontWeight: 600 }}>KL</span>}
          {b.buyer_phone && <span style={{ fontFamily: 'monospace' }}>{b.buyer_phone}</span>}
          {b.notes && <span style={{ fontStyle: 'italic' }} title={b.notes}>· note</span>}
        </div>
      </div>

      {/* Weight */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '14px', color: t.gold, fontWeight: 700, fontFamily: 'monospace' }}>
          {fmt(b.weight, 3)}<span style={{ fontSize: 10, marginLeft: 2 }}>g</span>
        </div>
        <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>weight</div>
      </div>
      {/* Rate */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '13px', color: t.text2, fontFamily: 'monospace', fontWeight: 600 }}>
          ₹{fmtNum(Math.round(b.rate))}
        </div>
        <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>per g</div>
      </div>
      {/* Total value */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '13.5px', color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>
          {fmtINR(total)}
        </div>
        <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>value</div>
      </div>

      {/* Status + audit */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: t.text4 }}>
        <span style={{ fontSize: 9.5, color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, borderRadius: 99, padding: '2px 9px', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', alignSelf: 'flex-start' }}>{meta.label}</span>
        {b.created_at && (
          <span title={`Created by ${b.created_by || 'unknown'} on ${fmtTS(b.created_at)}`}>
            {fmtTS(b.created_at)}
          </span>
        )}
        {b.cancelled_at && (
          <span style={{ color: t.red }} title={b.cancellation_reason || ''}>
            cancelled {fmtTS(b.cancelled_at)}
          </span>
        )}
        {b.fulfilled_at && (
          <span style={{ color: t.green }}>fulfilled {fmtTS(b.fulfilled_at)}</span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {!isTerminal && b.status === 'booked' && (
          <ActionPill label="Confirm" color={t.blue} onClick={() => onUpdateStatus(b.id, 'confirmed')} t={t} />
        )}
        {!isTerminal && (b.status === 'booked' || b.status === 'confirmed') && (
          <ActionPill label="Fulfill" color={t.green} onClick={() => onUpdateStatus(b.id, 'fulfilled')} t={t} />
        )}
        {!isTerminal && (
          <ActionPill label="Cancel" color={t.red} onClick={() => onRequestCancel(b)} t={t} subtle />
        )}
      </div>
    </div>
  )
}

function ActionPill({ label, color, onClick, t, subtle = false }) {
  return (
    <button onClick={onClick}
      style={{
        background:    subtle ? 'transparent' : `${color}15`,
        border:        `1px solid ${color}${subtle ? '40' : '60'}`,
        color,
        borderRadius:  6,
        padding:       '4px 10px',
        fontSize:      10,
        fontWeight:    700,
        cursor:        'pointer',
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        whiteSpace:    'nowrap',
      }}>{label}</button>
  )
}

// ── Sources section (collapsed by default) ───────────────────────────────────
function SourcesSection({ t, supply }) {
  const renderBranchTable = (rows, accent, showTat = false) => (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: `${t.text4}05` }}>
          {['Branch', 'Region', ...(showTat ? ['TAT'] : []), 'Bills', 'Net Wt'].map(h => (
            <th key={h} style={{ padding: '8px 14px', fontSize: '9.5px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, textAlign: ['Bills', 'Net Wt'].includes(h) ? 'right' : 'left', borderBottom: `1px solid ${t.border}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const rColor = REGION_COLORS[r.region] || t.text3
          return (
            <tr key={r.branch_name}>
              <td style={{ padding: '8px 14px', fontSize: 12, color: t.text1, fontWeight: 600, borderLeft: `3px solid ${rColor}80` }}>{r.branch_name}</td>
              <td style={{ padding: '8px 14px', fontSize: 11, color: rColor }}>{r.region}</td>
              {showTat && <td style={{ padding: '8px 14px', fontSize: 10 }}><span style={{ color: t.text2, background: `${t.text4}15`, borderRadius: 4, padding: '2px 7px', fontFamily: 'monospace', fontWeight: 600 }}>{r.tat_hours ? `${r.tat_hours}h` : '—'}</span></td>}
              <td style={{ padding: '8px 14px', fontSize: 12, color: t.gold, fontFamily: 'monospace', fontWeight: 600, textAlign: 'right' }}>{r.total_bills}</td>
              <td style={{ padding: '8px 14px', fontSize: 12, color: t.gold, fontFamily: 'monospace', fontWeight: 600, textAlign: 'right' }}>{fmt(r.total_net_wt, 2)}<span style={{ fontSize: 10, marginLeft: 2 }}>g</span></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const bang = supply.bangalore?.branches || []
  const inT  = supply.in_transit?.branches || []

  return (
    <div>
      <div style={{ padding: '12px 18px', fontSize: 11, color: t.text3, background: `${t.red}06`, borderBottom: `1px solid ${t.border}` }}>
        <strong style={{ color: t.text1, fontSize: 11.5 }}>Bangalore Purchases</strong> · purchase date {fmtDateShort(supply.bangalore_purchase_date)} · {fmt(supply.bangalore?.total?.net_wt || 0, 2)} g · {supply.bangalore?.total?.bills || 0} bills
      </div>
      {bang.length > 0 ? renderBranchTable(bang, t.red, false) : <div style={{ padding: '20px', fontSize: 11, color: t.text4, textAlign: 'center' }}>No approved Bangalore purchases on the source date.</div>}
      <div style={{ padding: '12px 18px', fontSize: 11, color: t.text3, background: `${t.blue}06`, borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}` }}>
        <strong style={{ color: t.text1, fontSize: 11.5 }}>Outside-Bangalore In Transit</strong> · arriving on {fmtDateShort(supply.arrival_date)} · {fmt(supply.in_transit?.total?.net_wt || 0, 2)} g · {supply.in_transit?.total?.bills || 0} bills
      </div>
      {inT.length > 0 ? renderBranchTable(inT, t.blue, true) : <div style={{ padding: '20px', fontSize: 11, color: t.text4, textAlign: 'center' }}>No outstation bills are scheduled to arrive on this date.</div>}
    </div>
  )
}

// ── Booking modal ────────────────────────────────────────────────────────────
function BookingModal({ t, arrivalDate, incomingNetWt, bookedQty, onSubmit, onClose }) {
  const [party,       setParty]       = useState('')
  const [buyerPhone,  setBuyerPhone]  = useState('')
  const [weight,      setWeight]      = useState('')
  const [rate,        setRate]        = useState('')
  const [purity,      setPurity]      = useState('')
  const [isKl,        setIsKl]        = useState(false)
  const [notes,       setNotes]       = useState('')
  const [busy,        setBusy]        = useState(false)

  const w = Number(weight); const r = Number(rate)
  const total = Number.isFinite(w) && Number.isFinite(r) ? w * r : 0
  const remaining = incomingNetWt - bookedQty
  const wouldOverbook = Number.isFinite(w) && w > 0 && w > remaining

  const submit = async () => {
    if (!party.trim()) return
    if (!Number.isFinite(w) || w <= 0) return
    if (!Number.isFinite(r) || r <= 0) return
    setBusy(true)
    const ok = await onSubmit({
      party:       party.trim(),
      buyer_phone: buyerPhone.trim() || null,
      weight:      w,
      rate:        r,
      purity:      purity || null,
      is_kl:       isKl,
      notes:       notes.trim() || null,
    })
    if (!ok) setBusy(false)
  }

  const valid = party.trim() && Number.isFinite(w) && w > 0 && Number.isFinite(r) && r > 0

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 14, padding: 22,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text1 }}>New Booking</div>
          <div style={{ fontSize: 11, color: t.text4, marginTop: 4 }}>Committing against arrival on {fmtDate(arrivalDate)}</div>
        </div>

        <Field label="Buyer name *">
          <input value={party} onChange={e => setParty(e.target.value)} autoFocus placeholder="e.g. ABC Jewellers"
            style={inputStyle(t)} />
        </Field>
        <Field label="Buyer phone (optional)">
          <input value={buyerPhone} onChange={e => setBuyerPhone(e.target.value)} placeholder="+91 …"
            style={inputStyle(t)} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Weight (g) *">
            <input value={weight} onChange={e => setWeight(e.target.value.replace(/[^\d.]/g, ''))} placeholder="100.000"
              style={{ ...inputStyle(t), fontFamily: 'monospace' }} />
          </Field>
          <Field label="Rate (₹/g) *">
            <input value={rate} onChange={e => setRate(e.target.value.replace(/[^\d.]/g, ''))} placeholder="7250.00"
              style={{ ...inputStyle(t), fontFamily: 'monospace' }} />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Purity (optional)">
            <select value={purity} onChange={e => setPurity(e.target.value)} style={inputStyle(t)}>
              <option value="">—</option>
              <option value="24K">24K</option>
              <option value="22K">22K</option>
              <option value="18K">18K</option>
            </select>
          </Field>
          <Field label="Karnataka local">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 11, color: t.text2 }}>
              <input type="checkbox" checked={isKl} onChange={e => setIsKl(e.target.checked)} />
              KL (used by CalTable allocation)
            </label>
          </Field>
        </div>

        <Field label="Notes (optional)">
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any context for accounts"
            style={inputStyle(t)} />
        </Field>

        {/* Live total */}
        <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Total value</span>
          <span style={{ fontSize: 16, color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>{total > 0 ? fmtINR(total) : '—'}</span>
        </div>

        {wouldOverbook && (
          <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: 8, padding: '8px 12px', fontSize: 11, color: t.red, fontWeight: 600 }}>
            ⚠ This booking will overbook by {fmt(w - remaining, 2)} g. Allowed, but flagged.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose}
            style={{ flex: 1, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 8, padding: '9px 14px', fontSize: 12, color: t.text2, cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={submit} disabled={!valid || busy}
            style={{ flex: 1, background: valid && !busy ? t.gold : t.card2, color: valid && !busy ? '#1a0a00' : t.text4, border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: valid && !busy ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Creating…' : 'Create Booking'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CancelModal({ t, booking, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420,
        background: t.card, border: `1px solid ${t.red}55`,
        borderRadius: 14, padding: 22,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.red }}>Cancel booking?</div>
          <div style={{ fontSize: 11.5, color: t.text2, marginTop: 6 }}>
            <strong>{booking.party}</strong> · {fmt(booking.weight, 2)} g · ₹{fmtNum(Math.round(booking.rate))}/g
          </div>
        </div>
        <Field label="Reason (optional)">
          <input value={reason} onChange={e => setReason(e.target.value)} autoFocus placeholder="Why is this being cancelled?"
            style={inputStyle(t)} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 8, padding: '9px 14px', fontSize: 12, color: t.text2, cursor: 'pointer', fontWeight: 600 }}>Keep</button>
          <button onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false) }} disabled={busy}
            style={{ flex: 1, background: t.red, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Cancelling…' : 'Cancel booking'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,.4)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  )
}

function inputStyle(t) {
  return {
    width: '100%', boxSizing: 'border-box',
    background: t.card2 || t.card, border: `1px solid ${t.border}`,
    borderRadius: 7, padding: '9px 12px',
    fontSize: 12.5, color: t.text1, outline: 'none',
  }
}
