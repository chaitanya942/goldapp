'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { AppProvider, useApp } from '../../lib/context'
import Sidebar from '../../components/Sidebar'
import Topbar from '../../components/Topbar'
import DashboardHome from '../../components/dashboard/DashboardHome'
import BranchManagement from '../../components/admin/BranchManagement'
import UserManagement from '../../components/admin/UserManagement'
import CompanySettings from '../../components/admin/CompanySettings'
import ConsignmentSeeds from '../../components/admin/ConsignmentSeeds'
import ImportLogs from '../../components/admin/ImportLogs'
import PurchaseData from '../../components/purchases/PurchaseData'
import PurchaseReports from '../../components/purchases/reports/PurchaseReports'
import ConsignmentData from '../../components/consignments/ConsignmentData'
import ConsignmentReport from '../../components/consignments/ConsignmentReport'
import ConsignmentSummary from '../../components/consignments/ConsignmentSummary'
import CalTable from '../../components/sales/CalTable'
import LiveMarketRates from '../../components/sales/LiveMarketRates'
import InboundBotTesting from '../../components/telesales/InboundBotTesting'

const THEMES = {
  dark:  { bg: '#0e0e0e', card: '#111111', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#2a2a2a', red: '#e05555' },
  light: { bg: '#f5f0e8', card: '#e8e2d6', text1: '#2a1f0a', text2: '#5a4a2a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d5cfc0', red: '#cc3333' },
}

function ComingSoon({ title }) {
  const { theme } = useApp()
  const t = THEMES[theme]
  return (
    <div style={{ padding: '48px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', color: t.text3, marginBottom: '8px' }}>◈</div>
      <div style={{ fontSize: '.88rem', color: t.text1, marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '.72rem', color: t.text3 }}>Coming in a future phase</div>
    </div>
  )
}

function AccessDenied() {
  const { theme, role, setActiveNav } = useApp()
  const t = THEMES[theme]
  return (
    <div style={{ padding: '80px 48px', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '16px', opacity: .2 }}>⊘</div>
      <div style={{ fontSize: '1rem', color: t.text1, marginBottom: '8px', fontWeight: 500 }}>Access Restricted</div>
      <div style={{ fontSize: '.75rem', color: t.text3, marginBottom: '24px', lineHeight: 1.8 }}>
        Your role <span style={{ color: t.gold, fontWeight: 500 }}>{ROLE_LABELS[role]?.label || role}</span> does not have access to this section.
        <br />Contact your administrator to request access.
      </div>
      <button onClick={() => setActiveNav('dashboard')} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 24px', color: t.text2, fontSize: '.75rem', cursor: 'pointer' }}>← Back to Dashboard</button>
    </div>
  )
}

const ROLE_LABELS = {
  super_admin:     { label: 'Super Admin',      color: '#c9a84c' },
  founders_office: { label: "Founder's Office", color: '#8c5ac8' },
  admin:           { label: 'Admin',            color: '#3a8fbf' },
  manager:         { label: 'Manager',          color: '#3aaa6a' },
  branch_staff:    { label: 'Branch Staff',     color: '#c9981f' },
  viewer:          { label: 'View Only',        color: '#7a6a4a' },
  telesales:       { label: 'Telesales',        color: '#8c5ac8' },
}

export { ROLE_LABELS }

function DashboardShell() {
  const { theme, activeNav, setActiveNav, role, canSee } = useApp()
  const t = THEMES[theme]
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push('/')
      else setChecking(false)
    })
  }, [])

  useEffect(() => {
    if (!checking && role && activeNav !== 'dashboard' && !canSee(activeNav)) {
      setActiveNav('dashboard')
    }
  }, [role, activeNav, checking])

  if (checking) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg }}>
      <div style={{ fontSize: '.75rem', color: t.text3, letterSpacing: '.1em' }}>Loading…</div>
    </div>
  )

  const renderPage = () => {
    if (activeNav !== 'dashboard' && !canSee(activeNav)) return <AccessDenied />
    switch (activeNav) {
      case 'dashboard':           return <DashboardHome />
      case 'purchase-data':       return <PurchaseData />
      case 'purchase-reports':    return <PurchaseReports />
      case 'consignment-data':    return <ConsignmentData />
      case 'consignment-report':  return <ConsignmentReport />
      case 'consignment-summary': return <ConsignmentSummary />
      case 'melting':             return <ComingSoon title="Melting" />
      case 'sales':               return <ComingSoon title="Sales" />
      case 'cal-table':           return <CalTable />
      case 'live-market-rates':   return <LiveMarketRates />
      case 'reports':             return <ComingSoon title="Reports" />
      case 'branch-management':   return <BranchManagement />
      case 'user-management':     return <UserManagement />
      case 'company-settings':    return <CompanySettings />
      case 'consignment-seeds':   return <ConsignmentSeeds />
      case 'import-logs':         return <ImportLogs />
      case 'inbound-bot':         return <InboundBotTesting />
      default:                    return <DashboardHome />
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: t.bg, overflow: 'hidden' }}>
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar />
        <main style={{ flex: 1, overflowY: 'auto' }}>{renderPage()}</main>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <AppProvider>
      <DashboardShell />
    </AppProvider>
  )
}