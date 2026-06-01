'use client'

import { useState, useEffect, useRef } from 'react'
import { AppProvider, useApp } from '../../lib/context'
import Clarity from '../../components/analytics/Clarity'
import HeatmapTracker from '../../components/analytics/HeatmapTracker'
import Sidebar from '../../components/Sidebar'
import Topbar from '../../components/Topbar'
import DashboardHome from '../../components/dashboard/DashboardHome'
import BranchManagement from '../../components/admin/BranchManagement'
import UserManagement from '../../components/admin/UserManagement'
import CompanySettings from '../../components/admin/CompanySettings'
import GoldBuyingRate from '../../components/admin/GoldBuyingRate'
import ConsignmentSeeds from '../../components/admin/ConsignmentSeeds'
import Logistics from '../../components/admin/Logistics'
import BranchEmployees from '../../components/admin/BranchEmployees'
import ImportLogs from '../../components/admin/ImportLogs'
import RoleManagement from '../../components/admin/RoleManagement'
import HeatmapInsights from '../../components/admin/HeatmapInsights'
import DynamicDashboard from '../../components/dashboard/DynamicDashboard'
import PurchaseHub   from '../../components/purchases/PurchaseHub'
import LiveFeed      from '../../components/purchases/LiveFeed'
import PurchaseData  from '../../components/purchases/PurchaseData'
import BottomNav from '../../components/BottomNav'
import MobileMenu from '../../components/MobileMenu'
import ReportsHub    from '../../components/purchases/ReportsHub'
import ConsignmentOverview from '../../components/consignments/ConsignmentOverview'
import ConsignmentData from '../../components/consignments/ConsignmentData'
import ConsignmentReport from '../../components/consignments/ConsignmentReport'
import BiddingVolume from '../../components/consignments/BiddingVolume'
import CollectionAudit from '../../components/consignments/CollectionAudit'
import AuditRoster from '../../components/consignments/AuditRoster'
import AuditReport from '../../components/consignments/AuditReport'
import ConsignmentAnalytics from '../../components/consignments/ConsignmentAnalytics'
import ConsignmentApprovals from '../../components/consignments/ConsignmentApprovals'
import EodStockReport from '../../components/consignments/EodStockReport'
import AtRiskBookingsBanner from '../../components/bidding/AtRiskBookingsBanner'
import CalTable from '../../components/sales/CalTable'
import LiveMarketRates from '../../components/sales/LiveMarketRates'
import InboundBotTesting from '../../components/telesales/InboundBotTesting'
import TelesalesDashboard from '../../components/telesales/TelesalesDashboard'
import DialogHost from '../../components/ui/ConfirmDialog'
import AuditAccessGuard from '../../components/AuditAccessGuard'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', red: '#e05555' },
  light: { bg: '#f5f0e8', card: '#faf7f2', text1: '#1a1208', text2: '#3a2a10', text3: '#6a5a3a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', red: '#c03030' },
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
  const { theme, activeNav, setActiveNav, role, canSee, profileLoaded, previewRole, mobileMenuOpen, setMobileMenuOpen, mobileMenuInitialModule, setMobileMenuInitialModule, openMobileMenuWithModule } = useApp()
  const t = THEMES[theme]
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (mobile) setSidebarOpen(false)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Expose current nav to the heatmap tracker so each module shows as a separate "page"
  // in the Heatmap Viewer (otherwise everything is just /dashboard).
  useEffect(() => {
    if (typeof window !== 'undefined') window.__APP_NAV = activeNav
  }, [activeNav])

  useEffect(() => {
    if (role && activeNav !== 'dashboard' && !canSee(activeNav)) {
      setActiveNav('dashboard')
    }
  }, [role, activeNav, previewRole])

  // ── Back-button / swipe-back interception ──────────────────────────────────
  // The app navigates between modules via the activeNav state, not URL changes,
  // so the browser back button used to close the tab/app entirely. That was
  // disorienting on mobile especially (swipe back = app gone). New behaviour:
  //
  //   1. Inside any module → back returns to the dashboard.
  //   2. On dashboard, first back arms a 2.5s "press back again to exit" toast.
  //   3. Second back within the window genuinely exits (to login/previous page).
  //
  // Mechanism: push a sentinel history entry on mount so the first back lands
  // here instead of leaving the app. The popstate handler reads the latest
  // activeNav (via a ref to avoid stale closures), takes the appropriate
  // action, and re-pushes the sentinel so subsequent back presses behave the
  // same — except in the armed-exit case where we let it through.
  const activeNavRef = useRef(activeNav)
  useEffect(() => { activeNavRef.current = activeNav }, [activeNav])
  const exitArmedRef = useRef(false)
  const exitTimerRef = useRef(null)
  const [exitPrompt, setExitPrompt] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Sentinel: a no-op history entry so the first back press lands in our
    // handler instead of leaving the page. We tag it via state so we know it
    // came from us if we ever need to disambiguate.
    const pushSentinel = () => window.history.pushState({ __goldNavSentinel: true }, '', window.location.href)
    pushSentinel()

    const handlePop = () => {
      if (activeNavRef.current !== 'dashboard') {
        // Inside a module → back means "return to dashboard". Consume the back
        // press by re-pushing the sentinel so the user stays in the app.
        setActiveNav('dashboard')
        pushSentinel()
        return
      }

      if (exitArmedRef.current) {
        // Confirmed exit — let the browser take them out. We don't re-push
        // the sentinel; calling history.back() walks past /dashboard to
        // whatever the user came from (typically /login).
        exitArmedRef.current = false
        if (exitTimerRef.current) { clearTimeout(exitTimerRef.current); exitTimerRef.current = null }
        window.history.back()
        return
      }

      // First back on dashboard → arm the exit and surface the toast. Re-push
      // the sentinel so the next back press triggers popstate again.
      exitArmedRef.current = true
      setExitPrompt(true)
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      exitTimerRef.current = setTimeout(() => {
        exitArmedRef.current = false
        setExitPrompt(false)
        exitTimerRef.current = null
      }, 2500)
      pushSentinel()
    }

    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!profileLoaded) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg }}>
      <svg width="36" height="36" viewBox="0 0 32 32" style={{ animation: 'spin 1s linear infinite' }}>
        <circle cx="16" cy="16" r="12" fill="none" stroke="rgba(201,168,76,0.15)" strokeWidth="2" />
        <circle cx="16" cy="16" r="12" fill="none" stroke="#C9A84C" strokeWidth="2"
          strokeDasharray="20 56" strokeLinecap="round" />
      </svg>
    </div>
  )

  const renderPage = () => {
    if (activeNav !== 'dashboard' && !canSee(activeNav)) return <AccessDenied />
    switch (activeNav) {
      case 'dashboard': {
        // Super admin's own session → full DashboardHome (unrestricted overview)
        if (role === 'super_admin' && !previewRole) return <DashboardHome />

        const hasPurchase  = canSee('purchase-live') || canSee('purchase-data') || canSee('purchase-reports')
        const hasTelesales = canSee('inbound-bot')

        // Telesales-only → dedicated rich dashboard (charts, filters, call log)
        if (hasTelesales && !hasPurchase) return <TelesalesDashboard />

        // Everyone else → element-driven DynamicDashboard:
        // each section renders only the widgets their element-level permissions allow
        return <DynamicDashboard />
      }
      // Purchase module split into 3 sub-modules. PurchaseHub (the old
      // Live-Feed + Purchase-Data tab wrapper) is retired but kept in the
      // tree — see components/purchases/PurchaseHub.js.
      case 'purchase-live':     return <LiveFeed />
      case 'purchase-data':     return <PurchaseData />
      case 'purchase-reports':  return <ReportsHub />
      case 'consignment-overview': return <ConsignmentOverview />
      case 'consignment-data':       return <ConsignmentData />
      case 'consignment-approvals':  return <ConsignmentApprovals />
      case 'consignment-report':     return <ConsignmentReport />
      case 'consignment-summary':    return <ConsignmentReport />
      case 'consignment-bidding':    return <BiddingVolume />
      case 'eod-stock-report':       return <EodStockReport />
      case 'audit-data':              return <CollectionAudit />
      case 'audit-roster':            return <AuditRoster />
      case 'audit-report':            return <AuditReport />
      case 'consignment-analytics':  return <ConsignmentAnalytics />
      case 'melting':             return <ComingSoon title="Melting" />
      case 'sales':               return <ComingSoon title="Sales" />
      case 'cal-table':           return <CalTable />
      case 'live-market-rates':   return <LiveMarketRates />
      case 'reports':             return <ComingSoon title="Reports" />
      case 'branch-management':   return <BranchManagement />
      case 'user-management':     return <UserManagement />
      case 'company-settings':    return <CompanySettings />
      case 'gold-buying-rate':    return <GoldBuyingRate />
      case 'consignment-seeds':   return <ConsignmentSeeds />
      case 'logistics':           return <Logistics />
      case 'branch-employees':    return <BranchEmployees />
      case 'import-logs':         return <ImportLogs />
      case 'role-management':     return role === 'super_admin' ? <RoleManagement /> : <AccessDenied />
      case 'inbound-bot':         return <InboundBotTesting />
      case 'heatmap-insights':    return ['super_admin', 'founders_office', 'admin'].includes(role) ? <HeatmapInsights /> : <AccessDenied />
      default:                    return <DashboardHome />
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: t.bg, overflow: 'hidden' }}>
      {/* Sidebar — desktop only */}
      {!isMobile && <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} isMobile={false} />}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <Topbar onMenuToggle={() => setSidebarOpen(o => !o)} isMobile={isMobile} />
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'clip', paddingBottom: isMobile ? 60 : 0 }}>
          <AtRiskBookingsBanner />
          <div key={activeNav} className="page-enter">{renderPage()}</div>
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      {isMobile && <BottomNav onMenuOpen={() => openMobileMenuWithModule()} />}
      {isMobile && mobileMenuOpen && <MobileMenu initialModuleId={mobileMenuInitialModule} onClose={() => { setMobileMenuOpen(false); setMobileMenuInitialModule(null) }} />}

      {/* Global themed dialog host — replaces native window.confirm() / window.prompt() */}
      <DialogHost />

      {/* Audit-shift time gate — only active for role='audit' users. Other
          roles render nothing from this component. Mounted at dashboard root
          so it covers every module. */}
      <AuditAccessGuard role={role} />

      {/* Exit-confirmation toast — surfaces when the user presses back on the
          dashboard. A second back press within 2.5s actually exits. Sits
          above the bottom nav on mobile so it's visible. */}
      {exitPrompt && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: isMobile ? 76 : 24,
            zIndex: 10000,
            background: theme === 'dark' ? 'rgba(20,20,20,.96)' : 'rgba(36,28,16,.96)',
            color: '#f0e6c8',
            border: `1px solid ${t.gold}40`,
            borderRadius: 999,
            padding: '10px 18px',
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: '.02em',
            boxShadow: '0 8px 24px rgba(0,0,0,.35)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            animation: 'goldExitPromptIn .22s cubic-bezier(.34,1.2,.64,1)',
          }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.gold, animation: 'pulse 1.4s infinite' }} />
          Press back again to exit
        </div>
      )}
      <style>{`
        @keyframes goldExitPromptIn {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <AppProvider>
      <Clarity />
      <HeatmapTracker />
      <DashboardShell />
    </AppProvider>
  )
}