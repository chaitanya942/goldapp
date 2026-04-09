'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp, ROLE_PAGES, ROLE_RESTRICTIONS } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0e0e0e', surface: '#111', card: '#141414', card2: '#1a1a1a', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', goldDim: '#c9a84c18', border: '#2a2a2a', border2: '#333', green: '#3aaa6a', greenDim: '#3aaa6a20', red: '#e05555', redDim: '#e0555520', blue: '#3a8fbf' },
  light: { bg: '#f5f0e8', surface: '#ede8dc', card: '#faf7f2', card2: '#e4dfd3', text1: '#1a1208', text2: '#3a2a10', text3: '#8a7a5a', text4: '#b0a080', gold: '#9a7228', goldDim: '#9a722818', border: '#e0dace', border2: '#d0c8b8', green: '#2a8a5a', greenDim: '#2a8a5a20', red: '#cc3333', redDim: '#cc333320', blue: '#2a6fa0' },
}

// ── Complete permission registry ─────────────────────────────────────────────
export const PERMISSION_REGISTRY = [
  {
    group: 'Pages & Modules',
    icon: '⬜',
    desc: 'Which pages are visible in the sidebar',
    items: [
      { key: 'page.dashboard',             label: 'Dashboard',             desc: 'Main overview' },
      { key: 'page.purchase-data',         label: 'Purchases',             desc: 'Live Feed + Purchase Data tabs' },
      { key: 'page.purchase-reports',      label: 'Purchase Reports',      desc: 'Analytics and charts' },
      { key: 'page.consignment-overview',  label: 'Branch Stock',          desc: 'Consignment overview' },
      { key: 'page.consignment-data',      label: 'Consignment Data',      desc: 'Detailed consignment records' },
      { key: 'page.consignment-report',    label: 'Consignment Report',    desc: 'Consignment analytics' },
      { key: 'page.consignment-summary',   label: 'Movement Report',       desc: 'Stock movement summary' },
      { key: 'page.melting',               label: 'Melting',               desc: 'Gold melting module' },
      { key: 'page.cal-table',             label: 'Cal Table',             desc: 'Sales calculation table' },
      { key: 'page.live-market-rates',     label: 'Live Market Rates',     desc: 'Gold rate tracking' },
      { key: 'page.branch-management',     label: 'Branch Management',     desc: 'Admin: manage branches' },
      { key: 'page.branch-employees',      label: 'Branch Employees',      desc: 'Admin: employee records' },
      { key: 'page.user-management',       label: 'User Management',       desc: 'Admin: manage app users' },
      { key: 'page.company-settings',      label: 'Company Settings',      desc: 'Admin: company config' },
      { key: 'page.consignment-seeds',     label: 'Consignment Seeds',     desc: 'Admin: seed data' },
      { key: 'page.import-logs',           label: 'Import Logs',           desc: 'Admin: data import history' },
      { key: 'page.inbound-bot',           label: 'Inbound Bot Testing',   desc: 'Telesales bot testing' },
    ],
  },
  {
    group: 'Live Feed Elements',
    icon: '📡',
    desc: 'Granular visibility inside the Live Feed (requires Purchases access)',
    items: [
      { key: 'livefeed.old_crm_tab',      label: 'Old CRM Tab',           desc: 'Old CRM data tab' },
      { key: 'livefeed.new_crm_tab',      label: 'New CRM Tab',           desc: 'New CRM data tab' },
      { key: 'livefeed.date_picker',      label: 'Date Picker',           desc: 'View historical dates' },
      { key: 'livefeed.region_filter',    label: 'Region Filter',         desc: 'Filter by region' },
      { key: 'livefeed.summary_bar',      label: 'Summary Bar',           desc: 'Top strip with key numbers' },
      { key: 'livefeed.customer_journey', label: 'Customer Journey',      desc: 'Walk-in → Billed → Purchased funnel' },
      { key: 'livefeed.weight_flow',      label: 'Gold Weight Flow',      desc: 'Weight breakdown strip' },
      { key: 'livefeed.region_breakdown', label: 'Region Breakdown',      desc: 'Region-wise table' },
      { key: 'livefeed.detail_table',     label: 'Detail Drill-down',     desc: 'Click hero to expand records' },
      { key: 'livefeed.timeline',         label: 'Live Timeline',         desc: 'Real-time event timeline' },
      { key: 'livefeed.csv_export',       label: 'CSV Export',            desc: 'Download CSV from tables' },
    ],
  },
  {
    group: 'Actions',
    icon: '⚡',
    desc: 'What operations each role can perform',
    items: [
      { key: 'action.delete',    label: 'Delete Records',    desc: 'Permanently delete data' },
      { key: 'action.edit',      label: 'Edit / Modify',     desc: 'Edit existing records' },
      { key: 'action.import',    label: 'Import Data',       desc: 'Bulk import operations' },
      { key: 'action.export',    label: 'Export / Download', desc: 'Download reports and CSV' },
      { key: 'action.sync_crm',  label: 'Sync CRM',         desc: 'Trigger manual CRM sync' },
    ],
  },
]

