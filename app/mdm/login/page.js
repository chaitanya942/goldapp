'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const SSO_DOMAIN = 'sell-gold.in'

// MDM portal login — isolated from GoldApp. A valid sign-in only gets you to
// /mdm; the gate there refuses entry unless the IT admin has enabled the user.
export default function MdmLogin() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b'
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  // After the Google SAML redirect, Supabase returns the session as URL-hash
  // tokens (implicit flow, detectSessionInUrl:false → we adopt them by hand,
  // mirroring the invite/reset pages). Also surfaces any SSO error param.
  useEffect(() => {
    const hash = window.location.hash?.slice(1) || ''
    const search = window.location.search?.slice(1) || ''
    const params = new URLSearchParams(hash || search)
    const errDesc = params.get('error_description') || params.get('error')
    if (errDesc) {
      setErr(decodeURIComponent(errDesc))
      window.history.replaceState(null, '', window.location.pathname)
      return
    }
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (access_token && refresh_token) {
      setBusy(true)
      supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
        window.history.replaceState(null, '', window.location.pathname)
        if (error) { setErr('Could not complete Google sign-in. Try again.'); setBusy(false) }
        else router.push('/mdm')   // gate provisions/locks/admits
      })
    }
  }, [router])

  const signInGoogle = async () => {
    setErr(''); setNotice(''); setBusy(true)
    // Return to THIS exact login page (whatever path/domain it's served at) so
    // the hash-token handler above adopts the session. Robust to custom domains
    // / path rewrites — no hardcoded /mdm/login assumption.
    const { data, error } = await supabase.auth.signInWithSSO({
      domain: SSO_DOMAIN,
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error || !data?.url) { setErr(error?.message || 'Could not start Google sign-in.'); setBusy(false); return }
    window.location.href = data.url   // → Google → back here with the session
  }

  const signIn = async () => {
    setErr(''); setNotice(''); setBusy(true)
    // Username can be anything (name / employee id / phone / email). The server
    // resolves it to the auth email and signs in.
    const r = await fetch('/api/mdm/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'Sign-in failed'); setBusy(false); return }
    const { error } = await supabase.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token })
    if (error) { setErr('Could not start session. Try again.'); setBusy(false); return }
    router.push('/mdm')   // the gate decides: forced reset / lock screen / portal
  }

  const forgot = async () => {
    setErr(''); setNotice('')
    const e = username.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) { setErr('Enter your email above to reset by email. If you log in with a name/ID, ask your IT admin to reset your password.'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: `${window.location.origin}/reset` })
    if (error) { setErr(error.message || 'Could not send reset email'); return }
    setNotice(`If ${e} has an account, a password-reset link is on its way.`)
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

          {/* Google Workspace SSO (SAML) — primary path for @sell-gold.in staff */}
          <button onClick={signInGoogle} disabled={busy}
            style={{ width: '100%', padding: 11, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 9, color: slate, fontSize: '.85rem', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
            <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            <span style={{ fontSize: '.66rem', color: sub, textTransform: 'uppercase', letterSpacing: '.06em' }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
          </div>

          <label style={{ display: 'block', fontSize: '.62rem', color: sub, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 6 }}>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()}
            placeholder="email, employee ID, phone, or name" autoComplete="username"
            style={{ width: '100%', padding: '11px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: '.85rem', color: slate, outline: 'none', marginBottom: 14, boxSizing: 'border-box' }} />
          <label style={{ display: 'block', fontSize: '.62rem', color: sub, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 6 }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()}
            placeholder="••••••••" autoComplete="current-password"
            style={{ width: '100%', padding: '11px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: '.85rem', color: slate, outline: 'none', marginBottom: 18, boxSizing: 'border-box' }} />
          {err && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '.74rem', marginBottom: 14 }}>{err}</div>}
          {notice && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: blue, fontSize: '.74rem', marginBottom: 14 }}>{notice}</div>}
          <button onClick={signIn} disabled={busy}
            style={{ width: '100%', padding: 12, background: blue, border: 'none', borderRadius: 9, color: '#fff', fontSize: '.85rem', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1 }}>
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>
          <button onClick={forgot} style={{ width: '100%', marginTop: 12, background: 'transparent', border: 'none', color: sub, fontSize: '.74rem', fontWeight: 600, cursor: 'pointer' }}>
            Forgot password?
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: '.66rem', color: sub }}>Access is controlled by your IT admin.</div>
      </div>
    </div>
  )
}
