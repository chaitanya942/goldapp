'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e0d9cc', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const REGION_COLORS = {
  'Rest of Karnataka': '#c9a84c',
  'Andhra Pradesh':    '#3a8fbf',
  'Telangana':         '#8c5ac8',
  'Kerala':            '#3aaa6a',
}

const istNow = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const istStr = (d = istNow()) => d.toISOString().split('T')[0]

const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtCr = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

function getRange(key) {
  const now = istNow(), y = now.getFullYear(), m = now.getMonth(), today = istStr(now)
  if (key === 'today')     return { from: today, to: today, label: 'Today' }
  if (key === 'yesterday') { const d = istStr(new Date(now - 86400000)); return { from: d, to: d, label: 'Yesterday' } }
  if (key === 'week')      { const off = now.getDay() === 0 ? 6 : now.getDay() - 1; return { from: istStr(new Date(now - off * 86400000)), to: today, label: 'This Week' } }
  if (key === 'mtd')       return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: today, label: 'Month to Date' }
  if (key === 'prev')      { const pm = m === 0 ? 11 : m - 1, pY = m === 0 ? y - 1 : y, last = new Date(pY, pm + 1, 0).getDate(); return { from: `${pY}-${String(pm + 1).padStart(2, '0')}-01`, to: `${pY}-${String(pm + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`, label: 'Previous Month' } }
  if (key === 'q')         { const q = Math.floor(m / 3); return { from: `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`, to: today, label: 'This Quarter' } }
  if (key === 'ytd')       return { from: `${y}-01-01`, to: today, label: 'Year to Date' }
  return { from: today, to: today, label: 'Today' }
}

