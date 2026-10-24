'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email,     setEmail]     = useState('')
  const [status,    setStatus]    = useState('idle') // idle | loading | sent | error
  const [error,     setError]     = useState('')
  const [countdown, setCountdown] = useState(0)

  const gold  = '#c9a84c'
  const text1 = '#f0e6c8'
  const text3 = '#7a6a4a'
  const green = '#3aaa6a'
  const red   = '#e05555'

  const startCountdown = () => {
    let t = 60
    setCountdown(t)
    const iv = setInterval(() => {
      t--
      setCountdown(t)
      if (t <= 0) clearInterval(iv)
    }, 1000)
  }

  const sendReset = async (emailToSend) => {
    const { error: err } = await supabase.auth.resetPasswordForEmail(emailToSend.trim(), {
      redirectTo: `${window.location.origin}/auth/reset`,
    })
    return err
  }

  const handleSend = async () => {
    setError('')
    if (!email.trim()) return setError('Please enter your email address.')
    setStatus('loading')
    const err = await sendReset(email)
    if (err) { setStatus('error'); setError(err.message); return }
    setStatus('sent')
    startCountdown()
  }

  const handleResend = async () => {
    if (countdown > 0) return
    setStatus('loading')
    const err = await sendReset(email)
    if (err) { setStatus('error'); setError(err.message); return }
    setStatus('sent')
    startCountdown()
  }

  return (
    <div style={{ minHeight:'100vh', background:'#0a0a0a', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
      <div style={{ width:'100%', maxWidth:'400px' }}>

        <div style={{ textAlign:'center', marginBottom:'36px' }}>
          <div style={{ fontSize:'1.6rem', fontWeight:300, color:gold, letterSpacing:'.12em' }}>GOLDAPP</div>
          <div style={{ fontSize:'.65rem', color:text3, marginTop:'6px', letterSpacing:'.1em' }}>WHITE GOLD OPERATIONS</div>
        </div>

        <div style={{ background:'#111111', border:'1px solid #2a2a2a', borderRadius:'14px', padding:'32px', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, left:0, right:0, height:'2px', background:`linear-gradient(90deg,${gold},${gold}00)` }}/>

          {status === 'sent' ? (
            <div style={{ textAlign:'center' }}>
              {/* Email sent icon */}
              <div style={{ width:68, height:68, borderRadius:'50%', background:`${green}12`, border:`1px solid ${green}30`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 22px' }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={green} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>

              <div style={{ fontSize:'1rem', color:text1, fontWeight:500, marginBottom:8 }}>Check your email</div>
              <div style={{ fontSize:'.72rem', color:text3, lineHeight:1.7, marginBottom:6 }}>
                We sent a password reset link to
              </div>
              <div style={{ fontSize:'.85rem', color:gold, fontWeight:600, marginBottom:20 }}>{email}</div>
              <div style={{ fontSize:'.7rem', color:text3, lineHeight:1.7, marginBottom:28, padding:'0 8px' }}>
                Click the link in the email to set a new password. If you don't see it, check your spam folder.
              </div>

              {/* Steps */}
              <div style={{ background:'#161616', border:'1px solid #222', borderRadius:'10px', padding:'16px 18px', marginBottom:24, textAlign:'left' }}>
                {[
                  { n:'1', text:'Open the email from WhiteGold' },
                  { n:'2', text:'Tap "Reset Password" in the email' },
                  { n:'3', text:'Set your new password on the next page' },
                ].map(step => (
                  <div key={step.n} style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:step.n !== '3' ? 12 : 0 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:`${gold}18`, border:`1px solid ${gold}30`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>
                      <span style={{ fontSize:'.6rem', color:gold, fontWeight:700 }}>{step.n}</span>
                    </div>
                    <span style={{ fontSize:'.72rem', color:text3, lineHeight:1.6 }}>{step.text}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleResend}
                disabled={countdown > 0 || status === 'loading'}
                style={{ width:'100%', padding:'11px', background:'transparent', border:`1px solid ${countdown > 0 ? '#2a2a2a' : gold+'60'}`, borderRadius:'8px', color:countdown > 0 ? '#3a3a3a' : gold, fontSize:'.78rem', fontWeight:600, cursor:countdown > 0 ? 'not-allowed' : 'pointer', marginBottom:14, transition:'all .2s' }}>
                {status === 'loading' ? 'Sending…' : countdown > 0 ? `Resend in ${countdown}s` : 'Resend Email'}
              </button>

              <button
                onClick={() => router.push('/')}
                style={{ background:'none', border:'none', color:text3, fontSize:'.72rem', cursor:'pointer', letterSpacing:'.03em' }}>
                ← Back to Sign In
              </button>
            </div>

          ) : (
            <>
              {/* Lock icon */}
              <div style={{ width:52, height:52, borderRadius:'50%', background:`${gold}0d`, border:`1px solid ${gold}25`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:20 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
              </div>

              <div style={{ fontSize:'1rem', color:text1, fontWeight:500, marginBottom:6 }}>Forgot your password?</div>
              <div style={{ fontSize:'.7rem', color:text3, marginBottom:28, lineHeight:1.6 }}>
                No worries. Enter your registered email and we'll send you a secure reset link.
              </div>

              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:'.58rem', color:text3, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:6 }}>Email Address</div>
                <input
                  type="email"
                  placeholder="you@whitegold.money"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  autoFocus
                  style={{ width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'11px 14px', color:text1, fontSize:'.8rem', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
                />
              </div>

              {error && (
                <div style={{ marginBottom:16, padding:'10px 12px', borderRadius:'7px', background:`${red}18`, border:`1px solid ${red}40`, fontSize:'.7rem', color:red }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={status === 'loading'}
                style={{ width:'100%', padding:'12px', background:gold, border:'none', borderRadius:'8px', color:'#0a0a0a', fontSize:'.8rem', fontWeight:700, cursor:status === 'loading' ? 'not-allowed' : 'pointer', opacity:status === 'loading' ? .7 : 1, marginBottom:16 }}>
                {status === 'loading' ? 'Sending…' : 'Send Reset Link →'}
              </button>

              <div style={{ textAlign:'center' }}>
                <button
                  onClick={() => router.push('/')}
                  style={{ background:'none', border:'none', color:text3, fontSize:'.72rem', cursor:'pointer', letterSpacing:'.03em' }}>
                  ← Back to Sign In
                </button>
              </div>
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
