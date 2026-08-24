'use client'

import { useState } from 'react'
import { useApp } from '../lib/context'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'
import { getVisibleModules, getVisibleAdmin } from '../lib/modules'

const T = {
  dark: {
    bg: '#0c0b09', card: '#15140f', border: '#1e1e1a', text1: '#f0e6c8',
    text2: '#c8b89a', text3: '#7a6a4a', text4: '#3a2a1a',
    gold: '#c9a84c', goldDim: 'rgba(201,168,76,.1)', goldBdr: 'rgba(201,168,76,.2)',
    hov: 'rgba(201,168,76,.06)', red: '#e05555',
    avatarBg: 'linear-gradient(135deg, #c9a84c 0%, #7a4a10 100%)',
    sectionClr: '#3a2e18',
  },
  light: {
    bg: '#f0ebe0', card: '#faf7f2', border: '#ddd8cc', text1: '#1a1208',
    text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a',
    gold: '#9a7228', goldDim: 'rgba(154,114,40,.08)', goldBdr: 'rgba(154,114,40,.2)',
    hov: 'rgba(154,114,40,.06)', red: '#c03030',
    avatarBg: 'linear-gradient(135deg, #b8882e 0%, #7a4a10 100%)',
    sectionClr: '#c0b090',
  },
}

