'use client'

import { useApp } from '../lib/context'

const TABS = [
  {
    id: 'dashboard',
    label: 'Home',
    svgPath: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z||M9 22V12h6v10',
  },
  {
    id: 'purchase-data',
    label: 'Live',
    live: true,
    svgPath: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    id: 'purchase-reports',
    label: 'Reports',
    svgPath: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    id: 'consignment-overview',
    label: 'Stock',
    svgPath: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  },
]

const T = {
  dark:  { bg: '#0c0b09', border: '#1e1e1a', text3: '#6a5a3a', gold: '#c9a84c', green: '#3aaa6a', active: 'rgba(201,168,76,.08)' },
  light: { bg: '#f0ebe0', border: '#ddd8cc', text3: '#8a7a5a', gold: '#9a7228', green: '#2a8a52', active: 'rgba(154,114,40,.07)' },
}

function TabIcon({ paths, color, size = 20, strokeWidth = 1.5 }) {
  const parts = paths.split('||')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {parts.map((p, i) => <path key={i} d={p} />)}
    </svg>
  )
}

export default function BottomNav({ onMenuOpen }) {
  const { theme, activeNav, setActiveNav, canSee } = useApp()
  const t = T[theme] || T.dark

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: 60, background: t.bg,
      borderTop: `1px solid ${t.border}`,
      display: 'flex', alignItems: 'stretch',
      zIndex: 60,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {TABS.map(tab => {
        const isActive = activeNav === tab.id
        const color = isActive ? t.gold : t.text3

        return (
          <button key={tab.id} onClick={() => setActiveNav(tab.id)} style={{
            flex: 1, background: isActive ? t.active : 'transparent',
            border: 'none', borderTop: isActive ? `2px solid ${t.gold}` : '2px solid transparent',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 3, cursor: 'pointer', padding: '6px 4px 8px',
            transition: 'background .15s',
          }}>
            {tab.live ? (
              <span style={{ position: 'relative', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isActive && <span style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: t.green, animation: 'ping 1.5s ease-in-out infinite', opacity: .6 }} />}
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: isActive ? t.green : t.text3, display: 'block', position: 'relative', zIndex: 1, boxShadow: isActive ? `0 0 8px ${t.green}` : 'none' }} />
              </span>
            ) : (
              <TabIcon paths={tab.svgPath} color={color} strokeWidth={isActive ? 2 : 1.5} />
            )}
            <span style={{ fontSize: '.5rem', color, fontWeight: isActive ? 700 : 400, letterSpacing: '.07em', textTransform: 'uppercase', lineHeight: 1 }}>
              {tab.label}
            </span>
          </button>
        )
      })}

      {/* Menu */}
      <button onClick={onMenuOpen} style={{
        flex: 1, background: 'transparent', border: 'none', borderTop: '2px solid transparent',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 3, cursor: 'pointer', padding: '6px 4px 8px',
      }}>
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={t.text3} strokeWidth={1.5} strokeLinecap="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="14" y2="18" />
        </svg>
        <span style={{ fontSize: '.5rem', color: t.text3, fontWeight: 400, letterSpacing: '.07em', textTransform: 'uppercase', lineHeight: 1 }}>Menu</span>
      </button>

      <style>{`@keyframes ping { 75%,100%{transform:scale(2.2);opacity:0} }`}</style>
    </div>
  )
}
