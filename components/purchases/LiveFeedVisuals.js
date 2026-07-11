'use client'

import { Fragment } from 'react'

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

// Stable SVG-gradient id from a colour hex, so bars/donuts can fill with a
// vertical (id) or horizontal (id+'h') gradient defined once in <Gradients/>.
const gradId = (c) => 'lfvg' + String(c || '').replace(/[^a-z0-9]/gi, '')
const vFill  = (c) => `url(#${gradId(c)})`
const hFill  = (c) => `url(#${gradId(c)}h)`

function Gradients({ colors }) {
  const uniq = [...new Set(colors.filter(Boolean))]
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {uniq.map(c => (
          <Fragment key={c}>
            <linearGradient id={gradId(c)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={c} stopOpacity={0.95} />
              <stop offset="100%" stopColor={c} stopOpacity={0.5} />
            </linearGradient>
            <linearGradient id={`${gradId(c)}h`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"  stopColor={c} stopOpacity={0.55} />
              <stop offset="100%" stopColor={c} stopOpacity={1} />
            </linearGradient>
          </Fragment>
        ))}
      </defs>
    </svg>
  )
}

function Panel({ t, title, hint, icon, accent, children, span = 1 }) {
  const ac = accent || t.gold
  return (
    <div className="lfv-card" style={{
      gridColumn: `span ${span}`, background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)',
      display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${ac}, ${ac}22 70%, ${ac}00)` }} />
      <div style={{ padding: '15px 18px 17px', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {icon && (
            <span style={{ width: 27, height: 27, borderRadius: 9, background: `${ac}1e`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{icon}</span>
          )}
          <div style={{ fontSize: '.83rem', fontWeight: 800, color: t.text1, letterSpacing: '-.01em' }}>{title}</div>
        </div>
        {hint && <div style={{ fontSize: '.63rem', color: t.text3, marginTop: 5, lineHeight: 1.4 }}>{hint}</div>}
        <div style={{ flex: 1, marginTop: hint ? 8 : 12, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  )
}

function Kpi({ t, icon, label, value, sub, accent }) {
  return (
    <div className="lfv-kpi" style={{
      position: 'relative', background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 14, padding: '13px 16px 14px 18px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: `linear-gradient(${accent}, ${accent}66)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ width: 28, height: 28, borderRadius: 9, background: `${accent}1e`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: '.6rem', fontWeight: 800, color: t.text3, textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.7rem', fontWeight: 800, color: t.text1, lineHeight: 1, letterSpacing: '-.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: '.61rem', color: t.text4, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function ChartTip({ t, active, payload, unit }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: '7px 11px', fontSize: '.66rem', color: t.text1, boxShadow: '0 8px 24px rgba(0,0,0,.22)' }}>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 3, background: p.color || p.payload?.fill }} />
          <span style={{ color: t.text3 }}>{p.name}:</span>
          <b>{unit === 'wt' ? fmtWt(p.value) + 'g' : fmtNum(p.value)}</b>
        </div>
      ))}
    </div>
  )
}

// Donut with a centred total in the hole.
function DonutCenter({ t, value, label }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: t.text1, lineHeight: 1 }}>{value}</span>
      {label && <span style={{ fontSize: '.56rem', color: t.text4, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>}
    </div>
  )
}

const STAGE_ORDER = ['walkin', 'estimation', 'kyc', 'payment', 'completed', 'walkout']
const STAGE_LABEL = { walkin: 'Walk-in', estimation: 'Estim.', kyc: 'KYC', payment: 'Payment', completed: 'Done', walkout: 'Walkout' }

