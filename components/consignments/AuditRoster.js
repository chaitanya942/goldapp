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
// Both sections render stacked on the same page so the auditor / supervisor
// can see both shifts at once without flipping tabs. Bodies are intentionally
// minimal placeholders right now — actual queues + actions land here in
// subsequent passes.

import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const SECTIONS = [
  {
    id:     'night',
    label:  'Night Weight Audit',
    icon:   '🌙',
    accent: 'gold',
    desc:   'Bills audited during the night shift — weight check only.',
  },
  {
    id:     'morning',
    label:  'Morning Weight + Melting Audit',
    icon:   '☀',
    accent: 'orange',
    desc:   'Bills audited during the morning shift — weight check + melting readiness.',
  },
]

export default function AuditRoster() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

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

      {/* Stacked sections — both visible, no tabs */}
      {SECTIONS.map(section => {
        const accent = t[section.accent] || t.gold
        return (
          <div key={section.id} style={{
            background:  t.card,
            border:      `1px solid ${t.border}`,
            borderRadius: '14px',
            overflow:    'hidden',
            position:    'relative',
            boxShadow:   `0 1px 3px ${t.border}40`,
          }}>
            {/* Top accent stripe — colour-codes the section without needing a sidebar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)` }} />

            {/* Section header */}
            <div style={{
              padding: '18px 22px',
              borderBottom: `1px solid ${t.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
            }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: `linear-gradient(135deg, ${accent}25, ${accent}08)`,
                border:     `1px solid ${accent}30`,
                display:    'flex', alignItems: 'center', justifyContent: 'center',
                fontSize:   '18px',
                flexShrink: 0,
              }}>{section.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>{section.label}</div>
                <div style={{ fontSize: '11px', color: t.text4, marginTop: '3px' }}>{section.desc}</div>
              </div>
            </div>

            {/* Placeholder body — actual queue / actions land here later */}
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: t.text4, fontStyle: 'italic', maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
                Workflow scaffolding next — bill queue, weight entry{section.id === 'morning' ? ', and melting sign-off' : ''}.
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
