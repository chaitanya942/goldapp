'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', card3: '#1c1c1c', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8', shadow: '0 1px 3px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', card3: '#d8d0c2', text1: '#1a1208', text2: '#5a4a2a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d0c8b8', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3aa0', shadow: '0 1px 3px rgba(0,0,0,.08)' },
}

const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
const fmtVal  = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDT   = (d) => d ? new Date(d).toLocaleString('en-IN',  { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const STATE_COLORS = { Karnataka: '#c9a84c', Kerala: '#3a8fbf', 'Andhra Pradesh': '#3aaa6a', Telangana: '#8c5ac8' }
const STATE_ICONS  = { Kerala: '🌴', Karnataka: '🏛️', 'Andhra Pradesh': '🌊', Telangana: '⭐' }

// ── CSV EXPORT (CRM style) ──
const exportCSV = (rows, kpis, dateLabel) => {
  const now = new Date().toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
  const header = [
    `"WHITE GOLD BULLION PVT LTD GOLD MOVEMENT REPORT",,,,,,,,`,
    `"Period: ${dateLabel}",,,"Bills: ${kpis.count}",,"Net Wt: ${fmt(kpis.net)}g",,"Value: ${fmtVal(kpis.value)}",,`,
    '',
    ['S No','Date','Dispatched At','Customer Name','Branch','State','GRS WT','STONE','WASTAGE','NET WT','GROSS AMOUNT','SERVICE%','FINAL AMT','TYPE','APPLICATION NO'].join(','),
  ]
  const lines = rows.map((p, i) => [
    i + 1,
    fmtDate(p.purchase_date),
    fmtDT(p.dispatched_at),
    `"${p.customer_name || ''}"`,
    `"${p.branch_name || ''}"`,
    p.state || '',
    p.gross_weight,
    p.stone_weight,
    p.wastage,
    p.net_weight,
    p.total_amount,
    p.service_charge_pct,
    p.final_amount_crm,
    p.transaction_type,
    p.application_id,
  ].join(','))
  const blob = new Blob([[...header, ...lines].join('\n')], { type: 'text/csv' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `gold_movement_${dateLabel.replace(/\s/g,'_')}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
}

// ── TREND CHART ──
function TrendChart({ data, metric, t }) {
  const ref  = useRef(null)
  const [w, setW] = useState(600)
  const [tip, setTip] = useState(null)
  useEffect(() => {
    if (!ref.current) return
    setW(ref.current.offsetWidth)
    const ro = new ResizeObserver(() => ref.current && setW(ref.current.offsetWidth))
    ro.observe(ref.current); return () => ro.disconnect()
  }, [data])

  if (!data.length) return <div style={{ textAlign: 'center', color: t.text4, padding: '40px', fontSize: '.72rem' }}>No trend data</div>

  const vals  = data.map(d => Number(d[metric] || 0))
  const max   = Math.max(...vals, 1)
  const pad   = { t: 20, b: 36, l: 50, r: 16 }
  const cw    = w - pad.l - pad.r
  const ch    = 160 - pad.t - pad.b
  const h     = 160
  const pts   = vals.map((v, i) => `${pad.l + (i / Math.max(vals.length - 1, 1)) * cw},${pad.t + (1 - v / max) * ch}`)
  const area  = [`${pad.l},${pad.t + ch}`, ...pts, `${pad.l + cw},${pad.t + ch}`].join(' ')

  const onMove = e => {
    const rect = ref.current?.getBoundingClientRect(); if (!rect) return
    const mx = e.clientX - rect.left - pad.l
    const i  = Math.max(0, Math.min(vals.length - 1, Math.round((mx / cw) * (vals.length - 1))))
    setTip({ i, x: pad.l + (i / Math.max(vals.length - 1, 1)) * cw, v: vals[i], d: data[i].dispatch_date })
  }

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
      {tip && (
        <div style={{ position: 'absolute', top: 4, left: Math.min(tip.x + 12, w - 160), background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 14px', pointerEvents: 'none', zIndex: 10, minWidth: '140px' }}>
          <div style={{ fontSize: '.6rem', color: t.text4, marginBottom: '4px' }}>{fmtDate(tip.d)}</div>
          <div style={{ fontSize: '.82rem', color: t.gold, fontWeight: 300 }}>
            {metric === 'net_weight' ? `${fmt(tip.v)}g` : metric === 'bill_count' ? tip.v.toLocaleString('en-IN') : fmtVal(tip.v)}
          </div>
        </div>
      )}
      <svg width="100%" height={h} style={{ overflow: 'visible', cursor: 'crosshair' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const yp = pad.t + p * ch, val = max * (1 - p)
          return <g key={i}>
            <line x1={pad.l} y1={yp} x2={w - pad.r} y2={yp} stroke={t.border} strokeWidth="1" opacity=".6" />
            <text x={pad.l - 5} y={yp + 4} textAnchor="end" fontSize="9" fill={t.text4}>
              {metric === 'net_weight' ? `${(val / 1000).toFixed(1)}k` : metric === 'bill_count' ? Math.round(val) : `₹${(val / 100000).toFixed(0)}L`}
            </text>
          </g>
        })}
        <defs>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.gold} stopOpacity=".3" />
            <stop offset="100%" stopColor={t.gold} stopOpacity=".02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#tg)" />
        <polyline points={pts.join(' ')} fill="none" stroke={t.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {tip && <>
          <line x1={tip.x} y1={pad.t} x2={tip.x} y2={pad.t + ch} stroke={t.text3} strokeWidth="1" strokeDasharray="3,3" opacity=".5" />
          <circle cx={tip.x} cy={pad.t + (1 - tip.v / max) * ch} r="4" fill={t.gold} />
        </>}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', paddingLeft: `${pad.l}px`, paddingRight: `${pad.r}px` }}>
        <span style={{ fontSize: '.58rem', color: t.text4 }}>{fmtDate(data[0]?.dispatch_date)}</span>
        <span style={{ fontSize: '.58rem', color: t.text4 }}>{fmtDate(data[data.length - 1]?.dispatch_date)}</span>
      </div>
    </div>
  )
}

// ── STATE BAR CHART ──
function StateBarChart({ branchData, t }) {
  const stateMap = {}
  branchData.forEach(b => {
    if (!stateMap[b.state]) stateMap[b.state] = { net: 0, count: 0 }
    stateMap[b.state].net   += Number(b.net_weight || 0)
    stateMap[b.state].count += Number(b.bill_count || 0)
  })
  const states = Object.entries(stateMap).sort((a, b) => b[1].net - a[1].net)
  const maxNet = Math.max(...states.map(s => s[1].net), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {states.map(([state, d]) => {
        const pct  = (d.net / maxNet * 100).toFixed(1)
        const color = STATE_COLORS[state] || t.gold
        return (
          <div key={state}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '.68rem', color: t.text2 }}>{STATE_ICONS[state] || ''} {state}</span>
              <span style={{ fontSize: '.68rem', color }}>{fmt(d.net)}g · {d.count.toLocaleString('en-IN')} bills</span>
            </div>
            <div style={{ height: '7px', borderRadius: '4px', background: t.border, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width .6s ease' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── DONUT CHART ──
function DonutChart({ physical, takeover, t }) {
  const total = physical + takeover || 1
  const pPct  = physical / total
  const r = 36, cx = 52, cy = 52
  const circ = 2 * Math.PI * r
  const dash = pPct * circ
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <svg width="104" height="104">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.blue}   strokeWidth="10" opacity=".3" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.gold}   strokeWidth="10"
          strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray .6s ease' }} />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fill={t.text1} fontWeight="300">{(pPct * 100).toFixed(0)}%</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill={t.text4}>PHYSICAL</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '.72rem', color: t.gold }}>{physical.toLocaleString('en-IN')} bills</div>
          <div style={{ fontSize: '.55rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Physical</div>
        </div>
        <div>
          <div style={{ fontSize: '.72rem', color: t.blue }}>{takeover.toLocaleString('en-IN')} bills</div>
          <div style={{ fontSize: '.55rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Takeover</div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════
// ── MAIN COMPONENT ──
// ══════════════════════════════
export default function ConsignmentSummary() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  // ── Filters ──
  const today    = new Date().toISOString().split('T')[0]
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const [dateFrom, setDateFrom]   = useState(monthAgo)
  const [dateTo, setDateTo]       = useState(today)
  const [filterState, setFilterState] = useState('')
  const [filterTxn, setFilterTxn]     = useState('')
  const [viewMode, setViewMode]       = useState('transaction') // 'transaction' | 'branch'
  const [trendMetric, setTrendMetric] = useState('net_weight')

  // ── Data ──
  const [txnRows, setTxnRows]       = useState([])
  const [branchRows, setBranchRows] = useState([])
  const [trendData, setTrendData]   = useState([])
  const [loading, setLoading]       = useState(false)
  const [exporting, setExporting]   = useState(false)

  // ── States list ──
  const [states, setStates] = useState([])

  // ── Pagination (txn view) ──
  const [page, setPage]           = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const PAGE_SIZE  = 100
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // ── Sort ──
  const [sortCol, setSortCol] = useState('dispatched_at')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    supabase.from('branches').select('state').eq('model_type', 'outside_bangalore').then(({ data }) => {
      if (data) setStates([...new Set(data.map(b => b.state).filter(Boolean))].sort())
    })
  }, [])

  useEffect(() => { loadAll() }, [dateFrom, dateTo, filterState, filterTxn])
  useEffect(() => { if (viewMode === 'transaction') loadTxn(page) }, [page, sortCol, sortDir])

  const loadAll = async () => {
    setLoading(true)
    setPage(0)
    await Promise.all([loadTxn(0), loadBranch(), loadTrend()])
    setLoading(false)
  }

  const loadTxn = async (pageNum) => {
    const from = pageNum * PAGE_SIZE
    const { data, count } = await supabase
      .rpc('get_consignment_summary', {
        p_from:     dateFrom || null,
        p_to:       dateTo   || null,
        p_state:    filterState || null,
        p_branch:   null,
        p_txn_type: filterTxn   || null,
      }, { count: 'exact' })
      // Note: Supabase RPC doesn't support range directly — fetch all and slice client-side for now
    const all = data || []
    setTotalCount(count ?? all.length)

    // Sort client side
    const sorted = [...all].sort((a, b) => {
      const av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
    })
    setTxnRows(sorted.slice(from, from + PAGE_SIZE))
    if (count === null) setTotalCount(all.length)
  }

  const loadBranch = async () => {
    const { data } = await supabase.rpc('get_consignment_summary_branch', {
      p_from:     dateFrom    || null,
      p_to:       dateTo      || null,
      p_state:    filterState || null,
      p_txn_type: filterTxn   || null,
    })
    setBranchRows(data || [])
  }

  const loadTrend = async () => {
    const { data } = await supabase.rpc('get_consignment_daily_trend', {
      p_from:  dateFrom    || null,
      p_to:    dateTo      || null,
      p_state: filterState || null,
    })
    setTrendData(data || [])
  }

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(0)
  }

  // ── Derived KPIs ──
  const kpis = branchRows.reduce((acc, b) => ({
    count:    acc.count    + Number(b.bill_count    || 0),
    net:      acc.net      + Number(b.net_weight    || 0),
    gross:    acc.gross    + Number(b.gross_weight  || 0),
    value:    acc.value    + Number(b.total_value   || 0),
    physical: acc.physical + Number(b.physical_count || 0),
    takeover: acc.takeover + Number(b.takeover_count || 0),
    branches: acc.branches + 1,
  }), { count: 0, net: 0, gross: 0, value: 0, physical: 0, takeover: 0, branches: 0 })

  const dateLabel = dateFrom && dateTo ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}` : 'All Dates'

  const handleExport = async () => {
    setExporting(true)
    const { data } = await supabase.rpc('get_consignment_summary', {
      p_from: dateFrom || null, p_to: dateTo || null,
      p_state: filterState || null, p_branch: null, p_txn_type: filterTxn || null,
    })
    exportCSV(data || [], kpis, dateLabel)
    setExporting(false)
  }

  const SortIcon = ({ col }) => (
    <span style={{ marginLeft: '4px', fontSize: '.5rem', opacity: sortCol === col ? 1 : .25 }}>
      {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
    </span>
  )

  const inp  = { background: t.card2, border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '.72rem', outline: 'none' }
  const pill = (active, color) => ({ padding: '5px 14px', borderRadius: '100px', border: `1px solid ${active ? (color || t.gold) : t.border}`, background: active ? `${color || t.gold}18` : 'transparent', color: active ? (color || t.gold) : t.text3, fontSize: '.65rem', cursor: 'pointer' })
  const th   = { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
  const td   = { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}18`, whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '6px' }}>Dispatched Stock</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em', lineHeight: 1 }}>Gold Movement Report</div>
          <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '6px' }}>Outside-Bangalore · In Transit to HO</div>
        </div>
        <button onClick={handleExport} disabled={exporting}
          style={{ background: t.gold, border: 'none', borderRadius: '8px', padding: '10px 24px', color: '#0e0e0e', fontSize: '.72rem', fontWeight: 700, cursor: exporting ? 'wait' : 'pointer', letterSpacing: '.04em' }}>
          {exporting ? 'Exporting...' : '↓ Export CRM Report'}
        </button>
      </div>

      {/* ── FILTERS ── */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '14px 18px' }}>
        {/* Date presets */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { label: 'Today',   from: today,    to: today },
            { label: '7d',      from: new Date(Date.now() - 7  * 86400000).toISOString().split('T')[0], to: today },
            { label: '30d',     from: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0], to: today },
            { label: 'This Month', from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0], to: today },
          ].map(p => (
            <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to) }}
              style={pill(dateFrom === p.from && dateTo === p.to)}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ width: '1px', height: '24px', background: t.border }} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, fontSize: '.7rem', cursor: 'pointer' }} />
        <span style={{ fontSize: '.65rem', color: t.text4 }}>to</span>
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={{ ...inp, fontSize: '.7rem', cursor: 'pointer' }} />
        <div style={{ width: '1px', height: '24px', background: t.border }} />
        {/* State filter */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button style={pill(!filterState)} onClick={() => setFilterState('')}>All States</button>
          {states.map(s => <button key={s} style={pill(filterState === s, STATE_COLORS[s])} onClick={() => setFilterState(filterState === s ? '' : s)}>{STATE_ICONS[s]} {s}</button>)}
        </div>
        <div style={{ width: '1px', height: '24px', background: t.border }} />
        {/* Txn type */}
        <button style={pill(filterTxn === 'PHYSICAL', t.gold)} onClick={() => setFilterTxn(filterTxn === 'PHYSICAL' ? '' : 'PHYSICAL')}>Physical</button>
        <button style={pill(filterTxn === 'TAKEOVER', t.blue)} onClick={() => setFilterTxn(filterTxn === 'TAKEOVER' ? '' : 'TAKEOVER')}>Takeover</button>
      </div>

      {/* ── KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Bills Dispatched', value: kpis.count.toLocaleString('en-IN'),    color: t.gold,   icon: '📦' },
          { label: 'Gross Weight',     value: `${fmt(kpis.gross)}g`,                 color: t.text1              },
          { label: 'Net Weight',       value: `${fmt(kpis.net)}g`,                   color: t.gold               },
          { label: 'Total Value',      value: fmtVal(kpis.value),                    color: t.green              },
          { label: 'Branches',         value: kpis.branches,                         color: t.blue,   icon: '🏪' },
          { label: 'Avg Net / Bill',   value: kpis.count > 0 ? `${fmt(kpis.net / kpis.count)}g` : '—', color: t.orange },
        ].map(c => (
          <div key={c.label} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ fontSize: '.52rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em' }}>{c.label}</div>
              {c.icon && <span style={{ fontSize: '.8rem', opacity: .5 }}>{c.icon}</span>}
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 200, color: c.color, lineHeight: 1 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* ── CHARTS ROW ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>

        {/* Trend chart */}
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ fontSize: '.58rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.15em' }}>Daily Dispatch Trend</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[['Net Wt', 'net_weight'], ['Bills', 'bill_count'], ['Value', 'total_value']].map(([l, v]) => (
                <button key={v} onClick={() => setTrendMetric(v)}
                  style={{ padding: '3px 10px', borderRadius: '100px', border: `1px solid ${trendMetric === v ? t.gold : t.border}`, background: trendMetric === v ? `${t.gold}18` : 'transparent', color: trendMetric === v ? t.gold : t.text3, fontSize: '.6rem', cursor: 'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <TrendChart data={trendData} metric={trendMetric} t={t} />
        </div>

        {/* State bar chart */}
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ fontSize: '.58rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.15em', marginBottom: '16px' }}>Net Weight by State</div>
          {branchRows.length > 0 ? <StateBarChart branchData={branchRows} t={t} /> : <div style={{ color: t.text4, fontSize: '.7rem', textAlign: 'center', padding: '30px' }}>No data</div>}
        </div>

        {/* Donut */}
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ fontSize: '.58rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.15em', marginBottom: '16px' }}>Physical vs Takeover</div>
          <DonutChart physical={kpis.physical} takeover={kpis.takeover} t={t} />
          <div style={{ marginTop: '16px', borderTop: `1px solid ${t.border}`, paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '.62rem', color: t.text3 }}>Avg Physical Wt</span>
              <span style={{ fontSize: '.65rem', color: t.gold }}>{kpis.physical > 0 ? `${fmt(kpis.net * (kpis.physical / (kpis.count || 1)) * (kpis.count / (kpis.physical || 1)) / (kpis.count || 1) * kpis.count / (kpis.physical || 1))}g` : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── VIEW TOGGLE ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={pill(viewMode === 'transaction')} onClick={() => setViewMode('transaction')}>≡ Transaction Wise</button>
          <button style={pill(viewMode === 'branch')}      onClick={() => setViewMode('branch')}>⊞ Branch Wise</button>
        </div>
        {viewMode === 'transaction' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '.68rem', color: t.text3 }}>
              {totalCount === 0 ? 'No records' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString('en-IN')} of ${totalCount.toLocaleString('en-IN')}`}
            </span>
            <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
              style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 12px', color: t.text3, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? .4 : 1, fontSize: '.7rem' }}>←</button>
            <span style={{ fontSize: '.68rem', color: t.text3 }}>Page {page + 1} / {totalPages || 1}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 12px', color: t.text3, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? .4 : 1, fontSize: '.7rem' }}>→</button>
          </div>
        )}
      </div>

      {/* ── TRANSACTION TABLE ── */}
      {viewMode === 'transaction' && (
        <div style={{ overflowX: 'auto', borderRadius: '12px', border: `1px solid ${t.border}`, boxShadow: t.shadow }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, cursor: 'default' }}>#</th>
                {[
                  { label: 'App ID',       col: 'application_id'  },
                  { label: 'Purchase Date',col: 'purchase_date'   },
                  { label: 'Dispatched',   col: 'dispatched_at'   },
                  { label: 'Customer',     col: 'customer_name'   },
                  { label: 'Branch',       col: 'branch_name'     },
                  { label: 'State',        col: 'state'           },
                  { label: 'Gross Wt',     col: 'gross_weight'    },
                  { label: 'Stone',        col: 'stone_weight'    },
                  { label: 'Wastage',      col: 'wastage'         },
                  { label: 'Net Wt',       col: 'net_weight'      },
                  { label: 'Gross Amt',    col: 'total_amount'    },
                  { label: 'Svc%',         col: 'service_charge_pct' },
                  { label: 'Final Amt',    col: 'final_amount_crm'},
                  { label: 'Type',         col: 'transaction_type'},
                ].map(({ label, col }) => (
                  <th key={label} style={{ ...th, color: sortCol === col ? t.gold : t.text3 }} onClick={() => handleSort(col)}>
                    {label}<SortIcon col={col} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} style={{ ...td, textAlign: 'center', padding: '60px', color: t.text4 }}>Loading...</td></tr>
              ) : txnRows.map((p, i) => (
                <tr key={p.id}
                  style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}12`, transition: 'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${t.border}12`}>
                  <td style={{ ...td, color: t.text4 }}>{page * PAGE_SIZE + i + 1}</td>
                  <td style={{ ...td, color: t.gold, fontWeight: 500, fontFamily: 'monospace' }}>{p.application_id}</td>
                  <td style={{ ...td, color: t.text2 }}>{fmtDate(p.purchase_date)}</td>
                  <td style={{ ...td, color: t.orange }}>{fmtDT(p.dispatched_at)}</td>
                  <td style={{ ...td, maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.customer_name}</td>
                  <td style={{ ...td, color: t.text2 }}>{p.branch_name}</td>
                  <td style={{ ...td, fontSize: '.65rem' }}>
                    <span style={{ padding: '2px 7px', borderRadius: '4px', background: `${STATE_COLORS[p.state] || t.gold}18`, color: STATE_COLORS[p.state] || t.gold }}>{p.state}</span>
                  </td>
                  <td style={td}>{fmt(p.gross_weight)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={{ ...td, color: t.text3 }}>{fmt(p.stone_weight)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={{ ...td, color: t.text3 }}>{fmt(p.wastage)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={{ ...td, color: t.gold }}>{fmt(p.net_weight)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={td}>₹{fmt(p.total_amount)}</td>
                  <td style={{ ...td, color: t.text3 }}>{fmt(p.service_charge_pct)}%</td>
                  <td style={{ ...td, color: t.green }}>₹{fmt(p.final_amount_crm)}</td>
                  <td style={td}>
                    <span style={{ fontSize: '.65rem', padding: '2px 8px', borderRadius: '100px', background: `${p.transaction_type === 'PHYSICAL' ? t.gold : t.blue}18`, color: p.transaction_type === 'PHYSICAL' ? t.gold : t.blue }}>
                      {p.transaction_type}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && txnRows.length === 0 && (
                <tr><td colSpan={15} style={{ ...td, textAlign: 'center', color: t.text4, padding: '60px' }}>No dispatched bills found for this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── BRANCH TABLE ── */}
      {viewMode === 'branch' && (
        <div style={{ overflowX: 'auto', borderRadius: '12px', border: `1px solid ${t.border}`, boxShadow: t.shadow }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, cursor: 'default' }}>#</th>
                {['Branch','State','Region','Bills','Gross Wt','Net Wt','Value','Physical','Takeover','First Dispatch','Last Dispatch'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} style={{ ...td, textAlign: 'center', padding: '60px', color: t.text4 }}>Loading...</td></tr>
              ) : branchRows.map((b, i) => (
                <tr key={b.branch_name}
                  style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}12`, transition: 'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${t.border}12`}>
                  <td style={{ ...td, color: t.text4 }}>{i + 1}</td>
                  <td style={{ ...td, color: t.gold, fontWeight: 500 }}>{b.branch_name}</td>
                  <td style={{ ...td, fontSize: '.65rem' }}>
                    <span style={{ padding: '2px 7px', borderRadius: '4px', background: `${STATE_COLORS[b.state] || t.gold}18`, color: STATE_COLORS[b.state] || t.gold }}>{b.state}</span>
                  </td>
                  <td style={{ ...td, color: t.text3 }}>{b.region || '—'}</td>
                  <td style={{ ...td, color: t.text1 }}>{Number(b.bill_count).toLocaleString('en-IN')}</td>
                  <td style={{ ...td, color: t.text1 }}>{fmt(b.gross_weight)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={{ ...td, color: t.gold }}>{fmt(b.net_weight)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={{ ...td, color: t.green }}>{fmtVal(b.total_value)}</td>
                  <td style={{ ...td, color: t.gold }}>{Number(b.physical_count).toLocaleString('en-IN')}</td>
                  <td style={{ ...td, color: t.blue }}>{Number(b.takeover_count).toLocaleString('en-IN')}</td>
                  <td style={{ ...td, color: t.text3, fontSize: '.68rem' }}>{fmtDate(b.first_dispatch)}</td>
                  <td style={{ ...td, color: t.orange, fontSize: '.68rem' }}>{fmtDate(b.last_dispatch)}</td>
                </tr>
              ))}
              {!loading && branchRows.length === 0 && (
                <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: t.text4, padding: '60px' }}>No dispatched bills found for this period</td></tr>
              )}
            </tbody>
            {branchRows.length > 0 && (
              <tfoot>
                <tr style={{ background: t.card2, borderTop: `2px solid ${t.border}` }}>
                  <td style={{ ...td, color: t.text4 }} />
                  <td style={{ ...td, color: t.gold, fontWeight: 600 }}>TOTAL</td>
                  <td colSpan={2} />
                  <td style={{ ...td, color: t.text1, fontWeight: 600 }}>{kpis.count.toLocaleString('en-IN')}</td>
                  <td style={{ ...td, color: t.text1, fontWeight: 600 }}>{fmt(kpis.gross)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={{ ...td, color: t.gold, fontWeight: 600 }}>{fmt(kpis.net)}<span style={{ fontSize: '.62rem', color: t.text4 }}>g</span></td>
                  <td style={{ ...td, color: t.green, fontWeight: 600 }}>{fmtVal(kpis.value)}</td>
                  <td style={{ ...td, color: t.gold, fontWeight: 600 }}>{kpis.physical.toLocaleString('en-IN')}</td>
                  <td style={{ ...td, color: t.blue,  fontWeight: 600 }}>{kpis.takeover.toLocaleString('en-IN')}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}