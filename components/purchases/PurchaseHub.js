'use client'

import { useState } from 'react'
import { useApp } from '../../lib/context'
import LiveFeed              from './LiveFeed'
import PurchaseData          from './PurchaseData'
import WalkinPipeline        from './WalkinPipeline'
import PendingBills          from './PendingBills'
import RejectedBills         from './RejectedBills'
import BlacklistedCustomers  from './BlacklistedCustomers'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const TABS = [
  { id: 'live',        label: 'Live Feed',    icon: '●', accentFn: t => t.green  },
  { id: 'approved',    label: 'Purchase Data',icon: '✓', accentFn: t => t.gold   },
  { id: 'walkin',      label: 'Walk-in',      icon: '→', accentFn: t => t.blue   },
  { id: 'pending',     label: 'Pending',      icon: '⏳',accentFn: t => t.orange },
  { id: 'rejected',    label: 'Rejected',     icon: '✕', accentFn: t => t.red    },
  { id: 'blacklisted', label: 'Blacklisted',  icon: '⊘', accentFn: t => t.red    },
]

export default function PurchaseHub() {
  const { theme, canSee } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [activeTab, setActiveTab] = useState('live')

  const visibleTabs = TABS.filter(tab => canSee(`tab.purchase-data.${tab.id}`))
  // If active tab was hidden by permissions change, fall back to first visible
  const active = visibleTabs.some(t => t.id === activeTab) ? activeTab : (visibleTabs[0]?.id ?? 'live')

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* TAB BAR */}
      <div style={{
        background: t.card, borderBottom: `1px solid ${t.border}`,
        padding: '0 16px', display: 'flex', overflowX: 'auto',
        position: 'sticky', top: 0, zIndex: 50,
        scrollbarWidth: 'none',
      }}>
        {visibleTabs.map(tab => {
          const accent  = tab.accentFn(t)
          const isActive = active === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              background: 'transparent', border: 'none',
              borderBottom: isActive ? `2px solid ${accent}` : '2px solid transparent',
              padding: '14px 14px', cursor: 'pointer',
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
      <div className="hub-content" style={{ padding: '24px 24px' }}>
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
