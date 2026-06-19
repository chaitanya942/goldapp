'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

// MDM portal login — isolated from GoldApp. A valid sign-in only gets you to
// /mdm; the gate there refuses entry unless the IT admin has enabled the user.
export default function MdmLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b'

  const signIn = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) { setErr(error.message || 'Sign-in failed'); setBusy(false); return }
    router.push('/mdm')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: slate, letterSpacing: '-.02em' }}>MDM Portal</div>
          <div style={{ fontSize: '.72rem', color: sub, marginTop: 4, letterSpacing: '.04em' }}>Device Management · IT</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 28, boxShadow: '0 4px 24px rgba(15,23,42,.06)' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: slate, marginBottom: 18 }}>Sign in</div>
          <label style={{ display: 'block', fontSize: '.62rem', color: sub, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 6 }}>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()}
            placeholder="you@company.com" autoComplete="username"
            style={{ width: '100%', padding: '11px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: '.85rem', color: slate, outline: 'none', marginBottom: 14, boxSizing: 'border-box' }} />
          <label style={{ display: 'block', fontSize: '.62rem', color: sub, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 6 }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()}
            placeholder="••••••••" autoComplete="current-password"
            style={{ width: '100%', padding: '11px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: '.85rem', color: slate, outline: 'none', marginBottom: 18, boxSizing: 'border-box' }} />
          {err && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '.74rem', marginBottom: 14 }}>{err}</div>}
          <button onClick={signIn} disabled={busy}
            style={{ width: '100%', padding: 12, background: blue, border: 'none', borderRadius: 9, color: '#fff', fontSize: '.85rem', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1 }}>
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: '.66rem', color: sub }}>Access is controlled by your IT admin.</div>
      </div>
    </div>
  )
}
