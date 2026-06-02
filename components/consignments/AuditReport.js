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

const fmt    = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt  = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtTS  = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const fmtDate= (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

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
  const filtered = useMemo(() => rows.filter(r =>
    !q
    || (r.application_id   || '').toLowerCase().includes(q)
    || (r.customer_name    || '').toLowerCase().includes(q)
    || (r.branch_name      || '').toLowerCase().includes(q)
    || (r.audited_by_email || '').toLowerCase().includes(q)
  ), [rows, q])

  const kpis = useMemo(() => {
    const total      = filtered.length
    const received   = filtered.filter(r => r.stock_status === 'at_ho').length
    const pending    = total - received
    const discrepancies = filtered.filter(r => Number(r.audit_discrepancy_g || 0) !== 0)
    const totalDiscG = discrepancies.reduce((s, r) => s + Math.abs(Number(r.audit_discrepancy_g || 0)), 0)
    const totalDiscVal = discrepancies.reduce((s, r) => s + Number(r.total_amount || 0), 0)
    return { total, received, pending, discrepancyCount: discrepancies.length, totalDiscG, totalDiscVal }
  }, [filtered])

  const byAuditor = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const k = r.audited_by_email || '—'
      if (!m.has(k)) m.set(k, { auditor: k, total: 0, received: 0, pending: 0, discrepancies: 0, totalDiscG: 0 })
      const o = m.get(k)
      o.total += 1
      if (r.stock_status === 'at_ho') o.received += 1
      else o.pending += 1
      if (Number(r.audit_discrepancy_g || 0) !== 0) {
        o.discrepancies += 1
        o.totalDiscG += Math.abs(Number(r.audit_discrepancy_g))
      }
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [filtered])

  const byBranch = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const k = r.branch_name || '—'
      if (!m.has(k)) m.set(k, { branch: k, total: 0, received: 0, discrepancies: 0, totalDiscG: 0 })
      const o = m.get(k)
      o.total += 1
      if (r.stock_status === 'at_ho') o.received += 1
      if (Number(r.audit_discrepancy_g || 0) !== 0) {
        o.discrepancies += 1
        o.totalDiscG += Math.abs(Number(r.audit_discrepancy_g))
      }
    }
    return [...m.values()].sort((a, b) => b.discrepancies - a.discrepancies || b.total - a.total)
  }, [filtered])

  // CSV export — matches the on-screen log table headers.
  const dateTag = from === to ? from : `${from}_to_${to}`
  function exportCsv() {
    if (!filtered.length) return
    const cols = [
      ['Audited At',        r => r.audited_at],
      ['App ID',            r => r.application_id],
      ['Customer',          r => r.customer_name],
      ['Branch',            r => r.branch_name],
      ['CRM Gross (g)',     r => Number(r.gross_weight || 0).toFixed(3)],
      ['Measured (g)',      r => Number(r.audit_gross_weight || 0).toFixed(3)],
      ['Discrepancy (g)',   r => Number(r.audit_discrepancy_g || 0).toFixed(3)],
      ['Status',            r => r.stock_status === 'at_ho' ? 'Received' : 'Kept Pending'],
      ['Auditor',           r => r.audited_by_email],
      ['Remark',            r => r.audit_remark || ''],
    ]
    const esc = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')
    const csv = [cols.map(c => c[0]).join(','), ...filtered.map(r => cols.map(c => esc(c[1](r))).join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `AuditReport_${dateTag}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
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
            <button onClick={exportCsv} disabled={!filtered.length}
              style={{ ...s.btnOut, color: filtered.length ? t.gold : t.text4, borderColor: filtered.length ? `${t.gold}50` : t.border }}>
              ↓ CSV
            </button>
          </div>
        </div>
      </div>

      {/* KPI band — drop minimum to 130px on mobile so 2 KPIs fit per row
          on a 360px phone instead of 1 (which made the band very tall). */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '130px' : '180px'}, 1fr))`, gap: '1px', background: t.border, borderRadius: '12px', overflow: 'hidden', boxShadow: `0 1px 3px ${t.border}50` }}>
        <Kpi t={t} label="Bills audited"          primary={kpis.total}                              sub={windowLabel}                                                    accent={t.gold} />
        <Kpi t={t} label="Received"               primary={kpis.received}                           sub={`${kpis.total ? Math.round(kpis.received / kpis.total * 100) : 0}% of audited`} accent={t.green} />
        <Kpi t={t} label="Kept pending"           primary={kpis.pending}                            sub="awaiting follow-up"                                            accent={t.orange} />
        <Kpi t={t} label="Discrepancies"          primary={kpis.discrepancyCount}                   sub={`${kpis.total ? Math.round(kpis.discrepancyCount / kpis.total * 100) : 0}% of audited`} accent={t.red} />
        <Kpi t={t} label="Total |Δ| grams"        primary={fmtWt(kpis.totalDiscG)}                  sub="sum of absolute differences"                                    accent={t.purple} mono />
        <Kpi t={t} label="Discrepancy value"      primary={`₹${fmt(Math.round(kpis.totalDiscVal))}`} sub="goods value of flagged bills"                                  accent={t.blue} mono />
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : (
        <>
          {/* Per-auditor breakdown */}
          <Section t={t} s={s} accent={t.blue} badge="AUDITORS" title="Per-Auditor Breakdown" subtitle={`${byAuditor.length} auditor${byAuditor.length === 1 ? '' : 's'} active in this window`}>
            {byAuditor.length === 0 ? (
              <Empty t={t} text="No audits in this window." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: t.card2 || t.card }}>
                  <th style={s.th}>Auditor</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Audited</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Received</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Kept Pending</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Discrepancies</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Σ |Δ| grams</th>
                </tr></thead>
                <tbody>
                  {byAuditor.map(a => (
                    <tr key={a.auditor}>
                      <td style={{ ...s.td, color: t.text1, fontWeight: 600 }}>{a.auditor}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 700 }}>{a.total}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.green }}>{a.received}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.orange }}>{a.pending}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: a.discrepancies > 0 ? t.red : t.text4 }}>{a.discrepancies}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.purple }}>{fmtWt(a.totalDiscG)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Section>

          {/* Per-branch breakdown */}
          <Section t={t} s={s} accent={t.gold} badge="BRANCHES" title="Per-Branch Breakdown" subtitle="Sorted by discrepancy count first — most-flagged branches at the top">
            {byBranch.length === 0 ? (
              <Empty t={t} text="No audits in this window." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: t.card2 || t.card }}>
                  <th style={s.th}>Branch</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Audited</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Received</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Discrepancies</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Discrepancy rate</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Σ |Δ| grams</th>
                </tr></thead>
                <tbody>
                  {byBranch.map(b => {
                    const rate = b.total ? Math.round((b.discrepancies / b.total) * 100) : 0
                    const rateColor = rate >= 25 ? t.red : rate >= 10 ? t.orange : rate > 0 ? t.gold : t.text4
                    return (
                      <tr key={b.branch}>
                        <td style={{ ...s.td, color: t.text1, fontWeight: 600 }}>{b.branch}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 700 }}>{b.total}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.green }}>{b.received}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: b.discrepancies > 0 ? t.red : t.text4 }}>{b.discrepancies}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: rateColor, fontWeight: 700 }}>{rate}%</td>
                        <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.purple }}>{fmtWt(b.totalDiscG)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}
          </Section>

          {/* Full log */}
          <Section t={t} s={s} accent={t.purple} badge="LOG" title="Audit Log" subtitle={`${filtered.length} row${filtered.length === 1 ? '' : 's'} · most recent first`}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                style={{ ...s.input, flex: 1, fontFamily: 'inherit' }}
                placeholder="Filter by app ID, customer, branch, auditor…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {filtered.length === 0 ? (
              <Empty t={t} text="No audits in this window." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: t.card2 || t.card }}>
                    <th style={s.th}>Audited</th>
                    <th style={s.th}>App ID</th>
                    <th style={s.th}>Customer</th>
                    <th style={s.th}>Branch</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>CRM Gross</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Measured</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Δ</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Auditor</th>
                    <th style={s.th}>Remark</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(r => {
                      const diff = Number(r.audit_discrepancy_g || 0)
                      const has  = diff !== 0
                      const received = r.stock_status === 'at_ho'
                      return (
                        <tr key={r.id}>
                          <td style={{ ...s.td, fontFamily: 'monospace', color: t.text3, fontSize: '11px' }}>{fmtTS(r.audited_at)}</td>
                          <td style={{ ...s.td, fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{r.application_id}</td>
                          <td style={s.td}>{r.customer_name || '—'}</td>
                          <td style={s.td}>{r.branch_name}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold }}>{fmtWt(r.gross_weight)}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(r.audit_gross_weight)}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontFamily: 'monospace', color: has ? t.red : t.green, fontWeight: 700 }}>
                            {has ? `${diff > 0 ? '+' : ''}${diff.toFixed(3)}g` : '0.000g'}
                          </td>
                          <td style={s.td}>
                            <span style={{ ...s.badge(received ? t.green : t.orange) }}>
                              {received ? 'Received' : 'Pending'}
                            </span>
                          </td>
                          <td style={{ ...s.td, fontSize: '11px', color: t.text3 }}>{r.audited_by_email || '—'}</td>
                          <td style={{ ...s.td, fontSize: '11px', color: t.text3, whiteSpace: 'normal', maxWidth: '260px' }}>{r.audit_remark || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
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
