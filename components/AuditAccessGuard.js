'use client'

// AuditAccessGuard
//
// Enforces the audit-shift time gate on the client for role='audit' users.
// Instead of forcing a sign-out at the window boundary (which means a
// password re-entry every shift — auditors forget passwords), this keeps
// the session and overlays a persistent LOCK SCREEN whenever the auditor
// is outside their assigned window.
//
// Lifecycle:
//   1. On mount (role==='audit' only): call /api/auditor-access.
//      - allowed → no UI, schedule a re-check at window close.
//      - denied  → show lock screen with auditor's name, next shift, and
//        an Exit button (explicit signOut only on tap).
//
//   2. Re-checks fire automatically at the window's NEXT inflection point
//      (close-time when allowed, next open-time when denied). So when an
//      auditor's shift starts, the lock screen auto-unlocks without any
//      manual reload, and when it ends, the lock screen reappears.
//
//   3. Tab visibility-change also triggers a re-check — covers the
//      open-but-backgrounded tab crossing a boundary.
//
// Server-side gate (lib/apiAuth.js) prevents any actual data access
// outside the window, so the persistent session is essentially just a
// viewing pass for "what's my next shift" — no security exposure beyond
// the auditor's own roster info.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { authedFetch } from '../lib/authedFetch'

const VERIFY_BACKOFF_MS = 60_000   // on network blip, recheck after this delay
const CLOCK_TICK_MS     = 30_000   // countdown refresh cadence

export default function AuditAccessGuard({ role }) {
  // null = haven't checked yet
  // { allowed:true } = unlocked
  // { allowed:false, ... } = locked, showing lock screen
  const [status, setStatus] = useState(null)
  const [exiting, setExiting] = useState(false)
  const [tick, setTick] = useState(0)   // bumps every CLOCK_TICK_MS so countdown re-renders
  const timerRef = useRef(null)
  const tickRef  = useRef(null)

  useEffect(() => {
    if (role !== 'audit') return
    let mounted = true

    const clearTimer = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    }

    const scheduleNext = (decision) => {
      clearTimer()
      const now = Date.now()
      // Pick the most informative next boundary:
      //   allowed → window close (so we re-lock at the right second)
      //   denied  → next shift opens (so we auto-unlock at the right second)
      let target = null
      if (decision.allowed && decision.expiresAtMs)        target = decision.expiresAtMs
      else if (!decision.allowed && decision.nextShift)    target = decision.nextShift.opensAtMs
      if (!target) return
      const delay = Math.min(24 * 3600_000, Math.max(2_000, target - now + 1500))
      timerRef.current = setTimeout(check, delay)
    }

    const check = async () => {
      try {
        const res = await authedFetch('/api/auditor-access')
        const j   = await res.json().catch(() => ({}))
        if (!mounted) return
        if (res.status === 401) {
          // Session is dead (token expired etc.) — bounce to login.
          window.location.href = '/'
          return
        }
        if (!res.ok || !j) {
          clearTimer()
          timerRef.current = setTimeout(check, VERIFY_BACKOFF_MS)
          return
        }
        if (j.gated === false) {
          // Server says this role isn't gated. Stop everything.
          clearTimer()
          setStatus({ allowed: true })
          return
        }
        setStatus(j)
        scheduleNext(j)
      } catch {
        if (!mounted) return
        clearTimer()
        timerRef.current = setTimeout(check, VERIFY_BACKOFF_MS)
      }
    }

    check()

    // Re-check when the tab regains focus.
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)

    // Countdown ticker — drives the "Opens in 4h 23m" relative text.
    tickRef.current = setInterval(() => setTick(t => t + 1), CLOCK_TICK_MS)

    return () => {
      mounted = false
      clearTimer()
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [role])

  // For non-audit roles render nothing and don't touch the DOM.
  if (role !== 'audit') return null
  // Allowed (or still checking) → render nothing; dashboard stays visible.
  if (!status || status.allowed) return null

  // Denied → persistent lock screen.
  return <LockScreen status={status} exiting={exiting} setExiting={setExiting} tick={tick} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock screen

function LockScreen({ status, exiting, setExiting, tick }) {
  const { auditor, nextShift, reason } = status
  const firstName = (auditor?.full_name || '').split(' ')[0] || ''

  const onExit = async () => {
    setExiting(true)
    try { await supabase.auth.signOut() } catch {}
    try { localStorage.removeItem('goldapp-role') } catch {}
    window.location.href = '/'
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 999999,
        background: 'rgba(8,8,10,0.96)',
        backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}>
      <div style={{
        width: '100%', maxWidth: '460px',
        background: 'linear-gradient(180deg, #161310 0%, #0d0c0a 100%)',
        border: '1px solid #2a2520',
        borderRadius: '20px',
        padding: '36px 30px 28px',
        boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
        color: '#f0e6c8',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* subtle gold sheen across the top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.6), transparent)',
        }} />

        {/* Icon — animates a slow breathe */}
        <div style={{
          width: '72px', height: '72px', margin: '0 auto 18px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, rgba(201,168,76,0.25), rgba(201,168,76,0.05) 70%)',
          border: '1px solid rgba(201,168,76,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '32px',
          animation: 'auditBreathe 3.6s ease-in-out infinite',
        }}>
          🌙
        </div>

        <div style={{ fontSize: '11px', color: '#8a7a4e', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '8px' }}>
          Audit access locked
        </div>
        <div style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-.01em', marginBottom: '6px' }}>
          {firstName ? `Hi ${firstName}` : 'Hi'}
        </div>
        <div style={{ fontSize: '12.5px', color: '#c8b89a', lineHeight: 1.55, marginBottom: '22px' }}>
          {reason}
        </div>

        {/* Next shift card — only shown when one exists */}
        {nextShift && <NextShiftCard nextShift={nextShift} tick={tick} />}

        {!nextShift && (
          <div style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px dashed #3a3328',
            borderRadius: '12px',
            padding: '16px 14px',
            marginBottom: '22px',
            fontSize: '11.5px',
            color: '#9a8c70',
            lineHeight: 1.5,
          }}>
            No upcoming audit shift on your roster.<br/>
            <span style={{ color: '#7a6a4a' }}>Ask the roster admin to add you to a shift date.</span>
          </div>
        )}

        {/* Auditor identity strip */}
        {auditor && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            paddingTop: '14px',
            borderTop: '1px solid #1f1c18',
            fontSize: '10.5px', color: '#7a6a4a',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3a8fbf', boxShadow: '0 0 6px #3a8fbf80' }} />
            Signed in as <span style={{ color: '#a89770', fontFamily: 'monospace' }}>{auditor.email}</span>
          </div>
        )}

        {/* Exit button — explicit signOut only */}
        <button
          type="button"
          onClick={onExit}
          disabled={exiting}
          style={{
            marginTop: '18px',
            background: 'transparent',
            border: '1px solid #2a2520',
            borderRadius: '10px',
            padding: '10px 22px',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: '#c8b89a',
            cursor: exiting ? 'wait' : 'pointer',
            opacity: exiting ? 0.5 : 1,
            transition: 'border-color .15s ease, color .15s ease',
          }}
          onMouseEnter={(e) => { if (!exiting) { e.currentTarget.style.borderColor = '#c9a84c80'; e.currentTarget.style.color = '#f0e6c8' } }}
          onMouseLeave={(e) => { if (!exiting) { e.currentTarget.style.borderColor = '#2a2520'; e.currentTarget.style.color = '#c8b89a' } }}>
          {exiting ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      <style>{`
        @keyframes auditBreathe {
          0%, 100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(201,168,76,0.0); }
          50%      { transform: scale(1.05); box-shadow: 0 0 0 14px rgba(201,168,76,0.0); }
        }
      `}</style>
    </div>
  )
}

