'use client'

// Audit Report — historical view + analytics over every audit action.
// Powered by /api/collection-audit?mode=history which returns every bill
// that has audited_at populated, regardless of current stock_status.
//
// Surfaces:
//   - KPI band: bills audited in window, received vs kept-pending split,
//     count of bills with discrepancy, total discrepancy grams, total value
//     of discrepancy-flagged bills.
//   - Per-auditor breakdown: who audited how many, how many discrepancies they flagged.
//   - Per-branch breakdown: which branches generate the most discrepancies.
//   - Full row-level log table with CSV export.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import { istToday, istDaysAgo } from '../../lib/dateIst'

const fmt          = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt        = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtSignedWt  = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v) || v === 0) return '0.000g'
  return `${v > 0 ? '+' : ''}${v.toFixed(3)}g`
}
const fmtTS  = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
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
  const [branchBreakdown, setBranchBreakdown] = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [tab,     setTab]     = useState('branches')   // 'branches' | 'log'
  // Shift filter — 'all' shows every audit; 'night' / 'morning' / 'off'
  // narrow to events whose audited_at falls inside that shift's window.
  // Drives both the Audit Log filter AND a client-side recomputation
  // of the Per-Branch breakdown so the numbers always match.
  const [shift,   setShift]   = useState('all')

  const fetchData = useCallback(async (f, tt) => {
    setLoading(true)
    const res = await authedFetch(`/api/collection-audit?mode=history&from=${f}&to=${tt}`)
    const j   = await res.json()
    if (!res.ok || j.error) {
      setRows([])
      setBranchBreakdown([])
      setLoading(false)
      return
    }
    setRows(j.rows || [])
    setBranchBreakdown(j.branchBreakdown || [])
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
      || (r.audited_by_email || '').toLowerCase().includes(q)
    )
  ), [rowsWithShift, q, shift])

  // Per-branch breakdown: when 'all' shift, use the server-supplied
  // breakdown verbatim (it already includes live in-transit counts).
  // When filtered, recompute everything EXCEPT in-transit (which is a
  // live snapshot independent of audit window/shift) from rowsWithShift.
  const filteredBranchBreakdown = useMemo(() => {
    if (shift === 'all') return branchBreakdown
    const inTransitByBranch = new Map(branchBreakdown.map(b => [b.branch, {
      in_transit_count:    b.in_transit_count,
      in_transit_weight_g: b.in_transit_weight_g,
    }]))
    const agg = new Map()
    for (const r of rowsWithShift) {
      if (!shiftMatches(r)) continue
      const k = r.branch_name || '—'
      if (!agg.has(k)) agg.set(k, {
        branch: k,
        in_transit_count:         0,
        in_transit_weight_g:      0,
        received_count:           0,
        received_weight_g:        0,
        audited_count:            0,
        discrepancy_count:        0,
        sum_abs_discrepancy_g:    0,
        total_expected_g:         0,
        total_received_audited_g: 0,
        auditors:                 new Set(),
      })
      const e = agg.get(k)
      e.audited_count    += 1
      e.total_expected_g += Number(r.gross_weight || 0)
      if (r.stock_status === 'at_ho') {
        e.received_count           += 1
        e.received_weight_g        += Number(r.audit_gross_weight || 0)
        e.total_received_audited_g += Number(r.audit_gross_weight || 0)
      }
      const d = Number(r.audit_discrepancy_g || 0)
      if (d !== 0) {
        e.discrepancy_count    += 1
        e.sum_abs_discrepancy_g += Math.abs(d)
      }
      if (r.audited_by_email) e.auditors.add(r.audited_by_email)
    }
    // Merge in-transit (live snapshot) per branch and round.
    const out = [...agg.values()].map(e => {
      const live = inTransitByBranch.get(e.branch) || { in_transit_count: 0, in_transit_weight_g: 0 }
      return {
        branch:                   e.branch,
        in_transit_count:         live.in_transit_count,
        in_transit_weight_g:      live.in_transit_weight_g,
        received_count:           e.received_count,
        received_weight_g:        Number(e.received_weight_g.toFixed(3)),
        audited_count:            e.audited_count,
        discrepancy_count:        e.discrepancy_count,
        sum_abs_discrepancy_g:    Number(e.sum_abs_discrepancy_g.toFixed(3)),
        total_expected_g:         Number(e.total_expected_g.toFixed(3)),
        total_received_audited_g: Number(e.total_received_audited_g.toFixed(3)),
        auditors:                 [...e.auditors],
      }
    })
    return out.sort((a, b) =>
      b.discrepancy_count - a.discrepancy_count ||
      b.audited_count     - a.audited_count
    )
  }, [shift, rowsWithShift, branchBreakdown])

  // KPI band — driven by the full window (not the filtered log) since the
  // filter is just a search filter on top of the log, not a scope change.
  const kpis = useMemo(() => {
    const total      = rows.length
    const received   = rows.filter(r => r.stock_status === 'at_ho').length
    const pending    = total - received
    const discrepancies = rows.filter(r => Number(r.audit_discrepancy_g || 0) !== 0)
    const totalDiscG = discrepancies.reduce((s, r) => s + Math.abs(Number(r.audit_discrepancy_g || 0)), 0)
    const reaudited  = rows.filter(r => (r.audit_attempts || 0) > 1).length
    return { total, received, pending, discrepancyCount: discrepancies.length, totalDiscG, reaudited }
  }, [rows])

  // ── CSV / PDF download — per-tab ─────────────────────────────────────────
  const dateTag = from === to ? from : `${from}_to_${to}`
  const windowLabelShort = from === to
    ? new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : `${new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} to ${new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`

  // Column definitions — single source of truth so CSV, PDF, and on-screen
  // tables all stay in sync.
  const branchCols = [
    ['Branch',                       b => b.branch],
    ['In transit (bills)',           b => b.in_transit_count],
    ['In transit (g)',               b => fmtWt(b.in_transit_weight_g)],
    ['Received (bills)',             b => b.received_count],
    ['Received (g)',                 b => fmtWt(b.received_weight_g)],
    ['Audited (bills)',              b => b.audited_count],
    ['Discrepancies',                b => b.discrepancy_count],
    ['Σ |Δ| grams',                  b => fmtWt(b.sum_abs_discrepancy_g)],
    ['Total expected (g)',           b => fmtWt(b.total_expected_g)],
    ['Total received+audited (g)',   b => fmtWt(b.total_received_audited_g)],
    ['Auditors',                     b => (b.auditors || []).join('; ')],
  ]
  const logCols = [
    ['Audited At',          r => r.audited_at],
    ['Shift',               r => SHIFT_LABEL[r._shift] || '—'],
    ['Customer',            r => r.customer_name],
    ['Branch',              r => r.branch_name],
    ['CRM Gross (g)',       r => fmtWt(r.gross_weight)],
    ['Audit Weight (g)',    r => fmtWt(r.first_audit?.audit_gross_weight ?? r.audit_gross_weight)],
    ['Discrepancy (g)',     r => fmtSignedWt(r.first_audit?.discrepancy_g ?? r.audit_discrepancy_g)],
    ['Re-audit Weight (g)', r => r.reaudit ? fmtWt(r.reaudit.audit_gross_weight) : '—'],
    ['Re-audit Δ (g)',      r => r.reaudit ? fmtSignedWt(r.reaudit.discrepancy_g) : '—'],
    ['Auditor',             r => r.reaudit?.audited_by_email || r.audited_by_email || '—'],
    ['Remark',              r => r.reaudit?.remark || r.audit_remark || ''],
  ]

  function exportCsv() {
    const isBranches = tab === 'branches'
    const data = isBranches ? filteredBranchBreakdown : filteredLog
    const cols = isBranches ? branchCols : logCols
    const fname = `AuditReport_${isBranches ? 'PerBranch' : 'Log'}_${dateTag}${shift === 'all' ? '' : `_${shift}`}.csv`
    if (!data.length) return
    const esc = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')
    const csv = [cols.map(c => c[0]).join(','), ...data.map(r => cols.map(c => esc(c[1](r))).join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fname
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  async function exportPdf() {
    const isBranches = tab === 'branches'
    const data = isBranches ? filteredBranchBreakdown : filteredLog
    const cols = isBranches ? branchCols : logCols
    const fname = `AuditReport_${isBranches ? 'PerBranch' : 'Log'}_${dateTag}${shift === 'all' ? '' : `_${shift}`}.pdf`
    if (!data.length) return
    // Dynamic imports — jspdf is heavy and only needed on click.
    const { jsPDF } = await import('jspdf')
    const autoTableMod = await import('jspdf-autotable')
    const autoTable = autoTableMod.default || autoTableMod
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    doc.setFontSize(13)
    doc.text(`Audit Report — ${isBranches ? 'Per-Branch Breakdown' : 'Audit Log'}`, 40, 32)
    doc.setFontSize(9)
    doc.text(`Reporting window: ${windowLabelShort}`, 40, 48)
    autoTable(doc, {
      startY: 60,
      head: [cols.map(c => c[0])],
      body: data.map(r => cols.map(c => String(c[1](r) ?? ''))),
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
            Historical view of every audit action. Filter by date window, see per-auditor and per-branch breakdowns.
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

        {/* Shift filter chips — narrow both Audit Log + Per-Branch breakdown
            to audits captured in that shift's IST window. Times mirror the
            roster: Night 19:30–24:00, Morning 08:30–19:30. */}
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

      {/* KPI band */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '130px' : '170px'}, 1fr))`, gap: '1px', background: t.border, borderRadius: '12px', overflow: 'hidden', boxShadow: `0 1px 3px ${t.border}50` }}>
        <Kpi t={t} label="Bills audited"          primary={kpis.total}                              sub={windowLabel}                                                       accent={t.gold} />
        <Kpi t={t} label="Received"               primary={kpis.received}                           sub={`${kpis.total ? Math.round(kpis.received / kpis.total * 100) : 0}% of audited`}        accent={t.green} />
        <Kpi t={t} label="Kept pending"           primary={kpis.pending}                            sub="awaiting follow-up"                                                accent={t.orange} />
        <Kpi t={t} label="Discrepancies"          primary={kpis.discrepancyCount}                   sub={`${kpis.total ? Math.round(kpis.discrepancyCount / kpis.total * 100) : 0}% of audited`} accent={t.red} />
        <Kpi t={t} label="Re-audited"             primary={kpis.reaudited}                          sub="bills with > 1 attempt"                                            accent={t.purple} />
        <Kpi t={t} label="Total |Δ| grams"        primary={fmtWt(kpis.totalDiscG)}                  sub="sum of absolute differences"                                       accent={t.blue} mono />
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : (
        <>
          {/* Tab strip + download buttons */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '10px', flexWrap: 'wrap',
            padding: '0 2px',
          }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'branches', label: 'Per-Branch Breakdown', icon: '🏬' },
                { id: 'log',      label: 'Audit Log',            icon: '📜' },
              ].map(item => {
                const active = tab === item.id
                return (
                  <button key={item.id} onClick={() => setTab(item.id)}
                    style={{
                      background: active ? `${t.gold}18` : 'transparent',
                      color:      active ? t.gold       : t.text2,
                      border:     `1px solid ${active ? `${t.gold}60` : t.border}`,
                      borderRadius: '11px',
                      padding:    '9px 16px',
                      fontSize:   '12px',
                      fontWeight: active ? 700 : 500,
                      cursor:     'pointer',
                      letterSpacing: '.02em',
                      display:    'inline-flex', alignItems: 'center', gap: '7px',
                      transition: 'all .15s ease',
                      boxShadow:  active ? `0 0 0 3px ${t.gold}10` : 'none',
                    }}>
                    <span style={{ fontSize: '13px', lineHeight: 1 }}>{item.icon}</span>
                    {item.label}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={exportCsv} disabled={tab === 'branches' ? !branchBreakdown.length : !filteredLog.length}
                style={{ ...s.btnOut, color: (tab === 'branches' ? filteredBranchBreakdown.length : filteredLog.length) ? t.gold : t.text4, borderColor: (tab === 'branches' ? filteredBranchBreakdown.length : filteredLog.length) ? `${t.gold}50` : t.border, padding: '7px 13px' }}>
                ↓ CSV
              </button>
              <button onClick={exportPdf} disabled={tab === 'branches' ? !branchBreakdown.length : !filteredLog.length}
                style={{ ...s.btnOut, color: (tab === 'branches' ? filteredBranchBreakdown.length : filteredLog.length) ? t.red : t.text4, borderColor: (tab === 'branches' ? filteredBranchBreakdown.length : filteredLog.length) ? `${(t.red || '#c03030')}55` : t.border, padding: '7px 13px' }}>
                ↓ PDF
              </button>
            </div>
          </div>

          {tab === 'branches' && (
            <Section t={t} s={s} accent={t.gold} badge="BRANCHES" title="Per-Branch Breakdown" subtitle="In-transit is a live snapshot; everything else scopes to the window. Sorted by discrepancy count, then audited count.">
              {filteredBranchBreakdown.length === 0 ? (
                <Empty t={t} text="No branch activity in this window." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: t.card2 || t.card }}>
                        <th style={s.th}>Branch</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>In transit</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Received</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Audited</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Discrepancies</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Σ |Δ| g</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Total expected</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Total received+audited</th>
                        <th style={s.th}>Auditors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBranchBreakdown.map(b => (
                        <tr key={b.branch}>
                          <td style={{ ...s.td, color: t.text1, fontWeight: 600 }}>{b.branch}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace' }}>
                            <div style={{ color: t.text2, fontWeight: 700 }}>{b.in_transit_count}</div>
                            <div style={{ color: t.text4, fontSize: '10px' }}>{fmtWt(b.in_transit_weight_g)}</div>
                          </td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace' }}>
                            <div style={{ color: t.green, fontWeight: 700 }}>{b.received_count}</div>
                            <div style={{ color: t.text4, fontSize: '10px' }}>{fmtWt(b.received_weight_g)}</div>
                          </td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 700 }}>{b.audited_count}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: b.discrepancy_count > 0 ? t.red : t.text4, fontWeight: 700 }}>{b.discrepancy_count}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.purple }}>{fmtWt(b.sum_abs_discrepancy_g)}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.text2 }}>{fmtWt(b.total_expected_g)}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.text2 }}>{fmtWt(b.total_received_audited_g)}</td>
                          <td style={{ ...s.td, fontSize: '10.5px', color: t.text3, whiteSpace: 'normal', maxWidth: '260px' }}>
                            {(b.auditors || []).length ? b.auditors.join(', ') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {tab === 'log' && (
            <Section t={t} s={s} accent={t.purple} badge="LOG" title="Audit Log" subtitle={`${filteredLog.length} row${filteredLog.length === 1 ? '' : 's'} · most recent first · re-audit columns populated when a bill was audited more than once`}>
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  style={{ ...s.input, flex: 1, fontFamily: 'inherit' }}
                  placeholder="Filter by app ID, customer, branch, auditor…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              {filteredLog.length === 0 ? (
                <Empty t={t} text="No audits in this window." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: t.card2 || t.card }}>
                        <th style={s.th}>Audit Date</th>
                        <th style={s.th}>Shift</th>
                        <th style={s.th}>Customer</th>
                        <th style={s.th}>Branch</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>CRM Weight</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Audit Weight</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Δ</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Re-audit Weight</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Re-audit Δ</th>
                        <th style={s.th}>Auditor</th>
                        <th style={s.th}>Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLog.map(r => {
                        const firstW = r.first_audit?.audit_gross_weight ?? r.audit_gross_weight
                        const firstD = Number(r.first_audit?.discrepancy_g ?? r.audit_discrepancy_g ?? 0)
                        const hasReaudit = !!r.reaudit
                        const reD = Number(r.reaudit?.discrepancy_g || 0)
                        const auditor = r.reaudit?.audited_by_email || r.audited_by_email || '—'
                        const remark  = r.reaudit?.remark || r.audit_remark || ''
                        const shiftColor = r._shift === 'night' ? t.gold : r._shift === 'morning' ? t.orange : t.text4
                        return (
                          <tr key={r.id}>
                            <td style={{ ...s.td, fontFamily: 'monospace', color: t.text3, fontSize: '11px' }}>{fmtTS(r.audited_at)}</td>
                            <td style={s.td}>
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
                            <td style={s.td}>{r.customer_name || '—'}</td>
                            <td style={s.td}>{r.branch_name}</td>
                            <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold }}>{fmtWt(r.gross_weight)}</td>
                            <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(firstW)}</td>
                            <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: firstD !== 0 ? t.red : t.green, fontWeight: 700 }}>{fmtSignedWt(firstD)}</td>
                            <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: hasReaudit ? t.text1 : t.text4 }}>{hasReaudit ? fmtWt(r.reaudit.audit_gross_weight) : '—'}</td>
                            <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: hasReaudit ? (reD !== 0 ? t.red : t.green) : t.text4, fontWeight: hasReaudit ? 700 : 400 }}>{hasReaudit ? fmtSignedWt(reD) : '—'}</td>
                            <td style={{ ...s.td, fontSize: '11px', color: t.text3 }}>{auditor}</td>
                            <td style={{ ...s.td, fontSize: '11px', color: t.text3, whiteSpace: 'normal', maxWidth: '260px' }}>{remark || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function Section({ t, s, accent, badge, title, subtitle, children }) {
  return (
    <div style={{ ...s.card, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)` }} />
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={s.badge(accent)}>{badge}</span>
        <div>
          <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>{subtitle}</div>
        </div>
      </div>
      {children}
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

function Kpi({ t, label, primary, sub, accent, mono }) {
  return (
    <div style={{ background: t.card, padding: '16px 18px 18px', position: 'relative', transition: 'background .18s ease' }}
      onMouseEnter={e => e.currentTarget.style.background = `${accent || t.text3}08`}
      onMouseLeave={e => e.currentTarget.style.background = t.card}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: accent || t.text3, opacity: .55 }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '22px', color: accent || t.text1, fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit', lineHeight: 1.1, letterSpacing: '-.015em' }}>{primary}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '8px' }}>{sub}</div>}
    </div>
  )
}
