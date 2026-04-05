'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/context'
import Toast from './ui/Toast'

const THEMES = {
  dark: {
    bg: '#0f0f0d', border: '#1e1e1a', text1: '#f0e6c8', text2: '#c8b89a',
    text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', goldBg: 'rgba(201,168,76,0.1)',
    goldBorder: 'rgba(201,168,76,0.25)', red: '#e05555', green: '#3aaa6a',
    pillBg: 'rgba(255,255,255,0.04)', pillHov: 'rgba(255,255,255,0.07)',
    avatarBg: 'linear-gradient(135deg, #c9a84c 0%, #7a4a10 100%)',
    syncBg: 'rgba(201,168,76,0.08)', syncBorder: 'rgba(201,168,76,0.2)',
    syncHov: 'rgba(201,168,76,0.15)',
  },
  light: {
    bg: '#faf7f2', border: '#ddd8cc', text1: '#1a1208', text2: '#4a3a1a',
    text3: '#8a7a5a', text4: '#b0a080', gold: '#9a7228', goldBg: 'rgba(154,114,40,0.08)',
    goldBorder: 'rgba(154,114,40,0.22)', red: '#c03030', green: '#1e7a4a',
    pillBg: 'rgba(0,0,0,0.03)', pillHov: 'rgba(0,0,0,0.06)',
    avatarBg: 'linear-gradient(135deg, #b8882e 0%, #7a4a10 100%)',
    syncBg: 'rgba(154,114,40,0.07)', syncBorder: 'rgba(154,114,40,0.2)',
    syncHov: 'rgba(154,114,40,0.14)',
  },
}

const PAGE_TITLES = {
  'dashboard':           'Dashboard',
  'purchase-data':       'Purchase Data',
  'purchase-reports':    'Purchase Reports',
  'consignment-data':    'Consignment Data',
  'consignment-report':  'Consignment Report',
  'consignment-summary': 'Movement Report',
  'melting':             'Melting',
  'sales':               'Sales',
  'cal-table':           'Cal Table',
  'live-market-rates':   'Live Market Rates',
  'reports':             'Reports',
  'branch-management':   'Branch Management',
  'branch-employees':    'Branch Employees',
  'user-management':     'User Management',
  'company-settings':    'Company Settings',
  'consignment-seeds':   'Consignment Seeds',
  'import-logs':         'Import Logs',
  'inbound-bot':         'Inbound Bot Testing',
}

const SECTION_LABELS = {
  'dashboard':           null,
  'purchase-data':       'Purchases',
  'purchase-reports':    'Purchases',
  'consignment-data':    'Consignments',
  'consignment-report':  'Consignments',
  'consignment-summary': 'Consignments',
  'cal-table':           'Sales',
  'live-market-rates':   'Sales',
  'inbound-bot':         'Telesales',
  'branch-management':   'Admin',
  'branch-employees':    'Admin',
  'user-management':     'Admin',
  'company-settings':    'Admin',
  'consignment-seeds':   'Admin',
  'import-logs':         'Admin',
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────
function ThemeToggle({ theme, setTheme, t }) {
  const [spinning, setSpinning] = useState(false)

  const toggle = () => {
    setSpinning(true)
    setTimeout(() => {
      setTheme(theme === 'dark' ? 'light' : 'dark')
      setSpinning(false)
    }, 200)
  }

  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      style={{
        width: '36px', height: '36px',
        borderRadius: '10px',
        border: `1px solid ${t.border}`,
        background: t.pillBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', position: 'relative', overflow: 'hidden',
        transition: 'all .18s ease', flexShrink: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = t.pillHov; e.currentTarget.style.borderColor = t.goldBorder }}
      onMouseLeave={e => { e.currentTarget.style.background = t.pillBg; e.currentTarget.style.borderColor = t.border }}
    >
      <span style={{
        fontSize: '14px',
        display: 'block',
        transform: spinning ? 'rotate(180deg) scale(0.7)' : 'rotate(0deg) scale(1)',
        transition: 'transform 0.2s ease',
        lineHeight: 1,
      }}>
        {isDark ? '☀' : '☾'}
      </span>
    </button>
  )
}

// ─── Sync Button ──────────────────────────────────────────────────────────────
function SyncButton({ syncing, onSync, t }) {
  return (
    <button
      onClick={onSync}
      disabled={syncing}
      style={{
        height: '36px',
        padding: '0 16px',
        borderRadius: '10px',
        border: `1px solid ${t.syncBorder}`,
        background: t.syncBg,
        color: t.gold,
        fontSize: '.7rem',
        fontWeight: 600,
        letterSpacing: '.05em',
        display: 'flex', alignItems: 'center', gap: '7px',
        cursor: syncing ? 'not-allowed' : 'pointer',
        opacity: syncing ? 0.7 : 1,
        transition: 'all .18s ease',
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (!syncing) e.currentTarget.style.background = t.syncHov }}
      onMouseLeave={e => { e.currentTarget.style.background = t.syncBg }}
    >
      <span style={{
        display: 'inline-block',
        animation: syncing ? 'spin 0.9s linear infinite' : 'none',
        fontSize: '13px', lineHeight: 1,
      }}>⟳</span>
      <span>{syncing ? 'Syncing…' : 'Sync CRM'}</span>
    </button>
  )
}

