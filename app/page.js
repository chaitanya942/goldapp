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
  const orbCanvasRef                     = useRef(null)

  // ── Main particle canvas ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    let particles = []

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      // Two tiers: many small dim + a few large bright
      particles = [
        ...Array.from({ length: 55 }, () => ({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 1.0 + 0.2,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.18,
          op: Math.random() * 0.45 + 0.1,
          phase: Math.random() * Math.PI * 2,
          tier: 0,
        })),
        ...Array.from({ length: 12 }, () => ({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 2.2 + 1.2,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.1,
          op: Math.random() * 0.6 + 0.3,
          phase: Math.random() * Math.PI * 2,
          tier: 1,
        })),
      ]
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw connections only between tier-0
      const t0 = particles.filter(p => p.tier === 0)
      for (let i = 0; i < t0.length; i++) {
        for (let j = i + 1; j < t0.length; j++) {
          const dx = t0[i].x - t0[j].x
          const dy = t0[i].y - t0[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 130) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(201,168,76,${0.08 * (1 - dist / 130)})`
            ctx.lineWidth = 0.5
            ctx.moveTo(t0[i].x, t0[i].y)
            ctx.lineTo(t0[j].x, t0[j].y)
            ctx.stroke()
          }
        }
      }

      particles.forEach(p => {
        p.phase += p.tier === 1 ? 0.012 : 0.018
        const op = p.op * (0.55 + 0.45 * Math.sin(p.phase))

        if (p.tier === 1) {
          // Tier-1: glowing halo
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
          grad.addColorStop(0, `rgba(201,168,76,${op})`)
          grad.addColorStop(1, `rgba(201,168,76,0)`)
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
          ctx.fillStyle = grad
          ctx.fill()
        }

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
        html, body { height: 100%; overflow: hidden; background: #060401; }
        body { font-family: var(--font-jakarta), 'Plus Jakarta Sans', -apple-system, sans-serif; }

        .pg {
          height: 100vh;
          display: grid;
          grid-template-columns: 1fr 440px;
          overflow: hidden;
        }

        /* ─── LEFT ─────────────────────────────────────── */
        .lft {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: #060401;
        }

        /* Atmospheric glow layers */
        .lft-atm {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 70% 55% at 45% 48%, rgba(201,168,76,0.10) 0%, transparent 65%),
            radial-gradient(ellipse 35% 30% at 80% 18%, rgba(180,140,20,0.05) 0%, transparent 55%),
            radial-gradient(ellipse 28% 28% at 15% 85%, rgba(201,168,76,0.04) 0%, transparent 55%);
        }

        canvas.particles { position: absolute; inset: 0; width: 100%; height: 100%; }

        /* Rotating geometric rings */
        .geo-rings {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: min(70vh, 70vw); height: min(70vh, 70vw);
          pointer-events: none;
        }
        .ring {
          position: absolute; inset: 0;
          border-radius: 50%;
          border: 1px solid rgba(201,168,76,0.08);
        }
        .ring-1 { animation: rotCW 40s linear infinite; }
        .ring-2 { inset: 8%; border-color: rgba(201,168,76,0.06); animation: rotCCW 55s linear infinite; }
        .ring-3 { inset: 18%; border-color: rgba(201,168,76,0.07); animation: rotCW 70s linear infinite; }

        /* Diamond frame */
        .diamond-frame {
          position: absolute; inset: 0;
          animation: rotCW 90s linear infinite;
          pointer-events: none;
        }

        /* Static geo lines */
        .geo-svg {
          position: absolute; inset: 0; width: 100%; height: 100%;
          opacity: 0.12; pointer-events: none;
        }

        /* Horizontal scanline sweep */
        .scan {
          position: absolute; inset: 0; pointer-events: none;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            rgba(201,168,76,0.008) 3px,
            rgba(201,168,76,0.008) 4px
          );
        }

        /* Inner content */
        .lft-inner {
          position: relative; z-index: 2;
          text-align: center;
          display: flex; flex-direction: column; align-items: center;
        }

        /* Company logo with halo */
        .logo-wrap {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 36px;
          opacity: 0;
          animation: riseScale 1.4s cubic-bezier(0.22,1,0.36,1) 0.2s forwards;
        }
        .logo-halo {
          position: absolute;
          width: 220px; height: 220px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(201,168,76,0.14) 0%, transparent 70%);
          animation: breathe 4s ease-in-out infinite;
        }
        .logo-halo-2 {
          position: absolute;
          width: 160px; height: 160px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(201,168,76,0.08) 0%, transparent 70%);
          animation: breathe 4s ease-in-out 0.8s infinite;
        }
        .logo-img {
          position: relative; z-index: 1;
          width: 130px; height: auto;
          filter: brightness(12) saturate(0.2);
          opacity: 0.92;
          mix-blend-mode: lighten;
          animation: logoFloat 6s ease-in-out infinite;
          drop-shadow: 0 0 40px rgba(201,168,76,0.3);
        }

        /* Wordmark below logo */
        .wordmark-wrap {
          opacity: 0;
          animation: rise 1.2s cubic-bezier(0.22,1,0.36,1) 0.5s forwards;
        }
        .wm-line1 {
          display: block;
          font-size: clamp(1.6rem, 2.6vw, 2.8rem);
          font-weight: 200;
          letter-spacing: 0.62em;
          text-transform: uppercase;
          color: rgba(201,168,76,0.5);
          line-height: 1;
          text-indent: 0.62em; /* compensate letter-spacing so it looks centred */
        }
        .wm-line2 {
          display: block;
          font-size: clamp(2.8rem, 5vw, 5.6rem);
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(201,168,76,0.95);
          text-shadow:
            0 0 100px rgba(201,168,76,0.22),
            0 0 30px rgba(201,168,76,0.08);
          line-height: 0.88;
          margin-top: 2px;
          text-indent: 0.1em;
        }

        /* Ornament */
        .orn {
          display: flex; align-items: center; gap: 18px;
          margin: 28px 0 24px;
          opacity: 0;
          animation: rise 1.2s cubic-bezier(0.22,1,0.36,1) 0.7s forwards;
        }
        .orn-l { height: 1px; width: 70px; background: linear-gradient(90deg, transparent, rgba(201,168,76,0.38)); }
        .orn-r { height: 1px; width: 70px; background: linear-gradient(90deg, rgba(201,168,76,0.38), transparent); }
        .gem-wrap { position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
        .gem { width: 7px; height: 7px; background: #c9a84c; transform: rotate(45deg); box-shadow: 0 0 16px rgba(201,168,76,0.8), 0 0 5px rgba(201,168,76,1); }
        .gem-ring-1 { position: absolute; width: 18px; height: 18px; border: 1px solid rgba(201,168,76,0.3); transform: rotate(45deg); animation: gemSpin 7s linear infinite; }
        .gem-ring-2 { position: absolute; width: 26px; height: 26px; border: 1px solid rgba(201,168,76,0.12); transform: rotate(45deg); animation: gemSpin 12s linear infinite reverse; }

        /* Tagline */
        .tagline {
          opacity: 0;
          animation: rise 1.2s cubic-bezier(0.22,1,0.36,1) 0.85s forwards;
        }
        .tg1 { font-size: clamp(1rem, 1.6vw, 1.4rem); font-weight: 300; color: rgba(220,200,155,0.38); letter-spacing: 0.01em; line-height: 1.4; }
        .tg2 { font-size: clamp(1.1rem, 1.8vw, 1.6rem); font-weight: 700; color: rgba(240,218,155,0.72); letter-spacing: -0.01em; line-height: 1.2; margin-top: 1px; }

        /* Vertical divider */
        .vdiv {
          position: absolute; right: 0; top: 0; bottom: 0; width: 1px;
          background: linear-gradient(to bottom, transparent 0%, rgba(201,168,76,0.1) 20%, rgba(201,168,76,0.24) 50%, rgba(201,168,76,0.1) 80%, transparent 100%);
          z-index: 3;
        }

        /* ─── RIGHT ─────────────────────────────────────── */
        .rgt {
          position: relative;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 52px 52px;
          background: #0a0806;
          overflow: hidden;
        }

        /* Subtle inner glow */
        .rgt::after {
          content: '';
          position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(ellipse 100% 70% at 50% 35%, rgba(201,168,76,0.035) 0%, transparent 65%);
        }

        /* Top accent line */
        .rgt::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,0.35) 30%, rgba(240,210,80,0.6) 50%, rgba(201,168,76,0.35) 70%, transparent);
        }

        /* Corner accents */
        .ca { position: absolute; width: 20px; height: 20px; }
        .ca-tl { top: 16px; left: 16px; border-top: 1px solid rgba(201,168,76,0.22); border-left: 1px solid rgba(201,168,76,0.22); }
        .ca-tr { top: 16px; right: 16px; border-top: 1px solid rgba(201,168,76,0.22); border-right: 1px solid rgba(201,168,76,0.22); }
        .ca-bl { bottom: 16px; left: 16px; border-bottom: 1px solid rgba(201,168,76,0.22); border-left: 1px solid rgba(201,168,76,0.22); }
        .ca-br { bottom: 16px; right: 16px; border-bottom: 1px solid rgba(201,168,76,0.22); border-right: 1px solid rgba(201,168,76,0.22); }

        /* Form box */
        .fbox {
          width: 100%; position: relative; z-index: 2;
          opacity: 0;
          animation: rise 1s cubic-bezier(0.22,1,0.36,1) 0.3s forwards;
        }

        /* Logo in right panel — centered, prominent */
        .rgt-logo-wrap {
          display: flex; flex-direction: column; align-items: center;
          margin-bottom: 32px;
        }
        .rgt-logo-halo {
          position: absolute;
          width: 140px; height: 80px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(201,168,76,0.12) 0%, transparent 70%);
          animation: breathe 4s ease-in-out 1s infinite;
          pointer-events: none;
        }
        .rgt-logo-img {
          position: relative;
          width: 110px; height: auto;
          filter: brightness(12) saturate(0.15);
          opacity: 0.9;
          mix-blend-mode: lighten;
        }
        .rgt-logo-name {
          margin-top: 10px;
          font-size: 0.58rem; font-weight: 600;
          letter-spacing: 0.28em; text-transform: uppercase;
          color: rgba(201,168,76,0.45);
          text-indent: 0.28em;
        }

        /* Divider */
        .rgt-rule {
          height: 1px; margin-bottom: 32px;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,0.15) 40%, rgba(201,168,76,0.15) 60%, transparent);
        }

        /* Welcome header */
        .portal-header { margin-bottom: 32px; }
        .portal-title {
          font-size: 1.75rem; font-weight: 300; color: rgba(255,255,255,0.90);
          letter-spacing: -0.03em; line-height: 1;
        }
        .portal-hint {
          font-size: 0.68rem; font-weight: 400; color: rgba(255,255,255,0.28);
          margin-top: 7px; letter-spacing: 0.01em;
        }

        /* Fields */
        .field { margin-bottom: 16px; }
        .flbl {
          font-size: 0.58rem; font-weight: 700;
          letter-spacing: 0.2em; text-transform: uppercase;
          color: rgba(201,168,76,0.4);
          margin-bottom: 8px; display: block;
          transition: color 0.2s;
        }
        .field:focus-within .flbl { color: rgba(201,168,76,0.8); }

        .iwrap { position: relative; }
        .inp {
          width: 100%;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(201,168,76,0.12);
          border-radius: 10px;
          padding: 13px 16px;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 0.875rem; font-weight: 400;
          color: rgba(255,255,255,0.88); outline: none;
          transition: border-color 0.22s, background 0.22s, box-shadow 0.22s;
          letter-spacing: 0.01em;
          caret-color: #c9a84c;
        }
        .inp:focus {
          border-color: rgba(201,168,76,0.4);
          background: rgba(201,168,76,0.035);
          box-shadow: 0 0 0 3px rgba(201,168,76,0.055);
        }
        .inp:-webkit-autofill,
        .inp:-webkit-autofill:hover,
        .inp:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #0f0c08 inset !important;
          -webkit-text-fill-color: rgba(255,255,255,0.88) !important;
          caret-color: #c9a84c;
        }
        .inp::placeholder { color: rgba(255,255,255,0.18); }
        .inp.pw { padding-right: 66px; }

        /* Show/Hide eye toggle */
        .pwbtn {
          position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; padding: 5px;
          display: flex; align-items: center; justify-content: center;
          color: rgba(201,168,76,0.35); transition: color 0.2s;
        }
        .pwbtn:hover { color: rgba(201,168,76,0.75); }
        .pwbtn svg { width: 16px; height: 16px; }

        /* Error */
        .errmsg {
          display: flex; align-items: center; gap: 10px;
          background: rgba(200,60,60,0.07);
          border: 1px solid rgba(220,90,90,0.18);
          border-radius: 9px;
          padding: 11px 14px; margin-bottom: 14px;
          font-size: 0.75rem; font-weight: 400;
          color: rgba(255,148,148,0.82);
          animation: shake 0.4s ease;
        }
        .errdot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,100,100,0.55); flex-shrink: 0; }

        /* Button */
        .btnrow { margin-top: 24px; }
        .sbtn {
          width: 100%; padding: 15px;
          background: linear-gradient(110deg, #9a7020 0%, #c9a84c 30%, #edd870 52%, #c09030 73%, #9a7020 100%);
          background-size: 240% 100%;
          border: none; border-radius: 10px;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 0.7rem; font-weight: 800;
          letter-spacing: 0.24em; text-transform: uppercase;
          color: #07040100; cursor: pointer;
          position: relative; overflow: hidden;
          transition: transform 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s ease;
          animation: bgSlide 4.5s linear infinite;
          color: rgba(6,4,1,0.9);
        }
        .sbtn::after {
          content: ''; position: absolute; top: 0; left: -85%;
          width: 55%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
          transform: skewX(-20deg); transition: left 0.55s ease;
        }
        .sbtn:hover::after { left: 135%; }
        .sbtn:hover { transform: translateY(-2px); box-shadow: 0 10px 32px rgba(201,168,76,0.32), 0 3px 10px rgba(201,168,76,0.18); }
        .sbtn:active { transform: translateY(0); }
        .sbtn:disabled { opacity: 0.42; cursor: not-allowed; transform: none; box-shadow: none; animation: none; }

        .binner { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .sp { width: 13px; height: 13px; border: 1.5px solid rgba(0,0,0,0.12); border-top-color: rgba(0,0,0,0.7); border-radius: 50%; animation: spin 0.7s linear infinite; }
        .arr { font-size: 1rem; transition: transform 0.28s; display: inline-block; }
        .sbtn:hover .arr { transform: translateX(5px); }

        /* ─── Keyframes ─────────────────────────────────── */
        @keyframes rise       { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes riseScale  { from { opacity: 0; transform: translateY(20px) scale(0.94) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes spin       { to { transform: rotate(360deg) } }
        @keyframes shake      { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) } 75% { transform: translateX(5px) } }
        @keyframes bgSlide    { 0% { background-position: 0% 50% } 100% { background-position: 240% 50% } }
        @keyframes breathe    { 0%,100% { opacity: 0.6; transform: scale(1) } 50% { opacity: 1; transform: scale(1.12) } }
        @keyframes logoFloat  { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
        @keyframes gemSpin    { to { transform: rotate(45deg) rotate(360deg) } }
        @keyframes rotCW      { to { transform: rotate(360deg) } }
        @keyframes rotCCW     { to { transform: rotate(-360deg) } }

        @media (max-width: 820px) {
          .pg { grid-template-columns: 1fr }
          .lft { display: none }
          .rgt { padding: 40px 32px }
        }
      `}</style>

      <div className="pg">

        {/* ─── LEFT ─── */}
        <div className="lft">
          <div className="lft-atm" />
          <canvas className="particles" ref={canvasRef} />
          <div className="scan" />

          {/* Rotating rings centered behind logo */}
          <div className="geo-rings">
            <div className="ring ring-1" />
            <div className="ring ring-2" />
            <div className="ring ring-3" />
            {/* Diamond ring */}
            <svg className="diamond-frame" viewBox="0 0 400 400">
              <polygon points="200,10 390,200 200,390 10,200"
                fill="none" stroke="rgba(201,168,76,0.07)" strokeWidth="1" />
              <polygon points="200,50 350,200 200,350 50,200"
                fill="none" stroke="rgba(201,168,76,0.05)" strokeWidth="0.8" />
            </svg>
          </div>

          {/* Static fine lines */}
          <svg className="geo-svg" viewBox="0 0 900 700" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="gl" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#c9a84c" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#a07828" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            <line x1="50"  y1="350" x2="850" y2="350" stroke="#c9a84c" strokeWidth="0.3" strokeDasharray="1 14" opacity="0.35" />
            <line x1="450" y1="50"  x2="450" y2="650" stroke="#c9a84c" strokeWidth="0.3" strokeDasharray="1 14" opacity="0.35" />
            <circle cx="450" cy="50"  r="2" fill="#c9a84c" opacity="0.4" />
            <circle cx="850" cy="350" r="2" fill="#c9a84c" opacity="0.4" />
            <circle cx="450" cy="650" r="2" fill="#c9a84c" opacity="0.4" />
            <circle cx="50"  cy="350" r="2" fill="#c9a84c" opacity="0.4" />
          </svg>

          <div className="lft-inner">
            {/* Logo with floating halo */}
            <div className="logo-wrap">
              <div className="logo-halo" />
              <div className="logo-halo-2" />
              <img src="/logo.png" alt="White Gold" className="logo-img" />
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
                <div className="gem-ring-1" />
                <div className="gem-ring-2" />
              </div>
              <div className="orn-r" />
            </div>

            {/* Tagline */}
            <div className="tagline">
              <div className="tg1">Every gram.</div>
              <div className="tg2">Accounted for.</div>
            </div>
          </div>

          <div className="vdiv" />
        </div>

        {/* ─── RIGHT ─── */}
        <div className="rgt">
          <div className="ca ca-tl" />
          <div className="ca ca-tr" />
          <div className="ca ca-bl" />
          <div className="ca ca-br" />

          <div className="fbox">
            {/* Logo centered in right panel */}
            <div className="rgt-logo-wrap">
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="rgt-logo-halo" />
                <img src="/logo.png" alt="White Gold" className="rgt-logo-img" />
              </div>
              <div className="rgt-logo-name">White Gold</div>
            </div>

            <div className="rgt-rule" />

            {/* Welcome header */}
            <div className="portal-header">
              <div className="portal-title">Welcome back</div>
              <div className="portal-hint">Sign in with your authorised account</div>
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
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && <div className="errmsg"><div className="errdot" />{error}</div>}

              <div className="btnrow">
                <button type="submit" className="sbtn" disabled={loading}>
                  <div className="binner">
                    {loading
                      ? <><div className="sp" /> Signing in…</>
                      : <>Sign In <span className="arr">→</span></>
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
