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

  useEffect(() => {
    const t1 = setTimeout(() => setOut(true), 2500);
    const t2 = setTimeout(() => onDone && onDone(), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const color = COLORS[type] || COLORS.info;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 20px', borderRadius: 4,
      background: '#111', border: `1px solid ${color}33`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${color}22`,
      animation: out ? 'notifOut 0.4s ease forwards' : 'notifIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
      minWidth: 240,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, animation: 'goldPulse 1.5s ease infinite',
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 11, color: '#e8d9b0', letterSpacing: '0.04em' }}>{msg}</span>
    </div>
  );
}
