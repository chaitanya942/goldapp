// lib/modules.js
// Single source of truth for module → tabs mapping.
// Used by mobile dashboard cards, MobileMenu, sidebar (eventually).
// Each module groups related submodules so the nav stays compact and clear.

export const MODULES = [
  {
    id:    'purchases',
    label: 'Purchases',
    icon:  '📊',
    color: '#c9a84c',
    tabs: [
      { id: 'purchase-data',    label: 'Live Data',  dot: '#c9a84c' },
      { id: 'purchase-reports', label: 'Reports',    dot: '#8c5ac8' },
    ],
  },
  {
    id:    'consignments',
    label: 'Consignments',
    icon:  '📦',
    color: '#3aaa6a',
    tabs: [
      { id: 'consignment-overview',  label: 'Branch Stock',         dot: '#3aaa6a' },
      { id: 'consignment-data',      label: 'Consignment Data',     dot: '#c9a84c' },
      { id: 'consignment-bidding',   label: 'Bidding Volume',       dot: '#e58a3b' },
      { id: 'consignment-report',    label: 'Consignment Report',   dot: '#3a8fbf' },
      { id: 'consignment-analytics', label: 'Movement Analytics',   dot: '#8c5ac8' },
    ],
  },
  {
    id:    'inventory-audit',
    label: 'Inventory Audit',
    icon:  '✓',
    color: '#3a8fbf',
    comingSoon: true,
    tabs: [],
  },
  {
    id:    'melting',
    label: 'Melting',
    icon:  '🔥',
    color: '#e05555',
    comingSoon: true,
    tabs: [],
  },
  {
    id:    'sales',
    label: 'Sales',
    icon:  '💰',
    color: '#3a8fbf',
    tabs: [
      { id: 'cal-table',         label: 'Cal Table',         dot: '#c9a84c' },
      { id: 'live-market-rates', label: 'Live Market Rates', dot: '#3aaa6a' },
    ],
  },
  {
    id:    'telesales',
    label: 'Telesales',
    icon:  '📞',
    color: '#8c5ac8',
    tabs: [
      { id: 'inbound-bot', label: 'Inbound Bot Testing', dot: '#8c5ac8' },
    ],
  },
]

// Admin lives separately so it doesn't clutter the operational module list.
// Order matters — role/user management surface first so super_admin can always
// reach them on mobile to fix self-inflicted permission damage.
export const ADMIN_MODULE = {
  id:    'admin',
  label: 'Admin',
  icon:  '⚙',
  color: '#e05555',
  tabs: [
    { id: 'role-management',     label: 'Role Management',     dot: '#e05555' },
    { id: 'user-management',     label: 'User Management',     dot: '#3aaa6a' },
    { id: 'branch-management',   label: 'Branch Management',   dot: '#8c5ac8' },
    { id: 'branch-employees',    label: 'Branch Employees',    dot: '#c9a84c' },
    { id: 'company-settings',    label: 'Company Settings',    dot: '#c9a84c' },
    { id: 'gold-buying-rate',    label: 'Gold Buying Rate',    dot: '#c9a84c' },
    { id: 'consignment-seeds',   label: 'Consignment Seeds',   dot: '#3a8fbf' },
    { id: 'import-logs',         label: 'Import Logs',         dot: '#c9981f' },
  ],
}

// Filter modules by what the user is allowed to see.
// A module shows ONLY if it has at least one tab the user can access.
// Coming-soon modules (Inventory Audit, Melting, etc.) stay hidden until they're built —
// users only see what's real and accessible to them.
export function getVisibleModules(canSee) {
  return MODULES
    .map(m => ({
      ...m,
      visibleTabs: m.tabs.filter(t => canSee(t.id)),
    }))
    .filter(m => m.visibleTabs.length > 0)
}

export function getVisibleAdmin(canSee) {
  const visibleTabs = ADMIN_MODULE.tabs.filter(t => canSee(t.id))
  return visibleTabs.length > 0 ? { ...ADMIN_MODULE, visibleTabs } : null
}
