'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const AppContext = createContext({})

export const ROLE_PAGES = {
  super_admin:     ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot'],
  founders_office: ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot'],
  admin:           ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','cal-table','live-market-rates'],
  manager:         ['dashboard','purchase-data','purchase-reports','live-market-rates'],
  branch_staff:    ['dashboard','purchase-data','purchase-reports'],
  viewer:          ['dashboard','purchase-reports'],
  telesales:       ['dashboard','inbound-bot'],
}

export const ROLE_RESTRICTIONS = {
  super_admin:     [],
  founders_office: ['delete'],
  admin:           ['delete'],
  manager:         ['delete'],
  branch_staff:    ['delete','import'],
  viewer:          ['delete','import','edit'],
  telesales:       ['delete','import','edit'],
}

export function canDo(role, action) {
  const restrictions = ROLE_RESTRICTIONS[role] ?? ROLE_RESTRICTIONS['viewer']
  return !restrictions.includes(action)
}

export function canSee(role, page) {
  const pages = ROLE_PAGES[role] ?? ROLE_PAGES['viewer']
  return pages.includes(page)
}

export function AppProvider({ children }) {
  const [user,          setUser]          = useState(null)
  // seed role from localStorage so dashboard renders correctly on first paint
  const [userProfile,   setUserProfile]   = useState(() => {
    try { const r = localStorage.getItem('goldapp-role'); return r ? { role: r } : null } catch { return null }
  })
  const [profileLoaded, setProfileLoaded] = useState(() => {
    try { return !!localStorage.getItem('goldapp-role') } catch { return false }
  })
  const [theme,        setThemeState]   = useState('dark')
  const [branches,     setBranches]     = useState({})
  const [activeNav,    setActiveNav]    = useState('dashboard')
  const [expandedNav,  setExpandedNav]  = useState({ purchases: false, users: false })

  const setTheme = (nextTheme) => {
    // Cross-fade overlay — covers the instant inline-style swap so it looks like a smooth dissolve
    const overlay = document.createElement('div')
    const bgColor  = nextTheme === 'dark' ? '#0a0a0a' : '#f5f0e8'
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      `background:${bgColor}`, 'opacity:0',
      'transition:opacity 0.15s ease', 'pointer-events:none',
    ].join(';')
    document.body.appendChild(overlay)

    // Fade overlay IN (covers old theme)
    requestAnimationFrame(() => {
      overlay.style.opacity = '1'
      setTimeout(() => {
        // Swap theme while hidden
        setThemeState(nextTheme)
        localStorage.setItem('goldapp-theme', nextTheme)
        document.documentElement.setAttribute('data-theme', nextTheme)
        // Fade overlay OUT (reveals new theme)
        requestAnimationFrame(() => {
          overlay.style.opacity = '0'
          setTimeout(() => overlay.remove(), 160)
        })
      }, 150)
    })
  }

  useEffect(() => {
    const saved = localStorage.getItem('goldapp-theme') || 'dark'
    setThemeState(saved)
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else setProfileLoaded(true)  // no session → profile is "ready" (empty)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else { setUserProfile(null); setProfileLoaded(true); try { localStorage.removeItem('goldapp-role') } catch {} }
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadProfile = async (userId) => {
    const { data } = await supabase.from('user_profiles').select('*').eq('id', userId).single()
    if (data) {
      setUserProfile(data)
      try { localStorage.setItem('goldapp-role', data.role) } catch {}
    }
    setProfileLoaded(true)
  }

  const loadBranches = async () => {
    const { data } = await supabase.from('branches').select('*').eq('is_active', true)
    if (data) {
      const map = {}
      data.forEach(b => { map[b.name.toUpperCase()] = b })
      setBranches(map)
    }
  }

  useEffect(() => {
    if (user) loadBranches()
  }, [user])

  // ── Background auto-sync (fire-and-forget, never blocks UI) ──────────────────
  useEffect(() => {
    if (!user) return

    const triggerSync = () => {
      fetch('/api/sync-purchases', { method: 'POST' }).catch(() => {})
      fetch('/api/sync-new-crm',   { method: 'POST' }).catch(() => {})
    }

    // Sync immediately on login
    triggerSync()

    // Then every 5 minutes while app is open
    const interval = setInterval(triggerSync, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [user])

  const role = userProfile?.role || 'viewer'

  return (
    <AppContext.Provider value={{
      user, userProfile, profileLoaded,
      role,
      canDo: (action) => canDo(role, action),
      canSee: (page)  => canSee(role, page),
      theme, setTheme,
      branches, setBranches, loadBranches,
      activeNav, setActiveNav,
      expandedNav, setExpandedNav,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)