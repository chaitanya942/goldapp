'use client'

// Audit Roster — host page for the audit team's day.
//
// Two top-level tabs:
//
//   1) SHIFTS — the two shift workflows stacked one below the other:
//        🌙 Night Weight Audit
//        ☀ Morning Weight + Melting Audit
//
//   2) AUDIT HISTORY — past audit log + list of auditors stacked:
//        📜 Audit History
//        👤 Auditors
//
// Tabs at the top level (Shifts vs History) because the user mental
// model is different — Shifts is the active workflow lane, History
// is the reporting + roster admin lane. Inside each tab the sections
// are stacked (no inner tabs), per the earlier preference.
//
// All bodies are first-cut shells. Real data + actions land in
// subsequent passes.

import { useState } from 'react'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const TABS = [
  { id: 'shifts',  label: 'Shifts',        icon: '🗓' },
  { id: 'history', label: 'Audit History', icon: '📜' },
]

const SHIFT_SECTIONS = [
  {
    id:     'night',
    label:  'Night Weight Audit',
    icon:   '🌙',
    accent: 'gold',
    desc:   'Bills audited during the night shift — weight check only.',
    hint:   'Workflow scaffolding next — bill queue, weight entry.',
  },
  {
    id:     'morning',
    label:  'Morning Weight + Melting Audit',
    icon:   '☀',
    accent: 'orange',
    desc:   'Bills audited during the morning shift — weight check + melting readiness.',
    hint:   'Workflow scaffolding next — bill queue, weight entry, and melting sign-off.',
  },
]

const HISTORY_SECTIONS = [
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

export default function AuditRoster() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [tab, setTab] = useState('shifts')

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
            Night + morning audit shifts, audit history, and the team running them.
          </div>
        </div>
      </div>

      {/* Top-level tab strip */}
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
                transition: 'transform .18s cubic-bezier(.34,1.56,.64,1), color .15s ease, background .15s ease, border-color .15s ease, box-shadow .2s ease',
                boxShadow: isActive ? `0 0 0 4px ${t.gold}12, 0 2px 6px ${t.gold}25` : 'none',
              }}
              onMouseEnter={e => {
                if (isActive) return
                e.currentTarget.style.borderColor = `${t.gold}60`
                e.currentTarget.style.color       = t.gold
                e.currentTarget.style.transform   = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                if (isActive) return
                e.currentTarget.style.borderColor = t.border
                e.currentTarget.style.color       = t.text2
                e.currentTarget.style.transform   = 'translateY(0)'
              }}>
              <span style={{ fontSize: '14px', lineHeight: 1 }}>{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </div>

      {/* Tab body */}
      {tab === 'shifts'  && <StackedSections sections={SHIFT_SECTIONS}  t={t} bodyRenderer={ShiftBody}   />}
      {tab === 'history' && <StackedSections sections={HISTORY_SECTIONS} t={t} bodyRenderer={HistoryBody} extras={extrasFor} />}
    </div>
  )
}

// extras() decides whether a section header gets a button on the right.
function extrasFor(section, t) {
  if (section.id !== 'auditors') return null
  const accent = t.blue || t.gold
  return (
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
  )
}

// ── Stacked-sections layout used by both tabs ──────────────────────────────
function StackedSections({ sections, t, bodyRenderer: Body, extras }) {
  return (
    <>
      {sections.map(section => {
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
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)` }} />
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
              {extras?.(section, t)}
            </div>
            <Body section={section} accent={accent} t={t} />
          </div>
        )
      })}
    </>
  )
}

// ── Body renderers ──────────────────────────────────────────────────────────
function ShiftBody({ section, t }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '11px', color: t.text4, fontStyle: 'italic', maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
        {section.hint || 'Workflow scaffolding next.'}
      </div>
    </div>
  )
}

function HistoryBody({ section, accent, t }) {
  const isHistory = section.id === 'history'
  return (
    <div style={{ padding: '40px 24px 48px', textAlign: 'center' }}>
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: `linear-gradient(135deg, ${accent}20, ${accent}08)`,
        border:     `1px solid ${accent}30`,
        margin:     '0 auto 12px',
        display:    'flex', alignItems: 'center', justifyContent: 'center',
        fontSize:   '22px',
      }}>{section.icon}</div>
      <div style={{ fontSize: '13px', color: t.text2, fontWeight: 600, marginBottom: '4px' }}>
        {isHistory ? 'No audit history yet' : 'No auditors added yet'}
      </div>
      <div style={{ fontSize: '11px', color: t.text4, maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
        {isHistory
          ? 'Once auditors run their first shifts, this section will list every bill audited — auditor name, shift, weight measured vs CRM, and any discrepancies.'
          : 'Add the people who run the night and morning audit shifts. Each entry will store name, phone, designation, and which shift(s) they cover.'}
      </div>
    </div>
  )
}
