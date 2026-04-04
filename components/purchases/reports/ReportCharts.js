'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmt, fmtVal, fmtShort, growth, getStyles, GrowthBadge, DAYS } from './reportUtils'
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine,
  Cell,
} from 'recharts'

// ─── Tooltip styles ────────────────────────────────────────────────────────────
function TipBox({ t, children }) {
  return (
    <div style={{
      background: t.card2,
      border: `1px solid ${t.border}`,
      borderRadius: '10px',
      padding: '10px 14px',
      boxShadow: t.shadowLg,
      minWidth: '130px',
    }}>
      {children}
    </div>
  )
}

// ─── Custom tooltip for area/bar ───────────────────────────────────────────────
function makeTrendTip(t, metric) {
  return function TrendTip({ active, payload, label }) {
    if (!active || !payload?.length) return null
    return (
      <TipBox t={t}>
        <div style={{ fontSize: '.6rem', color: t.text3, marginBottom: '6px', letterSpacing: '.06em' }}>
          {label}
        </div>
        {payload.map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '2px' }}>
            <span style={{ fontSize: '.62rem', color: p.color }}>{p.name}</span>
            <span style={{ fontSize: '.78rem', color: p.color, fontWeight: 600 }}>
              {metric === 'value' ? fmtVal(p.value)
                : metric === 'txn_count' ? (p.value ?? 0).toLocaleString('en-IN')
                : `${fmt(p.value)}g`}
            </span>
          </div>
        ))}
      </TipBox>
    )
  }
}

