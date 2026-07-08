'use client'

// LiveFeedVisuals — the "Visualise" mode for the New-CRM Customer Journey.
// Turns the same day's data (respecting the active date / region / type filters)
// into insight-driven charts: conversion, where customers are stuck, where the
// GOLD (capital) is stuck, region performance, and physical-vs-takeover mix.
import {
  BarChart, Bar, PieChart, Pie, Cell, RadialBarChart, RadialBar, PolarAngleAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts'

const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN')
const fmtWt  = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtKg  = (g) => g >= 1000 ? `${(g / 1000).toFixed(2)}kg` : `${Math.round(g)}g`

function Panel({ t, title, hint, children, span = 1 }) {
  return (
    <div style={{
      gridColumn: `span ${span}`, background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 14, padding: '16px 18px', boxShadow: '0 2px 8px rgba(0,0,0,.06)',
      display: 'flex', flexDirection: 'column', minWidth: 0,
    }}>
      <div style={{ fontSize: '.78rem', fontWeight: 800, color: t.text1, letterSpacing: '.01em' }}>{title}</div>
      {hint && <div style={{ fontSize: '.62rem', color: t.text3, marginTop: 2, marginBottom: 6 }}>{hint}</div>}
      <div style={{ flex: 1, marginTop: hint ? 0 : 10 }}>{children}</div>
    </div>
  )
}

function ChartTip({ t, active, payload, unit }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 10px', fontSize: '.66rem', color: t.text1, boxShadow: '0 4px 14px rgba(0,0,0,.18)' }}>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.payload?.fill }} />
          <span style={{ color: t.text3 }}>{p.name}:</span>
          <b>{unit === 'wt' ? fmtWt(p.value) + 'g' : fmtNum(p.value)}</b>
        </div>
      ))}
    </div>
  )
}

