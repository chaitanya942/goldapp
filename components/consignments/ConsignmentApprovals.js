'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import { supabase as supabaseClient } from '../../lib/supabase'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { openConfirm, openPrompt } from '../ui/ConfirmDialog'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtTS = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

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
  // 'approved' and 'rejected' are read-only audit trails for the last 30 days.
  const [tab, setTab] = useState('pending')

  const [pending, setPending] = useState([])
  const [history, setHistory] = useState([])  // approved or rejected, depending on tab
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [toast, setToast] = useState(null)
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
    const r = await authedFetch(`/api/consignments?action=approval_history&status=${status}&days=30`)
    const j = await r.json()
    setHistory(j.data || [])
    setLoading(false)
  }, [])

  // Initial fetch + refetch when the user switches tabs.
  useEffect(() => {
    if (tab === 'pending') fetchPending()
    else fetchHistory(tab)
  }, [tab, fetchPending, fetchHistory])

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

  // Generate EWB / E-Invoice from inside the approval review. Accounts owns
  // the GST documents; they should produce them as part of the verification
  // step, not just rubber-stamp what ops generated. Routes are the same
  // ones ops uses; auth allows any authenticated user (including ACCOUNTS).
  async function generateEwbForReview(c) {
    setActionId(c.id + ':gen-ewb')
    try {
      const r = await authedFetch('/api/eway-bill/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'E-Way Bill generation failed.', 'error'); return }
      showToast(`E-Way Bill ${j.ewb_no} generated.`, 'success')
      fetchPending(true)  // refresh row so the new EWB chip + preview link appear
    } finally { setActionId(null) }
  }

  async function generateEinvForReview(c) {
    setActionId(c.id + ':gen-einv')
    try {
      const r = await authedFetch('/api/e-invoice/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consignment_id: c.id }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'E-Invoice generation failed.', 'error'); return }
      showToast('E-Invoice generated.', 'success')
      fetchPending(true)
    } finally { setActionId(null) }
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
          {tab !== 'pending' && (
            <div style={{ fontSize: '11px', color: t.text3 }}>
              Last 30 days · <strong style={{ color: t.text2 }}>{history.length}</strong> {tab}
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
          <button onClick={() => tab === 'pending' ? fetchPending(false) : fetchHistory(tab, false)} style={btnOut}>Refresh</button>
        </div>
      </div>

      {/* Tab strip — Pending / Approved / Rejected */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${t.border}`, marginTop: '-2px' }}>
        {[
          { id: 'pending',  label: 'Pending',  color: t.orange },
          { id: 'approved', label: 'Approved', color: t.green  },
          { id: 'rejected', label: 'Rejected', color: t.red    },
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
              }}>
              {o.label}
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
      ) : tab !== 'pending' && history.length === 0 ? (
        /* Empty state — history tab */
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 500 }}>
            No {tab} consignments in the last 30 days
          </div>
          <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>
            {tab === 'approved' ? 'Once you approve a consignment, it will be archived here.' : 'Rejected consignments are recorded here for audit.'}
          </div>
        </div>
      ) : tab !== 'pending' ? (
        /* History list — read-only, no approve/reject buttons */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {history.map(c => {
            const isType    = c.movement_type === 'INTERNAL'
            const dest      = isType ? c.dest_branch : 'Head Office'
            const isApproved = tab === 'approved'
            // Time taken: created → approved/rejected. approved_at is set on
            // both branches by the approve and reject actions.
            const decidedAt = c.approved_at || c.cancelled_at || c.created_at
            const ttaMs  = decidedAt && c.created_at ? new Date(decidedAt) - new Date(c.created_at) : null
            const ttaMin = ttaMs ? Math.max(0, Math.floor(ttaMs / 60000)) : null
            const ttaLabel = ttaMin == null ? null
              : ttaMin < 60   ? `${ttaMin}m`
              : ttaMin < 1440 ? `${Math.floor(ttaMin/60)}h ${ttaMin%60}m`
              : `${Math.floor(ttaMin/1440)}d ${Math.floor((ttaMin%1440)/60)}h`
            const accentColor = isApproved ? t.green : t.red

            return (
              <div key={c.id} style={{ ...card, padding: '12px 16px 12px 18px', borderLeft: `3px solid ${accentColor}`, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '14px', alignItems: 'center' }}>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '.02em' }}>{c.tmp_prf_no}</span>
                    <span style={{ fontSize: '9px', color: isType ? t.purple : t.orange, background: `${isType ? t.purple : t.orange}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>
                      {isType ? 'VIA HUB' : 'DIRECT → HO'}
                    </span>
                    <span style={{ fontSize: '9px', color: accentColor, background: `${accentColor}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.04em' }}>
                      {isApproved ? 'APPROVED' : 'REJECTED'}
                    </span>
                    {ttaLabel && (
                      <span title={`Time from creation to ${isApproved ? 'approval' : 'rejection'}`} style={{ fontSize: '9px', color: t.text3, background: `${t.text3}10`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>
                        in {ttaLabel}
                      </span>
                    )}
                    {c.eway_bill_no && <span style={{ fontSize: '9px', color: t.green, background: `${t.green}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>EWB</span>}
                    {c.irn         && <span style={{ fontSize: '9px', color: t.purple, background: `${t.purple}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600, letterSpacing: '.04em' }}>IRN</span>}
                  </div>
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
                  {!isApproved && c.rejection_reason && (
                    <div style={{ fontSize: '11px', color: t.red, marginTop: '2px' }}>
                      <span style={{ color: t.text4 }}>Reason:</span> {c.rejection_reason}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '2px', fontSize: '10px', color: t.text4 }}>
                    <span>Created {fmtTS(c.created_at)}{c.created_by && c.created_by !== 'unknown' ? ` by ${c.created_by}` : ''}</span>
                    {c.approved_at && (
                      <>
                        <span>·</span>
                        <span>{isApproved ? 'Approved' : 'Rejected'} {fmtTS(c.approved_at)}{c.approved_by ? ` by ${c.approved_by}` : ''}</span>
                      </>
                    )}
                    <span>·</span>
                    <button onClick={() => previewDoc(`/api/generate-consignee-report?id=${c.id}`, `Report-${c.tmp_prf_no}.jpg`, msg => showToast(msg, 'error'))}
                      style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                      Report
                    </button>
                    <button onClick={() => previewDoc(
                        isType ? `/api/generate-issue-voucher-pdf?id=${c.id}` : `/api/generate-challan-pdf?id=${c.id}`,
                        `${isType ? 'Voucher' : 'Challan'}-${c.tmp_prf_no}.pdf`,
                        msg => showToast(msg, 'error'))}
                      style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.gold, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                      {isType ? 'Voucher' : 'Challan'}
                    </button>
                    {c.eway_bill_no && (
                      <button onClick={() => previewDoc(`/api/eway-bill/pdf?id=${c.id}`, `EWB-${c.eway_bill_no}.pdf`, msg => showToast(msg, 'error'))}
                        style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.green, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                        E-Way Bill
                      </button>
                    )}
                    {c.irn && (
                      <button onClick={() => previewDoc(`/api/e-invoice/pdf?id=${c.id}`, `EInvoice-${c.tmp_prf_no}.pdf`, msg => showToast(msg, 'error'))}
                        style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                        E-Invoice
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
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
                      {isType ? 'VIA HUB' : 'DIRECT → HO'}
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
                    {/* EWB column: preview if generated, Generate button if applicable but not yet generated */}
                    {(() => {
                      // Same applicability rules as ConsignmentData:
                      //   showEwb  = INTERNAL OR intrastate Karnataka source
                      //   showEinv = interstate (non-INTERNAL, non-KA source)
                      const isKaSource = c.state_code === 'KA'
                      const showEwb    = isType || isKaSource
                      const showEinv   = !isType && !isKaSource
                      const isGenEwbBusy  = actionId === c.id + ':gen-ewb'
                      const isGenEinvBusy = actionId === c.id + ':gen-einv'
                      return (
                        <>
                          {showEwb && (c.eway_bill_no ? (
                            <button onClick={() => previewDoc(`/api/eway-bill/pdf?id=${c.id}`, `EWB-${c.eway_bill_no}.pdf`, msg => showToast(msg, 'error'))}
                              title={`Preview E-Way Bill ${c.eway_bill_no}`}
                              style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.green, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                              E-Way Bill
                            </button>
                          ) : (
                            <button onClick={() => generateEwbForReview(c)} disabled={!!actionId}
                              title="Generate E-Way Bill via NIC. Verify the values match the Voucher / Challan before approving."
                              style={{ background: 'transparent', border: `1px solid ${t.green}50`, borderRadius: '5px', padding: '2px 8px', fontSize: '10px', color: t.green, fontWeight: 600, cursor: actionId ? 'not-allowed' : 'pointer', opacity: isGenEwbBusy ? 0.6 : 1 }}>
                              {isGenEwbBusy ? 'Generating…' : 'Generate EWB'}
                            </button>
                          ))}
                          {showEinv && (c.irn ? (
                            <button onClick={() => previewDoc(`/api/e-invoice/pdf?id=${c.id}`, `EInvoice-${c.tmp_prf_no}.pdf`, msg => showToast(msg, 'error'))}
                              title="Preview E-Invoice PDF"
                              style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                              E-Invoice
                            </button>
                          ) : (
                            <button onClick={() => generateEinvForReview(c)} disabled={!!actionId}
                              title="Generate E-Invoice via IRP. Verify the values before approving."
                              style={{ background: 'transparent', border: `1px solid ${t.purple}50`, borderRadius: '5px', padding: '2px 8px', fontSize: '10px', color: t.purple, fontWeight: 600, cursor: actionId ? 'not-allowed' : 'pointer', opacity: isGenEinvBusy ? 0.6 : 1 }}>
                              {isGenEinvBusy ? 'Generating…' : 'Generate IRN'}
                            </button>
                          ))}
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* Right side: Reject + Approve */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button onClick={() => reject(c)} disabled={!!actionId}
                    style={{ background: 'transparent', border: `1px solid ${t.red}`, borderRadius: '7px', padding: '7px 16px', fontSize: '11px', color: t.red, fontWeight: 600, cursor: actionId ? 'not-allowed' : 'pointer', opacity: isRejectBusy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                    {isRejectBusy ? 'Rejecting…' : 'Reject'}
                  </button>
                  <button onClick={() => approve(c)} disabled={!!actionId}
                    style={{ background: t.green, color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 20px', fontSize: '11px', fontWeight: 700, cursor: actionId ? 'not-allowed' : 'pointer', opacity: isApproveBusy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                    {isApproveBusy ? 'Approving…' : 'Approve'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
