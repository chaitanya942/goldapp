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

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
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
  // 'bidding' = source picker (sections 1-4); 'bookings' = committed bookings
  // list. Tabbed so the page doesn't try to be both at once.
  const [activeTab,    setActiveTab]    = useState('bidding')
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
  // Incoming = Section 1 (Bangalore today) + Section 2 (24h transit, arrives
  // tomorrow). Section 4 (Branch Stock pre-EOD) is OPTIONAL — only enters
  // the booking math when ops explicitly selects bills from it, so it's not
  // part of the default Incoming surface. Section 3 (48h transit) is
  // view-only and never counts.
  const s1Net   = supply?.bangalore?.total?.net_wt    || 0
  const s2Net   = supply?.transit_24h?.total?.net_wt  || supply?.in_transit?.total?.net_wt  || 0
  const s1Gross = supply?.bangalore?.total?.gross_wt  || 0
  const s2Gross = supply?.transit_24h?.total?.gross_wt|| supply?.in_transit?.total?.gross_wt|| 0
  const s1Bills = supply?.bangalore?.total?.bills     || 0
  const s2Bills = supply?.transit_24h?.total?.bills   || supply?.in_transit?.total?.bills   || 0
  const incomingNetWt   = s1Net   + s2Net
  const incomingGrossWt = s1Gross + s2Gross
  const incomingBills   = s1Bills + s2Bills

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
  // Branch metadata lookup — used for region/Kerala-locking helpers + the
  // booking modal's chip display. Keyed by branch_name (no prefix needed now
  // that the selection is bill-level).
  const branchesByKey = useMemo(() => {
    const m = {}
    for (const b of bangBranches)   m[b.branch_name] = { ...b, group: 'bangalore' }
    for (const b of inTBranches)    m[b.branch_name] = { ...b, group: 'transit_24h' }
    for (const b of preEodBranches) m[b.branch_name] = { ...b, group: 'branch_pre_eod' }
    return m
  }, [bangBranches, inTBranches, preEodBranches])

  // Bill-level catalogue across the three SELECTABLE sections (Section 3 is
  // view-only). Indexed by bill.id so the source of truth for booking math
  // is the individual purchase row, not the branch summary.
  const billsById = useMemo(() => {
    const m = {}
    const collect = (branches, group) => {
      for (const b of branches || []) {
        for (const bill of b.bills || []) {
          m[bill.id] = { ...bill, _branch_name: b.branch_name, _region: b.region || null, _group: group }
        }
      }
    }
    collect(bangBranches,   'bangalore')
    collect(inTBranches,    'transit_24h')
    collect(preEodBranches, 'branch_pre_eod')
    return m
  }, [bangBranches, inTBranches, preEodBranches])

  const selectedTotal = useMemo(() => {
    let s = 0
    for (const id of selected) s += Number(billsById[id]?.net_weight || 0)
    return s
  }, [selected, billsById])

  // Single-bill toggle (used by the drill-down checkbox).
  const toggleBill = (billId) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(billId)) next.delete(billId); else next.add(billId)
    return next
  })
  // Tri-state branch toggle — checking a branch row selects every one of its
  // bills; clicking again clears them. If only some of the branch's bills
  // are currently selected, the click promotes to ALL (most useful default).
  const branchSelectionState = (branch) => {
    const bills = branch?.bills || []
    if (!bills.length) return 'none'
    let sel = 0
    for (const b of bills) if (selected.has(b.id)) sel++
    if (sel === 0)            return 'none'
    if (sel === bills.length) return 'all'
    return 'partial'
  }
  const toggleBranchAll = (branch) => setSelected(prev => {
    const next  = new Set(prev)
    const bills = branch?.bills || []
    const state = (() => {
      if (!bills.length) return 'none'
      let sel = 0
      for (const b of bills) if (prev.has(b.id)) sel++
      if (sel === 0)            return 'none'
      if (sel === bills.length) return 'all'
      return 'partial'
    })()
    if (state === 'all') for (const b of bills) next.delete(b.id)
    else                 for (const b of bills) next.add(b.id)
    return next
  })
  // Region select-all — operates on every bill under every branch of the
  // region. Used by the "Select all" link in each region header.
  const toggleRegionAll = (branchRows) => setSelected(prev => {
    const next   = new Set(prev)
    const allIds = branchRows.flatMap(r => (r.bills || []).map(b => b.id))
    if (!allIds.length) return next
    const allOn = allIds.every(id => next.has(id))
    if (allOn) for (const id of allIds) next.delete(id)
    else       for (const id of allIds) next.add(id)
    return next
  })

  // Kerala (KL) no-mix rule — Kerala bookings must be exclusive. With
  // bill-level selection, look at the BILL's branch's region (cached on the
  // bill as `_region` by billsById). Locking a branch is now "would any of
  // its bills violate the current selection mode".
  const isKeralaBill = (id) => billsById[id]?._region === 'Kerala'
  const isKeralaBranch = (b)  => b?.region === 'Kerala'
  const selectionMode = useMemo(() => {
    let hasKerala = false, hasOther = false
    for (const id of selected) {
      if (isKeralaBill(id)) hasKerala = true
      else                  hasOther  = true
    }
    if (hasKerala && hasOther) return 'mixed'
    if (hasKerala) return 'kerala'
    if (hasOther)  return 'other'
    return null
  }, [selected, billsById])
  const branchLocked = (b) => {
    if (!selectionMode) return false
    if (selectionMode === 'kerala') return !isKeralaBranch(b)
    if (selectionMode === 'other')  return  isKeralaBranch(b)
    return false
  }
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
    // Bill-level claim: send the exact purchase ids ops selected. The server
    // honours bill_ids verbatim (no branch-wide widening) so partial
    // selections — "3 of 7 bills at Mysore" — are respected at booking time.
    // source_branches is sent alongside for backwards compat + audit context
    // (server falls back to it only when bill_ids is empty).
    const billIds = [...selected]
    const sourceBranches = [...new Set(billIds.map(id => billsById[id]?._branch_name).filter(Boolean))]
    const r = await authedFetch('/api/consignments?action=create_booking', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, date: arrivalDate, bill_ids: billIds, source_branches: sourceBranches }),
    })
    const j = await r.json()
    if (!r.ok || j.error) { showToast(j.error || 'Booking failed', 'error'); return false }
    showToast('Booking created.', 'success')
    setShowBookModal(false)
    setActiveTab('bookings')                          // surface the committed row immediately
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

      {/* Date controls removed — the bid window is always today → tomorrow's
          HO arrival. Custom dates confused ops more than they helped. The
          `arrivalDate` state stays (defaults to tomorrow) so downstream
          consumers don't need to change. */}

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

      {/* ── Tab navigation — Bidding (source picker) vs Bookings (committed)
          The hero KPIs above stay visible across both tabs so ops always
          see Incoming / Available / Booked / Remaining at a glance. */}
      <div style={{ display: 'inline-flex', alignSelf: 'flex-start', background: t.card2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 3, gap: 2 }}>
        {[
          { key: 'bidding',  label: 'Bidding',  icon: '⚖' },
          { key: 'bookings', label: 'Bookings', icon: '✓', count: activeBookings.length },
        ].map(tab => {
          const active = activeTab === tab.key
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 18px', borderRadius: 8,
                background: active ? `${t.gold}1f` : 'transparent',
                border: `1px solid ${active ? `${t.gold}55` : 'transparent'}`,
                color: active ? t.gold : t.text2,
                fontSize: 13, fontWeight: active ? 800 : 700, letterSpacing: '.02em',
                cursor: 'pointer', transition: 'all .15s',
              }}>
              <span style={{ fontSize: 14, opacity: active ? 1 : 0.7 }}>{tab.icon}</span>
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span style={{
                  fontSize: 10.5, fontWeight: 800, fontFamily: 'monospace',
                  background: active ? t.gold : `${t.text4}30`,
                  color: active ? '#1a0a00' : t.text2,
                  borderRadius: 99, padding: '1px 8px', minWidth: 18, textAlign: 'center',
                }}>{tab.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ─────────────────────────── BIDDING TAB ────────────────────────── */}
      {activeTab === 'bidding' && (<>

      {/* ── Four source sections, always rendered in this fixed order ──
          even when empty. Bangalore on top because that's the largest pool;
          48h-TAT view-only and pre-EOD pickup-pending at the bottom. */}

      {/* 1 · Bangalore Today */}
      <SourceSection
        t={t} card={card}
        index={1}
        icon="🏙"
        title="Bangalore Today"
        subtitle={supply?.bangalore_purchase_date
          ? `Today's Bangalore purchases (${fmtDateShort(supply.bangalore_purchase_date)}) · arrive at HO ${fmtDate(arrivalDate)}`
          : `Today's Bangalore purchases · arrive at HO ${fmtDate(arrivalDate)}`}
        accent={t.gold}
        branches={bangBranches}
        total={supply?.bangalore?.total}
        prefix="B"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        emptyMsg="No Bangalore purchases recorded today yet."
      />

      {/* 2 · In-Transit · 24h TAT (arrives tomorrow) */}
      <SourceSection
        t={t} card={card}
        index={2}
        icon="⇒"
        title="In-Transit · 24h TAT"
        subtitle={`Already dispatched · arriving at HO ${fmtDate(arrivalDate)}`}
        accent={t.blue}
        branches={inTBranches}
        total={supply?.transit_24h?.total || supply?.in_transit?.total}
        prefix="T"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        emptyMsg="No 24h-TAT bills currently in transit."
      />

      {/* 3 · In-Transit · 48h TAT (view-only — not part of today's bid) */}
      <SourceSection
        t={t} card={card}
        index={3}
        icon="⏲"
        title="In-Transit · 48h TAT"
        subtitle={dayAfterArrivalDate
          ? `Arriving at HO ${fmtDate(dayAfterArrivalDate)} — view-only, not part of today's bidding`
          : "Arriving day after tomorrow — view-only, not part of today's bidding"}
        accent={t.text4}
        branches={t48hBranches}
        total={supply?.transit_48h?.total}
        selectable={false}
        viewOnly
        emptyMsg="No 48h-TAT bills currently in transit."
      />

      {/* 4 · Branch Stock pre-EOD (selectable — moves today) */}
      <SourceSection
        t={t} card={card}
        index={4}
        icon="◐"
        title="Branch Stock — pickup pending today"
        subtitle={`Currently at_branch · will move by EOD · arrives at HO ${fmtDate(arrivalDate)}`}
        accent={t.orange}
        branches={preEodBranches}
        total={supply?.branch_pre_eod?.total}
        prefix="P"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        emptyMsg="No eligible branches — either pickups already happened today, or no eligible branches scheduled today."
      />

      {/* Sticky selection bar — appears only when something is selected. */}
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 16, zIndex: 50,
          alignSelf: 'center', minWidth: 360, maxWidth: 720,
          background: t.card,
          border: `1px solid ${t.gold}55`,
          borderRadius: 14,
          padding: '12px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18,
          boxShadow: `0 10px 30px ${t.gold}33, 0 1px 0 ${t.gold}22 inset`,
          backdropFilter: 'blur(8px)',
        }}>
          <div>
            <div style={{ fontSize: 11, color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 800 }}>Selected</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 3 }}>
              <span style={{ fontSize: 26, color: t.gold, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '-.01em' }}>{fmt(selectedTotal, 2)}</span>
              <span style={{ fontSize: 13, color: t.text2, fontWeight: 700 }}>g · {selected.size} bill{selected.size === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            <button onClick={() => setSelected(new Set())}
              style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: 8, padding: '8px 16px', fontSize: 12, color: t.text2, fontWeight: 700, cursor: 'pointer' }}>
              Clear
            </button>
            <button onClick={() => setShowBookModal(true)}
              style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 900, cursor: 'pointer', letterSpacing: '.02em', boxShadow: `0 3px 12px ${t.gold}66` }}>
              Book Selected →
            </button>
          </div>
        </div>
      )}

      </>)}

      {/* ────────────────────────── BOOKINGS TAB ────────────────────────── */}
      {activeTab === 'bookings' && (
        <>
          <BookingsList
            t={t} card={card}
            bookings={bookings}
            onUpdateStatus={updateStatus}
            onRequestCancel={(b) => setCancelTarget(b)}
            onCreate={() => { setActiveTab('bidding') }}
          />
          <div style={{ fontSize: '10px', color: t.text4, textAlign: 'right' }}>
            Bookings stored in <code style={{ background: t.card2, padding: '1px 4px', borderRadius: '3px', color: t.text3 }}>cal_quotas</code> — also visible in Sales → Cal Table → Quotas on the same date.
          </div>
        </>
      )}

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
          billsById={billsById}
          bidders={bidders}
          effectiveGainRate={effectiveGainRate}
          isKerala={selectionIsKerala}
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
// Table layout matches Sales → Cal Table → Quotas exactly so ops sees the
// same view in both places: # · Party · Weight · Rate · KL · Status. Adds
// an Actions column on the right (Confirm / Fulfill / Cancel) because the
// transitions live here in the Bidding module. Active total pinned in the
// footer just like Cal Table.
//
// Party colour mapping is deterministic (mirrors lib in CalTable.js) — same
// party gets the same dot colour across both screens for visual continuity.
const _bookingPartyColors = ['#c9a84c','#4a9fd4','#3aaa6a','#8c5ac8','#e05555','#e09040','#2a9d8f','#e76f51','#457b9d','#6a994e']
const _bookingPartyCache  = {}
let   _bookingPartyIdx    = 0
const partyColor = (name) => {
  const k = String(name || '').trim().toLowerCase()
  if (!_bookingPartyCache[k]) _bookingPartyCache[k] = _bookingPartyColors[_bookingPartyIdx++ % _bookingPartyColors.length]
  return _bookingPartyCache[k]
}

