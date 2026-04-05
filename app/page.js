'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const canvasRef                        = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    let particles = []

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      particles = Array.from({ length: 60 }, () => ({
        x:     Math.random() * canvas.width,
        y:     Math.random() * canvas.height,
        size:  Math.random() * 1.3 + 0.2,
        vx:    (Math.random() - 0.5) * 0.28,
        vy:    (Math.random() - 0.5) * 0.22,
        op:    Math.random() * 0.55 + 0.15,
        phase: Math.random() * Math.PI * 2,
      }))
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx   = particles[i].x - particles[j].x
          const dy   = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(201,168,76,${0.1 * (1 - dist / 120)})`
            ctx.lineWidth   = 0.5
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }
      particles.forEach(p => {
        p.phase += 0.016
        const op = p.op * (0.6 + 0.4 * Math.sin(p.phase))
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(201,168,76,${op})`
        ctx.fill()
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) { setError(authError.message); setLoading(false); return }
    window.location.href = '/dashboard'
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; background: #08060200; }
        body { font-family: var(--font-jakarta), 'Plus Jakarta Sans', -apple-system, sans-serif; }

        .pg {
          height: 100vh;
          display: grid;
          grid-template-columns: 1fr 480px;
          overflow: hidden;
        }

        /* ── LEFT ── */
        .lft {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: #070501;
        }
        .lft-bg {
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse 60% 50% at 40% 50%, rgba(201,168,76,0.11) 0%, transparent 65%),
            radial-gradient(ellipse 30% 30% at 75% 20%, rgba(180,130,15,0.06) 0%, transparent 55%),
            radial-gradient(ellipse 25% 25% at 20% 80%, rgba(201,168,76,0.04) 0%, transparent 55%),
            #070501;
        }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        .geo { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.14; pointer-events: none; }

        .lft-inner {
          position: relative; z-index: 2;
          text-align: center;
          display: flex; flex-direction: column; align-items: center;
          padding: 0 60px;
        }

        /* Brand badge */
        .brand-badge {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 5px 14px 5px 10px;
          border: 1px solid rgba(201,168,76,0.2);
          border-radius: 100px;
          background: rgba(201,168,76,0.05);
          margin-bottom: 40px;
          opacity: 0;
          animation: rise 1s cubic-bezier(0.22,1,0.36,1) 0.1s forwards;
        }
        .badge-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #c9a84c;
          box-shadow: 0 0 8px rgba(201,168,76,0.8);
          animation: pulse 2s ease infinite;
        }
        .badge-text {
          font-size: 0.58rem; font-weight: 500; letter-spacing: 0.22em;
          text-transform: uppercase; color: rgba(201,168,76,0.7);
        }

        /* Wordmark: 2-line stacked */
        .wordmark-wrap {
          opacity: 0;
          animation: rise 1.2s cubic-bezier(0.22,1,0.36,1) 0.25s forwards;
        }
        .wm-line1 {
          display: block;
          font-size: clamp(2rem, 3.2vw, 3.6rem);
          font-weight: 200;
          letter-spacing: 0.55em;
          text-transform: uppercase;
          color: rgba(201,168,76,0.55);
          line-height: 1;
        }
        .wm-line2 {
          display: block;
          font-size: clamp(3.6rem, 6vw, 7rem);
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(201,168,76,0.95);
          text-shadow:
            0 0 80px rgba(201,168,76,0.25),
            0 0 24px rgba(201,168,76,0.1);
          line-height: 0.9;
          margin-top: 4px;
        }

        /* Ornament */
        .orn {
          display: flex; align-items: center; gap: 20px;
          margin: 36px 0 32px;
          opacity: 0;
          animation: rise 1.2s cubic-bezier(0.22,1,0.36,1) 0.45s forwards;
        }
        .orn-l { height: 1px; width: 80px; background: linear-gradient(90deg, transparent, rgba(201,168,76,0.4)); }
        .orn-r { height: 1px; width: 80px; background: linear-gradient(90deg, rgba(201,168,76,0.4), transparent); }
        .gem-wrap { position: relative; width: 10px; height: 10px; display: flex; align-items: center; justify-content: center; }
        .gem {
          width: 7px; height: 7px;
          background: #c9a84c; transform: rotate(45deg);
          box-shadow: 0 0 18px rgba(201,168,76,0.7), 0 0 6px rgba(201,168,76,1);
        }
        .gem-ring {
          position: absolute; width: 18px; height: 18px;
          border: 1px solid rgba(201,168,76,0.25);
          transform: rotate(45deg);
          animation: gemSpin 8s linear infinite;
        }

        /* Tagline */
        .tagline {
          opacity: 0;
          animation: rise 1.2s cubic-bezier(0.22,1,0.36,1) 0.6s forwards;
        }
        .tg1 {
          font-size: clamp(1.1rem, 1.8vw, 1.5rem);
          font-weight: 300;
          color: rgba(220,200,155,0.4);
          letter-spacing: 0.02em;
          line-height: 1.4;
        }
        .tg2 {
          font-size: clamp(1.2rem, 2vw, 1.7rem);
          font-weight: 600;
          color: rgba(240,218,155,0.75);
          letter-spacing: -0.01em;
          line-height: 1.2;
          margin-top: 2px;
        }

        /* Stats row */
        .stats {
          display: flex; gap: 0;
          margin-top: 52px; align-items: stretch;
          opacity: 0;
          animation: rise 1.2s cubic-bezier(0.22,1,0.36,1) 0.8s forwards;
        }
        .stat {
          padding: 14px 28px; text-align: center;
          border: 1px solid rgba(201,168,76,0.1);
        }
        .stat:first-child { border-radius: 8px 0 0 8px; }
        .stat:last-child  { border-radius: 0 8px 8px 0; border-left: none; }
        .stat:not(:first-child):not(:last-child) { border-left: none; }
        .stat-n { font-size: 1.3rem; font-weight: 600; color: rgba(201,168,76,0.9); line-height: 1; }
        .stat-l { font-size: 0.55rem; font-weight: 400; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255,255,255,0.25); margin-top: 5px; }

        /* vertical divider */
        .vdiv {
          position: absolute; right: 0; top: 0; bottom: 0;
          width: 1px;
          background: linear-gradient(to bottom,
            transparent 0%,
            rgba(201,168,76,0.12) 20%,
            rgba(201,168,76,0.28) 50%,
            rgba(201,168,76,0.12) 80%,
            transparent 100%);
          z-index: 3;
        }

        /* ── RIGHT ── */
        .rgt {
          position: relative;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 48px 52px;
          background: #0b0906;
          overflow: hidden;
        }
        .rgt-bg {
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse 80% 60% at 50% 40%, rgba(201,168,76,0.04) 0%, transparent 70%);
          pointer-events: none;
        }

        /* Corner accents — all 4 */
        .ca { position: absolute; width: 22px; height: 22px; }
        .ca-tl { top: 18px; left: 18px; border-top: 1px solid rgba(201,168,76,0.25); border-left: 1px solid rgba(201,168,76,0.25); }
        .ca-tr { top: 18px; right: 18px; border-top: 1px solid rgba(201,168,76,0.25); border-right: 1px solid rgba(201,168,76,0.25); }
        .ca-bl { bottom: 18px; left: 18px; border-bottom: 1px solid rgba(201,168,76,0.25); border-left: 1px solid rgba(201,168,76,0.25); }
        .ca-br { bottom: 18px; right: 18px; border-bottom: 1px solid rgba(201,168,76,0.25); border-right: 1px solid rgba(201,168,76,0.25); }

        /* Top shimmer line */
        .rgt::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg,
            transparent,
            rgba(201,168,76,0.4) 30%,
            rgba(240,210,80,0.65) 50%,
            rgba(201,168,76,0.4) 70%,
            transparent);
        }

        /* form box */
        .fbox {
          width: 100%; position: relative; z-index: 2;
          opacity: 0;
          animation: rise 1s cubic-bezier(0.22,1,0.36,1) 0.35s forwards;
        }

        /* Brand header inside right panel */
        .rgt-brand {
          display: flex; align-items: center; gap: 14px;
          margin-bottom: 8px;
        }
        .rgt-icon {
          width: 42px; height: 42px; border-radius: 11px;
          background: linear-gradient(135deg, #c9a84c 0%, #7a4a10 100%);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(201,168,76,0.25), 0 0 0 1px rgba(201,168,76,0.1);
          flex-shrink: 0;
        }
        .rgt-name { font-size: 1.1rem; font-weight: 700; color: rgba(255,255,255,0.92); letter-spacing: 0.04em; line-height: 1.1; }
        .rgt-sub  { font-size: 0.58rem; font-weight: 400; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(201,168,76,0.55); margin-top: 3px; }

        .rgt-rule {
          height: 1px; margin: 24px 0 28px;
          background: linear-gradient(90deg, rgba(201,168,76,0.2), rgba(201,168,76,0.05) 60%, transparent);
        }

        .portal-header {
          margin-bottom: 36px;
        }
        .portal-title {
          font-size: 1.55rem; font-weight: 300; color: rgba(255,255,255,0.88);
          letter-spacing: -0.02em; line-height: 1.1;
        }
        .portal-hint {
          font-size: 0.67rem; font-weight: 400; color: rgba(255,255,255,0.3);
          margin-top: 6px; letter-spacing: 0.01em;
        }

        /* Fields */
        .field { margin-bottom: 18px; }
        .flbl {
          font-size: 0.6rem; font-weight: 600;
          letter-spacing: 0.18em; text-transform: uppercase;
          color: rgba(201,168,76,0.5);
          margin-bottom: 8px;
          display: block;
          transition: color 0.25s;
        }
        .field:focus-within .flbl { color: rgba(201,168,76,0.85); }

        .iwrap { position: relative; }
        .inp {
          width: 100%;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(201,168,76,0.14);
          border-radius: 10px;
          padding: 13px 16px;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 0.88rem; font-weight: 400;
          color: rgba(255,255,255,0.88); outline: none;
          transition: border-color 0.25s, background 0.25s, box-shadow 0.25s;
          letter-spacing: 0.01em;
          caret-color: #c9a84c;
        }
        .inp:focus {
          border-color: rgba(201,168,76,0.45);
          background: rgba(201,168,76,0.04);
          box-shadow: 0 0 0 3px rgba(201,168,76,0.06), inset 0 1px 0 rgba(255,255,255,0.03);
        }
        .inp:-webkit-autofill,
        .inp:-webkit-autofill:hover,
        .inp:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #0f0c08 inset !important;
          -webkit-text-fill-color: rgba(255,255,255,0.88) !important;
          caret-color: #c9a84c;
        }
        .inp::placeholder { color: rgba(255,255,255,0.2); }
        .inp.pw { padding-right: 68px; }

        .pwbtn {
          position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 0.58rem; font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: rgba(201,168,76,0.4); transition: color 0.2s; padding: 4px;
        }
        .pwbtn:hover { color: rgba(201,168,76,0.75); }

        .errmsg {
          display: flex; align-items: center; gap: 10px;
          background: rgba(200,60,60,0.08);
          border: 1px solid rgba(220,90,90,0.2);
          border-radius: 8px;
          padding: 11px 14px; margin-bottom: 16px;
          font-size: 0.76rem; font-weight: 400;
          color: rgba(255,148,148,0.85);
          animation: shake 0.4s ease;
        }
        .errdot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,100,100,0.6); flex-shrink: 0; }

        .btnrow { margin-top: 28px; }
        .sbtn {
          width: 100%; padding: 15px;
          background: linear-gradient(110deg, #a07828 0%, #c9a84c 35%, #edd870 55%, #c09030 75%, #a07828 100%);
          background-size: 240% 100%;
          border: none; border-radius: 10px;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 0.72rem; font-weight: 700;
          letter-spacing: 0.2em; text-transform: uppercase;
          color: #060402; cursor: pointer;
          position: relative; overflow: hidden;
          transition: transform 0.3s cubic-bezier(0.22,1,0.36,1), box-shadow 0.3s ease;
          animation: bgSlide 5s linear infinite;
        }
        .sbtn::after {
          content: ''; position: absolute; top: 0; left: -80%;
          width: 55%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
          transform: skewX(-18deg); transition: left 0.5s ease;
        }
        .sbtn:hover::after { left: 130%; }
        .sbtn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 28px rgba(201,168,76,0.35), 0 2px 8px rgba(201,168,76,0.2);
        }
        .sbtn:active { transform: translateY(0); }
        .sbtn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; animation: none; }

        .binner { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .sp { width: 13px; height: 13px; border: 1.5px solid rgba(0,0,0,0.15); border-top-color: rgba(0,0,0,0.75); border-radius: 50%; animation: spin 0.7s linear infinite; }
        .arr { font-size: 1rem; transition: transform 0.3s, opacity 0.3s; }
        .sbtn:hover .arr { transform: translateX(5px); }

        /* Footer */
        .foot {
          margin-top: 36px; padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.05);
          display: flex; align-items: center; justify-content: center; gap: 12px;
        }
        .fdot { width: 2px; height: 2px; border-radius: 50%; background: rgba(201,168,76,0.18); }
        .ftxt { font-size: 0.57rem; font-weight: 500; letter-spacing: 0.14em; color: rgba(255,255,255,0.22); text-transform: uppercase; }

        /* Keyframes */
        @keyframes rise    { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes spin    { to { transform: rotate(360deg) } }
        @keyframes shake   { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) } 75% { transform: translateX(5px) } }
        @keyframes bgSlide { 0% { background-position: 0% 50% } 100% { background-position: 240% 50% } }
        @keyframes pulse   { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
        @keyframes gemSpin { to { transform: rotate(45deg) rotate(360deg) } }

        @media (max-width: 820px) {
          .pg { grid-template-columns: 1fr }
          .lft { display: none }
          .rgt { padding: 40px 32px }
        }
      `}</style>

      <div className="pg">

        {/* ── LEFT ── */}
        <div className="lft">
          <div className="lft-bg" />
          <canvas ref={canvasRef} />

          <svg className="geo" viewBox="0 0 900 700" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#c9a84c" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#a07828" stopOpacity="0.15" />
              </linearGradient>
            </defs>
            <polygon points="450,40  860,350  450,660  40,350"   fill="none" stroke="url(#g1)" strokeWidth="0.6" />
            <polygon points="450,110 790,350  450,590  110,350"  fill="none" stroke="url(#g1)" strokeWidth="0.5" />
            <polygon points="450,180 720,350  450,520  180,350"  fill="none" stroke="url(#g1)" strokeWidth="0.4" />
            <polygon points="450,250 650,350  450,450  250,350"  fill="none" stroke="url(#g1)" strokeWidth="0.28" />
            <line x1="40"  y1="350" x2="860" y2="350" stroke="#c9a84c" strokeWidth="0.25" strokeDasharray="2 12" opacity="0.5" />
            <line x1="450" y1="40"  x2="450" y2="660" stroke="#c9a84c" strokeWidth="0.25" strokeDasharray="2 12" opacity="0.5" />
            <circle cx="450" cy="40"  r="2.5" fill="#c9a84c" opacity="0.6" />
            <circle cx="860" cy="350" r="2.5" fill="#c9a84c" opacity="0.6" />
            <circle cx="450" cy="660" r="2.5" fill="#c9a84c" opacity="0.6" />
            <circle cx="40"  cy="350" r="2.5" fill="#c9a84c" opacity="0.6" />
            <circle cx="450" cy="350" r="6"   fill="none" stroke="#c9a84c" strokeWidth="0.7" opacity="0.35" />
            <circle cx="450" cy="350" r="2.2" fill="#c9a84c" opacity="0.5" />
          </svg>

          <div className="lft-inner">
            {/* Live status badge */}
            <div className="brand-badge">
              <div className="badge-dot" />
              <span className="badge-text">Gold Operations Platform</span>
            </div>

            {/* Wordmark */}
            <div className="wordmark-wrap">
              <span className="wm-line1">White</span>
              <span className="wm-line2">Gold</span>
            </div>

            {/* Ornament */}
            <div className="orn">
              <div className="orn-l" />
              <div className="gem-wrap">
                <div className="gem" />
                <div className="gem-ring" />
              </div>
              <div className="orn-r" />
            </div>

            {/* Tagline */}
            <div className="tagline">
              <div className="tg1">Every gram.</div>
              <div className="tg2">Accounted for.</div>
            </div>

            {/* Stats */}
            <div className="stats">
              <div className="stat">
                <div className="stat-n">24/7</div>
                <div className="stat-l">Live tracking</div>
              </div>
              <div className="stat">
                <div className="stat-n">100%</div>
                <div className="stat-l">Verified data</div>
              </div>
              <div className="stat">
                <div className="stat-n">Real-time</div>
                <div className="stat-l">CRM Sync</div>
              </div>
            </div>
          </div>

          <div className="vdiv" />
        </div>

        {/* ── RIGHT ── */}
        <div className="rgt">
          <div className="rgt-bg" />
          <div className="ca ca-tl" />
          <div className="ca ca-tr" />
          <div className="ca ca-bl" />
          <div className="ca ca-br" />

          <div className="fbox">
            {/* Brand header */}
            <div className="rgt-brand">
              <div className="rgt-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div>
                <div className="rgt-name">White Gold</div>
                <div className="rgt-sub">Management Portal</div>
              </div>
            </div>

            <div className="rgt-rule" />

            {/* Sign in header */}
            <div className="portal-header">
              <div className="portal-title">Welcome back</div>
              <div className="portal-hint">Sign in to your account to continue</div>
            </div>

            <form onSubmit={handleLogin} autoComplete="off">
              <div className="field">
                <label className="flbl">Email Address</label>
                <div className="iwrap">
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
                <div className="iwrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="inp pw"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <button type="button" className="pwbtn" onClick={() => setShowPassword(v => !v)}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {error && <div className="errmsg"><div className="errdot" />{error}</div>}

              <div className="btnrow">
                <button type="submit" className="sbtn" disabled={loading}>
                  <div className="binner">
                    {loading
                      ? <><div className="sp" /> Signing in...</>
                      : <>Sign In <span className="arr">→</span></>
                    }
                  </div>
                </button>
              </div>
            </form>

            <div className="foot">
              <div className="fdot" />
              <div className="ftxt">Authorised Personnel Only</div>
              <div className="fdot" />
              <div className="ftxt">White Gold · v1.0</div>
              <div className="fdot" />
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
