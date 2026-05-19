'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import { supabase as supabaseClient } from '../../lib/supabase'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { openConfirm, openPrompt } from '../ui/ConfirmDialog'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { WorkflowStrip, DocAuditPanel } from './workflowParts'
import { istToday, istDaysAgo } from '../../lib/dateIst'

const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtTS = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// Deterministic avatar background colour from an email — same email always
// hashes to the same colour. 8-bucket palette pulled from the theme so
// avatars feel native everywhere they appear (Efficiency table, Approved
// cards, future tabs). Returns a single colour token from the theme.
function hashAvatarColor(email, t) {
  const palette = [t.gold, t.green, t.purple, t.blue, t.orange, t.red, '#5ec1d6', '#9275d5']
  let h = 0
  for (let i = 0; i < (email || '').length; i++) h = (h * 31 + email.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

// 24h cancel window status for an EWB / E-Invoice. Returns the time left
// until NIC / IRP locks the doc (cancellation is rejected after 24h),
// colour-coded by urgency.
//   > 12h         → green   "18h 24m left"
//   6–12h         → gold    "8h 02m left"
//   1–6h          → orange  "3h 15m left"
//   < 1h          → red     "45m left"
//   past 24h      → text4   "Window closed", expired=true
//   no timestamp  → null    (caller should hide chip + button)
function cancelWindow(generatedAt, t) {
  if (!generatedAt) return null
  const elapsed   = Date.now() - new Date(generatedAt).getTime()
  const remaining = 24 * 60 * 60 * 1000 - elapsed
  if (remaining <= 0) {
    return { expired: true, label: 'Cancel window closed', color: t.text4, bg: `${t.text4}15` }
  }
  const totalMins = Math.floor(remaining / 60000)
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  const label = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m left` : `${m}m left`
  const color = h >= 12 ? t.green
              : h >=  6 ? t.gold
              : h >=  1 ? t.orange
              :           t.red
  return { expired: false, label, color, bg: `${color}15`, hours: h, minutes: m }
}

// Returns { label, color } for waiting time, color-coded by urgency.
function waitingBadge(ts, t) {
  if (!ts) return { label: '—', color: t.text4, bg: 'transparent' }
  const ms = Date.now() - new Date(ts).getTime()
  if (ms < 0) return { label: 'just now', color: t.green, bg: `${t.green}15` }
  const mins = Math.floor(ms / 60000)
  let label
  if (mins < 1)        label = 'just now'
  else if (mins < 60)  label = `${mins}m`
  else if (mins < 1440) {
    const h = Math.floor(mins / 60); const m = mins % 60
    label = `${h}h ${m}m`
  } else {
    const d = Math.floor(mins / 1440); const h = Math.floor((mins % 1440) / 60)
    label = `${d}d ${h}h`
  }
  // Urgency colour ramp
  const color = mins < 60   ? t.green
              : mins < 240  ? t.gold
              : mins < 1440 ? t.orange
              : t.red
  return { label, color, bg: `${color}18` }
}

// Lazy-create one shared AudioContext for the lifetime of the page. Browsers
// cap concurrent live AudioContexts; new'ing one per beep leaks them when
// approvals arrive in bursts. We resume() before each beep so autoplay-block
// recovers automatically once the user has interacted with the page.
let _sharedAudioCtx = null
function getAudioContext() {
  if (typeof window === 'undefined') return null
  if (!_sharedAudioCtx) {
    try { _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)() }
    catch { return null }
  }
  return _sharedAudioCtx
}

function playApprovalBeep() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  try {
    const beep = (freq, start, dur, gain = 0.15) => {
      const osc = ctx.createOscillator()
      const g   = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      g.gain.setValueAtTime(0, ctx.currentTime + start)
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.connect(g); g.connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur + 0.05)
    }
    beep(880, 0,    0.18)
    beep(1320, 0.18, 0.22)
  } catch {}
}

function fireDesktopNotification(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body, icon: '/logo.png', badge: '/logo.png',
      tag: 'consignment-approval', requireInteraction: false,
    })
    n.onclick = () => { window.focus(); n.close() }
    setTimeout(() => n.close(), 8000)
  } catch {}
}

const SOUND_PREF_KEY = 'wg-approval-sound-enabled'
function readSoundPref() {
  if (typeof window === 'undefined') return true
  try { const v = localStorage.getItem(SOUND_PREF_KEY); return v == null ? true : v === '1' } catch { return true }
}
function writeSoundPref(v) {
  try { localStorage.setItem(SOUND_PREF_KEY, v ? '1' : '0') } catch {}
}

async function previewDoc(url, filename, onError) {
  const sep = url.includes('?') ? '&' : '?'
  // Auth header required — server-side approvalGate verifies the role from the
  // bearer token before honouring `?preview=accounts`. Without auth the request
  // is rejected as 401 even if approval_status is pending.
  const res = await authedFetch(`${url}${sep}preview=accounts`)
  if (!res.ok) {
    let msg = `Preview failed: ${res.status}`
    try { const j = await res.json(); if (j.error) msg = j.error } catch {}
    onError?.(msg); return
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function ConsignmentApprovals() {
  const { theme, user, userProfile } = useApp()
  const t = THEMES[theme]
  const userEmail = user?.email || userProfile?.email || null

  // Tab state. 'pending' is the live queue (with realtime + sound + alerts).
  // 'approved' and 'rejected' are read-only audit trails — all time.
  const [tab, setTab] = useState('pending')

  const [pending, setPending] = useState([])
  const [history, setHistory] = useState([])  // approved or rejected, depending on tab
  const [cancellations, setCancellations] = useState([])  // ewb_cancelled / einvoice_cancelled events
  const [cancelRequests, setCancelRequests] = useState([])  // pending cancellation requests from ops
  // Modal state for the reject-cancellation flow (reason input).
  const [rejectCancelTarget,    setRejectCancelTarget]    = useState(null)
  const [rejectCancelReason,    setRejectCancelReason]    = useState('')
  const [rejectCancelBusy,      setRejectCancelBusy]      = useState(false)
  const [approveCancelBusy,     setApproveCancelBusy]     = useState(null) // consignment id mid-approval
  const [report,        setReport]        = useState({ ewbs: [], einvoices: [] })
  const [reportFrom,    setReportFrom]    = useState(() => istToday())
  const [reportTo,      setReportTo]      = useState(() => istToday())
  // Approved tab filters — accounts review tool. Default: all-time, all doc
  // types. Client-side because volume is moderate and the underlying fetch
  // already returns the full history sorted by approved_at desc.
  const [approvedFrom,  setApprovedFrom]  = useState('')      // YYYY-MM-DD, '' = no floor
  const [approvedTo,    setApprovedTo]    = useState('')      // YYYY-MM-DD, '' = no ceiling
  const [approvedDoc,   setApprovedDoc]   = useState('all')   // 'all' | 'ewb' | 'einv'
  const [efficiency,    setEfficiency]    = useState({ users: [] })
  const [effFrom,       setEffFrom]       = useState(() => istDaysAgo(6))
  const [effTo,         setEffTo]         = useState(() => istToday())
  const [settings,      setSettings]      = useState(null)
  const [settingsBusy,  setSettingsBusy]  = useState(null)  // 'seq:KL' | 'gstin:KA' etc.
  const [settingsToast, setSettingsToast] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  // Preview-before-generate modal state. The modal shows the exact payload that
  // would be sent to NIC/IRP so accounts can verify addresses + values match
  // the challan/voucher BEFORE clicking Confirm. Catches "wrong doc" issues
  // before they become "wrong doc on NIC's books".
  const [preview, setPreview] = useState(null)
  // { type: 'ewb'|'irn', consignment, loading, data, generating, error }

  // Cancel modal state for active EWBs/IRNs. Calls our cancel API which talks
  // to NIC. If NIC says past-24h-window, falls back to credit-note flow (IRN only).
  const [cancelModal, setCancelModal] = useState(null)
  // { type: 'ewb'|'irn', consignment, reasonCode, remark, busy, error, suggestCreditNote }

  const [toast, setToast] = useState(null)
  // Diagnostic state for the Cancellations tab — populated by the "Run
  // diagnostic" button on the empty state so we can see exactly what the
  // server returns when the tab looks blank.
  const [cancelDiag, setCancelDiag] = useState(null)
  const [notifPermission, setNotifPermission] = useState(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported')
  const [soundEnabled, setSoundEnabled] = useState(true)
  useEffect(() => { setSoundEnabled(readSoundPref()) }, [])
  const [, forceTick] = useState(0)
  const knownIds = useRef(new Set())
  // Burst-debounce arriving approvals so 10 simultaneous inserts yield ONE
  // notification + ONE beep (not 10 of each). Buffer holds row summaries.
  const arrivalBuffer = useRef([])
  const arrivalTimer  = useRef(null)

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type, key: Date.now() })
  }, [])

  const fetchPending = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const r = await authedFetch('/api/consignments?action=pending_approvals')
    const j = await r.json()
    const rows = j.data || []
    setPending(rows)
    // Merge IDs (don't replace) so realtime arrivals between request and response
    // aren't clobbered.
    rows.forEach(c => knownIds.current.add(c.id))
    setLoading(false)
  }, [])

  // Fetches the audit trail for the active history tab. Backed by
  // /api/consignments?action=approval_history&status=approved|rejected.
  const fetchHistory = useCallback(async (status, silent = false) => {
    if (!silent) setLoading(true)
    const r = await authedFetch(`/api/consignments?action=approval_history&status=${status}`)
    const j = await r.json()
    setHistory(j.data || [])
    setLoading(false)
  }, [])

  // Fetches the cancellation log: every EWB / E-Invoice cancellation in the last 30d.
  const fetchCancellations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const r = await authedFetch(`/api/consignments?action=cancellation_history`)
    const j = await r.json()
    setCancellations(j.data || [])
    setLoading(false)
  }, [])

  // Fetches pending cancellation requests filed by operations. Oldest first so
  // accounts works through them FIFO (matches the API ordering).
  const fetchCancelRequests = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const r = await authedFetch(`/api/consignments?action=cancellation_requests`)
    const j = await r.json()
    setCancelRequests(j.data || [])
    setLoading(false)
  }, [])

  // Reports: every EWB + E-Invoice generated in the [from..to] window.
  const fetchReport = useCallback(async (from, to, silent = false) => {
    if (!silent) setLoading(true)
    const r = await authedFetch(`/api/consignments?action=docs_generated_report&from=${from}&to=${to}`)
    const j = await r.json()
    setReport({ ewbs: j.ewbs || [], einvoices: j.einvoices || [] })
    setLoading(false)
  }, [])

  // Settings: per-state E-Invoice sequence + state GSTINs.
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const r = await authedFetch('/api/admin/einvoice-settings')
    const j = await r.json()
    setSettings(j)
    setLoading(false)
  }, [])

  // Efficiency: per-user accounts performance over a date window.
  const fetchEfficiency = useCallback(async (from, to, silent = false) => {
    if (!silent) setLoading(true)
    const r = await authedFetch(`/api/consignments?action=user_efficiency&from=${from}&to=${to}`)
    const j = await r.json()
    setEfficiency({ users: j.users || [] })
    setLoading(false)
  }, [])

  // Initial fetch + refetch when the user switches tabs.
  useEffect(() => {
    if (tab === 'pending')                 fetchPending()
    else if (tab === 'cancel_requests')    fetchCancelRequests()
    else if (tab === 'cancellations')      fetchCancellations()
    else if (tab === 'reports')            fetchReport(reportFrom, reportTo)
    else if (tab === 'efficiency')         fetchEfficiency(effFrom, effTo)
    else if (tab === 'settings')           fetchSettings()
    else                                   fetchHistory(tab)
  }, [tab, fetchPending, fetchHistory, fetchCancelRequests, fetchCancellations, fetchReport, fetchEfficiency, fetchSettings, reportFrom, reportTo, effFrom, effTo])

  // Save a single E-Invoice sequence row (state + last_seq).
  const saveSeq = useCallback(async (state_code, fy_code, last_seq) => {
    setSettingsBusy(`seq:${state_code}`)
    try {
      const r = await authedFetch('/api/admin/einvoice-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'seq', state_code, fy_code, last_seq: Number(last_seq) }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setSettingsToast({ type: 'error', msg: j.error || 'Save failed' }); return }
      setSettingsToast({ type: 'success', msg: `${state_code}: next will be ${j.next_no}` })
      await fetchSettings(true)
    } finally {
      setSettingsBusy(null)
      setTimeout(() => setSettingsToast(null), 4000)
    }
  }, [fetchSettings])

  // Save a single state GSTIN.
  const saveGstin = useCallback(async (state_code, gstin) => {
    setSettingsBusy(`gstin:${state_code}`)
    try {
      const r = await authedFetch('/api/admin/einvoice-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'gstin', state_code, gstin }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setSettingsToast({ type: 'error', msg: j.error || 'Save failed' }); return }
      setSettingsToast({ type: 'success', msg: `${state_code} GSTIN updated` })
      await fetchSettings(true)
    } finally {
      setSettingsBusy(null)
      setTimeout(() => setSettingsToast(null), 4000)
    }
  }, [fetchSettings])

  // Add a new state — GSTIN + opening invoice sequence number.
  const addState = useCallback(async (state_code, gstin, last_seq) => {
    setSettingsBusy(`add:${state_code}`)
    try {
      const r = await authedFetch('/api/admin/einvoice-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'gstin_add', state_code, gstin, last_seq: Number(last_seq) || 0 }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setSettingsToast({ type: 'error', msg: j.error || 'Add failed' }); return false }
      setSettingsToast({ type: 'success', msg: `${state_code} added — next invoice will be ${j.sequence?.next_no || '—'}` })
      await fetchSettings(true)
      return true
    } finally {
      setSettingsBusy(null)
      setTimeout(() => setSettingsToast(null), 4000)
    }
  }, [fetchSettings])

  // Remove a state — wipes GSTIN + every sequence row for that state.
  const removeState = useCallback(async (state_code) => {
    setSettingsBusy(`remove:${state_code}`)
    try {
      const r = await authedFetch('/api/admin/einvoice-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'gstin_remove', state_code }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setSettingsToast({ type: 'error', msg: j.error || 'Remove failed' }); return }
      setSettingsToast({ type: 'success', msg: `${state_code} removed` })
      await fetchSettings(true)
    } finally {
      setSettingsBusy(null)
      setTimeout(() => setSettingsToast(null), 4000)
    }
  }, [fetchSettings])

  // Re-render every 30s so the urgency badge stays current
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 30000)
    return () => clearInterval(id)
  }, [])

  // Flushes the arrival buffer 1.2s after the last arrival so a burst of 10 inserts
  // becomes one notification + one beep, not ten of each.
  const flushArrivals = useCallback(() => {
    const items = arrivalBuffer.current
    arrivalBuffer.current = []
    arrivalTimer.current = null
    if (!items.length) return
    if (items.length === 1) {
      const r = items[0]
      fireDesktopNotification('Consignment awaiting approval',
        `${r.tmp_prf_no || ''}: ${r.branch_name} to ${r.dest_branch || 'Head Office'}. ${r.total_bills || 0} bills, ${Number(r.total_net_wt || 0).toFixed(3)}g.`)
    } else {
      fireDesktopNotification(`${items.length} consignments awaiting approval`,
        items.slice(0, 3).map(r => `${r.tmp_prf_no || ''} (${r.branch_name})`).join(', ') + (items.length > 3 ? '…' : ''))
    }
    if (readSoundPref()) playApprovalBeep()
  }, [])

  const queueArrival = useCallback((row) => {
    arrivalBuffer.current.push(row)
    if (arrivalTimer.current) clearTimeout(arrivalTimer.current)
    arrivalTimer.current = setTimeout(flushArrivals, 1200)
  }, [flushArrivals])

  // Realtime: instant arrival/dismissal. Always refetch enriched rows from the
  // API instead of trusting payload.new — joined fields like total_bills and
  // total_net_wt aren't present on the raw row.
  useEffect(() => {
    const channel = supabaseClient
      .channel('consignment-approvals')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'consignments', filter: 'approval_status=eq.pending' },
        (payload) => {
          const row = payload.new
          if (!row || knownIds.current.has(row.id)) return
          knownIds.current.add(row.id)
          // Optimistically insert the raw row so the list reflects the change instantly,
          // then refetch to fill in the joined fields. Queue arrival for debounced notify.
          setPending(prev => [row, ...prev])
          queueArrival(row)
          fetchPending(true)
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consignments' },
        (payload) => {
          const row = payload.new
          if (!row) return
          if (row.approval_status !== 'pending') {
            knownIds.current.delete(row.id)
            setPending(prev => prev.filter(c => c.id !== row.id))
          } else if (!knownIds.current.has(row.id)) {
            knownIds.current.add(row.id)
            setPending(prev => [row, ...prev])
            queueArrival(row)
            fetchPending(true)
          } else {
            // Existing row mutated (e.g. EWB/IRN written) — refetch so joined
            // fields stay in sync; no notification, no beep.
            fetchPending(true)
          }
        })
      .subscribe()
    return () => {
      supabaseClient.removeChannel(channel)
      if (arrivalTimer.current) { clearTimeout(arrivalTimer.current); arrivalTimer.current = null }
    }
  }, [queueArrival, fetchPending])

  function toggleSound() {
    const next = !soundEnabled
    setSoundEnabled(next)
    writeSoundPref(next)
    if (next) playApprovalBeep()  // give immediate audible feedback that sound is on
  }

  // Open the preview modal — shows exactly what would be sent to NIC/IRP.
  // No NIC call yet; this just fetches our local payload constructor. Accounts
  // verifies the addresses, weight, value match the challan/voucher BEFORE
  // clicking Confirm & Generate inside the modal.
  async function openPreview(c, type) {
    const path = type === 'ewb' ? '/api/eway-bill/preview' : '/api/e-invoice/preview'
    setPreview({ type, consignment: c, loading: true, data: null, audit: null, generating: false, error: null })
    // Race guard: if the user opens a different preview while this fetch is in flight,
    // we must not overwrite their newer preview state with our stale response.
    const isStillCurrent = (p) => p && p.type === type && p.consignment?.id === c.id
    try {
      // Fetch preview + cross-doc audit in parallel. The audit catches any
      // builder drift between EWB / E-Invoice / Challan / Voucher / Consignee
      // Report so accounts sees mismatches BEFORE clicking Generate.
      const [previewRes, auditRes] = await Promise.all([
        authedFetch(`${path}?id=${c.id}`),
        authedFetch(`/api/consignments/document-audit?id=${c.id}`),
      ])
      const previewJson = await previewRes.json()
      const auditJson   = await auditRes.json().catch(() => null)
      setPreview(p => {
        if (!isStillCurrent(p)) return p
        if (!previewRes.ok || previewJson.error) {
          return { ...p, loading: false, error: previewJson.error || 'Preview failed' }
        }
        return { ...p, loading: false, data: previewJson, audit: auditRes.ok ? auditJson : null }
      })
    } catch (e) {
      setPreview(p => {
        if (!isStillCurrent(p)) return p
        return { ...p, loading: false, error: e.message }
      })
    }
  }

  // After accounts reviews the preview, this fires the actual generation.
  // This is the ONLY function that hits NIC — gated by an explicit click.
  async function confirmGenerate() {
    if (!preview) return
    const { type, consignment: c } = preview
    const path = type === 'ewb' ? '/api/eway-bill/generate' : '/api/e-invoice/generate'
    setPreview(p => p ? { ...p, generating: true, error: null } : null)
    try {
      const r = await authedFetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        setPreview(p => p ? { ...p, generating: false, error: j.error || 'Generation failed' } : null)
        return
      }
      const successMsg = type === 'ewb' ? `E-Way Bill ${j.ewb_no} generated.` : 'E-Invoice generated.'
      showToast(successMsg, 'success')
      setPreview(null)
      fetchPending(true)
    } catch (e) {
      setPreview(p => p ? { ...p, generating: false, error: e.message } : null)
    }
  }

  // Bill confirmation now happens automatically at consignment creation —
  // the create flow already gates with two confirms (review modal + 'Yes,
  // create now' dialog). No standalone confirm step in this view either.

  // Open the cancel modal for an existing EWB / IRN.
  function openCancel(c, type) {
    setCancelModal({
      type, consignment: c,
      reasonCode: '2',  // 2 = Data Entry Mistake (most common reason for our cancellations)
      remark: '',
      busy: false, error: null, suggestCreditNote: false,
    })
  }

  // Fires the actual cancel call to NIC/IRP via our cancel API.
  async function confirmCancel() {
    if (!cancelModal) return
    const { type, consignment: c, reasonCode, remark } = cancelModal
    const path = type === 'ewb' ? '/api/eway-bill/cancel' : '/api/e-invoice/cancel'
    setCancelModal(m => m ? { ...m, busy: true, error: null } : null)
    try {
      const r = await authedFetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id, reason_code: reasonCode, remark }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        // Detect 24h-past errors so we can offer the credit-note alternative (IRN only).
        // NIC error phrasings vary across EWB and IRP responses — match permissively but require an explicit signal.
        const msg = (j.error || '').toLowerCase()
        const matchesWindow = msg.includes('24 hr')
          || msg.includes('24 hour')
          || msg.includes('24hour')
          || msg.includes('24 hrs')
          || msg.includes('time limit')
          || msg.includes('time has elapsed')
          || msg.includes('time exceeded')
          || msg.includes('time expired')
          || msg.includes('past time')
          || msg.includes('cancel window')
          || msg.includes('cancellation window')
          || msg.includes('cancellation period')
          || msg.includes('beyond cancel')
          || msg.includes('not allowed') && msg.includes('cancel')
        const isPast24h = type === 'irn' && matchesWindow
        const isEwbPast24h = type === 'ewb' && matchesWindow
        setCancelModal(m => m ? {
          ...m,
          busy: false,
          error: j.error || 'Cancel failed',
          suggestCreditNote: isPast24h,
          ewbPast24h: isEwbPast24h,
        } : null)
        return
      }
      showToast(`${type === 'ewb' ? 'E-Way Bill' : 'E-Invoice'} cancelled.`, 'success')
      setCancelModal(null)
      // Refresh whichever tab is active. Cancel auto-rejects the consignment,
      // so the row leaves the current view (Pending or Approved) and lands in
      // Rejected. Also refresh the Cancellations log on its tab.
      if (tab === 'pending') fetchPending(true)
      else if (tab === 'cancellations') fetchCancellations(true)
      else fetchHistory(tab, true)
    } catch (e) {
      setCancelModal(m => m ? { ...m, busy: false, error: e.message } : null)
    }
  }

  // Generate a credit note IRN for an E-Invoice that's past the 24h cancel window.
  // The credit note offsets the original IRN in GSTR-1 — it's the GST-compliant
  // way to nullify a wrongly-issued invoice when cancellation is no longer allowed.
  async function generateCreditNote() {
    if (!cancelModal || cancelModal.type !== 'irn') return
    const c = cancelModal.consignment
    setCancelModal(m => m ? { ...m, busy: true, error: null } : null)
    try {
      const r = await authedFetch('/api/e-invoice/credit-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id, remark: cancelModal.remark || 'Reversal — wrong invoice issued' }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        setCancelModal(m => m ? { ...m, busy: false, error: j.error || 'Credit Note generation failed' } : null)
        return
      }
      showToast(`Credit Note ${j.irn} generated. Original IRN remains on NIC books — both will appear in GSTR-1.`, 'success')
      setCancelModal(null)
      fetchPending(true)
    } catch (e) {
      setCancelModal(m => m ? { ...m, busy: false, error: e.message } : null)
    }
  }

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      showToast('Desktop notifications not supported by this browser', 'error'); return
    }
    const perm = await Notification.requestPermission()
    setNotifPermission(perm)
    if (perm === 'granted') {
      showToast('Notifications enabled', 'success')
      fireDesktopNotification('Notifications enabled', 'You will be notified when a new consignment needs approval.')
    }
  }

  async function approve(c) {
    const ok = await openConfirm({
      title: `Approve ${c.tmp_prf_no}?`,
      message: `${c.branch_name} to ${c.dest_branch || 'Head Office'}\n${c.total_bills || 0} bills, ${Number(c.total_net_wt || 0).toFixed(3)}g, ₹${fmt(Math.round(c.total_amount || 0))}.\n\nOps will be able to download all documents once approved.`,
      confirmLabel: 'Approve',
      primaryColor: 'green',
    })
    if (!ok) return
    setActionId(c.id + ':approve')
    try {
      const r = await authedFetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_consignment', id: c.id, approver_email: userEmail }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'Approval failed', 'error'); return }
      showToast(`${c.tmp_prf_no} approved`, 'success')
    } finally { setActionId(null) }
  }

  async function reject(c) {
    const reason = await openPrompt({
      title: `Reject ${c.tmp_prf_no}?`,
      message: `${c.branch_name} to ${c.dest_branch || 'Head Office'}.\n\nEnter a reason. The operator will see this when they reopen the consignment.`,
      placeholder: 'e.g. Destination branch is wrong, value differs from EWB, KYC missing.',
      minLength: 8,
      maxLength: 280,
      rows: 3,
      confirmLabel: 'Reject',
      danger: true,
    })
    if (!reason) return
    setActionId(c.id + ':reject')
    try {
      const r = await authedFetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject_approval', id: c.id, approver_email: userEmail, reason }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'Rejection failed', 'error'); return }
      showToast(`${c.tmp_prf_no} rejected`, 'warning')
    } finally { setActionId(null) }
  }

  // ── Aggregates for the summary header ──
  const totalBills    = pending.reduce((s, c) => s + (c.total_bills || 0), 0)
  const totalNetWt    = pending.reduce((s, c) => s + parseFloat(c.total_net_wt || 0), 0)
  const totalValue    = pending.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0)
  const oldestWaiting = pending.reduce((min, c) => {
    if (!c.created_at) return min
    const ms = Date.now() - new Date(c.created_at).getTime()
    return ms > min ? ms : min
  }, 0)
  const oldestBadge = pending.length > 0
    ? waitingBadge(new Date(Date.now() - oldestWaiting).toISOString(), t)
    : null

  if (loading) return <div style={{ padding: '60px', textAlign: 'center' }}><GoldSpinner /></div>

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '1400px', margin: '0 auto' }}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header — title + inline stats + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>
            Approvals
          </div>
          {tab === 'pending' && (
            <div style={{ fontSize: '11px', color: t.text3, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: t.green }} />
              Live
            </div>
          )}
          {tab === 'pending' && pending.length > 0 && (
            <div style={{ fontSize: '11px', color: t.text3, display: 'flex', gap: '12px', alignItems: 'baseline' }}>
              <span><strong style={{ color: t.orange, fontSize: '13px' }}>{pending.length}</strong> waiting</span>
              <span><strong style={{ color: t.gold }}>{totalBills}</strong> bills</span>
              <span><strong style={{ color: t.blue, fontFamily: 'monospace' }}>{fmtWt(totalNetWt)}</strong></span>
              <span><strong style={{ color: t.green }}>₹{fmt(Math.round(totalValue))}</strong></span>
            </div>
          )}
          {(tab === 'approved' || tab === 'rejected') && (
            <div style={{ fontSize: '11px', color: t.text3 }}>
              <strong style={{ color: t.text2 }}>{history.length}</strong> {tab} · all time
            </div>
          )}
          {tab === 'cancellations' && (
            <div style={{ fontSize: '11px', color: t.text3 }}>
              <strong style={{ color: t.text2 }}>{cancellations.length}</strong> doc cancellation{cancellations.length === 1 ? '' : 's'} · all time
            </div>
          )}
          {tab === 'cancel_requests' && (
            <div style={{ fontSize: '11px', color: t.text3 }}>
              <strong style={{ color: t.text2 }}>{cancelRequests.length}</strong> pending cancellation request{cancelRequests.length === 1 ? '' : 's'} · oldest first
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {tab === 'pending' && pending.length > 0 && oldestBadge && (
            <div style={{ fontSize: '10px', color: t.text3, padding: '5px 10px', background: oldestBadge.bg, borderRadius: '6px', border: `1px solid ${oldestBadge.color}30` }}>
              Oldest: <strong style={{ color: oldestBadge.color }}>{oldestBadge.label}</strong>
            </div>
          )}
          {tab === 'pending' && (
            <button onClick={toggleSound}
              title={soundEnabled ? 'Sound on. Click to mute.' : 'Sound off. Click to enable.'}
              aria-label={soundEnabled ? 'Mute approval sound' : 'Unmute approval sound'}
              style={{ ...btnOut, padding: '7px 14px', color: soundEnabled ? t.text2 : t.text4, borderColor: soundEnabled ? `${t.gold}50` : t.border2 }}>
              {soundEnabled ? 'Sound on' : 'Sound off'}
            </button>
          )}
          <button onClick={() => {
            if (tab === 'pending')               fetchPending(false)
            else if (tab === 'cancel_requests')  fetchCancelRequests(false)
            else if (tab === 'cancellations')    fetchCancellations(false)
            else if (tab === 'reports')          fetchReport(reportFrom, reportTo, false)
            else if (tab === 'efficiency')       fetchEfficiency(effFrom, effTo, false)
            else if (tab === 'settings')         fetchSettings(false)
            else                               fetchHistory(tab, false)
          }} style={btnOut}>Refresh</button>
        </div>
      </div>

      {/* Tab strip — Pending / Approved / Rejected / Cancellations / Reports / Settings */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${t.border}`, marginTop: '-2px', flexWrap: 'wrap' }}>
        {[
          { id: 'pending',         label: 'Pending',         color: t.orange,                       badge: pending.length },
          { id: 'cancel_requests', label: 'Cancel Requests', color: t.red,                          badge: cancelRequests.length },
          { id: 'approved',        label: 'Approved',        color: t.green  },
          { id: 'rejected',        label: 'Rejected',        color: t.red    },
          { id: 'cancellations',   label: 'Cancellations',   color: t.purple },
          { id: 'reports',         label: 'Reports',         color: t.blue   },
          { id: 'efficiency',      label: 'Efficiency',      color: t.gold   },
          { id: 'settings',        label: 'Settings',        color: t.text2  },
        ].map(o => {
          const active = tab === o.id
          return (
            <button key={o.id} onClick={() => setTab(o.id)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                color: active ? o.color : t.text3,
                borderBottom: `2px solid ${active ? o.color : 'transparent'}`,
                marginBottom: '-1px',
                letterSpacing: '.02em',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
              }}>
              {o.label}
              {o.badge ? (
                <span style={{ background: `${o.color}25`, color: o.color, fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '99px', fontFamily: 'monospace', minWidth: '18px', textAlign: 'center' }}>
                  {o.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Notifications banner */}
      {notifPermission === 'default' && (
        <div style={{ background: `${t.gold}10`, border: `1px solid ${t.gold}40`, borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ fontSize: '12px', color: t.gold }}>
            Enable desktop notifications to be alerted when a new request arrives.
          </div>
          <button onClick={requestNotifications}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
            Enable
          </button>
        </div>
      )}
      {notifPermission === 'denied' && (
        <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '10px', padding: '10px 16px', fontSize: '11px', color: t.red }}>
          Notifications are blocked. Click the lock icon in the browser address bar to allow them.
        </div>
      )}

      {/* Empty state — pending tab */}
      {tab === 'pending' && pending.length === 0 ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 500 }}>No pending approvals</div>
          <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>
            New requests will appear here as they arrive.
          </div>
        </div>
      ) : (tab === 'approved' || tab === 'rejected') && history.length === 0 ? (
        /* Empty state — history tab */
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 500 }}>
            No {tab} consignments yet
          </div>
          <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>
            {tab === 'approved' ? 'Once you approve a consignment, it will be archived here.' : 'Rejected consignments are recorded here for audit.'}
          </div>
        </div>
      ) : tab === 'cancel_requests' && cancelRequests.length === 0 ? (
        /* Empty state — Cancel Requests tab */
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 500 }}>No pending cancellation requests</div>
          <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>
            When operations files a Cancel request from the Consignment Data page, it appears here for accounts to approve or reject.
          </div>
        </div>
      ) : tab === 'cancel_requests' ? (
        /* Pending cancellation requests — accounts queue. Oldest first (FIFO). */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {cancelRequests.map(c => {
            const isType   = c.movement_type === 'INTERNAL'
            const dest     = isType ? (c.dest_branch || '?') : 'Head Office'
            const requestAge = (() => {
              if (!c.cancellation_requested_at) return ''
              const ms = Date.now() - new Date(c.cancellation_requested_at).getTime()
              const mins = Math.floor(ms / 60000)
              if (mins < 1)    return 'just now'
              if (mins < 60)   return `${mins}m ago`
              const hrs = Math.floor(mins / 60)
              if (hrs < 24)    return `${hrs}h ago`
              const days = Math.floor(hrs / 24)
              return `${days}d ago`
            })()
            const ewbActive = !!c.eway_bill_no
            const irnActive = !!c.irn
            const busy = approveCancelBusy === c.id
            return (
              <div key={c.id} style={{ ...card, padding: '14px 18px', borderLeft: `3px solid ${t.red}`, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Header row — TMP PRF, type, source→dest, request age */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: t.gold, fontFamily: 'monospace' }}>{c.tmp_prf_no}</span>
                  <span style={{ fontSize: '10px', color: isType ? t.purple : t.orange, background: `${isType ? t.purple : t.orange}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>
                    {isType ? 'Branch → Hub' : 'Branch → HO'}
                  </span>
                  <span style={{ fontSize: '12px', color: t.text2 }}>
                    <strong style={{ color: t.text1 }}>{c.branch_name}</strong>
                    <span style={{ color: t.text4, margin: '0 6px' }}>→</span>
                    {dest}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: t.red, background: `${t.red}12`, border: `1px solid ${t.red}35`, borderRadius: '99px', padding: '3px 11px', fontWeight: 600 }}>
                    <span className="cdata-status-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.red, display: 'inline-block', color: t.red }} />
                    Requested {requestAge}
                  </span>
                </div>

                {/* Reason block — surfaced loudly because it's the whole point of the queue */}
                <div style={{ background: `${t.red}08`, border: `1px solid ${t.red}25`, borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>Reason from operations</div>
                  <div style={{ fontSize: '13px', color: t.text1, lineHeight: 1.5 }}>{c.cancellation_reason || '—'}</div>
                  <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>by {c.cancellation_requested_by || 'unknown'}</div>
                </div>

                {/* Stats + active-doc warnings */}
                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px', color: t.text3 }}>
                  <span><strong style={{ color: t.text1, fontFamily: 'monospace' }}>{c.total_bills}</strong> bills</span>
                  <span><strong style={{ color: t.gold, fontFamily: 'monospace' }}>{Number(c.total_net_wt || 0).toFixed(3)}g</strong> net wt</span>
                  <span><strong style={{ color: t.blue, fontFamily: 'monospace' }}>₹{Number(c.total_amount || 0).toLocaleString('en-IN')}</strong></span>
                  {(ewbActive || irnActive) && (
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: t.blue, fontWeight: 600 }}
                      title="Approving will cancel this on the GST portal first, then void the consignment. All in one click.">
                      <span>⟲</span>
                      {ewbActive && irnActive ? 'EWB + E-Invoice will be cancelled on portal' : ewbActive ? 'EWB will be cancelled on NIC' : 'E-Invoice will be cancelled on IRP'}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '2px' }}>
                  <button onClick={() => { setRejectCancelTarget(c); setRejectCancelReason('') }} disabled={busy}
                    style={{ background: 'transparent', border: `1px solid ${t.border2}`, color: t.text2, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    Reject request
                  </button>
                  <button onClick={async () => {
                    // Compose the confirmation message so accounts knows exactly what
                    // the single click will do — NIC + IRP + local void all happen
                    // server-side now, no more separate GST portal trip.
                    const steps = []
                    if (ewbActive) steps.push(`Cancel EWB ${c.eway_bill_no} on NIC`)
                    if (irnActive) steps.push('Cancel the E-Invoice IRN on IRP')
                    steps.push(`Return ${c.total_bills} bill${c.total_bills === 1 ? '' : 's'} to ${c.branch_name}`)
                    steps.push('Mark consignment as cancelled')
                    const ok = await openConfirm({
                      title: `Approve cancellation of ${c.tmp_prf_no}?`,
                      message: `This will:\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nAll in one shot. If NIC or IRP rejects (e.g. > 24h since generation), nothing is changed and you'll see the error.`,
                      confirmLabel: 'Approve cancellation',
                      danger: true,
                    })
                    if (!ok) return
                    setApproveCancelBusy(c.id)
                    try {
                      const r = await authedFetch('/api/consignments', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'approve_cancellation', id: c.id }),
                      })
                      const j = await r.json()
                      if (!r.ok || j.error) { showToast(j.error || 'Approval failed', 'error'); return }
                      showToast(j.message || 'Cancellation approved.', 'success')
                      fetchCancelRequests(true)
                    } finally { setApproveCancelBusy(null) }
                  }} disabled={busy}
                    style={{ background: busy ? `${t.red}50` : t.red, color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    {busy ? (ewbActive || irnActive ? 'Cancelling on portal…' : 'Approving…') : 'Approve cancellation'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : tab === 'cancellations' && cancellations.length === 0 ? (
        /* Empty state — cancellations tab.
           Includes a diagnostic button that calls the endpoint with debug=1
           and surfaces the raw response inline. Useful when accounts is
           certain a cancellation happened but the tab is empty — we can
           see whether the API is returning rows, hitting a permission
           filter, or never being called at all. */
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 500 }}>
            No EWB / E-Invoice cancellations yet
          </div>
          <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>
            When a cancelled E-Way Bill or E-Invoice voids a consignment, the audit entry appears here.
          </div>
          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <button
              onClick={async () => {
                setCancelDiag({ loading: true })
                try {
                  const r = await authedFetch(`/api/consignments?action=cancellation_history&debug=1`)
                  const j = await r.json()
                  setCancelDiag({ loading: false, status: r.status, body: j })
                } catch (e) {
                  setCancelDiag({ loading: false, error: String(e?.message || e) })
                }
              }}
              style={{
                ...btnOut,
                padding: '6px 14px',
                fontSize: '11px',
                borderColor: `${t.purple}55`,
                color: t.purple,
              }}>
              {cancelDiag?.loading ? 'Running…' : 'Run diagnostic'}
            </button>
            {cancelDiag && !cancelDiag.loading && (
              <pre style={{
                marginTop: 8, padding: '12px 14px',
                background: t.card2, border: `1px solid ${t.border}`,
                borderRadius: 8, textAlign: 'left',
                fontSize: 10, color: t.text2,
                maxWidth: 720, maxHeight: 400, overflow: 'auto',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
{cancelDiag.error
  ? `Fetch error: ${cancelDiag.error}`
  : `HTTP ${cancelDiag.status}\n\n${JSON.stringify(cancelDiag.body, null, 2)}`}
              </pre>
            )}
          </div>
        </div>
      ) : tab === 'cancellations' ? (
        /* Cancellation log — every doc cancellation, all time */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {cancellations.map(ev => {
            const c       = ev.consignment || {}
            const isEwb   = ev.event_type === 'ewb_cancelled'
            const docNo   = isEwb ? ev.details?.ewb_no : ev.details?.irn
            const reasonCode = ev.details?.reason_code
            const remark  = ev.details?.remark
            const ack     = isEwb ? ev.details?.nic_ack : ev.details?.irp_ack
            const accent  = isEwb ? t.green : t.purple
            const isType  = c.movement_type === 'INTERNAL'
            const dest    = isType ? c.dest_branch : 'Head Office'
            return (
              <div key={ev.id} style={{ ...card, padding: '12px 16px 12px 18px', borderLeft: `3px solid ${accent}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '9px', color: accent, background: `${accent}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.04em' }}>
                    {isEwb ? 'EWB CANCELLED' : 'E-INVOICE CANCELLED'}
                  </span>
                  {c.tmp_prf_no && <span style={{ fontSize: '13px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '.02em' }}>{c.tmp_prf_no}</span>}
                  {docNo && <span style={{ fontSize: '11px', color: t.text2, fontFamily: 'monospace' }}>{docNo}</span>}
                  {c.movement_type && (
                    <span style={{ fontSize: '9px', color: isType ? t.purple : t.orange, background: `${isType ? t.purple : t.orange}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>
                      {isType ? 'BRANCH → HUB' : 'BRANCH → HO'}
                    </span>
                  )}
                </div>
                {c.branch_name && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '12px', color: t.text1, fontWeight: 600 }}>
                      {c.branch_name}
                      <span style={{ color: t.text4, margin: '0 8px', fontWeight: 400 }}>→</span>
                      {dest}
                    </div>
                    <div style={{ fontSize: '11px', color: t.text3, display: 'flex', gap: '12px', fontFamily: 'monospace' }}>
                      {c.total_bills != null && <span>{c.total_bills} bills</span>}
                      {c.total_net_wt != null && <span style={{ color: t.gold }}>{fmtWt(c.total_net_wt)}</span>}
                      {c.total_gross_value != null && <span style={{ color: t.blue }}>₹{fmt(Math.round(c.total_gross_value))}</span>}
                    </div>
                  </div>
                )}
                {/* If the consignment row was deleted (e.g. by an E2E reset),
                    the audit entry still surfaces here. Tell the operator the
                    branch/route info is unavailable so they don't think we
                    just hid it. */}
                {ev.consignment_missing && (
                  <div style={{ fontSize: '11px', color: t.orange, fontStyle: 'italic' }}>
                    Consignment record no longer exists — audit entry preserved.
                  </div>
                )}
                <div style={{ fontSize: '11px', color: t.text2 }}>
                  <span style={{ color: t.text4 }}>Reason:</span>{' '}
                  {reasonCode && <span style={{ color: t.text2, fontWeight: 600 }}>{reasonCode}</span>}
                  {remark && <span style={{ color: t.text2 }}>{reasonCode ? ' · ' : ''}{remark}</span>}
                  {!reasonCode && !remark && <span style={{ color: t.text4 }}>—</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '10px', color: t.text4 }}>
                  <span>Cancelled by <strong style={{ color: t.text3 }}>{ev.actor_email || 'unknown'}</strong></span>
                  <span>·</span>
                  <span>{fmtTS(ev.created_at)}</span>
                  {ack?.Success && (
                    <>
                      <span>·</span>
                      <span title="NIC / IRP acknowledgement" style={{ color: t.green }}>{isEwb ? 'NIC' : 'IRP'} ack: {String(ack.Success)}</span>
                    </>
                  )}
                  {c.rejection_reason && (
                    <>
                      <span>·</span>
                      <span style={{ color: t.red }}>Consignment auto-rejected</span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : tab === 'reports' ? (
        <ReportsTab
          t={t} card={card}
          report={report}
          reportFrom={reportFrom} setReportFrom={setReportFrom}
          reportTo={reportTo}     setReportTo={setReportTo}
          fetchReport={fetchReport}
        />
      ) : tab === 'efficiency' ? (
        <EfficiencyTab
          t={t} card={card}
          users={efficiency.users}
          from={effFrom} setFrom={setEffFrom}
          to={effTo}     setTo={setEffTo}
          fetchEfficiency={fetchEfficiency}
        />
      ) : tab === 'settings' ? (
        <SettingsTab
          t={t} card={card}
          settings={settings}
          settingsBusy={settingsBusy}
          settingsToast={settingsToast}
          saveSeq={saveSeq}
          saveGstin={saveGstin}
          addState={addState}
          removeState={removeState}
          openConfirm={openConfirm}
        />
      ) : (tab === 'approved' || tab === 'rejected') ? (
        /* History list — polished card per consignment with stats pills,
           avatar audit trail, doc-action chips, live cancel countdown.
           Approved tab gets accounts-driven filters (date range + doc type)
           so the team can drill into a specific reconciliation window. */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {tab === 'approved' && (
            <ApprovedFilterBar
              t={t}
              card={card}
              from={approvedFrom} setFrom={setApprovedFrom}
              to={approvedTo}     setTo={setApprovedTo}
              doc={approvedDoc}   setDoc={setApprovedDoc}
              total={history.length}
            />
          )}
          {(() => {
            // Client-side filter for the Approved tab only — rejected stays
            // unfiltered (audit-critical) until accounts asks otherwise.
            const list = tab === 'approved'
              ? history.filter(c => {
                  // Doc-type filter
                  if (approvedDoc === 'ewb'  && !c.eway_bill_no) return false
                  if (approvedDoc === 'einv' && !c.irn)          return false
                  // Date filter on approved_at (the audit-relevant timestamp)
                  if (approvedFrom || approvedTo) {
                    if (!c.approved_at) return false
                    const d = String(c.approved_at).slice(0, 10)
                    if (approvedFrom && d < approvedFrom) return false
                    if (approvedTo   && d > approvedTo)   return false
                  }
                  return true
                })
              : history
            return list.length === 0 ? (
              <div style={{ ...card, padding: '40px 20px', textAlign: 'center', color: t.text3, fontSize: '12px' }}>
                No {tab === 'approved' ? 'approved' : 'rejected'} consignments match the current filters.
              </div>
            ) : list.map(c => (
              <HistoryCard
                key={c.id}
                c={c}
                t={t}
                card={card}
                isApproved={tab === 'approved'}
                previewDoc={previewDoc}
                showToast={showToast}
                openCancel={openCancel}
              />
            ))
          })()}
        </div>
      ) : (
        /* Pending list */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pending.map(c => {
            const isType        = c.movement_type === 'INTERNAL'
            const isApproveBusy = actionId === c.id + ':approve'
            const isRejectBusy  = actionId === c.id + ':reject'
            const wb            = waitingBadge(c.created_at, t)
            const dest          = isType ? c.dest_branch : 'Head Office'

            // Doc-required gate. Mirrors the backend rule in approve_consignment:
            //   - INTERNAL Branch → Hub                 → EWB required
            //   - KA-source EXTERNAL                    → EWB required
            //   - Non-KA EXTERNAL                       → E-Invoice required
            // Reject is intentionally NOT gated — accounts can stop bad
            // submissions without burning an NIC document number.
            const isKaSource     = c.state_code === 'KA'
            const needsEwb       = isType || isKaSource
            const needsIrn       = !isType && !isKaSource
            const docMissing     = (needsEwb && !c.eway_bill_no) || (needsIrn && !c.irn)
            const docMissingType = needsEwb ? 'E-Way Bill' : 'E-Invoice'
            const approveBlocked = docMissing
            const approveTooltip = approveBlocked
              ? `Generate the ${docMissingType} first — accounts cannot dispatch goods without one.`
              : 'Approve this consignment for dispatch'
            const rejectTooltip  = 'Reject this consignment. Tip: Preview the EWB / E-Invoice first to verify values before deciding.'

            // Stat blocks — only show EWB / IRN when generated
            const stats = [
              ['Bills',   c.total_bills,                                t.text1],
              ['Net Wt',  fmtWt(c.total_net_wt),                        t.gold],
              ['Value',   `₹${fmt(Math.round(c.total_amount))}`,        t.blue],
            ]
            if (c.eway_bill_no) stats.push(['EWB', c.eway_bill_no,                                   t.green])
            if (c.irn)          stats.push(['IRN', String(c.irn).slice(0, 12) + '…',                 t.purple])

            return (
              <div key={c.id} style={{ ...card, padding: '12px 16px 12px 18px', borderLeft: `3px solid ${wb.color}`, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '14px', alignItems: 'center' }}>
                {/* Left side: identity + route + inline stats */}
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {/* Row 1: PRF + badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '.02em' }}>{c.tmp_prf_no}</span>
                    <span style={{ fontSize: '9px', color: isType ? t.purple : t.orange, background: `${isType ? t.purple : t.orange}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>
                      {isType ? 'BRANCH → HUB' : 'BRANCH → HO'}
                    </span>
                    <span style={{ fontSize: '9px', color: wb.color, background: wb.bg, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>
                      {wb.label}
                    </span>
                    {c.eway_bill_no && <span style={{ fontSize: '9px', color: t.green, background: `${t.green}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>EWB</span>}
                    {c.irn         && <span style={{ fontSize: '9px', color: t.purple, background: `${t.purple}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>IRN</span>}
                  </div>
                  {/* Row 2: Source → Destination + stats inline */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>
                      {c.branch_name}
                      <span style={{ color: t.text4, margin: '0 8px', fontWeight: 400 }}>→</span>
                      {dest}
                    </div>
                    <div style={{ fontSize: '11px', color: t.text3, display: 'flex', gap: '12px', fontFamily: 'monospace' }}>
                      <span>{c.total_bills} bills</span>
                      <span style={{ color: t.gold }}>{fmtWt(c.total_net_wt)}</span>
                      <span style={{ color: t.blue }}>₹{fmt(Math.round(c.total_amount))}</span>
                    </div>
                  </div>
                  {/* Workflow stepper — sequential progress through the doc chain */}
                  <WorkflowStrip t={t} c={c} isType={isType} />

                  {/* Row 3: timestamp + preview links */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                    <span style={{ fontSize: '10px', color: t.text4 }}>
                      {fmtTS(c.created_at)}{c.created_by && c.created_by !== 'unknown' ? ` · ${c.created_by}` : ''}
                    </span>
                    <span style={{ color: t.text4, fontSize: '10px' }}>·</span>
                    <button onClick={() => previewDoc(`/api/generate-consignee-report?id=${c.id}`, `Report-${c.tmp_prf_no}.jpg`, msg => showToast(msg, 'error'))}
                      title="Preview Consignee Report"
                      style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                      Report
                    </button>
                    <button onClick={() => previewDoc(
                        isType ? `/api/generate-issue-voucher-pdf?id=${c.id}` : `/api/generate-challan-pdf?id=${c.id}`,
                        `${isType ? 'Voucher' : 'Challan'}-${c.tmp_prf_no}.pdf`,
                        msg => showToast(msg, 'error'))}
                      title={isType ? 'Preview Issue Voucher' : 'Preview Delivery Challan'}
                      style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.gold, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                      {isType ? 'Voucher' : 'Challan'}
                    </button>
                    {/* E-Invoice preview / generate / cancel. EWB is no longer
                        handled here — it's operations self-service on the
                        Consignment Data page, so EWB-route consignments never
                        reach this accounts queue (filtered server-side). */}
                    {(() => {
                      const isKaSource = c.state_code === 'KA'
                      const showEinv   = !isType && !isKaSource
                      if (!showEinv) return null
                      // (Generate runs from inside the Preview modal now; busy state is owned by `preview.generating`.)
                      return c.irn ? (
                        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          <button onClick={() => previewDoc(`/api/e-invoice/pdf?id=${c.id}`, `EInvoice-${c.tmp_prf_no}.pdf`, msg => showToast(msg, 'error'))}
                            title="Preview E-Invoice PDF"
                            style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                            E-Invoice
                          </button>
                          <button onClick={() => openCancel(c, 'irn')}
                            aria-label="Cancel E-Invoice"
                            title="Cancel this E-Invoice on IRP (within 24h) — or generate a Credit Note if past the window"
                            style={{ background: 'transparent', border: `1px solid ${t.red}80`, borderRadius: '5px', padding: '2px 8px', fontSize: '10px', color: t.red, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Cancel E-Invoice
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => openPreview(c, 'irn')} disabled={!!actionId}
                          title="Preview the E-Invoice payload before firing IRP. Verify GSTINs + value + items match."
                          style={{ background: 'transparent', border: `1px solid ${t.purple}50`, borderRadius: '5px', padding: '2px 8px', fontSize: '10px', color: t.purple, fontWeight: 600, cursor: actionId ? 'not-allowed' : 'pointer' }}>
                          Preview IRN
                        </button>
                      )
                    })()}
                  </div>
                </div>

                {/* Right side: Reject + Approve */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button onClick={() => reject(c)} disabled={!!actionId}
                    title={rejectTooltip}
                    style={{ background: 'transparent', border: `1px solid ${t.red}`, borderRadius: '7px', padding: '7px 16px', fontSize: '11px', color: t.red, fontWeight: 600, cursor: actionId ? 'not-allowed' : 'pointer', opacity: isRejectBusy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                    {isRejectBusy ? 'Rejecting…' : 'Reject'}
                  </button>
                  <button onClick={() => approve(c)} disabled={!!actionId || approveBlocked}
                    title={approveTooltip}
                    style={{
                      background:    approveBlocked ? 'transparent' : t.green,
                      color:         approveBlocked ? t.text4 : '#fff',
                      border:        approveBlocked ? `1px solid ${t.border}` : 'none',
                      borderRadius:  '7px',
                      padding:       '7px 20px',
                      fontSize:      '11px',
                      fontWeight:    700,
                      cursor:        (actionId || approveBlocked) ? 'not-allowed' : 'pointer',
                      opacity:       isApproveBusy ? 0.6 : (approveBlocked ? 0.7 : 1),
                      whiteSpace:    'nowrap',
                    }}>
                    {isApproveBusy ? 'Approving…' : (approveBlocked ? `Generate ${docMissingType} first` : 'Approve')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Preview Modal: EWB / IRN before firing NIC ── */}
      {preview && (
        <PreviewModal
          state={preview}
          t={t}
          onClose={() => setPreview(null)}
          onConfirm={confirmGenerate}
        />
      )}

      {/* ── Cancel Modal: cancel an existing EWB/IRN, with credit note fallback for past 24h ── */}
      {cancelModal && (
        <CancelModal
          state={cancelModal}
          t={t}
          onChange={(patch) => setCancelModal(m => m ? { ...m, ...patch } : null)}
          onClose={() => setCancelModal(null)}
          onConfirm={confirmCancel}
          onCreditNote={generateCreditNote}
        />
      )}

      {/* ── Reject Cancellation Request Modal — accounts pushes back on an
            ops-filed cancellation request. Requires a reason so operations
            knows why and can fix-and-refile (or drop it). ── */}
      {rejectCancelTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}
          onClick={() => { if (!rejectCancelBusy) { setRejectCancelTarget(null); setRejectCancelReason('') } }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '24px 26px', width: '100%', maxWidth: '460px', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: `${t.orange}18`, color: t.orange, fontSize: '15px', fontWeight: 700 }}>?</span>
              <div style={{ fontSize: '15px', fontWeight: 600, color: t.text1 }}>Reject cancellation request</div>
            </div>
            <div style={{ fontSize: '11px', color: t.text3, marginBottom: '14px' }}>
              <strong style={{ color: t.gold, fontFamily: 'monospace' }}>{rejectCancelTarget.tmp_prf_no}</strong> ·{' '}
              {rejectCancelTarget.branch_name} → {rejectCancelTarget.movement_type === 'INTERNAL' ? (rejectCancelTarget.dest_branch || '?') : 'Head Office'}
            </div>
            <div style={{ background: `${t.orange}10`, border: `1px solid ${t.orange}35`, borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: t.orange, marginBottom: '14px', lineHeight: 1.5 }}>
              Bills stay attached. Operations will see the row revert to a normal Cancel button and can re-file with corrected details if needed.
            </div>
            <label style={{ display: 'block', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px' }}>
              Why are you rejecting? <span style={{ color: t.red }}>*</span>
            </label>
            <textarea
              value={rejectCancelReason}
              onChange={e => setRejectCancelReason(e.target.value)}
              placeholder="Operations sees this verbatim. Be specific so they can fix-and-refile."
              autoFocus rows={4}
              style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: t.text1, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => { setRejectCancelTarget(null); setRejectCancelReason('') }} disabled={rejectCancelBusy}
                style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 16px', fontSize: '12px', color: t.text2, cursor: rejectCancelBusy ? 'not-allowed' : 'pointer' }}>
                Back
              </button>
              <button onClick={async () => {
                const reason = rejectCancelReason.trim()
                if (!reason) return
                setRejectCancelBusy(true)
                try {
                  const r = await authedFetch('/api/consignments', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reject_cancellation', id: rejectCancelTarget.id, reason }),
                  })
                  const j = await r.json()
                  if (!r.ok || j.error) { showToast(j.error || 'Rejection failed', 'error'); return }
                  showToast(j.message || 'Cancellation request rejected.', 'success')
                  setRejectCancelTarget(null)
                  setRejectCancelReason('')
                  fetchCancelRequests(true)
                } finally { setRejectCancelBusy(false) }
              }}
                disabled={rejectCancelBusy || !rejectCancelReason.trim()}
                style={{
                  background: rejectCancelReason.trim() && !rejectCancelBusy ? t.orange : `${t.orange}40`,
                  color: '#1a0a00', border: 'none', borderRadius: '8px',
                  padding: '8px 18px', fontSize: '12px', fontWeight: 700,
                  cursor: rejectCancelBusy || !rejectCancelReason.trim() ? 'not-allowed' : 'pointer',
                }}>
                {rejectCancelBusy ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pulse keyframe used by the request-age dot, mirroring ConsignmentData. */}
      <style>{`
        @keyframes cdataChipPulse { 0%,100% { box-shadow: 0 0 0 0 currentColor; } 50% { box-shadow: 0 0 0 4px transparent; } }
        .cdata-status-dot { animation: cdataChipPulse 2.4s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview modal — shows the exact payload that would be sent to NIC/IRP, side
// by side with the document fields accounts cares about. Only after explicit
// confirmation does the actual generate fire.
// ─────────────────────────────────────────────────────────────────────────────
function PreviewModal({ state, t, onClose, onConfirm }) {
  const { type, consignment: c, loading, data, audit, generating, error } = state
  const isEwb   = type === 'ewb'
  const docName = isEwb ? 'E-Way Bill' : 'E-Invoice'
  const accent  = isEwb ? t.green : t.purple
  const fmtINR  = (n) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const summary = data?.summary
  const errors  = data?.validation_errors || []
  const blocked = errors.length > 0 || data?.already_generated || !data?.can_generate

  // Render via portal so the fixed overlay lives at <body> — escapes any
  // CSS containing-block created by ancestor transforms / filters / etc.
  if (typeof document === 'undefined') return null
  return createPortal((
    <div onClick={(e) => { if (e.target === e.currentTarget && !generating) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px', overflow: 'hidden' }}>
      <div style={{
        background: t.card, border: `1px solid ${accent}40`, borderRadius: '12px',
        width: '100%', maxWidth: '720px',
        maxHeight: 'calc(100vh - 40px)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.6)',
        overflow: 'hidden',  // keeps the rounded corners on header / footer
      }}>

        {/* Header — always visible (outside the scrollable body) */}
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Preview before generation</div>
            <div style={{ fontSize: '1.05rem', color: accent, fontWeight: 600 }}>{docName} for {c.tmp_prf_no}</div>
            <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '4px' }}>
              Review the values below. Click <strong>Confirm &amp; Generate</strong> only if everything matches the Voucher / Challan.
            </div>
          </div>
          <button onClick={onClose} disabled={generating} aria-label="Close preview" style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: '18px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body — flex-grow + scroll. Only this region scrolls when content overflows. */}
        <div style={{ padding: '18px 22px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading && <div style={{ textAlign: 'center', color: t.text3, fontSize: '12px', padding: '40px 0' }}>Loading preview…</div>}

          {error && (
            <div style={{ background: `${t.red}15`, border: `1px solid ${t.red}40`, borderRadius: '7px', padding: '10px 14px', fontSize: '12px', color: t.red, marginBottom: '12px' }}>
              {error}
            </div>
          )}

          {data?.already_generated && (
            <div style={{ background: `${t.orange}15`, border: `1px solid ${t.orange}40`, borderRadius: '7px', padding: '10px 14px', fontSize: '12px', color: t.orange, marginBottom: '12px' }}>
              {docName} already exists ({data.existing_ewb_no || data.existing_irn}). Cancel it first if you need to regenerate.
            </div>
          )}

          {errors.length > 0 && (
            <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}30`, borderRadius: '7px', padding: '10px 14px', fontSize: '11px', color: t.red, marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Cannot generate — fix these first:</div>
              {errors.map((e, i) => <div key={i} style={{ marginTop: '2px' }}>· {e}</div>)}
            </div>
          )}

          {summary && (
            <>
              {/* Document number banner — accounts wants this front-and-centre,
                  especially for E-Invoice where the per-state sequence number
                  needs to be verified before generation. EWB shows the system
                  fingerprint (TMP_PRF + UUID prefix). */}
              <div style={{
                background:    `${accent}10`,
                border:        `1px solid ${accent}40`,
                borderRadius:  '8px',
                padding:       '10px 14px',
                marginBottom:  '14px',
                display:       'flex',
                justifyContent:'space-between',
                alignItems:    'center',
                gap:           '12px',
                flexWrap:      'wrap',
              }}>
                <div>
                  <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>
                    {isEwb ? 'EWB Document Number' : 'E-Invoice Number'}
                  </div>
                  <div style={{ fontSize: '14px', color: accent, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '.02em' }}>
                    {summary.document_no || '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Date</div>
                  <div style={{ fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>{summary.document_date || '—'}</div>
                </div>
              </div>

              {/* Header KPIs — easy to scan against challan */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: t.border, borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' }}>
                <PreviewKpi t={t} label="Quantity (Gross)" value={`${Number(summary.quantity_grams || 0).toFixed(3)}g`} accent={t.gold} />
                <PreviewKpi t={t} label="Taxable Amount"   value={fmtINR(summary.taxable_amount)} accent={t.blue} />
                <PreviewKpi t={t} label="Total Invoice"    value={fmtINR(summary.total_invoice)}  accent={t.green} />
              </div>

              {/* Side-by-side parties */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '14px' }}>
                <PartyCard t={t} title={isEwb ? 'From / Dispatch' : 'Seller'} party={summary.seller} />
                <PartyCard t={t} title={isEwb ? 'To / Ship'       : 'Buyer (HO)'} party={summary.buyer} />
              </div>

              {/* Tax breakdown */}
              <div style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
                <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>Tax breakdown</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '11px' }}>
                  <div><div style={{ color: t.text4 }}>Taxable</div><div style={{ color: t.text1, fontFamily: 'monospace', marginTop: '2px' }}>{fmtINR(summary.taxable_amount)}</div></div>
                  <div><div style={{ color: t.text4 }}>IGST{summary.igst_rate ? ` @${summary.igst_rate}%` : ''}</div><div style={{ color: t.text1, fontFamily: 'monospace', marginTop: '2px' }}>{fmtINR(summary.igst_amount)}</div></div>
                  <div><div style={{ color: t.text4 }}>CGST + SGST</div><div style={{ color: t.text1, fontFamily: 'monospace', marginTop: '2px' }}>{fmtINR((Number(summary.cgst_amount || 0) + Number(summary.sgst_amount || 0)))}</div></div>
                  <div><div style={{ color: t.text4 }}>Total</div><div style={{ color: t.green, fontFamily: 'monospace', marginTop: '2px', fontWeight: 600 }}>{fmtINR(summary.total_invoice)}</div></div>
                </div>
                {isEwb && summary.distance_km != null && (
                  <div style={{ marginTop: '10px', fontSize: '10px', color: t.text3 }}>Distance: <strong style={{ color: t.text2 }}>{summary.distance_km} km</strong> · HSN: <strong style={{ color: t.text2 }}>{summary.hsn}</strong> · Sub-supply: <strong style={{ color: t.text2 }}>{summary.sub_supply_type}</strong></div>
                )}
              </div>

              {/* Cross-doc consistency audit — only shown if audit fetched successfully */}
              {audit && <DocAuditPanel t={t} audit={audit} />}

              {/* Items list */}
              {summary.items?.length > 0 && (
                <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' }}>
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Items ({summary.items.length})</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Bill', 'Customer', 'Gross', 'Net', 'Value'].map(h =>
                      <th key={h} style={{ padding: '7px 12px', fontSize: '9px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: ['Gross','Net','Value'].includes(h) ? 'right' : 'left', fontWeight: 500, borderBottom: `1px solid ${t.border}` }}>{h}</th>
                    )}</tr></thead>
                    <tbody>
                      {summary.items.map((it, i) => (
                        <tr key={i} style={{ borderBottom: i === summary.items.length - 1 ? 'none' : `1px solid ${t.border}25` }}>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.gold, fontFamily: 'monospace' }}>{it.bill_no || '—'}</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.text1 }}>{it.customer || '—'}</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{Number(it.gross_weight).toFixed(3)}g</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>{Number(it.net_weight).toFixed(3)}g</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>{fmtINR(it.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ fontSize: '10px', color: t.text4, textAlign: 'center' }}>
                Document #: <span style={{ fontFamily: 'monospace', color: t.text2 }}>{summary.document_no}</span> · Date: <span style={{ fontFamily: 'monospace', color: t.text2 }}>{summary.document_date}</span>
              </div>
            </>
          )}
        </div>

        {/* Footer — always visible (outside scroll region) */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: `${t.card2 || t.card}80`, flexShrink: 0 }}>
          <div style={{ fontSize: '10px', color: t.text4 }}>
            {!blocked && !generating && '⚠ Clicking Confirm will generate this on the GST portal — real legal document.'}
            {blocked && '✕ Generation blocked — see issues above.'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} disabled={generating}
              style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 16px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
              Close
            </button>
            <button onClick={onConfirm} disabled={blocked || generating || loading}
              style={{ background: blocked || generating ? t.border : accent, color: blocked || generating ? t.text3 : '#fff', border: 'none', borderRadius: '6px', padding: '7px 18px', fontSize: '11px', fontWeight: 700, cursor: blocked || generating || loading ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1 }}>
              {generating ? 'Generating…' : `Confirm & Generate ${docName}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}

// WorkflowStrip + DocAuditPanel are imported from ./workflowParts so they
// stay in lockstep between this view and ConsignmentData.

// Reports tab — date-range picker with quick presets, KPI summary band,
// EWB + E-Invoice tables with totals row + CSV export. Heavy enough to
// extract into its own component so the parent doesn't get unwieldy.
function ReportsTab({ t, card, report, reportFrom, setReportFrom, reportTo, setReportTo, fetchReport }) {
  const today      = istToday()
  const yesterday  = istDaysAgo(1)
  const last7      = istDaysAgo(6)
  const monthStart = today.slice(0, 8) + '01'
  // FY 26-27 = Apr 2026 → Mar 2027. Generic: if current month >= April, FY
  // started this calendar year; else last calendar year.
  const now    = new Date()
  const fyYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const fyStart = `${fyYear}-04-01`

  const presets = [
    { label: 'Today',       from: today,      to: today },
    { label: 'Yesterday',   from: yesterday,  to: yesterday },
    { label: 'Last 7 days', from: last7,      to: today },
    { label: 'This month',  from: monthStart, to: today },
    { label: 'This FY',     from: fyStart,    to: today },
  ]
  const isPresetActive = (p) => p.from === reportFrom && p.to === reportTo
  const applyPreset = (p) => {
    setReportFrom(p.from); setReportTo(p.to)
    fetchReport(p.from, p.to, false)
  }

  // Aggregate totals for the KPI band + totals rows.
  // EWB rows still summed on raw goods value (no IGST in intrastate OWN_USE
  // for the report view). E-Invoice rows now sum the FULL invoice total
  // (assessable + IGST) so the band number matches what's actually billed.
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const ewbBills    = sum(report.ewbs, 'total_bills')
  const ewbWt       = sum(report.ewbs, 'total_net_wt')
  const ewbVal      = sum(report.ewbs.map(r => ({ v: r.total_amount || r.total_gross_value || 0 })), 'v')
  const eiBills     = sum(report.einvoices, 'total_bills')
  const eiWt        = sum(report.einvoices, 'total_net_wt')
  const eiAssess    = sum(report.einvoices, 'assessable_value')
  const eiIgst      = sum(report.einvoices, 'igst_amount')
  const eiVal       = sum(report.einvoices, 'total_invoice')

  // Per-state E-Invoice breakdown — useful for quick state-level reconciliation.
  const eiByState = report.einvoices.reduce((acc, r) => {
    const st = (r.einvoice_doc_no || '').match(/^WG\/(KL|TS|AP)\//)?.[1] || '??'
    if (!acc[st]) acc[st] = { count: 0, wt: 0, val: 0, igst: 0 }
    acc[st].count += 1
    acc[st].wt    += Number(r.total_net_wt || 0)
    acc[st].val   += Number(r.total_invoice || 0)
    acc[st].igst  += Number(r.igst_amount   || 0)
    return acc
  }, {})

  // CSV export helper — quote any field containing comma/quote/newline.
  const toCsv = (rows) => {
    if (!rows.length) return ''
    const headers = Object.keys(rows[0])
    const escape = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
  }
  const downloadCsv = (filename, rows) => {
    const csv  = toCsv(rows)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })  // BOM so Excel detects UTF-8
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const dateTag = reportFrom === reportTo ? reportFrom : `${reportFrom}_to_${reportTo}`
  const exportEwbs = () => downloadCsv(`EWB_${dateTag}.csv`, report.ewbs.map(r => ({
    Generated:    r.ewb_generated_at,
    TMP_PRF:      r.tmp_prf_no,
    'EWB No':     r.eway_bill_no,
    Branch:       r.branch_name,
    Destination:  r.movement_type === 'INTERNAL' ? r.dest_branch : 'HO',
    Bills:        r.total_bills,
    'Net Wt (g)': Number(r.total_net_wt || 0).toFixed(3),
    Value:        Math.round(r.total_amount || r.total_gross_value || 0),
    'Generated By': r.generated_by || '',
  })))
  const exportEinv = () => downloadCsv(`EInvoice_${dateTag}.csv`, report.einvoices.map(r => ({
    Generated:        r.einvoice_generated_at,
    'Invoice No':     r.einvoice_doc_no || '',
    State:            (r.einvoice_doc_no || '').match(/^WG\/(KL|TS|AP)\//)?.[1] || '',
    TMP_PRF:          r.tmp_prf_no,
    IRN:              r.irn || '',
    Branch:           r.branch_name,
    Destination:      'HO',
    Bills:            r.total_bills,
    'Net Wt (g)':     Number(r.total_net_wt || 0).toFixed(3),
    'Goods Value':    Math.round(r.total_amount     || 0),
    Assessable:       Number(r.assessable_value || 0).toFixed(2),
    'IGST 3%':        Number(r.igst_amount      || 0).toFixed(2),
    'Total Invoice':  Number(r.total_invoice    || 0).toFixed(2),
    'Generated By':   r.generated_by || '',
  })))

  // Cell styles — slightly more breathing room than the default for richer feel.
  const th       = { padding: '11px 14px', textAlign: 'left', fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' }
  const td       = { padding: '10px 14px', verticalAlign: 'middle', fontSize: '11.5px' }
  const totalsTd = { ...td, borderTop: `2px solid ${t.gold}40`, background: `${t.gold}10`, fontWeight: 700, fontSize: '11.5px' }

  // Friendly window label for the section descriptors.
  const windowLabel = reportFrom === reportTo
    ? new Date(reportFrom).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : `${new Date(reportFrom).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} → ${new Date(reportTo).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ─── Date controls panel ─────────────────────────────────────────── */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Reporting window</div>
            <div style={{ fontSize: '14px', color: t.text1, fontWeight: 600, marginTop: '3px', fontFamily: 'monospace', letterSpacing: '-.01em' }}>{windowLabel}</div>
          </div>
          <div style={{ width: '1px', height: '32px', background: t.border }} />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presets.map(p => {
              const active = isPresetActive(p)
              return (
                <button key={p.label} onClick={() => applyPreset(p)}
                  style={{
                    background:    active ? t.gold : 'transparent',
                    color:         active ? '#1a0a00' : t.text3,
                    border:        `1px solid ${active ? t.gold : t.border}`,
                    boxShadow:     active ? `0 1px 4px ${t.gold}40` : 'none',
                    borderRadius:  '16px',
                    padding:       '5px 14px',
                    fontSize:      '11px',
                    fontWeight:    600,
                    cursor:        'pointer',
                    transition:    'all .15s ease',
                  }}>
                  {p.label}
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} max={today}
              style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '12px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
            <span style={{ fontSize: '11px', color: t.text4 }}>→</span>
            <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} max={today}
              style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '12px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
            <button onClick={() => fetchReport(reportFrom, reportTo, false)}
              style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '7px 16px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', boxShadow: `0 1px 4px ${t.gold}50` }}>
              Run report
            </button>
          </div>
        </div>
      </div>

      {/* ─── KPI summary band ────────────────────────────────────────────── */}
      {/* EWB tile shows raw goods value (intrastate, no IGST). E-Inv tile
          shows the FULL invoice total (assessable + IGST 3%) so accounts can
          read the band as 'this is what was billed'. IGST tile breaks out
          the tax component separately for GSTR-1 reconciliation. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1px', background: t.border, borderRadius: '12px', overflow: 'hidden', boxShadow: `0 1px 3px ${t.border}50` }}>
        <ReportKpi t={t} label="Total docs"    primary={`${report.ewbs.length + report.einvoices.length}`}                  sub={`${report.ewbs.length} EWB · ${report.einvoices.length} E-Inv`} accent={t.gold} />
        <ReportKpi t={t} label="Total bills"   primary={`${ewbBills + eiBills}`}                                            sub={`${ewbBills} EWB · ${eiBills} E-Inv`} accent={t.text2} />
        <ReportKpi t={t} label="Net weight"    primary={`${(ewbWt + eiWt).toFixed(3)}g`}                                    sub={`${ewbWt.toFixed(3)} EWB · ${eiWt.toFixed(3)} E-Inv`} accent={t.gold} mono />
        <ReportKpi t={t} label="IGST collected" primary={`₹${fmt(Math.round(eiIgst))}`}                                     sub={`from ${report.einvoices.length} E-Invoice${report.einvoices.length === 1 ? '' : 's'}`} accent={t.purple} mono />
        <ReportKpi t={t} label="Total value"   primary={`₹${fmt(Math.round(ewbVal + eiVal))}`}                              sub={`EWB ₹${fmt(Math.round(ewbVal))} · E-Inv ₹${fmt(Math.round(eiVal))}`} accent={t.blue} mono />
      </div>

      {/* ─── EWB section ─────────────────────────────────────────────────── */}
      <ReportSection
        t={t} card={card}
        accent={t.green}
        badge="EWB"
        title="E-Way Bills"
        subtitle={`${report.ewbs.length} document${report.ewbs.length === 1 ? '' : 's'} · ${windowLabel}`}
        onExport={report.ewbs.length > 0 ? exportEwbs : null}
        emptyText="No E-Way Bills generated in this window."
        rowCount={report.ewbs.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
          <thead>
            <tr style={{ background: t.card2 || t.card }}>
              {['Generated', 'TMP_PRF', 'EWB No', 'Branch → Dest', 'Bills', 'Net Wt', 'Value', 'By'].map(h => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {report.ewbs.map((r, i) => (
              <ReportRow key={r.id} t={t} striped={i % 2 === 1}>
                <td style={{ ...td, color: t.text3, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtTS(r.ewb_generated_at)}</td>
                <td style={{ ...td, color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{r.tmp_prf_no}</td>
                <td style={{ ...td, color: t.green, fontFamily: 'monospace' }}>{r.eway_bill_no}</td>
                <td style={{ ...td, color: t.text2 }}>{r.branch_name} <span style={{ color: t.text4 }}>→</span> {r.movement_type === 'INTERNAL' ? r.dest_branch : 'HO'}</td>
                <td style={{ ...td, color: t.text2, textAlign: 'right' }}>{r.total_bills}</td>
                <td style={{ ...td, color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(r.total_net_wt)}</td>
                <td style={{ ...td, color: t.blue, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>₹{fmt(Math.round(r.total_amount || r.total_gross_value || 0))}</td>
                <td style={{ ...td, color: t.text3, fontSize: '10px' }}>{r.generated_by || '—'}</td>
              </ReportRow>
            ))}
            <tr>
              <td style={{ ...totalsTd, color: t.text3, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Total</td>
              <td style={totalsTd} colSpan={3} />
              <td style={{ ...totalsTd, color: t.text1, textAlign: 'right' }}>{ewbBills}</td>
              <td style={{ ...totalsTd, color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(ewbWt)}</td>
              <td style={{ ...totalsTd, color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(ewbVal))}</td>
              <td style={totalsTd} />
            </tr>
          </tbody>
        </table>
      </ReportSection>

      {/* ─── E-Invoice section ───────────────────────────────────────────── */}
      <ReportSection
        t={t} card={card}
        accent={t.purple}
        badge="E-INV"
        title="E-Invoices"
        subtitle={`${report.einvoices.length} document${report.einvoices.length === 1 ? '' : 's'} · ${windowLabel}`}
        onExport={report.einvoices.length > 0 ? exportEinv : null}
        emptyText="No E-Invoices generated in this window."
        rowCount={report.einvoices.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
          <thead>
            <tr style={{ background: t.card2 || t.card }}>
              {/* IGST + Total are visually grouped via a subtle left-edge tint
                  on the IGST th — accounts can scan the tax-breakdown block
                  without counting columns. */}
              <th style={th}>Generated</th>
              <th style={th}>Invoice No</th>
              <th style={th}>IRN</th>
              <th style={th}>TMP_PRF</th>
              <th style={th}>Branch → Dest</th>
              <th style={{ ...th, textAlign: 'right' }}>Bills</th>
              <th style={{ ...th, textAlign: 'right' }}>Net Wt</th>
              <th style={{ ...th, textAlign: 'right', borderLeft: `1px solid ${t.purple}30` }}>IGST 3%</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
              <th style={th}>By</th>
            </tr>
          </thead>
          <tbody>
            {report.einvoices.map((r, i) => {
              const stateMatch = (r.einvoice_doc_no || '').match(/^WG\/(KL|TS|AP)\//)
              const stateCode  = stateMatch?.[1] || ''
              const irnShort   = r.irn ? `${r.irn.slice(0, 12)}…` : '—'
              return (
                <ReportRow key={r.id} t={t} striped={i % 2 === 1} title={r.irn ? `IRN: ${r.irn}` : ''}>
                  <td style={{ ...td, color: t.text3, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtTS(r.einvoice_generated_at)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ color: t.purple, fontFamily: 'monospace', fontWeight: 700 }}>{r.einvoice_doc_no || '—'}</span>
                      {stateCode && (
                        <span style={{ fontSize: '9px', color: t.purple, background: `${t.purple}18`, borderRadius: '4px', padding: '2px 6px', fontWeight: 700, letterSpacing: '.06em' }}>
                          {stateCode}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* IRN — full hash on hover (row title), 12-char preview here.
                      Click-to-copy is wired so accounts can paste into GSTR-1
                      reconciliation without manual selection. */}
                  <td title={r.irn || ''} onClick={() => r.irn && navigator.clipboard?.writeText(r.irn)}
                    style={{ ...td, color: t.text2, fontFamily: 'monospace', fontSize: '10px', background: r.irn ? `${t.text4}06` : 'transparent', cursor: r.irn ? 'copy' : 'default', whiteSpace: 'nowrap' }}>
                    {irnShort}
                  </td>
                  <td style={{ ...td, color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{r.tmp_prf_no}</td>
                  <td style={{ ...td, color: t.text2 }}>{r.branch_name} <span style={{ color: t.text4 }}>→</span> HO</td>
                  <td style={{ ...td, color: t.text2, textAlign: 'right' }}>{r.total_bills}</td>
                  <td style={{ ...td, color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(r.total_net_wt)}</td>
                  <td style={{ ...td, color: t.purple, textAlign: 'right', fontFamily: 'monospace', borderLeft: `1px solid ${t.purple}20` }}>₹{fmt(Math.round(r.igst_amount || 0))}</td>
                  <td style={{ ...td, color: t.blue, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>₹{fmt(Math.round(r.total_invoice || 0))}</td>
                  <td style={{ ...td, color: t.text3, fontSize: '10px' }}>{r.generated_by || '—'}</td>
                </ReportRow>
              )
            })}
            <tr>
              <td style={{ ...totalsTd, color: t.text3, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Total</td>
              <td style={totalsTd} colSpan={4} />
              <td style={{ ...totalsTd, color: t.text1, textAlign: 'right' }}>{eiBills}</td>
              <td style={{ ...totalsTd, color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(eiWt)}</td>
              <td style={{ ...totalsTd, color: t.purple, textAlign: 'right', fontFamily: 'monospace', borderLeft: `1px solid ${t.purple}40` }}>₹{fmt(Math.round(eiIgst))}</td>
              <td style={{ ...totalsTd, color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>₹{fmt(Math.round(eiVal))}</td>
              <td style={totalsTd} />
            </tr>
          </tbody>
        </table>
      </ReportSection>
    </div>
  )
}

// Section card for a doc-type table — accent stripe on top, header with badge
// + title + subtitle, optional CSV export, body slot for the table.
function ReportSection({ t, card, accent, badge, title, subtitle, onExport, emptyText, rowCount, children }) {
  return (
    <div style={{ ...card, overflow: 'hidden', position: 'relative' }}>
      {/* Top accent stripe — 3px gradient that fades to transparent on the right */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)` }} />
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '9px', color: accent, background: `${accent}18`, borderRadius: '5px', padding: '4px 9px', fontWeight: 700, letterSpacing: '.08em' }}>{badge}</span>
        <div>
          <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>{subtitle}</div>
        </div>
        <div style={{ flex: 1 }} />
        {onExport && (
          <button onClick={onExport}
            style={{ background: 'transparent', color: t.text2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all .15s ease' }}
            onMouseEnter={e => { e.currentTarget.style.background = `${accent}10`; e.currentTarget.style.borderColor = `${accent}50`; e.currentTarget.style.color = accent }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text2 }}>
            Export CSV
          </button>
        )}
      </div>
      {rowCount === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>{emptyText}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>{children}</div>
      )}
    </div>
  )
}

// Row wrapper with a subtle hover lift — gives the tables a more interactive,
// rich feel without being noisy.
function ReportRow({ t, striped, title, children }) {
  const baseBg = striped ? `${t.text4}05` : 'transparent'
  return (
    <tr title={title}
      style={{ borderBottom: `1px solid ${t.border}25`, background: baseBg, transition: 'background .12s ease' }}
      onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
      onMouseLeave={e => e.currentTarget.style.background = baseBg}>
      {children}
    </tr>
  )
}

// Single KPI tile inside the Reports summary band. Soft top accent stripe +
// generous padding give it a card-like premium feel. Hover tints background
// in the tile's accent colour.
function ReportKpi({ t, label, primary, sub, accent, mono, small }) {
  return (
    <div style={{
      background:    t.card,
      padding:       '16px 18px 18px',
      position:      'relative',
      transition:    'background .18s ease',
    }}
      onMouseEnter={e => e.currentTarget.style.background = `${accent || t.text3}08`}
      onMouseLeave={e => e.currentTarget.style.background = t.card}>
      {/* Accent strip across the top — keeps the tiles visually grouped while
          hinting at the metric's "category colour" (gold/blue/text2). */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: accent || t.text3, opacity: .55 }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: small ? '12px' : '22px', color: accent || t.text1, fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit', letterSpacing: '-.015em', lineHeight: 1.1 }}>{primary}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '8px', fontFamily: 'monospace', letterSpacing: '.02em' }}>{sub}</div>}
    </div>
  )
}


// Efficiency tab — per-user accounts performance over a date window.
// Date controls + KPI band + sortable user table + CSV export.
// Polished card for the Approved / Rejected history list. Wraps every doc
// in a consistent layout: identity badges, source→dest hero, stats pills,
// audit avatars, doc-action chips, and (on Approved) live cancel countdowns.
// Hover tints the card subtly. Cancel chip pulses when < 1h remains so the
// operator notices a doc about to slip past the 24h NIC/IRP window.
// ApprovedFilterBar — accounts-team filter strip above the Approved list.
// Date range applies to approved_at (the audit timestamp). Doc-type segments
// narrow to EWB-only or E-Invoice-only when reconciling against a specific
// portal. Quick presets cover the common windows (today / this month / etc).
function ApprovedFilterBar({ t, card, from, setFrom, setTo, to, doc, setDoc, total }) {
  const today      = new Date().toISOString().slice(0, 10)
  const daysAgo    = (n) => { const d = new Date(); d.setDate(d.getDate() - n + 1); return d.toISOString().slice(0, 10) }
  const monthStart = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01` })()

  const presets = [
    { id: 'today',  label: 'Today',      from: today,        to: today },
    { id: '7d',     label: 'Last 7d',    from: daysAgo(7),   to: today },
    { id: '30d',    label: 'Last 30d',   from: daysAgo(30),  to: today },
    { id: 'month',  label: 'This Month', from: monthStart,   to: today },
    { id: 'all',    label: 'All time',   from: '',           to: '' },
  ]
  const activePreset = presets.find(p => p.from === from && p.to === to)?.id

  const docOptions = [
    { id: 'all',  label: 'All',        color: t.text2 },
    { id: 'ewb',  label: 'EWB only',   color: t.green },
    { id: 'einv', label: 'E-Inv only', color: t.purple },
  ]

  const windowLabel = !from && !to
    ? 'all time'
    : (from === to && from)
      ? new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : `${from ? new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'start'} → ${to ? new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'now'}`

  return (
    <div style={{ ...card, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'relative' }}>
      {/* Soft top accent strip — visual marker that this is a filter strip */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, ${t.gold}40 0%, transparent 60%)`, pointerEvents: 'none' }} />

      {/* RANGE label */}
      <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Range</span>

      {/* Date preset chips */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {presets.map(p => {
          const active = activePreset === p.id
          return (
            <button key={p.id}
              onClick={() => { setFrom(p.from); setTo(p.to) }}
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

      {/* Divider */}
      <span style={{ width: 1, height: 18, background: t.border }} />

      {/* Custom date inputs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} max={to || today}
          style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
        <span style={{ fontSize: '10px', color: t.text4 }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} min={from || undefined} max={today}
          style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '11px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
      </div>

      {/* Divider */}
      <span style={{ width: 1, height: 18, background: t.border }} />

      {/* TYPE label + Doc-type segmented toggle */}
      <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Type</span>
      <div style={{ display: 'inline-flex', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '2px' }}>
        {docOptions.map(o => {
          const active = doc === o.id
          return (
            <button key={o.id} onClick={() => setDoc(o.id)}
              style={{
                background:   active ? `${o.color}25` : 'transparent',
                color:        active ? o.color : t.text3,
                border:       'none', borderRadius: '5px',
                padding:      '4px 11px',
                fontSize:     '10.5px',
                fontWeight:   active ? 700 : 500,
                cursor:       'pointer',
                transition:   'all .12s',
                letterSpacing:'.02em',
              }}>
              {o.label}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />
      {/* Count + active window summary, right aligned. The dual-line layout
          keeps the numbers prominent without crowding the chips. */}
      <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
        <div style={{ fontSize: '13px', color: t.text1, fontWeight: 700, fontFamily: 'monospace' }}>
          {total} <span style={{ color: t.text4, fontWeight: 500, fontSize: '10px', letterSpacing: '.06em' }}>approved</span>
        </div>
        <div style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.04em', textTransform: 'uppercase' }}>{windowLabel}</div>
      </div>
    </div>
  )
}

function HistoryCard({ c, t, card, isApproved, previewDoc, showToast, openCancel }) {
  const [hover, setHover] = useState(false)
  const isType = c.movement_type === 'INTERNAL'
  const dest   = isType ? c.dest_branch : 'Head Office'

  // Time-to-decision in human form. Reused on the row pill.
  const decidedAt = c.approved_at || c.cancelled_at || c.created_at
  const ttaMs   = decidedAt && c.created_at ? new Date(decidedAt) - new Date(c.created_at) : null
  const ttaMin  = ttaMs ? Math.max(0, Math.floor(ttaMs / 60000)) : null
  const ttaLabel = ttaMin == null ? null
    : ttaMin < 60   ? `${ttaMin}m`
    : ttaMin < 1440 ? `${Math.floor(ttaMin/60)}h ${ttaMin%60}m`
    : `${Math.floor(ttaMin/1440)}d ${Math.floor((ttaMin%1440)/60)}h`

  const accent = isApproved ? t.green : t.red

  // Avatar component — small initial circle, deterministic colour per email.
  const Avatar = ({ email, size = 18 }) => {
    if (!email || email === 'unknown') return null
    return (
      <span title={email} style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: `${size}px`, height: `${size}px`, borderRadius: '50%',
        background: hashAvatarColor(email, t), color: '#fff',
        fontSize: `${Math.round(size * 0.45)}px`, fontWeight: 700, flexShrink: 0,
      }}>{email[0].toUpperCase()}</span>
    )
  }

  // Doc-preview chip used for Report / Voucher / Challan / EWB / E-Invoice.
  const DocChip = ({ label, color, onClick, title }) => (
    <button onClick={onClick} title={title}
      style={{
        background:    `${color}10`,
        border:        `1px solid ${color}40`,
        color,
        borderRadius:  '6px',
        padding:       '4px 10px',
        fontSize:      '10px',
        fontWeight:    600,
        cursor:        'pointer',
        transition:    'background .15s ease',
      }}
      onMouseEnter={e => e.currentTarget.style.background = `${color}25`}
      onMouseLeave={e => e.currentTarget.style.background = `${color}10`}>
      {label}
    </button>
  )

  // Stats pill — bills / weight / value with subtle tinted background.
  const StatPill = ({ icon, label, color }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      background: `${color}10`, border: `1px solid ${color}25`,
      borderRadius: '6px', padding: '3px 9px',
      fontSize: '11px', color, fontFamily: 'monospace', fontWeight: 600,
    }}>
      <span style={{ fontSize: '10px', opacity: 0.85 }}>{icon}</span>
      {label}
    </span>
  )

  // Cancel button + countdown chip — extracted to reuse for EWB and IRN.
  const CancelControl = ({ docKind, generatedAt, modalKey, label, expiredHelp, liveHelp }) => {
    const w = cancelWindow(generatedAt, t)
    const disabled = !w || w.expired
    const critical = w && !w.expired && w.hours < 1
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {w && (
          <span title={w.expired
              ? `Generated ${fmtTS(generatedAt)} — over 24h ago. ${expiredHelp}`
              : `Cancel before ${fmtTS(new Date(new Date(generatedAt).getTime() + 24 * 60 * 60 * 1000))}`}
            style={{
              fontSize: '10px', color: w.color, background: w.bg,
              border: `1px solid ${w.color}40`, borderRadius: '12px',
              padding: '3px 10px', fontWeight: 600, fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              animation: critical ? 'glowBreathe 1.6s ease-in-out infinite' : 'none',
            }}>
            ⏱ {w.label}
          </span>
        )}
        <button onClick={disabled ? undefined : () => openCancel(c, modalKey)}
          disabled={disabled}
          title={disabled ? expiredHelp : liveHelp}
          style={{
            background:    'transparent',
            border:        `1px solid ${disabled ? t.border : t.red + '80'}`,
            borderRadius:  '6px',
            padding:       '4px 11px',
            fontSize:      '10px',
            color:         disabled ? t.text4 : t.red,
            fontWeight:    600,
            cursor:        disabled ? 'not-allowed' : 'pointer',
            whiteSpace:    'nowrap',
            opacity:       disabled ? 0.55 : 1,
          }}>
          {label}
        </button>
      </div>
    )
  }

  return (
    <div style={{
      ...card,
      padding:      '0',
      overflow:     'hidden',
      position:     'relative',
      transition:   'background .18s ease, box-shadow .18s ease',
      background:   hover ? `${accent}06` : t.card,
      boxShadow:    hover ? `0 2px 12px ${accent}18` : 'none',
    }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      {/* Top accent stripe — green for approved, red for rejected. Fades to
          transparent so the colour cue is present without screaming. */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)`,
      }} />

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* HEADER — doc number(s) as the hero, route + stats as the title row.
            Strict 2-row hierarchy: line 1 = identity (big monospace doc nos
            with prefix labels), line 2 = source→dest + stat pills. The
            quiet metadata (TMP_PRF, BRANCH→X badge, status, TTA) is pushed
            to a separate dimmer strip below so accounts can see numbers
            first, context second. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Doc number row */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
            {(c.eway_bill_no || c.einvoice_doc_no || c.irn) ? (
              <>
                {c.eway_bill_no && (
                  <span title={`E-Way Bill ${c.eway_bill_no}\nGenerated ${fmtTS(c.ewb_generated_at)}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '9px', color: t.green, background: `${t.green}18`, border: `1px solid ${t.green}30`, borderRadius: '4px', padding: '2px 6px', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>EWB</span>
                    <span style={{ fontSize: '17px', color: t.text1, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '.01em' }}>{c.eway_bill_no}</span>
                  </span>
                )}
                {(c.einvoice_doc_no || c.irn) && (
                  <span title={c.irn ? `IRN ${c.irn}\nGenerated ${fmtTS(c.einvoice_generated_at)}` : ''}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '9px', color: t.purple, background: `${t.purple}18`, border: `1px solid ${t.purple}30`, borderRadius: '4px', padding: '2px 6px', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>E-Inv</span>
                    <span style={{ fontSize: '17px', color: t.text1, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '.01em' }}>{c.einvoice_doc_no || `${String(c.irn).slice(0, 12)}…`}</span>
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: '17px', color: t.gold, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '.01em' }}>{c.tmp_prf_no}</span>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: '9px', color: accent, background: `${accent}15`, border: `1px solid ${accent}30`, borderRadius: '99px', padding: '3px 10px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>
              {isApproved ? '✓ Approved' : '✕ Rejected'}
            </span>
          </div>

          {/* Source → dest + stats — the at-a-glance summary line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '14.5px', color: t.text1, fontWeight: 600, letterSpacing: '-.005em', display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
              <span>{c.branch_name}</span>
              <span style={{ color: t.text4, fontWeight: 300 }}>→</span>
              <span>{dest}</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <StatPill icon="◧" label={`${c.total_bills} bill${c.total_bills === 1 ? '' : 's'}`} color={t.text2} />
              <StatPill icon="⚖" label={fmtWt(c.total_net_wt)} color={t.gold} />
              <StatPill icon="₹" label={fmt(Math.round(c.total_amount))} color={t.blue} />
            </div>
          </div>

          {/* Quiet metadata strip — secondary context that accounts only
              needs occasionally (TMP_PRF, route type, time-to-decision). */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '10.5px', color: t.text4, flexWrap: 'wrap' }}>
            {(c.eway_bill_no || c.einvoice_doc_no || c.irn) && (
              <span title={`Internal tamper-proof reference`} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{c.tmp_prf_no}</span>
            )}
            <span style={{ color: isType ? t.purple : t.orange, fontWeight: 600, letterSpacing: '.04em' }}>
              {isType ? 'BRANCH → HUB' : 'BRANCH → HO'}
            </span>
            {ttaLabel && (() => {
              const slow = ttaMin > 5
              const cTta = slow ? t.red : t.text4
              return (
                <span title={`Time from creation to ${isApproved ? 'approval' : 'rejection'}${slow ? ' — over 5 minutes, slow review' : ''}`}
                  style={{ color: cTta, fontWeight: slow ? 700 : 500 }}>
                  decided in {ttaLabel}
                </span>
              )
            })()}
          </div>
        </div>

        {/* REJECTION REASON (rejected only) */}
        {!isApproved && c.rejection_reason && (
          <div style={{ fontSize: '11px', color: t.red, background: `${t.red}08`, border: `1px solid ${t.red}25`, borderRadius: '6px', padding: '8px 12px' }}>
            <span style={{ color: t.text4, marginRight: '6px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Reason:</span>
            {c.rejection_reason}
          </div>
        )}

        {/* FOOTER — audit trail (compact) + actions + cancel control.
            Single row, separated by a hairline. Audit avatars on the left,
            doc chips in the middle, cancel control aligned right so the
            countdown sits where the eye expects deadlines to live. */}
        <div style={{ borderTop: `1px solid ${t.border}50`, paddingTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Audit avatars — compact, no labels (avatar title carries email) */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: t.text4 }}>
            {c.created_by && c.created_by !== 'unknown' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }} title={`Created by ${c.created_by} on ${fmtTS(c.created_at)}`}>
                <Avatar email={c.created_by} size={16} />
                <span style={{ color: t.text3 }}>{fmtTS(c.created_at)}</span>
              </span>
            )}
            {c.approved_at && c.approved_by && (
              <>
                <span style={{ color: t.text4, opacity: 0.5 }}>·</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }} title={`${isApproved ? 'Approved' : 'Rejected'} by ${c.approved_by} on ${fmtTS(c.approved_at)}`}>
                  <Avatar email={c.approved_by} size={16} />
                  <span style={{ color: t.text3 }}>{fmtTS(c.approved_at)}</span>
                </span>
              </>
            )}
          </div>

          {/* Divider */}
          <span style={{ width: 1, height: 16, background: t.border, opacity: 0.5 }} />

          {/* Doc action chips */}
          <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap' }}>
            <DocChip label="Report"  color={t.purple} onClick={() => previewDoc(`/api/generate-consignee-report?id=${c.id}`, `Report-${c.tmp_prf_no}.jpg`, msg => showToast(msg, 'error'))} title="Preview the Consignee Report (branch-facing)" />
            <DocChip label={isType ? 'Voucher' : 'Challan'} color={t.gold}
              onClick={() => previewDoc(
                isType ? `/api/generate-issue-voucher-pdf?id=${c.id}` : `/api/generate-challan-pdf?id=${c.id}`,
                `${isType ? 'Voucher' : 'Challan'}-${c.tmp_prf_no}.pdf`,
                msg => showToast(msg, 'error'))}
              title={isType ? 'Preview the Issue Voucher PDF' : 'Preview the Delivery Challan PDF'} />
            {c.eway_bill_no && (
              <DocChip label="E-Way Bill" color={t.green}
                onClick={() => previewDoc(`/api/eway-bill/pdf?id=${c.id}`, `EWB-${c.eway_bill_no}.pdf`, msg => showToast(msg, 'error'))}
                title={`E-Way Bill ${c.eway_bill_no}\nGenerated ${fmtTS(c.ewb_generated_at)}${c.ewb_valid_until ? `\nValid till ${fmtTS(c.ewb_valid_until)}` : ''}`} />
            )}
            {c.irn && (
              <DocChip label="E-Invoice" color={t.purple}
                onClick={() => previewDoc(`/api/e-invoice/pdf?id=${c.id}`, `EInvoice-${c.tmp_prf_no}.pdf`, msg => showToast(msg, 'error'))}
                title={`E-Invoice ${c.einvoice_doc_no || ''}\nGenerated ${fmtTS(c.einvoice_generated_at)}\nIRN ${c.irn}`} />
            )}
          </div>

          <div style={{ flex: 1 }} />

          {/* Cancel controls — right-aligned where deadlines live */}
          {isApproved && c.eway_bill_no && (
            <CancelControl
              docKind="EWB"
              generatedAt={c.ewb_generated_at}
              modalKey="ewb"
              label="Cancel EWB"
              expiredHelp="NIC no longer accepts cancellation; log the EWB with accounts for GSTR-1 reconciliation."
              liveHelp="Cancel this E-Way Bill on NIC. Voids the consignment."
            />
          )}
          {isApproved && c.irn && (
            <CancelControl
              docKind="IRN"
              generatedAt={c.einvoice_generated_at}
              modalKey="irn"
              label="Cancel E-Invoice"
              expiredHelp="Cancel window has passed. Issue a Credit Note from accounts to nullify this E-Invoice in GSTR-1."
              liveHelp="Cancel this E-Invoice on IRP. Voids the consignment."
            />
          )}
        </div>
      </div>
    </div>
  )
}

// Count cell with an inline horizontal bar tinted to the column accent.
// Bar width = count / column-max × 100%. Anchors right so high-count rows
// visually 'lean toward' the number. Zero counts dim out so the live numbers
// pop on a busy table.
function BarCell({ t, count, pct, accent, td }) {
  const isZero = !count
  return (
    <td style={{ ...td, position: 'relative', textAlign: 'right' }}>
      {!isZero && (
        <div style={{
          position: 'absolute',
          right:    '8px',
          top:      '50%',
          transform: 'translateY(-50%)',
          width:    `calc(${pct}% - 16px)`,
          maxWidth: 'calc(100% - 16px)',
          height:   '4px',
          background: `${accent}30`,
          borderRadius: '2px',
          pointerEvents: 'none',
        }} />
      )}
      <span style={{
        position: 'relative',
        color:    isZero ? t.text4 : accent,
        fontFamily: 'monospace',
        fontWeight: isZero ? 400 : 700,
        fontSize:   isZero ? '12px' : '14px',
      }}>
        {isZero ? '—' : count}
      </span>
    </td>
  )
}

function EfficiencyTab({ t, card, users, from, setFrom, to, setTo, fetchEfficiency }) {
  const today      = istToday()
  const yesterday  = istDaysAgo(1)
  const last7      = istDaysAgo(6)
  const monthStart = today.slice(0, 8) + '01'
  const now        = new Date()
  const fyYear     = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const fyStart    = `${fyYear}-04-01`
  const presets = [
    { label: 'Today',       from: today,      to: today },
    { label: 'Yesterday',   from: yesterday,  to: yesterday },
    { label: 'Last 7 days', from: last7,      to: today },
    { label: 'This month',  from: monthStart, to: today },
    { label: 'This FY',     from: fyStart,    to: today },
  ]
  const isPresetActive = (p) => p.from === from && p.to === to
  const applyPreset = (p) => { setFrom(p.from); setTo(p.to); fetchEfficiency(p.from, p.to, false) }

  const [sortBy, setSortBy] = useState('total')   // total | approved | rejected | cancelled | avg
  const [sortDir, setSortDir] = useState('desc')

  const sortKey = (u) => ({
    total:     (u.approved_count || 0) + (u.rejected_count || 0) + (u.cancelled_count || 0),
    approved:  u.approved_count || 0,
    rejected:  u.rejected_count || 0,
    cancelled: u.cancelled_count || 0,
    avg:       u.avg_min ?? Number.MAX_SAFE_INTEGER,   // null avgs sort last
  })[sortBy] ?? 0
  const sortedUsers = [...users].sort((a, b) => {
    const da = sortKey(a); const db = sortKey(b)
    return sortDir === 'asc' ? da - db : db - da
  })
  const toggleSort = (k) => {
    if (sortBy === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(k); setSortDir(k === 'avg' ? 'asc' : 'desc') }   // avg defaults asc (faster first)
  }
  const sortIndicator = (k) => sortBy === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  // Time colour: matches the > 5min red rule on Approved tab cards.
  // ≤ 5min muted (default), > 5min red.
  const timeColor = (mins) => {
    if (mins == null) return t.text4
    return mins > 5 ? t.red : t.text2
  }

  // Avatar colour pulls from the shared hashAvatarColor helper so the same
  // person carries the same colour across Efficiency table, Approved cards,
  // and any future avatar usage.
  const avatarColor = (email) => hashAvatarColor(email, t)

  // Maxes per column for the inline proportional bars. Floor at 1 so a
  // single-row table doesn't divide by zero.
  const maxApproved  = Math.max(1, ...users.map(u => u.approved_count  || 0))
  const maxRejected  = Math.max(1, ...users.map(u => u.rejected_count  || 0))
  const maxCancelled = Math.max(1, ...users.map(u => u.cancelled_count || 0))

  // Top performer for the ★ Fastest ribbon — lowest avg with ≥3 samples to
  // discount single-decision winners.
  const fastestUser = users
    .filter(u => ((u.approved_count || 0) + (u.rejected_count || 0)) >= 3 && u.avg_min != null)
    .sort((a, b) => a.avg_min - b.avg_min)[0]

  // Team totals row — sum counts, weight-average the avg across all users
  // (weighted by their decision count), and overall min/max.
  const teamTotal = users.reduce((acc, u) => {
    acc.approved  += u.approved_count  || 0
    acc.rejected  += u.rejected_count  || 0
    acc.cancelled += u.cancelled_count || 0
    const decisions = (u.approved_count || 0) + (u.rejected_count || 0)
    if (u.avg_min != null && decisions > 0) {
      acc.avgWeightedSum += u.avg_min * decisions
      acc.avgWeightedDen += decisions
    }
    if (u.min_min != null) acc.minMin = acc.minMin == null ? u.min_min : Math.min(acc.minMin, u.min_min)
    if (u.max_min != null) acc.maxMax = acc.maxMax == null ? u.max_min : Math.max(acc.maxMax, u.max_min)
    return acc
  }, { approved: 0, rejected: 0, cancelled: 0, avgWeightedSum: 0, avgWeightedDen: 0, minMin: null, maxMax: null })
  const teamAvg = teamTotal.avgWeightedDen > 0 ? Math.round(teamTotal.avgWeightedSum / teamTotal.avgWeightedDen) : null

  // CSV export — one row per user, 7 columns.
  const dateTag = from === to ? from : `${from}_to_${to}`
  const exportCsv = () => {
    if (!users.length) return
    const rows = users.map(u => ({
      User:        u.email,
      'Avg (m)':   u.avg_min ?? '',
      'Min (m)':   u.min_min ?? '',
      'Max (m)':   u.max_min ?? '',
      Approved:    u.approved_count,
      Rejected:    u.rejected_count,
      Cancelled:   u.cancelled_count,
    }))
    const headers = Object.keys(rows[0])
    const escape  = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `efficiency_${dateTag}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const windowLabel = from === to
    ? new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : `${new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} → ${new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`

  const th = { padding: '11px 14px', textAlign: 'left', fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
  const thStatic = { ...th, cursor: 'default' }
  const td = { padding: '12px 14px', verticalAlign: 'middle', fontSize: '12px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Date controls */}
      <div style={{ ...card }}>
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Reporting window</div>
            <div style={{ fontSize: '14px', color: t.text1, fontWeight: 600, marginTop: '3px', fontFamily: 'monospace', letterSpacing: '-.01em' }}>{windowLabel}</div>
          </div>
          <div style={{ width: '1px', height: '32px', background: t.border }} />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presets.map(p => {
              const active = isPresetActive(p)
              return (
                <button key={p.label} onClick={() => applyPreset(p)}
                  style={{ background: active ? t.gold : 'transparent', color: active ? '#1a0a00' : t.text3,
                    border: `1px solid ${active ? t.gold : t.border}`, boxShadow: active ? `0 1px 4px ${t.gold}40` : 'none',
                    borderRadius: '16px', padding: '5px 14px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all .15s ease' }}>
                  {p.label}
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} max={today}
              style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '12px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
            <span style={{ fontSize: '11px', color: t.text4 }}>→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} max={today}
              style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '12px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
            <button onClick={() => fetchEfficiency(from, to, false)}
              style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '7px 16px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', boxShadow: `0 1px 4px ${t.gold}50` }}>
              Run
            </button>
          </div>
        </div>
      </div>

      {/* User table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>Per-user activity</div>
            <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>Time = created → decision (same number shown as the &quot;in Xm&quot; pill on Approved cards). Avg/min/max across approved + rejected.</div>
          </div>
          <div style={{ flex: 1 }} />
          {users.length > 0 && (
            <button onClick={exportCsv}
              style={{ background: 'transparent', color: t.text2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
              Export CSV
            </button>
          )}
        </div>
        {users.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>No accounts activity in this window.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: t.card2 || t.card }}>
                  <th style={thStatic}>User</th>
                  <th style={{ ...th, textAlign: 'right' }} onClick={() => toggleSort('avg')}       title="Click to sort">Average{sortIndicator('avg')}</th>
                  <th style={{ ...thStatic, textAlign: 'right' }}>Minimum</th>
                  <th style={{ ...thStatic, textAlign: 'right' }}>Maximum</th>
                  <th style={{ ...th, textAlign: 'right' }} onClick={() => toggleSort('approved')}  title="Click to sort">Approved{sortIndicator('approved')}</th>
                  <th style={{ ...th, textAlign: 'right' }} onClick={() => toggleSort('rejected')}  title="Click to sort">Rejected{sortIndicator('rejected')}</th>
                  <th style={{ ...th, textAlign: 'right' }} onClick={() => toggleSort('cancelled')} title="Click to sort">Cancelled{sortIndicator('cancelled')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((u, i) => {
                  const isFastest = fastestUser && u.email === fastestUser.email
                  const initial   = (u.email || '?')[0].toUpperCase()
                  const aPct = ((u.approved_count  || 0) / maxApproved)  * 100
                  const rPct = ((u.rejected_count  || 0) / maxRejected)  * 100
                  const cPct = ((u.cancelled_count || 0) / maxCancelled) * 100
                  return (
                    <tr key={u.email}
                      style={{
                        borderBottom: `1px solid ${t.border}25`,
                        background:   i % 2 ? `${t.text4}05` : 'transparent',
                        borderLeft:   isFastest ? `3px solid ${t.gold}` : '3px solid transparent',
                        transition:   'background .15s ease',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = `${t.gold}0A`}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 ? `${t.text4}05` : 'transparent'}>
                      {/* User column — avatar + email + ★ Fastest ribbon when applicable. */}
                      <td style={{ ...td }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{
                            width: '28px', height: '28px', borderRadius: '50%',
                            background: avatarColor(u.email), color: '#fff',
                            fontSize: '12px', fontWeight: 700, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, fontFamily: 'inherit',
                          }}>{initial}</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                            <span style={{ color: t.text1, fontWeight: 600, fontSize: '12px' }}>{u.email}</span>
                            {isFastest && (
                              <span style={{
                                alignSelf: 'flex-start',
                                fontSize: '9px', color: t.gold, background: `${t.gold}15`,
                                border: `1px solid ${t.gold}40`,
                                borderRadius: '10px', padding: '1px 8px',
                                fontWeight: 600, letterSpacing: '.05em',
                              }} title={`Fastest avg in this window — ${u.avg_min}m across ${(u.approved_count || 0) + (u.rejected_count || 0)} decisions`}>
                                ★ FASTEST
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, color: timeColor(u.avg_min), textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: '14px' }}>
                        {u.avg_min != null ? `${u.avg_min}m` : <span style={{ color: t.text4 }}>—</span>}
                      </td>
                      <td style={{ ...td, color: u.min_min != null ? t.text3 : t.text4, textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>
                        {u.min_min != null ? `${u.min_min}m` : '—'}
                      </td>
                      <td style={{ ...td, color: timeColor(u.max_min), textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>
                        {u.max_min != null ? `${u.max_min}m` : '—'}
                      </td>
                      <BarCell t={t} count={u.approved_count}  pct={aPct} accent={t.green}  td={td} />
                      <BarCell t={t} count={u.rejected_count}  pct={rPct} accent={t.red}    td={td} />
                      <BarCell t={t} count={u.cancelled_count} pct={cPct} accent={t.orange} td={td} />
                    </tr>
                  )
                })}
                {/* Team totals row */}
                {sortedUsers.length > 1 && (
                  <tr style={{ borderTop: `2px solid ${t.gold}40`, background: `${t.gold}08` }}>
                    <td style={{ ...td, color: t.gold, fontWeight: 700, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase' }}>Team total</td>
                    <td style={{ ...td, color: timeColor(teamAvg),   textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: '14px' }}>{teamAvg != null ? `${teamAvg}m` : '—'}</td>
                    <td style={{ ...td, color: t.text3,              textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>{teamTotal.minMin != null ? `${teamTotal.minMin}m` : '—'}</td>
                    <td style={{ ...td, color: timeColor(teamTotal.maxMax), textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>{teamTotal.maxMax != null ? `${teamTotal.maxMax}m` : '—'}</td>
                    <td style={{ ...td, color: t.green,  textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: '14px' }}>{teamTotal.approved}</td>
                    <td style={{ ...td, color: t.red,    textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: '14px' }}>{teamTotal.rejected}</td>
                    <td style={{ ...td, color: t.orange, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: '14px' }}>{teamTotal.cancelled}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// All Indian state codes — name + code. Used for the 'add new state' dropdown.
// Code = the 2-char prefix on GSTINs and on per-state E-Invoice numbers.
const INDIAN_STATES = [
  { code: 'AN', name: 'Andaman & Nicobar' },     { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'AR', name: 'Arunachal Pradesh' },     { code: 'AS', name: 'Assam' },
  { code: 'BR', name: 'Bihar' },                 { code: 'CG', name: 'Chhattisgarh' },
  { code: 'CH', name: 'Chandigarh' },            { code: 'DD', name: 'Daman & Diu' },
  { code: 'DL', name: 'Delhi' },                 { code: 'DN', name: 'Dadra & Nagar Haveli' },
  { code: 'GA', name: 'Goa' },                   { code: 'GJ', name: 'Gujarat' },
  { code: 'HP', name: 'Himachal Pradesh' },      { code: 'HR', name: 'Haryana' },
  { code: 'JH', name: 'Jharkhand' },             { code: 'JK', name: 'Jammu & Kashmir' },
  { code: 'KA', name: 'Karnataka' },             { code: 'KL', name: 'Kerala' },
  { code: 'LA', name: 'Ladakh' },                { code: 'LD', name: 'Lakshadweep' },
  { code: 'MH', name: 'Maharashtra' },           { code: 'ML', name: 'Meghalaya' },
  { code: 'MN', name: 'Manipur' },               { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'MZ', name: 'Mizoram' },               { code: 'NL', name: 'Nagaland' },
  { code: 'OD', name: 'Odisha' },                { code: 'PB', name: 'Punjab' },
  { code: 'PY', name: 'Puducherry' },            { code: 'RJ', name: 'Rajasthan' },
  { code: 'SK', name: 'Sikkim' },                { code: 'TG', name: 'Telangana (alt)' },
  { code: 'TN', name: 'Tamil Nadu' },            { code: 'TR', name: 'Tripura' },
  { code: 'TS', name: 'Telangana' },             { code: 'UK', name: 'Uttarakhand (alt)' },
  { code: 'UP', name: 'Uttar Pradesh' },         { code: 'UT', name: 'Uttarakhand' },
  { code: 'WB', name: 'West Bengal' },
]
const STATE_NAME_BY_CODE = Object.fromEntries(INDIAN_STATES.map(s => [s.code, s.name]))

// Settings tab — instructions panel, per-state cards (GSTIN + sequence
// combined), and an 'add new state' affordance. Add / remove gives ops a
// self-service path when a new state goes live, no schema migration needed.
function SettingsTab({ t, card, settings, settingsBusy, settingsToast, saveSeq, saveGstin, addState, removeState, openConfirm }) {
  // Build the merged per-state list. Every state in `gstins` gets a card.
  // Sequences for non-KA states are matched by code; KA gets no sequence
  // (E-Invoices aren't issued for KA-source consignments).
  const fy = settings?.fy
  const seqByState = Object.fromEntries((settings?.sequences || []).map(s => [s.state_code, s]))
  const stateRows = Object.entries(settings?.gstins || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, gstin]) => ({
      code,
      name: STATE_NAME_BY_CODE[code] || code,
      gstin: gstin || '',
      seq: code === 'KA' ? null : (seqByState[code] || { state_code: code, fy_code: fy, last_seq: 0, next_no: `WG/${code}/${fy}/1`, exists: false }),
    }))

  // States not yet configured — used to populate the 'add new state' dropdown.
  const usedCodes = new Set(stateRows.map(r => r.code))
  const availableStates = INDIAN_STATES.filter(s => !usedCodes.has(s.code))

  const [showAdd, setShowAdd] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {settingsToast && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: settingsToast.type === 'success' ? `${t.green}15` : `${t.red}15`, border: `1px solid ${settingsToast.type === 'success' ? t.green : t.red}40`, fontSize: '12px', color: settingsToast.type === 'success' ? t.green : t.red }}>
          {settingsToast.msg}
        </div>
      )}

      {/* Instructions panel */}
      <div style={{ ...card, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${t.gold} 0%, ${t.gold}30 60%, transparent 100%)` }} />
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, fontSize: '13px', color: t.text1, fontWeight: 600 }}>
          When are E-Way Bill and E-Invoice issued?
        </div>
        <div style={{ padding: '14px 18px', fontSize: '12px', color: t.text2, lineHeight: 1.7 }}>
          <div style={{ marginBottom: '10px' }}>
            <span style={{ display: 'inline-block', minWidth: '90px', fontSize: '9px', color: t.green, background: `${t.green}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.04em', textAlign: 'center', marginRight: '10px' }}>EWB</span>
            <strong>Karnataka source → Karnataka HO</strong> (intrastate own-use, value &gt; ₹50,000) and <strong>Branch → Hub</strong> internal moves. Same legal entity, same GSTIN. Sub-supply: <code style={{ color: t.gold, background: 'transparent' }}>OWN_USE</code>.
          </div>
          <div style={{ marginBottom: '10px' }}>
            <span style={{ display: 'inline-block', minWidth: '90px', fontSize: '9px', color: t.purple, background: `${t.purple}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.04em', textAlign: 'center', marginRight: '10px' }}>E-INV</span>
            <strong>Non-Karnataka source → Karnataka HO</strong> (interstate sale, B2B). Different state-wise GSTINs are mandatory — IRP rejects matching seller/buyer GSTINs.
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${t.border}` }}>
            <strong style={{ color: t.text2 }}>Workflow order:</strong> Consignee Report → Issue Voucher / Delivery Challan → EWB / E-Invoice. Each step unlocks the next; you can&apos;t fire NIC / IRP before the underlying physical document exists.
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '6px' }}>
            <strong style={{ color: t.text2 }}>Cancel window:</strong> 24 hours after generation on both NIC and IRP. Past 24h, an E-Invoice can be nullified via Credit Note (Typ: CRN); an E-Way Bill cannot be retracted, only logged for reconciliation.
          </div>
        </div>
      </div>

      {/* Per-state configuration */}
      <div style={{ ...card, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${t.purple} 0%, ${t.purple}30 60%, transparent 100%)` }} />
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>State configuration</div>
            <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>One card per state. Edit GSTIN + invoice sequence inline. Add new states when they go live.</div>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '11px', color: t.text4 }}>FY {fy || '—'}</span>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {stateRows.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>
              No states configured yet. Click <strong>Add state</strong> below to start.
            </div>
          )}
          {stateRows.map(row => (
            <StateCard
              key={row.code}
              t={t}
              row={row}
              busy={settingsBusy}
              saveGstin={saveGstin}
              saveSeq={saveSeq}
              removeState={removeState}
              openConfirm={openConfirm}
            />
          ))}

          {/* Add-state affordance */}
          {!showAdd ? (
            <button onClick={() => setShowAdd(true)} disabled={availableStates.length === 0}
              style={{
                background: 'transparent', border: `1.5px dashed ${t.border}`,
                borderRadius: '10px', padding: '14px',
                fontSize: '12px', color: availableStates.length === 0 ? t.text4 : t.text2,
                fontWeight: 600, cursor: availableStates.length === 0 ? 'not-allowed' : 'pointer',
                transition: 'background .15s ease, border-color .15s ease',
              }}
              onMouseEnter={e => { if (availableStates.length) { e.currentTarget.style.background = `${t.gold}08`; e.currentTarget.style.borderColor = t.gold } }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = t.border }}>
              {availableStates.length === 0 ? 'All Indian states already configured' : '＋  Add new state'}
            </button>
          ) : (
            <AddStateForm
              t={t}
              availableStates={availableStates}
              busyKey={settingsBusy}
              onAdd={async (code, gstin, last_seq) => {
                const ok = await addState(code, gstin, last_seq)
                if (ok) setShowAdd(false)
              }}
              onCancel={() => setShowAdd(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// 15-char GSTIN regex — re-used for the live ✓ format-valid icon.
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

// State-to-GSTN-prefix lookup — first 2 digits of a GSTIN must match the
// state. We surface a soft warning (not a block) when the prefix doesn't
// match the state code, since accounts is responsible for the source data.
const STATE_GSTIN_PREFIX = {
  AN:'35', AP:'37', AR:'12', AS:'18', BR:'10', CG:'22', CH:'04', DD:'25',
  DL:'07', DN:'26', GA:'30', GJ:'24', HP:'02', HR:'06', JH:'20', JK:'01',
  KA:'29', KL:'32', LA:'38', LD:'31', MH:'27', ML:'17', MN:'14', MP:'23',
  MZ:'15', NL:'13', OD:'21', OR:'21', PB:'03', PY:'34', RJ:'08', SK:'11',
  TG:'36', TN:'33', TR:'16', TS:'36', UK:'05', UP:'09', UT:'05', WB:'19',
}

// Per-state card — polished. Top accent stripe, hover lift, inline format
// validation on GSTIN, two-column body on wide screens, single 'Save changes'
// footer button that activates when ANY field is dirty.
function StateCard({ t, row, busy, saveGstin, saveSeq, removeState, openConfirm }) {
  const [gstinVal, setGstinVal] = useState(row.gstin || '')
  const [seqVal,   setSeqVal]   = useState(String(row.seq?.last_seq ?? 0))
  const [hover,    setHover]    = useState(false)
  useEffect(() => { setGstinVal(row.gstin || '') }, [row.gstin])
  useEffect(() => { setSeqVal(String(row.seq?.last_seq ?? 0)) }, [row.seq?.last_seq])

  const gstinDirty = gstinVal.trim().toUpperCase() !== (row.gstin || '').toUpperCase()
  const seqDirty   = row.seq != null && String(seqVal) !== String(row.seq.last_seq)
  const anyDirty   = gstinDirty || seqDirty
  const gstinBusy  = busy === `gstin:${row.code}`
  const seqBusy    = busy === `seq:${row.code}`
  const removeBusy = busy === `remove:${row.code}`
  const saving     = gstinBusy || seqBusy

  const isKA = row.code === 'KA'
  const accent = isKA ? t.gold : t.purple

  const gstinValid     = !gstinVal || GSTIN_REGEX.test(gstinVal.trim().toUpperCase())
  const expectedPrefix = STATE_GSTIN_PREFIX[row.code]
  const prefixMatch    = !gstinVal || !expectedPrefix || gstinVal.trim().slice(0, 2) === expectedPrefix

  const onRemove = async () => {
    const ok = await openConfirm({
      title: `Remove ${row.code} – ${STATE_NAME_BY_CODE[row.code] || row.code}?`,
      message: `Removes the GSTIN and ${row.seq ? 'every E-Invoice sequence row ' : ''}for this state. ${row.seq?.last_seq ? `Current last invoice (${row.seq.last_seq}) will be lost — re-add later if needed.` : ''}`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (ok) removeState(row.code)
  }

  // Save handler — fires only the dirty mutations, in parallel.
  const saveAll = async () => {
    const promises = []
    if (gstinDirty) promises.push(saveGstin(row.code, gstinVal.trim()))
    if (seqDirty)   promises.push(saveSeq(row.code, row.seq.fy_code, parseInt(seqVal) || 0))
    await Promise.all(promises)
  }

  const nextPreview = row.seq
    ? `WG/${row.code}/${row.seq.fy_code}/${(parseInt(seqVal) || 0) + 1}`
    : null

  // Card-level styles
  const baseBg = t.card2 || t.card
  const hoverBg = `${accent}06`

  return (
    <div style={{
      position:     'relative',
      border:       `1px solid ${hover ? `${accent}40` : t.border}`,
      borderRadius: '12px',
      background:   hover ? hoverBg : baseBg,
      overflow:     'hidden',
      boxShadow:    hover ? `0 2px 12px ${accent}18` : 'none',
      transition:   'background .18s ease, border-color .18s ease, box-shadow .18s ease',
    }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      {/* Top accent stripe — gold for KA, purple for everyone else */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)`,
      }} />

      {/* Header — pill + name + read-only metadata + remove */}
      <div style={{ padding: '14px 18px 12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: '40px', height: '32px', padding: '0 12px',
          fontSize: '13px', fontWeight: 700, letterSpacing: '.06em',
          color: accent, background: `${accent}18`, border: `1px solid ${accent}50`,
          borderRadius: '7px', fontFamily: 'monospace',
        }}>{row.code}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '15px', color: t.text1, fontWeight: 600, letterSpacing: '-.005em' }}>
              {STATE_NAME_BY_CODE[row.code] || row.code}
            </span>
            {isKA && (
              <span style={{ fontSize: '9px', color: t.gold, background: `${t.gold}10`, border: `1px solid ${t.gold}30`, borderRadius: '4px', padding: '2px 8px', fontWeight: 700, letterSpacing: '.05em' }}>HO BUYER</span>
            )}
          </div>
          <div style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {row.gstin && <span>{row.gstin}</span>}
            {row.seq && <span>Format: WG/{row.code}/{row.seq.fy_code}/##</span>}
            {isKA && !row.seq && <span>Read-only — used as the buyer GSTIN on every E-Invoice</span>}
          </div>
        </div>
        {!isKA && (
          <button onClick={onRemove} disabled={removeBusy}
            title={`Remove ${row.code}`}
            style={{
              background: 'transparent', border: `1px solid ${t.red}40`,
              borderRadius: '7px', padding: '6px 11px',
              fontSize: '11px', color: t.red, fontWeight: 600, cursor: removeBusy ? 'wait' : 'pointer',
              opacity: removeBusy ? 0.6 : 1,
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              transition: 'background .15s ease',
            }}
            onMouseEnter={e => { if (!removeBusy) e.currentTarget.style.background = `${t.red}10` }}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            {removeBusy ? '…' : <><span style={{ fontSize: '12px' }}>🗑</span> Remove</>}
          </button>
        )}
      </div>

      {/* Body — two-column grid (GSTIN + sequence) on wide screens, stacks on narrow.
          KA gets a single full-width column for GSTIN since it has no sequence. */}
      <div style={{
        padding:             '4px 18px 16px',
        display:             'grid',
        gridTemplateColumns: row.seq ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
        gap:                 '16px',
      }}>
        {/* GSTIN field group */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>GSTIN</span>
            {gstinVal && (
              <span style={{ fontSize: '10px', color: gstinValid && prefixMatch ? t.green : t.orange, fontFamily: 'monospace' }}>
                {gstinValid && prefixMatch ? '✓ valid'
                  : !gstinValid ? `${gstinVal.length}/15`
                  : `prefix should be ${expectedPrefix}`}
              </span>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <input value={gstinVal} onChange={e => setGstinVal(e.target.value.toUpperCase())} disabled={gstinBusy}
              placeholder={expectedPrefix ? `${expectedPrefix}AAAAA0000A1Z5` : '22AAAAA0000A1Z5'} maxLength={15}
              style={{
                width: '100%',
                background: t.card,
                border: `1.5px solid ${gstinDirty ? t.gold : (gstinVal && !gstinValid ? t.orange + '60' : t.border)}`,
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '13px',
                color: t.text1,
                fontFamily: 'monospace',
                fontWeight: 600,
                letterSpacing: '.06em',
                outline: 'none',
                transition: 'border-color .15s ease, box-shadow .15s ease',
                boxShadow: gstinDirty ? `0 0 0 3px ${t.gold}20` : 'none',
              }}
              onFocus={e => e.currentTarget.style.boxShadow = `0 0 0 3px ${(gstinDirty ? t.gold : accent)}25`}
              onBlur={e =>  e.currentTarget.style.boxShadow = gstinDirty ? `0 0 0 3px ${t.gold}20` : 'none'} />
          </div>
        </div>

        {/* Last invoice / sequence field group — KA excluded */}
        {row.seq && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Last invoice number</span>
              {nextPreview && (
                <span style={{ fontSize: '10px', color: seqDirty ? t.gold : t.text3, fontFamily: 'monospace', fontWeight: seqDirty ? 700 : 400 }}>
                  Next → <span style={{ color: seqDirty ? t.gold : t.text2 }}>{nextPreview}</span>
                </span>
              )}
            </div>
            <input type="number" min="0" value={seqVal} onChange={e => setSeqVal(e.target.value)} disabled={seqBusy}
              style={{
                width: '100%',
                background: t.card,
                border: `1.5px solid ${seqDirty ? t.gold : t.border}`,
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '13px',
                color: t.text1,
                fontFamily: 'monospace',
                fontWeight: 600,
                outline: 'none',
                transition: 'border-color .15s ease, box-shadow .15s ease',
                boxShadow: seqDirty ? `0 0 0 3px ${t.gold}20` : 'none',
              }}
              onFocus={e => e.currentTarget.style.boxShadow = `0 0 0 3px ${(seqDirty ? t.gold : accent)}25`}
              onBlur={e =>  e.currentTarget.style.boxShadow = seqDirty ? `0 0 0 3px ${t.gold}20` : 'none'} />
          </div>
        )}
      </div>

      {/* Footer — single Save button when anything is dirty */}
      {anyDirty && (
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${t.border}`, background: `${t.gold}05`, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', color: t.text3, flex: 1 }}>
            <span style={{ color: t.gold, fontWeight: 600 }}>●</span>{' '}
            Unsaved changes
            {gstinDirty && seqDirty ? ' to GSTIN and last invoice'
              : gstinDirty           ? ' to GSTIN'
              : seqDirty             ? ' to last invoice'
              : ''}
          </span>
          <button onClick={() => { setGstinVal(row.gstin || ''); setSeqVal(String(row.seq?.last_seq ?? 0)) }}
            disabled={saving}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 14px', fontSize: '11px', color: t.text3, cursor: saving ? 'wait' : 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={saveAll} disabled={saving}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '6px', padding: '7px 18px', fontSize: '11px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', boxShadow: `0 1px 4px ${t.gold}50`, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

// Form for adding a new state — slides in below the state cards when the
// operator clicks 'Add new state'. State picker + GSTIN + opening invoice
// number, with an Add / Cancel pair at the bottom.
function AddStateForm({ t, availableStates, busyKey, onAdd, onCancel }) {
  const [code, setCode]       = useState(availableStates[0]?.code || '')
  const [gstin, setGstin]     = useState('')
  const [lastSeq, setLastSeq] = useState('0')
  const busy = busyKey?.startsWith('add:')
  const canSubmit = code && gstin.trim().length === 15 && !busy

  return (
    <div style={{
      border: `1.5px solid ${t.gold}`, background: `${t.gold}06`,
      borderRadius: '10px', padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      <div style={{ fontSize: '12px', color: t.gold, fontWeight: 700, letterSpacing: '.04em' }}>Add new state</div>

      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>State</span>
        <select value={code} onChange={e => setCode(e.target.value)} disabled={busy}
          style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', fontSize: '12px', color: t.text1, outline: 'none', maxWidth: '320px' }}>
          {availableStates.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>GSTIN</span>
        <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} disabled={busy}
          placeholder="22AAAAA0000A1Z5" maxLength={15}
          style={{ width: '100%', maxWidth: '320px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', fontSize: '12px', color: t.text1, fontFamily: 'monospace', outline: 'none', letterSpacing: '.05em' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Last invoice</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="number" min="0" value={lastSeq} onChange={e => setLastSeq(e.target.value)} disabled={busy}
            style={{ width: '100px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', fontSize: '12px', color: t.text1, fontFamily: 'monospace', outline: 'none' }} />
          <span style={{ fontSize: '10px', color: t.text4 }}>0 if you&apos;re starting fresh</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
        <button onClick={onCancel} disabled={busy}
          style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 16px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={() => canSubmit && onAdd(code, gstin.trim(), parseInt(lastSeq) || 0)} disabled={!canSubmit}
          style={{ background: canSubmit ? t.gold : 'transparent', color: canSubmit ? '#1a0a00' : t.text4, border: `1px solid ${canSubmit ? t.gold : t.border}`, borderRadius: '6px', padding: '7px 18px', fontSize: '11px', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {busy ? 'Adding…' : 'Add state'}
        </button>
      </div>
    </div>
  )
}

function PreviewKpi({ t, label, value, accent }) {
  return (
    <div style={{ background: t.card, padding: '11px 14px' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '15px', color: accent, fontFamily: 'monospace', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function PartyCard({ t, title, party }) {
  if (!party) return null
  return (
    <div style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 14px' }}>
      <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: t.gold, marginBottom: '4px' }}>{party.gstin || '—'}</div>
      <div style={{ fontSize: '11px', color: t.text1, fontWeight: 600, marginBottom: '2px' }}>{party.legal_name || '—'}</div>
      <div style={{ fontSize: '10px', color: t.text2, lineHeight: 1.5 }}>
        {party.address1}{party.address2 ? ` ${party.address2}` : ''}
      </div>
      <div style={{ fontSize: '10px', color: t.text3, marginTop: '4px' }}>
        {party.location ? `${party.location} · ` : ''}{party.pin ? `PIN ${party.pin}` : ''}{party.state_code ? ` · ${party.state_code}` : ''}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel modal — calls our cancel API which talks to NIC. If NIC says past 24h,
// we offer Credit Note (E-Invoice only) as the GST-compliant alternative.
// ─────────────────────────────────────────────────────────────────────────────
function CancelModal({ state, t, onChange, onClose, onConfirm, onCreditNote }) {
  const { type, consignment: c, reasonCode, remark, busy, error, suggestCreditNote, ewbPast24h } = state
  const isEwb = type === 'ewb'
  const docName = isEwb ? 'E-Way Bill' : 'E-Invoice'
  const docNo = isEwb ? c.eway_bill_no : c.irn
  const REASONS = isEwb ? [
    { code: '1', label: 'Duplicate' },
    { code: '2', label: 'Order Cancelled' },
    { code: '3', label: 'Data Entry Mistake' },
    { code: '4', label: 'Others' },
  ] : [
    { code: '1', label: 'Duplicate' },
    { code: '2', label: 'Data Entry Mistake' },
    { code: '3', label: 'Order Cancelled' },
    { code: '4', label: 'Others' },
  ]

  if (typeof document === 'undefined') return null
  return createPortal((
    <div onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px', overflow: 'hidden' }}>
      <div style={{ background: t.card, border: `1px solid ${t.red}40`, borderRadius: '12px', width: '100%', maxWidth: '480px', maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.6)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: '1.05rem', color: t.red, fontWeight: 600 }}>Cancel {docName}</div>
          <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '4px' }}>
            {c.tmp_prf_no} · {docNo}
          </div>
        </div>

        <div style={{ padding: '18px 22px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {!suggestCreditNote && (
            <>
              <div style={{ fontSize: '11px', color: t.text2, marginBottom: '14px', lineHeight: 1.5 }}>
                Cancelling on {isEwb ? 'NIC E-Way Bill portal' : 'IRP / E-Invoice portal'}. Must be within <strong style={{ color: t.orange }}>24 hours</strong> of generation. Once cancelled, you cannot un-cancel — you'd have to regenerate a new one.
              </div>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '5px' }}>Reason</div>
                <select value={reasonCode} onChange={e => onChange({ reasonCode: e.target.value })} disabled={busy}
                  style={{ width: '100%', background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '8px 10px', color: t.text1, fontSize: '12px', outline: 'none' }}>
                  {REASONS.map(r => <option key={r.code} value={r.code}>{r.code} — {r.label}</option>)}
                </select>
              </div>

              <div>
                <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '5px' }}>Remark <span style={{ color: t.text4, textTransform: 'none', letterSpacing: 'normal' }}>(optional)</span></div>
                <input type="text" value={remark} onChange={e => onChange({ remark: e.target.value })} disabled={busy}
                  placeholder={`Reason for cancellation`}
                  style={{ width: '100%', background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '8px 10px', color: t.text1, fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </>
          )}

          {error && (
            <div style={{ background: `${t.red}15`, border: `1px solid ${t.red}40`, borderRadius: '7px', padding: '10px 14px', fontSize: '11px', color: t.red, marginTop: '14px' }}>
              {error}
            </div>
          )}

          {suggestCreditNote && (
            <div style={{ background: `${t.orange}10`, border: `1px solid ${t.orange}40`, borderRadius: '8px', padding: '14px', marginTop: '14px' }}>
              <div style={{ fontSize: '12px', color: t.orange, fontWeight: 600, marginBottom: '6px' }}>Past the 24-hour cancellation window</div>
              <div style={{ fontSize: '11px', color: t.text2, lineHeight: 1.6, marginBottom: '10px' }}>
                NIC won't accept the cancellation now. To nullify this E-Invoice in your GSTR-1, you can issue a <strong style={{ color: t.orange }}>Credit Note</strong> against it. Both the original IRN and the credit note will appear in your filings — net effect on tax: zero.
              </div>
              <div style={{ fontSize: '10px', color: t.text3, lineHeight: 1.5 }}>
                The credit note's IRN will be registered with IRP automatically. Talk to your CA about how to mark this in the next return cycle.
              </div>
            </div>
          )}

          {ewbPast24h && (
            <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '8px', padding: '14px', marginTop: '14px' }}>
              <div style={{ fontSize: '12px', color: t.red, fontWeight: 600, marginBottom: '6px' }}>Past the 24-hour cancellation window</div>
              <div style={{ fontSize: '11px', color: t.text2, lineHeight: 1.6, marginBottom: '10px' }}>
                NIC will not accept this E-Way Bill cancellation anymore. Unlike E-Invoices, EWBs have no <strong>Credit Note</strong> equivalent — they're transport documents only, not tax documents.
              </div>
              <div style={{ fontSize: '10px', color: t.text3, lineHeight: 1.5 }}>
                Action: log this EWB number with accounts. They'll record it in the GSTR-1 reconciliation as an issued-but-unused EWB. Since EWBs don't drive tax computation, there's no GST impact — only documentation.
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <button onClick={onClose} disabled={busy}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 16px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
            Close
          </button>
          {suggestCreditNote ? (
            <button onClick={onCreditNote} disabled={busy}
              style={{ background: t.orange, color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 18px', fontSize: '11px', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Generating…' : 'Generate Credit Note'}
            </button>
          ) : (
            <button onClick={onConfirm} disabled={busy}
              style={{ background: t.red, color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 18px', fontSize: '11px', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Cancelling…' : `Cancel ${docName}`}
            </button>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}
