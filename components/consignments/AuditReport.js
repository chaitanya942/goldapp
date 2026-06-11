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
  // Click-to-sort state for the two tables. Default to "what hurts most":
  // branches by discrepancy count, log by most-recent audit.
  const [branchSort, setBranchSort] = useState({ key: 'discrepancy_count', dir: 'desc' })
  const [logSort,    setLogSort]    = useState({ key: 'audited_at',        dir: 'desc' })
  const toggleSort = (sort, setSort) => (key) => {
    if (sort.key === key) setSort({ key, dir: sort.dir === 'desc' ? 'asc' : 'desc' })
    else setSort({ key, dir: 'desc' })
  }

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
  // BUT we DO honor the shift filter: an ops user looking at "Morning shift"
  // expects the headline numbers to reflect that subset, not the full day.
  const kpis = useMemo(() => {
    const scope = rowsWithShift.filter(shiftMatches)
    const total      = scope.length
    const received   = scope.filter(r => r.stock_status === 'at_ho').length
    const pending    = total - received
    const discrepancies = scope.filter(r => Number(r.audit_discrepancy_g || 0) !== 0)
    const totalDiscG = discrepancies.reduce((s, r) => s + Math.abs(Number(r.audit_discrepancy_g || 0)), 0)
    const reaudited  = scope.filter(r => (r.audit_attempts || 0) > 1).length
    return { total, received, pending, discrepancyCount: discrepancies.length, totalDiscG, reaudited }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsWithShift, shift])

  // ── Daily series — bar per IST day in window; height = audited count,
  // colour switches red on days that had ≥1 discrepancy. Drives the
  // hero-strip sparkline.
  const dailySeries = useMemo(() => {
    const out = new Map()
    // Pre-seed every day in [from, to] so zero-audit days still show as a
    // faint stub rather than a gap.
    const start = new Date(from + 'T00:00:00Z')
    const end   = new Date(to   + 'T00:00:00Z')
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10)
      out.set(k, { date: k, count: 0, discCount: 0, discG: 0 })
    }
    for (const r of rowsWithShift) {
      if (!shiftMatches(r)) continue
      const istDate = new Date(new Date(r.audited_at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)
      const e = out.get(istDate)
      if (!e) continue
      e.count += 1
      const d = Number(r.audit_discrepancy_g || 0)
      if (d !== 0) {
        e.discCount += 1
        e.discG     += Math.abs(d)
      }
    }
    return [...out.values()]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsWithShift, from, to, shift])

  // ── Top callouts — three "open and act" hooks under the hero strip:
  //   1. Top-3 branches by discrepancy count (then by Σ|Δ|)
  //   2. Biggest single |Δ| of the window
  //   3. Most active auditor (by raw audit count)
  const callouts = useMemo(() => {
    const scope = rowsWithShift.filter(shiftMatches)
    // 1. Branches
    const branchAgg = new Map()
    for (const r of scope) {
      const k = r.branch_name || '—'
      if (!branchAgg.has(k)) branchAgg.set(k, { branch: k, audits: 0, discrepancies: 0, sumAbsG: 0 })
      const e = branchAgg.get(k)
      e.audits += 1
      const d = Number(r.audit_discrepancy_g || 0)
      if (d !== 0) { e.discrepancies += 1; e.sumAbsG += Math.abs(d) }
    }
    const topBranches = [...branchAgg.values()]
      .filter(b => b.discrepancies > 0)
      .sort((a, b) => b.discrepancies - a.discrepancies || b.sumAbsG - a.sumAbsG)
      .slice(0, 3)
    // 2. Biggest single Δ
    let biggest = null
    for (const r of scope) {
      const d = Math.abs(Number(r.audit_discrepancy_g || 0))
      if (d > 0 && (!biggest || d > Math.abs(Number(biggest.audit_discrepancy_g || 0)))) biggest = r
    }
    // 3. Top auditor by raw audit count, tie-break by discrepancies
    const auditorAgg = new Map()
    for (const r of scope) {
      const k = r.audited_by_email
      if (!k) continue
      if (!auditorAgg.has(k)) auditorAgg.set(k, { email: k, audits: 0, discrepancies: 0 })
      const e = auditorAgg.get(k)
      e.audits += 1
      if (Number(r.audit_discrepancy_g || 0) !== 0) e.discrepancies += 1
    }
    const topAuditor = [...auditorAgg.values()].sort((a, b) => b.audits - a.audits || b.discrepancies - a.discrepancies)[0] || null
    return { topBranches, biggest, topAuditor }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsWithShift, shift])

  // ── Threshold for tinting the worst log rows. Top ~10% of non-zero |Δ|
  // get a faint red wash so the eye lands there first. Returns Infinity
  // (i.e. nobody tinted) when the window has too few discrepancies for a
  // 10%-tile to be meaningful.
  const highlightThreshold = useMemo(() => {
    const ds = filteredLog
      .map(r => Math.abs(Number(r.audit_discrepancy_g || 0)))
      .filter(v => v > 0)
      .sort((a, b) => b - a)
    if (ds.length < 5) return Infinity
    const k = Math.max(1, Math.floor(ds.length * 0.1))
    return ds[k - 1]
  }, [filteredLog])

  // ── Apply click-to-sort overlays. Branch sort keys are column names;
  // log sort keys map a couple of cross-cutting columns ('discrepancy_g',
  // 'audited_at') to the underlying row fields.
  const sortedBranchBreakdown = useMemo(() => {
    const arr = [...filteredBranchBreakdown]
    const { key, dir } = branchSort
    const m = dir === 'desc' ? -1 : 1
    arr.sort((a, b) => {
      const av = a[key], bv = b[key]
      if (typeof av === 'string') return (av || '').localeCompare(bv || '') * m
      return ((Number(av) || 0) - (Number(bv) || 0)) * m
    })
    return arr
  }, [filteredBranchBreakdown, branchSort])

  const sortedLog = useMemo(() => {
    const arr = [...filteredLog]
    const { key, dir } = logSort
    const m = dir === 'desc' ? -1 : 1
    arr.sort((a, b) => {
      let av, bv
      if (key === 'discrepancy_g') {
        av = Math.abs(Number(a.first_audit?.discrepancy_g ?? a.audit_discrepancy_g ?? 0))
        bv = Math.abs(Number(b.first_audit?.discrepancy_g ?? b.audit_discrepancy_g ?? 0))
      } else if (key === 'audit_gross_weight') {
        av = Number(a.first_audit?.audit_gross_weight ?? a.audit_gross_weight ?? 0)
        bv = Number(b.first_audit?.audit_gross_weight ?? b.audit_gross_weight ?? 0)
      } else {
        av = a[key]; bv = b[key]
      }
      if (typeof av === 'string') return (av || '').localeCompare(bv || '') * m
      return ((Number(av) || 0) - (Number(bv) || 0)) * m
    })
    return arr
  }, [filteredLog, logSort])

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
    const data = isBranches ? sortedBranchBreakdown : sortedLog
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
    const data = isBranches ? sortedBranchBreakdown : sortedLog
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

      {/* Hero — Σ|Δ| + discrepancy rate as the headline, daily-volume
          sparkline in the middle, counts (audited / received / pending /
          re-audited) demoted to a compact stack on the right. */}
      <HeroStrip t={t} isMobile={isMobile} kpis={kpis} dailySeries={dailySeries} windowLabel={windowLabel} />

      {/* Callouts — three "open and act" hooks: which branches are bleeding,
          the worst single miss, who's pulling the most weight. */}
      <CalloutsRow t={t} isMobile={isMobile} callouts={callouts} fmtDate={fmtDate} fmtSignedWt={fmtSignedWt} />

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
              {sortedBranchBreakdown.length === 0 ? (
                <Empty t={t} text="No branch activity in this window." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: t.card2 || t.card }}>
                        <SortableTh s={s} sortKey="branch"                   label="Branch"                 sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} />
                        <SortableTh s={s} sortKey="in_transit_count"         label="In transit"             sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} align="right" />
                        <SortableTh s={s} sortKey="received_count"           label="Received"               sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} align="right" />
                        <SortableTh s={s} sortKey="audited_count"            label="Audited"                sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} align="right" />
                        <SortableTh s={s} sortKey="discrepancy_count"        label="Discrepancies"          sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} align="right" />
                        <SortableTh s={s} sortKey="sum_abs_discrepancy_g"    label="Σ |Δ| g"                sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} align="right" />
                        <SortableTh s={s} sortKey="total_expected_g"         label="Total expected"         sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} align="right" />
                        <SortableTh s={s} sortKey="total_received_audited_g" label="Total received+audited" sort={branchSort} onSort={toggleSort(branchSort, setBranchSort)} align="right" />
                        <th style={s.th}>Auditors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedBranchBreakdown.map(b => (
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
              {sortedLog.length === 0 ? (
                <Empty t={t} text="No audits in this window." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: t.card2 || t.card }}>
                        <SortableTh s={s} sortKey="audited_at"          label="Audit Date"      sort={logSort} onSort={toggleSort(logSort, setLogSort)} />
                        <th style={s.th}>Shift</th>
                        <SortableTh s={s} sortKey="customer_name"       label="Customer"        sort={logSort} onSort={toggleSort(logSort, setLogSort)} />
                        <SortableTh s={s} sortKey="branch_name"         label="Branch"          sort={logSort} onSort={toggleSort(logSort, setLogSort)} />
                        <SortableTh s={s} sortKey="gross_weight"        label="CRM Weight"      sort={logSort} onSort={toggleSort(logSort, setLogSort)} align="right" />
                        <SortableTh s={s} sortKey="audit_gross_weight"  label="Audit Weight"    sort={logSort} onSort={toggleSort(logSort, setLogSort)} align="right" />
                        <SortableTh s={s} sortKey="discrepancy_g"       label="|Δ|"             sort={logSort} onSort={toggleSort(logSort, setLogSort)} align="right" />
                        <th style={{ ...s.th, textAlign: 'right' }}>Re-audit Weight</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Re-audit Δ</th>
                        <SortableTh s={s} sortKey="audited_by_email"    label="Auditor"         sort={logSort} onSort={toggleSort(logSort, setLogSort)} />
                        <th style={s.th}>Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLog.map(r => {
                        const firstW = r.first_audit?.audit_gross_weight ?? r.audit_gross_weight
                        const firstD = Number(r.first_audit?.discrepancy_g ?? r.audit_discrepancy_g ?? 0)
                        const hasReaudit = !!r.reaudit
                        const reD = Number(r.reaudit?.discrepancy_g || 0)
                        const auditor = r.reaudit?.audited_by_email || r.audited_by_email || '—'
                        const remark  = r.reaudit?.remark || r.audit_remark || ''
                        const shiftColor = r._shift === 'night' ? t.gold : r._shift === 'morning' ? t.orange : t.text4
                        const isHot = Math.abs(firstD) >= highlightThreshold && Math.abs(firstD) > 0
                        return (
                          <tr key={r.id} style={isHot ? { background: `${t.red}10` } : undefined}>
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

// ── HeroStrip ────────────────────────────────────────────────────────────────
// One row, three zones: headline Σ|Δ| + discrepancy rate on the left,
// daily-volume sparkline in the middle, audited/received/pending/re-audited
// counts as a thin stack on the right. The point of the redesign is to put
// the "is anything bleeding?" answer first; counts demote to supporting.
function HeroStrip({ t, isMobile, kpis, dailySeries, windowLabel }) {
  const discRate = kpis.total ? Math.round(kpis.discrepancyCount / kpis.total * 100) : 0
  const recvRate = kpis.total ? Math.round(kpis.received       / kpis.total * 100) : 0
  const fmt3 = (n) => Number(n || 0).toFixed(3)
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px',
      padding: isMobile ? '18px' : '22px 26px',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
        background: `linear-gradient(90deg, ${t.purple || '#9d6cff'} 0%, ${t.red}55 55%, ${t.gold}50 100%)` }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.16em',
        textTransform: 'uppercase', fontWeight: 700 }}>
        Audit Health <span style={{ color: t.text4, opacity: .6 }}>·</span> {windowLabel}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1.2fr 2fr 1.5fr',
        gap: isMobile ? '22px' : '34px',
        marginTop: '14px',
        alignItems: 'center',
      }}>
        {/* Headline */}
        <div>
          <div style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.14em',
            textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>
            Σ |Δ| grams
          </div>
          <div style={{ fontSize: '38px', color: t.purple || '#9d6cff', fontWeight: 700,
            fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-.02em' }}>
            {fmt3(kpis.totalDiscG)}
            <span style={{ fontSize: '18px', color: t.text3, fontWeight: 400, marginLeft: '4px' }}>g</span>
          </div>
          <div style={{ marginTop: '14px', display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '22px', color: discRate > 0 ? t.red : t.green,
              fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>{discRate}%</span>
            <span style={{ fontSize: '10.5px', color: t.text4 }}>
              discrepancy rate · {kpis.discrepancyCount} of {kpis.total} bills
            </span>
          </div>
        </div>
        {/* Sparkline */}
        <div>
          <div style={{ fontSize: '9.5px', color: t.text4, letterSpacing: '.14em',
            textTransform: 'uppercase', fontWeight: 600, marginBottom: '10px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span>Daily audit volume</span>
            <span style={{ fontSize: '10px', textTransform: 'none', letterSpacing: 0,
              fontWeight: 400, opacity: .7 }}>
              red = had ≥1 discrepancy
            </span>
          </div>
          <Sparkline t={t} series={dailySeries} />
        </div>
        {/* Counts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <CountRow t={t} label="Audited"      value={kpis.total}     accent={t.gold}   bold />
          <CountRow t={t} label="Received"     value={kpis.received}  sub={`${recvRate}%`} accent={t.green} />
          <CountRow t={t} label="Kept pending" value={kpis.pending}   sub="awaiting"       accent={t.orange} />
          <CountRow t={t} label="Re-audited"   value={kpis.reaudited} sub=">1 attempt"     accent={t.blue || t.text2} last />
        </div>
      </div>
    </div>
  )
}

function CountRow({ t, label, value, sub, accent, bold, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      padding: '7px 0',
      borderBottom: last ? 'none' : `1px dashed ${t.border}80`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <div style={{ width: '4px', height: '13px', background: accent, borderRadius: '2px' }} />
        <span style={{ fontSize: '11.5px', color: bold ? t.text1 : t.text2,
          fontWeight: bold ? 700 : 500, letterSpacing: '.01em' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{ fontSize: bold ? '20px' : '16px', color: bold ? t.text1 : t.text2,
          fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>{value}</span>
        {sub && <span style={{ fontSize: '10px', color: t.text4 }}>{sub}</span>}
      </div>
    </div>
  )
}

// ── Sparkline ───────────────────────────────────────────────────────────────
// One bar per IST day in the window; bar height ∝ audited count. Days that
// had at least one discrepancy switch to red. Zero-audit days render as a
// faint stub so the day spacing stays honest.
function Sparkline({ t, series }) {
  const w = 320, h = 70, padX = 2, padY = 4
  const innerW = w - padX * 2, innerH = h - padY * 2
  if (!series.length) return <div style={{ fontSize: '11px', color: t.text4 }}>—</div>
  const maxCount = Math.max(1, ...series.map(s => s.count))
  const slotW   = innerW / series.length
  const barW    = Math.max(3, slotW - 3)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      style={{ width: '100%', height: '70px', display: 'block' }}>
      {/* baseline */}
      <line x1={padX} x2={w - padX} y1={h - padY} y2={h - padY} stroke={t.border} strokeWidth="0.5" />
      {series.map((d, i) => {
        const x = padX + i * slotW + (slotW - barW) / 2
        const ratio = d.count / maxCount
        const barH  = Math.max(d.count > 0 ? 2 : 1, ratio * innerH)
        const y     = h - padY - barH
        const hot   = d.discCount > 0
        return (
          <rect key={d.date}
            x={x} y={y} width={barW} height={barH}
            fill={hot ? t.red : t.gold}
            opacity={d.count === 0 ? 0.18 : (hot ? 0.85 : 0.7)}
            rx="1.5">
            <title>{`${d.date}: ${d.count} audited, ${d.discCount} discrepancy, |Δ| ${d.discG.toFixed(3)}g`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

// ── CalloutsRow ──────────────────────────────────────────────────────────────
// Three "open and act" tiles surfacing the highest-leverage observations
// for the window. Each tile is self-contained: if its data isn't present
// it shows a tasteful empty state instead of leaving a hole.
function CalloutsRow({ t, isMobile, callouts, fmtDate, fmtSignedWt }) {
  const card = {
    background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px',
    padding: '14px 16px 16px', position: 'relative', overflow: 'hidden',
  }
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
      gap: '12px',
    }}>
      {/* Top discrepancy branches */}
      <div style={card}>
        <Accent color={t.red} />
        <CalloutTitle t={t} color={t.red} icon="◆">Top discrepancy branches</CalloutTitle>
        {callouts.topBranches.length === 0 ? (
          <CalloutEmpty t={t}>No discrepancies in window.</CalloutEmpty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            {callouts.topBranches.map((b, i) => (
              <div key={b.branch} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  fontSize: '10px', color: t.red, background: `${t.red}20`,
                  borderRadius: '4px', padding: '3px 7px', fontWeight: 700,
                  fontFamily: 'monospace', minWidth: '16px', textAlign: 'center',
                }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12.5px', color: t.text1, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.branch}
                  </div>
                  <div style={{ fontSize: '10px', color: t.text4, marginTop: '2px' }}>
                    {b.discrepancies} discrepanc{b.discrepancies === 1 ? 'y' : 'ies'} · {b.sumAbsG.toFixed(3)}g
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Biggest single Δ */}
      <div style={card}>
        <Accent color={t.purple || '#9d6cff'} />
        <CalloutTitle t={t} color={t.purple || '#9d6cff'} icon="✦">Biggest single Δ</CalloutTitle>
        {!callouts.biggest ? (
          <CalloutEmpty t={t}>No discrepancy in window.</CalloutEmpty>
        ) : (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '26px',
              color: Number(callouts.biggest.audit_discrepancy_g) < 0 ? t.red : t.green,
              fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>
              {fmtSignedWt(callouts.biggest.audit_discrepancy_g)}
            </div>
            <div style={{ fontSize: '12px', color: t.text2, marginTop: '8px', fontWeight: 600 }}>
              {callouts.biggest.application_id || '—'}
              {callouts.biggest.customer_name ? <span style={{ color: t.text4, fontWeight: 400 }}> · {callouts.biggest.customer_name}</span> : null}
            </div>
            <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>
              {callouts.biggest.branch_name || '—'} · {fmtDate(callouts.biggest.audited_at)}
            </div>
          </div>
        )}
      </div>
      {/* Most active auditor */}
      <div style={card}>
        <Accent color={t.gold} />
        <CalloutTitle t={t} color={t.gold} icon="●">Most active auditor</CalloutTitle>
        {!callouts.topAuditor ? (
          <CalloutEmpty t={t}>No audits in window.</CalloutEmpty>
        ) : (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '13px', color: t.text1, fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {callouts.topAuditor.email}
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '20px', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontSize: '22px', color: t.gold, fontWeight: 700,
                  fontFamily: 'monospace', lineHeight: 1 }}>{callouts.topAuditor.audits}</div>
                <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em',
                  textTransform: 'uppercase', marginTop: '4px', fontWeight: 600 }}>Bills audited</div>
              </div>
              <div>
                <div style={{ fontSize: '22px',
                  color: callouts.topAuditor.discrepancies > 0 ? t.red : t.text3,
                  fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>
                  {callouts.topAuditor.discrepancies}
                </div>
                <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em',
                  textTransform: 'uppercase', marginTop: '4px', fontWeight: 600 }}>Flagged</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Accent({ color }) {
  return <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: color, opacity: .65 }} />
}
function CalloutTitle({ t, color, icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <span style={{ color, fontSize: '11px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em',
        textTransform: 'uppercase', fontWeight: 700 }}>{children}</span>
    </div>
  )
}
function CalloutEmpty({ t, children }) {
  return <div style={{ fontSize: '12px', color: t.text4, fontStyle: 'italic', marginTop: '14px' }}>{children}</div>
}

// ── SortableTh ───────────────────────────────────────────────────────────────
// Header cell with click-to-sort behaviour. Renders ▼/▲ when this column
// is the active sort, a faint ↕ otherwise so the affordance is visible
// without being noisy.
function SortableTh({ s, sortKey, label, sort, onSort, align }) {
  const active = sort.key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        ...s.th,
        textAlign: align || 'left',
        cursor: 'pointer',
        userSelect: 'none',
        color: active ? (s.th.color || undefined) : undefined,
      }}
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
