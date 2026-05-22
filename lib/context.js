'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const AppContext = createContext({})

export const ROLE_PAGES = {
  super_admin:     ['dashboard','purchase-live','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','consignment-bidding','consignment-analytics','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','logistics','consignment-seeds','import-logs','inbound-bot','role-management','heatmap-insights','consignment-approvals','gold-buying-rate'],
  founders_office: ['dashboard','purchase-live','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','consignment-analytics','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','logistics','consignment-seeds','import-logs','inbound-bot','heatmap-insights','consignment-approvals','gold-buying-rate'],
  admin:           ['dashboard','purchase-live','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','consignment-analytics','cal-table','live-market-rates','heatmap-insights','gold-buying-rate'],
  manager:         ['dashboard','purchase-live','purchase-data','purchase-reports','live-market-rates'],
  branch_staff:    ['dashboard','purchase-live','purchase-data','purchase-reports'],
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
  // Unknown/custom roles: deny everything until DB permissions load
  const restrictions = ROLE_RESTRICTIONS[role] ?? ['delete','import','edit','export','sync_crm']
  return !restrictions.includes(action)
}

export function canSee(role, page) {
  // Unknown/custom roles: deny everything until DB permissions load
  const pages = ROLE_PAGES[role] ?? []
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
  // null = no DB config (use hardcoded fallback), Set = loaded from DB
  const [permissions,   setPermissions]   = useState(null)
  // preview: super_admin can impersonate any role to see how it looks
  const [previewRole,        setPreviewRoleState]  = useState(null)
  const [previewPermissions, setPreviewPermissions] = useState(null)
  const [theme,        setThemeState]   = useState('dark')
  const [branches,     setBranches]     = useState({})
  const [activeNav,    setActiveNav]    = useState('dashboard')
  const [expandedNav,  setExpandedNav]  = useState({ purchases: false, users: false })
  const [syncVersion,        setSyncVersion]        = useState(0)
  const [consignmentDeepLink, setConsignmentDeepLink] = useState(null)
  const [mobileMenuOpen,           setMobileMenuOpen]           = useState(false)
  const [mobileMenuInitialModule,  setMobileMenuInitialModule]  = useState(null)
  const openMobileMenuWithModule = (moduleId = null) => { setMobileMenuInitialModule(moduleId); setMobileMenuOpen(true) }

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
    // onAuthStateChange fires INITIAL_SESSION immediately on mount — covers the getSession() case too
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else { setUserProfile(null); setProfileLoaded(true); try { localStorage.removeItem('goldapp-role') } catch {} }
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadProfile = async (userId) => {
    try {
      const timeout = new Promise(r => setTimeout(r, 8000)) // 8s safety net
      const query   = supabase.from('user_profiles').select('*').eq('id', userId).single()
      const { data } = await Promise.race([query, timeout.then(() => ({ data: null }))])
      if (data) {
        setUserProfile(data)
        try { localStorage.setItem('goldapp-role', data.role) } catch {}
        loadPermissionsForRole(data.role).catch(() => {})
      }
    } catch {}
    setProfileLoaded(true)
  }

  const setPreviewRole = async (roleName) => {
    if (!roleName) {
      setPreviewRoleState(null)
      setPreviewPermissions(null)
      return
    }
    setPreviewRoleState(roleName)
    try {
      const { data } = await supabase
        .from('role_permissions')
        .select('permission_key, enabled')
        .eq('role_name', roleName)
      if (data && data.length > 0) {
        const enabled = new Set(data.filter(p => p.enabled).map(p => p.permission_key))
        setPreviewPermissions(enabled)
      } else {
        setPreviewPermissions(null)  // no DB config — use hardcoded fallback for this role
      }
    } catch {
      setPreviewPermissions(null)
    }
  }

  const loadPermissionsForRole = async (roleName) => {
    // All roles (including super_admin) go through the DB-driven permission loader.
    // If a role has no rows in role_permissions, we fall back to the hardcoded ROLE_PAGES map
    // (which gives super_admin all pages by default — preserving god-mode out of the box).
    try {
      const { data } = await supabase
        .from('role_permissions')
        .select('permission_key, enabled')
        .eq('role_name', roleName)
      if (data && data.length > 0) {
        const enabled = new Set(data.filter(p => p.enabled).map(p => p.permission_key))
        setPermissions(enabled)
      } else {
        setPermissions(null)  // no DB config — fall back to hardcoded ROLE_PAGES
      }
    } catch {
      setPermissions(null)
    }
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
      // Fire-and-forget background sync — never blocks UI, never bumps syncVersion
      fetch('/api/sync-purchases?days=2', { method: 'POST' }).catch(() => null)
      fetch('/api/sync-new-crm',          { method: 'POST' }).catch(() => null)
    }

    // Do NOT sync immediately on login — let pages load their data first.
    // Running sync on login races with page queries and can corrupt data on timeout.
    // 5 min cadence keeps Supabase reports/dashboard close to CRM state.
    const interval = setInterval(triggerSync, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [user])

  const role = userProfile?.role || 'viewer'

  // ── Element key → parent page map ─────────────────────────────────────────
  // Used to fall back to page-level access when no element config exists for a module
  const ELEMENT_PAGE = {
    'element.dashboard':            'purchase-data',      // KPI cards / top branches are purchase data widgets
    'element.reports':              'purchase-reports',
    'element.intelligence':         'purchase-reports',
    'element.consignment-overview': 'consignment-overview',
  }

  // For a given element/tab/livefeed key and a permissions Set, returns true if:
  //  (a) the key is explicitly enabled, OR
  //  (b) no element config exists for this module → fall back to page-level access
  const resolveElementKey = (key, perms) => {
    if (perms.has(key)) return true

    const parts = key.split('.')
    // Module prefix = all parts except last → 'element.dashboard.kpi_cards' → 'element.dashboard'
    //                                          'livefeed.timeline'           → 'livefeed'
    //                                          'tab.purchase-data.live'      → 'tab.purchase-data'
    const modulePrefix = parts.slice(0, parts.length - 1).join('.')

    // If admin configured ANY key in this module, respect those; missing = disabled
    if ([...perms].some(k => k.startsWith(modulePrefix + '.'))) return false

    // No module-level config → fall back to page access
    if (key.startsWith('element.')) {
      const pageName = ELEMENT_PAGE[modulePrefix]
      if (!pageName) return false
      return perms.has('page.' + pageName) || [...perms].some(k => k.startsWith('tab.' + pageName + '.'))
    }
    if (key.startsWith('livefeed.')) {
      return perms.has('page.purchase-data') || [...perms].some(k => k.startsWith('tab.purchase-data.'))
    }
    if (key.startsWith('tab.')) {
      // 'tab.purchase-data.live' → pageName = 'purchase-data'
      return perms.has('page.' + parts[1])
    }
    return false
  }

  // canSee: checks page-level ('purchase-data') or element-level ('livefeed.timeline')
  const canSeeResolved = (key) => {
    // ── Safety: super_admin always retains access to admin tools + the full
    // consignment module, regardless of saved role_permissions. This prevents
    // self-lockout when editing permissions, and ensures critical operational
    // modules stay visible even if the role's permissions are partially saved.
    const ALWAYS_ON_FOR_SUPER_ADMIN = new Set([
      'role-management', 'user-management', 'heatmap-insights',
      'consignment-overview', 'consignment-data', 'consignment-approvals',
      'consignment-report', 'consignment-summary', 'consignment-bidding', 'consignment-analytics',
      'logistics', 'gold-buying-rate',
    ])
    if (role === 'super_admin' && !previewRole) {
      const stripped = key.startsWith('page.') ? key.slice(5) : key
      if (ALWAYS_ON_FOR_SUPER_ADMIN.has(stripped)) return true
    }

    // ── Preview mode (super_admin impersonating another role) ──
    if (role === 'super_admin' && previewRole) {
      const pr = previewRole
      if (previewPermissions !== null) {
        if (key.includes('.')) return resolveElementKey(key, previewPermissions)
        return previewPermissions.has('page.' + key) ||
          [...previewPermissions].some(k => k.startsWith('tab.' + key + '.'))
      }
      // No DB config for preview role — use hardcoded fallback
      if (!(pr in ROLE_PAGES)) return false
      if (key.startsWith('tab.') || key.startsWith('element.')) {
        return ROLE_PAGES[pr].includes(key.split('.')[1])
      }
      if (key.startsWith('livefeed.')) return ROLE_PAGES[pr].includes('purchase-data')
      return ROLE_PAGES[pr].includes(key)
    }

    // super_admin no longer hard-coded to god mode — they load permissions from DB like any other role.
    // If DB has no permissions for super_admin, falls through to ROLE_PAGES fallback below
    // which lists all pages → behaves as god mode out of the box.
    if (permissions !== null) {
      // Element/tab/livefeed keys: smart resolution with module-level fallback
      if (key.includes('.')) return resolveElementKey(key, permissions)
      // Page/nav keys — true if page key set, OR if any tab under this page is enabled
      // (handles partial saves where page.* wasn't explicitly stored)
      return permissions.has('page.' + key) ||
        [...permissions].some(k => k.startsWith('tab.' + key + '.'))
    }
    // Fallback to hardcoded — only for built-in roles; custom roles get no access until DB loads
    if (!(role in ROLE_PAGES)) return false
    // Tab/element keys: allow if the parent page is in ROLE_PAGES (no granular config in hardcoded map)
    if (key.startsWith('tab.') || key.startsWith('element.')) {
      const pageName = key.split('.')[1]  // 'tab.purchase-data.live' → 'purchase-data'
      return ROLE_PAGES[role].includes(pageName)
    }
    if (key.startsWith('livefeed.')) return ROLE_PAGES[role].includes('purchase-data')
    return ROLE_PAGES[role].includes(key)
  }

  const canDoResolved = (action) => {
    // ── Preview mode ──
    if (role === 'super_admin' && previewRole) {
      const pr = previewRole
      if (previewPermissions !== null) return previewPermissions.has('action.' + action)
      if (!(pr in ROLE_RESTRICTIONS)) return false
      return !ROLE_RESTRICTIONS[pr].includes(action)
    }

    // super_admin actions also flow through DB-configurable permissions; fallback below is "all enabled"
    if (permissions !== null) return permissions.has('action.' + action)
    // Custom roles: deny all actions until DB loads
    if (!(role in ROLE_RESTRICTIONS)) return false
    return canDo(role, action)
  }

  return (
    <AppContext.Provider value={{
      user, userProfile, profileLoaded,
      role, permissions, loadPermissionsForRole,
      previewRole, setPreviewRole,
      canDo: canDoResolved,
      canSee: canSeeResolved,
      theme, setTheme,
      branches, setBranches, loadBranches,
      activeNav, setActiveNav,
      expandedNav, setExpandedNav,
      syncVersion,
      bumpSync: () => setSyncVersion(v => v + 1),
      consignmentDeepLink, setConsignmentDeepLink,
      mobileMenuOpen, setMobileMenuOpen,
      mobileMenuInitialModule, setMobileMenuInitialModule,
      openMobileMenuWithModule,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)

// ─────────────────────────────────────────────────────────────────────────────
// Helper: classify a user's region access for UI filtering.
//   restricted: false → user can see every region (admin or unscoped)
//   restricted: true  → user is scoped to specific regions
//   single:     true  → only one region allowed (UI should hide region filter)
// Components use this to decide whether to render a region dropdown at all,
// and which regions to include in it.
// ─────────────────────────────────────────────────────────────────────────────
export function getUserRegionAccess(profile) {
  const role = profile?.role
  const allowed = profile?.allowed_regions
  const isBypass = ['super_admin', 'founders_office', 'admin'].includes(role)
  if (isBypass) return { restricted: false, regions: null, single: false, isBypass: true }
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return { restricted: false, regions: null, single: false, isBypass: false }
  }
  return {
    restricted: true,
    regions:    allowed,
    single:     allowed.length === 1,
    isBypass:   false,
  }
}

// Hook variant — pulls profile from context.
export function useRegionAccess() {
  const { userProfile } = useApp()
  return getUserRegionAccess(userProfile)
}