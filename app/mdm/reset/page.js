'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { authedFetch } from '../../../lib/authedFetch'

// Set a new password. Two entry points:
//   1. First login with a temp password (mdm_must_reset) — the /mdm gate sends
//      the user here; their session already exists.
//   2. Forgot-password email — Supabase recovery link drops tokens in the URL
//      hash; we establish the session, then let them set a new password.
// The new password is known only to the user, stored nowhere by us.
export default function MdmReset() {
  const router = useRouter()
  const [step, setStep] = useState('loading')   // loading | form | nosession
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b', red = '#dc2626'

  useEffect(() => {
    (async () => {
      // Recovery tokens from the forgot-password email (hash fragment).
      const h = new URLSearchParams(window.location.hash.substring(1))
      const at = h.get('access_token'), rt = h.get('refresh_token')
      if (at && rt) {
        await supabase.auth.setSession({ access_token: at, refresh_token: rt }).catch(() => {})
        window.history.replaceState(null, '', window.location.pathname)
      }
      const { data: { session } } = await supabase.auth.getSession()
      setStep(session ? 'form' : 'nosession')
    })()
  }, [])

  useEffect(() => { if (step === 'nosession') router.replace('/mdm/login') }, [step, router])

  const submit = async () => {
    setMsg('')
    if (password.length < 8) return setMsg('Password must be at least 8 characters.')
    if (password !== confirm) return setMsg('Passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setBusy(false); setMsg(error.message || 'Failed to set password.'); return }
    // Clear the forced-reset flag (no-op for forgot-password recovery), then
    // refresh the session so the cleared flag is reflected, and enter the portal.
    try { await authedFetch('/api/mdm/reset-complete', { method: 'POST' }) } catch {}
    try { await supabase.auth.refreshSession() } catch {}
    router.replace('/mdm')
  }

  const input = { width: '100%', padding: '11px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: '.85rem', color: slate, outline: 'none', boxSizing: 'border-box' }

  if (step === 'loading' || step === 'nosession')
    return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: sub, fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>Loading…</div>

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: slate, letterSpacing: '-.02em' }}>MDM Portal</div>
          <div style={{ fontSize: '.72rem', color: sub, marginTop: 4 }}>Set a new password</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 28, boxShadow: '0 4px 24px rgba(15,23,42,.06)' }}>
          <div style={{ fontSize: '.74rem', color: sub, marginBottom: 18, lineHeight: 1.5 }}>Choose a new password. Only you will know it — it isn't stored anywhere.</div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (min 8)" style={{ ...input, marginBottom: 12 }} />
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Confirm new password" style={{ ...input, marginBottom: 16 }} />
          {msg && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: red, fontSize: '.74rem', marginBottom: 14 }}>{msg}</div>}
          <button onClick={submit} disabled={busy} style={{ width: '100%', padding: 12, background: blue, border: 'none', borderRadius: 9, color: '#fff', fontSize: '.85rem', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1 }}>
            {busy ? 'Saving…' : 'Save & continue →'}
          </button>
        </div>
      </div>
    </div>
  )
}
