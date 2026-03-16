'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { card: '#141414', text1: '#f0e6c8', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#2a2a2a', green: '#3aaa6a' },
  light: { card: '#ede8dc', text1: '#2a1f0a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d5cfc0', green: '#2a8a5a' },
}

export default function ImportLogs() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('csv_import_logs')
      .select('*, user_profiles(full_name, email)')
      .order('uploaded_at', { ascending: false })
      .limit(100)
    if (data) setLogs(data)
    setLoading(false)
  }

  const s = {
    wrap:    { padding: '32px', maxWidth: '1100px' },
    title:   { fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' },
    sub:     { fontSize: '.72rem', color: t.text3, marginTop: '4px', marginBottom: '24px' },
    tblWrap: { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:      { padding: '10px 16px', fontSize: '.6rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400 },
    td:      { padding: '11px 16px', fontSize: '.75rem', color: t.text1, borderBottom: `1px solid ${t.border}20` },
  }

  const formatDate = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={s.wrap}>
      <div style={s.title}>Import Logs</div>
      <div style={s.sub}>Full history of all CSV uploads — last 100 records</div>

      {loading ? (
        <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading logs...</div>
      ) : (
        <div style={s.tblWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Date & Time', 'File', 'Uploaded By', 'Total Rows', 'Imported', 'Rejected', 'Status'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td style={{ ...s.td, color: t.text3, fontSize: '.7rem' }}>{formatDate(log.uploaded_at)}</td>
                  <td style={{ ...s.td, color: t.gold }}>{log.file_name ?? '—'}</td>
                  <td style={{ ...s.td, color: t.text3, fontSize: '.7rem' }}>
                    {log.user_profiles?.full_name ?? log.user_profiles?.email ?? '—'}
                  </td>
                  <td style={{ ...s.td, textAlign: 'center' }}>{log.total_rows ?? '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center', color: t.green }}>{log.imported_rows ?? '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center', color: log.rejected_rows > 0 ? '#e05555' : t.text3 }}>
                    {log.rejected_rows ?? '—'}
                  </td>
                  <td style={s.td}>
                    <span style={{
                      fontSize: '.62rem', letterSpacing: '.08em', textTransform: 'uppercase',
                      color: log.status === 'success' ? t.green : '#e05555',
                    }}>
                      {log.status === 'success' ? '✓ Success' : '✕ Rejected'}
                    </span>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>No imports yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}