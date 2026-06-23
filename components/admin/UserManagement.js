'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { openAlert, openConfirm } from '../ui/ConfirmDialog'

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

// Fallback used only before API loads
const DEFAULT_ROLES = [
  { value: 'super_admin',     label: 'Super Admin',      color: '#c9a84c' },
  { value: 'founders_office', label: "Founder's Office", color: '#8c5ac8' },
  { value: 'admin',           label: 'Admin',            color: '#3a8fbf' },
  { value: 'manager',         label: 'Manager',          color: '#3aaa6a' },
  { value: 'branch_staff',    label: 'Branch Staff',     color: '#c9981f' },
  { value: 'viewer',          label: 'View Only',        color: '#7a6a4a' },
  { value: 'telesales',       label: 'Telesales',        color: '#e07840' },
  { value: 'audit',           label: 'Accounts',         color: '#5ec1d6' },
]

const REGION_COLOR = {
  'Andhra Pradesh':    '#5ec1d6',
  'Kerala':            '#3aaa6a',
  'Telangana':         '#c9a84c',
  'Tamil Nadu':        '#e58a3b',
  'Rest of Karnataka': '#9275d5',
  'Bangalore':         '#e05555',
}

const REGION_BYPASS_ROLES = new Set(['super_admin', 'founders_office', 'admin'])

// Compact region label (e.g. "Andhra Pradesh" → "AP", "Rest of Karnataka" → "RoK")
const regionShort = (r) => ({
  'Andhra Pradesh':    'AP',
  'Kerala':            'KL',
  'Telangana':         'TS',
  'Tamil Nadu':        'TN',
  'Rest of Karnataka': 'RoK',
  'Bangalore':         'BLR',
}[r] || r.slice(0, 3).toUpperCase())