export default function LiveFeedVisuals({ t, stages, totals, typeSplit, regionRows, viewDate, regionFilter, onClose }) {
  const stage = (k) => stages.find(s => s.key === k) || { count: 0, wt: 0, color: t.text3 }
  // Journey order (pipeline → completed). Walkout shown separately.
  const journey = ['walkin', 'estimation', 'kyc', 'payment', 'completed'].map(k => {
    const s = stage(k)
    return { name: s.label, key: k, count: s.count, wt: s.wt, fill: s.color }
  })
  const pipelineStages = ['walkin', 'estimation', 'kyc', 'payment'].map(k => {
    const s = stage(k); return { name: s.label, value: s.count, fill: s.color }
  }).filter(d => d.value > 0)

  const pendingWt = journey.filter(j => j.key !== 'completed').reduce((a, j) => a + j.wt, 0)
  const typePie = [
    { name: 'Physical', value: typeSplit.physical, fill: t.blue },
    { name: 'Takeover', value: typeSplit.takeover, fill: t.purple },
  ].filter(d => d.value > 0)

  const regions = (regionRows || []).slice().sort((a, b) => b.walkins - a.walkins)

  const axis = { fontSize: 10, fill: t.text3 }
  const grid = { gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }
  const dateLabel = viewDate

  return (
    <div>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '.9rem', fontWeight: 800, color: t.text1 }}>Journey Insights · New CRM</div>
          <div style={{ fontSize: '.64rem', color: t.text3, marginTop: 2 }}>
            {dateLabel}{regionFilter ? ` · ${regionFilter}` : ' · All regions'} · {fmtNum(totals.totalWalkins)} walk-ins → {fmtNum(totals.completed)} completed
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 14px', fontSize: '.66rem', fontWeight: 700, color: t.text2, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.05em' }}>▤ Cards view</button>
        )}
      </div>

      <div style={{ display: 'grid', ...grid }}>
        {/* 1. Conversion gauge */}
        <Panel t={t} title="Conversion" hint="Walk-ins that completed a purchase today">
          <div style={{ position: 'relative', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="72%" outerRadius="100%" barSize={16}
                data={[{ name: 'Conversion', value: totals.conversionPct, fill: t.green }]}
                startAngle={90} endAngle={90 - (360 * totals.conversionPct / 100)}>
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background={{ fill: `${t.green}1e` }} dataKey="value" cornerRadius={12} angleAxisId={0} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: '2.2rem', fontWeight: 300, color: t.green, lineHeight: 1 }}>{totals.conversionPct}%</span>
              <span style={{ fontSize: '.6rem', color: t.text3, marginTop: 4 }}>{fmtNum(totals.completed)} of {fmtNum(totals.totalWalkins)}</span>
              <span style={{ fontSize: '.58rem', color: t.text4, marginTop: 6 }}>{fmtNum(totals.pendingCount)} still in pipeline</span>
            </div>
          </div>
        </Panel>

        {/* 2. Journey stage distribution */}
        <Panel t={t} title="Where customers are" hint="Count at each journey stage — the tallest bar is your bottleneck">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={journey} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <XAxis type="number" tick={axis} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={axis} axisLine={false} tickLine={false} width={78} />
              <Tooltip cursor={{ fill: `${t.text3}12` }} content={(p) => <ChartTip t={t} {...p} />} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive>
                {journey.map((d, i) => <Cell key={i} fill={d.fill} />)}
                <LabelList dataKey="count" position="right" style={{ fill: t.text2, fontSize: 11, fontWeight: 700 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* 3. Gold stuck by stage (capital view) */}
        <Panel t={t} title="Gold in the pipeline" hint={`${fmtKg(pendingWt)} of gold not yet completed — by stage (net wt)`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={journey.filter(j => j.key !== 'completed')} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
              <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
              <Tooltip cursor={{ fill: `${t.text3}12` }} content={(p) => <ChartTip t={t} unit="wt" {...p} />} />
              <Bar dataKey="wt" name="Net wt" radius={[6, 6, 0, 0]}>
                {journey.filter(j => j.key !== 'completed').map((d, i) => <Cell key={i} fill={d.fill} />)}
                <LabelList dataKey="wt" position="top" formatter={(v) => fmtKg(v)} style={{ fill: t.text3, fontSize: 10, fontWeight: 700 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* 4. Pending bottleneck donut */}
        <Panel t={t} title="Pipeline bottleneck" hint="How the not-yet-purchased split across stages">
          {pipelineStages.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pipelineStages} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">
                  {pipelineStages.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip content={(p) => <ChartTip t={t} {...p} />} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty t={t} />}
          <Legend t={t} items={pipelineStages} total={totals.pendingCount} />
        </Panel>

        {/* 5. Region performance */}
        <Panel t={t} title="Region performance" hint="Completed vs still-in-pipeline, by region" span={2}>
          {regions.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={regions} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} barGap={2}>
                <XAxis dataKey="region" tick={axis} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={32} />
                <Tooltip cursor={{ fill: `${t.text3}12` }} content={(p) => <ChartTip t={t} {...p} />} />
                <Bar dataKey="completed" name="Completed" stackId="a" fill={t.green} radius={[0, 0, 0, 0]} />
                <Bar dataKey="pending"   name="In pipeline" stackId="a" fill={t.orange} radius={[6, 6, 0, 0]}>
                  <LabelList dataKey="conversion" position="top" formatter={(v) => `${v}%`} style={{ fill: t.text3, fontSize: 10, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty t={t} />}
        </Panel>

        {/* 6. Physical vs Takeover */}
        <Panel t={t} title="Physical vs Takeover" hint="Transaction-type mix">
          {typePie.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={typePie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">
                  {typePie.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip content={(p) => <ChartTip t={t} {...p} />} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty t={t} />}
          <Legend t={t} items={typePie} total={typeSplit.physical + typeSplit.takeover} />
        </Panel>
      </div>
    </div>
  )
}

function Legend({ t, items, total }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, justifyContent: 'center' }}>
      {items.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.64rem', color: t.text2 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: d.fill }} />
          {d.name} <b style={{ color: t.text1 }}>{fmtNum(d.value)}</b>
          {total > 0 && <span style={{ color: t.text4 }}>({Math.round(d.value / total * 100)}%)</span>}
        </div>
      ))}
    </div>
  )
}

function Empty({ t }) {
  return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.7rem' }}>No data for this filter</div>
}
