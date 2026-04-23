'use client'

import { useEffect, useState } from 'react'

export default function PWAUpdater() {
  const [showUpdate, setShowUpdate] = useState(false)
  const [worker, setWorker]         = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setWorker(newWorker)
            setShowUpdate(true)
          }
        })
      })
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