// ─── Bill scatter tooltip ──────────────────────────────────────────────────────
function BillTip({ active, payload, t }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <TipBox t={t}>
      <div style={{ fontSize: '.7rem', color: t.gold, fontWeight: 600, marginBottom: '4px' }}>{d?.timeLabel}</div>
      <div style={{ fontSize: '.65rem', color: t.text2, marginBottom: '2px' }}>{d?.customer}</div>
      <div style={{ fontSize: '.6rem', color: t.text3, marginBottom: '5px' }}>
        {d?.branch} · <span style={{ color: d?.type === 'PHYSICAL' ? t.gold : t.blue }}>{d?.type}</span>
      </div>
      <div style={{ fontSize: '.72rem', color: t.text1 }}>{fmt(d?.net_weight)}g &nbsp;·&nbsp; {fmtVal(d?.value)}</div>
    </TipBox>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function ReportCharts({ trend, monthly, dowData, hourlyTrend, isSingleDay, t, fromDate, filterBranch, filterTxn }) {
  const [trendMetric, setTrendMetric] = useState('net_wt')
  const [drillBranch, setDrillBranch]   = useState(null)
  const [branches,    setBranches]      = useState([])
  const [branchTrend, setBranchTrend]   = useState([])
  const [bills,       setBills]         = useState([])
  const [billsLoading, setBillsLoading] = useState(false)
  const s = getStyles(t)

  // Fetch branch list for drilldown picker
  useEffect(() => {
    supabase.from('branches').select('name').order('name').then(({ data }) => {
      if (data) setBranches(data.map(b => b.name))
    })
  }, [])

  // Branch-specific trend for overlay
  useEffect(() => {
    if (!drillBranch) { setBranchTrend([]); return }
    supabase.rpc('get_daily_trend', {
      p_from: fromDate || null, p_to: null,
      p_branch: drillBranch, p_txn_type: filterTxn || null, p_state: null,
    }).then(({ data }) => { if (data) setBranchTrend(data) })
  }, [drillBranch, fromDate, filterTxn])

  // Individual bills for single-day scatter timeline
  useEffect(() => {
    if (!isSingleDay || !fromDate) { setBills([]); return }
    setBillsLoading(true)
    let q = supabase.from('purchases')
      .select('transaction_time, net_weight, final_amount_crm, branch_name, customer_name, transaction_type')
      .eq('purchase_date', fromDate)
      .eq('is_deleted', false)
      .not('transaction_time', 'is', null)
    if (filterBranch) q = q.eq('branch_name', filterBranch)
    if (filterTxn)    q = q.eq('transaction_type', filterTxn)
    q.then(({ data }) => {
      if (data) {
        const mapped = data.map(r => {
          const parts = String(r.transaction_time || '').split(':')
          const h = parseInt(parts[0]), m = parseInt(parts[1] || '0')
          if (isNaN(h) || h < 0 || h > 23) return null
          const ampm = h < 12 ? 'AM' : 'PM'
          const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h
          return {
            timeMinutes: h * 60 + m,
            timeLabel:   `${h12}:${String(m).padStart(2, '0')} ${ampm}`,
            net_weight:  parseFloat(r.net_weight || 0),
            value:       parseFloat(r.final_amount_crm || 0),
            branch:      r.branch_name || '—',
            customer:    r.customer_name || '—',
            type:        r.transaction_type || '—',
          }
        }).filter(Boolean).sort((a, b) => a.timeMinutes - b.timeMinutes)
        setBills(mapped)
      }
      setBillsLoading(false)
    })
  }, [isSingleDay, fromDate, filterBranch, filterTxn])

  // ── Build merged trend data for overlay ──────────────────────────────────────
  const trendData = (trend || []).map(d => ({
    ...d,
    net_wt:    Number(d.net_wt || 0),
    value:     Number(d.value || 0),
    txn_count: Number(d.txn_count || 0),
    avg_purity: Number(d.avg_purity || 0),
  }))

  const mergedData = trendData.map(d => {
    const b = branchTrend.find(r => r.day === d.day)
    return {
      ...d,
      branch_net_wt:    b ? Number(b.net_wt)    : undefined,
      branch_value:     b ? Number(b.value)      : undefined,
      branch_txn_count: b ? Number(b.txn_count)  : undefined,
    }
  })

  const branchMetricKey = `branch_${trendMetric}`
  const metricLabel = trendMetric === 'value' ? 'Value' : trendMetric === 'txn_count' ? 'Bills' : 'Net Wt'

  const yFmt = (v) =>
    trendMetric === 'value' ? `₹${(v / 1000).toFixed(0)}k`
    : trendMetric === 'txn_count' ? String(v)
    : `${v}g`

  const TrendTip = makeTrendTip(t, trendMetric)
  const axisTick = { fill: t.text4, fontSize: 9 }
  const gridProps = { stroke: t.border, strokeOpacity: 0.45, vertical: false }

  // ── Scatter axis domain ──────────────────────────────────────────────────────
  const minT = bills.length ? Math.min(...bills.map(b => b.timeMinutes)) : 540
  const maxT = bills.length ? Math.max(...bills.map(b => b.timeMinutes)) : 1080
  const scatterDomain = [Math.floor((minT - 30) / 60) * 60, Math.ceil((maxT + 30) / 60) * 60]
  const scatterTicks  = []
  for (let m = scatterDomain[0]; m <= scatterDomain[1]; m += 60) scatterTicks.push(m)

  const pillStyle = (active) => ({
    padding: '4px 12px', borderRadius: '100px', border: `1px solid ${active ? t.gold : t.border}`,
    background: active ? `${t.gold}18` : 'transparent', color: active ? t.gold : t.text3,
    fontSize: '.62rem', cursor: 'pointer', letterSpacing: '.04em',
    fontWeight: active ? 500 : 400, transition: 'all .15s', outline: 'none',
  })

  return (
    <>
      {/* ── TREND CHART ──────────────────────────────────────────────────────── */}
      <div style={s.card}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ ...s.sTitle, marginBottom: 0 }}>
              {isSingleDay ? "Today's Transaction Timeline" : 'Daily Trend'}
            </div>
            {!isSingleDay && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '.6rem', color: t.text4 }}>Branch</span>
                <select
                  value={drillBranch || ''}
                  onChange={e => setDrillBranch(e.target.value || null)}
                  style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '4px 10px', color: drillBranch ? t.gold : t.text3, fontSize: '.62rem', cursor: 'pointer', outline: 'none' }}
                >
                  <option value="">All Branches</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[['Net Wt', 'net_wt'], ['Value', 'value'], ['Bills', 'txn_count']].map(([l, v]) => (
              <button key={v} style={pillStyle(trendMetric === v)} onClick={() => setTrendMetric(v)}>{l}</button>
            ))}
          </div>
        </div>

        {/* Single-day: scatter of individual bills */}
        {isSingleDay ? (
          billsLoading ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.72rem' }}>Loading transactions…</div>
          ) : bills.length === 0 ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.72rem' }}>No approved transactions today</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <span style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.1em' }}>
                  {bills.length} TRANSACTIONS · hover a dot for details
                </span>
                {bills.some(b => b.type === 'PHYSICAL') && (
                  <span style={{ fontSize: '.58rem', color: t.gold, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.gold, display: 'inline-block' }} /> Physical
                  </span>
                )}
                {bills.some(b => b.type === 'TAKEOVER') && (
                  <span style={{ fontSize: '.58rem', color: t.blue, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.blue, display: 'inline-block' }} /> Takeover
                  </span>
                )}
              </div>

              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid stroke={t.border} strokeOpacity={0.35} vertical={false} />
                  <XAxis
                    type="number" dataKey="timeMinutes"
                    domain={scatterDomain} ticks={scatterTicks}
                    tickFormatter={m => {
                      const h = Math.floor(m / 60)
                      return h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`
                    }}
                    tick={axisTick} axisLine={{ stroke: t.border }} tickLine={false}
                    label={{ value: 'Time of Day', position: 'insideBottom', offset: -10, fill: t.text4, fontSize: 9 }}
                  />
                  <YAxis
                    type="number"
                    dataKey={trendMetric === 'value' ? 'value' : 'net_weight'}
                    tick={axisTick} axisLine={false} tickLine={false} width={44}
                    tickFormatter={v => trendMetric === 'value' ? `₹${(v / 1000).toFixed(0)}k` : `${v}g`}
                  />
                  <Tooltip content={(props) => <BillTip {...props} t={t} />} />
                  {/* Physical bills */}
                  <Scatter
                    data={bills.filter(b => b.type !== 'TAKEOVER')}
                    fill={t.gold}
                    opacity={0.85}
                    r={5}
                    name="Physical"
                  />
                  {/* Takeover bills */}
                  <Scatter
                    data={bills.filter(b => b.type === 'TAKEOVER')}
                    fill={t.blue}
                    opacity={0.85}
                    r={5}
                    name="Takeover"
                  />
                </ScatterChart>
              </ResponsiveContainer>

              {/* Hourly bar below scatter */}
              {hourlyTrend.length > 1 && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontSize: '.56rem', color: t.text4, letterSpacing: '.12em', marginBottom: '6px' }}>HOURLY TOTALS</div>
                  <ResponsiveContainer width="100%" height={54}>
                    <BarChart data={hourlyTrend} margin={{ top: 0, right: 20, bottom: 0, left: 10 }}>
                      <XAxis dataKey="day" tick={{ fill: t.text4, fontSize: 8 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={v => trendMetric === 'value' ? fmtVal(v) : trendMetric === 'txn_count' ? v : `${fmt(v)}g`}
                        contentStyle={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', color: t.text2, fontSize: '.68rem' }}
                      />
                      <Bar dataKey={trendMetric} fill={t.gold} fillOpacity={0.5} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )

        ) : (
          /* Multi-day: area chart with optional branch overlay */
          mergedData.length < 2 ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.72rem' }}>Not enough data for this period</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={mergedData} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
                  <defs>
                    <linearGradient id="ga_all" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={t.gold} stopOpacity={0.28} />
                      <stop offset="95%" stopColor={t.gold} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ga_branch" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={t.blue} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={t.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis
                    dataKey="day"
                    tick={axisTick} axisLine={{ stroke: t.border }} tickLine={false}
                    tickFormatter={v => fmtShort(v)}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={axisTick} axisLine={false} tickLine={false} width={44}
                    tickFormatter={yFmt}
                  />
                  <Tooltip content={<TrendTip />} />
                  <Area
                    type="monotone" dataKey={trendMetric} stroke={t.gold} strokeWidth={2}
                    fill="url(#ga_all)" dot={false} activeDot={{ r: 5, fill: t.gold, strokeWidth: 0 }}
                    name="All Branches"
                  />
                  {drillBranch && branchTrend.length > 0 && (
                    <Area
                      type="monotone" dataKey={branchMetricKey} stroke={t.blue} strokeWidth={2}
                      strokeDasharray="5 3" fill="url(#ga_branch)"
                      dot={false} activeDot={{ r: 4, fill: t.blue, strokeWidth: 0 }}
                      name={drillBranch}
                      connectNulls={false}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>

              {/* Legend */}
              {drillBranch && (
                <div style={{ marginTop: '10px', display: 'flex', gap: '16px', fontSize: '.62rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: t.text3 }}>
                    <span style={{ width: 18, height: 2, background: t.gold, display: 'inline-block', borderRadius: 2 }} />
                    All Branches
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: t.text3 }}>
                    <span style={{ width: 18, height: 2, background: t.blue, display: 'inline-block', borderRadius: 2, borderTop: '1px dashed ' + t.blue }} />
                    {drillBranch}
                  </div>
                </div>
              )}
            </>
          )
        )}
      </div>

      {/* ── PURITY TREND ──────────────────────────────────────────────────────── */}
      {trendData.length > 1 && trendData.some(d => d.avg_purity > 0) && (
        <div style={s.card}>
          <div style={{ ...s.sTitle, marginBottom: '14px' }}>Purity Trend</div>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={trendData} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
              <defs>
                <linearGradient id="ga_purity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={t.purple} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={t.purple} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="day" tick={axisTick} axisLine={{ stroke: t.border }} tickLine={false} tickFormatter={fmtShort} interval="preserveStartEnd" />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={v => `${v}%`} />
              <Tooltip
                formatter={v => `${Number(v).toFixed(2)}%`}
                labelFormatter={v => fmtShort(v)}
                contentStyle={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', color: t.text2, fontSize: '.68rem' }}
              />
              <Area type="monotone" dataKey="avg_purity" stroke={t.purple} strokeWidth={2} fill="url(#ga_purity)" dot={false} activeDot={{ r: 4, fill: t.purple }} name="Avg Purity %" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── MONTHLY SUMMARY ───────────────────────────────────────────────────── */}
      {monthly?.length > 0 && (
        <div style={s.card}>
          <div style={{ ...s.sTitle, marginBottom: '14px' }}>Monthly Summary</div>

          {monthly.length >= 2 && (
            <div style={{ marginBottom: '16px' }}>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={monthly} margin={{ top: 0, right: 20, bottom: 0, left: 10 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month_label" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={v => `${v}g`} />
                  <Tooltip
                    formatter={v => `${fmt(v)}g`}
                    contentStyle={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', color: t.text2, fontSize: '.68rem' }}
                  />
                  <Bar dataKey="total_net" fill={t.gold} fillOpacity={0.85} radius={[3, 3, 0, 0]} name="Net Weight" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ overflowX: 'auto', borderRadius: '8px', border: `1px solid ${t.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Month', 'Bills', 'Gross Wt', 'Net Wt', 'MoM', 'Value', 'Avg Purity', 'Avg Net/Bill', 'Physical', 'Takeover'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, i) => {
                  const prev = monthly[i + 1]
                  const netG = prev ? growth(Number(m.total_net), Number(prev.total_net)) : null
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}20` }}>
                      <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{m.month_label}</td>
                      <td style={s.td}>{Number(m.txn_count).toLocaleString('en-IN')}</td>
                      <td style={s.td}>{fmt(m.total_gross)}g</td>
                      <td style={{ ...s.td, color: t.gold }}>{fmt(m.total_net)}g</td>
                      <td style={s.td}>{netG !== null ? <GrowthBadge value={netG} t={t} /> : <span style={{ color: t.text4 }}>—</span>}</td>
                      <td style={{ ...s.td, color: t.green }}>{fmtVal(m.total_value)}</td>
                      <td style={s.td}>{Number(m.avg_purity).toFixed(2)}%</td>
                      <td style={s.td}>{fmt(m.avg_per_txn)}g</td>
                      <td style={{ ...s.td, color: t.gold }}>{Number(m.physical_count).toLocaleString('en-IN')}</td>
                      <td style={{ ...s.td, color: t.blue }}>{Number(m.takeover_count).toLocaleString('en-IN')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DAY OF WEEK ───────────────────────────────────────────────────────── */}
      {dowData?.length > 0 && (
        <div style={s.card}>
          <div style={{ ...s.sTitle, marginBottom: '14px' }}>Day of Week Analysis</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

            <div>
              <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '10px' }}>Net Weight</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={dowData.map(d => ({ ...d, label: DAYS[d.dow] || d.dow, net_wt: Number(d.net_wt) }))}
                  layout="vertical"
                  margin={{ left: 0, right: 20, top: 0, bottom: 0 }}
                >
                  <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={v => `${v}g`} />
                  <YAxis type="category" dataKey="label" tick={{ fill: t.text3, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    formatter={v => `${fmt(v)}g`}
                    contentStyle={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', color: t.text2, fontSize: '.68rem' }}
                  />
                  <Bar dataKey="net_wt" fill={t.gold} fillOpacity={0.8} radius={[0, 3, 3, 0]} name="Net Wt" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div>
              <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '10px' }}>Transactions</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={dowData.map(d => ({ ...d, label: DAYS[d.dow] || d.dow, txn_count: Number(d.txn_count) }))}
                  layout="vertical"
                  margin={{ left: 0, right: 20, top: 0, bottom: 0 }}
                >
                  <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" tick={{ fill: t.text3, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    formatter={v => v.toLocaleString('en-IN')}
                    contentStyle={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', color: t.text2, fontSize: '.68rem' }}
                  />
                  <Bar dataKey="txn_count" fill={t.blue} fillOpacity={0.8} radius={[0, 3, 3, 0]} name="Bills" />
                </BarChart>
              </ResponsiveContainer>
            </div>

          </div>
        </div>
      )}
    </>
  )
}
