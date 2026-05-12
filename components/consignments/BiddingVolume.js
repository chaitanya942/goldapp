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
  const [showBookModal, setShowBookModal] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [toast,        setToast]        = useState(null)
  // Source selection — branches the ops team has ticked from the inline
  // picker. Keys are `B:<branch_name>` for Bangalore, `T:<branch_name>` for
  // outside in-transit. Lifted to the parent so the contextual CTA, the
  // KPI summary, and the modal all share the same selection.
  const [selected,     setSelected]     = useState(() => new Set())
  // Reset selection when the arrival date changes — selections are date-
  // specific (a YELAHANKA shipment for 13 May isn't the same as 14 May's).
  useEffect(() => { setSelected(new Set()) }, [arrivalDate])

  // Gain rate — projected refining gain in % per gram of available net wt.
  // Default 3.5% (≈ 35 g per 1 kg available). One-level flat rate per the
  // ops spec. Persisted to localStorage so the operator's override sticks
  // across sessions; per-device for v1. (TODO: move to company_settings
  // when the ops team needs to share the rate across users.)
  const [gainRatePct, setGainRatePct] = useState(() => {
    if (typeof window === 'undefined') return 3.5
    const stored = window.localStorage.getItem('bidding.gainRatePct')
    const n = stored != null ? Number(stored) : NaN
    return Number.isFinite(n) && n >= 0 ? n : 3.5
  })
  const [editingGain, setEditingGain] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('bidding.gainRatePct', String(gainRatePct))
  }, [gainRatePct])

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
  // Pool composition (revised per ops spec):
  //   gain          = incoming * gain_rate / 100   (refining margin estimate)
  //   available     = incoming + gain              (total grams sellable)
  //   booked        = sum(active bookings)         (cancelled excluded)
  //   remaining     = available - booked           (still bookable)
  // When remaining < 0, ops has overbooked; UI flags it but lets the booking
  // through (operator may have committed against shipments not yet visible).
  const incomingNetWt   = supply?.grand_total?.net_wt    || 0
  const incomingGrossWt = supply?.grand_total?.gross_wt  || 0
  const incomingBills   = supply?.grand_total?.bills     || 0

  const bookings        = bookingsResp?.bookings || []
  const activeBookings  = useMemo(() => bookings.filter(b => b.status !== 'cancelled'), [bookings])
  const bookedQty       = bookingsResp?.active_qty_grams || 0
  const bookedValue     = bookingsResp?.active_value     || 0

  const gainGrams       = incomingNetWt * (gainRatePct / 100)
  const availablePool   = incomingNetWt + gainGrams
  const remainingQty    = availablePool - bookedQty
  const overbooked      = remainingQty < 0
  const bookedPct       = availablePool > 0 ? Math.min(100, (bookedQty / availablePool) * 100) : 0

  // Source picker helpers — shared between the inline picker and the modal.
  const bangBranches = supply?.bangalore?.branches  || []
  const inTBranches  = supply?.in_transit?.branches || []
  const branchesByKey = useMemo(() => {
    const m = {}
    for (const b of bangBranches) m[`B:${b.branch_name}`] = { ...b, group: 'bangalore' }
    for (const b of inTBranches)  m[`T:${b.branch_name}`] = { ...b, group: 'in_transit' }
    return m
  }, [bangBranches, inTBranches])
  const selectedTotal = useMemo(() => {
    let s = 0
    for (const k of selected) s += Number(branchesByKey[k]?.total_net_wt || 0)
    return s
  }, [selected, branchesByKey])
  const toggleBranch = (k) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })
  const selectGroupAll = (rows, prefix, allOn) => setSelected(prev => {
    const next = new Set(prev)
    for (const b of rows) {
      const k = `${prefix}:${b.branch_name}`
      if (allOn) next.delete(k); else next.add(k)
    }
    return next
  })

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
          {/* Top-right "+ New Booking" CTA removed — booking flow is now
              source-pick first. The Book CTA surfaces inside the Incoming
              Sources card as soon as any branch is checked. */}
          <button onClick={() => fetchAll()} disabled={loading}
            style={{ background: loading ? t.card2 : 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: loading ? t.text4 : t.text2, cursor: loading ? 'default' : 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
            Refresh
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

      {/* ── KPI strip — Incoming + Gain = Available; Available − Booked = Remaining
          Order reads left-to-right as the equation. The two operator-input
          tiles (Gain rate override, Booked from the bookings list) sit
          between the two computed totals. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: '10px' }}>
        <KpiCard
          label="Incoming"
          value={`${fmt(incomingNetWt, 2)} g`}
          sub={`${incomingBills} bill${incomingBills === 1 ? '' : 's'} · gross ${fmt(incomingGrossWt, 2)} g`}
          accent={t.gold} card={card} t={t} />

        <GainCard
          t={t} card={card}
          basisGrams={incomingNetWt}
          gainGrams={gainGrams}
          ratePct={gainRatePct}
          editing={editingGain}
          onStartEdit={() => setEditingGain(true)}
          onSave={(v) => { setGainRatePct(v); setEditingGain(false) }}
          onCancel={() => setEditingGain(false)} />

        <KpiCard
          label="Available"
          value={`${fmt(availablePool, 2)} g`}
          sub={`Incoming + Gain · pool for tomorrow's bid`}
          accent={t.text1 || t.gold} card={card} t={t}
          big />

        <KpiCard
          label="Booked"
          value={`${fmt(bookedQty, 2)} g`}
          sub={`${activeBookings.length} booking${activeBookings.length === 1 ? '' : 's'} · ${fmtINR(bookedValue)}`}
          accent={t.blue} card={card} t={t} />

        <KpiCard
          label={overbooked ? 'Overbooked' : 'Remaining'}
          value={`${overbooked ? '−' : ''}${fmt(Math.abs(remainingQty), 2)} g`}
          sub={overbooked
            ? `${fmt(Math.abs(remainingQty), 2)} g past available pool`
            : `${availablePool > 0 ? Math.round(100 - bookedPct) : 0}% of available free`}
          accent={overbooked ? t.red : t.green} card={card} t={t}
          pulse={overbooked} />
      </div>

      {overbooked && (
        <div style={{ ...card, padding: '10px 16px', borderColor: `${t.red}55`, background: `${t.red}10`, fontSize: '12px', color: t.red, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          Bookings exceed expected incoming by <strong>{fmt(Math.abs(availableQty), 2)} g</strong>. Consider deferring some or sourcing additional supply.
        </div>
      )}

      {/* ── Incoming Sources — primary interactive surface.
          Always expanded. Each branch is a checkbox row; checking a
          branch adds its net weight to the running total in the
          header's contextual action bar. Clicking "Book Selected →"
          opens the booking modal with the weight pre-filled. */}
      <SourcePicker
        t={t} card={card}
        supply={supply}
        bangBranches={bangBranches}
        inTBranches={inTBranches}
        selected={selected}
        selectedTotal={selectedTotal}
        onToggleBranch={toggleBranch}
        onSelectGroup={selectGroupAll}
        onBook={() => setShowBookModal(true)}
        incomingNetWt={incomingNetWt}
        incomingBills={incomingBills}
        arrivalDate={arrivalDate}
      />

      {/* ── Bookings list — what's already committed ── */}
      <BookingsList
        t={t} card={card}
        bookings={bookings}
        onUpdateStatus={updateStatus}
        onRequestCancel={(b) => setCancelTarget(b)}
        onCreate={() => setShowBookModal(true)}
      />

      <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
        Bookings stored in <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>cal_quotas</code> — also visible in Sales → Cal Table → Quotas on the same date.
      </div>

      {/* ── Booking form modal — fired from "Book Selected" on the sources
            card. Source picker is no longer inside the modal; the modal
            just shows a read-only chip strip of selected branches plus
            the buyer-details form. */}
      {showBookModal && (
        <BookingModal
          t={t}
          arrivalDate={arrivalDate}
          availablePool={availablePool}
          remainingQty={remainingQty}
          selected={selected}
          selectedTotal={selectedTotal}
          branchesByKey={branchesByKey}
          onUnselect={(k) => toggleBranch(k)}
          onSubmit={createBooking}
          onClose={() => setShowBookModal(false)}
          onSuccess={() => setSelected(new Set())}
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
function KpiCard({ label, value, sub, accent, card, t, pulse = false, big = false }) {
  return (
    <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${accent}`, position: 'relative' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: big ? '28px' : '24px', fontWeight: big ? 300 : 200, color: accent, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.01em', animation: pulse ? 'pulse 1.4s infinite' : 'none' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ── Gain Card — projected refining margin on the incoming pool ───────────────
// Inline-editable rate; default 3.5% ≈ 35g per kg. Click the rate pill to
// edit; Enter saves, Escape cancels. Per-spec a "one-level" flat rate so
// no tiered logic here. Basis = INCOMING (not available) — gain is what
// we expect to recover *on top of* what's coming in, so it adds to the
// sellable pool rather than scaling with what's left to book.
function GainCard({ t, card, basisGrams, gainGrams, ratePct, editing, onStartEdit, onSave, onCancel }) {
  const [draft, setDraft] = useState(ratePct)
  useEffect(() => { if (editing) setDraft(ratePct) }, [editing, ratePct])
  const accent = t.orange || '#e58a3b'
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 0 && n <= 100) onSave(n)
    else onCancel()
  }
  return (
    <div style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${accent}`, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Gain (est.)</span>
        {editing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number" step="0.1" min="0" max="100"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
              onBlur={commit}
              autoFocus
              style={{
                width: 56,
                background: t.card2 || t.card,
                border: `1px solid ${accent}`,
                borderRadius: 5,
                padding: '2px 6px',
                fontSize: 11,
                color: accent,
                fontFamily: 'monospace',
                fontWeight: 700,
                outline: 'none',
                textAlign: 'right',
              }} />
            <span style={{ fontSize: 10, color: accent, fontWeight: 700 }}>%</span>
          </span>
        ) : (
          <button onClick={onStartEdit}
            title="Click to override the gain rate"
            style={{
              background: `${accent}15`,
              border: `1px solid ${accent}40`,
              color: accent,
              borderRadius: 99,
              padding: '2px 9px',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'monospace',
              cursor: 'pointer',
              letterSpacing: '.04em',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${accent}25` }}
            onMouseLeave={e => { e.currentTarget.style.background = `${accent}15` }}>
            {ratePct.toFixed(2)}% ✎
          </button>
        )}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 200, color: accent, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.01em' }}>
        {fmt(gainGrams, 2)}<span style={{ fontSize: 13, color: t.text3, marginLeft: 4 }}>g</span>
      </div>
      <div style={{ fontSize: '10px', color: t.text4, marginTop: 6 }}>
        on {fmt(basisGrams, 2)} g incoming · {Math.round(ratePct * 10)}g per kg
      </div>
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

// ── Source Picker — primary interactive surface on the page ──────────────────
// Inline (not modal) — every branch is a row with a checkbox; the page-level
// selection state lights up the contextual action bar in the card header
// once anything is checked. Clicking "Book Selected" opens the booking
// form modal with the weight pre-filled from the selection total.
function SourcePicker({ t, card, supply, bangBranches, inTBranches, selected, selectedTotal, onToggleBranch, onSelectGroup, onBook, incomingNetWt, incomingBills, arrivalDate }) {
  const hasSelection = selected.size > 0

  const bangAllSelected = bangBranches.length > 0 && bangBranches.every(b => selected.has(`B:${b.branch_name}`))
  const inTAllSelected  = inTBranches.length  > 0 && inTBranches.every(b => selected.has(`T:${b.branch_name}`))

  const renderBranchRow = (b, prefix, accent) => {
    const k = `${prefix}:${b.branch_name}`
    const on = selected.has(k)
    return (
      <div key={b.branch_name} onClick={() => onToggleBranch(k)}
        style={{
          display: 'grid',
          gridTemplateColumns: '28px minmax(140px, 1fr) 1fr auto 90px',
          gap: 12,
          alignItems: 'center',
          padding: '10px 18px',
          borderBottom: `1px solid ${t.border}30`,
          cursor: 'pointer',
          background: on ? `${accent}10` : 'transparent',
          borderLeft: `3px solid ${on ? accent : 'transparent'}`,
          transition: 'background .12s',
        }}
        onMouseEnter={e => { if (!on) e.currentTarget.style.background = `${t.text4}06` }}
        onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>
        <input type="checkbox" checked={on} onChange={() => onToggleBranch(k)} onClick={e => e.stopPropagation()}
          style={{ accentColor: accent, cursor: 'pointer', width: 16, height: 16 }} />
        <span style={{ fontSize: 12.5, color: t.text1, fontWeight: 600 }}>{b.branch_name}</span>
        <span style={{ fontSize: 11, color: REGION_COLORS[b.region] || t.text3 }}>{b.region}</span>
        {b.tat_hours != null ? (
          <span style={{ fontSize: 10, color: t.text2, background: `${t.text4}15`, borderRadius: 4, padding: '2px 7px', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {b.tat_hours}h
          </span>
        ) : <span />}
        <span style={{ fontSize: 12.5, color: t.gold, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>
          {fmt(b.total_net_wt, 2)}<span style={{ fontSize: 10, marginLeft: 2, color: t.text4 }}>g</span>
        </span>
      </div>
    )
  }

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      {/* Header — always shows pool totals; flips to selection summary + CTA
          once anything is checked. */}
      <div style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${t.border}`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: hasSelection ? `linear-gradient(90deg, ${t.gold}10 0%, transparent 70%)` : 'transparent',
        transition: 'background .2s',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text1 }}>Incoming Sources</div>
          <div style={{ fontSize: 11, color: t.text4, marginTop: 2 }}>
            Bangalore today + outside in-transit · {fmt(incomingNetWt, 2)} g · {incomingBills} bill{incomingBills === 1 ? '' : 's'}
          </div>
        </div>
        {hasSelection ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13.5, color: t.gold, fontFamily: 'monospace', fontWeight: 700 }}>
                {fmt(selectedTotal, 2)} g
              </div>
              <div style={{ fontSize: 10, color: t.text4, marginTop: 1 }}>
                {selected.size} branch{selected.size === 1 ? '' : 'es'} selected
              </div>
            </div>
            <button onClick={onBook}
              style={{
                background: t.gold, color: '#1a0a00', border: 'none',
                borderRadius: 8, padding: '9px 18px',
                fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em',
                cursor: 'pointer', boxShadow: `0 1px 4px ${t.gold}50`,
                whiteSpace: 'nowrap',
              }}>
              Book Selected →
            </button>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: t.text4, fontStyle: 'italic' }}>
            Tick branches to start a booking
          </span>
        )}
      </div>

      {/* Bangalore group */}
      {bangBranches.length > 0 && (
        <div>
          <div onClick={() => onSelectGroup(bangBranches, 'B', bangAllSelected)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: `${t.red}08`, borderBottom: `1px solid ${t.border}`, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={bangAllSelected}
              onChange={() => onSelectGroup(bangBranches, 'B', bangAllSelected)}
              onClick={e => e.stopPropagation()}
              style={{ accentColor: t.red, cursor: 'pointer', width: 16, height: 16 }} />
            <span style={{ fontSize: 11, color: t.text2, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Bangalore</span>
            <span style={{ fontSize: 10, color: t.text4, fontFamily: 'monospace' }}>
              {bangBranches.length} {bangBranches.length === 1 ? 'branch' : 'branches'} · purchase {fmtDateShort(supply?.bangalore_purchase_date || '')}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: t.red, fontFamily: 'monospace', fontWeight: 700 }}>
              {fmt(supply?.bangalore?.total?.net_wt || 0, 2)}<span style={{ fontSize: 9, marginLeft: 2 }}>g</span>
            </span>
          </div>
          {bangBranches.map(b => renderBranchRow(b, 'B', t.red))}
        </div>
      )}

      {/* Outside in-transit group */}
      {inTBranches.length > 0 && (
        <div>
          <div onClick={() => onSelectGroup(inTBranches, 'T', inTAllSelected)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: `${t.blue}08`, borderTop: bangBranches.length > 0 ? `1px solid ${t.border}` : 'none', borderBottom: `1px solid ${t.border}`, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={inTAllSelected}
              onChange={() => onSelectGroup(inTBranches, 'T', inTAllSelected)}
              onClick={e => e.stopPropagation()}
              style={{ accentColor: t.blue, cursor: 'pointer', width: 16, height: 16 }} />
            <span style={{ fontSize: 11, color: t.text2, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Outside In-Transit</span>
            <span style={{ fontSize: 10, color: t.text4, fontFamily: 'monospace' }}>
              {inTBranches.length} {inTBranches.length === 1 ? 'branch' : 'branches'} · arriving {fmtDateShort(supply?.arrival_date || arrivalDate)}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>
              {fmt(supply?.in_transit?.total?.net_wt || 0, 2)}<span style={{ fontSize: 9, marginLeft: 2 }}>g</span>
            </span>
          </div>
          {inTBranches.map(b => renderBranchRow(b, 'T', t.blue))}
        </div>
      )}

      {bangBranches.length === 0 && inTBranches.length === 0 && (
        <div style={{ padding: '32px 18px', textAlign: 'center', color: t.text4, fontSize: 12 }}>
          No incoming sources for this date.
        </div>
      )}
    </div>
  )
}

// ── Booking modal — buyer-form-only ──────────────────────────────────────────
// Source selection happens on the page now; this modal just confirms the
// already-selected branches (as removable chips) and collects buyer + rate
// + notes. Weight pre-fills from the selection total and is editable for
// partial commits.
function BookingModal({ t, arrivalDate, availablePool, remainingQty, selected, selectedTotal, branchesByKey, onUnselect, onSubmit, onClose, onSuccess }) {
  const [weightDirty, setWeightDirty] = useState(false)
  const [party,       setParty]       = useState('')
  const [buyerPhone,  setBuyerPhone]  = useState('')
  const [weight,      setWeight]      = useState(() => selectedTotal > 0 ? selectedTotal.toFixed(2) : '')
  const [rate,        setRate]        = useState('')
  const [purity,      setPurity]      = useState('')
  const [isKl,        setIsKl]        = useState(false)
  const [notes,       setNotes]       = useState('')
  const [busy,        setBusy]        = useState(false)

  // Selection can change while the modal is open (operator removes a chip).
  // Keep the weight in sync unless they've manually edited it.
  useEffect(() => {
    if (weightDirty) return
    setWeight(selectedTotal > 0 ? selectedTotal.toFixed(2) : '')
  }, [selectedTotal, weightDirty])

  const selectedRows = [...selected].map(k => ({ k, b: branchesByKey[k] })).filter(x => x.b)

  const w = Number(weight); const r = Number(rate)
  const total = Number.isFinite(w) && Number.isFinite(r) ? w * r : 0
  const wouldOverbook = Number.isFinite(w) && w > 0 && w > remainingQty

  const submit = async () => {
    if (!party.trim()) return
    if (!Number.isFinite(w) || w <= 0) return
    if (!Number.isFinite(r) || r <= 0) return
    setBusy(true)
    // Stamp the selected branch names into notes so the audit trail records
    // which sources the booking was committed against. (When partial-bill
    // selection becomes a feature we'll add a proper booking_sources join.)
    const selectedBranchList = selectedRows.map(({ b }) => b.branch_name)
    const compositeNotes = [
      notes.trim() || null,
      selectedBranchList.length ? `Sources: ${selectedBranchList.join(', ')}` : null,
    ].filter(Boolean).join(' · ') || null

    const ok = await onSubmit({
      party:       party.trim(),
      buyer_phone: buyerPhone.trim() || null,
      weight:      w,
      rate:        r,
      purity:      purity || null,
      is_kl:       isKl,
      notes:       compositeNotes,
    })
    if (ok && onSuccess) onSuccess()
    if (!ok) setBusy(false)
  }

  const valid = party.trim() && Number.isFinite(w) && w > 0 && Number.isFinite(r) && r > 0

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, overflow: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, maxHeight: '90vh', overflow: 'auto',
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 14, padding: 22,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text1 }}>New Booking</div>
          <div style={{ fontSize: 11, color: t.text4, marginTop: 4 }}>Committing against arrival on {fmtDate(arrivalDate)}</div>
        </div>

        {/* Selected sources — chips strip. Click ✕ to remove a chip; the
            selection on the page updates in real time. */}
        {selectedRows.length > 0 ? (
          <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 12px', background: t.card2 }}>
            <div style={{ fontSize: 10, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
              Selected sources · {fmt(selectedTotal, 2)} g
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {selectedRows.map(({ k, b }) => {
                const accent = b.group === 'bangalore' ? t.red : t.blue
                return (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${accent}15`, border: `1px solid ${accent}40`, borderRadius: 99, padding: '3px 6px 3px 10px', fontSize: 11, color: t.text1, fontWeight: 600 }}>
                    {b.branch_name}
                    <span style={{ fontSize: 10, color: t.gold, fontFamily: 'monospace', fontWeight: 700 }}>{fmt(b.total_net_wt, 2)}g</span>
                    <button onClick={() => onUnselect(k)} title="Remove from selection"
                      style={{ background: 'transparent', border: 'none', color: t.text3, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 4px' }}>
                      ✕
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: t.text4, fontStyle: 'italic', padding: '6px 0' }}>
            No sources selected — booking will commit the entered weight directly against the pool.
          </div>
        )}

        {/* Buyer + commercial */}
        <Field label="Buyer name *">
          <input value={party} onChange={e => setParty(e.target.value)} autoFocus placeholder="e.g. ABC Jewellers"
            style={inputStyle(t)} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Buyer phone (optional)">
            <input value={buyerPhone} onChange={e => setBuyerPhone(e.target.value)} placeholder="+91 …"
              style={inputStyle(t)} />
          </Field>
          <Field label="Purity (optional)">
            <select value={purity} onChange={e => setPurity(e.target.value)} style={inputStyle(t)}>
              <option value="">—</option>
              <option value="24K">24K</option>
              <option value="22K">22K</option>
              <option value="18K">18K</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={`Weight (g) *${selectedTotal > 0 && !weightDirty ? ' · auto-filled' : ''}`}>
            <input value={weight}
              onChange={e => { setWeight(e.target.value.replace(/[^\d.]/g, '')); setWeightDirty(true) }}
              placeholder="100.000"
              style={{ ...inputStyle(t), fontFamily: 'monospace', borderColor: weightDirty || selectedTotal === 0 ? t.border : t.gold }} />
            {weightDirty && selectedTotal > 0 && (
              <button type="button" onClick={() => { setWeightDirty(false); setWeight(selectedTotal.toFixed(2)) }}
                style={{ background: 'transparent', border: 'none', color: t.gold, fontSize: 10, cursor: 'pointer', padding: '4px 0 0', textAlign: 'left' }}>
                ↺ Reset to selected total ({fmt(selectedTotal, 2)} g)
              </button>
            )}
          </Field>
          <Field label="Rate (₹/g) *">
            <input value={rate} onChange={e => setRate(e.target.value.replace(/[^\d.]/g, ''))} placeholder="7250.00"
              style={{ ...inputStyle(t), fontFamily: 'monospace' }} />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any context for accounts"
            style={inputStyle(t)} />
        </Field>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: t.text2 }}>
          <input type="checkbox" checked={isKl} onChange={e => setIsKl(e.target.checked)} />
          Karnataka local (KL) — used by CalTable allocation
        </label>

        {/* Live total */}
        <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Total value</span>
          <span style={{ fontSize: 16, color: t.blue, fontFamily: 'monospace', fontWeight: 700 }}>{total > 0 ? fmtINR(total) : '—'}</span>
        </div>

        {wouldOverbook && (
          <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: 8, padding: '8px 12px', fontSize: 11, color: t.red, fontWeight: 600 }}>
            ⚠ This booking will overbook by {fmt(w - remainingQty, 2)} g (available pool {fmt(availablePool, 2)} g). Allowed, but flagged.
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
