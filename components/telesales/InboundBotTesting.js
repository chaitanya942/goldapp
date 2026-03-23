'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const OUTCOMES = [
  { value: '',              label: 'All Outcomes',    color: '' },
  { value: 'interested',    label: 'Interested',      color: '#3aaa6a' },
  { value: 'callback',      label: 'Callback',        color: '#3a8fbf' },
  { value: 'not_interested',label: 'Not Interested',  color: '#e05555' },
  { value: 'no_answer',     label: 'No Answer',       color: '#9a8a6a' },
  { value: 'wrong_number',  label: 'Wrong Number',    color: '#c9981f' },
]

const OUTCOME_META = {
  interested:     { label: 'Interested',     color: '#3aaa6a' },
  callback:       { label: 'Callback',       color: '#3a8fbf' },
  not_interested: { label: 'Not Interested', color: '#e05555' },
  no_answer:      { label: 'No Answer',      color: '#9a8a6a' },
  wrong_number:   { label: 'Wrong Number',   color: '#c9981f' },
}

const fmt         = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtDate     = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDuration = (s) => { if (!s) return '—'; const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}` }

// Mock data for now — replace with real Supabase data once S3 is wired up
const MOCK_CALLS = [
  { id: '1', call_date: '2026-03-18', call_time: '10:23:00', customer_number: '9876543210', customer_name: 'Rajesh Kumar', branch_name: 'MYSURU', duration_seconds: 183, recording_url: null, transcript: null, outcome: 'interested', outcome_notes: 'Customer interested in selling 20g gold next week' },
  { id: '2', call_date: '2026-03-18', call_time: '11:05:00', customer_number: '8765432109', customer_name: 'Priya Sharma', branch_name: 'HUBLI', duration_seconds: 67, recording_url: null, transcript: null, outcome: 'callback', outcome_notes: 'Call back on Monday 10 AM' },
  { id: '3', call_date: '2026-03-18', call_time: '11:45:00', customer_number: '7654321098', customer_name: 'Mohammed Farhan', branch_name: 'AP-KAKINADA', duration_seconds: 42, recording_url: null, transcript: null, outcome: 'not_interested', outcome_notes: null },
  { id: '4', call_date: '2026-03-18', call_time: '14:12:00', customer_number: '6543210987', customer_name: null, branch_name: 'MANGALORE', duration_seconds: 8, recording_url: null, transcript: null, outcome: 'no_answer', outcome_notes: null },
  { id: '5', call_date: '2026-03-17', call_time: '09:30:00', customer_number: '9543210876', customer_name: 'Sunita Devi', branch_name: 'MYSURU', duration_seconds: 224, recording_url: null, transcript: null, outcome: 'interested', outcome_notes: 'Has 35g ornaments, visiting branch tomorrow' },
  { id: '6', call_date: '2026-03-17', call_time: '10:15:00', customer_number: '8432109765', customer_name: 'Venkat Rao', branch_name: 'KL-KOCHI', duration_seconds: 156, recording_url: null, transcript: null, outcome: 'callback', outcome_notes: 'Wants to discuss rates first' },
  { id: '7', call_date: '2026-03-17', call_time: '12:00:00', customer_number: '7321098654', customer_name: 'Lakshmi Bai', branch_name: 'HUBLI', duration_seconds: 95, recording_url: null, transcript: null, outcome: 'wrong_number', outcome_notes: null },
  { id: '8', call_date: '2026-03-16', call_time: '15:30:00', customer_number: '9210987543', customer_name: 'Arjun Nair', branch_name: 'KL-THRISSUR', duration_seconds: 312, recording_url: null, transcript: null, outcome: 'interested', outcome_notes: 'High value customer — 80g+ gold' },
]

export default function InboundBotTesting() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [calls, setCalls]           = useState(MOCK_CALLS)
  const [loading, setLoading]       = useState(false)
  const [search, setSearch]         = useState('')
  const [filterOutcome, setFilterOutcome] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [selectedCall, setSelectedCall]   = useState(null)
  const [transcribing, setTranscribing]   = useState(false)
  const [savingOutcome, setSavingOutcome] = useState(false)
  const [outcomeForm, setOutcomeForm]     = useState({ outcome: '', notes: '' })
  const audioRef = useRef(null)

  // Stats
  const totalCalls      = calls.length
  const totalDuration   = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0)
  const interestedCount = calls.filter(c => c.outcome === 'interested').length
  const callbackCount   = calls.filter(c => c.outcome === 'callback').length
  const conversionRate  = totalCalls > 0 ? ((interestedCount / totalCalls) * 100).toFixed(1) : 0

  const filtered = calls.filter(c => {
    const matchSearch  = !search || c.customer_number?.includes(search) || c.customer_name?.toLowerCase().includes(search.toLowerCase()) || c.branch_name?.toLowerCase().includes(search.toLowerCase())
    const matchOutcome = !filterOutcome || c.outcome === filterOutcome
    const matchDate    = !filterDate || c.call_date === filterDate
    return matchSearch && matchOutcome && matchDate
  })

  const handleOpenCall = (call) => {
    setSelectedCall(call)
    setOutcomeForm({ outcome: call.outcome || '', notes: call.outcome_notes || '' })
  }

  const handleTranscribe = async () => {
    if (!selectedCall?.recording_url) {
      alert('No recording available yet — recordings will appear once S3 is connected.')
      return
    }
    setTranscribing(true)
    // TODO: Call Claude API to transcribe once S3 is wired
    await new Promise(r => setTimeout(r, 2000))
    setTranscribing(false)
    alert('Transcription will be available once recordings are connected from S3.')
  }

  const handleSaveOutcome = async () => {
    if (!outcomeForm.outcome) return
    setSavingOutcome(true)
    // Update in Supabase (mock for now)
    const updated = calls.map(c => c.id === selectedCall.id
      ? { ...c, outcome: outcomeForm.outcome, outcome_notes: outcomeForm.notes }
      : c
    )
    setCalls(updated)
    setSelectedCall(prev => ({ ...prev, outcome: outcomeForm.outcome, outcome_notes: outcomeForm.notes }))
    setSavingOutcome(false)
  }

  const s = {
    card:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px 24px', marginBottom: '16px' },
    th:      { padding: '10px 14px', fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 600, whiteSpace: 'nowrap' },
    td:      { padding: '11px 14px', fontSize: '13px', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    input:   { background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '13px', outline: 'none' },
    select:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '13px', cursor: 'pointer' },
    btnGold: { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '8px 18px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
    btnOut:  { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 18px', fontSize: '12px', cursor: 'pointer' },
    lbl:     { fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px', display: 'block' },
  }

  // ── CALL DETAIL PANEL
  if (selectedCall) {
    const meta = OUTCOME_META[selectedCall.outcome] || null
    return (
      <div style={{ padding: '32px', maxWidth: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <button style={{ ...s.btnOut, marginBottom: '12px', fontSize: '12px' }} onClick={() => setSelectedCall(null)}>← Back</button>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1 }}>{selectedCall.customer_name || selectedCall.customer_number}</div>
            <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>
              {fmtDate(selectedCall.call_date)} · {selectedCall.call_time?.slice(0,5)} · {fmtDuration(selectedCall.duration_seconds)} · {selectedCall.branch_name}
            </div>
          </div>
          {meta && <span style={{ fontSize: '12px', color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, borderRadius: '6px', padding: '4px 12px', fontWeight: 600 }}>{meta.label}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Left — Recording + Transcript */}
          <div>
            {/* Audio Player */}
            <div style={{ ...s.card, marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '16px' }}>Recording</div>
              {selectedCall.recording_url ? (
                <audio ref={audioRef} controls style={{ width: '100%', borderRadius: '8px' }} src={selectedCall.recording_url} />
              ) : (
                <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '28px', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', opacity: .2, marginBottom: '8px' }}>🎙</div>
                  <div style={{ fontSize: '13px', color: t.text3, marginBottom: '4px' }}>Recording not available yet</div>
                  <div style={{ fontSize: '11px', color: t.text4 }}>Will appear once S3 is connected</div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px' }}>
                <div style={{ fontSize: '12px', color: t.text3 }}>Duration: <span style={{ color: t.text1 }}>{fmtDuration(selectedCall.duration_seconds)}</span></div>
                <div style={{ fontSize: '12px', color: t.text3 }}>Number: <span style={{ color: t.gold }}>{selectedCall.customer_number}</span></div>
              </div>
            </div>

            {/* Transcript */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Transcript</div>
                <button style={{ ...s.btnOut, fontSize: '11px', padding: '5px 12px', color: t.blue, borderColor: `${t.blue}50` }} onClick={handleTranscribe} disabled={transcribing}>
                  {transcribing ? '⟳ Transcribing...' : '✦ Auto Transcribe'}
                </button>
              </div>
              {selectedCall.transcript ? (
                <div style={{ fontSize: '13px', color: t.text2, lineHeight: 1.8, maxHeight: '300px', overflowY: 'auto' }}>
                  {selectedCall.transcript}
                </div>
              ) : (
                <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', color: t.text3, marginBottom: '4px' }}>No transcript yet</div>
                  <div style={{ fontSize: '11px', color: t.text4 }}>Click "Auto Transcribe" to generate using Claude AI</div>
                </div>
              )}
            </div>
          </div>

          {/* Right — Outcome + Notes */}
          <div>
            <div style={s.card}>
              <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '16px' }}>Call Outcome</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                {OUTCOMES.filter(o => o.value).map(o => (
                  <button key={o.value} onClick={() => setOutcomeForm(p => ({ ...p, outcome: o.value }))}
                    style={{
                      padding: '10px 12px', borderRadius: '8px', border: `1px solid ${outcomeForm.outcome === o.value ? o.color : t.border}`,
                      background: outcomeForm.outcome === o.value ? `${o.color}18` : 'transparent',
                      color: outcomeForm.outcome === o.value ? o.color : t.text3,
                      fontSize: '12px', fontWeight: outcomeForm.outcome === o.value ? 600 : 400, cursor: 'pointer',
                      transition: 'all .15s', textAlign: 'left',
                    }}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={s.lbl}>Notes</label>
                <textarea style={{ ...s.input, width: '100%', height: '100px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  placeholder="Add notes about this call..."
                  value={outcomeForm.notes}
                  onChange={e => setOutcomeForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <button style={{ ...s.btnGold, width: '100%' }} onClick={handleSaveOutcome} disabled={savingOutcome || !outcomeForm.outcome}>
                {savingOutcome ? 'Saving...' : 'Save Outcome'}
              </button>
            </div>

            {/* Call Details */}
            <div style={s.card}>
              <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '16px' }}>Call Details</div>
              {[
                { label: 'Customer',  value: selectedCall.customer_name || '—' },
                { label: 'Number',    value: selectedCall.customer_number },
                { label: 'Branch',    value: selectedCall.branch_name || '—' },
                { label: 'Date',      value: fmtDate(selectedCall.call_date) },
                { label: 'Time',      value: selectedCall.call_time?.slice(0,5) || '—' },
                { label: 'Duration',  value: fmtDuration(selectedCall.duration_seconds) },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${t.border}20` }}>
                  <span style={{ fontSize: '12px', color: t.text4 }}>{item.label}</span>
                  <span style={{ fontSize: '13px', color: t.text1 }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── MAIN LIST VIEW
  return (
    <div style={{ padding: '32px', maxWidth: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Inbound Bot Testing</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Gnani AI call recordings · Listen, transcribe, and track outcomes</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '20px', background: `${t.orange}15`, border: `1px solid ${t.orange}40` }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: t.orange, display: 'inline-block' }} />
          <span style={{ fontSize: '12px', color: t.orange, fontWeight: 600 }}>S3 Not Connected</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'Total Calls',     value: fmt(totalCalls),                      color: t.gold,   size: '1.8rem' },
          { label: 'Total Duration',  value: fmtDuration(totalDuration),           color: t.text1,  size: '1.4rem' },
          { label: 'Interested',      value: fmt(interestedCount),                 color: t.green,  size: '1.8rem' },
          { label: 'Callbacks',       value: fmt(callbackCount),                   color: t.blue,   size: '1.8rem' },
          { label: 'Conversion Rate', value: `${conversionRate}%`,                 color: t.purple, size: '1.8rem' },
        ].map(item => (
          <div key={item.label} style={{ ...s.card, textAlign: 'center', padding: '18px', marginBottom: 0 }}>
            <div style={{ fontSize: item.size, fontWeight: 200, color: item.color, lineHeight: 1.1, marginBottom: '6px' }}>{item.value}</div>
            <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Outcome breakdown */}
      <div style={{ ...s.card, marginBottom: '24px' }}>
        <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '14px' }}>Outcome Breakdown</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {Object.entries(OUTCOME_META).map(([key, meta]) => {
            const count = calls.filter(c => c.outcome === key).length
            const pct   = totalCalls > 0 ? ((count / totalCalls) * 100).toFixed(0) : 0
            return (
              <div key={key} style={{ flex: 1, minWidth: '120px', padding: '12px 16px', background: `${meta.color}10`, border: `1px solid ${meta.color}30`, borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 300, color: meta.color }}>{count}</div>
                <div style={{ fontSize: '11px', color: meta.color, fontWeight: 600, marginTop: '2px' }}>{meta.label}</div>
                <div style={{ fontSize: '11px', color: t.text4, marginTop: '2px' }}>{pct}%</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...s.input, width: '240px' }} placeholder="Search name, number, branch..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={s.select} value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}>
          {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="date" style={s.select} value={filterDate} onChange={e => setFilterDate(e.target.value)} />
        {(search || filterOutcome || filterDate) && (
          <button style={s.btnOut} onClick={() => { setSearch(''); setFilterOutcome(''); setFilterDate('') }}>Clear</button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: t.text3 }}>{filtered.length} calls</div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Date', 'Time', 'Customer', 'Number', 'Branch', 'Duration', 'Outcome', 'Notes'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>No calls found</td></tr>
            ) : filtered.map(call => {
              const meta = OUTCOME_META[call.outcome]
              return (
                <tr key={call.id}
                  onClick={() => handleOpenCall(call)}
                  style={{ cursor: 'pointer', transition: 'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = `${t.gold}08`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={s.td}>{fmtDate(call.call_date)}</td>
                  <td style={{ ...s.td, color: t.text3 }}>{call.call_time?.slice(0,5) || '—'}</td>
                  <td style={{ ...s.td, color: t.text2, fontWeight: 500 }}>{call.customer_name || '—'}</td>
                  <td style={{ ...s.td, color: t.gold }}>{call.customer_number}</td>
                  <td style={{ ...s.td, color: t.text2 }}>{call.branch_name || '—'}</td>
                  <td style={s.td}>{fmtDuration(call.duration_seconds)}</td>
                  <td style={s.td}>
                    {meta ? (
                      <span style={{ fontSize: '11px', color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, borderRadius: '4px', padding: '2px 8px', fontWeight: 600 }}>{meta.label}</span>
                    ) : <span style={{ fontSize: '11px', color: t.text4 }}>—</span>}
                  </td>
                  <td style={{ ...s.td, color: t.text3, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{call.outcome_notes || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}