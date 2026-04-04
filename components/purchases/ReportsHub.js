'use client'

import { useState } from 'react'
import { useApp } from '../../lib/context'
import PurchaseReports      from './reports/PurchaseReports'
import PurchaseIntelligence from './intelligence/PurchaseIntelligence'

const THEMES = {
  dark:  { card: '#111111', text1: '#f0e6c8', text3: '#9a8a6a', gold: '#c9a84c', border: '#1e1e1e', purple: '#8c5ac8', blue: '#3a8fbf' },
  light: { card: '#e8e2d6', text1: '#1a1208', text3: '#7a6a4a', gold: '#a07830', border: '#d0c8b8', purple: '#6a3a9a', blue: '#2a6a9a' },
}

const TABS = [
  { id: 'analytics',    label: 'Analytics',    icon: '↗', desc: 'Charts, trends, branch performance' },
  { id: 'intelligence', label: 'Intelligence', icon: '◈', desc: 'Branch health, repeat customers, alerts' },
]

export default function ReportsHub() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [active, setActive] = useState('analytics')

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* TAB BAR */}
      <div style={{
        background: t.card, borderBottom: `1px solid ${t.border}`,
        padding: '0 32px', display: 'flex', overflowX: 'auto',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        {TABS.map(tab => {
          const isActive = active === tab.id
          const accent = tab.id === 'intelligence' ? t.purple : t.gold
          return (
            <button key={tab.id} onClick={() => setActive(tab.id)} style={{
              background: 'transparent', border: 'none',
              borderBottom: isActive ? `2px solid ${accent}` : '2px solid transparent',
              padding: '14px 24px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
              color: isActive ? accent : t.text3,
              transition: 'all .15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ fontSize: '.75rem' }}>{tab.icon}</span>
                <span style={{ fontSize: '.72rem', fontWeight: isActive ? 500 : 400, letterSpacing: '.03em' }}>{tab.label}</span>
              </div>
              <span style={{ fontSize: '.58rem', color: t.text3, opacity: .7 }}>{tab.desc}</span>
            </button>
          )
        })}
      </div>

      {/* No extra padding — child components handle their own layout */}
      {active === 'analytics'    && <PurchaseReports />}
      {active === 'intelligence' && <PurchaseIntelligence />}
    </div>
  )
}