// Initials from full name (e.g. "Mithun Shetty" → "MS")
const initials = (name) => {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

export default function UserManagement() {
  const { theme, canDo } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const [roles,      setRoles]      = useState(DEFAULT_ROLES)
  const [users,      setUsers]      = useState([])
  const [allRegions, setAllRegions] = useState([])  // pulled from branches.region distinct
  const [loading,    setLoading]    = useState(false)
  const [savingId,   setSavingId]   = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }
  const [openRegionsFor, setOpenRegionsFor] = useState(null) // userId whose region popover is open
  const [regionsAnchor,  setRegionsAnchor]  = useState({ top: 0, left: 0 }) // viewport coords for fixed popover
  const [popoverSearch,  setPopoverSearch]  = useState('')

  // Search + filters
  const [userSearch,    setUserSearch]    = useState('')
  const [roleFilter,    setRoleFilter]    = useState('')
  const [regionFilter,  setRegionFilter]  = useState('')

  // Invite form
  const [showInvite, setShowInvite] = useState(false)
  const [invTab,     setInvTab]     = useState('invite') // 'invite' | 'existing'
  const [invEmail,   setInvEmail]   = useState('')
  const [invName,    setInvName]    = useState('')
  const [invRole,    setInvRole]    = useState('viewer')
  const [inviting,   setInviting]   = useState(false)
  const [invMsg,     setInvMsg]     = useState(null)  // { type: 'success'|'error', text }

  // Add existing user form (created directly in Supabase)
  const [exUuid,     setExUuid]     = useState('')
  const [exEmail,    setExEmail]    = useState('')
  const [exName,     setExName]     = useState('')
  const [exRole,     setExRole]     = useState('viewer')
  const [exSaving,   setExSaving]   = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [{ data }, rbacRes, branchRes] = await Promise.all([
      supabase.from('user_profiles').select('*').order('full_name'),
      authedFetch('/api/rbac?action=all').then(r => r.json()).catch(() => null),
      supabase.from('branches').select('region').not('region', 'is', null),
    ])
    if (data) setUsers(data)
    if (rbacRes?.roles?.length) {
      setRoles(rbacRes.roles.map(r => ({ value: r.name, label: r.label, color: r.color || '#7a6a4a' })))
    }
    if (branchRes?.data) {
      setAllRegions([...new Set(branchRes.data.map(b => b.region).filter(Boolean))].sort())
    }
    setLoading(false)
  }

  // Update a user's allowed_regions (TEXT[]). Empty array = no restriction (sees all).
  const updateRegions = async (id, regions) => {
    setSavingId(id)
    const value = regions.length === 0 ? null : regions
    await supabase.from('user_profiles').update({ allowed_regions: value }).eq('id', id)
    setUsers(prev => prev.map(u => u.id === id ? { ...u, allowed_regions: value } : u))
    setSavingId(null)
  }

  const getRoleStyle = (role) => roles.find(r => r.value === role) ?? { label: role, color: '#7a6a4a' }

  // ── INVITE ──────────────────────────────────────────────
  const inviteUser = async () => {
    if (!invEmail.trim()) return
    setInviting(true)
    setInvMsg(null)

    try {
      // Server-side route uses the service role key. authedFetch injects the
      // caller's session token so the route can verify the caller is admin.
      const res = await authedFetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:     invEmail.trim(),
          full_name: invName.trim(),
          role:      invRole,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send invite.')

      setInvMsg({ type: 'success', text: `Invite sent to ${invEmail.trim()}. They will receive an email to set their password.` })
      setInvEmail('')
      setInvName('')
      setInvRole('viewer')
      await load()

    } catch (err) {
      setInvMsg({ type: 'error', text: err.message || 'Failed to send invite.' })
    }

    setInviting(false)
  }

  // ── UPDATE ROLE ──────────────────────────────────────────
  const updateRole = async (id, role) => {
    setSavingId(id)
    await supabase.from('user_profiles').update({ role }).eq('id', id)
    await load()
    setSavingId(null)
  }

  // ── DELETE USER ──────────────────────────────────────────
  const deleteUser = async (id) => {
    setSavingId(id)
    setConfirmDelete(null)
    try {
      const res = await authedFetch('/api/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await load()
    } catch (err) {
      openAlert({ title: 'Delete failed', message: err.message })
    }
    setSavingId(null)
  }

  // ── TOGGLE ACTIVE ────────────────────────────────────────
  const toggleActive = async (id, current) => {
    setSavingId(id)
    await supabase.from('user_profiles').update({ is_active: !current }).eq('id', id)
    await load()
    setSavingId(null)
  }

  // ── ADD EXISTING USER (created directly in Supabase Auth) ──
  const addExistingUser = async () => {
    if (!exUuid.trim() || !exEmail.trim()) return
    setExSaving(true)
    setInvMsg(null)
    try {
      // authedFetch handles bearer injection — no need to manually pull session.
      const res = await authedFetch('/api/add-user-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:        exUuid.trim(),
          email:     exEmail.trim(),
          full_name: exName.trim() || exEmail.trim(),
          role:      exRole,
        }),
      })
      if (!res.ok) {
        const msg = await res.text()
        setInvMsg({ type: 'error', text: msg })
      } else {
        setInvMsg({ type: 'success', text: `${exEmail.trim()} added with ${exRole} role.` })
        setExUuid(''); setExEmail(''); setExName(''); setExRole('viewer')
        await load()
      }
    } catch (err) {
      setInvMsg({ type: 'error', text: err.message })
    }
    setExSaving(false)
  }

  // ── Apply search + role + region filters once for both table + count ──
  const filteredUsers = users.filter(u => {
    if (userSearch) {
      const q = userSearch.toLowerCase()
      if (!`${u.full_name || ''} ${u.email || ''}`.toLowerCase().includes(q)) return false
    }
    if (roleFilter && u.role !== roleFilter) return false
    if (regionFilter === '__bypass' && !REGION_BYPASS_ROLES.has(u.role)) return false
    if (regionFilter === '__none'   && (REGION_BYPASS_ROLES.has(u.role) || (u.allowed_regions || []).length > 0)) return false
    if (regionFilter && !['__bypass', '__none'].includes(regionFilter)) {
      if (REGION_BYPASS_ROLES.has(u.role)) return true
      if (!(u.allowed_regions || []).includes(regionFilter)) return false
    }
    return true
  })

  // ── SHARED INPUT STYLE ───────────────────────────────────
  const inp = {
    background: t.card2,
    border: `1px solid ${t.border2}`,
    borderRadius: '7px',
    padding: '9px 12px',
    color: t.text1,
    fontSize: '.75rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1060px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>User Management</div>
          <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>Invite team members and manage their access roles</div>
        </div>
        {canDo('edit') && (
          <button
            onClick={() => { setShowInvite(!showInvite); setInvMsg(null) }}
            style={{
              background: showInvite ? 'transparent' : t.gold,
              border: `1px solid ${t.gold}`,
              borderRadius: '8px',
              padding: '9px 20px',
              color: showInvite ? t.gold : '#0a0a0a',
              fontSize: '.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all .2s',
            }}>
            {showInvite ? 'Cancel' : 'Add user'}
          </button>
        )}
      </div>

      {/* ── Invite Form ── */}
      {showInvite && (
        <div style={{
          background: t.card,
          border: `1px solid ${t.gold}33`,
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Gold top accent */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg,${t.gold},${t.gold}00)` }}/>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: t.card2, borderRadius: '8px', padding: '3px', width: 'fit-content' }}>
            {[{ key: 'invite', label: 'Invite via Email' }, { key: 'existing', label: 'Add Existing User' }].map(tab => (
              <button key={tab.key} onClick={() => { setInvTab(tab.key); setInvMsg(null) }}
                style={{ padding: '6px 16px', fontSize: '.65rem', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all .15s',
                  background: invTab === tab.key ? t.gold : 'transparent',
                  color: invTab === tab.key ? '#0a0a0a' : t.text3 }}>
                {tab.label}
              </button>
            ))}
          </div>

          {invTab === 'invite' ? (<>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '14px', marginBottom: '18px' }}>
              <div>
                <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Full Name</div>
                <input style={inp} placeholder="e.g. Rahul Sharma" value={invName} onChange={e => setInvName(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Email Address</div>
                <input style={inp} placeholder="rahul@whitegold.money" type="email" value={invEmail}
                  onChange={e => setInvEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && inviteUser()} />
              </div>
              <div>
                <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Role</div>
                <select style={{ ...inp, cursor: 'pointer' }} value={invRole} onChange={e => setInvRole(e.target.value)}>
                  {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button onClick={inviteUser} disabled={inviting || !invEmail.trim()}
                style={{ background: inviting || !invEmail.trim() ? t.border2 : t.gold, border: 'none', borderRadius: '7px', padding: '9px 28px', color: '#0a0a0a', fontSize: '.75rem', fontWeight: 700, cursor: inviting || !invEmail.trim() ? 'not-allowed' : 'pointer', opacity: inviting || !invEmail.trim() ? .6 : 1 }}>
                {inviting ? 'Sending…' : 'Send Invite →'}
              </button>
              <div style={{ fontSize: '.65rem', color: t.text4, lineHeight: 1.5 }}>User will receive an email with a link to set their password</div>
            </div>
          </>) : (<>
            <div style={{ fontSize: '.65rem', color: t.text4, marginBottom: '14px', lineHeight: 1.6, background: `${t.blue}10`, border: `1px solid ${t.blue}25`, borderRadius: '6px', padding: '8px 12px' }}>
              Use this when a user was created directly in Supabase Auth dashboard. Copy their UUID from Authentication → Users and paste it below.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.6fr 1fr 1fr 0.8fr', gap: '14px', marginBottom: '18px' }}>
              <div>
                <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>User UUID</div>
                <input style={inp} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={exUuid} onChange={e => setExUuid(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Email</div>
                <input style={inp} placeholder="user@example.com" type="email" value={exEmail} onChange={e => setExEmail(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Full Name</div>
                <input style={inp} placeholder="Optional" value={exName} onChange={e => setExName(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Role</div>
                <select style={{ ...inp, cursor: 'pointer' }} value={exRole} onChange={e => setExRole(e.target.value)}>
                  {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <button onClick={addExistingUser} disabled={exSaving || !exUuid.trim() || !exEmail.trim()}
              style={{ background: exSaving || !exUuid.trim() || !exEmail.trim() ? t.border2 : t.gold, border: 'none', borderRadius: '7px', padding: '9px 28px', color: '#0a0a0a', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer', opacity: exSaving || !exUuid.trim() || !exEmail.trim() ? .6 : 1 }}>
              {exSaving ? 'Adding…' : 'Add User →'}
            </button>
          </>)}

          {/* Status message */}
          {invMsg && (
            <div style={{
              marginTop: '14px',
              padding: '10px 14px',
              borderRadius: '7px',
              background: invMsg.type === 'success' ? `${t.green}18` : `${t.red}18`,
              border: `1px solid ${invMsg.type === 'success' ? t.green : t.red}40`,
              fontSize: '.72rem',
              color: invMsg.type === 'success' ? t.green : t.red,
              lineHeight: 1.6,
            }}>
              {invMsg.text}
            </div>
          )}
        </div>
      )}

      {/* ── Stats strip ── */}
      {!loading && users.length > 0 && (() => {
        const total       = users.length
        const active      = users.filter(u => u.is_active !== false).length
        const restricted  = users.filter(u => Array.isArray(u.allowed_regions) && u.allowed_regions.length > 0).length
        const unrestricted= total - restricted - users.filter(u => REGION_BYPASS_ROLES.has(u.role)).length
        const adminCount  = users.filter(u => REGION_BYPASS_ROLES.has(u.role)).length
        return (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '1px', background: t.border, borderRadius: '11px', overflow: 'hidden', border: `1px solid ${t.border}`, marginBottom: '14px' }}>
            <StatCard label="Total Users"     value={total}        sub={`${active} active`}                      color={t.gold}   t={t} />
            <StatCard label="Admins"          value={adminCount}   sub="full org-wide access"                    color="#8c5ac8"  t={t} />
            <StatCard label="Region-restricted" value={restricted} sub={restricted === 0 ? 'none scoped yet' : 'scoped to specific regions'} color={restricted > 0 ? t.green : t.text3} t={t} />
            <StatCard label="Unrestricted"    value={Math.max(unrestricted, 0)} sub="non-admin, no region scope"  color={t.text2}  t={t} />
          </div>
        )
      })()}

      {/* ── Search + filter bar ── */}
      {!loading && users.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
          <input
            placeholder="Search name or email…"
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            style={{ ...inp, width: '260px', padding: '8px 12px', fontSize: '.72rem' }} />
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '8px 12px', fontSize: '.72rem', cursor: 'pointer' }}>
            <option value="">All roles</option>
            {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '8px 12px', fontSize: '.72rem', cursor: 'pointer' }}>
            <option value="">All regions</option>
            <option value="__bypass">Admin (full access)</option>
            <option value="__none">Unrestricted</option>
            {allRegions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {(userSearch || roleFilter || regionFilter) && (
            <button onClick={() => { setUserSearch(''); setRoleFilter(''); setRegionFilter('') }}
              style={{ background: 'transparent', border: `1px solid ${t.gold}40`, color: t.gold, borderRadius: '6px', padding: '7px 14px', fontSize: '.68rem', cursor: 'pointer' }}>
              Clear filters
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: t.text3 }}>
            {filteredUsers.length} of {users.length}
          </span>
        </div>
      )}

      {/* ── Users Table ── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: t.text3, padding: '48px', fontSize: '.8rem' }}>Loading users…</div>
      ) : (
        <div style={{ borderRadius: '12px', border: `1px solid ${t.border}`, overflow: isMobile ? 'auto' : 'hidden', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: isMobile ? '720px' : 'auto' }}>

          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.6fr 0.9fr 1.1fr 0.65fr 1.2fr', background: t.card }}>
            {['Name', 'Email', 'Role', 'Regions', 'Status', 'Action'].map(h => (
              <div key={h} style={{ padding: '10px 16px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}` }}>
                {h}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {users.length === 0 && (
            <div style={{ textAlign: 'center', color: t.text4, padding: '48px', fontSize: '.8rem' }}>No users found.</div>
          )}
          {users.length > 0 && filteredUsers.length === 0 && (
            <div style={{ textAlign: 'center', color: t.text4, padding: '48px', fontSize: '.8rem' }}>No users match the current filters.</div>
          )}
          {filteredUsers.map((u, i) => {
            const rs     = getRoleStyle(u.role)
            const busy   = savingId === u.id
            const active = u.is_active !== false
            const last   = i === filteredUsers.length - 1
            return (
              <div
                key={u.id}
                style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.6fr 0.9fr 1.1fr 0.65fr 1.2fr', alignItems: 'center', borderBottom: last ? 'none' : `1px solid ${t.border}20`, transition: 'background .15s' }}
                onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                {/* Name with avatar */}
                <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '50%',
                    background: `linear-gradient(135deg, ${rs.color}40, ${rs.color}15)`,
                    border: `1px solid ${rs.color}50`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '.7rem', fontWeight: 600, color: rs.color,
                    flexShrink: 0,
                  }}>
                    {initials(u.full_name || u.email)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '.75rem', color: t.text1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.full_name || '—'}
                    </div>
                  </div>
                </div>

                {/* Email */}
                <div style={{ padding: '13px 16px', fontSize: '.72rem', color: t.text3 }}>
                  {u.email}
                </div>

                {/* Role */}
                <div style={{ padding: '13px 16px' }}>
                  {canDo('edit') ? (
                    <select
                      value={u.role || 'viewer'}
                      disabled={busy}
                      onChange={e => updateRole(u.id, e.target.value)}
                      style={{
                        background: `${rs.color}15`,
                        border: `1px solid ${rs.color}50`,
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: rs.color,
                        fontSize: '.68rem',
                        cursor: 'pointer',
                        outline: 'none',
                      }}>
                      {roles.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: '.68rem', padding: '3px 10px', borderRadius: '100px', background: `${rs.color}15`, color: rs.color }}>
                      {rs.label}
                    </span>
                  )}
                </div>

                {/* Regions — chips for restricted users; "All" pill for unrestricted/admins */}
                <div style={{ padding: '13px 16px' }}>
                  {(() => {
                    const isBypass = REGION_BYPASS_ROLES.has(u.role)
                    const regions  = Array.isArray(u.allowed_regions) ? u.allowed_regions : []

                    // Admin / unrestricted: simple "All" pill (with admin lock icon for bypass roles)
                    if (isBypass) {
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '.62rem', color: t.text3, padding: '3px 9px', background: `${t.text3}10`, border: `1px solid ${t.border}`, borderRadius: '100px' }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: t.text3 }} />
                          All (admin)
                        </span>
                      )
                    }

                    const open = openRegionsFor === u.id
                    const openPopover = (e) => {
                      e.stopPropagation()
                      if (open) { setOpenRegionsFor(null); return }
                      const r = e.currentTarget.getBoundingClientRect()
                      const popoverWidth = 280
                      const left = Math.min(r.left, window.innerWidth - popoverWidth - 12)
                      setRegionsAnchor({ top: r.bottom + 4, left: Math.max(12, left) })
                      setPopoverSearch('')
                      setOpenRegionsFor(u.id)
                    }

                    if (!canDo('edit')) {
                      // Read-only view (still show chips)
                      if (regions.length === 0) {
                        return <span style={{ fontSize: '.62rem', color: t.text3, padding: '3px 9px', background: `${t.text3}10`, border: `1px solid ${t.border}`, borderRadius: '100px' }}>All</span>
                      }
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {regions.map(r => (
                            <span key={r} style={{ fontSize: '.6rem', color: REGION_COLOR[r] || t.text3, padding: '2px 8px', background: `${REGION_COLOR[r] || t.text3}15`, border: `1px solid ${REGION_COLOR[r] || t.text3}40`, borderRadius: '100px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: REGION_COLOR[r] || t.text3 }} />
                              {regionShort(r)}
                            </span>
                          ))}
                        </div>
                      )
                    }

                    // Editable: clickable chip(s) that open the popover
                    if (regions.length === 0) {
                      return (
                        <button onClick={openPopover} disabled={busy}
                          title="Click to restrict this user to specific regions"
                          style={{ background: 'transparent', border: `1px dashed ${t.border}`, borderRadius: '100px', padding: '3px 10px', color: t.text3, fontSize: '.62rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: t.green }} />
                          All regions
                          <span style={{ opacity: 0.5, fontSize: '.55rem' }}>▾</span>
                        </button>
                      )
                    }
                    return (
                      <button onClick={openPopover} disabled={busy}
                        title={regions.join(', ')}
                        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                        {regions.slice(0, 3).map(r => (
                          <span key={r} style={{ fontSize: '.6rem', color: REGION_COLOR[r] || t.text3, padding: '2px 8px', background: `${REGION_COLOR[r] || t.text3}15`, border: `1px solid ${REGION_COLOR[r] || t.text3}40`, borderRadius: '100px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: REGION_COLOR[r] || t.text3 }} />
                            {regionShort(r)}
                          </span>
                        ))}
                        {regions.length > 3 && (
                          <span style={{ fontSize: '.6rem', color: t.text3, padding: '2px 7px', background: `${t.text3}10`, borderRadius: '100px' }}>
                            +{regions.length - 3}
                          </span>
                        )}
                        <span style={{ opacity: 0.4, fontSize: '.55rem', color: t.text3 }}>▾</span>
                      </button>
                    )
                  })()}
                </div>

                {/* Status */}
                <div style={{ padding: '13px 16px' }}>
                  <span style={{ fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', color: active ? t.green : t.text4 }}>
                    {active ? '● Active' : '○ Inactive'}
                  </span>
                </div>

                {/* Action */}
                <div style={{ padding: '13px 16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {canDo('edit') && (<>
                    <button
                      disabled={busy}
                      onClick={() => toggleActive(u.id, active)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${active ? t.red + '50' : t.gold + '50'}`,
                        color: active ? t.red : t.gold,
                        borderRadius: '6px',
                        padding: '4px 12px',
                        fontSize: '.62rem',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        letterSpacing: '.06em',
                        transition: 'all .15s',
                        opacity: busy ? .5 : 1,
                      }}>
                      {busy ? '…' : active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setConfirmDelete({ id: u.id, name: u.full_name || u.email })}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${t.red}40`,
                        color: t.red,
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '.62rem',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        opacity: busy ? .5 : 1,
                        transition: 'all .15s',
                      }}>
                      🗑
                    </button>
                  </>)}
                </div>

              </div>
            )
          })}
        </div>
        </div>
      )}

      {/* ── Region popover (floating, viewport-positioned) ── */}
      {openRegionsFor && (() => {
        const u = users.find(x => x.id === openRegionsFor)
        if (!u) return null
        const regions = Array.isArray(u.allowed_regions) ? u.allowed_regions : []
        const filteredRegions = popoverSearch
          ? allRegions.filter(r => r.toLowerCase().includes(popoverSearch.toLowerCase()))
          : allRegions
        const selectedCount = regions.length
        const totalCount    = allRegions.length
        return (
          <>
            <div onClick={() => setOpenRegionsFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.15)' }} />
            <div style={{
              position: 'fixed', top: regionsAnchor.top, left: regionsAnchor.left,
              background: t.card, border: `1px solid ${t.border}`,
              borderRadius: '12px', boxShadow: '0 16px 48px rgba(0,0,0,.6)',
              zIndex: 101, width: '280px', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
              animation: 'popIn .12s ease-out',
            }}>
              <style>{`@keyframes popIn{0%{opacity:0;transform:translateY(-4px)}100%{opacity:1;transform:none}}`}</style>

              {/* Header */}
              <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '.65rem', color: t.text2, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                    Region access
                  </div>
                  <div style={{ fontSize: '.6rem', color: selectedCount === 0 ? t.text3 : t.gold, fontWeight: 500 }}>
                    {selectedCount === 0 ? 'No restriction' : `${selectedCount} of ${totalCount}`}
                  </div>
                </div>
                <div style={{ fontSize: '.62rem', color: t.text3, marginBottom: '8px', lineHeight: 1.5 }}>
                  {u.full_name || u.email}
                </div>
                {totalCount > 4 && (
                  <input
                    autoFocus
                    placeholder="Search regions…"
                    value={popoverSearch}
                    onChange={e => setPopoverSearch(e.target.value)}
                    style={{ ...inp, padding: '6px 10px', fontSize: '.7rem', width: '100%' }}
                  />
                )}
              </div>

              {/* Region list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
                {filteredRegions.length === 0 && (
                  <div style={{ padding: '20px 14px', fontSize: '.7rem', color: t.text4, textAlign: 'center' }}>
                    {allRegions.length === 0 ? 'No regions configured.' : 'No matches.'}
                  </div>
                )}
                {filteredRegions.map(r => {
                  const checked = regions.includes(r)
                  const color = REGION_COLOR[r] || t.gold
                  return (
                    <button
                      key={r}
                      onClick={() => {
                        const next = checked ? regions.filter(x => x !== r) : [...regions, r]
                        updateRegions(u.id, next)
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '8px 10px', width: '100%',
                        background: checked ? `${color}10` : 'transparent',
                        border: 'none', borderRadius: '7px',
                        cursor: 'pointer', textAlign: 'left',
                        marginBottom: '2px',
                        transition: 'background .12s',
                      }}
                      onMouseEnter={e => { if (!checked) e.currentTarget.style.background = `${t.text3}10` }}
                      onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent' }}>
                      {/* Custom checkbox */}
                      <span style={{
                        width: '15px', height: '15px', borderRadius: '4px',
                        border: `1.5px solid ${checked ? color : t.border2}`,
                        background: checked ? color : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all .12s',
                      }}>
                        {checked && <span style={{ color: '#0a0a0a', fontSize: '11px', lineHeight: 1, fontWeight: 700 }}>✓</span>}
                      </span>
                      {/* Region color dot */}
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: '.75rem', color: checked ? color : t.text1, fontWeight: checked ? 600 : 400, flex: 1 }}>
                        {r}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Footer */}
              <div style={{ padding: '10px 12px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', background: `${t.card2}80` }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => updateRegions(u.id, allRegions)}
                    title="Restrict to all configured regions (each region must be added explicitly)"
                    style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '5px', color: t.text2, fontSize: '.6rem', padding: '4px 8px', cursor: 'pointer' }}>
                    Select all
                  </button>
                  <button onClick={() => updateRegions(u.id, [])}
                    title="Remove all restrictions — user sees every region"
                    style={{ background: 'transparent', border: `1px solid ${t.gold}40`, borderRadius: '5px', color: t.gold, fontSize: '.6rem', padding: '4px 8px', cursor: 'pointer' }}>
                    Clear
                  </button>
                </div>
                <button onClick={() => setOpenRegionsFor(null)}
                  style={{ background: t.gold, border: 'none', borderRadius: '5px', color: '#0a0a0a', fontSize: '.62rem', fontWeight: 700, padding: '4px 12px', cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Delete Confirmation Modal ── */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: t.card, border: `1px solid ${t.red}40`, borderRadius: '14px', padding: '28px 32px', maxWidth: '400px', width: '90%' }}>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: t.text1, marginBottom: '8px' }}>Delete User?</div>
            <div style={{ fontSize: '.75rem', color: t.text3, lineHeight: 1.6, marginBottom: '20px' }}>
              This will permanently delete <strong style={{ color: t.text1 }}>{confirmDelete.name}</strong> from both GoldApp and Supabase Auth. They will lose all access immediately and cannot be recovered.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '7px 18px', fontSize: '.72rem', color: t.text3, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => deleteUser(confirmDelete.id)}
                style={{ background: t.red, border: 'none', borderRadius: '7px', padding: '7px 18px', fontSize: '.72rem', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Role Legend ── */}
      <div style={{ marginTop: '20px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Roles:</span>
        {roles.map(r => (
          <div key={r.value} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: r.color }}/>
            <span style={{ fontSize: '.62rem', color: t.text3 }}>{r.label}</span>
          </div>
        ))}
      </div>

    </div>
  )
}

function StatCard({ label, value, sub, color, t }) {
  return (
    <div style={{ background: t.card, padding: '14px 16px' }}>
      <div style={{ fontSize: '.55rem', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '7px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 200, color, lineHeight: 1, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '5px' }}>{sub}</div>}
    </div>
  )
}