// ─── Main Topbar ──────────────────────────────────────────────────────────────
export default function Topbar() {
  const { theme, setTheme, activeNav, user, role } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const router = useRouter()

  const [syncing, setSyncing] = useState(false)
  const [toast,   setToast]   = useState(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res  = await fetch('/api/sync-purchases', { method: 'POST' })
      const data = await res.json()
      if (data.success) setToast({ msg: `${data.synced} records synced`, type: 'success' })
      else              setToast({ msg: data.error || 'Sync failed', type: 'error' })
    } catch {
      setToast({ msg: 'Network error', type: 'error' })
    } finally {
      setSyncing(false)
    }
  }

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return
    const handler = () => setUserMenuOpen(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [userMenuOpen])

  const initial   = user?.email?.[0]?.toUpperCase() ?? '?'
  const pageTitle = PAGE_TITLES[activeNav] ?? 'GoldApp'
  const section   = SECTION_LABELS[activeNav]
  const canSync   = role === 'super_admin' || role === 'founders_office'

  return (
    <header style={{
      height: '56px',
      background: t.bg,
      borderBottom: `1px solid ${t.border}`,
      display: 'flex', alignItems: 'center',
      padding: '0 20px 0 24px',
      gap: '10px', flexShrink: 0,
      position: 'relative', zIndex: 40,
    }}>

      {/* ── Breadcrumb ── */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <span style={{ fontSize: '.65rem', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 500, flexShrink: 0 }}>
          White Gold
        </span>
        {section && (
          <>
            <span style={{ color: t.text4, fontSize: '.65rem', flexShrink: 0 }}>/</span>
            <span style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 500, flexShrink: 0 }}>{section}</span>
          </>
        )}
        <span style={{ color: t.text4, fontSize: '.65rem', flexShrink: 0 }}>/</span>
        <span style={{ fontSize: '.8rem', color: t.text1, fontWeight: 600, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pageTitle}
        </span>
      </div>

      {/* ── Right actions ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>

        {/* Sync CRM */}
        {canSync && <SyncButton syncing={syncing} onSync={handleSync} t={t} />}

        {/* Divider */}
        {canSync && <div style={{ width: '1px', height: '22px', background: t.border, flexShrink: 0 }} />}

        {/* Theme toggle */}
        <ThemeToggle theme={theme} setTheme={setTheme} t={t} />

        {/* Divider */}
        <div style={{ width: '1px', height: '22px', background: t.border, flexShrink: 0 }} />

        {/* User pill */}
        <div
          style={{ position: 'relative' }}
          onClick={e => { e.stopPropagation(); setUserMenuOpen(o => !o) }}
        >
          <div style={{
            height: '36px',
            padding: '0 12px 0 6px',
            borderRadius: '10px',
            border: `1px solid ${t.border}`,
            background: t.pillBg,
            display: 'flex', alignItems: 'center', gap: '8px',
            cursor: 'pointer',
            transition: 'all .18s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = t.pillHov; e.currentTarget.style.borderColor = t.goldBorder }}
            onMouseLeave={e => { e.currentTarget.style.background = t.pillBg; e.currentTarget.style.borderColor = t.border }}
          >
            {/* Avatar */}
            <div style={{
              width: '26px', height: '26px', borderRadius: '7px',
              background: t.avatarBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '.65rem', fontWeight: 700, color: '#fff', flexShrink: 0,
              letterSpacing: '.02em',
            }}>
              {initial}
            </div>
            {/* Email (truncated) */}
            <span style={{
              fontSize: '.7rem', color: t.text2, fontWeight: 500,
              maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              letterSpacing: '-.01em',
            }}>
              {user?.email?.split('@')[0]}
            </span>
            {/* Chevron */}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={t.text4} strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .18s', flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>

          {/* Dropdown menu */}
          {userMenuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              minWidth: '200px',
              background: t.bg,
              border: `1px solid ${t.border}`,
              borderRadius: '12px',
              boxShadow: theme === 'dark'
                ? '0 8px 32px rgba(0,0,0,.7), 0 2px 8px rgba(0,0,0,.5)'
                : '0 8px 32px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.08)',
              overflow: 'hidden',
              animation: 'fadeSlideDown 0.16s ease both',
              zIndex: 100,
            }}>
              {/* User info */}
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ fontSize: '.72rem', color: t.text1, fontWeight: 600, marginBottom: '2px' }}>
                  {user?.email?.split('@')[0]}
                </div>
                <div style={{ fontSize: '.65rem', color: t.text3 }}>{user?.email}</div>
              </div>
              {/* Sign out */}
              <div style={{ padding: '6px' }}>
                <button onClick={signOut} style={{
                  width: '100%', textAlign: 'left',
                  padding: '9px 12px', borderRadius: '8px',
                  border: 'none', background: 'transparent',
                  color: t.red, fontSize: '.72rem', fontWeight: 500,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                  transition: 'background .15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = `${t.red}12`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.red} strokeWidth="2" strokeLinecap="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </header>
  )
}
