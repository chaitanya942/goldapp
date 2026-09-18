'use client'

// components/admin/DashboardAuditLog.js
//
// Super-admin-only viewer for the Dashboard audit trail — who viewed which
// dashboard/section, under what region/branch/period, and when.
// Data comes from GET /api/dashboard-audit-log, which hard-gates on
// role === 'super_admin' server-side (see lib/apiAuth.js requireAuth) —
// this component's own gating in app/dashboard/page.js is just UI visibility.

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import { fmtIst } from '../../lib/dateIst'

const PAGE_SIZE = 50

const PAGE_LABELS = {
  'dashboard':         'Dashboard',
  'dynamic-dashboard': 'Dashboard',
}

export default function DashboardAuditLog() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [rows,    setRows]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [offset,  setOffset]  = useState(0)
  const [userFilter, setUserFilter] = useState('')

  const load = useCallback(async (o) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(o) })
      const res = await authedFetch(`/api/dashboard-audit-log?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `Request failed: ${res.status}`)
      setRows(body.rows || [])
      setTotal(body.total || 0)
    } catch (e) {
      setError(e.message || 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(offset) }, [offset, load])

  const filteredRows = userFilter
    ? rows.filter(r =>
        (r.user_name || '').toLowerCase().includes(userFilter.toLowerCase()) ||
        (r.user_email || '').toLowerCase().includes(userFilter.toLowerCase()))
    : rows

  const s = {
    wrap:    { padding: '32px', maxWidth: '1300px' },
    title:   { fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' },
    sub:     { fontSize: '.72rem', color: t.text3, marginTop: '4px', marginBottom: '20px' },
    input:   { padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.card, color: t.text1, fontSize: '.75rem', outline: 'none', minWidth: 240 },
    tblWrap: { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:      { padding: '10px 14px', fontSize: '.6rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400, whiteSpace: 'nowrap' },
    td:      { padding: '10px 14px', fontSize: '.75rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    pager:   { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, fontSize: '.72rem', color: t.text3 },
    pageBtn: (disabled) => ({ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.card, color: disabled ? t.text4 : t.text1, fontSize: '.72rem', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }),
  }

  return (
    <div style={s.wrap}>
      <div style={s.title}>Dashboard Audit Log</div>
      <div style={s.sub}>Who viewed which dashboard/section, under what region/branch/period, and when (IST). Super-admin only — not editable by normal users.</div>

      <div style={{ marginBottom: 16 }}>
        <input
          style={s.input}
          placeholder="Filter by name or email..."
          value={userFilter}
          onChange={e => setUserFilter(e.target.value)}
        />
      </div>

      {error && (
        <div style={{ color: '#e05555', fontSize: '.75rem', marginBottom: 12 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading audit log...</div>
      ) : (
        <>
          <div style={s.tblWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Viewed At (IST)', 'User', 'Role', 'Dashboard', 'Section', 'Region', 'Branch', 'Period', 'Result'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filteredRows.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...s.td, color: t.text3, fontSize: '.7rem' }}>{fmtIst(r.created_at)}</td>
                    <td style={{ ...s.td, color: t.gold }}>{r.user_name || r.user_email}</td>
                    <td style={{ ...s.td, color: t.text3, fontSize: '.7rem' }}>{r.user_role || '—'}</td>
                    <td style={s.td}>{PAGE_LABELS[r.page] || r.page}</td>
                    <td style={s.td}>{r.section || '—'}</td>
                    <td style={s.td}>{r.region || '—'}</td>
                    <td style={s.td}>{r.branch || '—'}</td>
                    <td style={s.td}>{r.period || '—'}</td>
                    <td style={s.td}>
                      <span style={{ fontSize: '.62rem', letterSpacing: '.08em', textTransform: 'uppercase', color: r.access_result === 'denied' ? '#e05555' : t.green }}>
                        {r.access_result === 'denied' ? 'Denied' : 'Granted'}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px', whiteSpace: 'normal' }}>No audit log entries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={s.pager}>
            <button style={s.pageBtn(offset === 0)} disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}>← Prev</button>
            <span>{total === 0 ? '0' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}</span>
            <button style={s.pageBtn(offset + PAGE_SIZE >= total)} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(o => o + PAGE_SIZE)}>Next →</button>
          </div>
        </>
      )}
    </div>
  )
}