export default function LiveFeedVisuals({ t, stages, totals, typeSplit, regionRows, txns, allTxns, stageOf, viewDate, regionFilter, onClose }) {
  const stage = (k) => stages.find(s => s.key === k) || { count: 0, wt: 0, color: t.text3 }
  const stageColor = (k) => stage(k).color
  const outcomeOf = (s) => { const g = stageOf ? stageOf(s) : 'other'; return g === 'completed' ? 'completed' : g === 'walkout' ? 'walkout' : 'pipeline' }

  // ── Walk-ins by hour (stacked by outcome) ─────────────────────────────────
  const hourMap = new Map()
  for (const tx of (txns || [])) {
    const hh = parseInt(String(tx.time || '').split(':')[0])
    if (!Number.isFinite(hh)) continue
    const row = hourMap.get(hh) || { hour: hh, completed: 0, pipeline: 0, walkout: 0 }
    row[outcomeOf(tx.status)]++; hourMap.set(hh, row)
  }
  const hours = [...hourMap.keys()]
  const hourly = hours.length
    ? Array.from({ length: Math.max(...hours) - Math.min(...hours) + 1 }, (_, i) => {
        const hh = Math.min(...hours) + i
        const r = hourMap.get(hh) || { hour: hh, completed: 0, pipeline: 0, walkout: 0 }
        return { ...r, label: `${(hh % 12) || 12}${hh < 12 ? 'a' : 'p'}` }
      })
    : []

  // ── Branch leaderboard (within current filter) ────────────────────────────
  const bMap = new Map()
  for (const tx of (txns || [])) {
    const b = tx.branch_name || '—'
    const row = bMap.get(b) || { branch: b, walkins: 0, completed: 0, wt: 0 }
    row.walkins++
    if (stageOf && stageOf(tx.status) === 'completed') row.completed++
    row.wt += Number(tx.net_weight) || 0
    bMap.set(b, row)
  }
  const branches = [...bMap.values()]
    .map(r => ({ ...r, conversion: r.walkins ? Math.round(r.completed / r.walkins * 100) : 0 }))
    .sort((a, b) => b.walkins - a.walkins).slice(0, 8)

  // ── Region × Stage heatmap (all regions) ──────────────────────────────────
  const hmRegions = [...new Set((allTxns || []).map(x => x.region).filter(Boolean))]
  const heat = hmRegions.map(rg => {
    const cells = {}
    STAGE_ORDER.forEach(s => { cells[s] = 0 })
    for (const tx of allTxns) if (tx.region === rg) { const g = stageOf ? stageOf(tx.status) : 'other'; if (cells[g] != null) cells[g]++ }
    const total = STAGE_ORDER.reduce((a, s) => a + cells[s], 0)
    return { region: rg, cells, total }
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total)
  const heatMax = Math.max(1, ...heat.flatMap(r => STAGE_ORDER.map(s => r.cells[s])))
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

  const gradColors = [
    ...journey.map(j => j.fill), ...pipelineStages.map(p => p.fill),
    t.green, t.orange, t.blue, t.purple, t.red, t.gold,
  ]

  return (
    <div>
      <style>{`
        .lfv-card, .lfv-kpi { transition: transform .18s ease, box-shadow .18s ease; }
        .lfv-card:hover { transform: translateY(-3px); box-shadow: 0 14px 32px rgba(0,0,0,.10); }
        .lfv-kpi:hover  { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,.09); }
        .lfv-brow { transition: background .15s ease; border-radius: 8px; }
        .lfv-brow:hover { background: ${t.text3}0c; }
      `}</style>
      <Gradients colors={gradColors} />

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: t.text1, letterSpacing: '-.01em' }}>Journey Insights <span style={{ color: t.text4, fontWeight: 600 }}>· New CRM</span></div>
          <div style={{ fontSize: '.64rem', color: t.text3, marginTop: 3 }}>
            {dateLabel}{regionFilter ? ` · ${regionFilter}` : ' · All regions'} · {fmtNum(totals.totalWalkins)} walk-ins → {fmtNum(totals.completed)} completed
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 9, padding: '7px 15px', fontSize: '.66rem', fontWeight: 700, color: t.text2, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.05em' }}>▤ Cards view</button>
        )}
      </div>

      {/* KPI hero strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Kpi t={t} icon="👣" accent={t.blue}  label="Walk-ins"     value={fmtNum(totals.totalWalkins)} sub={`${dateLabel}`} />
        <Kpi t={t} icon="✅" accent={t.green} label="Completed"    value={fmtNum(totals.completed)}    sub={`${totals.conversionPct}% conversion`} />
        <Kpi t={t} icon="⏳" accent={t.orange} label="In pipeline"  value={fmtNum(totals.pendingCount)} sub="not yet purchased" />
        <Kpi t={t} icon="🪙" accent={t.gold}  label="Gold pending" value={fmtKg(pendingWt)}            sub="net weight in journey" />
      </div>

      <div style={{ display: 'grid', ...grid }}>
        {/* 1. Conversion gauge */}
        <Panel t={t} title="Conversion" icon="🎯" accent={t.green} hint="Walk-ins that completed a purchase today">
          <div style={{ position: 'relative', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="72%" outerRadius="100%" barSize={16}
                data={[{ name: 'Conversion', value: totals.conversionPct, fill: t.green }]}
                startAngle={90} endAngle={90 - (360 * totals.conversionPct / 100)}>
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background={{ fill: `${t.green}18` }} dataKey="value" cornerRadius={12} angleAxisId={0} fill={vFill(t.green)} isAnimationActive={false} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: '2.4rem', fontWeight: 800, color: t.green, lineHeight: 1, textShadow: `0 0 22px ${t.green}33` }}>{totals.conversionPct}%</span>
              <span style={{ fontSize: '.62rem', color: t.text3, marginTop: 6 }}>{fmtNum(totals.completed)} of {fmtNum(totals.totalWalkins)}</span>
              <span style={{ fontSize: '.58rem', color: t.text4, marginTop: 5 }}>{fmtNum(totals.pendingCount)} still in pipeline</span>
            </div>
          </div>
        </Panel>

        {/* 2. Journey stage distribution */}
        <Panel t={t} title="Where customers are" icon="📍" accent={t.gold} hint="Count at each journey stage — the tallest bar is your bottleneck">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={journey} layout="vertical" margin={{ left: 8, right: 26, top: 4, bottom: 4 }}>
              <XAxis type="number" tick={axis} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={axis} axisLine={false} tickLine={false} width={78} />
              <Tooltip cursor={{ fill: `${t.text3}10` }} content={(p) => <ChartTip t={t} {...p} />} />
              <Bar dataKey="count" radius={[0, 7, 7, 0]} isAnimationActive={false}>
                {journey.map((d, i) => <Cell key={i} fill={hFill(d.fill)} />)}
                <LabelList dataKey="count" position="right" style={{ fill: t.text2, fontSize: 11, fontWeight: 800 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* 3. Gold stuck by stage (capital view) */}
        <Panel t={t} title="Gold in the pipeline" icon="🪙" accent={t.gold} hint={`${fmtKg(pendingWt)} of gold not yet completed — by stage (net wt)`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={journey.filter(j => j.key !== 'completed')} margin={{ left: 0, right: 8, top: 16, bottom: 4 }}>
              <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
              <Tooltip cursor={{ fill: `${t.text3}10` }} content={(p) => <ChartTip t={t} unit="wt" {...p} />} />
              <Bar dataKey="wt" name="Net wt" radius={[7, 7, 0, 0]} isAnimationActive={false}>
                {journey.filter(j => j.key !== 'completed').map((d, i) => <Cell key={i} fill={vFill(d.fill)} />)}
                <LabelList dataKey="wt" position="top" formatter={(v) => fmtKg(v)} style={{ fill: t.text3, fontSize: 10, fontWeight: 800 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* 4. Pending bottleneck donut */}
        <Panel t={t} title="Pipeline bottleneck" icon="🔀" accent={t.purple} hint="How the not-yet-purchased split across stages">
          {pipelineStages.length ? (
            <div style={{ position: 'relative', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pipelineStages} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3} cornerRadius={5} stroke="none" isAnimationActive={false}>
                    {pipelineStages.map((d, i) => <Cell key={i} fill={vFill(d.fill)} />)}
                  </Pie>
                  <Tooltip content={(p) => <ChartTip t={t} {...p} />} />
                </PieChart>
              </ResponsiveContainer>
              <DonutCenter t={t} value={fmtNum(totals.pendingCount)} label="pending" />
            </div>
          ) : <Empty t={t} />}
          <Legend t={t} items={pipelineStages} total={totals.pendingCount} />
        </Panel>

        {/* 5. Region performance */}
        <Panel t={t} title="Region performance" icon="🗺️" accent={t.green} hint="Completed vs still-in-pipeline, by region" span={2}>
          {regions.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={regions} margin={{ left: 0, right: 8, top: 18, bottom: 4 }} barGap={2}>
                <XAxis dataKey="region" tick={axis} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={32} />
                <Tooltip cursor={{ fill: `${t.text3}10` }} content={(p) => <ChartTip t={t} {...p} />} />
                <Bar dataKey="completed" name="Completed" stackId="a" fill={vFill(t.green)} radius={[0, 0, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="pending"   name="In pipeline" stackId="a" fill={vFill(t.orange)} radius={[7, 7, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="conversion" position="top" formatter={(v) => `${v}%`} style={{ fill: t.text3, fontSize: 10, fontWeight: 800 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty t={t} />}
        </Panel>

        {/* 6. Physical vs Takeover */}
        <Panel t={t} title="Physical vs Takeover" icon="⚖️" accent={t.blue} hint="Transaction-type mix">
          {typePie.length ? (
            <div style={{ position: 'relative', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={typePie} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3} cornerRadius={5} stroke="none" isAnimationActive={false}>
                    {typePie.map((d, i) => <Cell key={i} fill={vFill(d.fill)} />)}
                  </Pie>
                  <Tooltip content={(p) => <ChartTip t={t} {...p} />} />
                </PieChart>
              </ResponsiveContainer>
              <DonutCenter t={t} value={fmtNum(typeSplit.physical + typeSplit.takeover)} label="deals" />
            </div>
          ) : <Empty t={t} />}
          <Legend t={t} items={typePie} total={typeSplit.physical + typeSplit.takeover} />
        </Panel>

        {/* 7. Walk-ins by hour (with outcome) */}
        <Panel t={t} title="Activity by hour" icon="🕐" accent={t.blue} hint="When customers walk in — and how those visits are trending (completed / in-pipeline / walkout)" span={2}>
          {hourly.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourly} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} barCategoryGap="18%">
                <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip cursor={{ fill: `${t.text3}10` }} content={(p) => <ChartTip t={t} {...p} />} />
                <Bar dataKey="completed" name="Completed"  stackId="h" fill={vFill(t.green)}  isAnimationActive={false} />
                <Bar dataKey="pipeline"  name="In pipeline" stackId="h" fill={vFill(t.orange)} isAnimationActive={false} />
                <Bar dataKey="walkout"   name="Walkout"     stackId="h" fill={vFill(t.red)}    radius={[5, 5, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty t={t} />}
        </Panel>

        {/* 8. Branch leaderboard */}
        <Panel t={t} title="Top branches" icon="🏆" accent={t.gold} hint="Walk-ins today, with conversion — spot the leaders & laggards" span={2}>
          {branches.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              {branches.map((b, i) => {
                const max = branches[0].walkins || 1
                return (
                  <div key={i} className="lfv-brow" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.68rem', padding: '4px 6px' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.6rem', fontWeight: 800, background: i < 3 ? `${t.gold}22` : `${t.text3}12`, color: i < 3 ? t.gold : t.text3 }}>{i + 1}</span>
                    <span style={{ width: 120, color: t.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={b.branch}>{b.branch}</span>
                    <div style={{ flex: 1, height: 15, background: `${t.text3}12`, borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
                      <div style={{ width: `${Math.round(b.walkins / max * 100)}%`, height: '100%', background: `linear-gradient(90deg, ${t.blue}88, ${t.blue})`, borderRadius: 5 }} />
                      <div style={{ position: 'absolute', left: 0, top: 0, width: `${Math.round(b.completed / max * 100)}%`, height: '100%', background: `linear-gradient(90deg, ${t.green}99, ${t.green})`, borderRadius: 5 }} />
                    </div>
                    <span style={{ width: 30, textAlign: 'right', color: t.text1, fontWeight: 800 }}>{b.walkins}</span>
                    <span style={{ width: 44, textAlign: 'right', color: b.conversion >= 40 ? t.green : b.conversion >= 20 ? t.gold : t.text3, fontWeight: 800 }}>{b.conversion}%</span>
                    <span style={{ width: 58, textAlign: 'right', color: t.text3 }}>{fmtKg(b.wt)}</span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 14, marginTop: 8, justifyContent: 'flex-end', fontSize: '.6rem', color: t.text4 }}>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, background: t.blue, borderRadius: 2, marginRight: 4 }} />walk-ins</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, background: t.green, borderRadius: 2, marginRight: 4 }} />completed</span>
                <span>conv%</span><span>net wt</span>
              </div>
            </div>
          ) : <Empty t={t} />}
        </Panel>

        {/* 9. Region × Stage heatmap */}
        <Panel t={t} title="Region × stage heatmap" icon="🔥" accent={t.orange} hint="Where each region's customers are concentrated — darker = more" span={2}>
          {heat.length ? (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${STAGE_ORDER.length}, 1fr) 54px`, gap: 4, minWidth: 460, marginTop: 4 }}>
                <div />
                {STAGE_ORDER.map(s => <div key={s} style={{ fontSize: '.56rem', color: t.text3, textAlign: 'center', fontWeight: 800, textTransform: 'uppercase', paddingBottom: 2 }}>{STAGE_LABEL[s]}</div>)}
                <div style={{ fontSize: '.56rem', color: t.text3, textAlign: 'right', fontWeight: 800, textTransform: 'uppercase' }}>Total</div>
                {heat.map(r => (
                  <Fragment key={r.region}>
                    <div style={{ fontSize: '.64rem', color: t.text2, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={r.region}>{r.region}</div>
                    {STAGE_ORDER.map(s => {
                      const v = r.cells[s]; const intensity = v / heatMax
                      const col = stageColor(s)
                      return (
                        <div key={s} title={`${r.region} · ${STAGE_LABEL[s]}: ${v}`}
                          style={{ height: 32, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: v ? `${col}${Math.round(20 + intensity * 220).toString(16).padStart(2, '0')}` : `${t.text3}0a`,
                            color: intensity > 0.5 ? '#fff' : t.text2, fontSize: '.64rem', fontWeight: 800 }}>
                          {v || ''}
                        </div>
                      )
                    })}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: '.64rem', color: t.text1, fontWeight: 800 }}>{r.total}</div>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : <Empty t={t} />}
        </Panel>
      </div>
    </div>
  )
}

function Legend({ t, items, total }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10, justifyContent: 'center' }}>
      {items.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.63rem', color: t.text2, background: `${t.text3}0e`, borderRadius: 20, padding: '4px 10px' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: d.fill }} />
          {d.name} <b style={{ color: t.text1 }}>{fmtNum(d.value)}</b>
          {total > 0 && <span style={{ color: t.text4 }}>{Math.round(d.value / total * 100)}%</span>}
        </div>
      ))}
    </div>
  )
}

function Empty({ t }) {
  return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text4, fontSize: '.7rem' }}>No data for this filter</div>
}
