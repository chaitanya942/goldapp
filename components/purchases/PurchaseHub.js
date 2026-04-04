'use client'

import { useState } from 'react'
import { useApp } from '../../lib/context'
import LiveFeed              from './LiveFeed'
import PurchaseData          from './PurchaseData'
import WalkinPipeline        from './WalkinPipeline'
import PendingBills          from './PendingBills'
import RejectedBills         from './RejectedBills'
import BlacklistedCustomers  from './BlacklistedCustomers'

const THEMES = {
  dark:  { card: '#111111', text1: '#f0e6c8', text3: '#9a8a6a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555', orange: '#c9981f', blue: '#3a8fbf' },
  light: { card: '#e8e2d6', text1: '#1a1208', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', green: '#2a8a5a', red: '#c03030', orange: '#a07010', blue: '#2a6a9a' },
}

const TABS = [
  { id: 'live',        label: 'Live Feed',    icon: '●', accentFn: t => t.green  },
  { id: 'approved',    label: 'Purchase Data',icon: '✓', accentFn: t => t.gold   },
  { id: 'walkin',      label: 'Walk-in',      icon: '→', accentFn: t => t.blue   },
  { id: 'pending',     label: 'Pending',      icon: '⏳',accentFn: t => t.orange },
  { id: 'rejected',    label: 'Rejected',     icon: '✕', accentFn: t => t.red    },
  { id: 'blacklisted', label: 'Blacklisted',  icon: '⊘', accentFn: t => t.red    },
]

export default function PurchaseHub() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [active, setActive] = useState('live')

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* TAB BAR */}
      <div style={{
        background: t.card, borderBottom: `1px solid ${t.border}`,
        padding: '0 32px', display: 'flex', overflowX: 'auto',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        {TABS.map(tab => {
          const accent  = tab.accentFn(t)
          const isActive = active === tab.id
          return (
            <button key={tab.id} onClick={() => setActive(tab.id)} style={{
              background: 'transparent', border: 'none',
              borderBottom: isActive ? `2px solid ${accent}` : '2px solid transparent',
              padding: '14px 20px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '7px',
              color: isActive ? accent : t.text3,
              fontSize: '.72rem', fontWeight: isActive ? 500 : 400,
              letterSpacing: '.03em', transition: 'all .15s',
              whiteSpace: 'nowrap',
            }}>
              {/* Pulse animation for Live tab */}
              {tab.id === 'live' ? (
                <span style={{ position: 'relative', display: 'inline-flex', width: '8px', height: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: accent, display: 'block', position: 'absolute' }} />
                  {isActive && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: accent, display: 'block', position: 'absolute', animation: 'ping 1.5s ease-in-out infinite', opacity: .7 }} />}
                </span>
              ) : (
                <span style={{ fontSize: '.75rem' }}>{tab.icon}</span>
              )}
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* CONTENT */}
      <div style={{ padding: '28px 32px' }}>
        {active === 'live'        && <LiveFeed />}
        {active === 'approved'    && <PurchaseData />}
        {active === 'walkin'      && <WalkinPipeline />}
        {active === 'pending'     && <PendingBills />}
        {active === 'rejected'    && <RejectedBills />}
        {active === 'blacklisted' && <BlacklistedCustomers />}
      </div>

      <style>{`@keyframes ping { 75%,100%{transform:scale(2);opacity:0} }`}</style>
    </div>
  )
}
