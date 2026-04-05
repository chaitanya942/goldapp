'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const AppContext = createContext({})

export const ROLE_PAGES = {
  super_admin:     ['dashboard','purchase-data','purchase-reports','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot'],
  founders_office: ['dashboard','purchase-data','purchase-reports','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot'],
  admin:           ['dashboard','purchase-data','purchase-reports','cal-table','live-market-rates'],
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
  const [user,         setUser]         = useState(null)
  const [userProfile,  setUserProfile]  = useState(null)
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
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else setUserProfile(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadProfile = async (userId) => {
    const { data } = await supabase.from('user_profiles').select('*').eq('id', userId).single()
    if (data) setUserProfile(data)
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

    let lastSync = 0
    const THROTTLE_MS = 2 * 60 * 1000 // max once every 2 min

    const triggerSync = () => {
      const now = Date.now()
      if (now - lastSync < THROTTLE_MS) return
      lastSync = now
      fetch('/api/sync-purchases', { method: 'POST' }).catch(() => {})
    }

    // Sync on login
    triggerSync()

    // Sync when user switches back to the tab
    const onVisible = () => { if (document.visibilityState === 'visible') triggerSync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user])

  const role = userProfile?.role || 'viewer'

  return (
    <AppContext.Provider value={{
      user, userProfile,
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