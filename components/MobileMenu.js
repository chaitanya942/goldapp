'use client'

import { useApp } from '../lib/context'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'

const NAV_SECTIONS = [
  {
    label: 'Main',
    items: [
      { id: 'dashboard',            label: 'Dashboard',           icon: '⌂' },
      { id: 'purchase-data',        label: 'Purchase Data',       icon: '◈', dot: '#c9a84c' },
      { id: 'purchase-reports',     label: 'Purchase Reports',    icon: '◉', dot: '#8c5ac8' },
      { id: 'consignment-overview', label: 'Branch Stock',        icon: '◎', dot: '#3aaa6a' },
      { id: 'consignment-data',     label: 'Consignment Data',    icon: '◎', dot: '#c9a84c' },
      { id: 'consignment-report',   label: 'Consignment Report',  icon: '◎', dot: '#3a8fbf' },
      { id: 'consignment-summary',  label: 'Movement Report',     icon: '◎', dot: '#8c5ac8' },
      { id: 'cal-table',            label: 'Cal Table',           icon: '◈', dot: '#c9a84c' },
      { id: 'live-market-rates',    label: 'Live Market Rates',   icon: '◈', dot: '#3aaa6a' },
      { id: 'inbound-bot',          label: 'Inbound Bot Testing', icon: '◈', dot: '#8c5ac8' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { id: 'branch-management',  label: 'Branch Management', dot: '#8c5ac8' },
      { id: 'branch-employees',   label: 'Branch Employees',  dot: '#c9a84c' },
      { id: 'user-management',    label: 'User Management',   dot: '#3aaa6a' },
      { id: 'company-settings',   label: 'Company Settings',  dot: '#c9a84c' },
      { id: 'import-logs',        label: 'Import Logs',       dot: '#c9981f' },
      { id: 'role-management',    label: 'Role Management',   dot: '#e05555' },
    ],
  },
]

const T = {
  dark: {
    bg: '#0c0b09', card: '#111', border: '#1e1e1a', text1: '#f0e6c8',
    text2: '#c8b89a', text3: '#7a6a4a', text4: '#3a2a1a',
    gold: '#c9a84c', goldDim: 'rgba(201,168,76,.1)', goldBdr: 'rgba(201,168,76,.2)',
    hov: 'rgba(201,168,76,.06)', red: '#e05555',
    avatarBg: 'linear-gradient(135deg, #c9a84c 0%, #7a4a10 100%)',
    sectionClr: '#3a2e18',
  },
  light: {
    bg: '#f0ebe0', card: '#faf7f2', border: '#ddd8cc', text1: '#1a1208',
    text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a',
    gold: '#9a7228', goldDim: 'rgba(154,114,40,.08)', goldBdr: 'rgba(154,114,40,.2)',
    hov: 'rgba(154,114,40,.06)', red: '#c03030',
    avatarBg: 'linear-gradient(135deg, #b8882e 0%, #7a4a10 100%)',
    sectionClr: '#c0b090',
  },
}

export default function MobileMenu({ onClose }) {
  const { theme, activeNav, setActiveNav, user, canSee } = useApp()
  const t = T[theme] || T.dark
  const router = useRouter()
  const initial = user?.email?.[0]?.toUpperCase() ?? '?'

  const handleNav = (id) => {
    setActiveNav(id)
    onClose()
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }} />

      {/* Drawer - slides up from bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: t.bg, borderRadius: '20px 20px 0 0',
        borderTop: `1px solid ${t.border}`,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        animation: 'slideUp .25s cubic-bezier(.4,0,.2,1) both',
      }}>
        {/* Handle bar */}
        <div style={{ padding: '12px 0 0', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: t.text4 }} />
        </div>

        {/* User header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px 14px',
          borderBottom: `1px solid ${t.border}`, flexShrink: 0,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: t.avatarBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '.9rem', fontWeight: 700, color: '#fff',
          }}>
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '.8rem', fontWeight: 600, color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email?.split('@')[0]}
            </div>
            <div style={{ fontSize: '.62rem', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: `1px solid ${t.border}`,
            background: 'transparent', color: t.text3, fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 80px', scrollbarWidth: 'none' }}>
          {NAV_SECTIONS.map(section => {
            const visible = section.items.filter(item => canSee(item.id))
            if (!visible.length) return null
            return (
              <div key={section.label} style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: '.5rem', color: t.sectionClr,
                  letterSpacing: '.18em', textTransform: 'uppercase',
                  padding: '8px 8px 6px', fontWeight: 700,
                }}>
                  {section.label}
                </div>
                {visible.map(item => {
                  const isActive = activeNav === item.id
                  return (
                    <button key={item.id} onClick={() => handleNav(item.id)} style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '13px 12px', borderRadius: 10,
                      border: `1px solid ${isActive ? t.goldBdr : 'transparent'}`,
                      background: isActive ? t.goldDim : 'transparent',
                      cursor: 'pointer', marginBottom: 2,
                      transition: 'all .12s',
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: isActive ? (item.dot || t.gold) : t.text4,
                        boxShadow: isActive ? `0 0 8px ${item.dot || t.gold}` : 'none',
                      }} />
                      <span style={{
                        fontSize: '.8rem', color: isActive ? (item.dot || t.gold) : t.text2,
                        fontWeight: isActive ? 600 : 400, letterSpacing: '.01em',
                      }}>
                        {item.label}
                      </span>
                      {isActive && (
                        <svg style={{ marginLeft: 'auto' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={item.dot || t.gold} strokeWidth="2.5" strokeLinecap="round">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Sign out */}
        <div style={{
          padding: '12px 12px calc(12px + env(safe-area-inset-bottom))',
          borderTop: `1px solid ${t.border}`, flexShrink: 0,
          background: t.bg,
        }}>
          <button onClick={signOut} style={{
            width: '100%', padding: '13px 16px', borderRadius: 10,
            border: `1px solid ${t.red}30`, background: `${t.red}08`,
            color: t.red, fontSize: '.78rem', fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.red} strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </div>
  )
}
