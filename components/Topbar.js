'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/context'
import GoldButton from './ui/GoldButton'
import Toast from './ui/Toast'

const THEMES = {
  dark:  { bg: '#141414', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', gold: '#c9a84c', border: '#2a2a2a', card2: '#1a1a1a', green: '#3aaa6a', red: '#e05555' },
  light: { bg: '#ede8dc', text1: '#2a1f0a', text2: '#6a5a3a', text3: '#8a7a5a', gold: '#a07830', border: '#d5cfc0', card2: '#e0dace', green: '#2a8a5a', red: '#cc3333' },
}

const PAGE_TITLES = {
  'dashboard':          'Dashboard',
  'purchase-data':      'Purchase Data',
  'purchase-reports':   'Purchase Reports',
  'consignments':       'Consignments',
  'melting':            'Melting',
  'sales':              'Sales',
  'reports':            'Reports',
  'branch-management':  'Branch Management',
  'user-management':    'User Management',
  'import-logs':        'Import Logs',
}

export default function Topbar() {
  const { theme, setTheme, activeNav, user, role, canDo } = useApp()
  const t = THEMES[theme]
  const router = useRouter()

  const [syncing, setSyncing] = useState(false)
  const [toast,   setToast]   = useState(null)

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res  = await fetch('/api/sync-purchases', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setToast({ msg: `${data.synced} records synced`, type: 'success' })
      } else {
        setToast({ msg: data.error || 'Sync failed', type: 'error' })
      }
    } catch (e) {
      setToast({ msg: 'Network error', type: 'error' })
    } finally {
      setSyncing(false)
    }
  }

  const initial    = user?.email?.[0]?.toUpperCase() ?? '?'
  const pageTitle  = PAGE_TITLES[activeNav] ?? 'GoldApp'
  const canSync    = role === 'super_admin' || role === 'founders_office'

  return (
    <div style={{
      height: '52px', background: t.bg,
      borderBottom: `1px solid ${t.border}`,
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: '12px', flexShrink: 0,
    }}>

      {/* Breadcrumb */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>GoldApp</span>
        <span style={{ color: t.text3, fontSize: '.65rem' }}>/</span>
        <span style={{ fontSize: '.75rem', color: t.text1, fontWeight: 500, letterSpacing: '.04em' }}>{pageTitle}</span>
      </div>

      {/* CRM Sync button — only for super_admin and founders_office */}
      {canSync && (
        <GoldButton
          variant="outline"
          onClick={handleSync}
          disabled={syncing}
          style={{ padding: '5px 14px', fontSize: '.62rem' }}
        >
          {syncing ? <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> : '⟳'} Sync CRM
        </GoldButton>
      )}

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        style={{
          background: 'transparent', border: `1px solid ${t.border}`,
          color: t.text3, borderRadius: '50%',
          width: '32px', height: '32px', cursor: 'pointer',
          fontSize: '.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      {/* User avatar */}
      <div style={{
        width: '32px', height: '32px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #c9a84c, #8a5c20)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '.75rem', fontWeight: 700, color: '#fff', flexShrink: 0,
      }}>
        {initial}
      </div>

      {/* Email */}
      <span style={{ fontSize: '.7rem', color: t.text3, letterSpacing: '.02em' }}>
        {user?.email}
      </span>

      {/* Sign out */}
      <button
        onClick={signOut}
        style={{
          background: 'transparent', border: `1px solid ${t.border}`,
          color: t.text3, borderRadius: '6px',
          padding: '5px 12px', cursor: 'pointer',
          fontSize: '.65rem', letterSpacing: '.08em', textTransform: 'uppercase',
        }}
      >
        Sign Out
      </button>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}