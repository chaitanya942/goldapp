'use client'

// ConsignmentReport — in-flight stock view + analytics.
//
// Mirrors Branch Stock Overview's structure but for bills CURRENTLY IN A CONSIGNMENT.
// "In-flight" = consignments that have been approved by accounts and dispatched
// (EXTERNAL: bills are physically moving to HO; INTERNAL: bills auto-flipped to
// dest_branch on creation, so for the purposes of this report INTERNAL completed
// transfers also show as "settled at hub" not "in flight").

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtINR = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0

// "In flight" — visible in this report. We exclude:
//   - 'cancelled' (voided / rejected — separate view)
//   - 'received' (closed — bills already at HO; future Inventory Audit will track these)
// We KEEP 'dispatched'. Approved + dispatched = the bills you should see in transit.
const isInFlight = (c) => c.status === 'dispatched' && c.approval_status === 'approved'

const REGION_COLOR = {
  'Andhra Pradesh':    '#5ec1d6',
  'Kerala':            '#3aaa6a',
  'Telangana':         '#c9a84c',
  'Tamil Nadu':        '#e58a3b',
  'Rest of Karnataka': '#9275d5',
  'Bangalore':         '#e05555',
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ConsignmentReport() {
  const { theme } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

  const [consignments,   setConsignments]   = useState([])
  const [branches,       setBranches]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [filterRegion,   setFilterRegion]   = useState('')
  const [filterType,     setFilterType]     = useState('')
  const [filterBranch,   setFilterBranch]   = useState('')
  const [search,         setSearch]         = useState('')
  const [drillId,        setDrillId]        = useState(null)
  const [drillDetail,    setDrillDetail]    = useState(null)
  const [drillLoading,   setDrillLoading]   = useState(false)
  const [downloading,    setDownloading]    = useState(null)
  const [toast,          setToast]          = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const [cR, bR] = await Promise.all([
        authedFetch('/api/consignments?action=consignments'),
        authedFetch('/api/consignments?action=branches'),
      ])
      const cJ = await cR.json()
      const bJ = await bR.json()
      setConsignments((cJ.data || []).filter(isInFlight))
      setBranches(bJ.data || [])
    } catch (e) {
      setToast({ msg: e.message || 'Load failed', type: 'error' })
    }
    setLoading(false)
  }

  async function openDrill(id) {
    setDrillId(id); setDrillLoading(true); setDrillDetail(null)
    try {
      const r = await authedFetch(`/api/consignments?action=consignment_detail&id=${id}`)
      const j = await r.json()
      setDrillDetail(j.data)
    } catch (e) {
      setToast({ msg: 'Failed to load detail', type: 'error' })
    }
    setDrillLoading(false)
  }

  async function downloadDoc(type, id, label) {
    setDownloading(`${type}:${id}`)
    const url = type === 'report'  ? `/api/generate-consignee-report?id=${id}`
              : type === 'voucher' ? `/api/generate-issue-voucher-pdf?id=${id}`
              : type === 'challan' ? `/api/generate-challan-pdf?id=${id}`
              : type === 'ewb'     ? `/api/eway-bill/pdf?id=${id}`
              :                      `/api/e-invoice/pdf?id=${id}`
    try {
      const res = await authedFetch(url)
      if (!res.ok) {
        let msg = `Download failed: ${res.status}`
        try { const j = await res.json(); msg = j.error || msg } catch {}
        setToast({ msg, type: 'error' })
      } else {
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${label}.${type === 'report' ? 'jpg' : 'pdf'}`
        a.click()
        URL.revokeObjectURL(a.href)
      }
    } catch (e) {
      setToast({ msg: e.message, type: 'error' })
    }
    setDownloading(null)
  }

  const branchByName = useMemo(() => {
    const m = {}
    branches.forEach(b => { m[b.name] = b })
    return m
  }, [branches])

  // ── Filters ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => consignments.filter(c => {
    if (filterRegion) {
      const br = branchByName[c.branch_name]
      if (br?.region !== filterRegion) return false
    }
    if (filterType   && c.movement_type !== filterType) return false
    if (filterBranch && c.branch_name   !== filterBranch) return false
    if (search) {
      const q = search.toLowerCase()
      if (![c.tmp_prf_no, c.challan_no, c.branch_name, c.dest_branch].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  }), [consignments, filterRegion, filterType, filterBranch, search, branchByName])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpiBills = filtered.reduce((s, c) => s + (c.total_bills    || 0), 0)
  const kpiGross = filtered.reduce((s, c) => s + parseFloat(c.total_gross_wt || c.total_net_wt || 0), 0)
  const kpiValue = filtered.reduce((s, c) => s + parseFloat(c.total_amount   || 0), 0)
  const oldestDays = filtered.length
    ? Math.max(...filtered.map(c => daysSince(c.dispatched_at || c.created_at)))
    : 0

  // ── Region pills ───────────────────────────────────────────────────────────
  const regions = useMemo(() => {
    const r = {}
    filtered.forEach(c => {
      const region = branchByName[c.branch_name]?.region || 'Unknown'
      if (!r[region]) r[region] = { region, bills: 0, gross: 0, value: 0, consignments: 0 }
      r[region].bills        += c.total_bills    || 0
      r[region].gross        += parseFloat(c.total_gross_wt || c.total_net_wt || 0)
      r[region].value        += parseFloat(c.total_amount   || 0)
      r[region].consignments += 1
    })
    return Object.values(r).sort((a, b) => b.value - a.value)
  }, [filtered, branchByName])

  // ── Per-branch table ───────────────────────────────────────────────────────
  const byBranch = useMemo(() => {
    const m = {}
    filtered.forEach(c => {
      const key = c.branch_name
      if (!m[key]) {
        m[key] = {
          branch:    c.branch_name,
          region:    branchByName[c.branch_name]?.region || '—',
          consignments: 0, bills: 0, gross: 0, value: 0,
          oldestDispatchedAt: null,
          movementTypes: new Set(),
        }
      }
      m[key].consignments += 1
      m[key].bills += c.total_bills || 0
      m[key].gross += parseFloat(c.total_gross_wt || c.total_net_wt || 0)
      m[key].value += parseFloat(c.total_amount   || 0)
      m[key].movementTypes.add(c.movement_type)
      const dt = c.dispatched_at || c.created_at
      if (!m[key].oldestDispatchedAt || new Date(dt) < new Date(m[key].oldestDispatchedAt)) {
        m[key].oldestDispatchedAt = dt
      }
    })
    return Object.values(m).sort((a, b) => b.value - a.value)
  }, [filtered, branchByName])

  // ── Aging buckets (insight: how long bills have been in transit) ───────────
  const agingData = useMemo(() => {
    const buckets = [
      { name: '0-1 days',   count: 0, color: '#3aaa6a' },
      { name: '2-3 days',   count: 0, color: '#c9a84c' },
      { name: '4-7 days',   count: 0, color: '#e58a3b' },
      { name: '8+ days',    count: 0, color: '#e05555' },
    ]
    filtered.forEach(c => {
      const d = daysSince(c.dispatched_at || c.created_at)
      if      (d <= 1) buckets[0].count++
      else if (d <= 3) buckets[1].count++
      else if (d <= 7) buckets[2].count++
      else             buckets[3].count++
    })
    return buckets
  }, [filtered])

  // ── Movement type split ────────────────────────────────────────────────────
  const movementData = useMemo(() => {
    const counts = { INTERNAL: 0, EXTERNAL: 0 }
    filtered.forEach(c => { counts[c.movement_type] = (counts[c.movement_type] || 0) + 1 })
    return [
      { name: 'Direct → HO',  value: counts.EXTERNAL || 0, color: t.gold },
      { name: 'Branch → Hub', value: counts.INTERNAL || 0, color: '#5ec1d6' },
    ].filter(d => d.value > 0)
  }, [filtered, t])

  // ── Daily dispatch trend (last 30 days) ───────────────────────────────────
  const trendData = useMemo(() => {
    const map = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      map[key] = { date: key, label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), consignments: 0, gross: 0 }
    }
    filtered.forEach(c => {
      const key = (c.dispatched_at || c.created_at || '').slice(0, 10)
      if (map[key]) {
        map[key].consignments += 1
        map[key].gross += parseFloat(c.total_gross_wt || c.total_net_wt || 0)
      }
    })
    return Object.values(map)
  }, [filtered])

  // ── Insights strip (auto-generated bullets) ────────────────────────────────
  const insights = useMemo(() => {
    const out = []
    if (!filtered.length) return out

    const topBranch = byBranch[0]
    if (topBranch) out.push(`${topBranch.branch} has the highest in-flight value: ${fmtINR(topBranch.value)} across ${topBranch.consignments} consignment${topBranch.consignments !== 1 ? 's' : ''}.`)

    const stale = filtered.filter(c => daysSince(c.dispatched_at || c.created_at) > 3)
    if (stale.length) out.push(`${stale.length} consignment${stale.length !== 1 ? 's' : ''} dispatched more than 3 days ago — review with logistics.`)

    const internal = filtered.filter(c => c.movement_type === 'INTERNAL').length
    const external = filtered.length - internal
    if (filtered.length > 0) {
      const pct = Math.round((external / filtered.length) * 100)
      out.push(`${pct}% of in-flight consignments are Direct → HO (${external}); the rest are Branch → Hub transfers (${internal}).`)
    }
    return out
  }, [filtered, byBranch])

  // ── Styles ────────────────────────────────────────────────────────────────
  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '11px' }
  const btnOut = { background: 'transparent', color: t.text2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 14px', fontSize: '11px', cursor: 'pointer', letterSpacing: '.04em' }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><GoldSpinner /></div>

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>Consignment Report</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            {filtered.length} in-flight consignment{filtered.length !== 1 ? 's' : ''} · stock currently in transit
          </div>
        </div>
        <button onClick={fetchAll} style={btnOut}>⟳ Refresh</button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '1px', background: t.border, borderRadius: '11px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
        <Kpi label="Bills In Flight"      value={fmt(kpiBills)}    sub="across consignments" color={t.gold}   t={t} />
        <Kpi label="Gross Weight"         value={fmtWt(kpiGross)}  sub="in transit"          color={t.blue}   t={t} />
        <Kpi label="Total Value"          value={fmtINR(kpiValue)} sub="in transit"          color={t.green}  t={t} />
        <Kpi label="Oldest in Flight"     value={`${oldestDays} day${oldestDays !== 1 ? 's' : ''}`} sub={oldestDays > 3 ? 'check with logistics' : 'within window'} color={oldestDays > 3 ? t.red : t.text2} t={t} />
      </div>

      {/* Region pills (clickable filter) */}
      {regions.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <RegionPill
            label="ALL"
            bills={kpiBills}
            gross={kpiGross}
            value={kpiValue}
            color={t.gold}
            active={!filterRegion}
            onClick={() => setFilterRegion('')}
            t={t}
          />
          {regions.map(r => (
            <RegionPill
              key={r.region}
              label={r.region.toUpperCase()}
              bills={r.bills}
              gross={r.gross}
              value={r.value}
              color={REGION_COLOR[r.region] || t.gold}
              active={filterRegion === r.region}
              onClick={() => setFilterRegion(filterRegion === r.region ? '' : r.region)}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div style={{ ...card, padding: '14px 18px' }}>
          <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>Insights</div>
          {insights.map((s, i) => (
            <div key={i} style={{ fontSize: '12px', color: t.text2, marginBottom: '4px' }}>· {s}</div>
          ))}
        </div>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '14px' }}>
        <ChartCard title="Aging — days in transit" t={t}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agingData}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
              <XAxis dataKey="name" tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} />
              <YAxis allowDecimals={false} tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} />
              <Tooltip contentStyle={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, color: t.text1, fontSize: 12 }} />
              <Bar dataKey="count" name="Consignments" radius={[4, 4, 0, 0]}>
                {agingData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Movement type split" t={t}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={movementData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {movementData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, color: t.text1, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: t.text3 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="By region — bills in flight" t={t}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={regions} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} />
              <YAxis type="category" dataKey="region" tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} width={120} />
              <Tooltip contentStyle={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, color: t.text1, fontSize: 12 }} />
              <Bar dataKey="bills" name="Bills" radius={[0, 4, 4, 0]}>
                {regions.map((e, i) => <Cell key={i} fill={REGION_COLOR[e.region] || t.gold} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Daily dispatch trend (last 30 days)" t={t}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
              <XAxis dataKey="label" tick={{ fill: t.text3, fontSize: 10 }} stroke={t.border} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fill: t.text3, fontSize: 11 }} stroke={t.border} />
              <Tooltip contentStyle={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, color: t.text1, fontSize: 12 }} />
              <Line type="monotone" dataKey="consignments" name="Consignments" stroke={t.gold} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search PRF / challan / branch…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '8px 14px', color: t.text1, fontSize: '12px', width: '260px', outline: 'none' }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '8px 12px', color: t.text1, fontSize: '12px', outline: 'none' }}>
          <option value="">All movement types</option>
          <option value="EXTERNAL">Direct → HO</option>
          <option value="INTERNAL">Branch → Hub</option>
        </select>
        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
          style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '8px 12px', color: t.text1, fontSize: '12px', outline: 'none', maxWidth: '200px' }}>
          <option value="">All branches</option>
          {[...new Set(consignments.map(c => c.branch_name))].sort().map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        {(search || filterType || filterBranch || filterRegion) && (
          <button onClick={() => { setSearch(''); setFilterType(''); setFilterBranch(''); setFilterRegion('') }}
            style={{ ...btnOut, color: t.gold, borderColor: `${t.gold}40` }}>Clear filters</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: t.text3 }}>
          {byBranch.length} branch{byBranch.length !== 1 ? 'es' : ''} · {filtered.length} consignment{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Per-branch table */}
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Branch', 'Region', 'Consignments', 'Bills', 'Gross Wt', 'Value', 'Oldest', 'Type'].map(h =>
                <th key={h} style={{ padding: '11px 14px', fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Branch' || h === 'Region' || h === 'Type' ? 'left' : 'right', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {byBranch.map(r => {
              const oldDays = daysSince(r.oldestDispatchedAt)
              const oldColor = oldDays > 7 ? t.red : oldDays > 3 ? t.orange : t.text2
              return (
                <tr key={r.branch} style={{ borderBottom: `1px solid ${t.border}20` }}>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, fontWeight: 600 }}>{r.branch}</td>
                  <td style={{ padding: '11px 14px', fontSize: '11px', color: REGION_COLOR[r.region] || t.text3 }}>{r.region}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{r.consignments}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{fmt(r.bills)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: t.gold, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtWt(r.gross)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>{fmtINR(r.value)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '11px', color: oldColor, textAlign: 'right' }}>{oldDays}d</td>
                  <td style={{ padding: '11px 14px', fontSize: '10px', color: t.text3 }}>
                    {[...r.movementTypes].map(mt => mt === 'INTERNAL' ? 'Hub' : 'HO').join(' + ')}
                  </td>
                </tr>
              )
            })}
            {byBranch.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No in-flight consignments match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Consignment-level table for drill-down */}
      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>Individual consignments</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['PRF #', 'Type', 'Source', 'Destination', 'Bills', 'Gross', 'Value', 'Dispatched', 'Docs'].map(h =>
                <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Bills' || h === 'Gross' || h === 'Value' ? 'right' : 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const isInternal = c.movement_type === 'INTERNAL'
              return (
                <tr key={c.id} style={{ borderBottom: `1px solid ${t.border}20`, cursor: 'pointer' }}
                  onClick={() => openDrill(c.id)}>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{c.tmp_prf_no}</td>
                  <td style={{ padding: '10px 14px', fontSize: '10px', color: isInternal ? '#5ec1d6' : t.gold, background: 'transparent' }}>
                    <span style={{ background: `${isInternal ? '#5ec1d6' : t.gold}15`, padding: '2px 8px', borderRadius: 4 }}>{isInternal ? 'Via Hub' : 'Direct → HO'}</span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text1 }}>{c.branch_name}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text2 }}>{isInternal ? c.dest_branch : 'Head Office'}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: t.text2, textAlign: 'right' }}>{c.total_bills}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: t.gold, fontFamily: 'monospace', textAlign: 'right' }}>{fmtWt(c.total_gross_wt || c.total_net_wt)}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: t.blue, fontFamily: 'monospace', textAlign: 'right' }}>{fmtINR(c.total_amount)}</td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: t.text3 }}>{fmtDate(c.dispatched_at)}</td>
                  <td style={{ padding: '10px 14px', fontSize: '10px', display: 'flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => downloadDoc('report', c.id, `Report-${c.tmp_prf_no}`)} disabled={downloading === `report:${c.id}`}
                      style={{ background: 'transparent', border: `1px solid ${t.border}`, color: t.text2, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>Report</button>
                    {isInternal
                      ? <button onClick={() => downloadDoc('voucher', c.id, `Voucher-${c.tmp_prf_no}`)} disabled={downloading === `voucher:${c.id}`}
                          style={{ background: 'transparent', border: `1px solid ${t.border}`, color: t.text2, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>Voucher</button>
                      : <button onClick={() => downloadDoc('challan', c.id, `Challan-${c.tmp_prf_no}`)} disabled={downloading === `challan:${c.id}`}
                          style={{ background: 'transparent', border: `1px solid ${t.border}`, color: t.text2, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>Challan</button>}
                    {c.eway_bill_no && <button onClick={() => downloadDoc('ewb', c.id, `EWB-${c.eway_bill_no}`)} disabled={downloading === `ewb:${c.id}`}
                      style={{ background: 'transparent', border: `1px solid ${t.gold}50`, color: t.gold, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>EWB</button>}
                    {c.irn && <button onClick={() => downloadDoc('einvoice', c.id, `IRN-${c.irn}`)} disabled={downloading === `einvoice:${c.id}`}
                      style={{ background: 'transparent', border: `1px solid ${t.gold}50`, color: t.gold, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>IRN</button>}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No consignments match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drill-down drawer */}
      {drillId && (
        <DrillDrawer
          consignment={consignments.find(c => c.id === drillId)}
          detail={drillDetail}
          loading={drillLoading}
          onClose={() => { setDrillId(null); setDrillDetail(null) }}
          t={t}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────
function Kpi({ label, value, sub, color, t }) {
  return (
    <div style={{ background: t.card, padding: '15px 18px' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '7px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 300, color, lineHeight: 1, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '5px' }}>{sub}</div>}
    </div>
  )
}

function RegionPill({ label, bills, gross, value, color, active, onClick, t }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? `${color}15` : t.card,
        border: `1px solid ${active ? color : t.border}`,
        borderRadius: '11px',
        padding: '14px 18px',
        cursor: 'pointer',
        textAlign: 'left',
        minWidth: '180px',
        transition: 'all .15s',
      }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 300, color, fontFamily: 'monospace', marginTop: '6px' }}>{fmtWt(gross)}</div>
      <div style={{ fontSize: '10px', color: t.text3, marginTop: '4px' }}>{bills} bill{bills !== 1 ? 's' : ''} · {fmtINR(value)}</div>
    </button>
  )
}

function ChartCard({ title, t, children }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '11px', padding: '16px 18px' }}>
      <div style={{ fontSize: '10px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  )
}

function DrillDrawer({ consignment, detail, loading, onClose, t }) {
  if (!consignment) return null
  const items = detail?.items || []
  const isInternal = consignment.movement_type === 'INTERNAL'

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', justifyContent: 'flex-end', zIndex: 2000 }}>
      <div style={{ width: '640px', maxWidth: '95vw', height: '100vh', background: t.card, borderLeft: `1px solid ${t.border}`, boxShadow: '-12px 0 40px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '14px', color: t.gold, fontWeight: 600, fontFamily: 'monospace' }}>{consignment.tmp_prf_no}</div>
            <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
              {consignment.branch_name} → {isInternal ? consignment.dest_branch : 'Head Office'}
            </div>
            <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>
              {fmtDate(consignment.dispatched_at)} · {consignment.total_bills} bills · {fmtWt(consignment.total_gross_wt || consignment.total_net_wt)} · {fmtINR(consignment.total_amount)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: '18px', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ textAlign: 'center', padding: 40, color: t.text3, fontSize: 12 }}>Loading bills…</div>}
          {!loading && items.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: `${t.border}20` }}>
                  {['Bill', 'Customer', 'Date', 'Gross', 'Net', 'Value'].map(h =>
                    <th key={h} style={{ padding: '8px 14px', fontSize: '9px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: h === 'Gross' || h === 'Net' || h === 'Value' ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  // Snapshot fields are authoritative; live purchase is fallback for legacy rows.
                  const bill   = it.bill_no_snap        ?? it.purchase?.sl_no        ?? '—'
                  const cust   = it.customer_name_snap  ?? it.purchase?.customer_name ?? '—'
                  const date   = it.purchase_date_snap  ?? it.purchase?.purchase_date
                  const gross  = it.gross_weight_snap   ?? it.purchase?.gross_weight
                  const net    = it.net_weight_snap     ?? it.purchase?.net_weight
                  const amount = it.total_amount_snap   ?? it.purchase?.total_amount
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${t.border}20` }}>
                      <td style={{ padding: '8px 14px', fontSize: '11px', color: t.text2, fontFamily: 'monospace' }}>{bill}</td>
                      <td style={{ padding: '8px 14px', fontSize: '11px', color: t.text1 }}>{cust}</td>
                      <td style={{ padding: '8px 14px', fontSize: '11px', color: t.text3 }}>{fmtDate(date)}</td>
                      <td style={{ padding: '8px 14px', fontSize: '11px', color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(gross)}</td>
                      <td style={{ padding: '8px 14px', fontSize: '11px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>{fmtWt(net)}</td>
                      <td style={{ padding: '8px 14px', fontSize: '11px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>{fmtINR(amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {!loading && items.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: t.text4, fontSize: 12 }}>No bill items returned for this consignment.</div>
          )}
        </div>
      </div>
    </div>
  )
}
