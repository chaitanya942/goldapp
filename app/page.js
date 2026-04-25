'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

export default function LoginPage() {
  const [email,             setEmail]             = useState('')
  const [password,          setPassword]          = useState('')
  const [loading,           setLoading]           = useState(false)
  const [error,             setError]             = useState('')
  const [showPassword,      setShowPassword]      = useState(false)
  const [step,              setStep]              = useState('login')       // 'login' | 'passkey-prompt'
  const [hasSavedPasskey,   setHasSavedPasskey]   = useState(false)
  const [savedPasskeyEmail, setSavedPasskeyEmail] = useState('')
  const [savedCredentialId, setSavedCredentialId] = useState(null)
  const [biometricLoading,  setBiometricLoading]  = useState(false)
  const [passkeyError,      setPasskeyError]      = useState('')
  const [sessionChecking,   setSessionChecking]   = useState(true)
  const accessTokenRef = useRef(null)

  const canvasRef   = useRef(null)
  const bgRef       = useRef(null)   // parallax background wrapper
  const mousePos    = useRef({ x: 0, y: 0 })
  const bgSmooth    = useRef({ x: 0, y: 0 })
  const rafRef      = useRef(null)

  // ── Skip login if already authenticated ─────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        window.location.href = '/dashboard'
      } else {
        setSessionChecking(false)
      }
    })
  }, [])

  // ── Check for saved passkey & auto-trigger biometric prompt ─
  useEffect(() => {
    const data  = JSON.parse(localStorage.getItem('wg_passkey_data') || 'null')
    const email = data?.email || localStorage.getItem('wg_passkey_email')
    if (email) {
      setHasSavedPasskey(true)
      setSavedPasskeyEmail(email)
      setSavedCredentialId(data?.credentialId || null)
    }
  }, [])

  useEffect(() => {
    if (!hasSavedPasskey) return
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return
    handleBiometricLogin()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSavedPasskey])

  // ── Particles ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId, pts = []

    const init = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      pts = Array.from({ length: 60 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.0 + 0.1,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.12,
        a: Math.random() * 0.35 + 0.05,
        ph: Math.random() * Math.PI * 2,
        spd: Math.random() * 0.011 + 0.006,
      }))
    }
    init()
    window.addEventListener('resize', init)

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of pts) {
        p.ph += p.spd
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(201,168,76,${p.a * (0.45 + 0.55 * Math.sin(p.ph))})`
        ctx.fill()
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0
      }
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', init) }
  }, [])

  // ── Mouse parallax ─────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', onMove)

    const tick = () => {
      const { x: mx, y: my } = mousePos.current
      const W = window.innerWidth, H = window.innerHeight
      const nx = (mx / W - 0.5) * 2
      const ny = (my / H - 0.5) * 2

      bgSmooth.current.x += (nx * 14 - bgSmooth.current.x) * 0.04
      bgSmooth.current.y += (ny * 10 - bgSmooth.current.y) * 0.04
      if (bgRef.current) {
        bgRef.current.style.transform =
          `translate(${bgSmooth.current.x}px, ${bgSmooth.current.y}px) scale(1.04)`
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ── Button ripple ───────────────────────────────────────────
  const handleRipple = (e) => {
    const btn = e.currentTarget
    const rect = btn.getBoundingClientRect()
    const rip  = document.createElement('span')
    const size = Math.max(rect.width, rect.height) * 2
    rip.style.cssText = `
      position:absolute;
      width:${size}px; height:${size}px;
      left:${e.clientX - rect.left - size/2}px;
      top:${e.clientY - rect.top - size/2}px;
      background:rgba(255,255,255,0.18);
      border-radius:50%;
      transform:scale(0);
      animation:ripple .55s ease-out forwards;
      pointer-events:none;
    `
    btn.appendChild(rip)
    setTimeout(() => rip.remove(), 600)
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); setLoading(false); return }
    accessTokenRef.current = data.session?.access_token
    // Offer passkey registration if device supports it and not already saved for this email
    const savedData    = JSON.parse(localStorage.getItem('wg_passkey_data') || 'null')
    const alreadySaved = savedData?.email === email || localStorage.getItem('wg_passkey_email') === email
    const isMobile     = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (!alreadySaved && isMobile && window.PublicKeyCredential) {
      setLoading(false)
      setStep('passkey-prompt')
      return
    }
    window.location.href = '/dashboard'
  }

  const handleBiometricLogin = async () => {
    setBiometricLoading(true); setPasskeyError('')
    try {
      const optRes = await fetch('/api/webauthn/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: savedPasskeyEmail, credentialId: savedCredentialId }),
      })
      const options = await optRes.json()
      if (!optRes.ok) throw new Error(options.error || 'Failed to get options')
      const authnResponse = await startAuthentication({ optionsJSON: options })
      const verifyRes = await fetch('/api/webauthn/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: savedPasskeyEmail, response: authnResponse }),
      })
      const result = await verifyRes.json()
      if (!verifyRes.ok) throw new Error(result.error || 'Authentication failed')
      const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: result.token_hash, type: 'magiclink' })
      if (otpErr) throw new Error(otpErr.message)
      window.location.href = '/dashboard'
    } catch (err) {
      // User dismissed the prompt (back button / cancel / timeout) — silently fall back to form
      if (err.name === 'NotAllowedError' || err.message?.includes('timed out') || err.message?.includes('not allowed')) {
        setBiometricLoading(false)
        return
      }
      setPasskeyError(err.message || 'Biometric login failed')
      setBiometricLoading(false)
    }
  }

  const handleSavePasskey = async () => {
    setBiometricLoading(true); setPasskeyError('')
    try {
      const token = accessTokenRef.current
      const optRes = await fetch('/api/webauthn/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      })
      const options = await optRes.json()
      if (!optRes.ok) throw new Error(options.error || 'Failed to get options')
      const regResponse = await startRegistration({ optionsJSON: options })
      const verifyRes = await fetch('/api/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(regResponse),
      })
      const result = await verifyRes.json()
      if (!verifyRes.ok) throw new Error(result.error || 'Registration failed')
      localStorage.setItem('wg_passkey_data', JSON.stringify({ email, credentialId: regResponse.id }))
      localStorage.removeItem('wg_passkey_email')
      window.location.href = '/dashboard'
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.message?.includes('timed out') || err.message?.includes('not allowed')) {
        window.location.href = '/dashboard'
        return
      }
      setPasskeyError(err.message || 'Failed to save biometric login')
      setBiometricLoading(false)
    }
  }

  const handleSkipPasskey = () => { window.location.href = '/dashboard' }

  if (sessionChecking) return (
    <div style={{ height:'100vh', background:'#060401', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <svg width="32" height="32" viewBox="0 0 32 32" style={{ animation:'spin .9s linear infinite' }}>
        <circle cx="16" cy="16" r="12" fill="none" stroke="rgba(201,168,76,0.12)" strokeWidth="2"/>
        <circle cx="16" cy="16" r="12" fill="none" stroke="#C9A84C" strokeWidth="2" strokeDasharray="18 56" strokeLinecap="round"/>
      </svg>
      <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
    </div>
  )

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; background: #060401; }
        body { font-family: var(--font-jakarta), 'Plus Jakarta Sans', -apple-system, sans-serif; }

        /* ── STAGE ── */
        .stage {
          position: relative;
          height: 100vh; width: 100vw;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          background: #060401;
          /* Nudge content zone slightly below centre so logo clears the top-right edge line */
          padding-top: 48px;
        }

        /* ── PARALLAX BG WRAPPER ── */
        .bg-wrap {
          position: absolute;
          inset: -5%;           /* slightly oversized so parallax doesn't expose edges */
          will-change: transform;
          transform-origin: center;
        }

        /* ── FACETED PANELS ── */
        .panel { position: absolute; inset: 0; pointer-events: none; }
        .p-tl {
          background: linear-gradient(135deg, #141008 0%, #0c0904 100%);
          clip-path: polygon(0 0, 68% 0, 36% 100%, 0 100%);
        }
        .p-tr {
          background: linear-gradient(225deg, #110e07 0%, #090703 100%);
          clip-path: polygon(72% 0, 100% 0, 100% 100%, 60% 100%);
        }
        .p-bc {
          background: #030200;
          clip-path: polygon(28% 100%, 62% 100%, 100% 58%, 100% 100%, 0 100%, 0 70%);
        }

        /* ── SHARP EDGE LINES ── */
        .edges { position: absolute; inset: 0; pointer-events: none; }
        .edges svg { width: 100%; height: 100%; }

        /* ── STREAKS ── */
        .streaks { position: absolute; inset: 0; pointer-events: none; }
        .streak-1 {
          position: absolute; top: -10%; left: -5%; width: 60%; height: 120%;
          background: linear-gradient(148deg,
            transparent 0%, transparent 35%,
            rgba(201,168,76,0.07) 36.5%,
            rgba(240,215,90,0.32) 37.4%,
            rgba(255,230,100,0.18) 37.9%,
            rgba(240,215,90,0.32) 38.4%,
            rgba(201,168,76,0.07) 39.5%,
            transparent 41%);
          animation: streakPulse 5s ease-in-out infinite;
        }
        .streak-2 {
          position: absolute; top: -10%; left: 2%; width: 60%; height: 120%;
          background: linear-gradient(148deg,
            transparent 0%, transparent 44%,
            rgba(201,168,76,0.04) 44.8%,
            rgba(201,168,76,0.14) 45.4%,
            rgba(201,168,76,0.04) 46%,
            transparent 47%);
          animation: streakPulse 5s ease-in-out 1.2s infinite;
        }
        .streak-3 {
          position: absolute; top: 0; right: -5%; width: 50%; height: 100%;
          background: linear-gradient(-140deg,
            transparent 0%, transparent 46%,
            rgba(201,168,76,0.05) 47%,
            rgba(240,210,80,0.24) 47.8%,
            rgba(201,168,76,0.05) 48.6%,
            transparent 50%);
          animation: streakPulse 7s ease-in-out 2.5s infinite;
        }
        .streak-4 {
          position: absolute; top: -5%; left: 10%; width: 40%; height: 60%;
          background: linear-gradient(148deg,
            transparent 0%, transparent 55%,
            rgba(255,235,120,0.07) 56%,
            rgba(255,235,120,0.16) 56.5%,
            rgba(255,235,120,0.07) 57%,
            transparent 58%);
          animation: streakPulse 9s ease-in-out 4s infinite;
        }

        /* ── ATM GLOW ── */
        .atm {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 55% 60% at 50% 50%, rgba(201,168,76,0.12) 0%, transparent 60%),
            radial-gradient(ellipse 85% 65% at 50% 50%, rgba(120,85,10,0.06) 0%, transparent 70%);
        }

        /* Particles */
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

        /* ── CONTENT ── */
        .content {
          position: relative; z-index: 10;
          display: flex; flex-direction: column; align-items: center;
          width: 100%; max-width: 400px;
          padding: 0 24px;
        }

        /* ── LOGO ── */
        .logo-wrap {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 36px;
          opacity: 0;
          animation: fadeUp 1.3s cubic-bezier(.22,1,.36,1) .1s forwards;
        }
        .logo-halo {
          position: absolute;
          width: 340px; height: 180px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(201,168,76,0.18) 0%, transparent 65%);
          filter: blur(6px);
          animation: breathe 5s ease-in-out infinite;
        }
        .logo-img {
          position: relative; z-index: 1;
          width: 230px; height: auto;
          filter: brightness(10) saturate(0.08)
                  drop-shadow(0 0 40px rgba(201,168,76,0.38))
                  drop-shadow(0 0 14px rgba(201,168,76,0.22));
          opacity: 0.95;
          mix-blend-mode: lighten;
          animation: float 8s ease-in-out infinite;
        }

        /* ── CARD ── */
        .card {
          position: relative; width: 100%;
          background: rgba(18,13,6,0.78);
          border: 1px solid rgba(201,168,76,0.16);
          border-radius: 16px;
          padding: 34px 34px 30px;
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          box-shadow:
            0 32px 80px rgba(0,0,0,0.75),
            0 8px 32px rgba(0,0,0,0.5),
            0 1px 0 rgba(201,168,76,0.1) inset,
            0 -1px 0 rgba(0,0,0,0.5) inset;
          opacity: 0;
          animation: fadeUp 1.1s cubic-bezier(.22,1,.36,1) .28s forwards;
          overflow: hidden;
          transition: box-shadow .3s ease;
        }
        .card:hover {
          box-shadow:
            0 36px 90px rgba(0,0,0,0.8),
            0 8px 32px rgba(0,0,0,0.5),
            0 0 0 1px rgba(201,168,76,0.22),
            0 1px 0 rgba(201,168,76,0.14) inset,
            0 -1px 0 rgba(0,0,0,0.5) inset;
        }

        /* Card top shimmer line */
        .card::before {
          content: '';
          position: absolute; top: 0; left: 15%; right: 15%; height: 1px;
          background: linear-gradient(90deg,
            transparent,
            rgba(201,168,76,0.38) 25%,
            rgba(255,230,100,0.7) 50%,
            rgba(201,168,76,0.38) 75%,
            transparent);
        }

        /* Card entry shimmer sweep */
        .card::after {
          content: '';
          position: absolute; top: 0; left: -100%; width: 60%; height: 100%;
          background: linear-gradient(105deg,
            transparent 40%,
            rgba(201,168,76,0.04) 50%,
            rgba(255,230,100,0.07) 52%,
            rgba(201,168,76,0.04) 54%,
            transparent 64%);
          animation: cardShimmer 1.4s cubic-bezier(.22,1,.36,1) .5s forwards;
          pointer-events: none;
        }

        /* Corner brackets */
        .card-cb { position: absolute; width: 14px; height: 14px; }
        .card-tl { top: -1px; left: -1px; border-top: 1px solid rgba(201,168,76,0.42); border-left: 1px solid rgba(201,168,76,0.42); border-radius: 16px 0 0 0; }
        .card-tr { top: -1px; right: -1px; border-top: 1px solid rgba(201,168,76,0.42); border-right: 1px solid rgba(201,168,76,0.42); border-radius: 0 16px 0 0; }
        .card-bl { bottom: -1px; left: -1px; border-bottom: 1px solid rgba(201,168,76,0.42); border-left: 1px solid rgba(201,168,76,0.42); border-radius: 0 0 0 16px; }
        .card-br { bottom: -1px; right: -1px; border-bottom: 1px solid rgba(201,168,76,0.42); border-right: 1px solid rgba(201,168,76,0.42); border-radius: 0 0 16px 0; }

        /* Card heading */
        .card-title {
          font-size: 1.5rem; font-weight: 300;
          color: rgba(255,255,255,0.9);
          letter-spacing: -.028em; margin-bottom: 4px;
        }
        .card-sub {
          font-size: .63rem; font-weight: 400;
          color: rgba(255,255,255,0.22);
          margin-bottom: 28px; letter-spacing: .01em;
        }

        /* ── FIELDS ── */
        .field { margin-bottom: 16px; }
        .flbl {
          display: block;
          font-size: .55rem; font-weight: 700;
          letter-spacing: .22em; text-transform: uppercase;
          color: rgba(201,168,76,0.34);
          margin-bottom: 7px;
          transition: color .22s, letter-spacing .22s;
        }
        .field:focus-within .flbl {
          color: rgba(201,168,76,0.78);
          letter-spacing: .18em;
        }

        .inp-wrap { position: relative; }

        /* Animated gold focus bar underneath input */
        .inp-wrap::after {
          content: '';
          position: absolute; bottom: 0; left: 50%;
          width: 0; height: 2px;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,0.7) 30%, #c9a84c 50%, rgba(201,168,76,0.7) 70%, transparent);
          border-radius: 0 0 9px 9px;
          transform: translateX(-50%);
          transition: width .35s cubic-bezier(.22,1,.36,1);
          pointer-events: none;
        }
        .field:focus-within .inp-wrap::after { width: 100%; }

        .inp {
          width: 100%;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.055);
          border-radius: 9px;
          padding: 12px 15px;
          font-family: inherit;
          font-size: .875rem; font-weight: 400;
          color: rgba(255,255,255,0.88); outline: none;
          transition: border-color .22s, background .22s, box-shadow .22s, transform .15s;
          caret-color: #c9a84c;
        }
        .inp:focus {
          border-color: rgba(201,168,76,0.3);
          background: rgba(201,168,76,0.035);
          box-shadow: 0 0 0 3px rgba(201,168,76,0.045), 0 4px 16px rgba(0,0,0,0.3);
          transform: translateY(-1px);
        }
        .inp:-webkit-autofill,
        .inp:-webkit-autofill:hover,
        .inp:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #100d09 inset !important;
          -webkit-text-fill-color: rgba(255,255,255,0.88) !important;
          caret-color: #c9a84c;
        }
        .inp::placeholder { color: rgba(255,255,255,0.13); }
        .inp.pw { padding-right: 46px; }

        .eye-btn {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; padding: 4px;
          color: rgba(201,168,76,0.25); transition: color .2s;
          display: flex; align-items: center;
        }
        .eye-btn:hover { color: rgba(201,168,76,0.65); }
        .eye-btn svg { width: 15px; height: 15px; }

        /* ── ERROR ── */
        .errmsg {
          display: flex; align-items: center; gap: 9px;
          background: rgba(180,40,40,0.08);
          border: 1px solid rgba(200,70,70,0.15);
          border-radius: 8px;
          padding: 9px 12px; margin-bottom: 12px;
          font-size: .72rem; color: rgba(255,140,140,0.82);
          animation: shake .36s ease;
        }
        .errdot { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,100,100,0.5); flex-shrink: 0; }

        /* ── BUTTON ── */
        .btn-wrap { margin-top: 20px; }
        .btn {
          width: 100%; padding: 14px 20px;
          background: linear-gradient(108deg, #9a6e18 0%, #c9a84c 28%, #edd870 50%, #c09030 72%, #9a6e18 100%);
          background-size: 240% 100%;
          border: none; border-radius: 9px;
          font-family: inherit;
          font-size: .66rem; font-weight: 800;
          letter-spacing: .24em; text-transform: uppercase;
          color: rgba(5,3,0,0.9); cursor: pointer;
          position: relative; overflow: hidden;
          transition: transform .24s cubic-bezier(.22,1,.36,1), box-shadow .24s;
          animation: gold-slide 4s linear infinite;
        }
        /* Hover sweep */
        .btn::before {
          content: '';
          position: absolute; top: 0; left: -90%;
          width: 58%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
          transform: skewX(-22deg); transition: left .48s ease;
        }
        .btn:hover::before { left: 140%; }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(201,168,76,0.38), 0 4px 12px rgba(201,168,76,0.18);
        }
        .btn:active { transform: scale(0.99) translateY(0); }
        .btn:disabled { opacity: .38; cursor: not-allowed; transform: none; box-shadow: none; animation: none; }
        .btn-inner { display: flex; align-items: center; justify-content: center; gap: 10px; position: relative; z-index: 1; }
        .spinner { width: 13px; height: 13px; border: 1.5px solid rgba(0,0,0,0.12); border-top-color: rgba(0,0,0,0.7); border-radius: 50%; animation: spin .65s linear infinite; }
        .arrow { font-size: .95rem; transition: transform .24s; display: inline-block; }
        .btn:hover .arrow { transform: translateX(5px); }

        /* ── KEYFRAMES ── */
        @keyframes fadeUp      { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes breathe     { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.1)} }
        @keyframes float       { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes spin        { to{transform:rotate(360deg)} }
        @keyframes shake       { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        @keyframes gold-slide  { 0%{background-position:0 50%} 100%{background-position:240% 50%} }
        @keyframes streakPulse { 0%,100%{opacity:.65} 50%{opacity:1} }
        @keyframes cardShimmer { from{left:-100%} to{left:120%} }
        @keyframes ripple      { to{transform:scale(1);opacity:0} }

        /* ── BIOMETRIC BUTTON ── */
        .bio-btn {
          width: 100%; padding: 13px 20px; margin-bottom: 16px;
          background: rgba(201,168,76,0.05);
          border: 1px solid rgba(201,168,76,0.22);
          border-radius: 9px;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          font-family: inherit; font-size: .66rem; font-weight: 700;
          letter-spacing: .18em; text-transform: uppercase;
          color: rgba(201,168,76,0.8); cursor: pointer;
          transition: all .22s; position: relative; overflow: hidden;
        }
        .bio-btn:hover {
          background: rgba(201,168,76,0.1);
          border-color: rgba(201,168,76,0.42);
          color: rgba(201,168,76,1);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(201,168,76,0.12);
        }
        .bio-btn:disabled { opacity: .38; cursor: not-allowed; transform: none; }
        .bio-icon { width: 17px; height: 17px; flex-shrink: 0; }

        .divider {
          display: flex; align-items: center; gap: 10px; margin-bottom: 18px;
          font-size: .56rem; font-weight: 500; letter-spacing: .12em; text-transform: uppercase;
          color: rgba(255,255,255,0.15);
        }
        .divider::before, .divider::after { content:''; flex:1; height:1px; background: rgba(255,255,255,0.07); }

        /* ── PASSKEY PROMPT ── */
        .passkey-prompt { text-align: center; padding: 4px 0 8px; }
        .passkey-icon-wrap {
          width: 58px; height: 58px; border-radius: 50%;
          background: rgba(201,168,76,0.07);
          border: 1px solid rgba(201,168,76,0.18);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 18px;
        }
        .passkey-title { font-size: 1rem; font-weight: 300; color: rgba(255,255,255,0.85); margin-bottom: 6px; }
        .passkey-desc { font-size: .68rem; color: rgba(255,255,255,0.33); line-height: 1.7; margin-bottom: 24px; }
        .passkey-actions { display: flex; gap: 10px; }
        .passkey-save {
          flex: 1; padding: 13px 16px;
          background: linear-gradient(108deg, #9a6e18 0%, #c9a84c 40%, #edd870 60%, #9a6e18 100%);
          background-size: 240% 100%;
          border: none; border-radius: 9px; font-family: inherit;
          font-size: .63rem; font-weight: 800; letter-spacing: .18em; text-transform: uppercase;
          color: rgba(5,3,0,0.9); cursor: pointer;
          animation: gold-slide 4s linear infinite; transition: transform .2s;
        }
        .passkey-save:hover { transform: translateY(-1px); }
        .passkey-save:disabled { opacity: .38; cursor: not-allowed; transform: none; animation: none; }
        .passkey-skip {
          flex: 1; padding: 13px 16px;
          background: transparent; border: 1px solid rgba(255,255,255,0.08);
          border-radius: 9px; font-family: inherit;
          font-size: .63rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
          color: rgba(255,255,255,0.28); cursor: pointer; transition: all .2s;
        }
        .passkey-skip:hover { border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); }

        @media (max-width:520px) {
          .stage { padding-top: 24px; }
          .content { padding: 0 16px; }
          .card { padding: 28px 22px; }
          .logo-img { width: 180px; }
        }
      `}</style>

      <div className="stage">

        {/* ── Parallax background ── */}
        <div ref={bgRef} className="bg-wrap">
          <div className="panel p-tl" />
          <div className="panel p-tr" />
          <div className="panel p-bc" />

          {/* Sharp gold edge lines */}
          <div className="edges">
            <svg viewBox="0 0 1440 900" preserveAspectRatio="none">
              <defs>
                <linearGradient id="eg1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"   stopColor="rgba(240,210,80,0)" />
                  <stop offset="20%"  stopColor="rgba(240,210,80,0.5)" />
                  <stop offset="50%"  stopColor="rgba(255,230,100,0.92)" />
                  <stop offset="80%"  stopColor="rgba(240,210,80,0.5)" />
                  <stop offset="100%" stopColor="rgba(240,210,80,0)" />
                </linearGradient>
                <linearGradient id="eg2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%"   stopColor="rgba(240,210,80,0)" />
                  <stop offset="25%"  stopColor="rgba(240,210,80,0.45)" />
                  <stop offset="55%"  stopColor="rgba(255,230,100,0.85)" />
                  <stop offset="80%"  stopColor="rgba(240,210,80,0.45)" />
                  <stop offset="100%" stopColor="rgba(240,210,80,0)" />
                </linearGradient>
                <linearGradient id="eg3" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="rgba(240,210,80,0)" />
                  <stop offset="30%"  stopColor="rgba(240,210,80,0.38)" />
                  <stop offset="60%"  stopColor="rgba(255,230,100,0.65)" />
                  <stop offset="100%" stopColor="rgba(240,210,80,0)" />
                </linearGradient>
              </defs>
              <line x1="979" y1="0"   x2="518" y2="900" stroke="url(#eg1)" strokeWidth="1.2" />
              <line x1="1037" y1="0"  x2="864" y2="900" stroke="url(#eg2)" strokeWidth="1.2" />
              <line x1="0" y1="630"   x2="403" y2="900" stroke="url(#eg3)" strokeWidth="1" />
              <line x1="1440" y1="522" x2="893" y2="900" stroke="url(#eg3)" strokeWidth="1" />
            </svg>
          </div>

          {/* Streaks */}
          <div className="streaks">
            <div className="streak-1" />
            <div className="streak-2" />
            <div className="streak-3" />
            <div className="streak-4" />
          </div>

          <div className="atm" />
          <canvas ref={canvasRef} />
        </div>

        {/* ── Centred content ── */}
        <div className="content">

          <div className="logo-wrap">
            <div className="logo-halo" />
            <img src="/logo.png" alt="White Gold" className="logo-img" />
          </div>

          <div className="card">
            <div className="card-cb card-tl" />
            <div className="card-cb card-tr" />
            <div className="card-cb card-bl" />
            <div className="card-cb card-br" />

            <div className="card-title">{step === 'passkey-prompt' ? 'Faster Sign‑In' : biometricLoading && hasSavedPasskey ? 'Signing In' : 'Sign In'}</div>
            <div className="card-sub">{step === 'passkey-prompt' ? 'Skip the password next time' : biometricLoading && hasSavedPasskey ? 'Preparing biometric prompt…' : 'Enter your credentials to access the portal'}</div>

            {step === 'passkey-prompt' ? (
              <div className="passkey-prompt">
                <div className="passkey-icon-wrap">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(201,168,76,0.85)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"/>
                  </svg>
                </div>
                <div className="passkey-title">Enable Biometric Login</div>
                <div className="passkey-desc">Use Face ID, fingerprint, or your device PIN to sign in instantly — no password needed next time.</div>
                {passkeyError && <div className="errmsg" style={{ marginBottom: 14 }}><div className="errdot" />{passkeyError}</div>}
                <div className="passkey-actions">
                  <button className="passkey-save" onClick={handleSavePasskey} disabled={biometricLoading}>
                    {biometricLoading ? 'Saving…' : 'Enable Now'}
                  </button>
                  <button className="passkey-skip" onClick={handleSkipPasskey} disabled={biometricLoading}>
                    Skip
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleLogin} autoComplete="off">
                {hasSavedPasskey && biometricLoading ? (
                  <div style={{ textAlign:'center', padding:'24px 0 20px' }}>
                    <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(201,168,76,0.07)', border:'1px solid rgba(201,168,76,0.18)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(201,168,76,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"/>
                      </svg>
                    </div>
                    <div style={{ width:28, height:28, border:'2px solid rgba(201,168,76,0.15)', borderTopColor:'rgba(201,168,76,0.7)', borderRadius:'50%', animation:'spin .8s linear infinite', margin:'0 auto 14px' }} />
                    <div style={{ fontSize:'.72rem', color:'rgba(255,255,255,0.35)', marginBottom:6 }}>Signing in as</div>
                    <div style={{ fontSize:'.85rem', color:'rgba(201,168,76,0.75)', fontWeight:500, marginBottom:16, letterSpacing:'.01em' }}>{savedPasskeyEmail}</div>
                    <div style={{ fontSize:'.62rem', color:'rgba(255,255,255,0.22)', letterSpacing:'.06em' }}>
                      Not you?{' '}
                      <button type="button" onClick={() => setBiometricLoading(false)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.45)', cursor:'pointer', fontSize:'.62rem', letterSpacing:'.06em', textDecoration:'underline' }}>
                        Use a different account
                      </button>
                    </div>
                  </div>
                ) : hasSavedPasskey ? (
                  <>
                    <button type="button" className="bio-btn" onClick={handleBiometricLogin} disabled={biometricLoading}>
                      <svg className="bio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"/>
                      </svg>
                      Sign In with Biometrics
                    </button>
                    {passkeyError && <div className="errmsg" style={{ marginBottom: 4 }}><div className="errdot" />{passkeyError}</div>}
                    <div style={{ textAlign:'right', marginBottom: 14, marginTop: 4 }}>
                      <button type="button" onClick={() => { localStorage.removeItem('wg_passkey_data'); localStorage.removeItem('wg_passkey_email'); setHasSavedPasskey(false); setSavedPasskeyEmail(''); setSavedCredentialId(null); setPasskeyError('') }} style={{ background:'none', border:'none', fontSize:'.58rem', color:'rgba(255,255,255,0.2)', cursor:'pointer', letterSpacing:'.08em', textTransform:'uppercase' }}>
                        Remove passkey
                      </button>
                    </div>
                    <div className="divider">or continue with email</div>
                  </>
                ) : null}

                {!(hasSavedPasskey && biometricLoading) && <>
                <div className="field">
                  <label className="flbl">Email</label>
                  <div className="inp-wrap">
                    <input
                      type="email" className="inp"
                      placeholder="you@whitegold.money"
                      value={email} onChange={e => setEmail(e.target.value)}
                      required autoComplete="off"
                    />
                  </div>
                </div>

                <div className="field">
                  <label className="flbl">Password</label>
                  <div className="inp-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'} className="inp pw"
                      placeholder="Enter your password"
                      value={password} onChange={e => setPassword(e.target.value)}
                      required autoComplete="new-password"
                    />
                    <button type="button" className="eye-btn" onClick={() => setShowPassword(v => !v)}>
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && <div className="errmsg"><div className="errdot" />{error}</div>}

                <div className="btn-wrap">
                  <button type="submit" className="btn" disabled={loading} onMouseDown={handleRipple}>
                    <div className="btn-inner">
                      {loading
                        ? <><div className="spinner" /> Signing in…</>
                        : <>Sign In <span className="arrow">→</span></>
                      }
                    </div>
                  </button>
                </div>

                <div style={{ textAlign:'center', marginTop:16 }}>
                  <a href="/auth/forgot-password" style={{ fontSize:'.62rem', color:'rgba(201,168,76,0.4)', textDecoration:'none', letterSpacing:'.06em', transition:'color .2s' }}
                    onMouseEnter={e => e.target.style.color='rgba(201,168,76,0.75)'}
                    onMouseLeave={e => e.target.style.color='rgba(201,168,76,0.4)'}>
                    Forgot your password?
                  </a>
                </div>
                </>}
              </form>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
