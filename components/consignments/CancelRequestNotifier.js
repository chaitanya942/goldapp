'use client'

// CancelRequestNotifier — global poller that surfaces pending cancellation
// requests to ACCOUNTS-group users (super_admin / founders_office / accounts).
//
// Behaviour:
//   - Polls /api/consignments?action=cancellation_requests every 60 s.
//   - Renders one card per pending request in a portal at top-right, fixed
//     to the viewport so it follows the user across modules.
//   - Fires a browser Notification each poll (using tag='cancel-requests'
//     so the OS replaces the previous one rather than stacking N copies).
//   - Plays a two-tone chime ONLY on the first appearance of a new request
//     (tracked in sessionStorage so reloads don't re-chime). Subsequent
//     polls are silent reminders — visible but not startling.
//   - Stops automatically once the request is approved or rejected (the
//     endpoint stops returning it; we drop it from the seen-set and the
//     popup disappears).
//
// Mounted at dashboard root so it's active across every module, including
// when accounts is browsing Branch Stock / Purchase Data / etc.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

// Mirror of ROLE_GROUPS.ACCOUNTS from lib/apiAuth.js. Hardcoded here so the
// client doesn't pull in the server-only auth module.
const ACCOUNTS_ROLES = ['super_admin', 'founders_office', 'accounts']
const POLL_INTERVAL_MS = 60_000
const SEEN_STORAGE_KEY = 'cancel-req-seen-ids'

export default function CancelRequestNotifier() {
  const { userProfile, setActiveNav, theme } = useApp()
  const role = userProfile?.role
  const isAccounts = !!role && ACCOUNTS_ROLES.includes(role)

  const [pending, setPending] = useState([])
  const seenIdsRef = useRef(new Set())

  // Hydrate seen IDs from sessionStorage so a page reload within the same
  // tab doesn't re-chime for requests the user has already been alerted to.
  // A fresh tab (new session) re-chimes — intentional: a closed-and-reopened
  // session probably means a different shift / new attention surface.
  useEffect(() => {
    if (!isAccounts) return
    try {
      const raw = sessionStorage.getItem(SEEN_STORAGE_KEY)
      if (raw) seenIdsRef.current = new Set(JSON.parse(raw))
    } catch {}
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission() } catch {}
    }
  }, [isAccounts])

  // Two-tone chime via Web Audio — same pattern as ConsignmentOverview's
  // pickup reminder. No audio asset shipped; sounds even when the OS
  // notification sound is muted.
  const playChime = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const beep = (freq, t0, dur) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.frequency.value = freq
        osc.type = 'sine'
        osc.connect(gain).connect(ctx.destination)
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + t0)
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t0 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur)
        osc.start(ctx.currentTime + t0)
        osc.stop(ctx.currentTime + t0 + dur + 0.05)
      }
      beep(880, 0,    0.18)
      beep(660, 0.22, 0.28)
    } catch {}
  }

  const fireBrowserNotif = (count) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
      new Notification(
        count === 1 ? '1 cancel request pending' : `${count} cancel requests pending`,
        {
          body: 'Open Approvals → Cancel Requests to approve or reject.',
          tag: 'cancel-requests',
          requireInteraction: true,
        },
      )
    } catch {}
  }

  useEffect(() => {
    if (!isAccounts) return
    let cancelled = false

    const tick = async () => {
      try {
        const res = await authedFetch('/api/consignments?action=cancellation_requests')
        const j = await res.json()
        if (cancelled || j?.error) return
        const list = Array.isArray(j.data) ? j.data : []

        // Prune seen IDs that are no longer pending — keeps the set bounded
        // and lets the chime fire again if the SAME consignment id ever
        // ends up with another cancel request later (rare but possible).
        const currentIds = new Set(list.map(c => c.id))
        for (const id of Array.from(seenIdsRef.current)) {
          if (!currentIds.has(id)) seenIdsRef.current.delete(id)
        }

        const newOnes = list.filter(c => !seenIdsRef.current.has(c.id))
        setPending(list)

        if (list.length > 0) {
          fireBrowserNotif(list.length)
          if (newOnes.length > 0) playChime()
        }

        for (const c of list) seenIdsRef.current.add(c.id)
        try { sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...seenIdsRef.current])) } catch {}
      } catch {
        // Network errors swallowed — next tick retries. Don't break the loop.
      }
    }

    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [isAccounts])

  if (!isAccounts || pending.length === 0) return null
  if (typeof document === 'undefined') return null

  const isDark = theme !== 'light'
  const colors = {
    bg:     isDark ? 'rgba(20, 12, 8, 0.97)' : 'rgba(255, 248, 240, 0.98)',
    border: '#e0555560',
    text1:  isDark ? '#f0e6c8' : '#1a1208',
    text2:  isDark ? '#c8b89a' : '#3a2a10',
    text3:  isDark ? '#7a6a4a' : '#6a5a3a',
    gold:   isDark ? '#c9a84c' : '#9a7228',
    red:    '#e05555',
  }

  return createPortal(
    <div style={{
      position: 'fixed', top: 80, right: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 380, pointerEvents: 'none',
    }}>
      {pending.slice(0, 5).map(c => (
        <div key={c.id} style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: '12px 16px',
          color: colors.text1,
          boxShadow: '0 12px 32px rgba(0,0,0,.5)',
          animation: 'cancelNotifIn 0.3s ease-out',
          pointerEvents: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: colors.red, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.red, animation: 'cancelNotifPulse 1.4s infinite' }} />
            Cancel request pending
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.gold, fontFamily: 'monospace', marginBottom: 2 }}>
            {c.tmp_prf_no}
          </div>
          <div style={{ fontSize: 12, color: colors.text2, marginBottom: 6 }}>
            {c.branch_name} → {c.dest_branch || 'Head Office'}
          </div>
          {c.cancellation_reason && (
            <div style={{ fontSize: 11, color: colors.text3, fontStyle: 'italic', marginBottom: 8 }}>
              &ldquo;{c.cancellation_reason}&rdquo;
            </div>
          )}
          <button onClick={() => setActiveNav('consignment-approvals')}
            style={{
              background: colors.gold, color: '#1a0a00', border: 'none',
              borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 700,
              cursor: 'pointer',
            }}>
            Open Approvals →
          </button>
        </div>
      ))}
      {pending.length > 5 && (
        <div style={{
          background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10,
          padding: '10px 16px', color: colors.text2, fontSize: 11, textAlign: 'center',
          pointerEvents: 'auto',
        }}>
          +{pending.length - 5} more pending
        </div>
      )}
      <style>{`
        @keyframes cancelNotifIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes cancelNotifPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
      `}</style>
    </div>,
    document.body,
  )
}
