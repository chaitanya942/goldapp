'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import JSZip from 'jszip'
import { useApp } from '../../lib/context'
import { supabase as supabaseClient } from '../../lib/supabase'
import GoldSpinner from '../ui/GoldSpinner'
import Badge from '../ui/Badge'
import Toast from '../ui/Toast'
import { openConfirm, openPrompt } from '../ui/ConfirmDialog'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, REGION_COLORS, useMobile } from '../../lib/consignmentTheme'
import { WorkflowStrip, canActOnStep } from './workflowParts'

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

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const fmtTS   = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// Waiting-time helper for the approval pending pill in the ALL column.
// Mirrors ConsignmentApprovals.waitingBadge but returns just label + color
// urgency band so callers can style their own pill.
function approvalWaiting(ts, t) {
  if (!ts) return { label: '—', color: t.text4 }
  const ms = Date.now() - new Date(ts).getTime()
  if (ms < 0) return { label: 'just now', color: t.green }
  const mins = Math.floor(ms / 60000)
  let label
  if (mins < 1)        label = 'just now'
  else if (mins < 60)  label = `${mins}m`
  else if (mins < 1440) {
    const h = Math.floor(mins / 60); const m = mins % 60
    label = m ? `${h}h ${m}m` : `${h}h`
  } else {
    const d = Math.floor(mins / 1440); const h = Math.floor((mins % 1440) / 60)
    label = h ? `${d}d ${h}h` : `${d}d`
  }
  // Urgency colour ramp: <1h green, <4h gold, <24h orange, >24h red.
  const color = mins < 60   ? t.green
              : mins < 240  ? t.gold
              : mins < 1440 ? t.orange
              : t.red
  return { label, color }
}
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0

function AgeBadge({ days, t }) {
  if (days === null || days === undefined) return null
  const color = days > 7 ? t.red : days > 3 ? t.orange : t.green
  return <span style={{ fontSize: '10px', color, background: `${color}18`, borderRadius: '5px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.02em' }}>{days}d</span>
}

