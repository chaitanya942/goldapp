'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import { supabase as supabaseClient } from '../../lib/supabase'
import GoldSpinner from '../ui/GoldSpinner'
import Badge from '../ui/Badge'
import Toast from '../ui/Toast'
import { openConfirm } from '../ui/ConfirmDialog'
import { authedFetch } from '../../lib/authedFetch'
import { computeConsignmentTotals } from '../../lib/consignmentTotals'
import { triggerSync } from '../../lib/triggerSync'
import { isSelfCarryRegion, branchEmployeeTransporter } from '../../lib/selfCarryRegions'
import { getCache, setCache } from '../../lib/moduleCache'
import { CONSIGNMENT_THEMES as THEMES, REGION_COLORS, useMobile } from '../../lib/consignmentTheme'
import { canActOnStep } from './workflowParts'
import PreviewModal from './PreviewModal'
import { istToday, istDaysAgo, istStartOfDayIso, istEndOfDayIso } from '../../lib/dateIst'
import { docFilename } from '../../lib/docFilename'
import { appIdMatches } from '../../lib/appIdSearch'

async function triggerDownload(url, filename, onError) {
  const res  = await authedFetch(url)
  if (!res.ok) {
    let msg = `Download failed: ${res.status}`
    try { const j = await res.json(); if (j.error) msg = j.error } catch { try { msg = await res.text() } catch {} }
    onError?.(msg); return
  }
  const blob = await res.blob()
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

// View a generated doc INLINE in a new tab (the primary action now — download
// is secondary). authedFetch carries the Bearer token to the gated route, then
// a blob URL lets the browser render the JPEG/PDF instead of downloading it.
// Hitting the route still stamps the workflow step, so viewing unlocks the next
// document exactly as downloading used to. The tab is opened synchronously
// before the await so it isn't treated as a blocked popup.
async function triggerView(url, onError) {
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null
  const res = await authedFetch(url)
  if (!res.ok) {
    let msg = `Couldn't open: ${res.status}`
    try { const j = await res.json(); if (j.error) msg = j.error } catch {}
    if (tab) tab.close()
    onError?.(msg); return false
  }
  const obj = URL.createObjectURL(await res.blob())
  if (tab) tab.location = obj; else window.open(obj, '_blank')
  setTimeout(() => URL.revokeObjectURL(obj), 60000)
  return true
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
// purchases.transaction_time is a plain "HH:MM:SS" string (the final-payment
// clock time), not a timestamp — render it as 12-hour without touching timezones.
const fmtBillTime = (v) => {
  if (!v) return '—'
  const m = String(v).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return '—'
  let h = parseInt(m[1], 10)
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m[2]} ${ap}`
}
const fmtTS   = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
// Compact "2h ago" / "3d ago" display so the operator can eyeball freshness
// next to the absolute timestamp without doing date math in their head.
const relTime = (d) => {
  if (!d) return ''
  const diffMs = Date.now() - new Date(d).getTime()
  if (diffMs < 0) return 'just now'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0

function AgeBadge({ days, t }) {
  if (days === null || days === undefined) return null
  const color = days > 7 ? t.red : days > 3 ? t.orange : t.green
  return <span style={{ fontSize: '10px', color, background: `${color}18`, borderRadius: '5px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.02em' }}>{days}d</span>
}

export default function ConsignmentData() {
  const { theme, consignmentDeepLink, setConsignmentDeepLink, setActiveNav } = useApp()
  // Track whether the user landed here via a Branch Stock Overview row click,
  // so the Back button can return them to that view instead of the local list.
  const cameFromBranchStock = useRef(false)
  const t = THEMES[theme]
  const isMobile = useMobile()

  // Mode: null = Active Consignments list,  { type:'branch', branch, fromRegion } = bill picker
  const [nav,                 setNav]                = useState(null)
  // Seed from in-memory cache (stale-while-revalidate) so a re-open paints
  // the previous list instantly while a fresh fetch + Realtime sub take over.
  const _cdCached = getCache('cd:fetchAll')
  const [purchases,           setPurchases]          = useState(_cdCached?.purchases       ?? [])
  // Branch-specific bill list, populated when entering a branch view.
  // Decoupled from `purchases` so fetchAll (no-branch) can't race-overwrite.
  const [branchBillsState,    setBranchBillsState]   = useState(null)
  const [consignments,        setConsignments]       = useState(_cdCached?.consignments    ?? [])
  const [branches,            setBranches]           = useState(_cdCached?.branches        ?? [])
  const [unknownBranches,     setUnknownBranches]    = useState(_cdCached?.unknownBranches ?? [])
  const [loading,             setLoading]            = useState(!_cdCached)
  const [selected,            setSelected]           = useState(new Set())
  // Default sort: oldest first. Operations should dispatch ageing bills before
  // fresh ones (FIFO + risk-management) — surface them at the top.
  const [sortBy,              setSortBy]             = useState('oldest')
  const [search,              setSearch]             = useState('')
  const [creating,            setCreating]           = useState(false)
  // moveType:
  //   ''         → nothing chosen yet (modal just opened, suggestion hasn't
  //                landed, ops hasn't clicked). Create is blocked.
  //   'INTERNAL' → ops picked a hub from the picker.
  //   'EXTERNAL' → ops clicked the 'send to Head Office' button.
  // Default is empty so an accidental Enter / Confirm never ships to HO
  // when ops meant to pick a hub — the toggle that defaulted to EXTERNAL
  // produced exactly that failure mode.
  const [moveType,            setMoveType]           = useState('')
  const [destBranch,          setDestBranch]         = useState('')
  const [destSearch,          setDestSearch]         = useState('')
  const [destOpen,            setDestOpen]           = useState(false)
  // The open hub list is absolutely positioned OVER the "OR" divider and the
  // Head Office button beneath it, so an operator who opened it by mistake had
  // no way back to HO — clicking where HO appears just hit a hub row. Make the
  // list dismissable: outside-click and Escape both close it (capture phase, so
  // Escape closes the list without also closing the whole modal).
  const destBoxRef = useRef(null)
  useEffect(() => {
    if (!destOpen) return
    const onDown = (e) => { if (destBoxRef.current && !destBoxRef.current.contains(e.target)) setDestOpen(false) }
    const onKey  = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setDestOpen(false) } }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown',   onKey,  true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown',   onKey,  true)
    }
  }, [destOpen])
  // Suggested destination from history — surfaces a small hint next to
  // the destination picker so ops knows where the default came from and
  // can override it without confusion.
  //   { dest_branch, movement_type } or null when no prior consignment.
  const [destSuggestion,      setDestSuggestion]    = useState(null)
  const [ewayBillNo,          setEwayBillNo]         = useState('')
  // Per-consignment override of branches.contact_person / contact_phone.
  // Seeded from the branch row when the modal opens; operator can edit before
  // creating. Whatever they confirm is what the Delivery Challan / Issue
  // Voucher prints. Null/empty → fall back to branch defaults at generation.
  const [branchContactName,   setBranchContactName]  = useState('')
  const [branchContactPhone,  setBranchContactPhone] = useState('')
  const [transporterMode,     setTransporterMode]    = useState('bvc')   // 'bvc' | 'branch_employee' | 'other'
  const [transporterOther,    setTransporterOther]   = useState('')
  // Self-carry (ROK / AP / TS): the branch employee who physically carries the
  // parcel to the hub. Prints on the Issue Voucher. Suggestions come from the
  // branch_employees directory, but the field stays free-text — 15 of 22 Rest
  // of Karnataka branches have no employee records, so a strict dropdown would
  // block consignment creation there.
  const [carrierName,         setCarrierName]        = useState('')
  const [branchEmps,          setBranchEmps]         = useState([])
  const [showModal,           setShowModal]          = useState(false)
  const [lastConsignment,     setLastConsignment]    = useState(null)
  // Re-render every 60s so the "approval pending · 5m" timer in the ALL
  // column ticks live without needing a network round trip. Cheap — only
  // re-renders the active consignments list (typically <30 rows).
  const [, _bumpTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => _bumpTick(n => n + 1), 60000)
    return () => clearInterval(id)
  }, [])
  const [previewNumbers,      setPreviewNumbers]     = useState(null)
  const [loadingPreview,      setLoadingPreview]     = useState(false)
  const [downloadingId,       setDownloadingId]      = useState(null)
  const [transferHistory,     setTransferHistory]    = useState({}) // purchase_id → prior INTERNAL transfer info
  const [toast,               setToast]              = useState(null)
  // Activity Log drawer — opens on click of "Activity" in row action column.
  // Stores the consignment id whose activity we're viewing; null = closed.
  const [activityId,          setActivityId]         = useState(null)
  const [activityRows,        setActivityRows]       = useState([])
  const [activityLoading,     setActivityLoading]    = useState(false)
  useEffect(() => {
    if (!activityId) return
    setActivityLoading(true); setActivityRows([])
    authedFetch(`/api/consignments?action=activity_log&id=${activityId}`)
      .then(r => r.json())
      .then(d => setActivityRows(Array.isArray(d.data) ? d.data : []))
      .catch(() => setActivityRows([]))
      .finally(() => setActivityLoading(false))
  }, [activityId])

  // List filters. filterRegions is a Set of region names — multi-select via
  // toggleable chips. dateFrom / dateTo bound created_at against IST calendar
  // days so "today" matches the operator's clock, not the server's.
  const [filterRegions, setFilterRegions] = useState(() => new Set())
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  // Sortable columns. Default: newest first by created_at.
  const [sortKey, setSortKey] = useState('created_at')
  const [sortDir, setSortDir] = useState(-1)  // -1 desc, 1 asc

  // Cancellation request modal state. cancelTarget holds the consignment row
  // whose Cancel button was clicked; null means modal is closed.
  const [cancelTarget,    setCancelTarget]    = useState(null)
  const [emailTarget,     setEmailTarget]     = useState(null)   // consignment whose docs are being emailed
  const [saveBlockedFor,  setSaveBlockedFor]  = useState(null)   // Save clicked before the branch mail was sent
  const [cancelReason,    setCancelReason]    = useState('')
  const [cancelSubmitting,setCancelSubmitting]= useState(false)

  // EWB preview/generate modal. EWB is operations self-service now: ops
  // reviews the exact NIC payload here (same shared PreviewModal accounts
  // uses for E-Invoice), then Generate fires NIC + auto-approves the
  // consignment server-side. null = closed.
  //   { c, loading, data, audit, error, generating }
  const [ewbModal, setEwbModal] = useState(null)
  // E-Invoice preview/generate modal — same shape + same flow as EWB. Ops
  // can now generate the IRN themselves from the row's "Preview & Generate"
  // button; the server auto-approves on success (mirrors the EWB pattern).
  const [einvoiceModal, setEinvoiceModal] = useState(null)

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [p, b, c, u] = await Promise.all([
      authedFetch('/api/consignments?action=stock_in_branch').then(r => r.json()),
      authedFetch('/api/consignments?action=branches').then(r => r.json()),
      authedFetch('/api/consignments?action=consignments').then(r => r.json()),
      authedFetch('/api/consignments?action=unknown_branches').then(r => r.json()),
    ])
    setPurchases(p.data || [])
    setBranches(b.data || [])
    // Active = in-flight rows + accounts-rejected rows (so ops can see the
    // pushback + reason). Hide:
    //   - seed templates
    //   - operator-cancelled rows (status=cancelled WITHOUT approval=rejected)
    //   - INTERNAL/EXTERNAL received rows (after the 24h grace window for INTERNAL)
    // Keep:
    //   - approval_status='rejected' rows even though the reject flow auto-sets
    //     status='cancelled' — operations needs to see them and the rejection
    //     reason. They stay visible until ops re-creates or 7d passes.
    const filteredConsignments = (c.data || []).filter(x => {
      if (x.status === 'seed') return false
      // A cancelled EWB / E-Invoice records approval_status='rejected' with a
      // "Rejected because of cancellation of…" reason — but that's a
      // CANCELLATION, not an accounts rejection. Don't treat it as rejected here
      // (no REJECTED pill, no "accounts rejected" banner); it's hidden like any
      // other cancelled row and lives on the Approvals → Cancellations tab.
      const isCancelReject = x.approval_status === 'rejected'
        && /^Rejected because of cancellation of/i.test(x.rejection_reason || '')
      const isRejected = x.approval_status === 'rejected' && !isCancelReject
      if (x.status === 'cancelled' && !isRejected) return false
      // Anything still awaiting a decision must surface here — otherwise it
      // can appear in the accounts Pending Approvals queue but be invisible
      // to ops. Trumps the received/age gates below in case status/approval
      // got out of sync (e.g. a received row that never got approved).
      if (x.approval_status === 'pending') return true
      // Rejected rows: keep for 7 days (gives ops a clear window to review
      // the reason, fix data, and re-create). After that, they live in the
      // approval-history audit trail only.
      if (isRejected) {
        const ageMs = Date.now() - new Date(x.approved_at || x.created_at).getTime()
        if (ageMs > 7 * 24 * 3600 * 1000) return false
        return true
      }
      if (x.status === 'received' && x.movement_type !== 'INTERNAL') return false
      // Auto-received INTERNAL: keep visible for 24h since creation
      if (x.status === 'received' && x.movement_type === 'INTERNAL') {
        const ageMs = Date.now() - new Date(x.created_at).getTime()
        if (ageMs > 24 * 3600 * 1000) return false
      }
      return true
    })
    setConsignments(filteredConsignments)
    setUnknownBranches(u.data || [])
    // Cache the *filtered* consignments (the same shape consumers expect) so a
    // re-open hydrates state instantly. Cutoff windows will be a few minutes
    // stale at most — the very next fetchAll (fires on mount) corrects them.
    setCache('cd:fetchAll', {
      purchases:       p.data || [],
      branches:        b.data || [],
      consignments:    filteredConsignments,
      unknownBranches: u.data || [],
    })
    if (!silent) setLoading(false)
  }, [])

  // Render the bill picker immediately (don't block on sync). In parallel,
  // force a fresh CRM→Supabase sync so any just-approved bills land. When
  // it resolves, refetch silently to surface them. Previously fetchAll
  // waited for sync to complete — adding 1–3s to the page open.
  useEffect(() => {
    // If we already painted from cache, refresh silently — don't flip the
    // screen back to a spinner just because a re-open kicked a refetch.
    const haveCache = !!getCache('cd:fetchAll')
    fetchAll(haveCache)
    triggerSync({ minIntervalMs: 0 }).then(res => { if (res) fetchAll(true) })
  }, [fetchAll])

  // Realtime: when accounts approves/rejects a consignment, the badge and
  // download buttons in this view update without the user refreshing.
  useEffect(() => {
    // Coalesce INSERT bursts (e.g. an external sync landing many at once)
    // into one debounced silent refetch instead of N round-trips.
    let insertTimer = null
    const channel = supabaseClient
      .channel('consignment-approval-updates')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consignments' },
        (payload) => {
          const row = payload.new
          if (!row?.id) return
          setConsignments(prev => prev.map(c => c.id === row.id ? { ...c, ...row } : c))
          // Notify ops when accounts changes status.
          if (row.approval_status === 'approved') {
            setToast({ msg: `${row.tmp_prf_no} approved. Documents are now available.`, type: 'success' })
          } else if (row.approval_status === 'rejected') {
            setToast({ msg: `${row.tmp_prf_no} rejected: ${row.rejection_reason || 'no reason given'}`, type: 'error' })
          }
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'consignments' },
        () => {
          // New row needs the filter pass + branch joins, so just refetch silently.
          if (insertTimer) clearTimeout(insertTimer)
          insertTimer = setTimeout(() => fetchAll(true), 800)
        })
      .subscribe()
    return () => { if (insertTimer) clearTimeout(insertTimer); supabaseClient.removeChannel(channel) }
  }, [fetchAll])

  // Deep-link from Branch Stock Overview → enter bill-picker mode for that branch
  useEffect(() => {
    if (consignmentDeepLink) {
      setNav({ type: 'branch', branch: consignmentDeepLink.branch, fromRegion: consignmentDeepLink.region })
      setSelected(new Set())
      setSearch('')
      cameFromBranchStock.current = true
      setConsignmentDeepLink(null)
    }
  }, [consignmentDeepLink])

  // When entering a branch view, fetch authoritative own + transferred-in
  // bills into a SEPARATE state. Decoupled from the global `purchases`
  // (used by Branch Stock Overview) so fetchAll can't race-overwrite it.
  // Also pulls the last destination this branch shipped to so the
  // destination picker can default to it (overridable).
  useEffect(() => {
    if (!nav?.branch) {
      setTransferHistory({})
      setBranchBillsState(null)
      setDestSuggestion(null)
      return
    }
    setBranchBillsState(null)  // show loading until fresh data arrives
    // Fire the suggestion fetch in parallel — non-blocking, failures
    // just leave the picker empty (current behaviour).
    authedFetch(`/api/consignments?action=last_destination_for_branch&branch=${encodeURIComponent(nav.branch)}`)
      .then(r => r.json())
      .then(j => {
        const sug = j?.suggestion
        if (!sug) { setDestSuggestion(null); return }
        setDestSuggestion(sug)
        // Pre-fill the picker IF ops hasn't already started editing it.
        // We check destBranch === '' && moveType still at default to avoid
        // clobbering a deliberate choice on a tab they're returning to.
        if (sug.movement_type === 'INTERNAL' && sug.dest_branch) {
          setMoveType('INTERNAL')
          setDestBranch(sug.dest_branch)
        } else if (sug.movement_type === 'EXTERNAL') {
          setMoveType('EXTERNAL')
          setDestBranch('')
        }
      })
      .catch(() => { setDestSuggestion(null) })

    Promise.all([
      authedFetch(`/api/consignments?action=stock_in_branch&branch=${encodeURIComponent(nav.branch)}`).then(r => r.json()),
      authedFetch(`/api/consignments?action=transfer_history&branch=${encodeURIComponent(nav.branch)}`).then(r => r.json()),
    ]).then(([s, h]) => {
      const branchBills = s.data || []
      const history     = h.data || {}
      setBranchBillsState(branchBills)
      setTransferHistory(history)
      // Auto-select EVERY transferred-in bill at this hub. Detect from the
      // bill row itself (branch_name !== nav.branch && current_branch ===
      // nav.branch), NOT from transfer_history. The history map is only
      // populated for INTERNAL+received parent consignments, but transferred-
      // in bills can be at the hub even when their parent is approved-but-
      // not-received. Without this, those bills render as force-checked in
      // the picker UI but get silently dropped from `selected` when the
      // operator clicks Create — the resulting Hub→HO consignment then
      // misses them entirely from EWB / report / challan.
      const transferredIds = branchBills
        .filter(b => b.branch_name !== nav.branch)
        .map(b => b.id)
      if (transferredIds.length) {
        setSelected(prev => {
          const next = new Set(prev)
          transferredIds.forEach(id => next.add(id))
          return next
        })
      }
    }).catch(err => {
      console.warn('Branch stock fetch failed:', err)
      setTransferHistory({})
      setBranchBillsState([])
    })
  }, [nav?.branch])

  // Reset hub destination when source branch changes
  useEffect(() => {
    if (!nav?.branch) { setDestBranch(''); setDestSearch(''); return }
    setDestBranch(''); setDestSearch('')
  }, [nav?.branch])

  // ── Bill picker filtering / selection ─────────────────────────────────────
  // Source of truth when in branch view: branchBillsState (fresh, branch-scoped).
  // Falls back to filtered global `purchases` if branch fetch hasn't completed.
  function getBillsForBranch() {
    if (!nav?.branch) return []
    let bills = branchBillsState != null
      ? branchBillsState
      : purchases.filter(p => (p.current_branch || p.branch_name) === nav.branch)
    if (search) {
      const q = search.toLowerCase()
      bills = bills.filter(p =>
        p.customer_name?.toLowerCase().includes(q) ||
        p.phone_number?.includes(q) ||
        appIdMatches(p.application_id, q))
    }
    return [...bills].sort((a, b) => {
      if (sortBy === 'date_desc')   return new Date(b.purchase_date) - new Date(a.purchase_date)
      if (sortBy === 'oldest')      return new Date(a.purchase_date) - new Date(b.purchase_date)
      if (sortBy === 'weight_desc') return parseFloat(b.net_weight || 0) - parseFloat(a.net_weight || 0)
      if (sortBy === 'amount_desc') return parseFloat(b.final_amount_crm || 0) - parseFloat(a.final_amount_crm || 0)
      return 0
    })
  }

  const visibleBills = getBillsForBranch()
  const selectedRows = visibleBills.filter(p => selected.has(p.id))
  const allSelected  = visibleBills.length > 0 && visibleBills.every(p => selected.has(p.id))
  const totalSelWt   = selectedRows.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
  const totalSelAmt  = selectedRows.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

  function toggleAll() {
    if (allSelected) { const n = new Set(selected); visibleBills.forEach(p => n.delete(p.id)); setSelected(n) }
    else { const n = new Set(selected); visibleBills.forEach(p => n.add(p.id)); setSelected(n) }
  }
  function toggleRow(id) { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n) }

  async function fetchPreviewNumbers() {
    if (!nav?.branch || !moveType) return
    setLoadingPreview(true)
    try {
      const res  = await authedFetch(`/api/consignments-preview?branch=${encodeURIComponent(nav.branch)}&movement_type=${moveType}`)
      const data = await res.json()
      if (!data.error) setPreviewNumbers(data)
    } catch {}
    finally { setLoadingPreview(false) }
  }

  // When the modal is open and ops picks a destination, the preview numbers
  // (tmp_prf_no, challan_no) need to refresh. The original Create-button
  // handler called fetchPreviewNumbers once with the old default moveType;
  // since the toggle moved to an opt-in pick, the first fetch hits an empty
  // moveType and short-circuits. This effect catches the moveType landing
  // and fires the fetch so the tamper-proof number is always visible
  // before Confirm & Create.
  useEffect(() => {
    if (showModal && moveType) fetchPreviewNumbers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, moveType, nav?.branch])

  async function handleCreate() {
    if (!selected.size || !nav?.branch) return
    if (!moveType) {
      setToast({ msg: 'Pick a destination first — a hub or Head Office.', type: 'error' })
      return
    }
    if (moveType === 'INTERNAL' && !destBranch) {
      setToast({ msg: 'Select a destination hub before creating.', type: 'error' })
      return
    }

    // Transporter chosen on the modal → prints on the Delivery Challan. Default
    // BVC; Branch Employee for self-carry; Other = free-text courier name.
    const TRANSPORTERS = {
      bvc:             { name: 'BVC LOGISTICS PVT. LTD.', mode: 'BY AIR & ROAD' },
      branch_employee: { name: 'BRANCH EMPLOYEE',         mode: 'BY ROAD' },
    }
    // INTERNAL movements out of a self-carry region are carried by a named
    // branch employee, so the voucher can say who. Everything else keeps the
    // existing transporter selector.
    const srcRegionForCarry = branches.find(b => b.name === nav?.branch)?.region
    const isSelfCarry = moveType === 'INTERNAL' && isSelfCarryRegion(srcRegionForCarry)

    const transporter_name = isSelfCarry
      ? branchEmployeeTransporter(carrierName)
      : transporterMode === 'other'
        ? (transporterOther.trim() || 'OTHER')
        : TRANSPORTERS[transporterMode].name
    const transport_mode   = isSelfCarry
      ? 'BY ROAD'
      : transporterMode === 'other' ? 'BY ROAD' : TRANSPORTERS[transporterMode].mode

    // Final confirmation gate — themed dialog so creation never fires from a
    // single click. Restates destination, bills, weight, value AND the
    // transporter. The transporter selector sits below the modal fold, so this
    // line is the safety net: ops who never scrolled still see it here and can
    // cancel to fix it before the consignment is created.
    const dest = moveType === 'INTERNAL' ? destBranch : 'Head Office'
    const transLine = (moveType === 'INTERNAL' && !isSelfCarry) ? '' : `\n· Transporter: ${transporter_name}`
    const ok = await openConfirm({
      title: 'Create this consignment?',
      message: `${nav.branch} → ${dest}\n\n· ${selected.size} bill${selected.size === 1 ? '' : 's'}\n· ${fmtWt(totalSelWt)} net weight\n· ₹${fmt(Math.round(totalSelAmt))} value\n· ${moveType === 'INTERNAL' ? 'Issue Voucher' : 'Delivery Challan'} will be issued${transLine}\n\nOnce created, the bills are locked to this consignment until accounts approves or the consignment is voided.`,
      confirmLabel: 'Yes, create now',
    })
    if (!ok) return

    setCreating(true)
    try {
      const res = await authedFetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_consignment',
          purchase_ids: [...selected],
          branch_name: nav.branch,
          movement_type: moveType,
          dest_branch: moveType === 'INTERNAL' ? destBranch : null,
          // EWB is always generated downstream from the preview now — input
          // for it was removed when Branch Contact replaced it on the modal.
          eway_bill_no: null,
          // Per-consignment Branch Contact override. Empty strings normalise
          // to null so the PDF generator falls back to the live branch row.
          branch_contact_name:  branchContactName.trim()  || null,
          branch_contact_phone: branchContactPhone.trim() || null,
          transporter_name,
          transport_mode,
        }),
      })
      const result = await res.json()
      if (result.error) { setToast({ msg: result.error, type: 'error' }); return }
      setLastConsignment(result.data)
      // Auto-clear the highlight after 30s so it doesn't linger forever.
      // The user has already seen the "new" pulse; keeping it permanently
      // pollutes the list on subsequent visits to this page.
      setTimeout(() => setLastConsignment(prev => (prev?.id === result.data?.id ? null : prev)), 30000)
      setSelected(new Set())
      setShowModal(false)
      setDestBranch(''); setEwayBillNo('')
      setBranchContactName(''); setBranchContactPhone('')
      setTransporterMode('bvc'); setTransporterOther('')
      await fetchAll()
      // Return to Active Consignments list with the new one highlighted
      setNav(null)
    } finally { setCreating(false) }
  }


  async function downloadEwbPdf(c) {
    setDownloadingId(c.id + ':ewb')
    const branch = branches.find(b => b.name === c.branch_name)
    await triggerDownload(`/api/eway-bill/pdf?id=${c.id}`,
      docFilename({ consignment: c, branch, docType: 'ewb', ext: 'pdf' }),
      msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
  }

  // Open the EWB preview modal — fetches the exact payload that WOULD be sent
  // to NIC (no NIC call yet). Ops verifies from/to/qty/value match the
  // voucher/challan before clicking Generate.
  async function openEwbPreview(c) {
    setEwbModal({ c, loading: true, data: null, audit: null, error: null, generating: false })
    try {
      // Preview + cross-doc audit in parallel — same as the accounts screen,
      // so the shared PreviewModal can render the consistency panel too.
      const [pr, ar] = await Promise.all([
        authedFetch(`/api/eway-bill/preview?id=${c.id}`),
        authedFetch(`/api/consignments/document-audit?id=${c.id}`),
      ])
      const pj = await pr.json()
      const aj = await ar.json().catch(() => null)
      setEwbModal(m => {
        if (!m || m.c.id !== c.id) return m   // a newer modal opened — don't clobber
        if (!pr.ok || pj.error) return { ...m, loading: false, error: pj.error || 'Preview failed' }
        return { ...m, loading: false, data: pj, audit: ar.ok ? aj : null }
      })
    } catch (e) {
      setEwbModal(m => (m && m.c.id === c.id ? { ...m, loading: false, error: e.message } : m))
    }
  }

  // ── E-Invoice ops self-service (mirror of EWB) ──────────────────────────
  // Open the preview: fetches the exact IRP payload + cross-doc audit in
  // parallel. The audit endpoint may 403 for non-accounts users — the
  // PreviewModal renders fine without it.
  async function openEinvoicePreview(c) {
    setEinvoiceModal({ c, loading: true, data: null, audit: null, error: null, generating: false })
    try {
      const [pr, ar] = await Promise.all([
        authedFetch(`/api/e-invoice/preview?id=${c.id}`),
        authedFetch(`/api/consignments/document-audit?id=${c.id}`),
      ])
      const pj = await pr.json()
      const aj = await ar.json().catch(() => null)
      setEinvoiceModal(m => {
        if (!m || m.c.id !== c.id) return m
        if (!pr.ok || pj.error) return { ...m, loading: false, error: pj.error || 'Preview failed' }
        return { ...m, loading: false, data: pj, audit: ar.ok ? aj : null }
      })
    } catch (e) {
      setEinvoiceModal(m => (m && m.c.id === c.id ? { ...m, loading: false, error: e.message } : m))
    }
  }

  // Fires the actual E-Invoice generation on IRP. On success the server also
  // auto-approves the consignment (same shared helper EWB uses).
  async function confirmGenerateEinvoice() {
    if (!einvoiceModal?.c) return
    const c = einvoiceModal.c
    setEinvoiceModal(m => m ? { ...m, generating: true, error: null } : null)
    try {
      const r = await authedFetch('/api/e-invoice/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        setEinvoiceModal(m => m ? { ...m, generating: false, error: j.error || 'Generation failed' } : null)
        return
      }
      const warn = j.auto_approve_warning
        ? ` (auto-approve needs attention: ${j.auto_approve_warning})`
        : ''
      try { await fetchAll() } catch {}
      setEinvoiceModal(null)
      setToast({ msg: `E-Invoice ${j.doc_no || ''} generated.${warn}`, type: warn ? 'error' : 'success' })
    } catch (e) {
      setEinvoiceModal(m => m ? { ...m, generating: false, error: e.message } : null)
    }
  }

  // Fires the actual EWB generation on NIC. On success the server also auto-
  // approves the consignment and moves stock (lib/consignmentApproval). We
  // keep the modal up in its "Generating…" state and AWAIT the list refetch
  // before closing — otherwise the modal closes first and the row flashes
  // its stale pre-generation state (the "in review" pill) until fetch lands.
  async function confirmGenerateEwb() {
    if (!ewbModal?.c) return
    const c = ewbModal.c
    setEwbModal(m => m ? { ...m, generating: true, error: null } : null)
    try {
      const r = await authedFetch('/api/eway-bill/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        setEwbModal(m => m ? { ...m, generating: false, error: j.error || 'Generation failed' } : null)
        return
      }
      const warn = j.auto_approve_warning
        ? ` (auto-approve needs attention: ${j.auto_approve_warning})`
        : ''
      // Refresh the list FIRST (modal stays in Generating…), then close — so
      // the row is already showing the approved / PDF state when it reappears.
      try { await fetchAll() } catch {}
      setEwbModal(null)
      setToast({ msg: `E-Way Bill ${j.ewb_no} generated.${warn}`, type: warn ? 'error' : 'success' })
    } catch (e) {
      setEwbModal(m => m ? { ...m, generating: false, error: e.message } : null)
    }
  }

  // Bill confirmation now happens automatically at consignment creation
  // (the user already confirmed twice during the create flow). Removed the
  // explicit handler; the workflow strip is purely a status indicator now.

  const docUrl = (c, kind) => kind === 'report'  ? `/api/generate-consignee-report?id=${c.id}`
                            : kind === 'voucher' ? `/api/generate-issue-voucher-pdf?id=${c.id}`
                            :                       `/api/generate-challan-pdf?id=${c.id}`

  async function downloadDoc(c, kind) {
    setDownloadingId(c.id + ':' + kind + ':dl')
    const branch   = branches.find(b => b.name === c.branch_name)
    const filename = docFilename({
      consignment: c, branch,
      docType: kind,                          // 'report' | 'voucher' | 'challan'
      ext:     kind === 'report' ? 'jpg' : 'pdf',
    })
    await triggerDownload(docUrl(c, kind), filename, msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
  }

  // Primary action: open the doc inline. Also stamps the workflow step, so
  // viewing the Report unlocks the Voucher/Challan, and viewing that unlocks
  // EWB / E-Invoice — the same chain download used to drive.
  async function viewDoc(c, kind) {
    setDownloadingId(c.id + ':' + kind)
    const ok = await triggerView(docUrl(c, kind), msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
    if (ok) fetchAll(true)          // refresh so the unlock state updates immediately
  }

  // Save ALL of a consignment's available documents in one click. On Chromium
  // (File System Access API) it drops them into a folder the user picks — a
  // real folder named after the consignment, NOT a zip. Elsewhere it falls back
  // to separate downloads. Includes whichever docs already exist: Report,
  // Voucher/Challan (once the report's generated), and EWB / E-Invoice (once
  // generated).
  async function saveAllDocs(c) {
    // Gate: the documents can't be downloaded until the branch email has gone
    // out. This makes the official mail the mandatory step before ops keeps a
    // local copy. Not sent yet → prompt (with a Send-mail action) instead of
    // downloading.
    if (!c.documents_emailed_at) { setSaveBlockedFor(c); return }
    const branch  = branches.find(b => b.name === c.branch_name)
    const isType  = c.movement_type === 'INTERNAL'
    const docKind = isType ? 'voucher' : 'challan'
    // Folder name the operator sees: "Branch consignment-date", e.g.
    // "KL-EDAPPALLY 27 Jul 2026". Sanitised of characters Windows/macOS forbid.
    const dateStr = c.created_at
      ? new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
      : ''
    const folder = `${c.branch_name}${dateStr ? ' ' + dateStr : ''}`.replace(/[\\/:*?"<>|]+/g, '-').trim() || c.tmp_prf_no || 'consignment'
    const list = [{ url: docUrl(c, 'report'), name: docFilename({ consignment: c, branch, docType: 'report', ext: 'jpg' }) }]
    if (c.issue_voucher_generated_at || c.delivery_challan_generated_at)
      list.push({ url: docUrl(c, docKind), name: docFilename({ consignment: c, branch, docType: docKind, ext: 'pdf' }) })
    if (c.eway_bill_no)
      list.push({ url: `/api/eway-bill/pdf?id=${c.id}`, name: docFilename({ consignment: c, branch, docType: 'ewb', ext: 'pdf' }) })
    else if (c.irn && c.approval_status === 'approved')
      list.push({ url: `/api/e-invoice/pdf?id=${c.id}`, name: docFilename({ consignment: c, branch, docType: 'einvoice', ext: 'pdf' }) })

    setDownloadingId(c.id + ':all')
    try {
      // Fetch every doc first (parallel), then save straight to the browser's
      // download folder — NO folder-picker prompt. Each filename is prefixed with
      // "Branch consignment-date" so all three files for a consignment sort and
      // group together in Downloads.
      const blobs = await Promise.all(list.map(async d => {
        const res = await authedFetch(d.url)
        if (!res.ok) { let m = `HTTP ${res.status}`; try { const j = await res.json(); if (j.error) m = j.error } catch {} throw new Error(`${d.name}: ${m}`) }
        return { name: `${folder} - ${d.name}`, blob: await res.blob() }
      }))
      for (const b of blobs) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(b.blob); a.download = b.name; a.click(); URL.revokeObjectURL(a.href)
        await new Promise(r => setTimeout(r, 350))   // let each download register before the next
      }
      setToast({ msg: `Downloaded ${blobs.length} documents for ${folder}.`, type: 'success' })
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' })
    }
    setDownloadingId(null)
  }


  // ── Active consignments filtering ─────────────────────────────────────────
  const filteredCons = consignments.filter(c => {
    // Show in-flight rows + rejected rows (operations needs visibility into
    // what accounts pushed back, with the reason). Operator-cancelled rows
    // (status='cancelled' but approval_status not 'rejected') stay hidden —
    // those are intentionally voided.
    const isRejected         = c.approval_status === 'rejected'
    const isOperatorCancelled = c.status === 'cancelled' && !isRejected
    if (isOperatorCancelled) return false
    if (filterRegions.size > 0) {
      const br = branches.find(b => b.name === c.branch_name)
      if (!filterRegions.has(br?.region)) return false
    }
    // Date range bounds c.created_at against IST calendar days. Uses
    // istStartOfDayIso/istEndOfDayIso so the from/to inputs (YYYY-MM-DD) get
    // converted to UTC instants at IST midnight, not server-local midnight.
    if (dateFrom && c.created_at && c.created_at < istStartOfDayIso(dateFrom)) return false
    if (dateTo   && c.created_at && c.created_at > istEndOfDayIso(dateTo))     return false
    if (search && !nav) {
      const q = search.toLowerCase()
      if (![c.tmp_prf_no, c.challan_no, c.branch_name, c.dest_branch].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  }).slice().sort((a, b) => {
    let av, bv
    switch (sortKey) {
      case 'tmp_prf_no':   av = a.tmp_prf_no || '';                 bv = b.tmp_prf_no || '';                 return av.localeCompare(bv) * sortDir
      case 'branch_name':  av = a.branch_name || '';                bv = b.branch_name || '';                return av.localeCompare(bv) * sortDir
      case 'total_bills':  av = a.total_bills || 0;                 bv = b.total_bills || 0;                 break
      case 'total_net_wt': av = parseFloat(a.total_net_wt || 0);    bv = parseFloat(b.total_net_wt || 0);    break
      case 'total_amount': av = parseFloat(a.total_amount || 0);    bv = parseFloat(b.total_amount || 0);    break
      case 'created_at':
      default:             av = new Date(a.created_at || 0).getTime(); bv = new Date(b.created_at || 0).getTime()
    }
    return (av - bv) * sortDir
  })

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(-1) }
  }

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  // ── BILL PICKER MODE (deep-linked from Branch Stock) ──────────────────────
  // Defined as a render-helper function (not a JSX component) so React doesn't
  // unmount/remount the entire subtree on every parent re-render. Previously a
  // toast or realtime tick caused the search input to lose focus mid-typing
  // and the table scroll position to reset because <BillPicker /> was a fresh
  // component identity each render. Calling renderBillPicker() inlines the
  // returned JSX into the parent's tree directly — same output, stable identity.
  const renderBillPicker = () => {
    const branchInfo = branches.find(b => b.name === nav.branch)
    const rColor     = REGION_COLORS[branchInfo?.region] || t.text3

    // Hub consolidation: group bills by their original branch (transferred-in vs own)
    const sourceCounts = visibleBills.reduce((acc, p) => {
      const origin = p.branch_name
      if (!acc[origin]) acc[origin] = { count: 0, wt: 0 }
      acc[origin].count++
      acc[origin].wt += parseFloat(p.net_weight || 0)
      return acc
    }, {})
    const sourceList = Object.entries(sourceCounts).sort((a, b) => b[1].count - a[1].count)
    const transferredIn = sourceList.filter(([n]) => n !== nav.branch)
    // Any branch acts as a hub when it currently holds bills from other branches.
    // The is_hub flag is no longer required — we detect it dynamically.
    const isHub = !!branchInfo?.is_hub || transferredIn.length > 0

    // Pickup-time reminder logic — show a banner if pickup is within 2 hours and bills are pending.
    const pickupReminder = (() => {
      const pickupTime = branchInfo?.pickup_time  // 'HH:MM' format
      if (!pickupTime || visibleBills.length === 0) return null
      const [hh, mm] = String(pickupTime).split(':').map(Number)
      if (isNaN(hh)) return null
      const now = new Date()
      const pickup = new Date(now); pickup.setHours(hh, mm || 0, 0, 0)
      const minsUntil = Math.round((pickup - now) / 60000)
      if (minsUntil < -30 || minsUntil > 240) return null   // outside ±0.5h–4h window
      if (minsUntil < 0)  return { text: `Pickup time was ${Math.abs(minsUntil)} min ago. ${visibleBills.length} bills still pending.`, urgent: true }
      if (minsUntil < 60) return { text: `Pickup in ${minsUntil} min. ${visibleBills.length} bills pending.`, urgent: true }
      return { text: `Pickup at ${pickupTime} (in ${Math.floor(minsUntil/60)}h ${minsUntil%60}m). ${visibleBills.length} bills pending.`, urgent: false }
    })()

    return (
      <>
        <style>{`@keyframes shimmerRow { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
        {/* Pickup reminder banner */}
        {pickupReminder && (
          <div style={{
            background: pickupReminder.urgent ? `${t.red}15` : `${t.gold}10`,
            border: `1px solid ${pickupReminder.urgent ? t.red + '40' : t.gold + '40'}`,
            borderRadius: '8px', padding: '10px 16px', fontSize: '12px',
            color: pickupReminder.urgent ? t.red : t.gold, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: pickupReminder.urgent ? t.red : t.gold }} />
            {pickupReminder.text}
          </div>
        )}

        {/* Branch header */}
        <div style={{ ...card, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button onClick={() => {
            // If the user arrived via Branch Stock Overview, send them back there
            // instead of dropping them into the regional consignment list — they
            // never saw that list and it'd feel like teleporting sideways.
            if (cameFromBranchStock.current) {
              cameFromBranchStock.current = false
              setSelected(new Set())
              setNav(null)
              setActiveNav('consignment-overview')
            } else {
              setNav(null)
              setSelected(new Set())
            }
          }} style={btnOut}>← Back</button>
          <div style={{ width: '4px', height: '36px', background: rColor, borderRadius: '4px' }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: t.text1 }}>{nav.branch}</span>
              {isHub && <span style={{ fontSize: '10px', color: t.green, background: `${t.green}18`, borderRadius: '5px', padding: '2px 8px', fontWeight: 700, letterSpacing: '.05em' }}>HUB</span>}
            </div>
            <div style={{ fontSize: '11px', color: rColor, marginTop: '2px' }}>{branchInfo?.region}</div>
          </div>
          <div style={{ display: 'flex', gap: '20px', fontSize: '11px', color: t.text3, alignItems: 'center' }}>
            <span><span style={{ color: t.text4 }}>Bills:</span> <strong style={{ color: t.text1 }}>{visibleBills.length}</strong></span>
            <span><span style={{ color: t.text4 }}>Selected:</span> <strong style={{ color: t.gold }}>{selected.size}</strong></span>
            {(() => {
              // Surface the oldest pending bill so ops sees the FIFO risk at a
              // glance — same green/orange/red convention as Branch Stock.
              const ages = visibleBills.map(b => daysSince(b.purchase_date)).filter(d => d != null)
              if (ages.length === 0) return null
              const maxAge = Math.max(...ages)
              const tone = maxAge > 7 ? t.red : maxAge > 3 ? t.orange : t.green
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: t.text4 }}>Oldest:</span>
                  <strong style={{ color: tone, background: `${tone}15`, padding: '2px 8px', borderRadius: '5px', fontWeight: 700 }}>{maxAge}d</strong>
                </span>
              )
            })()}
          </div>
        </div>

        {/* Hub consolidation summary — shows source breakdown */}
        {isHub && transferredIn.length > 0 && (
          <div style={{ ...card, padding: '12px 18px', borderLeft: `3px solid ${t.green}` }}>
            <div style={{ fontSize: '10px', color: t.green, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>
              Hub Consolidation · {visibleBills.length} bills from {sourceList.length} source{sourceList.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {sourceList.map(([origin, stats]) => {
                const isOwn = origin === nav.branch
                return (
                  <div key={origin} style={{ background: isOwn ? `${t.gold}12` : `${t.purple}12`, border: `1px solid ${isOwn ? t.gold + '40' : t.purple + '40'}`, borderRadius: '7px', padding: '6px 10px', fontSize: '11px' }}>
                    <span style={{ color: isOwn ? t.gold : t.purple, fontWeight: 600 }}>{origin}</span>
                    {isOwn && <span style={{ color: t.text4, fontSize: '9px', marginLeft: '4px' }}>(own)</span>}
                    <span style={{ color: t.text3, marginLeft: '8px' }}>{stats.count} bills · {fmtWt(stats.wt)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone, app ID..."
              style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px 8px 30px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
            <option value="oldest">Oldest First</option>
            <option value="date_desc">Latest First</option>
            <option value="weight_desc">Heaviest First</option>
            <option value="amount_desc">Highest Amount</option>
          </select>
          {/* Overdue quick-select — picks bills the OPS team should clear
              first (FIFO + risk). Distinct from the date-window shortcuts
              below: those select bills FROM that window; this one selects
              bills OLDER than 7 days. Only shown when there's something to
              flag — otherwise it'd just be noise. */}
          {(() => {
            const overdueIds = visibleBills
              .filter(p => {
                const d = daysSince(p.purchase_date)
                return d != null && d > 7
              })
              .map(p => p.id)
            if (overdueIds.length === 0) return null
            return (
              <button
                onClick={() => setSelected(new Set(overdueIds))}
                title="Select all bills older than 7 days"
                style={{ background: `${t.red}15`, border: `1px solid ${t.red}50`, borderRadius: '8px', padding: '8px 12px', fontSize: '11px', color: t.red, outline: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                ⚠ Overdue ({overdueIds.length})
              </button>
            )
          })()}

          {/* Date-window quick-select shortcuts — replace current selection */}
          {[
            { label: 'Last 1d', days: 1  },
            { label: 'Last 3d', days: 3  },
            { label: 'Last 7d', days: 7  },
            { label: 'All',     days: null },
          ].map(opt => (
            <button key={opt.label}
              onClick={() => {
                const cutoff = opt.days != null ? Date.now() - opt.days * 86400000 : null
                const n = new Set()
                visibleBills.forEach(p => {
                  if (cutoff == null || new Date(p.purchase_date).getTime() >= cutoff) n.add(p.id)
                })
                setSelected(n)
              }}
              style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 10px', fontSize: '11px', color: t.text2, outline: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div style={{ background: `${t.gold}0d`, border: `1px solid ${t.gold}30`, borderRadius: '10px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: t.gold, fontWeight: 700 }}>{selected.size} selected</span>
            <span style={{ fontSize: '12px', color: t.text3 }}>{fmtWt(totalSelWt)}</span>
            <span style={{ fontSize: '12px', color: t.text3 }}>₹{fmt(Math.round(totalSelAmt))}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <button onClick={() => {
                  // Seed the Branch Contact name + phone from the branch's
                  // configured default. Operator can edit before confirming.
                  const br = branches.find(b => b.name === nav?.branch)
                  setBranchContactName(br?.contact_person || '')
                  setBranchContactPhone(br?.contact_phone  || '')
                  setTransporterMode('bvc'); setTransporterOther('')   // default each dispatch to BVC
                  setCarrierName('')
                  // Suggestions for the self-carry carrier field. Fetched on
                  // open rather than at mount so the directory isn't pulled for
                  // operators who never create a consignment.
                  if (isSelfCarryRegion(br?.region)) {
                    authedFetch('/api/branch-employees')
                      .then(r => r.json())
                      .then(d => setBranchEmps(Array.isArray(d?.employees) ? d.employees : []))
                      .catch(() => setBranchEmps([]))   // field stays free-text
                  } else {
                    setBranchEmps([])
                  }
                  setShowModal(true)
                  fetchPreviewNumbers()
                }} style={btnGold}>
                Create Consignment →
              </button>
              <button onClick={() => setSelected(new Set())} style={btnOut}>Clear</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '780px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th style={{ padding: '10px 14px', background: t.card2, borderBottom: `1px solid ${t.border}`, width: '36px' }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', accentColor: t.gold }} />
                  </th>
                  {['Date', 'Time', ...(isHub ? ['Origin'] : []), 'Customer','App ID','Net Wt','Amount','Age','Type','CRM'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Net Wt' || h === 'Amount' ? 'right' : 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branchBillsState === null ? (
                  // Skeleton rows while the branch fetch is in flight. Same row
                  // height as a real row so the table doesn't jump when data
                  // arrives. shimmer keyframe is defined further down.
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk-${i}`} style={{ borderBottom: `1px solid ${t.border}15` }}>
                      {Array.from({ length: isHub ? 11 : 10 }).map((__, j) => (
                        <td key={j} style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'block', height: '12px', width: `${30 + ((i + j) * 7) % 50}%`, borderRadius: '3px', background: `linear-gradient(90deg, ${t.border}40 0%, ${t.border}80 50%, ${t.border}40 100%)`, backgroundSize: '200% 100%', animation: 'shimmerRow 1.4s ease-in-out infinite' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : visibleBills.length === 0 ? (
                  <tr><td colSpan={isHub ? 11 : 10} style={{ padding: '48px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No bills available at this branch</td></tr>
                ) : visibleBills.map(row => {
                  const isSel    = selected.has(row.id)
                  const days     = daysSince(row.purchase_date)
                  const fromOther = isHub && row.branch_name !== nav.branch
                  // Subtle row tint for overdue bills (>7d) — FIFO risk.
                  // Selection wins over urgency (gold tint), purple for hub
                  // transferred-in wins over both (those are mandatory anyway).
                  const isOverdue = days != null && days > 7
                  // Base tint separates TODAY's bills from PREVIOUS days' at a glance —
                  // same language as Branch Stock (today = blue, previous = orange). It's
                  // the bottom layer: transferred-in / selected / overdue still win.
                  const isToday  = days === 0
                  const dayBg    = isToday ? `${t.blue}07` : days != null ? `${t.orange}07` : 'transparent'
                  const restingBg =
                    fromOther  ? `${t.purple}06`
                    : isSel    ? `${t.gold}08`
                    : isOverdue ? `${t.red}06`
                    : dayBg
                  return (
                    <tr key={row.id} onClick={() => { if (!fromOther) toggleRow(row.id) }}
                      style={{
                        borderBottom: `1px solid ${t.border}15`,
                        borderLeft:   isOverdue && !fromOther && !isSel ? `3px solid ${t.red}` : '3px solid transparent',
                        background:   restingBg,
                        cursor:       fromOther ? 'not-allowed' : 'pointer',
                      }}
                      onMouseEnter={e => { if (!fromOther && !isSel && !isOverdue) e.currentTarget.style.background = `${t.gold}0e` }}
                      onMouseLeave={e => { if (!fromOther && !isSel) e.currentTarget.style.background = restingBg }}>
                      <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={fromOther ? true : isSel}
                          disabled={fromOther}
                          onChange={() => { if (!fromOther) toggleRow(row.id) }}
                          title={fromOther ? `Locked. Transferred in from ${row.branch_name}; must be included in this hub's onward consignment.` : ''}
                          style={{ cursor: fromOther ? 'not-allowed' : 'pointer', accentColor: fromOther ? t.purple : t.gold }} />
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text3, whiteSpace: 'nowrap' }}>{fmtDate(row.purchase_date)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtBillTime(row.transaction_time)}</td>
                      {isHub && (
                        <td style={{ padding: '10px 14px' }}>
                          {fromOther ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span title={`Transferred in from ${row.branch_name}`} style={{ background: `${t.purple}18`, color: t.purple, borderRadius: '5px', padding: '2px 8px', fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}>↩ {row.branch_name}</span>
                              {transferHistory[row.id]?.tmp_prf_no && (
                                <span title={`Came via consignment ${transferHistory[row.id].tmp_prf_no}`} style={{ fontSize: '9px', color: t.text4, fontFamily: 'monospace', alignSelf: 'flex-start' }}>via {transferHistory[row.id].tmp_prf_no}</span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: t.text4, fontSize: '11px' }}>own</span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text1, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</td>
                      <td style={{ padding: '10px 14px', fontSize: '11px', color: t.text4, fontFamily: 'monospace' }}>{row.application_id}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: t.gold, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtWt(row.net_weight)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(row.final_amount_crm))}</td>
                      <td style={{ padding: '10px 14px' }}><AgeBadge days={days} t={t} /></td>
                      <td style={{ padding: '10px 14px' }}>
                        <Badge label={row.transaction_type} color={row.transaction_type === 'TAKEOVER' ? 'purple' : 'green'} />
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <Badge label={row.crm_source === 'new_crm' ? 'NEW CRM' : 'OLD CRM'} color={row.crm_source === 'new_crm' ? 'blue' : 'dim'} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )
  }

  // ── ACTIVE CONSIGNMENTS LIST ─────────────────────────────────────────────
  // Same render-helper pattern as renderBillPicker — see comment there.
  const renderConsignmentsList = () => (
    <>
      {/* Filters — two stacked rows. Top: search + date range with quick presets.
          Bottom: type chips + multi-select region chips + clear + count. */}
      {(() => {
        const allRegions = [...new Set(branches.map(b => b.region).filter(Boolean))].sort()
        const hasFilters = filterRegions.size > 0 || search || dateFrom || dateTo
        const today = istToday()
        const datePresetActive =
          dateFrom === today && dateTo === today                ? 'today'
          : dateFrom === istDaysAgo(1) && dateTo === istDaysAgo(1) ? 'yesterday'
          : dateFrom === istDaysAgo(6) && dateTo === today      ? 'last7'
          : null
        const setPreset = (kind) => {
          if (kind === 'today')     { setDateFrom(today);          setDateTo(today)          }
          if (kind === 'yesterday') { setDateFrom(istDaysAgo(1));  setDateTo(istDaysAgo(1))  }
          if (kind === 'last7')     { setDateFrom(istDaysAgo(6));  setDateTo(today)          }
          if (kind === 'all')       { setDateFrom('');             setDateTo('')             }
        }
        const Chip = ({ active, color, onClick, children, title }) => (
          <button onClick={onClick} title={title}
            style={{
              padding: '5px 11px', borderRadius: '99px',
              background: active ? `${color}18` : 'transparent',
              border: `1px solid ${active ? `${color}80` : t.border2}`,
              color: active ? color : t.text3,
              fontSize: '11px', fontWeight: active ? 700 : 500,
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background .18s ease, color .18s ease, border-color .18s ease, transform .12s ease', display: 'inline-flex', alignItems: 'center', gap: '5px',
            }}>
            {children}
          </button>
        )
        return (
          <div style={{ ...card, padding: '12px 14px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', rowGap: '10px' }}>
            {/* Search — sits where Type chips used to be. Matches TMP PRF,
                challan_no, branch_name, dest_branch. Filter wiring in the
                main filter pass above; this is purely the UI surface. */}
            <div style={{ position: 'relative', minWidth: '200px', maxWidth: '260px', flex: '0 1 auto' }}>
              <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search TMP PRF, source, dest…"
                style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 30px 7px 30px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }}
              />
              {search && (
                <button onClick={() => setSearch('')} title="Clear search"
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: t.text4, fontSize: '14px', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>
                  ×
                </button>
              )}
            </div>
            {/* Region */}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, marginRight: '2px' }}>Region</span>
              <Chip active={filterRegions.size === 0} color={t.gold} onClick={() => setFilterRegions(new Set())}>All</Chip>
              {allRegions.map(r => {
                const active = filterRegions.has(r)
                const color  = REGION_COLORS[r] || t.text3
                return (
                  <Chip key={r} active={active} color={color}
                    onClick={() => setFilterRegions(prev => {
                      const next = new Set(prev)
                      if (next.has(r)) next.delete(r); else next.add(r)
                      return next
                    })}>
                    {active && <span style={{ fontSize: '11px' }}>✓</span>}{r}
                  </Chip>
                )
              })}
            </div>
            {/* Created */}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, marginRight: '2px' }}>Created</span>
              <Chip active={!dateFrom && !dateTo}             color={t.gold}   onClick={() => setPreset('all')}>All</Chip>
              <Chip active={datePresetActive === 'today'}     color={t.blue}   onClick={() => setPreset('today')}>Today</Chip>
              <Chip active={datePresetActive === 'yesterday'} color={t.purple} onClick={() => setPreset('yesterday')}>Yesterday</Chip>
              <Chip active={datePresetActive === 'last7'}     color={t.orange} onClick={() => setPreset('last7')}>Last 7d</Chip>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined}
                title="From (inclusive)"
                style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '6px 8px', fontSize: '11px', color: t.text2, outline: 'none', colorScheme: 'dark' }} />
              <span style={{ color: t.text4, fontSize: '11px' }}>→</span>
              <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   min={dateFrom || undefined}
                title="To (inclusive)"
                style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '6px 8px', fontSize: '11px', color: t.text2, outline: 'none', colorScheme: 'dark' }} />
            </div>
            {hasFilters && (
              <button onClick={() => { setFilterRegions(new Set()); setSearch(''); setDateFrom(''); setDateTo('') }}
                style={{ ...btnOut, padding: '5px 11px', fontSize: '11px' }}>Clear all</button>
            )}
          </div>
        )
      })()}

      {/* Table — flex:1 so it claims all the vertical space the page has left
          after the header + filter bar, instead of a fixed maxHeight that
          left dead air at the bottom. */}
      <div style={{ ...card, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr>
                {(() => {
                  const cols = [
                    { key: 'created_at',   label: 'Created',         align: 'left',  sortable: true  },
                    { key: 'tmp_prf_no',   label: 'TMP PRF',         align: 'left',  sortable: true  },
                    { key: 'type',         label: 'Type',            align: 'left',  sortable: false },
                    { key: 'branch_name',  label: 'Source',          align: 'left',  sortable: true  },
                    { key: 'dest_branch',  label: 'Destination',     align: 'left',  sortable: false },
                    { key: 'total_bills',  label: 'Bills',           align: 'right', sortable: true  },
                    { key: 'total_net_wt', label: 'Net Wt',          align: 'right', sortable: true  },
                    { key: 'total_amount', label: 'Value',           align: 'right', sortable: true  },
                    { key: 'documents',    label: 'Documents',       align: 'center', sortable: false },
                    { key: 'cancel',       label: 'Actions',         align: 'left',  sortable: false },
                  ]
                  return cols.map(col => {
                    const isActive = col.sortable && sortKey === col.key
                    const arrow = !col.sortable ? '' : isActive ? (sortDir === -1 ? '↓' : '↑') : '⇅'
                    const arrowColor = isActive ? t.gold : t.text4
                    return (
                      <th key={col.key}
                        onClick={col.sortable ? () => handleSort(col.key) : undefined}
                        style={{
                          padding: '10px 14px', fontSize: '10px',
                          color: isActive ? t.gold : t.text4,
                          letterSpacing: '.1em', textTransform: 'uppercase',
                          textAlign: col.align,
                          background: t.card2, borderBottom: `1px solid ${t.border}`,
                          whiteSpace: 'nowrap', fontWeight: 600,
                          cursor: col.sortable ? 'pointer' : 'default',
                          userSelect: 'none',
                          position: 'sticky', top: 0, zIndex: 1,
                        }}>
                        {col.label}
                        {col.sortable && <span style={{ marginLeft: '5px', fontSize: '10px', color: arrowColor }}>{arrow}</span>}
                      </th>
                    )
                  })
                })()}
              </tr>
            </thead>
            <tbody>
              {loading && consignments.length === 0 ? (
                // Skeleton rows on initial load — column-aware widths so each
                // cell roughly matches the shape of the real data it'll
                // become. Shimmer is animated via .cdata-skeleton in CSS.
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} style={{ borderBottom: `1px solid ${t.border}15` }}>
                    {/* Created — stripe lives here now */}
                    <td style={{ padding: '14px 14px 14px 11px', boxShadow: `inset 3px 0 0 ${t.border}` }}>
                      <span className="cdata-skeleton" style={{ width: '90px' }} /><br />
                      <span className="cdata-skeleton" style={{ width: '50px', height: '10px', marginTop: '4px' }} />
                    </td>
                    {/* TMP PRF */}
                    <td style={{ padding: '14px' }}><span className="cdata-skeleton" style={{ width: '78px' }} /></td>
                    {/* Type */}
                    <td style={{ padding: '14px' }}><span className="cdata-skeleton" style={{ width: '92px', height: '18px', borderRadius: '99px' }} /></td>
                    {/* Source */}
                    <td style={{ padding: '14px' }}><span className="cdata-skeleton" style={{ width: '110px' }} /></td>
                    {/* Destination */}
                    <td style={{ padding: '14px' }}><span className="cdata-skeleton" style={{ width: '90px' }} /></td>
                    {/* Bills */}
                    <td style={{ padding: '14px', textAlign: 'right' }}><span className="cdata-skeleton" style={{ width: '24px' }} /></td>
                    {/* Net Wt */}
                    <td style={{ padding: '14px', textAlign: 'right' }}><span className="cdata-skeleton" style={{ width: '60px' }} /></td>
                    {/* Value */}
                    <td style={{ padding: '14px', textAlign: 'right' }}><span className="cdata-skeleton" style={{ width: '70px' }} /></td>
                    {/* Document */}
                    <td style={{ padding: '14px' }}><span className="cdata-skeleton" style={{ width: '120px', height: '20px' }} /></td>
                    {/* EWB / E-Invoice */}
                    <td style={{ padding: '14px' }}><span className="cdata-skeleton" style={{ width: '90px', height: '20px' }} /></td>
                    {/* Cancel */}
                    <td style={{ padding: '14px' }}><span className="cdata-skeleton" style={{ width: '60px', height: '20px' }} /></td>
                  </tr>
                ))
              ) : filteredCons.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '64px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
                  {consignments.length === 0
                    ? 'No active consignments. Use Branch Stock → Move to create one.'
                    : 'No consignments match the filters'}
                </td></tr>
              ) : <>
                {/* Σ Totals row — sits immediately below the column headers
                    and reflects the *filtered* set so it stays accurate as
                    type/region/date/search filters change. Single row, gold
                    accent, no expansion. */}
                {(() => {
                  const tot = filteredCons.reduce((acc, c) => {
                    acc.bills  += Number(c.total_bills  || 0)
                    acc.netWt  += Number(c.total_net_wt || 0)
                    acc.amount += Number(c.total_amount || 0)
                    return acc
                  }, { bills: 0, netWt: 0, amount: 0 })
                  return (
                    <tr style={{
                      background: `${t.gold}10`,
                      borderTop:    `1px solid ${t.gold}30`,
                      borderBottom: `1px solid ${t.gold}40`,
                    }}>
                      {/* Created — Σ label with stripe (matches data rows' new stripe location) */}
                      <td style={{ padding: '10px 14px 10px 11px', fontSize: '10px', color: t.gold, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800, boxShadow: `inset 3px 0 0 ${t.gold}`, whiteSpace: 'nowrap' }}>
                        Σ Totals
                      </td>
                      {/* TMP PRF — count */}
                      <td style={{ padding: '10px 14px', fontSize: '11px', color: t.text3, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {filteredCons.length} consignment{filteredCons.length === 1 ? '' : 's'}
                      </td>
                      {/* Type */}
                      <td />
                      {/* Source */}
                      <td />
                      {/* Destination */}
                      <td />
                      {/* Bills */}
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text1, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>{fmt(tot.bills)}</td>
                      {/* Net Wt */}
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtWt(tot.netWt)}</td>
                      {/* Value */}
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, whiteSpace: 'nowrap' }}>₹{fmt(Math.round(tot.amount))}</td>
                      {/* Document */}
                      <td />
                      {/* EWB / E-Invoice */}
                      <td />
                      {/* Cancel */}
                      <td />
                    </tr>
                  )
                })()}
                {filteredCons.map(c => {
                const isType = c.movement_type === 'INTERNAL'
                const tColor = isType ? t.purple : t.orange
                const isNew  = lastConsignment?.id === c.id
                // Pick the row's left-edge stripe colour: rejection wins over
                // region so urgent state pops; otherwise the source-branch
                // region tint (Karnataka green, Kerala teal, AP amber, TS rose)
                // gives the operator regional context at a glance.
                const sourceRegion = (branches.find(b => b.name === c.branch_name) || {}).region
                const regionStripe = REGION_COLORS[sourceRegion] || t.text4
                // Document applicability per business rules:
                //   Intrastate KA Branch → HO       : EWB ✓ + Challan,  NO E-Invoice
                //   Intrastate non-KA Branch → Hub  : EWB ✓ + Voucher,  NO E-Invoice
                //   Interstate Hub → HO (non-KA src): NO EWB + Challan, E-Invoice ✓
                const sourceBranchInfo = branches.find(b => b.name === c.branch_name)
                const isKaSource       = sourceBranchInfo?.region === 'Rest of Karnataka' || sourceBranchInfo?.region === 'Bangalore'
                const showEwb          = isType || isKaSource          // intrastate cases only
                const showEinvoice     = !isType && !isKaSource        // interstate Hub → HO only
                const isRejectedRow = c.approval_status === 'rejected'
                const restingBg     = isNew ? `${t.green}08` : isRejectedRow ? `${t.red}08` : 'transparent'
                return (
                  <React.Fragment key={c.id}>
                  <tr
                    className="cdata-row"
                    style={{
                      borderBottom: `1px solid ${t.border}15`,
                      background: restingBg,
                      verticalAlign: 'middle',
                      // CSS variables drive the per-row stripe + hover glow.
                      // Stripe is painted as inset boxShadow on the first cell
                      // so the row's borderLeft can't desync thead/tbody widths.
                      ['--cdata-stripe']: isRejectedRow ? t.red : regionStripe,
                      ['--cdata-glow']:   isRejectedRow ? t.red : isNew ? t.green : t.gold,
                    }}>
                    {/* Created — moved to leading column; stripe lives here now */}
                    <td style={{ padding: '11px 14px 11px 11px', whiteSpace: 'nowrap', boxShadow: 'inset 3px 0 0 var(--cdata-stripe)' }}>
                      <div className="cdata-num" style={{ fontSize: '11px', color: t.text2, fontFamily: 'monospace' }}>{fmtTS(c.created_at)}</div>
                      <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>{relTime(c.created_at)}</div>
                    </td>
                    {/* TMP PRF — stripe moved off; standard left padding now */}
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => setActivityId(c.id)}
                        title="View full activity log — every event from creation through dispatch"
                        style={{ background: 'transparent', border: 'none', padding: 0, font: 'inherit', color: t.gold, fontWeight: 700, fontFamily: 'monospace', cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                        onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}>
                        {c.tmp_prf_no}
                      </button>
                      {isNew && <span style={{ marginLeft: 6, fontSize: 9, color: t.green, background: `${t.green}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>NEW</span>}
                      {c.approval_status === 'pending' && (
                        showEwb && !c.eway_bill_no ? (
                          // EWB route, not yet generated — the action is on
                          // OPERATIONS (Preview & Generate here), NOT accounts.
                          <span title="Action needed: Preview & Generate the E-Way Bill on this row. Generating it dispatches the consignment automatically — no accounts approval involved."
                            style={{ marginLeft: 6, fontSize: 9, color: t.gold, background: `${t.gold}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                            EWB PENDING
                          </span>
                        ) : showEinvoice && !c.irn ? (
                          // E-Invoice route — ops self-service (same model as EWB).
                          <span title="Action needed: Preview & Generate the E-Invoice on this row. Generating it dispatches the consignment automatically — no accounts approval involved."
                            style={{ marginLeft: 6, fontSize: 9, color: t.purple, background: `${t.purple}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                            E-INVOICE PENDING
                          </span>
                        ) : (
                          // Doc already generated but auto-approve hasn't landed yet.
                          // Rare — surfaces only when the post-generation approval
                          // step errored (see auto_approve_warning on the response).
                          <span title="Document generated; auto-approval is finalising. Refresh in a moment."
                            style={{ marginLeft: 6, fontSize: 9, color: t.orange, background: `${t.orange}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                            FINALISING
                          </span>
                        )
                      )}
                      {c.approval_status === 'rejected' && (
                        <span title={c.rejection_reason || 'Rejected'} style={{ marginLeft: 6, fontSize: 9, color: t.red, background: `${t.red}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>REJECTED</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '10px', color: tColor, background: `${tColor}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {isType ? 'Branch → Hub' : 'Branch → HO'}
                      </span>
                    </td>
                    {/* Source */}
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text1, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {c.branch_name}
                    </td>
                    {/* Destination */}
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, whiteSpace: 'nowrap' }}>
                      {isType ? (c.dest_branch || '?') : 'Head Office'}
                    </td>
                    <td className="cdata-num" style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                    <td className="cdata-num" style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtWt(c.total_net_wt)}</td>
                    <td className="cdata-num" style={{ padding: '11px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>₹{fmt(Math.round(c.total_amount))}</td>
                    {/* Documents pipeline — Report → Voucher/Challan → EWB/E-Invoice
                        as one connected control (replaces the old Document + EWB
                        columns and the workflow strip). Each step: View primary,
                        ⤓ download secondary; the last step generates the GST doc.
                        Connectors turn green as each step completes. The unlock
                        chain is unchanged and still enforced server-side. */}
                    {(() => {
                      const docKind    = isType ? 'voucher' : 'challan'
                      const docLabel   = isType ? 'Voucher' : 'Challan'
                      const reportDone = !!c.consignee_report_generated_at
                      const docGate    = canActOnStep(c, docKind)
                      const docDone    = !!(c.issue_voucher_generated_at || c.delivery_challan_generated_at)
                      const isApproved = c.approval_status === 'approved'
                      const dead       = c.approval_status === 'rejected' || c.status === 'cancelled'
                      const err        = msg => setToast({ msg, type: 'error' })

                      const TONE = {
                        done:       { background: 'transparent', color: t.green,  border: `1px solid ${t.green}55` },
                        donePurple: { background: 'transparent', color: t.purple, border: `1px solid ${t.purple}55` },
                        gold:       { background: t.gold,   color: (t.goldText || '#1a0a00'), border: 'none' },
                        purple:     { background: t.purple, color: '#fff', border: 'none' },
                        locked:     { background: t.border, color: t.text4, border: `1px solid ${t.border}` },
                      }
                      const step = ({ label, tone, onClick, disabled, busy, title }) => (
                        <button onClick={onClick} disabled={disabled} title={title}
                          style={{ ...tone, display: 'inline-flex', alignItems: 'center', gap: 5,
                            borderRadius: '7px', padding: '5px 11px', fontSize: '10.5px', fontWeight: 700,
                            cursor: disabled ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                            whiteSpace: 'nowrap', lineHeight: 1.1 }}>
                          {busy ? '…' : label}
                        </button>
                      )
                      const conn = (filled) => <span style={{ width: 14, height: 2, borderRadius: 2, background: filled ? t.green : t.border2, flexShrink: 0 }} />
                      // Download is a plainly-labelled button (not a bare icon) so
                      // the field team reads it as clickable at a glance.
                      const dlEinv = async () => {
                        setDownloadingId(c.id + ':einv:dl')
                        await triggerDownload(`/api/e-invoice/pdf?id=${c.id}`,
                          docFilename({ consignment: c, branch: sourceBranchInfo, docType: 'einvoice', ext: 'pdf' }), err)
                        setDownloadingId(null)
                      }
                      const gst = (() => {
                        if (showEwb) {
                          if (c.eway_bill_no) return { kind: 'done', short: 'EWB', tip: `E-Way Bill ${c.eway_bill_no}`,
                            view: () => triggerView(`/api/eway-bill/pdf?id=${c.id}`, err), dl: () => downloadEwbPdf(c), dlBusy: c.id + ':ewb' }
                          if (dead) return { kind: 'dash' }
                          return { kind: 'gen', short: 'EWB', label: 'Generate EWB', tone: TONE.gold, act: () => openEwbPreview(c) }
                        }
                        if (showEinvoice) {
                          if (c.irn) return { kind: isApproved ? 'done' : 'lockedpdf', short: 'E-Inv', tip: `IRN ${c.irn}`,
                            view: () => triggerView(`/api/e-invoice/pdf?id=${c.id}`, err), dl: dlEinv, dlBusy: c.id + ':einv:dl' }
                          if (dead) return { kind: 'dash' }
                          return { kind: 'gen', short: 'E-Inv', label: 'Generate E-Invoice', tone: TONE.purple, act: () => openEinvoicePreview(c) }
                        }
                        return { kind: 'na' }
                      })()

                      return (
                        <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            {/* 1 · Report */}
                            {step({ label: reportDone ? '✓ Report' : 'Report', tone: reportDone ? TONE.done : TONE.gold,
                              onClick: () => viewDoc(c, 'report'), disabled: !!downloadingId,
                              busy: downloadingId === c.id + ':report',
                              title: reportDone ? 'View Consignee Report' : 'View the Consignee Report to unlock the next step' })}
                            {conn(reportDone)}
                            {/* 2 · Voucher / Challan */}
                            {step({ label: docDone ? `✓ ${docLabel}` : (docGate.allowed ? docLabel : `🔒 ${docLabel}`),
                              tone: docDone ? TONE.done : (docGate.allowed ? TONE.gold : TONE.locked),
                              onClick: docGate.allowed ? () => viewDoc(c, docKind) : undefined,
                              disabled: !!downloadingId || !docGate.allowed, busy: downloadingId === c.id + ':' + docKind,
                              title: docGate.allowed ? `View ${docLabel}` : 'View the Consignee Report first' })}
                            {conn(docDone)}
                            {/* 3 · EWB / E-Invoice */}
                            {gst.kind === 'na' ? (
                              <span title="No GST document required for this movement" style={{ fontSize: '10px', color: t.text4, padding: '0 6px' }}>n/a</span>
                            ) : gst.kind === 'dash' ? (
                              <span title="Unavailable — consignment is rejected or cancelled" style={{ fontSize: '10px', color: t.text4, fontStyle: 'italic', padding: '0 6px' }}>—</span>
                            ) : gst.kind === 'gen' ? (
                              step({ label: docDone ? gst.label : `🔒 ${gst.short}`, tone: docDone ? gst.tone : TONE.locked,
                                onClick: docDone ? gst.act : undefined, disabled: !!downloadingId || !docDone,
                                title: docDone ? 'Preview & generate on the portal' : 'Finish the Voucher / Challan first' })
                            ) : gst.kind === 'lockedpdf' ? (
                              step({ label: `✓ ${gst.short}`, tone: TONE.donePurple, disabled: true, title: 'PDF finalising — refresh in a moment' })
                            ) : (
                              step({ label: `✓ ${gst.short}`, tone: gst.short === 'E-Inv' ? TONE.donePurple : TONE.done, onClick: gst.view, disabled: !!downloadingId, title: gst.tip })
                            )}
                            {/* One Save button — downloads every ready document (Report, Voucher/Challan,
                                EWB/E-Invoice) into a folder you pick (Chromium), else as separate files. */}
                            {reportDone && (
                              <>
                                <span style={{ width: 1, height: 18, background: t.border2, margin: '0 4px', flexShrink: 0 }} />
                                <button onClick={() => saveAllDocs(c)} disabled={!!downloadingId}
                                  title="Download all documents — Report, Voucher/Challan and EWB/E-Invoice together"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                                    background: t.card2 || '#fff', border: `1px solid ${t.border2 || t.border}`, color: t.text2,
                                    cursor: downloadingId ? 'default' : 'pointer', fontSize: '10px', fontWeight: 700,
                                    borderRadius: '6px', padding: '5px 11px', lineHeight: 1,
                                    opacity: downloadingId === c.id + ':all' ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                                  {downloadingId === c.id + ':all' ? '· saving' : '↓ Save'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )
                    })()}
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                     <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {/* Email to Branch — sits before Cancel. Enabled only once
                          all three docs exist (the GST doc is the last step and
                          implies the others). Opens the confirm modal. */}
                      {(() => {
                        const gstReady = c.eway_bill_no ? true : (c.irn ? c.approval_status === 'approved' : false)
                        const allReady = !!c.consignee_report_generated_at
                          && !!(c.issue_voucher_generated_at || c.delivery_challan_generated_at)
                          && gstReady
                        const dead = c.status === 'cancelled' || c.approval_status === 'rejected'
                        if (dead) return null
                        const emailed = !!c.documents_emailed_at
                        const sentOn = emailed
                          ? (() => { try { return new Date(c.documents_emailed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) } catch { return '' } })()
                          : ''
                        return (
                          <button onClick={() => allReady && setEmailTarget(c)} disabled={!allReady}
                            title={!allReady
                              ? 'Available once the Consignee Report, Voucher/Challan and E-Way Bill / E-Invoice are all done'
                              : emailed
                                ? `Mail sent${sentOn ? ' on ' + sentOn : ''} — click to resend`
                                : 'Email all 3 documents to the branch'}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '5px',
                              background: !allReady ? 'transparent' : emailed ? `${t.green}18` : t.green,
                              border: !allReady ? `1px solid ${t.border}` : emailed ? `1px solid ${t.green}` : 'none',
                              borderRadius: '6px', padding: '5px 11px', fontSize: '10px', fontWeight: 700,
                              color: !allReady ? t.text4 : emailed ? t.green : '#fff',
                              cursor: allReady ? 'pointer' : 'not-allowed', opacity: allReady ? 1 : 0.55,
                            }}>
                            {emailed ? '✓ Mail Sent' : '✉ Email'}
                          </button>
                        )
                      })()}
                      {/* Ops self-cancel — direct, no accounts request. Bills return
                          to the branch; if an EWB/E-Invoice exists it's cancelled on
                          the portal and accounts is notified. */}
                      <button onClick={() => setCancelTarget(c)}
                        title="Cancel this consignment — bills return to the branch. Any EWB/E-Invoice is cancelled on the portal and accounts is notified."
                        style={{ background: 'transparent', border: `1px solid ${t.red}50`, borderRadius: '6px', padding: '5px 12px', fontSize: '10px', color: t.red, cursor: 'pointer', fontWeight: 600 }}>
                        Cancel
                      </button>
                     </div>
                    </td>
                  </tr>

                  {/* Sub-row beneath the main row.
                      - Rejected: an unmissable red banner with the accounts
                        team's reason, the decider's email, and a hint on what
                        ops should do next. The bill list was auto-freed on
                        rejection so the next step is to fix the data and
                        recreate from Branch Stock.
                      - In-flight (pending / not yet decided): the four-step
                        WorkflowStrip with the Confirm bills CTA.
                      - Approved: nothing — workflow is moot, table stays lean. */}
                  {isRejectedRow ? (
                    <tr style={{ background: `${t.red}08`, borderLeft: `3px solid ${t.red}`, borderBottom: `1px solid ${t.border}15` }}>
                      <td colSpan={10} style={{ padding: '8px 14px 12px' }}>
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: '12px',
                          background: `${t.red}10`, border: `1px solid ${t.red}40`,
                          borderRadius: '8px', padding: '10px 14px',
                        }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 26, borderRadius: '50%',
                            background: t.red, color: '#fff', fontSize: 14, fontWeight: 700,
                            flexShrink: 0, marginTop: 1,
                          }} aria-hidden="true">!</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: t.red, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                              Accounts rejected this consignment
                              {c.approved_by && <span style={{ color: t.red, fontWeight: 500, marginLeft: 8, opacity: .85 }}>· by {c.approved_by}</span>}
                              {c.approved_at && <span style={{ color: t.red, fontWeight: 500, marginLeft: 8, opacity: .65, fontFamily: 'monospace' }}>· {fmtTS(c.approved_at)}</span>}
                            </div>
                            <div style={{ fontSize: 12, color: t.text1, marginTop: 5, lineHeight: 1.5 }}>
                              <strong style={{ color: t.text1 }}>Reason:</strong>{' '}
                              <span style={{ color: t.text2 }}>{c.rejection_reason || '(no reason given)'}</span>
                            </div>
                            <div style={{ fontSize: 11, color: t.text3, marginTop: 6, lineHeight: 1.5 }}>
                              The bills are already free — fix the data and re-create the consignment from <strong style={{ color: t.text2 }}>Branch Stock</strong>. This row will auto-hide after 7 days; full audit stays in{' '}
                              <button type="button" onClick={() => setActivityId(c.id)}
                                style={{ background: 'transparent', border: 'none', padding: 0, font: 'inherit', color: t.text2, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
                                Activity
                              </button>.
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                )
              })}
              </>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hover glow + zebra + entrance animation for the active-consignments
          table. Pure CSS so React inline-style serialisation can't shadow
          it. --cdata-glow / --cdata-stripe set per row inline. */}
      <style>{`
        @keyframes cdataRowIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cdataChipPulse {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; }
          50%      { box-shadow: 0 0 0 4px transparent; }
        }
        @keyframes cdataSpin { to { transform: rotate(360deg); } }
        @keyframes cdataSkeleton {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Row entrance — staggered fade-in (cap at 12 so a 200-row table
           doesn't have rows still appearing 4s later). */
        .cdata-row { animation: cdataRowIn .35s cubic-bezier(.4, .0, .2, 1) backwards; transition: background .15s ease, box-shadow .25s ease; }
        .cdata-row:nth-child(1)  { animation-delay: 0ms; }
        .cdata-row:nth-child(2)  { animation-delay: 30ms; }
        .cdata-row:nth-child(3)  { animation-delay: 60ms; }
        .cdata-row:nth-child(4)  { animation-delay: 90ms; }
        .cdata-row:nth-child(5)  { animation-delay: 120ms; }
        .cdata-row:nth-child(6)  { animation-delay: 150ms; }
        .cdata-row:nth-child(7)  { animation-delay: 180ms; }
        .cdata-row:nth-child(8)  { animation-delay: 210ms; }
        .cdata-row:nth-child(9)  { animation-delay: 240ms; }
        .cdata-row:nth-child(10) { animation-delay: 270ms; }
        .cdata-row:nth-child(11) { animation-delay: 300ms; }
        .cdata-row:nth-child(12) { animation-delay: 330ms; }

        .cdata-row:nth-child(even):not(:hover) { background: rgba(201,168,76,.018); }
        .cdata-row:hover {
          background: color-mix(in srgb, var(--cdata-glow) 6%, transparent) !important;
          box-shadow:
            inset 3px 0 0 var(--cdata-glow),
            0 4px 14px color-mix(in srgb, var(--cdata-glow) 16%, transparent);
        }

        /* Tabular-nums on numeric cells so digits line up vertically. */
        .cdata-num { font-variant-numeric: tabular-nums; }

        /* Status chips in the header — subtle pulse on the dot. */
        .cdata-status-dot { animation: cdataChipPulse 2.4s ease-in-out infinite; }

        /* Refresh button spin while loading. */
        .cdata-refresh-spin { animation: cdataSpin .9s linear infinite; }

        /* Skeleton loading row shimmer. */
        .cdata-skeleton {
          background: linear-gradient(90deg,
            rgba(255,255,255,.04) 0%,
            rgba(255,255,255,.10) 50%,
            rgba(255,255,255,.04) 100%);
          background-size: 200% 100%;
          animation: cdataSkeleton 1.4s linear infinite;
          border-radius: 4px;
          height: 12px;
          display: inline-block;
        }

        /* Honour reduce-motion users — skip the animations entirely. */
        @media (prefers-reduced-motion: reduce) {
          .cdata-row, .cdata-status-dot, .cdata-refresh-spin, .cdata-skeleton {
            animation: none !important;
          }
        }
      `}</style>
    </>
  )

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px', minHeight: 'calc(100vh - 60px)' }}>

      {/* Header — title + at-a-glance status chips so the operator sees the
          backlog before scanning the table. Chips only render on the list view. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>
              {nav?.branch ? 'Create Consignment' : 'Consignment Data'}
            </div>
            {!nav && (() => {
              const inReview  = consignments.filter(c => c.approval_status === 'pending').length
              const rejected  = consignments.filter(c => c.approval_status === 'rejected').length
              const approved  = consignments.filter(c => c.approval_status === 'approved' && c.status !== 'cancelled').length
              const Chip = ({ label, count, color, title }) => count > 0 ? (
                <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: `${color}12`, border: `1px solid ${color}35`, borderRadius: '99px', padding: '3px 11px', fontSize: '11px', color, fontWeight: 600 }}>
                  <span className="cdata-status-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, display: 'inline-block', color }} />
                  <strong style={{ fontFamily: 'monospace', fontWeight: 700 }}>{count}</strong> {label}
                </span>
              ) : null
              return (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <Chip label="approved" count={approved} color={t.green}  title="Approved consignments still in transit" />
                  <Chip label="pending"  count={inReview} color={t.orange} title="Action needed — Preview & Generate the EWB / E-Invoice on these rows" />
                  <Chip label="rejected" count={rejected} color={t.red}    title="Accounts pushed back — fix the data and re-create" />
                </div>
              )
            })()}
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '6px' }}>
            {nav?.branch
              ? `Select bills to dispatch from ${nav.branch}`
              : `${consignments.length} active consignment${consignments.length !== 1 ? 's' : ''} · branch movements in flight`}
          </div>
        </div>
        <button onClick={fetchAll} disabled={loading} style={{ ...btnOut, display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          <span className={loading ? 'cdata-refresh-spin' : ''} style={{ display: 'inline-block', fontSize: '13px' }}>⟳</span>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Content. Bill picker still uses the spinner overlay (it builds its
          own complex layout); the active-consignments list renders its own
          skeleton rows inside the table shell on initial load so the user
          sees the layout immediately, not a centered spinner on a blank
          card. */}
      {loading && nav?.branch ? (
        <div style={{ padding: '64px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
      ) : nav?.branch ? (
        renderBillPicker()
      ) : (
        renderConsignmentsList()
      )}

      {/* Confirm modal — portalled to <body> so the position:fixed overlay can't
          be clipped by any ancestor with transform / filter / contain.

          Layout:
            • hero header (eyebrow + title + subtitle)
            • movement type segmented control (Branch → HO  /  Branch → Hub)
            • dest hub picker (only for Branch → Hub)
            • Source ──→ Destination flow card
            • Stats row: Bills · Net Weight · Total Value
            • Document chip
            • E-Way Bill input (Branch → HO only)
            • TMP PRF + Challan/Voucher preview badges
            • Cancel / Confirm-and-Create CTA
      */}
      {/* EWB preview / generate — the SAME shared modal accounts use for
          E-Invoice. Generate fires NIC and (server-side) auto-approves the
          consignment + moves stock. */}
      {ewbModal && (
        <PreviewModal
          state={{
            type:        'ewb',
            consignment: ewbModal.c,
            loading:     ewbModal.loading,
            data:        ewbModal.data,
            audit:       ewbModal.audit,
            generating:  ewbModal.generating,
            error:       ewbModal.error,
          }}
          t={t}
          onClose={() => { if (!ewbModal.generating) setEwbModal(null) }}
          onConfirm={confirmGenerateEwb}
        />
      )}

      {/* E-Invoice preview/generate modal — same shared PreviewModal as EWB,
          parameterised via type='einvoice'. */}
      {einvoiceModal && (
        <PreviewModal
          state={{
            type:        'einvoice',
            consignment: einvoiceModal.c,
            loading:     einvoiceModal.loading,
            data:        einvoiceModal.data,
            audit:       einvoiceModal.audit,
            generating:  einvoiceModal.generating,
            error:       einvoiceModal.error,
          }}
          t={t}
          onClose={() => { if (!einvoiceModal.generating) setEinvoiceModal(null) }}
          onConfirm={confirmGenerateEinvoice}
        />
      )}

      {/* Email documents modal — confirm recipient + send the 3 docs. */}
      {emailTarget && (
        <EmailDocsModal
          t={t}
          c={emailTarget}
          branchEmail={branches.find(b => b.name === emailTarget.branch_name)?.contact_email || ''}
          onClose={() => setEmailTarget(null)}
          onSent={(to) => { setToast({ msg: `Documents sent to ${to}`, type: 'success' }); fetchAll(true) }}
          onError={(msg) => setToast({ msg, type: 'error' })}
        />
      )}

      {/* Save-gate prompt — ops clicked Save before the branch mail went out.
          Shows the flow so it's clear WHY Save is locked (Email is the pending
          step before Save) and offers to send the mail right here. */}
      {saveBlockedFor && typeof document !== 'undefined' && createPortal((() => {
        const c = saveBlockedFor
        const isInternal = c.movement_type === 'INTERNAL'
        const reportDone = !!c.consignee_report_generated_at
        const docDone    = !!(c.issue_voucher_generated_at || c.delivery_challan_generated_at)
        const gstDone    = !!(c.eway_bill_no || (c.irn && c.approval_status === 'approved'))
        const gstLabel   = c.eway_bill_no ? 'EWB' : c.irn ? 'E-Inv' : 'EWB'
        const allReady   = reportDone && docDone && gstDone
        const steps = [
          { label: 'Report', done: reportDone },
          { label: isInternal ? 'Voucher' : 'Challan', done: docDone },
          { label: gstLabel, done: gstDone },
          { label: 'Email', current: true },
          { label: 'Save', locked: true },
        ]
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}
            onClick={() => setSaveBlockedFor(null)}>
            <style>{`
              @keyframes sgIn { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: none } }
              @keyframes sgPulse { 0%,100% { box-shadow: 0 0 0 0 ${t.orange}55 } 50% { box-shadow: 0 0 0 5px ${t.orange}00 } }
              .sg-card { animation: sgIn .2s cubic-bezier(.2,.7,.3,1) }
              .sg-now  { animation: sgPulse 1.8s ease-in-out infinite }
              .sg-send:hover { filter: brightness(1.07); transform: translateY(-1px) }
              .sg-cancel:hover { background: ${t.card2} }
              @media (prefers-reduced-motion: reduce) { .sg-card,.sg-now,.sg-send { animation: none } }
            `}</style>
            <div className="sg-card" onClick={e => e.stopPropagation()}
              style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', width: '100%', maxWidth: '470px', boxShadow: '0 24px 70px rgba(0,0,0,.55)', overflow: 'hidden' }}>

              <div style={{ padding: '22px 24px 6px', textAlign: 'center' }}>
                <div style={{ width: '46px', height: '46px', borderRadius: '13px', background: `${t.orange}18`, border: `1px solid ${t.orange}40`, color: t.orange, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', marginBottom: '12px' }}>✉</div>
                <div style={{ fontSize: '16.5px', fontWeight: 800, color: t.text1, marginBottom: '4px' }}>Email the branch before saving</div>
                <div style={{ fontSize: '12px', color: t.text3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', color: t.text2, fontWeight: 700 }}>{c.tmp_prf_no}</span>
                  <span style={{ color: t.text4 }}>·</span>
                  <span>{c.branch_name}</span>
                  <span style={{ color: t.gold }}>→</span>
                  <span>{isInternal ? (c.dest_branch || 'Hub') : 'Head Office'}</span>
                </div>
              </div>

              {/* Flow strip — the three docs are done; Email is the pending step
                  that unlocks Save. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '3px', padding: '16px 20px 6px' }}>
                {steps.map((s, i) => (
                  <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {i > 0 && <span style={{ width: 14, height: 2, borderRadius: 2, background: s.done ? t.green : (steps[i - 1].done && !s.locked ? t.orange : t.border2), flexShrink: 0 }} />}
                    <span className={s.current ? 'sg-now' : ''}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: 11, fontWeight: 800, borderRadius: 8, padding: '5px 10px', letterSpacing: '.01em',
                        ...(s.done ? { background: `${t.green}16`, color: t.green, border: `1px solid ${t.green}40` }
                          : s.current ? { background: t.orange, color: '#fff', border: 'none' }
                          : { background: t.card2, color: t.text4, border: `1px solid ${t.border2}` }) }}>
                      <span aria-hidden="true">{s.done ? '✓' : s.current ? '✉' : '🔒'}</span>{s.label}
                    </span>
                  </span>
                ))}
              </div>

              <div style={{ fontSize: '12.5px', color: t.text2, lineHeight: 1.55, textAlign: 'center', padding: '4px 28px 0' }}>
                {allReady
                  ? <>All three documents are ready. Send them to the branch, then you can save a copy.</>
                  : <>Saving is locked until the branch has been emailed the documents.</>}
              </div>

              <div style={{ margin: '20px 0 0', padding: '15px 24px', borderTop: `1px solid ${t.border2}`, background: t.card3, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button className="sg-cancel" onClick={() => setSaveBlockedFor(null)}
                  style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '9px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, color: t.text2, cursor: 'pointer', transition: 'background .15s' }}>
                  Cancel
                </button>
                <button className="sg-send" onClick={() => { setSaveBlockedFor(null); setEmailTarget(c) }}
                  style={{ background: t.green, color: '#fff', border: 'none', borderRadius: '9px', padding: '10px 24px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', boxShadow: `0 3px 12px ${t.green}44`, transition: 'filter .15s, transform .15s', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  ✉ Send mail
                </button>
              </div>
            </div>
          </div>
        )
      })(), document.body)}

      {/* Cancellation request modal — operations fills in a reason and confirms;
          server records the request and accounts processes it later. */}
      {cancelTarget && typeof document !== 'undefined' && createPortal((
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}
          onClick={() => { if (!cancelSubmitting) { setCancelTarget(null); setCancelReason('') } }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '24px 26px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            {(() => {
              const ct = cancelTarget
              const isInternal = ct.movement_type === 'INTERNAL'
              const gstKind  = ct.eway_bill_no ? 'ewb' : ct.irn ? 'einvoice' : null
              const gstLabel = gstKind === 'ewb' ? 'E-Way Bill' : gstKind === 'einvoice' ? 'E-Invoice' : null
              const mailed   = !!ct.documents_emailed_at
              const effects = [
                <>Bills return to <b style={{ color: t.text1 }}>{ct.branch_name}</b> stock.</>,
                gstLabel ? <>The <b style={{ color: t.text1 }}>{gstLabel}</b> is cancelled on the government portal, and accounts are emailed to remove it manually (with the document attached).</> : null,
                mailed ? <>The branch is emailed that this consignment&apos;s documents are <b style={{ color: t.text1 }}>no longer valid</b>.</> : null,
              ].filter(Boolean)
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: `${t.red}18`, color: t.red, fontSize: '15px', fontWeight: 700 }}>!</span>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: t.text1 }}>Cancel consignment</div>
                  </div>
                  <div style={{ fontSize: '11px', color: t.text3, marginBottom: '14px' }}>
                    <strong style={{ color: t.gold, fontFamily: 'monospace' }}>{ct.tmp_prf_no}</strong> ·{' '}
                    {ct.branch_name} → {isInternal ? (ct.dest_branch || '?') : 'Head Office'}
                  </div>
                  <div style={{ background: `${t.red}0d`, border: `1px solid ${t.red}30`, borderRadius: '8px', padding: '11px 13px', marginBottom: '14px' }}>
                    <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '7px' }}>This will</div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '11.5px', color: t.text2, lineHeight: 1.6 }}>
                      {effects.map((e, i) => <li key={i} style={{ marginBottom: i < effects.length - 1 ? '4px' : 0 }}>{e}</li>)}
                    </ul>
                  </div>
                  <label style={{ display: 'block', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px' }}>
                    Reason <span style={{ color: t.red }}>*</span>
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    placeholder="Why is this consignment being cancelled?"
                    autoFocus
                    rows={3}
                    style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: t.text1, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                    <button onClick={() => { setCancelTarget(null); setCancelReason('') }} disabled={cancelSubmitting}
                      style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 16px', fontSize: '12px', color: t.text2, cursor: cancelSubmitting ? 'not-allowed' : 'pointer' }}>
                      Back
                    </button>
                    <button onClick={async () => {
                      const reason = cancelReason.trim()
                      if (!reason) return
                      setCancelSubmitting(true)
                      try {
                        const res  = await authedFetch('/api/consignments', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'ops_cancel_consignment', id: ct.id, reason }),
                        })
                        const json = await res.json()
                        if (!res.ok) throw new Error(json.error || 'Failed to cancel')
                        const notes = []
                        if (json.gst_kind) notes.push(json.portal_cancelled ? 'portal doc cancelled' : 'accounts notified to remove portal doc')
                        if (json.emails_sent?.length) notes.push('emailed ' + json.emails_sent.join(' + '))
                        setToast({ msg: 'Consignment cancelled · bills back at branch' + (notes.length ? ' · ' + notes.join(' · ') : ''), type: 'success' })
                        setCancelTarget(null)
                        setCancelReason('')
                        fetchAll()
                      } catch (err) {
                        setToast({ msg: err.message || 'Failed to cancel', type: 'error' })
                      } finally { setCancelSubmitting(false) }
                    }}
                      disabled={cancelSubmitting || !cancelReason.trim()}
                      style={{
                        background: cancelReason.trim() && !cancelSubmitting ? t.red : `${t.red}40`,
                        color: '#fff', border: 'none', borderRadius: '8px',
                        padding: '8px 18px', fontSize: '12px', fontWeight: 700,
                        cursor: cancelSubmitting || !cancelReason.trim() ? 'not-allowed' : 'pointer',
                      }}>
                      {cancelSubmitting ? 'Cancelling…' : 'Cancel consignment'}
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      ), document.body)}

      {showModal && typeof document !== 'undefined' && createPortal((
        <div className="ccm-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}>
          {/* Scoped polish — entrance, input focus ring, action hover feel.
              These need real CSS pseudo-states/keyframes that inline styles
              can't express. */}
          <style>{`
            @keyframes ccmFade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes ccmIn { from { opacity: 0; transform: translateY(12px) scale(.985) } to { opacity: 1; transform: none } }
            .ccm-overlay { animation: ccmFade .18s ease }
            .ccm-card { animation: ccmIn .28s cubic-bezier(.22,1,.36,1) }
            .ccm-card input { transition: border-color .14s ease, box-shadow .14s ease }
            .ccm-card input:focus { border-color: ${t.gold} !important; box-shadow: 0 0 0 3px ${t.gold}26 }
            .ccm-confirm { transition: transform .12s ease, box-shadow .14s ease, filter .12s ease }
            .ccm-confirm:hover { transform: translateY(-1px); filter: brightness(1.04); box-shadow: 0 10px 24px ${t.gold}4a }
            .ccm-confirm:active { transform: translateY(0); box-shadow: 0 4px 10px ${t.gold}3a }
            .ccm-cancel { transition: background .12s ease, border-color .12s ease, color .12s ease }
            .ccm-cancel:hover { background: ${t.card2}; color: ${t.text1} }
            @media (prefers-reduced-motion: reduce) { .ccm-overlay, .ccm-card { animation: none } }
          `}</style>
          <div className="ccm-card" style={{
            background: t.card,
            border: `1px solid ${t.border2}`,
            borderRadius: '20px',
            width: '960px', maxWidth: '100%',
            boxShadow: '0 30px 90px rgba(0,0,0,.55)',
            maxHeight: 'calc(100vh - 40px)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>

            {/* ── Hero header ──────────────────────────────────────────── */}
            <div style={{
              padding: '26px 34px 22px',
              borderBottom: `1px solid ${t.border}`,
              background: `linear-gradient(150deg, ${t.gold}16 0%, transparent 62%)`,
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <span style={{ width: '18px', height: '2px', borderRadius: '2px', background: t.gold, display: 'inline-block' }} />
                <span style={{ fontSize: '9.5px', color: t.gold, letterSpacing: '.22em', textTransform: 'uppercase', fontWeight: 800 }}>Create Consignment</span>
              </div>
              <div style={{ fontSize: '23px', fontWeight: 800, color: t.text1, marginTop: '7px', letterSpacing: '-.025em' }}>Confirm before dispatch</div>
              <div style={{ fontSize: '12px', color: t.text3, marginTop: '5px', lineHeight: 1.5 }}>
                Once you create, bills are locked to this consignment until accounts approves or it's voided.
              </div>
            </div>

            {/* ── Body (scrollable) ────────────────────────────────────── */}
            <div style={{ padding: '26px 34px', overflowY: 'auto', flex: 1, minHeight: 0 }}>

            {(() => {
              // Hub must be in the same state as the source branch — interstate
              // Branch→Hub transfers aren't supported (would need EWB + treated as
              // separate movement). Falls back to region match if state is missing.
              const srcBranch = branches.find(b => b.name === nav?.branch)
              const srcState  = srcBranch?.state || null
              const srcRegion = srcBranch?.region || null
              const srcRegionLabel = srcBranch?.region || ''
              const candidateHubs = branches.filter(b => {
                if (b.name === nav?.branch) return false
                if (srcState)  return b.state  === srcState
                if (srcRegion) return b.region === srcRegion
                return true
              })
              const filteredHubs  = destSearch
                ? candidateHubs.filter(b => b.name.toLowerCase().includes(destSearch.toLowerCase()) || (b.region || '').toLowerCase().includes(destSearch.toLowerCase()))
                : candidateHubs
              const isExternal     = moveType === 'EXTERNAL'
              const isHubPicked    = moveType === 'INTERNAL' && !!destBranch
              const hasDestination = isExternal || isHubPicked
              const dest = isExternal ? 'Head Office'
                         : isHubPicked ? destBranch
                         : '— pick a destination below —'
              const destRegion = isExternal ? 'Bangalore (KA)'
                               : isHubPicked ? (branches.find(b => b.name === destBranch)?.region || '')
                               : ''
              const destColor  = isExternal ? t.gold
                               : isHubPicked ? t.purple
                               : t.text4

              return (
                <>
                  {/* Suggestion hint — only when we have a prior consignment
                      from this branch. Tells ops where the defaults came
                      from so an unexpected pre-fill doesn't read as a bug. */}
                  {destSuggestion && (
                    <div style={{
                      marginBottom: '16px',
                      padding: '10px 14px',
                      background: t.card2,
                      border: `1px solid ${t.border2}`,
                      borderLeft: `3px solid ${t.gold}`,
                      borderRadius: '8px',
                      fontSize: '11.5px',
                      color: t.text2,
                      lineHeight: 1.5,
                    }}>
                      Suggested from your last consignment:{' '}
                      <strong style={{ color: t.text1 }}>
                        {destSuggestion.movement_type === 'INTERNAL'
                          ? `Branch → ${destSuggestion.dest_branch}`
                          : 'Branch → HO'}
                      </strong>
                      {' '}— change anything below to override.
                    </div>
                  )}

                  {/* Top band: Destination picker (left) beside the route +
                      summary (right). Broadens the modal and halves its height
                      vs the old single column. Stacks on narrow widths. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '32px', alignItems: 'start', marginBottom: '4px' }}>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* Destination — unified two-zone picker.
                      Hub combobox up top, an explicit 'send to Head Office'
                      button below. The previous segmented toggle defaulted
                      to EXTERNAL which let ops accidentally ship to HO when
                      they meant a hub — this layout forces an explicit
                      click on either side before Create unlocks. */}
                  <div style={{ marginBottom: '0' }}>
                    <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      Destination
                      <span style={{ color: t.red, fontSize: '9px' }}>(required)</span>
                    </div>

                    {/* Zone 1: Hub picker */}
                    <div ref={destBoxRef} style={{ position: 'relative', opacity: isExternal ? 0.45 : 1, transition: 'opacity .15s' }}>
                      <input
                        value={destBranch && !destOpen ? destBranch : destSearch}
                        onFocus={() => {
                          if (candidateHubs.length === 0) return
                          // Clicking the hub picker clears any prior HO
                          // pick — ops is signalling they want a hub.
                          if (isExternal) setMoveType('')
                          setDestOpen(true); setDestSearch('')
                        }}
                        onChange={e => {
                          if (isExternal) setMoveType('')
                          setDestSearch(e.target.value); setDestBranch(''); setDestOpen(true)
                        }}
                        placeholder={candidateHubs.length === 0
                          ? `No other branches in ${srcState || srcRegion || 'this state'} — use Head Office below.`
                          : `Type to search a hub in ${srcRegionLabel || 'state'}…`}
                        disabled={candidateHubs.length === 0}
                        style={{
                          width: '100%',
                          background: t.card2,
                          border: `1px solid ${isHubPicked ? `${t.purple}80` : t.border2}`,
                          borderRadius: '10px', padding: '13px 15px',
                          fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box',
                          cursor: candidateHubs.length === 0 ? 'not-allowed' : 'text',
                          transition: 'border-color .15s',
                        }} />
                      {isHubPicked && !destOpen && (
                        <span title="Destination hub picked"
                          style={{
                            position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                            color: t.purple, fontSize: '15px', fontWeight: 800,
                            pointerEvents: 'none',
                          }}>✓</span>
                      )}
                      {/* Explicit dismiss — the way out when the list was opened by mistake. */}
                      {destOpen && (
                        <button type="button"
                          onClick={() => { setDestOpen(false); setDestSearch('') }}
                          title="Close (Esc)"
                          style={{
                            position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                            background: 'transparent', border: 'none', color: t.text3,
                            fontSize: '15px', lineHeight: 1, cursor: 'pointer', padding: '4px 7px',
                          }}>✕</button>
                      )}
                      {destOpen && !isExternal && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: t.card, border: `1px solid ${t.border2}`, borderRadius: '9px', maxHeight: '240px', overflowY: 'auto', zIndex: 10, boxShadow: '0 12px 36px rgba(0,0,0,.45)' }}>
                          {filteredHubs.length === 0 ? (
                            <div style={{ padding: '14px', fontSize: '12px', color: t.text4, textAlign: 'center' }}>No branches match</div>
                          ) : filteredHubs.map(b => (
                            <div key={b.id}
                              onClick={() => {
                                setMoveType('INTERNAL')
                                setDestBranch(b.name); setDestSearch(''); setDestOpen(false)
                              }}
                              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', color: t.text1, borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                              onMouseEnter={e => e.currentTarget.style.background = `${t.purple}10`}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <span style={{ fontWeight: 500 }}>{b.name}</span>
                              <span style={{ fontSize: '10px', color: t.text4 }}>{b.region}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* OR divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '12px 0' }}>
                      <div style={{ flex: 1, height: 1, background: t.border }} />
                      <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', fontWeight: 700 }}>OR</span>
                      <div style={{ flex: 1, height: 1, background: t.border }} />
                    </div>

                    {/* Zone 2: Head Office — an explicit destination choice card
                        (HO badge · title · sub-line) paralleling the hub search. */}
                    <button type="button"
                      onClick={() => {
                        setMoveType('EXTERNAL')
                        setDestBranch('')
                        setDestSearch('')
                        setDestOpen(false)
                      }}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: '11px',
                        border: isExternal ? `1.5px solid ${t.gold}` : `1px solid ${t.border2}`,
                        background: isExternal ? `${t.gold}1c` : t.card2,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left',
                        opacity: isHubPicked ? 0.45 : 1,
                        transition: 'all .15s',
                        boxSizing: 'border-box',
                      }}
                      onMouseEnter={e => { if (!isExternal && !isHubPicked) e.currentTarget.style.background = `${t.gold}10` }}
                      onMouseLeave={e => { if (!isExternal && !isHubPicked) e.currentTarget.style.background = t.card2 }}>
                      <span style={{
                        width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: isExternal ? t.gold : `${t.gold}18`,
                        color: isExternal ? (t.goldText || '#1a0a00') : t.gold,
                        fontSize: '13px', fontWeight: 900, letterSpacing: '.03em',
                      }}>HO</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: isExternal ? t.gold : t.text1 }}>Send directly to Head Office</div>
                        <div style={{ fontSize: '10.5px', color: t.text3, marginTop: '2px' }}>Bangalore (KA) · no hub stop</div>
                      </div>
                      {isExternal && <span style={{ fontSize: '16px', fontWeight: 900, color: t.gold, flexShrink: 0 }}>✓</span>}
                    </button>

                    {/* Tiny hint at the bottom — only visible while ops
                        hasn't picked anything yet, so the empty state isn't
                        ambiguous. */}
                    {!hasDestination && (
                      <div style={{ fontSize: '10.5px', color: t.text4, marginTop: '8px', textAlign: 'center', fontStyle: 'italic' }}>
                        Pick a hub above OR tap Head Office to continue.
                      </div>
                    )}
                  </div>

                  {/* Branch Contact override — prints on Delivery Challan +
                      Issue Voucher. Pre-seeded from the branch's configured
                      contact, but operations can edit so the person actually
                      handling THIS shipment is on the paperwork (not just the
                      branch manager). Empty → fall back to branch defaults at
                      PDF-generation time. */}
                  <div>
                    <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>
                      Branch Contact <span style={{ textTransform: 'none', fontWeight: 400, color: t.text4 }}>(prints on {moveType === 'INTERNAL' ? 'Issue Voucher' : 'Delivery Challan'})</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        value={branchContactName}
                        onChange={e => setBranchContactName(e.target.value)}
                        placeholder="Name"
                        style={{ flex: 1.4, minWidth: 0, background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '10px', padding: '13px 15px', fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box' }}
                      />
                      <input
                        value={branchContactPhone}
                        onChange={e => setBranchContactPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18))}
                        placeholder="Phone"
                        inputMode="tel"
                        style={{ flex: 1, minWidth: 0, background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '10px', padding: '13px 15px', fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
                      />
                    </div>
                  </div>

                  {/* Self-carry (ROK / AP / TS) INTERNAL movements: name the
                      branch employee carrying the parcel. Prints on the Issue
                      Voucher as "Branch Employee - <name>", both in the header
                      and pre-filled into Carrier Name. Free text with
                      suggestions — see the carrierName state for why. */}
                  {moveType === 'INTERNAL' && isSelfCarryRegion(branches.find(b => b.name === nav?.branch)?.region) && (
                    <div>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>
                        Carried by <span style={{ textTransform: 'none', fontWeight: 400, color: t.text4 }}>(branch employee — prints on Issue Voucher)</span>
                      </div>
                      <input
                        value={carrierName}
                        onChange={e => setCarrierName(e.target.value.slice(0, 40))}
                        placeholder="Employee name"
                        list="ba-carrier-suggestions"
                        style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '10px', padding: '13px 15px', fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box' }}
                      />
                      <datalist id="ba-carrier-suggestions">
                        {branchEmps
                          .filter(e => e.crm_branch_name === nav?.branch && e.name)
                          .map(e => <option key={e.id} value={e.name}>{e.designation || ''}</option>)}
                      </datalist>
                      <div style={{ fontSize: '10px', color: t.text4, marginTop: '5px' }}>
                        Leave blank to print just &ldquo;BRANCH EMPLOYEE&rdquo;.
                      </div>
                    </div>
                  )}

                  {/* Transporter — who physically carries this consignment.
                      Prints on the Delivery Challan (EXTERNAL only; INTERNAL
                      self-carry uses the Carried by field above). Default BVC;
                      Branch Employee for self-carry; Other = free text. */}
                  {moveType !== 'INTERNAL' && (
                    <div>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>
                        Transporter <span style={{ textTransform: 'none', fontWeight: 400, color: t.text4 }}>(prints on Delivery Challan)</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {[['bvc', 'BVC Logistics'], ['branch_employee', 'Branch Employee'], ['other', 'Other']].map(([val, label]) => {
                          const on = transporterMode === val
                          return (
                            <button key={val} type="button" onClick={() => setTransporterMode(val)}
                              style={{ flex: 1, padding: '13px 8px', borderRadius: '10px', border: `1px solid ${on ? t.gold : t.border2}`, background: on ? `${t.gold}18` : t.card2, color: on ? t.gold : t.text2, fontSize: '12.5px', fontWeight: on ? 700 : 500, cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap' }}>
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      {transporterMode === 'other' && (
                        <input
                          value={transporterOther}
                          onChange={e => setTransporterOther(e.target.value.slice(0, 50))}
                          placeholder="Courier / transporter name"
                          style={{ width: '100%', marginTop: '8px', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '10px', padding: '13px 15px', fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box' }}
                        />
                      )}
                    </div>
                  )}
                    </div>{/* end left column */}
                    <div style={{ minWidth: 0 }}>
                  {/* Section label mirrors DESTINATION on the left so the two
                      columns share the same top baseline. */}
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>Summary</div>
                  {/* Shipment summary — one cohesive panel (route · metrics ·
                      document) divided by hairlines. Reads as the "ticket" being
                      created rather than three loose cards. */}
                  <div style={{ border: `1px solid ${t.border2}`, borderRadius: '14px', background: t.card2, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.03)' }}>
                    {/* Route */}
                    <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px' }}>From</div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: t.gold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.015em' }}>{nav?.branch || '—'}</div>
                        {srcRegionLabel && <div style={{ fontSize: '10.5px', color: t.text3, marginTop: '4px' }}>{srcRegionLabel}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', color: destColor }}>
                        <span style={{ width: '18px', height: '2px', borderRadius: '2px', background: `repeating-linear-gradient(90deg, ${destColor} 0 3px, transparent 3px 6px)` }} />
                        <span style={{ fontSize: '16px', lineHeight: 1, marginLeft: '1px' }}>→</span>
                      </div>
                      <div style={{ minWidth: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px' }}>To</div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: destColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.015em' }}>{dest}</div>
                        {destRegion && <div style={{ fontSize: '10.5px', color: t.text3, marginTop: '4px' }}>{destRegion}</div>}
                      </div>
                    </div>
                    <div style={{ height: '1px', background: t.border }} />
                    {/* Metrics */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                      {[
                        { label: 'Bills',      value: String(selected.size),               color: t.text1, size: '24px' },
                        { label: 'Net Weight', value: fmtWt(totalSelWt),                   color: t.gold,  size: '17px' },
                        { label: 'Value',      value: `₹${fmt(Math.round(totalSelAmt))}`,  color: t.blue,  size: '17px' },
                      ].map((m, i) => (
                        <div key={m.label} style={{ padding: '16px 16px', borderLeft: i === 0 ? 'none' : `1px solid ${t.border}` }}>
                          <div style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '8px' }}>{m.label}</div>
                          <div style={{ fontSize: m.size, color: m.color, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ height: '1px', background: t.border }} />
                    {/* Value breakdown — goods value + (interstate only) markup &
                        IGST → grand total, computed by the SAME single source of
                        truth the E-Invoice/Voucher use. For INTERNAL / intrastate
                        markup & IGST are n/a and Total = goods value. */}
                    {(() => {
                      const T = computeConsignmentTotals({
                        consignment: { movement_type: moveType, source_region: srcRegion },
                        items: selectedRows,
                        companySettings: {},
                      })
                      const rs = n => `₹${fmt(Math.round(n))}`
                      const line = (label, value, opts = {}) => (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
                          <span style={{ fontSize: opts.strong ? '12px' : '11.5px', color: opts.strong ? t.text1 : t.text3, fontWeight: opts.strong ? 800 : 500, letterSpacing: opts.strong ? '.02em' : 0, textTransform: opts.strong ? 'uppercase' : 'none' }}>{label}</span>
                          <span style={{ fontSize: opts.strong ? '15px' : '12.5px', color: opts.strong ? t.gold : (opts.muted ? t.text4 : t.text2), fontFamily: 'monospace', fontWeight: opts.strong ? 800 : 600, whiteSpace: 'nowrap' }}>{value}</span>
                        </div>
                      )
                      const inter = T.isExternalInterstate
                      return (
                        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {/* Markup + IGST side by side */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                            {[
                              { label: `Markup @ ${T.upliftPct}%`, value: inter ? rs(T.markupAmt) : '—' },
                              { label: `IGST @ ${T.gstRate}%`,     value: inter ? rs(T.igstAmt)   : '—' },
                            ].map(x => (
                              <div key={x.label} style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '5px' }}>{x.label}</div>
                                <div style={{ fontSize: '14px', color: inter ? t.text2 : t.text4, fontFamily: 'monospace', fontWeight: 700 }}>{x.value}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ height: '1px', background: t.border, margin: '2px 0' }} />
                          {line('Total value', rs(T.grandTotal), { strong: true })}
                        </div>
                      )
                    })()}
                    <div style={{ height: '1px', background: t.border }} />
                    {/* Documents — the movement doc PLUS the GST doc that will be
                        generated. GST kind: intrastate (INTERNAL, or KA source →
                        KA head office) = E-Way Bill; interstate (non-KA → HO) =
                        E-Invoice. */}
                    {(() => {
                      const isKaSrc = srcState === 'Karnataka'
                      const gst = (moveType === 'INTERNAL' || isKaSrc)
                        ? { badge: 'EWB',   label: 'E-Way Bill', accent: t.blue }
                        : { badge: 'E-Inv', label: 'E-Invoice',  accent: t.purple }
                      const docs = [
                        { badge: isExternal ? 'DC' : 'IV', label: isExternal ? 'Delivery Challan' : 'Issue Voucher', accent: isExternal ? t.gold : t.purple },
                        gst,
                      ]
                      return (
                        <div style={{ padding: '16px 20px' }}>
                          <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '9px' }}>Documents</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                            {docs.map(d => (
                              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                <span style={{ fontSize: '9.5px', fontWeight: 800, letterSpacing: '.03em', color: d.accent, background: `${d.accent}18`, border: `1px solid ${d.accent}40`, borderRadius: '5px', padding: '4px 7px', flexShrink: 0 }}>{d.badge}</span>
                                <div style={{ fontSize: '12.5px', color: t.text1, fontWeight: 700, whiteSpace: 'nowrap' }}>{d.label}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                    </div>{/* end right column */}
                  </div>{/* end top band grid */}

                  {/* Reference numbers — full-width band beneath both columns. */}
                  {(loadingPreview || previewNumbers) && (
                    <div style={{ marginTop: '18px', border: `1px solid ${t.border2}`, borderRadius: '12px', background: t.card2, padding: '15px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                      {loadingPreview ? (
                        <div style={{ fontSize: '11px', color: t.text4 }}>Generating reference numbers…</div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px' }}>TMP PRF No</div>
                            <div style={{ fontSize: '15px', color: t.gold, fontWeight: 700, fontFamily: 'monospace' }}>{previewNumbers.tmp_prf_no}</div>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px' }}>{moveType === 'INTERNAL' ? 'Voucher No' : 'Challan No'}</div>
                            <div style={{ fontSize: '13px', color: t.blue, fontWeight: 600, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewNumbers.challan_no}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )
            })()}

            </div>

            {/* ── Footer (sticky to modal bottom) ──────────────────────── */}
            <div style={{
              padding: '18px 34px',
              borderTop: `1px solid ${t.border}`,
              background: t.card,
              display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center',
              flexShrink: 0,
            }}>
              {(() => {
                const footDest = moveType === 'EXTERNAL' ? 'Head Office' : moveType === 'INTERNAL' ? destBranch : null
                return (
                  <div style={{ marginRight: 'auto', minWidth: 0 }}>
                    {footDest ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: t.text2, flexWrap: 'wrap' }}>
                        <strong style={{ color: t.text1, fontFamily: 'monospace' }}>{selected.size}</strong>
                        <span style={{ color: t.text3 }}>bill{selected.size === 1 ? '' : 's'}</span>
                        <span style={{ color: t.text4 }}>·</span>
                        <strong style={{ color: t.gold, fontFamily: 'monospace' }}>{fmtWt(totalSelWt)}</strong>
                        <span style={{ color: t.text4 }}>→</span>
                        <strong style={{ color: moveType === 'EXTERNAL' ? t.gold : t.purple, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>{footDest}</strong>
                      </div>
                    ) : (
                      <span style={{ fontSize: '11.5px', color: t.text4 }}>Pick a destination to continue.</span>
                    )}
                    <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>You'll confirm once more before it's created.</div>
                  </div>
                )
              })()}
              <button className="ccm-cancel" onClick={() => setShowModal(false)} style={btnOut}>Cancel</button>
              <button className="ccm-confirm" onClick={handleCreate} disabled={creating}
                style={{ ...btnGold, padding: '11px 24px', fontSize: '13px', fontWeight: 700, opacity: creating ? .7 : 1 }}>
                {creating ? 'Creating…' : 'Confirm & Create →'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {activityId && (
        <ActivityDrawer
          consignment={consignments.find(x => x.id === activityId)}
          rows={activityRows}
          loading={activityLoading}
          onClose={() => setActivityId(null)}
          t={t}
        />
      )}
    </div>
  )
}

// ── Activity Log drawer ───────────────────────────────────────────────────────
// Right-side panel showing every event in consignment_activity_log for one
// consignment. Surfaces who did what and any reason/remark they gave —
// the audit trail every operator and accounts query lands on.
function ActivityDrawer({ consignment, rows, loading, onClose, t }) {
  const eventLabel = (et) => ({
    'created':                'Created',
    'created_and_received':   'Created (auto-received at hub)',
    'approved_by_accounts':   'Approved by accounts',
    'rejected_by_accounts':   'Rejected by accounts',
    'cancelled':              'Cancelled / voided',
    'received':               'Received at HO',
    'ewb_generated':          'E-Way Bill generated',
    'ewb_cancelled':          'E-Way Bill cancelled',
    'einvoice_generated':     'E-Invoice (IRN) generated',
    'einvoice_cancelled':     'E-Invoice cancelled',
  }[et] || et)

  // Pull a human-readable reason/remark out of the details JSON, falling back
  // to whichever key the action wrote (reason, note, remark, rejection_reason).
  const reasonOf = (r) => {
    const d = r.details || {}
    return d.reason || d.rejection_reason || d.remark || d.note || d.cancel_reason || null
  }

  const fmt = (ts) => {
    if (!ts) return ''
    try { return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return ts }
  }

  // Portalled to <body> so the right-side drawer can't get clipped by an
  // ancestor with transform / filter / contain.
  if (typeof document === 'undefined') return null
  return createPortal((
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', justifyContent: 'flex-end', zIndex: 2000 }}>
      <div style={{ width: '440px', maxWidth: '95vw', height: '100vh', background: t.card, borderLeft: `1px solid ${t.border}`, boxShadow: '-12px 0 40px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '14px', color: t.text1, fontWeight: 500, letterSpacing: '.02em' }}>Activity log</div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px', fontFamily: 'monospace' }}>
              {consignment?.tmp_prf_no || '—'} · {consignment?.branch_name} → {consignment?.dest_branch || 'HO'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close activity log" style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: '18px', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
          {loading && <div style={{ color: t.text3, fontSize: '12px', textAlign: 'center', padding: '40px 0' }}>Loading…</div>}
          {!loading && rows.length === 0 && (
            <div style={{ color: t.text4, fontSize: '12px', textAlign: 'center', padding: '40px 0' }}>No activity recorded.</div>
          )}
          {!loading && rows.map((r, i) => {
            const reason = reasonOf(r)
            const isRejection = r.event_type === 'rejected_by_accounts'
            const isCancel    = r.event_type === 'cancelled'
            const accent = isRejection ? t.red : isCancel ? t.red : r.event_type === 'approved_by_accounts' ? t.green : t.gold
            return (
              <div key={r.id || i} style={{ display: 'flex', gap: '12px', paddingBottom: '14px', marginBottom: '14px', borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${t.border}25` }}>
                <div style={{ width: '8px', minWidth: '8px', marginTop: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: accent }}></div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', color: t.text1, fontWeight: 500 }}>{eventLabel(r.event_type)}</div>
                  <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
                    {fmt(r.created_at)}
                    {r.actor_email && <> · <span style={{ fontFamily: 'monospace', color: t.text3 }}>{r.actor_email}</span></>}
                  </div>
                  {reason && (
                    <div style={{ fontSize: '11px', color: t.text2, marginTop: '6px', background: `${accent}10`, border: `1px solid ${accent}30`, borderRadius: '5px', padding: '7px 10px', whiteSpace: 'pre-wrap' }}>
                      {reason}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  ), document.body)
}

// ── Email documents modal ────────────────────────────────────────────────────
// Confirms the recipient (prefilled from the branch mailbox, editable — this is
// the "ops enters the mail id" path when the branch has none) and sends the 3
// consignment documents as attachments. Fetches readiness + the exact filenames
// from the endpoint on open so the operator sees precisely what will go out.
function EmailDocsModal({ t, c, branchEmail, onClose, onSent, onError }) {
  const [info,    setInfo]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [to,      setTo]      = useState(branchEmail || '')
  const [cc,      setCc]      = useState('')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(null)   // success confirmation shown in-modal

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await authedFetch(`/api/consignments/email-documents?id=${c.id}`)
        const j = await r.json()
        if (!live) return
        if (!r.ok) { onError?.(j.error || 'Could not load document info'); onClose?.(); return }
        setInfo(j)
        setTo(prev => prev || j.branch_email || '')
      } catch (e) {
        if (live) { onError?.('Network error loading document info'); onClose?.() }
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [c.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const toValid  = EMAIL_RE.test(to.trim())
  const ccValid  = !cc.trim() || EMAIL_RE.test(cc.trim())
  const canSend  = !loading && !sending && info?.ready && toValid && ccValid
  const alreadySent = !!info?.last_sent
  const fmtSent = (iso) => {
    try { return 'on ' + new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) }
    catch { return 'earlier' }
  }

  const send = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const r = await authedFetch('/api/consignments/email-documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, to: to.trim(), cc: cc.trim() || undefined }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { onError?.(j.error || `Send failed (${r.status})`); setSending(false); return }
      // Show an explicit in-modal confirmation (ops asked for a clear "sent"
      // acknowledgement) rather than closing straight away. onSent still fires
      // so the row refreshes to its "✓ Emailed" state in the background.
      setSent({ to: j.sent_to || to.trim(), cc: j.cc || [], attachments: j.attachments || [] })
      setSending(false)
      onSent?.(j.sent_to || to.trim())
    } catch (e) {
      onError?.('Network error — the email may not have been sent.'); setSending(false)
    }
  }

  if (typeof document === 'undefined') return null
  const inp = { width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '10px', padding: '11px 13px', fontSize: '13.5px', color: t.text1, outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s, box-shadow .15s', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.05)' }
  // Friendly document names for the three attachments (order fixed by the API:
  // report, voucher/challan, EWB/E-Invoice) — the raw filenames are cryptic to
  // the branch ops team, so lead with a plain-English label + a file-type badge.
  const docLabels = ['Consignee Report', info?.doc_label || 'Voucher / Challan', info?.gst_label || 'EWB / E-Invoice']
  const docRows = (info?.attachments || []).map((f, i) => ({ name: docLabels[i] || 'Document', file: f, ext: (String(f).split('.').pop() || '').toUpperCase() }))
  // Colour each document by what it IS (mirrors the pipeline): Report = gold,
  // Voucher/Challan = blue, then green for an E-Way Bill or purple for an
  // E-Invoice. Gives the three rows a distinct, on-brand identity.
  const docAccent = (i) => i === 0 ? t.gold : i === 1 ? t.blue : (info?.gst_label === 'E-Invoice' ? t.purple : t.green)
  const bills = c.total_bills
  const wt = c.total_gross_wt != null ? Number(c.total_gross_wt).toFixed(3) : (c.total_net_wt != null ? Number(c.total_net_wt).toFixed(3) : null)
  // A proper folded-corner document glyph, tinted to the doc's accent, with the
  // file type lettered inside — reads as a real file, not a coloured box.
  const FileGlyph = ({ ext, color }) => (
    <svg width="28" height="34" viewBox="0 0 28 34" style={{ flexShrink: 0 }} aria-hidden="true">
      <path d="M3 1.5 h14 l8.5 8.5 V31 a1.5 1.5 0 0 1-1.5 1.5 H3 a1.5 1.5 0 0 1-1.5-1.5 V3 A1.5 1.5 0 0 1 3 1.5 Z" fill={`${color}14`} stroke={color} strokeWidth="1.4" />
      <path d="M17 1.5 V10 h8.5" fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      <text x="13.5" y="26" fontSize="6.5" fontWeight="800" fill={color} textAnchor="middle" style={{ fontFamily: 'system-ui, sans-serif', letterSpacing: '.03em' }}>{ext}</text>
    </svg>
  )
  return createPortal((
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}
      onClick={() => { if (!sending) onClose?.() }}>
      <style>{`
        @keyframes edmIn { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: none } }
        .edm-card { animation: edmIn .2s cubic-bezier(.2,.7,.3,1) }
        .edm-card input:focus { border-color: ${t.green} !important; box-shadow: 0 0 0 3px ${t.green}22 }
        .edm-send:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px) }
        .edm-cancel:hover { background: ${t.card2} }
        .edm-doc { transition: transform .13s ease, box-shadow .13s ease }
        .edm-doc:hover { transform: translateY(-1px) }
        @media (prefers-reduced-motion: reduce) { .edm-card, .edm-send, .edm-doc { animation: none; transition: none } }
      `}</style>
      <div className="edm-card" onClick={e => e.stopPropagation()}
        style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: '0 24px 70px rgba(0,0,0,.55)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '13px', padding: '20px 24px 16px', borderBottom: `1px solid ${t.border2}` }}>
          <div style={{ flexShrink: 0, width: '38px', height: '38px', borderRadius: '11px', background: `${t.green}18`, color: t.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>✉</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15.5px', fontWeight: 800, color: t.text1, lineHeight: 1.2 }}>Email documents to branch</div>
            <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', color: t.text2, fontWeight: 700 }}>{c.tmp_prf_no}</span>
              <span style={{ color: t.text4 }}>·</span>
              <span>{c.branch_name}</span>
              <span style={{ color: t.gold }}>→</span>
              <span>{info?.dest || 'Head Office'}</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 24px 20px' }}>
        {sent ? (
          <div style={{ padding: '14px 0 4px', textAlign: 'center' }}>
            <div style={{ width: '58px', height: '58px', borderRadius: '50%', background: `${t.green}18`, border: `1px solid ${t.green}44`, color: t.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px', fontWeight: 800, marginBottom: '14px' }}>✓</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: t.text1, marginBottom: '6px' }}>Email sent</div>
            <div style={{ fontSize: '13px', color: t.text2, lineHeight: 1.6 }}>
              {sent.attachments.length || 3} document{(sent.attachments.length || 3) === 1 ? '' : 's'} sent to <b style={{ color: t.text1 }}>{sent.to}</b>
              {sent.cc && sent.cc.length > 0 && (
                <><br /><span style={{ fontSize: '11.5px', color: t.text3 }}>Cc: {sent.cc.join(', ')}</span></>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
              <button className="edm-send" onClick={() => onClose?.()}
                style={{ background: t.green, color: '#fff', border: 'none', borderRadius: '9px', padding: '10px 30px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', boxShadow: `0 3px 12px ${t.green}44` }}>
                Done
              </button>
            </div>
          </div>
        ) : loading ? (
          <div style={{ fontSize: '13px', color: t.text3, padding: '22px 0', textAlign: 'center' }}>Loading…</div>
        ) : (
          <>
            {alreadySent && (
              <div style={{ display: 'flex', gap: '8px', fontSize: '11.5px', color: t.green, background: `${t.green}12`, border: `1px solid ${t.green}40`, borderRadius: '9px', padding: '10px 12px', marginBottom: '16px', lineHeight: 1.5 }}>
                <span style={{ flexShrink: 0, fontWeight: 800 }}>✓</span>
                <span>Already emailed {fmtSent(info.last_sent.at)}{info.last_sent.by ? ` by ${info.last_sent.by}` : ''}{info.last_sent.to ? ` to ${info.last_sent.to}` : ''}. You can resend if required.</span>
              </div>
            )}

            {/* Attachments — plain-English document names, not raw filenames */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Attachments</span>
              {(bills != null || wt) && (
                <span style={{ fontSize: '10.5px', color: t.text3 }}>
                  {bills != null ? `${bills} bill${bills === 1 ? '' : 's'}` : ''}{bills != null && wt ? ' · ' : ''}{wt ? `${wt} g` : ''}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {docRows.map((d, i) => {
                const accent = docAccent(i)
                return (
                  <div className="edm-doc" key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: t.card, border: `1px solid ${t.border}`, borderLeft: `3px solid ${accent}`, borderRadius: '11px', padding: '10px 13px', boxShadow: t.shadow }}>
                    <FileGlyph ext={d.ext} color={accent} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: t.text1, marginBottom: '1px' }}>{d.name}</div>
                      <div style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.file}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {!info?.ready && (
              <div style={{ fontSize: '11.5px', color: t.orange, background: `${t.orange}12`, border: `1px solid ${t.orange}40`, borderRadius: '9px', padding: '10px 12px', marginBottom: '16px' }}>
                Not ready to send — missing: {(info?.missing || []).join(', ')}.
              </div>
            )}

            <label style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '6px' }}>To</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="branch@whitegold.money" style={{ ...inp, borderColor: to && !toValid ? t.red : t.border2, marginBottom: '5px' }} />
            {!info?.branch_email && (
              <div style={{ fontSize: '10.5px', color: t.text4, marginBottom: '12px' }}>This branch has no email on file — enter one to send.</div>
            )}
            {info?.branch_email && <div style={{ height: '12px' }} />}

            <label style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '6px' }}>Cc <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="add another recipient…" style={{ ...inp, borderColor: cc && !ccValid ? t.red : t.border2, marginBottom: '20px' }} />

            <div style={{ margin: '22px -24px -20px', padding: '15px 24px', borderTop: `1px solid ${t.border2}`, background: t.card3, display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button className="edm-cancel" onClick={() => { if (!sending) onClose?.() }} disabled={sending}
                style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '9px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, color: t.text2, cursor: sending ? 'not-allowed' : 'pointer', transition: 'background .15s' }}>
                Cancel
              </button>
              <button className="edm-send" onClick={send} disabled={!canSend}
                title={!info?.ready ? 'All 3 documents must be ready' : !toValid ? 'Enter a valid recipient email' : ''}
                style={{ background: canSend ? t.green : t.border2, color: canSend ? '#fff' : t.text4, border: 'none', borderRadius: '9px', padding: '10px 24px', fontSize: '13px', fontWeight: 800, cursor: canSend ? 'pointer' : 'not-allowed', transition: 'filter .15s, transform .15s', display: 'inline-flex', alignItems: 'center', gap: '6px', boxShadow: canSend ? `0 3px 12px ${t.green}44` : 'none' }}>
                {sending ? 'Sending…' : (alreadySent ? '✉ Resend' : '✉ Send')}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  ), document.body)
}
