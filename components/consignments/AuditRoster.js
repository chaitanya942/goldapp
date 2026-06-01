'use client'

// Audit Roster — first-cut shell for the two-shift audit workflow.
//
// Two audits happen on different schedules and against different bill states:
//
//   1) NIGHT WEIGHT AUDIT — at-HO bills audited in the night shift. Same
//      mechanic as Collection Audit (weight on the scale, match against CRM),
//      done by the night-shift auditor.
//
//   2) MORNING WEIGHT + MELTING AUDIT — at-HO bills audited in the morning,
//      with the additional melting check (the gold is being prepared for the
//      melt and the morning auditor signs off on both weight + readiness).
//
// This file is intentionally minimal — a tab shell with placeholders so we
// can iterate on the specific data shape, queries, and audit POST actions
// for each shift in subsequent passes.

import { useState } from 'react'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const TABS = [
  {
    id:    'night',
    label: 'Night Weight Audit',
    icon:  '🌙',
    desc:  'Bills audited during the night shift — weight check only.',
  },
  {
    id:    'morning',
    label: 'Morning Weight + Melting Audit',
    icon:  '☀',
    desc:  'Bills audited during the morning shift — weight check + melting readiness.',
  },
]

export default function AuditRoster() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [tab, setTab] = useState('night')

  const active = TABS.find(x => x.id === tab) || TABS[0]

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hero header */}
      <div style={{
        background:  `linear-gradient(135deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
        border:      `1px solid ${t.border}`,
        borderRadius: '16px',
        padding:     '22px 26px',
        display:     'flex',
        alignItems:  'center',
        gap:         '18px',
        position:    'relative',
        overflow:    'hidden',
        boxShadow:   `0 1px 3px ${t.border}40`,
      }}>
        <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: '50%', height: '200%', background: `radial-gradient(ellipse at center, ${t.gold}10 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{
          width: '54px', height: '54px', borderRadius: '14px',
          background: `linear-gradient(135deg, ${t.gold}25, ${t.gold}10)`,
          border:     `1px solid ${t.gold}40`,
          display:    'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:   '26px',
        }}>
          🗓
        </div>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em', lineHeight: 1.1 }}>Audit Roster</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '6px', maxWidth: '640px' }}>
            Two audit shifts on at-HO bills — night does the weight check, morning does weight plus melting readiness.
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {TABS.map(item => {
          const isActive = item.id === tab
          return (
            <button key={item.id} onClick={() => setTab(item.id)}
              style={{
                background: isActive ? `${t.gold}15` : 'transparent',
                border: `1px solid ${isActive ? `${t.gold}80` : t.border}`,
                borderRadius: '11px',
                padding: '10px 18px',
                fontSize: '12px',
                color: isActive ? t.gold : t.text2,
                cursor: 'pointer',
                fontWeight: isActive ? 700 : 500,
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                transition: 'all .15s ease',
                boxShadow: isActive ? `0 0 0 4px ${t.gold}12` : 'none',
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = `${t.gold}60`; e.currentTarget.style.color = t.gold } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text2 } }}>
              <span style={{ fontSize: '14px', lineHeight: 1 }}>{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </div>

      {/* Placeholder body — actual queues / actions land here in later passes */}
      <div style={{
        background: t.card,
        border:     `1px solid ${t.border}`,
        borderRadius: '14px',
        padding:    '60px 24px',
        textAlign:  'center',
        boxShadow:  `0 1px 3px ${t.border}40`,
      }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '50%',
          background: `linear-gradient(135deg, ${t.gold}20, ${t.gold}08)`,
          border:     `1px solid ${t.gold}30`,
          margin:     '0 auto 14px',
          display:    'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:   '24px',
        }}>{active.icon}</div>
        <div style={{ fontSize: '15px', color: t.text1, fontWeight: 600, marginBottom: '6px' }}>{active.label}</div>
        <div style={{ fontSize: '12px', color: t.text3, maxWidth: '480px', margin: '0 auto', lineHeight: 1.6 }}>
          {active.desc}
        </div>
        <div style={{ fontSize: '11px', color: t.text4, marginTop: '14px', fontStyle: 'italic' }}>
          Workflow scaffolding next — bill queue, weight entry, and (for the morning lane) melting sign-off.
        </div>
      </div>
    </div>
  )
}
