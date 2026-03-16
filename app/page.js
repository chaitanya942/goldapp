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
      particles = Array.from({ length: 55 }, () => ({
        x:     Math.random() * canvas.width,
        y:     Math.random() * canvas.height,
        size:  Math.random() * 1.2 + 0.2,
        vx:    (Math.random() - 0.5) * 0.3,
        vy:    (Math.random() - 0.5) * 0.25,
        op:    Math.random() * 0.65 + 0.15,
        phase: Math.random() * Math.PI * 2,
      }))
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 110) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(201,168,76,${0.13 * (1 - dist / 110)})`
            ctx.lineWidth = 0.5
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }
      particles.forEach(p => {
        p.phase += 0.018
        const op = p.op * (0.65 + 0.35 * Math.sin(p.phase))
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
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Outfit:wght@200;300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; background: #0a0702; }
        body { font-family: 'Outfit', sans-serif; }

        .pg {
          height: 100vh;
          display: grid;
          grid-template-columns: 1fr 500px;
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
          background: #090601;
        }
        .lft-bg {
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse 55% 45% at 35% 48%, rgba(201,168,76,0.13) 0%, transparent 60%),
            radial-gradient(ellipse 35% 35% at 72% 22%, rgba(180,130,15,0.07) 0%, transparent 55%),
            #090601;
        }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        .geo { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.18; pointer-events: none; }

        .lft-inner {
          position: relative; z-index: 2;
          text-align: center;
          display: flex; flex-direction: column; align-items: center;
        }

        .wordmark {
          font-family: 'Cormorant Garamond', serif;
          font-weight: 300;
          font-size: clamp(3.4rem, 5.2vw, 6rem);
          letter-spacing: 0.28em;
          text-transform: uppercase;
          line-height: 1;
          color: rgba(201,168,76,0.94);
          text-shadow: 0 0 130px rgba(201,168,76,0.28), 0 0 40px rgba(201,168,76,0.12);
          opacity: 0;
          animation: rise 1.4s cubic-bezier(0.22,1,0.36,1) 0.2s forwards;
        }
        .wordmark span { display: none; }

        .orn {
          display: flex; align-items: center; gap: 18px;
          margin: 30px 0 34px;
          opacity: 0;
          animation: rise 1.4s cubic-bezier(0.22,1,0.36,1) 0.45s forwards;
        }
        .orn-l { height: 1px; width: 60px; background: linear-gradient(90deg, transparent, rgba(201,168,76,0.55)); }
        .orn-r { height: 1px; width: 60px; background: linear-gradient(90deg, rgba(201,168,76,0.55), transparent); }
        .gem {
          width: 6px; height: 6px;
          background: #c9a84c; transform: rotate(45deg);
          box-shadow: 0 0 14px rgba(201,168,76,0.6), 0 0 4px rgba(201,168,76,1);
        }

        .tagline {
          font-family: 'Cormorant Garamond', serif;
          font-style: italic;
          font-weight: 300;
          font-size: clamp(1.4rem, 2.2vw, 2rem);
          color: rgba(220,200,155,0.48);
          line-height: 1.45;
          letter-spacing: 0.04em;
          opacity: 0;
          animation: rise 1.4s cubic-bezier(0.22,1,0.36,1) 0.65s forwards;
        }
        .tagline b {
          display: block;
          font-weight: 500;
          font-style: italic;
          color: rgba(240,218,155,0.82);
          font-size: 1.12em;
        }

        .sub {
          margin-top: 24px;
          font-size: 0.62rem; font-weight: 300;
          letter-spacing: 0.3em; text-transform: uppercase;
          color: rgba(201,168,76,0.42);
          opacity: 0;
          animation: rise 1.4s cubic-bezier(0.22,1,0.36,1) 0.85s forwards;
        }

        /* vertical divider */
        .vdiv {
          position: absolute; right: 0; top: 0; bottom: 0;
          width: 1px;
          background: linear-gradient(to bottom,
            transparent 0%,
            rgba(201,168,76,0.18) 25%,
            rgba(201,168,76,0.32) 50%,
            rgba(201,168,76,0.18) 75%,
            transparent 100%);
          z-index: 3;
        }

        /* ── RIGHT ── */
        .rgt {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          padding: 56px 60px;
          background: #0c0a06;
          overflow: hidden;
        }
        .rgt::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,0.55) 40%, rgba(240,210,80,0.75) 50%, rgba(201,168,76,0.55) 60%, transparent);
          animation: shimmer 4s ease infinite;
        }
        .c-tr { position: absolute; top: 20px; right: 20px; width: 26px; height: 26px; border-top: 1px solid rgba(201,168,76,0.28); border-right: 1px solid rgba(201,168,76,0.28); }
        .c-bl { position: absolute; bottom: 20px; left: 20px; width: 26px; height: 26px; border-bottom: 1px solid rgba(201,168,76,0.28); border-left: 1px solid rgba(201,168,76,0.28); }
        .rgt-glow {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 340px; height: 340px;
          background: radial-gradient(ellipse, rgba(201,168,76,0.05) 0%, transparent 70%);
          pointer-events: none;
        }

        /* form box */
        .fbox {
          width: 100%; position: relative; z-index: 2;
          opacity: 0;
          animation: rise 1s cubic-bezier(0.22,1,0.36,1) 0.4s forwards;
        }

        .logo-img {
          width: 170px; height: auto;
          filter: brightness(10) saturate(0);
          opacity: 0.88;
          mix-blend-mode: lighten;
          margin-bottom: 0;
        }
        .logo-rule {
          height: 1px; width: 100%;
          background: linear-gradient(90deg, rgba(201,168,76,0.42), transparent);
          margin: 16px 0 11px;
        }
        .portal-lbl {
          font-size: 0.61rem; font-weight: 300;
          letter-spacing: 0.28em; text-transform: uppercase;
          color: rgba(255,255,255,0.38);
          margin-bottom: 48px;
        }

        .field { margin-bottom: 30px; }
        .flbl {
          display: flex; align-items: center; gap: 9px;
          font-size: 0.63rem; font-weight: 400;
          letter-spacing: 0.2em; text-transform: uppercase;
          color: rgba(201,168,76,0.62);
          margin-bottom: 11px;
          transition: color 0.32s;
        }
        .flbl-line {
          display: block; width: 13px; height: 1px;
          background: rgba(201,168,76,0.33);
          transition: width 0.32s, background 0.32s;
          flex-shrink: 0;
        }
        .field:focus-within .flbl { color: rgba(201,168,76,0.9); }
        .field:focus-within .flbl-line { width: 19px; background: #c9a84c; }

        .iwrap { position: relative; }
        .inp {
          width: 100%; background: transparent;
          border: none; border-bottom: 1px solid rgba(201,168,76,0.17);
          border-radius: 0; padding: 12px 0;
          font-family: 'Outfit', sans-serif;
          font-size: 0.9rem; font-weight: 300;
          color: rgba(255,255,255,0.88); outline: none;
          transition: color 0.3s; letter-spacing: 0.05em;
          caret-color: #c9a84c;
        }
        .inp:-webkit-autofill,
        .inp:-webkit-autofill:hover,
        .inp:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #080604 inset !important;
          -webkit-text-fill-color: rgba(255,255,255,0.88) !important;
          background-color: #080604 !important;
          caret-color: #c9a84c;
        }
        .inp:focus { border-bottom-color: transparent; }
        .inp::placeholder { color: rgba(255,255,255,0.25); }
        .inp.pw { padding-right: 48px; }

        .uline {
          position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
          background: rgba(201,168,76,0.17);
          overflow: visible;
        }
        .uline::after {
          content: ''; position: absolute; bottom: 0; left: 50%;
          transform: translateX(-50%);
          width: 0; height: 1px;
          background: linear-gradient(90deg, transparent, #c9a84c 30%, #f0d060 50%, #c9a84c 70%, transparent);
          transition: width 0.55s cubic-bezier(0.22,1,0.36,1);
        }
        .field:focus-within .uline::after { width: 100%; }

        .pwbtn {
          position: absolute; right: 0; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          font-family: 'Outfit', sans-serif; font-size: 0.6rem; font-weight: 300;
          letter-spacing: 0.18em; text-transform: uppercase;
          color: rgba(201,168,76,0.5); transition: color 0.25s; padding: 4px;
        }
        .pwbtn:hover { color: rgba(201,168,76,0.72); }

        .errmsg {
          display: flex; align-items: center; gap: 10px;
          background: rgba(200,60,60,0.07);
          border-left: 2px solid rgba(220,90,90,0.42);
          padding: 11px 14px; margin-bottom: 18px;
          border-radius: 0 2px 2px 0;
          font-size: 0.78rem; font-weight: 300;
          color: rgba(255,148,148,0.85);
          animation: shake 0.4s ease;
        }
        .errdot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,100,100,0.6); flex-shrink: 0; }

        .btnrow { margin-top: 38px; }
        .sbtn {
          width: 100%; padding: 17px;
          background: linear-gradient(120deg, #a07828 0%, #c9a84c 32%, #efd870 55%, #c09030 78%, #a07828 100%);
          background-size: 250% 100%;
          border: none; border-radius: 2px;
          font-family: 'Outfit', sans-serif;
          font-size: 0.72rem; font-weight: 500;
          letter-spacing: 0.38em; text-transform: uppercase;
          color: #060402; cursor: pointer;
          position: relative; overflow: hidden;
          transition: transform 0.35s cubic-bezier(0.22,1,0.36,1), box-shadow 0.35s ease;
          animation: bgSlide 5s linear infinite;
        }
        .sbtn::after {
          content: ''; position: absolute; top: 0; left: -80%;
          width: 50%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.26), transparent);
          transform: skewX(-18deg); transition: left 0.6s ease;
        }
        .sbtn:hover::after { left: 130%; }
        .sbtn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(201,168,76,0.3), 0 2px 8px rgba(201,168,76,0.16); }
        .sbtn:active { transform: translateY(0); }
        .sbtn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; animation: none; }

        .binner { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .sp { width: 13px; height: 13px; border: 1.5px solid rgba(0,0,0,0.2); border-top-color: rgba(0,0,0,0.8); border-radius: 50%; animation: spin 0.7s linear infinite; }
        .arr { font-size: 0.9rem; opacity: 0.6; transition: transform 0.3s, opacity 0.3s; }
        .sbtn:hover .arr { transform: translateX(4px); opacity: 1; }

        .foot {
          margin-top: 44px; padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.04);
          display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .fdot { width: 2px; height: 2px; border-radius: 50%; background: rgba(201,168,76,0.2); }
        .ftxt { font-size: 0.59rem; font-weight: 300; letter-spacing: 0.15em; color: rgba(255,255,255,0.28); text-transform: uppercase; }

        @keyframes rise    { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes shake   { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        @keyframes shimmer { 0%,100%{opacity:.7} 50%{opacity:.3} }
        @keyframes bgSlide { 0%{background-position:0% 50%} 100%{background-position:250% 50%} }

        @media(max-width:820px){ .pg{grid-template-columns:1fr} .lft{display:none} .rgt{padding:40px 32px} }
      `}</style>

      <div className="pg">

        {/* LEFT */}
        <div className="lft">
          <div className="lft-bg" />
          <canvas ref={canvasRef} />

          <svg className="geo" viewBox="0 0 900 700" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#c9a84c" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#a07828" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <polygon points="450,50  840,350  450,650  60,350"  fill="none" stroke="url(#g1)" strokeWidth="0.7" />
            <polygon points="450,120 770,350  450,580  130,350" fill="none" stroke="url(#g1)" strokeWidth="0.55" />
            <polygon points="450,190 700,350  450,510  200,350" fill="none" stroke="url(#g1)" strokeWidth="0.44" />
            <polygon points="450,260 630,350  450,440  270,350" fill="none" stroke="url(#g1)" strokeWidth="0.32" />
            <line x1="60"  y1="350" x2="840" y2="350" stroke="#c9a84c" strokeWidth="0.3" strokeDasharray="3 10" />
            <line x1="450" y1="50"  x2="450" y2="650" stroke="#c9a84c" strokeWidth="0.3" strokeDasharray="3 10" />
            <circle cx="450" cy="50"  r="2.5" fill="#c9a84c" opacity="0.7" />
            <circle cx="840" cy="350" r="2.5" fill="#c9a84c" opacity="0.7" />
            <circle cx="450" cy="650" r="2.5" fill="#c9a84c" opacity="0.7" />
            <circle cx="60"  cy="350" r="2.5" fill="#c9a84c" opacity="0.7" />
            <circle cx="450" cy="350" r="5"   fill="none" stroke="#c9a84c" strokeWidth="0.8" opacity="0.45" />
            <circle cx="450" cy="350" r="2"   fill="#c9a84c" opacity="0.55" />
          </svg>

          <div className="lft-inner">
            <div className="wordmark">White Gold</div>
            <div className="orn">
              <div className="orn-l" /><div className="gem" /><div className="orn-r" />
            </div>
            <div className="tagline">
              Every gram.<br />
              <b>Accounted for.</b>
            </div>
            <div className="sub">Gold Operations Platform</div>
          </div>

          <div className="vdiv" />
        </div>

        {/* RIGHT */}
        <div className="rgt">
          <div className="rgt-glow" />
          <div className="c-tr" /><div className="c-bl" />

          <div className="fbox">
            <img src="/logo.png" alt="White Gold" className="logo-img" />
            <div className="logo-rule" />
            <div className="portal-lbl">Management Portal</div>

            <form onSubmit={handleLogin} autoComplete="off">
              <div className="field">
                <label className="flbl"><span className="flbl-line" />Email Address</label>
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
                  <div className="uline" />
                </div>
              </div>

              <div className="field">
                <label className="flbl"><span className="flbl-line" />Password</label>
                <div className="iwrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="inp pw"
                    placeholder="••••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <div className="uline" />
                  <button type="button" className="pwbtn" onClick={() => setShowPassword(v => !v)}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {error && <div className="errmsg"><div className="errdot" />{error}</div>}

              <div className="btnrow">
                <button type="submit" className="sbtn" disabled={loading}>
                  <div className="binner">
                    {loading ? <><div className="sp" /> Signing in...</> : <>Sign In <span className="arr">→</span></>}
                  </div>
                </button>
              </div>
            </form>

            <div className="foot">
              <div className="fdot" />
              <div className="ftxt">Authorised Personnel Only</div>
              <div className="fdot" />
              <div className="ftxt">GoldApp v1.0</div>
              <div className="fdot" />
            </div>
          </div>
        </div>

      </div>
    </>
  )
}