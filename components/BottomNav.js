'use client'

import { useApp } from '../lib/context'

const T = {
  dark:  { bg: '#0c0b09', border: '#1e1e1a', text3: '#6a5a3a', text2: '#c8b89a', gold: '#c9a84c', green: '#3aaa6a', active: 'rgba(201,168,76,.08)' },
  light: { bg: '#f0ebe0', border: '#ddd8cc', text3: '#8a7a5a', text2: '#3a2a10', gold: '#9a7228', green: '#2a8a52', active: 'rgba(154,114,40,.07)' },
}

function Icon({ d, color, size = 22, strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export default function BottomNav({ onMenuOpen }) {
  const { theme, activeNav, setActiveNav, canSee } = useApp()
  const t = T[theme] || T.dark

  const isHome  = activeNav === 'dashboard'
  const isLive  = activeNav === 'purchase-data'
  const showLive = canSee('purchase-data')

  const Cell = ({ active, onClick, icon, label, dotPing }) => (
    <button onClick={onClick} style={{
      flex: 1, background: active ? t.active : 'transparent',
      border: 'none', borderTop: active ? `2px solid ${t.gold}` : '2px solid transparent',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 4, cursor: 'pointer', padding: '8px 4px 10px',
      transition: 'background .15s',
    }}>
      {dotPing ? (
        <span style={{ position: 'relative', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {active && <span style={{ position: 'absolute', width: 11, height: 11, borderRadius: '50%', background: t.green, animation: 'ping 1.5s ease-in-out infinite', opacity: .6 }} />}
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: active ? t.green : t.text3, position: 'relative', zIndex: 1, boxShadow: active ? `0 0 8px ${t.green}` : 'none' }} />
        </span>
      ) : icon}
      <span style={{ fontSize: '.55rem', color: active ? t.gold : t.text3, fontWeight: active ? 700 : 500, letterSpacing: '.07em', textTransform: 'uppercase', lineHeight: 1 }}>{label}</span>
    </button>
  )

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: 64, background: t.bg,
      borderTop: `1px solid ${t.border}`,
      display: 'flex', alignItems: 'stretch',
      zIndex: 60,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <Cell active={isHome} onClick={() => setActiveNav('dashboard')}
        icon={<Icon d="M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H10v7H6a2 2 0 01-2-2V9z" color={isHome ? t.gold : t.text3} strokeWidth={isHome ? 2 : 1.6} />}
        label="Home" />

      {showLive && (
        <Cell active={isLive} onClick={() => setActiveNav('purchase-data')}
          dotPing label="Live" />
      )}

      <Cell active={false} onClick={onMenuOpen}
        icon={<Icon d="M3 6h6M3 12h12M3 18h18M15 6h6M21 12h-3" color={t.text3} strokeWidth={1.6} />}
        label="Modules" />

      <style>{`@keyframes ping { 75%,100%{transform:scale(2.2);opacity:0} }`}</style>
    </div>
  )
}
