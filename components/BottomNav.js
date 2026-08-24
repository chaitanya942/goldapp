'use client'

import { useApp } from '../lib/context'

const T = {
  dark:  { bg: '#0c0b09', border: '#1e1e1a', text3: '#6a5a3a', text2: '#c8b89a', gold: '#c9a84c', green: '#3aaa6a', active: 'rgba(201,168,76,.08)' },
  light: { bg: '#f0ebe0', border: '#ddd8cc', text3: '#8a7a5a', text2: '#3a2a10', gold: '#9a7228', green: '#2a8a52', active: 'rgba(154,114,40,.07)' },
}

// Simple 24×24 stroke icons (single `d`, multiple sub-paths where needed).
const ICONS = {
  home:       'M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H10v7H6a2 2 0 01-2-2V9z',
  purchases:  'M3 3v18h18M7 14l3-3 3 3 4-5',
  operations: 'M12 2l9 5v10l-9 5-9-5V7zM3.3 7L12 12l8.7-5M12 12v10',
  bidding:    'M3 21h18M6 21V10M18 21V10M4 10h16l-8-6-8 6zM10 13v5M14 13v5',
  finance:    'M12 3v18M5 8h14M5 8l-3 6h6zM19 8l-3 6h6zM8 21h8',
  melting:    'M12 2C9 6 8 8 8 12a4 4 0 008 0c0-2.2-1-3.5-1-3.5',
  sales:      'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2.8 12.8V4H11l9.6 9.4a2 2 0 010 0zM7 7h.01',
  more:       'M4 6h16M4 12h16M4 18h16',
}

// Candidate primary tabs, in priority order. Each lands on a real, accessible
// page (canSee-gated); `match` decides when the tab shows as active. Derived,
// not hardcoded per role — a user only sees tabs they can open.
const CANDIDATES = [
  { key: 'purchases',  nav: 'purchase-data',        label: 'Purchase', icon: ICONS.purchases,  match: a => a.startsWith('purchase') && a !== 'purchase-register' },
  { key: 'operations', nav: 'consignment-overview', label: 'Ops',      icon: ICONS.operations, match: a => a.startsWith('consignment') && a !== 'consignment-bidding' },
  { key: 'bidding',    nav: 'consignment-bidding',  label: 'Bidding',  icon: ICONS.bidding,    match: a => a === 'consignment-bidding' },
  { key: 'finance',    nav: 'audit-data',           label: 'F&A',      icon: ICONS.finance,    match: a => ['audit-data', 'audit-roster', 'audit-report', 'discrepancy-cases', 'consignment-approvals', 'purchase-register', 'billed-vs-paid'].includes(a) },
  { key: 'melting',    nav: 'melting-incoming',     label: 'Melting',  icon: ICONS.melting,    match: a => a.startsWith('melting') },
  { key: 'sales',      nav: 'cal-table',            label: 'Sales',    icon: ICONS.sales,      match: a => ['cal-table', 'live-market-rates'].includes(a) },
]

function Icon({ d, color, active }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export default function BottomNav({ onMenuOpen }) {
  const { theme, activeNav, setActiveNav, canSee } = useApp()
  const t = T[theme] || T.dark

  const isHome = activeNav === 'dashboard'
  // Up to 3 permission-visible primary modules; the rest live under "More".
  const primary = CANDIDATES.filter(c => (canSee ? canSee(c.nav) : false)).slice(0, 3)
  const activeKey = isHome ? 'home' : (primary.find(c => c.match(activeNav))?.key || null)
  // Highlight "More" when the current page isn't Home or a primary tab.
  const moreActive = !isHome && !activeKey

  const Cell = ({ active, onClick, iconD, label }) => (
    <button onClick={onClick} aria-label={label} style={{
      flex: 1, minWidth: 0, background: active ? t.active : 'transparent',
      border: 'none', borderTop: active ? `2px solid ${t.gold}` : '2px solid transparent',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 4, cursor: 'pointer', padding: '8px 2px 10px',
      transition: 'background .15s',
    }}>
      <Icon d={iconD} color={active ? t.gold : t.text3} active={active} />
      <span style={{
        fontSize: '.58rem', color: active ? t.gold : t.text3, fontWeight: active ? 700 : 500,
        letterSpacing: '.04em', textTransform: 'uppercase', lineHeight: 1,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
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
      boxShadow: '0 -2px 12px rgba(0,0,0,.10)',
    }}>
      <Cell active={isHome} onClick={() => setActiveNav('dashboard')} iconD={ICONS.home} label="Home" />
      {primary.map(c => (
        <Cell key={c.key} active={activeKey === c.key} onClick={() => setActiveNav(c.nav)} iconD={c.icon} label={c.label} />
      ))}
      <Cell active={moreActive} onClick={onMenuOpen} iconD={ICONS.more} label="More" />
    </div>
  )
}
