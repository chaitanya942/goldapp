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

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import Toast from '../ui/Toast'

// All auditors share the same role — fixed, not user-selectable in the modal.
// Same role string the existing ROLE_GROUPS.AUDIT (lib/apiAuth.js) admits, so
// every auditor added here also satisfies the audit endpoints' auth check.
const AUDITOR_ROLE = 'audit'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  },
  {
    id:     'morning',
    label:  'Morning Weight + Melting Audit',
    icon:   '☀',
    accent: 'orange',
    desc:   'Bills audited during the morning shift — weight check + melting readiness.',
  },
]

// Today in IST as YYYY-MM-DD — first cut defaults the shift date to today.
// A date picker can be added later if ops needs to plan ahead.
function istTodayYmd() {
  const istMs = Date.now() + (5.5 * 3600_000)
  return new Date(istMs).toISOString().slice(0, 10)
}

const MAX_PER_SHIFT = 2

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

  // ── Auditor list state ────────────────────────────────────────────────────
  // Auditors are stored in user_profiles with role='audit'. Inviting one from
  // here uses the same /api/invite-user endpoint that User Management uses —
  // so the entry shows up in BOTH the Audit Roster auditors section and
  // User Management. Single source of truth, no duplicate table.
  const [auditors,  setAuditors]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [toast,     setToast]     = useState(null)

  // Shift assignments — first cut pins to today's date. Adding a date
  // picker later is a one-state change.
  const [shiftDate]      = useState(istTodayYmd)
  const [nightAssigns,   setNightAssigns]   = useState([])
  const [morningAssigns, setMorningAssigns] = useState([])
  const [shiftBusy,      setShiftBusy]      = useState(false)

  const fetchAuditors = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, is_active, created_at')
      .eq('role', AUDITOR_ROLE)
      .order('created_at', { ascending: false })
    if (error) setToast({ msg: error.message || 'Failed to load auditors', type: 'error', key: Date.now() })
    else        setAuditors(data || [])
    setLoading(false)
  }, [])

  const fetchShifts = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/audit-shifts?date=${shiftDate}`)
      const j   = await res.json()
      if (!res.ok || j.error) {
        setToast({ msg: j.error || 'Failed to load shift assignments', type: 'error', key: Date.now() })
        return
      }
      setNightAssigns(j.night   || [])
      setMorningAssigns(j.morning || [])
    } catch (e) {
      setToast({ msg: e.message || 'Failed to load shift assignments', type: 'error', key: Date.now() })
    }
  }, [shiftDate])

  useEffect(() => { fetchAuditors() }, [fetchAuditors])
  useEffect(() => { fetchShifts() }, [fetchShifts])

  // Assign / unassign handlers used by both shift sections.
  const assignAuditor = useCallback(async (shiftType, auditorId) => {
    setShiftBusy(true)
    try {
      const res = await authedFetch('/api/audit-shifts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ shift_date: shiftDate, shift_type: shiftType, auditor_id: auditorId }),
      })
      const j = await res.json()
      if (!res.ok || j.error) {
        setToast({ msg: j.error || 'Assignment failed', type: 'error', key: Date.now() })
        return
      }
      await fetchShifts()
    } catch (e) {
      setToast({ msg: e.message || 'Assignment failed', type: 'error', key: Date.now() })
    } finally {
      setShiftBusy(false)
    }
  }, [shiftDate, fetchShifts])

  const unassignAuditor = useCallback(async (assignmentId) => {
    setShiftBusy(true)
    try {
      const res = await authedFetch(`/api/audit-shifts?id=${assignmentId}`, { method: 'DELETE' })
      const j = await res.json()
      if (!res.ok || j.error) {
        setToast({ msg: j.error || 'Unassignment failed', type: 'error', key: Date.now() })
        return
      }
      await fetchShifts()
    } catch (e) {
      setToast({ msg: e.message || 'Unassignment failed', type: 'error', key: Date.now() })
    } finally {
      setShiftBusy(false)
    }
  }, [fetchShifts])

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
      {tab === 'shifts' && (
        <StackedSections
          sections={SHIFT_SECTIONS}
          t={t}
          bodyRenderer={(props) => (
            <ShiftBody
              {...props}
              shiftDate={shiftDate}
              assignments={props.section.id === 'night' ? nightAssigns : morningAssigns}
              auditors={auditors}
              busy={shiftBusy}
              onAssign={(auditorId) => assignAuditor(props.section.id, auditorId)}
              onUnassign={unassignAuditor}
            />
          )}
        />
      )}
      {tab === 'history' && (
        <StackedSections
          sections={HISTORY_SECTIONS}
          t={t}
          bodyRenderer={(props) => <HistoryBody {...props} auditors={auditors} loading={loading} />}
          extras={(section, t) => extrasFor(section, t, () => setModalOpen(true))}
        />
      )}

      {modalOpen && (
        <AddAuditorModal
          t={t}
          onClose={() => setModalOpen(false)}
          onAdded={(msg) => {
            setToast({ msg, type: 'success', key: Date.now() })
            setModalOpen(false)
            fetchAuditors()
          }}
          onError={(msg) => setToast({ msg, type: 'error', key: Date.now() })}
        />
      )}

      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}

// extras() decides whether a section header gets a button on the right.
function extrasFor(section, t, onClick) {
  if (section.id !== 'auditors') return null
  const accent = t.blue || t.gold
  return (
    <button
      onClick={onClick}
      style={{
        background: accent,
        color: '#fff',
        border: 'none',
        borderRadius: '9px',
        padding: '8px 16px',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '.02em',
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        flexShrink: 0,
        transition: 'transform .15s ease, box-shadow .15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${accent}40` }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)';   e.currentTarget.style.boxShadow = 'none' }}>
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
function ShiftBody({ section, accent, t, shiftDate, assignments = [], auditors = [], busy, onAssign, onUnassign }) {
  // Auditors NOT already on this shift — candidate set for the picker.
  // Conflict prevention (no-back-to-back) is enforced server-side too; we
  // don't filter on the client for that because the client doesn't know the
  // other shift's assignments without an extra prop. The server returns a
  // clear toast on rejection.
  const assignedIds  = new Set(assignments.map(a => a.auditor_id))
  const availables   = (auditors || []).filter(a => a.is_active !== false && !assignedIds.has(a.id))
  const atCapacity   = assignments.length >= MAX_PER_SHIFT
  const dateLabel    = fmtPrettyDate(shiftDate)

  return (
    <div style={{ padding: '18px 22px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Date label so the operator always knows which day's slot they're editing */}
      <div style={{
        fontSize: '10px', color: t.text4, letterSpacing: '.1em',
        textTransform: 'uppercase', fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <span>Shift date</span>
        <span style={{ fontSize: '11px', color: t.text2, letterSpacing: 0, textTransform: 'none', fontWeight: 600, fontFamily: 'monospace' }}>{dateLabel}</span>
        <span style={{ fontSize: '10px', color: t.text4, letterSpacing: 0, textTransform: 'none' }}>· up to {MAX_PER_SHIFT} auditors per shift</span>
      </div>

      {/* Assigned auditor chips */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {assignments.length === 0 && (
          <span style={{ fontSize: '11px', color: t.text4, fontStyle: 'italic' }}>No auditors assigned yet.</span>
        )}
        {assignments.map(a => (
          <span key={a.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background:  `${accent}10`,
            border:      `1px solid ${accent}40`,
            borderRadius: '999px',
            padding:     '6px 6px 6px 12px',
            fontSize:    '12px',
            color:       t.text1,
            fontWeight:  600,
          }}>
            <span style={{
              width: '18px', height: '18px', borderRadius: '50%',
              background: `${accent}30`,
              color: accent,
              fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px',
            }}>{(a.auditor?.full_name || a.auditor?.email || '?').charAt(0).toUpperCase()}</span>
            <span>{a.auditor?.full_name || a.auditor?.email || '—'}</span>
            <button onClick={() => onUnassign(a.id)} disabled={busy}
              title="Unassign auditor"
              style={{
                background: 'transparent',
                border: 'none',
                color: t.text3,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                padding: '0 8px',
                borderRadius: '50%',
                lineHeight: 1,
                transition: 'color .15s ease, background .15s ease',
              }}
              onMouseEnter={e => { if (!busy) { e.currentTarget.style.color = t.red; e.currentTarget.style.background = `${t.red}15` } }}
              onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.background = 'transparent' }}>
              ✕
            </button>
          </span>
        ))}
      </div>

      {/* Picker — disabled when at capacity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <select
          disabled={busy || atCapacity || availables.length === 0}
          value=""
          onChange={e => { if (e.target.value) onAssign(e.target.value) }}
          style={{
            background: t.card2 || t.card,
            border: `1px solid ${atCapacity ? `${t.border}80` : t.border}`,
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '12px',
            color: t.text1,
            outline: 'none',
            cursor: (busy || atCapacity || availables.length === 0) ? 'not-allowed' : 'pointer',
            minWidth: '220px',
            opacity: (busy || atCapacity || availables.length === 0) ? 0.55 : 1,
          }}>
          <option value="">
            {atCapacity
              ? `Shift is at the ${MAX_PER_SHIFT}-auditor cap`
              : availables.length === 0
                ? auditors.length === 0
                  ? 'No auditors yet — add one from the Audit History tab'
                  : 'Every auditor is already on this shift'
                : 'Select an auditor to assign…'}
          </option>
          {availables.map(a => (
            <option key={a.id} value={a.id}>
              {a.full_name || a.email}{a.full_name ? ` · ${a.email}` : ''}
            </option>
          ))}
        </select>
        <span style={{ fontSize: '10px', color: t.text4, fontStyle: 'italic' }}>
          {section.id === 'night'
            ? 'Auditors here cannot also run tomorrow morning (back-to-back rule).'
            : 'Auditors here cannot also have run last night (back-to-back rule).'}
        </span>
      </div>
    </div>
  )
}

// Pretty date label like "Mon, 02 Jun 2026". Pure formatting helper.
function fmtPrettyDate(ymd) {
  if (!ymd || typeof ymd !== 'string') return '—'
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ymd
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function HistoryBody({ section, accent, t, auditors = [], loading = false }) {
  // Audit history is still a future pass (need an audit_events table); the
  // auditors body renders the real list now.
  if (section.id === 'history') {
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
        <div style={{ fontSize: '13px', color: t.text2, fontWeight: 600, marginBottom: '4px' }}>No audit history yet</div>
        <div style={{ fontSize: '11px', color: t.text4, maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
          Once auditors run their first shifts, this section will list every bill audited — auditor name, shift, weight measured vs CRM, and any discrepancies.
        </div>
      </div>
    )
  }

  // section.id === 'auditors' — real list.
  if (loading) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: '11px', color: t.text4 }}>Loading auditors…</div>
    )
  }
  if (!auditors.length) {
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
        <div style={{ fontSize: '13px', color: t.text2, fontWeight: 600, marginBottom: '4px' }}>No auditors added yet</div>
        <div style={{ fontSize: '11px', color: t.text4, maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
          Click <strong style={{ color: t.text2 }}>+ Add auditor</strong> above to invite the people who run the audit shifts. They'll also show up in User Management.
        </div>
      </div>
    )
  }
  return (
    <div style={{ padding: '12px 18px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {auditors.map(a => (
        <div key={a.id} style={{
          background:    t.card2 || t.card,
          border:        `1px solid ${t.border}`,
          borderRadius:  '10px',
          padding:       '12px 16px',
          display:       'flex',
          alignItems:    'center',
          gap:           '14px',
          transition:    'border-color .15s ease, transform .15s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}60`; e.currentTarget.style.transform = 'translateY(-1px)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = 'translateY(0)' }}>
          {/* Avatar — first-letter circle, accent tinted */}
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
            border:     `1px solid ${accent}40`,
            display:    'flex', alignItems: 'center', justifyContent: 'center',
            color:      accent,
            fontWeight: 700,
            fontSize:   '13px',
            flexShrink: 0,
          }}>{(a.full_name || a.email || '?').charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {a.full_name || '—'}
            </div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {a.email || '—'}
            </div>
          </div>
          <span style={{
            fontSize: '9px',
            color: a.is_active === false ? t.text4 : t.green,
            background: a.is_active === false ? `${t.text4}15` : `${t.green}15`,
            border: `1px solid ${(a.is_active === false ? t.text4 : t.green)}40`,
            borderRadius: '999px',
            padding: '2px 8px',
            fontWeight: 700,
            letterSpacing: '.05em',
            flexShrink: 0,
          }}>
            {a.is_active === false ? 'INACTIVE' : 'ACTIVE'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Add Auditor modal ──────────────────────────────────────────────────────
// Same shape as the User Management add-user flow (POST /api/invite-user),
// but the role is fixed to 'audit' — no role picker on the form. After the
// invite returns success, the new auditor lands in BOTH user_profiles AND
// the Audit Roster auditors list (same row, queried two different places).

function AddAuditorModal({ t, onClose, onAdded, onError }) {
  const [name, setName]    = useState('')
  const [email, setEmail]  = useState('')
  const [busy, setBusy]    = useState(false)

  const submit = async () => {
    const cleanName  = name.trim()
    const cleanEmail = email.trim()
    if (!cleanName)  return onError('Name is required.')
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) return onError('A valid email is required.')

    setBusy(true)
    try {
      const res = await authedFetch('/api/invite-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:     cleanEmail,
          full_name: cleanName,
          role:      AUDITOR_ROLE,
        }),
      })
      const j = await res.json()
      if (!res.ok || j.error) {
        onError(j.error || 'Invite failed')
        return
      }
      onAdded(`Invited ${cleanName} (${cleanEmail}) as auditor.`)
    } catch (e) {
      onError(e.message || 'Invite failed')
    } finally {
      setBusy(false)
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal((
    <div onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px', backdropFilter: 'blur(4px)' }}>
      <div style={{
        background: t.card,
        border: `1px solid ${t.gold}40`,
        borderRadius: '14px',
        width: '100%',
        maxWidth: '460px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.6)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>Add auditor</div>
          <div style={{ fontSize: '11px', color: t.text4, marginTop: '4px' }}>
            They'll get an invite email and a profile in both Audit Roster and User Management.
          </div>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} disabled={busy}
              placeholder="Full name"
              autoFocus
              style={{ width: '100%', background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} disabled={busy}
              placeholder="name@whitegold.money"
              type="email"
              style={{ width: '100%', background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: t.text1, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
          </div>
          {/* Role — visible but locked. Mirrors the User Management form shape
              so ops sees a consistent UI, but the field is disabled (with a
              lock icon hint) so it can't be changed from this entry point.
              For any other role, ops uses User Management. */}
          <div>
            <label style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span>Role</span>
              <span style={{ fontSize: '11px', opacity: 0.8 }}>🔒</span>
              <span style={{ fontSize: '9px', color: t.text4, letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>locked — change via User Management</span>
            </label>
            <div style={{
              background: `${t.gold}08`,
              border: `1px solid ${t.gold}30`,
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '13px',
              color: t.gold,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'not-allowed',
              opacity: 0.95,
            }}>
              <span>Auditor</span>
              <span style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace', fontWeight: 400 }}>(audit)</span>
            </div>
          </div>
        </div>
        <div style={{ padding: '14px 24px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={busy}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 16px', fontSize: '12px', color: t.text2, cursor: busy ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !name.trim() || !email.trim()}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '8px 18px', fontSize: '12px', fontWeight: 700, cursor: (busy || !name.trim() || !email.trim()) ? 'not-allowed' : 'pointer', opacity: (busy || !name.trim() || !email.trim()) ? 0.55 : 1 }}>
            {busy ? 'Inviting…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}
