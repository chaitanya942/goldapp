'use client'

// Productivity — insights & throughput, locked to a hard email allowlist
// (PAGE_EMAIL_ALLOWLIST; even super_admin blocked). Built as a FLUID pivot you
// refine one knob at a time — the controls read like a sentence:
//   "<Metric> by <Rows>, split by <Columns> — <Source> · <dates>"
// e.g. Median TAT by State, split by Stone — NEW CRM · 15→30 Jun. Change Rows to
// Branch, or Columns to none, or add a filter, or flip to Compare — nothing else
// moves. Heavy views (distribution, SLA, leaderboard) live in their own tabs so
// the screen is never crammed.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import GoldSpinner from '../ui/GoldSpinner'

const fmt = (m) => m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(0) + 'm'
const fmt1 = (m) => m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : m.toFixed(1) + 'm'
const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN')
const SC = ['#3a8fbf', '#c9a84c', '#8c5ac8', '#e58a3b', '#3aaa6a', '#e05555', '#5ec1d6']
const METRIC_LABEL = { median: 'Median TAT', avg: 'Avg TAT', count: 'Case count' }
const DIMS = ['region', 'state', 'branch', 'type', 'stone', 'ornaments', 'employee', 'status']

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
  const inp = { background: t.card2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 8px', fontSize: 11.5, color: t.text1 }

  const [source, setSource] = useState('new')
  const [from, setFrom] = useState('2026-06-15')
  const [to, setTo] = useState('2026-06-30')
  const [bucket, setBucket] = useState('day')
  const [metric, setMetric] = useState('median')
  const [groupBy, setGroupBy] = useState('state')   // Rows
  const [splitBy, setSplitBy] = useState('none')     // Columns
  const [sla, setSla] = useState(60)
  const [filters, setFilters] = useState({ state: '', region: '', branch: '', type: '', stone: '', ornaments: '', status: '', employee: '' })
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState(null)
  const [people, setPeople] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Deep-link from Branch-Employees Insights: pre-filter to one employee.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('productivity_prefilter')
      if (!raw) return
      sessionStorage.removeItem('productivity_prefilter')
      const pf = JSON.parse(raw)
      if (pf?.employee) { setSource('new'); setGroupBy('employee'); setFilters(f => ({ ...f, employee: pf.employee })); setTab('people') }
    } catch {}
  }, [])

  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const activeFilters = Object.entries(filters).filter(([, v]) => v)
  const qbase = useCallback((extra = {}) => { const qs = new URLSearchParams({ from, to, source, bucket, metric, groupBy, splitBy, sla: String(sla), ...extra }); Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) }); return qs }, [from, to, source, bucket, metric, groupBy, splitBy, sla, filters])

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setLoading(true); setError(null)
    try { const r = await authedFetch(`/api/productivity?action=report&${qbase()}`); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); setData(j) }
    catch (e) { setError(e.message); setData(null) }
    setLoading(false)
  }, [allowed, qbase])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab !== 'people' || !allowed) return; let live = true; authedFetch(`/api/productivity?action=people&${qbase()}`).then(r => r.json()).then(j => { if (live) setPeople(j) }).catch(() => {}); return () => { live = false } }, [tab, qbase, allowed])

  const openCase = async (code) => { setDetail({ loading: true, code }); try { const r = await authedFetch(`/api/productivity?action=case&code=${encodeURIComponent(code)}`); const j = await r.json(); setDetail(j.detail || { error: j.error || 'not found', code }) } catch (e) { setDetail({ error: e.message, code }) } }

  const reports = useMemo(() => { if (!data?.sources) return []; const o = []; if (data.sources.new) o.push({ label: 'NEW CRM', rep: data.sources.new }); if (data.sources.old) o.push({ label: 'OLD CRM', rep: data.sources.old }); return o }, [data])
  const facets = reports[0]?.rep.facets || {}

  const exportCsv = () => {
    const lines = []
    reports.forEach(({ label, rep }) => {
      const pv = rep.pivot
      lines.push(`# ${label} — ${METRIC_LABEL[metric]} by ${pv.groupBy}${pv.splitBy !== 'none' ? `, split by ${pv.splitBy}` : ''}`)
      lines.push([pv.groupBy, 'n', ...pv.cols.map(c => c.label), 'TOTAL'].join(','))
      pv.rows.forEach(r => lines.push([r.key, r.n, ...pv.cols.map(c => r.cells[c.key]?.val ?? ''), r.total ?? ''].join(',')))
      lines.push('')
    })
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `productivity_${from}_${to}.csv`; a.click()
  }

  if (!allowed) return <div style={{ padding: 60, textAlign: 'center', color: t.text3 }}><div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div><div style={{ fontSize: 16, fontWeight: 700, color: t.text1 }}>Restricted</div><div style={{ fontSize: 12, marginTop: 6 }}>This module is limited to specific accounts.</div></div>

  const SentSel = ({ value, onChange, opts, color }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, fontWeight: 700, color: color || t.gold, border: `1px solid ${color || t.gold}`, cursor: 'pointer' }}>
      {opts.map(o => <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>)}
    </select>
  )
  const Sel = ({ label, k, opts }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 8.5, color: t.text4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{label}</span>
      <select value={filters[k]} onChange={e => setF(k, e.target.value)} style={{ ...inp, border: `1px solid ${filters[k] ? t.gold : t.border}`, maxWidth: 150 }}><option value="">All</option>{(opts || []).map(o => <option key={o} value={o}>{o}</option>)}</select>
    </label>
  )
  const TabBtn = ({ id, label }) => <button onClick={() => setTab(id)} style={{ background: tab === id ? t.card2 : 'transparent', color: tab === id ? t.gold : t.text3, borderBottom: tab === id ? `2px solid ${t.gold}` : '2px solid transparent', border: 'none', padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  const conn = { fontSize: 13, color: t.text3, fontWeight: 500 }

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 13, color: t.text1 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 300, letterSpacing: '.03em' }}>Productivity</span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: t.red, background: `${t.red}16`, border: `1px solid ${t.red}40`, borderRadius: 5, padding: '2px 8px' }}>🔒 RESTRICTED</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {['new', 'old', 'compare'].map(v => <button key={v} onClick={() => setSource(v)} style={{ background: source === v ? t.gold : 'transparent', color: source === v ? '#1a0a00' : t.text2, border: `1px solid ${source === v ? t.gold : t.border}`, borderRadius: 8, padding: '6px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{v === 'new' ? 'NEW only' : v === 'old' ? 'OLD only' : 'Compare'}</button>)}
          <button onClick={exportCsv} disabled={!reports.length} style={{ background: 'transparent', color: t.text2, border: `1px solid ${t.border}`, borderRadius: 7, padding: '6px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>⬇ CSV</button>
        </div>
      </div>

      {/* The question — reads like a sentence */}
      <div style={{ ...card, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginRight: 2 }}>Show</span>
        <SentSel value={metric} onChange={setMetric} opts={[{ v: 'median', l: 'Median TAT' }, { v: 'avg', l: 'Avg TAT' }, { v: 'count', l: 'Case count' }]} />
        <span style={conn}>by</span>
        <SentSel value={groupBy} onChange={setGroupBy} opts={DIMS.map(d => ({ v: d, l: d }))} />
        <span style={conn}>split by</span>
        <SentSel value={splitBy} onChange={setSplitBy} color={t.purple} opts={[{ v: 'none', l: 'none' }, { v: 'stage', l: 'stage' }, ...DIMS.map(d => ({ v: d, l: d }))]} />
        <span style={{ width: 1, height: 22, background: t.border, margin: '0 4px' }} />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
        <span style={conn}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>{['day', 'week'].map(b => <button key={b} onClick={() => setBucket(b)} style={{ background: bucket === b ? t.blue : 'transparent', color: bucket === b ? '#fff' : t.text3, border: `1px solid ${bucket === b ? t.blue : t.border}`, borderRadius: 6, padding: '5px 9px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>{b}</button>)}</div>
        <button onClick={load} disabled={loading} style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: 7, padding: '6px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer', marginLeft: 'auto' }}>{loading ? '…' : 'Run'}</button>
      </div>

      {/* Filters — narrow to specific values; active ones show as chips */}
      <div style={{ ...card, padding: '10px 13px', display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: t.text4, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 800, alignSelf: 'center' }}>Filter</span>
        <Sel label="Region" k="region" opts={facets.region} /><Sel label="State" k="state" opts={facets.state} /><Sel label="Branch" k="branch" opts={facets.branch} />
        <Sel label="Type" k="type" opts={facets.type} /><Sel label="Stone" k="stone" opts={facets.stone} /><Sel label="Ornaments" k="ornaments" opts={facets.ornaments} />
        <Sel label="Status" k="status" opts={facets.status} /><Sel label="Employee" k="employee" opts={facets.employee} />
        {activeFilters.length > 0 && <button onClick={() => setFilters({ state: '', region: '', branch: '', type: '', stone: '', ornaments: '', status: '', employee: '' })} style={{ background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: 7, padding: '5px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Clear</button>}
      </div>

      {/* Plain-English echo of the current question */}
      <div style={{ fontSize: 12.5, color: t.text2 }}>
        <strong style={{ color: t.gold }}>{METRIC_LABEL[metric]}</strong> by <strong style={{ color: t.text1 }}>{groupBy}</strong>
        {splitBy !== 'none' && <> split by <strong style={{ color: t.purple }}>{splitBy}</strong></>}
        {' — '}<strong>{source === 'compare' ? 'NEW vs OLD' : source === 'new' ? 'NEW CRM' : 'OLD CRM'}</strong> · {from}→{to}
        {activeFilters.map(([k, v]) => <span key={k} style={{ marginLeft: 6, fontSize: 11, background: `${t.gold}1a`, border: `1px solid ${t.gold}55`, color: t.gold, borderRadius: 5, padding: '1px 7px' }}>{k}: {v}</span>)}
      </div>

      {error && <div style={{ ...card, borderColor: `${t.red}55`, background: `${t.red}10`, color: t.red, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>⚠ {error}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
        <TabBtn id="overview" label="Overview" /><TabBtn id="trends" label="Trends" /><TabBtn id="distribution" label="Distribution / SLA" /><TabBtn id="people" label="People leaderboard" />
        {source !== 'old' && <TabBtn id="stuck" label="Stuck / WIP" />}<TabBtn id="cases" label="Cases" />
      </div>

      {loading ? <div style={{ ...card, padding: 80, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div> : !reports.length ? null : (
        <div style={{ display: source === 'compare' ? 'grid' : 'block', gridTemplateColumns: source === 'compare' ? '1fr 1fr' : '1fr', gap: 14 }}>
          {reports.map(({ label, rep }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              {source === 'compare' && <div style={{ fontWeight: 800, fontSize: 13, color: label.startsWith('NEW') ? t.green : t.blue }}>{label}</div>}
              {tab === 'overview' && <Overview rep={rep} metric={metric} t={t} card={card} th={th} td={td} />}
              {tab === 'trends' && <Trends rep={rep} bucket={bucket} t={t} card={card} />}
              {tab === 'distribution' && <Distribution rep={rep} sla={sla} setSla={setSla} t={t} card={card} th={th} td={td} inp={inp} />}
              {tab === 'cases' && <Cases rep={rep} t={t} card={card} th={th} td={td} onOpen={openCase} />}
              {tab === 'stuck' && rep.wip && <Stuck rep={rep} t={t} card={card} th={th} td={td} />}
              {tab === 'people' && (label.startsWith('NEW') ? <People people={people} t={t} card={card} th={th} td={td} /> : <div style={{ ...card, padding: 20, color: t.text3, fontSize: 12 }}>People leaderboard is NEW-CRM only.</div>)}
            </div>
          ))}
        </div>
      )}

      {detail && <CaseModal detail={detail} t={t} card={card} th={th} td={td} onClose={() => setDetail(null)} />}
    </div>
  )
}

const cellFmt = (v, metric) => v == null ? '—' : metric === 'count' ? num(v) : fmt1(v)

// ── Overview: the pivot ───────────────────────────────────────────────────────
function Overview({ rep, metric, t, card, th, td }) {
  const pv = rep.pivot
  const stageBar = useMemo(() => { const segs = rep.stageMeta.map((s, i) => ({ ...s, val: rep.stages[s.key]?.median || 0, color: SC[i % SC.length] })); const sum = segs.reduce((a, s) => a + s.val, 0) || 1; return segs.map(s => ({ ...s, pct: (s.val / sum) * 100 })) }, [rep])
  const isStage = pv.splitBy === 'stage'
  return <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
      {[['Median TAT', fmt1(rep.kpis.medianTat), t.gold], ['Completed', num(rep.kpis.completed), t.green], ['Open (WIP)', num(rep.kpis.open), t.blue], ['Avg TAT', fmt1(rep.kpis.avgTat), t.purple], ['Slowest', fmt1(rep.kpis.slowest), t.red]].map(([l, v, c]) => (
        <div key={l} style={{ ...card, padding: '12px 14px', borderLeft: `3px solid ${c}` }}><div style={{ fontSize: 9, color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800 }}>{l}</div><div style={{ fontSize: 21, fontWeight: 700, color: c, fontFamily: 'monospace', marginTop: 4 }}>{v}</div></div>
      ))}
    </div>
    <div style={{ ...card, padding: '13px 15px' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Where the time goes <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· median per stage (overall)</span></div>
      <div style={{ display: 'flex', height: 24, borderRadius: 7, overflow: 'hidden', border: `1px solid ${t.border}` }}>{stageBar.map(s => s.pct > 0 && <div key={s.key} title={`${s.label}: ${fmt1(s.val)}`} style={{ width: `${s.pct}%`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700 }}>{s.pct > 8 ? fmt(s.val) : ''}</div>)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 9 }}>{stageBar.map(s => <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} /><span style={{ color: t.text2 }}>{s.label}</span><strong style={{ color: t.text1, fontFamily: 'monospace' }}>{fmt1(s.val)}</strong></div>)}</div>
    </div>
    {pv.splitBy === 'none' && <BarChart title={`${METRIC_LABEL[metric]} by ${pv.groupBy}`} rows={pv.rows.slice(0, 14)} metric={metric} t={t} card={card} />}
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>{METRIC_LABEL[metric]} by {pv.groupBy}{pv.splitBy !== 'none' && <> <span style={{ color: t.purple }}>× {pv.splitBy}</span></>} <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· {pv.rows.length} rows</span></div>
      <div style={{ overflowX: 'auto', maxHeight: 460 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>{pv.groupBy}</th><th style={{ ...th, textAlign: 'right' }}>n</th>
            {pv.cols.map(c => <th key={c.key} style={{ ...th, textAlign: 'right' }}>{c.label}</th>)}
            <th style={{ ...th, textAlign: 'right', color: t.gold }}>{pv.splitBy === 'none' ? METRIC_LABEL[metric] : 'TOTAL'}</th>
          </tr></thead>
          <tbody>{pv.rows.map(r => (
            <tr key={r.key}>
              <td style={{ ...td, fontWeight: 700, color: t.text1, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.key}</td>
              <td style={{ ...td, textAlign: 'right' }}>{num(r.n)}</td>
              {pv.cols.map(c => <td key={c.key} style={{ ...td, textAlign: 'right' }}>{isStage ? fmt(r.cells[c.key]?.val) : <span>{cellFmt(r.cells[c.key]?.val, metric)} {r.cells[c.key]?.n != null && <span style={{ color: t.text4, fontSize: 9 }}>·{r.cells[c.key].n}</span>}</span>}</td>)}
              <td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{cellFmt(r.total, metric)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  </>
}

// ── Trends ────────────────────────────────────────────────────────────────────
function Trends({ rep, bucket, t, card }) {
  const d = rep.trend || []
  return <div style={{ ...card, padding: '14px 16px' }}>
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>TAT &amp; volume trend <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· per {bucket} · {d.length} points</span></div>
    <LineChart data={d} t={t} />
  </div>
}

// ── Distribution + SLA ────────────────────────────────────────────────────────
function Distribution({ rep, sla, setSla, t, card, th, td, inp }) {
  const h = rep.histogram || []
  const max = Math.max(...h.map(b => b.count), 1)
  const s = rep.sla
  return <>
    <div style={{ ...card, padding: '14px 16px' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>TAT distribution <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· how long cases actually take</span></div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150 }}>
        {h.map(b => <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <div style={{ fontSize: 11, color: t.text1, fontWeight: 700 }}>{b.count}</div>
          <div style={{ width: '70%', height: `${(b.count / max) * 110}px`, background: t.blue, borderRadius: '4px 4px 0 0' }} />
          <div style={{ fontSize: 10, color: t.text3 }}>{b.label}</div>
        </div>)}
      </div>
    </div>
    <div style={{ ...card, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>SLA breach</div>
        <span style={{ fontSize: 11.5, color: t.text3 }}>target ≤</span>
        <input type="number" value={sla} onChange={e => setSla(Math.max(0, +e.target.value || 0))} style={{ ...inp, width: 70 }} />
        <span style={{ fontSize: 11.5, color: t.text3 }}>minutes</span>
        {s && <span style={{ marginLeft: 'auto', fontSize: 13 }}><strong style={{ color: s.pct > 30 ? t.red : t.green, fontSize: 20, fontFamily: 'monospace' }}>{s.pct}%</strong> <span style={{ color: t.text3 }}>breached ({num(s.breached)}/{num(s.n)})</span></span>}
      </div>
      {s && <div style={{ overflowX: 'auto', maxHeight: 360, marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{rep.pivot.groupBy}</th><th style={{ ...th, textAlign: 'right' }}>n</th><th style={{ ...th, textAlign: 'right' }}>Breached</th><th style={{ ...th, textAlign: 'right' }}>% over SLA</th></tr></thead>
          <tbody>{s.byGroup.map(g => <tr key={g.key}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{g.key}</td><td style={{ ...td, textAlign: 'right' }}>{num(g.n)}</td><td style={{ ...td, textAlign: 'right' }}>{num(g.breached)}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700, color: g.pct > 30 ? t.red : g.pct > 10 ? t.gold : t.green }}>{g.pct}%</td></tr>)}</tbody>
        </table>
      </div>}
    </div>
  </>
}

// ── People leaderboard (sortable) ─────────────────────────────────────────────
function People({ people, t, card, th, td }) {
  const [sortKey, setSortKey] = useState('cases')
  if (!people) return <div style={{ ...card, padding: 60, display: 'flex', justifyContent: 'center' }}><GoldSpinner size={28} /></div>
  const sm = people.stageMeta || []
  const rows = [...(people.people || [])].sort((a, b) => sortKey === 'cases' ? b.cases - a.cases : ((a.stages[sortKey]?.median ?? 1e9) - (b.stages[sortKey]?.median ?? 1e9)))
  const Hd = ({ k, label, right }) => <th onClick={() => setSortKey(k)} style={{ ...th, textAlign: right ? 'right' : 'left', cursor: 'pointer', color: sortKey === k ? t.gold : t.text4 }}>{label}{sortKey === k ? ' ▾' : ''}</th>
  return <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>People leaderboard <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· {rows.length} people · click a stage to rank by it (fastest first)</span></div>
    <div style={{ overflowX: 'auto', maxHeight: 600 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Employee</th><Hd k="cases" label="Cases" right /> {sm.map(s => <Hd key={s.key} k={s.key} label={s.label.split('·')[1]?.trim() || s.label} right />)}</tr></thead>
        <tbody>{rows.map(p => <tr key={p.name}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{p.name}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{num(p.cases)}</td>{sm.map(s => <td key={s.key} style={{ ...td, textAlign: 'right', color: sortKey === s.key ? t.gold : t.text2 }}>{p.stages[s.key] ? <span>{fmt(p.stages[s.key].median)} <span style={{ color: t.text4, fontSize: 9 }}>·{p.stages[s.key].n}</span></span> : '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>
}

// ── Stuck / WIP ───────────────────────────────────────────────────────────────
function Stuck({ rep, t, card, th, td }) {
  return <>
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Stuck by status <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· open cases</span></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Status</th><th style={th}>Waiting on</th><th style={{ ...th, textAlign: 'right' }}>Open</th><th style={{ ...th, textAlign: 'right' }}>Median age</th><th style={{ ...th, textAlign: 'right' }}>Oldest</th></tr></thead>
        <tbody>{rep.wip.map(w => <tr key={w.status}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{w.status}</td><td style={{ ...td, color: t.text3 }}>{w.owner}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{num(w.n)}</td><td style={{ ...td, textAlign: 'right' }}>{fmt(w.medianAge)}</td><td style={{ ...td, textAlign: 'right', color: t.red }}>{fmt(w.oldestAge)}</td></tr>)}</tbody></table>
    </div>
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Oldest open cases</div>
      <div style={{ overflowX: 'auto', maxHeight: 420 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Code</th><th style={th}>Branch</th><th style={th}>State</th><th style={th}>Type</th><th style={th}>Status → waiting on</th><th style={{ ...th, textAlign: 'right' }}>Age</th></tr></thead>
        <tbody>{rep.oldestOpen.map(c => <tr key={c.code}><td style={{ ...td, fontWeight: 700, color: t.text1 }}>{c.code}</td><td style={td}>{c.branch}</td><td style={td}>{c.state}</td><td style={td}>{c.type}</td><td style={{ ...td, fontSize: 11 }}>{c.status} <span style={{ color: t.text4 }}>→ {c.owner}</span></td><td style={{ ...td, textAlign: 'right', color: t.red, fontWeight: 700 }}>{fmt(c.ageMin)}</td></tr>)}</tbody></table></div>
    </div>
  </>
}

// ── Cases (drill-down → bill-level) ───────────────────────────────────────────
function Cases({ rep, t, card, th, td, onOpen }) {
  return <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${t.border}` }}>Completed cases <span style={{ color: t.text4, fontWeight: 500, fontSize: 11 }}>· slowest first · {rep.cases.length} shown · click a row → full timeline</span></div>
    <div style={{ overflowX: 'auto', maxHeight: 600 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Code</th><th style={th}>Branch</th><th style={th}>Type</th><th style={th}>Stone</th><th style={{ ...th, textAlign: 'right' }}>Orn</th>{rep.stageMeta.map(s => <th key={s.key} style={{ ...th, textAlign: 'right' }}>{s.label.split('·')[0].trim()}</th>)}<th style={{ ...th, textAlign: 'right', color: t.gold }}>TOTAL</th></tr></thead>
        <tbody>{rep.cases.map(c => <tr key={c.code} onClick={() => onOpen(c.code)} style={{ cursor: 'pointer' }}><td style={{ ...td, fontWeight: 700, color: t.blue }}>{c.code}</td><td style={td}>{c.branch}</td><td style={td}>{c.type}</td><td style={td}>{c.stone === 'with_stone' ? 'stone' : '—'}</td><td style={{ ...td, textAlign: 'right' }}>{c.ornCnt ?? '—'}</td>{rep.stageMeta.map(s => <td key={s.key} style={{ ...td, textAlign: 'right' }}>{fmt(c.stages[s.key])}</td>)}<td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmt1(c.total)}</td></tr>)}</tbody>
      </table>
    </div>
  </div>
}

// ── Bill-level modal ──────────────────────────────────────────────────────────
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
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Stage</th><th style={th}>Start</th><th style={th}>End</th><th style={{ ...th, textAlign: 'right' }}>Duration</th><th style={th}>Handled by</th></tr></thead>
              <tbody>{detail.rows.map((r, i) => <tr key={i}><td style={{ ...td, fontWeight: 600, color: t.text1 }}>{r.stage}</td><td style={td}>{r.start}</td><td style={td}>{r.end}</td><td style={{ ...td, textAlign: 'right', color: t.gold, fontWeight: 700 }}>{fmt1(r.dur)}</td><td style={{ ...td, color: t.text3 }}>{r.who}</td></tr>)}</tbody></table>
          </>}
    </div>
  </div>
}

// ── tiny SVG charts ───────────────────────────────────────────────────────────
function LineChart({ data, t, height = 180 }) {
  if (!data?.length) return <div style={{ padding: 30, color: t.text4, fontSize: 12, textAlign: 'center' }}>No data in range.</div>
  const W = Math.max(data.length * 46, 360), H = height, pad = { l: 40, r: 12, t: 14, b: 28 }
  const ys = data.map(d => d.medianTat || 0), ymax = Math.max(...ys, 1), nmax = Math.max(...data.map(d => d.n || 0), 1)
  const X = i => pad.l + (i * (W - pad.l - pad.r)) / Math.max(data.length - 1, 1)
  const Y = v => pad.t + (1 - v / ymax) * (H - pad.t - pad.b)
  return <div style={{ overflowX: 'auto' }}><svg width={W} height={H} style={{ display: 'block' }}>
    {[0, 0.5, 1].map(f => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={Y(ymax * f)} y2={Y(ymax * f)} stroke={t.border} strokeDasharray="2 3" /><text x={4} y={Y(ymax * f) + 3} fontSize="9" fill={t.text4}>{fmt(ymax * f)}</text></g>)}
    {data.map((d, i) => { const bh = (d.n / nmax) * (H - pad.t - pad.b) * 0.5; return <rect key={i} x={X(i) - 6} y={H - pad.b - bh} width={12} height={bh} fill={t.blue} opacity={0.18} /> })}
    <polyline points={data.map((d, i) => `${X(i)},${Y(d.medianTat || 0)}`).join(' ')} fill="none" stroke={t.gold} strokeWidth={2} />
    {data.map((d, i) => <circle key={i} cx={X(i)} cy={Y(d.medianTat || 0)} r={3} fill={t.gold} />)}
    {data.map((d, i) => (i % Math.ceil(data.length / 12 || 1) === 0) && <text key={i} x={X(i)} y={H - 8} fontSize="8.5" fill={t.text4} textAnchor="middle">{d.bucket.slice(5)}</text>)}
  </svg></div>
}
function BarChart({ title, rows, metric, t, card }) {
  if (!rows?.length) return null
  const max = Math.max(...rows.map(i => i.total || 0), 1)
  return <div style={{ ...card, padding: '13px 15px' }}>
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(i => <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 120, fontSize: 11, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{i.key}</div>
        <div style={{ flex: 1, background: t.card2, borderRadius: 4, height: 16 }}><div style={{ width: `${((i.total || 0) / max) * 100}%`, background: t.gold, height: '100%', borderRadius: 4 }} /></div>
        <div style={{ width: 60, fontSize: 11, color: t.text1, fontFamily: 'monospace', fontWeight: 700 }}>{cellFmt(i.total, metric)}</div>
        <div style={{ width: 38, fontSize: 9.5, color: t.text4, textAlign: 'right' }}>n={i.n}</div>
      </div>)}
    </div>
  </div>
}
