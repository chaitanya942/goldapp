'use client';
import { useEffect } from 'react';

export default function GoldDrawer({ open, onClose, title, children, width = 360 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: open ? 'all' : 'none', zIndex: 999 }}>
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            animation: 'backdropIn 0.2s ease',
          }}
        />
      )}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: width,
        background: '#0f0f0f',
        borderLeft: '1px solid rgba(201,168,76,0.2)',
        padding: '32px 24px',
        overflowY: 'auto',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
      }}>
        {(title || onClose) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
            {title && (
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: '#FFD700' }}>
                {title}
              </span>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#8B6914', cursor: 'pointer', fontSize: 20, lineHeight: 1, marginLeft: 'auto' }}
            >×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
