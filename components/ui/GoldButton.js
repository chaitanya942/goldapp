'use client';
import { useRef } from 'react';

export default function GoldButton({ children, variant = 'primary', onClick, style = {}, type = 'button', disabled = false }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    if (disabled) return;
    const btn = btnRef.current;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
      position:absolute;border-radius:50%;
      width:${size}px;height:${size}px;
      left:${e.clientX - rect.left - size / 2}px;
      top:${e.clientY - rect.top - size / 2}px;
      background:rgba(255,215,0,0.3);
      transform:scale(0);
      animation:ripple 0.6s ease-out forwards;
      pointer-events:none;
    `;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
    onClick && onClick(e);
  };

  const base = {
    position: 'relative', overflow: 'hidden',
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'DM Mono', 'Geist Mono', monospace",
    fontSize: '12px', letterSpacing: '0.12em',
    textTransform: 'uppercase', fontWeight: 400,
    padding: '10px 24px', borderRadius: '2px',
    transition: 'all 0.25s ease',
    opacity: disabled ? 0.5 : 1,
    ...style,
  };

  const variants = {
    primary: {
      background: 'linear-gradient(135deg, #C9A84C, #FFD700, #C9A84C)',
      color: '#080808',
      boxShadow: '0 0 20px rgba(255,215,0,0.2)',
    },
    outline: {
      background: 'transparent',
      color: '#FFD700',
      border: '1px solid #C9A84C',
    },
    ghost: {
      background: 'rgba(255,215,0,0.05)',
      color: '#C9A84C',
      border: '1px solid rgba(255,215,0,0.1)',
    },
  };

  return (
    <button
      ref={btnRef}
      type={type}
      disabled={disabled}
      style={{ ...base, ...variants[variant] }}
      onClick={handleClick}
      onMouseEnter={e => {
        if (disabled) return;
        if (variant === 'primary') {
          e.currentTarget.style.boxShadow = '0 0 40px rgba(255,215,0,0.5)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        } else {
          e.currentTarget.style.borderColor = '#FFD700';
          e.currentTarget.style.color = '#FFD700';
          e.currentTarget.style.background = 'rgba(255,215,0,0.08)';
        }
      }}
      onMouseLeave={e => {
        if (disabled) return;
        e.currentTarget.style.boxShadow = variant === 'primary' ? '0 0 20px rgba(255,215,0,0.2)' : 'none';
        e.currentTarget.style.transform = 'none';
        if (variant !== 'primary') {
          e.currentTarget.style.borderColor = '#C9A84C';
          e.currentTarget.style.color = variant === 'ghost' ? '#C9A84C' : '#FFD700';
          e.currentTarget.style.background = variant === 'ghost' ? 'rgba(255,215,0,0.05)' : 'transparent';
        }
      }}
    >
      {children}
    </button>
  );
}
