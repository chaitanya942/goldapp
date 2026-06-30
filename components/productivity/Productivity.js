'use client'

// Productivity — insights & throughput module, locked to a hard email allowlist
// (PAGE_EMAIL_ALLOWLIST in lib/context.js; even super_admin is blocked). Built
// as an extensible multi-section dashboard. Section 1 = TAT (turn-around-time),
// sliced state × type × stone × ornament-count, OLD-vs-NEW by the date filter.
// More sections (throughput, conversion, employee, branch, …) layer on top.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import GoldSpinner from '../ui/GoldSpinner'

const fmtMin = (n) => n == null ? '—' : `${Number(n).toFixed(1)}m`
const num    = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN')

export default function Productivity() {
  const { theme, canSee } = useApp()
  const allowed = canSee('productivity')   // hard email allowlist (see PAGE_EMAIL_ALLOWLIST)
  const dark = theme === 'dark'
  const t = {
    bg: dark ? '#14110c' : '#faf7f0', card: dark ? '#1c1813' : '#ffffff', card2: dark ? '#221d16' : '#f7f3ea',
    border: dark ? '#332b20' : '#e7ddc8', text1: dark ? '#f3ead6' : '#1a140a', text2: dark ? '#cdbfa3' : '#5a4d36',
    text3: dark ? '#9a8d72' : '#897a5c', text4: dark ? '#6f6450' : '#a89878',
    gold: '#c9a84c', green: '#3aaa6a', blue: '#3a8fbf', red: '#e05555', purple: '#8c5ac8',
  }
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14 }

  const [from, setFrom] = useState('2026-06-01')
  const [to,   setTo]   = useState('2026-06-14')
  const [data, setData] = useState(null)
  const [note, setNote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const r = await authedFetch(`/api/productivity?action=tat&from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j.data); setNote(j.note || null)
    } catch (e) { setError(e.message); setData(null) }
    setLoading(false)
  }, [from, to, allowed])
  useEffect(() => { load() }, [load])

  // state × type × stone → pivot for the matrix.
  const matrix = useMemo(() => {
    const rows = data?.by_state_type || []
    const states = [...new Set(rows.map(r => r.state))]
    return states.map(st => {
      const cell = (typ, stone) => rows.find(r => r.state === st && r.typ === typ && r.stone === stone)
      return { state: st,
        phys_no: cell('PHYSICAL', 'no_stone'), phys_st: cell('PHYSICAL', 'with_stone'),
        tk_no:   cell('TAKEOVER', 'no_stone'), tk_st:   cell('TAKEOVER', 'with_stone') }
    })
  }, [data])

  const Cell = ({ c }) => c ? <span><strong style={{ color: t.text1 }}>{fmtMin(c.avg_min)}</strong> <span style={{ color: t.text4, fontSize: 10 }}>· {num(c.bills)}</span></span> : <span style={{ color: t.text4 }}>—</span>
  const th = { padding: '9px 12px', fontSize: 10, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card2 }
  const td = { padding: '9px 12px', fontSize: 12.5, color: t.text2, borderBottom: `1px solid ${t.border}55` }

  if (!allowed) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: t.text3 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text1 }}>Restricted</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>This module is limited to specific accounts.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 16, color: t.text1 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 300, letterSpacing: '.03em' }}>Productivity</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: t.red, background: `${t.red}16`, border: `1px solid ${t.red}40`, borderRadius: 5, padding: '2px 8px' }}>🔒 RESTRICTED</span>
          </div>
          <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>
            Turn-around-time, like-for-like across state · type · stone · ornaments. 1–14 Jun = OLD CRM · 15–30 Jun = NEW CRM.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: t.text4, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700 }}>Purchase dates</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '6px 9px', fontSize: 11, color: t.text1, fontFamily: 'monospace' }} />
          <span style={{ color: t.text4 }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '6px 9px', fontSize: 11, color: t.text1, fontFamily: 'monospace' }} />
          <button onClick={load} disabled={loading}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            {loading ? '…' : 'Run'}
          </button>
        </div>
      </div>

      {error && <div style={{ ...card, borderColor: `${t.red}55`, background: `${t.red}10`, color: t.red, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>⚠ {error}</div>}
      {note  && <div style={{ ...card, borderColor: `${t.gold}55`, background: `${t.gold}10`, color: t.gold, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{note}</div>}

      {loading ? (
        <div style={{ ...card, padding: 80, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
      ) : data ? (
        <>
          {/* Overall KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            {[
              { label: 'Avg TAT', val: fmtMin(data.overall?.avg_min), sub: 'walk-in → payment', color: t.gold },
              { label: 'Bills', val: num(data.overall?.bills), sub: 'closed in window', color: t.blue },
              { label: 'Fastest', val: fmtMin(data.overall?.min_min), sub: 'min', color: t.green },
              { label: 'Slowest', val: fmtMin(data.overall?.max_min), sub: 'max', color: t.red },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '14px 16px', borderLeft: `3px solid ${k.color}` }}>
                <div style={{ fontSize: 9.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 800 }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: k.color, fontFamily: 'monospace', marginTop: 6 }}>{k.val}</div>
                <div style={{ fontSize: 10.5, color: t.text4, marginTop: 3 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Statewise + Physical/Takeover */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Statewise TAT</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>State</th><th style={{ ...th, textAlign: 'right' }}>Avg TAT</th><th style={{ ...th, textAlign: 'right' }}>Bills</th></tr></thead>
                <tbody>{(data.by_state || []).map(r => (
                  <tr key={r.state}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{r.state}</td><td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmtMin(r.avg_min)}</td><td style={{ ...td, textAlign: 'right' }}>{num(r.bills)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Physical vs Takeover</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Type</th><th style={{ ...th, textAlign: 'right' }}>Avg TAT</th><th style={{ ...th, textAlign: 'right' }}>Bills</th></tr></thead>
                <tbody>{(data.by_type || []).map(r => (
                  <tr key={r.typ}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{r.typ}</td><td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmtMin(r.avg_min)}</td><td style={{ ...td, textAlign: 'right' }}>{num(r.bills)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {/* The apple-to-apple matrix: state × type × stone */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>
              State × Type × Stone <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· avg TAT · bills · the like-for-like view (no-stone columns compare clean — KL has ~none)</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th} rowSpan={2}>State</th>
                  <th style={{ ...th, textAlign: 'center', borderRight: `1px solid ${t.border}` }} colSpan={2}>Physical</th>
                  <th style={{ ...th, textAlign: 'center' }} colSpan={2}>Takeover</th>
                </tr>
                <tr>
                  <th style={{ ...th, textAlign: 'right' }}>no stone</th><th style={{ ...th, textAlign: 'right', borderRight: `1px solid ${t.border}` }}>with stone</th>
                  <th style={{ ...th, textAlign: 'right' }}>no stone</th><th style={{ ...th, textAlign: 'right' }}>with stone</th>
                </tr>
              </thead>
              <tbody>{matrix.map(m => (
                <tr key={m.state}>
                  <td style={{ ...td, fontWeight: 700, color: t.text1 }}>{m.state}</td>
                  <td style={{ ...td, textAlign: 'right' }}><Cell c={m.phys_no} /></td>
                  <td style={{ ...td, textAlign: 'right', borderRight: `1px solid ${t.border}55` }}><Cell c={m.phys_st} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><Cell c={m.tk_no} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><Cell c={m.tk_st} /></td>
                </tr>
              ))}</tbody>
            </table>
            </div>
          </div>

          {/* Ornament count × stone */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Ornament count × Stone</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Ornaments</th><th style={th}>Stone</th><th style={{ ...th, textAlign: 'right' }}>Avg TAT</th><th style={{ ...th, textAlign: 'right' }}>Bills</th></tr></thead>
              <tbody>{(data.by_ornament || []).map((r, i) => (
                <tr key={i}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{r.orn}</td><td style={{ ...td }}>{r.stone === 'with_stone' ? 'with' : 'no'} stone</td><td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmtMin(r.avg_min)}</td><td style={{ ...td, textAlign: 'right' }}>{num(r.bills)}</td></tr>
              ))}</tbody>
            </table>
          </div>

          <div style={{ fontSize: 10.5, color: t.text4, textAlign: 'right' }}>
            Source: {data.source === 'old_crm' ? 'OLD CRM' : data.source} · TAT = walk-in → payment · outliers (&gt;24h) excluded · more sections coming (stage-wise, throughput, conversion, employee/branch, time-of-day).
          </div>
        </>
      ) : null}
    </div>
  )
}
