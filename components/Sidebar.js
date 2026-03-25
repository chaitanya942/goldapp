'use client'

import { useApp } from '../lib/context'

const NAV_ITEMS = [
  { id: 'dashboard',    label: 'Dashboard',    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', desc: 'Overview' },
  { id: 'purchases',    label: 'Purchases',    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', desc: 'Gold bought',
    children: [
      { id: 'purchase-data',    label: 'Purchase Data',    dot: '#c9a84c' },
      { id: 'purchase-reports', label: 'Purchase Reports', dot: '#3a8fbf' },
    ]
  },
  { id: 'consignments', label: 'Consignments', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4', desc: 'In transit',
    children: [
      { id: 'consignment-data',    label: 'Consignment Data',   dot: '#c9a84c' },
      { id: 'consignment-report',  label: 'Consignment Report', dot: '#3a8fbf' },
      { id: 'consignment-summary', label: 'Movement Report',    dot: '#3aaa6a' },
    ]
  },
  { id: 'melting', label: 'Melting', icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z', desc: 'Processing' },
  { id: 'sales',   label: 'Sales',   icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', desc: 'Revenue',
    children: [
      { id: 'cal-table',         label: 'Cal Table',         dot: '#c9a84c' },
      { id: 'live-market-rates', label: 'Live Market Rates', dot: '#3aaa6a' },
    ]
  },
  { id: 'telesales', label: 'Telesales', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z', desc: 'Bot calls',
    children: [
      { id: 'inbound-bot', label: 'Inbound Bot Testing', dot: '#8c5ac8' },
    ]
  },
]

const ADMIN_ITEMS = [
  { id: 'users', label: 'Admin', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', desc: 'Settings',
    children: [
      { id: 'branch-management', label: 'Branch Management', dot: '#8c5ac8' },
      { id: 'user-management',   label: 'User Management',   dot: '#3aaa6a' },
      { id: 'import-logs',       label: 'Import Logs',       dot: '#c9981f' },
    ]
  },
]

const T = {
  dark: {
    side: '#0c0b09', text1: '#f0e6c8', text3: '#6a5a3a', text4: '#3a2a1a',
    gold: '#c9a84c', goldDim: 'rgba(201,168,76,.14)', goldBdr: 'rgba(201,168,76,.22)',
    goldSdw: '0 0 12px rgba(201,168,76,.08), inset 0 1px 0 rgba(201,168,76,.1)',
    goldGlow: 'rgba(201,168,76,.5)', border: '#1a1a18', border2: '#222018',
    hov: 'rgba(201,168,76,.06)', topGlow: 'radial-gradient(ellipse at top, rgba(201,168,76,.06) 0%, transparent 60%)',
    divider: 'linear-gradient(90deg, transparent, rgba(201,168,76,.15), transparent)',
    sectionClr: '#2a1e0e', logoBg: 'linear-gradient(135deg, #c9a84c 0%, #7a4a10 100%)',
    logoSdw: '0 2px 14px rgba(201,168,76,.35)',
  },
  light: {
    side: '#e8e2d6', text1: '#1a1208', text3: '#8a7a5a', text4: '#b0a080',
    gold: '#a07830', goldDim: 'rgba(160,120,48,.12)', goldBdr: 'rgba(160,120,48,.25)',
    goldSdw: '0 0 8px rgba(160,120,48,.08), inset 0 1px 0 rgba(160,120,48,.1)',
    goldGlow: 'rgba(160,120,48,.4)', border: '#d0c8b8', border2: '#c8c0b0',
    hov: 'rgba(160,120,48,.06)', topGlow: 'radial-gradient(ellipse at top, rgba(160,120,48,.05) 0%, transparent 60%)',
    divider: 'linear-gradient(90deg, transparent, rgba(160,120,48,.18), transparent)',
    sectionClr: '#b0a080', logoBg: 'linear-gradient(135deg, #a07830 0%, #6a3a08 100%)',
    logoSdw: '0 2px 12px rgba(160,120,48,.25)',
  },
}

function NavIcon({ path, size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {path.includes(' M ') || path.includes('M15') || path.includes('M10')
        ? path.split(' M ').map((p, i) => <path key={i} d={i === 0 ? p : 'M ' + p} />)
        : <path d={path} />
      }
    </svg>
  )
}

export default function Sidebar({ sidebarOpen, setSidebarOpen }) {
  const { theme, activeNav, setActiveNav, expandedNav, setExpandedNav, canSee } = useApp()
  const t = T[theme]

  const isActive       = (id)   => activeNav === id
  const hasActiveChild = (item) => item.children?.some(c => c.id === activeNav)

  const handleParentClick = (item) => {
    if (item.children) {
      setExpandedNav(prev => ({ ...prev, [item.id]: !prev[item.id] }))
      if (!sidebarOpen) setSidebarOpen(true)
    } else {
      setActiveNav(item.id)
    }
  }

  const filterItem = (item) => {
    if (item.children) {
      const visibleChildren = item.children.filter(c => canSee(c.id))
      if (visibleChildren.length === 0) return null
      return { ...item, children: visibleChildren }
    }
    if (!canSee(item.id)) return null
    return item
  }

  const visibleNavItems   = NAV_ITEMS.map(filterItem).filter(Boolean)
  const visibleAdminItems = ADMIN_ITEMS.map(filterItem).filter(Boolean)

  const renderItem = (item) => {
    const active   = isActive(item.id) || hasActiveChild(item)
    const expanded = expandedNav[item.id]

    return (
      <div key={item.id} style={{ marginBottom: '1px' }}>
        <div
          onClick={() => handleParentClick(item)}
          style={{
            display: 'flex', alignItems: 'center',
            gap: sidebarOpen ? '10px' : '0',
            padding: sidebarOpen ? '9px 14px 9px 12px' : '10px 0',
            justifyContent: sidebarOpen ? 'flex-start' : 'center',
            cursor: 'pointer', borderRadius: '9px',
            margin: '0 8px',
            background: active ? t.goldDim : 'transparent',
            border: `1px solid ${active ? t.goldBdr : 'transparent'}`,
            borderLeft: active && sidebarOpen ? `2px solid ${t.gold}` : `1px solid ${active ? t.goldBdr : 'transparent'}`,
            boxShadow: active ? t.goldSdw : 'none',
            transition: 'all .18s ease',
          }}
          onMouseEnter={e => { if (!active) e.currentTarget.style.background = t.hov }}
          onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
        >
          <div style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, filter: active ? `drop-shadow(0 0 5px ${t.goldGlow})` : 'none', transition: 'filter .2s' }}>
            <NavIcon path={item.icon} size={16} color={active ? t.gold : t.text3} />
          </div>
          {sidebarOpen && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.76rem', fontWeight: active ? 600 : 400, color: active ? t.gold : t.text3, letterSpacing: '.03em', lineHeight: 1.3, transition: 'color .18s' }}>{item.label}</div>
                {!item.children && <div style={{ fontSize: '.55rem', color: t.text4, marginTop: '1px', letterSpacing: '.05em' }}>{item.desc}</div>}
              </div>
              {item.children && (
                <div style={{ width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={active ? t.gold : t.text3} strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                </div>
              )}
            </>
          )}
        </div>

        {item.children && expanded && sidebarOpen && (
          <div style={{ marginLeft: '24px', paddingLeft: '16px', borderLeft: `1px solid ${t.goldBdr}`, marginTop: '2px', marginBottom: '4px' }}>
            {item.children.map(child => (
              <div key={child.id} onClick={() => setActiveNav(child.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', marginBottom: '1px', background: isActive(child.id) ? `${child.dot || t.gold}18` : 'transparent', transition: 'background .15s' }}
                onMouseEnter={e => { if (!isActive(child.id)) e.currentTarget.style.background = t.hov }}
                onMouseLeave={e => { if (!isActive(child.id)) e.currentTarget.style.background = 'transparent' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0, background: isActive(child.id) ? (child.dot || t.gold) : t.text4, boxShadow: isActive(child.id) ? `0 0 6px ${child.dot || t.gold}` : 'none', transition: 'all .18s' }} />
                <span style={{ fontSize: '.72rem', color: isActive(child.id) ? (child.dot || t.gold) : t.text3, fontWeight: isActive(child.id) ? 500 : 400, letterSpacing: '.02em', transition: 'color .15s' }}>{child.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ width: sidebarOpen ? '232px' : '52px', flexShrink: 0, background: t.side, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', transition: 'width .22s cubic-bezier(.4,0,.2,1)', overflow: 'hidden', height: '100vh', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '120px', background: t.topGlow, pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ padding: sidebarOpen ? '18px 16px 16px' : '18px 0 16px', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: sidebarOpen ? 'flex-start' : 'center', borderBottom: `1px solid ${t.border}`, flexShrink: 0, position: 'relative', zIndex: 1 }}>
        <div style={{ width: '34px', height: '34px', flexShrink: 0, background: t.logoBg, borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: t.logoSdw }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        {sidebarOpen && (
          <div>
            <div style={{ fontSize: '.82rem', fontWeight: 700, color: t.text1, letterSpacing: '.06em', lineHeight: 1.2 }}>White Gold</div>
            <div style={{ fontSize: '.52rem', color: t.gold, letterSpacing: '.18em', textTransform: 'uppercase', marginTop: '2px', opacity: .75 }}>Operations</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0', scrollbarWidth: 'none', position: 'relative', zIndex: 1 }}>
        {sidebarOpen && <div style={{ fontSize: '.5rem', color: t.sectionClr, letterSpacing: '.2em', textTransform: 'uppercase', padding: '4px 20px 8px', fontWeight: 600 }}>Main</div>}
        {visibleNavItems.map(renderItem)}
        {visibleAdminItems.length > 0 && (
          <>
            <div style={{ margin: '10px 16px', height: '1px', background: t.divider }} />
            {sidebarOpen && <div style={{ fontSize: '.5rem', color: t.sectionClr, letterSpacing: '.2em', textTransform: 'uppercase', padding: '4px 20px 8px', fontWeight: 600 }}>Admin</div>}
            {visibleAdminItems.map(renderItem)}
          </>
        )}
      </div>

      <div onClick={() => setSidebarOpen(o => !o)}
        style={{ padding: sidebarOpen ? '12px 16px' : '12px 0', borderTop: `1px solid ${t.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: sidebarOpen ? 'flex-start' : 'center', gap: '10px', flexShrink: 0, transition: 'background .15s', position: 'relative', zIndex: 1 }}
        onMouseEnter={e => e.currentTarget.style.background = t.hov}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <div style={{ width: '24px', height: '24px', borderRadius: '6px', border: `1px solid ${t.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={t.text3} strokeWidth="2.5" strokeLinecap="round" style={{ transform: sidebarOpen ? 'none' : 'rotate(180deg)', transition: 'transform .22s' }}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
        {sidebarOpen && <span style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.04em' }}>Collapse</span>}
      </div>
    </div>
  )
}