export default function ConsignmentAnalytics() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [period,       setPeriod]       = useState('mtd')
  const [from,         setFrom]         = useState('')
  const [to,           setTo]           = useState('')
  const [consignments, setConsignments] = useState([])
  const [branches,     setBranches]     = useState([])
  const [loading,      setLoading]      = useState(true)

  // Stock-now snapshot (independent of date range)
  const [stockNow, setStockNow] = useState({ at_branch: 0, at_branch_wt: 0, at_branch_val: 0, in_consignment: 0, in_consignment_wt: 0 })

  useEffect(() => {
    const r = getRange(period)
    setFrom(r.from); setTo(r.to)
  }, [period])

  useEffect(() => {
    if (!from || !to) return
    fetchData()
  }, [from, to])

  async function fetchData() {
    setLoading(true)
    const [cRes, bRes, sRes] = await Promise.all([
      supabase.from('consignments')
        .select('*')
        .neq('status', 'seed')
        .gte('created_at', from + 'T00:00:00')
        .lte('created_at', to   + 'T23:59:59')
        .order('created_at', { ascending: false }),
      supabase.from('branches').select('name, region, state, is_hub').eq('is_active', true),
      supabase.from('purchases').select('stock_status, net_weight, total_amount')
        .eq('crm_status', 'approved').eq('is_deleted', false)
        .in('stock_status', ['at_branch', 'in_consignment']),
    ])
    setConsignments(cRes.data || [])
    setBranches(bRes.data || [])

    const snap = { at_branch: 0, at_branch_wt: 0, at_branch_val: 0, in_consignment: 0, in_consignment_wt: 0 }
    for (const r of sRes.data || []) {
      if (r.stock_status === 'at_branch') {
        snap.at_branch++
        snap.at_branch_wt  += parseFloat(r.net_weight   || 0)
        snap.at_branch_val += parseFloat(r.total_amount || 0)
      } else if (r.stock_status === 'in_consignment') {
        snap.in_consignment++
        snap.in_consignment_wt += parseFloat(r.net_weight || 0)
      }
    }
    setStockNow(snap)
    setLoading(false)
  }

  // ── Aggregates over selected window ──────────────────────────────────────
  const totalCons = consignments.length
  const totalBills = consignments.reduce((s, c) => s + (c.total_bills || 0), 0)
  const totalWt    = consignments.reduce((s, c) => s + parseFloat(c.total_net_wt || 0), 0)
  const totalVal   = consignments.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0)

  // Avg transit time: created → received
  const transitDays = consignments.filter(c => c.received_at).map(c =>
    (new Date(c.received_at) - new Date(c.created_at)) / 86400000)
  const avgTransit = transitDays.length ? (transitDays.reduce((a, b) => a + b, 0) / transitDays.length) : 0

  // Status counts
  const byStatus = consignments.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1
    return acc
  }, { draft: 0, dispatched: 0, received: 0 })

  // Type split
  const byType = consignments.reduce((acc, c) => {
    const k = c.movement_type || 'EXTERNAL'
    if (!acc[k]) acc[k] = { count: 0, bills: 0, wt: 0, val: 0 }
    acc[k].count++
    acc[k].bills += c.total_bills || 0
    acc[k].wt    += parseFloat(c.total_net_wt || 0)
    acc[k].val   += parseFloat(c.total_amount || 0)
    return acc
  }, {})

  // Daily trend
  const byDay = {}
  for (const c of consignments) {
    const d = c.created_at?.split('T')[0]
    if (!d) continue
    if (!byDay[d]) byDay[d] = { day: d, count: 0, bills: 0, wt: 0, val: 0 }
    byDay[d].count++
    byDay[d].bills += c.total_bills || 0
    byDay[d].wt    += parseFloat(c.total_net_wt || 0)
    byDay[d].val   += parseFloat(c.total_amount || 0)
  }
  const trend = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day))

  // By source branch
  const branchMeta = Object.fromEntries(branches.map(b => [b.name, b]))
  const byBranch = {}
  for (const c of consignments) {
    const k = c.branch_name
    if (!byBranch[k]) byBranch[k] = { branch: k, region: branchMeta[k]?.region || 'Unknown', count: 0, bills: 0, wt: 0, val: 0 }
    byBranch[k].count++
    byBranch[k].bills += c.total_bills || 0
    byBranch[k].wt    += parseFloat(c.total_net_wt || 0)
    byBranch[k].val   += parseFloat(c.total_amount || 0)
  }
  const topBranches = Object.values(byBranch).sort((a, b) => b.wt - a.wt).slice(0, 10)

  // By region
  const byRegion = {}
  for (const c of consignments) {
    const r = branchMeta[c.branch_name]?.region || 'Unknown'
    if (!byRegion[r]) byRegion[r] = { region: r, count: 0, bills: 0, wt: 0 }
    byRegion[r].count++
    byRegion[r].bills += c.total_bills || 0
    byRegion[r].wt    += parseFloat(c.total_net_wt || 0)
  }
  const regions = Object.values(byRegion).sort((a, b) => b.wt - a.wt)

  // Slowest still-in-transit (created days ago, not received)
  const slowest = consignments
    .filter(c => c.status !== 'received')
    .map(c => ({ ...c, age_days: Math.floor((Date.now() - new Date(c.created_at)) / 86400000) }))
    .sort((a, b) => b.age_days - a.age_days)
    .slice(0, 5)

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const btnOut = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '6px 12px', fontSize: '11px', color: t.text3, cursor: 'pointer' }

  // Bar chart helper
  const Bar = ({ value, max, color, label, sub, w = '100%' }) => (
    <div style={{ width: w, marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
        <span style={{ color: t.text2, fontWeight: 500 }}>{label}</span>
        <span style={{ color: t.text3, fontFamily: 'monospace' }}>{sub}</span>
      </div>
      <div style={{ height: '6px', background: t.card2, borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: max > 0 ? `${(value / max) * 100}%` : '0%', height: '100%', background: color, borderRadius: '3px', transition: 'width .3s ease' }} />
      </div>
    </div>
  )

  // Trend bars
  const trendMax = Math.max(...trend.map(d => d.wt), 1)

  return (
    <div style={{ padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '6px' }}>Analytics</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em' }}>Movement Analytics</div>
          <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '4px' }}>{from && to ? `${from} → ${to}` : 'Select a period'}</div>
        </div>

        {/* Period buttons */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { key: 'today',     label: 'Today' },
            { key: 'yesterday', label: 'Yesterday' },
            { key: 'week',      label: 'Week' },
            { key: 'mtd',       label: 'MTD' },
            { key: 'prev',      label: 'Prev Mo' },
            { key: 'q',         label: 'Quarter' },
            { key: 'ytd',       label: 'YTD' },
          ].map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              style={{
                background: period === p.key ? t.gold : 'transparent',
                color:      period === p.key ? '#1a0a00' : t.text3,
                border:    `1px solid ${period === p.key ? t.gold : t.border2}`,
                borderRadius: '7px', padding: '6px 12px', fontSize: '11px', fontWeight: period === p.key ? 700 : 500,
                cursor: 'pointer',
              }}>
              {p.label}
            </button>
          ))}
          {/* Custom date range */}
          <input type="date" value={from} onChange={e => { setPeriod('custom'); setFrom(e.target.value) }}
            style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '6px 10px', fontSize: '11px', color: t.text2, outline: 'none' }} />
          <input type="date" value={to} onChange={e => { setPeriod('custom'); setTo(e.target.value) }}
            style={{ background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '7px', padding: '6px 10px', fontSize: '11px', color: t.text2, outline: 'none' }} />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '64px', display: 'flex', justifyContent: 'center' }}><GoldSpinner size={32} /></div>
      ) : (
        <>
          {/* Stock-Now snapshot (current state, independent of period) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {[
              { label: 'At Branch (Now)',       value: fmt(stockNow.at_branch),       sub: fmtWt(stockNow.at_branch_wt),       color: t.gold,   bg: `${t.gold}06` },
              { label: 'In Consignment (Now)',  value: fmt(stockNow.in_consignment),  sub: fmtWt(stockNow.in_consignment_wt),  color: t.orange, bg: `${t.orange}06` },
              { label: 'Stock Value (At Branch)', value: fmtCr(stockNow.at_branch_val), sub: 'gross purchase value',          color: t.blue,   bg: `${t.blue}06` },
              { label: 'Active Consignments',   value: fmt(byStatus.draft + byStatus.dispatched), sub: `${byStatus.draft} draft · ${byStatus.dispatched} en route`, color: t.green, bg: `${t.green}06` },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '14px 18px', background: k.bg, borderLeft: `3px solid ${k.color}` }}>
                <div style={{ fontSize: '9px', color: k.color, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>{k.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 300, color: k.color, fontFamily: 'monospace', lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: '10px', color: t.text4, marginTop: '5px' }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Period KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
            {[
              { label: 'Consignments', value: fmt(totalCons),                color: t.text1, sub: 'in this period' },
              { label: 'Bills Moved',  value: fmt(totalBills),               color: t.gold,  sub: '' },
              { label: 'Net Weight',   value: fmtWt(totalWt),                color: t.blue,  sub: '' },
              { label: 'Total Value',  value: fmtCr(totalVal),               color: t.green, sub: '' },
              { label: 'Avg Transit',  value: avgTransit ? `${avgTransit.toFixed(1)}d` : '—', color: t.purple, sub: 'create → receive' },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '14px 18px' }}>
                <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>{k.label}</div>
                <div style={{ fontSize: '20px', fontWeight: 300, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: '10px', color: t.text4, marginTop: '4px' }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Daily trend chart */}
          {trend.length > 0 && (
            <div style={{ ...card, padding: '18px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Daily Movement</div>
                <div style={{ fontSize: '10px', color: t.text4 }}>Net Weight (g)</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '120px', marginBottom: '8px' }}>
                {trend.map(d => {
                  const h = trendMax > 0 ? Math.max(2, (d.wt / trendMax) * 100) : 2
                  return (
                    <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
                      title={`${d.day} · ${fmtWt(d.wt)} · ${d.count} consignments · ${d.bills} bills`}>
                      <div style={{ width: '100%', height: `${h}%`, background: `linear-gradient(180deg, ${t.gold}, ${t.gold}90)`, borderRadius: '3px 3px 0 0', cursor: 'pointer', transition: 'opacity .15s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 0.7}
                        onMouseLeave={e => e.currentTarget.style.opacity = 1} />
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: t.text4 }}>
                <span>{trend[0]?.day}</span>
                <span>{trend[trend.length - 1]?.day}</span>
              </div>
            </div>
          )}

          {/* Two-column: Type breakdown + Status funnel */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Type */}
            <div style={{ ...card, padding: '18px 22px' }}>
              <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '14px' }}>Movement Type</div>
              {['EXTERNAL', 'INTERNAL'].map(k => {
                const stats = byType[k] || { count: 0, bills: 0, wt: 0, val: 0 }
                const color = k === 'INTERNAL' ? t.purple : t.orange
                const max   = Math.max(...Object.values(byType).map(b => b.wt), 1)
                return (
                  <div key={k} style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color, fontWeight: 600 }}>{k === 'INTERNAL' ? 'Via Hub' : 'Direct → HO'}</span>
                      <span style={{ fontSize: '11px', color: t.text2, fontFamily: 'monospace' }}>{stats.count} · {fmtWt(stats.wt)} · {fmtCr(stats.val)}</span>
                    </div>
                    <div style={{ height: '8px', background: t.card2, borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: max > 0 ? `${(stats.wt / max) * 100}%` : '0%', height: '100%', background: color, borderRadius: '4px', transition: 'width .3s' }} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Status funnel */}
            <div style={{ ...card, padding: '18px 22px' }}>
              <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '14px' }}>Status Funnel</div>
              {[
                { k: 'draft',      label: 'Draft',      color: t.orange },
                { k: 'dispatched', label: 'Dispatched', color: t.blue },
                { k: 'received',   label: 'Received',   color: t.green },
              ].map(s => {
                const v   = byStatus[s.k] || 0
                const max = Math.max(...Object.values(byStatus), 1)
                return (
                  <div key={s.k} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '12px', color: s.color, fontWeight: 600 }}>{s.label}</span>
                      <span style={{ fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>{v}</span>
                    </div>
                    <div style={{ height: '8px', background: t.card2, borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: max > 0 ? `${(v / max) * 100}%` : '0%', height: '100%', background: s.color, borderRadius: '4px', transition: 'width .3s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Two-column: Top branches + Regions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Top branches */}
            <div style={{ ...card, padding: '18px 22px' }}>
              <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '14px' }}>Top Branches by Weight Moved</div>
              {topBranches.length === 0 ? (
                <div style={{ fontSize: '12px', color: t.text4, textAlign: 'center', padding: '20px' }}>No movements in this period</div>
              ) : topBranches.map((b, i) => {
                const max = topBranches[0]?.wt || 1
                return <Bar key={b.branch} value={b.wt} max={max}
                  color={REGION_COLORS[b.region] || t.gold}
                  label={`${i + 1}. ${b.branch}`}
                  sub={`${fmtWt(b.wt)} · ${b.count}c · ${b.bills}b`} />
              })}
            </div>

            {/* Regions */}
            <div style={{ ...card, padding: '18px 22px' }}>
              <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '14px' }}>By Region</div>
              {regions.length === 0 ? (
                <div style={{ fontSize: '12px', color: t.text4, textAlign: 'center', padding: '20px' }}>No movements in this period</div>
              ) : regions.map(r => {
                const max = regions[0]?.wt || 1
                return <Bar key={r.region} value={r.wt} max={max}
                  color={REGION_COLORS[r.region] || t.gold}
                  label={r.region}
                  sub={`${fmtWt(r.wt)} · ${r.count}c`} />
              })}
            </div>
          </div>

          {/* Slowest in-transit */}
          {slowest.length > 0 && (
            <div style={{ ...card, padding: '18px 22px' }}>
              <div style={{ fontSize: '11px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '14px' }}>Slowest Pending Consignments</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['TMP PRF', 'Source → Dest', 'Type', 'Status', 'Bills', 'Wt', 'Age'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slowest.map(c => {
                    const isType = c.movement_type === 'INTERNAL'
                    const ageColor = c.age_days > 7 ? t.red : c.age_days > 3 ? t.orange : t.green
                    return (
                      <tr key={c.id} style={{ borderBottom: `1px solid ${t.border}10` }}>
                        <td style={{ padding: '8px 10px', fontSize: '11px', color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{c.tmp_prf_no}</td>
                        <td style={{ padding: '8px 10px', fontSize: '11px', color: t.text2 }}>{c.branch_name} → {isType ? (c.dest_branch || '?') : 'HO'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontSize: '9px', color: isType ? t.purple : t.orange, background: isType ? `${t.purple}15` : `${t.orange}15`, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>{isType ? 'Hub' : 'Direct'}</span>
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: '11px', color: t.text3, textTransform: 'capitalize' }}>{c.status}</td>
                        <td style={{ padding: '8px 10px', fontSize: '11px', color: t.text2 }}>{c.total_bills}</td>
                        <td style={{ padding: '8px 10px', fontSize: '11px', color: t.gold, fontFamily: 'monospace' }}>{fmtWt(c.total_net_wt)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontSize: '10px', color: ageColor, background: `${ageColor}18`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700 }}>{c.age_days}d</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
