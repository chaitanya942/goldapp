'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { startRegistration } from '@simplewebauthn/browser'

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

function PasswordInput({ value, onChange, onKeyDown, show, onToggle, placeholder }) {
  return (
    <div style={{ display:'flex', alignItems:'center', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', overflow:'hidden' }}>
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        style={{ flex:1, background:'transparent', border:'none', outline:'none', padding:'11px 14px', color:'#f0e6c8', fontSize:'.8rem', fontFamily:'inherit' }}
      />
      <button type="button" onClick={onToggle} tabIndex={-1}
        style={{ padding:'0 14px', background:'transparent', border:'none', color:'#7a6a4a', cursor:'pointer', display:'flex', alignItems:'center', height:'100%' }}>
        <Eye open={show} />
      </button>
    </div>
  )
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [step,        setStep]        = useState('loading')  // loading | invalid | password | biometric
  const [password,    setPassword]    = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [status,      setStatus]      = useState('idle')
  const [message,     setMessage]     = useState('')
  const [showPwd,     setShowPwd]     = useState(false)
  const [showConf,    setShowConf]    = useState(false)
  const [bioLoading,  setBioLoading]  = useState(false)
  const [bioError,    setBioError]    = useState('')
  const [userEmail,   setUserEmail]   = useState('')
  const [accessToken, setAccessToken] = useState('')

  const gold  = '#c9a84c'
  const text1 = '#f0e6c8'
  const text3 = '#7a6a4a'
  const green = '#3aaa6a'
  const red   = '#e05555'

  useEffect(() => {
    const init = async () => {
      // Supabase password reset emails send tokens in URL hash: #access_token=...&type=recovery
      const hash    = window.location.hash.substring(1)
      const hParams = new URLSearchParams(hash)
      const at      = hParams.get('access_token')
      const rt      = hParams.get('refresh_token')
      const type    = hParams.get('type')

      const code = new URLSearchParams(window.location.search).get('code')

      if (at && rt) {
        const { data: { session }, error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt })
        if (error || !session) { setStep('invalid'); return }
        if (session.user?.email) setUserEmail(session.user.email)
        if (session.access_token) setAccessToken(session.access_token)
        window.history.replaceState(null, '', window.location.pathname)
        setStep('password')
      } else if (code) {
        const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error || !session) { setStep('invalid'); return }
        if (session.user?.email) setUserEmail(session.user.email)
        if (session.access_token) setAccessToken(session.access_token)
        window.history.replaceState(null, '', window.location.pathname)
        setStep('password')
      } else {
        // Check for existing recovery session
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setStep('invalid'); return }
        if (session.user?.email) setUserEmail(session.user.email)
        if (session.access_token) setAccessToken(session.access_token)
        setStep('password')
      }
    }
    init()
  }, [])

  const handleSubmit = async () => {
    setMessage('')
    if (!password)            return setMessage('Please enter a new password.')
    if (password.length < 8)  return setMessage('Password must be at least 8 characters.')
    if (password !== confirm)  return setMessage('Passwords do not match.')

    setStatus('loading')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setStatus('error'); setMessage(error.message || 'Failed to reset password.'); return }

    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) setAccessToken(session.access_token)

    setStatus('success')

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const hasSavedPasskey = !!localStorage.getItem('wg_passkey_data') || !!localStorage.getItem('wg_passkey_email')

    if (isMobile && window.PublicKeyCredential && !hasSavedPasskey) {
      setStep('biometric')
    } else {
      setMessage('Password reset! Signing you in…')
      setTimeout(() => router.push('/dashboard'), 1400)
    }
  }

  const handleEnableBiometric = async () => {
    setBioLoading(true); setBioError('')
    try {
      const optRes = await fetch('/api/webauthn/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      })
      const options = await optRes.json()
      if (!optRes.ok) throw new Error(options.error || 'Failed to get options')

      const regResponse = await startRegistration({ optionsJSON: options })

      const verifyRes = await fetch('/api/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify(regResponse),
      })
      const result = await verifyRes.json()
      if (!verifyRes.ok) throw new Error(result.error || 'Registration failed')

      localStorage.setItem('wg_passkey_data', JSON.stringify({ email: userEmail, credentialId: regResponse.id }))
      localStorage.removeItem('wg_passkey_email')
      router.push('/dashboard')
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.message?.includes('timed out') || err.message?.includes('not allowed')) {
        router.push('/dashboard')
        return
      }
      setBioError(err.message || 'Failed to enable biometric login')
      setBioLoading(false)
    }
  }

  const checks = [
    { label: '8+ chars',        pass: password.length >= 8 },
    { label: 'Uppercase',       pass: /[A-Z]/.test(password) },
    { label: 'Number',          pass: /[0-9]/.test(password) },
    { label: 'Passwords match', pass: password === confirm && confirm.length > 0 },
  ]

  return (
    <div style={{ minHeight:'100vh', background:'#0a0a0a', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
      <div style={{ width:'100%', maxWidth:'400px' }}>

        <div style={{ textAlign:'center', marginBottom:'36px' }}>
          <div style={{ fontSize:'1.6rem', fontWeight:300, color:gold, letterSpacing:'.12em' }}>GOLDAPP</div>
          <div style={{ fontSize:'.65rem', color:text3, marginTop:'6px', letterSpacing:'.1em' }}>WHITE GOLD OPERATIONS</div>
        </div>

        <div style={{ background:'#111111', border:'1px solid #2a2a2a', borderRadius:'14px', padding:'32px', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, left:0, right:0, height:'2px', background:`linear-gradient(90deg,${gold},${gold}00)` }}/>

          {/* ── Loading ── */}
          {step === 'loading' && (
            <div style={{ textAlign:'center', padding:'24px 0' }}>
              <div style={{ width:28, height:28, border:`2px solid ${gold}20`, borderTopColor:gold, borderRadius:'50%', animation:'spin .8s linear infinite', margin:'0 auto 16px' }} />
              <div style={{ fontSize:'.75rem', color:text3 }}>Verifying reset link…</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {/* ── Invalid / Expired ── */}
          {step === 'invalid' && (
            <div style={{ textAlign:'center' }}>
              <div style={{ width:64, height:64, borderRadius:'50%', background:`${red}12`, border:`1px solid ${red}30`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div style={{ fontSize:'1rem', color:text1, fontWeight:500, marginBottom:8 }}>Link expired or invalid</div>
              <div style={{ fontSize:'.72rem', color:text3, lineHeight:1.7, marginBottom:24 }}>
                This password reset link has expired or already been used. Request a new one below.
              </div>
              <button
                onClick={() => router.push('/auth/forgot-password')}
                style={{ width:'100%', padding:'12px', background:gold, border:'none', borderRadius:'8px', color:'#0a0a0a', fontSize:'.8rem', fontWeight:700, cursor:'pointer', marginBottom:12 }}>
                Request New Link →
              </button>
              <button onClick={() => router.push('/')} style={{ background:'none', border:'none', color:text3, fontSize:'.72rem', cursor:'pointer' }}>
                ← Back to Sign In
              </button>
            </div>
          )}

          {/* ── Biometric step ── */}
          {step === 'biometric' && (
            <div style={{ textAlign:'center' }}>
              <div style={{ width:58, height:58, borderRadius:'50%', background:`${gold}0d`, border:`1px solid ${gold}25`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"/>
                </svg>
              </div>
              <div style={{ fontSize:'1rem', color:text1, fontWeight:500, marginBottom:8 }}>Set Up Biometric Login</div>
              <div style={{ fontSize:'.7rem', color:text3, lineHeight:1.7, marginBottom:24 }}>
                Skip the password next time — use your fingerprint or Face ID to sign in instantly.
              </div>
              {bioError && (
                <div style={{ padding:'9px 12px', borderRadius:'7px', background:`${red}18`, border:`1px solid ${red}40`, fontSize:'.7rem', color:red, marginBottom:16, textAlign:'left' }}>
                  {bioError}
                </div>
              )}
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={handleEnableBiometric} disabled={bioLoading}
                  style={{ flex:1, padding:'12px', background:gold, border:'none', borderRadius:'8px', color:'#0a0a0a', fontSize:'.78rem', fontWeight:700, cursor:bioLoading ? 'not-allowed' : 'pointer', opacity:bioLoading ? .6 : 1 }}>
                  {bioLoading ? 'Saving…' : 'Enable Now'}
                </button>
                <button onClick={() => router.push('/dashboard')} disabled={bioLoading}
                  style={{ flex:1, padding:'12px', background:'transparent', border:'1px solid #2a2a2a', borderRadius:'8px', color:text3, fontSize:'.78rem', fontWeight:600, cursor:'pointer' }}>
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── Password step ── */}
          {step === 'password' && (
            <>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
                <div style={{ width:40, height:40, borderRadius:'50%', background:`${gold}0d`, border:`1px solid ${gold}25`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize:'1rem', color:text1, fontWeight:500 }}>Reset your password</div>
                  {userEmail && <div style={{ fontSize:'.68rem', color:gold, marginTop:2 }}>{userEmail}</div>}
                </div>
              </div>

              <div style={{ fontSize:'.7rem', color:text3, marginBottom:24, lineHeight:1.6 }}>
                Choose a strong new password. You'll be signed in automatically after.
              </div>

              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:'.58rem', color:text3, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:6 }}>New Password</div>
                <PasswordInput value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} show={showPwd} onToggle={() => setShowPwd(v => !v)} placeholder="Minimum 8 characters"/>
              </div>

              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:'.58rem', color:text3, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:6 }}>Confirm Password</div>
                <PasswordInput value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} show={showConf} onToggle={() => setShowConf(v => !v)} placeholder="Re-enter your password"/>
              </div>

              <button onClick={handleSubmit} disabled={status === 'loading' || status === 'success'}
                style={{ width:'100%', padding:'12px', background:gold, border:'none', borderRadius:'8px', color:'#0a0a0a', fontSize:'.8rem', fontWeight:700, cursor:status === 'loading' ? 'not-allowed' : 'pointer', opacity:status === 'loading' ? .7 : 1 }}>
                {status === 'loading' ? 'Saving…' : status === 'success' ? 'Saved! Signing in…' : 'Reset Password →'}
              </button>

              {message && (
                <div style={{ marginTop:14, padding:'10px 12px', borderRadius:'7px', background:`${status === 'error' ? red : green}18`, border:`1px solid ${status === 'error' ? red : green}40`, fontSize:'.7rem', color:status === 'error' ? red : green, textAlign:'center' }}>
                  {message}
                </div>
              )}

              {password.length > 0 && status !== 'success' && (
                <div style={{ marginTop:16, display:'flex', gap:8, flexWrap:'wrap' }}>
                  {checks.map(c => (
                    <div key={c.label} style={{ fontSize:'.58rem', padding:'2px 8px', borderRadius:'100px', background:c.pass ? `${green}20` : '#2a2a2a', color:c.pass ? green : text3, transition:'all .2s' }}>
                      {c.pass ? '✓' : '○'} {c.label}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ textAlign:'center', marginTop:'20px', fontSize:'.62rem', color:text3 }}>
          White Gold Operations · Confidential
        </div>
      </div>
    </div>
  )
}
