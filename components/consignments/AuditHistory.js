'use client'

// Audit History — separate sub-module under Collection Audit.
//
// Two stacked sections (per ops' "one below the other" preference):
//
//   1) AUDIT HISTORY — read-only log of every audit action performed.
//      Will pull from purchases.audited_at + audited_by (weight audit)
//      UNION'd with count_received_at + count_received_by (count audit
//      added earlier today), joined to Auditors so the UUIDs resolve
//      into names.
//
//   2) AUDITORS — list of people assigned to run audit shifts. Source
//      of truth for who can show up in the history log and the Audit
//      Roster shift assignments.
//
// First-cut shell — empty states with the right shape so the next pass
// can drop in the actual data + CRUD without touching the layout.

import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const SECTIONS = [
  {
    id:     'history',
    label:  'Audit History',
    icon:   '📜',
    accent: 'purple',
    desc:   'Past audit activity — who audited what, when, and the outcome.',
  },
  {
    id:     'auditors',
    label:  'Auditors',
    icon:   '👤',
    accent: 'blue',
    desc:   'People assigned to the night and morning audit shifts.',
  },
]

export default function AuditHistory() {
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
          📜
        </div>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em', lineHeight: 1.1 }}>Audit History</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '6px', maxWidth: '640px' }}>
            Past audit activity and the team that runs it — history above, auditor roster below.
          </div>
        </div>
      </div>

      {/* Stacked sections — history first, auditors below */}
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
            {/* Top accent stripe */}
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
              {section.id === 'auditors' && (
                <button
                  disabled
                  title="Scaffolding only — add-auditor flow wires up in the next pass"
                  style={{
                    background: accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: '9px',
                    padding: '8px 16px',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '.02em',
                    cursor: 'not-allowed',
                    opacity: 0.55,
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    flexShrink: 0,
                  }}>
                  + Add auditor
                </button>
              )}
            </div>

            {/* Body — kind-specific empty state */}
            {section.id === 'history' ? <HistoryBody accent={accent} t={t} /> : <AuditorsBody accent={accent} t={t} />}
          </div>
        )
      })}
    </div>
  )
}

// ── Body renderers ──────────────────────────────────────────────────────────
// First-cut empty states. Will hold the actual table + CRUD in next passes.

function HistoryBody({ accent, t }) {
  return (
    <div style={{ padding: '40px 24px 48px', textAlign: 'center' }}>
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: `linear-gradient(135deg, ${accent}20, ${accent}08)`,
        border:     `1px solid ${accent}30`,
        margin:     '0 auto 12px',
        display:    'flex', alignItems: 'center', justifyContent: 'center',
        fontSize:   '22px',
      }}>📜</div>
      <div style={{ fontSize: '13px', color: t.text2, fontWeight: 600, marginBottom: '4px' }}>No audit history yet</div>
      <div style={{ fontSize: '11px', color: t.text4, maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
        Once auditors run their first shifts, this section will list every bill audited — auditor name, shift, weight measured vs CRM, and any discrepancies.
      </div>
    </div>
  )
}

function AuditorsBody({ accent, t }) {
  return (
    <div style={{ padding: '40px 24px 48px', textAlign: 'center' }}>
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: `linear-gradient(135deg, ${accent}20, ${accent}08)`,
        border:     `1px solid ${accent}30`,
        margin:     '0 auto 12px',
        display:    'flex', alignItems: 'center', justifyContent: 'center',
        fontSize:   '22px',
      }}>👤</div>
      <div style={{ fontSize: '13px', color: t.text2, fontWeight: 600, marginBottom: '4px' }}>No auditors added yet</div>
      <div style={{ fontSize: '11px', color: t.text4, maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
        Add the people who run the night and morning audit shifts. Each entry will store name, phone, designation, and which shift(s) they cover.
      </div>
    </div>
  )
}
