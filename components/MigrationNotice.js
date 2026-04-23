'use client'

import { useEffect, useState } from 'react'

export default function MigrationNotice() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('wg_migrated')) {
      setShow(true)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem('wg_migrated', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.85)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '24px',
    }}>
      <div style={{
        background: '#111', border: '1px solid #c9a84c', borderRadius: '16px',
        padding: '32px 28px', maxWidth: '360px', width: '100%', textAlign: 'center',
      }}>
        <img src="/images.png" alt="WhiteGold" style={{ width: '80px', height: '80px', borderRadius: '16px', marginBottom: '20px', objectFit: 'cover' }} />
        <div style={{ fontSize: '1.1rem', color: '#f0e6c8', fontWeight: 500, marginBottom: '10px' }}>App Updated</div>
        <div style={{ fontSize: '.8rem', color: '#9a8a6a', lineHeight: 1.7, marginBottom: '24px' }}>
          WhiteGold has moved to a new server. For the best experience, remove the old app from your home screen and re-install it from the new link.
        </div>
        <a
          href="https://goldapp-production.up.railway.app"
          style={{
            display: 'block', background: '#c9a84c', color: '#0a0a0a',
            borderRadius: '10px', padding: '12px', fontSize: '.82rem',
            fontWeight: 700, textDecoration: 'none', marginBottom: '12px',
          }}>
          Re-install App
        </a>
        <button
          onClick={dismiss}
          style={{ background: 'none', border: 'none', color: '#6a5a3a', fontSize: '.75rem', cursor: 'pointer' }}>
          I'll do it later
        </button>
      </div>
    </div>
  )
}
