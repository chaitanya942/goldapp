'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'
import PurchaseData        from '../../components/purchases/PurchaseData'
import RejectedBills       from '../../components/purchases/RejectedBills'
import PendingBills        from '../../components/purchases/PendingBills'
import WalkinPipeline      from '../../components/purchases/WalkinPipeline'
import BlacklistedCustomers from '../../components/purchases/BlacklistedCustomers'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', red: '#e05555', orange: '#c9981f', green: '#3aaa6a' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', red: '#c03030', orange: '#a07010', green: '#2a8a5a' },
}

const TABS = [
  { id: 'approved',     label: 'Purchase Data',        icon: '✓', desc: 'Approved bills synced from CRM',      color: null },
  { id: 'rejected',     label: 'Rejected Bills',        icon: '✕', desc: 'Bills rejected in CRM',               color: 'red' },
  { id: 'pending',      label: 'Pending Bills',         icon: '⏳', desc: 'Bills awaiting approval',            color: 'orange' },
  { id: 'walkin',       label: 'Walk-in Pipeline',      icon: '→', desc: 'Active walk-in leads from CRM',       color: null },
  { id: 'blacklisted',  label: 'Blacklisted Customers', icon: '⊘', desc: 'Flagged customers in CRM',           color: 'red' },
]

export default function PurchasesPage() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [activeTab, setActiveTab] = useState('approved')
  const [kpis, setKpis] = useState(null)

  useEffect(() => {
    fetch('/api/crm-purchases?action=kpis')
      .then(r => r.json())
      .then(d => setKpis(d))
      .catch(() => {})
  }, [])

  const getCount = id => {
    if (!kpis) return null
    const map = { rejected: kpis.rejected, pending: kpis.pending, walkin: kpis.walkin, blacklisted: kpis.blacklisted }
    return map[id] ?? null
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg }}>
      {/* TAB BAR */}
      <div style={{
        background: t.card,
        borderBottom: `1px solid ${t.border}`,
        padding: '0 32px',
        display: 'flex',
        gap: '0',
        overflowX: 'auto',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          const count    = getCount(tab.id)
          const labelColor = tab.color === 'red' ? t.red : tab.color === 'orange' ? t.orange : t.gold
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${isActive && tab.color === 'red' ? t.red : isActive && tab.color === 'orange' ? t.orange : t.gold}` : '2px solid transparent',
                padding: '16px 20px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '2px',
                minWidth: '140px',
                transition: 'all .15s',
                opacity: isActive ? 1 : 0.65,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '.75rem', color: isActive ? (tab.color === 'red' ? t.red : tab.color === 'orange' ? t.orange : t.gold) : t.text3 }}>
                  {tab.icon}
                </span>
                <span style={{
                  fontSize: '.72rem',
                  fontWeight: isActive ? 500 : 400,
                  letterSpacing: '.04em',
                  color: isActive ? (tab.color === 'red' ? t.red : tab.color === 'orange' ? t.orange : t.text1) : t.text3,
                  whiteSpace: 'nowrap',
                }}>
                  {tab.label}
                </span>
                {count !== null && (
                  <span style={{
                    fontSize: '.58rem',
                    background: isActive ? (tab.color === 'red' ? `${t.red}20` : tab.color === 'orange' ? `${t.orange}20` : `${t.gold}20`) : `${t.border}`,
                    color: isActive ? (tab.color === 'red' ? t.red : tab.color === 'orange' ? t.orange : t.gold) : t.text4,
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontWeight: 500,
                  }}>
                    {Number(count).toLocaleString('en-IN')}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.02em' }}>{tab.desc}</span>
            </button>
          )
        })}
      </div>

      {/* TAB CONTENT */}
      <div>
        {activeTab === 'approved'    && <PurchaseData />}
        {activeTab === 'rejected'    && <RejectedBills />}
        {activeTab === 'pending'     && <PendingBills />}
        {activeTab === 'walkin'      && <WalkinPipeline />}
        {activeTab === 'blacklisted' && <BlacklistedCustomers />}
      </div>
    </div>
  )
}
