'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

// ── Eye Icon ─────────────────────────────────────────────
function Eye({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </>
      )}
    </svg>
  )
}

// ── Password Input — defined OUTSIDE main component to prevent remount ────────
function PasswordInput({ value, onChange, onKeyDown, show, onToggle, placeholder }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: '#161616',
      border: '1px solid #2a2a2a',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: '11px 14px',
          color: '#f0e6c8',
          fontSize: '.8rem',
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        style={{
          padding: '0 14px',
          background: 'transparent',
          border: 'none',
          color: '#7a6a4a',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          height: '100%',
        }}>
        <Eye open={show} />
      </button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────
export default function SetPasswordPage() {
  const router = useRouter()
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [status,    setStatus]    = useState('idle')
  const [message,   setMessage]   = useState('')
  const [showPwd,   setShowPwd]   = useState(false)
  const [showConf,  setShowConf]  = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      // session is set automatically when user clicks invite link
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async () => {
    setMessage('')
    if (!password)            return setMessage('Please enter a password.')
    if (password.length < 8)  return setMessage('Password must be at least 8 characters.')
    if (password !== confirm)  return setMessage('Passwords do not match.')

    setStatus('loading')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setStatus('error')
      setMessage(error.message || 'Failed to set password.')
    } else {
      setStatus('success')
      setMessage('Password set! Redirecting to your dashboard…')
      setTimeout(() => router.push('/dashboard'), 2000)
    }
  }

  const gold   = '#c9a84c'
  const text1  = '#f0e6c8'
  const text3  = '#7a6a4a'
  const green  = '#3aaa6a'
  const red    = '#e05555'
  const border = '#2a2a2a'

  const checks = [
    { label: '8+ chars',        pass: password.length >= 8 },
    { label: 'Uppercase',       pass: /[A-Z]/.test(password) },
    { label: 'Number',          pass: /[0-9]/.test(password) },
    { label: 'Passwords match', pass: password === confirm && confirm.length > 0 },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: gold, letterSpacing: '.12em' }}>GOLDAPP</div>
          <div style={{ fontSize: '.65rem', color: text3, marginTop: '6px', letterSpacing: '.1em' }}>WHITE GOLD OPERATIONS</div>
        </div>

        {/* Card */}
        <div style={{ background: '#111111', border: '1px solid #2a2a2a', borderRadius: '14px', padding: '32px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg,${gold},${gold}00)` }}/>

          <div style={{ fontSize: '1rem', color: text1, fontWeight: 500, marginBottom: '6px' }}>Set your password</div>
          <div style={{ fontSize: '.7rem', color: text3, marginBottom: '28px', lineHeight: 1.6 }}>
            Welcome to GoldApp. Create a secure password to activate your account.
          </div>

          {/* New Password */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '.58rem', color: text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px' }}>New Password</div>
            <PasswordInput
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              show={showPwd}
              onToggle={() => setShowPwd(v => !v)}
              placeholder="Minimum 8 characters"
            />
          </div>

          {/* Confirm Password */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '.58rem', color: text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px' }}>Confirm Password</div>
            <PasswordInput
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              show={showConf}
              onToggle={() => setShowConf(v => !v)}
              placeholder="Re-enter your password"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={status === 'loading' || status === 'success'}
            style={{
              width: '100%', padding: '12px',
              background: status === 'success' ? green : gold,
              border: 'none', borderRadius: '8px',
              color: '#0a0a0a', fontSize: '.8rem', fontWeight: 700,
              cursor: status === 'loading' || status === 'success' ? 'not-allowed' : 'pointer',
              opacity: status === 'loading' ? .7 : 1,
              transition: 'all .2s',
            }}>
            {status === 'loading' ? 'Setting password…' : status === 'success' ? '✓ Password set!' : 'Set Password →'}
          </button>

          {/* Message */}
          {message && (
            <div style={{
              marginTop: '14px', padding: '10px 12px', borderRadius: '7px',
              background: status === 'success' ? `${green}18` : `${red}18`,
              border: `1px solid ${status === 'success' ? green : red}40`,
              fontSize: '.7rem', color: status === 'success' ? green : red, textAlign: 'center',
            }}>
              {message}
            </div>
          )}

          {/* Strength indicators */}
          {password.length > 0 && status !== 'success' && (
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {checks.map(c => (
                <div key={c.label} style={{
                  fontSize: '.58rem', padding: '2px 8px', borderRadius: '100px',
                  background: c.pass ? `${green}20` : border,
                  color: c.pass ? green : text3, transition: 'all .2s',
                }}>
                  {c.pass ? '✓' : '○'} {c.label}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '.62rem', color: text3 }}>
          White Gold Operations · Confidential
        </div>
      </div>
    </div>
  )
}