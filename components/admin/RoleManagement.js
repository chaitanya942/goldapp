'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { supabase } from '../../lib/supabase'

// ── Local role defaults ────────────────────────────────────────────────────────
const _ROLE_PAGES = {
  super_admin:     ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot'],
  founders_office: ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot'],
  admin:           ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','cal-table','live-market-rates'],
  manager:         ['dashboard','purchase-data','purchase-reports','live-market-rates'],
  branch_staff:    ['dashboard','purchase-data','purchase-reports'],
  viewer:          ['dashboard','purchase-reports'],
  telesales:       ['dashboard','inbound-bot'],
}
const _ROLE_RESTRICTIONS = {
  super_admin:     [],
  founders_office: ['delete'],
  admin:           ['delete'],
  manager:         ['delete'],
  branch_staff:    ['delete','import'],
  viewer:          ['delete','import','edit'],
  telesales:       ['delete','import','edit'],
}

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = {
  dark:  { bg: '#0e0e0e', surface: '#111', card: '#141414', card2: '#1a1a1a', card3: '#111', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', goldDim: '#c9a84c22', border: '#2a2a2a', border2: '#333', green: '#3aaa6a', greenDim: '#3aaa6a20', red: '#e05555', redDim: '#e0555520', blue: '#3a8fbf' },
  light: { bg: '#f5f0e8', surface: '#ede8dc', card: '#faf7f2', card2: '#e4dfd3', card3: '#f5f0e8', text1: '#1a1208', text2: '#3a2a10', text3: '#8a7a5a', text4: '#b0a080', gold: '#9a7228', goldDim: '#9a722822', border: '#e0dace', border2: '#d0c8b8', green: '#2a8a5a', greenDim: '#2a8a5a20', red: '#cc3333', redDim: '#cc333320', blue: '#2a6fa0' },
}

// ── Permission tree — mirrors the app navigation exactly ─────────────────────
// Structure: Module > Submodule/Page > Tab > Element
// Nodes with `key` are toggleable permissions.
// Nodes without `key` are visual containers only.
const PERM_TREE = [
  {
    label: 'Dashboard', icon: '◈',
    key: 'page.dashboard',
    children: [
      { key: 'element.dashboard.kpi_cards',      label: 'KPI Cards',       desc: 'Animated today-totals strip (customers, weight, value)' },
      { key: 'element.dashboard.period_selector', label: 'Period Selector', desc: 'Today / Yesterday / Week / MTD / YTD switcher' },
      { key: 'element.dashboard.state_table',     label: 'State Summary',   desc: 'State-wise breakdown table with sparkbars' },
      { key: 'element.dashboard.top_branches',    label: 'Top Branches',    desc: 'Branch performance ranking list' },
      { key: 'element.dashboard.region_cards',    label: 'Region Cards',    desc: 'Region distribution summary cards' },
    ],
  },
  {
    label: 'Purchases', icon: '◉',
    children: [
      {
        key: 'page.purchase-data', label: 'Purchase Data',
        children: [
          {
            key: 'tab.purchase-data.live', label: 'Live Feed',
            children: [
              { key: 'livefeed.summary_bar',      label: 'Summary Bar',       desc: 'Top strip: total customers, total weight, total value' },
              { key: 'livefeed.customer_journey',  label: 'Customer Journey',  desc: 'Walk-in → Billed → Purchased funnel' },
              { key: 'livefeed.weight_flow',       label: 'Gold Weight Flow',  desc: 'Weight breakdown strip by type' },
              { key: 'livefeed.region_filter',     label: 'Region Filter',     desc: 'Dropdown to filter data by region' },
              { key: 'livefeed.region_breakdown',  label: 'Region Breakdown',  desc: 'Region-wise stats table' },
              { key: 'livefeed.detail_table',      label: 'Detail Drill-down', desc: 'Expandable records table (click hero to open)' },
              { key: 'livefeed.timeline',          label: 'Live Timeline',     desc: 'Real-time event feed on the right' },
              { key: 'livefeed.date_picker',       label: 'Date Picker',       desc: 'View historical dates' },
              { key: 'livefeed.old_crm_tab',       label: 'Old CRM Tab',       desc: 'Old CRM pipeline data tab' },
              { key: 'livefeed.new_crm_tab',       label: 'New CRM Tab',       desc: 'New CRM pipeline data tab' },
              { key: 'livefeed.csv_export',        label: 'CSV Export',        desc: 'Download CSV from tables' },
            ],
          },
          { key: 'tab.purchase-data.approved',    label: 'Purchase Data',   desc: 'Approved purchase records table' },
          { key: 'tab.purchase-data.walkin',      label: 'Walk-in',         desc: 'Walk-in pipeline status view' },
          { key: 'tab.purchase-data.pending',     label: 'Pending',         desc: 'Bills awaiting approval' },
          { key: 'tab.purchase-data.rejected',    label: 'Rejected',        desc: 'Rejected bill records' },
          { key: 'tab.purchase-data.blacklisted', label: 'Blacklisted',     desc: 'Blacklisted customer list' },
        ],
      },
      {
        key: 'page.purchase-reports', label: 'Purchase Reports',
        children: [
          {
            key: 'tab.purchase-reports.analytics', label: 'Analytics',
            children: [
              { key: 'element.reports.charts',         label: 'Charts',                desc: 'Line, bar, pie graphs' },
              { key: 'element.reports.branch_table',   label: 'Branch Performance',    desc: 'Branch-wise stats breakdown table' },
              { key: 'element.reports.distribution',   label: 'Distribution Analysis', desc: 'Weight & value distribution section' },
              { key: 'element.reports.crm_insights',   label: 'CRM Insights',          desc: 'CRM pipeline section' },
              { key: 'element.reports.same_day',       label: 'Same-Day Trends',       desc: 'Intraday pattern analysis' },
              { key: 'element.reports.period_compare', label: 'Period Compare',        desc: 'Compare two date ranges widget' },
            ],
          },
          {
            key: 'tab.purchase-reports.intelligence', label: 'Intelligence',
            children: [
              { key: 'element.intelligence.branch_health',    label: 'Branch Health',    desc: 'Per-branch health metrics' },
              { key: 'element.intelligence.repeat_customers', label: 'Repeat Customers', desc: 'Customer retention analysis' },
              { key: 'element.intelligence.alerts',           label: 'Alerts',           desc: 'Threshold breach alert panel' },
            ],
          },
        ],
      },
    ],
  },
  {
    label: 'Consignments', icon: '📦',
    children: [
      {
        key: 'page.consignment-overview', label: 'Branch Stock',
        children: [
          { key: 'element.consignment-overview.region_cards', label: 'Region Summary Cards', desc: 'Flashcard row per region at top' },
          { key: 'element.consignment-overview.search',       label: 'Search Bar',           desc: 'Search by branch name' },
          { key: 'element.consignment-overview.sort',         label: 'Sort Controls',        desc: 'Sort by weight, age, urgency' },
          { key: 'element.consignment-overview.table',        label: 'Branch Stock Table',   desc: 'Full branch-wise stock table' },
        ],
      },
      { key: 'page.consignment-data',    label: 'Consignment Data',   desc: 'Detailed consignment records' },
      { key: 'page.consignment-report',  label: 'Consignment Report', desc: 'Consignment analytics charts' },
      { key: 'page.consignment-summary', label: 'Movement Report',    desc: 'Stock movement summary' },
    ],
  },
  {
    label: 'Sales', icon: '◎',
    children: [
      { key: 'page.cal-table',         label: 'Cal Table',         desc: 'Sales calculation and pricing table' },
      { key: 'page.live-market-rates', label: 'Live Market Rates', desc: 'Real-time gold rate ticker' },
    ],
  },
  {
    label: 'Telesales', icon: '◑',
    children: [
      { key: 'page.inbound-bot', label: 'Inbound Bot Testing', desc: 'Bot testing and inbound call interface' },
    ],
  },
  {
    label: 'Admin', icon: '⚙',
    children: [
      { key: 'page.branch-management', label: 'Branch Management',  desc: 'Create and manage branch records' },
      { key: 'page.branch-employees',  label: 'Branch Employees',   desc: 'View and manage employee records' },
      { key: 'page.user-management',   label: 'User Management',    desc: 'Manage app users, roles and access' },
      { key: 'page.company-settings',  label: 'Company Settings',   desc: 'Company-wide configuration' },
      { key: 'page.consignment-seeds', label: 'Consignment Seeds',  desc: 'Test seed data management' },
      { key: 'page.import-logs',       label: 'Import Logs',        desc: 'Data import history and status' },
    ],
  },
  {
    label: 'Actions', icon: '⚡',
    desc: 'System-level operations available to this role',
    children: [
      { key: 'action.delete',   label: 'Delete Records',    desc: 'Permanently delete any data' },
      { key: 'action.edit',     label: 'Edit / Modify',     desc: 'Edit and update existing records' },
      { key: 'action.import',   label: 'Import Data',       desc: 'Bulk data import operations' },
      { key: 'action.export',   label: 'Export / Download', desc: 'Download reports and CSV files' },
      { key: 'action.sync_crm', label: 'Sync CRM',          desc: 'Manually trigger CRM sync' },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

// Collect all permission keys in a subtree
function getAllKeys(node) {
  const keys = []
  if (node.key) keys.push(node.key)
  if (node.children) node.children.forEach(c => keys.push(...getAllKeys(c)))
  return keys
}

const ALL_TREE_KEYS = PERM_TREE.flatMap(getAllKeys)
const TOTAL_PERMS   = ALL_TREE_KEYS.length

// Tristate: 'on' | 'off' | 'partial'
function nodeState(node, enabled) {
  const keys = getAllKeys(node)
  if (!keys.length) return 'off'
  const onCount = keys.filter(k => enabled.has(k)).length
  if (onCount === 0) return 'off'
  if (onCount === keys.length) return 'on'
  return 'partial'
}

// Build default permissions from role name
function buildDefaults(roleName) {
  const pages        = _ROLE_PAGES[roleName]        || []
  const restrictions = _ROLE_RESTRICTIONS[roleName] || []
  const pageKeySet   = new Set(pages.map(p => 'page.' + p))
  const perms        = new Set()

  function traverse(node) {
    if (node.key && node.key.startsWith('page.') && pageKeySet.has(node.key)) {
      // Enable this page and all its children (tabs + elements)
      getAllKeys(node).forEach(k => perms.add(k))
      return
    }
    if (node.children) node.children.forEach(traverse)
  }

  PERM_TREE.forEach(traverse)

  const ACTIONS = ['delete', 'edit', 'import', 'export', 'sync_crm']
  ACTIONS.forEach(a => { if (!restrictions.includes(a)) perms.add('action.' + a) })
  return perms
}

// Flatten tree to a visible list based on which nodes are expanded
function flattenVisible(nodes, expanded, depth = 0) {
  const result = []
  nodes.forEach(node => {
    const nodeId = node.key || ('__' + node.label)
    const isLeaf = !node.children || node.children.length === 0
    result.push({ node, depth, id: nodeId, isLeaf })
    if (!isLeaf && expanded.has(nodeId)) {
      result.push(...flattenVisible(node.children, expanded, depth + 1))
    }
  })
  return result
}

// Search across all leaf nodes
function searchTree(nodes, q, path = []) {
  const results = []
  nodes.forEach(node => {
    const currentPath = [...path, node.label]
    const isLeaf = !node.children || node.children.length === 0
    if (isLeaf && node.key) {
      const haystack = (node.label + ' ' + (node.desc || '') + ' ' + node.key).toLowerCase()
      if (haystack.includes(q)) results.push({ node, path: currentPath })
    } else if (node.children) {
      results.push(...searchTree(node.children, q, currentPath))
    }
  })
  return results
}

// ── Backward-compat export (used by hasPermission checks in app) ───────────────
export const PERMISSION_REGISTRY = [
  {
    group: 'Pages & Modules', icon: '⬜',
    desc: 'Which pages are visible in the sidebar',
    items: [
      { key: 'page.dashboard',            label: 'Dashboard',           desc: 'Main overview' },
      { key: 'page.purchase-data',        label: 'Purchases',           desc: 'Live Feed + Purchase Data tabs' },
      { key: 'page.purchase-reports',     label: 'Purchase Reports',    desc: 'Analytics and charts' },
      { key: 'page.consignment-overview', label: 'Branch Stock',        desc: 'Consignment overview' },
      { key: 'page.consignment-data',     label: 'Consignment Data',    desc: 'Detailed consignment records' },
      { key: 'page.consignment-report',   label: 'Consignment Report',  desc: 'Consignment analytics' },
      { key: 'page.consignment-summary',  label: 'Movement Report',     desc: 'Stock movement summary' },
      { key: 'page.melting',              label: 'Melting',             desc: 'Gold melting module' },
      { key: 'page.cal-table',            label: 'Cal Table',           desc: 'Sales calculation table' },
      { key: 'page.live-market-rates',    label: 'Live Market Rates',   desc: 'Gold rate tracking' },
      { key: 'page.branch-management',    label: 'Branch Management',   desc: 'Admin: manage branches' },
      { key: 'page.branch-employees',     label: 'Branch Employees',    desc: 'Admin: employee records' },
      { key: 'page.user-management',      label: 'User Management',     desc: 'Admin: manage app users' },
      { key: 'page.company-settings',     label: 'Company Settings',    desc: 'Admin: company config' },
      { key: 'page.consignment-seeds',    label: 'Consignment Seeds',   desc: 'Admin: seed data' },
      { key: 'page.import-logs',          label: 'Import Logs',         desc: 'Admin: data import history' },
      { key: 'page.inbound-bot',          label: 'Inbound Bot Testing', desc: 'Telesales bot testing' },
    ],
  },
  {
    group: 'Live Feed Elements', icon: '📡',
    desc: 'Granular visibility inside the Live Feed',
    items: [
      { key: 'livefeed.old_crm_tab',      label: 'Old CRM Tab',       desc: 'Old CRM data tab' },
      { key: 'livefeed.new_crm_tab',      label: 'New CRM Tab',       desc: 'New CRM data tab' },
      { key: 'livefeed.date_picker',      label: 'Date Picker',       desc: 'View historical dates' },
      { key: 'livefeed.region_filter',    label: 'Region Filter',     desc: 'Filter by region' },
      { key: 'livefeed.summary_bar',      label: 'Summary Bar',       desc: 'Top strip with key numbers' },
      { key: 'livefeed.customer_journey', label: 'Customer Journey',  desc: 'Walk-in → Billed → Purchased funnel' },
      { key: 'livefeed.weight_flow',      label: 'Gold Weight Flow',  desc: 'Weight breakdown strip' },
      { key: 'livefeed.region_breakdown', label: 'Region Breakdown',  desc: 'Region-wise table' },
      { key: 'livefeed.detail_table',     label: 'Detail Drill-down', desc: 'Click hero to expand records' },
      { key: 'livefeed.timeline',         label: 'Live Timeline',     desc: 'Real-time event timeline' },
      { key: 'livefeed.csv_export',       label: 'CSV Export',        desc: 'Download CSV' },
    ],
  },
  {
    group: 'Actions', icon: '⚡',
    desc: 'What operations each role can perform',
    items: [
      { key: 'action.delete',   label: 'Delete Records',    desc: 'Permanently delete data' },
      { key: 'action.edit',     label: 'Edit / Modify',     desc: 'Edit existing records' },
      { key: 'action.import',   label: 'Import Data',       desc: 'Bulk import operations' },
      { key: 'action.export',   label: 'Export / Download', desc: 'Download reports and CSV' },
      { key: 'action.sync_crm', label: 'Sync CRM',          desc: 'Trigger manual CRM sync' },
    ],
  },
]

// ── Small UI helpers ──────────────────────────────────────────────────────────

function TriCheckbox({ state, onClick, t }) {
  const isOn      = state === 'on'
  const isPartial = state === 'partial'
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        width: 17, height: 17, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
        border: `2px solid ${isOn || isPartial ? t.gold : t.border2}`,
        background: isOn ? t.gold : isPartial ? t.goldDim : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .12s',
      }}>
      {isOn      && <span style={{ color: '#000', fontSize: 10, fontWeight: 900, lineHeight: 1, userSelect: 'none' }}>✓</span>}
      {isPartial && <span style={{ color: t.gold, fontSize: 13, fontWeight: 900, lineHeight: 1, userSelect: 'none', marginTop: -1 }}>−</span>}
    </div>
  )
}

function ColorDot({ color, size = 10 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

function Modal({ t, onClose, children, width = 420 }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: 14, padding: 28, width, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 60px rgba(0,0,0,.45)' }}>
        {children}
      </div>
    </div>
  )
}

function Field({ t, label, children }) {
  return (
    <div>
      <label style={{ fontSize: '.61rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

function Inp({ t, ...props }) {
  return (
    <input
      {...props}
      style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '9px 12px', fontSize: '.78rem', color: t.text1, outline: 'none', boxSizing: 'border-box', ...props.style }}
      onFocus={e => e.target.style.borderColor = t.gold}
      onBlur={e => e.target.style.borderColor = t.border2}
    />
  )
}

const COLOR_PALETTE = ['#c9a84c','#8c5ac8','#3a8fbf','#3aaa6a','#c9981f','#e07840','#e05555','#7a6a4a','#3a7a6a','#6a3a8a']

function ColorPicker({ value, onChange, t }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {COLOR_PALETTE.map(c => (
        <div key={c} onClick={() => onChange(c)} style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', outline: value === c ? `3px solid ${t.text1}` : '3px solid transparent', outlineOffset: 2, transition: 'outline .12s' }} />
      ))}
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: 26, height: 26, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0, background: 'none' }} title="Custom color" />
    </div>
  )
}

// Depth-based visual styles
const DEPTH_STYLES = [
  { indent: 0,  rowPad: '0 0 0 0',    bg: 'transparent', fontSize: '.82rem', fontWeight: 600, iconSize: '1rem' },
  { indent: 24, rowPad: '0 0 0 24px', bg: 'transparent', fontSize: '.76rem', fontWeight: 500, iconSize: '.75rem' },
  { indent: 48, rowPad: '0 0 0 48px', bg: 'transparent', fontSize: '.71rem', fontWeight: 400, iconSize: '.68rem' },
  { indent: 72, rowPad: '0 0 0 72px', bg: 'transparent', fontSize: '.68rem', fontWeight: 400, iconSize: '.65rem' },
]

/* ══════════════════════════════════════════════════════════════════════════════
                              MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
export default function RoleManagement() {
  const { theme, loadPermissionsForRole, role: myRole } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [roles,      setRoles]      = useState([])
  const [rolePerms,  setRolePerms]  = useState({})       // { roleName: Set<key> }
  const [dirty,      setDirty]      = useState({})       // { roleName: bool }
  const [selected,   setSelected]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [loadErr,    setLoadErr]    = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [saveMsg,    setSaveMsg]    = useState(null)
  const [users,      setUsers]      = useState([])
  const [rightTab,   setRightTab]   = useState('perms')  // 'perms' | 'users'

  // Tree expansion — start with all top-level modules open
  const [expanded, setExpanded] = useState(() => {
    const s = new Set()
    PERM_TREE.forEach(n => s.add(n.key || ('__' + n.label)))
    return s
  })

  // Search
  const [search, setSearch] = useState('')

  // Modals
  const [showAdd,       setShowAdd]       = useState(false)
  const [newLabel,      setNewLabel]      = useState('')
  const [newName,       setNewName]       = useState('')
  const [newColor,      setNewColor]      = useState('#3aaa6a')
  const [adding,        setAdding]        = useState(false)
  const [addErr,        setAddErr]        = useState(null)

  const [showEdit,      setShowEdit]      = useState(false)
  const [editLabel,     setEditLabel]     = useState('')
  const [editColor,     setEditColor]     = useState('#c9a84c')
  const [editing,       setEditing]       = useState(false)
  const [editErr,       setEditErr]       = useState(null)

  const [confirmDelete, setConfirmDelete] = useState(null) // role name

  const [copyFrom,      setCopyFrom]      = useState('')

  /* ── Load ──────────────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true); setLoadErr(null)
    try {
      const [rbacRes, { data: userRows }] = await Promise.all([
        fetch('/api/rbac?action=all').then(r => r.json()),
        supabase.from('user_profiles').select('id, full_name, email, role, is_active').order('full_name'),
      ])
      if (rbacRes.error) throw new Error(rbacRes.error)
      if (!rbacRes.roles) throw new Error('No roles returned from API')

      // Start from defaults, then overlay DB overrides
      const permsMap = {}
      for (const role of rbacRes.roles) permsMap[role.name] = buildDefaults(role.name)

      const dbByRole = {}
      for (const p of (rbacRes.permissions || [])) {
        if (!dbByRole[p.role_name]) dbByRole[p.role_name] = []
        dbByRole[p.role_name].push(p)
      }
      for (const [roleName, perms] of Object.entries(dbByRole)) {
        if (perms.length > 0) {
          const dbEnabled = new Set(perms.filter(p => p.enabled).map(p => p.permission_key))
          const dbKeys    = new Set(perms.map(p => p.permission_key))
          const merged    = new Set(permsMap[roleName] || [])
          for (const k of dbKeys) {
            if (dbEnabled.has(k)) merged.add(k); else merged.delete(k)
          }
          permsMap[roleName] = merged
        }
      }

      setRoles(rbacRes.roles)
      setRolePerms(permsMap)
      setDirty({})
      setUsers(userRows || [])
      if (!selected && rbacRes.roles.length > 0) setSelected(rbacRes.roles[0].name)
    } catch (e) {
      setLoadErr(e.stack || e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const selectedRole  = roles.find(r => r.name === selected)
  const selectedPerms = rolePerms[selected] || new Set()
  const isDirty       = dirty[selected] || false

  const userCountByRole = useMemo(() => {
    const map = {}
    for (const u of users) map[u.role] = (map[u.role] || 0) + 1
    return map
  }, [users])

  const roleUsers = useMemo(() => users.filter(u => u.role === selected), [users, selected])

  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    return searchTree(PERM_TREE, search.toLowerCase())
  }, [search])

  const visibleRows = useMemo(() => flattenVisible(PERM_TREE, expanded), [expanded])

  /* ── Tree toggle logic ─────────────────────────────────────────────────── */
  function toggleExpand(nodeId) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId)
      return next
    })
  }

  function toggleNode(node) {
    const keys = getAllKeys(node)
    if (!keys.length) return
    const state = nodeState(node, selectedPerms)
    const forceOn = state === 'off' // off → all on; partial/on → all off
    setRolePerms(prev => {
      const next = new Set(prev[selected] || [])
      keys.forEach(k => forceOn ? next.add(k) : next.delete(k))
      return { ...prev, [selected]: next }
    })
    setDirty(prev => ({ ...prev, [selected]: true }))
  }

  function toggleKey(key) {
    setRolePerms(prev => {
      const next = new Set(prev[selected] || [])
      if (next.has(key)) next.delete(key); else next.add(key)
      return { ...prev, [selected]: next }
    })
    setDirty(prev => ({ ...prev, [selected]: true }))
  }

  function resetToDefaults() {
    if (!selected) return
    setRolePerms(prev => ({ ...prev, [selected]: buildDefaults(selected) }))
    setDirty(prev => ({ ...prev, [selected]: true }))
  }

  function copyFromRole(fromRole) {
    if (!fromRole || !selected || fromRole === selected) return
    const source = rolePerms[fromRole]
    if (!source) return
    setRolePerms(prev => ({ ...prev, [selected]: new Set(source) }))
    setDirty(prev => ({ ...prev, [selected]: true }))
    setCopyFrom('')
  }

  /* ── Save ──────────────────────────────────────────────────────────────── */
  const save = async () => {
    if (!selected) return
    setSaving(true); setSaveMsg(null)
    try {
      const permissions = ALL_TREE_KEYS.map(key => ({ key, enabled: selectedPerms.has(key) }))
      const res  = await fetch('/api/rbac', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_permissions', role_name: selected, permissions }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setDirty(prev => ({ ...prev, [selected]: false }))
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 2000)
      if (myRole === selected) loadPermissionsForRole(selected)
    } catch (e) {
      setSaveMsg('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  /* ── Add role ──────────────────────────────────────────────────────────── */
  const addRole = async () => {
    if (!newLabel.trim()) return
    setAdding(true); setAddErr(null)
    try {
      const res  = await fetch('/api/rbac', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_role', name: newName || newLabel.toLowerCase().replace(/\s+/g, '_'), label: newLabel, color: newColor }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setShowAdd(false); setNewLabel(''); setNewName(''); setNewColor('#3aaa6a')
      await load()
      setSelected(json.name)
    } catch (e) {
      setAddErr(e.message)
    } finally {
      setAdding(false)
    }
  }

  /* ── Edit role ─────────────────────────────────────────────────────────── */
  const openEdit = () => {
    if (!selectedRole) return
    setEditLabel(selectedRole.label)
    setEditColor(selectedRole.color || '#c9a84c')
    setEditErr(null)
    setShowEdit(true)
  }

  const saveEdit = async () => {
    if (!editLabel.trim()) return
    setEditing(true); setEditErr(null)
    try {
      const res  = await fetch('/api/rbac', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_role', name: selected, label: editLabel.trim(), color: editColor }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setShowEdit(false)
      await load()
    } catch (e) {
      setEditErr(e.message)
    } finally {
      setEditing(false)
    }
  }

  /* ── Delete role ───────────────────────────────────────────────────────── */
  const confirmAndDelete = async () => {
    const name = confirmDelete
    setConfirmDelete(null)
    const res  = await fetch('/api/rbac', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_role', name }),
    })
    const json = await res.json()
    if (!json.success) { alert(json.error); return }
    await load()
    setSelected(null)
  }

  /* ══ RENDER ═══════════════════════════════════════════════════════════════ */
  if (loading) return (
    <div style={{ padding: 48, textAlign: 'center', color: t.text3, fontSize: '.75rem' }}>Loading role configuration...</div>
  )
  if (loadErr) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ color: t.red, fontSize: '.8rem', marginBottom: 12 }}>Failed to load roles</div>
      <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: '.65rem', color: t.text3, background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 16px', display: 'inline-block', marginBottom: 16 }}>{loadErr}</div>
      <br /><button onClick={load} style={{ padding: '8px 20px', borderRadius: 7, background: t.gold, color: '#000', border: 'none', fontSize: '.72rem', cursor: 'pointer', fontWeight: 600 }}>Retry</button>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', height: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: t.text1, letterSpacing: '.03em' }}>Role Management</div>
          <div style={{ fontSize: '.64rem', color: t.text3, marginTop: 3 }}>
            {roles.length} roles · {users.length} users · {TOTAL_PERMS} configurable permissions
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding: '8px 18px', borderRadius: 8, background: t.gold, color: '#000', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', border: 'none', letterSpacing: '.04em' }}>
          + Add Role
        </button>
      </div>

      {/* ── Two-panel layout ── */}
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>

        {/* ── Left: Role list ── */}
        <div style={{ width: 226, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: '.52rem', color: t.text4, letterSpacing: '.15em', textTransform: 'uppercase', fontWeight: 700, padding: '0 8px 8px' }}>Roles</div>
          {roles.length === 0 && (
            <div style={{ padding: '12px 8px', fontSize: '.65rem', color: t.red, lineHeight: 1.6 }}>
              No roles found. Run the SQL setup in Supabase to seed the roles table.
            </div>
          )}
          {roles.map(r => {
            const permCount  = rolePerms[r.name]?.size || 0
            const uCount     = userCountByRole[r.name] || 0
            const isSelected = selected === r.name
            return (
              <div key={r.name}
                onClick={() => { setSelected(r.name); setRightTab('perms'); setSearch('') }}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: isSelected ? `${r.color}15` : 'transparent', border: `1px solid ${isSelected ? r.color + '40' : 'transparent'}`, transition: 'all .15s', position: 'relative' }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = t.card }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}>
                <ColorDot color={r.color} size={8} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.73rem', color: isSelected ? r.color : t.text2, fontWeight: isSelected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                  <div style={{ display: 'flex', gap: 7, marginTop: 2, alignItems: 'center' }}>
                    {r.is_system && <span style={{ fontSize: '.48rem', color: t.text4, letterSpacing: '.06em' }}>SYSTEM</span>}
                    <span style={{ fontSize: '.52rem', color: t.text4, fontFamily: 'ui-monospace,monospace' }}>{permCount}/{TOTAL_PERMS}</span>
                    {uCount > 0 && <span style={{ fontSize: '.52rem', color: isSelected ? r.color : t.text4 }}>· {uCount}u</span>}
                  </div>
                </div>
                {dirty[r.name] && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.gold, flexShrink: 0 }} title="Unsaved changes" />}
              </div>
            )
          })}
        </div>

        {/* ── Right: Permission tree ── */}
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.75rem' }}>Select a role to configure</div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden', minHeight: 0 }}>

            {/* Role header */}
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <ColorDot color={selectedRole?.color} size={12} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '.9rem', fontWeight: 700, color: t.text1 }}>{selectedRole?.label}</span>
                <span style={{ fontSize: '.58rem', color: t.text4, marginLeft: 10, fontFamily: 'ui-monospace,monospace' }}>{selected}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {saveMsg && <span style={{ fontSize: '.65rem', color: saveMsg.startsWith('Error') ? t.red : t.green, fontWeight: 600 }}>{saveMsg}</span>}
                {isDirty && !saving && <span style={{ fontSize: '.6rem', color: t.gold }}>Unsaved</span>}
                <button onClick={openEdit} title="Edit role name / color" style={{ padding: '6px 10px', borderRadius: 7, fontSize: '.68rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border}`, color: t.text3 }}>✏️</button>
                <button onClick={save} disabled={saving || !isDirty} style={{ padding: '7px 18px', borderRadius: 7, fontSize: '.7rem', fontWeight: 600, cursor: isDirty ? 'pointer' : 'default', background: isDirty ? t.gold : t.card2, color: isDirty ? '#000' : t.text4, border: `1px solid ${isDirty ? t.gold : t.border}`, transition: 'all .2s' }}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                {!selectedRole?.is_system && (
                  <button onClick={() => setConfirmDelete(selected)} style={{ padding: '7px 12px', borderRadius: 7, fontSize: '.65rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.redDim}`, color: t.red }}>Delete</button>
                )}
              </div>
            </div>

            {/* Tab bar: Permissions | Users */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.card2, flexShrink: 0 }}>
              {[
                { key: 'perms', label: `Permissions (${selectedPerms.size}/${TOTAL_PERMS})` },
                { key: 'users', label: `Users (${roleUsers.length})` },
              ].map(tab => (
                <button key={tab.key} onClick={() => setRightTab(tab.key)} style={{
                  padding: '10px 20px', fontSize: '.65rem', cursor: 'pointer', border: 'none',
                  background: rightTab === tab.key ? t.card : 'transparent',
                  color: rightTab === tab.key ? t.text1 : t.text3,
                  fontWeight: rightTab === tab.key ? 600 : 400,
                  borderBottom: rightTab === tab.key ? `2px solid ${t.gold}` : '2px solid transparent',
                  transition: 'all .15s', letterSpacing: '.03em',
                }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ══ PERMISSIONS TAB ════════════════════════════════════════════ */}
            {rightTab === 'perms' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${t.border}`, background: t.card2, flexShrink: 0, flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
                    <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: '.7rem', color: t.text4, pointerEvents: 'none' }}>🔍</span>
                    <input
                      type="text"
                      placeholder="Search permissions..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      style={{ width: '100%', background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, padding: '6px 10px 6px 28px', fontSize: '.65rem', color: t.text1, outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => e.target.style.borderColor = t.gold}
                      onBlur={e => e.target.style.borderColor = t.border}
                    />
                    {search && (
                      <span onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: t.text4, fontSize: '.7rem' }}>✕</span>
                    )}
                  </div>
                  <select value={copyFrom} onChange={e => copyFromRole(e.target.value)}
                    style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, padding: '6px 10px', fontSize: '.65rem', color: t.text3, cursor: 'pointer', outline: 'none' }}>
                    <option value="">Copy from role...</option>
                    {roles.filter(r => r.name !== selected).map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                  </select>
                  <button onClick={resetToDefaults} title="Reset to defaults"
                    style={{ padding: '6px 12px', borderRadius: 6, fontSize: '.62rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, whiteSpace: 'nowrap' }}>
                    ↺ Defaults
                  </button>
                </div>

                {/* ── Search results ── */}
                {searchResults ? (
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {searchResults.length === 0 ? (
                      <div style={{ padding: 32, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No permissions matching "{search}"</div>
                    ) : (
                      <>
                        <div style={{ padding: '8px 20px 4px', fontSize: '.58rem', color: t.text4, letterSpacing: '.08em' }}>
                          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                        </div>
                        {searchResults.map(({ node, path }) => {
                          const on = selectedPerms.has(node.key)
                          return (
                            <div key={node.key}
                              onClick={() => toggleKey(node.key)}
                              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${t.border}18`, cursor: 'pointer', transition: 'background .12s' }}
                              onMouseEnter={e => e.currentTarget.style.background = t.card2}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <TriCheckbox state={on ? 'on' : 'off'} onClick={() => toggleKey(node.key)} t={t} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '.73rem', color: on ? t.text1 : t.text3, fontWeight: on ? 500 : 400 }}>{node.label}</div>
                                <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 2 }}>{node.desc}</div>
                                <div style={{ fontSize: '.52rem', color: t.text4, opacity: .6, marginTop: 2 }}>
                                  {path.slice(0, -1).join(' › ')}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                ) : (
                  /* ── Permission Tree ── */
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {visibleRows.map(({ node, depth, id, isLeaf }) => {
                      const ds       = DEPTH_STYLES[Math.min(depth, DEPTH_STYLES.length - 1)]
                      const state    = nodeState(node, selectedPerms)
                      const isExp    = !isLeaf && expanded.has(id)
                      const keyCount = getAllKeys(node).length
                      const onCount  = getAllKeys(node).filter(k => selectedPerms.has(k)).length

                      // Visual treatment by depth
                      const isModule    = depth === 0
                      const isPage      = depth === 1
                      const isTab       = depth === 2
                      const isElement   = isLeaf

                      const rowBg = isModule
                        ? (state === 'on' ? `${selectedRole?.color || t.gold}10` : 'transparent')
                        : 'transparent'

                      const borderTop = isModule && !isLeaf ? `1px solid ${t.border}` : 'none'

                      return (
                        <div
                          key={id}
                          style={{
                            display: 'flex', alignItems: 'center',
                            paddingLeft: ds.indent + 16,
                            paddingRight: 20,
                            paddingTop: isModule ? 13 : isPage ? 10 : isTab ? 8 : 8,
                            paddingBottom: isModule ? 13 : isPage ? 10 : isTab ? 8 : 8,
                            borderTop,
                            background: rowBg,
                            cursor: 'pointer',
                            transition: 'background .1s',
                            gap: 10,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = isModule ? `${t.gold}08` : t.card2}
                          onMouseLeave={e => e.currentTarget.style.background = rowBg}
                          onClick={() => {
                            if (!isLeaf) toggleExpand(id)
                          }}
                        >
                          {/* Expand arrow — only for non-leaf nodes */}
                          <span style={{
                            width: 14, flexShrink: 0,
                            fontSize: '.6rem', color: t.text4,
                            opacity: isLeaf ? 0 : 1,
                            transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform .15s',
                            userSelect: 'none',
                          }}>▶</span>

                          {/* Module icon for top-level */}
                          {isModule && node.icon && (
                            <span style={{ fontSize: '1rem', flexShrink: 0, opacity: .8 }}>{node.icon}</span>
                          )}

                          {/* Tristate checkbox */}
                          <TriCheckbox
                            state={state}
                            onClick={() => toggleNode(node)}
                            t={t}
                          />

                          {/* Label + desc */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                fontSize: ds.fontSize,
                                fontWeight: ds.fontWeight,
                                color: state !== 'off' ? t.text1 : isModule ? t.text2 : t.text3,
                                letterSpacing: isModule ? '.04em' : 0,
                              }}>
                                {node.label}
                              </span>
                              {/* Permission key badge for pages/tabs */}
                              {(isPage || isTab) && node.key && (
                                <span style={{ fontSize: '.5rem', color: t.text4, fontFamily: 'ui-monospace,monospace', opacity: .7 }}>{node.key}</span>
                              )}
                            </div>
                            {/* Description on leaf elements */}
                            {isElement && node.desc && (
                              <div style={{ fontSize: '.59rem', color: t.text4, marginTop: 1, lineHeight: 1.4 }}>{node.desc}</div>
                            )}
                            {/* Module description */}
                            {isModule && node.desc && (
                              <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 2 }}>{node.desc}</div>
                            )}
                          </div>

                          {/* Count badge for non-leaf */}
                          {!isLeaf && keyCount > 0 && (
                            <span style={{
                              fontSize: '.52rem',
                              fontFamily: 'ui-monospace,monospace',
                              color: state !== 'off' ? t.gold : t.text4,
                              background: state !== 'off' ? t.goldDim : `${t.border2}60`,
                              borderRadius: 10,
                              padding: '2px 7px',
                              flexShrink: 0,
                              fontWeight: 600,
                              transition: 'all .15s',
                            }}>
                              {onCount}/{keyCount}
                            </span>
                          )}
                        </div>
                      )
                    })}
                    <div style={{ height: 24 }} />
                  </div>
                )}
              </div>
            )}

            {/* ══ USERS TAB ══════════════════════════════════════════════════ */}
            {rightTab === 'users' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {roleUsers.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', opacity: .3, marginBottom: 12 }}>👤</div>
                    <div style={{ fontSize: '.78rem', color: t.text3 }}>No users assigned to this role</div>
                    <div style={{ fontSize: '.62rem', color: t.text4, marginTop: 6 }}>Assign from the User Management page</div>
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '10px 20px 6px', fontSize: '.6rem', color: t.text4, letterSpacing: '.08em' }}>
                      {roleUsers.length} user{roleUsers.length !== 1 ? 's' : ''} with this role
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 8, padding: '8px 20px', background: t.card2, borderBottom: `1px solid ${t.border}`, borderTop: `1px solid ${t.border}` }}>
                      {['Name', 'Email', 'Status'].map(h => (
                        <span key={h} style={{ fontSize: '.55rem', color: t.text3, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</span>
                      ))}
                    </div>
                    {roleUsers.map(u => (
                      <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 8, padding: '11px 20px', borderBottom: `1px solid ${t.border}18`, alignItems: 'center' }}>
                        <span style={{ fontSize: '.73rem', color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || '—'}</span>
                        <span style={{ fontSize: '.67rem', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                        <span style={{ fontSize: '.58rem', padding: '2px 8px', borderRadius: 10, background: u.is_active ? t.greenDim : t.redDim, color: u.is_active ? t.green : t.red, textAlign: 'center', fontWeight: 600 }}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

          </div>
        )}
      </div>

      {/* ══ MODALS ════════════════════════════════════════════════════════════ */}

      {/* Add Role */}
      {showAdd && (
        <Modal t={t} onClose={() => { setShowAdd(false); setAddErr(null) }}>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: t.text1 }}>Create New Role</div>
          <Field t={t} label="Display Label">
            <Inp t={t} value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Branch Manager" autoFocus />
          </Field>
          <Field t={t} label="Role Key (auto-generated if blank)">
            <Inp t={t} value={newName} onChange={e => setNewName(e.target.value)} placeholder={newLabel ? newLabel.toLowerCase().replace(/\s+/g, '_') : 'role_key'} />
          </Field>
          <Field t={t} label="Color"><ColorPicker value={newColor} onChange={setNewColor} t={t} /></Field>
          {addErr && <div style={{ fontSize: '.65rem', color: t.red }}>{addErr}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowAdd(false); setAddErr(null) }} style={{ padding: '8px 18px', borderRadius: 7, fontSize: '.72rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3 }}>Cancel</button>
            <button onClick={addRole} disabled={adding || !newLabel.trim()} style={{ padding: '8px 18px', borderRadius: 7, fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', background: t.gold, color: '#000', border: 'none', opacity: adding ? .6 : 1 }}>
              {adding ? 'Creating...' : 'Create Role'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Role */}
      {showEdit && (
        <Modal t={t} onClose={() => { setShowEdit(false); setEditErr(null) }}>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: t.text1 }}>Edit Role</div>
          <Field t={t} label="Display Label">
            <Inp t={t} value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus />
          </Field>
          <Field t={t} label="Color"><ColorPicker value={editColor} onChange={setEditColor} t={t} /></Field>
          {editErr && <div style={{ fontSize: '.65rem', color: t.red }}>{editErr}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowEdit(false); setEditErr(null) }} style={{ padding: '8px 18px', borderRadius: 7, fontSize: '.72rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3 }}>Cancel</button>
            <button onClick={saveEdit} disabled={editing || !editLabel.trim()} style={{ padding: '8px 18px', borderRadius: 7, fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', background: t.gold, color: '#000', border: 'none', opacity: editing ? .6 : 1 }}>
              {editing ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete Confirm */}
      {confirmDelete && (() => {
        const role     = roles.find(r => r.name === confirmDelete)
        const uCount   = userCountByRole[confirmDelete] || 0
        return (
          <Modal t={t} onClose={() => setConfirmDelete(null)} width={380}>
            <div style={{ fontSize: '.9rem', fontWeight: 700, color: t.red }}>Delete Role?</div>
            <div style={{ fontSize: '.75rem', color: t.text2, lineHeight: 1.6 }}>
              You are about to permanently delete <strong style={{ color: t.text1 }}>{role?.label}</strong>.
              {uCount > 0 && (
                <><br /><span style={{ color: t.red }}>{uCount} user{uCount !== 1 ? 's' : ''} currently have this role.</span> They will need to be reassigned.</>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: '8px 18px', borderRadius: 7, fontSize: '.72rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3 }}>Cancel</button>
              <button onClick={confirmAndDelete} style={{ padding: '8px 18px', borderRadius: 7, fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', background: t.red, color: '#fff', border: 'none' }}>Delete</button>
            </div>
          </Modal>
        )
      })()}

    </div>
  )
}
