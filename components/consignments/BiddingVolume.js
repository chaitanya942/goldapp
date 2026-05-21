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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import AnimatedNumber from '../ui/AnimatedNumber'
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

  // Past bidder names — drives the dropdown in the booking modal. Pulled
  // once on mount; the list refreshes after a new booking via fetchAll's
  // side-effects (since new parties land in cal_quotas).
  const [bidders, setBidders] = useState([])
  useEffect(() => {
    let cancelled = false
    authedFetch('/api/consignments?action=bidder_names').then(r => r.json()).then(j => {
      if (!cancelled && Array.isArray(j.data)) setBidders(j.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [bookingsResp])

  // Gain — projected refining recovery on incoming net weight. Two-mode:
  //   - Default: percent rate (3.5%) baked into the company; gain in grams
  //     computed from incoming on each render.
  //   - Override: operator sets an absolute grams value for the day (e.g.
  //     "I'm expecting 80g of gain regardless"). Stored separately so
  //     swapping the date doesn't drag the override along blindly — when
  //     gainOverrideGrams is null, we fall back to the percent rate.
  // Both persist to localStorage so reload keeps the operator's last choice.
  // (TODO: move to company_settings for team-wide shared state.)
  const [gainRatePct, setGainRatePct] = useState(() => {
    if (typeof window === 'undefined') return 3.5
    const stored = window.localStorage.getItem('bidding.gainRatePct')
    const n = stored != null ? Number(stored) : NaN
    return Number.isFinite(n) && n >= 0 ? n : 3.5
  })
  const [gainOverrideGrams, setGainOverrideGrams] = useState(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem('bidding.gainOverrideGrams')
    const n = stored != null && stored !== '' ? Number(stored) : NaN
    return Number.isFinite(n) && n >= 0 ? n : null
  })
  const [editingGain, setEditingGain] = useState(false)

  // Pending Delivery — shared, server-side carry-over for the arrival date
  // (NOT localStorage like Gain — the whole ops team books against one
  // number). Value lives in supply.pending.grams; editing is local UI state;
  // saving POSTs and refetches so every device converges.
  const [editingPending,  setEditingPending]  = useState(false)
  const [savingPending,   setSavingPending]   = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('bidding.gainRatePct', String(gainRatePct))
  }, [gainRatePct])
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (gainOverrideGrams == null) window.localStorage.removeItem('bidding.gainOverrideGrams')
    else window.localStorage.setItem('bidding.gainOverrideGrams', String(gainOverrideGrams))
  }, [gainOverrideGrams])

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

  // Persist Pending Delivery for this arrival date, then refetch so the
  // recomputed pool (and every other device on next poll) reflects it.
  const savePending = useCallback(async (gramsRaw) => {
    // Coerce at the boundary — callers pass numbers today, but a bad value
    // must fail loud, not send NaN to the API or throw on .toFixed.
    const grams = Number(gramsRaw)
    if (!Number.isFinite(grams)) {
      setToast({ msg: 'Pending Delivery must be a number', type: 'error', key: Date.now() })
      setTimeout(() => setToast(null), 3500)
      return
    }
    setSavingPending(true)
    try {
      const res = await authedFetch('/api/consignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_bidding_pending', date: arrivalDate, pending_grams: grams }),
      })
      const j = await res.json()
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`)
      setEditingPending(false)
      await fetchAll(true)               // silent refetch — keep numbers on screen
      setToast({ msg: `Pending Delivery set to ${grams >= 0 ? '+' : ''}${grams.toFixed(2)} g`, type: 'success', key: Date.now() })
      setTimeout(() => setToast(null), 3500)
    } catch (e) {
      setToast({ msg: `Couldn't save Pending Delivery: ${String(e?.message || e)}`, type: 'error', key: Date.now() })
      setTimeout(() => setToast(null), 3500)
    } finally {
      setSavingPending(false)
    }
  }, [arrivalDate, fetchAll])

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

  // Gain in grams — operator override wins if set, otherwise the default
  // percentage. Effective rate (used for per-branch booking weight scaling)
  // is just gain / incoming when incoming > 0.
  const gainGrams       = gainOverrideGrams != null
    ? gainOverrideGrams
    : incomingNetWt * (gainRatePct / 100)
  const gainOverridden  = gainOverrideGrams != null
  const effectiveGainRate = incomingNetWt > 0 ? gainGrams / incomingNetWt : 0

  // Pending Delivery — signed carry-over from supply (server-side, shared).
  // Folded into the pool: Available = Incoming + Gain ± Pending.
  const pendingGrams    = supply?.pending?.grams || 0
  const pendingSetBy    = supply?.pending?.updated_by || null

  const availablePool   = incomingNetWt + gainGrams + pendingGrams
  const remainingQty    = availablePool - bookedQty
  const bookedPct       = availablePool > 0 ? Math.min(100, (bookedQty / availablePool) * 100) : 0

  // Two distinct deficit states — they were conflated before, which made a
  // −Pending with zero bookings wrongly read as "Bookings exceed pool":
  //   poolNegative — the pool itself is underwater because the Pending
  //                  pull-back exceeds Incoming + Gain. Independent of
  //                  bookings; there's simply nothing to bid.
  //   overbooked   — the pool is non-negative but commitments exceed it
  //                  (genuine overbooking). Only meaningful when something
  //                  is actually booked.
  const poolNegative    = availablePool < 0
  const overbooked      = !poolNegative && bookedQty > 0 && remainingQty < 0

  // Single source for the last tile + the alert banner so they never
  // disagree.
  const poolState = poolNegative
    ? {
        label:  'Pool Deficit',
        num:    Math.abs(availablePool), prefix: '−',
        sub:    'Pending pull-back exceeds Incoming + Gain',
        accent: t.red, alert: true,
      }
    : overbooked
    ? {
        label:  'Overbooked',
        num:    Math.abs(remainingQty), prefix: '−',
        sub:    `${fmt(Math.abs(remainingQty), 2)} g past available pool`,
        accent: t.red, alert: true,
      }
    : {
        label:  'Remaining',
        num:    remainingQty, prefix: '',
        sub:    `${availablePool > 0 ? Math.round(100 - bookedPct) : 0}% of available free`,
        accent: t.green, alert: false,
      }

  // Source picker helpers — shared between the inline picker and the modal.
  // Four sections feed the bid:
  //   1. Bangalore Today           (B: prefix)  selectable
  //   2. In-Transit 24h TAT        (T: prefix)  selectable — arrives tomorrow
  //   3. In-Transit 48h TAT                     view-only  — arrives day after
  //   4. Branch Stock pre-EOD      (P: prefix)  selectable — moves today
  const bangBranches   = supply?.bangalore?.branches      || []
  const inTBranches    = supply?.transit_24h?.branches    || supply?.in_transit?.branches || []
  const t48hBranches   = supply?.transit_48h?.branches    || []
  const preEodBranches = supply?.branch_pre_eod?.branches || []
  const dayAfterArrivalDate = supply?.day_after_arrival   || null
  const branchesByKey = useMemo(() => {
    const m = {}
    for (const b of bangBranches)   m[`B:${b.branch_name}`] = { ...b, group: 'bangalore' }
    for (const b of inTBranches)    m[`T:${b.branch_name}`] = { ...b, group: 'transit_24h' }
    for (const b of preEodBranches) m[`P:${b.branch_name}`] = { ...b, group: 'branch_pre_eod' }
    return m
  }, [bangBranches, inTBranches, preEodBranches])
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

  // Kerala (KL) no-mix rule — Kerala bookings must be exclusive. The mode is
  // 'kerala' if any selected branch is Kerala, 'other' if any non-Kerala
  // branch is selected, or null when nothing is picked. Branches outside
  // the current mode are disabled in the source picker to prevent
  // accidental mixed selection.
  const isKerala = (b) => b?.region === 'Kerala'
  const selectionMode = useMemo(() => {
    let hasKerala = false, hasOther = false
    for (const k of selected) {
      const b = branchesByKey[k]
      if (!b) continue
      if (isKerala(b)) hasKerala = true
      else             hasOther  = true
    }
    if (hasKerala && hasOther) return 'mixed' // shouldn't happen — picker prevents it
    if (hasKerala) return 'kerala'
    if (hasOther)  return 'other'
    return null
  }, [selected, branchesByKey])
  // A branch is locked when the current selection mode disallows it.
  const branchLocked = (b) => {
    if (!selectionMode) return false
    if (selectionMode === 'kerala') return !isKerala(b)
    if (selectionMode === 'other')  return  isKerala(b)
    return false
  }
  // Auto-derived KL flag for the booking insert. CalTable's allocation
  // reads is_kl to keep Kerala buyers paired with Kerala bars.
  const selectionIsKerala = selectionMode === 'kerala'

  // ── Date label ─────────────────────────────────────────────────────────────
  const dayDiff = dateDiff(arrivalDate, today)
  const dayLabel = dayDiff === 0 ? 'today'
    : dayDiff === 1 ? 'tomorrow'
    : dayDiff === -1 ? 'yesterday'
    : dayDiff > 0 ? `in ${dayDiff} days`
    : `${Math.abs(dayDiff)} days ago`

  // "Today's bid = tomorrow's HO arrival." The bidding SESSION for an
  // arrival date D is run on D−1, so the headline pill is keyed to the
  // bidding day, not the arrival day. Presentation only — the arrival-date
  // machinery (and every number) is unchanged.
  const bidDiff = dayDiff - 1
  const bidLabel = bidDiff === 0 ? "Today's Bid"
    : bidDiff === 1 ? "Tomorrow's Bid"
    : bidDiff === -1 ? "Yesterday's Bid"
    : bidDiff > 0 ? `Bid +${bidDiff}d`
    : `Bid ${bidDiff}d`

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
    // Capture the selected branch names so the API can mark their eligible
    // bills with the booking id (purchases.booking_id). Sending names
    // rather than bill ids keeps the request body small; the server
    // re-derives eligibility using the same rule the bidding-volume reader
    // applies.
    const sourceBranches = [...selected].map(k => branchesByKey[k]?.branch_name).filter(Boolean)
    const r = await authedFetch('/api/consignments?action=create_booking', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, date: arrivalDate, source_branches: sourceBranches }),
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
              {bidLabel}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            {bidLabel}: today's Bangalore purchases + outstation in-transit — all expected at HO{' '}
            <strong style={{ color: t.text1 }}>{dayLabel}</strong>{' '}
            (<strong style={{ color: t.text1 }}>{fmtDate(arrivalDate)}</strong>)
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
        <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>HO Arrival</span>
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

      {/* ── KPI strip — Incoming + Gain ± Pending = Available; Available − Booked
          = Remaining. Order reads left-to-right as the equation. Operator-
          input tiles (Gain override, Pending Delivery, Booked) sit between
          the computed totals. 6 columns now. */}
      <div className="bidKpi" style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: '10px' }}>
        <KpiCard
          label="Incoming"
          value={<AnimatedNumber target={incomingNetWt} decimals={2} suffix=" g"
                   fromPrevious animateOnMount={false} replayable={false} duration={650} />}
          sub={`${incomingBills} bill${incomingBills === 1 ? '' : 's'} · gross ${fmt(incomingGrossWt, 2)} g`}
          accent={t.gold} card={card} t={t} variant="source" />

        <GainCard
          op="+"
          t={t} card={card}
          basisGrams={incomingNetWt}
          gainGrams={gainGrams}
          ratePct={gainRatePct}
          overridden={gainOverridden}
          editing={editingGain}
          onStartEdit={() => setEditingGain(true)}
          onSave={(v) => { setGainOverrideGrams(v); setEditingGain(false) }}
          onResetDefault={() => { setGainOverrideGrams(null); setEditingGain(false) }}
          onCancel={() => setEditingGain(false)} />

        <PendingCard
          op={pendingGrams > 0 ? '+' : pendingGrams < 0 ? '−' : '±'}
          t={t} card={card}
          grams={pendingGrams}
          setBy={pendingSetBy}
          editing={editingPending}
          saving={savingPending}
          onStartEdit={() => setEditingPending(true)}
          onSave={savePending}
          onClear={() => savePending(0)}
          onCancel={() => setEditingPending(false)} />

        <KpiCard
          op="="
          label="Available"
          value={<AnimatedNumber target={availablePool} decimals={2} suffix=" g"
                   fromPrevious animateOnMount={false} replayable={false} duration={650} />}
          sub={`${pendingGrams === 0
            ? 'Incoming + Gain'
            : `Incoming + Gain ${pendingGrams < 0 ? '−' : '+'} Pending`} · pool for tomorrow's bid`}
          accent={t.gold} card={card} t={t}
          variant="result" />

        <KpiCard
          op="−"
          label="Booked"
          value={<AnimatedNumber target={bookedQty} decimals={2} suffix=" g"
                   fromPrevious animateOnMount={false} replayable={false} duration={650} />}
          sub={`${activeBookings.length} booking${activeBookings.length === 1 ? '' : 's'} · ${fmtINR(bookedValue)}`}
          accent={t.blue} card={card} t={t} variant="consumed" />

        <KpiCard
          op="="
          label={poolState.label}
          value={<AnimatedNumber target={poolState.num} prefix={poolState.prefix} decimals={2} suffix=" g"
                   fromPrevious animateOnMount={false} replayable={false} duration={650} />}
          sub={poolState.sub}
          accent={poolState.accent} card={card} t={t}
          variant="state" pulse={poolState.alert} />
      </div>

      {poolNegative && (
        <div style={{ ...card, padding: '10px 16px', borderColor: `${t.red}55`, background: `${t.red}10`, fontSize: '12px', color: t.red, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          Available pool is negative — the Pending pull-back (<strong>{fmt(pendingGrams, 2)} g</strong>) exceeds Incoming + Gain by <strong>{fmt(Math.abs(availablePool), 2)} g</strong>. Nothing to bid until supply arrives or the pull-back is reduced.
        </div>
      )}

      {overbooked && (
        <div style={{ ...card, padding: '10px 16px', borderColor: `${t.red}55`, background: `${t.red}10`, fontSize: '12px', color: t.red, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          Bookings exceed available pool by <strong>{fmt(Math.abs(remainingQty), 2)} g</strong>. Consider deferring some or sourcing additional supply.
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
        selectionMode={selectionMode}
        branchLocked={branchLocked}
        onToggleBranch={toggleBranch}
        onSelectGroup={selectGroupAll}
        onBook={() => setShowBookModal(true)}
        incomingNetWt={incomingNetWt}
        incomingBills={incomingBills}
        arrivalDate={arrivalDate}
      />

      {/* ── Section 4 · Branch Stock pre-EOD ─────────────────────────────
          Bills currently at_branch at branches whose pickup is still ahead
          today, and whose TAT will land them at HO tomorrow. Selectable —
          counts toward today's bid pool. Kerala restricted to hubs (Vennala
          By-Pass + Thrissur) by the server. */}
      <SourceSection
        t={t} card={card}
        title="Branch Stock — pickup pending today"
        subtitle={`Currently at_branch · will move by EOD · arrives at HO ${fmtDate(arrivalDate)}`}
        accent={t.orange}
        branches={preEodBranches}
        total={supply?.branch_pre_eod?.total}
        prefix="P"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBranch={toggleBranch}
        onSelectGroup={selectGroupAll}
        emptyMsg="No eligible branches — every branch with stock has already done today's pickup, or the next pickup is on another day."
      />

      {/* ── Section 3 · In-Transit · 48h TAT (view only) ─────────────────
          In-transit bills arriving DAY AFTER the bid date. Shown so ops
          sees what's coming, but NOT part of tomorrow's bid pool — no
          checkboxes, dimmed. */}
      <SourceSection
        t={t} card={card}
        title="In-Transit · 48h TAT — view only"
        subtitle={dayAfterArrivalDate
          ? `Arriving at HO ${fmtDate(dayAfterArrivalDate)} — not part of today's bidding`
          : 'Arriving day after tomorrow — not part of today\'s bidding'}
        accent={t.text4}
        branches={t48hBranches}
        total={supply?.transit_48h?.total}
        selectable={false}
        emptyMsg="No 48h-TAT bills currently in transit."
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

      {/* ── Booking form modal — bidder/weight/rate only. Source selection
            is on the page; the modal displays selected branches as a
            compact chip strip and auto-derives the Kerala (KL) flag from
            the selection. */}
      {showBookModal && (
        <BookingModal
          t={t}
          arrivalDate={arrivalDate}
          availablePool={availablePool}
          remainingQty={remainingQty}
          incomingNetWt={incomingNetWt}
          gainGrams={gainGrams}
          pendingGrams={pendingGrams}
          bookedQty={bookedQty}
          selected={selected}
          selectedTotal={selectedTotal}
          branchesByKey={branchesByKey}
          bidders={bidders}
          effectiveGainRate={effectiveGainRate}
          isKerala={selectionIsKerala}
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
        <div key={toast.key} className="bidToast" style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 100,
          background: toast.type === 'error' ? t.red : toast.type === 'success' ? t.green : t.card,
          color: '#fff',
          borderRadius: 10, fontSize: 12, fontWeight: 600,
          boxShadow: '0 8px 28px rgba(0,0,0,.32)',
          overflow: 'hidden', minWidth: 180, maxWidth: 360,
          animation: 'bidToastIn .32s cubic-bezier(.34,1.12,.64,1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px' }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>
              {toast.type === 'error' ? '⚠' : toast.type === 'success' ? '✓' : '•'}
            </span>
            <span style={{ lineHeight: 1.35 }}>{toast.msg}</span>
          </div>
          <div aria-hidden className="bidToastBar" style={{
            height: 2, background: 'rgba(255,255,255,.34)',
            transformOrigin: 'left',
            animation: 'bidToastBar 3.5s linear forwards',
          }} />
        </div>
      )}

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }
        /* Source picker — staggered branch fade-in when a region expands */
        @keyframes bidRowIn       { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes bidGroupExpand { from { opacity: 0; max-height: 0 } to { opacity: 1; max-height: 9999px } }
        @keyframes bidActionIn    { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
        /* Modal entrance — soft scale + fade */
        @keyframes bidModalOverlayIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes bidModalIn        { from { opacity: 0; transform: translateY(12px) scale(.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
        /* Chip add-in */
        @keyframes bidChipIn { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: scale(1) } }
        /* Booking modal — staggered field reveal + gauge sheen */
        @keyframes bidFieldIn  { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes bidHeroIn   { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes bidSheen    { from { background-position: 200% 0 } to { background-position: -200% 0 } }
        @keyframes bidFadeIn   { from { opacity: 0 } to { opacity: 1 } }
        /* Toast — slide-up entrance + a bar that drains over its 3.5s life */
        @keyframes bidToastIn  { from { opacity: 0; transform: translateY(14px) scale(.96) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes bidToastBar { from { transform: scaleX(1) } to { transform: scaleX(0) } }
        .bidStagger > * { animation: bidFieldIn .34s cubic-bezier(.34,1.12,.64,1) backwards; }
        .bidStagger > *:nth-child(1) { animation-delay: .04s }
        .bidStagger > *:nth-child(2) { animation-delay: .09s }
        .bidStagger > *:nth-child(3) { animation-delay: .14s }
        .bidStagger > *:nth-child(4) { animation-delay: .19s }
        .bidStagger > *:nth-child(5) { animation-delay: .24s }
        .bidGauge   { transition: width .55s cubic-bezier(.34,1.1,.64,1); }
        .bidInput   { transition: border-color .18s ease, box-shadow .18s ease, background .18s ease; }
        .bidInput:focus { box-shadow: 0 0 0 3px rgba(201,168,76,.18); }
        /* KPI strip cascades in left→right like the equation reads */
        .bidKpi > * { animation: bidFieldIn .42s cubic-bezier(.34,1.12,.64,1) backwards; }
        .bidKpi > *:nth-child(1) { animation-delay: .03s }
        .bidKpi > *:nth-child(2) { animation-delay: .09s }
        .bidKpi > *:nth-child(3) { animation-delay: .15s }
        .bidKpi > *:nth-child(4) { animation-delay: .21s }
        .bidKpi > *:nth-child(5) { animation-delay: .27s }
        .bidKpi > *:nth-child(6) { animation-delay: .33s }
        @media (prefers-reduced-motion: reduce) {
          [class*="bid"], .bidStagger > *, .bidKpi > * { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
// variant differentiates the six strip tiles so they don't read as one
// repeated block — they read as the equation:
//   source  → Incoming (where it comes from)
//   result  → Available (the hero: the pool everything builds to)
//   consumed→ Booked (what's been taken)
//   state   → Remaining / Pool Deficit / Overbooked (the outcome)
// `op` is the dim equation operator shown before the label (+ ± = −).
// Hover lifts the card, brightens the border, and blooms a corner glow.
function KpiCard({ label, value, sub, accent, card, t, op, variant = 'source', pulse = false, big = false }) {
  const [hov, setHov] = useState(false)
  const isResult = variant === 'result'
  const isState  = variant === 'state'
  const lit      = isResult || (isState && pulse)         // tinted at rest
  const glow     = hov ? '28' : lit ? '14' : '00'
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative', overflow: 'hidden',
        background: lit
          ? `linear-gradient(135deg, ${accent}12, ${accent}04 60%, ${t.card})`
          : t.card,
        border: `1px solid ${hov ? `${accent}55` : t.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 12,
        padding: isResult ? '16px 18px' : '14px 18px',
        transform: hov ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hov
          ? `0 9px 24px ${accent}26`
          : isResult ? `0 1px 0 ${accent}1f inset` : 'none',
        transition: 'transform .18s cubic-bezier(.34,1.1,.64,1), box-shadow .2s ease, border-color .2s ease, background .25s ease',
      }}>
      <div aria-hidden style={{
        position: 'absolute', top: -45, right: -45, width: 130, height: 130, borderRadius: '50%',
        pointerEvents: 'none', transition: 'background .25s ease',
        background: `radial-gradient(circle, ${accent}${glow} 0%, transparent 70%)`,
      }}/>
      {isResult && (
        <div aria-hidden style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1,
          background: `linear-gradient(90deg, transparent, ${accent}66, transparent)`, pointerEvents: 'none' }}/>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {op && <span style={{ fontSize: 12, color: t.text4, fontFamily: 'monospace', fontWeight: 700, opacity: .75 }}>{op}</span>}
        <span style={{ fontSize: 9, color: t.text4, letterSpacing: '.13em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{
        position: 'relative',
        fontSize: isResult ? 30 : (big ? 28 : 23),
        fontWeight: isResult ? 300 : 200,
        color: accent, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.02em',
        animation: pulse ? 'pulse 1.4s infinite' : 'none',
      }}>{value}</div>
      {sub && <div style={{ position: 'relative', fontSize: 10, color: t.text4, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

// ── Gain Card — projected refining recovery on incoming net weight ───────────
// Click the pill to override the gain in *grams* directly (ops doesn't
// think in percentages mid-shift — they know "today I expect 80g back").
// Enter saves the override; Escape cancels. When overridden, a small
// "↺ default" link appears to revert to the percent-based estimate.
// Per-spec one-level flat rate, no tiered logic.
function GainCard({ op, t, card, basisGrams, gainGrams, ratePct, overridden, editing, onStartEdit, onSave, onResetDefault, onCancel }) {
  const [draft, setDraft] = useState('')
  const [hov, setHov] = useState(false)
  useEffect(() => { if (editing) setDraft(gainGrams ? gainGrams.toFixed(2) : '') }, [editing, gainGrams])
  const accent = t.orange || '#e58a3b'
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 0) onSave(n)
    else onCancel()
  }
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...card, padding: '14px 18px', borderLeft: `3px solid ${accent}`,
        position: 'relative', overflow: 'hidden',
        border: `1px solid ${hov ? `${accent}55` : t.border}`,
        borderLeftWidth: 3, borderLeftColor: accent,
        transform: hov ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hov ? `0 9px 24px ${accent}26` : 'none',
        transition: 'transform .18s cubic-bezier(.34,1.1,.64,1), box-shadow .2s ease, border-color .2s ease',
      }}>
      <div aria-hidden style={{
        position: 'absolute', top: -45, right: -45, width: 130, height: 130, borderRadius: '50%',
        pointerEvents: 'none', transition: 'background .25s ease',
        background: `radial-gradient(circle, ${accent}${hov ? '24' : '00'} 0%, transparent 70%)`,
      }}/>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {op && <span style={{ fontSize: 12, color: t.text4, fontFamily: 'monospace', fontWeight: 700, opacity: .75 }}>{op}</span>}
          <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Gain (est.)</span>
        </span>
        {editing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number" step="0.01" min="0"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
              onBlur={commit}
              autoFocus
              style={{
                width: 76,
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
            <span style={{ fontSize: 10, color: accent, fontWeight: 700 }}>g</span>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {overridden && (
              <button onClick={onResetDefault}
                title={`Reset to default rate (${ratePct.toFixed(2)}%)`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: t.text4,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '2px 4px',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.color = t.text4 }}>
                ↺
              </button>
            )}
            <button onClick={onStartEdit}
              title="Click to override the gain in grams"
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
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${accent}25` }}
              onMouseLeave={e => { e.currentTarget.style.background = `${accent}15` }}>
              {overridden ? 'MANUAL' : `${ratePct.toFixed(2)}%`} ✎
            </button>
          </span>
        )}
      </div>
      <div style={{ position: 'relative', fontSize: '24px', fontWeight: 200, color: accent, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.01em' }}>
        {fmt(gainGrams, 2)}<span style={{ fontSize: 13, color: t.text3, marginLeft: 4 }}>g</span>
      </div>
      <div style={{ position: 'relative', fontSize: '10px', color: t.text4, marginTop: 6 }}>
        {overridden
          ? `manual override on ${fmt(basisGrams, 2)} g incoming`
          : `on ${fmt(basisGrams, 2)} g incoming · ${Math.round(ratePct * 10)}g per kg`}
      </div>
    </div>
  )
}

// ── Pending Delivery Card — shared signed carry-over for this arrival date ────
// Gold expected for an earlier booking cycle that slipped (uncertain events)
// and now adjusts this date's pool: positive = delayed gold rolling in,
// negative = a pull-back. Unlike Gain this is server-side and shared (the
// whole ops team books against one number), so saving goes through the API
// and the value comes from supply, not localStorage. Negative values are
// allowed and shown with an explicit sign. Click the pill to edit; Enter
// saves; Escape cancels. When non-zero a small "↺" clears it back to 0.
function PendingCard({ op, t, card, grams, setBy, editing, saving, onStartEdit, onSave, onClear, onCancel }) {
  const [draft, setDraft] = useState('')
  const [hov, setHov] = useState(false)
  useEffect(() => { if (editing) setDraft(grams ? String(grams) : '') }, [editing, grams])
  // Blue-violet so it's visually distinct from Gain's orange and the gold/
  // green computed tiles.
  const accent = t.purple || '#8c5ac8'
  const nonZero = Number(grams) !== 0
  const signed  = `${grams > 0 ? '+' : grams < 0 ? '−' : ''}${fmt(Math.abs(grams), 2)}`
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n)) onSave(n)   // negative allowed by design
    else onCancel()
  }
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...card, padding: '14px 18px', position: 'relative', overflow: 'hidden',
        border: `1px solid ${hov ? `${accent}55` : t.border}`,
        borderLeft: `3px solid ${accent}`,
        opacity: saving ? 0.65 : 1,
        transform: hov ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hov ? `0 9px 24px ${accent}26` : 'none',
        transition: 'opacity .15s, transform .18s cubic-bezier(.34,1.1,.64,1), box-shadow .2s ease, border-color .2s ease',
      }}>
      <div aria-hidden style={{
        position: 'absolute', top: -45, right: -45, width: 130, height: 130, borderRadius: '50%',
        pointerEvents: 'none', transition: 'background .25s ease',
        background: `radial-gradient(circle, ${accent}${hov ? '24' : '00'} 0%, transparent 70%)`,
      }}/>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {op && <span style={{ fontSize: 12, color: t.text4, fontFamily: 'monospace', fontWeight: 700, opacity: .75 }}>{op}</span>}
          <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Pending Delivery</span>
        </span>
        {editing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number" step="0.01"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
              onBlur={commit}
              autoFocus
              placeholder="±g"
              style={{
                width: 82,
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
            <span style={{ fontSize: 10, color: accent, fontWeight: 700 }}>g</span>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {nonZero && (
              <button onClick={onClear}
                title="Clear carry-over (set to 0)"
                disabled={saving}
                style={{ background: 'transparent', border: 'none', color: t.text4, fontSize: 10, fontWeight: 600, cursor: saving ? 'default' : 'pointer', padding: '2px 4px' }}
                onMouseEnter={e => { if (!saving) e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.color = t.text4 }}>
                ↺
              </button>
            )}
            <button onClick={onStartEdit}
              title="Click to set the pending carry-over (can be negative)"
              disabled={saving}
              style={{
                background: `${accent}15`,
                border: `1px solid ${accent}40`,
                color: accent,
                borderRadius: 99,
                padding: '2px 9px',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'monospace',
                cursor: saving ? 'default' : 'pointer',
                letterSpacing: '.04em',
              }}
              onMouseEnter={e => { if (!saving) e.currentTarget.style.background = `${accent}25` }}
              onMouseLeave={e => { e.currentTarget.style.background = `${accent}15` }}>
              {saving ? '…' : 'SET ✎'}
            </button>
          </span>
        )}
      </div>
      <div style={{
        position: 'relative',
        fontSize: '24px', fontWeight: 200,
        color: grams === 0 ? t.text3 : accent,
        fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.01em',
      }}>
        {grams === 0 ? '0.00' : signed}<span style={{ fontSize: 13, color: t.text3, marginLeft: 4 }}>g</span>
      </div>
      <div style={{ position: 'relative', fontSize: '10px', color: t.text4, marginTop: 6 }}>
        {grams === 0
          ? 'no carry-over for this date'
          : `${grams > 0 ? 'delayed gold rolling in' : 'pull-back'}${setBy ? ` · by ${String(setBy).split('@')[0]}` : ''}`}
      </div>
    </div>
  )
}

// ── Bookings list ────────────────────────────────────────────────────────────
function BookingsList({ t, card, bookings, onUpdateStatus, onRequestCancel, onCreate }) {
  const [hideCancelled, setHideCancelled] = useState(true)
  const visible = hideCancelled ? bookings.filter(b => b.status !== 'cancelled') : bookings

  if (bookings.length === 0) {
    // Empty state — no explicit + New Booking CTA here; the booking flow
    // is selection-first. Pick branches above to start; the CTA appears
    // in the sources card once anything is ticked.
    return (
      <div style={{ ...card, padding: '36px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', color: t.text1, fontWeight: 600 }}>No bookings yet for this date</div>
        <div style={{ fontSize: '11.5px', color: t.text4, marginTop: 6, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
          Tick branches in <strong style={{ color: t.text3 }}>Incoming Sources</strong> above to start a booking. Bookings also appear in <strong style={{ color: t.text3 }}>Sales → Cal Table → Quotas</strong> on the same date.
        </div>
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
function SourcePicker({ t, card, supply, bangBranches, inTBranches, selected, selectedTotal, selectionMode, branchLocked, onToggleBranch, onSelectGroup, onBook, incomingNetWt, incomingBills, arrivalDate }) {
  const hasSelection = selected.size > 0

  // Region-wise grouping — every branch lives under its own region. Bangalore
  // is one of the regions, not a separate top-level container, so the picker
  // reads as a uniform list of region drill-downs.
  const REGION_ORDER = ['Bangalore', 'Rest of Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Tamil Nadu']
  const branchesByRegion = useMemo(() => {
    const m = {}
    for (const b of bangBranches) {
      const r = b.region || 'Bangalore'
      ;(m[r] = m[r] || []).push({ ...b, _prefix: 'B' })
    }
    for (const b of inTBranches) {
      const r = b.region || 'Unknown'
      ;(m[r] = m[r] || []).push({ ...b, _prefix: 'T' })
    }
    return m
  }, [bangBranches, inTBranches])
  const orderedRegions = useMemo(() => {
    const all = Object.keys(branchesByRegion)
    return [
      ...REGION_ORDER.filter(r => all.includes(r)),
      ...all.filter(r => !REGION_ORDER.includes(r)).sort(),
    ]
  }, [branchesByRegion])

  // Each region group collapsed by default. The operator drills into the
  // ones they're actually booking from.
  const [openRegions, setOpenRegions] = useState(() => new Set())
  const toggleRegion = (r) => setOpenRegions(prev => {
    const next = new Set(prev)
    if (next.has(r)) next.delete(r); else next.add(r)
    return next
  })
  // Third drill level: region → branch → bills. A branch row can be expanded
  // (independent of its selection state) to reveal the individual CRM bills
  // backing its number — case-level visibility/audit.
  const [openBranches, setOpenBranches] = useState(() => new Set())
  const toggleBranchExpand = (k) => setOpenBranches(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  // Shared grid template — checkbox · branch · bills · net weight.
  // (Region column dropped from the row since the group header already
  // carries the region name; saves a column and lets the branch name
  // breathe.)
  const ROW_GRID = '28px minmax(160px, 1fr) 80px 110px'

  const accentForRegion = (r) => REGION_COLORS[r] || t.text3

  // Column header strip — explicit names for the data underneath.
  const renderColHeader = () => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: ROW_GRID,
      gap: 12,
      padding: '8px 18px',
      background: `${t.text4}06`,
      borderBottom: `1px solid ${t.border}`,
    }}>
      <span />
      <span style={{ fontSize: 9.5, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Branch</span>
      <span style={{ fontSize: 9.5, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, textAlign: 'right' }}>Bills</span>
      <span style={{ fontSize: 9.5, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, textAlign: 'right' }}>Net Weight</span>
    </div>
  )

  const renderBillRow = (bl, accent, j) => (
    <div key={bl.id || bl.application_id || j}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 96px 110px',
        gap: 12, alignItems: 'center',
        padding: '7px 18px 7px 64px',     // deepest indent — nested under branch
        borderBottom: `1px solid ${t.border}1f`,
        background: `${accent}05`,
        animation: `bidRowIn .2s cubic-bezier(.4,0,.2,1) ${Math.min(j, 10) * 16}ms backwards`,
      }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: `${accent}99`, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: t.text2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bl.application_id || '—'}
        </span>
        {bl.stock_status && bl.stock_status !== 'at_branch' && (
          <span style={{ fontSize: 8.5, color: t.text4, background: `${t.text4}14`, borderRadius: 3, padding: '1px 5px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700, flexShrink: 0 }}>
            {String(bl.stock_status).replace(/_/g, ' ')}
          </span>
        )}
      </span>
      <span style={{ fontSize: 10.5, color: t.text4, fontFamily: 'monospace', textAlign: 'right' }}>
        {fmt(bl.gross_weight, 2)}<span style={{ fontSize: 8.5, marginLeft: 2 }}>g gr</span>
      </span>
      <span style={{ fontSize: 11.5, color: accent, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>
        {fmt(bl.net_weight, 2)}<span style={{ fontSize: 9, marginLeft: 2, color: t.text4 }}>g</span>
      </span>
    </div>
  )

  const renderBranchRow = (b, accent, idx) => {
    const k = `${b._prefix}:${b.branch_name}`
    const on = selected.has(k)
    const locked = branchLocked(b)
    const expanded = openBranches.has(k)
    const bills = Array.isArray(b.bills) ? b.bills : []
    const lockReason = locked
      ? (selectionMode === 'kerala'
          ? 'Kerala bookings can’t mix with other regions — clear the Kerala selection first.'
          : 'Selection already contains other regions — Kerala bookings must be exclusive.')
      : ''
    return (
      <div key={b.branch_name}>
        <div
          onClick={() => { if (!locked) onToggleBranch(k) }}
          title={lockReason}
          style={{
            display: 'grid',
            gridTemplateColumns: ROW_GRID,
            gap: 12,
            alignItems: 'center',
            padding: '10px 18px 10px 32px',  // extra left pad — visually nested under group
            borderBottom: `1px solid ${t.border}30`,
            cursor: locked ? 'not-allowed' : 'pointer',
            background: on ? `${accent}10` : 'transparent',
            borderLeft: `3px solid ${on ? accent : 'transparent'}`,
            opacity: locked ? 0.4 : 1,
            transition: 'background .15s ease, opacity .2s ease',
            animation: `bidRowIn .22s cubic-bezier(.4,0,.2,1) ${Math.min(idx, 8) * 18}ms backwards`,
          }}
          onMouseEnter={e => { if (!on && !locked) e.currentTarget.style.background = `${t.text4}06` }}
          onMouseLeave={e => { if (!on && !locked) e.currentTarget.style.background = on ? `${accent}10` : 'transparent' }}>
          <input type="checkbox" checked={on} disabled={locked}
            onChange={() => onToggleBranch(k)} onClick={e => e.stopPropagation()}
            style={{ accentColor: accent, cursor: locked ? 'not-allowed' : 'pointer', width: 16, height: 16 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {bills.length > 0 && (
              <button
                onClick={e => { e.stopPropagation(); toggleBranchExpand(k) }}
                title={expanded ? 'Hide bills' : `Show ${bills.length} bill${bills.length === 1 ? '' : 's'}`}
                style={{
                  width: 16, height: 16, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: expanded ? `${accent}22` : 'transparent',
                  border: `1px solid ${expanded ? `${accent}55` : t.border}`,
                  borderRadius: 4, color: expanded ? accent : t.text4,
                  fontSize: 9, cursor: 'pointer',
                  transform: expanded ? 'rotate(0)' : 'rotate(-90deg)',
                  transition: 'transform .22s ease, background .15s ease, color .15s ease, border-color .15s ease',
                }}>▾</button>
            )}
            <span style={{ fontSize: 12.5, color: t.text1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.branch_name}
            </span>
          </span>
          <span style={{ fontSize: 11.5, color: t.text2, fontFamily: 'monospace', textAlign: 'right', fontWeight: 600 }}>
            {b.total_bills || 0}
          </span>
          <span style={{ fontSize: 12.5, color: t.gold, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>
            {fmt(b.total_net_wt, 2)}<span style={{ fontSize: 10, marginLeft: 2, color: t.text4 }}>g</span>
          </span>
        </div>
        {expanded && bills.length > 0 && (
          <div style={{ animation: 'bidGroupExpand .25s cubic-bezier(.4,0,.2,1)' }}>
            {bills.map((bl, j) => renderBillRow(bl, accent, j))}
          </div>
        )}
      </div>
    )
  }

  const renderRegionGroup = (region) => {
    const branches = branchesByRegion[region] || []
    if (!branches.length) return null
    const accent = accentForRegion(region)
    const open = openRegions.has(region)
    const isKerala = region === 'Kerala'

    const eligible = branches.filter(b => !branchLocked(b))
    const allSelected = eligible.length > 0 && eligible.every(b => selected.has(`${b._prefix}:${b.branch_name}`))
    const totalBills = branches.reduce((s, b) => s + (b.total_bills || 0), 0)
    const totalNetWt = branches.reduce((s, b) => s + Number(b.total_net_wt || 0), 0)

    const contextLine = region === 'Bangalore'
      ? `purchase ${fmtDateShort(supply?.bangalore_purchase_date || '')}`
      : `arriving ${fmtDateShort(supply?.arrival_date || arrivalDate)}`

    return (
      <div key={region}>
        <div onClick={() => toggleRegion(region)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 18px',
            background: open ? `${accent}10` : `${accent}06`,
            borderBottom: `1px solid ${t.border}`,
            cursor: 'pointer', userSelect: 'none',
            transition: 'background .2s ease',
          }}>
          <span style={{
            width: 18, height: 18, borderRadius: '50%',
            background: `${accent}25`, color: accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
            transform: open ? 'rotate(0)' : 'rotate(-90deg)',
            transition: 'transform .25s ease',
            flexShrink: 0,
          }}>▾</span>
          <input type="checkbox" checked={allSelected} disabled={eligible.length === 0}
            onChange={() => onSelectGroup(branches, branches[0]?._prefix || 'T', allSelected)}
            onClick={e => e.stopPropagation()}
            style={{ accentColor: accent, cursor: eligible.length ? 'pointer' : 'not-allowed', width: 16, height: 16 }} />
          <span style={{ fontSize: 12, color: t.text1, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {region}
          </span>
          {isKerala && (
            <span title="Kerala bookings can’t mix with other regions"
              style={{ fontSize: 9, color: t.green, background: `${t.green}18`, border: `1px solid ${t.green}40`, borderRadius: 3, padding: '2px 6px', fontWeight: 800, letterSpacing: '.08em' }}>
              KL · EXCLUSIVE
            </span>
          )}
          <span style={{ fontSize: 10, color: t.text4, fontFamily: 'monospace' }}>
            {branches.length} {branches.length === 1 ? 'branch' : 'branches'} · {totalBills} bill{totalBills === 1 ? '' : 's'} · {contextLine}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: accent, fontFamily: 'monospace', fontWeight: 700 }}>
            {fmt(totalNetWt, 2)}<span style={{ fontSize: 9, marginLeft: 2 }}>g</span>
          </span>
        </div>
        {open && (
          <div style={{ animation: 'bidGroupExpand .25s cubic-bezier(.4,0,.2,1)' }}>
            {branches.map((b, i) => renderBranchRow(b, accent, i))}
          </div>
        )}
      </div>
    )
  }

  const totalRegions = orderedRegions.length

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      {/* Action bar — pool summary, flips to Book Selected → once anything
          is ticked. */}
      <div style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${t.border}`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: hasSelection ? `linear-gradient(90deg, ${t.gold}10 0%, transparent 70%)` : 'transparent',
        transition: 'background .25s ease',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text1 }}>Incoming Sources</div>
          <div style={{ fontSize: 11, color: t.text4, marginTop: 2 }}>
            {totalRegions} region{totalRegions === 1 ? '' : 's'} · {fmt(incomingNetWt, 2)} g · {incomingBills} bill{incomingBills === 1 ? '' : 's'}
          </div>
        </div>
        {hasSelection ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, animation: 'bidActionIn .25s cubic-bezier(.34,1.2,.64,1)' }}>
            {selectionMode === 'kerala' && (
              <span title="Kerala bookings can’t mix with other regions"
                style={{ fontSize: 9.5, color: t.green, background: `${t.green}18`, border: `1px solid ${t.green}40`, borderRadius: 4, padding: '3px 8px', fontWeight: 700, letterSpacing: '.08em' }}>
                KL · KERALA ONLY
              </span>
            )}
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
                transition: 'transform .12s ease, box-shadow .12s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${t.gold}60` }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)';   e.currentTarget.style.boxShadow = `0 1px 4px ${t.gold}50` }}>
              Book Selected →
            </button>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: t.text4, fontStyle: 'italic' }}>
            Open a region to start ticking branches · Kerala bookings are exclusive
          </span>
        )}
      </div>

      {/* Column header strip */}
      {totalRegions > 0 && renderColHeader()}

      {/* Region groups, ordered */}
      {orderedRegions.map(renderRegionGroup)}

      {totalRegions === 0 && (
        <div style={{ padding: '32px 18px', textAlign: 'center', color: t.text4, fontSize: 12 }}>
          No incoming sources for this date.
        </div>
      )}
    </div>
  )
}

// ── Supplementary source section — compact alternative to SourcePicker ──────
// Used for Section 3 (transit-48h, view-only) and Section 4 (branch-stock
// pre-EOD, selectable). Same region-grouped branch list pattern, but as a
// standalone card with its own title/total — keeps the main picker focused on
// the "primary" 24h-arrival pool while these extras dock below it.
function SourceSection({
  t, card, title, subtitle, accent,
  branches = [], total, prefix, selectable = false,
  selected, branchLocked, onToggleBranch, onSelectGroup,
  emptyMsg,
}) {
  // Group branches by region in insertion order (already sorted server-side
  // by total_net_wt within each branch list).
  const regions = (() => {
    const m = new Map()
    for (const b of branches) {
      const r = b.region || 'Unknown'
      if (!m.has(r)) m.set(r, [])
      m.get(r).push(b)
    }
    return [...m.entries()]
  })()
  const isEmpty = branches.length === 0
  const totalBills = total?.bills    || 0
  const totalNet   = total?.net_wt   || 0
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', borderLeft: `3px solid ${accent || t.gold}` }}>
      <div style={{ padding: '13px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${t.border}`, background: `${(accent || t.gold)}06` }}>
        <div>
          <div style={{ fontSize: 13, color: t.text1, fontWeight: 600, letterSpacing: '.02em' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10.5, color: t.text3, marginTop: 3 }}>{subtitle}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, color: accent || t.gold, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1 }}>
            {fmt(totalNet, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 3, fontWeight: 500 }}>g</span>
          </div>
          <div style={{ fontSize: 10, color: t.text4, marginTop: 3 }}>{totalBills} bill{totalBills === 1 ? '' : 's'}</div>
        </div>
      </div>
      {isEmpty ? (
        <div style={{ padding: '22px 18px', textAlign: 'center', color: t.text4, fontSize: 11, lineHeight: 1.6 }}>{emptyMsg || 'Nothing here yet.'}</div>
      ) : (
        <div style={{ padding: '6px 0' }}>
          {regions.map(([region, rows]) => {
            const rColor = REGION_COLORS[region] || t.text3
            // Group toggle state — all branches in this region selected?
            const allOn = selectable && rows.every(b => selected?.has(`${prefix}:${b.branch_name}`))
            return (
              <div key={region} style={{ padding: '8px 18px', borderTop: `1px solid ${t.border}30` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: rColor, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{region}</span>
                  {selectable && rows.length > 1 && (
                    <button onClick={() => onSelectGroup?.(rows, prefix, allOn)}
                      style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                      {allOn ? 'Clear region' : 'Select all'}
                    </button>
                  )}
                </div>
                {rows.map(b => {
                  const k       = `${prefix || 'X'}:${b.branch_name}`
                  const checked = selectable && (selected?.has(k) || false)
                  const locked  = selectable && branchLocked?.(b)
                  const rowCursor = !selectable ? 'default' : (locked ? 'not-allowed' : 'pointer')
                  return (
                    <div key={b.branch_name}
                      onClick={() => { if (selectable && !locked) onToggleBranch?.(k) }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '7px 10px', borderRadius: 6,
                        background: checked ? `${t.gold}10` : 'transparent',
                        cursor: rowCursor,
                        opacity: !selectable ? 0.62 : (locked ? 0.45 : 1),
                        transition: 'background .12s',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {selectable ? (
                          <span style={{
                            width: 14, height: 14, borderRadius: 3,
                            border: `1.5px solid ${checked ? t.gold : t.border2}`,
                            background: checked ? t.gold : 'transparent',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            color: '#1a0a00', fontSize: 10, fontWeight: 900, flexShrink: 0,
                          }}>{checked ? '✓' : ''}</span>
                        ) : (
                          <span style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${t.border}`, background: 'transparent', flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: 12, color: t.text1, fontWeight: 500 }}>{b.branch_name}</span>
                        {b.tat_hours != null && (
                          <span style={{ fontSize: 9, color: t.text4, background: `${t.text4}14`, borderRadius: 3, padding: '1px 6px' }}>{b.tat_hours}h TAT</span>
                        )}
                        {b.pickup_time && (
                          <span style={{ fontSize: 9, color: t.text4 }}>pickup {b.pickup_time}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: 'monospace' }}>
                        <span style={{ fontSize: 12, color: t.gold, fontWeight: 600 }}>{fmt(b.total_net_wt, 2)}<span style={{ fontSize: 10, color: t.text3, marginLeft: 2 }}>g</span></span>
                        <span style={{ fontSize: 10, color: t.text4 }}>{b.total_bills} bill{b.total_bills === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Bidder combobox — custom dropdown (replaces native datalist) ─────────────
// Wraps the input + a click-to-open dropdown listing known bidders, with an
// always-visible "+ Add new bidder" option at the top of the list (and a
// dynamic "+ Add '<typed>'" row when the operator types a name that's not
// in the roster). Native datalist couldn't surface the add-new affordance
// inside the drop-down itself, which is what the ops team asked for.
function BidderCombobox({ t, value, onChange, options, onAddNew }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const query = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!query) return options
    return options.filter(o => o.toLowerCase().includes(query))
  }, [options, query])
  const isNew = value.trim().length > 0 && !options.some(o => o.toLowerCase() === query)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input value={value}
          onChange={e => { onChange(e.target.value); if (!open) setOpen(true) }}
          onFocus={() => setOpen(true)}
          autoFocus
          placeholder="Select or type bidder name"
          style={{ ...inputStyle(t), paddingRight: 32 }} />
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', color: t.text3,
            cursor: 'pointer', padding: '4px 6px', borderRadius: 4,
            fontSize: 10, lineHeight: 1,
            transition: 'transform .2s, color .2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = t.gold }}
          onMouseLeave={e => { e.currentTarget.style.color = t.text3 }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>▾</span>
        </button>
      </div>
      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)',
          background: t.card, border: `1px solid ${t.border}`,
          borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,.3)',
          maxHeight: 240, overflowY: 'auto', zIndex: 200,
          animation: 'bidRowIn .15s cubic-bezier(.4,0,.2,1)',
        }}>
          {/* Add-new row sits at the very top so it's always reachable */}
          {isNew && (
            <button type="button"
              onClick={() => { if (onAddNew) onAddNew(value.trim()); setOpen(false) }}
              style={{
                width: '100%', textAlign: 'left',
                background: `${t.green}10`,
                border: 'none', borderBottom: `1px solid ${t.border}`,
                padding: '10px 14px',
                fontSize: 12, color: t.green, fontWeight: 700,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.green}20` }}
              onMouseLeave={e => { e.currentTarget.style.background = `${t.green}10` }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
              Add “{value.trim()}” as new bidder
            </button>
          )}
          {!isNew && (
            <div style={{
              padding: '8px 14px',
              fontSize: 9.5, color: t.text4,
              letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700,
              borderBottom: `1px solid ${t.border}`, background: `${t.text4}06`,
            }}>
              {filtered.length} {filtered.length === 1 ? 'bidder' : 'bidders'} · type to add new
            </div>
          )}
          {filtered.length === 0 && !isNew && (
            <div style={{ padding: '20px 14px', fontSize: 11, color: t.text4, textAlign: 'center', fontStyle: 'italic' }}>
              No bidders yet — type a name above to add one
            </div>
          )}
          {filtered.map((o, i) => {
            const isSelected = o === value
            return (
              <button key={o} type="button"
                onClick={() => { onChange(o); setOpen(false) }}
                style={{
                  width: '100%', textAlign: 'left',
                  background: isSelected ? `${t.gold}15` : 'transparent',
                  border: 'none', borderBottom: i === filtered.length - 1 ? 'none' : `1px solid ${t.border}30`,
                  padding: '9px 14px',
                  fontSize: 12, color: isSelected ? t.gold : t.text2,
                  fontWeight: isSelected ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background .1s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${t.text4}10` }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: hashAvatarBg(o, t), color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700,
                }}>{o[0].toUpperCase()}</span>
                {o}
                {isSelected && <span style={{ marginLeft: 'auto', color: t.gold, fontSize: 11 }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Stable avatar bg colour per bidder — same name always gets the same chip.
function hashAvatarBg(s, t) {
  const palette = [t.gold, t.blue, t.green, t.purple || '#8c5ac8', t.orange || '#e58a3b', t.red]
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

// ── Booking modal — minimal: Bidder · Weight · Rate ──────────────────────────
// Per ops spec, the booking form collects only what's strictly required:
// bidder (dropdown), weight (auto-filled from selection), rate per gram.
// Phone / purity / notes / KL toggle are dropped — KL is auto-derived
// from whether the selection is all-Kerala (selection rules enforce
// that bookings are never mixed across Kerala / non-Kerala).
//
// Selected sources display: compact by default — chip strip is collapsed
// to "first 6 + (N more)" so 20+ branches don't blow up the modal height.
function BookingModal({ t, arrivalDate, availablePool, remainingQty, incomingNetWt, gainGrams, pendingGrams, bookedQty, selected, selectedTotal, branchesByKey, bidders, effectiveGainRate, isKerala, onUnselect, onSubmit, onClose, onSuccess }) {
  // The quantity committed to a bidder is a *negotiated* figure against the
  // whole available pool (Incoming + Gain ± Pending), not the exact sum of
  // the selected source branches — ops tells a bidder "550 g", a rounded
  // commitment, then the selected branches are simply the bills that back
  // it. So: the pool is the ceiling shown up top; the selected net+gain is
  // only a one-tap *suggestion* to pre-fill the field; the operator types
  // whatever they actually committed.
  const netFromSelection = selectedTotal
  const suggestedWeight = netFromSelection > 0
    ? netFromSelection * (1 + (effectiveGainRate || 0))
    : 0
  // Keep the old name aliased so the rest of the component (sync effect,
  // reset link) doesn't need touching.
  const defaultBookingWeight = suggestedWeight
  const [bookingWeight, setBookingWeight] = useState(() => defaultBookingWeight > 0 ? defaultBookingWeight.toFixed(2) : '')
  const [bookingWeightDirty, setBookingWeightDirty] = useState(false)
  const [party,       setParty]       = useState('')
  const [rate,        setRate]        = useState('')
  const [busy,        setBusy]        = useState(false)
  // Local bidder roster (combines API list + names saved during this
  // session). On submit we POST to /api/consignments?action=create_booking
  // which writes the party into cal_quotas; next mount the API list
  // picks it up.
  const [localBidders, setLocalBidders] = useState(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(window.localStorage.getItem('bidding.localBidders') || '[]') } catch { return [] }
  })
  const allBidders = useMemo(() => {
    const seen = new Set(); const out = []
    for (const b of [...(bidders || []), ...localBidders]) {
      const k = String(b || '').trim().toLowerCase()
      if (!k || seen.has(k)) continue
      seen.add(k); out.push(b)
    }
    return out.sort((a, b) => a.localeCompare(b))
  }, [bidders, localBidders])
  const isNewBidder = party.trim().length > 0 && !allBidders.some(b => b.toLowerCase() === party.trim().toLowerCase())
  const saveNewBidder = () => {
    const name = party.trim()
    if (!name || !isNewBidder) return
    const next = [...localBidders, name]
    setLocalBidders(next)
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('bidding.localBidders', JSON.stringify(next)) } catch {}
    }
  }

  // Lock the page scroll while the modal is open. body.overflow=hidden alone
  // doesn't hold on every browser (some put the scroller on <html>), so we
  // pin both elements AND use position: fixed + saved scrollY to defeat any
  // pull-to-refresh / overscroll behaviour on mobile. Restored on close.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const html = document.documentElement
    const body = document.body
    const scrollY = window.scrollY || window.pageYOffset || 0
    const prev = {
      bodyOverflow:  body.style.overflow,
      htmlOverflow:  html.style.overflow,
      bodyPosition:  body.style.position,
      bodyTop:       body.style.top,
      bodyWidth:     body.style.width,
    }
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top      = `-${scrollY}px`
    body.style.width    = '100%'
    return () => {
      body.style.overflow = prev.bodyOverflow
      html.style.overflow = prev.htmlOverflow
      body.style.position = prev.bodyPosition
      body.style.top      = prev.bodyTop
      body.style.width    = prev.bodyWidth
      window.scrollTo(0, scrollY)
    }
  }, [])

  // Keep booking weight in sync with the selection (× gain factor) unless
  // the operator has manually edited it.
  useEffect(() => {
    if (bookingWeightDirty) return
    setBookingWeight(defaultBookingWeight > 0 ? defaultBookingWeight.toFixed(2) : '')
  }, [defaultBookingWeight, bookingWeightDirty])

  // selectedRows is still needed by submit() to compose the "Sources: …"
  // note saved with the booking — the branches just no longer get their
  // own visual block in the modal (per ops: selection happens in the
  // Incoming Sources picker, the modal is about the commitment).
  const selectedRows = [...selected].map(k => ({ k, b: branchesByKey[k] })).filter(x => x.b)

  const w = Number(bookingWeight); const r = Number(rate)
  const total = Number.isFinite(w) && Number.isFinite(r) ? w * r : 0
  const wValid = Number.isFinite(w) && w > 0
  const freePool = remainingQty                                    // pool − already booked
  const afterFree = wValid ? freePool - w : freePool
  // wouldOverbook also true when there is NO free pool at all (deficit /
  // already fully booked) and the operator still enters a weight.
  const wouldOverbook = wValid && (freePool <= 0 || w > freePool)
  // Gauge fill: fraction of the free pool this commitment consumes.
  // Critical edge: when freePool <= 0 the pool is in deficit / fully
  // booked — any positive commit is 100% over. Show a FULL red bar so the
  // showpiece conveys "no room" instead of going blank in exactly the
  // dangerous state (audit should-fix #4).
  const fillPct = !wValid
    ? 0
    : freePool > 0
      ? Math.min(100, (w / freePool) * 100)
      : 100
  const overPct = freePool > 0 && wValid && w > freePool
    ? Math.min(100, ((w - freePool) / freePool) * 100)
    : 0

  const submit = async () => {
    if (!party.trim()) return
    if (!Number.isFinite(w) || w <= 0) return
    if (!Number.isFinite(r) || r <= 0) return
    setBusy(true)
    // Pin the new name into the local roster on submit too — covers the
    // case where the operator skipped the explicit "+ Save" button.
    if (isNewBidder) saveNewBidder()
    const selectedBranchList = selectedRows.map(({ b }) => b.branch_name)
    const compositeNotes = selectedBranchList.length
      ? `Sources: ${selectedBranchList.join(', ')}`
      : null
    const ok = await onSubmit({
      party:       party.trim(),
      buyer_phone: null,
      weight:      w,
      rate:        r,
      purity:      null,
      is_kl:       !!isKerala,
      notes:       compositeNotes,
    })
    if (ok && onSuccess) onSuccess()
    if (!ok) setBusy(false)
  }

  const valid = party.trim() && Number.isFinite(w) && w > 0 && Number.isFinite(r) && r > 0

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, overflow: 'auto',
      animation: 'bidModalOverlayIn .18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 460, maxHeight: '90vh', overflow: 'auto',
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,.4)',
        display: 'flex', flexDirection: 'column',
        animation: 'bidModalIn .25s cubic-bezier(.34,1.2,.64,1)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, letterSpacing: '-.01em' }}>New Booking</div>
              <div style={{ fontSize: 11, color: t.text4, marginTop: 3 }}>Arrival · {fmtDate(arrivalDate)}</div>
            </div>
            {isKerala && (
              <span style={{ fontSize: 9.5, color: t.green, background: `${t.green}18`, border: `1px solid ${t.green}40`, borderRadius: 99, padding: '3px 10px', fontWeight: 800, letterSpacing: '.08em' }}>
                KL · KERALA
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Pool ceiling + gauge — the showpiece. The booking is committed
              against the whole available pool (Incoming + Gain ± Pending),
              surfaced here so ops sees the ceiling and how much of it this
              commitment consumes, animated as they type. */}
          {(() => {
            const pAbs  = Math.abs(pendingGrams || 0)
            const pSign = pendingGrams > 0 ? '+' : pendingGrams < 0 ? '−' : ''
            const fillColor = wouldOverbook
              ? `linear-gradient(90deg, ${t.red}, ${t.red}cc)`
              : `linear-gradient(90deg, ${t.gold}, ${t.green || '#3aaa6a'})`
            return (
              <div style={{
                position: 'relative', overflow: 'hidden',
                background: `linear-gradient(150deg, ${t.gold}14, ${t.gold}05 55%, transparent)`,
                border: `1px solid ${wouldOverbook ? `${t.red}45` : `${t.gold}38`}`,
                borderRadius: 14, padding: '16px 18px',
                animation: 'bidHeroIn .4s cubic-bezier(.34,1.12,.64,1)',
                transition: 'border-color .25s ease',
              }}>
                {/* soft corner glow */}
                <div aria-hidden style={{
                  position: 'absolute', top: -50, right: -50, width: 150, height: 150,
                  borderRadius: '50%', pointerEvents: 'none',
                  background: `radial-gradient(circle, ${(wouldOverbook ? t.red : t.gold)}22 0%, transparent 70%)`,
                }}/>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 9.5, color: t.text4, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700 }}>
                      Free to commit
                    </div>
                    <div style={{ fontSize: 30, color: wouldOverbook ? t.red : t.gold, fontFamily: 'monospace', fontWeight: 300, lineHeight: 1.05, marginTop: 5, letterSpacing: '-.025em' }}>
                      {fmt(freePool, 2)}<span style={{ fontSize: 14, color: t.text3, marginLeft: 4 }}>g</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 10, color: t.text4, lineHeight: 1.7 }}>
                    <div>pool <strong style={{ color: t.text2, fontFamily: 'monospace' }}>{fmt(availablePool, 2)} g</strong></div>
                    {bookedQty > 0 && <div>booked <strong style={{ color: t.text3, fontFamily: 'monospace' }}>{fmt(bookedQty, 2)} g</strong></div>}
                  </div>
                </div>

                {/* Gauge — fills as you type the committed weight. Green→gold
                    while within pool; red once overbooking. Width eases via
                    .bidGauge so the bar glides instead of snapping. */}
                <div style={{ position: 'relative', marginTop: 14, height: 10, borderRadius: 99, background: `${t.text4}22`, overflow: 'hidden' }}>
                  <div className="bidGauge" style={{
                    height: '100%', width: `${fillPct}%`, borderRadius: 99,
                    background: fillColor,
                    boxShadow: wValid ? `0 0 10px ${(wouldOverbook ? t.red : t.gold)}66` : 'none',
                  }}>
                    {wValid && !wouldOverbook && (
                      <div aria-hidden style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent)',
                        backgroundSize: '200% 100%',
                        animation: 'bidSheen 2.4s linear infinite',
                      }}/>
                    )}
                  </div>
                </div>

                {/* Breakdown chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                  <PoolChip t={t} label="Incoming" val={`${fmt(incomingNetWt, 2)} g`} />
                  <PoolChip t={t} label="Gain" val={`+${fmt(gainGrams, 2)} g`} />
                  {pendingGrams !== 0 && (
                    <PoolChip t={t} label="Pending" val={`${pSign}${fmt(pAbs, 2)} g`}
                      tone={pendingGrams < 0 ? t.red : (t.purple || '#8c5ac8')} />
                  )}
                </div>

                {/* Live feedback — keyed so it cross-fades on each change */}
                {wValid && (
                  <div key={`${wouldOverbook}-${Math.round(afterFree)}`}
                    style={{ marginTop: 12, fontSize: 11.5, fontWeight: 700, color: wouldOverbook ? t.red : t.green, animation: 'bidFadeIn .22s ease' }}>
                    {wouldOverbook
                      ? `⚠ ${fmt(w, 2)} g committed · overbooks the pool by ${fmt(Math.abs(afterFree), 2)} g`
                      : `${fmt(w, 2)} g committed · ${fmt(afterFree, 2)} g still free after this`}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Staggered field reveal */}
          <div className="bidStagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <Field label="Bidder">
              <BidderCombobox
                t={t}
                value={party}
                onChange={setParty}
                options={allBidders}
                onAddNew={(name) => { setParty(name); saveNewBidder() }}
              />
            </Field>

            {/* Committed weight — the negotiated figure ("550 g"). Free
                entry against the pool above; selected net+gain is a one-tap
                suggestion only. */}
            <Field label="Committed to bidder (g)">
              <input value={bookingWeight} className="bidInput"
                onChange={e => { setBookingWeight(e.target.value.replace(/[^\d.]/g, '')); setBookingWeightDirty(true) }}
                placeholder="e.g. 550"
                inputMode="decimal"
                style={{ ...inputStyle(t), fontFamily: 'monospace', fontSize: 19, fontWeight: 700, padding: '13px 14px', color: wouldOverbook ? t.red : t.gold, borderColor: wouldOverbook ? `${t.red}66` : (wValid ? `${t.gold}66` : t.border) }} />
              <div style={{ fontSize: 9.5, color: t.text4, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {suggestedWeight > 0 && (
                  <button type="button"
                    onClick={() => { setBookingWeight(suggestedWeight.toFixed(2)); setBookingWeightDirty(true) }}
                    style={{
                      background: `${t.gold}15`, border: `1px solid ${t.gold}40`,
                      borderRadius: 99, padding: '3px 10px', fontSize: 9.5, fontWeight: 700,
                      color: t.gold, cursor: 'pointer', letterSpacing: '.02em',
                      transition: 'background .15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${t.gold}28` }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${t.gold}15` }}>
                    use selected net+gain · {fmt(suggestedWeight, 2)} g
                  </button>
                )}
                <span>negotiated figure — type what's committed to the bidder</span>
              </div>
            </Field>

            <Field label="Rate (₹/g)">
              <input value={rate} className="bidInput"
                onChange={e => setRate(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="7250.00"
                style={{ ...inputStyle(t), fontFamily: 'monospace' }} />
            </Field>

            {/* Total Value — prominent, eases when it changes */}
            <div style={{
              background: total > 0 ? `linear-gradient(135deg, ${t.blue}14, ${t.blue}05)` : t.card2,
              border: `1px solid ${total > 0 ? `${t.blue}38` : t.border}`,
              borderRadius: 12, padding: '14px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              transition: 'background .25s ease, border-color .25s ease',
            }}>
              <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700 }}>Total Value</span>
              <span key={Math.round(total)} style={{ fontSize: 22, color: total > 0 ? t.blue : t.text4, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '-.015em', animation: total > 0 ? 'bidFadeIn .22s ease' : 'none' }}>
                {total > 0 ? fmtINR(total) : '—'}
              </span>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 8, background: t.card2 }}>
          <button onClick={onClose}
            style={{ flex: 1, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: t.text2, cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={submit} disabled={!valid || busy}
            style={{
              flex: 2,
              background: valid && !busy ? t.gold : t.card2,
              color: valid && !busy ? '#1a0a00' : t.text4,
              border: 'none', borderRadius: 8, padding: '10px 14px',
              fontSize: 12.5, fontWeight: 700, letterSpacing: '.03em',
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? `0 1px 4px ${t.gold}50` : 'none',
            }}>
            {busy ? 'Creating…' : `Create Booking · ${total > 0 ? fmtINR(total) : ''}`}
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

// Small breakdown chip used in the booking modal's pool ceiling — makes the
// Incoming / Gain / Pending composition explicit so ops can see exactly
// where the available figure (incl. any Pending carry-over) comes from.
function PoolChip({ t, label, val, tone }) {
  const c = tone || t.text3
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 5,
      background: `${c}12`, border: `1px solid ${c}30`,
      borderRadius: 99, padding: '3px 10px',
    }}>
      <span style={{ fontSize: 9, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 11, color: c, fontFamily: 'monospace', fontWeight: 700 }}>{val}</span>
    </span>
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
