'use client'

import { useState } from 'react'
import { fmt, fmtVal, fmtShort, growth, getStyles, GrowthBadge, BarChart, LineChart, HeatmapRow, CHART_COLORS, DAYS } from './reportUtils'

export default function ReportCharts({ trend, monthly, dowData, hourlyTrend, isSingleDay, t }) {
  const [trendMetric, setTrendMetric] = useState('net_wt')
  const s = getStyles(t)

  const trendData = (trend || []).map(d => ({
    ...d,
    net_wt:    Number(d.net_wt),
    value:     Number(d.value),
    txn_count: Number(d.txn_count),
    avg_purity: Number(d.avg_purity),
  }))

  const showHourly  = isSingleDay && (hourlyTrend || []).length > 1
  const chartData   = showHourly ? hourlyTrend : trendData
  const chartTitle  = showHourly ? 'Hourly Trend' : 'Daily Trend'
  const hasEnough   = chartData.length > 1

  const maxDow = Math.max(...(dowData || []).map(d => Number(d.net_wt) || 0))

  return (
    <>
      {/* ── DAILY / HOURLY TREND ── */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={s.sTitle}>{chartTitle}</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[['Net Wt', 'net_wt'], ['Value', 'value'], ['Txns', 'txn_count']].map(([l, v]) => (
              <button key={v} style={s.pill(trendMetric === v)} onClick={() => setTrendMetric(v)}>{l}</button>
            ))}
          </div>
        </div>
        {hasEnough
          ? <>
              <LineChart data={chartData} xKey="day" yKey={trendMetric} color={t.gold} height={150} t={t} />
              <div style={{ marginTop: '8px' }}>
                <BarChart data={chartData} xKey="day" yKey={trendMetric} color={`${t.gold}50`} height={50} t={t} />
              </div>
            </>
          : <div style={{ textAlign: 'center', color: t.text4, padding: '48px', fontSize: '.75rem' }}>Not enough data for trend</div>
        }
      </div>

      {/* ── PURITY TREND ── */}
      {trendData.length > 1 && trendData.some(d => d.avg_purity > 0) && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={s.sTitle}>Purity Trend</div>
            <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.08em' }}>Daily avg purity — weighted by net weight</div>
          </div>
          <LineChart data={trendData} xKey="day" yKey="avg_purity" color={t.purple} height={130} t={t} />
        </div>
      )}

      {/* ── MONTHLY SUMMARY ── */}
      {monthly?.length > 0 && (
        <div style={s.card}>
          <div style={s.sTitle}>Monthly Summary</div>
          <div style={{ overflowX: 'auto', borderRadius: '8px', border: `1px solid ${t.border}`, marginBottom: '16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Month', 'Transactions', 'Gross Wt', 'Net Wt', 'MoM', 'Value', 'Avg Purity', 'Avg Net / Txn', 'Physical', 'Takeover'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, i) => {
                  const prev = monthly[i - 1]
                  const netG = prev ? growth(Number(m.total_net), Number(prev.total_net)) : null
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${t.border}20` }}>
                      <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{m.month_label}</td>
                      <td style={s.td}>{Number(m.txn_count).toLocaleString('en-IN')}</td>
                      <td style={s.td}>{fmt(m.total_gross)}g</td>
                      <td style={{ ...s.td, color: t.gold }}>{fmt(m.total_net)}g</td>
                      <td style={s.td}>
                        {netG !== null
                          ? <GrowthBadge value={netG} t={t} />
                          : <span style={{ color: t.text4, fontSize: '.6rem' }}>—</span>
                        }
                      </td>
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

          {/* Monthly bar chart — only show if 2+ months with data */}
          {monthly.length >= 2 && (
            <BarChart
              data={monthly.map(m => ({ month_label: m.month_label, total_net: Number(m.total_net) }))}
              xKey="month_label" yKey="total_net" color={t.gold} height={80} t={t}
            />
          )}
        </div>
      )}

      {/* ── DAY OF WEEK ── */}
      {dowData?.length > 0 && (
        <div style={s.card}>
          <div style={s.sTitle}>Day of Week Analysis</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div>
              <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>Net Weight</div>
              {dowData.map((d, i) => (
                <HeatmapRow key={i} label={DAYS[d.dow] || d.dow} value={Number(d.net_wt)} max={maxDow}
                  sub={`${fmt(d.net_wt)}g`} color={t.gold} t={t} />
              ))}
            </div>
            <div>
              <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>Transactions</div>
              {dowData.map((d, i) => {
                const maxTxn = Math.max(...dowData.map(x => Number(x.txn_count) || 0))
                return (
                  <HeatmapRow key={i} label={DAYS[d.dow] || d.dow} value={Number(d.txn_count)} max={maxTxn}
                    sub={Number(d.txn_count).toLocaleString('en-IN')} color={t.blue} t={t} />
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}