'use client';
import { useState, useEffect } from 'react';

const COLORS = {
  success: '#4ade80',
  error:   '#f87171',
  info:    '#FFD700',
  warning: '#c9981f',
};

export default function Toast({ msg, type = 'info', onDone }) {
  const [out, setOut] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setOut(true), 2500);
    const t2 = setTimeout(() => onDone && onDone(), 3000);
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', check); };
  }, []);

  const color = COLORS[type] || COLORS.info;

  // Mobile: full-width bottom toast above the BottomNav (64px) with safe-area inset.
  // Desktop: small floating bottom-right toast.
  const positionStyle = isMobile
    ? { left: 12, right: 12, bottom: 'calc(76px + env(safe-area-inset-bottom))', minWidth: 0 }
    : { right: 24, bottom: 24, minWidth: 240 };

  return (
    <div style={{
      position: 'fixed', zIndex: 2000,
      ...positionStyle,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 20px', borderRadius: isMobile ? 12 : 4,
      background: '#111', border: `1px solid ${color}33`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${color}22`,
      animation: out ? 'notifOut 0.4s ease forwards' : 'notifIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, animation: 'goldPulse 1.5s ease infinite',
        flexShrink: 0,
      }} />
      <span style={{ fontSize: isMobile ? 12 : 11, color: '#e8d9b0', letterSpacing: '0.04em' }}>{msg}</span>
    </div>
  );
}
