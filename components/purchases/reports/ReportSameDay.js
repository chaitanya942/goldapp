'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmt, fmtVal, getStyles } from './reportUtils'

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// IST today string
const istToday = () => {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  return d.toISOString().split('T')[0]
}

// Get DOW from a yyyy-mm-dd string (local, no timezone shift)
const dowFromStr = (str) => new Date(str + 'T00:00:00').getDay()

// ── MINI BAR CHART ────────────────────────────────────────────────
function BarChart({ data, valueKey, color, t, formatValue }) {
  const [hov, setHov] = useState(null)
  const max    = Math.max(...data.map(d => Number(d[valueKey] || 0)), 1)
  const W = 500, H = 190, PL = 8, PR = 8, PT = 28, PB = 38
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const barW   = Math.min(56, (chartW / data.length) * 0.55)
  const gap    = chartW / data.length

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {[0, 0.5, 1].map((f, i) => {
        const y = PT + chartH - f * chartH
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke={t.border} strokeWidth="1" strokeDasharray="3 3" />
            <text x={PL} y={y - 3} fontSize="7.5" fill={t.text4}>{formatValue(max * f)}</text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const val    = Number(d[valueKey] || 0)
        const barH   = max > 0 ? (val / max) * chartH : 0
        const x      = PL + gap * i + gap / 2 - barW / 2
        const y      = PT + chartH - barH
        const isSelected = d.week_label === 'Selected'
        const isHov  = hov === i
        return (
          <g key={i} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 2)} rx="4"
              fill={isSelected ? color : `${color}50`}
              stroke={isHov ? color : 'none'} strokeWidth="1.5" />
            {(isHov || isSelected) && (
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="9"
                fill={isSelected ? color : t.text2} fontWeight={isSelected ? '600' : '400'}>
                {formatValue(val)}
              </text>
            )}
            <text x={x + barW / 2} y={PT + chartH + 13} textAnchor="middle" fontSize="9"
              fill={isSelected ? color : t.text3} fontWeight={isSelected ? '600' : '400'}>
              {d.week_label}
            </text>
            <text x={x + barW / 2} y={PT + chartH + 24} textAnchor="middle" fontSize="7.5" fill={t.text4}>
              {d.purchase_date ? new Date(d.purchase_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
            </text>
          </g>
        )
      })}
      <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT + chartH} stroke={t.border} strokeWidth="1" />
    </svg>
  )
}

// ── TREND LINE ────────────────────────────────────────────────────
function TrendLine({ data, valueKey, color, t, formatValue }) {
  const [hov, setHov] = useState(null)
  const pts = [...data].reverse()
  const W = 500, H = 120, PL = 8, PR = 8, PT = 18, PB = 26
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const max = Math.max(...pts.map(d => Number(d[valueKey] || 0)), 1)
  const min = Math.min(...pts.map(d => Number(d[valueKey] || 0)))
  const range = max - min || 1
  const px = (i) => PL + (i / Math.max(pts.length - 1, 1)) * chartW
  const py = (d) => PT + chartH - ((Number(d[valueKey] || 0) - min) / range) * chartH
  const pathD = pts.map((d, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(d)}`).join(' ')
  const areaD = pts.length > 1 ? `${pathD} L ${px(pts.length - 1)} ${PT + chartH} L ${px(0)} ${PT + chartH} Z` : ''

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`tg-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {areaD && <path d={areaD} fill={`url(#tg-${valueKey})`} />}
      {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((d, i) => {
        const x = px(i), y = py(d)
        const isSelected = d.week_label === 'Selected'
        const isHov   = hov === i
        return (
          <g key={i} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
            <circle cx={x} cy={y} r={isSelected ? 5 : isHov ? 4 : 3}
              fill={isSelected ? color : t.card} stroke={color} strokeWidth={isSelected ? 0 : 1.5} />
            {(isHov || isSelected) && (
              <text x={x} y={y - 8} textAnchor="middle" fontSize="8.5"
                fill={color} fontWeight={isSelected ? '600' : '400'}>
                {formatValue(Number(d[valueKey] || 0))}
              </text>
            )}
            <text x={x} y={PT + chartH + 12} textAnchor="middle" fontSize="8"
              fill={isSelected ? color : t.text4} fontWeight={isSelected ? '600' : '400'}>
              {d.week_label}
            </text>
          </g>
        )
      })}
      <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT + chartH} stroke={t.border} strokeWidth="1" />
    </svg>
  )
}

