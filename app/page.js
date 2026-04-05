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
    let animId, particles = []

    const spawn = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      particles = Array.from({ length: 70 }, () => ({
        x:     Math.random() * canvas.width,
        y:     Math.random() * canvas.height,
        r:     Math.random() * 1.1 + 0.15,
        vx:    (Math.random() - 0.5) * 0.2,
        vy:    (Math.random() - 0.5) * 0.16,
        a:     Math.random() * 0.5 + 0.08,
        ph:    Math.random() * Math.PI * 2,
        speed: Math.random() * 0.014 + 0.008,
      }))
    }
    spawn()
    window.addEventListener('resize', spawn)

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const d  = Math.sqrt(dx * dx + dy * dy)
          if (d < 110) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(201,168,76,${0.07 * (1 - d / 110)})`
            ctx.lineWidth   = 0.4
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }

      // dots
      for (const p of particles) {
        p.ph += p.speed
        const opacity = p.a * (0.5 + 0.5 * Math.sin(p.ph))
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(201,168,76,${opacity})`
        ctx.fill()
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0
      }

      animId = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', spawn) }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); setLoading(false); return }
    window.location.href = '/dashboard'
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; background: #080603; }
        body { font-family: var(--font-jakarta), 'Plus Jakarta Sans', -apple-system, sans-serif; }

        /* ── LAYOUT ─────────────────────────────────── */
        .pg {
          height: 100vh;
          display: grid;
          grid-template-columns: 1fr 420px;
        }

        /* ── LEFT ───────────────────────────────────── */
        .lft {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: #080603;
        }

        /* Atmospheric glow — warm centre, cool corners */
        .atm {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 65% 55% at 50% 50%, rgba(201,168,76,0.09) 0%, transparent 68%),
            radial-gradient(ellipse 30% 25% at 80% 15%, rgba(160,110,10,0.045) 0%, transparent 55%),
            radial-gradient(ellipse 22% 20% at 12% 82%, rgba(201,168,76,0.03) 0%, transparent 55%);
        }

        /* Particle canvas */
        canvas {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
        }

        /* Fine geometric diamond lines */
        .geo {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          pointer-events: none;
          opacity: 1;
        }

        /* Centered content */
        .lft-body {
          position: relative; z-index: 2;
          display: flex; flex-direction: column; align-items: center;
          text-align: center;
          gap: 0;
          padding: 0 80px;
        }

        /* Logo — the only brand identity on the left */
        .logo-area {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 40px;
          opacity: 0;
          animation: fadeUp 1.2s cubic-bezier(.22,1,.36,1) .15s forwards;
        }
        /* Soft ground glow beneath logo */
        .logo-glow {
          position: absolute;
          bottom: -20px; left: 50%;
          transform: translateX(-50%);
          width: 240px; height: 70px;
          background: radial-gradient(ellipse, rgba(201,168,76,0.2) 0%, transparent 70%);
          animation: breathe 5s ease-in-out infinite;
          pointer-events: none;
          border-radius: 50%;
          filter: blur(8px);
        }
        /* Ambient ring behind logo — single, very subtle */
        .logo-ring {
          position: absolute;
          width: 200px; height: 200px; border-radius: 50%;
          border: 1px solid rgba(201,168,76,0.07);
          animation: breathe 5s ease-in-out infinite;
        }
        .logo-ring-2 {
          position: absolute;
          width: 270px; height: 270px; border-radius: 50%;
          border: 1px solid rgba(201,168,76,0.035);
          animation: breathe 5s ease-in-out 0.8s infinite;
        }
        .logo-img {
          position: relative; z-index: 1;
          width: 148px; height: auto;
          filter: brightness(9) saturate(0.15) drop-shadow(0 0 24px rgba(201,168,76,0.25));
          opacity: 0.88;
          mix-blend-mode: lighten;
          animation: float 7s ease-in-out infinite;
        }

        /* Thin divider with centre gem */
        .orn {
          display: flex; align-items: center; gap: 16px;
          margin-bottom: 28px;
          opacity: 0;
          animation: fadeUp 1.2s cubic-bezier(.22,1,.36,1) .5s forwards;
        }
        .orn-line { height: 1px; width: 64px; }
        .orn-line-l { background: linear-gradient(90deg, transparent, rgba(201,168,76,0.35)); }
        .orn-line-r { background: linear-gradient(90deg, rgba(201,168,76,0.35), transparent); }
        .orn-gem {
          width: 6px; height: 6px;
          background: #c9a84c;
          transform: rotate(45deg);
          box-shadow: 0 0 12px rgba(201,168,76,0.7), 0 0 4px rgba(201,168,76,1);
        }

        /* Tagline */
        .tagline {
          opacity: 0;
          animation: fadeUp 1.2s cubic-bezier(.22,1,.36,1) .65s forwards;
        }
        .tg-1 {
          font-size: clamp(.95rem, 1.5vw, 1.3rem);
          font-weight: 300;
          color: rgba(220,200,155,0.35);
          letter-spacing: .01em;
          line-height: 1.5;
        }
        .tg-2 {
          font-size: clamp(1.05rem, 1.7vw, 1.45rem);
          font-weight: 700;
          color: rgba(240,218,155,0.68);
          letter-spacing: -.01em;
          line-height: 1.2;
        }

        /* Vertical divider between panels */
        .vdiv {
          position: absolute; right: 0; top: 0; bottom: 0; width: 1px;
          background: linear-gradient(to bottom,
            transparent 0%,
            rgba(201,168,76,0.09) 20%,
            rgba(201,168,76,0.2) 50%,
            rgba(201,168,76,0.09) 80%,
            transparent 100%);
          z-index: 3;
        }

        /* ── RIGHT ──────────────────────────────────── */
        .rgt {
          position: relative;
          display: flex; flex-direction: column;
          align-items: stretch; justify-content: center;
          padding: 56px 48px;
          background: #0c0a07;
          overflow: hidden;
        }

        /* Very subtle top shimmer */
        .rgt::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg,
            transparent,
            rgba(201,168,76,0.28) 25%,
            rgba(230,195,60,0.5) 50%,
            rgba(201,168,76,0.28) 75%,
            transparent);
        }

        /* Ambient glow top-centre */
        .rgt-glow {
          position: absolute; top: -60px; left: 50%;
          transform: translateX(-50%);
          width: 300px; height: 200px;
          background: radial-gradient(ellipse, rgba(201,168,76,0.05) 0%, transparent 70%);
          pointer-events: none;
        }

        /* Corner brackets */
        .cb { position: absolute; width: 18px; height: 18px; }
        .cb-tl { top: 14px; left: 14px; border-top: 1px solid rgba(201,168,76,0.2); border-left: 1px solid rgba(201,168,76,0.2); }
        .cb-tr { top: 14px; right: 14px; border-top: 1px solid rgba(201,168,76,0.2); border-right: 1px solid rgba(201,168,76,0.2); }
        .cb-bl { bottom: 14px; left: 14px; border-bottom: 1px solid rgba(201,168,76,0.2); border-left: 1px solid rgba(201,168,76,0.2); }
        .cb-br { bottom: 14px; right: 14px; border-bottom: 1px solid rgba(201,168,76,0.2); border-right: 1px solid rgba(201,168,76,0.2); }

        /* Form wrapper */
        .form-wrap {
          position: relative; z-index: 2;
          opacity: 0;
          animation: fadeUp 1s cubic-bezier(.22,1,.36,1) .3s forwards;
        }

        /* Small portal label */
        .portal-label {
          font-size: .55rem; font-weight: 600;
          letter-spacing: .26em; text-transform: uppercase;
          color: rgba(201,168,76,0.38);
          margin-bottom: 28px;
          display: flex; align-items: center; gap: 10px;
        }
        .portal-label::after {
          content: '';
          flex: 1; height: 1px;
          background: linear-gradient(90deg, rgba(201,168,76,0.15), transparent);
        }

        /* Sign in heading */
        .signin-title {
          font-size: 2rem; font-weight: 300;
          color: rgba(255,255,255,0.90);
          letter-spacing: -.03em; line-height: 1;
          margin-bottom: 6px;
        }
        .signin-sub {
          font-size: .68rem; font-weight: 400;
          color: rgba(255,255,255,0.26);
          margin-bottom: 40px;
          letter-spacing: .01em;
        }

        /* Input fields */
        .field { margin-bottom: 16px; }
        .flbl {
          display: block;
          font-size: .57rem; font-weight: 700;
          letter-spacing: .2em; text-transform: uppercase;
          color: rgba(201,168,76,0.38);
          margin-bottom: 8px;
          transition: color .2s;
        }
        .field:focus-within .flbl { color: rgba(201,168,76,0.75); }

        .inp-wrap { position: relative; }
        .inp {
          width: 100%;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px;
          padding: 13px 16px;
          font-family: inherit;
          font-size: .875rem; font-weight: 400;
          color: rgba(255,255,255,0.88); outline: none;
          transition: border-color .22s, background .22s, box-shadow .22s;
          caret-color: #c9a84c;
        }
        .inp:focus {
          border-color: rgba(201,168,76,0.38);
          background: rgba(201,168,76,0.03);
          box-shadow: 0 0 0 3px rgba(201,168,76,0.05);
        }
        .inp:-webkit-autofill,
        .inp:-webkit-autofill:hover,
        .inp:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #0f0c09 inset !important;
          -webkit-text-fill-color: rgba(255,255,255,0.88) !important;
          caret-color: #c9a84c;
          border-color: rgba(201,168,76,0.2) !important;
        }
        .inp::placeholder { color: rgba(255,255,255,0.15); }
        .inp.has-icon { padding-right: 48px; }

        /* Eye toggle */
        .eye-btn {
          position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; padding: 4px;
          color: rgba(201,168,76,0.3); transition: color .2s;
          display: flex; align-items: center;
        }
        .eye-btn:hover { color: rgba(201,168,76,0.7); }
        .eye-btn svg { width: 16px; height: 16px; }

        /* Error */
        .errmsg {
          display: flex; align-items: center; gap: 9px;
          background: rgba(200,50,50,0.07);
          border: 1px solid rgba(220,80,80,0.15);
          border-radius: 8px;
          padding: 10px 13px; margin-bottom: 14px;
          font-size: .74rem; color: rgba(255,140,140,0.82);
          animation: shake .38s ease;
        }
        .errdot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,100,100,0.5); flex-shrink: 0; }

        /* CTA Button */
        .btn-wrap { margin-top: 24px; }
        .btn {
          width: 100%; padding: 15px 20px;
          background: linear-gradient(108deg, #9a6e18 0%, #c9a84c 28%, #edd870 50%, #c09030 72%, #9a6e18 100%);
          background-size: 240% 100%;
          border: none; border-radius: 10px;
          font-family: inherit;
          font-size: .68rem; font-weight: 800;
          letter-spacing: .22em; text-transform: uppercase;
          color: rgba(6,4,1,0.88); cursor: pointer;
          position: relative; overflow: hidden;
          transition: transform .26s cubic-bezier(.22,1,.36,1), box-shadow .26s;
          animation: gold-slide 4s linear infinite;
        }
        .btn::before {
          content: '';
          position: absolute; top: 0; left: -90%;
          width: 60%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
          transform: skewX(-22deg);
          transition: left .52s ease;
        }
        .btn:hover::before { left: 140%; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(201,168,76,0.3), 0 3px 8px rgba(201,168,76,0.15); }
        .btn:active { transform: translateY(0); }
        .btn:disabled { opacity: .4; cursor: not-allowed; transform: none; box-shadow: none; animation: none; }
        .btn-inner { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .spinner { width: 13px; height: 13px; border: 1.5px solid rgba(0,0,0,0.1); border-top-color: rgba(0,0,0,0.65); border-radius: 50%; animation: spin .65s linear infinite; }
        .arrow { font-size: .95rem; transition: transform .26s; display: inline-block; }
        .btn:hover .arrow { transform: translateX(5px); }

        /* ── KEYFRAMES ───────────────────────────────── */
        @keyframes fadeUp   { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }
        @keyframes breathe  { 0%,100% { opacity:.6; transform:scale(1) } 50% { opacity:1; transform:scale(1.1) } }
        @keyframes float    { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-8px) } }
        @keyframes spin     { to { transform:rotate(360deg) } }
        @keyframes shake    { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        @keyframes gold-slide { 0%{background-position:0 50%} 100%{background-position:240% 50%} }

        @media (max-width:820px) {
          .pg { grid-template-columns:1fr }
          .lft { display:none }
          .rgt { padding:40px 32px }
        }
      `}</style>

      <div className="pg">

        {/* ─── LEFT PANEL ─────────────────────────── */}
        <div className="lft">
          <div className="atm" />
          <canvas ref={canvasRef} />

          {/* Geometric diamond SVG — fine, not circles */}
          <svg className="geo" viewBox="0 0 900 700" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#c9a84c" stopOpacity=".65" />
                <stop offset="60%"  stopColor="#c9a84c" stopOpacity=".18" />
                <stop offset="100%" stopColor="#c9a84c" stopOpacity=".04" />
              </linearGradient>
            </defs>
            {/* Diamond outline layers — no circles */}
            <polygon points="450,60  820,350 450,640  80,350"  fill="none" stroke="url(#gg)" strokeWidth=".7"  />
            <polygon points="450,130 750,350 450,570 150,350"  fill="none" stroke="url(#gg)" strokeWidth=".5"  />
            <polygon points="450,200 680,350 450,500 220,350"  fill="none" stroke="url(#gg)" strokeWidth=".38" />
            <polygon points="450,270 610,350 450,430 290,350"  fill="none" stroke="url(#gg)" strokeWidth=".26" />
            {/* Cross hairlines */}
            <line x1="80"  y1="350" x2="820" y2="350" stroke="#c9a84c" strokeWidth=".28" strokeDasharray="1.5 14" opacity=".28" />
            <line x1="450" y1="60"  x2="450" y2="640" stroke="#c9a84c" strokeWidth=".28" strokeDasharray="1.5 14" opacity=".28" />
            {/* Corner dots */}
            <circle cx="450" cy="60"  r="2" fill="#c9a84c" opacity=".35" />
            <circle cx="820" cy="350" r="2" fill="#c9a84c" opacity=".35" />
            <circle cx="450" cy="640" r="2" fill="#c9a84c" opacity=".35" />
            <circle cx="80"  cy="350" r="2" fill="#c9a84c" opacity=".35" />
            <circle cx="450" cy="350" r="3" fill="none" stroke="#c9a84c" strokeWidth=".6" opacity=".22" />
          </svg>

          <div className="lft-body">
            {/* Logo — single, hero */}
            <div className="logo-area">
              <div className="logo-ring" />
              <div className="logo-ring-2" />
              <div className="logo-glow" />
              <img src="/logo.png" alt="White Gold" className="logo-img" />
            </div>

            {/* Ornament */}
            <div className="orn">
              <div className="orn-line orn-line-l" />
              <div className="orn-gem" />
              <div className="orn-line orn-line-r" />
            </div>

            {/* Tagline only — no text wordmark since logo already has it */}
            <div className="tagline">
              <div className="tg-1">Every gram.</div>
              <div className="tg-2">Accounted for.</div>
            </div>
          </div>

          <div className="vdiv" />
        </div>

        {/* ─── RIGHT PANEL ────────────────────────── */}
        <div className="rgt">
          <div className="rgt-glow" />
          <div className="cb cb-tl" /><div className="cb cb-tr" />
          <div className="cb cb-bl" /><div className="cb cb-br" />

          <div className="form-wrap">
            <div className="portal-label">Management Portal</div>

            <div className="signin-title">Welcome back</div>
            <div className="signin-sub">Sign in to your authorised account</div>

            <form onSubmit={handleLogin} autoComplete="off">
              <div className="field">
                <label className="flbl">Email</label>
                <div className="inp-wrap">
                  <input
                    type="email"
                    className="inp"
                    placeholder="you@whitegold.money"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="field">
                <label className="flbl">Password</label>
                <div className="inp-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="inp has-icon"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
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

              {error && (
                <div className="errmsg">
                  <div className="errdot" />
                  {error}
                </div>
              )}

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
