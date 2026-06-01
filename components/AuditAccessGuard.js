'use client'

// AuditAccessGuard
//
// Enforces the audit-shift time gate on the client. Mounted high up in the
// dashboard tree — runs only when the signed-in user's role is 'audit'.
//
//   1. On mount, calls /api/auditor-access.
//      - Allowed → schedule a setTimeout to the window's end so the
//        auditor gets auto-logged-out exactly when their shift closes.
//      - Denied  → show a full-screen "outside your window" overlay for
//        a moment, then sign them out and redirect to login.
//
//   2. Re-checks when the browser tab regains visibility (covers the case
//      where the user left the tab open across the window boundary and the
//      setTimeout fired in the background but supabase signOut is the only
//      forcing function — defense in depth).
//
// Non-audit roles render NOTHING from this component (the parent should not
// even mount it, but the role-guard inside is a second line of defense).

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { authedFetch } from '../lib/authedFetch'

const REDIRECT_GRACE_MS = 2500   // how long to show the overlay before signOut
const VERIFY_BACKOFF_MS = 60_000 // on network blip, recheck after this delay

export default function AuditAccessGuard({ role }) {
  // null = haven't decided yet; { reason } = denied + overlay showing.
  const [denied, setDenied] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (role !== 'audit') return
    let mounted = true

    const clearTimer = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    }

    const enforceDenied = (reason) => {
      if (!mounted) return
      setDenied({ reason })
      clearTimer()
      timerRef.current = setTimeout(async () => {
        try { await supabase.auth.signOut() } catch {}
        try { localStorage.removeItem('goldapp-role') } catch {}
        window.location.href = '/?reason=outside-shift-window'
      }, REDIRECT_GRACE_MS)
    }

    const check = async () => {
      try {
        const res = await authedFetch('/api/auditor-access')
        const j = await res.json().catch(() => ({}))
        if (!mounted) return
        if (!res.ok || !j) {
          // Treat unexpected non-200 (other than 401) as a transient — retry
          // soon rather than locking the user out for what might be a
          // deploy blip. 401 means session is dead → bounce to login.
          if (res.status === 401) {
            window.location.href = '/'
            return
          }
          clearTimer()
          timerRef.current = setTimeout(check, VERIFY_BACKOFF_MS)
          return
        }

        if (j.gated === false) {
          // Server says this role isn't gated. Stop polling.
          clearTimer()
          return
        }
        if (j.allowed) {
          // Schedule the next check at window close + a small buffer so we
          // see the post-close state on the very first re-poll. Cap to 24h
          // to keep numbers sane.
          if (j.expiresAtMs) {
            const delay = Math.min(24 * 3600_000, Math.max(2_000, j.expiresAtMs - Date.now() + 1500))
            clearTimer()
            timerRef.current = setTimeout(check, delay)
          }
        } else {
          enforceDenied(j.reason || 'Outside your assigned shift window.')
        }
      } catch {
        if (!mounted) return
        clearTimer()
        timerRef.current = setTimeout(check, VERIFY_BACKOFF_MS)
      }
    }

    check()

    // Re-check when the tab regains focus — covers an open-but-idle tab
    // crossing the window boundary while the page was hidden.
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      mounted = false
      clearTimer()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [role])

  if (!denied) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        maxWidth: '440px', textAlign: 'center',
        background: '#111111',
        border: '1px solid #2a2a2a',
        borderRadius: '18px',
        padding: '36px 30px',
        color: '#f0e6c8',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: '40px', marginBottom: '14px', opacity: 0.85 }}>🌙</div>
        <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', letterSpacing: '-.01em' }}>
          Outside your shift window
        </div>
        <div style={{ fontSize: '12px', color: '#c8b89a', lineHeight: 1.6 }}>
          {denied.reason}
        </div>
        <div style={{
          fontSize: '10px', color: '#7a6a4a', marginTop: '20px',
          fontStyle: 'italic', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600,
        }}>
          Signing you out…
        </div>
      </div>
    </div>
  )
}