export default function MobileMenu({ onClose, initialModuleId = null }) {
  const { theme, activeNav, setActiveNav, user, canSee } = useApp()
  const t = T[theme] || T.dark
  const router = useRouter()
  const initial = user?.email?.[0]?.toUpperCase() ?? '?'

  // 2-level nav state: null = top-level module list, otherwise = drilled into a module
  const [activeModule, setActiveModule] = useState(initialModuleId)

  const modules = getVisibleModules(canSee)
  const admin   = getVisibleAdmin(canSee)

  const handleNav = (tabId) => { setActiveNav(tabId); onClose() }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // If a module is active, find it from filtered list (modules + admin)
  const allModules    = admin ? [...modules, admin] : modules
  const currentModule = activeModule ? allModules.find(m => m.id === activeModule) : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', flexDirection: 'column' }}>
      <div onClick={onClose} className="mm-backdrop" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(2px)', animation: 'mmFade .22s ease both' }} />

      <div className="mm-sheet" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: t.bg, borderRadius: '22px 22px 0 0', borderTop: `1px solid ${t.border}`, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -12px 40px rgba(0,0,0,.4)', animation: 'mmSheetIn .36s cubic-bezier(.16,1,.3,1) both' }}>

        <div style={{ padding: '12px 0 0', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: t.text4 }} />
        </div>

        {/* Header: either user info (top level) or Back arrow + module name (drilled in) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          {currentModule ? (
            <>
              <button onClick={() => setActiveModule(null)} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${t.border}`, background: 'transparent', color: t.text2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.text2} strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${currentModule.color}18`, border: `1px solid ${currentModule.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{currentModule.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.85rem', fontWeight: 700, color: currentModule.color }}>{currentModule.label}</div>
                <div style={{ fontSize: '.6rem', color: t.text3 }}>{currentModule.visibleTabs.length} section{currentModule.visibleTabs.length !== 1 ? 's' : ''}</div>
              </div>
            </>
          ) : (
            <>
              <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: t.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.9rem', fontWeight: 700, color: '#fff' }}>{initial}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.8rem', fontWeight: 600, color: t.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email?.split('@')[0]}</div>
                <div style={{ fontSize: '.62rem', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
              </div>
            </>
          )}
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', color: t.text3, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 12px', scrollbarWidth: 'none' }}>
          {currentModule ? (
            // Level 2 — module's tabs
            <>
              {currentModule.comingSoon && (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: t.text4 }}>
                  <div style={{ fontSize: 30, opacity: 0.3, marginBottom: 8 }}>{currentModule.icon}</div>
                  <div style={{ fontSize: '.85rem', color: t.text2, fontWeight: 500, marginBottom: 4 }}>Coming soon</div>
                  <div style={{ fontSize: '.7rem', color: t.text4 }}>This module will be available in a future release.</div>
                </div>
              )}
              {currentModule.visibleTabs.map((tab, i) => {
                const isActive = activeNav === tab.id
                const dot = tab.dot || currentModule.color
                return (
                  <button key={tab.id} onClick={() => handleNav(tab.id)} className="mm-item"
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 13, padding: '15px 14px', borderRadius: 13, border: `1px solid ${isActive ? dot + '55' : t.border}`, background: isActive ? `${dot}12` : t.card, cursor: 'pointer', marginBottom: 8, animation: 'mmItemIn .34s cubic-bezier(.16,1,.3,1) both', animationDelay: `${0.04 + i * 0.05}s` }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: `${dot}18`, border: `1px solid ${dot}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 9, height: 9, borderRadius: '50%', background: dot, boxShadow: isActive ? `0 0 8px ${dot}` : 'none' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.86rem', color: isActive ? dot : t.text1, fontWeight: 600, letterSpacing: '.01em' }}>{tab.label}</div>
                      {tab.desc && <div style={{ fontSize: '.62rem', color: t.text3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.desc}</div>}
                    </div>
                    <svg style={{ flexShrink: 0 }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isActive ? dot : t.text4} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                )
              })}
            </>
          ) : (
            // Level 1 — module list
            <>
              <button onClick={() => handleNav('dashboard')}
                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 11, border: `1px solid ${activeNav === 'dashboard' ? t.goldBdr : 'transparent'}`, background: activeNav === 'dashboard' ? t.goldDim : 'transparent', cursor: 'pointer', marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: `${t.gold}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>⌂</div>
                <span style={{ fontSize: '.82rem', color: activeNav === 'dashboard' ? t.gold : t.text2, fontWeight: activeNav === 'dashboard' ? 600 : 500 }}>Dashboard</span>
                {activeNav === 'dashboard' && <div style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: t.gold }} />}
              </button>

              <div style={{ fontSize: '.5rem', color: t.sectionClr, letterSpacing: '.18em', textTransform: 'uppercase', padding: '8px 8px 6px', fontWeight: 700 }}>Modules</div>

              {modules.map((m, i) => {
                const tabIds   = m.visibleTabs.map(x => x.id)
                const isActive = tabIds.includes(activeNav)
                return (
                  <button key={m.id} onClick={() => setActiveModule(m.id)} className="mm-item"
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 12, border: `1px solid ${isActive ? m.color + '50' : t.border}`, background: isActive ? `${m.color}10` : t.card, cursor: 'pointer', marginBottom: 7, opacity: m.comingSoon ? 0.65 : 1, animation: 'mmItemIn .34s cubic-bezier(.16,1,.3,1) both', animationDelay: `${0.03 + i * 0.04}s` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${m.color}18`, border: `1px solid ${m.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>{m.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.82rem', color: isActive ? m.color : t.text1, fontWeight: 600 }}>{m.label}</div>
                      <div style={{ fontSize: '.62rem', color: t.text3, marginTop: 1 }}>
                        {m.comingSoon ? 'Coming soon' : `${m.visibleTabs.length} section${m.visibleTabs.length !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    {isActive && <div style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isActive ? m.color : t.text3} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                )
              })}

              {admin && (
                <>
                  <div style={{ fontSize: '.5rem', color: t.sectionClr, letterSpacing: '.18em', textTransform: 'uppercase', padding: '14px 8px 6px', fontWeight: 700 }}>Admin</div>
                  <button onClick={() => setActiveModule(admin.id)}
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 11, border: `1px solid ${admin.visibleTabs.some(x => x.id === activeNav) ? admin.color + '50' : t.border}`, background: admin.visibleTabs.some(x => x.id === activeNav) ? `${admin.color}10` : t.card, cursor: 'pointer', marginBottom: 6 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${admin.color}18`, border: `1px solid ${admin.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>{admin.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.82rem', color: t.text1, fontWeight: 600 }}>Admin</div>
                      <div style={{ fontSize: '.62rem', color: t.text3, marginTop: 1 }}>{admin.visibleTabs.length} section{admin.visibleTabs.length !== 1 ? 's' : ''}</div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.text3} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {/* Sign out (only on top level) */}
        {!currentModule && (
          <div style={{ padding: '12px 12px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${t.border}`, flexShrink: 0, background: t.bg }}>
            <button onClick={signOut} style={{ width: '100%', padding: '13px 16px', borderRadius: 10, border: `1px solid ${t.red}30`, background: `${t.red}08`, color: t.red, fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.red} strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              Sign Out
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes mmSheetIn { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes mmFade    { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mmItemIn  { from { opacity: 0; transform: translateY(9px) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) {
          .mm-sheet, .mm-backdrop, .mm-item { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
