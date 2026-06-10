'use client'

// Admin → Calendar
//
// Statewise holiday list. Two views over the same data:
//   1. Table — list view, sortable, filterable by state + year. Default.
//      Each row has Toggle / Delete. Add via the inline form at the top.
//   2. Month Grid — calendar preview for a chosen month, showing every
//      holiday as a coloured chip per state on its day. Sundays are
//      visually muted (Sundays are always non-working, tracked in code,
//      not in this table).
//
// Add UX:
//   - Inline form: date input, state multi-select, description.
//     Selecting "All India" disables the other state checkboxes — one
//     row gets written, not five.
//   - Bulk paste: textarea taking CSV-style lines of
//       YYYY-MM-DD, <State>, <description>
//     Useful when ops loads a year's worth of holidays from a sheet.
//
// All writes go through /api/admin/holidays (upsert on (date, state)).

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

const STATES = ['Karnataka', 'Andhra Pradesh', 'Telangana', 'Kerala', 'All India']
const STATE_COLOR = {
  'Karnataka':       '#9275d5',
  'Andhra Pradesh':  '#5ec1d6',
  'Telangana':       '#c9a84c',
  'Kerala':          '#3aaa6a',
  'All India':       '#e05555',
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const T_LIGHT = {
  bg: '#f5f0e8', card: '#faf7f2', card2: '#f0e9d8', text1: '#1a1208', text2: '#3a2a10', text3: '#6a5a3a', text4: '#9a8a6a',
  gold: '#9a7228', border: '#e0dace', border2: '#d0c8b8', red: '#c03030', green: '#2a8050',
}
const T_DARK = {
  bg: '#0a0a0a', card: '#111111', card2: '#1a1a1a', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a',
  gold: '#c9a84c', border: '#1e1e1e', border2: '#2a2a2a', red: '#e05555', green: '#3aaa6a',
}

const fmtDateForLabel = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d} ${MONTH_NAMES[+m - 1].slice(0, 3)} ${y}`
}

export default function HolidayCalendar() {
  const { theme } = useApp()
  const t = theme === 'dark' ? T_DARK : T_LIGHT

  const today      = new Date()
  const todayIso   = today.toISOString().slice(0, 10)
  const thisYear   = today.getFullYear()
  const thisMonth0 = today.getMonth()

  const [view,         setView]         = useState('table')                  // 'table' | 'grid'
  const [year,         setYear]         = useState(thisYear)
  const [stateFilter,  setStateFilter]  = useState('')                       // '' = all
  const [gridMonth0,   setGridMonth0]   = useState(thisMonth0)               // 0-11 for grid view
  const [holidays,     setHolidays]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [toast,        setToast]        = useState(null)

  // Add form state
  const [formDate,        setFormDate]        = useState(todayIso)
  const [formStates,      setFormStates]      = useState(new Set())          // selected state names
  const [formDescription, setFormDescription] = useState('')
  const [saving,          setSaving]          = useState(false)

  // Bulk paste state
  const [bulkOpen, setBulkOpen]   = useState(false)
  const [bulkText, setBulkText]   = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type, key: Date.now() })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchHolidays = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ year: String(year) })
      if (stateFilter) qs.set('state', stateFilter)
      const r = await authedFetch(`/api/admin/holidays?${qs}`)
      const j = await r.json()
      if (j.error) { showToast(j.error, 'error'); setHolidays([]) }
      else setHolidays(j.holidays || [])
    } catch (e) {
      showToast(`Load failed: ${e.message}`, 'error')
      setHolidays([])
    }
    setLoading(false)
  }, [year, stateFilter])

  useEffect(() => { fetchHolidays() }, [fetchHolidays])

  // Submit one or more rows from the inline add form.
  const submitForm = async () => {
    if (!formDate) { showToast('Pick a date', 'error'); return }
    if (formStates.size === 0) { showToast('Select at least one state', 'error'); return }
    // 'All India' suppresses the other state rows — it's the wildcard.
    const isWildcard = formStates.has('All India')
    const targets = isWildcard ? ['All India'] : [...formStates]
    const rows = targets.map(s => ({
      holiday_date: formDate,
      state:        s,
      description:  formDescription.trim() || null,
      is_active:    true,
    }))
    setSaving(true)
    try {
      const r = await authedFetch('/api/admin/holidays', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ kind: 'upsert', rows }),
      })
      const j = await r.json()
      if (j.error) { showToast(j.error, 'error'); return }
      showToast(`Saved ${j.upserted || rows.length} holiday row${rows.length === 1 ? '' : 's'}`, 'success')
      setFormDate(todayIso); setFormStates(new Set()); setFormDescription('')
      await fetchHolidays()
    } catch (e) {
      showToast(`Save failed: ${e.message}`, 'error')
    }
    setSaving(false)
  }

  const submitBulk = async () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) { showToast('Paste at least one line', 'error'); return }
    const rows = []
    const errors = []
    lines.forEach((line, i) => {
      // CSV-ish: date, state, description. Description may contain commas if quoted.
      const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*,\s*([^,]+?)\s*(?:,\s*(.+))?$/)
      if (!m) { errors.push(`line ${i + 1}: expected "YYYY-MM-DD, State, Description"`); return }
      const date  = m[1]
      const state = m[2].trim()
      const desc  = (m[3] || '').trim().replace(/^"|"$/g, '')
      if (!STATES.includes(state)) { errors.push(`line ${i + 1}: unknown state "${state}"`); return }
      rows.push({ holiday_date: date, state, description: desc || null, is_active: true })
    })
    if (errors.length) { showToast(errors.slice(0, 3).join(' · '), 'error'); return }
    setBulkSaving(true)
    try {
      const r = await authedFetch('/api/admin/holidays', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ kind: 'upsert', rows }),
      })
      const j = await r.json()
      if (j.error) { showToast(j.error, 'error'); return }
      showToast(`Saved ${j.upserted || rows.length} holidays`, 'success')
      setBulkText(''); setBulkOpen(false)
      await fetchHolidays()
    } catch (e) {
      showToast(`Save failed: ${e.message}`, 'error')
    }
    setBulkSaving(false)
  }

  const toggleActive = async (id, next) => {
    try {
      const r = await authedFetch('/api/admin/holidays', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ kind: 'toggle', id, is_active: next }),
      })
      const j = await r.json()
      if (j.error) { showToast(j.error, 'error'); return }
      setHolidays(prev => prev.map(h => h.id === id ? { ...h, is_active: next } : h))
    } catch (e) { showToast(`Toggle failed: ${e.message}`, 'error') }
  }

  const deleteRow = async (id, label) => {
    if (!confirm(`Delete "${label}"? This is a hard delete; use the Active toggle for a temporary suppression.`)) return
    try {
      const r = await authedFetch(`/api/admin/holidays?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) { showToast(j.error || `HTTP ${r.status}`, 'error'); return }
      setHolidays(prev => prev.filter(h => h.id !== id))
      showToast('Deleted', 'success')
    } catch (e) { showToast(`Delete failed: ${e.message}`, 'error') }
  }

  // Year options — current year ± 2 (most ops add this year + plan next).
  const yearOpts = useMemo(() => {
    const arr = []
    for (let y = thisYear - 1; y <= thisYear + 2; y++) arr.push(y)
    return arr
  }, [thisYear])

  // ─── Card / button styles, reused below ────────────────────────────────────
  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 12 }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, color: t.text2, cursor: 'pointer', fontFamily: 'inherit' }
  const chip    = (active, color) => ({
    padding: '5px 12px', borderRadius: 99,
    background: active ? `${color}22` : 'transparent',
    border: `1px solid ${active ? `${color}80` : t.border2}`,
    color: active ? color : t.text3,
    fontSize: 11, fontWeight: active ? 700 : 500,
    cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background .15s, color .15s, border-color .15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Page header */}
      <div>
        <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>Calendar</div>
        <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>
          Statewise holiday list · feeds the dashboard month projection. Sundays are excluded automatically and don't need to be entered here.
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ ...card, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, rowGap: 10 }}>
        <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>Year</span>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '5px 10px', fontSize: 11, color: t.text2, fontFamily: 'inherit', outline: 'none' }}>
          {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ width: 1, height: 18, background: t.border }} />
        <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>State</span>
        <button onClick={() => setStateFilter('')} style={chip(!stateFilter, t.gold)}>All</button>
        {STATES.map(s => (
          <button key={s} onClick={() => setStateFilter(s === stateFilter ? '' : s)} style={chip(stateFilter === s, STATE_COLOR[s] || t.gold)}>
            {s}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>View</span>
        <button onClick={() => setView('table')} style={chip(view === 'table', t.gold)}>Table</button>
        <button onClick={() => setView('grid')}  style={chip(view === 'grid',  t.gold)}>Month Grid</button>
      </div>

      {/* Add form */}
      <div style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: t.text2, fontWeight: 700 }}>Add holiday</span>
          <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '5px 8px', fontSize: 11, color: t.text2, outline: 'none', colorScheme: theme }} />
          <input type="text" value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Description (e.g. Republic Day)"
            style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '5px 10px', fontSize: 11, color: t.text1, outline: 'none', minWidth: 220, flex: 1, fontFamily: 'inherit' }} />
          <button onClick={submitForm} disabled={saving} style={{ ...btnGold, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setBulkOpen(o => !o)} style={btnOut}>{bulkOpen ? 'Hide bulk paste' : 'Bulk paste…'}</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>States</span>
          {STATES.map(s => {
            const checked   = formStates.has(s)
            const isAllIdx  = formStates.has('All India')
            const isAll     = s === 'All India'
            const disabled  = !isAll && isAllIdx     // selecting All India disables others
            const color     = STATE_COLOR[s] || t.gold
            return (
              <label key={s} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11,
                color: disabled ? t.text4 : (checked ? color : t.text2),
                background: checked ? `${color}18` : 'transparent',
                border: `1px solid ${checked ? `${color}70` : t.border2}`,
                borderRadius: 99, padding: '4px 11px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                userSelect: 'none', fontWeight: checked ? 700 : 500,
                transition: 'all .15s',
              }}>
                <input type="checkbox" checked={checked} disabled={disabled}
                  onChange={() => {
                    setFormStates(prev => {
                      const next = new Set(prev)
                      if (next.has(s)) next.delete(s); else next.add(s)
                      // If All India was just selected, clear the others (server only stores one row anyway).
                      if (s === 'All India' && next.has('All India')) {
                        STATES.forEach(x => { if (x !== 'All India') next.delete(x) })
                      }
                      return next
                    })
                  }}
                  style={{ accentColor: color, cursor: disabled ? 'not-allowed' : 'pointer' }} />
                {s}
              </label>
            )
          })}
        </div>
        {bulkOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, color: t.text4 }}>
              One per line: <code style={{ background: t.card2, padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>YYYY-MM-DD, State, Description</code>. State must be one of {STATES.join(' / ')}.
            </span>
            <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={6}
              placeholder={`2026-01-26, All India, Republic Day\n2026-04-14, All India, Ambedkar Jayanti\n2026-11-01, Karnataka, Kannada Rajyotsava`}
              style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '8px 10px', fontSize: 11, color: t.text1, fontFamily: 'monospace', outline: 'none', resize: 'vertical', minHeight: 100 }} />
            <div>
              <button onClick={submitBulk} disabled={bulkSaving} style={{ ...btnGold, opacity: bulkSaving ? 0.6 : 1 }}>
                {bulkSaving ? 'Saving…' : 'Save all'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content area — table or grid */}
      {view === 'table' ? (
        <TableView holidays={holidays} loading={loading} t={t} card={card} onToggle={toggleActive} onDelete={deleteRow} />
      ) : (
        <GridView holidays={holidays} loading={loading} year={year} month0={gridMonth0} setMonth0={setGridMonth0} t={t} card={card} btnOut={btnOut} />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'error' ? `${t.red}` : toast.type === 'success' ? `${t.green}` : t.gold,
          color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)', zIndex: 10000,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Table view ────────────────────────────────────────────────────────────────
function TableView({ holidays, loading, t, card, onToggle, onDelete }) {
  if (loading) return <div style={{ ...card, padding: '40px 20px', textAlign: 'center', color: t.text3, fontSize: 12 }}>Loading…</div>
  if (holidays.length === 0) {
    return <div style={{ ...card, padding: '40px 20px', textAlign: 'center', color: t.text3, fontSize: 12 }}>
      No holidays for the current filter. Use the form above to add one, or paste a list via Bulk paste.
    </div>
  }
  const th = { padding: '11px 14px', textAlign: 'left', fontSize: 10, color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' }
  const td = { padding: '10px 14px', fontSize: 12, verticalAlign: 'middle' }
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: t.card2 }}>
            <th style={th}>Date</th>
            <th style={th}>State</th>
            <th style={th}>Description</th>
            <th style={th}>Active</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr></thead>
          <tbody>
            {holidays.map((h, i) => {
              const color = STATE_COLOR[h.state] || t.gold
              return (
                <tr key={h.id} style={{ borderBottom: `1px solid ${t.border}25`, background: i % 2 === 1 ? `${t.card2}40` : 'transparent', opacity: h.is_active ? 1 : 0.5 }}>
                  <td style={{ ...td, color: t.text1, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDateForLabel(h.holiday_date)}</td>
                  <td style={td}>
                    <span style={{ display: 'inline-block', background: `${color}20`, color, border: `1px solid ${color}50`, borderRadius: 6, padding: '2px 9px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em' }}>
                      {h.state}
                    </span>
                  </td>
                  <td style={{ ...td, color: t.text2 }}>{h.description || <span style={{ color: t.text4, fontStyle: 'italic' }}>—</span>}</td>
                  <td style={td}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={h.is_active} onChange={e => onToggle(h.id, e.target.checked)} style={{ accentColor: t.green }} />
                      <span style={{ fontSize: 11, color: h.is_active ? t.green : t.text4, fontWeight: 600 }}>{h.is_active ? 'Active' : 'Paused'}</span>
                    </label>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => onDelete(h.id, `${fmtDateForLabel(h.holiday_date)} · ${h.state} · ${h.description || ''}`.trim())}
                      style={{ background: 'transparent', color: t.red, border: `1px solid ${t.red}55`, borderRadius: 6, padding: '4px 10px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Month grid view ──────────────────────────────────────────────────────────
function GridView({ holidays, loading, year, month0, setMonth0, t, card, btnOut }) {
  // Bucket the holidays by date string for O(1) lookup per cell.
  const byDate = useMemo(() => {
    const m = {}
    for (const h of holidays) {
      if (!m[h.holiday_date]) m[h.holiday_date] = []
      m[h.holiday_date].push(h)
    }
    return m
  }, [holidays])

  const firstOfMonth = new Date(year, month0, 1)
  const lastOfMonth  = new Date(year, month0 + 1, 0)
  const firstWeekday = firstOfMonth.getDay()  // 0 = Sun
  const daysInMonth  = lastOfMonth.getDate()

  // Build a 6-row × 7-col grid. Leading and trailing nulls for padding.
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => {
    if (month0 === 0) { /* roll year? keep simple — don't */ setMonth0(0) }
    else setMonth0(month0 - 1)
  }
  const nextMonth = () => {
    if (month0 === 11) setMonth0(11)
    else setMonth0(month0 + 1)
  }

  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={prevMonth} style={btnOut} disabled={month0 === 0}>← Prev</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 14, color: t.text1, fontWeight: 700, letterSpacing: '.02em' }}>
          {MONTH_NAMES[month0]} {year}
        </div>
        <button onClick={nextMonth} style={btnOut} disabled={month0 === 11}>Next →</button>
      </div>

      {/* Day-of-week header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
        {DOW_SHORT.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: i === 0 ? t.red : t.text4, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {cells.map((d, i) => {
          if (d == null) {
            return <div key={`pad-${i}`} style={{ minHeight: 86, background: 'transparent' }} />
          }
          const iso  = `${year}-${String(month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const dow  = (firstWeekday + d - 1) % 7
          const isSunday = dow === 0
          const dayHolidays = byDate[iso] || []
          return (
            <div key={iso} style={{
              minHeight: 86, padding: '6px 8px',
              border: `1px solid ${isSunday ? `${t.red}33` : t.border}`,
              borderRadius: 8,
              background: isSunday ? `${t.red}0c` : t.card2,
              opacity: isSunday ? 0.7 : 1,
            }}>
              <div style={{ fontSize: 11, color: isSunday ? t.red : t.text2, fontWeight: 700, marginBottom: 4 }}>
                {d}{isSunday ? ' · Sun' : ''}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {dayHolidays.map(h => {
                  const color = STATE_COLOR[h.state] || t.gold
                  return (
                    <div key={h.id} title={`${h.state}${h.description ? ' · ' + h.description : ''}${h.is_active ? '' : ' (paused)'}`}
                      style={{
                        background: `${color}22`,
                        border: `1px solid ${color}50`,
                        color: color,
                        borderRadius: 4, padding: '2px 5px',
                        fontSize: 9, fontWeight: 700, letterSpacing: '.02em',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        opacity: h.is_active ? 1 : 0.4,
                      }}>
                      {h.state === 'All India' ? '🇮🇳 All' : h.state.split(' ')[0]}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {loading && (
        <div style={{ textAlign: 'center', color: t.text3, fontSize: 11, marginTop: 12 }}>Loading…</div>
      )}
    </div>
  )
}
