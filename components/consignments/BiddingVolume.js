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
import { istToday, addWorkingDaysSkipSunday } from '../../lib/dateIst'

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
  const { theme, setActiveNav, setConsignmentDeepLink } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const today    = istToday()
  const tomorrow = dateAdd(today, 1)
  // Default arrival = next WORKING day (Sunday skipped — BVC logistics is off).
  // Without this, bidding on a Saturday would target Sunday arrival, which
  // no logistics partner can hit. A 24h-TAT bill dispatched Saturday lands
  // Monday, not Sunday — keeping the default Sunday-aware makes Section 2
  // ("24h TAT, arriving tomorrow") match what the truck actually delivers.
  const defaultArrival = addWorkingDaysSkipSunday(today, 1)

  const [arrivalDate,  setArrivalDate]  = useState(defaultArrival)
  // Bookings tab pivots on bidding day (the date the booking was placed),
  // separate from arrivalDate. Defaults to today so the freshly-placed
  // bookings show up. ← / → step through past bidding days; the hero +
  // Bidding tab stay locked to tomorrow's arrival.
  const [bookingsDate, setBookingsDate] = useState(today)
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
  // Outer region tab — 'ka_ap_ts' = Bangalore + outstation pool (the
  // historical default), 'kl' = Kerala-only pool with its own 3-section
  // taxonomy (S1 hub stock, S2 leaf→hub in movement, S3 leaf at_branch).
  // Each tab carries its own KPI strip, source picker, and bookings filter,
  // but shares the same arrivalDate / bookingsDate / poll cycle.
  const [regionTab, setRegionTab] = useState('ka_ap_ts')
  // Section navigator — ops view ONE section at a time ('1'..'7'); the
  // stacked "ALL" view was removed. KA·AP·TS tab only.
  const [activeSection, setActiveSection] = useState('1')
  // Source selection — branches the ops team has ticked from the inline
  // picker. Keys are `B:<branch_name>` for Bangalore, `T:<branch_name>` for
  // outside in-transit. Lifted to the parent so the contextual CTA, the
  // KPI summary, and the modal all share the same selection.
  const [selected,     setSelected]     = useState(() => new Set())
  // Reset selection when the arrival date changes — selections are date-
  // specific (a YELAHANKA shipment for 13 May isn't the same as 14 May's).
  useEffect(() => { setSelected(new Set()) }, [arrivalDate])
  // Reset selection when the region tab flips — KA·AP·TS and KL pools are
  // mutually exclusive (booking modal can only commit against one at a time),
  // so the safest behaviour is to start fresh.
  useEffect(() => { setSelected(new Set()); setActiveSection('1') }, [regionTab])

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
        // Bookings use bidding_date (created_at IST) — so the operator sees
        // bookings on the day they were placed, not the arrival day.
        authedFetch(`/api/consignments?action=bidding_bookings&bidding_date=${bookingsDate}`),
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
  }, [arrivalDate, bookingsDate])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Auto-refresh poll ──────────────────────────────────────────────────────
  // The page silently re-fetches supply + bookings every 30 s so the numbers
  // stay live without the operator hitting Refresh. PAUSED whenever a bill
  // selection or a modal is in progress — refreshing the data underneath an
  // operator mid-booking would shift the very rows they're acting on. The
  // moment they finish (clear the selection / close the modal) polling
  // resumes with an immediate catch-up fetch so they're not stuck on stale
  // numbers for up to 30 s.
  const pollPaused = selected.size > 0 || showBookModal || cancelTarget != null || editingGain || editingPending
  const pollPausedRef = useRef(pollPaused)
  const wasPausedRef   = useRef(pollPaused)
  useEffect(() => {
    pollPausedRef.current = pollPaused
    // paused → active transition: catch up right away.
    if (wasPausedRef.current && !pollPaused) fetchAll(true)
    wasPausedRef.current = pollPaused
  }, [pollPaused, fetchAll])
  useEffect(() => {
    const id = setInterval(() => {
      if (pollPausedRef.current) return
      if (typeof document !== 'undefined' && document.hidden) return  // skip when tab backgrounded
      fetchAll(true)                                                   // silent — keeps numbers on screen
    }, 30000)
    return () => clearInterval(id)
  }, [fetchAll])

  // Persist Pending Delivery for this arrival date, then refetch so the
  // recomputed pool (and every other device on next poll) reflects it.
  const savePending = useCallback(async (gramsRaw) => {
    // Coerce at the boundary — callers pass numbers today, but a bad value
    // must fail loud, not send NaN to the API or throw on .toFixed.
    const grams = Number(gramsRaw)
    if (!Number.isFinite(grams)) {
      setToast({ msg: 'Pending Delivery must be a number', type: 'error', key: Date.now() })
      setTimeout(() => setToast(null), 3500)
      return false
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
      return true
    } catch (e) {
      setToast({ msg: `Couldn't save Pending Delivery: ${String(e?.message || e)}`, type: 'error', key: Date.now() })
      setTimeout(() => setToast(null), 3500)
      return false
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
  // Bookings filtered to the active region tab — the Bookings sub-tab and
  // the inactive-tab chip both read this so KA·AP·TS only sees non-KL rows
  // and the KL tab only sees its own.
  const tabBookings     = useMemo(
    () => bookings.filter(b => regionTab === 'kl' ? !!b.is_kl : !b.is_kl),
    [bookings, regionTab]
  )
  const tabActiveBookings = useMemo(() => tabBookings.filter(b => b.status !== 'cancelled'), [tabBookings])
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

  // Pipeline-booked aggregate — the portion of existing bookings still
  // owed against FUTURE incoming bills (decrements as pipeline auto-
  // attach fires). For old bookings without the breakdown columns we
  // derive from (weight − attached_bills − gain − pending).
  //
  // Why this matters: the older math (Available − Booked) double-
  // counted attached bills. When a bill gets attached to a booking,
  // Incoming already excludes it (booking_id IS NOT NULL filter) AND
  // the booking's full committed weight was being subtracted again —
  // making the pool look overbooked by exactly the attached weight.
  //
  // Correct math:
  //   Available − Pipeline = Remaining (capacity for new bookings)
  // The attached portion is already netted out of Incoming, so the only
  // future claim on Available is the uncovered pipeline. Pipeline comes
  // straight from the API's derived gain model (derived_pipeline_g) —
  // 0 once a booking's arrival day has passed.
  const pipelineFor = (b) => Number(b.derived_pipeline_g) || 0
  const pipelineKLG       = activeBookings.filter(b => b.is_kl).reduce((s, b) => s + pipelineFor(b), 0)
  const pipelineOtherG    = activeBookings.filter(b => !b.is_kl).reduce((s, b) => s + pipelineFor(b), 0)
  const pipelineTotalG    = pipelineKLG + pipelineOtherG

  // ── Regional split — Bangalore & Others vs Kerala ─────────────────────────
  // The two regions have separate supply chains and separate pipeline
  // mechanics, so the hero strip splits into two rows.
  //
  // Bangalore & Others Hero = Section 1 (Bangalore today) + non-Kerala
  // Section 2 (24h transit). Section 4 (branch stock pre-EOD) is NOT
  // counted in the hero math — those bills only enter the booking when
  // the operator explicitly picks them. Per ops spec.
  //
  // Kerala Hero = Kerala bills wherever they appear in supply — both
  // Section 2 (rare: Kerala 24h transit) and Section 4 (the common
  // case: hub at_branch stock waiting for EOD dispatch). Section 1 is
  // Bangalore-only so it contributes nothing here.
  const s2BranchesAll = supply?.transit_24h?.branches    || supply?.in_transit?.branches || []
  const s4BranchesAll = supply?.branch_pre_eod?.branches || []
  const sumWt    = (arr) => arr.reduce((s, b) => s + Number(b.total_net_wt   || 0), 0)
  const sumGross = (arr) => arr.reduce((s, b) => s + Number(b.total_gross_wt || 0), 0)
  const sumBills = (arr) => arr.reduce((s, b) => s + Number(b.total_bills    || 0), 0)
  const isKL = (b) => b.region === 'Kerala'

  // Kerala "certain pool" for tomorrow = S1 hub stock + S2 in-movement to hub.
  // S3 (still at leaf) is contingent on the leaf→hub pickup actually firing
  // today — excluded from Incoming by default; operator ticks manually.
  // Reads supply directly (not the picker-side klS*Total consts) so this
  // block can sit anywhere in render order without a TDZ issue.
  const _klS1   = supply?.kerala_sections?.s1_hub_stock?.total   || {}
  const _klS1Lf = supply?.kerala_sections?.s1_hub_stock?.received_from_leaf?.total || {}
  const _klS2   = supply?.kerala_sections?.s2_in_movement?.total || {}
  const klSupplyNet   = Number(_klS1.net_wt   || 0) + Number(_klS1Lf.net_wt   || 0) + Number(_klS2.net_wt   || 0)
  const klSupplyGross = Number(_klS1.gross_wt || 0) + Number(_klS1Lf.gross_wt || 0) + Number(_klS2.gross_wt || 0)
  const klSupplyBills = Number(_klS1.bills    || 0) + Number(_klS1Lf.bills    || 0) + Number(_klS2.bills    || 0)

  // Others — S1 (all Bangalore) + non-Kerala S2 only. S4 is intentionally
  // omitted; those bills only count when explicitly selected. Filter
  // s2BranchesAll inline (rather than reading the picker-side inTBranches
  // const) so this block stays free of TDZ-bound references.
  const othersSupplyNet   = s1Net   + sumWt(s2BranchesAll.filter(b => !isKL(b)))
  const othersSupplyGross = s1Gross + sumGross(s2BranchesAll.filter(b => !isKL(b)))
  const othersSupplyBills = s1Bills + sumBills(s2BranchesAll.filter(b => !isKL(b)))

  // Gain — Kerala default is 0 % (leaf→hub flow already absorbs refining
  // loss upstream). Others use the standard 3.5 % (or the operator's
  // global override, which applies to Others only).
  const othersGain   = gainOverrideGrams != null
    ? gainOverrideGrams
    : othersSupplyNet * (gainRatePct / 100)
  const klGain       = 0

  // Pending Delivery — global per arrival_date; attributed to Others by
  // convention (Bangalore-side carry-over is the common case).
  const othersPending = pendingGrams
  const klPending     = 0

  // Booked + pipeline — split by is_kl flag on the cal_quotas row.
  const klBookedQty    = activeBookings.filter(b =>  b.is_kl).reduce((s, b) => s + Number(b.weight || 0), 0)
  const othersBookedQty = bookedQty - klBookedQty
  const klBookedValue   = activeBookings.filter(b =>  b.is_kl).reduce((s, b) => s + Number(b.weight || 0) * Number(b.rate || 0), 0)
  const othersBookedValue = bookedValue - klBookedValue
  const klBookings      = activeBookings.filter(b =>  b.is_kl).length
  const othersBookings  = activeBookings.length - klBookings

  // Regional Available / Remaining — same formula as global, applied to
  // each region's slice.
  const klAvailable     = klSupplyNet + klGain + klPending
  const othersAvailable = othersSupplyNet + othersGain + othersPending
  const klRemaining     = klAvailable     - pipelineKLG
  const othersRemaining = othersAvailable - pipelineOtherG
  const klOverbooked      = klAvailable >= 0 && pipelineKLG > 0 && klRemaining < 0
  const othersOverbooked  = othersAvailable >= 0 && pipelineOtherG > 0 && othersRemaining < 0

  const remainingQty    = availablePool - pipelineTotalG
  const bookedPct       = availablePool > 0 ? Math.min(100, (pipelineTotalG / availablePool) * 100) : 0

  // Two distinct deficit states — they were conflated before, which made a
  // −Pending with zero bookings wrongly read as "Bookings exceed pool":
  //   poolNegative — the pool itself is underwater because the Pending
  //                  pull-back exceeds Incoming + Gain. Independent of
  //                  bookings; there's simply nothing to bid.
  //   overbooked   — pipeline commitments exceed what the current pool
  //                  can absorb. Real overbook risk now that the math
  //                  ignores the already-attached bills.
  const poolNegative    = availablePool < 0
  const overbooked      = !poolNegative && pipelineTotalG > 0 && remainingQty < 0

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
        label:  'Pipeline Over',
        num:    Math.abs(remainingQty), prefix: '−',
        sub:    `Pipeline owes ${fmt(Math.abs(remainingQty), 2)} g more than the pool can supply`,
        accent: t.red, alert: true,
      }
    : {
        label:  'Remaining',
        num:    remainingQty, prefix: '',
        sub:    pipelineTotalG > 0
                  ? `After pipeline back-fill · ${availablePool > 0 ? Math.round(100 - bookedPct) : 0}% of pool free`
                  : `Full pool free · no pipeline commitments`,
        accent: t.green, alert: false,
      }

  // Source picker helpers — shared between the inline picker and the modal.
  // Four sections feed the bid:
  //   1. Bangalore Today           (B: prefix)  selectable
  //   2. In-Transit 24h TAT        (T: prefix)  selectable — arrives tomorrow
  //   3. In-Transit 48h TAT                     view-only  — arrives day after
  //   4. Branch Stock pre-EOD      (P: prefix)  selectable — moves today
  // KA·AP·TS source picker — Kerala bills are filtered OUT here because
  // they now live on their own tab. Non-Kerala bills (Bangalore S1, KA/AP/TS
  // S2/S3/S4) are unchanged.
  const bangBranches   = supply?.bangalore?.branches      || []
  const inTBranchesRaw = supply?.transit_24h?.branches    || supply?.in_transit?.branches || []
  const t48hBranchesRaw = supply?.transit_48h?.branches   || []
  const t72hBranchesRaw = supply?.transit_72h?.branches   || []
  const preEodBranchesRaw = supply?.branch_pre_eod?.branches || []
  const pendBookRaw    = supply?.consignment_pending_booking?.branches || []
  const bangPendRaw    = supply?.bangalore_pending_booking?.branches    || []
  const bookedPendRaw  = supply?.booked_pending_dispatch?.branches      || []
  const inTBranches    = useMemo(() => inTBranchesRaw.filter(b => b.region !== 'Kerala'),    [inTBranchesRaw])
  // Consignment-created-but-booking-pending bills — already non-Kerala
  // server-side, but filter defensively to match the rest of this tab.
  const pendBookBranches = useMemo(() => pendBookRaw.filter(b => b.region !== 'Kerala'), [pendBookRaw])
  // Bangalore counterpart — feeds Section 1's consolidated sub-group.
  const bangPendBranches = useMemo(() => bangPendRaw, [bangPendRaw])
  const t48hBranches   = useMemo(() => t48hBranchesRaw.filter(b => b.region !== 'Kerala'),   [t48hBranchesRaw])
  const t72hBranches   = useMemo(() => t72hBranchesRaw.filter(b => b.region !== 'Kerala'),   [t72hBranchesRaw])
  const preEodBranches = useMemo(() => preEodBranchesRaw.filter(b => b.region !== 'Kerala'), [preEodBranchesRaw])
  // Section 6 — booked but consignment not created (Red Flag). View-only;
  // server already partitions this to non-Kerala (KL has its own slice).
  const bookedPendBranches = useMemo(() => bookedPendRaw, [bookedPendRaw])
  const dayAfterArrivalDate  = supply?.day_after_arrival   || null
  const dayAfter2ArrivalDate = supply?.day_after_2_arrival || null

  // Region-consistent section totals. The KA·AP·TS tab hides Kerala branch
  // rows (Kerala has its own KL tab), but the API's *.total / *.booked figures
  // are region-agnostic (all outside-Bangalore incl. Kerala). Feeding those raw
  // totals into the hero cards made Kerala bills (e.g. KL-THRISSUR) show up as
  // "Unbooked / Available to Book" with NO rows beneath them. Sum the metrics
  // from the same Kerala-filtered branch lists the rows actually render.
  const sumBranches = (arr) => (arr || []).reduce((a, b) => ({
    bills:    a.bills    + (b.total_bills    || 0),
    gross_wt: a.gross_wt + (b.total_gross_wt || 0),
    net_wt:   a.net_wt   + (b.total_net_wt   || 0),
    amount:   a.amount   + (b.total_amount   || 0),
  }), { bills: 0, gross_wt: 0, net_wt: 0, amount: 0 })
  const dropKL = (arr) => (arr || []).filter(b => b.region !== 'Kerala')
  const t24Booked    = useMemo(() => dropKL(supply?.transit_24h?.booked?.branches),    [supply])
  const t48Booked    = useMemo(() => dropKL(supply?.transit_48h?.booked?.branches),    [supply])
  const t72Booked    = useMemo(() => dropKL(supply?.transit_72h?.booked?.branches),    [supply])
  const preEodBooked = useMemo(() => dropKL(supply?.branch_pre_eod?.booked?.branches), [supply])

  // Per-section metric cards (Total / Booked / Unbooked / Gain / Available).
  // Total = booked + unbooked; gain mirrors the % rate but is applied to the
  // UNBOOKED portion only, so Available to Book = Unbooked + its gain.
  // Per-section absolute gain override (grams), keyed by section index. When
  // set, that section's gain = the override instead of unbooked × rate.
  const [sectionGainGrams, setSectionGainGrams] = useState({})
  useEffect(() => { setSectionGainGrams({}) }, [arrivalDate, regionTab])

  const sectionMetrics = (unbookedNet, bookedNet, idx) => {
    const u = Number(unbookedNet || 0)
    const b = Number(bookedNet || 0)
    const ov = idx != null ? sectionGainGrams[idx] : null
    const gain = ov != null ? Number(ov) : u * (gainRatePct / 100)
    return { totalNet: u + b, bookedNet: b, unbookedNet: u, gainNet: gain, availableNet: u + gain, rate: gainRatePct, gainOverride: ov != null ? Number(ov) : null }
  }
  // Editing the gain % from a section sets the shared company rate and clears
  // that section's absolute override so the rate applies again.
  const handleSectionRate = (idx, pct) => {
    setSectionGainGrams(o => { const n = { ...o }; delete n[idx]; return n })
    setGainOverrideGrams(null); setGainRatePct(pct)
  }
  // Editing the gain in grams sets a per-section absolute override.
  const handleSectionGainGrams = (idx, g) => setSectionGainGrams(o => ({ ...o, [idx]: g }))

  // KL has no gain, so Available to Book = Unbooked Net. These build the metric
  // strip for the Kerala sections with gain forced to 0 (the company % rate that
  // sectionMetrics applies must NOT leak into the Kerala pool).
  const klMetrics = (netWt) => {
    const u = Number(netWt || 0)
    return { totalNet: u, bookedNet: 0, unbookedNet: u, gainNet: 0, availableNet: u, rate: 0, gainOverride: null }
  }
  const klBookedMetrics = (netWt) => {
    const b = Number(netWt || 0)
    return { totalNet: b, bookedNet: b, unbookedNet: 0, gainNet: 0, availableNet: 0, rate: 0, gainOverride: null }
  }

  // KL tab source picker — five sections from the kerala_sections payload,
  // mirroring the KA·AP·TS section layout.
  const klSections      = supply?.kerala_sections || {}
  const klS1Branches    = klSections.s1_hub_stock?.branches   || []                       // S1 hub-origin
  const klS1LeafBranches= klSections.s1_hub_stock?.received_from_leaf?.branches || []      // S1 received-from-leaf
  const klS2Branches    = klSections.s2_in_movement?.branches || []                       // S2 leaf→hub in movement
  const klS3Branches    = klSections.s3_created_not_booked?.branches || []                 // S3 consignment, not booked
  const klS4Branches    = klSections.s4_booked_pending?.branches || []                     // S4 booked, no consignment
  const klS5Branches    = klSections.s5_at_leaf?.branches     || []                        // S5 at leaf, dispatch pending
  const klS1Total       = klSections.s1_hub_stock?.total      || { bills: 0, gross_wt: 0, net_wt: 0 }
  const klS1LeafTotal   = klSections.s1_hub_stock?.received_from_leaf?.total || { bills: 0, gross_wt: 0, net_wt: 0 }
  const klS2Total       = klSections.s2_in_movement?.total    || { bills: 0, gross_wt: 0, net_wt: 0 }
  const klS3Total       = klSections.s3_created_not_booked?.total || { bills: 0, gross_wt: 0, net_wt: 0 }
  const klS4Total       = klSections.s4_booked_pending?.total || { bills: 0, gross_wt: 0, net_wt: 0 }
  const klS5Total       = klSections.s5_at_leaf?.total        || { bills: 0, gross_wt: 0, net_wt: 0 }
  // Section 2 "Branch → Hub" = in-movement runs + bills already received at hub,
  // shown as ONE card (both are the branch→hub flow, just at different stages).
  const klS2Merged      = [...klS2Branches, ...klS1LeafBranches]
  const klS2MergedTotal = {
    bills:    (klS2Total.bills    || 0) + (klS1LeafTotal.bills    || 0),
    gross_wt: (klS2Total.gross_wt || 0) + (klS1LeafTotal.gross_wt || 0),
    net_wt:   (klS2Total.net_wt   || 0) + (klS1LeafTotal.net_wt   || 0),
  }
  // Hubs that already cut their hub→HO E-invoice today — their incoming
  // bills (S1 + S2) have been server-side excluded from this bid because
  // they'll ride tomorrow's truck. Surfaced as a banner above the picker.
  const klHubsDispatchedToday = klSections.hubs_dispatched_today || []
  // Branch metadata lookup — used for region/Kerala-locking helpers + the
  // booking modal's chip display. Keyed by branch_name (no prefix needed now
  // that the selection is bill-level).
  const branchesByKey = useMemo(() => {
    const m = {}
    for (const b of bangBranches)     m[b.branch_name] = { ...b, group: 'bangalore' }
    for (const b of inTBranches)      m[b.branch_name] = { ...b, group: 'transit_24h' }
    for (const b of t48hBranches)     m[b.branch_name] = { ...b, group: 'transit_48h' }
    for (const b of t72hBranches)     m[b.branch_name] = { ...b, group: 'transit_72h' }
    for (const b of pendBookBranches) m[b.branch_name] = { ...b, group: 'transit_pending_booking' }
    for (const b of bangPendBranches) m[b.branch_name] = { ...b, group: 'bangalore_pending_booking' }
    for (const b of preEodBranches)   m[b.branch_name] = { ...b, group: 'branch_pre_eod' }
    // Kerala-tab buckets — five sections, keyed by branch_name.
    for (const b of klS1Branches)     m[b.branch_name] = { ...b, group: 'kl_hub_stock' }
    for (const b of klS1LeafBranches) m[b.branch_name] = { ...b, group: 'kl_hub_from_leaf' }
    for (const b of klS2Branches)     m[b.branch_name] = { ...b, group: 'kl_in_movement' }
    for (const b of klS3Branches)     m[b.branch_name] = { ...b, group: 'kl_created_not_booked' }
    for (const b of klS5Branches)     m[b.branch_name] = { ...b, group: 'kl_at_leaf' }
    return m
  }, [bangBranches, inTBranches, t48hBranches, t72hBranches, pendBookBranches, bangPendBranches, preEodBranches, klS1Branches, klS1LeafBranches, klS2Branches, klS3Branches, klS5Branches])

  // Bill-level catalogue across every selectable section in either tab.
  // Tagging via _group lets autoSelectRemaining + selectionMode + branchLocked
  // segregate KA·AP·TS bills (bangalore / transit_24h / branch_pre_eod) from
  // KL bills (kl_hub_stock / kl_in_movement / kl_at_leaf).
  const billsById = useMemo(() => {
    const m = {}
    const collect = (branches, group) => {
      for (const b of branches || []) {
        for (const bill of b.bills || []) {
          m[bill.id] = { ...bill, _branch_name: b.branch_name, _region: b.region || null, _group: group }
        }
      }
    }
    collect(bangBranches,     'bangalore')
    collect(inTBranches,      'transit_24h')
    collect(t48hBranches,     'transit_48h')
    collect(t72hBranches,     'transit_72h')
    collect(pendBookBranches, 'transit_pending_booking')
    collect(bangPendBranches, 'bangalore_pending_booking')
    collect(preEodBranches,   'branch_pre_eod')
    collect(klS1Branches,     'kl_hub_stock')
    collect(klS1LeafBranches, 'kl_hub_from_leaf')
    collect(klS2Branches,     'kl_in_movement')
    collect(klS3Branches,     'kl_created_not_booked')
    collect(klS5Branches,     'kl_at_leaf')
    return m
  }, [bangBranches, inTBranches, t48hBranches, t72hBranches, pendBookBranches, bangPendBranches, preEodBranches, klS1Branches, klS1LeafBranches, klS2Branches, klS3Branches, klS5Branches])

  const selectedTotal = useMemo(() => {
    let s = 0
    for (const id of selected) s += Number(billsById[id]?.net_weight || 0)
    return s
  }, [selected, billsById])
  // Booking weight = selected net + refining gain (the figure actually
  // committed to the bidder). Kerala bookings carry 0 % gain by convention;
  // everything else uses the company rate. Mirrors the booking modal's default.
  const selGainRate  = regionTab === 'kl' ? 0 : (gainRatePct / 100)
  const selGain      = selectedTotal * selGainRate
  const selBookingWt = selectedTotal + selGain

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
    // Exclude held bills so 'all/partial/none' reflects the actually-
    // selectable rows. A branch where every non-held bill is ticked reads
    // as 'all' even if a held bill sits among them.
    const bills = (branch?.bills || []).filter(b => !b.audit_hold)
    if (!bills.length) return 'none'
    let sel = 0
    for (const b of bills) if (selected.has(b.id)) sel++
    if (sel === 0)            return 'none'
    if (sel === bills.length) return 'all'
    return 'partial'
  }
  const toggleBranchAll = (branch) => setSelected(prev => {
    const next  = new Set(prev)
    // Held bills (audit_hold=true) are excluded from select-all: ops parked
    // them outside the bidding pool and shouldn't sweep them back in by
    // accident. They can still be ticked individually if needed.
    const bills = (branch?.bills || []).filter(b => !b.audit_hold)
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
  // Region select-all — operates on every (non-held) bill under every branch
  // of the region. Used by the "Select all" link in each region header.
  const toggleRegionAll = (branchRows) => setSelected(prev => {
    const next   = new Set(prev)
    const allIds = branchRows.flatMap(r => (r.bills || []).filter(b => !b.audit_hold).map(b => b.id))
    if (!allIds.length) return next
    const allOn = allIds.every(id => next.has(id))
    if (allOn) for (const id of allIds) next.delete(id)
    else       for (const id of allIds) next.add(id)
    return next
  })

  // Auto-select bills totaling the target weight from a pool. Wired to the
  // Remaining KPI tiles — clicking "Remaining" picks bills FIFO-style until
  // the cumulative net weight hits the target, then the operator clicks
  // "Book Selected" to open the booking modal. Pools are mutually exclusive
  // (Kerala vs Bangalore-and-Others) because the booking modal can only
  // handle one pool at a time, so the new selection REPLACES the current one.
  //
  // Section 4 (Branch Stock — pickup pending today) is INTENTIONALLY excluded
  // from auto-select. Those bills haven't been physically picked up yet, so
  // their arrival on the bid date is contingent on the pickup actually
  // running. Ops manually ticks Section 4 branches when they want to commit
  // against them — the safe-by-default behaviour is to only auto-select from
  // Section 1 (Bangalore today, certain) and Section 2 (already in transit,
  // certain). If Sections 1 + 2 don't cover the full Remaining target,
  // auto-select underbooks and ops adds Section 4 picks manually.
  //
  // Order of preference:
  //   1. Section 1 (Bangalore today)  — freshest, bid against this first
  //   2. Section 2 (24h transit)     — already in motion
  // Within each section: branch name alphabetical, then purchase_date oldest first.
  const autoSelectRemaining = useCallback((pool, target) => {
    if (!Number.isFinite(target) || target <= 0) return
    // Per-pool section preference order:
    //   KA·AP·TS: Bangalore today → 24h transit (pre-EOD S4 excluded — contingent).
    //   KL:       Hub stock S1     → In-movement S2 (leaf S3 excluded — contingent).
    const sectionOrder = pool === 'kerala'
      ? { kl_hub_stock: 1, kl_hub_from_leaf: 1, kl_in_movement: 2 }
      : { bangalore: 1, transit_24h: 2 }
    const eligibleGroups = new Set(Object.keys(sectionOrder))
    const eligible = []
    for (const id of Object.keys(billsById)) {
      const bill = billsById[id]
      if (!eligibleGroups.has(bill._group)) continue
      // Skip bills the operator has parked outside the audit pool — they
      // shouldn't get auto-pulled into a booking.
      if (bill.audit_hold) continue
      eligible.push(bill)
    }
    eligible.sort((a, b) => {
      const sa = sectionOrder[a._group] ?? 99
      const sb = sectionOrder[b._group] ?? 99
      if (sa !== sb) return sa - sb
      const bn = (a._branch_name || '').localeCompare(b._branch_name || '')
      if (bn !== 0) return bn
      return (a.purchase_date || '').localeCompare(b.purchase_date || '')
    })
    const chosen = new Set()
    let sum = 0
    for (const bill of eligible) {
      if (sum >= target) break
      chosen.add(bill.id)
      sum += Number(bill.net_weight || 0)
    }
    setSelected(chosen)
  }, [billsById])

  // Click a section's "Available to Book" card → select every unbooked
  // (non-held) bill in that section's group(s).
  const selectSectionBills = useCallback((groups) => {
    const gset = new Set(groups)
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of Object.keys(billsById)) {
        const bl = billsById[id]
        if (gset.has(bl._group) && !bl.audit_hold) next.add(id)
      }
      return next
    })
  }, [billsById])

  // Kerala (KL) no-mix rule — Kerala bookings must be exclusive. With
  // bill-level selection, the cleanest signal is the _group tag set when
  // the catalogue is built — any 'kl_*' group is Kerala-pool, others are
  // KA·AP·TS-pool. (We don't fall back to _region because the picker bills
  // are pre-segregated by group; using _group keeps the rule tied to the
  // section the bill came from.)
  const KL_GROUPS = new Set(['kl_hub_stock', 'kl_hub_from_leaf', 'kl_in_movement', 'kl_created_not_booked', 'kl_at_leaf'])
  const isKeralaBill = (id) => KL_GROUPS.has(billsById[id]?._group)
  const isKeralaBranch = (b) => b?.region === 'Kerala'
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

  // Presets use the Sunday-aware next-working-day for 'Tomorrow' so a
  // Saturday bidder doesn't accidentally target Sunday. Today / +2 / +3
  // are plain calendar bumps because the operator chose those explicitly.
  const presets = [
    { id: 'today',     label: 'Today',     date: today },
    { id: 'tomorrow',  label: 'Tomorrow',  date: defaultArrival },
    { id: 'plus2',     label: '+2 days',   date: dateAdd(today, 2) },
    { id: 'plus3',     label: '+3 days',   date: dateAdd(today, 3) },
  ]
  const activePreset = presets.find(p => p.date === arrivalDate)?.id

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type, key: Date.now() })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Section 5 / S4 actions (booked-pending dispatch) ──────────────────────
  // Deep-link to Consignment Data with the branch pre-selected, so ops can
  // tick the bills and create the consignment without re-navigating manually.
  const handleCreateConsignment = (branchName, region) => {
    setConsignmentDeepLink({ branch: branchName, region: region || null })
    setActiveNav('consignment-data')
  }

  // Release all booked-but-still-at_branch bills under a single branch row.
  // Server-side endpoint is defensive (skips if not booked / not at_branch /
  // audit-consumed), returns per-id outcome — we surface the counts on toast
  // then silently refetch supply so the branch disappears from Section 5.
  const handleUnbookBranch = async (applicationIds, branchName) => {
    if (!Array.isArray(applicationIds) || applicationIds.length === 0) return
    if (!confirm(`Release ${applicationIds.length} bill${applicationIds.length === 1 ? '' : 's'} from their booking${applicationIds.length === 1 ? '' : 's'} at ${branchName}?`)) return
    try {
      const res = await authedFetch('/api/consignments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'unbook_bills', application_ids: applicationIds }),
      })
      const j = await res.json()
      if (j.error) { showToast(`Unbook failed: ${j.error}`, 'error'); return }
      const skipped = (j.data?.skipped || []).length
      showToast(
        `Unbooked ${j.data?.unbooked || 0} bill${(j.data?.unbooked || 0) === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped` : ''} at ${branchName}`,
        'success',
      )
      await fetchAll(true)
    } catch (e) {
      showToast(`Unbook failed: ${String(e?.message || e)}`, 'error')
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createBooking = async (payload) => {
    // Bill-level claim: send the exact purchase ids ops selected. The server
    // honours bill_ids verbatim (no branch-wide widening) so partial
    // selections — "3 of 7 bills at Mysore" — are respected at booking time.
    // source_branches is sent alongside for backwards compat + audit context
    // (server falls back to it only when bill_ids is empty).
    //
    // The whole flow is wrapped in try/catch so a network blip / JSON parse
    // error / RBAC 403 always surfaces to ops via toast instead of failing
    // silently behind a "Creating…" button.
    const billIds = [...selected]
    const sourceBranches = [...new Set(billIds.map(id => billsById[id]?._branch_name).filter(Boolean))]
    // 20-second client timeout so a hung request can never strand the
    // modal in "Creating…". AbortController fires after the deadline and
    // the catch surfaces a clear timeout toast.
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const r = await authedFetch('/api/consignments?action=create_booking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, date: arrivalDate, bill_ids: billIds, source_branches: sourceBranches }),
        signal: ctrl.signal,
      })
      clearTimeout(tid)
      let j = null
      try { j = await r.json() } catch { /* may be empty body on 5xx */ }
      if (!r.ok || j?.error) {
        const msg = j?.error || `Booking failed (HTTP ${r.status})`
        console.error('[create_booking] server error:', r.status, j)
        showToast(msg, 'error')
        return false
      }
      // Surface the auto-reconcile outcome — server may have detached
      // smallest-first bills when the operator's selection exceeded
      // booked weight, and any residual under-attachment lands in
      // pipeline. Stays out of the toast when nothing was reconciled.
      const detachedList = Array.isArray(j?.detached) ? j.detached : []
      const detachedNetG = detachedList.reduce((s, b) => s + Number(b.net_weight_g || 0), 0)
      const residualG    = Number(j?.residual_pipeline_g || 0)
      let toastMsg = 'Booking created.'
      if (detachedList.length > 0) {
        toastMsg = `Booking created. Auto-detached ${detachedList.length} bill${detachedList.length === 1 ? '' : 's'} (${detachedNetG.toFixed(2)} g)`
        toastMsg += residualG > 0.001
          ? ` — ${residualG.toFixed(2)} g residual → pipeline.`
          : '.'
      }
      showToast(toastMsg, 'success')
      setShowBookModal(false)
      setActiveTab('bookings')                        // surface the committed row immediately
      fetchAll(true)
      return true
    } catch (err) {
      clearTimeout(tid)
      console.error('[create_booking] network/parse error:', err)
      const msg = err?.name === 'AbortError'
        ? 'Booking timed out (20s) — try again or check the Railway logs.'
        : (err?.message || 'Booking failed — network error')
      showToast(msg, 'error')
      return false
    }
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

  // Recovery action for booked-but-not-shipped: detach the bills and cancel
  // the booking so ops can either re-attach against fresh incoming OR start
  // fresh. Uses the existing cancel path which already releases booking_id
  // on the attached purchases.
  const unbookBooking = useCallback(async (id) => {
    return updateStatus(id, 'cancelled', 'Unbooked: source bills still at_branch — released for re-booking')
  }, [])

  // Toggle the audit_hold flag on a Bangalore Section 1 bill. Held bills
  // stay visible in the picker but are skipped by auto-select and by the
  // 23:30 EOD audit. Optimistically updates supply state so the toggle
  // feels instant; the next poll reconciles with server truth.
  const toggleBillHold = useCallback(async (billId, hold) => {
    try {
      const r = await authedFetch('/api/consignments?action=toggle_bill_hold', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: billId, hold }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'Could not toggle hold', 'error'); return false }
      // Optimistic patch — mutate the bill row in supply so the UI reflects
      // the new state without waiting for a refetch. The 30s poll will
      // re-sync anyway.
      setSupply(prev => {
        if (!prev?.bangalore?.branches) return prev
        const branches = prev.bangalore.branches.map(b => ({
          ...b,
          bills: (b.bills || []).map(x => x.id === billId ? { ...x, audit_hold: hold } : x),
        }))
        return { ...prev, bangalore: { ...prev.bangalore, branches } }
      })
      if (hold && selected.has(billId)) {
        // If ops held a bill that was selected, drop it from the selection.
        setSelected(prev => { const next = new Set(prev); next.delete(billId); return next })
      }
      showToast(hold ? 'Bill held — excluded from auto-select & EOD audit.' : 'Hold released.', 'success')
      return true
    } catch (err) {
      showToast(err?.message || 'Could not toggle hold', 'error')
      return false
    }
  }, [selected])

  // Recovery action for booked-but-not-shipped: fire a consignment for the
  // attached bills' source branch(es). Multi-branch bookings fan out into
  // one consignment per source branch.
  const createConsignmentForBooking = useCallback(async (bookingId) => {
    try {
      const r = await authedFetch(`/api/consignments?action=booking_bills_by_branch&booking_id=${bookingId}`)
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'Could not load bills', 'error'); return false }
      const groups = j.data?.groups || []
      const dispatchable = groups
        .map(g => ({ branch_name: g.branch_name, bill_ids: (g.at_branch_bills || []).map(b => b.id) }))
        .filter(g => g.bill_ids.length > 0)
      if (dispatchable.length === 0) {
        showToast('Every attached bill has already moved. Nothing to dispatch.', 'info')
        return false
      }
      let created = 0
      const errors = []
      for (const g of dispatchable) {
        const cr = await authedFetch('/api/consignments?action=create_consignment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchase_ids:  g.bill_ids,
            branch_name:   g.branch_name,
            movement_type: 'EXTERNAL',
          }),
        })
        const cj = await cr.json().catch(() => ({}))
        if (!cr.ok || cj.error) errors.push(`${g.branch_name}: ${cj.error || `HTTP ${cr.status}`}`)
        else created++
      }
      if (created > 0) {
        showToast(`Created ${created} consignment${created === 1 ? '' : 's'}${errors.length ? ` (${errors.length} failed)` : ''}.`, errors.length ? 'error' : 'success')
        await fetchAll(true)
      } else {
        showToast(`Couldn't create consignment: ${errors.join('; ')}`, 'error')
      }
      return created > 0
    } catch (err) {
      showToast(err?.message || 'Could not create consignment', 'error')
      return false
    }
  }, [fetchAll])

  // Close a sub-10 g residual pipeline → folds into gain immediately.
  const closeBookingPipeline = async (id) => {
    const r = await authedFetch('/api/consignments?action=close_booking_pipeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const j = await r.json()
    if (!r.ok || j.error) { showToast(j.error || 'Could not close pipeline', 'error'); return false }
    showToast(`Residual ${fmt(j.data?.residual_g || 0, 2)} g closed to gain.`, 'success')
    fetchAll(true)
    return true
  }

  // ── Reconcile an over-attached booking ────────────────────────────────────
  // Calls /api/consignments?action=reconcile_booking which runs the same
  // smallest-first detach + residual-to-pipeline logic that create_booking
  // does at create time. For legacy rows that were over-attached BEFORE the
  // auto-reconcile feature shipped (e.g. the Augmont 12-Jun booking ops
  // flagged: NET 1217.19 + GAIN 42.60 = 1259.79 vs BOOKED 1200).
  const reconcileBooking = async (id) => {
    const r = await authedFetch('/api/consignments?action=reconcile_booking', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: id }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) {
      showToast(j.error || 'Reconcile failed', 'error')
      return false
    }
    const detached    = Array.isArray(j.detached) ? j.detached : []
    const detachedNet = detached.reduce((s, x) => s + Number(x.net_weight_g || 0), 0)
    const residual    = Number(j.residual_pipeline_g || 0)
    if (detached.length === 0 && residual === 0) {
      showToast('Already within booked weight — nothing to reconcile.', 'info')
    } else {
      let msg = `Detached ${detached.length} bill${detached.length === 1 ? '' : 's'} (${detachedNet.toFixed(2)} g)`
      msg += residual > 0.001 ? ` — ${residual.toFixed(2)} g residual → pipeline.` : '.'
      showToast(msg, 'success')
    }
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Date navigator removed from the header — moved next to the
              Bidding/Bookings tab switcher and now pivots on BIDDING DAY
              (created_at IST) rather than arrival date, since ops wants
              to find bookings under the day they were placed. */}
          <button onClick={() => fetchAll()} disabled={loading}
            style={{ background: loading ? t.card2 : 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: loading ? t.text4 : t.text2, cursor: loading ? 'default' : 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none', fontSize: '13px' }}>⟳</span>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Region tab strip — switches between the KA·AP·TS pool (Bangalore
          + outstation) and the KL pool (Kerala-only, with its own S1/S2/S3
          taxonomy). Selection clears on switch since the two pools can't
          mix on a single booking. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', background: t.card2, border: `1px solid ${t.border}`, borderRadius: 12, padding: 3, gap: 2 }}>
          {[
            { key: 'ka_ap_ts', label: 'KA · AP · TS', accent: t.gold },
            { key: 'kl',       label: 'KL',           accent: t.purple || '#8c5ac8' },
          ].map(tab => {
            const active = regionTab === tab.key
            const otherBookingCount = tab.key === 'kl'
              ? bookings.filter(b => b.is_kl && b.status !== 'cancelled').length
              : bookings.filter(b => !b.is_kl && b.status !== 'cancelled').length
            return (
              <button key={tab.key} onClick={() => setRegionTab(tab.key)}
                style={{
                  background: active ? `${tab.accent}1d` : 'transparent',
                  border:     `1px solid ${active ? `${tab.accent}80` : 'transparent'}`,
                  color:      active ? tab.accent : t.text3,
                  borderRadius: 9, padding: '7px 16px',
                  fontSize: 12, fontWeight: 800, letterSpacing: '.04em',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background .15s, color .15s, border-color .15s',
                }}>
                {tab.label}
                {!active && otherBookingCount > 0 && (
                  <span style={{ fontSize: 9.5, color: tab.accent, background: `${tab.accent}1a`, padding: '1px 7px', borderRadius: 99, fontWeight: 800 }}>
                    {otherBookingCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <span style={{ fontSize: 10.5, color: t.text4, letterSpacing: '.05em' }}>
          {regionTab === 'kl'
            ? 'Kerala pool · leaf → hub → HO flow'
            : 'Bangalore + outstation pool'}
        </span>
      </div>

      {/* ── KPI strips — split by region so the math doesn't conflate
          Bangalore/Others (today's purchases + outstation in-transit)
          with Kerala (leaf → hub consolidation). Each row reads as
          Incoming + Gain ± Pending = Available · Booked − Pipeline =
          Remaining. Kerala drops Pending (it's a global, attributed to
          Others by convention) and Gain (Kerala default is 0). */}

      {/* KA·AP·TS top KPI strip removed — the per-section metric cards
          (Total / Booked / Unbooked / Gain / Available) under each section
          now carry these numbers section-wise. */}

      {/* KL top KPI strip removed — the per-section metric cards (Total / Booked /
          Unbooked, with Unbooked clickable to select) now carry these numbers
          section-wise, so the top summary row is redundant. */}

      {regionTab === 'ka_ap_ts' && poolNegative && (
        <div style={{ ...card, padding: '10px 16px', borderColor: `${t.red}55`, background: `${t.red}10`, fontSize: '12px', color: t.red, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          Available pool is negative — the Pending pull-back (<strong>{fmt(pendingGrams, 2)} g</strong>) exceeds Incoming + Gain by <strong>{fmt(Math.abs(availablePool), 2)} g</strong>. Nothing to bid until supply arrives or the pull-back is reduced.
        </div>
      )}

      {regionTab === 'ka_ap_ts' && othersOverbooked && (
        <div style={{ ...card, padding: '10px 16px', borderColor: `${t.red}55`, background: `${t.red}10`, fontSize: '12px', color: t.red, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          <strong>Bangalore &amp; Others</strong> · pipeline commitments exceed the pool by <strong>{fmt(Math.abs(othersRemaining), 2)} g</strong>. The auto-attacher won't be able to back-fill every booking from today's incoming.
        </div>
      )}
      {regionTab === 'kl' && klOverbooked && (
        <div style={{ ...card, padding: '10px 16px', borderColor: `${t.red}55`, background: `${t.red}10`, fontSize: '12px', color: t.red, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          <strong>Kerala</strong> · pipeline commitments exceed the hub pool by <strong>{fmt(Math.abs(klRemaining), 2)} g</strong>. More bills need to reach the hubs (or pipeline closes to gain at EOD).
        </div>
      )}

      {/* ── Tab nav (Bidding / Bookings) + Bookings-day date nav ──
          The Bidding tab + the hero strips above always show today's bid
          (tomorrow's arrival). The Bookings tab pivots on BIDDING DAY —
          ← / → step through past bidding days so ops can find a booking
          under the day it was placed (not the next day's arrival). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', background: t.card2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 3, gap: 2 }}>
          {[
            { key: 'bidding',  label: 'Bidding',  icon: '⚖' },
            { key: 'bookings', label: 'Bookings', icon: '✓', count: tabActiveBookings.length },
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

        {activeTab === 'bookings' && (() => {
          // Day label for the bookings-date pill — today / yesterday /
          // N days ago, based on the difference from current IST day.
          const bDiff = dateDiff(bookingsDate, today)
          const bLabel = bDiff === 0 ? 'today'
            : bDiff === -1 ? 'yesterday'
            : bDiff < 0    ? `${Math.abs(bDiff)} days ago`
            : bDiff === 1  ? 'tomorrow'
            : `in ${bDiff} days`
          return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10.5, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Bidding day</span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: 3 }}>
                <button onClick={() => setBookingsDate(dateAdd(bookingsDate, -1))}
                  title="Previous bidding day"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: t.text2, padding: '4px 9px', fontSize: 13, fontWeight: 700, borderRadius: 5 }}>
                  ←
                </button>
                <button onClick={() => setBookingsDate(today)}
                  title={bDiff === 0 ? 'Showing today (default)' : 'Reset to today (default)'}
                  style={{
                    background: bDiff === 0 ? `${t.gold}1c` : 'transparent',
                    border: 'none', cursor: 'pointer',
                    color: bDiff === 0 ? t.gold : t.text2,
                    padding: '4px 10px', fontSize: 11, fontWeight: 700,
                    borderRadius: 5, letterSpacing: '.02em',
                    minWidth: 120, textAlign: 'center',
                  }}>
                  {fmtDateShort(bookingsDate)} · <span style={{ opacity: .7 }}>{bLabel}</span>
                </button>
                <button onClick={() => setBookingsDate(dateAdd(bookingsDate, 1))}
                  title="Next bidding day"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: t.text2, padding: '4px 9px', fontSize: 13, fontWeight: 700, borderRadius: 5 }}>
                  →
                </button>
              </div>
            </div>
          )
        })()}
      </div>

      {/* ─────────────────────────── BIDDING TAB ────────────────────────── */}
      {activeTab === 'bidding' && regionTab === 'ka_ap_ts' && (<>

      {/* ── Section navigator ── ops view ONE section at a time. Each chip
          shows its bill count + (where a single date applies) the HO-arrival
          date, so ops can see at a glance which sections have anything. */}
      {(() => {
        const t72 = t.teal || '#0e9aa7'
        // Weekday (DDD) + short date, e.g. "Sun · 15 Jun".
        const dddDate = (d) => {
          if (!d) return ''
          const dt = new Date(`${d}T00:00:00+05:30`)
          const day = dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })
          return `${day} · ${fmtDateShort(d)}`
        }
        // `date` = the HO-arrival date that section's stock lands on (where a
        // single date applies). Shown as a dim sub-line on the chip so ops can
        // read "which date" at a glance. Sections 5/6 span many dates → none.
        const navS = [
          { id: '1', label: 'Bangalore today',        accent: t.gold,                bills: supply?.bangalore?.total?.bills    || 0, date: arrivalDate },
          { id: '2', label: 'Arriving tomorrow · 24h', accent: t.blue,                bills: supply?.transit_24h?.total?.bills  || 0, date: arrivalDate },
          { id: '3', label: 'Day after · 48h',         accent: t.purple || '#8c5ac8', bills: supply?.transit_48h?.total?.bills  || 0, date: dayAfterArrivalDate },
          { id: '4', label: 'After 2 days · 72h',      accent: t72,                   bills: supply?.transit_72h?.total?.bills  || 0, date: dayAfter2ArrivalDate },
          { id: '5', label: 'Created · not booked',    accent: t.orange,              bills: (supply?.bangalore_pending_booking?.total?.bills || 0) + (supply?.consignment_pending_booking?.total?.bills || 0), date: null },
          { id: '6', label: 'Booked · no consignment', accent: t.red,                 bills: supply?.booked_pending_dispatch?.total?.bills || 0, date: null },
          { id: '7', label: 'Branch pickup pending',   accent: t.orange,              bills: supply?.branch_pre_eod?.total?.bills || 0, date: arrivalDate },
        ]
        const baseChip = (active, accent) => ({
          display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
          borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
          border: `1px solid ${active ? accent : t.border}`,
          background: active ? `${accent}1f` : 'transparent',
          color: active ? accent : t.text2,
          fontSize: 12, fontWeight: active ? 800 : 600, letterSpacing: '.01em',
        })
        return (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'stretch', overflowX: 'auto', paddingBottom: 2 }}>
            {navS.map(sx => {
              const active = activeSection === sx.id
              return (
                <button key={sx.id}
                  onClick={() => setActiveSection(sx.id)}
                  style={baseChip(active, sx.accent)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, borderRadius: 5, background: active ? sx.accent : `${sx.accent}26`, color: active ? '#fff' : sx.accent, fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{sx.id}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                    <span>{sx.label}</span>
                    {sx.date && <span style={{ fontSize: 10, color: sx.accent, fontWeight: 800, letterSpacing: '.01em' }}>→ HO {dddDate(sx.date)}</span>}
                  </span>
                  <span style={{ fontSize: 10.5, color: active ? sx.accent : t.text4, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{sx.bills}</span>
                </button>
              )
            })}
          </div>
        )
      })()}

      {/* ── Seven source sections, fixed order; the navigator above toggles
          visibility. 'all' shows every one stacked (legacy behaviour). ── */}

      {/* 1 · Today's Bangalore purchases */}
      {(activeSection === '1') && (
      <SourceSection
        t={t} card={card}
        index={1}
        icon="🏙"
        title="Today's Bangalore purchases"
        subtitle={supply?.bangalore_purchase_date
          ? `Bangalore purchases (${fmtDateShort(supply.bangalore_purchase_date)}) · arrive at HO ${fmtDate(arrivalDate)}`
          : `Today's Bangalore purchases · arrive at HO ${fmtDate(arrivalDate)}`}
        accent={t.gold}
        branches={bangBranches}
        total={supply?.bangalore?.total}
        metrics={sectionMetrics(supply?.bangalore?.total?.net_wt, supply?.bangalore?.booked?.net_wt, 1)}
        bookedBranches={supply?.bangalore?.booked?.branches}
        onRateChange={(p) => handleSectionRate(1, p)}
        onSetGainGrams={(g) => handleSectionGainGrams(1, g)}
        onAutoSelect={() => selectSectionBills(['bangalore'])}
        prefix="B"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        onToggleHold={toggleBillHold}
        emptyMsg="No Bangalore purchases recorded today yet."
      />)}

      {/* 2 · In Consignment — arriving tomorrow (24h) */}
      {(activeSection === '2') && (
      <SourceSection
        t={t} card={card}
        index={2}
        icon="⇒"
        title="In Consignment — arriving tomorrow (24h)"
        subtitle={`Already dispatched · arriving at HO ${fmtDate(arrivalDate)}`}
        accent={t.blue}
        branches={inTBranches}
        total={sumBranches(inTBranches)}
        metrics={sectionMetrics(sumBranches(inTBranches).net_wt, sumBranches(t24Booked).net_wt, 2)}
        bookedBranches={t24Booked}
        onRateChange={(p) => handleSectionRate(2, p)}
        onSetGainGrams={(g) => handleSectionGainGrams(2, g)}
        onAutoSelect={() => selectSectionBills(['transit_24h'])}
        prefix="T"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        emptyMsg="No 24h-TAT bills currently in transit."
      />)}

      {/* 3 · In Consignment — arriving day after tomorrow (48h) */}
      {(activeSection === '3') && (
      <SourceSection
        t={t} card={card}
        index={3}
        icon="⏲"
        title="In Consignment — arriving day after tomorrow (48h)"
        subtitle={dayAfterArrivalDate
          ? `Arriving at HO ${fmtDate(dayAfterArrivalDate)} · available to book`
          : 'Arriving day after tomorrow · available to book'}
        accent={t.purple || '#8c5ac8'}
        branches={t48hBranches}
        total={sumBranches(t48hBranches)}
        metrics={sectionMetrics(sumBranches(t48hBranches).net_wt, sumBranches(t48Booked).net_wt, 3)}
        bookedBranches={t48Booked}
        onRateChange={(p) => handleSectionRate(3, p)}
        onSetGainGrams={(g) => handleSectionGainGrams(3, g)}
        onAutoSelect={() => selectSectionBills(['transit_48h'])}
        prefix="D"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        emptyMsg="No 48h-TAT bills currently in transit."
      />)}

      {/* 4 · In Consignment — arriving after 2 days (72h) */}
      {(activeSection === '4') && (
      <SourceSection
        t={t} card={card}
        index={4}
        icon="⏳"
        title="In Consignment — arriving after 2 days (72h)"
        subtitle={dayAfter2ArrivalDate
          ? `Arriving at HO ${fmtDate(dayAfter2ArrivalDate)} · available to book`
          : 'Arriving after 2 days · available to book'}
        accent={t.teal || '#0e9aa7'}
        branches={t72hBranches}
        total={sumBranches(t72hBranches)}
        metrics={sectionMetrics(sumBranches(t72hBranches).net_wt, sumBranches(t72Booked).net_wt, 4)}
        bookedBranches={t72Booked}
        onRateChange={(p) => handleSectionRate(4, p)}
        onSetGainGrams={(g) => handleSectionGainGrams(4, g)}
        onAutoSelect={() => selectSectionBills(['transit_72h'])}
        prefix="E"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        emptyMsg="No 72h-TAT bills currently in transit."
      />)}

      {/* 5 · Consignment created, bidding date passed, not yet booked —
            stock held on hold, consignment created but unbooked. Two bands:
            a) Old Bangalore purchases, consignment created, never booked
               (consolidated Bangalore roll-up). Logic: every Bangalore
               purchase should be booked the same day; anything that slipped
               lands here the next day.
            b) Outstation consignments created but never booked.
          Both selectable so ops can book straight from here. */}
      {(activeSection === '5') && (
      <SourceSection
        t={t} card={card}
        index={5}
        icon="⚠"
        title="Consignment created · bidding passed · not booked"
        subtitle="Stock on hold, consignment created but no booking attached — select to book"
        accent={t.orange}
        branches={bangPendBranches}
        total={{
          bills:  (supply?.bangalore_pending_booking?.total?.bills  || 0) + (supply?.consignment_pending_booking?.total?.bills  || 0),
          net_wt: (supply?.bangalore_pending_booking?.total?.net_wt || 0) + (supply?.consignment_pending_booking?.total?.net_wt || 0),
        }}
        metrics={sectionMetrics((supply?.bangalore_pending_booking?.total?.net_wt || 0) + (supply?.consignment_pending_booking?.total?.net_wt || 0), 0, 5)}
        onRateChange={(p) => handleSectionRate(5, p)}
        onSetGainGrams={(g) => handleSectionGainGrams(5, g)}
        onAutoSelect={() => selectSectionBills(['bangalore_pending_booking', 'transit_pending_booking'])}
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        consolidateRegions={['Bangalore']}
        mainLabel={bangPendBranches.length ? {
          icon:  '🏙',
          title: 'Old Bangalore purchases · not booked',
        } : null}
        subGroup={pendBookBranches.length ? {
          icon:     '⇒',
          title:    'Consignment created but not booked',
          subtitle: 'Outstation consignments dispatched, no booking attached.',
          accent:   t.orange,
          branches: pendBookBranches,
          total:    supply?.consignment_pending_booking?.total,
        } : null}
        emptyMsg="Nothing pending — every dispatched consignment is booked."
      />)}

      {/* 6 · Booked but consignment NOT created (Red Flag). View-only —
            already attached to a booking but still at the branch. Ops must
            either kick off the consignment or release the booking. */}
      {(activeSection === '6') && (
      <SourceSection
        t={t} card={card}
        index={6}
        icon="🚩"
        title="Booked — consignment not created (Red Flag)"
        subtitle="Already attached to a booking but still at the branch · create the consignment or release the booking"
        accent={t.red}
        branches={bookedPendBranches}
        total={supply?.booked_pending_dispatch?.total}
        metrics={sectionMetrics(0, supply?.booked_pending_dispatch?.total?.net_wt)}
        selectable={false}
        viewOnly
        consolidateRegions={['Bangalore']}
        onCreateConsignment={handleCreateConsignment}
        onUnbookBranch={handleUnbookBranch}
        emptyMsg="No stalled bookings — every booked bill is in motion or already received."
      />)}

      {/* 7 · Branch Stock — pickup pending today (selectable — moves today) */}
      {(activeSection === '7') && (
      <SourceSection
        t={t} card={card}
        index={7}
        icon="◐"
        title="Branch Stock — pickup pending today"
        subtitle={`Currently at_branch · will move by EOD · arrives at HO ${fmtDate(arrivalDate)}`}
        accent={t.orange}
        branches={preEodBranches}
        total={sumBranches(preEodBranches)}
        metrics={sectionMetrics(sumBranches(preEodBranches).net_wt, sumBranches(preEodBooked).net_wt, 7)}
        bookedBranches={preEodBooked}
        onRateChange={(p) => handleSectionRate(7, p)}
        onSetGainGrams={(g) => handleSectionGainGrams(7, g)}
        onAutoSelect={() => selectSectionBills(['branch_pre_eod'])}
        prefix="P"
        selectable
        selected={selected}
        branchLocked={branchLocked}
        onToggleBill={toggleBill}
        onToggleBranchAll={toggleBranchAll}
        onToggleRegionAll={toggleRegionAll}
        branchSelectionState={branchSelectionState}
        emptyMsg="No eligible branches — either pickups already happened today, or no eligible branches scheduled today."
      />)}

      </>)}

      {/* ───────────────────── KL TAB — Kerala source picker ─────────────────────
          Five sections mirroring the KA·AP·TS layout, adapted to the Kerala
          leaf → hub → HO flow. One section shown at a time via the chip nav:
            1 · Hub Stock                (hub-origin at hub + received-from-leaf)
            2 · Branch → Hub             (leaf → hub INTERNAL, in movement)
            3 · Consignment · not booked (in_consignment, no booking, not S2)
            4 · Booked · no consignment  (at_branch + booked)
            5 · At branch · dispatch pending (leaf, at_branch, not consigned) */}
      {activeTab === 'bidding' && regionTab === 'kl' && (<>
        {klHubsDispatchedToday.length > 0 && (
          <div style={{ ...card, padding: '10px 14px', borderColor: `${t.orange}55`, background: `${t.orange}10`, fontSize: '12px', color: t.text2, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 14, color: t.orange, lineHeight: 1, marginTop: 1 }}>⛔</span>
            <div style={{ flex: 1, lineHeight: 1.5 }}>
              <strong style={{ color: t.orange, fontWeight: 800 }}>
                {klHubsDispatchedToday.join(' · ')} already dispatched today
              </strong>
              <div style={{ color: t.text3, fontSize: 11, marginTop: 2 }}>
                Bills currently at or in-movement to {klHubsDispatchedToday.length === 1 ? 'this hub' : 'these hubs'} are excluded from today's bid — they'll ride tomorrow's hub → HO truck and arrive at HO the day after. Bid for them via <strong style={{ color: t.text2 }}>+2 days</strong> instead.
              </div>
            </div>
          </div>
        )}

        {/* ── Section navigator (KL) — one section at a time, mirrors KA ── */}
        {(() => {
          const dddDate = (d) => {
            if (!d) return ''
            const dt = new Date(`${d}T00:00:00+05:30`)
            const day = dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })
            return `${day} · ${fmtDateShort(d)}`
          }
          const navKL = [
            { id: '1', label: 'Hub Stock',                    accent: t.purple || '#8c5ac8', bills: klS1Total.bills || 0, date: arrivalDate },
            { id: '2', label: 'Branch → Hub',                 accent: t.blue,                bills: (klS2Total.bills || 0) + (klS1LeafTotal.bills || 0), date: arrivalDate },
            { id: '3', label: 'Consignment · not booked',     accent: t.orange,              bills: klS3Total.bills || 0, date: null },
            { id: '4', label: 'Booked · no consignment',      accent: t.red,                 bills: klS4Total.bills || 0, date: null },
            { id: '5', label: 'At branch · dispatch pending', accent: t.teal || '#0e9aa7',   bills: klS5Total.bills || 0, date: null },
          ]
          const baseChip = (active, accent) => ({
            display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
            borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1px solid ${active ? accent : t.border}`,
            background: active ? `${accent}1f` : 'transparent',
            color: active ? accent : t.text2,
            fontSize: 12, fontWeight: active ? 800 : 600, letterSpacing: '.01em',
          })
          return (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'stretch', overflowX: 'auto', paddingBottom: 2 }}>
              {navKL.map(sx => {
                const active = activeSection === sx.id
                return (
                  <button key={sx.id} onClick={() => setActiveSection(sx.id)} style={baseChip(active, sx.accent)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, borderRadius: 5, background: active ? sx.accent : `${sx.accent}26`, color: active ? '#fff' : sx.accent, fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{sx.id}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                      <span>{sx.label}</span>
                      {sx.date && <span style={{ fontSize: 10, color: sx.accent, fontWeight: 800, letterSpacing: '.01em' }}>→ HO {dddDate(sx.date)}</span>}
                    </span>
                    <span style={{ fontSize: 10.5, color: active ? sx.accent : t.text4, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{sx.bills}</span>
                  </button>
                )
              })}
            </div>
          )
        })()}

        {/* 1 · Hub Stock — hub-origin bills only */}
        {(activeSection === '1') && (
        <SourceSection
          t={t} card={card}
          index={1}
          icon="🏛"
          title="Hub Stock — hub's own bills"
          subtitle={`Bought at the hub · at_branch · ready for tonight's hub → HO dispatch · arrives at HO ${fmtDate(arrivalDate)}`}
          accent={t.purple || '#8c5ac8'}
          branches={klS1Branches}
          total={klS1Total}
          metrics={klMetrics(klS1Total.net_wt)}
          noGain
          onAutoSelect={() => selectSectionBills(['kl_hub_stock'])}
          prefix="H"
          selectable
          selected={selected}
          branchLocked={branchLocked}
          onToggleBill={toggleBill}
          onToggleBranchAll={toggleBranchAll}
          onToggleRegionAll={toggleRegionAll}
          branchSelectionState={branchSelectionState}
          emptyMsg="No hub-origin bills sitting at the Kerala hubs."
        />)}

        {/* 2 · Branch → Hub — one card: in-movement runs + already received at hub */}
        {(activeSection === '2') && (
        <SourceSection
          t={t} card={card}
          index={2}
          icon="⇒"
          title="Branch → Hub"
          subtitle={`Leaf → hub: in transit now, plus bills already received at the hub · part of tonight's hub → HO dispatch · arrives ${fmtDate(arrivalDate)}`}
          accent={t.blue}
          branches={klS2Merged}
          total={klS2MergedTotal}
          metrics={klMetrics(klS2MergedTotal.net_wt)}
          noGain
          onAutoSelect={() => selectSectionBills(['kl_in_movement', 'kl_hub_from_leaf'])}
          prefix="M"
          selectable
          selected={selected}
          branchLocked={branchLocked}
          onToggleBill={toggleBill}
          onToggleBranchAll={toggleBranchAll}
          onToggleRegionAll={toggleRegionAll}
          branchSelectionState={branchSelectionState}
          emptyMsg="No branch → hub bills right now."
        />)}

        {/* 3 · Consignment created · not booked */}
        {(activeSection === '3') && (
        <SourceSection
          t={t} card={card}
          index={3}
          icon="⇒"
          title="Consignment created · not booked"
          subtitle="On a consignment (e.g. hub → HO) but no booking attached yet — still bookable."
          accent={t.orange}
          branches={klS3Branches}
          total={klS3Total}
          metrics={klMetrics(klS3Total.net_wt)}
          noGain
          onAutoSelect={() => selectSectionBills(['kl_created_not_booked'])}
          prefix="C"
          selectable
          selected={selected}
          branchLocked={branchLocked}
          onToggleBill={toggleBill}
          onToggleBranchAll={toggleBranchAll}
          onToggleRegionAll={toggleRegionAll}
          branchSelectionState={branchSelectionState}
          emptyMsg="No in-transit Kerala bills awaiting a booking."
        />)}

        {/* 4 · Booked but consignment not created */}
        {(activeSection === '4') && (
        <SourceSection
          t={t} card={card}
          index={4}
          icon="⚠"
          title="Booked — consignment not created"
          subtitle="Already attached to a booking but still at the branch · create the consignment or release the booking"
          accent={t.red}
          branches={klS4Branches}
          total={klS4Total}
          metrics={klBookedMetrics(klS4Total.net_wt)}
          noGain
          selectable={false}
          viewOnly
          onCreateConsignment={handleCreateConsignment}
          onUnbookBranch={handleUnbookBranch}
          emptyMsg="No stalled bookings in Kerala — every booked bill is in motion or already received."
        />)}

        {/* 5 · At leaf branch — dispatch pending (contingent — manual select) */}
        {(activeSection === '5') && (
        <SourceSection
          t={t} card={card}
          index={5}
          icon="◐"
          title="At branch — dispatch pending"
          subtitle="Still at a leaf branch · needs leaf → hub pickup to fire before tonight's hub → HO dispatch. Contingent, not in auto-select."
          accent={t.teal || '#0e9aa7'}
          branches={klS5Branches}
          total={klS5Total}
          metrics={klMetrics(klS5Total.net_wt)}
          noGain
          onAutoSelect={() => selectSectionBills(['kl_at_leaf'])}
          prefix="L"
          selectable
          selected={selected}
          branchLocked={branchLocked}
          onToggleBill={toggleBill}
          onToggleBranchAll={toggleBranchAll}
          onToggleRegionAll={toggleRegionAll}
          branchSelectionState={branchSelectionState}
          emptyMsg="No bills sitting at KL leaf branches right now."
        />)}
      </>)}

      {/* Sticky selection bar — shared across both region tabs. Appears the
          moment any bill is selected; pool exclusivity is enforced upstream
          by the region tab reset, so the sticky bar always reflects one
          pool's worth of bills. */}
      {activeTab === 'bidding' && selected.size > 0 && (
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
            <div style={{ fontSize: 11, color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 800 }}>Booking weight</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 3 }}>
              <span style={{ fontSize: 26, color: t.gold, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '-.01em' }}>{fmt(selBookingWt, 2)}</span>
              <span style={{ fontSize: 13, color: t.text2, fontWeight: 700 }}>g · {selected.size} bill{selected.size === 1 ? '' : 's'}</span>
            </div>
            <div style={{ fontSize: 10.5, color: t.text4, fontWeight: 600, marginTop: 2 }}>
              net {fmt(selectedTotal, 2)} g{selGainRate > 0 && <> + gain {fmt(selGain, 2)} g · {fmt(gainRatePct, 2)}%</>}
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

      {/* ────────────────────────── BOOKINGS TAB ────────────────────────── */}
      {activeTab === 'bookings' && (
        <>
          <BookingsList
            t={t} card={card}
            bookings={tabBookings}
            onUpdateStatus={updateStatus}
            onRequestCancel={(b) => setCancelTarget(b)}
            onClosePipeline={closeBookingPipeline}
            onReconcile={reconcileBooking}
            onUnbook={unbookBooking}
            onCreateConsignment={createConsignmentForBooking}
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
          onSavePending={savePending}
          savingPending={savingPending}
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
          onSubmitGuardFail={(msg) => showToast(msg, 'error')}
          onDetachBills={(ids) => setSelected(prev => {
            const next = new Set(prev)
            for (const id of ids) next.delete(id)
            return next
          })}
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

      {/* ── Toast — z-index 2100 puts it ABOVE the booking modal (2000)
              so error messages stay visible while the modal is open. ── */}
      {toast && (
        <div key={toast.key} className="bidToast" style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 2100,
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
function KpiCard({ label, value, sub, accent, card, t, op, variant = 'source', pulse = false, big = false, onClick = null, actionHint = null }) {
  const [hov, setHov] = useState(false)
  const isResult = variant === 'result'
  const isState  = variant === 'state'
  const lit      = isResult || (isState && pulse)         // tinted at rest
  const glow     = hov && onClick ? '38' : hov ? '28' : lit ? '14' : '00'
  const clickable = !!onClick
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
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
          ? clickable ? `0 12px 28px ${accent}40, 0 0 0 1px ${accent}50 inset` : `0 9px 24px ${accent}26`
          : isResult ? `0 1px 0 ${accent}1f inset` : 'none',
        cursor: clickable ? 'pointer' : 'default',
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
      {clickable && actionHint && (
        <div style={{
          position: 'relative',
          fontSize: 10, fontWeight: 700,
          color: hov ? accent : `${accent}b0`,
          letterSpacing: '.04em',
          marginTop: 8,
          display: 'inline-flex', alignItems: 'center', gap: 4,
          transition: 'color .15s ease',
        }}>
          {actionHint} <span style={{ fontSize: 12 }}>→</span>
        </div>
      )}
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

// Dispatch-state visual map. Keyed by the per-booking flag the API computes
// off attached bills' stock_status + source pickup_time + 2h grace. Surfaces
// "booked but not shipped" risk to the bid desk in a single glance.
const DISPATCH_META = {
  ready:   { label: '✓ shipped',          tone: 'green'  },
  partial: { label: '◐ partial dispatch',  tone: 'blue'   },
  pending: { label: '◷ dispatch pending',  tone: 'gold'   },
  at_risk: { label: '⚠ at risk',           tone: 'red'    },
}

function BookingsList({ t, card, bookings, onUpdateStatus, onRequestCancel, onClosePipeline, onReconcile, onUnbook, onCreateConsignment, onCreate }) {
  const [actionBusy, setActionBusy] = useState(null)  // booking id currently mid-action
  const [hideCancelled, setHideCancelled] = useState(true)
  // Branch-wise breakdown drill-down — click a booking's Net Wt to see every
  // attached bill grouped by branch.
  const [openBooking,   setOpenBooking]   = useState(null)
  const [breakdowns,    setBreakdowns]    = useState({})           // id → { loading, branches, total }
  const [openBranches,  setOpenBranches]  = useState(() => new Set())
  const toggleBreakdown = async (id) => {
    if (openBooking === id) { setOpenBooking(null); return }
    setOpenBooking(id)
    // Refetch when not yet loaded OR when a prior fetch came back empty —
    // never let a stale empty result stick (e.g. from a pre-deploy click).
    const cached = breakdowns[id]
    const needsFetch = !cached || (!cached.loading && !(cached.branches && cached.branches.length))
    if (needsFetch) {
      setBreakdowns(p => ({ ...p, [id]: { loading: true } }))
      const res = await authedFetch(`/api/consignments?action=booking_bills&booking_id=${id}`)
      const j   = await res.json().catch(() => ({}))
      setBreakdowns(p => ({ ...p, [id]: { loading: false, branches: j.branches || [], total: j.total || {} } }))
    }
  }
  const toggleBranch = (key) => setOpenBranches(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const visible       = hideCancelled ? bookings.filter(b => b.status !== 'cancelled') : bookings
  const activeRows    = visible.filter(b => b.status !== 'cancelled')
  const activeWeight  = activeRows.reduce((s, b) => s + Number(b.weight || 0), 0)
  const activeValue   = activeRows.reduce((s, b) => s + Number(b.weight || 0) * Number(b.rate || 0), 0)
  // Column-wise totals across active rows. Gain + Pipeline come straight
  // from the API's derived gain model (derived_gain_g / derived_pipeline_g)
  // — gain = sourced_net × rate while live, = weight − sourced once the
  // arrival day passes. Net Wt = live attached weight. Old bookings made
  // before the migration still have derived_* computed by the API's
  // fallback, so these reads are safe either way.
  const billsFor    = (b) => Number(b.attached_net_weight_g) > 0
                              ? Number(b.attached_net_weight_g)
                              : (b.bills_net_weight_g != null ? Number(b.bills_net_weight_g) : 0)
  const gainFor     = (b) => Number(b.derived_gain_g)     || 0
  const pendingFor  = (b) => Number(b.pending_g) || 0
  const pipelineFor = (b) => Number(b.derived_pipeline_g) || 0
  const totalBills    = activeRows.reduce((s, b) => s + billsFor(b),    0)
  const totalGain     = activeRows.reduce((s, b) => s + gainFor(b),     0)
  const totalPending  = activeRows.reduce((s, b) => s + pendingFor(b),  0)
  const totalPipeline = activeRows.reduce((s, b) => s + pipelineFor(b), 0)

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

      {/* Bill-style breakdown table.
            # | Party | Net Wt | + Gain | + Pending | + Pipeline | = Booked Wt | × Rate | = Value | KL
          Additional Gain column intentionally dropped — the daily audit
          folds it into + Gain proportionally so a separate column was
          double-display. Status + Actions removed (this surface is
          read-only; cancel/confirm happen elsewhere). */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 36, textAlign: 'center' }}>#</th>
              <th style={th}>Party</th>
              <th style={{ ...th, textAlign: 'right' }} title="Net weight of bills currently attached to this booking — grows as the pipeline auto-attacher pulls in new bills">Net Wt (g)</th>
              <th style={{ ...th, textAlign: 'right', color: t.text4 }} title="Refining gain = net weight × gain rate (3.5%, or 0 for Kerala). While the booking is live it tracks net weight exactly; once the arrival day passes any small leftover pipeline folds in.">+ Gain</th>
              <th style={{ ...th, textAlign: 'right', color: t.text4 }} title="Pending delivery carry-over included in this booking">+ Pending</th>
              <th style={{ ...th, textAlign: 'right', color: t.text4 }} title="Pipeline = bid weight not yet covered by attached bills + their gain. Decrements as fitting bills attach; zeros once the arrival day passes (leftover → gain).">+ Pipeline</th>
              <th style={{ ...th, textAlign: 'right' }} title="Total weight committed to the bidder">= Booked Wt</th>
              <th style={{ ...th, textAlign: 'right', color: t.text4 }}>× Rate</th>
              <th style={{ ...th, textAlign: 'right' }}>= Value</th>
              <th style={{ ...th, textAlign: 'center', width: 50 }}>KL</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((b, i) => {
              const isCancelled = b.status === 'cancelled'
              const total       = Number(b.weight || 0) * Number(b.rate || 0)
              const dotColor    = partyColor(b.party)
              // Net Weight = LIVE attached bill weight (grows as the
              // pipeline auto-attacher pulls in incoming purchases).
              // Falls back to the create-time snapshot if no bills are
              // attached yet.
              const billsG    = (Number(b.attached_net_weight_g) > 0
                                  ? Number(b.attached_net_weight_g)
                                  : (b.bills_net_weight_g != null ? Number(b.bills_net_weight_g) : null))
              const pendingG  = b.pending_g          != null ? Number(b.pending_g)          : null
              // Gain + Pipeline come from the derived gain model (API).
              //   live:    gain = sourced_net × rate (clean 3.5 %),
              //            pipeline = weight − sourced_net × (1+rate)
              //   settled: gain = weight − sourced_net, pipeline = 0
              const effectiveGainG = Number(b.derived_gain_g)     || 0
              const pipelineG      = Number(b.derived_pipeline_g) || 0
              const isSettled      = !!b.is_settled
              const numCell = (val, opts = {}) => {
                if (val == null) return <span style={{ color: t.text4, fontFamily: 'monospace', fontWeight: 600 }}>—</span>
                if (val === 0)   return <span style={{ color: t.text4, fontFamily: 'monospace', fontWeight: 600 }}>—</span>
                return (
                  <span style={{ fontFamily: 'monospace', color: opts.color || t.text2, fontWeight: opts.weight || 700, fontSize: opts.size || 12.5, whiteSpace: 'nowrap' }}>
                    {fmt(val, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 1.5, fontWeight: 600 }}>g</span>
                  </span>
                )
              }
              const bdOpen = openBooking === b.id
              const bd     = breakdowns[b.id]
              return (
                <Fragment key={b.id}>
                <tr
                  style={{
                    background: bdOpen ? `${t.gold}0c` : (i % 2 === 1 ? `${t.card2}40` : 'transparent'),
                    opacity: isCancelled ? 0.55 : 1,
                  }}>
                  <td style={{ ...td, textAlign: 'center', color: t.text4, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{i + 1}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <span style={{ color: t.text1, fontWeight: 700, textDecoration: isCancelled ? 'line-through' : 'none' }}>{b.party}</span>
                    </div>
                    {(b.purity || b.buyer_phone || b.notes || pipelineG > 0 || b.created_at) && (
                      <div style={{ fontSize: 10.5, color: t.text4, marginTop: 4, marginLeft: 17, display: 'flex', gap: 9, flexWrap: 'wrap', fontWeight: 600, alignItems: 'center' }}>
                        {b.purity && <span style={{ color: t.gold }}>{b.purity}</span>}
                        {b.buyer_phone && <span style={{ fontFamily: 'monospace' }}>{b.buyer_phone}</span>}
                        {/* Pipeline still owed — auto-attacher will keep
                            filling it (with fitting bills only) until the
                            arrival day passes, when the leftover folds into
                            gain. A sub-10 g residual can be closed on the
                            spot via the inline button. */}
                        {pipelineG > 0 && !isSettled && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
                            <span title={`Awaiting ${fmt(pipelineG, 2)} g of incoming purchases (region: ${b.pipeline_region || '—'})`}
                              style={{
                                background: `${t.purple || '#8c5ac8'}18`,
                                color: t.purple || '#8c5ac8',
                                border: `1px solid ${t.purple || '#8c5ac8'}40`,
                                borderRadius: pipelineG < 10 && onClosePipeline ? '99px 0 0 99px' : 99,
                                padding: '1px 8px',
                                fontFamily: 'monospace', fontWeight: 800, letterSpacing: '.02em',
                              }}>
                              ⟳ pipeline {fmt(pipelineG, 2)}g owed
                            </span>
                            {pipelineG < 10 && onClosePipeline && (
                              <button type="button"
                                onClick={() => onClosePipeline(b.id)}
                                title={`Close this ${fmt(pipelineG, 2)} g residual — folds straight into gain`}
                                style={{
                                  background: t.gold, color: '#1a0a00',
                                  border: 'none', borderRadius: '0 99px 99px 0',
                                  padding: '2px 9px', fontSize: 10, fontWeight: 800,
                                  letterSpacing: '.03em', cursor: 'pointer',
                                  textTransform: 'uppercase',
                                }}>
                                close → gain
                              </button>
                            )}
                          </span>
                        )}
                        {/* Over-attached — net + gain exceeds booked weight.
                            Legacy rows created before the auto-detach feature
                            shipped, plus any edge case where bills got
                            re-attached out of sync. One-click Auto-fix runs
                            the same smallest-first detach + residual-to-
                            pipeline reconcile that create_booking does. */}
                        {(() => {
                          if (isCancelled || isSettled || !onReconcile) return null
                          if (billsG == null || !(Number(b.weight) > 0)) return null
                          const effectiveCommittedG = billsG + (effectiveGainG || 0)
                          const overByG = effectiveCommittedG - Number(b.weight)
                          if (overByG <= 0.5) return null
                          return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
                              <span title={`Net + gain (${fmt(effectiveCommittedG, 2)} g) exceeds booked (${fmt(Number(b.weight), 2)} g) by ${fmt(overByG, 2)} g`}
                                style={{
                                  background: `${t.red}18`,
                                  color: t.red,
                                  border: `1px solid ${t.red}40`,
                                  borderRadius: '99px 0 0 99px',
                                  padding: '1px 8px',
                                  fontFamily: 'monospace', fontWeight: 800, letterSpacing: '.02em',
                                }}>
                                ⚠ over-attached {fmt(overByG, 2)}g
                              </span>
                              <button type="button"
                                onClick={() => onReconcile(b.id)}
                                title="Auto-detach the smallest bills until the booking fits. Residual moves to pipeline."
                                style={{
                                  background: t.gold, color: '#1a0a00',
                                  border: 'none', borderRadius: '0 99px 99px 0',
                                  padding: '2px 10px', fontSize: 10, fontWeight: 800,
                                  letterSpacing: '.03em', cursor: 'pointer',
                                  textTransform: 'uppercase',
                                }}>
                                Auto-fix
                              </button>
                            </span>
                          )
                        })()}
                        {/* Settled — arrival day has passed; gain is final
                            (net × rate plus any small EOD leftover). */}
                        {isSettled && (
                          <span title="Arrival day passed — gain finalised (net × rate, plus any leftover pipeline folded in)"
                            style={{
                              background: `${t.green}18`,
                              color: t.green,
                              border: `1px solid ${t.green}40`,
                              borderRadius: 99, padding: '1px 8px',
                              fontFamily: 'monospace', fontWeight: 800, letterSpacing: '.02em',
                            }}>
                            ✓ settled
                          </span>
                        )}
                        {/* Dispatch state — surfaces whether source bills have
                            physically moved or are still at_branch (with an
                            at_risk pill once we're past the source branch's
                            pickup_time + 2h grace). Only on live bookings. */}
                        {b.dispatch_state && DISPATCH_META[b.dispatch_state] && (() => {
                          const meta = DISPATCH_META[b.dispatch_state]
                          const c = t[meta.tone] || t.text2
                          return (
                            <span title={`${b.attached_bills_count} bill${b.attached_bills_count === 1 ? '' : 's'} attached · ${b.dispatch_state === 'at_risk' ? 'past pickup window' : ''}`}
                              style={{
                                background: `${c}18`, color: c,
                                border: `1px solid ${c}40`,
                                borderRadius: 99, padding: '1px 8px',
                                fontFamily: 'monospace', fontWeight: 800, letterSpacing: '.02em',
                                ...(b.dispatch_state === 'at_risk' ? { boxShadow: `0 0 0 2px ${c}10` } : {}),
                              }}>
                              {meta.label}
                            </span>
                          )
                        })()}
                        {/* At-risk recovery actions — single click each. The
                            confirm gate is intentional friction; the auto-poll
                            picks up the new state within 30 s of either. */}
                        {b.dispatch_state === 'at_risk' && !isCancelled && (onUnbook || onCreateConsignment) && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                            {onCreateConsignment && (
                              <button type="button" disabled={actionBusy === b.id}
                                onClick={async () => {
                                  if (actionBusy) return
                                  if (!window.confirm(`Create consignment(s) for the ${b.attached_bills_count} still-at-branch bill${b.attached_bills_count === 1 ? '' : 's'} of "${b.party}"? One consignment per source branch.`)) return
                                  setActionBusy(b.id)
                                  try { await onCreateConsignment(b.id) } finally { setActionBusy(null) }
                                }}
                                title="Fire EXTERNAL consignments now for every source branch with still-at-branch bills"
                                style={{
                                  background: `${t.gold}18`, color: t.gold,
                                  border: `1px solid ${t.gold}55`,
                                  borderRadius: 6, padding: '2px 9px',
                                  fontSize: 10, fontWeight: 800, letterSpacing: '.03em',
                                  textTransform: 'uppercase', cursor: actionBusy === b.id ? 'wait' : 'pointer',
                                  opacity: actionBusy === b.id ? 0.6 : 1,
                                }}>
                                {actionBusy === b.id ? '…' : 'Create consignment'}
                              </button>
                            )}
                            {onUnbook && (
                              <button type="button" disabled={actionBusy === b.id}
                                onClick={async () => {
                                  if (actionBusy) return
                                  if (!window.confirm(`Unbook "${b.party}"? The ${b.attached_bills_count} attached bill${b.attached_bills_count === 1 ? '' : 's'} will be released back to the picker and the booking will be cancelled.`)) return
                                  setActionBusy(b.id)
                                  try { await onUnbook(b.id) } finally { setActionBusy(null) }
                                }}
                                title="Cancel the booking and release the attached bills back into the picker"
                                style={{
                                  background: 'transparent', color: t.red,
                                  border: `1px solid ${t.red}55`,
                                  borderRadius: 6, padding: '2px 9px',
                                  fontSize: 10, fontWeight: 800, letterSpacing: '.03em',
                                  textTransform: 'uppercase', cursor: actionBusy === b.id ? 'wait' : 'pointer',
                                  opacity: actionBusy === b.id ? 0.6 : 1,
                                }}>
                                Mark unbooked
                              </button>
                            )}
                          </span>
                        )}
                        {b.created_at && (
                          <span title={`Created by ${b.created_by || 'unknown'}`} style={{ fontFamily: 'monospace' }}>
                            {fmtTS(b.created_at)}
                          </span>
                        )}
                        {b.notes && (billsG ? (
                          <span onClick={(e) => { e.stopPropagation(); toggleBreakdown(b.id) }}
                            title="Click to see the branch-wise breakup of every booked bill"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 360, cursor: 'pointer', color: t.blue, fontWeight: 700 }}>
                            <span style={{ fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {b.notes}</span>
                            <span style={{ fontStyle: 'normal', fontWeight: 800, whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{bdOpen ? '▾ hide breakup' : '▸ view breakup'}</span>
                          </span>
                        ) : (
                          <span title={b.notes} style={{ fontStyle: 'italic', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {b.notes}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', cursor: billsG ? 'pointer' : 'default' }}
                      onClick={() => { if (billsG) toggleBreakdown(b.id) }}
                      title={billsG ? 'Click for the branch-wise breakdown of attached bills' : undefined}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                      {numCell(billsG, { color: billsG ? t.gold : t.text1 })}
                      {billsG ? <span style={{ fontSize: 9, color: bdOpen ? t.gold : t.text4, fontWeight: 800 }}>{bdOpen ? '▾' : '▸'}</span> : null}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{numCell(effectiveGainG, { color: t.orange || '#e58a3b' })}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numCell(pendingG,       { color: t.purple || '#8c5ac8' })}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numCell(pipelineG,      { color: t.purple || '#8c5ac8' })}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap' }}>
                    {fmt(b.weight, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 2, fontWeight: 600 }}>g</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: t.text2, whiteSpace: 'nowrap' }}>
                    ₹{Number(b.rate || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.blue, fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {fmtINR(total)}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {b.is_kl
                      ? <span style={{ background: `${t.purple}1f`, color: t.purple, borderRadius: 4, padding: '2px 9px', fontSize: 10, fontWeight: 800, letterSpacing: '.04em' }}>KL</span>
                      : <span style={{ color: t.text4 }}>—</span>}
                  </td>
                </tr>
                {bdOpen && (
                  <tr>
                    <td colSpan={10} style={{ padding: 0, background: `${t.card2}55`, borderBottom: `1px solid ${t.border}` }}>
                      <div style={{ padding: '10px 18px 14px 44px' }}>
                        {bd?.loading ? (
                          <div style={{ padding: '14px', textAlign: 'center', color: t.text4, fontSize: 12 }}>Loading breakdown…</div>
                        ) : !bd?.branches?.length ? (
                          <div style={{ padding: '14px', color: t.text4, fontSize: 12 }}>No bills attached to this booking yet.</div>
                        ) : (
                          (() => {
                            const bth = (align) => ({ padding: '7px 12px', textAlign: align, fontSize: 9.5, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 800, whiteSpace: 'nowrap', borderBottom: `1px solid ${t.border}` })
                            const btd = (align, color, weight) => ({ padding: '8px 12px', textAlign: align, fontSize: 12.5, color: color || t.text2, fontWeight: weight || 500, whiteSpace: 'nowrap' })
                            return (
                            <>
                              <div style={{ fontSize: 10.5, color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 800, marginBottom: 8 }}>
                                Branch-wise breakup · {bd.total?.bills || 0} bill{(bd.total?.bills || 0) === 1 ? '' : 's'} · {fmt(bd.total?.net_wt || 0, 2)} g net · {bd.branches.length} branch{bd.branches.length === 1 ? '' : 'es'}
                              </div>
                              <table style={{ width: '100%', maxWidth: 640, borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr style={{ background: t.card2 || t.card }}>
                                    <th style={bth('center')}>#</th>
                                    <th style={bth('left')}>Branch</th>
                                    <th style={bth('left')}>Region</th>
                                    <th style={bth('right')}>No. of Bills</th>
                                    <th style={bth('right')}>Net Weight</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {bd.branches.map((br, i) => {
                                    const bkey   = `${b.id}::${br.branch_name}`
                                    const brOpen = openBranches.has(bkey)
                                    return (
                                    <Fragment key={br.branch_name}>
                                      <tr style={{ borderTop: `1px solid ${t.border}25`, cursor: 'pointer' }}
                                          onClick={() => toggleBranch(bkey)}
                                          title="Click to see the bills in this branch">
                                        <td style={btd('center', t.text4)}>{i + 1}</td>
                                        <td style={btd('left', t.text1, 700)}>
                                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ width: 9, display: 'inline-block', fontSize: 9, color: t.text4 }}>{brOpen ? '▾' : '▸'}</span>
                                            {br.branch_name}
                                          </span>
                                        </td>
                                        <td style={btd('left', REGION_COLORS[br.region] || t.text3, 600)}>{br.region || '—'}</td>
                                        <td style={btd('right', t.text2, 600)}>{br.bills.length}</td>
                                        <td style={{ ...btd('right', t.gold, 700), fontFamily: 'monospace' }}>{fmt(br.net_wt, 2)} g</td>
                                      </tr>
                                      {brOpen && (
                                        <tr>
                                          <td colSpan={5} style={{ padding: 0, background: `${t.card2 || t.card}80` }}>
                                            <div style={{ padding: '4px 10px 10px 38px' }}>
                                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                  <tr>
                                                    <th style={bth('left')}>Bill No</th>
                                                    <th style={bth('left')}>Customer</th>
                                                    <th style={bth('left')}>Status</th>
                                                    <th style={bth('right')}>Net Wt</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {br.bills.map((bill, j) => (
                                                    <tr key={bill.application_id || j} style={{ borderTop: `1px solid ${t.border}18` }}>
                                                      <td style={{ ...btd('left', t.gold, 600), fontFamily: 'monospace', fontSize: 11.5 }}>{bill.application_id || '—'}</td>
                                                      <td style={btd('left', t.text2, 500)}>{bill.customer_name || '—'}</td>
                                                      <td style={btd('left', t.text3, 500)}>{(bill.stock_status || '').replace(/_/g, ' ') || '—'}</td>
                                                      <td style={{ ...btd('right', t.text1, 600), fontFamily: 'monospace' }}>{fmt(bill.net_weight, 2)} g</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                    )
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr style={{ borderTop: `2px solid ${t.gold}40`, background: `${t.gold}08` }}>
                                    <td style={btd('center')} />
                                    <td style={btd('left', t.gold, 800)}>Total</td>
                                    <td style={btd('left')} />
                                    <td style={btd('right', t.gold, 800)}>{bd.total?.bills || 0}</td>
                                    <td style={{ ...btd('right', t.gold, 800), fontFamily: 'monospace' }}>{fmt(bd.total?.net_wt || 0, 2)} g</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </>
                            )
                          })()
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
          {activeRows.length > 0 && (() => {
            // Per-cell total renderer — keeps the same "—" empty state
            // styling so totals visually align with their column body
            // cells.
            const totalCell = (val, color) => (
              val > 0
                ? <span style={{ fontFamily: 'monospace', color, fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>
                    {fmt(val, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 1.5, fontWeight: 600 }}>g</span>
                  </span>
                : <span style={{ color: t.text4, fontFamily: 'monospace', fontWeight: 600 }}>—</span>
            )
            return (
              <tfoot>
                <tr style={{ background: `${t.gold}0d`, borderTop: `2px solid ${t.gold}55` }}>
                  <td colSpan={2} style={{ ...td, fontSize: 11, color: t.gold, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800 }}>Σ Active total</td>
                  <td style={{ ...td, textAlign: 'right' }}>{totalCell(totalBills,    t.text1)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{totalCell(totalGain,     t.orange || '#e58a3b')}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{totalCell(totalPending,  t.purple || '#8c5ac8')}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{totalCell(totalPipeline, t.purple || '#8c5ac8')}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap' }}>
                    {fmt(activeWeight, 2)}<span style={{ fontSize: 11, marginLeft: 2, color: t.text3 }}>g</span>
                  </td>
                  <td style={td} />
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: t.blue, fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtINR(activeValue)}</td>
                  <td style={td} />
                </tr>
              </tfoot>
            )
          })()}
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
  // Per-bill audit_hold override — when provided, renders a small Hold /
  // Held control on each bill row. Currently passed only for the Bangalore
  // Section 1 picker (the EOD audit pool). Held bills stay visible but are
  // excluded from auto-select + the 23:30 reconciliation.
  onToggleHold,
  // Branch-level actions for the booked-pending sections only. When both
  // callbacks are provided, the branch row renders [Create] [Unbook]
  // buttons inline; otherwise the row stays clean (default for sections
  // 1-4 which don't pass these).
  onCreateConsignment,
  onUnbookBranch,
  // Region names that should render as a single collapsed summary row
  // instead of an inline divider with every branch listed. Currently
  // only Section 5 (Booked — consignment not created) passes
  // ['Bangalore'] so ops sees one BANGALORE roll-up by default and
  // clicks to drill into the per-branch breakdown. Other regions in
  // the same section stay branch-wise.
  consolidateRegions,
  // Optional flagged sub-group rendered at the bottom of the SAME card,
  // separated by a labeled divider. Used by Section 2 to fold in
  // 'consignment created · booking pending' bills without spawning a
  // second numbered section. Shape: { title, subtitle, icon, branches,
  // total, accent }. The sub-group's rows reuse the exact same renderer
  // (selection, drill-down) as the main list.
  subGroup,
  // Optional band label rendered above the MAIN region list — used when a
  // section stacks two labelled bands (main + subGroup) and the section
  // title alone can't name the main band. Shape: { icon, title, subtitle }.
  mainLabel,
  // Optional 5-card metric strip rendered under the header. Shape:
  // { totalNet, bookedNet, unbookedNet, gainNet, availableNet, rate }.
  metrics,
  // Already-booked bills in this section's window, grouped by branch. Rendered
  // as a read-only "Already booked" band so booked stock stays visible (it
  // doesn't vanish from the section just because it left the picker list).
  bookedBranches,
  // When provided, the Gain card becomes inline-editable. onRateChange(pct)
  // sets the shared company % rate; onSetGainGrams(g) sets a per-section
  // absolute gain override (grams). onAutoSelect() is fired when ops clicks
  // the "Available to Book" card — selects this section's unbooked bills.
  onRateChange,
  onSetGainGrams,
  onAutoSelect,
  // When true (Kerala — no gain), the strip drops the Gain + Available cards and
  // makes the Unbooked Net card itself the clickable selector (Available =
  // Unbooked, so a separate card is redundant).
  noGain = false,
  emptyMsg,
}) {
  const tone = accent || t.gold
  const [editRate, setEditRate] = useState(false)
  const [gainMode, setGainMode] = useState('pct')   // 'pct' | 'abs'
  const [gainDraft, setGainDraft] = useState('')
  // Already-booked band — collapsed by default (just the summary row).
  const [bookedOpen, setBookedOpen] = useState(false)
  // Per-branch expand state for the bill drill-down. Keyed by branch_name
  // within this section — collapses on rerender if the branch disappears.
  const [openBranches, setOpenBranches] = useState(() => new Set())
  const toggleBranchExpand = (name) => setOpenBranches(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })
  // Per-region expand state for the consolidated roll-up. Only applies to
  // regions named in consolidateRegions; everything else renders the
  // branch list inline as before. Starts COLLAPSED so the default view
  // matches what ops asked for ('by default let it be Bangalore').
  const [openConsolidated, setOpenConsolidated] = useState(() => new Set())
  const toggleConsolidatedExpand = (region) => setOpenConsolidated(prev => {
    const next = new Set(prev)
    if (next.has(region)) next.delete(region); else next.add(region)
    return next
  })
  const toSet = (v) => {
    if (!v) return null
    if (v instanceof Set) return v
    return new Set(v)
  }
  const consolidateSet    = toSet(consolidateRegions)
  const subConsolidateSet = toSet(subGroup?.consolidateRegions)
  // Region consolidation is resolved per-entry: main entries read the
  // section-level set, sub-group entries read the sub-group's own set, so
  // the same region name (e.g. 'Bangalore') can render expanded in the
  // main list yet consolidated in the sub-group.
  const isConsolidatedRegion = (region, isSub) =>
    (isSub ? subConsolidateSet : consolidateSet)?.has(region) || false

  // Group branches by region in insertion order (server already sorted by
  // total_net_wt within each branch list).
  const regionsOf = (branchList) => {
    const m = new Map()
    for (const b of branchList || []) {
      const r = b.region || 'Unknown'
      if (!m.has(r)) m.set(r, [])
      m.get(r).push(b)
    }
    // Within each region, order by delivery TAT ascending (24h → 48h → 72h),
    // then by net weight desc as a tiebreak.
    for (const rows of m.values()) {
      rows.sort((a, b) => {
        const ta = a.tat_hours ?? 9999
        const tb = b.tat_hours ?? 9999
        if (ta !== tb) return ta - tb
        return (b.total_net_wt || 0) - (a.total_net_wt || 0)
      })
    }
    return [...m.entries()]
  }
  const regions      = regionsOf(branches)
  const subBranches  = subGroup?.branches || []
  const subRegions   = regionsOf(subBranches)
  // Main region blocks, then (when a sub-group exists) a sentinel divider
  // entry followed by the sub-group's own region blocks. Entries are
  // [region, rows, isSub] — the isSub flag lets the render callback apply
  // the sub-group's own consolidation + namespace its expand state so a
  // region present in both main and sub doesn't cross-toggle.
  const regionRenderList = subRegions.length
    ? [
        ...regions.map(([r, rows]) => [r, rows, false]),
        ['__SUBGROUP_DIVIDER__', { __divider: true }, false],
        ...subRegions.map(([r, rows]) => [r, rows, true]),
      ]
    : regions.map(([r, rows]) => [r, rows, false])
  // Already-booked band (read-only) — booked stock that's part of this
  // section's window but already attached to a booking. Kept visible so the
  // section never looks empty when stock has been booked.
  const bookedRows  = bookedBranches || []
  const bookedBills = bookedRows.reduce((s, b) => s + (b.total_bills || 0), 0)
  const bookedNet   = bookedRows.reduce((s, b) => s + (b.total_net_wt || 0), 0)
  const isEmpty   = branches.length === 0 && subBranches.length === 0 && bookedRows.length === 0
  const unbookedBills = total?.bills  || 0
  const totalBills = unbookedBills + bookedBills   // header count = booked + unbooked
  const totalNet   = (total?.net_wt || 0) + bookedNet
  const subTone    = subGroup?.accent || t.orange || '#e9a942'

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
        {/* Header total — hidden when the metric strip is shown (the Total
            Net card already carries it; showing it twice confused ops). */}
        {!metrics && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 26, color: tone, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1, letterSpacing: '-.01em' }}>{fmt(totalNet, 2)}</span>
              <span style={{ fontSize: 13, color: t.text2, fontWeight: 700 }}>g</span>
            </div>
            <div style={{ fontSize: 11, color: t.text3, marginTop: 5, letterSpacing: '.04em', fontWeight: 700 }}>{totalBills} bill{totalBills === 1 ? '' : 's'}</div>
          </div>
        )}
        {/* When the strip is shown, keep just the bill count on the right so
            the header still reads "N bills" at a glance. */}
        {metrics && (
          <div style={{ fontSize: 11, color: t.text3, letterSpacing: '.04em', fontWeight: 700, flexShrink: 0 }}>{totalBills} bill{totalBills === 1 ? '' : 's'}</div>
        )}
      </div>

      {/* Metric strip — Total / Booked / Unbooked / Gain on unbooked /
          Available to book. Gain applies to the UNBOOKED portion only, so
          Available = Unbooked + its gain. The Gain card's % is editable. */}
      {metrics && (() => {
        const green = t.green || '#3fa66a'
        const blue  = t.blue  || '#4a90d9'
        const canEditGain = !!(onRateChange || onSetGainGrams)
        const openGainEdit = () => {
          if (metrics.gainOverride != null) { setGainMode('abs'); setGainDraft(String(metrics.gainOverride)) }
          else { setGainMode('pct'); setGainDraft(String(metrics.rate)) }
          setEditRate(true)
        }
        const commitGain = () => {
          const v = parseFloat(gainDraft)
          if (Number.isFinite(v) && v >= 0) {
            if (gainMode === 'pct') { if (v <= 100 && onRateChange) onRateChange(v) }
            else if (onSetGainGrams) onSetGainGrams(v)
          }
          setEditRate(false)
        }
        const canSelect = !!onAutoSelect && metrics.unbookedNet > 0
        const cards = noGain ? [
          // Kerala — 3 cards; Unbooked Net IS the selector (no gain, so
          // Available == Unbooked and a separate card would be redundant).
          { key: 'total',    label: 'Total Net',    icon: 'Σ', color: t.text1, val: metrics.totalNet,    bills: totalBills,    sub: 'booked + unbooked' },
          { key: 'booked',   label: 'Booked Net',   icon: '◆', color: blue,    val: metrics.bookedNet,   bills: bookedBills,   sub: 'already booked' },
          { key: 'unbooked', label: 'Unbooked Net', icon: canSelect ? '✓' : '○', color: canSelect ? green : tone, val: metrics.unbookedNet, bills: unbookedBills, sub: canSelect ? 'tap to select →' : 'still to book', strong: canSelect, onClick: canSelect ? onAutoSelect : null },
        ] : [
          { key: 'total',    label: 'Total Net',         icon: 'Σ', color: t.text1, val: metrics.totalNet,     bills: totalBills,    sub: 'booked + unbooked' },
          { key: 'booked',   label: 'Booked Net',        icon: '◆', color: blue,    val: metrics.bookedNet,    bills: bookedBills,   sub: 'already booked' },
          { key: 'unbooked', label: 'Unbooked Net',      icon: '○', color: tone,    val: metrics.unbookedNet,  bills: unbookedBills, sub: 'still to book' },
          { key: 'gain',     label: 'Gain on Unbooked',  icon: '↗', color: green,   val: metrics.gainNet,      gain: true },
          { key: 'avail',    label: 'Available to Book', icon: '✓', color: green,   val: metrics.availableNet, bills: unbookedBills, sub: canSelect ? 'tap to select →' : 'unbooked + gain', strong: true, onClick: canSelect ? onAutoSelect : null },
        ]
        return (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))', gap: 10,
            padding: '14px 18px', borderBottom: `1px solid ${t.border}40`,
            background: `linear-gradient(180deg, ${t.card2 || t.card} 0%, transparent 100%)`,
          }}>
            {cards.map((c) => (
              <div key={c.key}
                onClick={c.onClick || undefined}
                style={{
                position: 'relative', overflow: 'hidden',
                borderRadius: 12, padding: '13px 15px',
                cursor: c.onClick ? 'pointer' : 'default',
                background: c.strong
                  ? `linear-gradient(150deg, ${c.color}24 0%, ${c.color}0c 100%)`
                  : `linear-gradient(150deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
                border: `1px solid ${c.strong ? c.color + '66' : t.border}`,
                boxShadow: c.strong ? `0 2px 10px ${c.color}22` : '0 1px 2px rgba(0,0,0,.12)',
              }}>
                {/* accent edge */}
                <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: c.color, opacity: c.strong ? 1 : .55 }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 9.5, color: c.strong ? c.color : t.text4, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 800 }}>{c.label}</span>
                  <span style={{
                    width: 19, height: 19, borderRadius: 6, flexShrink: 0,
                    background: `${c.color}1f`, color: c.color,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, lineHeight: 1,
                  }}>{c.icon}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 23, color: c.color, fontFamily: 'monospace', fontWeight: c.strong ? 800 : 700, lineHeight: 1, letterSpacing: '-.01em' }}>{fmt(c.val, 2)}</span>
                  <span style={{ fontSize: 12, color: t.text3, fontWeight: 700 }}>g</span>
                  {c.bills != null && (
                    <span style={{ fontSize: 10.5, color: t.text4, fontWeight: 700, marginLeft: 4 }}>
                      · {c.bills} {c.bills === 1 ? 'bill' : 'bills'}
                    </span>
                  )}
                </div>
                {/* Sub-line — editable gain: % rate (shared) or absolute g (per-section) */}
                {c.gain ? (
                  <div style={{ marginTop: 7 }} onClick={e => e.stopPropagation()}>
                    {editRate ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', border: `1px solid ${green}66`, borderRadius: 6, overflow: 'hidden' }}>
                          {[['pct', '%'], ['abs', 'g']].map(([m, lbl]) => (
                            <button key={m} onClick={() => setGainMode(m)}
                              style={{ padding: '2px 7px', fontSize: 9.5, fontWeight: 800, border: 'none', cursor: 'pointer',
                                background: gainMode === m ? green : 'transparent', color: gainMode === m ? '#fff' : green }}>{lbl}</button>
                          ))}
                        </span>
                        <input
                          autoFocus type="number" step={gainMode === 'pct' ? '0.1' : '1'} min="0"
                          value={gainDraft}
                          onChange={e => setGainDraft(e.target.value)}
                          onBlur={commitGain}
                          onKeyDown={e => { if (e.key === 'Enter') commitGain(); if (e.key === 'Escape') setEditRate(false) }}
                          style={{ width: 56, padding: '2px 6px', borderRadius: 6, border: `1px solid ${green}`, background: t.card, color: t.text1, fontSize: 11, fontWeight: 800, fontFamily: 'monospace', outline: 'none' }}
                        />
                        <span style={{ fontSize: 10, color: t.text4, fontWeight: 700 }}>{gainMode === 'pct' ? '%' : 'g'}</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => { if (canEditGain) openGainEdit() }}
                        disabled={!canEditGain}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '2px 8px', borderRadius: 999,
                          border: `1px solid ${green}55`, background: `${green}14`,
                          color: green, fontSize: 10, fontWeight: 800, letterSpacing: '.02em',
                          cursor: canEditGain ? 'pointer' : 'default',
                        }}>
                        {metrics.gainOverride != null ? `set · ${fmt(metrics.gainOverride, 2)} g` : `est · ${fmt(metrics.rate, 2)}%`}
                        {canEditGain && <span style={{ fontSize: 9, opacity: .85 }}>✎</span>}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 9.5, color: t.text4, fontWeight: 600, marginTop: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</div>
                )}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Body */}
      {isEmpty ? (
        <div style={{ padding: '34px 22px', textAlign: 'center', color: t.text3, fontSize: 13, lineHeight: 1.6, fontWeight: 600 }}>
          <div style={{ fontSize: 28, opacity: .35, marginBottom: 7 }}>{icon || '·'}</div>
          {emptyMsg || 'Nothing here yet.'}
        </div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          {mainLabel && regions.length > 0 && (
            <div style={{ margin: '6px 14px 2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                {mainLabel.icon && <span style={{ fontSize: 14 }}>{mainLabel.icon}</span>}
                <span style={{ fontSize: 12.5, color: tone, fontWeight: 800, letterSpacing: '.02em' }}>{mainLabel.title}</span>
              </div>
              {mainLabel.subtitle && (
                <div style={{ fontSize: 11, color: t.text3, marginTop: 4, lineHeight: 1.5 }}>{mainLabel.subtitle}</div>
              )}
            </div>
          )}
          {regionRenderList.map(([region, rows, isSub]) => {
            // Sentinel between the main list and the sub-group — draws a
            // labeled divider so ops reads the sub-group as a flagged
            // continuation of this section, not a new section.
            if (region === '__SUBGROUP_DIVIDER__') {
              return (
                <div key="__subgroup_divider__" style={{
                  margin: '10px 14px 4px',
                  paddingTop: 12,
                  borderTop: `1px dashed ${subTone}55`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    {subGroup?.icon && <span style={{ fontSize: 14 }}>{subGroup.icon}</span>}
                    <span style={{ fontSize: 12.5, color: subTone, fontWeight: 800, letterSpacing: '.02em' }}>
                      {subGroup?.title || 'Also bookable'}
                    </span>
                    {subGroup?.total && (
                      <span style={{ fontSize: 11, color: t.text3, fontFamily: 'monospace', fontWeight: 700 }}>
                        {fmt(subGroup.total.net_wt || 0, 2)} g · {subGroup.total.bills || 0} bill{(subGroup.total.bills || 0) === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {subGroup?.subtitle && (
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 4, lineHeight: 1.5 }}>{subGroup.subtitle}</div>
                  )}
                </div>
              )
            }
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
            const consolidated   = isConsolidatedRegion(region, isSub)
            // Namespace the consolidated-expand key so a region present in
            // both the main list and the sub-group doesn't cross-toggle.
            const consolidateKey = isSub ? `sub:${region}` : region
            const regionExpanded = openConsolidated.has(consolidateKey)
            const showBranches   = !consolidated || regionExpanded
            // Region totals — only need them when rendering the
            // consolidated roll-up row.
            const regBills = consolidated ? rows.reduce((s, r) => s + (r.total_bills    || 0), 0) : 0
            const regGross = consolidated ? rows.reduce((s, r) => s + (r.total_gross_wt || 0), 0) : 0
            const regNet   = consolidated ? rows.reduce((s, r) => s + (r.total_net_wt   || 0), 0) : 0
            return (
              <div key={consolidateKey} style={{ padding: '11px 20px', borderTop: `1px solid ${t.border}25` }}>
                {consolidated ? (
                  // ── Consolidated region row — single roll-up that drills
                  //    down into the existing per-branch list on click.
                  //    Layout mirrors a branch row so the columns line up
                  //    with the regular branch rows that appear below when
                  //    expanded.
                  <div
                    onClick={() => toggleConsolidatedExpand(consolidateKey)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = `${rColor}10` }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = regionExpanded ? `${rColor}0c` : 'transparent' }}
                    style={{
                      display: 'grid', gridTemplateColumns: rowGrid, alignItems: 'center',
                      columnGap: 14, padding: '12px 11px', borderRadius: 8,
                      cursor: 'pointer',
                      background: regionExpanded ? `${rColor}0c` : 'transparent',
                      border: `1px solid ${regionExpanded ? `${rColor}50` : `${rColor}28`}`,
                      transition: 'background .15s ease, border-color .15s ease',
                    }}>
                    {/* Col 1: region dot (no checkbox in consolidated row) */}
                    <span style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: `${rColor}40`, border: `1.5px solid ${rColor}`,
                      display: 'inline-flex', flexShrink: 0,
                    }} />
                    {/* Col 2: REGION label + branch count */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: 14, color: rColor, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{region}</span>
                      <span style={{ fontSize: 11, color: t.text3, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {rows.length} branch{rows.length === 1 ? '' : 'es'}
                      </span>
                      <span style={{ fontSize: 10.5, color: t.text4, fontWeight: 500, fontStyle: 'italic' }}>
                        {regionExpanded ? 'click to collapse' : 'click to drill down'}
                      </span>
                    </div>
                    {/* Col 3: aggregated gross */}
                    <span title="Aggregated gross weight" style={{ fontSize: 12.5, color: t.text2, fontFamily: 'monospace', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {fmt(regGross, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 2, fontWeight: 600 }}>g gross</span>
                    </span>
                    {/* Col 4: aggregated net (primary) */}
                    <span title="Aggregated net weight" style={{ fontSize: 15, color: tone, fontFamily: 'monospace', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>
                      {fmt(regNet, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 2, fontWeight: 600 }}>g</span>
                    </span>
                    {/* Col 5: aggregated bill count */}
                    <span style={{ fontSize: 12, color: t.text2, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap', fontWeight: 700 }}>
                      {regBills} bill{regBills === 1 ? '' : 's'}
                    </span>
                    {/* Col 6: expand caret */}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, borderRadius: 6,
                      color: regionExpanded ? rColor : t.text3,
                      fontSize: 13, fontWeight: 800,
                      background: regionExpanded ? `${rColor}18` : 'transparent',
                      border: `1px solid ${regionExpanded ? `${rColor}66` : 'transparent'}`,
                      transition: 'all .15s ease',
                    }}>
                      {regionExpanded ? '▾' : '▸'}
                    </span>
                  </div>
                ) : (
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
                )}
                {showBranches && (
                  // Tiny left-indent on expanded branches so the visual
                  // hierarchy (region → branch → bills) is obvious.
                  <div style={{ marginLeft: consolidated ? 14 : 0, marginTop: consolidated ? 6 : 0, paddingLeft: consolidated ? 10 : 0, borderLeft: consolidated ? `2px solid ${rColor}40` : 'none' }}>
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
                      {/* Col 2: branch name + meta chips, plus optional booking
                          caption inline (only on Section 5 / S4 booked-pending
                          rows). Inline placement uses the empty space after
                          the 24h TAT chip instead of stacking a new line. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, color: t.text1, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.branch_name}</span>
                        {b.tat_hours != null && (
                          <span title={`Delivery TAT ${b.tat_hours}h`} style={{ fontSize: 10.5, color: t.text3, background: `${t.text4}1c`, border: `1px solid ${t.text4}2e`, borderRadius: 4, padding: '1px 8px', whiteSpace: 'nowrap', fontWeight: 700, letterSpacing: '.03em' }}>{b.tat_hours}h TAT</span>
                        )}
                        {/* Pickup time intentionally suppressed — pickups
                            can run late and we don't want ops to think a
                            branch is "done" just because the scheduled
                            time has passed. Eligibility is gated by
                            pickup_days (today is a pickup day), not by
                            the clock. */}
                        {(b._booking_earliest || (b._booking_users && b._booking_users.length > 0)) && (
                          <span style={{ fontSize: 11, color: t.text2, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                            {b._booking_earliest && (
                              <>
                                booked {fmtTS(b._booking_earliest)}
                                {b._booking_latest && b._booking_latest !== b._booking_earliest ? ` → ${fmtTS(b._booking_latest)}` : ''}
                              </>
                            )}
                            {b._booking_users && b._booking_users.length > 0 && (
                              <> · by {b._booking_users.join(', ')}</>
                            )}
                          </span>
                        )}
                        {/* Consignment-creation caption — only present on the
                            Section 2 'booking pending' sub-group rows, where
                            the API attaches _consignment_earliest + creators.
                            Tells ops who dispatched the consignment and when,
                            so they can chase the missing booking. */}
                        {(b._consignment_earliest || (b._consignment_creators && b._consignment_creators.length > 0)) && (
                          <span style={{ fontSize: 11, color: t.text3, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                            {b._consignment_earliest && (
                              <>
                                created {fmtTS(b._consignment_earliest)}
                                {b._consignment_latest && b._consignment_latest !== b._consignment_earliest ? ` → ${fmtTS(b._consignment_latest)}` : ''}
                              </>
                            )}
                            {b._consignment_creators && b._consignment_creators.length > 0 && (
                              <> · by {b._consignment_creators.join(', ')}</>
                            )}
                          </span>
                        )}
                        {/* Branch-level actions for booked-pending rows only.
                            Both handlers must be passed (only Section 5 / S4
                            wire them up). Stops row-click propagation so
                            clicking the button doesn't toggle row selection. */}
                        {onCreateConsignment && onUnbookBranch && (b.bills?.length > 0) && (
                          <span style={{ display: 'inline-flex', gap: 8, marginLeft: 10, alignItems: 'center' }}
                            onClick={(e) => e.stopPropagation()}>
                            <button type="button"
                              onClick={() => onCreateConsignment(b.branch_name, b.region)}
                              title="Open Consignment Data for this branch to pack a consignment around these bills."
                              style={{
                                background: t.gold, color: '#1a0a00', border: 'none',
                                borderRadius: 7, padding: '5px 14px',
                                fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
                                cursor: 'pointer', whiteSpace: 'nowrap',
                                fontFamily: 'inherit',
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                boxShadow: `0 2px 6px ${t.gold}40`,
                                transition: 'transform .15s ease, box-shadow .15s ease',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${t.gold}66` }}
                              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)';    e.currentTarget.style.boxShadow = `0 2px 6px ${t.gold}40` }}>
                              Create Consignment <span style={{ fontSize: 12 }}>→</span>
                            </button>
                            <button type="button"
                              onClick={() => onUnbookBranch((b.bills || []).map(x => x.application_id).filter(Boolean), b.branch_name)}
                              title="Release the booking on all bills at this branch — clears booking_id + booked_at."
                              style={{
                                background: 'transparent', color: t.red,
                                border: `1px solid ${t.red}55`,
                                borderRadius: 7, padding: '5px 12px',
                                fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
                                cursor: 'pointer', whiteSpace: 'nowrap',
                                fontFamily: 'inherit',
                                transition: 'background .15s ease, border-color .15s ease, color .15s ease',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = `${t.red}12`; e.currentTarget.style.borderColor = `${t.red}99` }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = `${t.red}55` }}>
                              Unbook
                            </button>
                          </span>
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
                          // Optional trailing column for the audit_hold control —
                          // only when SourceSection was given onToggleHold (Bangalore S1).
                          const billCols = selectable
                            ? `20px 78px 130px minmax(0, 1fr) 100px 100px 130px${onToggleHold ? ' 70px' : ''}`
                            : `78px 130px minmax(0, 1fr) 100px 100px 130px${onToggleHold ? ' 70px' : ''}`
                          const headerCols = (
                            <>
                              {selectable && <span />}
                              <span>Date</span>
                              <span>App ID</span>
                              <span>Customer</span>
                              <span style={{ textAlign: 'right' }}>Gross</span>
                              <span style={{ textAlign: 'right' }}>Net</span>
                              <span style={{ textAlign: 'right' }}>Amount</span>
                              {onToggleHold && <span style={{ textAlign: 'center' }}>Hold</span>}
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
                                const isHeld      = !!bill.audit_hold
                                return (
                                  <div key={bill.id ?? idx}
                                    onClick={() => { if (selectable && !locked && !isHeld) onToggleBill?.(bill.id) }}
                                    onMouseEnter={(e) => { if (selectable && !locked && !isHeld) e.currentTarget.style.background = `${tone}10` }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = billChecked ? `${tone}1c` : (isHeld ? `${t.orange || '#c9981f'}0c` : (idx % 2 === 1 ? `${t.card2}40` : 'transparent')) }}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: billCols,
                                      alignItems: 'center',
                                      columnGap: 14, padding: '5px 8px', borderRadius: 5,
                                      background: billChecked ? `${tone}1c` : (isHeld ? `${t.orange || '#c9981f'}0c` : (idx % 2 === 1 ? `${t.card2}40` : 'transparent')),
                                      fontFamily: 'monospace', fontSize: 12,
                                      cursor: selectable ? (locked || isHeld ? 'not-allowed' : 'pointer') : 'default',
                                      opacity: (selectable && locked) || isHeld ? 0.55 : 1,
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
                                    {/* Purchase date — compact "10 Jun" form. */}
                                    <span style={{ color: t.text3, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                      {bill.purchase_date ? fmtDateShort(bill.purchase_date) : '—'}
                                    </span>
                                    <span style={{ color: t.gold, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.application_id || '—'}</span>
                                    {/* Customer cell — stacked with optional booking caption (only
                                        present for Section 5 / S4 booked-pending rows). When the
                                        booking metadata fields are absent, this renders identical
                                        to the original single-line span. */}
                                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                                      <span style={{ color: t.text1, fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.customer_name || '—'}</span>
                                      {(bill._booking_party || bill.booked_at) && (
                                        <span style={{ fontSize: 10, color: t.text4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                                          {bill._booking_party && <span style={{ color: t.red, fontWeight: 700 }}>{bill._booking_party}</span>}
                                          {bill.booked_at && <> · {fmtTS(bill.booked_at)}</>}
                                          {bill._booking_created_by && <> · by {bill._booking_created_by}</>}
                                        </span>
                                      )}
                                    </span>
                                    <span style={{ color: t.text2, textAlign: 'right', fontWeight: 600 }}>{fmt(bill.gross_weight, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 2, fontWeight: 600 }}>g</span></span>
                                    <span style={{ color: tone, textAlign: 'right', fontWeight: 800 }}>{fmt(bill.net_weight, 2)}<span style={{ fontSize: 10, color: t.text3, marginLeft: 2, fontWeight: 600 }}>g</span></span>
                                    <span style={{ color: t.blue, textAlign: 'right', fontWeight: 700 }}>{bill.total_amount != null ? `₹${Math.round(Number(bill.total_amount)).toLocaleString('en-IN')}` : '—'}</span>
                                    {onToggleHold && (
                                      <span style={{ textAlign: 'center' }}>
                                        <button type="button"
                                          onClick={(e) => { e.stopPropagation(); onToggleHold(bill.id, !isHeld) }}
                                          disabled={billChecked}
                                          title={isHeld ? 'Release hold — bill returns to the EOD audit pool' : 'Hold this bill — excluded from auto-select and the 23:30 audit'}
                                          style={{
                                            background: isHeld ? `${t.orange || '#c9981f'}25` : 'transparent',
                                            color:      isHeld ? (t.orange || '#c9981f') : t.text4,
                                            border:     `1px solid ${isHeld ? `${t.orange || '#c9981f'}70` : t.border2}`,
                                            borderRadius: 5,
                                            padding: '2px 8px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em',
                                            textTransform: 'uppercase',
                                            cursor: billChecked ? 'not-allowed' : 'pointer',
                                            opacity: billChecked ? 0.4 : 1,
                                            fontFamily: 'inherit',
                                          }}>
                                          {isHeld ? '⛔ held' : 'hold'}
                                        </button>
                                      </span>
                                    )}
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
                )}
              </div>
            )
          })}

          {/* Already-booked band — read-only. Booked stock in this window stays
              visible so the section never looks empty after booking. */}
          {bookedRows.length > 0 && (() => {
            const bk = t.blue || '#4a90d9'
            return (
              <div style={{ margin: '10px 14px 4px', paddingTop: 12, borderTop: `1px dashed ${bk}44` }}>
                {/* Summary row — click to expand the booked branches. Collapsed
                    by default so the section stays compact. */}
                <div onClick={() => setBookedOpen(o => !o)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: bookedOpen ? 6 : 0, cursor: 'pointer', userSelect: 'none' }}>
                  <span style={{ color: bookedOpen ? bk : t.text4, fontSize: 11, fontWeight: 800, width: 12, textAlign: 'center' }}>{bookedOpen ? '▾' : '▸'}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: bk, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 5, background: `${bk}22`, color: bk, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900 }}>✓</span>
                    Already booked
                  </span>
                  <span style={{ fontSize: 11, color: t.text3, fontFamily: 'monospace', fontWeight: 700 }}>
                    {fmt(bookedNet, 2)} g · {bookedBills} bill{bookedBills === 1 ? '' : 's'}
                  </span>
                </div>
                {bookedOpen && bookedRows.map(b => (
                  <div key={`bk-${b.branch_name}`} style={{ display: 'grid', gridTemplateColumns: rowGrid, alignItems: 'center', columnGap: 14, padding: '8px 11px', borderRadius: 8, opacity: 0.72 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: `${bk}22`, color: bk, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 }}>✓</span>
                    <span style={{ fontSize: 13, color: t.text2, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.branch_name}</span>
                    <span style={{ textAlign: 'right', color: t.text3, fontWeight: 600 }}>{fmt(b.total_gross_wt, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 2 }}>g</span></span>
                    <span style={{ textAlign: 'right', color: bk, fontWeight: 800 }}>{fmt(b.total_net_wt, 2)}<span style={{ fontSize: 10, color: t.text4, marginLeft: 2 }}>g</span></span>
                    <span style={{ textAlign: 'right', color: t.text3, fontWeight: 700 }}>{b.total_bills} bill{b.total_bills === 1 ? '' : 's'}</span>
                    <span />
                  </div>
                ))}
              </div>
            )
          })()}
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
// Advanced bidder picker. The anchor is a button that shows an avatar +
// the picked bidder (or a placeholder); clicking opens a popover with a
// sticky search box, a "Recent" section (last 4 picks from localStorage),
// the full bidder list, and an "Add new" row if the search term doesn't
// match any existing bidder. Keyboard: ↑/↓ to highlight, Enter to pick,
// Esc to close.
function BidderCombobox({ t, value, onChange, options, onAddNew }) {
  const [open, setOpen]           = useState(false)
  const [query, setQuery]         = useState('')
  const [highlight, setHighlight] = useState(0)
  const [recent, setRecent] = useState(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(window.localStorage.getItem('bidding.recentBidders') || '[]') } catch { return [] }
  })
  const wrapRef   = useRef(null)
  const searchRef = useRef(null)

  // Close on outside click. Reset the search on close so the next open
  // starts fresh.
  useEffect(() => {
    if (!open) { setQuery(''); setHighlight(0); return }
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    // Auto-focus search when popover opens (user can immediately filter).
    queueMicrotask(() => searchRef.current?.focus())
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Filter + section logic. "Recent" only surfaces names still present in
  // the live options roster (stale recents would be confusing).
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return options
    return options.filter(o => o.toLowerCase().includes(q))
  }, [options, q])
  const recentInOptions = useMemo(() => {
    const inSet = new Set(filtered.map(o => o.toLowerCase()))
    return recent.filter(r => inSet.has(r.toLowerCase()))
  }, [recent, filtered])
  // "All" excludes recents to avoid duplicates when no search term.
  const recentSet = new Set(recentInOptions.map(r => r.toLowerCase()))
  const rest      = filtered.filter(o => !recentSet.has(o.toLowerCase()))
  const flat      = [...recentInOptions, ...rest]
  const isExactMatch = q.length > 0 && options.some(o => o.toLowerCase() === q)
  const isNew        = q.length > 0 && !isExactMatch

  // Highlight stays within range as the filtered list shrinks/grows.
  useEffect(() => { setHighlight(0) }, [q])

  const pick = (name) => {
    onChange(name)
    setOpen(false)
    setQuery('')
    if (typeof window === 'undefined') return
    const next = [name, ...recent.filter(r => r.toLowerCase() !== name.toLowerCase())].slice(0, 4)
    setRecent(next)
    try { window.localStorage.setItem('bidding.recentBidders', JSON.stringify(next)) } catch {}
  }

  const onKey = (e) => {
    if (e.key === 'Escape')         { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(flat.length - 1 + (isNew ? 1 : 0), h + 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      // If highlight is on the "+ Add new" row (last index when isNew)
      if (isNew && highlight === flat.length) {
        if (onAddNew) onAddNew(query.trim())
        pick(query.trim())
        return
      }
      const pickName = flat[highlight]
      if (pickName) pick(pickName)
    }
  }

  // Anchor — when empty, shows placeholder. When set, shows avatar pill +
  // bidder name + clear button. Single click opens the popover.
  const avatar = value ? (
    <span style={{
      width: 22, height: 22, borderRadius: '50%',
      background: hashAvatarBg(value, t), color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 800, flexShrink: 0,
      boxShadow: `0 0 0 2px ${t.card}`,
    }}>{value[0].toUpperCase()}</span>
  ) : (
    <span style={{
      width: 22, height: 22, borderRadius: '50%',
      background: `${t.text4}18`, border: `1px dashed ${t.border2 || t.border}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, color: t.text4, fontWeight: 800, flexShrink: 0,
    }}>?</span>
  )

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          background: t.card2 || t.card, border: `1px solid ${value ? `${t.gold}55` : t.border}`,
          borderRadius: 8, padding: '8px 10px 8px 8px',
          cursor: 'pointer', color: t.text1, textAlign: 'left',
          transition: 'border-color .15s ease, background .15s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = `${t.gold}66` }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = value ? `${t.gold}55` : t.border }}>
        {avatar}
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: value ? 700 : 500, color: value ? t.text1 : t.text4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || 'Pick a bidder…'}
        </span>
        {value && (
          <span role="button" tabIndex={-1}
            onClick={e => { e.stopPropagation(); onChange(''); }}
            style={{
              fontSize: 11, color: t.text4, padding: '2px 6px',
              border: `1px solid ${t.border}`, borderRadius: 99,
              background: 'transparent', cursor: 'pointer',
              transition: 'color .15s ease, background .15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = t.red; e.currentTarget.style.background = `${t.red}10` }}
            onMouseLeave={e => { e.currentTarget.style.color = t.text4; e.currentTarget.style.background = 'transparent' }}>
            ✕ clear
          </span>
        )}
        <span style={{ color: t.text3, fontSize: 10, marginLeft: 2, transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)',
          background: t.card, border: `1px solid ${t.border}`,
          borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,.45)',
          maxHeight: 320, overflow: 'hidden', zIndex: 200,
          display: 'flex', flexDirection: 'column',
          animation: 'bidRowIn .15s cubic-bezier(.4,0,.2,1)',
        }}>
          {/* Sticky search */}
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${t.border}`, background: t.card }}>
            <input ref={searchRef} value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search or add new…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: t.card2 || t.card, border: `1px solid ${t.border}`,
                borderRadius: 7, padding: '7px 10px', fontSize: 12.5, color: t.text1,
                outline: 'none',
                fontWeight: 600,
              }} />
          </div>

          <div style={{ overflowY: 'auto', maxHeight: 240 }}>
            {/* Recent — only when present and no search query */}
            {!q && recentInOptions.length > 0 && (
              <>
                <div style={{ padding: '6px 12px 4px', fontSize: 9, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 800, background: `${t.text4}06` }}>
                  Recent
                </div>
                {recentInOptions.map((o, i) => {
                  const idx = i
                  const isSelected = o === value
                  const isHL       = idx === highlight
                  return (
                    <BidderRow key={`r-${o}`} t={t} name={o}
                      isSelected={isSelected} isHL={isHL}
                      onPick={() => pick(o)} />
                  )
                })}
              </>
            )}

            {/* All bidders */}
            {rest.length > 0 && (
              <>
                <div style={{ padding: '6px 12px 4px', fontSize: 9, color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 800, background: `${t.text4}06` }}>
                  {q ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : 'All bidders'}
                </div>
                {rest.map((o, i) => {
                  const idx = recentInOptions.length + i
                  const isSelected = o === value
                  const isHL       = idx === highlight
                  return (
                    <BidderRow key={`a-${o}`} t={t} name={o}
                      isSelected={isSelected} isHL={isHL}
                      onPick={() => pick(o)} />
                  )
                })}
              </>
            )}

            {/* Empty state when nothing matches and no new-name to add */}
            {flat.length === 0 && !isNew && (
              <div style={{ padding: '24px 14px', fontSize: 11.5, color: t.text4, textAlign: 'center', fontStyle: 'italic' }}>
                No bidders yet — type a name above to add one
              </div>
            )}

            {/* Add-new — green row at the bottom of results */}
            {isNew && (
              <button type="button"
                onClick={() => { if (onAddNew) onAddNew(query.trim()); pick(query.trim()) }}
                style={{
                  width: '100%', textAlign: 'left',
                  background: highlight === flat.length ? `${t.green}25` : `${t.green}10`,
                  border: 'none', borderTop: `1px solid ${t.border}`,
                  padding: '10px 14px',
                  fontSize: 12.5, color: t.green, fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${t.green}25` }}
                onMouseLeave={e => { e.currentTarget.style.background = highlight === flat.length ? `${t.green}25` : `${t.green}10` }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: t.green, color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, lineHeight: 1,
                }}>+</span>
                <span>Add “<span style={{ fontWeight: 900 }}>{query.trim()}</span>” as new bidder</span>
              </button>
            )}
          </div>

          {/* Footer hint — keyboard shortcuts */}
          <div style={{
            padding: '6px 12px', fontSize: 10, color: t.text4,
            borderTop: `1px solid ${t.border}`, background: t.card2 || t.card,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            <span>↑↓ navigate · <kbd style={{ fontFamily: 'monospace', background: `${t.text4}15`, padding: '1px 5px', borderRadius: 3 }}>↵</kbd> pick · <kbd style={{ fontFamily: 'monospace', background: `${t.text4}15`, padding: '1px 5px', borderRadius: 3 }}>Esc</kbd> close</span>
            <span style={{ fontWeight: 700 }}>{options.length} total</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Single row inside the bidder popover. Pulled out so the recent + all
// sections render identically.
function BidderRow({ t, name, isSelected, isHL, onPick }) {
  return (
    <button type="button" onClick={onPick}
      style={{
        width: '100%', textAlign: 'left',
        background: isHL ? `${t.gold}1c` : (isSelected ? `${t.gold}10` : 'transparent'),
        border: 'none', borderLeft: isHL ? `3px solid ${t.gold}` : '3px solid transparent',
        padding: '8px 12px',
        fontSize: 12.5, color: isSelected ? t.gold : t.text1,
        fontWeight: isSelected ? 800 : 600,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        transition: 'background .1s',
      }}
      onMouseEnter={e => { if (!isHL && !isSelected) e.currentTarget.style.background = `${t.text4}10` }}
      onMouseLeave={e => { if (!isHL && !isSelected) e.currentTarget.style.background = 'transparent' }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%',
        background: hashAvatarBg(name, t), color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, flexShrink: 0,
      }}>{name[0].toUpperCase()}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {isSelected && <span style={{ color: t.gold, fontSize: 12 }}>✓</span>}
    </button>
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
function BookingModal({ t, arrivalDate, availablePool, remainingQty, incomingNetWt, gainGrams, pendingGrams, onSavePending, savingPending, bookedQty, selected, selectedTotal, billsById, bidders, effectiveGainRate, isKerala, onSubmit, onClose, onSuccess, onSubmitGuardFail, onDetachBills }) {
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
  //
  // Kerala exception — per ops, gains aren't applied to Kerala bookings
  // by default (the consolidation flow already nets out refining loss
  // upstream). Default rate = 0 % for Kerala; operator can still type a
  // value to override.
  const DEFAULT_GAIN_RATE   = isKerala ? 0 : 0.035
  const liveGainRate        = (effectiveGainRate && effectiveGainRate > 0 && !isKerala) ? effectiveGainRate : DEFAULT_GAIN_RATE
  const defaultGainGrams    = netFromSelection > 0 ? netFromSelection * liveGainRate : 0
  const [gainsEntry,        setGainsEntry]      = useState(() => defaultGainGrams > 0 ? defaultGainGrams.toFixed(2) : '')
  const [gainsEntryDirty,   setGainsEntryDirty] = useState(false)
  const [includePending,    setIncludePending]  = useState(false)
  // Inline Pending Delivery editor — the shared, server-side carry-over for
  // this arrival date (positive = delayed gold rolling in, negative = a
  // pull-back). Edited here now that the hero Pending card is gone. Saving
  // persists globally (every device sees it on next poll); a non-zero save
  // auto-ticks "include" so it folds into this booking immediately.
  const [pendingEditing, setPendingEditing] = useState(false)
  const [pendingDraft,   setPendingDraft]   = useState('')
  const pendingCancelRef = useRef(false)     // set on Escape so the blur-commit is skipped
  const startEditPending = () => { pendingCancelRef.current = false; setPendingDraft(pendingGrams ? String(pendingGrams) : ''); setPendingEditing(true) }
  const cancelEditPending = () => { pendingCancelRef.current = true; setPendingEditing(false) }
  const commitPending = async () => {
    if (pendingCancelRef.current) { pendingCancelRef.current = false; return }
    const n = Number(pendingDraft)
    if (!Number.isFinite(n) || n === Number(pendingGrams || 0)) { setPendingEditing(false); return }
    const ok = await onSavePending?.(n)
    if (ok) { setPendingEditing(false); setIncludePending(n !== 0) }
  }
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

  // Difference vs the operator-built Total Bidding Weight (Selected +
  // Gains + Pending). When the operator commits MORE than that to a
  // bidder, the excess has to be attributed to either:
  //   · additional gain (we'll realize more than the 3.5 % default), or
  //   · pipeline (book against tomorrow's incoming purchases).
  // The operator ticks one or both — we record the attribution in the
  // notes string. No red anywhere; over-bookings are a normal flow.
  const overBy = wValid && totalBiddingW > 0 ? Math.max(0, w - totalBiddingW) : 0
  const [attrGain,     setAttrGain]     = useState(false)
  const [attrPipeline, setAttrPipeline] = useState(false)
  // Opt-in: when ticked, the pipeline auto-attacher will also draw from
  // outstation 24h-transit bills (non-Kerala) arriving on the booking's
  // arrival date — not just tomorrow's Bangalore purchases. Hidden until
  // the operator actually attributes excess to pipeline; auto-cleared if
  // they untick pipeline or switch to a Kerala booking.
  const [pipelineIncludeInTransit, setPipelineIncludeInTransit] = useState(false)
  useEffect(() => {
    if (!attrPipeline || isKerala) setPipelineIncludeInTransit(false)
  }, [attrPipeline, isKerala])
  // Drop attribution if the difference disappears (e.g. operator rounds
  // back down or adds more gains so the total catches up).
  useEffect(() => {
    if (overBy <= 0) {
      if (attrGain)     setAttrGain(false)
      if (attrPipeline) setAttrPipeline(false)
    }
  }, [overBy]) // eslint-disable-line react-hooks/exhaustive-deps

  // EXCESS — operator committed LESS than the selected booking weight
  // (bid < net + gain). The extra has to come OFF: trim it from gain, or
  // detach Bangalore-only bills (smallest first; gain absorbs any sub-bill
  // remainder). This stops the booking from being over-attached.
  const selectedBookingW = netFromSelection + addedGainsW
  const excessBy = wValid && selectedBookingW > 0 ? Math.max(0, selectedBookingW - w) : 0
  // Bangalore-only selected bills, smallest net first — the only detachable pool.
  const bangSelected = useMemo(() => {
    const out = []
    for (const id of selected) {
      const b = billsById?.[id]
      if (b && b._group === 'bangalore') out.push(b)
    }
    return out.sort((a, b) => Number(a.net_weight || 0) - Number(b.net_weight || 0))
  }, [selected, billsById])
  const canTrimGain = excessBy > 0 && excessBy <= addedGainsW + 0.001
  // Trim the excess straight off gain (viable while gain can absorb it).
  const trimFromGain = () => {
    const newGain = Math.max(0, addedGainsW - excessBy)
    setGainsEntry(newGain.toFixed(2)); setGainsEntryDirty(true)
  }
  const canDetachBangalore = excessBy > 0 && bangSelected.length > 0
  // Auto-detach smallest Bangalore bills (gain-adjusted contribution) until the
  // excess is covered, then land exactly on the bid by trimming gain.
  const detachBangalore = () => {
    let rem = excessBy, detachedNet = 0
    const toDetach = []
    for (const b of bangSelected) {
      if (rem <= 0.001) break
      const contrib = Number(b.net_weight || 0) * (1 + liveGainRate)
      if (contrib <= rem + 0.001) { toDetach.push(b.id); detachedNet += Number(b.net_weight || 0); rem -= contrib }
    }
    if (toDetach.length && onDetachBills) onDetachBills(toDetach)
    const newNet  = Math.max(0, netFromSelection - detachedNet)
    const newGain = Math.max(0, w - newNet)        // land net + gain = bid
    setGainsEntry(newGain.toFixed(2)); setGainsEntryDirty(true)
  }

  const submit = async () => {
    // Loud diagnostics — these logs and the visible bail-toast guarantee
    // we never have another "I clicked but nothing happened" scenario.
    // If a guard returns, the operator sees WHY in a toast.
    console.log('[BookingModal] submit() entered', {
      party: party.trim() || '(empty)',
      weight: w, rate: r, overBy,
      attrGain, attrPipeline,
      selected_count: selected?.size ?? 0,
    })
    if (!party.trim()) {
      console.warn('[BookingModal] guard: bidder missing')
      if (onSubmitGuardFail) onSubmitGuardFail('Pick a bidder before creating the booking.')
      return
    }
    if (!Number.isFinite(w) || w <= 0) {
      console.warn('[BookingModal] guard: invalid weight', w)
      if (onSubmitGuardFail) onSubmitGuardFail('Bidding weight is missing or invalid.')
      return
    }
    if (!Number.isFinite(r) || r <= 0) {
      console.warn('[BookingModal] guard: invalid rate', r)
      if (onSubmitGuardFail) onSubmitGuardFail('Rate is missing or invalid.')
      return
    }
    if (excessBy > 0.05) {
      console.warn('[BookingModal] guard: excess not reconciled', excessBy)
      if (onSubmitGuardFail) onSubmitGuardFail(`Bid is ${excessBy.toFixed(2)} g under the selected weight — reduce gain or detach Bangalore bills first.`)
      return
    }
    if (overBy > 0 && !attrGain && !attrPipeline) {
      console.warn('[BookingModal] guard: overBy attribution required', overBy)
      if (onSubmitGuardFail) onSubmitGuardFail(`Booking is ${overBy.toFixed(2)} g over total — tick ${isKerala ? 'Pipeline' : 'Additional gain or Pipeline'} first.`)
      return
    }
    setBusy(true)
    try {
      // Pin the new name into the local roster on submit too — covers the
      // case where the operator skipped the explicit "+ Save" button.
      if (isNewBidder) saveNewBidder()
      const attrBits = []
      if (attrGain)     attrBits.push('additional_gain')
      if (attrPipeline) attrBits.push('pipeline')
      const compositeNotes = [
        selectedBranchNames.length ? `Sources: ${selectedBranchNames.join(', ')}` : null,
        overBy > 0 && attrBits.length ? `Excess ${overBy.toFixed(2)} g · from ${attrBits.join(' + ')}` : null,
      ].filter(Boolean).join(' · ') || null
      // Pipeline payload — when ops ticks "Pipeline" attribution the
      // backend stores the gap (in grams) and the bidder's region so the
      // sync-purchases hook can auto-attach incoming bills until fulfilled.
      const pipelineRemainingG = attrPipeline && overBy > 0 ? overBy : 0
      const pipelineRegion = attrPipeline && overBy > 0
        ? (isKerala ? 'Kerala' : 'Bangalore')      // PHASE 1: Bangalore wires up the attacher; others just persist
        : null
      // Breakdown payload — snapshot of how the committed weight was
      // built so the Bookings tab can render it bill-style without
      // parsing the notes string.
      const ok = await onSubmit({
        party:       party.trim(),
        buyer_phone: null,
        weight:      w,
        rate:        r,
        purity:      null,
        is_kl:       !!isKerala,
        notes:       compositeNotes,
        pipeline_remaining_g:        pipelineRemainingG,
        pipeline_region:             pipelineRegion,
        // Kerala always back-fills pipeline from BOTH S1 (hub stock) and S2
        // (branch → hub) — no opt-in toggle. KA·AP·TS keeps the per-booking
        // "also use 24h in-transit" opt-in.
        pipeline_include_in_transit: !!(attrPipeline && overBy > 0 && (isKerala || pipelineIncludeInTransit)),
        // Breakdown — each component of the operator-built total.
        bills_net_weight_g:   Number(netFromSelection.toFixed(3)),
        gain_applied_g:       Number(addedGainsW.toFixed(3)),
        pending_g:            Number(addedPendingW.toFixed(3)),
        additional_gain_g:    attrGain && overBy > 0 && !attrPipeline ? Number(overBy.toFixed(3)) : 0,
        pipeline_original_g:  attrPipeline && overBy > 0 ? Number(overBy.toFixed(3)) : 0,
      })
      if (ok && onSuccess) onSuccess()
      if (!ok) setBusy(false)
    } catch (err) {
      // Anything thrown inside onSubmit lands here so the button can't get
      // stuck in "Creating…" with no visible feedback.
      console.error('[BookingModal] submit threw:', err)
      setBusy(false)
    }
  }

  const valid = party.trim() && Number.isFinite(w) && w > 0 && Number.isFinite(r) && r > 0 && (overBy === 0 || attrGain || attrPipeline) && excessBy <= 0.05

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
        width: '100%', maxWidth: 660, maxHeight: '92vh',
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,.4)',
        display: 'flex', flexDirection: 'column',
        animation: 'bidModalIn .25s cubic-bezier(.34,1.2,.64,1)',
      }}>
        {/* Header — compact single row: title · arrival pill · KL badge */}
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
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
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', flex: 1 }}>

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
              <div style={{ display: 'grid', gridTemplateColumns: `24px minmax(0,1fr) ${opts.editable ? '92px' : '128px'}`, alignItems: 'center', gap: 10, padding: '8px 0' }}>
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
                borderRadius: 12, padding: '16px 18px',
              }}>
                {/* Selected weight — read-only, from selection */}
                {row('Selected weight',
                  <span style={{ textAlign: 'right', color: t.text1, fontSize: 16, fontWeight: 800, fontFamily: 'monospace' }}>{fmt(netFromSelection, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 3 }}>g</span></span>,
                  { hint: `${selected.size} bill${selected.size === 1 ? '' : 's'} ticked`, symbol: '' })}

                <div style={{ height: 1, background: `${t.border}60`, margin: '2px 0' }} />

                {/* + Gains — KA·AP·TS only. Kerala has no gain, so the whole row
                    is hidden for KL bookings. Defaults to the company % of
                    selected, overrideable. type="text" + inputMode="decimal"
                    avoids the native spinner. */}
                {!isKerala && row('Add gains',
                  <input type="text" value={gainsEntry}
                    onChange={e => { setGainsEntry(e.target.value.replace(/[^\d.]/g, '')); setGainsEntryDirty(true) }}
                    onDoubleClick={() => setGainsEntryDirty(false)}
                    placeholder="0.00"
                    inputMode="decimal"
                    title={
                      isKerala
                        ? (gainsEntryDirty ? 'Double-click to reset to 0 (Kerala default)' : 'Kerala default is 0 — type to apply a gain')
                        : (gainsEntryDirty ? `Double-click to reset to ${(liveGainRate * 100).toFixed(2)} % default` : `Default: ${(liveGainRate * 100).toFixed(2)} % of selected weight`)
                    }
                    style={{
                      ...inputStyle(t), padding: '5px 10px', fontSize: 13.5,
                      fontFamily: 'monospace', fontWeight: 700,
                      textAlign: 'right',
                      color: addedGainsW > 0 ? (t.orange || '#e58a3b') : t.text3,
                      borderColor: addedGainsW > 0 ? `${(t.orange || '#e58a3b')}55` : t.border,
                    }} />,
                  { symbol: '+', editable: true, faded: addedGainsW === 0, hint:
                      isKerala
                        ? (gainsEntryDirty
                            ? `manual override · Kerala default is 0`
                            : `no default for Kerala · type to apply a gain`)
                        : (gainsEntryDirty
                            ? `manual override · default ${(liveGainRate * 100).toFixed(2)} %`
                            : `default ${(liveGainRate * 100).toFixed(2)} % of selected · type to override`)
                  })}

                {/* + Pending — the shared, server-side carry-over for this
                    arrival date, now editable here (the hero Pending card is
                    gone). Checkbox decides whether it enters THIS booking;
                    the pill/input lets ops add or subtract the carry-over,
                    which persists globally. */}
                {row('Add pending delivery',
                  pendingEditing ? (
                    <input
                      type="number" step="0.01"
                      value={pendingDraft}
                      onChange={e => setPendingDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } else if (e.key === 'Escape') { cancelEditPending() } }}
                      onBlur={commitPending}
                      autoFocus
                      placeholder="±g"
                      disabled={savingPending}
                      style={{
                        ...inputStyle(t), padding: '5px 10px', fontSize: 13.5,
                        fontFamily: 'monospace', fontWeight: 700, textAlign: 'right',
                        color: purpleTone, borderColor: `${purpleTone}66`, width: '100%',
                      }} />
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      {pendingAvailable && (
                        <button type="button"
                          onClick={() => onSavePending?.(0)}
                          disabled={savingPending}
                          title="Clear carry-over (set to 0)"
                          style={{ background: 'transparent', border: 'none', color: t.text4, fontSize: 12, fontWeight: 700, cursor: savingPending ? 'default' : 'pointer', padding: 0, lineHeight: 1 }}>↺</button>
                      )}
                      <button type="button"
                        onClick={startEditPending}
                        disabled={savingPending}
                        title="Set the shared pending-delivery carry-over (negative = pull-back)"
                        style={{
                          background: pendingAvailable ? `${purpleTone}15` : 'transparent',
                          border: `1px solid ${pendingAvailable ? `${purpleTone}40` : t.border2}`,
                          borderRadius: 99, padding: '3px 10px', cursor: savingPending ? 'default' : 'pointer',
                          fontFamily: 'monospace', fontWeight: 800, fontSize: 13.5,
                          color: pendingAvailable ? (includePending ? purpleTone : t.text2) : t.text3,
                          display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                        }}>
                        <span>{savingPending ? '…' : (pendingAvailable ? `${pendingGrams > 0 ? '+' : '−'}${fmt(Math.abs(pendingGrams), 2)} g` : 'Set ±g')}</span>
                        <span style={{ fontSize: 10, opacity: .8 }}>✎</span>
                      </button>
                    </span>
                  ),
                  { symbolNode: pendingCheckbox, hint: pendingEditing
                      ? 'Enter to save · Esc to cancel · negative = pull-back'
                      : (pendingAvailable
                          ? (includePending ? 'shared carry-over · included — uncheck to remove' : 'shared carry-over · tick to include')
                          : 'tap Set to add or subtract delivery for this date') })}

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
          <div className="bidStagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
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
                  style={{ ...inputStyle(t), fontFamily: 'monospace', fontSize: 17, fontWeight: 800, padding: '10px 12px', color: t.gold, borderColor: wValid ? `${t.gold}66` : t.border }} />
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

            {/* Excess attribution — appears only when the operator commits
                MORE to a bidder than the built Total Bidding Weight. Two
                checkboxes pick where the difference comes from; one of
                them must be ticked before the booking can be created. */}
            {overBy > 0 && (() => {
              const amberTone = t.orange || '#e58a3b'
              const Box = ({ checked, onClick, accent, label, hint }) => (
                <button type="button" onClick={onClick}
                  aria-checked={checked}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '8px 12px',
                    background: checked ? `${accent}14` : t.card2 || t.card,
                    border: `1px solid ${checked ? `${accent}66` : t.border}`,
                    borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    transition: 'all .15s ease', minWidth: 0,
                  }}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = `${accent}08` }}
                  onMouseLeave={e => { if (!checked) e.currentTarget.style.background = t.card2 || t.card }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                    border: `1.8px solid ${checked ? accent : t.border2 || t.border}`,
                    background: checked ? accent : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1,
                  }}>{checked ? '✓' : ''}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: checked ? accent : t.text1, letterSpacing: '.01em' }}>{label}</div>
                    <div style={{ fontSize: 10.5, color: t.text3, marginTop: 2, fontWeight: 500, lineHeight: 1.35 }}>{hint}</div>
                  </span>
                </button>
              )
              const needsAttr = !attrGain && !attrPipeline
              return (
                <div style={{
                  background: `linear-gradient(150deg, ${amberTone}0e, ${amberTone}04 60%, transparent)`,
                  border: `1px solid ${amberTone}40`,
                  borderRadius: 12, padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 10.5, color: amberTone, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800 }}>
                      Difference
                    </span>
                    <span style={{ fontSize: 17, color: amberTone, fontFamily: 'monospace', fontWeight: 800, letterSpacing: '-.01em' }}>
                      +{fmt(overBy, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 3 }}>g</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: t.text3, marginBottom: 8, fontWeight: 600 }}>
                    Booking weight is {fmt(overBy, 2)} g over the total bidding weight ({fmt(totalBiddingW, 2)} g). {isKerala ? 'Booked against tomorrow’s incoming (hub stock + branch → hub) — tick Pipeline:' : 'Pick where this comes from — tick one or both:'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isKerala ? '1fr' : '1fr 1fr', gap: 10 }}>
                    {!isKerala && (
                      <Box checked={attrGain} onClick={() => setAttrGain(v => !v)} accent={t.orange || '#e58a3b'} label="Additional gain" hint={`Realize more than the ${(liveGainRate * 100).toFixed(2)} % default`} />
                    )}
                    <Box checked={attrPipeline} onClick={() => setAttrPipeline(v => !v)} accent={t.purple || '#8c5ac8'} label="Pipeline" hint={isKerala ? 'Back-fill from hub stock + branch → hub' : "Book against tomorrow's incoming"} />
                  </div>
                  {/* Sub-option: when pipeline is ticked AND it's not a Kerala
                      booking, allow the auto-attacher to also pull from
                      outstation 24h-transit bills arriving on the booking's
                      arrival date. Off by default — opt-in per booking. */}
                  {attrPipeline && !isKerala && (
                    <div
                      onClick={() => setPipelineIncludeInTransit(v => !v)}
                      style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: pipelineIncludeInTransit ? `${t.purple || '#8c5ac8'}14` : 'transparent',
                        border: `1px solid ${pipelineIncludeInTransit ? `${t.purple || '#8c5ac8'}55` : t.border}`,
                        display: 'flex', alignItems: 'center', gap: 10,
                        cursor: 'pointer',
                        transition: 'background .15s ease, border-color .15s ease',
                      }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                        background: pipelineIncludeInTransit ? (t.purple || '#8c5ac8') : 'transparent',
                        border: `1.5px solid ${pipelineIncludeInTransit ? (t.purple || '#8c5ac8') : t.border2}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 12, fontWeight: 900,
                      }}>{pipelineIncludeInTransit ? '✓' : ''}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: t.text1, fontWeight: 700 }}>
                          Also use Section 2 (24h in-transit) bills for back-fill
                        </div>
                        <div style={{ fontSize: 10.5, color: t.text3, marginTop: 2, lineHeight: 1.45 }}>
                          By default pipeline only consumes tomorrow's Bangalore purchases. Tick this to also count outstation bills already in transit and arriving on this booking's date.
                        </div>
                      </div>
                    </div>
                  )}
                  {needsAttr && (
                    <div style={{ fontSize: 10.5, color: amberTone, marginTop: 8, fontWeight: 700, letterSpacing: '.01em' }}>
                      {isKerala ? 'Tick Pipeline to enable Create Booking.' : 'Tick at least one to enable Create Booking.'}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Excess reconcile — operator committed LESS than the selected
                booking weight (bid < net + gain). Take it off: trim from gain,
                or auto-detach Bangalore-only bills (smallest first; gain covers
                any sub-bill remainder). Must be cleared to enable booking. */}
            {excessBy > 0.05 && (() => {
              const tone = t.blue || '#3a8fbf'
              const actBtn = (enabled, accent) => ({
                display: 'block', textAlign: 'left', padding: '9px 12px',
                background: enabled ? `${accent}12` : (t.card2 || t.card),
                border: `1px solid ${enabled ? `${accent}66` : t.border}`,
                borderRadius: 8, cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: enabled ? 1 : 0.6,
              })
              return (
                <div style={{
                  background: `linear-gradient(150deg, ${tone}0e, ${tone}04 60%, transparent)`,
                  border: `1px solid ${tone}40`, borderRadius: 12, padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 10.5, color: tone, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800 }}>Excess</span>
                    <span style={{ fontSize: 17, color: tone, fontFamily: 'monospace', fontWeight: 800 }}>−{fmt(excessBy, 2)}<span style={{ fontSize: 11, color: t.text3, marginLeft: 3 }}>g</span></span>
                  </div>
                  <div style={{ fontSize: 11, color: t.text3, marginBottom: 8, fontWeight: 600 }}>
                    Bid ({fmt(w, 2)} g) is {fmt(excessBy, 2)} g under the selected booking weight ({fmt(selectedBookingW, 2)} g). Take it off:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button type="button" onClick={trimFromGain} disabled={!canTrimGain}
                      style={actBtn(canTrimGain, t.green || '#3aaa6a')}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: canTrimGain ? (t.green || '#3aaa6a') : t.text3 }}>Reduce from gain</div>
                      <div style={{ fontSize: 10.5, color: t.text3, marginTop: 2, fontWeight: 500, lineHeight: 1.35 }}>
                        {canTrimGain ? `Gain ${fmt(addedGainsW, 2)} → ${fmt(Math.max(0, addedGainsW - excessBy), 2)} g` : 'Excess exceeds gain — detach instead'}
                      </div>
                    </button>
                    <button type="button" onClick={detachBangalore} disabled={!canDetachBangalore}
                      style={actBtn(canDetachBangalore, t.gold)}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: canDetachBangalore ? t.gold : t.text3 }}>Detach Bangalore bills</div>
                      <div style={{ fontSize: 10.5, color: t.text3, marginTop: 2, fontWeight: 500, lineHeight: 1.35 }}>
                        {canDetachBangalore ? 'Drop smallest Bangalore bills; gain covers the rest' : 'No Bangalore bills in this selection'}
                      </div>
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Bidder — last because party gets picked AFTER the rate
                lands (highest-rate-wins). The combobox stays collapsed;
                a quick-pick chip row underneath shows every party name
                at a glance so ops doesn't have to open the dropdown. */}
            <Field label="Bidder">
              <BidderCombobox
                t={t}
                value={party}
                onChange={setParty}
                options={allBidders}
                onAddNew={(name) => { setParty(name); saveNewBidder() }}
              />
              {allBidders.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {allBidders.map(b => {
                    const picked = b.toLowerCase() === party.trim().toLowerCase()
                    return (
                      <button key={b} type="button"
                        onClick={() => setParty(picked ? '' : b)}
                        title={picked ? `${b} — click to clear` : `Pick ${b}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: picked ? `${t.gold}1f` : (t.card2 || t.card),
                          border: `1px solid ${picked ? `${t.gold}66` : t.border}`,
                          borderRadius: 99, padding: '4px 10px 4px 5px',
                          cursor: 'pointer', transition: 'all .12s ease',
                        }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: '50%',
                          background: hashAvatarBg(b, t), color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9.5, fontWeight: 800, flexShrink: 0,
                        }}>{b[0].toUpperCase()}</span>
                        <span style={{ fontSize: 12, fontWeight: picked ? 800 : 600, color: picked ? t.gold : t.text2, whiteSpace: 'nowrap' }}>{b}</span>
                        {picked && <span style={{ fontSize: 10, color: t.gold }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>

          </div>
        </div>

        {/* Footer — sticky. Over-bookings are handled inline in the body
            via an attribution panel, so the footer stays clean. */}
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${t.border}`, background: t.card2, flexShrink: 0 }}>
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
                    {wValid && <span style={{ fontFamily: 'monospace', fontWeight: 900, opacity: .85 }}>· {fmt(w, 2)} g</span>}
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
