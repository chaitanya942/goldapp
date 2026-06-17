'use client'

// SyncHealthNotifier — surfaces a STALLED CRM sync to super-admins only.
//
// Behaviour:
//   - Renders/polls ONLY for role === 'super_admin'.
//   - Polls /api/sync-health every 60 s.
//   - A sync is "stale" when its last successful run is older than the
//     server threshold (~10 min) or it has never recorded a success.
//   - On stale: fixed top-right banner (per stale sync) + a browser
//     Notification (tag='sync-health' so the OS replaces, not stacks) +
//     a one-time chime when a sync FIRST goes stale this session.
//   - Clears automatically once the sync recovers (anyStale → false).
//
// Mounted at dashboard root so it follows the super-admin across modules.
// This is the safety net for silent sync stalls (e.g. the new-CRM sync that
// sat ~5h stale because nothing was triggering it).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

const POLL_INTERVAL_MS = 60_000
const CHIMED_KEY = 'sync-health-chimed'

export default function SyncHealthNotifier() {
  const { userProfile, theme } = useApp()
  const isSuperAdmin = userProfile?.role === 'super_admin'

  const [stale, setStale] = useState([])
  const chimedRef = useRef(new Set())

  useEffect(() => {
    if (!isSuperAdmin) return
    try {
      const raw = sessionStorage.getItem(CHIMED_KEY)
      if (raw) chimedRef.current = new Set(JSON.parse(raw))
    } catch {}
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission() } catch {}
    }
  }, [isSuperAdmin])

  const playChime = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const beep = (freq, t0, dur) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.frequency.value = freq; osc.type = 'sine'
        osc.connect(gain).connect(ctx.destination)
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + t0)
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t0 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur)
        osc.start(ctx.currentTime + t0); osc.stop(ctx.currentTime + t0 + dur + 0.05)
      }
      // low → lower: an "alarm" feel, distinct from the cancel-request chime.
      beep(440, 0, 0.22); beep(330, 0.26, 0.34)
    } catch {}
  }

  const fireBrowserNotif = (staleList) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
      const names = staleList.map(s => s.label || s.name).join(', ')
      new Notification(
        staleList.length === 1 ? `⚠ ${names} has stalled` : `⚠ ${staleList.length} CRM syncs stalled`,
        {
          body: staleList.map(s => `${s.label || s.name}: ${s.age_minutes == null ? 'never synced' : `last ok ${s.age_minutes} min ago`}`).join('\n'),
          tag: 'sync-health',
          requireInteraction: true,
        },
      )
    } catch {}
  }

  useEffect(() => {
    if (!isSuperAdmin) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await authedFetch('/api/sync-health')
        const j = await res.json()
        if (cancelled || j?.error) return
        const list = Array.isArray(j.stale) ? j.stale : []
        setStale(list)
        if (list.length > 0) {
          fireBrowserNotif(list)
          // Chime once per sync per session when it first goes stale.
          const fresh = list.filter(s => !chimedRef.current.has(s.name))
          if (fresh.length > 0) {
            playChime()
            fresh.forEach(s => chimedRef.current.add(s.name))
            try { sessionStorage.setItem(CHIMED_KEY, JSON.stringify([...chimedRef.current])) } catch {}
          }
        } else {
          // All recovered — reset so a future stall re-chimes.
          chimedRef.current = new Set()
          try { sessionStorage.removeItem(CHIMED_KEY) } catch {}
        }
      } catch { /* swallow; retry next tick */ }
    }
    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [isSuperAdmin])

  if (!isSuperAdmin || stale.length === 0) return null
  if (typeof document === 'undefined') return null

  const isDark = theme !== 'light'
  const c = {
    bg:     isDark ? 'rgba(28, 8, 8, 0.97)' : 'rgba(255, 244, 244, 0.98)',
    border: '#e0555575',
    text1:  isDark ? '#ffd9d9' : '#5a1010',
    text2:  isDark ? '#e0a8a8' : '#7a2020',
    red:    '#e05555',
  }

  return createPortal(
    <div style={{
      position: 'fixed', top: 80, right: 16, zIndex: 10000,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380, pointerEvents: 'none',
    }}>
      {stale.map(s => (
        <div key={s.name} style={{
          background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10,
          padding: '12px 16px', color: c.text1, boxShadow: '0 12px 32px rgba(0,0,0,.5)',
          animation: 'syncHealthIn 0.3s ease-out', pointerEvents: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: c.red, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.red, animation: 'syncHealthPulse 1.2s infinite' }} />
            Sync stalled
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{s.label || s.name}</div>
          <div style={{ fontSize: 12, color: c.text2 }}>
            {s.age_minutes == null ? 'Never synced since deploy' : `Last successful sync ${s.age_minutes} min ago`}
          </div>
          {s.last_error && (
            <div style={{ fontSize: 11, color: c.text2, fontStyle: 'italic', marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-word' }}>
              {s.last_error}
            </div>
          )}
          <div style={{ fontSize: 11, color: c.text2, marginTop: 6 }}>
            Check the <strong>goldapp-cron</strong> Railway worker.
          </div>
        </div>
      ))}
      <style>{`
        @keyframes syncHealthIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes syncHealthPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>,
    document.body,
  )
}