// EWB cell — single-line layout. EWB number visible on wide screens, short
// "EWB" badge on narrow screens. Expiry shown as tooltip.
// PDF download is hidden until accounts approves; EWB itself is generated
// during create, but the legally binding PDF stays gated. Cancel and the
// number badge remain visible so ops can see the EWB exists and roll it
// back if needed within the 24h NIC window.
function EwbCell({ c, t, downloadingId, ewbActionId, downloadEwbPdf, cancelEwb }) {
  const validUntil = c.ewb_valid_until ? new Date(c.ewb_valid_until) : null
  const tooltipText = validUntil
    ? `EWB ${c.eway_bill_no}. Valid till ${validUntil.toLocaleString()}.`
    : `EWB ${c.eway_bill_no}`
  const isApproved = c.approval_status === 'approved'
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', alignItems: 'center', whiteSpace: 'nowrap' }} title={tooltipText}>
      <span className="ewb-num-full"
        style={{ fontSize: '10px', color: t.green, background: `${t.green}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, fontFamily: 'monospace' }}>
        {c.eway_bill_no}
      </span>
      <span className="ewb-num-short"
        style={{ fontSize: '10px', color: t.green, background: `${t.green}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>
        EWB
      </span>
      {isApproved ? (
        <button onClick={() => downloadEwbPdf(c)} disabled={!!downloadingId}
          style={{ background: t.blue, color: '#fff', border: 'none', borderRadius: '5px', padding: '3px 10px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', opacity: downloadingId === c.id + ':ewb' ? 0.6 : 1 }}>
          {downloadingId === c.id + ':ewb' ? '…' : 'PDF'}
        </button>
      ) : (
        <span title="PDF unlocks once accounts approves the consignment."
          style={{ fontSize: '10px', color: t.text4, padding: '3px 8px', fontStyle: 'italic' }}>
          locked
        </span>
      )}
      <button onClick={() => cancelEwb(c)} disabled={!!ewbActionId}
        title="Cancel E-Way Bill (within 24h)"
        style={{ background: 'transparent', border: `1px solid ${t.red}40`, borderRadius: '5px', padding: '3px 10px', fontSize: '10px', color: t.red, cursor: 'pointer', opacity: ewbActionId === c.id + ':cancel' ? 0.6 : 1 }}>
        {ewbActionId === c.id + ':cancel' ? '…' : 'Cancel'}
      </button>
      <style>{`
        .ewb-num-short { display: none; }
        @media (max-width: 1280px) {
          .ewb-num-full  { display: none; }
          .ewb-num-short { display: inline-block; }
        }
      `}</style>
    </div>
  )
}

export default function ConsignmentData() {
  const { theme, consignmentDeepLink, setConsignmentDeepLink, setActiveNav, user, userProfile } = useApp()
  // Track whether the user landed here via a Branch Stock Overview row click,
  // so the Back button can return them to that view instead of the local list.
  const cameFromBranchStock = useRef(false)
  const userEmail = user?.email || userProfile?.email || null
  const t = THEMES[theme]
  const isMobile = useMobile()

  // Mode: null = Active Consignments list,  { type:'branch', branch, fromRegion } = bill picker
  const [nav,                 setNav]                = useState(null)
  const [purchases,           setPurchases]          = useState([])
  // Branch-specific bill list, populated when entering a branch view.
  // Decoupled from `purchases` so fetchAll (no-branch) can't race-overwrite.
  const [branchBillsState,    setBranchBillsState]   = useState(null)
  const [consignments,        setConsignments]       = useState([])
  const [branches,            setBranches]           = useState([])
  const [unknownBranches,     setUnknownBranches]    = useState([])
  const [loading,             setLoading]            = useState(true)
  const [selected,            setSelected]           = useState(new Set())
  // Default sort: oldest first. Operations should dispatch ageing bills before
  // fresh ones (FIFO + risk-management) — surface them at the top.
  const [sortBy,              setSortBy]             = useState('oldest')
  const [search,              setSearch]             = useState('')
  const [creating,            setCreating]           = useState(false)
  const [moveType,            setMoveType]           = useState('EXTERNAL')
  const [destBranch,          setDestBranch]         = useState('')
  const [destSearch,          setDestSearch]         = useState('')
  const [destOpen,            setDestOpen]           = useState(false)
  const [ewayBillNo,          setEwayBillNo]         = useState('')
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
  const [ewbActionId,         setEwbActionId]        = useState(null)
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

  // List filters
  const [filterType,   setFilterType]   = useState('')
  const [filterRegion, setFilterRegion] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
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
    setConsignments((c.data || []).filter(x => {
      if (x.status === 'seed') return false
      const isRejected = x.approval_status === 'rejected'
      if (x.status === 'cancelled' && !isRejected) return false
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
    }))
    setUnknownBranches(u.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Realtime: when accounts approves/rejects a consignment, the badge and
  // download buttons in this view update without the user refreshing.
  useEffect(() => {
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
      .subscribe()
    return () => { supabaseClient.removeChannel(channel) }
  }, [])

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
  useEffect(() => {
    if (!nav?.branch) { setTransferHistory({}); setBranchBillsState(null); return }
    setBranchBillsState(null)  // show loading until fresh data arrives
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
        p.application_id?.toLowerCase().includes(q))
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
    if (!nav?.branch) return
    setLoadingPreview(true)
    try {
      const res  = await authedFetch(`/api/consignments-preview?branch=${encodeURIComponent(nav.branch)}&movement_type=${moveType}`)
      const data = await res.json()
      if (!data.error) setPreviewNumbers(data)
    } catch {}
    finally { setLoadingPreview(false) }
  }

  async function handleCreate() {
    if (!selected.size || !nav?.branch) return
    if (moveType === 'INTERNAL' && !destBranch) {
      setToast({ msg: 'Select a destination hub before creating.', type: 'error' })
      return
    }

    // Final confirmation gate — themed dialog so creation never fires from a
    // single click. Restates the destination, bills, weight, value so the user
    // can't claim they didn't see it. Cancel here is a clean no-op.
    const dest = moveType === 'INTERNAL' ? destBranch : 'Head Office'
    const ok = await openConfirm({
      title: 'Create this consignment?',
      message: `${nav.branch} → ${dest}\n\n· ${selected.size} bill${selected.size === 1 ? '' : 's'}\n· ${fmtWt(totalSelWt)} net weight\n· ₹${fmt(Math.round(totalSelAmt))} value\n· ${moveType === 'INTERNAL' ? 'Issue Voucher' : 'Delivery Challan'} will be issued\n\nOnce created, the bills are locked to this consignment until accounts approves or the consignment is voided.`,
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
          eway_bill_no: ewayBillNo || null,
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
      await fetchAll()
      // Return to Active Consignments list with the new one highlighted
      setNav(null)
    } finally { setCreating(false) }
  }

  // generateEinv removed — E-Invoice generation moved to the accounts review
  // page (ConsignmentApprovals.js). The /api/e-invoice/generate route is now
  // gated to ROLE_GROUPS.ACCOUNTS, so any ops attempt would 403.

  async function cancelEinv(c) {
    const ok = await openConfirm({
      title: `Cancel E-Invoice for ${c.tmp_prf_no}?`,
      message: `IRN ${String(c.irn || '').slice(0, 20)}…\n${c.branch_name} to ${c.dest_branch || 'Head Office'}.\n\nThe IRP only accepts cancellation within 24 hours of generation. After that, the IRN is locked and a credit note is required instead.`,
      confirmLabel: 'Cancel E-Invoice',
      danger: true,
    })
    if (!ok) return
    setEwbActionId(c.id + ':einv-cancel')
    try {
      const res  = await authedFetch('/api/e-invoice/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setToast({ msg: data.error || 'E-Invoice cancel failed', type: 'error' }); return }
      setToast({ msg: 'E-Invoice cancelled', type: 'success' })
      await fetchAll()
    } finally { setEwbActionId(null) }
  }

  // generateEwb removed — E-Way Bill generation moved to the accounts review
  // page. /api/eway-bill/generate is now gated to ROLE_GROUPS.ACCOUNTS.

  async function cancelEwb(c) {
    const ok = await openConfirm({
      title: `Cancel E-Way Bill ${c.eway_bill_no}?`,
      message: `${c.tmp_prf_no}, ${c.branch_name} to ${c.dest_branch || 'Head Office'}.\n\nNIC only accepts cancellation within 24 hours of generation. After that the EWB is locked and the goods cannot move under it.`,
      confirmLabel: 'Cancel E-Way Bill',
      danger: true,
    })
    if (!ok) return
    setEwbActionId(c.id + ':cancel')
    try {
      const res  = await authedFetch('/api/eway-bill/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setToast({ msg: data.error || 'EWB cancel failed', type: 'error' }); return }
      setToast({ msg: 'E-Way Bill cancelled', type: 'success' })
      await fetchAll()
    } finally { setEwbActionId(null) }
  }

  async function downloadEwbPdf(c) {
    setDownloadingId(c.id + ':ewb')
    await triggerDownload(`/api/eway-bill/pdf?id=${c.id}`, `EWB_${c.eway_bill_no}.pdf`, msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
  }

  async function cancelConsignment(c) {
    const reason = await openPrompt({
      title: `Void ${c.tmp_prf_no}?`,
      message: `${c.total_bills || 0} bill${c.total_bills === 1 ? '' : 's'} (${fmtWt(c.total_net_wt)}) will return to ${c.branch_name}. If the E-Way Bill or E-Invoice has been generated, cancel them separately on the GST portal.\n\nEnter a reason. It will be saved in the audit log.`,
      placeholder: 'For example: created on the wrong branch, vehicle cancelled, customer return.',
      minLength: 8,
      maxLength: 280,
      rows: 3,
      confirmLabel: 'Void',
      danger: true,
    })
    if (!reason) return
    try {
      const res = await authedFetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_consignment', id: c.id, reason, cancelled_by: userEmail }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setToast({ msg: data.error || 'Cancel failed', type: 'error' }); return }
      setToast({ msg: 'Consignment voided. Bills have been returned to the source branch.', type: 'success' })
      await fetchAll()
    } catch (err) {
      setToast({ msg: err.message || 'Cancel failed', type: 'error' })
    }
  }

  // Bill confirmation now happens automatically at consignment creation
  // (the user already confirmed twice during the create flow). Removed the
  // explicit handler; the workflow strip is purely a status indicator now.

  async function downloadDoc(c, kind) {
    setDownloadingId(c.id + ':' + kind)
    const url      = kind === 'report'  ? `/api/generate-consignee-report?id=${c.id}`
                   : kind === 'voucher' ? `/api/generate-issue-voucher-pdf?id=${c.id}`
                   :                       `/api/generate-challan-pdf?id=${c.id}`
    const filename = kind === 'report'  ? `GoldConsigneeReport-${c.tmp_prf_no}.jpg`
                   : kind === 'voucher' ? `${(c.tmp_prf_no || 'voucher').replace(/\//g,'-')}_voucher.pdf`
                   :                       `${(c.challan_no || c.tmp_prf_no || 'challan').replace(/\//g,'-')}.pdf`
    await triggerDownload(url, filename, msg => setToast({ msg, type: 'error' }))
    setDownloadingId(null)
  }

  // One-click: auto-generate any missing EWB / E-Invoice, then download all
  // applicable documents into a real folder (File System Access API where
  // supported — Chrome/Edge), else fall back to ZIP.
  // Folder name format: {TMP_PRF}_{SOURCE}-to-{DEST}_{YYYY-MM-DD}
  async function downloadAll(c) {
    const isType = c.movement_type === 'INTERNAL'
    const src = branches.find(b => b.name === c.branch_name)
    const isKaSource = src?.region === 'Rest of Karnataka' || src?.region === 'Bangalore'
    const showEwb = isType || isKaSource           // intrastate cases
    const showEinv = !isType && !isKaSource         // interstate Hub→HO

    const sanitize = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
    const dateStr  = new Date(c.created_at).toISOString().slice(0, 10)
    const dest     = isType ? c.dest_branch : 'HO'
    const folderName = `${sanitize(c.tmp_prf_no)}_${sanitize(c.branch_name)}-to-${sanitize(dest)}_${dateStr}`

    setDownloadingId(c.id + ':all')

    // Auto-generate-then-bundle was removed when generation moved to the
    // accounts review page. By the time ops can click Download all, the
    // consignment is approved — which means accounts already generated
    // whatever was applicable. If EWB / IRN are still missing here, the
    // bundle just skips them.
    const cur = { ...c }
    const genFailures = []

    // Build the list of files to fetch.
    //   - Consignee Report + Challan/Voucher: always included. The branch
    //     needs these to physically pack the consignment, even before
    //     accounts has approved.
    //   - EWB + E-Invoice: only included once accounts has approved.
    //     Including them earlier produces a 403 (approvalGate blocks them
    //     until the legally-binding GST documents have been verified).
    const isApproved = cur.approval_status === 'approved'
    const files = []
    files.push({ url: `/api/generate-consignee-report?id=${cur.id}`, name: 'Consignee_Report.jpg' })
    files.push({
      url:  isType ? `/api/generate-issue-voucher-pdf?id=${cur.id}` : `/api/generate-challan-pdf?id=${cur.id}`,
      name: isType ? 'Issue_Voucher.pdf' : 'Delivery_Challan.pdf',
    })
    if (isApproved && showEwb && cur.eway_bill_no) {
      files.push({ url: `/api/eway-bill/pdf?id=${cur.id}`, name: `EWB_${sanitize(cur.eway_bill_no)}.pdf` })
    }
    if (isApproved && showEinv && cur.irn) {
      files.push({ url: `/api/e-invoice/pdf?id=${cur.id}`, name: `EInvoice_${sanitize(cur.tmp_prf_no || 'IRN')}.pdf` })
    }
    // Use the refreshed cur object below
    c = cur

    // Fetch a URL → blob, surfacing JSON error bodies as readable messages.
    const fetchToBlob = async (url) => {
      const res = await authedFetch(url)
      if (!res.ok) {
        // Try to extract JSON error message from server
        let detail = `HTTP ${res.status}`
        try {
          const ct = res.headers.get('content-type') || ''
          if (ct.includes('json')) {
            const j = await res.json()
            if (j?.error) detail = j.error
          } else {
            const txt = await res.text()
            if (txt) detail = txt.slice(0, 200)
          }
        } catch {}
        throw new Error(detail)
      }
      return res.blob()
    }

    try {
      // ── Path 1: File System Access API (Chrome/Edge) — creates a real folder ──
      if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
        let parentDir
        try {
          parentDir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' })
        } catch (e) {
          if (e.name === 'AbortError') { setDownloadingId(null); return }
          throw e
        }
        setToast({ msg: 'Saving documents to folder.', type: 'info' })
        const subDir = await parentDir.getDirectoryHandle(folderName, { create: true })

        const summary = []
        const failures = []
        for (const f of files) {
          try {
            const blob = await fetchToBlob(f.url)
            const fileHandle = await subDir.getFileHandle(f.name, { create: true })
            const writable = await fileHandle.createWritable()
            await writable.write(blob)
            await writable.close()
            summary.push(f.name.split('.')[0].replace(/_/g, ' '))
          } catch (e) {
            console.error(`${f.name} failed:`, e.message)
            failures.push(`${f.name}: ${e.message}`)
          }
        }
        // Always write a small details file with IRN/AckNo for quick reference
        // alongside the signed PDF (which is now in `files`).
        if (showEinv && c.irn) {
          try {
            const txtHandle = await subDir.getFileHandle('E-Invoice_Details.txt', { create: true })
            const w = await txtHandle.createWritable()
            await w.write(`IRN: ${c.irn}\nAck No: ${c.ack_no || ''}\nAck Date: ${c.ack_dt || ''}\n`)
            await w.close()
          } catch (e) { /* non-critical, PDF is the authoritative copy */ }
        }

        const missing = []
        if (showEwb  && !c.eway_bill_no)            missing.push('E-Way Bill not generated')
        else if (showEwb && c.eway_bill_no && !isApproved)  missing.push('E-Way Bill awaiting accounts approval')
        if (showEinv && !c.irn)                     missing.push('E-Invoice not generated')
        else if (showEinv && c.irn && !isApproved)  missing.push('E-Invoice awaiting accounts approval')
        const baseMsg = `Saved to ${folderName}: ${summary.join(', ')}`
        const allFailures = [...genFailures, ...failures]
        if (allFailures.length) {
          // Surface failures prominently — don't pretend success.
          setToast({ msg: `${baseMsg}. Failed: ${allFailures.join('; ')}.`, type: 'error' })
        } else if (missing.length) {
          setToast({ msg: `${baseMsg}. ${missing.join(', ')}.`, type: 'info' })
        } else {
          setToast({ msg: baseMsg, type: 'success' })
        }
        return
      }

      // Path 2: Fallback for Firefox/Safari — pack into a ZIP.
      setToast({ msg: 'Bundling documents into a ZIP.', type: 'info' })
      const zip = new JSZip()
      const summary = []
      const failures = []
      for (const f of files) {
        try {
          const blob = await fetchToBlob(f.url)
          zip.file(`${folderName}/${f.name}`, blob)
          summary.push(f.name.split('.')[0].replace(/_/g, ' '))
        } catch (e) { failures.push(`${f.name}: ${e.message}`) }
      }
      // Reference text file alongside the signed PDF
      if (showEinv && c.irn) {
        zip.file(`${folderName}/E-Invoice_Details.txt`,
          `IRN: ${c.irn}\nAck No: ${c.ack_no || ''}\nAck Date: ${c.ack_dt || ''}\n`)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${folderName}.zip`
      a.click()
      URL.revokeObjectURL(a.href)

      const missing = []
      if (showEwb  && !c.eway_bill_no)            missing.push('E-Way Bill not generated')
      else if (showEwb && c.eway_bill_no && !isApproved)  missing.push('E-Way Bill awaiting accounts approval')
      if (showEinv && !c.irn)                     missing.push('E-Invoice not generated')
      else if (showEinv && c.irn && !isApproved)  missing.push('E-Invoice awaiting accounts approval')
      const baseMsg = `Downloaded ${folderName}.zip: ${summary.join(', ')}`
      const allFailuresZip = [...genFailures, ...failures]
      if (allFailuresZip.length) {
        setToast({ msg: `${baseMsg}. Failed: ${allFailuresZip.join('; ')}.`, type: 'error' })
      } else if (missing.length) {
        setToast({ msg: `${baseMsg}. ${missing.join(', ')}.`, type: 'info' })
      } else {
        setToast({ msg: baseMsg, type: 'success' })
      }
    } catch (err) {
      setToast({ msg: err.message || 'Save failed', type: 'error' })
    } finally { setDownloadingId(null) }
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
    if (filterType   && c.movement_type !== filterType)   return false
    if (filterRegion) {
      const br = branches.find(b => b.name === c.branch_name)
      if (br?.region !== filterRegion) return false
    }
    if (search && !nav) {
      const q = search.toLowerCase()
      if (![c.tmp_prf_no, c.challan_no, c.branch_name, c.dest_branch].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  })

  // KPIs — exclude rejected rows since their bills are already free (not in
  // transit). The rejected count surfaces separately as its own KPI tile.
  const inFlightCons = filteredCons.filter(c => c.approval_status !== 'rejected')
  const kpiBills    = inFlightCons.reduce((s, c) => s + (c.total_bills || 0), 0)
  const kpiNetWt    = inFlightCons.reduce((s, c) => s + parseFloat(c.total_net_wt || 0), 0)
  const kpiAmount   = inFlightCons.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0)

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
              <button onClick={() => { setShowModal(true); fetchPreviewNumbers() }} style={btnGold}>
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
                  {['Date', ...(isHub ? ['Origin'] : []), 'Customer','App ID','Net Wt','Amount','Age','Type'].map(h => (
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
                      {Array.from({ length: isHub ? 9 : 8 }).map((__, j) => (
                        <td key={j} style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'block', height: '12px', width: `${30 + ((i + j) * 7) % 50}%`, borderRadius: '3px', background: `linear-gradient(90deg, ${t.border}40 0%, ${t.border}80 50%, ${t.border}40 100%)`, backgroundSize: '200% 100%', animation: 'shimmerRow 1.4s ease-in-out infinite' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : visibleBills.length === 0 ? (
                  <tr><td colSpan={isHub ? 9 : 8} style={{ padding: '48px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>No bills available at this branch</td></tr>
                ) : visibleBills.map(row => {
                  const isSel    = selected.has(row.id)
                  const days     = daysSince(row.purchase_date)
                  const fromOther = isHub && row.branch_name !== nav.branch
                  // Subtle row tint for overdue bills (>7d) — FIFO risk.
                  // Selection wins over urgency (gold tint), purple for hub
                  // transferred-in wins over both (those are mandatory anyway).
                  const isOverdue = days != null && days > 7
                  const restingBg =
                    fromOther  ? `${t.purple}06`
                    : isSel    ? `${t.gold}08`
                    : isOverdue ? `${t.red}06`
                    : 'transparent'
                  return (
                    <tr key={row.id} onClick={() => { if (!fromOther) toggleRow(row.id) }}
                      style={{
                        borderBottom: `1px solid ${t.border}15`,
                        borderLeft:   isOverdue && !fromOther && !isSel ? `3px solid ${t.red}` : '3px solid transparent',
                        background:   restingBg,
                        cursor:       fromOther ? 'not-allowed' : 'pointer',
                      }}
                      onMouseEnter={e => { if (!fromOther && !isSel && !isOverdue) e.currentTarget.style.background = `${t.gold}04` }}
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
      {/* Filters */}
      <div style={{ ...card, padding: '10px 14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search TMP PRF, Challan, Branch…"
            style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px 7px 28px', fontSize: '12px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
          <option value="">All Types</option>
          <option value="EXTERNAL">Branch → HO</option>
          <option value="INTERNAL">Branch → Hub</option>
        </select>
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: t.text2, outline: 'none' }}>
          <option value="">All Regions</option>
          {[...new Set(branches.map(b => b.region).filter(Boolean))].sort().map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {(filterType || filterRegion || search) && (
          <button onClick={() => { setFilterType(''); setFilterRegion(''); setSearch('') }} style={btnOut}>Clear</button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '11px', color: t.text4 }}>{filteredCons.length} of {consignments.length}</div>
      </div>

      {/* Table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {['TMP PRF', 'Type', 'Source → Destination', 'Bills', 'Net Wt', 'Value', 'Created', 'Document', 'E-Way Bill', 'E-Invoice', 'All'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Bills' || h === 'Net Wt' || h === 'Value' ? 'right' : 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCons.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: '64px', textAlign: 'center', color: t.text4, fontSize: '13px' }}>
                  {consignments.length === 0
                    ? 'No active consignments. Use Branch Stock → Move to create one.'
                    : 'No consignments match the filters'}
                </td></tr>
              ) : filteredCons.map(c => {
                const isType = c.movement_type === 'INTERNAL'
                const tColor = isType ? t.purple : t.orange
                const isNew  = lastConsignment?.id === c.id
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
                    style={{
                      borderBottom: `1px solid ${t.border}15`,
                      borderLeft: isRejectedRow ? `3px solid ${t.red}` : '3px solid transparent',
                      background: restingBg,
                      transition: 'background .1s',
                      verticalAlign: 'middle',
                    }}
                    onMouseEnter={e => { if (!isNew && !isRejectedRow) e.currentTarget.style.background = `${t.gold}04` }}
                    onMouseLeave={e => { if (!isNew && !isRejectedRow) e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {c.tmp_prf_no}
                      {isNew && <span style={{ marginLeft: 6, fontSize: 9, color: t.green, background: `${t.green}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>NEW</span>}
                      {c.approval_status === 'pending' && (
                        <span title="Awaiting accounts review. Operations docs (report / voucher / challan) can be downloaded; EWB and E-Invoice unlock once accounts approves and generates them."
                          style={{ marginLeft: 6, fontSize: 9, color: t.orange, background: `${t.orange}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                          IN REVIEW
                        </span>
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
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, whiteSpace: 'nowrap' }}>
                      <strong style={{ color: t.text1 }}>{c.branch_name}</strong>
                      <span style={{ color: t.text4, margin: '0 6px' }}>→</span>
                      <span>{isType ? (c.dest_branch || '?') : 'Head Office'}</span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtWt(c.total_net_wt)}</td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>₹{fmt(Math.round(c.total_amount))}</td>
                    <td style={{ padding: '11px 14px', fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{fmtTS(c.created_at)}</td>
                    {/* Document column — Report comes first (always available),
                        Voucher/Challan unlocks only after Report. The button
                        disable + tooltip mirrors the backend workflow gate so
                        ops sees the lock state instead of getting a 409 toast. */}
                    {(() => {
                      const docKind  = isType ? 'voucher' : 'challan'
                      const docLabel = isType ? 'Voucher' : 'Challan'
                      const docGate  = canActOnStep(c, docKind)
                      const reportDone = !!c.consignee_report_generated_at
                      return (
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                            <button onClick={() => downloadDoc(c, 'report')} disabled={!!downloadingId}
                              title={reportDone ? 'Re-download Consignee Report' : 'Step 1 — Consignee Report (item-wise summary)'}
                              style={{
                                background: reportDone ? 'transparent' : t.gold,
                                color: reportDone ? t.purple : (t.goldText || '#1a0a00'),
                                border: reportDone ? `1px solid ${t.purple}50` : 'none',
                                borderRadius: '5px', padding: '4px 12px', fontSize: '10px',
                                fontWeight: 600, cursor: 'pointer',
                                opacity: downloadingId === c.id + ':report' ? 0.6 : 1,
                              }}>
                              {downloadingId === c.id + ':report' ? '…' : (reportDone ? '✓ Report' : 'Report')}
                            </button>
                            <button onClick={() => docGate.allowed && downloadDoc(c, docKind)} disabled={!!downloadingId || !docGate.allowed}
                              title={docGate.allowed ? docLabel : `Locked — ${docGate.reason}`}
                              style={{
                                ...btnGold,
                                padding: '4px 12px', fontSize: '10px',
                                background: docGate.allowed ? t.gold : t.border,
                                color: docGate.allowed ? (t.goldText || '#1a0a00') : t.text4,
                                cursor: docGate.allowed ? 'pointer' : 'not-allowed',
                                opacity: !docGate.allowed ? 0.5 : 1,
                              }}>
                              {downloadingId === c.id + ':' + docKind ? '…' : (docGate.allowed ? docLabel : `🔒 ${docLabel}`)}
                            </button>
                          </div>
                        </td>
                      )
                    })()}
                    <td style={{ padding: '11px 14px' }}>
                      {!showEwb ? (
                        <span title="Interstate Hub-to-HO uses E-Invoice instead. No separate EWB needed." style={{ fontSize: '10px', color: t.text4 }}>n/a</span>
                      ) : c.eway_bill_no ? (
                        <EwbCell c={c} t={t} downloadingId={downloadingId} ewbActionId={ewbActionId} downloadEwbPdf={downloadEwbPdf} cancelEwb={cancelEwb} />
                      ) : (
                        // Generation moved to the accounts review page. Operations
                        // can no longer trigger NIC from here — the route is now
                        // gated to ROLE_GROUPS.ACCOUNTS, and clicking would
                        // produce a 403. Show a status pill that explains why.
                        <span title="Accounts will preview, confirm, and generate the E-Way Bill on NIC during their review. Operations does not trigger this step."
                          style={{ fontSize: '10px', color: t.text4, fontStyle: 'italic' }}>
                          accounts to generate
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {!showEinvoice ? (
                        <span title={isType ? 'Branch-to-Hub uses Issue Voucher only. No E-Invoice required.' : 'Intrastate Karnataka Branch-to-HO uses EWB only. No E-Invoice required.'} style={{ fontSize: '10px', color: t.text4 }}>n/a</span>
                      ) : c.irn ? (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', alignItems: 'center', whiteSpace: 'nowrap' }} title={`IRN: ${c.irn}`}>
                          <span className="irn-full" style={{ fontSize: '10px', color: t.purple, background: `${t.purple}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, fontFamily: 'monospace' }}>
                            IRN {String(c.irn).slice(0, 8)}…
                          </span>
                          <span className="irn-short" style={{ fontSize: '10px', color: t.purple, background: `${t.purple}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>
                            IRN
                          </span>
                          {c.approval_status === 'approved' ? (
                            <button onClick={async () => {
                              setDownloadingId(c.id + ':einv')
                              await triggerDownload(`/api/e-invoice/pdf?id=${c.id}`,
                                `EInvoice_${c.tmp_prf_no || c.id}.pdf`,
                                msg => setToast({ msg, type: 'error' }))
                              setDownloadingId(null)
                            }} disabled={!!downloadingId}
                              title="Download signed E-Invoice PDF with QR code"
                              style={{ background: t.purple, color: '#fff', border: 'none', borderRadius: '5px', padding: '3px 10px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', opacity: downloadingId === c.id + ':einv' ? 0.6 : 1 }}>
                              {downloadingId === c.id + ':einv' ? '…' : 'PDF'}
                            </button>
                          ) : (
                            <span title="PDF unlocks once accounts approves the consignment."
                              style={{ fontSize: '10px', color: t.text4, padding: '3px 8px', fontStyle: 'italic' }}>
                              locked
                            </span>
                          )}
                          <button onClick={() => cancelEinv(c)} disabled={!!ewbActionId}
                            title="Cancel E-Invoice (within 24h)"
                            style={{ background: 'transparent', border: `1px solid ${t.red}40`, borderRadius: '5px', padding: '3px 10px', fontSize: '10px', color: t.red, cursor: 'pointer', opacity: ewbActionId === c.id + ':einv-cancel' ? 0.6 : 1 }}>
                            {ewbActionId === c.id + ':einv-cancel' ? '…' : 'Cancel'}
                          </button>
                          <style>{`
                            .irn-short { display: none; }
                            @media (max-width: 1280px) {
                              .irn-full  { display: none; }
                              .irn-short { display: inline-block; }
                            }
                          `}</style>
                        </div>
                      ) : (
                        // Generation moved to the accounts review page (same
                        // reason as the EWB column above).
                        <span title="Accounts will preview, confirm, and generate the E-Invoice on IRP during their review. Operations does not trigger this step."
                          style={{ fontSize: '10px', color: t.text4, fontStyle: 'italic' }}>
                          accounts to generate
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', whiteSpace: 'nowrap', alignItems: 'center' }}>
                        {c.approval_status === 'pending' ? (() => {
                          // Pending: show a status pill instead of "Download all".
                          // The bundle would skip EWB / E-Invoice anyway, so a
                          // disabled pill is honest about what's blocked. Timer
                          // shows accounts how long they've kept ops waiting.
                          const wait = approvalWaiting(c.created_at, t)
                          return (
                            <span title={`Awaiting accounts approval. Voucher / Challan / Report can be downloaded individually from the Document column. EWB and E-Invoice unlock on approval.`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: `${t.orange}10`, border: `1px solid ${t.orange}40`, borderRadius: '6px', padding: '5px 12px', fontSize: '10px', color: t.orange, fontWeight: 600 }}>
                              <span>EWB &amp; E-Invoice approval pending</span>
                              <span style={{ color: wait.color, fontWeight: 700 }}>· {wait.label}</span>
                            </span>
                          )
                        })() : c.approval_status === 'rejected' ? (
                          <span title={c.rejection_reason ? `Rejected: ${c.rejection_reason}` : 'Rejected by accounts'}
                            style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '6px', padding: '5px 12px', fontSize: '10px', color: t.red, fontWeight: 600 }}>
                            Approval rejected
                          </span>
                        ) : (
                          <button onClick={() => downloadAll(c)} disabled={downloadingId === c.id + ':all'}
                            title="Download Consignee Report, Voucher or Challan, EWB, and E-Invoice in one click"
                            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '6px', padding: '5px 14px', fontSize: '10px', fontWeight: 700, cursor: downloadingId === c.id + ':all' ? 'not-allowed' : 'pointer', opacity: downloadingId === c.id + ':all' ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                            {downloadingId === c.id + ':all' ? '…' : 'Download all'}
                          </button>
                        )}
                        <button onClick={() => setActivityId(c.id)}
                          title="View full audit trail for this consignment"
                          style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '5px 12px', fontSize: '10px', color: t.text2, cursor: 'pointer' }}>
                          Activity
                        </button>
                        {c.approval_status !== 'rejected' && (
                          <button onClick={() => cancelConsignment(c)}
                            title="Void this consignment. Bills return to the source branch."
                            style={{ background: 'transparent', border: `1px solid ${t.red}40`, borderRadius: '5px', padding: '5px 12px', fontSize: '10px', color: t.red, cursor: 'pointer' }}>
                            Void
                          </button>
                        )}
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
                      <td colSpan={11} style={{ padding: '8px 14px 12px' }}>
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
                              The bills are already free — fix the data and re-create the consignment from <strong style={{ color: t.text2 }}>Branch Stock</strong>. This row will auto-hide after 7 days; full audit stays in <strong style={{ color: t.text2 }}>Activity</strong>.
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : c.approval_status !== 'approved' && (
                    <tr style={{ background: isNew ? `${t.green}06` : 'transparent' }}>
                      <td colSpan={11} style={{ padding: '4px 14px 12px', borderBottom: `1px solid ${t.border}15` }}>
                        <WorkflowStrip t={t} c={c} isType={isType} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const fmtINR = (n) => {
    if (n == null) return '—'
    const v = Number(n)
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
    return `₹${Math.round(v).toLocaleString('en-IN')}`
  }
  // Counts the rejected rows so the KPI strip flags them. Stays out of the
  // in-transit / bills / weight / value rollups because rejected consignments
  // aren't in transit — bills already returned to source.
  const rejectedCount = filteredCons.filter(c => c.approval_status === 'rejected').length
  const inTransitCount = filteredCons.length - rejectedCount

  const kpis = [
    { label: 'Consignments In Transit', value: inTransitCount,    sub: 'in flight',           color: t.orange },
    { label: 'Bills In Transit',        value: kpiBills,           sub: 'across consignments', color: t.gold   },
    { label: 'Net Weight',              value: fmtWt(kpiNetWt),    sub: '',                    color: t.blue   },
    { label: 'Total Value',             value: fmtINR(kpiAmount),  sub: '',                    color: t.green  },
  ]
  // Rejected tile only when there's something to flag — stays out of the way
  // 99% of the time, draws the eye when accounts pushed something back.
  if (rejectedCount > 0) {
    kpis.push({ label: 'Rejected — Review', value: rejectedCount, sub: 'awaiting ops re-create', color: t.red })
  }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>
            {nav?.branch ? 'Create Consignment' : 'Consignment Data'}
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            {nav?.branch
              ? `Select bills to dispatch from ${nav.branch}`
              : `${consignments.length} active consignment${consignments.length !== 1 ? 's' : ''} · branch movements in flight`}
          </div>
        </div>
        <button onClick={fetchAll} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* KPIs (only on list view) */}
      {!nav && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '1px', background: t.border, borderRadius: '11px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
          {kpis.map(k => (
            <div key={k.label} style={{ background: t.card, padding: '15px 18px' }}>
              <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '7px', fontWeight: 600 }}>{k.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 300, color: k.color, lineHeight: 1, fontFamily: 'monospace' }}>{k.value}</div>
              {k.sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '5px' }}>{k.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
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
      {showModal && typeof document !== 'undefined' && createPortal((
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}>
          <div style={{
            background: t.card,
            border: `1px solid ${t.border2}`,
            borderRadius: '18px',
            width: '560px', maxWidth: '100%',
            boxShadow: '0 28px 80px rgba(0,0,0,.55)',
            maxHeight: 'calc(100vh - 40px)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>

            {/* ── Hero header ──────────────────────────────────────────── */}
            <div style={{
              padding: '20px 26px 18px',
              borderBottom: `1px solid ${t.border}`,
              background: `linear-gradient(160deg, ${t.gold}12 0%, transparent 100%)`,
              flexShrink: 0,
            }}>
              <div style={{ fontSize: '9px', color: t.gold, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700 }}>Create Consignment</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: t.text1, marginTop: '4px', letterSpacing: '-.01em' }}>Confirm before dispatch</div>
              <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>
                Once you create, bills are locked to this consignment until accounts approves or it's voided.
              </div>
            </div>

            {/* ── Body (scrollable) ────────────────────────────────────── */}
            <div style={{ padding: '20px 26px', overflowY: 'auto', flex: 1, minHeight: 0 }}>

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
              const isExternal = moveType === 'EXTERNAL'
              const dest        = isExternal ? 'Head Office' : (destBranch || '— select hub —')
              const destRegion  = isExternal ? 'Bangalore (KA)' : (branches.find(b => b.name === destBranch)?.region || '')

              return (
                <>
                  {/* Movement type — segmented control with semantic labels */}
                  <div style={{ marginBottom: '18px' }}>
                    <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>Movement type</div>
                    <div style={{ display: 'flex', gap: '6px', padding: '4px', background: t.card2, borderRadius: '10px' }}>
                      <button type="button" onClick={() => setMoveType('EXTERNAL')}
                        style={{
                          flex: 1, padding: '11px 10px', border: 'none', borderRadius: '7px',
                          cursor: 'pointer',
                          background: isExternal ? t.card : 'transparent',
                          color: isExternal ? t.gold : t.text3,
                          fontWeight: isExternal ? 700 : 500,
                          fontSize: '12px', letterSpacing: '.02em',
                          boxShadow: isExternal ? '0 1px 4px rgba(0,0,0,.25)' : 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                          transition: 'all .15s',
                        }}>
                        <span style={{ fontSize: '14px' }}>📤</span>
                        Branch → HO
                      </button>
                      <button type="button" onClick={() => setMoveType('INTERNAL')} disabled={candidateHubs.length === 0}
                        title={candidateHubs.length === 0 ? `No other branches in ${srcState || srcRegion || 'this state'}` : ''}
                        style={{
                          flex: 1, padding: '11px 10px', border: 'none', borderRadius: '7px',
                          cursor: candidateHubs.length === 0 ? 'not-allowed' : 'pointer',
                          opacity: candidateHubs.length === 0 ? 0.4 : 1,
                          background: !isExternal ? t.card : 'transparent',
                          color: !isExternal ? t.purple : t.text3,
                          fontWeight: !isExternal ? 700 : 500,
                          fontSize: '12px', letterSpacing: '.02em',
                          boxShadow: !isExternal ? '0 1px 4px rgba(0,0,0,.25)' : 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                          transition: 'all .15s',
                        }}>
                        <span style={{ fontSize: '14px' }}>🔁</span>
                        Branch → Hub
                      </button>
                    </div>
                  </div>

                  {/* Hub picker — only when Branch → Hub */}
                  {!isExternal && (
                    <div style={{ marginBottom: '18px', position: 'relative' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Destination hub</div>
                      <input
                        value={destBranch && !destOpen ? destBranch : destSearch}
                        onFocus={() => { setDestOpen(true); setDestSearch('') }}
                        onChange={e => { setDestSearch(e.target.value); setDestBranch(''); setDestOpen(true) }}
                        placeholder={`Type to search any branch in ${srcRegionLabel || 'state'}…`}
                        style={{
                          width: '100%',
                          background: t.card2,
                          border: `1px solid ${destBranch ? t.purple + '60' : t.border2}`,
                          borderRadius: '9px', padding: '11px 14px',
                          fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box',
                        }} />
                      {destOpen && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: t.card, border: `1px solid ${t.border2}`, borderRadius: '9px', maxHeight: '240px', overflowY: 'auto', zIndex: 10, boxShadow: '0 12px 36px rgba(0,0,0,.45)' }}>
                          {filteredHubs.length === 0 ? (
                            <div style={{ padding: '14px', fontSize: '12px', color: t.text4, textAlign: 'center' }}>No branches match</div>
                          ) : filteredHubs.map(b => (
                            <div key={b.id}
                              onClick={() => { setDestBranch(b.name); setDestSearch(''); setDestOpen(false) }}
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
                  )}

                  {/* Source ──→ Destination flow card */}
                  <div style={{
                    background: t.card2,
                    border: `1px solid ${t.border}`,
                    borderRadius: '12px',
                    padding: '14px 16px',
                    marginBottom: '14px',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    gap: '12px',
                    alignItems: 'center',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>From</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: t.gold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nav?.branch || '—'}</div>
                      {srcRegionLabel && <div style={{ fontSize: '10px', color: t.text3, marginTop: '2px' }}>{srcRegionLabel}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <div style={{ fontSize: '20px', color: isExternal ? t.gold : t.purple, lineHeight: 1 }}>→</div>
                    </div>
                    <div style={{ minWidth: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>To</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: isExternal ? t.gold : t.purple, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dest}</div>
                      {destRegion && <div style={{ fontSize: '10px', color: t.text3, marginTop: '2px' }}>{destRegion}</div>}
                    </div>
                  </div>

                  {/* Stats row — bills · net weight · total value */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
                    <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>Bills</div>
                      <div style={{ fontSize: '20px', color: t.text1, fontFamily: 'monospace', fontWeight: 600, lineHeight: 1 }}>{selected.size}</div>
                    </div>
                    <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>Net Weight</div>
                      <div style={{ fontSize: '15px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1.1 }}>{fmtWt(totalSelWt)}</div>
                    </div>
                    <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>Value</div>
                      <div style={{ fontSize: '15px', color: t.blue, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1.1 }}>₹{fmt(Math.round(totalSelAmt))}</div>
                    </div>
                  </div>

                  {/* Document chip */}
                  <div style={{
                    background: t.card2,
                    border: `1px solid ${t.border}`,
                    borderRadius: '10px',
                    padding: '12px 14px',
                    marginBottom: '14px',
                    display: 'flex', alignItems: 'center', gap: '12px',
                  }}>
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '8px',
                      background: isExternal ? `${t.gold}18` : `${t.purple}18`,
                      color: isExternal ? t.gold : t.purple,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '16px', flexShrink: 0,
                    }}>📄</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Document</div>
                      <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600, marginTop: '2px' }}>
                        {isExternal ? 'Delivery Challan' : 'Issue Voucher'}
                      </div>
                    </div>
                  </div>

                  {/* E-Way Bill input — Branch → HO only */}
                  {isExternal && (
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>
                        E-Way Bill No <span style={{ textTransform: 'none', fontWeight: 400, color: t.text4 }}>(optional — accounts will generate after approval)</span>
                      </div>
                      <input value={ewayBillNo} onChange={e => setEwayBillNo(e.target.value)} placeholder="Leave blank — accounts generates from preview"
                        style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '9px', padding: '11px 14px', fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  )}
                </>
              )
            })()}

            {loadingPreview ? (
              <div style={{ fontSize: '11px', color: t.text4, marginBottom: '4px', padding: '11px 14px', background: `${t.gold}08`, borderRadius: '9px', border: `1px solid ${t.gold}20`, textAlign: 'center' }}>Generating preview numbers…</div>
            ) : previewNumbers && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1, padding: '11px 14px', background: `${t.gold}10`, borderRadius: '9px', border: `1px solid ${t.gold}30` }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '3px', fontWeight: 700 }}>TMP PRF No</div>
                  <div style={{ fontSize: '14px', color: t.gold, fontWeight: 700, fontFamily: 'monospace' }}>{previewNumbers.tmp_prf_no}</div>
                </div>
                <div style={{ flex: 1, padding: '11px 14px', background: `${t.blue}10`, borderRadius: '9px', border: `1px solid ${t.blue}30`, minWidth: 0 }}>
                  <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '3px', fontWeight: 700 }}>{moveType === 'INTERNAL' ? 'Voucher No' : 'Challan No'}</div>
                  <div style={{ fontSize: '11px', color: t.blue, fontWeight: 600, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewNumbers.challan_no}</div>
                </div>
              </div>
            )}
            </div>

            {/* ── Footer (sticky to modal bottom) ──────────────────────── */}
            <div style={{
              padding: '14px 26px',
              borderTop: `1px solid ${t.border}`,
              background: t.card,
              display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: '10px', color: t.text4, marginRight: 'auto' }}>
                You'll be asked to confirm once more before creation.
              </span>
              <button onClick={() => setShowModal(false)} style={btnOut}>Cancel</button>
              <button onClick={handleCreate} disabled={creating}
                style={{ ...btnGold, padding: '10px 22px', fontSize: '13px', opacity: creating ? .7 : 1 }}>
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
