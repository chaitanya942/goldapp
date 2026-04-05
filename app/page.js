'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const canvasRef                        = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId, pts = []

    const init = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      pts = Array.from({ length: 55 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 0.9 + 0.1,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.14,
        a: Math.random() * 0.38 + 0.06,
        ph: Math.random() * Math.PI * 2,
        spd: Math.random() * 0.012 + 0.007,
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
        ctx.fillStyle = `rgba(201,168,76,${p.a * (0.5 + 0.5 * Math.sin(p.ph))})`
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

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); setLoading(false); return }
    window.location.href = '/dashboard'
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; background: #07050200; }
        body { font-family: var(--font-jakarta), 'Plus Jakarta Sans', -apple-system, sans-serif; }

        /* ── FULL SCREEN STAGE ── */
        .stage {
          position: relative;
          height: 100vh; width: 100vw;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          background: #070502;
        }

        /* ── FACETED BACKGROUND PANELS ── */
        .panel {
          position: absolute; inset: 0; pointer-events: none;
        }
        /* Top-left large facet — warmest */
        .p-tl {
          background: linear-gradient(135deg, #141008 0%, #0c0904 100%);
          clip-path: polygon(0 0, 68% 0, 36% 100%, 0 100%);
        }
        /* Top-right facet */
        .p-tr {
          background: linear-gradient(225deg, #110e07 0%, #090703 100%);
          clip-path: polygon(72% 0, 100% 0, 100% 100%, 60% 100%);
        }
        /* Bottom centre — darkest, makes panels "pop" */
        .p-bc {
          background: #030200;
          clip-path: polygon(28% 100%, 62% 100%, 100% 58%, 100% 100%, 0 100%, 0 70%);
        }

        /* Sharp gold edge lines exactly where panels meet — the key CRM detail */
        .edges {
          position: absolute; inset: 0; pointer-events: none;
        }
        .edges svg { width: 100%; height: 100%; }

        /* ── LIGHT STREAKS ── */
        .streaks { position: absolute; inset: 0; pointer-events: none; }

        /* Main broad streak — left diagonal */
        .streak-1 {
          position: absolute; top: -10%; left: -5%;
          width: 60%; height: 120%;
          background: linear-gradient(
            148deg,
            transparent 0%, transparent 35%,
            rgba(201,168,76,0.07) 36.5%,
            rgba(240,215,90,0.32) 37.4%,
            rgba(255,230,100,0.18) 37.9%,
            rgba(240,215,90,0.32) 38.4%,
            rgba(201,168,76,0.07) 39.5%,
            transparent 41%
          );
          animation: streakPulse 5s ease-in-out infinite;
        }
        /* Thin accent streak alongside */
        .streak-2 {
          position: absolute; top: -10%; left: 2%;
          width: 60%; height: 120%;
          background: linear-gradient(
            148deg,
            transparent 0%, transparent 44%,
            rgba(201,168,76,0.04) 44.8%,
            rgba(201,168,76,0.14) 45.4%,
            rgba(201,168,76,0.04) 46%,
            transparent 47%
          );
          animation: streakPulse 5s ease-in-out 1.2s infinite;
        }
        /* Right side streak */
        .streak-3 {
          position: absolute; top: 0; right: -5%;
          width: 50%; height: 100%;
          background: linear-gradient(
            -140deg,
            transparent 0%, transparent 46%,
            rgba(201,168,76,0.05) 47%,
            rgba(240,210,80,0.22) 47.8%,
            rgba(201,168,76,0.05) 48.6%,
            transparent 50%
          );
          animation: streakPulse 7s ease-in-out 2.5s infinite;
        }
        /* Extra glint — short bright flash top-left */
        .streak-4 {
          position: absolute; top: -5%; left: 10%;
          width: 40%; height: 60%;
          background: linear-gradient(
            148deg,
            transparent 0%, transparent 55%,
            rgba(255,235,120,0.08) 56%,
            rgba(255,235,120,0.18) 56.5%,
            rgba(255,235,120,0.08) 57%,
            transparent 58%
          );
          animation: streakPulse 9s ease-in-out 4s infinite;
        }

        /* ── ATMOSPHERIC GLOW ── */
        .atm {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 55% 60% at 50% 44%, rgba(201,168,76,0.13) 0%, transparent 60%),
            radial-gradient(ellipse 85% 65% at 50% 50%, rgba(120,85,10,0.07) 0%, transparent 70%);
        }

        /* Particles */
        canvas {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
        }

        /* ── CENTRED CONTENT ── */
        .content {
          position: relative; z-index: 10;
          display: flex; flex-direction: column;
          align-items: center;
          width: 100%; max-width: 420px;
          padding: 0 24px;
        }

        /* Logo */
        .logo-wrap {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 44px;
          opacity: 0;
          animation: fadeUp 1.2s cubic-bezier(.22,1,.36,1) .1s forwards;
        }
        .logo-halo {
          position: absolute;
          width: 320px; height: 200px;
          background: radial-gradient(ellipse, rgba(201,168,76,0.16) 0%, transparent 65%);
          filter: blur(4px);
          border-radius: 50%;
          animation: breathe 5s ease-in-out infinite;
        }
        .logo-img {
          position: relative; z-index: 1;
          width: 240px; height: auto;
          filter: brightness(10) saturate(0.08) drop-shadow(0 0 36px rgba(201,168,76,0.35)) drop-shadow(0 0 12px rgba(201,168,76,0.2));
          opacity: 0.95;
          mix-blend-mode: lighten;
          animation: float 8s ease-in-out infinite;
        }

        /* Form card — glass panel */
        .card {
          width: 100%;
          background: rgba(22,16,8,0.72);
          border: 1px solid rgba(201,168,76,0.18);
          border-radius: 16px;
          padding: 36px 36px 32px;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow:
            0 32px 80px rgba(0,0,0,0.7),
            0 8px 32px rgba(0,0,0,0.4),
            0 1px 0 rgba(201,168,76,0.12) inset,
            0 -1px 0 rgba(0,0,0,0.4) inset;
          opacity: 0;
          animation: fadeUp 1.1s cubic-bezier(.22,1,.36,1) .3s forwards;
        }

        /* Card top shimmer line */
        .card::before {
          content: '';
          position: absolute; top: 0; left: 20%; right: 20%; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,0.4) 30%, rgba(240,210,80,0.65) 50%, rgba(201,168,76,0.4) 70%, transparent);
          border-radius: 100%;
        }

        /* Corner brackets on card */
        .card { position: relative; }
        .card-cb { position: absolute; width: 14px; height: 14px; }
        .card-tl { top: -1px; left: -1px; border-top: 1px solid rgba(201,168,76,0.4); border-left: 1px solid rgba(201,168,76,0.4); border-radius: 16px 0 0 0; }
        .card-tr { top: -1px; right: -1px; border-top: 1px solid rgba(201,168,76,0.4); border-right: 1px solid rgba(201,168,76,0.4); border-radius: 0 16px 0 0; }
        .card-bl { bottom: -1px; left: -1px; border-bottom: 1px solid rgba(201,168,76,0.4); border-left: 1px solid rgba(201,168,76,0.4); border-radius: 0 0 0 16px; }
        .card-br { bottom: -1px; right: -1px; border-bottom: 1px solid rgba(201,168,76,0.4); border-right: 1px solid rgba(201,168,76,0.4); border-radius: 0 0 16px 0; }

        /* Card header */
        .card-title {
          font-size: 1.45rem; font-weight: 300;
          color: rgba(255,255,255,0.88);
          letter-spacing: -.025em;
          margin-bottom: 4px;
        }
        .card-sub {
          font-size: .65rem; font-weight: 400;
          color: rgba(255,255,255,0.24);
          letter-spacing: .01em;
          margin-bottom: 28px;
        }

        /* Fields */
        .field { margin-bottom: 14px; }
        .flbl {
          display: block;
          font-size: .56rem; font-weight: 700;
          letter-spacing: .2em; text-transform: uppercase;
          color: rgba(201,168,76,0.36);
          margin-bottom: 7px;
          transition: color .2s;
        }
        .field:focus-within .flbl { color: rgba(201,168,76,0.72); }

        .inp-wrap { position: relative; }
        .inp {
          width: 100%;
          background: rgba(0,0,0,0.28);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 9px;
          padding: 12px 15px;
          font-family: inherit;
          font-size: .875rem; font-weight: 400;
          color: rgba(255,255,255,0.86); outline: none;
          transition: border-color .2s, background .2s, box-shadow .2s;
          caret-color: #c9a84c;
        }
        .inp:focus {
          border-color: rgba(201,168,76,0.35);
          background: rgba(201,168,76,0.04);
          box-shadow: 0 0 0 3px rgba(201,168,76,0.05);
        }
        .inp:-webkit-autofill,
        .inp:-webkit-autofill:hover,
        .inp:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #100d09 inset !important;
          -webkit-text-fill-color: rgba(255,255,255,0.86) !important;
          caret-color: #c9a84c;
        }
        .inp::placeholder { color: rgba(255,255,255,0.14); }
        .inp.pw { padding-right: 46px; }

        .eye-btn {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; padding: 4px;
          color: rgba(201,168,76,0.28); transition: color .2s;
          display: flex; align-items: center;
        }
        .eye-btn:hover { color: rgba(201,168,76,0.65); }
        .eye-btn svg { width: 15px; height: 15px; }

        /* Error */
        .errmsg {
          display: flex; align-items: center; gap: 9px;
          background: rgba(180,40,40,0.07);
          border: 1px solid rgba(200,70,70,0.14);
          border-radius: 8px;
          padding: 9px 12px; margin-bottom: 12px;
          font-size: .73rem; color: rgba(255,140,140,0.8);
          animation: shake .36s ease;
        }
        .errdot { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,100,100,0.5); flex-shrink: 0; }

        /* CTA */
        .btn-wrap { margin-top: 20px; }
        .btn {
          width: 100%; padding: 14px 20px;
          background: linear-gradient(108deg, #9a6e18 0%, #c9a84c 28%, #edd870 50%, #c09030 72%, #9a6e18 100%);
          background-size: 240% 100%;
          border: none; border-radius: 9px;
          font-family: inherit;
          font-size: .67rem; font-weight: 800;
          letter-spacing: .22em; text-transform: uppercase;
          color: rgba(6,4,1,0.88); cursor: pointer;
          position: relative; overflow: hidden;
          transition: transform .24s cubic-bezier(.22,1,.36,1), box-shadow .24s;
          animation: gold-slide 4s linear infinite;
        }
        .btn::before {
          content: '';
          position: absolute; top: 0; left: -90%;
          width: 58%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
          transform: skewX(-22deg); transition: left .5s ease;
        }
        .btn:hover::before { left: 140%; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(201,168,76,0.32), 0 3px 8px rgba(201,168,76,0.14); }
        .btn:active { transform: translateY(0); }
        .btn:disabled { opacity: .4; cursor: not-allowed; transform: none; box-shadow: none; animation: none; }
        .btn-inner { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .spinner { width: 13px; height: 13px; border: 1.5px solid rgba(0,0,0,0.1); border-top-color: rgba(0,0,0,0.65); border-radius: 50%; animation: spin .65s linear infinite; }
        .arrow { font-size: .95rem; transition: transform .24s; display: inline-block; }
        .btn:hover .arrow { transform: translateX(5px); }

        /* ── KEYFRAMES ── */
        @keyframes fadeUp     { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes breathe    { 0%,100%{opacity:.55;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
        @keyframes float      { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
        @keyframes spin       { to{transform:rotate(360deg)} }
        @keyframes shake      { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        @keyframes gold-slide { 0%{background-position:0 50%} 100%{background-position:240% 50%} }
        @keyframes streakPulse { 0%,100%{opacity:.7} 50%{opacity:1} }

        @media (max-width:520px) {
          .content { padding: 0 16px; }
          .card { padding: 28px 24px; }
          .logo-img { width: 160px; }
        }
      `}</style>

      <div className="stage">
        {/* Angled background facets */}
        <div className="panel p-tl" />
        <div className="panel p-tr" />
        <div className="panel p-bc" />

        {/* Sharp gold panel edge lines */}
        <div className="edges">
          <svg viewBox="0 0 1440 900" preserveAspectRatio="none">
            <defs>
              <linearGradient id="eg1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="rgba(240,210,80,0)" />
                <stop offset="20%"  stopColor="rgba(240,210,80,0.55)" />
                <stop offset="50%"  stopColor="rgba(255,230,100,0.9)" />
                <stop offset="80%"  stopColor="rgba(240,210,80,0.55)" />
                <stop offset="100%" stopColor="rgba(240,210,80,0)" />
              </linearGradient>
              <linearGradient id="eg2" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="rgba(240,210,80,0)" />
                <stop offset="25%"  stopColor="rgba(240,210,80,0.45)" />
                <stop offset="55%"  stopColor="rgba(255,230,100,0.8)" />
                <stop offset="80%"  stopColor="rgba(240,210,80,0.45)" />
                <stop offset="100%" stopColor="rgba(240,210,80,0)" />
              </linearGradient>
              <linearGradient id="eg3" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="rgba(240,210,80,0)" />
                <stop offset="30%"  stopColor="rgba(240,210,80,0.4)" />
                <stop offset="60%"  stopColor="rgba(255,230,100,0.7)" />
                <stop offset="100%" stopColor="rgba(240,210,80,0)" />
              </linearGradient>
            </defs>
            {/* Left panel right edge: top-right corner of p-tl → bottom of p-tl */}
            <line x1="979" y1="0" x2="518" y2="900" stroke="url(#eg1)" strokeWidth="1.2" />
            {/* Right panel left edge */}
            <line x1="1037" y1="0" x2="864" y2="900" stroke="url(#eg2)" strokeWidth="1.2" />
            {/* Bottom panel top edge — left side */}
            <line x1="0" y1="630" x2="403" y2="900" stroke="url(#eg3)" strokeWidth="1" />
            {/* Bottom panel top edge — right side */}
            <line x1="1440" y1="522" x2="893" y2="900" stroke="url(#eg3)" strokeWidth="1" />
          </svg>
        </div>

        {/* Light streaks */}
        <div className="streaks">
          <div className="streak-1" />
          <div className="streak-2" />
          <div className="streak-3" />
          <div className="streak-4" />
        </div>

        {/* Atmospheric glow */}
        <div className="atm" />

        {/* Particles */}
        <canvas ref={canvasRef} />

        {/* ── Centred Content ── */}
        <div className="content">

          {/* Logo */}
          <div className="logo-wrap">
            <div className="logo-halo" />
            <img src="/logo.png" alt="White Gold" className="logo-img" />
          </div>

          {/* Glass form card */}
          <div className="card">
            <div className="card-cb card-tl" />
            <div className="card-cb card-tr" />
            <div className="card-cb card-bl" />
            <div className="card-cb card-br" />

            <div className="card-title">Sign In</div>
            <div className="card-sub">Enter your credentials to access the portal</div>

            <form onSubmit={handleLogin} autoComplete="off">
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
                <button type="submit" className="btn" disabled={loading}>
                  <div className="btn-inner">
                    {loading
                      ? <><div className="spinner" /> Signing in…</>
                      : <>Sign In <span className="arrow">→</span></>
                    }
                  </div>
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </>
  )
}
