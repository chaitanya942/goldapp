'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const SSO_DOMAIN = 'sell-gold.in'

const SsoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="10" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)

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

  // After a Google redirect (SAML SSO or OIDC), Supabase returns the session as
  // URL-hash tokens (implicit flow, detectSessionInUrl:false → we adopt them by
  // hand, mirroring the invite/reset pages). Then we enforce the allowed domain
  // so a wrong account is rejected cleanly (this only runs on federated returns,
  // never the username/password path). Also surfaces any provider error param.
  useEffect(() => {
    const hash = window.location.hash?.slice(1) || ''
    const search = window.location.search?.slice(1) || ''
    const params = new URLSearchParams(hash || search)
    const errDesc = params.get('error_description') || params.get('error')
    if (errDesc) {
      setErr(decodeURIComponent(errDesc))
      setBusy(false)
      window.history.replaceState(null, '', window.location.pathname)
      return
    }
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (access_token && refresh_token) {
      setBusy(true)
      supabase.auth.setSession({ access_token, refresh_token }).then(async ({ data, error }) => {
        window.history.replaceState(null, '', window.location.pathname)
        if (error) { setErr('Could not complete sign-in. Try again.'); setBusy(false); return }
        const email = (data?.user?.email || '').toLowerCase()
        if (email && !email.endsWith('@' + SSO_DOMAIN)) {
          // Wrong account (a non-org login) → reject.
          await supabase.auth.signOut()
          setErr(`Only @${SSO_DOMAIN} accounts can sign in here — you used ${email}.`)
          setBusy(false)
          return
        }
        router.push('/mdm')   // gate provisions/locks/admits
      })
    }
  }, [router])

  // Re-enable the buttons if the user comes BACK to this page after a redirect
  // (browser bfcache restores JS state, so `busy` could otherwise stay true and
  // lock every button). pageshow fires on both fresh load and bfcache restore.
  useEffect(() => {
    const onShow = () => setBusy(false)
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const redirectHere = () => window.location.origin + window.location.pathname

  // Single sign-on via SAML — routes the @sell-gold.in domain through the
  // configured IdP (currently Hexnode). Provider-agnostic on our side: we call
  // signInWithSSO by domain, so swapping the IdP needs no code change.
  const signInSSO = async () => {
    setErr(''); setNotice(''); setBusy(true)
    const { data, error } = await supabase.auth.signInWithSSO({
      domain: SSO_DOMAIN,
      options: { redirectTo: redirectHere() },
    })
    if (error || !data?.url) { setErr(error?.message || 'Could not start sign-in.'); setBusy(false); return }
    window.location.href = data.url
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

          {/* Two Google sign-in options (for the IT-Head comparison / pitch):
              A = Workspace SSO (SAML), B = Account chooser (OAuth/OIDC). */}
          {(() => {
            const gbtn = { width: '100%', padding: 11, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 9, color: slate, fontSize: '.85rem', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }
            const cap  = { fontSize: '.62rem', color: sub, textAlign: 'center', margin: '5px 0 0' }
            return (
              <>
                <button onClick={signInSSO} disabled={busy} style={gbtn}><SsoIcon /> Sign in with SSO</button>
                <div style={cap}>Single sign-on · @{SSO_DOMAIN}</div>
              </>
            )
          })()}

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