function NextShiftCard({ nextShift }) {
  // Recompute every render — parent passes `tick` so this re-runs on a
  // CLOCK_TICK_MS cadence and the countdown stays current.
  const now      = Date.now()
  const opens    = nextShift.opensAtMs
  const inWindow = now >= opens && now < nextShift.closesAtMs
  const msUntil  = opens - now
  const relative = inWindow ? '' : formatCountdown(msUntil)
  const accent   = nextShift.shift_type === 'night' ? '#c9a84c' : '#e9a942'
  const icon     = nextShift.shift_type === 'night' ? '🌙' : '☀'
  const dateLabel = fmtFullDate(nextShift.shift_date)

  return (
    <div style={{
      background: `linear-gradient(135deg, ${accent}14 0%, ${accent}05 100%)`,
      border: `1px solid ${accent}40`,
      borderRadius: '13px',
      padding: '16px 18px',
      marginBottom: '20px',
      textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: '14px',
    }}>
      <div style={{
        width: '44px', height: '44px', borderRadius: '12px',
        background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
        border: `1px solid ${accent}50`,
        color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '20px',
        flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '9.5px', color: '#8a7a4e', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
          Your next shift
        </div>
        <div style={{ fontSize: '13px', color: '#f0e6c8', fontWeight: 700, marginTop: '2px' }}>
          {nextShift.shift_type === 'night' ? 'Night Weight Audit' : 'Morning Weight + Melting'}
        </div>
        <div style={{ fontSize: '11px', color: '#c8b89a', marginTop: '4px' }}>
          {dateLabel} · {nextShift.windowStartIst}–{nextShift.windowEndIst} IST
        </div>
        {relative && (
          <div style={{
            fontSize: '10.5px',
            color: accent,
            marginTop: '6px',
            fontWeight: 600,
            letterSpacing: '.02em',
          }}>
            {relative}
          </div>
        )}
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function fmtFullDate(ymd) {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Opening now…'
  const mins = Math.floor(ms / 60_000)
  const hrs  = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days >= 1) return `Opens in ${days}d ${hrs % 24}h`
  if (hrs  >= 1) return `Opens in ${hrs}h ${mins % 60}m`
  if (mins >= 1) return `Opens in ${mins} min`
  return 'Opens in under a minute'
}