const ALL_KEYS = PERMISSION_REGISTRY.flatMap(g => g.items.map(i => i.key))

// Build default permissions from hardcoded ROLE_PAGES + ROLE_RESTRICTIONS
function buildDefaults(roleName) {
  const pages        = (ROLE_PAGES        && ROLE_PAGES[roleName])        || []
  const restrictions = (ROLE_RESTRICTIONS && ROLE_RESTRICTIONS[roleName]) || []
  const perms = new Set()

  pages.forEach(p => perms.add('page.' + p))

  // Actions: enabled unless restricted
  ['delete', 'edit', 'import', 'export', 'sync_crm'].forEach(a => {
    if (!restrictions.includes(a)) perms.add('action.' + a)
  })

  // Live Feed: all enabled if they have purchase-data
  if (pages.includes('purchase-data')) {
    PERMISSION_REGISTRY.find(g => g.group === 'Live Feed Elements')
      ?.items.forEach(i => perms.add(i.key))
  }

  return perms
}

function Toggle({ enabled, onChange, t }) {
  return (
    <div onClick={onChange} style={{ width: 38, height: 22, borderRadius: 11, cursor: 'pointer', background: enabled ? t.green : t.border2, transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 3, left: enabled ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
    </div>
  )
}

function ColorDot({ color, size = 10 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

export default function RoleManagement() {
  const { theme, loadPermissionsForRole, role: myRole } = useApp()
  const t = THEMES[theme]

  const [roles,        setRoles]        = useState([])
  const [rolePerms,    setRolePerms]    = useState({})
  const [dirty,        setDirty]        = useState({})
  const [selected,     setSelected]     = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [loadErr,      setLoadErr]      = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [saveMsg,      setSaveMsg]      = useState(null)
  const [activeGroup,  setActiveGroup]  = useState(0)

  // Add role modal
  const [showAdd,  setShowAdd]  = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newName,  setNewName]  = useState('')
  const [newColor, setNewColor] = useState('#3aaa6a')
  const [adding,   setAdding]   = useState(false)
  const [addErr,   setAddErr]   = useState(null)

  const COLOR_PALETTE = ['#c9a84c','#8c5ac8','#3a8fbf','#3aaa6a','#c9981f','#e07840','#e05555','#7a6a4a','#3a7a6a','#6a3a8a']

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const res  = await fetch('/api/rbac?action=all')
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      if (!json.roles) throw new Error('No roles returned from API')

      const permsMap = {}

      // Initialize with hardcoded defaults first
      for (const role of json.roles) {
        permsMap[role.name] = buildDefaults(role.name)
      }

      // Overlay with DB values (DB overrides defaults)
      const dbByRole = {}
      for (const p of (json.permissions || [])) {
        if (!dbByRole[p.role_name]) dbByRole[p.role_name] = []
        dbByRole[p.role_name].push(p)
      }
      for (const [roleName, perms] of Object.entries(dbByRole)) {
        if (perms.length > 0) {
          const dbSet = new Set(perms.filter(p => p.enabled).map(p => p.permission_key))
          // Only override keys that exist in DB (partial override)
          const dbKeys = new Set(perms.map(p => p.permission_key))
          const merged = new Set(permsMap[roleName] || [])
          for (const k of dbKeys) {
            if (dbSet.has(k)) merged.add(k)
            else merged.delete(k)
          }
          permsMap[roleName] = merged
        }
      }

      setRoles(json.roles)
      setRolePerms(permsMap)
      setDirty({})
      if (!selected && json.roles.length > 0) setSelected(json.roles[0].name)
    } catch (e) {
      console.error('RBAC load error:', e)
      const detail = (e.stack || e.message || String(e))
      setLoadErr(detail)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (key) => {
    setRolePerms(prev => {
      const next = new Set(prev[selected] || [])
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { ...prev, [selected]: next }
    })
    setDirty(prev => ({ ...prev, [selected]: true }))
  }

  const toggleAll = (keys, forceOn) => {
    setRolePerms(prev => {
      const next = new Set(prev[selected] || [])
      keys.forEach(k => forceOn ? next.add(k) : next.delete(k))
      return { ...prev, [selected]: next }
    })
    setDirty(prev => ({ ...prev, [selected]: true }))
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const enabled = rolePerms[selected] || new Set()
      const permissions = ALL_KEYS.map(key => ({ key, enabled: enabled.has(key) }))
      const res = await fetch('/api/rbac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_permissions', role_name: selected, permissions }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setDirty(prev => ({ ...prev, [selected]: false }))
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 2000)
      // Reload current user's permissions if they have this role
      if (myRole === selected) loadPermissionsForRole(selected)
    } catch (e) {
      setSaveMsg('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const addRole = async () => {
    if (!newLabel.trim()) return
    setAdding(true)
    setAddErr(null)
    try {
      const res  = await fetch('/api/rbac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_role', name: newName || newLabel, label: newLabel, color: newColor }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setShowAdd(false)
      setNewLabel(''); setNewName(''); setNewColor('#3aaa6a')
      await load()
      setSelected(json.name)
    } catch (e) {
      setAddErr(e.message)
    } finally {
      setAdding(false)
    }
  }

  const deleteRole = async (name) => {
    if (!confirm(`Delete role "${name}"? This cannot be undone.`)) return
    const res  = await fetch('/api/rbac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_role', name }),
    })
    const json = await res.json()
    if (!json.success) { alert(json.error); return }
    await load()
    setSelected(null)
  }

  const selectedRole  = roles.find(r => r.name === selected)
  const selectedPerms = rolePerms[selected] || new Set()
  const isDirty       = dirty[selected] || false

  if (loading) return (
    <div style={{ padding: 48, textAlign: 'center', color: t.text3 }}>Loading role configuration...</div>
  )

  if (loadErr) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ color: t.red, fontSize: '.8rem', marginBottom: 12 }}>Failed to load roles</div>
      <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: '.65rem', color: t.text3, background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 16px', display: 'inline-block', marginBottom: 16 }}>{loadErr}</div>
      <br />
      <button onClick={load} style={{ padding: '8px 20px', borderRadius: 7, background: t.gold, color: '#000', border: 'none', fontSize: '.72rem', cursor: 'pointer', fontWeight: 600 }}>Retry</button>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', height: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: t.text1, letterSpacing: '.03em' }}>Role Management</div>
          <div style={{ fontSize: '.65rem', color: t.text3, marginTop: 3 }}>Define what each role can see and do across the entire app</div>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding: '8px 18px', borderRadius: 8, background: t.gold, color: '#000', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', border: 'none', letterSpacing: '.04em' }}>
          + Add Role
        </button>
      </div>

      {/* ── Two-panel layout ── */}
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>

        {/* ── Left: Role list ── */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '.52rem', color: t.text4, letterSpacing: '.15em', textTransform: 'uppercase', fontWeight: 700, padding: '0 8px 8px' }}>Roles</div>
          {roles.length === 0 && (
            <div style={{ padding: '12px 8px', fontSize: '.65rem', color: t.red, lineHeight: 1.6 }}>
              No roles found. Run the SQL setup in Supabase dashboard to seed the roles table.
            </div>
          )}
          {roles.map(r => (
            <div key={r.name} onClick={() => setSelected(r.name)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              background: selected === r.name ? `${r.color}15` : 'transparent',
              border: `1px solid ${selected === r.name ? r.color + '40' : 'transparent'}`,
              transition: 'all .15s',
            }}
              onMouseEnter={e => { if (selected !== r.name) e.currentTarget.style.background = t.card }}
              onMouseLeave={e => { if (selected !== r.name) e.currentTarget.style.background = 'transparent' }}>
              <ColorDot color={r.color} size={8} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.74rem', color: selected === r.name ? r.color : t.text2, fontWeight: selected === r.name ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                {r.is_system && <div style={{ fontSize: '.52rem', color: t.text4, marginTop: 1 }}>system</div>}
              </div>
              {dirty[r.name] && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.gold, flexShrink: 0 }} title="Unsaved changes" />}
            </div>
          ))}
        </div>

        {/* ── Right: Permission editor ── */}
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.75rem' }}>Select a role to configure</div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }}>

            {/* Role header */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <ColorDot color={selectedRole?.color} size={12} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '.9rem', fontWeight: 700, color: t.text1 }}>{selectedRole?.label}</span>
                <span style={{ fontSize: '.6rem', color: t.text4, marginLeft: 10 }}>{selected}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {saveMsg && (
                  <span style={{ fontSize: '.65rem', color: saveMsg.startsWith('Error') ? t.red : t.green, fontWeight: 600 }}>{saveMsg}</span>
                )}
                {isDirty && !saving && (
                  <span style={{ fontSize: '.6rem', color: t.gold }}>Unsaved changes</span>
                )}
                <button onClick={save} disabled={saving || !isDirty} style={{
                  padding: '7px 18px', borderRadius: 7, fontSize: '.7rem', fontWeight: 600, cursor: isDirty ? 'pointer' : 'default',
                  background: isDirty ? t.gold : t.card2, color: isDirty ? '#000' : t.text4,
                  border: `1px solid ${isDirty ? t.gold : t.border}`, transition: 'all .2s',
                }}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                {!selectedRole?.is_system && (
                  <button onClick={() => deleteRole(selected)} style={{ padding: '7px 12px', borderRadius: 7, fontSize: '.65rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.redDim}`, color: t.red }}>
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* Group tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.card2 }}>
              {PERMISSION_REGISTRY.map((g, i) => (
                <button key={i} onClick={() => setActiveGroup(i)} style={{
                  padding: '10px 20px', fontSize: '.65rem', cursor: 'pointer', border: 'none',
                  background: activeGroup === i ? t.card : 'transparent',
                  color: activeGroup === i ? t.text1 : t.text3,
                  fontWeight: activeGroup === i ? 600 : 400,
                  borderBottom: activeGroup === i ? `2px solid ${t.gold}` : '2px solid transparent',
                  transition: 'all .15s', letterSpacing: '.04em',
                }}>
                  {g.icon} {g.group}
                </button>
              ))}
            </div>

            {/* Permission items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 16px' }}>
              {(() => {
                const group = PERMISSION_REGISTRY[activeGroup]
                const groupKeys = group.items.map(i => i.key)
                const allOn  = groupKeys.every(k => selectedPerms.has(k))
                const allOff = groupKeys.every(k => !selectedPerms.has(k))
                return (
                  <>
                    {/* Group header with select all/none */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${t.border}` }}>
                      <span style={{ fontSize: '.62rem', color: t.text3, lineHeight: 1.5 }}>{group.desc}</span>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button onClick={() => toggleAll(groupKeys, true)} disabled={allOn} style={{ padding: '4px 10px', borderRadius: 5, fontSize: '.58rem', cursor: allOn ? 'default' : 'pointer', background: 'transparent', border: `1px solid ${t.border}`, color: allOn ? t.text4 : t.text2 }}>All on</button>
                        <button onClick={() => toggleAll(groupKeys, false)} disabled={allOff} style={{ padding: '4px 10px', borderRadius: 5, fontSize: '.58rem', cursor: allOff ? 'default' : 'pointer', background: 'transparent', border: `1px solid ${t.border}`, color: allOff ? t.text4 : t.text2 }}>All off</button>
                      </div>
                    </div>

                    {group.items.map(item => {
                      const on = selectedPerms.has(item.key)
                      return (
                        <div key={item.key}
                          onClick={() => toggle(item.key)}
                          style={{ display: 'flex', alignItems: 'center', padding: '13px 20px', borderBottom: `1px solid ${t.border}18`, cursor: 'pointer', transition: 'background .12s' }}
                          onMouseEnter={e => e.currentTarget.style.background = t.card2}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '.75rem', color: on ? t.text1 : t.text3, fontWeight: on ? 500 : 400, transition: 'color .15s' }}>{item.label}</div>
                            <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 2 }}>{item.desc}</div>
                            <div style={{ fontSize: '.52rem', color: t.text4, fontFamily: 'ui-monospace,monospace', marginTop: 1, opacity: .6 }}>{item.key}</div>
                          </div>
                          <Toggle enabled={on} onChange={() => toggle(item.key)} t={t} />
                        </div>
                      )
                    })}
                  </>
                )
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ── Add Role Modal ── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}>
          <div style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: 14, padding: 28, width: 400, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
            <div style={{ fontSize: '.9rem', fontWeight: 700, color: t.text1 }}>Add Custom Role</div>

            <div>
              <label style={{ fontSize: '.62rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Display Name *</label>
              <input value={newLabel} onChange={e => { setNewLabel(e.target.value); setNewName(e.target.value) }}
                placeholder="e.g. Regional Manager"
                autoFocus
                style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '9px 12px', fontSize: '.78rem', color: t.text1, outline: `2px solid ${t.gold}40`, boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ fontSize: '.62rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Internal ID (auto-generated)</label>
              <input value={newName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}
                readOnly
                style={{ width: '100%', background: t.bg, border: `1px solid ${t.border}`, borderRadius: 7, padding: '9px 12px', fontSize: '.72rem', color: t.text3, fontFamily: 'ui-monospace,monospace', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ fontSize: '.62rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Color</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {COLOR_PALETTE.map(c => (
                  <div key={c} onClick={() => setNewColor(c)} style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', outline: newColor === c ? `3px solid ${t.text1}` : '3px solid transparent', outlineOffset: 2, transition: 'outline .12s' }} />
                ))}
              </div>
            </div>

            <div style={{ fontSize: '.62rem', color: t.text3, background: t.card2, borderRadius: 7, padding: '8px 12px' }}>
              New role starts with default permissions of "View Only". Configure permissions after creating.
            </div>

            {addErr && <div style={{ fontSize: '.65rem', color: t.red }}>{addErr}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setAddErr(null) }} style={{ padding: '8px 18px', borderRadius: 7, background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, fontSize: '.72rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={addRole} disabled={adding || !newLabel.trim()} style={{ padding: '8px 20px', borderRadius: 7, background: t.gold, color: '#000', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', border: 'none', opacity: adding ? .6 : 1 }}>
                {adding ? 'Creating...' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
