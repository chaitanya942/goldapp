'use client'

// Discrepancy Cases — ops queue + reasoning intake.
//
// Auditor lands a discrepancy bill here from the Audit Report ("Send to Ops"
// action). Each row carries the frozen weight snapshot at queue time, the
// bill / customer / branch context, and the auditor's identity. Ops writes
// a reason in the inline textarea and clicks Resolve — the case stamps
// resolved_by + resolved_at and disappears from the Pending list.
//
// Powered by /api/discrepancy-cases — see that route for shape.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import { appIdMatches } from '../../lib/appIdSearch'

const fmtWt        = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtSignedWt  = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '0.000g'
  return `${v > 0 ? '+' : ''}${v.toFixed(3)}g`
}
const fmtTS = (d) => d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  : '—'

export default function DiscrepancyCases() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isMobile = useMobile()

  const [statusFilter, setStatusFilter] = useState('pending')   // 'pending' | 'resolved' | 'all'
  const [cases,        setCases]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  // Per-row textarea draft + per-row in-flight flag, both keyed by case id.
  const [drafts,  setDrafts]  = useState({})
  const [resolving, setResolving] = useState({})

  const fetchCases = useCallback(async () => {
    setLoading(true)
    const res = await authedFetch(`/api/discrepancy-cases?status=${statusFilter}`)
    const j   = await res.json()
    if (!res.ok || j.error) { setCases([]); setLoading(false); return }
    setCases(j.cases || [])
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { fetchCases() }, [fetchCases])

  const q = search.trim().toLowerCase()
  const visible = useMemo(() => !q ? cases : cases.filter(c =>
    appIdMatches(c.purchase?.application_id, q)
    || (c.purchase?.customer_name || '').toLowerCase().includes(q)
    || (c.purchase?.branch_name   || '').toLowerCase().includes(q)
    || (c.auditor?.name           || '').toLowerCase().includes(q)
    || (c.reason                  || '').toLowerCase().includes(q)
  ), [cases, q])

  const pendingCount  = useMemo(() => cases.filter(c => c.status === 'pending').length, [cases])
  const resolvedCount = useMemo(() => cases.filter(c => c.status === 'resolved').length, [cases])

  async function resolve(id) {
    const reason = (drafts[id] || '').trim()
    if (!reason) return
    setResolving(prev => ({ ...prev, [id]: true }))
    const res = await authedFetch('/api/discrepancy-cases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reason }),
    })
    setResolving(prev => { const { [id]: _, ...rest } = prev; return rest })
    if (res.ok) {
      setDrafts(prev => { const { [id]: _, ...rest } = prev; return rest })
      fetchCases()
    } else {
      const j = await res.json().catch(() => ({}))
      alert(j.error || 'Failed to resolve case')
    }
  }

  // ── Styles ──
  const s = {
    wrap:    { padding: isMobile ? '12px 12px 80px' : '18px 22px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1400px', margin: '0 auto' },
    title:   { fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:     { fontSize: '11px', color: t.text3 },
    card:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    th:      { padding: '11px 14px', textAlign: 'left', fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' },
    td:      { padding: '11px 14px', fontSize: '12px', color: t.text2, borderBottom: `1px solid ${t.border}25`, verticalAlign: 'top' },
    btnOut:  { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11px', color: t.text3, cursor: 'pointer' },
    input:   { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 10px', color: t.text1, fontSize: '12px', outline: 'none' },
  }

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={s.title}>Discrepancy Cases</div>
          <div style={{ ...s.sub, marginTop: '2px' }}>
            Auditors send discrepancy bills here for review. Write a reason → mark Resolved → the case clears the queue.
          </div>
        </div>
        <button onClick={fetchCases} style={s.btnOut}>⟳ Refresh</button>
      </div>

      {/* Status filter + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { id: 'pending',  label: 'Pending',  count: pendingCount,  color: t.orange || '#e9a942' },
            { id: 'resolved', label: 'Resolved', count: resolvedCount, color: t.green },
            { id: 'all',      label: 'All',      count: cases.length,  color: t.text2 },
          ].map(f => {
            const active = statusFilter === f.id
            return (
              <button key={f.id} onClick={() => setStatusFilter(f.id)} style={{
                background:   active ? `${f.color}20` : 'transparent',
                color:        active ? f.color : t.text3,
                border:       `1px solid ${active ? `${f.color}80` : t.border}`,
                borderRadius: '14px',
                padding:      '6px 14px',
                fontSize:     '11.5px',
                fontWeight:   active ? 700 : 500,
                cursor:       'pointer',
                display:      'inline-flex', alignItems: 'center', gap: '7px',
              }}>
                {f.label}
                <span style={{
                  fontSize: '10px', fontFamily: 'monospace',
                  color:    active ? f.color : t.text4,
                  background: active ? `${f.color}25` : `${t.border}50`,
                  padding: '1px 6px', borderRadius: '8px', fontWeight: 700,
                }}>{f.count}</span>
              </button>
            )
          })}
        </div>
        <input
          style={{ ...s.input, flex: 1, minWidth: '220px' }}
          placeholder="Filter by app ID, customer, branch, auditor, reason…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Queue */}
      <div style={s.card}>
        <div style={{ position: 'absolute', display: 'none' }} />
        {loading ? (
          <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
        ) : visible.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>
            {statusFilter === 'pending' ? 'No pending cases — queue is clear.' : 'No cases match.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: t.card2 || t.card }}>
                  <th style={s.th}>Sent At</th>
                  <th style={s.th}>Auditor</th>
                  <th style={s.th}>Bill</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>CRM Gross</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Audit Weight</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Δ</th>
                  <th style={s.th}>Reason</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(c => {
                  const p = c.purchase || {}
                  const isPending = c.status === 'pending'
                  const d = Number(c.snapshot_discrepancy_g || 0)
                  const discColor = d > 0 ? t.green : d < 0 ? t.red : t.text4
                  const draft  = drafts[c.id] ?? (c.reason || '')
                  const sending = !!resolving[c.id]
                  return (
                    <tr key={c.id}>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '11px', color: t.text3, whiteSpace: 'nowrap' }}>
                        {fmtTS(c.sent_at)}
                      </td>
                      <td style={{ ...s.td, fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                        {c.auditor?.name || '—'}
                      </td>
                      <td style={s.td}>
                        <div style={{ fontWeight: 600, color: t.text1, fontFamily: 'monospace', fontSize: '11.5px' }}>
                          {p.application_id || '—'}
                        </div>
                        <div style={{ fontSize: '11px', color: t.text2, marginTop: '2px' }}>{p.customer_name || '—'}</div>
                        <div style={{ fontSize: '10px', color: t.text4, marginTop: '1px' }}>{p.branch_name || '—'}</div>
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, whiteSpace: 'nowrap' }}>
                        {fmtWt(c.snapshot_crm_gross_g)}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {fmtWt(c.snapshot_audit_gross_g)}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: discColor, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {d === 0 ? '—' : fmtSignedWt(d)}
                      </td>
                      <td style={{ ...s.td, minWidth: '260px' }}>
                        {isPending ? (
                          <textarea
                            value={draft}
                            onChange={e => setDrafts(prev => ({ ...prev, [c.id]: e.target.value }))}
                            placeholder="Reasoning for this discrepancy…"
                            rows={2}
                            style={{
                              ...s.input,
                              width: '100%',
                              minHeight: '46px',
                              resize: 'vertical',
                              fontFamily: 'inherit',
                              fontSize: '11.5px',
                              lineHeight: 1.35,
                            }}
                          />
                        ) : (
                          <div style={{ fontSize: '11.5px', color: t.text2, whiteSpace: 'pre-wrap' }}>{c.reason || '—'}</div>
                        )}
                        {!isPending && (
                          <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>
                            Resolved {fmtTS(c.resolved_at)} · {c.resolver?.name || '—'}
                          </div>
                        )}
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        {isPending ? (
                          <button
                            onClick={() => resolve(c.id)}
                            disabled={sending || !((drafts[c.id] || '').trim())}
                            style={{
                              background: (drafts[c.id] || '').trim() ? t.green : t.border,
                              color:      (drafts[c.id] || '').trim() ? '#fff' : t.text4,
                              border: 'none', borderRadius: '7px',
                              padding: '8px 14px', fontSize: '11.5px',
                              fontWeight: 700, cursor: sending ? 'wait' : 'pointer',
                              opacity: sending ? 0.6 : 1,
                            }}
                          >
                            {sending ? 'Saving…' : 'Resolve'}
                          </button>
                        ) : (
                          <span style={{
                            fontSize: '9.5px', color: t.green, background: `${t.green}18`,
                            border: `1px solid ${t.green}40`, borderRadius: '5px',
                            padding: '3px 9px', fontWeight: 700, letterSpacing: '.08em',
                            textTransform: 'uppercase',
                          }}>Resolved</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
