'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'
import PurchaseReports      from './reports/PurchaseReports'
import PurchaseIntelligence from './intelligence/PurchaseIntelligence'
import ReportScheduler      from './reports/ReportScheduler'

const SCHEDULE_ROLES = ['super_admin', 'founders_office', 'admin', 'accounts']

const THEMES = {
  dark:  { card: '#111111', text1: '#f0e6c8', text3: '#9a8a6a', gold: '#c9a84c', border: '#1e1e1e', purple: '#8c5ac8', blue: '#3a8fbf' },
  light: { card: '#faf7f2', text1: '#1a1208', text3: '#7a6a4a', gold: '#9a7228', border: '#e0dace', purple: '#6a3a9a', blue: '#2a6a9a' },
}

const TABS = [
  { id: 'analytics',    label: 'Analytics',    icon: '↗', desc: 'Charts, trends, branch performance' },
  { id: 'intelligence', label: 'Intelligence', icon: '◈', desc: 'Branch health, repeat customers, alerts' },
  { id: 'scheduled',    label: 'Email Reports', icon: '✉', desc: 'Auto-email reports to Finance' },
]

export default function ReportsHub() {
  const { theme, canSee, role } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [activeTab, setActiveTab] = useState('analytics')
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const visibleTabs = TABS.filter(tab => {
    // The scheduler is an admin/accounts config surface — gate by role, not the
    // generic per-tab permission key (which defaults to unrestricted).
    if (tab.id === 'scheduled') return SCHEDULE_ROLES.includes(role)
    return canSee(`tab.purchase-reports.${tab.id}`)
  })
  const active = visibleTabs.some(t => t.id === activeTab) ? activeTab : (visibleTabs[0]?.id ?? 'analytics')

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* TAB BAR */}
      <div style={{
        background: t.card, borderBottom: `1px solid ${t.border}`,
        padding: isMobile ? '0 8px' : '0 32px', display: 'flex', overflowX: 'auto',
        scrollbarWidth: 'none', position: 'sticky', top: 0, zIndex: 50,
      }}>
        {visibleTabs.map(tab => {
          const isActive = active === tab.id
          const accent = tab.id === 'intelligence' ? t.purple : tab.id === 'scheduled' ? t.blue : t.gold
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              background: 'transparent', border: 'none',
              borderBottom: isActive ? `2px solid ${accent}` : '2px solid transparent',
              padding: isMobile ? '12px 14px' : '14px 24px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
              color: isActive ? accent : t.text3,
              transition: 'all .15s', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '.75rem' }}>{tab.icon}</span>
                <span style={{ fontSize: '.72rem', fontWeight: isActive ? 500 : 400, letterSpacing: '.03em' }}>{tab.label}</span>
              </div>
              {!isMobile && <span style={{ fontSize: '.58rem', color: t.text3, opacity: .7 }}>{tab.desc}</span>}
            </button>
          )
        })}
      </div>

      {/* No extra padding — child components handle their own layout */}
      {active === 'analytics'    && <PurchaseReports />}
      {active === 'intelligence' && <PurchaseIntelligence />}
      {active === 'scheduled'    && <ReportScheduler />}
    </div>
  )
}
