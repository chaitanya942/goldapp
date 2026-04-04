'use client';
import { useEffect } from 'react';

export default function GoldModal({ open, onClose, title, children, width = 480 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        animation: 'backdropIn 0.25s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111',
          border: '1px solid rgba(201,168,76,0.3)',
          borderRadius: '6px',
          padding: '32px',
          width: '100%',
          maxWidth: width,
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 40px 80px rgba(0,0,0,0.8), 0 0 40px rgba(255,215,0,0.05)',
          animation: 'modalIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {title && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 24,
          }}>
            <span style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 22, color: '#FFD700', fontWeight: 600,
            }}>
              {title}
            </span>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: '#8B6914',
                cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 4,
              }}
            >×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