// ── CHANGE BADGE ──────────────────────────────────────────────────
function ChangeBadge({ today, avg, t, formatValue }) {
  if (avg == null || avg === 0) return <span style={{ fontSize: '.6rem', color: t.text4 }}>No avg data</span>
  const diff   = today - avg
  const pctChg = (diff / avg) * 100
  const isPos  = diff >= 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 8px', borderRadius: '20px', background: isPos ? `${t.green}18` : `${t.red}18`, border: `1px solid ${isPos ? t.green : t.red}35` }}>
      <span style={{ fontSize: '.7rem', color: isPos ? t.green : t.red, fontWeight: 500 }}>{isPos ? '▲' : '▼'} {Math.abs(pctChg).toFixed(1)}%</span>
      <span style={{ fontSize: '.6rem', color: t.text3 }}>vs avg</span>
    </span>
  )
}

// ── STAT BOX ──────────────────────────────────────────────────────
function StatBox({ label, value, badge, color, t }) {
  return (
    <div style={{ flex: 1, minWidth: '140px', background: t.card2, borderRadius: '10px', padding: '14px 16px', border: `1px solid ${t.border}` }}>
      <div style={{ fontSize: '.48rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: '7px' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', color, fontWeight: 500, marginBottom: badge ? '8px' : 0 }}>{value}</div>
      {badge}
    </div>
  )
}

