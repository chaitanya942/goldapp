'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const OUTCOMES = [
  { value: '',               label: 'All Outcomes',   color: '' },
  { value: 'pending',        label: 'Pending',        color: '#9a8a6a' },
  { value: 'interested',     label: 'Interested',     color: '#3aaa6a' },
  { value: 'callback',       label: 'Callback',       color: '#3a8fbf' },
  { value: 'not_interested', label: 'Not Interested', color: '#e05555' },
  { value: 'no_answer',      label: 'No Answer',      color: '#9a8a6a' },
  { value: 'wrong_number',   label: 'Wrong Number',   color: '#c9981f' },
]

const OUTCOME_META = {
  pending:        { label: 'Pending',        color: '#9a8a6a' },
  interested:     { label: 'Interested',     color: '#3aaa6a' },
  callback:       { label: 'Callback',       color: '#3a8fbf' },
  not_interested: { label: 'Not Interested', color: '#e05555' },
  no_answer:      { label: 'No Answer',      color: '#9a8a6a' },
  wrong_number:   { label: 'Wrong Number',   color: '#c9981f' },
}

const fmt         = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtDate     = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDuration = (s) => { if (!s) return '—'; const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}` }

export default function InboundBotTesting() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [calls, setCalls]                 = useState([])
  const [loading, setLoading]             = useState(true)
  const [syncing, setSyncing]             = useState(false)
  const [syncResult, setSyncResult]       = useState(null)
  const [search, setSearch]               = useState('')
  const [filterOutcome, setFilterOutcome] = useState('')
  const [filterDate, setFilterDate]       = useState('')
  const [selectedCall, setSelectedCall]   = useState(null)
  const [presignedUrl, setPresignedUrl]   = useState(null)
  const [loadingAudio, setLoadingAudio]   = useState(false)
  const [transcribing, setTranscribing]   = useState(false)
  const [savingOutcome, setSavingOutcome] = useState(false)
  const [outcomeForm, setOutcomeForm]     = useState({ outcome: '', notes: '' })
  const audioRef = useRef(null)

  useEffect(() => { fetchCalls() }, [])

  async function fetchCalls() {
    setLoading(true)
    const { data, error } = await supabase
      .from('telesales_calls')
      .select('*')
      .order('call_date', { ascending: false })
      .order('call_time', { ascending: false })
    if (!error) setCalls(data || [])
    setLoading(false)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res  = await fetch('/api/sync-gnani', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      setSyncResult(data)
      if (data.inserted > 0) await fetchCalls()
    } catch (err) {
      setSyncResult({ success: false, error: err.message })
    } finally {
      setSyncing(false)
    }
  }

  async function handleOpenCall(call) {
    setSelectedCall(call)
    setOutcomeForm({ outcome: call.outcome || '', notes: call.outcome_notes || '' })
    setPresignedUrl(null)

    // Fetch presigned URL if s3_key exists
    if (call.s3_key) {
      setLoadingAudio(true)
      try {
        const res  = await fetch('/api/presign-recording', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ s3_key: call.s3_key }),
        })
        const data = await res.json()
        if (data.url) setPresignedUrl(data.url)
      } catch (err) {
        console.error('Presign error:', err)
      } finally {
        setLoadingAudio(false)
      }
    }
  }

  async function handleTranscribe() {
    if (!presignedUrl) {
      alert('No recording available for this call.')
      return
    }
    setTranscribing(true)
    try {
      const res  = await fetch('/api/transcribe-call', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ callId: selectedCall.id, recordingUrl: presignedUrl }),
      })
      const data = await res.json()
      if (data.transcript) {
        const updated = calls.map(c => c.id === selectedCall.id ? { ...c, transcript: data.transcript } : c)
        setCalls(updated)
        setSelectedCall(prev => ({ ...prev, transcript: data.transcript }))
      }
    } catch (err) {
      alert('Transcription failed: ' + err.message)
    } finally {
      setTranscribing(false)
    }
  }

  async function handleSaveOutcome() {
    if (!outcomeForm.outcome) return
    setSavingOutcome(true)
    const { error } = await supabase
      .from('telesales_calls')
      .update({ outcome: outcomeForm.outcome, outcome_notes: outcomeForm.notes })
      .eq('id', selectedCall.id)
    if (!error) {
      const updated = calls.map(c => c.id === selectedCall.id
        ? { ...c, outcome: outcomeForm.outcome, outcome_notes: outcomeForm.notes }
        : c
      )
      setCalls(updated)
      setSelectedCall(prev => ({ ...prev, outcome: outcomeForm.outcome, outcome_notes: outcomeForm.notes }))
    }
    setSavingOutcome(false)
  }

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <button style={{ ...s.btnOut, marginBottom: '12px', fontSize: '12px' }} onClick={() => { setSelectedCall(null); setPresignedUrl(null) }}>← Back</button>
            <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1 }}>{selectedCall.customer_name || selectedCall.customer_number}</div>
            <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>
              {fmtDate(selectedCall.call_date)} · {selectedCall.call_time?.slice(0,5)} · {fmtDuration(selectedCall.duration_seconds)} · {selectedCall.language || ''}
            </div>
          </div>
          {meta && <span style={{ fontSize: '12px', color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, borderRadius: '6px', padding: '4px 12px', fontWeight: 600 }}>{meta.label}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            {/* Audio Player */}
            <div style={{ ...s.card, marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '16px' }}>Recording</div>
              {loadingAudio ? (
                <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '28px', textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', color: t.text3 }}>⟳ Loading audio...</div>
                </div>
              ) : presignedUrl ? (
                <audio ref={audioRef} controls style={{ width: '100%', borderRadius: '8px' }} src={presignedUrl} />
              ) : (
                <div style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '28px', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', opacity: .2, marginBottom: '8px' }}>🎙</div>
                  <div style={{ fontSize: '13px', color: t.text3, marginBottom: '4px' }}>Recording not available</div>
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

          <div>
            {/* Outcome */}
            <div style={s.card}>
              <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '16px' }}>Call Outcome</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                {OUTCOMES.filter(o => o.value && o.value !== 'pending').map(o => (
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
                { label: 'Language',  value: selectedCall.language || '—' },
                { label: 'Date',      value: fmtDate(selectedCall.call_date) },
                { label: 'Time',      value: selectedCall.call_time?.slice(0,5) || '—' },
                { label: 'Duration',  value: fmtDuration(selectedCall.duration_seconds) },
                { label: 'Gnani ID',  value: selectedCall.gnani_call_id ? selectedCall.gnani_call_id.slice(0,16) + '...' : '—' },
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Inbound Bot Testing</div>
          <div style={{ fontSize: '12px', color: t.text3, marginTop: '4px' }}>Gnani AI call recordings · Listen, transcribe, and track outcomes</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {syncResult && (
            <div style={{ fontSize: '12px', color: syncResult.success ? t.green : t.red, background: syncResult.success ? `${t.green}15` : `${t.red}15`, border: `1px solid ${syncResult.success ? t.green : t.red}40`, borderRadius: '8px', padding: '6px 12px' }}>
              {syncResult.success ? `✓ ${syncResult.message}` : `✗ ${syncResult.error}`}
            </div>
          )}
          <button onClick={handleSync} disabled={syncing} style={{ ...s.btnGold, display: 'flex', alignItems: 'center', gap: '6px', opacity: syncing ? .7 : 1 }}>
            <span style={{ fontSize: '14px' }}>{syncing ? '⟳' : '↓'}</span>
            {syncing ? 'Syncing S3...' : 'Sync Recordings'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '20px', background: `${t.green}15`, border: `1px solid ${t.green}40` }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: t.green, display: 'inline-block' }} />
            <span style={{ fontSize: '12px', color: t.green, fontWeight: 600 }}>S3 Connected</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'Total Calls',     value: loading ? '—' : fmt(totalCalls),            color: t.gold,   size: '1.8rem' },
          { label: 'Total Duration',  value: loading ? '—' : fmtDuration(totalDuration), color: t.text1,  size: '1.4rem' },
          { label: 'Interested',      value: loading ? '—' : fmt(interestedCount),        color: t.green,  size: '1.8rem' },
          { label: 'Callbacks',       value: loading ? '—' : fmt(callbackCount),          color: t.blue,   size: '1.8rem' },
          { label: 'Conversion Rate', value: loading ? '—' : `${conversionRate}%`,        color: t.purple, size: '1.8rem' },
        ].map(item => (
          <div key={item.label} style={{ ...s.card, textAlign: 'center', padding: '18px', marginBottom: 0 }}>
            <div style={{ fontSize: item.size, fontWeight: 200, color: item.color, lineHeight: 1.1, marginBottom: '6px' }}>{item.value}</div>
            <div style={{ fontSize: '11px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Outcome Breakdown */}
      <div style={{ ...s.card, marginBottom: '24px' }}>
        <div style={{ fontSize: '12px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '14px' }}>Outcome Breakdown</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {Object.entries(OUTCOME_META).filter(([k]) => k !== 'pending').map(([key, meta]) => {
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
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: t.text4, fontSize: '13px' }}>Loading calls...</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Time', 'Number', 'Language', 'Duration', 'Outcome', 'Notes'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                  {calls.length === 0 ? 'No calls yet — click "Sync Recordings" to load from S3' : 'No calls match filters'}
                </td></tr>
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
                    <td style={{ ...s.td, color: t.gold }}>{call.customer_number}</td>
                    <td style={{ ...s.td, color: t.text2, textTransform: 'capitalize' }}>{call.language || '—'}</td>
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
      )}
    </div>
  )
}