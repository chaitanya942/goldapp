'use client'

// Audit Report — historical view of every audit action, case-wise.
// Powered by /api/collection-audit?mode=history which returns every bill
// that has audited_at populated, regardless of current stock_status.
//
// Date filter semantics:
//   An "audit report for date N" is the pair Night-N + Morning-(N+1).
//   The window for a [from, to] range is [from 19:30 IST, (to+1) 19:30 IST)
//   — i.e. each calendar day in the range expands into one full audit pair.
//
// Columns: Consignment Created · Customer · Branch · CRM Gross · Audit Wt ·
//   Discrepancy (green when audit>CRM, red when audit<CRM, em-dash when
//   equal) · Re-audit Wt · Re-audit Δ · Auditor Name · Remark.
//
// "Collection audit only" — when a bill has audited_at but audit_gross_weight
// is null/0, the remark auto-fills to "Received — weight audit not done"
// so ops sees at a glance that the bill is in HO but still owes a weighing.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import { istToday, istDaysAgo } from '../../lib/dateIst'

const fmtWt        = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtSignedWt  = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '0.000g'
  return `${v > 0 ? '+' : ''}${v.toFixed(3)}g`
}
const fmtDate= (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Classify an audit timestamp into one of:
//   'morning' (8:30 – 19:30 IST), 'night' (19:30 – 24:00 IST), 'off' (else)
// Mirrors the shift windows used by the time-gate + roster module, with the
// 19:30–20:00 overlap resolved to 'night' so a hand-off audit goes with the
// shift that's actually starting.
function classifyShift(iso) {
  if (!iso) return null
  const istMs = new Date(iso).getTime() + 5.5 * 3600_000
  const ist   = new Date(istMs)
  const mins  = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  if (mins >= 510  && mins < 1170) return 'morning'   // 08:30 – 19:30
  if (mins >= 1170 && mins < 1440) return 'night'     // 19:30 – 24:00
  return 'off'                                         // 00:00 – 08:30
}
const SHIFT_LABEL = { night: 'Night', morning: 'Morning', off: 'Off-shift' }

export default function AuditReport() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isMobile = useMobile()

  const today      = istToday()
  const yesterday  = istDaysAgo(1)
  const last7      = istDaysAgo(6)
  const monthStart = today.slice(0, 8) + '01'

  const [from, setFrom]   = useState(last7)
  const [to,   setTo]     = useState(today)
  const [rows, setRows]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  // Shift filter — 'all' shows every audit in the pair; 'night' / 'morning'
  // narrow to the half-shift the audit landed in.
  const [shift,   setShift]   = useState('all')
  // Click-to-sort state. Default to most-recently-audited first so the
  // freshest audit lands at the top.
  const [sort, setSort] = useState({ key: 'audited_at', dir: 'desc' })
  const toggleSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
  )
  // ── Discrepancy case state ────────────────────────────────────────────
  // casesByPurchase: Map<purchase_id, { status, reason }> for every case
  //   ops has open or has resolved. Drives the per-row pill.
  // selected: Set<purchase_id> for rows the auditor has ticked but not yet
  //   sent. Cleared after a successful POST.
  // sending: in-flight flag for the floating "Send to Ops" button so we
  //   don't fire two requests on a double-click.
  const [casesByPurchase, setCasesByPurchase] = useState(new Map())
  const [selected,        setSelected]        = useState(new Set())
  const [sending,         setSending]         = useState(false)

  const fetchCases = useCallback(async () => {
    const res = await authedFetch('/api/discrepancy-cases?status=all')
    const j   = await res.json().catch(() => ({}))
    if (!res.ok) return
    const m = new Map()
    for (const c of (j.cases || [])) {
      // If multiple cases exist for the same bill (one resolved + one
      // pending after re-queue), the pending one wins because the unique
      // index guarantees at most one is pending.
      const prev = m.get(c.purchase_id)
      if (!prev || c.status === 'pending') m.set(c.purchase_id, { status: c.status, reason: c.reason })
    }
    setCasesByPurchase(m)
  }, [])
  useEffect(() => { fetchCases() }, [fetchCases])

  const fetchData = useCallback(async (f, tt) => {
    setLoading(true)
    const res = await authedFetch(`/api/collection-audit?mode=history&from=${f}&to=${tt}`)
    const j   = await res.json()
    if (!res.ok || j.error) {
      setRows([])
      setLoading(false)
      return
    }
    setRows(j.rows || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData(from, to) }, [from, to, fetchData])

  const presets = [
    { label: 'Today',       from: today,      to: today },
    { label: 'Yesterday',   from: yesterday,  to: yesterday },
    { label: 'Last 7 days', from: last7,      to: today },
    { label: 'This month',  from: monthStart, to: today },
  ]
  const isPresetActive = (p) => p.from === from && p.to === to

  // ── Filtered / derived ──
  const q = search.trim().toLowerCase()
  // Decorate every row with its shift up-front so the filter, the column,
  // and the breakdown recompute all read from the same value.
  const rowsWithShift = useMemo(() => rows.map(r => ({ ...r, _shift: classifyShift(r.audited_at) })), [rows])
  const shiftMatches = (r) => shift === 'all' || r._shift === shift
  const filteredLog = useMemo(() => rowsWithShift.filter(r =>
    shiftMatches(r) && (
      !q
      || (r.application_id   || '').toLowerCase().includes(q)
      || (r.customer_name    || '').toLowerCase().includes(q)
      || (r.branch_name      || '').toLowerCase().includes(q)
      || (r.audited_by_name  || '').toLowerCase().includes(q)
      || (r.audited_by_email || '').toLowerCase().includes(q)
    )
  ), [rowsWithShift, q, shift])

  // Sort layer on top of the filter. Cross-cutting keys ('discrepancy_g',
  // 'audit_gross_weight') resolve to the underlying first-audit fields
  // so the column behaves how the user reads it.
  const sortedLog = useMemo(() => {
    const arr = [...filteredLog]
    const { key, dir } = sort
    const m = dir === 'desc' ? -1 : 1
    arr.sort((a, b) => {
      let av, bv
      if (key === 'discrepancy_g') {
        av = Number(a.first_audit?.discrepancy_g ?? a.audit_discrepancy_g ?? 0)
        bv = Number(b.first_audit?.discrepancy_g ?? b.audit_discrepancy_g ?? 0)
      } else if (key === 'audit_gross_weight') {
        av = Number(a.first_audit?.audit_gross_weight ?? a.audit_gross_weight ?? 0)
        bv = Number(b.first_audit?.audit_gross_weight ?? b.audit_gross_weight ?? 0)
      } else if (key === 'auditor_name') {
        av = (a.reaudit?.audited_by_name || a.audited_by_name || '').toLowerCase()
        bv = (b.reaudit?.audited_by_name || b.audited_by_name || '').toLowerCase()
      } else {
        av = a[key]; bv = b[key]
      }
      if (typeof av === 'string') return (av || '').localeCompare(bv || '') * m
      return ((Number(av) || 0) - (Number(bv) || 0)) * m
    })
    return arr
  }, [filteredLog, sort])

  // ── CSV / PDF download ──────────────────────────────────────────────────
  const dateTag = from === to ? from : `${from}_to_${to}`
  const windowLabelShort = from === to
    ? new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : `${new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} to ${new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`

  // Collection-only signal: bill was logged into HO (audited_at exists) but
  // the weight audit wasn't actually performed (audit_gross_weight is null
  // or 0). Surfaces as an auto-filled remark so ops can chase the weighing.
  const isCollectionOnly = (r) => {
    const w = r.first_audit?.audit_gross_weight ?? r.audit_gross_weight
    return r.audited_at && (w == null || Number(w) === 0)
  }
  // Eligible to queue: real discrepancy, not collection-only, no existing
  // pending case (the unique partial index would reject it anyway, but
  // hiding the checkbox is friendlier than a silent skip).
  const hasDiscrepancy = (r) => {
    const d = Number(r.first_audit?.discrepancy_g ?? r.audit_discrepancy_g ?? 0)
    return d !== 0
  }
  const caseFor = (r) => casesByPurchase.get(r.id) || null
  const isEligible = (r) => hasDiscrepancy(r) && !isCollectionOnly(r) && !(caseFor(r)?.status === 'pending')

  async function sendSelectedToOps() {
    if (selected.size === 0 || sending) return
    setSending(true)
    const res = await authedFetch('/api/discrepancy-cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchase_ids: [...selected] }),
    })
    const j = await res.json().catch(() => ({}))
    setSending(false)
    if (!res.ok) {
      alert(j.error || 'Failed to send cases')
      return
    }
    setSelected(new Set())
    fetchCases()
  }
  const effectiveRemark = (r) => {
    const stated = r.reaudit?.remark || r.audit_remark || ''
    if (stated) return stated
    return isCollectionOnly(r) ? 'Received — weight audit not done' : ''
  }

  // Column definitions — single source of truth so CSV, PDF, and the
  // on-screen table stay in sync.
  const logCols = [
    ['Consignment Created', r => fmtDate(r.consignment_created_at)],
    ['Audited Date',        r => fmtDate(r.audited_at)],
    ['Audit Shift',         r => SHIFT_LABEL[r._shift] || '—'],
    ['Customer',            r => r.customer_name],
    ['Branch',              r => r.branch_name],
    ['CRM Gross (g)',       r => fmtWt(r.gross_weight)],
    ['Audit Weight (g)',    r => {
      const w = r.first_audit?.audit_gross_weight ?? r.audit_gross_weight
      return w == null || Number(w) === 0 ? '—' : fmtWt(w)
    }],
    ['Discrepancy (g)',     r => {
      if (isCollectionOnly(r)) return '—'
      const d = Number(r.first_audit?.discrepancy_g ?? r.audit_discrepancy_g ?? 0)
      return d === 0 ? '—' : fmtSignedWt(d)
    }],
    ['Re-audit Weight (g)', r => r.reaudit ? fmtWt(r.reaudit.audit_gross_weight) : '—'],
    ['Re-audit Δ (g)',      r => {
      if (!r.reaudit) return '—'
      const d = Number(r.reaudit.discrepancy_g || 0)
      return d === 0 ? '—' : fmtSignedWt(d)
    }],
    ['Auditor',             r => r.reaudit?.audited_by_name || r.audited_by_name || '—'],
    ['Remark',              r => effectiveRemark(r)],
  ]

  function exportCsv() {
    const data = sortedLog
    const fname = `AuditReport_${dateTag}${shift === 'all' ? '' : `_${shift}`}.csv`
    if (!data.length) return
    const esc = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')
    const csv = [logCols.map(c => c[0]).join(','), ...data.map(r => logCols.map(c => esc(c[1](r))).join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fname
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  async function exportPdf() {
    const data = sortedLog
    const fname = `AuditReport_${dateTag}${shift === 'all' ? '' : `_${shift}`}.pdf`
    if (!data.length) return
    // Dynamic imports — jspdf is heavy and only needed on click.
    const { jsPDF } = await import('jspdf')
    const autoTableMod = await import('jspdf-autotable')
    const autoTable = autoTableMod.default || autoTableMod
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    doc.setFontSize(13)
    doc.text('Audit Report', 40, 32)
    doc.setFontSize(9)
    doc.text(`Reporting window: ${windowLabelShort} (night N + morning N+1)`, 40, 48)
    autoTable(doc, {
      startY: 60,
      head: [logCols.map(c => c[0])],
      body: data.map(r => logCols.map(c => String(c[1](r) ?? ''))),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [201, 168, 76], textColor: [26, 10, 0], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 244, 235] },
      margin: { left: 24, right: 24 },
    })
    doc.save(fname)
  }

  // ── Styles ──
  const s = {
    wrap:    { padding: isMobile ? '12px 12px 80px' : '18px 22px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1400px', margin: '0 auto' },
    title:   { fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:     { fontSize: '11px', color: t.text3 },
    card:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    th:      { padding: '11px 14px', textAlign: 'left', fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' },
    td:      { padding: '11px 14px', fontSize: '12px', color: t.text2, borderBottom: `1px solid ${t.border}25`, whiteSpace: 'nowrap', verticalAlign: 'middle' },
    badge:   (color) => ({ fontSize: '9px', color, background: `${color}18`, borderRadius: '5px', padding: '4px 9px', fontWeight: 700, letterSpacing: '.08em' }),
    btnOut:  { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11px', color: t.text3, cursor: 'pointer' },
    input:   { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 10px', color: t.text1, fontSize: '12px', fontFamily: 'monospace', outline: 'none' },
  }

  const windowLabel = from === to
    ? new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : `${new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} → ${new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={s.title}>Audit Report</div>
          <div style={{ ...s.sub, marginTop: '2px' }}>
            Case-wise audit log. Each date covers one full shift pair: night-N (19:30 IST) → morning-N+1 (19:30 IST handover).
          </div>
        </div>
        <button onClick={() => fetchData(from, to)} style={s.btnOut}>⟳ Refresh</button>
      </div>

      {/* Date controls */}
      <div style={{ ...s.card }}>
        <div style={{
          padding: isMobile ? '12px 14px' : '14px 18px',
          display: 'flex',
          alignItems: isMobile ? 'flex-start' : 'center',
          gap: isMobile ? '10px' : '14px',
          flexWrap: 'wrap',
          flexDirection: isMobile ? 'column' : 'row',
        }}>
          <div>
            <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Reporting window</div>
            <div style={{ fontSize: '14px', color: t.text1, fontWeight: 600, marginTop: '3px', fontFamily: 'monospace', letterSpacing: '-.01em' }}>{windowLabel}</div>
          </div>
          {!isMobile && <div style={{ width: '1px', height: '32px', background: t.border }} />}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presets.map(p => {
              const active = isPresetActive(p)
              return (
                <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to) }}
                  style={{
                    background: active ? t.gold : 'transparent',
                    color:      active ? '#1a0a00' : t.text3,
                    border:     `1px solid ${active ? t.gold : t.border}`,
                    borderRadius: '16px',
                    padding:    '5px 14px',
                    fontSize:   '11px',
                    fontWeight: active ? 700 : 500,
                    cursor:     'pointer',
                  }}>
                  {p.label}
                </button>
              )
            })}
          </div>
          <div style={{
            marginLeft: isMobile ? 0 : 'auto',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            flexWrap: 'wrap',
            width: isMobile ? '100%' : 'auto',
          }}>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} max={today} style={{ ...s.input, flex: isMobile ? 1 : undefined, minWidth: 0 }} />
            <span style={{ fontSize: '11px', color: t.text4 }}>→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} max={today} style={{ ...s.input, flex: isMobile ? 1 : undefined, minWidth: 0 }} />
          </div>
        </div>

        {/* Shift filter chips — narrow the log to audits captured in that
            half of the pair. Times mirror the roster: Night 19:30–24:00 IST
            (date N), Morning 08:30–19:30 IST (date N+1). */}
        <div style={{
          padding: isMobile ? '0 14px 12px' : '0 18px 14px',
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>Shift</span>
          {[
            { id: 'all',     label: 'All',     color: t.text2,                  icon: null },
            { id: 'morning', label: 'Morning', color: t.orange || '#e9a942',    icon: '☀' },
            { id: 'night',   label: 'Night',   color: t.gold   || '#c9a84c',    icon: '🌙' },
          ].map(c => {
            const active = shift === c.id
            return (
              <button key={c.id} onClick={() => setShift(c.id)}
                style={{
                  background: active ? `${c.color}20` : 'transparent',
                  color:      active ? c.color : t.text3,
                  border:     `1px solid ${active ? `${c.color}80` : t.border}`,
                  borderRadius: '14px',
                  padding:    '4px 11px',
                  fontSize:   '11px',
                  fontWeight: active ? 700 : 500,
                  cursor:     'pointer',
                  display:    'inline-flex', alignItems: 'center', gap: '5px',
                  letterSpacing: '.02em',
                  boxShadow: active ? `0 0 0 3px ${c.color}10` : 'none',
                  transition: 'all .15s ease',
                }}>
                {c.icon && <span style={{ fontSize: '12px', lineHeight: 1 }}>{c.icon}</span>}
                {c.label}
              </button>
            )
          })}
          {shift !== 'all' && (
            <span style={{ fontSize: '10.5px', color: t.text4, fontStyle: 'italic' }}>
              ({SHIFT_LABEL[shift]} shift only — {shift === 'night' ? '19:30 – 24:00' : '08:30 – 19:30'} IST)
            </span>
          )}
        </div>
      </div>

      {/* Floating action bar — appears when ≥1 row is ticked. Sits low
          on screen so it's reachable from a tall table without scrolling
          back to a header button. */}
      {selected.size > 0 && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: isMobile ? '14px' : '22px',
          transform: 'translateX(-50%)',
          background: t.card,
          border: `1px solid ${t.gold}`,
          borderRadius: '12px',
          boxShadow: `0 12px 32px -6px ${t.border}, 0 4px 12px -2px ${t.border}60`,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          zIndex: 50,
          maxWidth: 'calc(100vw - 28px)',
        }}>
          <span style={{ fontSize: '12px', color: t.text2 }}>
            <strong style={{ color: t.text1, fontFamily: 'monospace' }}>{selected.size}</strong>
            {' '}case{selected.size === 1 ? '' : 's'} selected
          </span>
          <button
            onClick={() => setSelected(new Set())}
            style={{
              background: 'transparent', border: `1px solid ${t.border}`,
              borderRadius: '7px', padding: '6px 10px', fontSize: '11px',
              color: t.text3, cursor: 'pointer',
            }}
          >Clear</button>
          <button
            onClick={sendSelectedToOps}
            disabled={sending}
            style={{
              background: t.gold, color: '#1a0a00',
              border: 'none', borderRadius: '7px',
              padding: '8px 16px', fontSize: '12px', fontWeight: 700,
              cursor: sending ? 'wait' : 'pointer',
              opacity: sending ? 0.7 : 1,
              letterSpacing: '.02em',
            }}
          >
            {sending ? 'Sending…' : `Send ${selected.size} to Ops →`}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : (
        <>
          {/* Search + download buttons */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '10px', flexWrap: 'wrap',
            padding: '0 2px',
          }}>
            <input
              style={{ ...s.input, flex: 1, minWidth: '220px', fontFamily: 'inherit' }}
              placeholder="Filter by app ID, customer, branch, auditor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={exportCsv} disabled={!filteredLog.length}
                style={{ ...s.btnOut, color: filteredLog.length ? t.gold : t.text4, borderColor: filteredLog.length ? `${t.gold}50` : t.border, padding: '7px 13px' }}>
                ↓ CSV
              </button>
              <button onClick={exportPdf} disabled={!filteredLog.length}
                style={{ ...s.btnOut, color: filteredLog.length ? t.red : t.text4, borderColor: filteredLog.length ? `${(t.red || '#c03030')}55` : t.border, padding: '7px 13px' }}>
                ↓ PDF
              </button>
            </div>
          </div>

          {/* Case-wise audit log — one row per audited bill in the
              window. Discrepancy colour: green when audit > CRM (we
              found more gold), red when audit < CRM (short), em-dash
              when equal. Collection-only rows (no weight captured)
              auto-fill the Remark column. */}
          <div style={{ ...s.card, position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${t.gold} 0%, ${t.gold}30 60%, transparent 100%)` }} />
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>
                Audit Log <span style={{ color: t.text4, fontWeight: 400, marginLeft: '6px' }}>· {filteredLog.length} row{filteredLog.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
                Each row = one bill. Window covers night-N + morning-N+1 (19:30 IST handover). Discrepancy green = audit weight higher than CRM, red = lower.
              </div>
            </div>
            {filteredLog.length === 0 ? (
              <Empty t={t} text="No audits in this window." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: t.card2 || t.card }}>
                      <th style={{ ...s.th, width: '32px', padding: '11px 8px 11px 14px' }}>
                        <input
                          type="checkbox"
                          aria-label="Select all eligible rows"
                          checked={(() => {
                            const elig = sortedLog.filter(isEligible)
                            return elig.length > 0 && elig.every(r => selected.has(r.id))
                          })()}
                          onChange={(e) => {
                            const elig = sortedLog.filter(isEligible).map(r => r.id)
                            setSelected(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) elig.forEach(id => next.add(id))
                              else                  elig.forEach(id => next.delete(id))
                              return next
                            })
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                      <SortTh s={s} sortKey="consignment_created_at" label="Consignment Created" sort={sort} onSort={toggleSort} />
                      <SortTh s={s} sortKey="audited_at"             label="Audited Date"        sort={sort} onSort={toggleSort} />
                      <SortTh s={s} sortKey="_shift"                 label="Shift"               sort={sort} onSort={toggleSort} />
                      <SortTh s={s} sortKey="customer_name"          label="Customer"            sort={sort} onSort={toggleSort} />
                      <SortTh s={s} sortKey="branch_name"            label="Branch"              sort={sort} onSort={toggleSort} />
                      <SortTh s={s} sortKey="gross_weight"           label="CRM Gross"           sort={sort} onSort={toggleSort} align="right" />
                      <SortTh s={s} sortKey="audit_gross_weight"     label="Audit Weight"        sort={sort} onSort={toggleSort} align="right" />
                      <SortTh s={s} sortKey="discrepancy_g"          label="Discrepancy"         sort={sort} onSort={toggleSort} align="right" />
                      <th style={{ ...s.th, textAlign: 'right' }}>Re-audit Weight</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Re-audit Δ</th>
                      <SortTh s={s} sortKey="auditor_name"           label="Auditor"             sort={sort} onSort={toggleSort} />
                      <th style={s.th}>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLog.map(r => {
                      const collectionOnly = isCollectionOnly(r)
                      const firstW = r.first_audit?.audit_gross_weight ?? r.audit_gross_weight
                      const firstD = Number(r.first_audit?.discrepancy_g ?? r.audit_discrepancy_g ?? 0)
                      const hasReaudit = !!r.reaudit
                      const reW = hasReaudit ? r.reaudit.audit_gross_weight : null
                      const reD = Number(r.reaudit?.discrepancy_g || 0)
                      const auditor = r.reaudit?.audited_by_name || r.audited_by_name || '—'
                      const remark  = effectiveRemark(r)
                      // Δ colour: green when audit > CRM (positive), red
                      // when audit < CRM (negative), neutral when 0.
                      const discColor   = firstD > 0 ? t.green : firstD < 0 ? t.red : t.text4
                      const reDiscColor = reD > 0 ? t.green : reD < 0 ? t.red : t.text4
                      // Shift chip colours mirror the roster — gold for
                      // night, orange for morning, dim for off-shift.
                      const shiftColor = r._shift === 'night'   ? t.gold
                                       : r._shift === 'morning' ? (t.orange || '#e9a942')
                                       : t.text4
                      const existingCase = caseFor(r)
                      const eligible     = isEligible(r)
                      const ticked       = selected.has(r.id)
                      return (
                        <tr key={r.id}>
                          <td style={{ ...s.td, padding: '9px 8px 9px 14px', width: '32px' }}>
                            {existingCase ? (
                              <span style={{
                                fontSize: '9px',
                                color: existingCase.status === 'pending' ? (t.orange || '#e9a942') : t.green,
                                background: `${existingCase.status === 'pending' ? (t.orange || '#e9a942') : t.green}18`,
                                border: `1px solid ${existingCase.status === 'pending' ? (t.orange || '#e9a942') : t.green}45`,
                                borderRadius: '5px',
                                padding: '2px 6px',
                                fontWeight: 700, letterSpacing: '.06em',
                                textTransform: 'uppercase',
                              }} title={existingCase.reason || (existingCase.status === 'pending' ? 'Sent to ops — awaiting reasoning' : 'Resolved')}>
                                {existingCase.status === 'pending' ? 'Sent' : 'Resolved'}
                              </span>
                            ) : eligible ? (
                              <input
                                type="checkbox"
                                checked={ticked}
                                onChange={() => setSelected(prev => {
                                  const next = new Set(prev)
                                  if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                                  return next
                                })}
                                style={{ cursor: 'pointer' }}
                                title="Select to send to ops"
                              />
                            ) : null}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px', fontFamily: 'monospace', color: t.text2, fontSize: '11.5px' }}>
                            {fmtDate(r.consignment_created_at)}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px', fontFamily: 'monospace', color: t.text2, fontSize: '11.5px' }}>
                            {fmtDate(r.audited_at)}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px' }}>
                            <span style={{
                              fontSize: '9.5px', color: shiftColor,
                              background: `${shiftColor}18`,
                              border: `1px solid ${shiftColor}45`,
                              borderRadius: '5px',
                              padding: '2px 7px',
                              fontWeight: 700, letterSpacing: '.06em',
                              textTransform: 'uppercase',
                            }}>{SHIFT_LABEL[r._shift] || '—'}</span>
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px' }}>{r.customer_name || '—'}</td>
                          <td style={{ ...s.td, padding: '9px 14px', color: t.text2 }}>{r.branch_name || '—'}</td>
                          <td style={{ ...s.td, padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace', color: t.gold }}>
                            {fmtWt(r.gross_weight)}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace', color: collectionOnly ? t.text4 : t.text1 }}>
                            {collectionOnly ? '—' : fmtWt(firstW)}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace', color: discColor, fontWeight: firstD !== 0 ? 700 : 400 }}>
                            {collectionOnly || firstD === 0 ? '—' : fmtSignedWt(firstD)}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace', color: hasReaudit ? t.text1 : t.text4 }}>
                            {hasReaudit && reW != null && Number(reW) !== 0 ? fmtWt(reW) : '—'}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace', color: reDiscColor, fontWeight: hasReaudit && reD !== 0 ? 700 : 400 }}>
                            {hasReaudit && reD !== 0 ? fmtSignedWt(reD) : '—'}
                          </td>
                          <td style={{ ...s.td, padding: '9px 14px', fontSize: '11.5px', color: t.text2 }}>{auditor}</td>
                          <td style={{
                            ...s.td, padding: '9px 14px', fontSize: '11px',
                            color: collectionOnly ? t.orange : t.text3,
                            fontStyle: collectionOnly ? 'italic' : 'normal',
                            whiteSpace: 'normal', maxWidth: '260px',
                          }}>{remark || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Empty({ t, text }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>
      {text}
    </div>
  )
}

// Click-to-sort header cell. Shows ▼/▲ when this column is the active
// sort, a faint ↕ otherwise so the affordance is visible without being
// noisy. Uses Discrepancy magnitude (signed) as the comparison key so
// the largest positives and largest negatives land at opposite ends of
// the sort, which is what ops actually wants when scanning for misses.
function SortTh({ s, sortKey, label, sort, onSort, align }) {
  const active = sort.key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ ...s.th, textAlign: align || 'left', cursor: 'pointer', userSelect: 'none' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        {label}
        <span style={{ opacity: active ? 0.95 : 0.28, fontSize: '8px', letterSpacing: 0 }}>
          {active ? (sort.dir === 'desc' ? '▼' : '▲') : '↕'}
        </span>
      </span>
    </th>
  )
}