function BookingsList({ t, card, bookings, onUpdateStatus, onRequestCancel, onCreate }) {
  const [hideCancelled, setHideCancelled] = useState(true)
  const visible       = hideCancelled ? bookings.filter(b => b.status !== 'cancelled') : bookings
  const activeRows    = visible.filter(b => b.status !== 'cancelled')
  const activeWeight  = activeRows.reduce((s, b) => s + Number(b.weight || 0), 0)
  const activeValue   = activeRows.reduce((s, b) => s + Number(b.weight || 0) * Number(b.rate || 0), 0)

  if (bookings.length === 0) {
    return (
      <div style={{ ...card, padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, color: t.text1, fontWeight: 700 }}>No bookings yet for this date</div>
        <div style={{ fontSize: 12.5, color: t.text3, marginTop: 8, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6, fontWeight: 500 }}>
          Tick bills in the <strong style={{ color: t.text2 }}>Bidding</strong> tab to start a booking.
          Bookings also appear in <strong style={{ color: t.text2 }}>Sales → Cal Table → Quotas</strong> on the same date.
        </div>
      </div>
    )
  }

  const th = {
    padding: '11px 14px', fontSize: 10, color: t.text3,
    letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 800,
    background: t.card2, borderBottom: `1px solid ${t.border}`,
    whiteSpace: 'nowrap', userSelect: 'none',
  }
  const td = {
    padding: '12px 14px', fontSize: 13, color: t.text2,
    verticalAlign: 'middle',
  }
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: t.text1, letterSpacing: '.01em' }}>
          Bookings <span style={{ color: t.text3, fontWeight: 700 }}>({visible.length})</span>
        </div>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: t.text2, cursor: 'pointer', fontWeight: 600 }}>
          <input type="checkbox" checked={hideCancelled} onChange={e => setHideCancelled(e.target.checked)} />
          Hide cancelled
        </label>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 40, textAlign: 'center' }}>#</th>
              <th style={th}>Party</th>
              <th style={{ ...th, textAlign: 'right' }}>Weight (g)</th>
              <th style={{ ...th, textAlign: 'right' }}>Rate (₹/g)</th>
              <th style={{ ...th, textAlign: 'right' }}>Value</th>
              <th style={{ ...th, textAlign: 'center', width: 60 }}>KL</th>
              <th style={{ ...th, textAlign: 'center', width: 120 }}>Status</th>
              <th style={{ ...th, textAlign: 'right', width: 240 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((b, i) => {
              const meta        = STATUS_META[b.status] || STATUS_META.booked
              const isCancelled = b.status === 'cancelled'
              const isFulfilled = b.status === 'fulfilled'
              const isTerminal  = isCancelled || isFulfilled
              const total       = Number(b.weight || 0) * Number(b.rate || 0)
              const dotColor    = partyColor(b.party)
              return (
                <tr key={b.id}
                  style={{
                    background: i % 2 === 1 ? `${t.card2}40` : 'transparent',
                    opacity: isCancelled ? 0.55 : 1,
                  }}>
                  <td style={{ ...td, textAlign: 'center', color: t.text4, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{i + 1}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <span style={{ color: t.text1, fontWeight: 700, textDecoration: isCancelled ? 'line-through' : 'none' }}>{b.party}</span>
                    </div>
                    {(b.purity || b.buyer_phone || b.notes) && (
                      <div style={{ fontSize: 10.5, color: t.text4, marginTop: 4, marginLeft: 17, display: 'flex', gap: 9, flexWrap: 'wrap', fontWeight: 600 }}>
                        {b.purity && <span style={{ color: t.gold }}>{b.purity}</span>}
                        {b.buyer_phone && <span style={{ fontFamily: 'monospace' }}>{b.buyer_phone}</span>}
                        {b.notes && <span title={b.notes} style={{ fontStyle: 'italic' }}>· note</span>}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 800, fontSize: 14 }}>
                    {fmt(b.weight, 2)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: t.text2 }}>
                    ₹{Number(b.rate || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.blue, fontWeight: 700 }}>
                    {fmtINR(total)}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {b.is_kl && (
                      <span style={{ background: `${t.purple}1f`, color: t.purple, borderRadius: 4, padding: '2px 9px', fontSize: 10, fontWeight: 800, letterSpacing: '.04em' }}>KL</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ background: `${meta.color}1c`, color: meta.color, border: `1px solid ${meta.color}55`, borderRadius: 99, padding: '3px 11px', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{meta.label}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
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
                    {b.created_at && (
                      <div style={{ fontSize: 9.5, color: t.text4, marginTop: 5, fontFamily: 'monospace', fontWeight: 600 }} title={`Created by ${b.created_by || 'unknown'}`}>
                        {fmtTS(b.created_at)}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {activeRows.length > 0 && (
            <tfoot>
              <tr style={{ background: `${t.gold}0d`, borderTop: `2px solid ${t.gold}55` }}>
                <td colSpan={2} style={{ ...td, fontSize: 11, color: t.gold, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800 }}>Active total</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 800, fontSize: 14 }}>
                  {fmt(activeWeight, 2)}<span style={{ fontSize: 11, marginLeft: 2, color: t.text3 }}>g</span>
                </td>
                <td style={td} />
                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.blue, fontWeight: 800 }}>{fmtINR(activeValue)}</td>
                <td colSpan={3} style={td} />
              </tr>
            </tfoot>
          )}
        </table>
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


// ── Source section — one of the four bid pools (Bangalore / Transit 24h /
// Transit 48h / Branch-Stock pre-EOD). Each renders as a self-contained
// card so the four sit cleanly in a vertical stack, always visible (even
// when empty), in the same order every load.
//
// Visual language: numbered index chip (1..4) + section icon on the left,
// section title + subtitle, total grams/bills floated right. A faint
// gradient stripe traces the accent colour across the header. Branch rows
// support checkboxes (when selectable), hover lift, and the Kerala-locking
// affordance via `branchLocked`. View-only sections (48h TAT) render rows
// dimmed with no checkboxes — they're informational.
function SourceSection({
  t, card, index, icon, title, subtitle, accent,
  branches = [], total, selectable = false, viewOnly = false,
  selected, branchLocked,
  onToggleBill, onToggleBranchAll, onToggleRegionAll, branchSelectionState,
  emptyMsg,
}) {
  const tone = accent || t.gold
  // Per-branch expand state for the bill drill-down. Keyed by branch_name
  // within this section — collapses on rerender if the branch disappears.
  const [openBranches, setOpenBranches] = useState(() => new Set())
  const toggleBranchExpand = (name) => setOpenBranches(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  // Group branches by region in insertion order (server already sorted by
  // total_net_wt within each branch list).
  const regions = (() => {
    const m = new Map()
    for (const b of branches) {
      const r = b.region || 'Unknown'
      if (!m.has(r)) m.set(r, [])
      m.get(r).push(b)
    }
    return [...m.entries()]
  })()
  const isEmpty   = branches.length === 0
  const totalBills = total?.bills  || 0
  const totalNet   = total?.net_wt || 0

  // Shared row grid — fills the horizontal extent so the columns align
  // across every branch in every section. Left column flexes; the right
  // three numeric columns + the caret are fixed.
  //   [checkbox] [name + chips ...........]  [gross]  [net]  [bills]  [▾]
  const rowGrid = '20px minmax(0, 1fr) 92px 100px 70px 22px'

  return (
    <div style={{
      ...card,
      padding: 0,
      overflow: 'hidden',
      borderRadius: 14,
      borderLeft: `3px solid ${tone}`,
      boxShadow: `0 1px 0 ${tone}1a inset, 0 1px 2px rgba(0,0,0,.18)`,
      transition: 'box-shadow .2s ease',
    }}>
      {/* Header */}
      <div style={{
        position: 'relative',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
        borderBottom: `1px solid ${t.border}40`,
        background: `linear-gradient(135deg, ${tone}14 0%, ${tone}06 38%, transparent 100%)`,
      }}>
        {/* faint hairline glow at the top edge */}
        <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, ${tone}70 0%, transparent 65%)`, pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {/* Index chip — 1..4. Pure number, no border, large accent tone. */}
          <div style={{
            width: 38, height: 38, borderRadius: 11,
            background: `${tone}24`,
            border: `1.5px solid ${tone}55`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 17, color: tone, fontFamily: 'monospace', fontWeight: 800, letterSpacing: '-.02em' }}>0{index}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {icon && <span style={{ fontSize: 16, opacity: .95 }}>{icon}</span>}
              <span style={{ fontSize: 16, color: t.text1, fontWeight: 800, letterSpacing: '.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
              {viewOnly && (
                <span style={{ fontSize: 10, color: t.text3, background: `${t.text4}24`, border: `1px solid ${t.text4}40`, borderRadius: 4, padding: '2px 8px', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>view</span>
              )}
            </div>
            {subtitle && <div style={{ fontSize: 12, color: t.text2, marginTop: 5, lineHeight: 1.5, fontWeight: 500 }}>{subtitle}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 26, color: tone, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1, letterSpacing: '-.01em' }}>{fmt(totalNet, 2)}</span>
            <span style={{ fontSize: 13, color: t.text2, fontWeight: 700 }}>g</span>
          </div>
          <div style={{ fontSize: 11, color: t.text3, marginTop: 5, letterSpacing: '.04em', fontWeight: 700 }}>{totalBills} bill{totalBills === 1 ? '' : 's'}</div>
        </div>
      </div>

      {/* Body */}
      {isEmpty ? (
        <div style={{ padding: '34px 22px', textAlign: 'center', color: t.text3, fontSize: 13, lineHeight: 1.6, fontWeight: 600 }}>
          <div style={{ fontSize: 28, opacity: .35, marginBottom: 7 }}>{icon || '·'}</div>
          {emptyMsg || 'Nothing here yet.'}
        </div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          {regions.map(([region, rows]) => {
            const rColor = REGION_COLORS[region] || t.text3
            // Region tri-state: 'all' if every bill in the region is selected,
            // 'none' if zero, 'partial' otherwise.
            const regionState = (() => {
              if (!selectable) return 'none'
              const all = rows.flatMap(r => r.bills || [])
              if (!all.length) return 'none'
              let sel = 0
              for (const b of all) if (selected?.has(b.id)) sel++
              if (sel === 0)         return 'none'
              if (sel === all.length) return 'all'
              return 'partial'
            })()
            return (
              <div key={region} style={{ padding: '11px 20px', borderTop: `1px solid ${t.border}25` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, color: rColor, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: rColor, display: 'inline-block' }} />
                    {region}
                  </span>
                  {selectable && rows.length >= 1 && (
                    <button onClick={() => onToggleRegionAll?.(rows)}
                      style={{ background: regionState === 'none' ? 'transparent' : `${rColor}14`, border: `1px solid ${regionState === 'none' ? t.border2 : `${rColor}55`}`, borderRadius: 6, color: regionState === 'none' ? t.text3 : rColor, fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em', padding: '3px 10px' }}>
                      {regionState === 'all' ? 'Clear region' : regionState === 'partial' ? 'Select rest' : 'Select all'}
                    </button>
                  )}
                </div>
                {rows.map(b => {
                  const billRows  = Array.isArray(b.bills) ? b.bills : []
                  const branchSt  = selectable ? (branchSelectionState?.(b) || 'none') : 'none'
                  const checked   = branchSt === 'all'
                  const partial   = branchSt === 'partial'
                  const locked    = selectable && branchLocked?.(b)
                  const rowCursor = !selectable ? 'default' : (locked ? 'not-allowed' : 'pointer')
                  const expanded  = openBranches.has(b.branch_name)
                  return (
                    <Fragment key={b.branch_name}>
                    <div
                      onClick={() => { if (selectable && !locked) onToggleBranchAll?.(b) }}
                      onMouseEnter={(e) => { if (selectable && !locked) e.currentTarget.style.background = `${tone}0a` }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = (checked || partial) ? `${tone}12` : 'transparent' }}
                      style={{
                        display: 'grid', gridTemplateColumns: rowGrid, alignItems: 'center',
                        columnGap: 14,
                        padding: '10px 11px', borderRadius: 8,
                        background: (checked || partial) ? `${tone}12` : 'transparent',
                        cursor: rowCursor,
                        opacity: !selectable ? 0.78 : (locked ? 0.42 : 1),
                        transition: 'background .15s ease',
                      }}>
                      {/* Col 1: checkbox — tri-state when partial */}
                      {selectable ? (
                        <span style={{
                          width: 16, height: 16, borderRadius: 4,
                          border: `1.5px solid ${(checked || partial) ? tone : t.border2}`,
                          background: checked ? tone : (partial ? `${tone}55` : 'transparent'),
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          color: checked ? '#1a0a00' : tone, fontSize: 11, fontWeight: 900,
                          transition: 'all .12s ease',
                        }}>{checked ? '✓' : (partial ? '–' : '')}</span>
                      ) : (
                        <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px dashed ${t.border}`, background: 'transparent' }} />
                      )}
                      {/* Col 2: branch name + meta chips */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, color: t.text1, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.branch_name}</span>
                        {b.tat_hours != null && (
                          <span title={`Delivery TAT ${b.tat_hours}h`} style={{ fontSize: 10.5, color: t.text3, background: `${t.text4}1c`, border: `1px solid ${t.text4}2e`, borderRadius: 4, padding: '1px 8px', whiteSpace: 'nowrap', fontWeight: 700, letterSpacing: '.03em' }}>{b.tat_hours}h TAT</span>
                        )}
                        {b.pickup_time && (
                          <span title="Branch pickup time" style={{ fontSize: 11, color: t.text3, whiteSpace: 'nowrap', fontWeight: 600 }}>· pickup {b.pickup_time}</span>
                        )}
                      </div>
                      {/* Col 3: gross weight (muted) */}
                      <span title="Gross weight" style={{ fontSize: 12.5, color: t.text2, fontFamily: 'monospace', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {fmt(b.total_gross_wt, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 2, fontWeight: 600 }}>g gross</span>
                      </span>
                      {/* Col 4: net weight (primary, accent-coloured) */}
                      <span title="Net weight" style={{ fontSize: 15, color: tone, fontFamily: 'monospace', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>
                        {fmt(b.total_net_wt, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 2, fontWeight: 600 }}>g</span>
                      </span>
                      {/* Col 5: bill count */}
                      <span style={{ fontSize: 12, color: t.text2, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap', fontWeight: 700 }}>
                        {b.total_bills} bill{b.total_bills === 1 ? '' : 's'}
                      </span>
                      {/* Col 6: expand caret — clickable independently of the row click */}
                      <span
                        onClick={(e) => { e.stopPropagation(); toggleBranchExpand(b.branch_name) }}
                        title={expanded ? 'Hide bills' : 'Show bills'}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
                          color: expanded ? tone : t.text3, fontSize: 13, fontWeight: 800,
                          background: expanded ? `${tone}18` : 'transparent',
                          border: `1px solid ${expanded ? `${tone}66` : 'transparent'}`,
                          transition: 'all .15s ease',
                          opacity: billRows.length === 0 ? 0.25 : 1,
                          pointerEvents: billRows.length === 0 ? 'none' : 'auto',
                        }}>
                        {expanded ? '▾' : '▸'}
                      </span>
                    </div>

                    {/* Bill-level drill-down — appears under the branch row */}
                    {expanded && billRows.length > 0 && (
                      <div style={{
                        marginLeft: 30, marginTop: 2, marginBottom: 8,
                        paddingLeft: 12, paddingTop: 5, paddingBottom: 5,
                        borderLeft: `2px solid ${tone}40`,
                      }}>
                        {/* Drill-down grid layout — checkbox column added at the
                            front so individual bills can be ticked/unticked.
                            Section 3 (viewOnly) renders the bills sans checkbox. */}
                        {(() => {
                          const billCols = selectable
                            ? '20px 130px minmax(0, 1fr) 100px 100px 130px'
                            : '130px minmax(0, 1fr) 100px 100px 130px'
                          const headerCols = (
                            <>
                              {selectable && <span />}
                              <span>App ID</span>
                              <span>Customer</span>
                              <span style={{ textAlign: 'right' }}>Gross</span>
                              <span style={{ textAlign: 'right' }}>Net</span>
                              <span style={{ textAlign: 'right' }}>Amount</span>
                            </>
                          )
                          return (
                            <>
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: billCols,
                                columnGap: 14, padding: '4px 8px',
                                fontSize: 10, color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800,
                              }}>
                                {headerCols}
                              </div>
                              {billRows.map((bill, idx) => {
                                const billChecked = selectable && selected?.has(bill.id)
                                return (
                                  <div key={bill.id ?? idx}
                                    onClick={() => { if (selectable && !locked) onToggleBill?.(bill.id) }}
                                    onMouseEnter={(e) => { if (selectable && !locked) e.currentTarget.style.background = `${tone}10` }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = billChecked ? `${tone}1c` : (idx % 2 === 1 ? `${t.card2}40` : 'transparent') }}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: billCols,
                                      alignItems: 'center',
                                      columnGap: 14, padding: '5px 8px', borderRadius: 5,
                                      background: billChecked ? `${tone}1c` : (idx % 2 === 1 ? `${t.card2}40` : 'transparent'),
                                      fontFamily: 'monospace', fontSize: 12,
                                      cursor: selectable ? (locked ? 'not-allowed' : 'pointer') : 'default',
                                      opacity: selectable && locked ? 0.45 : 1,
                                      transition: 'background .12s ease',
                                    }}>
                                    {selectable && (
                                      <span style={{
                                        width: 14, height: 14, borderRadius: 3,
                                        border: `1.5px solid ${billChecked ? tone : t.border2}`,
                                        background: billChecked ? tone : 'transparent',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#1a0a00', fontSize: 9, fontWeight: 900,
                                        transition: 'all .12s ease',
                                      }}>{billChecked ? '✓' : ''}</span>
                                    )}
                                    <span style={{ color: t.gold, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.application_id || '—'}</span>
                                    <span style={{ color: t.text1, fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.customer_name || '—'}</span>
                                    <span style={{ color: t.text2, textAlign: 'right', fontWeight: 600 }}>{fmt(bill.gross_weight, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 2, fontWeight: 600 }}>g</span></span>
                                    <span style={{ color: tone, textAlign: 'right', fontWeight: 800 }}>{fmt(bill.net_weight, 2)}<span style={{ fontSize: 10, color: t.text3, marginLeft: 2, fontWeight: 600 }}>g</span></span>
                                    <span style={{ color: t.blue, textAlign: 'right', fontWeight: 700 }}>{bill.total_amount != null ? `₹${Math.round(Number(bill.total_amount)).toLocaleString('en-IN')}` : '—'}</span>
                                  </div>
                                )
                              })}
                            </>
                          )
                        })()}
                      </div>
                    )}
                    </Fragment>
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
function BookingModal({ t, arrivalDate, availablePool, remainingQty, incomingNetWt, gainGrams, pendingGrams, bookedQty, selected, selectedTotal, billsById, bidders, effectiveGainRate, isKerala, onSubmit, onClose, onSuccess }) {
  // The quantity committed to a bidder is a *negotiated* figure against the
  // whole available pool (Incoming + Gain ± Pending), not the exact sum of
  // the selected source branches — ops tells a bidder "550 g", a rounded
  // commitment, then the selected branches are simply the bills that back
  // it. So: the pool is the ceiling shown up top; the selected net+gain is
  // only a one-tap *suggestion* to pre-fill the field; the operator types
  // whatever they actually committed.
  const netFromSelection = selectedTotal
  // Operator-driven weight build-up: Selected + (optional) Gains
  // + (optional) Pending from hero = Total Bidding Weight. The Bidding
  // Weight input below this defaults to that total but is editable so
  // ops can round (1457 → 1500) before committing to a bidder.
  //
  // Gains default to 3.5 % of the selected weight (the company's standard
  // refining margin — also the default in the hero Gain card). Operators
  // can override by typing a number; once they do, we stop auto-syncing.
  const DEFAULT_GAIN_RATE   = 0.035
  const liveGainRate        = (effectiveGainRate && effectiveGainRate > 0) ? effectiveGainRate : DEFAULT_GAIN_RATE
  const defaultGainGrams    = netFromSelection > 0 ? netFromSelection * liveGainRate : 0
  const [gainsEntry,        setGainsEntry]      = useState(() => defaultGainGrams > 0 ? defaultGainGrams.toFixed(2) : '')
  const [gainsEntryDirty,   setGainsEntryDirty] = useState(false)
  const [includePending,    setIncludePending]  = useState(false)
  // Auto-sync the gains field to the live default until the operator edits.
  useEffect(() => {
    if (gainsEntryDirty) return
    setGainsEntry(defaultGainGrams > 0 ? defaultGainGrams.toFixed(2) : '')
  }, [defaultGainGrams, gainsEntryDirty])
  const addedGainsW   = (() => { const n = Number(gainsEntry); return Number.isFinite(n) && n > 0 ? n : 0 })()
  const addedPendingW = includePending ? Number(pendingGrams || 0) : 0
  const totalBiddingW = Math.max(0, netFromSelection + addedGainsW + addedPendingW)
  const defaultBookingWeight = totalBiddingW
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

  // Lock the page scroll while the modal is open. The dashboard layout has
  // its own scrolling <main> element (not body), so locking body alone isn't
  // enough — wheel events still scroll <main>. We pin body+html+<main> for
  // belt-and-braces coverage.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const html = document.documentElement
    const body = document.body
    const main = document.querySelector('main')
    const prev = {
      bodyOverflow:  body.style.overflow,
      htmlOverflow:  html.style.overflow,
      mainOverflow:  main?.style.overflowY,
    }
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    if (main) main.style.overflowY = 'hidden'
    return () => {
      body.style.overflow = prev.bodyOverflow
      html.style.overflow = prev.htmlOverflow
      if (main) main.style.overflowY = prev.mainOverflow ?? 'auto'
    }
  }, [])

  // Keep booking weight in sync with the selection (× gain factor) unless
  // the operator has manually edited it.
  useEffect(() => {
    if (bookingWeightDirty) return
    setBookingWeight(defaultBookingWeight > 0 ? defaultBookingWeight.toFixed(2) : '')
  }, [defaultBookingWeight, bookingWeightDirty])

  // Unique branch names underlying the bill-level selection — used only to
  // compose the "Sources: …" audit note on submit. Selection itself
  // happens in the source-picker cards on the page; the modal is purely
  // the commitment step.
  const selectedBranchNames = (() => {
    const s = new Set()
    for (const id of selected) {
      const n = billsById?.[id]?._branch_name
      if (n) s.add(n)
    }
    return [...s].sort()
  })()

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
    const compositeNotes = selectedBranchNames.length
      ? `Sources: ${selectedBranchNames.join(', ')}`
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

  // Portal to document.body — the dashboard <main> uses overflow: clip on
  // its x-axis, which (with overflow-y: auto) creates a clipping/paint
  // context that was swallowing the modal even though it's position: fixed.
  // Rendering at the body level guarantees the overlay reaches the viewport
  // edges regardless of where this component lives in the tree.
  if (typeof document === 'undefined') return null
  return createPortal((
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, overflow: 'auto',
      animation: 'bidModalOverlayIn .18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 580, maxHeight: '92vh',
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,.4)',
        display: 'flex', flexDirection: 'column',
        animation: 'bidModalIn .25s cubic-bezier(.34,1.2,.64,1)',
      }}>
        {/* Header — compact single row: title · arrival pill · KL badge */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.text1, letterSpacing: '-.01em' }}>New Booking</div>
            <span style={{ fontSize: 10.5, color: t.text3, background: `${t.gold}10`, border: `1px solid ${t.gold}28`, borderRadius: 99, padding: '3px 10px', fontWeight: 700, letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
              Arrival · {fmtDate(arrivalDate)}
            </span>
          </div>
          {isKerala && (
            <span style={{ fontSize: 9.5, color: t.green, background: `${t.green}18`, border: `1px solid ${t.green}40`, borderRadius: 99, padding: '3px 10px', fontWeight: 800, letterSpacing: '.08em', whiteSpace: 'nowrap' }}>
              KL · KERALA
            </span>
          )}
        </div>

        {/* Body — scrolls only if absolutely needed; sized to fit ≥720 px viewports */}
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>

          {/* ── Weight build-up — Selected + (optional Gains) + (optional
              Pending) = Total Bidding Weight. Each addend is on its own
              row so ops can see exactly what's feeding the total. The
              committed-weight input below this is what actually ships to
              the booking; it pre-fills from the total but can be rounded. */}
          {(() => {
            const pendingAvailable = Number(pendingGrams || 0) !== 0
            // Row helper — leading slot can render either a plain operator
            // glyph (+/=) or a custom node (the checkbox on the pending row).
            const row = (label, value, opts = {}) => (
              <div style={{ display: 'grid', gridTemplateColumns: `24px minmax(0,1fr) ${opts.editable ? '116px' : '128px'}`, alignItems: 'center', gap: 10, padding: '4px 0' }}>
                {opts.symbolNode != null
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{opts.symbolNode}</span>
                  : <span style={{ fontSize: 16, color: opts.faded ? t.text4 : t.text2, fontWeight: 800, textAlign: 'center', fontFamily: 'monospace' }}>{opts.symbol || ''}</span>
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
                  {opts.hint && <div style={{ fontSize: 10, color: t.text4, marginTop: 1, fontWeight: 500, lineHeight: 1.35 }}>{opts.hint}</div>}
                </div>
                {value}
              </div>
            )
            const purpleTone = t.purple || '#8c5ac8'
            const pendingCheckbox = (
              <button type="button"
                onClick={() => pendingAvailable && setIncludePending(v => !v)}
                disabled={!pendingAvailable}
                aria-checked={includePending}
                title={pendingAvailable
                  ? (includePending ? 'Exclude pending from this booking' : 'Include pending in this booking')
                  : 'No carry-over for this date'}
                style={{
                  width: 20, height: 20, borderRadius: 5, padding: 0,
                  border: `1.8px solid ${includePending ? purpleTone : (pendingAvailable ? t.border2 : t.border)}`,
                  background: includePending ? purpleTone : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  cursor: pendingAvailable ? 'pointer' : 'not-allowed',
                  opacity: pendingAvailable ? 1 : 0.5,
                  color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: 1,
                  transition: 'all .12s ease',
                }}>{includePending ? '✓' : ''}</button>
            )
            return (
              <div style={{
                background: `linear-gradient(150deg, ${t.gold}10, ${t.gold}04 55%, transparent)`,
                border: `1px solid ${t.gold}30`,
                borderRadius: 12, padding: '10px 14px',
              }}>
                {/* Selected weight — read-only, from selection */}
                {row('Selected weight',
                  <span style={{ textAlign: 'right', color: t.text1, fontSize: 16, fontWeight: 800, fontFamily: 'monospace' }}>{fmt(netFromSelection, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 3 }}>g</span></span>,
                  { hint: `${selected.size} bill${selected.size === 1 ? '' : 's'} ticked`, symbol: '' })}

                <div style={{ height: 1, background: `${t.border}60`, margin: '2px 0' }} />

                {/* + Gains — defaults to 3.5 % of selected, overrideable */}
                {row('Add gains',
                  <input type="number" step="0.01" min="0" value={gainsEntry}
                    onChange={e => { setGainsEntry(e.target.value); setGainsEntryDirty(true) }}
                    onDoubleClick={() => setGainsEntryDirty(false)}
                    placeholder="0.00"
                    inputMode="decimal"
                    title={gainsEntryDirty ? `Double-click to reset to ${(liveGainRate * 100).toFixed(2)} % default` : `Default: ${(liveGainRate * 100).toFixed(2)} % of selected weight`}
                    style={{
                      ...inputStyle(t), padding: '5px 10px', fontSize: 13.5,
                      fontFamily: 'monospace', fontWeight: 700,
                      textAlign: 'right',
                      color: addedGainsW > 0 ? (t.orange || '#e58a3b') : t.text3,
                      borderColor: addedGainsW > 0 ? `${(t.orange || '#e58a3b')}55` : t.border,
                    }} />,
                  { symbol: '+', faded: addedGainsW === 0, hint: gainsEntryDirty
                      ? `manual override · default ${(liveGainRate * 100).toFixed(2)} %`
                      : `default ${(liveGainRate * 100).toFixed(2)} % of selected · type to override` })}

                {/* + Pending — checkbox decides whether the hero's pending
                    carry-over enters this booking. Value column shows the
                    signed amount in muted text. */}
                {row('Add pending delivery',
                  <span style={{
                    textAlign: 'right',
                    fontSize: 14, fontFamily: 'monospace', fontWeight: 700,
                    color: includePending ? purpleTone : t.text3,
                    opacity: pendingAvailable ? 1 : 0.5,
                  }}>
                    {includePending
                      ? `${pendingGrams > 0 ? '+' : pendingGrams < 0 ? '−' : ''}${fmt(Math.abs(pendingGrams), 2)}`
                      : (pendingAvailable ? `${pendingGrams > 0 ? '+' : '−'}${fmt(Math.abs(pendingGrams), 2)}` : '0.00')}
                    <span style={{ fontSize: 10, color: t.text4, marginLeft: 3, fontWeight: 600 }}>g</span>
                  </span>,
                  { symbolNode: pendingCheckbox, hint: pendingAvailable
                      ? (includePending ? 'included — uncheck to remove' : 'tick to include in this booking')
                      : 'no carry-over for this date' })}

                <div style={{ height: 1, background: `${t.gold}55`, margin: '4px 0 0' }} />

                {/* = Total Bidding Weight — computed, large */}
                {row('Total bidding weight',
                  <span style={{ textAlign: 'right', color: t.gold, fontSize: 22, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '-.015em', lineHeight: 1 }}>
                    {fmt(totalBiddingW, 2)}<span style={{ fontSize: 13, color: t.text3, marginLeft: 3 }}>g</span>
                  </span>,
                  { symbol: '=' })}
              </div>
            )
          })()}

          {/* Inputs row — Bidding Weight + Rate side-by-side. Weight defaults
              to the breakdown's total (operator can round 1457 → 1500). Rate
              is per-gram. Total Value renders inline in the footer button so
              we don't waste a card on it. */}
          <div className="bidStagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
              {/* Bidding weight */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,.4)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Bidding weight · round-off</span>
                  {totalBiddingW > 0 && Math.abs(Number(bookingWeight || 0) - totalBiddingW) > 0.005 && (
                    <button type="button"
                      onClick={() => { setBookingWeight(totalBiddingW.toFixed(2)); setBookingWeightDirty(true) }}
                      title={`Reset to total · ${fmt(totalBiddingW, 2)} g`}
                      style={{
                        background: `${t.gold}18`, border: `1px solid ${t.gold}55`,
                        borderRadius: 99, padding: '2px 8px', fontSize: 9.5, fontWeight: 800,
                        color: t.gold, cursor: 'pointer', letterSpacing: '.02em',
                        transition: 'background .15s ease', whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${t.gold}28` }}
                      onMouseLeave={e => { e.currentTarget.style.background = `${t.gold}18` }}>
                      ↺ reset · {fmt(totalBiddingW, 2)} g
                    </button>
                  )}
                </span>
                <input value={bookingWeight} className="bidInput"
                  onChange={e => { setBookingWeight(e.target.value.replace(/[^\d.]/g, '')); setBookingWeightDirty(true) }}
                  placeholder="e.g. 1500"
                  inputMode="decimal"
                  style={{ ...inputStyle(t), fontFamily: 'monospace', fontSize: 17, fontWeight: 800, padding: '10px 12px', color: wouldOverbook ? t.red : t.gold, borderColor: wouldOverbook ? `${t.red}66` : (wValid ? `${t.gold}66` : t.border) }} />
              </label>

              {/* Rate */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,.4)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Rate · ₹ / g</span>
                <input value={rate} className="bidInput"
                  onChange={e => setRate(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="7250.00"
                  inputMode="decimal"
                  style={{ ...inputStyle(t), fontFamily: 'monospace', fontSize: 17, fontWeight: 800, padding: '10px 12px', color: Number(rate) > 0 ? t.blue : t.text3, borderColor: Number(rate) > 0 ? `${t.blue}66` : t.border }} />
              </label>
            </div>

            {/* Live equation — Weight × Rate = ₹ Total. Subtle inline strip
                (replaces the bulky Total Value card). */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              background: total > 0 ? `linear-gradient(90deg, ${t.blue}10, ${t.blue}04)` : t.card2,
              border: `1px solid ${total > 0 ? `${t.blue}30` : t.border}`,
              borderRadius: 10, padding: '8px 14px',
              transition: 'background .25s ease, border-color .25s ease',
            }}>
              <span style={{ fontSize: 11, color: t.text3, fontFamily: 'monospace', fontWeight: 700 }}>
                {wValid ? fmt(w, 2) : '—'} <span style={{ color: t.text4 }}>g</span>
                <span style={{ color: t.text4, margin: '0 6px' }}>×</span>
                {Number(rate) > 0 ? `₹${fmt(Number(rate), 2)}` : '—'}
                <span style={{ color: t.text4, margin: '0 6px' }}>=</span>
              </span>
              <span key={Math.round(total)} style={{ fontSize: 18, color: total > 0 ? t.blue : t.text4, fontFamily: 'monospace', fontWeight: 800, letterSpacing: '-.015em', animation: total > 0 ? 'bidFadeIn .22s ease' : 'none' }}>
                {total > 0 ? fmtINR(total) : '—'}
              </span>
            </div>

            {/* Bidder — last because party gets picked AFTER the rate
                lands (highest-rate-wins). Dropdown stays collapsed until
                the operator clicks the caret or starts typing. */}
            <Field label="Bidder">
              <BidderCombobox
                t={t}
                value={party}
                onChange={setParty}
                options={allBidders}
                onAddNew={(name) => { setParty(name); saveNewBidder() }}
              />
            </Field>

          </div>
        </div>

        {/* Footer — sticky, with inline overbook warning chip when relevant */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${t.border}`, background: t.card2, flexShrink: 0 }}>
          {wouldOverbook && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9,
              fontSize: 10.5, color: t.red, fontWeight: 700, letterSpacing: '.02em',
            }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: t.red }} />
              Overbook · this exceeds the free pool ({fmt(Math.max(0, freePool), 2)} g)
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ flex: 1, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 8, padding: '11px 14px', fontSize: 12.5, color: t.text2, cursor: 'pointer', fontWeight: 700 }}>
              Cancel
            </button>
            <button onClick={submit} disabled={!valid || busy}
              style={{
                flex: 2.4,
                background: valid && !busy ? t.gold : t.card2,
                color: valid && !busy ? '#1a0a00' : t.text4,
                border: 'none', borderRadius: 8, padding: '11px 14px',
                fontSize: 13, fontWeight: 800, letterSpacing: '.03em',
                cursor: valid && !busy ? 'pointer' : 'not-allowed',
                boxShadow: valid && !busy ? `0 2px 8px ${t.gold}50` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              {busy
                ? 'Creating…'
                : (<>
                    <span>Create Booking</span>
                    {total > 0 && <span style={{ fontFamily: 'monospace', fontWeight: 900, opacity: .85 }}>· {fmtINR(total)}</span>}
                  </>)
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}

function CancelModal({ t, booking, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (typeof document === 'undefined') return null
  return createPortal((
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2000,
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
  ), document.body)
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
