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
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import Toast from '../ui/Toast'

// Role minted by the "+ Add auditor" modal — basic auditor. master_auditor
// users are created via User Management (they're admin-like), but they ALSO
// audit and ALSO can be assigned to shifts, so they appear in the auditors
// list below alongside role='audit' users.
const AUDITOR_ROLE = 'audit'
// Every role that is considered "an auditor" for staffing purposes. Used
// for fetchAuditors() and mirrored in app/api/audit-shifts/route.js so the
// POST sanity check stays in sync. Both 'master_auditor' and the typo
// 'mater_auditor' are accepted in case ops created the role with either
// spelling.
const AUDITOR_ROLES = ['audit', 'master_auditor', 'mater_auditor']
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

// Today in IST as YYYY-MM-DD.
function istTodayYmd() {
  const istMs = Date.now() + (5.5 * 3600_000)
  return new Date(istMs).toISOString().slice(0, 10)
}

// Add N calendar days to a YYYY-MM-DD string. Used to pair the night
// shift on date N with the morning shift on date N+1 (the morning that
// processes what the night audited).
function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
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
  const isMobile = useMobile()
  const [tab, setTab] = useState('shifts')

  // ── Auditor list state ────────────────────────────────────────────────────
  // Auditors are stored in user_profiles with role='audit'. Inviting one from
  // here uses the same /api/invite-user endpoint that User Management uses —
  // so the entry shows up in BOTH the Audit Roster auditors section and
  // User Management. Single source of truth, no duplicate table.
  const [auditors,      setAuditors]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [modalOpen,     setModalOpen]     = useState(false)
  const [toast,         setToast]         = useState(null)
  // Past shift assignments — populates the Audit History section. One row
  // per (shift_date, shift_type), with the assigned auditors collapsed
  // into an array. Lazily fetched only when the user actually opens the
  // History tab so the default Shifts tab stays fast.
  const [historyShifts,  setHistoryShifts]  = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Shift assignments. Night and morning form a back-to-back pair: tonight's
  // night audit + tomorrow morning's audit are linked because tomorrow
  // morning processes what tonight's audit just count-checked. So the night
  // shift defaults to TODAY and the morning shift defaults to TOMORROW —
  // separate calendar dates, paired logically.
  const [nightDate]   = useState(istTodayYmd)
  const morningDate   = addDaysYmd(nightDate, 1)
  const [nightAssigns,   setNightAssigns]   = useState([])
  const [morningAssigns, setMorningAssigns] = useState([])
  const [shiftBusy,      setShiftBusy]      = useState(false)

  const fetchAuditors = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, is_active, created_at')
      .in('role', AUDITOR_ROLES)
      .order('created_at', { ascending: false })
    if (error) setToast({ msg: error.message || 'Failed to load auditors', type: 'error', key: Date.now() })
    else        setAuditors(data || [])
    setLoading(false)
  }, [])

  const fetchShifts = useCallback(async () => {
    try {
      // Two calls in parallel — night on date N, morning on date N+1. The
      // API takes one date at a time and returns both shift types for it;
      // we only consume the relevant one from each response so the
      // back-to-back rule plays out correctly across the pair.
      const [nightRes, morningRes] = await Promise.all([
        authedFetch(`/api/audit-shifts?date=${nightDate}`),
        authedFetch(`/api/audit-shifts?date=${morningDate}`),
      ])
      const nightJ   = await nightRes.json()
      const morningJ = await morningRes.json()
      if (!nightRes.ok || nightJ.error) {
        setToast({ msg: nightJ.error || 'Failed to load night shift', type: 'error', key: Date.now() })
        return
      }
      if (!morningRes.ok || morningJ.error) {
        setToast({ msg: morningJ.error || 'Failed to load morning shift', type: 'error', key: Date.now() })
        return
      }
      setNightAssigns(nightJ.night     || [])
      setMorningAssigns(morningJ.morning || [])
    } catch (e) {
      setToast({ msg: e.message || 'Failed to load shift assignments', type: 'error', key: Date.now() })
    }
  }, [nightDate, morningDate])

  useEffect(() => { fetchAuditors() }, [fetchAuditors])
  useEffect(() => { fetchShifts() }, [fetchShifts])

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await authedFetch('/api/audit-shifts?mode=history&days=30')
      const j   = await res.json().catch(() => ({}))
      if (!res.ok || j.error) {
        setToast({ msg: j.error || 'Failed to load audit history', type: 'error', key: Date.now() })
        setHistoryShifts([])
      } else {
        setHistoryShifts(j.shifts || [])
      }
    } catch (e) {
      setToast({ msg: e.message || 'Failed to load audit history', type: 'error', key: Date.now() })
      setHistoryShifts([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // Lazy-load history the first time the user opens the tab, and refresh
  // whenever they re-enter it. Shifts tab visitors don't pay this round-trip.
  useEffect(() => {
    if (tab !== 'history') return
    fetchHistory()
  }, [tab, fetchHistory])

  // Batch save for a shift draft. ShiftBody holds the staged selection
  // locally; only when ops clicks "Assign" do we walk the diff vs persisted
  // state and fire the POST/DELETEs. Sequential so the DB trigger errors
  // (cap, back-to-back) surface in a deterministic order — the first
  // failure aborts the rest of the batch.
  const saveShift = useCallback(async (shiftType, diff) => {
    const shiftDate = shiftType === 'night' ? nightDate : morningDate
    setShiftBusy(true)
    try {
      for (const auditorId of (diff.adds || [])) {
        const res = await authedFetch('/api/audit-shifts', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ shift_date: shiftDate, shift_type: shiftType, auditor_id: auditorId }),
        })
        const j = await res.json()
        if (!res.ok || j.error) {
          setToast({ msg: j.error || 'Assignment failed', type: 'error', key: Date.now() })
          await fetchShifts()
          return false
        }
      }
      for (const assignmentId of (diff.removes || [])) {
        const res = await authedFetch(`/api/audit-shifts?id=${assignmentId}`, { method: 'DELETE' })
        const j = await res.json()
        if (!res.ok || j.error) {
          setToast({ msg: j.error || 'Unassignment failed', type: 'error', key: Date.now() })
          await fetchShifts()
          return false
        }
      }
      await fetchShifts()
      const total = (diff.adds?.length || 0) + (diff.removes?.length || 0)
      if (total > 0) {
        setToast({ msg: `${shiftType === 'night' ? 'Night' : 'Morning'} shift saved.`, type: 'success', key: Date.now() })
      }
      return true
    } catch (e) {
      setToast({ msg: e.message || 'Save failed', type: 'error', key: Date.now() })
      return false
    } finally {
      setShiftBusy(false)
    }
  }, [nightDate, morningDate, fetchShifts])

  return (
    <div style={{
      padding: isMobile ? '12px 12px 80px' : '24px 28px',
      maxWidth: '1400px',
      margin: '0 auto',
      display: 'flex', flexDirection: 'column',
      gap: isMobile ? '14px' : '20px',
    }}>
      {/* Hero header */}
      <div style={{
        background:  `linear-gradient(135deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
        border:      `1px solid ${t.border}`,
        borderRadius: '16px',
        padding:     isMobile ? '14px 16px' : '22px 26px',
        display:     'flex',
        alignItems:  'center',
        gap:         isMobile ? '12px' : '18px',
        position:    'relative',
        overflow:    'hidden',
        boxShadow:   `0 1px 3px ${t.border}40`,
      }}>
        <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: '50%', height: '200%', background: `radial-gradient(ellipse at center, ${t.gold}10 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{
          width: isMobile ? '42px' : '54px', height: isMobile ? '42px' : '54px',
          borderRadius: isMobile ? '11px' : '14px',
          background: `linear-gradient(135deg, ${t.gold}25, ${t.gold}10)`,
          border:     `1px solid ${t.gold}40`,
          display:    'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:   isMobile ? '20px' : '26px',
          flexShrink: 0,
        }}>
          🗓
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? '1.15rem' : '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em', lineHeight: 1.1 }}>Audit Roster</div>
          <div style={{ fontSize: isMobile ? '11px' : '12px', color: t.text3, marginTop: isMobile ? '4px' : '6px', maxWidth: '640px' }}>
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
          isMobile={isMobile}
          bodyRenderer={(props) => {
            const isNight = props.section.id === 'night'
            // Cross-shift lock: an auditor already in the other shift would
            // trip the DB's back-to-back trigger (night N ↔ morning N+1).
            // Disable the checkbox here too so ops gets immediate feedback
            // instead of a round-trip error.
            const otherIds = new Set(
              (isNight ? morningAssigns : nightAssigns).map(a => a.auditor_id)
            )
            return (
              <ShiftBody
                {...props}
                shiftDate={isNight ? nightDate : morningDate}
                assignments={isNight ? nightAssigns : morningAssigns}
                conflictingAuditorIds={otherIds}
                auditors={auditors}
                busy={shiftBusy}
                onSave={(diff) => saveShift(props.section.id, diff)}
              />
            )
          }}
        />
      )}
      {tab === 'history' && (
        <StackedSections
          sections={HISTORY_SECTIONS}
          t={t}
          isMobile={isMobile}
          bodyRenderer={(props) => (
            <HistoryBody
              {...props}
              auditors={auditors}
              loading={loading}
              historyShifts={historyShifts}
              historyLoading={historyLoading}
              onRefresh={fetchHistory}
            />
          )}
          extras={(section, t) => extrasFor(section, t, () => setModalOpen(true))}
        />
      )}

      {modalOpen && (
        <AddAuditorModal
          t={t}
          isMobile={isMobile}
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
function StackedSections({ sections, t, isMobile = false, bodyRenderer: Body, extras }) {
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
              padding: isMobile ? '12px 14px' : '18px 22px',
              borderBottom: `1px solid ${t.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? '10px' : '14px',
            }}>
              <div style={{
                width: isMobile ? '34px' : '40px', height: isMobile ? '34px' : '40px',
                borderRadius: isMobile ? '8px' : '10px',
                background: `linear-gradient(135deg, ${accent}25, ${accent}08)`,
                border:     `1px solid ${accent}30`,
                display:    'flex', alignItems: 'center', justifyContent: 'center',
                fontSize:   isMobile ? '15px' : '18px',
                flexShrink: 0,
              }}>{section.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? '13px' : '14px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>{section.label}</div>
                <div style={{ fontSize: isMobile ? '10.5px' : '11px', color: t.text4, marginTop: '3px' }}>{section.desc}</div>
              </div>
              {extras?.(section, t)}
            </div>
            <Body section={section} accent={accent} t={t} isMobile={isMobile} />
          </div>
        )
      })}
    </>
  )
}

// ── Body renderers ──────────────────────────────────────────────────────────
function ShiftBody({ section, accent, t, isMobile = false, shiftDate, assignments = [], conflictingAuditorIds, auditors = [], busy, onSave }) {
  // Assigned auditor id -> assignment id (so we can fire DELETE when a
  // previously-saved auditor is removed from the draft on Save).
  const assignmentByAuditor = new Map(assignments.map(a => [a.auditor_id, a.id]))
  const persistedSet        = new Set(assignments.map(a => a.auditor_id))
  const conflicts           = conflictingAuditorIds instanceof Set ? conflictingAuditorIds : new Set()
  const activeAuditors      = (auditors || []).filter(a => a.is_active !== false)
  const dateLabel           = fmtPrettyDate(shiftDate)
  const dateRelative        = fmtRelativeDay(shiftDate)
  const otherShiftLabel     = section.id === 'night' ? 'morning' : 'night'

  // Draft selection — the staged set ops is editing before they click Save.
  // null = "in sync with persisted state"; a Set = "user has touched it".
  // We re-sync whenever the persisted set changes (e.g. after a successful
  // save → assignments prop updates → draft clears so the diff goes to 0).
  const [draft, setDraft] = useState(null)
  const persistedKey = [...persistedSet].sort().join(',')
  useEffect(() => { setDraft(null) }, [persistedKey])

  const workingSet  = draft ?? persistedSet
  const atCapacity  = workingSet.size >= MAX_PER_SHIFT

  // Diff between draft and persisted — drives the Assign button label + state.
  const adds    = [...workingSet].filter(id => !persistedSet.has(id))
  const removes = [...persistedSet].filter(id => !workingSet.has(id))
  const hasChanges = adds.length > 0 || removes.length > 0

  const toggle = (auditorId) => {
    const next = new Set(workingSet)
    if (next.has(auditorId)) next.delete(auditorId)
    else                     next.add(auditorId)
    setDraft(next)
  }
  const resetDraft = () => setDraft(null)
  const commitDraft = async () => {
    if (!hasChanges || busy) return
    await onSave({
      adds,
      removes: removes.map(auditorId => assignmentByAuditor.get(auditorId)).filter(Boolean),
    })
    // assignments will refresh from the parent; the useEffect above clears the draft.
  }

  return (
    <div style={{
      padding: isMobile ? '14px 14px 16px' : '20px 22px 22px',
      display: 'flex', flexDirection: 'column',
      gap: isMobile ? '12px' : '16px',
    }}>
      {/* Date + capacity header — premium card-in-card with subtle accent glow */}
      <div style={{
        background:  `linear-gradient(135deg, ${accent}10 0%, ${accent}04 60%, transparent 100%)`,
        border:      `1px solid ${accent}25`,
        borderRadius: '13px',
        padding:     isMobile ? '10px 12px' : '12px 16px',
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'space-between',
        gap:         isMobile ? '10px' : '14px',
        flexWrap:    'wrap',
        position:    'relative',
        overflow:    'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: '120%', height: '1px', background: `linear-gradient(90deg, transparent, ${accent}60, transparent)` }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '9px',
            background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
            border:     `1px solid ${accent}40`,
            color:      accent,
            display:    'flex', alignItems: 'center', justifyContent: 'center',
            fontSize:   '16px',
            flexShrink: 0,
          }}>{section.icon}</div>
          <div>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700 }}>
              {section.id === 'night' ? 'Tonight' : 'Tomorrow morning'} · shift date
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '3px' }}>
              <div style={{ fontSize: '15px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>{dateLabel}</div>
              {dateRelative && <div style={{ fontSize: '10px', color: accent, fontWeight: 600 }}>{dateRelative}</div>}
            </div>
          </div>
        </div>

        {/* Capacity pill — animates filled vs empty */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CapacityRing accent={accent} t={t} count={assignments.length} max={MAX_PER_SHIFT} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{
              fontSize: '10px',
              color: atCapacity ? accent : t.text2,
              fontWeight: 700,
              letterSpacing: '.04em',
            }}>
              {assignments.length} of {MAX_PER_SHIFT} assigned
            </span>
            <span style={{ fontSize: '8px', color: t.text4, marginTop: '2px' }}>
              {atCapacity ? 'Shift fully staffed' : `${MAX_PER_SHIFT - assignments.length} more can join`}
            </span>
          </div>
        </div>
      </div>

      {/* Auditor checklist */}
      {activeAuditors.length === 0 ? (
        <div style={{
          padding: '36px 18px', textAlign: 'center',
          background: t.card2 || t.card,
          border: `1px dashed ${t.border}`,
          borderRadius: '11px',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            background: `${t.text4}15`,
            margin: '0 auto 10px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px',
            color: t.text4,
          }}>👤</div>
          <div style={{ fontSize: '11px', color: t.text2, fontWeight: 600 }}>No active auditors yet</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>
            Add one from the <strong style={{ color: t.text2 }}>Audit History</strong> tab.
          </div>
        </div>
      ) : (
        <div>
          <div style={{
            fontSize: '9px', color: t.text4,
            letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '8px',
          }}>
            <span>Select auditors</span>
            <span style={{ fontSize: '8px', color: t.text4, letterSpacing: 0, textTransform: 'none', fontStyle: 'italic' }}>
              {activeAuditors.length} available
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeAuditors.map(a => {
              // Visual state follows the DRAFT — ops sees the row light up the
              // moment they click, even though nothing is persisted until they
              // hit Assign. The pill below distinguishes "persisted" from "pending".
              const inDraft      = workingSet.has(a.id)
              const wasPersisted = persistedSet.has(a.id)
              const lockedByPair = !inDraft && conflicts.has(a.id)
              const lockedByCap  = !inDraft && !lockedByPair && atCapacity
              const disabled     = busy || lockedByCap || lockedByPair
              const onToggle     = () => { if (!disabled) toggle(a.id) }
              const assigned     = inDraft
              // pending state — drives the right-side pill.
              const pendingAdd    = inDraft && !wasPersisted
              const pendingRemove = !inDraft && wasPersisted
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={onToggle}
                  disabled={disabled}
                  title={lockedByPair ? `Already assigned to the ${otherShiftLabel} shift — back-to-back blocked.` : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    width: '100%',
                    textAlign: 'left',
                    background: assigned
                      ? `linear-gradient(135deg, ${accent}15 0%, ${accent}05 100%)`
                      : t.card2 || t.card,
                    border: `1.5px solid ${assigned ? accent : t.border}`,
                    borderRadius: '11px',
                    padding: '12px 14px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: lockedByCap || lockedByPair ? 0.45 : 1,
                    transition: 'transform .2s cubic-bezier(.34,1.56,.64,1), border-color .2s ease, background .2s ease, box-shadow .2s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: assigned ? `0 2px 12px ${accent}15` : 'none',
                  }}
                  onMouseEnter={e => {
                    if (disabled) return
                    e.currentTarget.style.borderColor = accent
                    e.currentTarget.style.transform   = 'translateY(-2px)'
                    e.currentTarget.style.boxShadow   = `0 8px 24px ${accent}25`
                  }}
                  onMouseLeave={e => {
                    if (disabled) return
                    e.currentTarget.style.borderColor = assigned ? accent : t.border
                    e.currentTarget.style.transform   = 'translateY(0)'
                    e.currentTarget.style.boxShadow   = assigned ? `0 2px 12px ${accent}15` : 'none'
                  }}>
                  {/* Left accent rail — visible only when assigned, gives the
                      row a "selected" feeling like a tab indicator */}
                  {assigned && (
                    <span style={{
                      position: 'absolute', left: 0, top: '12%', bottom: '12%',
                      width: '3px',
                      borderRadius: '0 3px 3px 0',
                      background: `linear-gradient(180deg, ${accent}, ${accent}80)`,
                    }} />
                  )}

                  {/* Custom rounded-square checkbox */}
                  <span style={{
                    width: '20px', height: '20px',
                    borderRadius: '6px',
                    border: `2px solid ${assigned ? accent : t.text4}`,
                    background: assigned
                      ? `linear-gradient(135deg, ${accent}, ${accent}cc)`
                      : 'transparent',
                    color: '#fff',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '13px',
                    fontWeight: 900,
                    lineHeight: 1,
                    flexShrink: 0,
                    transition: 'background .15s ease, border-color .15s ease',
                    boxShadow: assigned ? `0 2px 6px ${accent}50` : 'none',
                  }}>
                    {assigned ? '✓' : ''}
                  </span>

                  {/* Avatar — larger, more premium */}
                  <span style={{
                    width: '36px', height: '36px', borderRadius: '50%',
                    background: `linear-gradient(135deg, ${accent}35, ${accent}10)`,
                    border:     `1.5px solid ${assigned ? `${accent}80` : `${accent}25`}`,
                    color:      accent,
                    fontWeight: 700,
                    fontSize:   '13px',
                    display:    'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow:  assigned ? `0 0 0 3px ${accent}10` : 'none',
                    transition: 'box-shadow .15s ease, border-color .15s ease',
                  }}>{(a.full_name || a.email || '?').charAt(0).toUpperCase()}</span>

                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{
                      fontSize: '13px', color: t.text1, fontWeight: 700, lineHeight: 1.2,
                      letterSpacing: '-.01em',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{a.full_name || '—'}</span>
                    <span style={{
                      fontSize: '10px', color: t.text3, fontFamily: 'monospace',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{a.email || '—'}</span>
                  </span>

                  {/* Right-side status pill — distinguishes persisted from staged */}
                  {pendingAdd ? (
                    <span style={{
                      fontSize: '8px',
                      color: accent,
                      background: 'transparent',
                      border: `1px dashed ${accent}80`,
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      flexShrink: 0,
                    }}>
                      PENDING · ADD
                    </span>
                  ) : pendingRemove ? (
                    <span style={{
                      fontSize: '8px',
                      color: t.red || '#c03030',
                      background: 'transparent',
                      border: `1px dashed ${t.red || '#c03030'}80`,
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      flexShrink: 0,
                    }}>
                      PENDING · REMOVE
                    </span>
                  ) : assigned ? (
                    <span style={{
                      fontSize: '8px',
                      color: '#fff',
                      background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      flexShrink: 0,
                      boxShadow: `0 2px 8px ${accent}50`,
                    }}>
                      ON SHIFT
                    </span>
                  ) : lockedByPair ? (
                    <span style={{
                      fontSize: '8px',
                      color: t.text3,
                      background: 'transparent',
                      border: `1px solid ${t.text4}50`,
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      flexShrink: 0,
                    }}>
                      ON {otherShiftLabel.toUpperCase()}
                    </span>
                  ) : lockedByCap ? (
                    <span style={{
                      fontSize: '8px',
                      color: t.text4,
                      background: 'transparent',
                      border: `1px solid ${t.text4}40`,
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      flexShrink: 0,
                    }}>
                      CAP REACHED
                    </span>
                  ) : (
                    <span style={{
                      fontSize: '9px',
                      color: t.text4,
                      flexShrink: 0,
                      fontStyle: 'italic',
                      opacity: 0.7,
                    }}>
                      Click to assign
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Save action bar — only visible when the draft differs from persisted.
          Shows a compact diff summary on the left, Discard + Assign on the right. */}
      {hasChanges && (
        <div style={{
          background:  `linear-gradient(135deg, ${accent}12 0%, ${accent}04 100%)`,
          border:      `1px solid ${accent}40`,
          borderRadius: '11px',
          padding:     '12px 14px',
          display:     'flex',
          alignItems:  'center',
          justifyContent: 'space-between',
          gap:         '12px',
          flexWrap:    'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{
              width: '24px', height: '24px', borderRadius: '7px',
              background: accent, color: '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 900, flexShrink: 0,
            }}>!</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '11px', color: t.text1, fontWeight: 700 }}>
                Unsaved changes
              </div>
              <div style={{ fontSize: '9px', color: t.text3, marginTop: '2px' }}>
                {adds.length    > 0 && <>+{adds.length} to add</>}
                {adds.length    > 0 && removes.length > 0 && <span style={{ color: t.text4, margin: '0 5px' }}>·</span>}
                {removes.length > 0 && <>−{removes.length} to remove</>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={resetDraft}
              disabled={busy}
              style={{
                background: 'transparent',
                border: `1px solid ${t.border}`,
                color: t.text2,
                borderRadius: '8px',
                padding: '7px 13px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}>
              Discard
            </button>
            <button
              type="button"
              onClick={commitDraft}
              disabled={busy}
              style={{
                background: busy ? `${accent}80` : `linear-gradient(135deg, ${accent}, ${accent}dd)`,
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '7px 16px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '.04em',
                cursor: busy ? 'wait' : 'pointer',
                boxShadow: busy ? 'none' : `0 2px 8px ${accent}40`,
                display: 'inline-flex', alignItems: 'center', gap: '6px',
              }}>
              {busy ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </div>
      )}

      {/* Footnote — back-to-back rule reminder */}
      <div style={{
        fontSize: '9px', color: t.text4,
        display: 'flex', alignItems: 'flex-start', gap: '8px',
        paddingTop: '4px',
        lineHeight: 1.5,
      }}>
        <span style={{
          flexShrink: 0,
          width: '14px', height: '14px', borderRadius: '50%',
          background: `${accent}15`,
          color: accent,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '9px',
          fontWeight: 700,
          marginTop: '1px',
        }}>i</span>
        <span style={{ fontStyle: 'italic' }}>
          {section.id === 'night'
            ? 'Auditors assigned here cannot also run tomorrow morning — back-to-back shifts are blocked.'
            : 'Auditors assigned here cannot also have run last night — back-to-back shifts are blocked.'}
        </span>
      </div>
    </div>
  )
}

// Small ring indicator showing count/max — same color scheme as the section
// accent so it reads as part of the section's visual identity.
function CapacityRing({ accent, t, count, max }) {
  const pct      = Math.min(1, count / max)
  const circ     = 2 * Math.PI * 14
  const dash     = circ * pct
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
      <circle cx="18" cy="18" r="14" fill="none" stroke={`${t.border}80`} strokeWidth="3" />
      <circle
        cx="18" cy="18" r="14"
        fill="none"
        stroke={accent}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform="rotate(-90 18 18)"
        style={{ transition: 'stroke-dasharray .3s ease' }}
      />
      <text x="18" y="22" textAnchor="middle" fontSize="11" fontWeight="700" fill={accent} fontFamily="monospace">
        {count}
      </text>
    </svg>
  )
}

// "Today" / "Tomorrow" / "in 2 days" — relative label paired with the
// absolute date so ops can scan both reads at once.
function fmtRelativeDay(ymd) {
  if (!ymd) return ''
  const today = istTodayYmd()
  if (ymd === today) return 'Today'
  if (ymd === addDaysYmd(today, 1)) return 'Tomorrow'
  if (ymd === addDaysYmd(today, -1)) return 'Yesterday'
  return ''
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

function HistoryBody({ section, accent, t, isMobile = false, auditors = [], loading = false, historyShifts = null, historyLoading = false, onRefresh }) {
  if (section.id === 'history') {
    return <HistoryShiftsList accent={accent} t={t} shifts={historyShifts} loading={historyLoading} onRefresh={onRefresh} icon={section.icon} isMobile={isMobile} />
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

// ── Audit History — past shift assignments ─────────────────────────────────
// Renders a per-date log of who worked which shift. One row per
// (shift_date, shift_type) with the assigned auditors collapsed into an
// inline chip list. Today's still-in-progress shifts live in the Shifts
// tab, not here — history only shows shifts that have already happened.

function HistoryShiftsList({ accent, t, shifts, loading, onRefresh, icon, isMobile = false }) {
  if (loading || shifts === null) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: '11px', color: t.text4 }}>
        Loading audit history…
      </div>
    )
  }
  if (!shifts.length) {
    return (
      <div style={{ padding: '40px 24px 48px', textAlign: 'center' }}>
        <div style={{
          width: '52px', height: '52px', borderRadius: '50%',
          background: `linear-gradient(135deg, ${accent}20, ${accent}08)`,
          border:     `1px solid ${accent}30`,
          margin:     '0 auto 12px',
          display:    'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:   '22px',
        }}>{icon}</div>
        <div style={{ fontSize: '13px', color: t.text2, fontWeight: 600, marginBottom: '4px' }}>No shift assignments yet</div>
        <div style={{ fontSize: '11px', color: t.text4, maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
          Once auditors are assigned in the <strong style={{ color: t.text2 }}>Shifts</strong> tab, each date + the auditors who worked it will appear here.
        </div>
      </div>
    )
  }

  // Group by date so each calendar day shows as one card containing its
  // night + morning rows.
  const byDate = new Map()
  for (const s of shifts) {
    if (!byDate.has(s.shift_date)) byDate.set(s.shift_date, [])
    byDate.get(s.shift_date).push(s)
  }
  const dateEntries = [...byDate.entries()]   // already sorted desc by the API

  const dayCount = dateEntries.length

  return (
    <div style={{ padding: isMobile ? '10px 14px 16px' : '12px 18px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: '10px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600,
        padding: '0 2px 4px',
      }}>
        <span>{dayCount} day{dayCount === 1 ? '' : 's'} of history</span>
        <button type="button" onClick={onRefresh}
          style={{
            background: 'transparent',
            border: `1px solid ${t.border}`,
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '9px',
            color: t.text3,
            cursor: 'pointer',
            fontWeight: 700,
            letterSpacing: '.06em',
          }}>
          REFRESH
        </button>
      </div>
      {dateEntries.map(([date, dayShifts]) => (
        <HistoryDayCard key={date} date={date} dayShifts={dayShifts} t={t} accent={accent} isMobile={isMobile} />
      ))}
    </div>
  )
}

// One calendar day. Holds up to 2 rows (night + morning).
function HistoryDayCard({ date, dayShifts, t, accent, isMobile }) {
  const today    = istTodayYmd()
  const relative = date === today                  ? { label: 'TODAY',     color: t.gold || '#c9a84c' }
                 : date === addDaysYmd(today,  1)  ? { label: 'TOMORROW',  color: t.blue || '#3a8fbf' }
                 : date === addDaysYmd(today, -1)  ? { label: 'YESTERDAY', color: t.text3 || '#7a6a4a' }
                 : null
  return (
    <div style={{
      background:   t.card2 || t.card,
      border:       `1px solid ${t.border}`,
      borderRadius: '11px',
      overflow:     'hidden',
    }}>
      <div style={{
        padding: isMobile ? '10px 14px' : '10px 16px',
        borderBottom: `1px solid ${t.border}`,
        background: `${accent}06`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '10px',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '12.5px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>
            {fmtPrettyDate(date)}
          </div>
          {relative && (
            <span style={{
              fontSize: '8.5px',
              color: relative.color,
              background: `${relative.color}15`,
              border: `1px solid ${relative.color}50`,
              borderRadius: '999px',
              padding: '2px 7px',
              fontWeight: 700,
              letterSpacing: '.08em',
            }}>
              {relative.label}
            </span>
          )}
        </div>
        <span style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>
          {dayShifts.length} shift{dayShifts.length === 1 ? '' : 's'} assigned
        </span>
      </div>
      {dayShifts.map(s => <HistoryShiftRow key={s.shift_type} shift={s} t={t} isMobile={isMobile} />)}
    </div>
  )
}

function HistoryShiftRow({ shift, t, isMobile }) {
  const isNight   = shift.shift_type === 'night'
  const shiftAccent = isNight ? (t.gold || '#c9a84c') : (t.orange || '#e9a942')
  const shiftIcon = isNight ? '🌙' : '☀'
  const shiftLabel = isNight ? 'Night' : 'Morning'
  const window  = isNight ? '19:30–24:00 IST' : '08:30–20:00 IST'

  return (
    <div style={{
      padding: isMobile ? '11px 14px' : '12px 16px',
      display: 'flex',
      alignItems: isMobile ? 'flex-start' : 'center',
      gap: '12px',
      borderTop: `1px solid ${t.border}40`,
      flexDirection: isMobile ? 'column' : 'row',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: isMobile ? 0 : '140px' }}>
        <div style={{
          width: '30px', height: '30px', borderRadius: '8px',
          background: `linear-gradient(135deg, ${shiftAccent}30, ${shiftAccent}10)`,
          border:     `1px solid ${shiftAccent}40`,
          color:      shiftAccent,
          display:    'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:   '14px',
          flexShrink: 0,
        }}>{shiftIcon}</div>
        <div>
          <div style={{ fontSize: '12px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>{shiftLabel}</div>
          <div style={{ fontSize: '9.5px', color: t.text4, marginTop: '2px', fontFamily: 'monospace' }}>{window}</div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {shift.auditors.length === 0 ? (
          <span style={{ fontSize: '11px', color: t.text4, fontStyle: 'italic' }}>No one was assigned.</span>
        ) : (
          shift.auditors.map(a => <AuditorChip key={a.id} auditor={a} t={t} accent={shiftAccent} />)
        )}
      </div>
    </div>
  )
}

function AuditorChip({ auditor, t, accent }) {
  const initial = (auditor.full_name || auditor.email || '?').charAt(0).toUpperCase()
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '7px',
      background: `${accent}10`,
      border: `1px solid ${accent}35`,
      borderRadius: '999px',
      padding: '4px 11px 4px 4px',
      maxWidth: '100%',
    }}>
      <span style={{
        width: '20px', height: '20px', borderRadius: '50%',
        background: `linear-gradient(135deg, ${accent}40, ${accent}15)`,
        color: accent,
        fontSize: '10px', fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{initial}</span>
      <span style={{
        fontSize: '11px', color: t.text1, fontWeight: 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{auditor.full_name || auditor.email || '—'}</span>
    </div>
  )
}

// ── Add Auditor modal ──────────────────────────────────────────────────────
// Same shape as the User Management add-user flow (POST /api/invite-user),
// but the role is fixed to 'audit' — no role picker on the form. After the
// invite returns success, the new auditor lands in BOTH user_profiles AND
// the Audit Roster auditors list (same row, queried two different places).

function AddAuditorModal({ t, isMobile = false, onClose, onAdded, onError }) {
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
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,.7)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: isMobile ? '0' : '20px',
        backdropFilter: 'blur(4px)',
      }}>
      <div style={{
        background: t.card,
        border: `1px solid ${t.gold}40`,
        borderRadius: isMobile ? '14px 14px 0 0' : '14px',
        width: '100%',
        maxWidth: '460px',
        maxHeight: isMobile ? '92vh' : 'none',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.6)',
        overflow: 'auto',
      }}>
        <div style={{ padding: isMobile ? '14px 18px' : '20px 24px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>Add auditor</div>
          <div style={{ fontSize: '11px', color: t.text4, marginTop: '4px' }}>
            They'll get an invite email and a profile in both Audit Roster and User Management.
          </div>
        </div>
        <div style={{ padding: isMobile ? '14px 18px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
        <div style={{
          padding: isMobile ? '12px 18px' : '14px 24px',
          borderTop: `1px solid ${t.border}`,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
          flexDirection: isMobile ? 'column-reverse' : 'row',
        }}>
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
