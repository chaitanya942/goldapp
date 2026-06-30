'use client'

// Productivity — insights & throughput module, locked to a hard email allowlist
// (PAGE_EMAIL_ALLOWLIST in lib/context.js; even super_admin is blocked).
// Combines EVERY angle of the case lifecycle, dynamic + filterable:
//   • per-stage TAT medians (valuation → … → completion), where time is lost
//   • breakdown by ANY dimension (state · branch · type · stone · ornaments ·
//     employee · status) — each is both a FILTER and a GROUP-BY
//   • WIP "stuck" board — open cases by status, oldest first
//   • case-level drill-down with every stage duration
// 1–14 Jun = OLD CRM (TAT slices) · 15 Jun+ = NEW CRM (full stage timeline).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import GoldSpinner from '../ui/GoldSpinner'

const fmt = (m) => m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(0) + 'm'
const fmt1 = (m) => m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(1) + 'm'
const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN')
const STAGE_COLORS = ['#3a8fbf', '#c9a84c', '#8c5ac8', '#e58a3b', '#3aaa6a', '#e05555', '#5ec1d6']

export default function Productivity() {
  const { theme, canSee } = useApp()
  const allowed = canSee('productivity')
  const dark = theme === 'dark'
  const t = {
    bg: dark ? '#14110c' : '#faf7f0', card: dark ? '#1c1813' : '#ffffff', card2: dark ? '#221d16' : '#f7f3ea',
    border: dark ? '#332b20' : '#e7ddc8', text1: dark ? '#f3ead6' : '#1a140a', text2: dark ? '#cdbfa3' : '#5a4d36',
    text3: dark ? '#9a8d72' : '#897a5c', text4: dark ? '#6f6450' : '#a89878',
    gold: '#c9a84c', green: '#3aaa6a', blue: '#3a8fbf', red: '#e05555', purple: '#8c5ac8',
  }
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14 }
  const th = { padding: '8px 11px', fontSize: 9.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card2, whiteSpace: 'nowrap', position: 'sticky', top: 0 }
  const td = { padding: '7px 11px', fontSize: 12, color: t.text2, borderBottom: `1px solid ${t.border}55`, whiteSpace: 'nowrap' }

  const [from, setFrom] = useState('2026-06-15')
  const [to, setTo] = useState('2026-06-30')
  const [groupBy, setGroupBy] = useState('state')
  const [filters, setFilters] = useState({ state: '', branch: '', type: '', stone: '', ornaments: '', status: '', employee: '' })
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const resetF = () => setFilters({ state: '', branch: '', type: '', stone: '', ornaments: '', status: '', employee: '' })

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ action: 'report', from, to, groupBy })
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await authedFetch(`/api/productivity?${qs}`)
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
    } catch (e) { setError(e.message); setData(null) }
    setLoading(false)
  }, [from, to, groupBy, filters, allowed])
  useEffect(() => { load() }, [load])

  const facets = data?.facets || {}
  const stages = data?.stageMeta || []
  const stageBar = useMemo(() => {
    if (!data?.stages) return []
    const segs = stages.map((s, i) => ({ ...s, val: data.stages[s.key]?.median || 0, color: STAGE_COLORS[i % STAGE_COLORS.length] }))
    const sum = segs.reduce((a, s) => a + s.val, 0) || 1
    return segs.map(s => ({ ...s, pct: (s.val / sum) * 100 }))
  }, [data, stages])

  if (!allowed) return (
    <div style={{ padding: 60, textAlign: 'center', color: t.text3 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: t.text1 }}>Restricted</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>This module is limited to specific accounts.</div>
    </div>
  )

  const Sel = ({ label, k, opts }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{label}</span>
      <select value={filters[k]} onChange={e => setF(k, e.target.value)}
        style={{ background: t.card2, border: `1px solid ${filters[k] ? t.gold : t.border}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1, maxWidth: 150 }}>
        <option value="">All</option>
        {(opts || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{ background: tab === id ? t.gold : 'transparent', color: tab === id ? '#1a0a00' : t.text2, border: `1px solid ${tab === id ? t.gold : t.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 14, color: t.text1 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 300, letterSpacing: '.03em' }}>Productivity</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: t.red, background: `${t.red}16`, border: `1px solid ${t.red}40`, borderRadius: 5, padding: '2px 8px' }}>🔒 RESTRICTED</span>
            {data?.mode && <span style={{ fontSize: 10, fontWeight: 700, color: t.text4 }}>{data.mode === 'new' ? 'NEW CRM · full stage timeline' : 'OLD CRM · TAT slices'}</span>}
          </div>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4 }}>Every case, every stage, every person — combined &amp; filterable. 1–14 Jun = OLD CRM · 15 Jun+ = NEW CRM.</div>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>From</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1 }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>To</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1 }} /></label>
          <button onClick={load} disabled={loading} style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{loading ? '…' : 'Run'}</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ ...card, padding: '11px 13px', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Sel label="State" k="state" opts={facets.state} />
        <Sel label="Branch" k="branch" opts={facets.branch} />
        <Sel label="Type" k="type" opts={facets.type} />
        <Sel label="Stone" k="stone" opts={facets.stone} />
        <Sel label="Ornaments" k="ornaments" opts={facets.ornaments} />
        <Sel label="Status" k="status" opts={facets.status} />
        <Sel label="Employee" k="employee" opts={facets.employee} />
        <button onClick={resetF} style={{ background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Clear</button>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Group by</span>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={{ background: t.card2, border: `1px solid ${t.gold}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1, fontWeight: 700 }}>
            {['state', 'branch', 'type', 'stone', 'ornaments', 'employee', 'status'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>

      {error && <div style={{ ...card, borderColor: `${t.red}55`, background: `${t.red}10`, color: t.red, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>⚠ {error}</div>}

      {loading ? (
        <div style={{ ...card, padding: 80, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
      ) : data?.mode === 'old' ? (
        <OldTat tat={data.tat} t={t} card={card} th={th} td={td} />
      ) : data?.mode === 'new' ? (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8 }}>
            <TabBtn id="overview" label="Overview" />
            <TabBtn id="stuck" label={`Stuck / WIP${data.kpis.open ? ` · ${data.kpis.open}` : ''}`} />
            <TabBtn id="cases" label="Case drill-down" />
          </div>

          {tab === 'overview' && <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {[
                { label: 'Median TAT', val: fmt1(data.kpis.medianTat), sub: 'open → completed', color: t.gold },
                { label: 'Completed', val: num(data.kpis.completed), sub: 'in window + filters', color: t.green },
                { label: 'Open (WIP)', val: num(data.kpis.open), sub: 'not yet completed', color: t.blue },
                { label: 'Avg TAT', val: fmt1(data.kpis.avgTat), sub: 'mean', color: t.purple },
                { label: 'Slowest', val: fmt1(data.kpis.slowest), sub: 'max completed', color: t.red },
              ].map(k => (
                <div key={k.label} style={{ ...card, padding: '13px 15px', borderLeft: `3px solid ${k.color}` }}>
                  <div style={{ fontSize: 9, color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800 }}>{k.label}</div>
                  <div style={{ fontSize: 23, fontWeight: 700, color: k.color, fontFamily: 'monospace', marginTop: 5 }}>{k.val}</div>
                  <div style={{ fontSize: 10, color: t.text4, marginTop: 2 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* Where time goes — stage breakdown */}
            <div style={{ ...card, padding: '13px 15px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Where the time goes <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· median per stage (the bottleneck view)</span></div>
              <div style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', border: `1px solid ${t.border}` }}>
                {stageBar.map(s => s.pct > 0 && (
                  <div key={s.key} title={`${s.label}: ${fmt1(s.val)}`} style={{ width: `${s.pct}%`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700, overflow: 'hidden' }}>
                    {s.pct > 7 ? fmt(s.val) : ''}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                {stageBar.map(s => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
                    <span style={{ color: t.text2 }}>{s.label}</span>
                    <strong style={{ color: t.text1, fontFamily: 'monospace' }}>{fmt1(s.val)}</strong>
                    <span style={{ color: t.text4, fontSize: 9.5 }}>n={data.stages[s.key]?.n}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Grouped breakdown — medians per stage per group */}
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>
                By {data.groupBy} <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· median TAT per stage · {data.groups.length} groups</span>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 460 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>{data.groupBy}</th><th style={{ ...th, textAlign: 'right' }}>n</th>
                    {stages.map(s => <th key={s.key} style={{ ...th, textAlign: 'right' }}>{s.label.split('·')[1]?.trim() || s.label}</th>)}
                    <th style={{ ...th, textAlign: 'right', color: t.gold }}>TOTAL</th>
                  </tr></thead>
                  <tbody>{data.groups.map(g => (
                    <tr key={g.key}>
                      <td style={{ ...td, fontWeight: 700, color: t.text1, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.key}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{num(g.n)}</td>
                      {stages.map(s => <td key={s.key} style={{ ...td, textAlign: 'right' }}>{fmt(g.stages[s.key])}</td>)}
                      <td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmt1(g.medianTat)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>}

          {tab === 'stuck' && <>
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Stuck by status <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· open cases, where they wait</span></div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Status</th><th style={th}>Waiting on</th><th style={{ ...th, textAlign: 'right' }}>Open</th><th style={{ ...th, textAlign: 'right' }}>Median age</th><th style={{ ...th, textAlign: 'right' }}>Oldest</th></tr></thead>
                <tbody>{data.wip.map(w => (
                  <tr key={w.status}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{w.status}</td><td style={{ ...td, color: t.text3 }}>{w.owner}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{num(w.n)}</td><td style={{ ...td, textAlign: 'right' }}>{fmt(w.medianAge)}</td><td style={{ ...td, textAlign: 'right', color: t.red }}>{fmt(w.oldestAge)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Oldest open cases</div>
              <div style={{ overflowX: 'auto', maxHeight: 460 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Code</th><th style={th}>Branch</th><th style={th}>State</th><th style={th}>Type</th><th style={th}>Status → waiting on</th><th style={th}>Opened by</th><th style={{ ...th, textAlign: 'right' }}>Age</th></tr></thead>
                  <tbody>{data.oldestOpen.map(c => (
                    <tr key={c.code}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{c.code}</td><td style={td}>{c.branch}</td><td style={td}>{c.state}</td><td style={td}>{c.type}</td><td style={{ ...td, fontSize: 11 }}>{c.status} <span style={{ color: t.text4 }}>→ {c.owner}</span></td><td style={td}>{c.opener}</td><td style={{ ...td, textAlign: 'right', color: t.red, fontWeight: 700 }}>{fmt(c.ageMin)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>}

          {tab === 'cases' && (
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Completed cases <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· slowest first · {data.cases.length} shown · every stage duration</span></div>
              <div style={{ overflowX: 'auto', maxHeight: 600 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>Code</th><th style={th}>Branch</th><th style={th}>Type</th><th style={th}>Stone</th><th style={{ ...th, textAlign: 'right' }}>Orn</th>
                    {stages.map(s => <th key={s.key} style={{ ...th, textAlign: 'right' }}>{s.label.split('·')[0].trim()}</th>)}
                    <th style={{ ...th, textAlign: 'right', color: t.gold }}>TOTAL</th>
                  </tr></thead>
                  <tbody>{data.cases.map(c => (
                    <tr key={c.code}>
                      <td style={{ ...td, fontWeight: 700, color: t.text1 }}>{c.code}</td><td style={td}>{c.branch}</td><td style={td}>{c.type}</td>
                      <td style={td}>{c.stone === 'with_stone' ? 'stone' : '—'}</td><td style={{ ...td, textAlign: 'right' }}>{c.ornCnt ?? '—'}</td>
                      {stages.map(s => <td key={s.key} style={{ ...td, textAlign: 'right' }}>{fmt(c.stages[s.key])}</td>)}
                      <td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmt1(c.total)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

// OLD-CRM window — legacy walk-in→payment TAT slices.
function OldTat({ tat, t, card, th, td }) {
  if (!tat) return null
  const fmtm = (n) => n == null ? '—' : `${Number(n).toFixed(1)}m`
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[['Avg TAT', fmtm(tat.overall?.avg_min), t.gold], ['Bills', Number(tat.overall?.bills || 0).toLocaleString('en-IN'), t.blue], ['Fastest', fmtm(tat.overall?.min_min), t.green], ['Slowest', fmtm(tat.overall?.max_min), t.red]].map(([l, v, c]) => (
          <div key={l} style={{ ...card, padding: '13px 15px', borderLeft: `3px solid ${c}` }}>
            <div style={{ fontSize: 9, color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800 }}>{l}</div>
            <div style={{ fontSize: 23, fontWeight: 700, color: c, fontFamily: 'monospace', marginTop: 5 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Statewise TAT (OLD CRM · walk-in → payment)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>State</th><th style={{ ...th, textAlign: 'right' }}>Avg TAT</th><th style={{ ...th, textAlign: 'right' }}>Bills</th></tr></thead>
          <tbody>{(tat.by_state || []).map(r => (
            <tr key={r.state}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{r.state}</td><td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmtm(r.avg_min)}</td><td style={{ ...td, textAlign: 'right' }}>{Number(r.bills).toLocaleString('en-IN')}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}
