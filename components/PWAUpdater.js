'use client'

import { useEffect, useState } from 'react'

export default function PWAUpdater() {
  const [showUpdate, setShowUpdate] = useState(false)
  const [worker, setWorker]         = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // When a new service worker takes control, reload once so the live client
    // bundle replaces whatever is running — no "Update" tap needed. Guarded so
    // a first install (no prior controller) and repeated events don't loop.
    const hadController = !!navigator.serviceWorker.controller
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return
      refreshing = true
      window.location.reload()
    })

    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Activate a worker that's already waiting from a previous visit.
      if (reg.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Auto-apply; controllerchange above then reloads. Keep the manual
            // prompt as a fallback in case the browser doesn't swap in time.
            newWorker.postMessage({ type: 'SKIP_WAITING' })
            setWorker(newWorker)
            setShowUpdate(true)
          }
        })
      })
      reg.update?.()
    })
  }, [])

  const update = () => {
    if (worker) worker.postMessage({ type: 'SKIP_WAITING' })
    window.location.reload()
  }

  if (!showUpdate) return null

  return (
    <div style={{
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, background: '#1a1208', border: '1px solid #c9a84c',
      borderRadius: '12px', padding: '14px 20px', display: 'flex',
      alignItems: 'center', gap: '14px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: '.8rem', color: '#f0e6c8' }}>New update available</span>
      <button
        onClick={update}
        style={{
          background: '#c9a84c', border: 'none', borderRadius: '8px',
          padding: '7px 16px', color: '#0a0a0a', fontSize: '.78rem',
          fontWeight: 700, cursor: 'pointer',
        }}>
        Update
      </button>
      <button
        onClick={() => setShowUpdate(false)}
        style={{ background: 'none', border: 'none', color: '#7a6a4a', cursor: 'pointer', fontSize: '.9rem' }}>
        ✕
      </button>
    </div>
  )
}
