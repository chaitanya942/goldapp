'use client'

// Productivity — insights & throughput, locked to a hard email allowlist
// (PAGE_EMAIL_ALLOWLIST; even super_admin blocked). All-in-one analytics:
//   • Source: NEW only · OLD only · Compare both (side by side)
//   • Custom date window + day/week trend lines
//   • Filter & group by ANY dimension: region·state·branch·type·stone·
//     ornaments·employee·status
//   • Charts: stage-bottleneck bar, TAT trend line, group bar chart
//   • Tabs: Overview · Trends · People (per-employee stage medians) ·
//     Stuck/WIP · Cases (bill-level drill-down → full per-stage timeline)
//   • CSV export

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import GoldSpinner from '../ui/GoldSpinner'

const fmt = (m) => m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(0) + 'm'
const fmt1 = (m) => m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(1) + 'm'
const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN')
const SC = ['#3a8fbf', '#c9a84c', '#8c5ac8', '#e58a3b', '#3aaa6a', '#e05555', '#5ec1d6']

export default function Productivity() {
  const { theme, canSee } = useApp()
  const allowed = canSee('productivity')
  const dark = theme === 'dark'
  const t = {
    card: dark ? '#1c1813' : '#ffffff', card2: dark ? '#221d16' : '#f7f3ea', border: dark ? '#332b20' : '#e7ddc8',
    text1: dark ? '#f3ead6' : '#1a140a', text2: dark ? '#cdbfa3' : '#5a4d36', text3: dark ? '#9a8d72' : '#897a5c', text4: dark ? '#6f6450' : '#a89878',
    gold: '#c9a84c', green: '#3aaa6a', blue: '#3a8fbf', red: '#e05555', purple: '#8c5ac8',
  }
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 14 }
  const th = { padding: '8px 11px', fontSize: 9.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card2, whiteSpace: 'nowrap', position: 'sticky', top: 0 }
  const td = { padding: '7px 11px', fontSize: 12, color: t.text2, borderBottom: `1px solid ${t.border}55`, whiteSpace: 'nowrap' }

  const [source, setSource] = useState('new')
  const [from, setFrom] = useState('2026-06-15')
  const [to, setTo] = useState('2026-06-30')
  const [bucket, setBucket] = useState('day')
  const [groupBy, setGroupBy] = useState('state')
  const [filters, setFilters] = useState({ state: '', region: '', branch: '', type: '', stone: '', ornaments: '', status: '', employee: '' })
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState(null)
  const [people, setPeople] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const qbase = useCallback(() => { const qs = new URLSearchParams({ from, to, source, bucket, groupBy }); Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) }); return qs }, [from, to, source, bucket, groupBy, filters])

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const r = await authedFetch(`/api/productivity?action=report&${qbase()}`)
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
    } catch (e) { setError(e.message); setData(null) }
    setLoading(false)
  }, [allowed, qbase])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (tab !== 'people' || !allowed) return
    let live = true
    authedFetch(`/api/productivity?action=people&${qbase()}`).then(r => r.json()).then(j => { if (live) setPeople(j) }).catch(() => {})
    return () => { live = false }
  }, [tab, qbase, allowed])

  const openCase = async (code) => {
    setDetail({ loading: true, code })
    try { const r = await authedFetch(`/api/productivity?action=case&code=${encodeURIComponent(code)}`); const j = await r.json(); setDetail(j.detail ? { ...j.detail } : { error: j.error || 'not found', code }) }
    catch (e) { setDetail({ error: e.message, code }) }
  }

  const reports = useMemo(() => {
    if (!data?.sources) return []
    const out = []
    if (data.sources.new) out.push({ label: 'NEW CRM', rep: data.sources.new })
    if (data.sources.old) out.push({ label: 'OLD CRM', rep: data.sources.old })
    return out
  }, [data])
  const facets = (reports[0]?.rep.facets) || {}

  const exportCsv = () => {
    const lines = []
    reports.forEach(({ label, rep }) => {
      lines.push(`# ${label} — by ${rep.groupBy}`)
      lines.push(['group', 'n', ...rep.stageMeta.map(s => s.label), 'TOTAL'].join(','))
      rep.groups.forEach(g => lines.push([g.key, g.n, ...rep.stageMeta.map(s => g.stages[s.key] ?? ''), g.medianTat ?? ''].join(',')))
      lines.push('')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `productivity_${from}_${to}.csv`; a.click()
  }

  if (!allowed) return (
    <div style={{ padding: 60, textAlign: 'center', color: t.text3 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div><div style={{ fontSize: 16, fontWeight: 700, color: t.text1 }}>Restricted</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>This module is limited to specific accounts.</div>
    </div>
  )

  const Sel = ({ label, k, opts }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{label}</span>
      <select value={filters[k]} onChange={e => setF(k, e.target.value)} style={{ background: t.card2, border: `1px solid ${filters[k] ? t.gold : t.border}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1, maxWidth: 150 }}>
        <option value="">All</option>{(opts || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
  const Pill = ({ v, label }) => (
    <button onClick={() => setSource(v)} style={{ background: source === v ? t.gold : 'transparent', color: source === v ? '#1a0a00' : t.text2, border: `1px solid ${source === v ? t.gold : t.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  )
  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{ background: tab === id ? t.card2 : 'transparent', color: tab === id ? t.gold : t.text3, borderBottom: tab === id ? `2px solid ${t.gold}` : '2px solid transparent', border: 'none', padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 14, color: t.text1 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 300, letterSpacing: '.03em' }}>Productivity</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: t.red, background: `${t.red}16`, border: `1px solid ${t.red}40`, borderRadius: 5, padding: '2px 8px' }}>🔒 RESTRICTED</span>
          </div>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4 }}>Every case · every stage · every person — NEW vs OLD CRM, fully filterable. (Region derived from state; NEW-CRM region link is unpopulated.)</div>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={exportCsv} disabled={!reports.length} style={{ background: 'transparent', color: t.text2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '7px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>⬇ CSV</button>
        </div>
      </div>

      {/* Controls */}
      <div style={{ ...card, padding: '11px 13px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Source</span>
          <div style={{ display: 'flex', gap: 6 }}><Pill v="new" label="NEW only" /><Pill v="old" label="OLD only" /><Pill v="compare" label="Compare" /></div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>From</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1 }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>To</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1 }} /></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Trend</span>
          <div style={{ display: 'flex', gap: 4 }}>{['day', 'week'].map(b => <button key={b} onClick={() => setBucket(b)} style={{ background: bucket === b ? t.blue : 'transparent', color: bucket === b ? '#fff' : t.text3, border: `1px solid ${bucket === b ? t.blue : t.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{b}</button>)}</div>
        </div>
        <button onClick={load} disabled={loading} style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{loading ? '…' : 'Run'}</button>
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: '11px 13px', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Sel label="Region" k="region" opts={facets.region} /><Sel label="State" k="state" opts={facets.state} /><Sel label="Branch" k="branch" opts={facets.branch} />
        <Sel label="Type" k="type" opts={facets.type} /><Sel label="Stone" k="stone" opts={facets.stone} /><Sel label="Ornaments" k="ornaments" opts={facets.ornaments} />
        <Sel label="Status" k="status" opts={facets.status} /><Sel label="Employee" k="employee" opts={facets.employee} />
        <button onClick={() => setFilters({ state: '', region: '', branch: '', type: '', stone: '', ornaments: '', status: '', employee: '' })} style={{ background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Clear</button>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Group by</span>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={{ background: t.card2, border: `1px solid ${t.gold}`, borderRadius: 7, padding: '5px 7px', fontSize: 11, color: t.text1, fontWeight: 700 }}>
            {['region', 'state', 'branch', 'type', 'stone', 'ornaments', 'employee', 'status'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>

      {error && <div style={{ ...card, borderColor: `${t.red}55`, background: `${t.red}10`, color: t.red, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>⚠ {error}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${t.border}` }}>
        <TabBtn id="overview" label="Overview" /><TabBtn id="trends" label="Trends" /><TabBtn id="people" label="People" />
        {source !== 'old' && <TabBtn id="stuck" label="Stuck / WIP" />}<TabBtn id="cases" label="Cases" />
      </div>

      {loading ? <div style={{ ...card, padding: 80, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div> : !reports.length ? null : (
        <div style={{ display: source === 'compare' ? 'grid' : 'block', gridTemplateColumns: source === 'compare' ? '1fr 1fr' : '1fr', gap: 14 }}>
          {reports.map(({ label, rep }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {source === 'compare' && <div style={{ fontWeight: 800, fontSize: 13, color: label.startsWith('NEW') ? t.green : t.blue, letterSpacing: '.04em' }}>{label}</div>}

              {tab === 'overview' && <Overview rep={rep} t={t} card={card} th={th} td={td} />}
              {tab === 'trends' && <Trends rep={rep} bucket={bucket} t={t} card={card} />}
              {tab === 'cases' && <Cases rep={rep} t={t} card={card} th={th} td={td} onOpen={openCase} />}
              {tab === 'stuck' && rep.wip && <Stuck rep={rep} t={t} card={card} th={th} td={td} />}
              {tab === 'people' && label.startsWith('NEW') && <People people={people} t={t} card={card} th={th} td={td} />}
              {tab === 'people' && label.startsWith('OLD') && <div style={{ ...card, padding: 20, color: t.text3, fontSize: 12 }}>People-level stage detail is NEW-CRM only (OLD CRM has no per-stage handler data).</div>}
            </div>
          ))}
        </div>
      )}

      {detail && <CaseModal detail={detail} t={t} card={card} th={th} td={td} onClose={() => setDetail(null)} />}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────
function Overview({ rep, t, card, th, td }) {
  const stageBar = useMemo(() => { const segs = rep.stageMeta.map((s, i) => ({ ...s, val: rep.stages[s.key]?.median || 0, color: SC[i % SC.length] })); const sum = segs.reduce((a, s) => a + s.val, 0) || 1; return segs.map(s => ({ ...s, pct: (s.val / sum) * 100 })) }, [rep])
  return <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10 }}>
      {[['Median TAT', fmt1(rep.kpis.medianTat), t.gold], ['Completed', num(rep.kpis.completed), t.green], ['Open (WIP)', num(rep.kpis.open), t.blue], ['Avg TAT', fmt1(rep.kpis.avgTat), t.purple], ['Slowest', fmt1(rep.kpis.slowest), t.red]].map(([l, v, c]) => (
        <div key={l} style={{ ...card, padding: '12px 14px', borderLeft: `3px solid ${c}` }}>
          <div style={{ fontSize: 9, color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800 }}>{l}</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: c, fontFamily: 'monospace', marginTop: 4 }}>{v}</div>
        </div>
      ))}
    </div>
    <div style={{ ...card, padding: '13px 15px' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Where the time goes <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· median per stage</span></div>
      <div style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', border: `1px solid ${t.border}` }}>
        {stageBar.map(s => s.pct > 0 && <div key={s.key} title={`${s.label}: ${fmt1(s.val)}`} style={{ width: `${s.pct}%`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700, overflow: 'hidden' }}>{s.pct > 8 ? fmt(s.val) : ''}</div>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 11, marginTop: 10 }}>
        {stageBar.map(s => <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} /><span style={{ color: t.text2 }}>{s.label}</span><strong style={{ color: t.text1, fontFamily: 'monospace' }}>{fmt1(s.val)}</strong></div>)}
      </div>
    </div>
    <BarChart title={`Median TAT by ${rep.groupBy}`} items={rep.groups.slice(0, 14)} t={t} card={card} />
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>By {rep.groupBy} <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· median per stage · {rep.groups.length} groups</span></div>
      <div style={{ overflowX: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{rep.groupBy}</th><th style={{ ...th, textAlign: 'right' }}>n</th>{rep.stageMeta.map(s => <th key={s.key} style={{ ...th, textAlign: 'right' }}>{s.label.split('·')[1]?.trim() || s.label}</th>)}<th style={{ ...th, textAlign: 'right', color: t.gold }}>TOTAL</th></tr></thead>
          <tbody>{rep.groups.map(g => <tr key={g.key}><td style={{ ...td, fontWeight: 700, color: t.text1, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.key}</td><td style={{ ...td, textAlign: 'right' }}>{num(g.n)}</td>{rep.stageMeta.map(s => <td key={s.key} style={{ ...td, textAlign: 'right' }}>{fmt(g.stages[s.key])}</td>)}<td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmt1(g.medianTat)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  </>
}

// ── Trends (line chart) ───────────────────────────────────────────────────────
function Trends({ rep, bucket, t, card }) {
  const d = rep.trend || []
  return <div style={{ ...card, padding: '14px 16px' }}>
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>TAT &amp; volume trend <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· per {bucket} · {d.length} points</span></div>
    <LineChart data={d} t={t} />
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ padding: '6px 9px', fontSize: 9.5, color: t.text4, textAlign: 'left', borderBottom: `1px solid ${t.border}` }}>{bucket}</th><th style={{ padding: '6px 9px', fontSize: 9.5, color: t.text4, textAlign: 'right', borderBottom: `1px solid ${t.border}` }}>Median TAT</th><th style={{ padding: '6px 9px', fontSize: 9.5, color: t.text4, textAlign: 'right', borderBottom: `1px solid ${t.border}` }}>Cases</th></tr></thead>
        <tbody>{d.map(x => <tr key={x.bucket}><td style={{ padding: '5px 9px', fontSize: 11.5, color: t.text2 }}>{x.bucket}</td><td style={{ padding: '5px 9px', fontSize: 11.5, color: t.gold, textAlign: 'right', fontWeight: 700 }}>{fmt1(x.medianTat)}</td><td style={{ padding: '5px 9px', fontSize: 11.5, color: t.text2, textAlign: 'right' }}>{num(x.n)}</td></tr>)}</tbody>
      </table>
    </div>
  </div>
}

// ── People ────────────────────────────────────────────────────────────────────
function People({ people, t, card, th, td }) {
  if (!people) return <div style={{ ...card, padding: 60, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div>
  const sm = people.stageMeta || []
  return <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>People — stage medians per employee <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· {people.people?.length || 0} people · cases-handled first</span></div>
    <div style={{ overflowX: 'auto', maxHeight: 600 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Employee</th><th style={{ ...th, textAlign: 'right' }}>Cases</th>{sm.map(s => <th key={s.key} style={{ ...th, textAlign: 'right' }}>{s.label.split('·')[1]?.trim() || s.label}</th>)}</tr></thead>
        <tbody>{(people.people || []).map(p => <tr key={p.name}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{p.name}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{num(p.cases)}</td>{sm.map(s => <td key={s.key} style={{ ...td, textAlign: 'right' }}>{p.stages[s.key] ? <span>{fmt(p.stages[s.key].median)} <span style={{ color: t.text4, fontSize: 9 }}>·{p.stages[s.key].n}</span></span> : '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>
}

// ── Stuck / WIP ───────────────────────────────────────────────────────────────
function Stuck({ rep, t, card, th, td }) {
  return <>
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Stuck by status <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· open cases</span></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Status</th><th style={th}>Waiting on</th><th style={{ ...th, textAlign: 'right' }}>Open</th><th style={{ ...th, textAlign: 'right' }}>Median age</th><th style={{ ...th, textAlign: 'right' }}>Oldest</th></tr></thead>
        <tbody>{rep.wip.map(w => <tr key={w.status}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{w.status}</td><td style={{ ...td, color: t.text3 }}>{w.owner}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{num(w.n)}</td><td style={{ ...td, textAlign: 'right' }}>{fmt(w.medianAge)}</td><td style={{ ...td, textAlign: 'right', color: t.red }}>{fmt(w.oldestAge)}</td></tr>)}</tbody>
      </table>
    </div>
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Oldest open cases</div>
      <div style={{ overflowX: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Code</th><th style={th}>Branch</th><th style={th}>State</th><th style={th}>Type</th><th style={th}>Status → waiting on</th><th style={{ ...th, textAlign: 'right' }}>Age</th></tr></thead>
          <tbody>{rep.oldestOpen.map(c => <tr key={c.code}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{c.code}</td><td style={td}>{c.branch}</td><td style={td}>{c.state}</td><td style={td}>{c.type}</td><td style={{ ...td, fontSize: 11 }}>{c.status} <span style={{ color: t.text4 }}>→ {c.owner}</span></td><td style={{ ...td, textAlign: 'right', color: t.red, fontWeight: 700 }}>{fmt(c.ageMin)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  </>
}

// ── Cases (drill-down) ────────────────────────────────────────────────────────
function Cases({ rep, t, card, th, td, onOpen }) {
  return <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Completed cases <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· slowest first · {rep.cases.length} shown · click a row for the full timeline</span></div>
    <div style={{ overflowX: 'auto', maxHeight: 600 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Code</th><th style={th}>Branch</th><th style={th}>Type</th><th style={th}>Stone</th><th style={{ ...th, textAlign: 'right' }}>Orn</th>{rep.stageMeta.map(s => <th key={s.key} style={{ ...th, textAlign: 'right' }}>{s.label.split('·')[0].trim()}</th>)}<th style={{ ...th, textAlign: 'right', color: t.gold }}>TOTAL</th></tr></thead>
        <tbody>{rep.cases.map(c => <tr key={c.code} onClick={() => onOpen(c.code)} style={{ cursor: 'pointer' }}><td style={{ ...td, fontWeight: 700, color: t.blue }}>{c.code}</td><td style={td}>{c.branch}</td><td style={td}>{c.type}</td><td style={td}>{c.stone === 'with_stone' ? 'stone' : '—'}</td><td style={{ ...td, textAlign: 'right' }}>{c.ornCnt ?? '—'}</td>{rep.stageMeta.map(s => <td key={s.key} style={{ ...td, textAlign: 'right' }}>{fmt(c.stages[s.key])}</td>)}<td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmt1(c.total)}</td></tr>)}</tbody>
      </table>
    </div>
  </div>
}

// ── Bill-level modal (full per-stage timeline) ────────────────────────────────
function CaseModal({ detail, t, card, th, td, onClose }) {
  const h = detail.header
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div onClick={e => e.stopPropagation()} style={{ ...card, maxWidth: 720, width: '100%', maxHeight: '86vh', overflow: 'auto' }}>
      <div style={{ padding: '13px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{detail.loading ? 'Loading…' : detail.error ? 'Not found' : `${h.code} · ${h.branch} · ${h.type}`}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: 20, cursor: 'pointer' }}>×</button>
      </div>
      {detail.loading ? <div style={{ padding: 50, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div>
        : detail.error ? <div style={{ padding: 20, color: t.text3 }}>{detail.error} ({detail.code})</div>
          : <>
            <div style={{ padding: '10px 16px', fontSize: 11.5, color: t.text3 }}>Opened {h.openedIst} · total <strong style={{ color: t.gold }}>{fmt1(h.total)}</strong> · {h.status} · opened by {h.openedBy}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Stage</th><th style={th}>Start</th><th style={th}>End</th><th style={{ ...th, textAlign: 'right' }}>Duration</th><th style={th}>Handled by</th></tr></thead>
              <tbody>{detail.rows.map((r, i) => <tr key={i}><td style={{ ...td, fontWeight: 600, color: t.text1 }}>{r.stage}</td><td style={td}>{r.start}</td><td style={td}>{r.end}</td><td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmt1(r.dur)}</td><td style={{ ...td, color: t.text3 }}>{r.who}</td></tr>)}</tbody>
            </table>
          </>}
    </div>
  </div>
}

// ── tiny SVG charts (no deps) ─────────────────────────────────────────────────
function LineChart({ data, t, height = 180 }) {
  if (!data?.length) return <div style={{ padding: 30, color: t.text4, fontSize: 12, textAlign: 'center' }}>No data in range.</div>
  const W = Math.max(data.length * 46, 360), H = height, pad = { l: 40, r: 12, t: 14, b: 28 }
  const ys = data.map(d => d.medianTat || 0), ymax = Math.max(...ys, 1)
  const ns = data.map(d => d.n || 0), nmax = Math.max(...ns, 1)
  const X = i => pad.l + (i * (W - pad.l - pad.r)) / Math.max(data.length - 1, 1)
  const Y = v => pad.t + (1 - v / ymax) * (H - pad.t - pad.b)
  const pts = data.map((d, i) => `${X(i)},${Y(d.medianTat || 0)}`).join(' ')
  return <div style={{ overflowX: 'auto' }}>
    <svg width={W} height={H} style={{ display: 'block' }}>
      {[0, 0.5, 1].map(f => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={Y(ymax * f)} y2={Y(ymax * f)} stroke={t.border} strokeDasharray="2 3" /><text x={4} y={Y(ymax * f) + 3} fontSize="9" fill={t.text4}>{fmt(ymax * f)}</text></g>)}
      {data.map((d, i) => { const bh = (d.n / nmax) * (H - pad.t - pad.b) * 0.5; return <rect key={i} x={X(i) - 6} y={H - pad.b - bh} width={12} height={bh} fill={t.blue} opacity={0.18} /> })}
      <polyline points={pts} fill="none" stroke={t.gold} strokeWidth={2} />
      {data.map((d, i) => <circle key={i} cx={X(i)} cy={Y(d.medianTat || 0)} r={3} fill={t.gold} />)}
      {data.map((d, i) => (i % Math.ceil(data.length / 12 || 1) === 0) && <text key={i} x={X(i)} y={H - 8} fontSize="8.5" fill={t.text4} textAnchor="middle">{d.bucket.slice(5)}</text>)}
    </svg>
  </div>
}
function BarChart({ title, items, t, card }) {
  if (!items?.length) return null
  const max = Math.max(...items.map(i => i.medianTat || 0), 1)
  return <div style={{ ...card, padding: '13px 15px' }}>
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(i => <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 120, fontSize: 11, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{i.key}</div>
        <div style={{ flex: 1, background: t.card2, borderRadius: 4, height: 16, position: 'relative' }}>
          <div style={{ width: `${((i.medianTat || 0) / max) * 100}%`, background: t.gold, height: '100%', borderRadius: 4 }} />
        </div>
        <div style={{ width: 56, fontSize: 11, color: t.text1, fontFamily: 'monospace', fontWeight: 700 }}>{fmt1(i.medianTat)}</div>
        <div style={{ width: 38, fontSize: 9.5, color: t.text4, textAlign: 'right' }}>n={i.n}</div>
      </div>)}
    </div>
  </div>
}
