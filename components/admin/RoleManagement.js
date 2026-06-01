'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { openAlert } from '../ui/ConfirmDialog'

// ── Local role defaults ────────────────────────────────────────────────────────
const _ROLE_PAGES = {
  super_admin:     ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot','gold-buying-rate'],
  founders_office: ['dashboard','purchase-data','purchase-reports','consignment-overview','consignment-data','consignment-report','consignment-summary','melting','sales','cal-table','live-market-rates','reports','branch-management','branch-employees','user-management','company-settings','consignment-seeds','import-logs','inbound-bot','gold-buying-rate'],
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
  dark:  { bg: '#0e0e0e', surface: '#111', card: '#141414', card2: '#1a1a1a', card3: '#0f0f0f', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', goldDim: '#c9a84c22', border: '#2a2a2a', border2: '#333', green: '#3aaa6a', greenDim: '#3aaa6a20', red: '#e05555', redDim: '#e0555520', blue: '#3a8fbf' },
  light: { bg: '#f5f0e8', surface: '#ede8dc', card: '#faf7f2', card2: '#e4dfd3', card3: '#f0ece4', text1: '#1a1208', text2: '#3a2a10', text3: '#8a7a5a', text4: '#b0a080', gold: '#9a7228', goldDim: '#9a722822', border: '#e0dace', border2: '#d0c8b8', green: '#2a8a5a', greenDim: '#2a8a5a20', red: '#cc3333', redDim: '#cc333320', blue: '#2a6fa0' },
}

// ── Permission tree ───────────────────────────────────────────────────────────
const PERM_TREE = [
  {
    label: 'Dashboard', icon: '◈',
    key: 'page.dashboard',
    children: [
      { key: 'element.dashboard.kpi_cards',       label: 'KPI Cards',       desc: 'Animated today-totals strip' },
      { key: 'element.dashboard.period_selector',  label: 'Period Selector', desc: 'Today / Week / MTD / YTD switcher' },
      { key: 'element.dashboard.state_table',      label: 'State Summary',   desc: 'State-wise breakdown table' },
      { key: 'element.dashboard.top_branches',     label: 'Top Branches',    desc: 'Branch performance ranking' },
      { key: 'element.dashboard.region_cards',     label: 'Region Cards',    desc: 'Region distribution cards' },
    ],
  },
  {
    label: 'Purchases', icon: '◉',
    children: [
      {
        // Live Data Feed — its own sub-module since the Purchase split.
        // The livefeed.* element toggles moved here from the old
        // tab.purchase-data.live node.
        key: 'page.purchase-live', label: 'Live Data Feed',
        children: [
          { key: 'livefeed.summary_bar',      label: 'Summary Bar',       desc: 'Top strip: total customers, weight, value' },
          { key: 'livefeed.customer_journey',  label: 'Customer Journey',  desc: 'Walk-in → Billed → Purchased funnel' },
          { key: 'livefeed.weight_flow',       label: 'Gold Weight Flow',  desc: 'Weight breakdown strip by type' },
          { key: 'livefeed.region_filter',     label: 'Region Filter',     desc: 'Dropdown to filter by region' },
          { key: 'livefeed.region_breakdown',  label: 'Region Breakdown',  desc: 'Region-wise stats table' },
          { key: 'livefeed.detail_table',      label: 'Detail Drill-down', desc: 'Expandable records table' },
          { key: 'livefeed.timeline',          label: 'Live Timeline',     desc: 'Real-time event feed' },
          { key: 'livefeed.date_picker',       label: 'Date Picker',       desc: 'View historical dates' },
          { key: 'livefeed.old_crm_tab',       label: 'Old CRM Tab',       desc: 'Old CRM pipeline data' },
          { key: 'livefeed.new_crm_tab',       label: 'New CRM Tab',       desc: 'New CRM pipeline data' },
          { key: 'livefeed.csv_export',        label: 'CSV Export',        desc: 'Download CSV from tables' },
        ],
      },
      {
        // Master Purchase Data — the approved purchase records table,
        // now its own page (was the tab.purchase-data.approved tab).
        key: 'page.purchase-data', label: 'Master Purchase Data',
        desc: 'Approved purchase records table',
      },
      {
        key: 'page.purchase-reports', label: 'Purchase Reports & Analytics',
        children: [
          {
            key: 'tab.purchase-reports.analytics', label: 'Analytics',
            children: [
              { key: 'element.reports.charts',         label: 'Charts',                desc: 'Line, bar, pie graphs' },
              { key: 'element.reports.branch_table',   label: 'Branch Performance',    desc: 'Branch-wise stats table' },
              { key: 'element.reports.distribution',   label: 'Distribution Analysis', desc: 'Weight & value distribution' },
              { key: 'element.reports.crm_insights',   label: 'CRM Insights',          desc: 'CRM pipeline section' },
              { key: 'element.reports.same_day',       label: 'Same-Day Trends',       desc: 'Intraday patterns' },
              { key: 'element.reports.period_compare', label: 'Period Compare',        desc: 'Compare two date ranges' },
            ],
          },
          {
            key: 'tab.purchase-reports.intelligence', label: 'Intelligence',
            children: [
              { key: 'element.intelligence.branch_health',    label: 'Branch Health',    desc: 'Per-branch health metrics' },
              { key: 'element.intelligence.repeat_customers', label: 'Repeat Customers', desc: 'Customer retention analysis' },
              { key: 'element.intelligence.alerts',           label: 'Alerts',           desc: 'Threshold breach alerts' },
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
          { key: 'element.consignment-overview.region_cards', label: 'Region Summary Cards', desc: 'Per-region flashcard row' },
          { key: 'element.consignment-overview.search',       label: 'Search Bar',           desc: 'Search by branch name' },
          { key: 'element.consignment-overview.sort',         label: 'Sort Controls',        desc: 'Sort by weight, age, urgency' },
          { key: 'element.consignment-overview.table',        label: 'Branch Stock Table',   desc: 'Full branch-wise stock table' },
        ],
      },
      { key: 'page.consignment-data',      label: 'Consignment Data',   desc: 'Detailed consignment records' },
      { key: 'page.consignment-approvals', label: 'Pending Approvals',  desc: 'Accounts approval queue (EWB/E-Invoice generation, approve/reject)' },
      { key: 'page.consignment-report',    label: 'Consignment Report', desc: 'Consignment analytics charts' },
      { key: 'page.consignment-summary',   label: 'Movement Report',    desc: 'Stock movement summary' },
      { key: 'page.consignment-bidding',   label: 'Bidding Volume',     desc: 'Volume expected at HO per day for bid desk planning' },
      { key: 'page.eod-stock-report',      label: 'EOD Stock Report',   desc: 'Daily 23:30 IST inventory snapshots — at-branch + in-transit by region and branch' },
      { key: 'page.audit-data',            label: 'Audit Data',         desc: 'At-HO weight check on inbound bills; flips stock_status to at_ho' },
      { key: 'page.audit-roster',          label: 'Audit Roster',       desc: 'Night/morning audit shifts + audit history + auditors list' },
      { key: 'page.audit-report',          label: 'Audit Report',       desc: 'Historical audit log + per-auditor and per-branch breakdown' },
      { key: 'page.consignment-analytics', label: 'Movement Analytics', desc: 'Inter-branch movement charts' },
    ],
  },
  {
    label: 'Melting', icon: '🔥',
    key: 'page.melting',
    children: [],
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
      { key: 'page.gold-buying-rate',  label: 'Gold Buying Rate',   desc: 'Live buying rates per state from new CRM' },
      { key: 'page.logistics',         label: 'Logistics',          desc: 'Per-branch courier partner, pickup time, delivery TAT' },
      { key: 'page.consignment-seeds', label: 'Consignment Seeds',  desc: 'Test seed data management' },
      { key: 'page.import-logs',       label: 'Import Logs',        desc: 'Data import history and status' },
    ],
  },
  {
    label: 'Actions', icon: '⚡',
    desc: 'System-level operations',
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
function getAllKeys(node) {
  const keys = []
  if (node.key) keys.push(node.key)
  if (node.children) node.children.forEach(c => keys.push(...getAllKeys(c)))
  return keys
}

// Map each key → ancestor page.* keys so enabling a child auto-enables its parent pages
const KEY_PAGE_ANCESTORS = {}
function buildAncestorMap(nodes, ancestorPageKeys = []) {
  for (const node of nodes) {
    const pageKeys = node.key?.startsWith('page.') ? [...ancestorPageKeys, node.key] : ancestorPageKeys
    if (node.key) KEY_PAGE_ANCESTORS[node.key] = pageKeys
    if (node.children?.length) buildAncestorMap(node.children, pageKeys)
  }
}
buildAncestorMap(PERM_TREE)

// Map each page.* key → all non-page descendant keys (for auto-disable when last child removed)
const PAGE_DESCENDANTS = {}
function buildPageDescendants(nodes, currentPage = null) {
  for (const node of nodes) {
    const pg = node.key?.startsWith('page.') ? node.key : currentPage
    if (node.key && pg && node.key !== pg) {
      if (!PAGE_DESCENDANTS[pg]) PAGE_DESCENDANTS[pg] = []
      PAGE_DESCENDANTS[pg].push(node.key)
    }
    if (node.children?.length) buildPageDescendants(node.children, pg)
  }
}
buildPageDescendants(PERM_TREE)

const ALL_TREE_KEYS = PERM_TREE.flatMap(getAllKeys)
const TOTAL_PERMS   = ALL_TREE_KEYS.length

function nodeState(node, enabled) {
  const keys = getAllKeys(node)
  if (!keys.length) return 'off'
  const onCount = keys.filter(k => enabled.has(k)).length
  if (onCount === 0) return 'off'
  if (onCount === keys.length) return 'on'
  return 'partial'
}

function buildDefaults(roleName) {
  const pages        = _ROLE_PAGES[roleName]        || []
  const restrictions = _ROLE_RESTRICTIONS[roleName] || []
  const pageKeySet   = new Set(pages.map(p => 'page.' + p))
  const perms        = new Set()
  function traverse(node) {
    if (node.key && node.key.startsWith('page.') && pageKeySet.has(node.key)) {
      getAllKeys(node).forEach(k => perms.add(k)); return
    }
    if (node.children) node.children.forEach(traverse)
  }
  PERM_TREE.forEach(traverse)
  const ACTIONS = ['delete', 'edit', 'import', 'export', 'sync_crm']
  ACTIONS.forEach(a => { if (!restrictions.includes(a)) perms.add('action.' + a) })
  return perms
}

function flattenVisible(nodes, expanded, depth = 0) {
  const result = []
  nodes.forEach(node => {
    const nodeId = node.key || ('__' + node.label)
    const isLeaf = !node.children || node.children.length === 0
    result.push({ node, depth, id: nodeId, isLeaf })
    if (!isLeaf && node.children.length > 0 && expanded.has(nodeId)) {
      result.push(...flattenVisible(node.children, expanded, depth + 1))
    }
  })
  return result
}

function searchTree(nodes, q, path = []) {
  const results = []
  nodes.forEach(node => {
    const currentPath = [...path, node.label]
    const isLeaf = !node.children || node.children.length === 0
    if (isLeaf && node.key) {
      const hay = (node.label + ' ' + (node.desc || '') + ' ' + node.key).toLowerCase()
      if (hay.includes(q)) results.push({ node, path: currentPath })
    } else if (node.children) results.push(...searchTree(node.children, q, currentPath))
  })
  return results
}

// Collect all leaf nodes for filter mode (flat list)
function collectLeaves(nodes, path = []) {
  const results = []
  nodes.forEach(node => {
    const currentPath = [...path, node.label]
    const isLeaf = !node.children || node.children.length === 0
    if (isLeaf && node.key) results.push({ node, path: currentPath })
    else if (node.children) results.push(...collectLeaves(node.children, currentPath))
  })
  return results
}
const ALL_LEAVES = collectLeaves(PERM_TREE)

// ── Backward-compat export ────────────────────────────────────────────────────
export const PERMISSION_REGISTRY = [
  {
    group: 'Pages & Modules', icon: '⬜', desc: 'Which pages are visible in the sidebar',
    items: [
      { key: 'page.dashboard',            label: 'Dashboard',           desc: 'Main overview' },
      { key: 'page.purchase-data',        label: 'Purchases',           desc: 'Live Feed + Purchase Data tabs' },
      { key: 'page.purchase-reports',     label: 'Purchase Reports',    desc: 'Analytics and charts' },
      { key: 'page.consignment-overview',  label: 'Branch Stock',        desc: 'Consignment overview' },
      { key: 'page.consignment-data',      label: 'Consignment Data',    desc: 'Detailed consignment records' },
      { key: 'page.consignment-approvals', label: 'Pending Approvals',   desc: 'Accounts approval queue' },
      { key: 'page.consignment-report',    label: 'Consignment Report',  desc: 'Consignment analytics' },
      { key: 'page.consignment-summary',   label: 'Movement Report',     desc: 'Stock movement summary' },
      { key: 'page.consignment-bidding',   label: 'Bidding Volume',      desc: 'Volume expected at HO per day' },
      { key: 'page.eod-stock-report',      label: 'EOD Stock Report',    desc: 'Daily inventory snapshots by region + branch' },
      { key: 'page.audit-data',            label: 'Audit Data',          desc: 'At-HO weight check on inbound bills' },
      { key: 'page.audit-roster',          label: 'Audit Roster',        desc: 'Two-shift audit workflow + history + auditors' },
      { key: 'page.audit-report',          label: 'Audit Report',        desc: 'Historical audit log + breakdown' },
      { key: 'page.consignment-analytics', label: 'Movement Analytics',  desc: 'Inter-branch movement charts' },
      { key: 'page.melting',              label: 'Melting',             desc: 'Gold melting module' },
      { key: 'page.cal-table',            label: 'Cal Table',           desc: 'Sales calculation table' },
      { key: 'page.live-market-rates',    label: 'Live Market Rates',   desc: 'Gold rate tracking' },
      { key: 'page.branch-management',    label: 'Branch Management',   desc: 'Admin: manage branches' },
      { key: 'page.branch-employees',     label: 'Branch Employees',    desc: 'Admin: employee records' },
      { key: 'page.user-management',      label: 'User Management',     desc: 'Admin: manage app users' },
      { key: 'page.company-settings',     label: 'Company Settings',    desc: 'Admin: company config' },
      { key: 'page.gold-buying-rate',     label: 'Gold Buying Rate',    desc: 'Admin: live buying rates per state' },
      { key: 'page.logistics',            label: 'Logistics',           desc: 'Admin: per-branch courier config' },
      { key: 'page.consignment-seeds',    label: 'Consignment Seeds',   desc: 'Admin: seed data' },
      { key: 'page.import-logs',          label: 'Import Logs',         desc: 'Admin: data import history' },
      { key: 'page.inbound-bot',          label: 'Inbound Bot Testing', desc: 'Telesales bot testing' },
    ],
  },
  {
    group: 'Live Feed Elements', icon: '📡', desc: 'Granular visibility inside the Live Feed',
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
    group: 'Actions', icon: '⚡', desc: 'What operations each role can perform',
    items: [
      { key: 'action.delete',   label: 'Delete Records',    desc: 'Permanently delete data' },
      { key: 'action.edit',     label: 'Edit / Modify',     desc: 'Edit existing records' },
      { key: 'action.import',   label: 'Import Data',       desc: 'Bulk import operations' },
      { key: 'action.export',   label: 'Export / Download', desc: 'Download reports and CSV' },
      { key: 'action.sync_crm', label: 'Sync CRM',          desc: 'Trigger manual CRM sync' },
    ],
  },
]

// ── UI helpers ────────────────────────────────────────────────────────────────

function TriCheckbox({ state, onClick, size = 18, t }) {
  const isOn = state === 'on', isPartial = state === 'partial'
  return (
    <div onClick={e => { e.stopPropagation(); onClick() }} style={{
      width: size, height: size, borderRadius: size * .25, cursor: 'pointer', flexShrink: 0,
      border: `2px solid ${isOn ? t.gold : isPartial ? t.gold : t.border2}`,
      background: isOn ? t.gold : isPartial ? t.goldDim : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'border-color .15s, background .15s', boxSizing: 'border-box',
    }}>
      {isOn      && <span style={{ color: '#000', fontSize: size * .58, fontWeight: 900, lineHeight: 1, userSelect: 'none' }}>✓</span>}
      {isPartial && <span style={{ color: t.gold, fontSize: size * .72, fontWeight: 900, lineHeight: 1, userSelect: 'none', marginTop: -1 }}>−</span>}
    </div>
  )
}

function ColorDot({ color, size = 10 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

function Modal({ t, onClose, children, width = 420 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: 16, padding: 28, width, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 64px rgba(0,0,0,.5)' }}>
        {children}
      </div>
    </div>
  )
}

function Field({ t, label, children }) {
  return (
    <div>
      <label style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: 6, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

function Inp({ t, ...props }) {
  return (
    <input {...props}
      style={{ width: '100%', background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 8, padding: '10px 13px', fontSize: '.8rem', color: t.text1, outline: 'none', boxSizing: 'border-box', ...props.style }}
      onFocus={e => e.target.style.borderColor = t.gold}
      onBlur={e => e.target.style.borderColor = t.border2} />
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
        style={{ width: 26, height: 26, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0, background: 'none' }} title="Custom" />
    </div>
  )
}

/* ── Coverage pill ─────────────────────────────────────────────────────────── */
function CoveragePill({ onCount, total, state, t }) {
  const pct = total > 0 ? Math.round(onCount / total * 100) : 0
  const color = state === 'on' ? t.gold : state === 'partial' ? t.gold : t.text4
  const bg    = state !== 'off' ? t.goldDim : `${t.border}60`
  const border = state !== 'off' ? `1px solid ${t.gold}40` : `1px solid ${t.border}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {/* mini progress bar */}
      <div style={{ width: 40, height: 3, background: t.border2, borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .25s' }} />
      </div>
      <span style={{ fontSize: '.56rem', fontFamily: 'ui-monospace,monospace', color, fontWeight: 700, background: bg, border, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>
        {onCount}/{total}
      </span>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
                              MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

export default function RoleManagement() {
  const { theme, loadPermissionsForRole, role: myRole, previewRole, setPreviewRole } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isMobile = useMobile()

  const [roles,      setRoles]      = useState([])
  const [rolePerms,  setRolePerms]  = useState({})
  const [dirty,      setDirty]      = useState({})
  const [selected,   setSelected]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [loadErr,    setLoadErr]    = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [saveMsg,    setSaveMsg]    = useState(null)
  const [users,      setUsers]      = useState([])
  const [rightTab,   setRightTab]   = useState('perms')

  const [expanded, setExpanded] = useState(() => {
    const s = new Set()
    PERM_TREE.forEach(n => s.add(n.key || ('__' + n.label)))
    return s
  })

  const [search,     setSearch]     = useState('')
  const [permFilter, setPermFilter] = useState('all')  // 'all' | 'enabled' | 'disabled'
  const [copyFrom,   setCopyFrom]   = useState('')

  const [showAdd,  setShowAdd]  = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newName,  setNewName]  = useState('')
  const [newColor, setNewColor] = useState('#3aaa6a')
  const [adding,   setAdding]   = useState(false)
  const [addErr,   setAddErr]   = useState(null)

  const [showEdit,  setShowEdit]  = useState(false)
  const [editLabel, setEditLabel] = useState('')
  const [editColor, setEditColor] = useState('#c9a84c')
  const [editing,   setEditing]   = useState(false)
  const [editErr,   setEditErr]   = useState(null)

  const [confirmDelete, setConfirmDelete] = useState(null)

  /* ── Load ─────────────────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true); setLoadErr(null)
    try {
      const [rbacRes, { data: userRows }] = await Promise.all([
        authedFetch('/api/rbac?action=all').then(r => r.json()),
        supabase.from('user_profiles').select('id, full_name, email, role, is_active').order('full_name'),
      ])
      if (rbacRes.error) throw new Error(rbacRes.error)
      if (!rbacRes.roles) throw new Error('No roles returned')

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
          for (const k of dbKeys) { if (dbEnabled.has(k)) merged.add(k); else merged.delete(k) }
          permsMap[roleName] = merged
        }
      }
      setRoles(rbacRes.roles); setRolePerms(permsMap); setDirty({})
      setUsers(userRows || [])
      if (!selected && rbacRes.roles.length > 0) setSelected(rbacRes.roles[0].name)
    } catch (e) {
      setLoadErr(e.stack || e.message || String(e))
    } finally { setLoading(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  /* ── Derived ──────────────────────────────────────────────────────────────── */
  const selectedRole  = roles.find(r => r.name === selected)
  const selectedPerms = rolePerms[selected] || new Set()
  const isDirty       = dirty[selected] || false

  const userCountByRole = useMemo(() => {
    const map = {}
    for (const u of users) map[u.role] = (map[u.role] || 0) + 1
    return map
  }, [users])

  const roleUsers     = useMemo(() => users.filter(u => u.role === selected), [users, selected])

  // Validation warnings — shown when role has unsaved dirty changes
  const saveWarnings  = useMemo(() => {
    if (!isDirty) return []
    const ws = []
    const enabledPageCount = ALL_TREE_KEYS.filter(k => k.startsWith('page.') && selectedPerms.has(k)).length
    if (selectedPerms.size === 0)
      ws.push({ type: 'error', msg: 'No permissions selected. Users with this role will see a blank screen.' })
    else if (enabledPageCount === 0)
      ws.push({ type: 'warn', msg: 'No pages are enabled. Users will have no sidebar navigation.' })
    if (roleUsers.length > 0)
      ws.push({ type: 'info', msg: `${roleUsers.length} user${roleUsers.length > 1 ? 's' : ''} with this role will be affected immediately on save` })
    return ws
  }, [isDirty, selectedPerms, roleUsers])

  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    return searchTree(PERM_TREE, search.toLowerCase())
  }, [search])

  const filterResults = useMemo(() => {
    if (permFilter === 'all') return null
    return ALL_LEAVES.filter(({ node }) => {
      const on = selectedPerms.has(node.key)
      return permFilter === 'enabled' ? on : !on
    })
  }, [permFilter, selectedPerms])

  const visibleRows   = useMemo(() => flattenVisible(PERM_TREE, expanded), [expanded])

  /* ── Actions ──────────────────────────────────────────────────────────────── */
  function toggleExpand(nodeId) {
    setExpanded(prev => { const n = new Set(prev); n.has(nodeId) ? n.delete(nodeId) : n.add(nodeId); return n })
  }
  function toggleNode(node) {
    const keys = getAllKeys(node)
    if (!keys.length) return
    // off → on; partial → on (select all missing, like a standard indeterminate checkbox); on → off
    const state = nodeState(node, selectedPerms)
    const forceOn = state !== 'on'
    setRolePerms(prev => {
      const next = new Set(prev[selected] || [])
      keys.forEach(k => {
        if (forceOn) {
          next.add(k)
          KEY_PAGE_ANCESTORS[k]?.forEach(pk => next.add(pk))
        } else {
          next.delete(k)
        }
      })
      if (!forceOn) {
        // Auto-disable any page.* key whose last descendant was just removed
        const affectedPages = new Set(keys.flatMap(k => KEY_PAGE_ANCESTORS[k] || []))
        affectedPages.forEach(pk => {
          const descendants = PAGE_DESCENDANTS[pk] || []
          if (!descendants.some(dk => next.has(dk))) next.delete(pk)
        })
      }
      return { ...prev, [selected]: next }
    })
    setDirty(prev => ({ ...prev, [selected]: true }))
  }
  function toggleKey(key) {
    setRolePerms(prev => {
      const next = new Set(prev[selected] || [])
      next.has(key) ? next.delete(key) : next.add(key)
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

  /* ── Save ─────────────────────────────────────────────────────────────────── */
  const save = async () => {
    if (!selected) return
    setSaving(true); setSaveMsg(null)
    try {
      const permissions = ALL_TREE_KEYS.map(key => ({ key, enabled: selectedPerms.has(key) }))
      const res  = await authedFetch('/api/rbac', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_permissions', role_name: selected, permissions }) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setDirty(prev => ({ ...prev, [selected]: false }))
      setSaveMsg('Saved'); setTimeout(() => setSaveMsg(null), 2200)
      if (myRole === selected) loadPermissionsForRole(selected)
      if (previewRole === selected) setPreviewRole(selected)  // refresh preview snapshot
    } catch (e) { setSaveMsg('Error: ' + e.message) } finally { setSaving(false) }
  }

  /* ── Add/Edit/Delete role ─────────────────────────────────────────────────── */
  const addRole = async () => {
    if (!newLabel.trim()) return
    setAdding(true); setAddErr(null)
    try {
      const res  = await authedFetch('/api/rbac', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_role', name: newName || newLabel.toLowerCase().replace(/\s+/g, '_'), label: newLabel, color: newColor }) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setShowAdd(false); setNewLabel(''); setNewName(''); setNewColor('#3aaa6a')
      await load(); setSelected(json.name)
    } catch (e) { setAddErr(e.message) } finally { setAdding(false) }
  }
  const openEdit = () => {
    if (!selectedRole) return
    setEditLabel(selectedRole.label); setEditColor(selectedRole.color || '#c9a84c'); setEditErr(null); setShowEdit(true)
  }
  const saveEdit = async () => {
    if (!editLabel.trim()) return
    setEditing(true); setEditErr(null)
    try {
      const res  = await authedFetch('/api/rbac', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_role', name: selected, label: editLabel.trim(), color: editColor }) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setShowEdit(false); await load()
    } catch (e) { setEditErr(e.message) } finally { setEditing(false) }
  }
  const confirmAndDelete = async () => {
    const name = confirmDelete; setConfirmDelete(null)
    const res  = await authedFetch('/api/rbac', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_role', name }) })
    const json = await res.json()
    if (!json.success) { openAlert({ title: 'Delete role failed', message: json.error }); return }
    await load(); setSelected(null)
  }

  /* ══ RENDER ═══════════════════════════════════════════════════════════════ */
  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: t.text3, fontSize: '.75rem' }}>Loading role configuration...</div>
  if (loadErr)  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ color: t.red, fontSize: '.8rem', marginBottom: 12 }}>Failed to load roles</div>
      <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: '.65rem', color: t.text3, background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 16px', display: 'inline-block', marginBottom: 16 }}>{loadErr}</div>
      <br /><button onClick={load} style={{ padding: '8px 22px', borderRadius: 8, background: t.gold, color: '#000', border: 'none', fontSize: '.72rem', cursor: 'pointer', fontWeight: 600 }}>Retry</button>
    </div>
  )

  const roleColor = selectedRole?.color || t.gold
  const totalOnCount = selectedPerms.size
  const totalPct = Math.round(totalOnCount / TOTAL_PERMS * 100)

  return (
    <div style={{ padding: isMobile ? '16px 14px' : '24px 28px', height: '100%', display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: t.text1, letterSpacing: '.02em' }}>Role Management</div>
          <div style={{ fontSize: '.63rem', color: t.text3, marginTop: 3 }}>
            {roles.length} roles · {users.length} users · {TOTAL_PERMS} configurable permissions
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding: '9px 20px', borderRadius: 9, background: t.gold, color: '#000', fontSize: '.73rem', fontWeight: 700, cursor: 'pointer', border: 'none', letterSpacing: '.04em', boxShadow: `0 2px 12px ${t.gold}40` }}>
          + New Role
        </button>
      </div>

      {/* ── Two-panel layout (stacks vertically on mobile) ── */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 18, flex: 1, minHeight: 0 }}>

        {/* ══ LEFT: Role list — horizontal scroll-strip on mobile, vertical column on desktop ════ */}
        <div style={{
          width: isMobile ? '100%' : 220,
          flexShrink: 0,
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          gap: isMobile ? 6 : 4,
          overflowX: isMobile ? 'auto' : 'visible',
          overflowY: isMobile ? 'visible' : 'auto',
          scrollSnapType: isMobile ? 'x mandatory' : 'none',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          padding: isMobile ? '0 0 4px' : 0,
        }}>
          <div style={{ fontSize: '.52rem', color: t.text4, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, padding: '0 4px 10px' }}>Roles</div>
          {roles.length === 0 && (
            <div style={{ padding: '12px 8px', fontSize: '.65rem', color: t.red, lineHeight: 1.6 }}>
              No roles found. Run the SQL setup to seed the roles table.
            </div>
          )}
          {roles.map(r => {
            const permCount  = rolePerms[r.name]?.size || 0
            const uCount     = userCountByRole[r.name] || 0
            const isSelected = selected === r.name
            const pct        = Math.round(permCount / TOTAL_PERMS * 100)
            return (
              <div key={r.name}
                onClick={() => { setSelected(r.name); setRightTab('perms'); setSearch('') }}
                style={{ padding: '11px 13px', borderRadius: 10, cursor: 'pointer', position: 'relative', transition: 'all .15s', border: `1px solid ${isSelected ? r.color + '50' : t.border}`, background: isSelected ? `${r.color}12` : t.card, flexShrink: isMobile ? 0 : undefined, scrollSnapAlign: isMobile ? 'start' : undefined, minWidth: isMobile ? 180 : undefined }}
                onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderColor = t.border2; e.currentTarget.style.background = t.card2 } }}
                onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.background = t.card } }}>
                {/* Left accent bar */}
                <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: '0 2px 2px 0', background: isSelected ? r.color : 'transparent', transition: 'background .15s' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0, boxShadow: isSelected ? `0 0 6px ${r.color}80` : 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.74rem', color: isSelected ? r.color : t.text2, fontWeight: isSelected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 1, alignItems: 'center' }}>
                      {r.is_system && <span style={{ fontSize: '.45rem', color: t.text4, letterSpacing: '.08em', background: `${t.border}80`, borderRadius: 3, padding: '1px 4px' }}>SYSTEM</span>}
                      <span style={{ fontSize: '.5rem', color: t.text4, fontFamily: 'ui-monospace,monospace' }}>{permCount}/{TOTAL_PERMS}</span>
                      {uCount > 0 && <span style={{ fontSize: '.5rem', color: isSelected ? r.color : t.text4 }}>· {uCount}u</span>}
                    </div>
                  </div>
                  {dirty[r.name] && <div style={{ width: 5, height: 5, borderRadius: '50%', background: t.gold, flexShrink: 0 }} title="Unsaved" />}
                </div>
                {/* Coverage bar */}
                <div style={{ marginTop: 8, marginLeft: 4, height: 2, background: t.border, borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: r.color, borderRadius: 1, opacity: isSelected ? 1 : 0.5, transition: 'width .3s, opacity .2s' }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* ══ RIGHT: Permission editor ════════════════════════════════════ */}
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.75rem' }}>Select a role to configure</div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, overflow: 'hidden', minHeight: 0, boxShadow: `inset 0 0 0 1px ${roleColor}12` }}>

            {/* ── Role header ── */}
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.border}`, background: `linear-gradient(135deg, ${roleColor}10 0%, transparent 60%)`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Role color circle */}
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${roleColor}20`, border: `1px solid ${roleColor}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: roleColor, boxShadow: `0 0 8px ${roleColor}80` }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontSize: '.95rem', fontWeight: 700, color: t.text1 }}>{selectedRole?.label}</span>
                    <span style={{ fontSize: '.57rem', color: t.text4, fontFamily: 'ui-monospace,monospace', background: t.card2, borderRadius: 4, padding: '1px 6px', border: `1px solid ${t.border}` }}>{selected}</span>
                  </div>
                  {/* Coverage bar + percent */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    <div style={{ flex: 1, maxWidth: 180, height: 4, background: t.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${totalPct}%`, background: roleColor, borderRadius: 2, transition: 'width .3s', boxShadow: `0 0 6px ${roleColor}60` }} />
                    </div>
                    <span style={{ fontSize: '.6rem', color: t.text3 }}>{totalOnCount}/{TOTAL_PERMS} permissions <span style={{ color: roleColor, fontWeight: 600 }}>{totalPct}%</span></span>
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {saveMsg && <span style={{ fontSize: '.65rem', color: saveMsg.startsWith('Error') ? t.red : t.green, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: saveMsg.startsWith('Error') ? t.redDim : t.greenDim }}>{saveMsg}</span>}
                  {isDirty && !saving && <span style={{ fontSize: '.6rem', color: t.gold, background: t.goldDim, padding: '3px 8px', borderRadius: 6, border: `1px solid ${t.gold}40` }}>Unsaved</span>}
                  <button onClick={openEdit} title="Edit label / color" style={{ width: 32, height: 32, borderRadius: 8, cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3, fontSize: '.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✏</button>
                  <button onClick={save} disabled={saving || !isDirty} style={{ padding: '7px 20px', borderRadius: 8, fontSize: '.7rem', fontWeight: 700, cursor: isDirty ? 'pointer' : 'default', background: isDirty ? t.gold : t.card2, color: isDirty ? '#000' : t.text4, border: `1px solid ${isDirty ? t.gold : t.border}`, transition: 'all .2s', boxShadow: isDirty ? `0 2px 10px ${t.gold}40` : 'none' }}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  {!selectedRole?.is_system && (
                    <button onClick={() => setConfirmDelete(selected)} style={{ width: 32, height: 32, borderRadius: 8, cursor: 'pointer', background: 'transparent', border: `1px solid ${t.redDim}`, color: t.red, fontSize: '.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🗑</button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Tab bar ── */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.card2, flexShrink: 0 }}>
              {[
                { key: 'perms', label: 'Permissions', badge: `${totalOnCount}/${TOTAL_PERMS}` },
                { key: 'users', label: 'Users',       badge: roleUsers.length },
              ].map(tab => {
                const active = rightTab === tab.key
                return (
                  <button key={tab.key} onClick={() => setRightTab(tab.key)} style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '10px 20px', fontSize: '.68rem', cursor: 'pointer', border: 'none',
                    background: active ? t.card : 'transparent',
                    color: active ? t.text1 : t.text3,
                    fontWeight: active ? 600 : 400,
                    borderBottom: active ? `2px solid ${roleColor}` : '2px solid transparent',
                    transition: 'all .15s',
                  }}>
                    {tab.label}
                    <span style={{ fontSize: '.52rem', background: active ? `${roleColor}22` : t.card, border: `1px solid ${active ? roleColor + '40' : t.border}`, color: active ? roleColor : t.text4, borderRadius: 20, padding: '1px 7px', fontFamily: 'ui-monospace,monospace', fontWeight: 700 }}>{tab.badge}</span>
                  </button>
                )
              })}
            </div>

            {/* ══ PERMISSIONS TAB ══════════════════════════════════════════ */}
            {rightTab === 'perms' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

                {/* ── Validation warnings ── */}
                {saveWarnings.length > 0 && (
                  <div style={{ flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
                    {saveWarnings.map((w, i) => {
                      const colors = {
                        error: { bg: t.redDim,  border: t.red  + '40', icon: '⊘', text: t.red  },
                        warn:  { bg: t.goldDim, border: t.gold + '40', icon: '⚠', text: t.gold },
                        info:  { bg: t.card2,   border: t.border,      icon: 'ℹ', text: t.text3 },
                      }
                      const c = colors[w.type]
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 18px', background: c.bg, borderBottom: i < saveWarnings.length - 1 ? `1px solid ${c.border}` : 'none' }}>
                          <span style={{ fontSize: '.72rem', color: c.text, flexShrink: 0 }}>{c.icon}</span>
                          <span style={{ fontSize: '.63rem', color: c.text, lineHeight: 1.4 }}>{w.msg}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: `1px solid ${t.border}`, background: t.card2, flexShrink: 0, flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '.7rem', color: t.text4, pointerEvents: 'none' }}>🔍</span>
                    <input type="text" placeholder="Search permissions..." value={search} onChange={e => setSearch(e.target.value)}
                      style={{ width: '100%', background: t.card, border: `1px solid ${t.border}`, borderRadius: 7, padding: '7px 10px 7px 30px', fontSize: '.66rem', color: t.text1, outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => e.target.style.borderColor = t.gold} onBlur={e => e.target.style.borderColor = t.border} />
                    {search && <span onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: t.text4, fontSize: '.7rem' }}>✕</span>}
                  </div>
                  <select value={copyFrom} onChange={e => copyFromRole(e.target.value)}
                    style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 7, padding: '7px 10px', fontSize: '.64rem', color: t.text3, cursor: 'pointer', outline: 'none' }}>
                    <option value="">Copy from role...</option>
                    {roles.filter(r => r.name !== selected).map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                  </select>
                  <button onClick={resetToDefaults} style={{ padding: '7px 13px', borderRadius: 7, fontSize: '.63rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3, whiteSpace: 'nowrap', transition: 'all .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = t.gold; e.currentTarget.style.color = t.gold }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = t.border2; e.currentTarget.style.color = t.text3 }}>
                    ↺ Defaults
                  </button>

                  {/* Filter pills */}
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0, background: t.card3, borderRadius: 8, padding: 3, border: `1px solid ${t.border}` }}>
                    {[{ v: 'all', label: 'All' }, { v: 'enabled', label: 'On' }, { v: 'disabled', label: 'Off' }].map(f => (
                      <button key={f.v} onClick={() => setPermFilter(f.v)} style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: '.6rem', fontWeight: permFilter === f.v ? 700 : 400,
                        background: permFilter === f.v ? (f.v === 'enabled' ? t.greenDim : f.v === 'disabled' ? t.card2 : t.gold) : 'transparent',
                        color: permFilter === f.v ? (f.v === 'enabled' ? t.green : f.v === 'disabled' ? t.text3 : '#000') : t.text4,
                        border: 'none', cursor: 'pointer', transition: 'all .12s',
                      }}>{f.label}</button>
                    ))}
                  </div>
                </div>

                {/* ── Filter results ── */}
                {!searchResults && filterResults ? (
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filterResults.length === 0 ? (
                      <div style={{ padding: 40, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>
                        No {permFilter === 'enabled' ? 'enabled' : 'disabled'} permissions
                      </div>
                    ) : (
                      <>
                        <div style={{ padding: '10px 22px 6px', fontSize: '.58rem', color: t.text4, letterSpacing: '.08em' }}>
                          {filterResults.length} permission{filterResults.length !== 1 ? 's' : ''} {permFilter}
                        </div>
                        {filterResults.map(({ node, path }) => {
                          const on = selectedPerms.has(node.key)
                          return (
                            <div key={node.key} onClick={() => toggleKey(node.key)}
                              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 22px', borderBottom: `1px solid ${t.border}20`, cursor: 'pointer', transition: 'background .1s' }}
                              onMouseEnter={e => e.currentTarget.style.background = t.card2}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <TriCheckbox state={on ? 'on' : 'off'} onClick={() => toggleKey(node.key)} t={t} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '.74rem', color: on ? t.text1 : t.text3, fontWeight: on ? 500 : 400 }}>{node.label}</span>
                                {node.desc && <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 2 }}>{node.desc}</div>}
                                <div style={{ fontSize: '.52rem', color: t.text4, opacity: .6, marginTop: 2 }}>{path.slice(0, -1).join(' › ')}</div>
                              </div>
                              <span style={{ fontSize: '.48rem', color: t.text4, fontFamily: 'ui-monospace,monospace', opacity: .6 }}>{node.key}</span>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                ) : null}

                {/* ── Search results ── */}
                {searchResults ? (
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {searchResults.length === 0 ? (
                      <div style={{ padding: 40, textAlign: 'center', color: t.text4, fontSize: '.72rem' }}>No permissions matching "{search}"</div>
                    ) : (
                      <>
                        <div style={{ padding: '10px 22px 6px', fontSize: '.58rem', color: t.text4, letterSpacing: '.08em' }}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</div>
                        {searchResults.map(({ node, path }) => {
                          const on = selectedPerms.has(node.key)
                          return (
                            <div key={node.key} onClick={() => toggleKey(node.key)}
                              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 22px', borderBottom: `1px solid ${t.border}20`, cursor: 'pointer', transition: 'background .1s' }}
                              onMouseEnter={e => e.currentTarget.style.background = t.card2}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <TriCheckbox state={on ? 'on' : 'off'} onClick={() => toggleKey(node.key)} t={t} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '.74rem', color: on ? t.text1 : t.text3, fontWeight: on ? 500 : 400 }}>{node.label}</span>
                                {node.desc && <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 2 }}>{node.desc}</div>}
                                <div style={{ fontSize: '.52rem', color: t.text4, opacity: .6, marginTop: 2 }}>{path.slice(0, -1).join(' › ')}</div>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                ) : (!filterResults && (
                  /* ── Permission Tree ── */
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {visibleRows.map(({ node, depth, id, isLeaf }, rowIndex) => {
                      const state    = nodeState(node, selectedPerms)
                      const isExp    = !isLeaf && expanded.has(id)
                      const keyCount = getAllKeys(node).length
                      const onCount  = getAllKeys(node).filter(k => selectedPerms.has(k)).length
                      const isModule = depth === 0
                      const isPage   = depth === 1
                      const isTab    = depth === 2

                      /* ── DEPTH 0: Module header ── */
                      if (isModule) {
                        return (
                          <div key={id}
                            onClick={() => toggleExpand(id)}
                            style={{ cursor: 'pointer', borderBottom: `1px solid ${t.border}`, transition: 'background .12s', background: state !== 'off' ? `${roleColor}06` : t.card3 }}
                            onMouseEnter={e => e.currentTarget.style.background = state !== 'off' ? `${roleColor}10` : t.card2}
                            onMouseLeave={e => e.currentTarget.style.background = state !== 'off' ? `${roleColor}06` : t.card3}>
                            {/* Left accent */}
                            <div style={{ display: 'flex', position: 'relative' }}>
                              <div style={{ width: 3, background: state === 'on' ? roleColor : state === 'partial' ? `${roleColor}70` : t.border, flexShrink: 0, transition: 'background .2s' }} />
                              <div style={{ flex: 1, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                                {/* Chevron */}
                                <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <span style={{ fontSize: '.58rem', color: t.text4, transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .18s', display: 'block', userSelect: 'none' }}>▶</span>
                                </div>
                                {/* Icon badge */}
                                {node.icon && (
                                  <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', background: state !== 'off' ? `${roleColor}18` : `${t.border2}50`, border: `1px solid ${state !== 'off' ? roleColor + '35' : t.border}`, transition: 'all .2s' }}>
                                    {node.icon}
                                  </div>
                                )}
                                {/* Checkbox */}
                                <TriCheckbox state={state} onClick={() => toggleNode(node)} size={18} t={t} />
                                {/* Label */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '.85rem', fontWeight: 600, color: state !== 'off' ? t.text1 : t.text3, letterSpacing: '.02em', transition: 'color .15s' }}>{node.label}</div>
                                  {node.desc && <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 2 }}>{node.desc}</div>}
                                </div>
                                {/* Coverage */}
                                {!isLeaf && <CoveragePill onCount={onCount} total={keyCount} state={state} t={t} />}
                              </div>
                            </div>
                          </div>
                        )
                      }

                      /* ── DEPTH 1: Page / Submodule ── */
                      if (isPage) {
                        // Page key is "auto-implied" if it's in selectedPerms but only because children were enabled,
                        // not because the user clicked the full page (i.e. state is partial, not full 'on')
                        const isAutoImplied = node.key?.startsWith('page.') && selectedPerms.has(node.key) && state === 'partial'
                        return (
                          <div key={id}
                            onClick={() => isLeaf ? toggleNode(node) : toggleExpand(id)}
                            style={{ cursor: 'pointer', borderBottom: `1px solid ${t.border}18`, position: 'relative', transition: 'background .1s', background: 'transparent' }}
                            onMouseEnter={e => e.currentTarget.style.background = t.card2}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            {/* Vertical guide line */}
                            <div style={{ position: 'absolute', left: 21, top: 0, bottom: 0, width: 1, background: t.border, opacity: .5 }} />
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 18px 11px 38px', gap: 10 }}>
                              {/* Horizontal branch line */}
                              <div style={{ width: 16, height: 1, background: t.border, opacity: .5, flexShrink: 0 }} />
                              {/* Chevron */}
                              {!isLeaf && (
                                <span style={{ fontSize: '.55rem', color: t.text4, transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', userSelect: 'none', flexShrink: 0 }}>▶</span>
                              )}
                              {isLeaf && <div style={{ width: 12, flexShrink: 0 }} />}
                              <TriCheckbox state={state} onClick={() => toggleNode(node)} size={16} t={t} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '.77rem', fontWeight: state !== 'off' ? 600 : 400, color: state !== 'off' ? t.text1 : t.text3 }}>{node.label}</span>
                                  {node.key && <span style={{ fontSize: '.49rem', color: t.text4, fontFamily: 'ui-monospace,monospace', background: t.card2, borderRadius: 3, padding: '1px 5px', border: `1px solid ${t.border}` }}>{node.key}</span>}
                                  {isAutoImplied && (
                                    <span title="Page is accessible because child permissions are enabled" style={{ fontSize: '.44rem', color: t.gold, background: t.goldDim, borderRadius: 3, padding: '1px 5px', border: `1px solid ${t.gold}35`, letterSpacing: '.04em', fontWeight: 600 }}>
                                      partial access
                                    </span>
                                  )}
                                </div>
                                {node.desc && isLeaf && <div style={{ fontSize: '.6rem', color: t.text4, marginTop: 1 }}>{node.desc}</div>}
                              </div>
                              {!isLeaf && <CoveragePill onCount={onCount} total={keyCount} state={state} t={t} />}
                            </div>
                          </div>
                        )
                      }

                      /* ── DEPTH 2: Tab ── */
                      if (isTab) {
                        return (
                          <div key={id}
                            onClick={() => isLeaf ? toggleNode(node) : toggleExpand(id)}
                            style={{ cursor: 'pointer', borderBottom: `1px solid ${t.border}10`, position: 'relative', transition: 'background .1s', background: isExp ? `${t.gold}04` : 'transparent' }}
                            onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                            onMouseLeave={e => e.currentTarget.style.background = isExp ? `${t.gold}04` : 'transparent'}>
                            {/* Guide lines */}
                            <div style={{ position: 'absolute', left: 21, top: 0, bottom: 0, width: 1, background: t.border, opacity: .3 }} />
                            <div style={{ position: 'absolute', left: 43, top: 0, bottom: 0, width: 1, background: t.border, opacity: .3 }} />
                            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 18px 10px 54px', gap: 10 }}>
                              <div style={{ width: 14, height: 1, background: t.border, opacity: .4, flexShrink: 0 }} />
                              {!isLeaf && (
                                <span style={{ fontSize: '.52rem', color: t.text4, transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', userSelect: 'none', flexShrink: 0 }}>▶</span>
                              )}
                              {isLeaf && <div style={{ width: 12, flexShrink: 0 }} />}
                              <TriCheckbox state={state} onClick={() => toggleNode(node)} size={15} t={t} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                  {/* Tab pill */}
                                  <span style={{ fontSize: '.64rem', fontWeight: state !== 'off' ? 500 : 400, color: state !== 'off' ? t.text2 : t.text4 }}>{node.label}</span>
                                  {node.key && <span style={{ fontSize: '.46rem', color: t.text4, fontFamily: 'ui-monospace,monospace', opacity: .7 }}>{node.key}</span>}
                                </div>
                                {node.desc && isLeaf && <div style={{ fontSize: '.58rem', color: t.text4, marginTop: 1 }}>{node.desc}</div>}
                              </div>
                              {!isLeaf && keyCount > 1 && <CoveragePill onCount={onCount} total={keyCount} state={state} t={t} />}
                            </div>
                          </div>
                        )
                      }

                      /* ── DEPTH 3+: Element (leaf) ── */
                      const on = node.key ? selectedPerms.has(node.key) : false
                      return (
                        <div key={id}
                          onClick={() => node.key && toggleKey(node.key)}
                          style={{ cursor: 'pointer', borderBottom: `1px solid ${t.border}08`, position: 'relative', transition: 'background .1s', background: on ? `${t.gold}04` : 'transparent' }}
                          onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
                          onMouseLeave={e => e.currentTarget.style.background = on ? `${t.gold}04` : 'transparent'}>
                          {/* Guide lines */}
                          <div style={{ position: 'absolute', left: 21, top: 0, bottom: 0, width: 1, background: t.border, opacity: .2 }} />
                          <div style={{ position: 'absolute', left: 43, top: 0, bottom: 0, width: 1, background: t.border, opacity: .2 }} />
                          <div style={{ position: 'absolute', left: 65, top: 0, bottom: 0, width: 1, background: t.border, opacity: .2 }} />
                          <div style={{ display: 'flex', alignItems: 'center', padding: '9px 18px 9px 76px', gap: 10 }}>
                            <div style={{ width: 12, height: 1, background: t.border, opacity: .3, flexShrink: 0 }} />
                            <TriCheckbox state={on ? 'on' : 'off'} onClick={() => node.key && toggleKey(node.key)} size={14} t={t} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: '.68rem', color: on ? t.text1 : t.text3, fontWeight: on ? 500 : 400, transition: 'color .12s' }}>{node.label}</span>
                              {node.desc && <span style={{ fontSize: '.58rem', color: t.text4, marginLeft: 8 }}>— {node.desc}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    <div style={{ height: 28 }} />
                  </div>
                ))}
              </div>
            )}

            {/* ══ USERS TAB ══════════════════════════════════════════════════ */}
            {rightTab === 'users' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {roleUsers.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', opacity: .2, marginBottom: 14 }}>👤</div>
                    <div style={{ fontSize: '.78rem', color: t.text3 }}>No users assigned to this role</div>
                    <div style={{ fontSize: '.63rem', color: t.text4, marginTop: 6 }}>Assign from the User Management page</div>
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '12px 22px 6px', fontSize: '.6rem', color: t.text4, letterSpacing: '.08em' }}>
                      {roleUsers.length} user{roleUsers.length !== 1 ? 's' : ''} with this role
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 8, padding: '9px 22px', background: t.card2, borderBottom: `1px solid ${t.border}`, borderTop: `1px solid ${t.border}` }}>
                      {['Name', 'Email', 'Status'].map(h => (
                        <span key={h} style={{ fontSize: '.54rem', color: t.text3, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>{h}</span>
                      ))}
                    </div>
                    {roleUsers.map(u => (
                      <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 8, padding: '12px 22px', borderBottom: `1px solid ${t.border}14`, alignItems: 'center' }}>
                        <span style={{ fontSize: '.74rem', color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || '—'}</span>
                        <span style={{ fontSize: '.67rem', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                        <span style={{ fontSize: '.58rem', padding: '3px 9px', borderRadius: 20, background: u.is_active ? t.greenDim : t.redDim, color: u.is_active ? t.green : t.red, textAlign: 'center', fontWeight: 600, border: `1px solid ${u.is_active ? t.green + '30' : t.red + '30'}` }}>
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

      {/* ══ MODALS ══════════════════════════════════════════════════════════ */}

      {showAdd && (
        <Modal t={t} onClose={() => { setShowAdd(false); setAddErr(null) }}>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: t.text1 }}>Create New Role</div>
          <Field t={t} label="Display Label"><Inp t={t} value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Branch Manager" autoFocus /></Field>
          <Field t={t} label="Role Key (auto if blank)"><Inp t={t} value={newName} onChange={e => setNewName(e.target.value)} placeholder={newLabel ? newLabel.toLowerCase().replace(/\s+/g, '_') : 'role_key'} /></Field>
          <Field t={t} label="Color"><ColorPicker value={newColor} onChange={setNewColor} t={t} /></Field>
          {addErr && <div style={{ fontSize: '.65rem', color: t.red }}>{addErr}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowAdd(false); setAddErr(null) }} style={{ padding: '9px 18px', borderRadius: 8, fontSize: '.72rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3 }}>Cancel</button>
            <button onClick={addRole} disabled={adding || !newLabel.trim()} style={{ padding: '9px 20px', borderRadius: 8, fontSize: '.72rem', fontWeight: 700, cursor: 'pointer', background: t.gold, color: '#000', border: 'none', opacity: adding ? .6 : 1 }}>{adding ? 'Creating...' : 'Create Role'}</button>
          </div>
        </Modal>
      )}

      {showEdit && (
        <Modal t={t} onClose={() => { setShowEdit(false); setEditErr(null) }}>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: t.text1 }}>Edit Role</div>
          <Field t={t} label="Display Label"><Inp t={t} value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus /></Field>
          <Field t={t} label="Color"><ColorPicker value={editColor} onChange={setEditColor} t={t} /></Field>
          {editErr && <div style={{ fontSize: '.65rem', color: t.red }}>{editErr}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowEdit(false); setEditErr(null) }} style={{ padding: '9px 18px', borderRadius: 8, fontSize: '.72rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3 }}>Cancel</button>
            <button onClick={saveEdit} disabled={editing || !editLabel.trim()} style={{ padding: '9px 20px', borderRadius: 8, fontSize: '.72rem', fontWeight: 700, cursor: 'pointer', background: t.gold, color: '#000', border: 'none', opacity: editing ? .6 : 1 }}>{editing ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </Modal>
      )}

      {confirmDelete && (() => {
        const role   = roles.find(r => r.name === confirmDelete)
        const uCount = userCountByRole[confirmDelete] || 0
        return (
          <Modal t={t} onClose={() => setConfirmDelete(null)} width={380}>
            <div style={{ fontSize: '.9rem', fontWeight: 700, color: t.red }}>Delete Role?</div>
            <div style={{ fontSize: '.76rem', color: t.text2, lineHeight: 1.65 }}>
              You are about to permanently delete <strong style={{ color: t.text1 }}>{role?.label}</strong>.
              {uCount > 0 && <><br /><span style={{ color: t.red }}>{uCount} user{uCount !== 1 ? 's' : ''} currently have this role</span> and will need reassignment.</>}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: '9px 18px', borderRadius: 8, fontSize: '.72rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border2}`, color: t.text3 }}>Cancel</button>
              <button onClick={confirmAndDelete} style={{ padding: '9px 20px', borderRadius: 8, fontSize: '.72rem', fontWeight: 700, cursor: 'pointer', background: t.red, color: '#fff', border: 'none' }}>Delete Role</button>
            </div>
          </Modal>
        )
      })()}

    </div>
  )
}
