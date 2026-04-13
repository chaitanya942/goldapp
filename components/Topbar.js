'use client'

import { useState, useEffect, useRef } from 'react'
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

// ─── View As Dropdown ────────────────────────────────────────────────────────
function ViewAsDropdown({ previewRole, setPreviewRole, t }) {
  const [open,      setOpen]      = useState(false)
  const [roles,     setRoles]     = useState([])
  const [switching, setSwitching] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    fetch('/api/rbac?action=roles').then(r => r.json()).then(d => {
      if (d.roles) setRoles(d.roles.filter(r => r.name !== 'super_admin'))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = async (roleName) => {
    setOpen(false)
    setSwitching(true)
    await setPreviewRole(roleName)
    setSwitching(false)
  }

  const handleExit = async () => {
    setSwitching(true)
    await setPreviewRole(null)
    setSwitching(false)
  }

  const activeRole = roles.find(r => r.name === previewRole)
  const color = activeRole?.color || '#c9a84c'

  if (previewRole || switching) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          height: 36, padding: '0 12px', borderRadius: 10,
          background: `${color}18`, border: `1px solid ${color}50`,
          display: 'flex', alignItems: 'center', gap: 8,
          animation: switching ? 'none' : 'previewPulse 2.5s ease-in-out infinite',
          opacity: switching ? 0.7 : 1, transition: 'opacity .2s',
        }}>
          {switching ? (
            <svg width="13" height="13" viewBox="0 0 32 32" style={{ animation: 'spin 0.9s linear infinite', flexShrink: 0 }}>
              <circle cx="16" cy="16" r="11" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="16 52" strokeLinecap="round"/>
            </svg>
          ) : (
            <span style={{ fontSize: 11, color }}>👁</span>
          )}
          <span style={{ fontSize: '.68rem', color, fontWeight: 600 }}>
            {switching ? 'Switching…' : (activeRole?.label || previewRole)}
          </span>
        </div>
        <button onClick={handleExit} disabled={switching} style={{
          height: 36, width: 36, borderRadius: 10, border: `1px solid ${t.border}`,
          background: t.pillBg, color: t.text3, cursor: switching ? 'not-allowed' : 'pointer',
          fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all .15s', opacity: switching ? 0.5 : 1,
        }}
          onMouseEnter={e => { if (!switching) { e.currentTarget.style.borderColor = '#e05555'; e.currentTarget.style.color = '#e05555' } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text3 }}
          title="Exit preview"
        >✕</button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        height: 36, padding: '0 13px', borderRadius: 10,
        border: `1px solid ${t.border}`, background: t.pillBg,
        display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
        transition: 'all .15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = t.pillHov; e.currentTarget.style.borderColor = t.goldBorder }}
        onMouseLeave={e => { e.currentTarget.style.background = t.pillBg; e.currentTarget.style.borderColor = t.border }}
      >
        <span style={{ fontSize: 13 }}>👁</span>
        <span style={{ fontSize: '.68rem', color: t.text3, fontWeight: 500 }}>View as</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={t.text4} strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 210,
          background: t.bg, border: `1px solid ${t.border}`, borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,.5)', overflow: 'hidden',
          animation: 'fadeSlideDown 0.14s ease both', zIndex: 100,
        }}>
          <div style={{ padding: '10px 14px 6px', fontSize: '.55rem', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
            Preview as role
          </div>
          {roles.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: '.65rem', color: t.text4 }}>Loading roles…</div>
          )}
          {roles.map(r => (
            <button key={r.name} onClick={() => handleSelect(r.name)} style={{
              width: '100%', textAlign: 'left', padding: '9px 14px',
              border: 'none', background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, transition: 'background .12s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = `${r.color || '#c9a84c'}12`}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color || '#c9a84c', flexShrink: 0 }} />
              <span style={{ fontSize: '.72rem', color: t.text2, fontWeight: 500 }}>{r.label}</span>
              {r.is_system && <span style={{ fontSize: '.48rem', color: t.text4, background: `${t.border}80`, borderRadius: 3, padding: '1px 4px', marginLeft: 'auto' }}>SYS</span>}
            </button>
          ))}
          <div style={{ height: 6 }} />
        </div>
      )}
    </div>
  )
}

// ─── Main Topbar ──────────────────────────────────────────────────────────────
export default function Topbar() {
  const { theme, setTheme, activeNav, user, role, previewRole, setPreviewRole, bumpSync } = useApp()
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
      // days=2: sync last 2 days only — fast enough for Vercel free plan (< 5s vs 18s for 7 days)
      const res  = await fetch('/api/sync-purchases?days=2', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setToast({ msg: `${data.synced} records synced`, type: 'success' })
        bumpSync?.()
      } else {
        setToast({ msg: data.error || 'Sync failed', type: 'error' })
      }
    } catch {
      setToast({ msg: 'Sync timed out — data updates automatically every 5 min', type: 'error' })
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

  const previewRoleData = previewRole ? null : null  // resolved in ViewAsDropdown

  return (
    <header style={{
      height: previewRole ? '92px' : '56px',
      background: t.bg,
      borderBottom: `1px solid ${t.border}`,
      display: 'flex', flexDirection: 'column',
      flexShrink: 0, position: 'relative', zIndex: 40,
      transition: 'height .2s ease',
    }}>

      {/* ── Main row ── */}
      <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 20px 0 24px', gap: '10px' }}>

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

        {/* View As (super_admin only) */}
        {role === 'super_admin' && <ViewAsDropdown previewRole={previewRole} setPreviewRole={setPreviewRole} t={t} />}
        {role === 'super_admin' && <div style={{ width: '1px', height: '22px', background: t.border, flexShrink: 0 }} />}

        {/* Sync CRM */}
        {canSync && !previewRole && <SyncButton syncing={syncing} onSync={handleSync} t={t} />}

        {/* Divider */}
        {canSync && !previewRole && <div style={{ width: '1px', height: '22px', background: t.border, flexShrink: 0 }} />}

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

      </div>{/* end main row */}

      {/* ── Preview mode banner ── */}
      {previewRole && (
        <div style={{
          height: 36, background: '#c9a84c18', borderTop: '1px solid #c9a84c30',
          display: 'flex', alignItems: 'center', padding: '0 24px', gap: 10,
        }}>
          <span style={{ fontSize: 12, animation: 'pglow 2s ease-in-out infinite' }}>👁</span>
          <span style={{ fontSize: '.62rem', color: '#c9a84c', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Preview Mode
          </span>
          <span style={{ fontSize: '.62rem', color: t.text4 }}>—</span>
          <span style={{ fontSize: '.68rem', color: t.text2 }}>
            You are viewing the app <strong style={{ color: '#c9a84c' }}>as it would appear for this role.</strong> No data or permissions are changed.
          </span>
          <button onClick={() => setPreviewRole(null)} style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: 6, border: '1px solid #c9a84c50',
            background: 'transparent', color: '#c9a84c', fontSize: '.62rem', fontWeight: 600, cursor: 'pointer',
          }}
            onMouseEnter={e => e.currentTarget.style.background = '#c9a84c15'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Exit Preview
          </button>
        </div>
      )}

      <style>{`
        @keyframes previewPulse { 0%,100%{opacity:.8} 50%{opacity:1} }
        @keyframes pglow { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.2)} }
      `}</style>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </header>
  )
}
