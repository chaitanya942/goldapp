'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

// MDM invite → set-password. Handles the Supabase invite token (hash or PKCE
// code), lets the user set a password, then sends them to /mdm. Entry there is
// still gated by the IT admin's active switch.
export default function MdmConfirm() {
  const router = useRouter()
  const [step, setStep] = useState('loading')   // loading | password | error
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b', red = '#dc2626'

  useEffect(() => {
    (async () => {
      try {
        const { data: { session: existing } } = await supabase.auth.getSession()
        if (existing) { window.history.replaceState(null, '', window.location.pathname); setStep('password'); return }
        const h = new URLSearchParams(window.location.hash.substring(1))
        const at = h.get('access_token'), rt = h.get('refresh_token')
        if (at && rt) {
          const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt })
          if (error) { setMsg(error.message); setStep('error'); return }
          window.history.replaceState(null, '', window.location.pathname); setStep('password'); return
        }
        const code = new URLSearchParams(window.location.search).get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) { setMsg(error.message); setStep('error'); return }
          setStep('password'); return
        }
        setMsg('Invite link is missing or expired. Ask your IT admin for a new one.'); setStep('error')
      } catch (e) { setMsg(e?.message || 'Something went wrong.'); setStep('error') }
    })()
  }, [])

  const submit = async () => {
    setMsg('')
    if (password.length < 8) return setMsg('Password must be at least 8 characters.')
    if (password !== confirm) return setMsg('Passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setBusy(false); setMsg(error.message || 'Failed to set password.'); return }
    router.push('/mdm')
  }

  const input = { width: '100%', padding: '11px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: '.85rem', color: slate, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: slate, letterSpacing: '-.02em' }}>MDM Portal</div>
          <div style={{ fontSize: '.72rem', color: sub, marginTop: 4 }}>Activate your account</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 28, boxShadow: '0 4px 24px rgba(15,23,42,.06)' }}>
          {step === 'loading' && <div style={{ textAlign: 'center', color: sub, fontSize: '.8rem', padding: '16px 0' }}>Verifying invite…</div>}
          {step === 'error' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '.95rem', color: slate, fontWeight: 600, marginBottom: 8 }}>Invite link problem</div>
              <div style={{ fontSize: '.76rem', color: sub, lineHeight: 1.6 }}>{msg}</div>
            </div>
          )}
          {step === 'password' && (
            <>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: slate, marginBottom: 6 }}>Set your password</div>
              <div style={{ fontSize: '.74rem', color: sub, marginBottom: 18, lineHeight: 1.5 }}>Create a password to activate your MDM account.</div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (min 8)" style={{ ...input, marginBottom: 12 }} />
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Confirm password" style={{ ...input, marginBottom: 16 }} />
              {msg && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: red, fontSize: '.74rem', marginBottom: 14 }}>{msg}</div>}
              <button onClick={submit} disabled={busy} style={{ width: '100%', padding: 12, background: blue, border: 'none', borderRadius: 9, color: '#fff', fontSize: '.85rem', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1 }}>
                {busy ? 'Saving…' : 'Set password →'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