// ── OVERALL VIEW ──────────────────────────────────────────────────
function OverallView({ data, t, dowName }) {
  const selRow   = data.find(d => d.week_label === 'Selected')
  const pastDays = data.filter(d => d.week_label !== 'Selected')
  const avg      = (key) => pastDays.length > 0
    ? pastDays.reduce((s, d) => s + Number(d[key] || 0), 0) / pastDays.length : 0

  const avgNet  = avg('net_weight')
  const avgVal  = avg('gross_value')
  const avgRate = avg('avg_rate_per_g')

  const METRICS = [
    { key: 'net_weight',     label: 'Net Weight',   color: t.gold,   fmt: (v) => `${fmt(v)}g` },
    { key: 'gross_value',    label: 'Gross Value',  color: t.green,  fmt: fmtVal },
    { key: 'avg_rate_per_g', label: 'Avg Rate / g', color: t.purple, fmt: (v) => `₹${Math.round(v).toLocaleString('en-IN')}` },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Summary boxes */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <StatBox label="Selected Day Net Wt"  color={t.gold}  t={t}
          value={selRow ? `${fmt(selRow.net_weight)}g` : '—'}
          badge={selRow ? <ChangeBadge today={Number(selRow.net_weight)} avg={avgNet} t={t} /> : null} />
        <StatBox label="4-Week Avg Net Wt"    color={t.text2} t={t} value={`${fmt(avgNet)}g`} />
        <StatBox label="Selected Day Value"   color={t.green} t={t}
          value={selRow ? fmtVal(selRow.gross_value) : '—'}
          badge={selRow ? <ChangeBadge today={Number(selRow.gross_value)} avg={avgVal} t={t} /> : null} />
        <StatBox label="4-Week Avg Value"     color={t.text2} t={t} value={fmtVal(avgVal)} />
        <StatBox label="Selected Day Rate/g"  color={t.purple} t={t}
          value={selRow ? `₹${Math.round(selRow.avg_rate_per_g).toLocaleString('en-IN')}` : '—'}
          badge={selRow ? <ChangeBadge today={Number(selRow.avg_rate_per_g)} avg={avgRate} t={t} /> : null} />
      </div>

      {/* Bar charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
        {METRICS.map(({ key, label, color, fmt: fmtFn }) => (
          <div key={key} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px' }}>
            <div style={{ fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.18em', fontWeight: 500, marginBottom: '3px' }}>{label}</div>
            <div style={{ fontSize: '.6rem', color: t.text4, marginBottom: '12px' }}>Selected (bright) vs past 4 {dowName}s</div>
            <BarChart data={data} valueKey={key} color={color} t={t} formatValue={fmtFn} />
          </div>
        ))}
      </div>

      {/* Trend lines */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
        {METRICS.map(({ key, label, color, fmt: fmtFn }) => (
          <div key={key} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px' }}>
            <div style={{ fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.18em', fontWeight: 500, marginBottom: '3px' }}>{label} — Trend</div>
            <div style={{ fontSize: '.6rem', color: t.text4, marginBottom: '12px' }}>Oldest → Selected</div>
            <TrendLine data={data} valueKey={key} color={color} t={t} formatValue={fmtFn} />
          </div>
        ))}
      </div>

      {/* Detail table */}
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '20px' }}>
        <div style={{ fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.18em', fontWeight: 500, marginBottom: '14px' }}>All {dowName}s — Detail</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[
                { h: 'Week',        align: 'left'  },
                { h: 'Date',        align: 'left'  },
                { h: 'Net Weight',  align: 'right' },
                { h: 'vs Avg',      align: 'right' },
                { h: 'Gross Value', align: 'right' },
                { h: 'vs Avg ',     align: 'right' },
                { h: 'Rate / g',    align: 'right' },
                { h: 'vs Avg  ',    align: 'right' },
                { h: 'Txns',        align: 'right' },
              ].map(({ h, align }) => (
                <th key={h} style={{ padding: '8px 12px', fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.1em', textAlign: align, borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h.trim()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const isSel = d.week_label === 'Selected'
              const nd = avgNet  > 0 ? ((Number(d.net_weight)     - avgNet)  / avgNet)  * 100 : null
              const vd = avgVal  > 0 ? ((Number(d.gross_value)    - avgVal)  / avgVal)  * 100 : null
              const rd = avgRate > 0 ? ((Number(d.avg_rate_per_g) - avgRate) / avgRate) * 100 : null
              const DC = ({ v }) => v == null
                ? <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '.65rem', color: t.text4 }}>—</td>
                : <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '.68rem', color: v >= 0 ? t.green : t.red }}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</td>
              return (
                <tr key={i} style={{ background: isSel ? `${t.gold}10` : i % 2 === 0 ? 'transparent' : `${t.border}18`, borderLeft: isSel ? `3px solid ${t.gold}` : '3px solid transparent' }}>
                  <td style={{ padding: '10px 12px', fontSize: '.72rem', color: isSel ? t.gold : t.text2, fontWeight: isSel ? 500 : 400 }}>{d.week_label}</td>
                  <td style={{ padding: '10px 12px', fontSize: '.68rem', color: t.text3, whiteSpace: 'nowrap' }}>
                    {d.purchase_date ? new Date(d.purchase_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '.75rem', color: t.gold,   textAlign: 'right', fontWeight: isSel ? 500 : 400 }}>{fmt(d.net_weight)}g</td>
                  <DC v={isSel ? null : nd} />
                  <td style={{ padding: '10px 12px', fontSize: '.75rem', color: t.green,  textAlign: 'right', fontWeight: isSel ? 500 : 400 }}>{fmtVal(d.gross_value)}</td>
                  <DC v={isSel ? null : vd} />
                  <td style={{ padding: '10px 12px', fontSize: '.72rem', color: t.purple, textAlign: 'right' }}>₹{Math.round(d.avg_rate_per_g).toLocaleString('en-IN')}</td>
                  <DC v={isSel ? null : rd} />
                  <td style={{ padding: '10px 12px', fontSize: '.68rem', color: t.text2,  textAlign: 'right' }}>{Number(d.txn_count).toLocaleString('en-IN')}</td>
                </tr>
              )
            })}
            {pastDays.length > 0 && (
              <tr style={{ borderTop: `1px solid ${t.border}`, background: `${t.border}25` }}>
                <td colSpan={2} style={{ padding: '10px 12px', fontSize: '.6rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>4-Week Avg</td>
                <td style={{ padding: '10px 12px', fontSize: '.72rem', color: t.text2, textAlign: 'right' }}>{fmt(avgNet)}g</td>
                <td />
                <td style={{ padding: '10px 12px', fontSize: '.72rem', color: t.text2, textAlign: 'right' }}>{fmtVal(avgVal)}</td>
                <td />
                <td style={{ padding: '10px 12px', fontSize: '.72rem', color: t.text2, textAlign: 'right' }}>₹{Math.round(avgRate).toLocaleString('en-IN')}</td>
                <td />
                <td style={{ padding: '10px 12px', fontSize: '.68rem', color: t.text2, textAlign: 'right' }}>
                  {fmt(pastDays.reduce((s, d) => s + Number(d.txn_count || 0), 0) / pastDays.length)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── BRANCH VIEW ───────────────────────────────────────────────────
function BranchView({ rawData, t, dowName }) {
  const [search,         setSearch]         = useState('')
  const [sortKey,        setSortKey]        = useState('today_net')
  const [sortDir,        setSortDir]        = useState('desc')
  const [selectedBranch, setSelectedBranch] = useState(null)

  const branchMap = {}
  ;(rawData || []).forEach(row => {
    const b = row.branch_name
    if (!branchMap[b]) branchMap[b] = { branch_name: b, today: null, past: [] }
    if (row.week_label === 'Selected') branchMap[b].today = row
    else branchMap[b].past.push(row)
  })

  const branches = Object.values(branchMap).map(b => {
    const avgNet  = b.past.length > 0 ? b.past.reduce((s, r) => s + Number(r.net_weight   || 0), 0) / b.past.length : 0
    const avgVal  = b.past.length > 0 ? b.past.reduce((s, r) => s + Number(r.gross_value  || 0), 0) / b.past.length : 0
    const avgRate = b.past.length > 0 ? b.past.reduce((s, r) => s + Number(r.avg_rate_per_g || 0), 0) / b.past.length : 0
    const todayNet  = Number(b.today?.net_weight     || 0)
    const todayVal  = Number(b.today?.gross_value    || 0)
    const todayRate = Number(b.today?.avg_rate_per_g || 0)
    return {
      ...b, avgNet, avgVal, avgRate, todayNet, todayVal, todayRate,
      netDiff:  avgNet  > 0 ? ((todayNet  - avgNet)  / avgNet)  * 100 : null,
      valDiff:  avgVal  > 0 ? ((todayVal  - avgVal)  / avgVal)  * 100 : null,
      rateDiff: avgRate > 0 ? ((todayRate - avgRate) / avgRate) * 100 : null,
      today_net: todayNet, today_val: todayVal,
      net_diff:  avgNet  > 0 ? ((todayNet  - avgNet)  / avgNet)  * 100 : -999,
      val_diff:  avgVal  > 0 ? ((todayVal  - avgVal)  / avgVal)  * 100 : -999,
      weeks_present: b.past.length,
    }
  })

  const filtered = branches.filter(b => b.branch_name.toLowerCase().includes(search.toLowerCase()))
  const sorted   = [...filtered].sort((a, b2) => {
    const v = (b2[sortKey] ?? -999) - (a[sortKey] ?? -999)
    return sortDir === 'desc' ? v : -v
  })

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortTh = ({ label, sk, align = 'right' }) => (
    <th onClick={() => toggleSort(sk)}
      style={{ padding: '8px 12px', fontSize: '.52rem', color: sortKey === sk ? t.gold : t.text3, textTransform: 'uppercase', letterSpacing: '.1em', textAlign: align, borderBottom: `1px solid ${t.border}`, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
      {label} {sortKey === sk ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  )

  const sel = selectedBranch ? branches.find(b => b.branch_name === selectedBranch) : null
  const selData = sel ? [...(sel.today ? [sel.today] : []), ...sel.past] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <input
          placeholder="Search branch…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 12px', color: t.text1, fontSize: '.72rem', outline: 'none', width: '200px' }}
        />
        <div style={{ fontSize: '.65rem', color: t.text3 }}>
          {sorted.length} branches · {sorted.filter(b => b.today_net > 0).length} active today
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '.62rem', color: t.text4 }}>Click a row to see branch trend detail</div>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 12px', fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'left', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>#</th>
              <SortTh label="Branch"       sk="branch_name" align="left" />
              <SortTh label="Sel Net Wt"   sk="today_net" />
              <SortTh label="Avg Net Wt"   sk="avgNet" />
              <SortTh label="Net Δ%"       sk="net_diff" />
              <SortTh label="Sel Value"    sk="today_val" />
              <SortTh label="Avg Value"    sk="avgVal" />
              <SortTh label="Val Δ%"       sk="val_diff" />
              <SortTh label="Weeks Data"   sk="weeks_present" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((b, i) => {
              const isSel    = selectedBranch === b.branch_name
              const hasToday = b.today_net > 0
              return (
                <tr key={i}
                  onClick={() => setSelectedBranch(isSel ? null : b.branch_name)}
                  style={{ background: isSel ? `${t.gold}12` : i % 2 === 0 ? 'transparent' : `${t.border}18`, cursor: 'pointer', borderLeft: isSel ? `3px solid ${t.gold}` : '3px solid transparent' }}
                  onMouseEnter={e => !isSel && (e.currentTarget.style.background = `${t.border}35`)}
                  onMouseLeave={e => !isSel && (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${t.border}18`)}>
                  <td style={{ padding: '9px 12px', fontSize: '.65rem', color: t.text4 }}>{i + 1}</td>
                  <td style={{ padding: '9px 12px', fontSize: '.75rem', color: isSel ? t.gold : t.text1, fontWeight: isSel ? 500 : 400 }}>{b.branch_name}</td>
                  <td style={{ padding: '9px 12px', fontSize: '.75rem', color: hasToday ? t.gold : t.text4, textAlign: 'right', fontWeight: hasToday ? 500 : 400 }}>
                    {hasToday ? `${fmt(b.todayNet)}g` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: '.72rem', color: t.text2, textAlign: 'right' }}>{b.avgNet > 0 ? `${fmt(b.avgNet)}g` : '—'}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    {b.netDiff == null || !hasToday
                      ? <span style={{ fontSize: '.65rem', color: t.text4 }}>—</span>
                      : <span style={{ fontSize: '.7rem', color: b.netDiff >= 0 ? t.green : t.red, fontWeight: 500 }}>{b.netDiff >= 0 ? '▲' : '▼'} {Math.abs(b.netDiff).toFixed(1)}%</span>
                    }
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: '.72rem', color: hasToday ? t.green : t.text4, textAlign: 'right' }}>
                    {hasToday ? fmtVal(b.todayVal) : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: '.7rem', color: t.text2, textAlign: 'right' }}>{b.avgVal > 0 ? fmtVal(b.avgVal) : '—'}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    {b.valDiff == null || !hasToday
                      ? <span style={{ fontSize: '.65rem', color: t.text4 }}>—</span>
                      : <span style={{ fontSize: '.7rem', color: b.valDiff >= 0 ? t.green : t.red, fontWeight: 500 }}>{b.valDiff >= 0 ? '▲' : '▼'} {Math.abs(b.valDiff).toFixed(1)}%</span>
                    }
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: '.68rem', color: t.text3, textAlign: 'right' }}>{b.weeks_present}/4</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sel && (
        <div style={{ background: t.card, border: `1px solid ${t.gold}40`, borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.18em', fontWeight: 500, marginBottom: '4px' }}>{sel.branch_name} — {dowName} Trend</div>
              <div style={{ fontSize: '.65rem', color: t.text3 }}>Selected vs past 4 {dowName}s</div>
            </div>
            <button onClick={() => setSelectedBranch(null)} style={{ background: 'transparent', border: 'none', color: t.text3, cursor: 'pointer', fontSize: '.8rem' }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            {[
              { key: 'net_weight',  label: 'Net Weight',  color: t.gold,  fmtFn: (v) => `${fmt(v)}g` },
              { key: 'gross_value', label: 'Gross Value', color: t.green, fmtFn: fmtVal },
            ].map(({ key, label, color, fmtFn }) => (
              <div key={key} style={{ background: t.card2, borderRadius: '10px', padding: '16px', border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.15em', marginBottom: '12px' }}>{label}</div>
                <BarChart data={selData} valueKey={key} color={color} t={t} formatValue={fmtFn} />
              </div>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Week', 'Date', 'Net Wt', 'vs Avg', 'Value', 'vs Avg ', 'Rate/g', 'Txns'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', fontSize: '.5rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.1em', textAlign: ['Week','Date'].includes(h.trim()) ? 'left' : 'right', borderBottom: `1px solid ${t.border}`, fontWeight: 500 }}>{h.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selData.map((d, i) => {
                const isSel2 = d.week_label === 'Selected'
                const nd = sel.avgNet > 0 ? ((Number(d.net_weight)    - sel.avgNet) / sel.avgNet) * 100 : null
                const vd = sel.avgVal > 0 ? ((Number(d.gross_value)   - sel.avgVal) / sel.avgVal) * 100 : null
                const DC = ({ v }) => v == null || isSel2
                  ? <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '.65rem', color: t.text4 }}>—</td>
                  : <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '.68rem', color: v >= 0 ? t.green : t.red }}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</td>
                return (
                  <tr key={i} style={{ background: isSel2 ? `${t.gold}10` : i % 2 === 0 ? 'transparent' : `${t.border}15`, borderLeft: isSel2 ? `3px solid ${t.gold}` : '3px solid transparent' }}>
                    <td style={{ padding: '8px 10px', fontSize: '.7rem', color: isSel2 ? t.gold : t.text2, fontWeight: isSel2 ? 500 : 400 }}>{d.week_label}</td>
                    <td style={{ padding: '8px 10px', fontSize: '.65rem', color: t.text3, whiteSpace: 'nowrap' }}>
                      {d.purchase_date ? new Date(d.purchase_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: '.72rem', color: t.gold,   textAlign: 'right', fontWeight: isSel2 ? 500 : 400 }}>{fmt(d.net_weight)}g</td>
                    <DC v={nd} />
                    <td style={{ padding: '8px 10px', fontSize: '.72rem', color: t.green,  textAlign: 'right', fontWeight: isSel2 ? 500 : 400 }}>{fmtVal(d.gross_value)}</td>
                    <DC v={vd} />
                    <td style={{ padding: '8px 10px', fontSize: '.7rem',  color: t.purple, textAlign: 'right' }}>₹{Math.round(d.avg_rate_per_g).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '8px 10px', fontSize: '.68rem', color: t.text2,  textAlign: 'right' }}>{Number(d.txn_count).toLocaleString('en-IN')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────
export default function ReportSameDay({ t }) {
  const [selectedDate, setSelectedDate] = useState(istToday())
  const [view,         setView]         = useState('overall')
  const [overallData,  setOverallData]  = useState([])
  const [branchData,   setBranchData]   = useState([])
  const [loading,      setLoading]      = useState(true)

  const dow     = dowFromStr(selectedDate)
  const dowName = DOW_NAMES[dow]

  useEffect(() => {
    if (!selectedDate) return
    setLoading(true)
    Promise.all([
      supabase.rpc('get_same_day_trend',        { p_dow: dow, p_weeks: 4, p_anchor_date: selectedDate }),
      supabase.rpc('get_same_day_branch_trend', { p_dow: dow, p_weeks: 4, p_anchor_date: selectedDate }),
    ]).then(([{ data: od }, { data: bd }]) => {
      setOverallData(od || [])
      setBranchData(bd  || [])
      setLoading(false)
    })
  }, [selectedDate])

  if (!t) return null

  const selRow  = overallData.find(d => d.week_label === 'Selected')
  const hasData = !!selRow

  const inp = {
    background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px',
    padding: '7px 12px', color: t.text1, fontSize: '.75rem', outline: 'none', cursor: 'pointer',
  }
  const pill = (active) => ({
    padding: '5px 14px', borderRadius: '20px', fontSize: '.62rem', cursor: 'pointer', border: 'none',
    background: active ? t.gold : t.border, color: active ? '#000' : t.text3, fontWeight: active ? 600 : 400,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Header */}
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '.52rem', color: t.text3, letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 500, marginBottom: '6px' }}>Same-Day Comparison</div>
            <div style={{ fontSize: '1rem', color: t.text1, fontWeight: 400 }}>
              {dowName}s — {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} vs Past 4 {dowName}s
            </div>
            {hasData
              ? <div style={{ fontSize: '.68rem', color: t.text3, marginTop: '3px' }}>Comparing against same weekday over the previous 4 weeks</div>
              : <div style={{ fontSize: '.68rem', color: t.orange, marginTop: '3px' }}>No purchases recorded for {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
            }
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
            {/* Date picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Select Date</span>
              <input
                type="date"
                value={selectedDate}
                onChange={e => e.target.value && setSelectedDate(e.target.value)}
                style={inp}
              />
              <button
                onClick={() => setSelectedDate(istToday())}
                style={{ padding: '7px 12px', borderRadius: '8px', border: `1px solid ${t.border}`, background: 'transparent', color: t.text3, fontSize: '.62rem', cursor: 'pointer', letterSpacing: '.04em' }}>
                Today
              </button>
            </div>
            {/* View toggle */}
            <div style={{ display: 'flex', gap: '5px' }}>
              <button style={pill(view === 'overall')}  onClick={() => setView('overall')}>📊 Overall</button>
              <button style={pill(view === 'branches')} onClick={() => setView('branches')}>⬡ Branch-wise</button>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: t.text4, padding: '60px', fontSize: '.8rem' }}>Loading…</div>
      )}

      {!loading && overallData.length === 0 && (
        <div style={{ textAlign: 'center', color: t.text4, padding: '60px', fontSize: '.8rem' }}>No data found for {dowName}s around {selectedDate}</div>
      )}

      {!loading && overallData.length > 0 && view === 'overall' && (
        <OverallView data={overallData} t={t} dowName={dowName} />
      )}

      {!loading && overallData.length > 0 && view === 'branches' && (
        <BranchView rawData={branchData} t={t} dowName={dowName} />
      )}

    </div>
  )
}