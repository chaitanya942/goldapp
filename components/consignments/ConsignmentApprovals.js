'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../lib/context'
import { supabase as supabaseClient } from '../../lib/supabase'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', card3: '#1d1c19', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e0d9cc', card3: '#ede5d8', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

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

function playApprovalBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
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
    setTimeout(() => ctx.close(), 600)
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

async function previewDoc(url, filename, onError) {
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}preview=accounts`)
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

  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [toast, setToast] = useState(null)
  const [notifPermission, setNotifPermission] = useState(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported')
  const [, forceTick] = useState(0)
  const knownIds = useRef(new Set())

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type, key: Date.now() })
  }, [])

  const fetchPending = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const r = await fetch('/api/consignments?action=pending_approvals')
    const j = await r.json()
    const rows = j.data || []
    setPending(rows)
    knownIds.current = new Set(rows.map(c => c.id))
    setLoading(false)
  }, [])

  useEffect(() => { fetchPending() }, [fetchPending])

  // Re-render every 30s so the urgency badge stays current
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 30000)
    return () => clearInterval(id)
  }, [])

  // Realtime: instant arrival/dismissal
  useEffect(() => {
    const channel = supabaseClient
      .channel('consignment-approvals')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'consignments', filter: 'approval_status=eq.pending' },
        (payload) => {
          const row = payload.new
          if (!row || knownIds.current.has(row.id)) return
          knownIds.current.add(row.id)
          setPending(prev => [row, ...prev])
          fireDesktopNotification(
            'New consignment awaiting approval',
            `${row.tmp_prf_no || ''}: ${row.branch_name} → ${row.dest_branch || 'HO'} · ${row.total_bills || 0} bills · ${Number(row.total_net_wt || 0).toFixed(3)}g`
          )
          playApprovalBeep()
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
            fireDesktopNotification('New consignment awaiting approval',
              `${row.tmp_prf_no || ''}: ${row.branch_name} → ${row.dest_branch || 'HO'}`)
            playApprovalBeep()
          } else {
            setPending(prev => prev.map(c => c.id === row.id ? row : c))
          }
        })
      .subscribe()
    return () => { supabaseClient.removeChannel(channel) }
  }, [])

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      showToast('Desktop notifications not supported by this browser', 'error'); return
    }
    const perm = await Notification.requestPermission()
    setNotifPermission(perm)
    if (perm === 'granted') {
      showToast('Notifications enabled — you\'ll be alerted on new requests', 'success')
      fireDesktopNotification('Notifications enabled', 'You will be notified when new consignments need approval.')
    }
  }

  async function approve(c) {
    if (!confirm(`Approve ${c.tmp_prf_no}?\n\nOperations team will be able to download all documents (Voucher/Challan, Report, EWB PDF, E-Invoice PDF).`)) return
    setActionId(c.id + ':approve')
    try {
      const r = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_consignment', id: c.id, approver_email: userEmail }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'Approval failed', 'error'); return }
      showToast(`✓ Approved ${c.tmp_prf_no} — ops can now download`, 'success')
    } finally { setActionId(null) }
  }

  async function reject(c) {
    const reason = prompt(`Reject ${c.tmp_prf_no}?\n\nEnter a reason (operator will see this):`)
    if (!reason || !reason.trim()) return
    setActionId(c.id + ':reject')
    try {
      const r = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject_approval', id: c.id, approver_email: userEmail, reason: reason.trim() }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { showToast(j.error || 'Rejection failed', 'error'); return }
      showToast(`✕ Rejected ${c.tmp_prf_no}`, 'warning')
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
    <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1300px', margin: '0 auto' }}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* ── Header with KPI strip ───────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '1.5rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>
            Pending Approvals
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: t.green, boxShadow: `0 0 6px ${t.green}` }} />
            Live updates active
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {pending.length > 0 && oldestBadge && (
            <div style={{ fontSize: '11px', color: t.text3, padding: '6px 12px', background: oldestBadge.bg, borderRadius: '8px', border: `1px solid ${oldestBadge.color}30` }}>
              Oldest pending: <strong style={{ color: oldestBadge.color }}>{oldestBadge.label}</strong>
            </div>
          )}
          <button onClick={() => fetchPending(false)} style={btnOut}>⟳ Refresh</button>
        </div>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div style={{ ...card, padding: '14px 18px' }}>
            <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Awaiting Review</div>
            <div style={{ fontSize: '1.6rem', color: t.orange, fontWeight: 300, marginTop: '4px' }}>{pending.length}</div>
            <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>consignment{pending.length !== 1 ? 's' : ''}</div>
          </div>
          <div style={{ ...card, padding: '14px 18px' }}>
            <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Total Bills</div>
            <div style={{ fontSize: '1.6rem', color: t.gold, fontWeight: 300, marginTop: '4px' }}>{totalBills}</div>
            <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>across all pending</div>
          </div>
          <div style={{ ...card, padding: '14px 18px' }}>
            <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Net Weight</div>
            <div style={{ fontSize: '1.6rem', color: t.blue, fontWeight: 300, marginTop: '4px', fontFamily: 'monospace' }}>{fmtWt(totalNetWt)}</div>
            <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>gold in transit</div>
          </div>
          <div style={{ ...card, padding: '14px 18px' }}>
            <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Total Value</div>
            <div style={{ fontSize: '1.6rem', color: t.green, fontWeight: 300, marginTop: '4px' }}>₹{fmt(Math.round(totalValue))}</div>
            <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>indicative</div>
          </div>
        </div>
      )}

      {/* ── Notifications banner ─────────────────────────────────────────── */}
      {notifPermission === 'default' && (
        <div style={{ background: `${t.gold}10`, border: `1px solid ${t.gold}40`, borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ fontSize: '12px', color: t.gold, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>🔔</span>
            <span>Enable desktop notifications + sound to be alerted instantly when a new request arrives</span>
          </div>
          <button onClick={requestNotifications}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
            Enable
          </button>
        </div>
      )}
      {notifPermission === 'denied' && (
        <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '10px', padding: '10px 16px', fontSize: '11px', color: t.red }}>
          Notifications blocked. To enable, click the lock icon in your browser address bar and allow notifications for this site.
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {pending.length === 0 ? (
        <div style={{ ...card, padding: '70px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '52px', marginBottom: '12px', opacity: 0.6 }}>✓</div>
          <div style={{ fontSize: '16px', color: t.text1, fontWeight: 500 }}>All caught up</div>
          <div style={{ fontSize: '12px', color: t.text4, marginTop: '6px' }}>
            No consignments waiting for approval. New requests will appear here instantly.
          </div>
        </div>
      ) : (
        /* ── Pending list ────────────────────────────────────────────────── */
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
              <div key={c.id} style={{ ...card, padding: 0, overflow: 'hidden', borderLeft: `4px solid ${wb.color}` }}>
                {/* Top row: identity + actions */}
                <div style={{ padding: '16px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '17px', color: t.gold, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '.02em' }}>{c.tmp_prf_no}</span>
                      <span style={{ fontSize: '10px', color: isType ? t.purple : t.orange, background: `${isType ? t.purple : t.orange}15`, borderRadius: '5px', padding: '3px 9px', fontWeight: 600, letterSpacing: '.02em' }}>
                        {isType ? 'VIA HUB' : 'DIRECT → HO'}
                      </span>
                      <span style={{ fontSize: '10px', color: wb.color, background: wb.bg, borderRadius: '5px', padding: '3px 9px', fontWeight: 600, letterSpacing: '.02em' }}>
                        ⏱ {wb.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '15px', color: t.text1, marginTop: '8px', fontWeight: 500 }}>
                      <strong style={{ color: t.text1 }}>{c.branch_name}</strong>
                      <span style={{ color: t.text4, margin: '0 10px' }}>→</span>
                      <strong style={{ color: t.text1 }}>{dest}</strong>
                    </div>
                    <div style={{ fontSize: '11px', color: t.text4, marginTop: '4px' }}>
                      Created {fmtTS(c.created_at)}
                      {c.created_by && c.created_by !== 'unknown' && <span> · by {c.created_by}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <button onClick={() => reject(c)} disabled={!!actionId}
                      style={{ background: 'transparent', border: `1px solid ${t.red}`, borderRadius: '8px', padding: '8px 18px', fontSize: '12px', color: t.red, fontWeight: 600, cursor: actionId ? 'not-allowed' : 'pointer', opacity: isRejectBusy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                      {isRejectBusy ? '…' : '✕ Reject'}
                    </button>
                    <button onClick={() => approve(c)} disabled={!!actionId}
                      style={{ background: t.green, color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 22px', fontSize: '12px', fontWeight: 700, cursor: actionId ? 'not-allowed' : 'pointer', opacity: isApproveBusy ? 0.6 : 1, whiteSpace: 'nowrap', boxShadow: `0 2px 8px ${t.green}40` }}>
                      {isApproveBusy ? '…' : '✓ Approve'}
                    </button>
                  </div>
                </div>

                {/* Stats grid — only populated columns shown */}
                <div style={{ padding: '0 22px 14px', display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: '8px' }}>
                  {stats.map(([label, val, color]) => (
                    <div key={label} style={{ background: t.card2, borderRadius: '8px', padding: '10px 14px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: '13px', color, fontWeight: 600, fontFamily: 'monospace', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Document preview footer */}
                <div style={{ padding: '12px 22px', borderTop: `1px solid ${t.border}`, background: t.card2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: t.text3, fontWeight: 500, letterSpacing: '.05em', textTransform: 'uppercase' }}>Review:</span>
                  <button onClick={() => previewDoc(`/api/generate-consignee-report?id=${c.id}`, `Report-${c.tmp_prf_no}.jpg`, msg => showToast(msg, 'error'))}
                    style={{ background: t.card, border: `1px solid ${t.purple}50`, borderRadius: '6px', padding: '5px 12px', fontSize: '11px', color: t.purple, fontWeight: 600, cursor: 'pointer' }}>
                    📋 Consignee Report
                  </button>
                  <button onClick={() => previewDoc(
                      isType ? `/api/generate-issue-voucher-pdf?id=${c.id}` : `/api/generate-challan-pdf?id=${c.id}`,
                      `${isType ? 'Voucher' : 'Challan'}-${c.tmp_prf_no}.pdf`,
                      msg => showToast(msg, 'error'))}
                    style={{ background: t.card, border: `1px solid ${t.gold}80`, borderRadius: '6px', padding: '5px 12px', fontSize: '11px', color: t.gold, fontWeight: 600, cursor: 'pointer' }}>
                    📄 {isType ? 'Issue Voucher' : 'Delivery Challan'}
                  </button>
                  {c.eway_bill_no && (
                    <button onClick={() => previewDoc(`/api/eway-bill/pdf?id=${c.id}`, `EWB-${c.eway_bill_no}.pdf`, msg => showToast(msg, 'error'))}
                      style={{ background: t.card, border: `1px solid ${t.green}80`, borderRadius: '6px', padding: '5px 12px', fontSize: '11px', color: t.green, fontWeight: 600, cursor: 'pointer' }}>
                      ⚡ E-Way Bill
                    </button>
                  )}
                  {c.irn && (
                    <button onClick={() => previewDoc(`/api/e-invoice/pdf?id=${c.id}`, `EInvoice-${c.tmp_prf_no}.pdf`, msg => showToast(msg, 'error'))}
                      style={{ background: t.card, border: `1px solid ${t.purple}80`, borderRadius: '6px', padding: '5px 12px', fontSize: '11px', color: t.purple, fontWeight: 600, cursor: 'pointer' }}>
                      ⚡ E-Invoice
                    </button>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: t.text4, fontStyle: 'italic' }}>
                    Click to download a preview before approving
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
