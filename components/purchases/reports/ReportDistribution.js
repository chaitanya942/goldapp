'use client'

import { useState, useEffect } from 'react'
import { fmt, fmtVal, pct, getStyles, HeatmapRow } from './reportUtils'

// ─────────────────────────────────────────────
// EXPANDABLE PANEL
// ─────────────────────────────────────────────
function Panel({ id, expanded, onExpand, onClose, t, cardStyle = {}, noExpand = false, children }) {
  const isExp = !noExpand && expanded === id

  useEffect(() => {
    if (!isExp) return
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [isExp, onClose])

  return (
    <>
      {isExp && (
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(7px)', WebkitBackdropFilter: 'blur(7px)',
          cursor: 'pointer',
        }} />
      )}
      <div
        onClick={() => !noExpand && !isExp && onExpand(id)}
        style={{
          ...cardStyle,
          position: isExp ? 'fixed' : 'relative',
          ...(isExp ? {
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(1200px, 96vw)',
            maxHeight: '92vh', overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 28px 72px rgba(0,0,0,0.85)',
            cursor: 'default',
          } : {
            cursor: noExpand ? 'default' : 'pointer',
          }),
        }}
      >
        {isExp && (
          <button onClick={(e) => { e.stopPropagation(); onClose() }} style={{
            position: 'sticky', top: 0, float: 'right',
            background: 'transparent', border: 'none',
            color: t.text3, fontSize: '1rem', cursor: 'pointer',
            padding: '0 0 8px 12px', lineHeight: 1, zIndex: 2,
          }}>✕</button>
        )}
        <div style={{ zoom: isExp ? 1.35 : 1 }}>
          {children}
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────
// LOCAL COMPONENTS
// ─────────────────────────────────────────────

function DonutChart({ physical, takeover, t }) {
  const total = physical + takeover
  if (!total) return null
  const r = 40, cx = 60, cy = 60, sw = 14, circ = 2 * Math.PI * r
  const phPct = physical / total
  return (
    <svg width="120" height="120">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.border} strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.blue} strokeWidth={sw}
        strokeDasharray={`${circ} 0`} strokeDashoffset={phPct * circ}
        transform={`rotate(-90 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.gold} strokeWidth={sw}
        strokeDasharray={`${phPct * circ} ${circ}`}
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={t.text1} fontSize="13" fontWeight="700">{Math.round(phPct * 100)}%</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill={t.text3} fontSize="8">Physical</text>
    </svg>
  )
}

function StatBox({ label, value, color, t, sub }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '.82rem', color, fontWeight: 500, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: '.55rem', color: t.text3, marginTop: '2px' }}>{sub}</div>}
      <div style={{ fontSize: '.5rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '4px' }}>{label}</div>
    </div>
  )
}

function SectionTitle({ title, t, badge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
      <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 500 }}>{title}</div>
      {badge && (
        <div style={{ fontSize: '.48rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', background: t.border, padding: '2px 6px', borderRadius: '4px' }}>{badge}</div>
      )}
    </div>
  )
}

function Divider({ t }) {
  return <div style={{ height: '1px', background: t.border, margin: '12px 0' }} />
}

function InsightChip({ icon, text, color, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: `${color}0d`, borderLeft: `3px solid ${color}`, borderRadius: '0 6px 6px 0', padding: '8px 12px' }}>
      <span style={{ fontSize: '.8rem', lineHeight: 1.2, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: '.64rem', color: t.text2, lineHeight: 1.6 }}>{text}</span>
    </div>
  )
}

function DualMetric({ leftLabel, leftVal, leftColor, rightLabel, rightVal, rightColor, t }) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      {[{ label: leftLabel, val: leftVal, color: leftColor }, { label: rightLabel, val: rightVal, color: rightColor }].map(({ label, val, color }, i) => (
        <div key={i} style={{ flex: 1, background: `${color}0f`, border: `1px solid ${color}22`, borderRadius: '6px', padding: '9px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: '.82rem', color, fontWeight: 400 }}>{val}</div>
          <div style={{ fontSize: '.5rem', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: '4px' }}>{label}</div>
        </div>
      ))}
    </div>
  )
}

function RankRow({ rank, label, value, sub, color, t, isTop }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: `1px solid ${t.border}` }}>
      <div style={{ width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, background: isTop ? color : t.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.5rem', color: isTop ? '#000' : t.text4, fontWeight: 700 }}>{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '.65rem', color: t.text1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        {sub && <div style={{ fontSize: '.55rem', color: t.text4 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: '.7rem', color, fontWeight: 400, flexShrink: 0 }}>{value}</div>
    </div>
  )
}

function ConcentrationBar({ label, topLabel, topPct, restPct, topColor, restColor, t }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '.62rem', color: t.text3 }}>{label}</span>
        <span style={{ fontSize: '.65rem', color: topColor, fontWeight: 400 }}>{topPct}% in {topLabel}</span>
      </div>
      <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ flex: topPct, background: topColor }} />
        <div style={{ flex: restPct, background: restColor, opacity: 0.3 }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// COLUMN WIDTH CONSTANTS
// ─────────────────────────────────────────────
const ROW_LABEL = '46px'
const ROW_TXNS  = '46px'
const ROW_NEWT  = '72px'
const ROW_VAL   = '78px'
const ROW_RATE  = '52px'
const ROW_AVG   = '52px'

const hdr = (w, align = 'right') => ({ width: w, flexShrink: 0, textAlign: align, fontSize: '.48rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.08em' })
const val = (w, color, size = '.68rem') => ({ width: w, flexShrink: 0, textAlign: 'right', fontSize: size, color, fontWeight: 400 })

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

export default function ReportDistribution({ kpis, purityDist, weightBuckets, regionSplit, monthHalf, t }) {
  const s = getStyles(t)
  const [expanded, setExpanded] = useState(null)
  const openPanel  = (id) => setExpanded(id)
  const closePanel = () => setExpanded(null)

  // ── counts ──
  const physical  = Number(kpis?.physical_count || 0)
  const takeover  = Number(kpis?.takeover_count || 0)
  const total     = Number(kpis?.total_count || 1)
  const physVal   = Number(kpis?.physical_value || 0)
  const tkVal     = Number(kpis?.takeover_value || 0)
  const totalVal  = Number(kpis?.total_value || 0)
  const physAvgWt = physical > 0 && kpis?.physical_net ? Number(kpis.physical_net) / physical : null
  const tkAvgWt   = takeover > 0 && kpis?.takeover_net ? Number(kpis.takeover_net) / takeover : null

  // ── purity aggregates ──
  const totalPurityTxns = (purityDist || []).reduce((s, d) => s + (Number(d.count) || 0), 0)
  const topPurityByTxn  = (purityDist || []).reduce((b, d) => Number(d.count) > Number(b?.count || 0) ? d : b, null)

  // ── weight aggregates ──
  const totalWtTxns    = (weightBuckets || []).reduce((s, d) => s + (Number(d.count) || 0), 0)
  const topWtBucket    = (weightBuckets || []).reduce((b, d) => Number(d.count) > Number(b?.count || 0) ? d : b, null)
  const topWtPct       = topWtBucket && totalWtTxns > 0 ? Math.round((Number(topWtBucket.count) / totalWtTxns) * 100) : 0
  const weightedPurity = totalWtTxns > 0 ? (weightBuckets || []).reduce((s, d) => s + Number(d.avg_purity) * Number(d.count), 0) / totalWtTxns : 0

  // ── region ──
  const sortedRegions      = [...(regionSplit || [])].sort((a, b) => Number(b.total_txns) - Number(a.total_txns))
  const totalRegionTxns    = (regionSplit || []).reduce((s, r) => s + Number(r.total_txns), 0)
  const highTakeoverRegion = (regionSplit || []).reduce((worst, r) => {
    const tkP = r.total_txns > 0 ? r.takeover_count / r.total_txns : 0
    const wP  = worst ? worst.takeover_count / worst.total_txns : 0
    return tkP > wP ? r : worst
  }, null)

  // ── month half ──
  const firstHalf    = (monthHalf || []).find(h => h.half === 'First Half')
  const secondHalf   = (monthHalf || []).find(h => h.half === 'Second Half')
  const halfTotal    = (Number(firstHalf?.txn_count) || 0) + (Number(secondHalf?.txn_count) || 0)
  const secondBusier = Number(secondHalf?.txn_count || 0) >= Number(firstHalf?.txn_count || 0)
  const fhDaily      = firstHalf  ? (Number(firstHalf.txn_count)  / 15).toFixed(1) : null
  const shDaily      = secondHalf ? (Number(secondHalf.txn_count) / 16).toFixed(1) : null

  // ── auto insights ──
  const insights = []
  if (topPurityByTxn) {
    const p = totalPurityTxns > 0 ? Math.round((Number(topPurityByTxn.count) / totalPurityTxns) * 100) : 0
    insights.push({ icon: '💎', color: t.purple, text: `${topPurityByTxn.bucket} purity dominates — ${p}% of all transactions.` })
  }
  if (topWtBucket)
    insights.push({ icon: '⚖️', color: t.blue, text: `${topWtBucket.bucket}g is the most common weight bucket at ${topWtPct}% of transactions.` })
  if (weightBuckets?.length > 0) {
    const topSvc = weightBuckets.reduce((b, d) => Number(d.avg_service_charge) > Number(b?.avg_service_charge || 0) ? d : b, null)
    if (topSvc) insights.push({ icon: '💰', color: t.orange, text: `Smaller purchases (${topSvc.bucket}g) attract the highest service charge at ${Number(topSvc.avg_service_charge).toFixed(2)}%.` })
  }
  if (fhDaily && shDaily) {
    const busierPct = halfTotal > 0 ? Math.round((Number(secondBusier ? secondHalf?.txn_count : firstHalf?.txn_count) / halfTotal) * 100) : 0
    insights.push({ icon: '📅', color: t.gold, text: `${secondBusier ? 'Second' : 'First'} half of the month accounts for ${busierPct}% of business.` })
  }
  if (highTakeoverRegion && regionSplit?.length > 0) {
    const tkP = Math.round((highTakeoverRegion.takeover_count / highTakeoverRegion.total_txns) * 100)
    if (tkP > 15) insights.push({ icon: '⚠️', color: t.red, text: `${highTakeoverRegion.region} has the highest takeover ratio at ${tkP}% — consider retention focus.` })
  }

  const P = (id, extra = {}, noExp = false) => ({ id, expanded, onExpand: openPanel, onClose: closePanel, t, noExpand: noExp, cardStyle: { ...s.card, marginBottom: 0, ...extra } })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── KEY INSIGHTS ── */}
      {insights.length > 0 && (
        <Panel {...P('key-insights')}>
          <SectionTitle title="Key Insights" t={t} badge={`${insights.length} findings`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {insights.map((ins, i) => <InsightChip key={i} icon={ins.icon} text={ins.text} color={ins.color} t={t} />)}
          </div>
        </Panel>
      )}

      {/* ══ ROW 1 — Transaction Split · Purity Distribution ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* TXN SPLIT */}
        <Panel {...P('txn-split')}>
          <SectionTitle title="Transaction Split" t={t} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <div style={{ flexShrink: 0 }}>
              <DonutChart physical={physical} takeover={takeover} t={t} />
            </div>
            <div style={{ flex: 1 }}>
              {[{ label: 'Physical', count: physical, color: t.gold }, { label: 'Takeover', count: takeover, color: t.blue }].map(item => {
                const p = pct(item.count, total)
                return (
                  <div key={item.label} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '.72rem', color: t.text2 }}>{item.label}</span>
                      <span style={{ fontSize: '.72rem', color: item.color, fontWeight: 400 }}>{item.count.toLocaleString('en-IN')} ({p}%)</span>
                    </div>
                    <div style={{ height: '5px', borderRadius: '3px', background: t.border }}>
                      <div style={{ height: '100%', width: `${p}%`, background: item.color, borderRadius: '3px' }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '.62rem', color: t.text4 }}>Total: <span style={{ color: t.text1, fontWeight: 400 }}>{total.toLocaleString('en-IN')} bills</span></span>
              </div>
            </div>
          </div>
          <Divider t={t} />
          {(() => {
            const physNet = Number(kpis?.physical_net || 0)
            const tkNet   = Number(kpis?.takeover_net || 0)
            const totNet  = Number(kpis?.total_net || 0)
            const avgNet  = total > 0 ? totNet / total : 0
            const gCols   = '80px 1fr 1.4fr 2fr 1fr'
            const gHdr    = (align = 'right') => ({ fontSize: '.48rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.08em', textAlign: align })
            const gVal    = (color, size = '.68rem') => ({ fontSize: size, color, fontWeight: 400, textAlign: 'right' })
            const bdr     = { borderBottom: `1px solid ${t.border}` }
            return (
              <div style={{ display: 'grid', gridTemplateColumns: gCols, gap: '0 8px', width: '100%' }}>
                <div /><div style={gHdr()}>Bills</div><div style={gHdr()}>Net Wt</div><div style={gHdr()}>Gross Value</div><div style={gHdr()}>Avg/Bill</div>
                <div style={{ display:'flex',alignItems:'center',gap:'5px',padding:'7px 0',...bdr }}><div style={{width:'7px',height:'7px',borderRadius:'50%',background:t.gold,flexShrink:0}}/><span style={{fontSize:'.65rem',color:t.text2}}>Physical</span></div>
                <div style={{...gVal(t.gold),padding:'7px 0',...bdr}}>{physical.toLocaleString('en-IN')}</div>
                <div style={{...gVal(t.gold),padding:'7px 0',...bdr}}>{fmt(physNet)}g</div>
                <div style={{...gVal(t.gold),padding:'7px 0',...bdr}}>{fmtVal(physVal)}</div>
                <div style={{...gVal(t.text3,'.62rem'),padding:'7px 0',...bdr}}>{physAvgWt ? `${fmt(physAvgWt)}g` : '—'}</div>
                <div style={{ display:'flex',alignItems:'center',gap:'5px',padding:'7px 0',...bdr }}><div style={{width:'7px',height:'7px',borderRadius:'50%',background:t.blue,flexShrink:0}}/><span style={{fontSize:'.65rem',color:t.text2}}>Takeover</span></div>
                <div style={{...gVal(t.blue),padding:'7px 0',...bdr}}>{takeover.toLocaleString('en-IN')}</div>
                <div style={{...gVal(t.blue),padding:'7px 0',...bdr}}>{fmt(tkNet)}g</div>
                <div style={{...gVal(t.blue),padding:'7px 0',...bdr}}>{fmtVal(tkVal)}</div>
                <div style={{...gVal(t.text3,'.62rem'),padding:'7px 0',...bdr}}>{tkAvgWt ? `${fmt(tkAvgWt)}g` : '—'}</div>
                <div style={{paddingTop:'8px'}}><span style={{fontSize:'.55rem',color:t.text4,textTransform:'uppercase',letterSpacing:'.08em'}}>Total</span></div>
                <div style={{...gVal(t.text1,'.74rem'),paddingTop:'8px'}}>{total.toLocaleString('en-IN')}</div>
                <div style={{...gVal(t.text1,'.74rem'),paddingTop:'8px'}}>{fmt(totNet)}g</div>
                <div style={{...gVal(t.green,'.74rem'),paddingTop:'8px'}}>{fmtVal(totalVal)}</div>
                <div style={{...gVal(t.text2,'.68rem'),paddingTop:'8px'}}>{fmt(avgNet)}g</div>
              </div>
            )
          })()}
        </Panel>

        {/* PURITY DISTRIBUTION */}
        <Panel {...P('purity-dist')}>
          <SectionTitle title="Purity Distribution" t={t} />
          {purityDist?.length > 0 ? (() => {
            const maxCount = Math.max(...purityDist.map(d => Number(d.count) || 0))
            const totTxns  = purityDist.reduce((s, d) => s + (Number(d.count) || 0), 0)
            const totNet   = purityDist.reduce((s, d) => s + (Number(d.net_wt) || 0), 0)
            const totVal   = purityDist.reduce((s, d) => s + (Number(d.total_value) || 0), 0)
            const totRate  = totNet > 0 ? totVal / totNet : 0
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <div style={{ width: ROW_LABEL, flexShrink: 0 }} /><div style={{ flex: 1 }} />
                  <div style={hdr(ROW_TXNS)}>Txns</div><div style={hdr(ROW_NEWT)}>Net Wt</div><div style={hdr(ROW_VAL)}>Value</div><div style={hdr(ROW_RATE)}>₹/g</div>
                </div>
                {purityDist.map((d, i) => {
                  const count  = Number(d.count) || 0
                  const netWt  = Number(d.net_wt) || 0
                  const valAmt = Number(d.total_value) || 0
                  const rate   = netWt > 0 ? valAmt / netWt : 0
                  const barPct = maxCount > 0 ? (count / maxCount) * 100 : 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                      <div style={{ width: ROW_LABEL, fontSize: '.62rem', color: t.text3, textAlign: 'right', flexShrink: 0 }}>{d.bucket}</div>
                      <div style={{ flex: 1, height: '18px', background: t.border, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(barPct, 2)}%`, height: '100%', background: `linear-gradient(90deg, ${t.purple}cc, ${t.purple})`, borderRadius: '4px', transition: 'width .5s ease' }} />
                      </div>
                      <div style={val(ROW_TXNS, t.text1)}>{count.toLocaleString('en-IN')}</div>
                      <div style={val(ROW_NEWT, t.gold)}>{fmt(netWt)}g</div>
                      <div style={val(ROW_VAL,  t.green)}>{fmtVal(valAmt)}</div>
                      <div style={val(ROW_RATE, t.text2, '.62rem')}>{Math.round(rate).toLocaleString('en-IN')}</div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderTop: `1px solid ${t.border}`, paddingTop: '7px', marginTop: '3px' }}>
                  <div style={{ width: ROW_LABEL, fontSize: '.55rem', color: t.text4, textAlign: 'right', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.06em' }}>Total</div>
                  <div style={{ flex: 1 }} />
                  <div style={val(ROW_TXNS, t.text1, '.72rem')}>{totTxns.toLocaleString('en-IN')}</div>
                  <div style={val(ROW_NEWT, t.gold,  '.72rem')}>{fmt(totNet)}g</div>
                  <div style={val(ROW_VAL,  t.green, '.72rem')}>{fmtVal(totVal)}</div>
                  <div style={val(ROW_RATE, t.text2, '.68rem')}>{Math.round(totRate).toLocaleString('en-IN')}</div>
                </div>
                <Divider t={t} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <StatBox label="Avg Purity"   value={`${Number(kpis?.avg_purity || 0).toFixed(2)}%`} color={t.purple} t={t} />
                  <StatBox label="Most Common"  value={topPurityByTxn?.bucket || '—'}                  color={t.text2}  t={t} />
                  <StatBox label="Total Net Wt" value={`${fmt(purityDist.reduce((s,d)=>s+(Number(d.net_wt)||0),0))}g`} color={t.gold} t={t} />
                </div>
              </>
            )
          })() : <div style={{ color: t.text4, fontSize: '.72rem', textAlign: 'center', padding: '30px' }}>No data</div>}
        </Panel>
      </div>

      {/* ══ ROW 2 — Weight Buckets · Svc Charge by Weight ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* WEIGHT BUCKETS */}
        <Panel {...P('weight-buckets')}>
          <SectionTitle title="Weight Buckets — Net Weight" t={t} />
          {weightBuckets?.length > 0 ? (() => {
            const maxNet  = Math.max(...weightBuckets.map(d => Number(d.total_net) || 0))
            const totTxns = weightBuckets.reduce((s, d) => s + (Number(d.count) || 0), 0)
            const totNet  = weightBuckets.reduce((s, d) => s + (Number(d.total_net) || 0), 0)
            const totAvg  = totTxns > 0 ? totNet / totTxns : 0
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <div style={{ width: ROW_LABEL, flexShrink: 0 }} /><div style={{ flex: 1 }} />
                  <div style={hdr(ROW_TXNS)}>Txns</div><div style={hdr(ROW_NEWT)}>Net Wt</div><div style={hdr(ROW_AVG)}>Avg/Txn</div>
                </div>
                {weightBuckets.map((d, i) => {
                  const netWt  = Number(d.total_net) || 0
                  const txns   = Number(d.count) || 0
                  const avgNet = txns > 0 ? netWt / txns : 0
                  const barPct = maxNet > 0 ? (netWt / maxNet) * 100 : 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                      <div style={{ width: ROW_LABEL, fontSize: '.65rem', color: t.text3, textAlign: 'right', flexShrink: 0 }}>{d.bucket}</div>
                      <div style={{ flex: 1, height: '18px', background: t.border, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(barPct, 2)}%`, height: '100%', background: `linear-gradient(90deg, ${t.blue}cc, ${t.blue})`, borderRadius: '4px', transition: 'width .5s ease' }} />
                      </div>
                      <div style={val(ROW_TXNS, t.text1)}>{txns.toLocaleString('en-IN')}</div>
                      <div style={val(ROW_NEWT, t.blue)}>{fmt(netWt)}g</div>
                      <div style={val(ROW_AVG,  t.text2, '.62rem')}>{fmt(avgNet)}g</div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderTop: `1px solid ${t.border}`, paddingTop: '7px', marginTop: '3px' }}>
                  <div style={{ width: ROW_LABEL, fontSize: '.55rem', color: t.text4, textAlign: 'right', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.06em' }}>Total</div>
                  <div style={{ flex: 1 }} />
                  <div style={val(ROW_TXNS, t.text1, '.72rem')}>{totTxns.toLocaleString('en-IN')}</div>
                  <div style={val(ROW_NEWT, t.gold,  '.72rem')}>{fmt(totNet)}g</div>
                  <div style={val(ROW_AVG,  t.text2, '.68rem')}>{fmt(totAvg)}g</div>
                </div>
                <Divider t={t} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <StatBox label="Most Net Wt" value={weightBuckets.reduce((b, d) => Number(d.total_net) > Number(b?.total_net || 0) ? d : b, null)?.bucket || '—'} color={t.blue} t={t} />
                  <StatBox label="Most Txns"   value={topWtBucket?.bucket || '—'} color={t.text2} t={t} />
                  {/* FIX: guard Math.max on empty array */}
                  <StatBox label="Highest Avg" value={`${fmt(weightBuckets.length > 0 ? Math.max(...weightBuckets.map(d => Number(d.count) > 0 ? Number(d.total_net) / Number(d.count) : 0)) : 0)}g`} color={t.text3} t={t} />
                </div>
                <Divider t={t} />
                <ConcentrationBar
                  label="Net Wt Concentration"
                  topLabel={weightBuckets.reduce((b, d) => Number(d.total_net) > Number(b?.total_net || 0) ? d : b, null)?.bucket || '—'}
                  topPct={(() => { const tn = weightBuckets.reduce((s,d)=>s+(Number(d.total_net)||0),0); const top = Math.max(...weightBuckets.map(d=>Number(d.total_net)||0)); return tn>0?Math.round((top/tn)*100):0 })()}
                  restPct={(() => { const tn = weightBuckets.reduce((s,d)=>s+(Number(d.total_net)||0),0); const top = Math.max(...weightBuckets.map(d=>Number(d.total_net)||0)); return tn>0?100-Math.round((top/tn)*100):100 })()}
                  topColor={t.blue} restColor={t.text4} t={t}
                />
              </>
            )
          })() : <div style={{ color: t.text4, fontSize: '.72rem', textAlign: 'center', padding: '30px' }}>No data</div>}
        </Panel>

        {/* SVC CHARGE % BY WEIGHT */}
        <Panel {...P('svc-weight')}>
          <SectionTitle title="Avg Service Charge % by Weight" t={t} />
          {weightBuckets?.length > 0 ? (() => {
            const maxSvc = Math.max(...weightBuckets.map(d => Number(d.avg_service_charge) || 0)) || 1
            return (
              <>
                {weightBuckets.map((d, i) => (
                  <HeatmapRow key={i} label={d.bucket} value={Number(d.avg_service_charge)} max={maxSvc} sub={`${Number(d.avg_service_charge).toFixed(2)}%`} color={t.orange} t={t} />
                ))}
                <Divider t={t} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <StatBox label="Highest Svc %" value={`${Number(weightBuckets.reduce((b,d)=>Number(d.avg_service_charge)>Number(b?.avg_service_charge||0)?d:b,null)?.avg_service_charge||0).toFixed(2)}%`} color={t.orange} t={t} />
                  <StatBox label="Lowest Svc %"  value={`${Number(weightBuckets.reduce((b,d)=>Number(d.avg_service_charge)<Number(b?.avg_service_charge??Infinity)?d:b,null)?.avg_service_charge||0).toFixed(2)}%`} color={t.text2} t={t} />
                </div>
              </>
            )
          })() : <div style={{ color: t.text4, fontSize: '.72rem', textAlign: 'center', padding: '30px' }}>No data</div>}
        </Panel>
      </div>

      {/* ══ ROW 3 — Avg Purity by Weight · Svc Charge by Purity ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* AVG PURITY BY WEIGHT — FIX: guard Math.min/max on empty purities array */}
        <Panel {...P('purity-weight')}>
          <SectionTitle title="Avg Purity by Weight Bucket" t={t} />
          {weightBuckets?.length > 0 ? (() => {
            const purities = weightBuckets.map(d => Number(d.avg_purity) || 0).filter(Boolean)
            const minP  = purities.length > 0 ? Math.min(...purities) : 0
            const maxP  = purities.length > 0 ? Math.max(...purities) : 1
            const range = maxP - minP || 0.01
            return (
              <>
                {weightBuckets.map((d, i) => {
                  const p      = Number(d.avg_purity) || 0
                  const barPct = range > 0 ? Math.max(((p - minP) / range) * 100, 4) : 50
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ width: ROW_LABEL, fontSize: '.65rem', color: t.text3, textAlign: 'right', flexShrink: 0 }}>{d.bucket}</div>
                      <div style={{ flex: 1, height: '18px', background: t.border, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: `linear-gradient(90deg, ${t.purple}cc, ${t.purple})`, borderRadius: '4px', transition: 'width .5s ease' }} />
                      </div>
                      <div style={{ width: '56px', fontSize: '.68rem', color: t.purple, textAlign: 'right', flexShrink: 0, fontWeight: 400 }}>{p.toFixed(2)}%</div>
                    </div>
                  )
                })}
                <div style={{ fontSize: '.5rem', color: t.text4, textAlign: 'right', marginBottom: '2px', fontStyle: 'italic' }}>bars scaled to show relative difference</div>
                <Divider t={t} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <StatBox label="Highest Purity" value={weightBuckets.reduce((b,d)=>Number(d.avg_purity)>Number(b?.avg_purity||0)?d:b,null)?.bucket||'—'} color={t.purple} t={t} />
                  <StatBox label="Lowest Purity"  value={weightBuckets.filter(d=>Number(d.avg_purity)>0).reduce((b,d)=>Number(d.avg_purity)<Number(b?.avg_purity??Infinity)?d:b,null)?.bucket||'—'} color={t.text3} t={t} />
                  <StatBox label="Weighted Avg"   value={`${weightedPurity.toFixed(2)}%`} color={t.text2} t={t} />
                </div>
              </>
            )
          })() : <div style={{ color: t.text4, fontSize: '.72rem', textAlign: 'center', padding: '30px' }}>No data</div>}
        </Panel>

        {/* SVC CHARGE % BY PURITY */}
        <Panel {...P('svc-purity')}>
          <SectionTitle title="Avg Service Charge % by Purity" t={t} />
          {purityDist?.length > 0 && purityDist.some(d => Number(d.avg_service_charge) > 0) ? (() => {
            const maxSvc = Math.max(...purityDist.map(d => Number(d.avg_service_charge) || 0)) || 1
            return (
              <>
                {purityDist.map((d, i) => (
                  <HeatmapRow key={i} label={d.bucket} value={Number(d.avg_service_charge || 0)} max={maxSvc || 1} sub={`${Number(d.avg_service_charge || 0).toFixed(2)}%`} color={t.orange} t={t} />
                ))}
                <Divider t={t} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <StatBox label="Highest Svc %" value={`${Number(purityDist.reduce((b,d)=>Number(d.avg_service_charge)>Number(b?.avg_service_charge||0)?d:b,null)?.avg_service_charge||0).toFixed(2)}%`} color={t.orange} t={t} />
                  <StatBox label="Lowest Svc %"  value={`${Number(purityDist.filter(d=>Number(d.avg_service_charge)>0).reduce((b,d)=>Number(d.avg_service_charge)<Number(b?.avg_service_charge??Infinity)?d:b,null)?.avg_service_charge||0).toFixed(2)}%`} color={t.text2} t={t} />
                </div>
              </>
            )
          })() : <div style={{ color: t.text4, fontSize: '.72rem', textAlign: 'center', padding: '30px' }}>No data — verify get_purity_distribution returns avg_service_charge</div>}
        </Panel>
      </div>

      {/* ══ ROW 4 — Region Split · Month Half ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* REGION SPLIT */}
        <Panel {...P('region-split')}>
          <SectionTitle title="Physical vs Takeover by Region" t={t} />
          {regionSplit?.length > 0
            ? sortedRegions.map((r, i) => {
                const phP   = r.total_txns > 0 ? ((r.physical_count / r.total_txns) * 100).toFixed(0) : 0
                const tkP   = 100 - Number(phP)
                const share = totalRegionTxns > 0 ? ((Number(r.total_txns) / totalRegionTxns) * 100).toFixed(1) : 0
                return (
                  <div key={i} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div>
                        <span style={{ fontSize: '.68rem', color: t.text1, fontWeight: 500 }}>{r.region}</span>
                        <span style={{ fontSize: '.52rem', color: t.text4, marginLeft: '6px' }}>{share}% of total</span>
                      </div>
                      <span style={{ fontSize: '.63rem', color: t.text2 }}>{Number(r.total_txns).toLocaleString('en-IN')} txns</span>
                    </div>
                    <div style={{ display: 'flex', height: '7px', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ flex: Number(phP), background: t.gold }} />
                      <div style={{ flex: tkP, background: t.blue }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
                      <span style={{ fontSize: '.58rem', color: t.gold }}>{phP}% Physical</span>
                      <span style={{ fontSize: '.58rem', color: t.blue }}>{tkP}% Takeover</span>
                    </div>
                  </div>
                )
              })
            : <div style={{ color: t.text4, fontSize: '.72rem', textAlign: 'center', padding: '30px' }}>No data</div>
          }
          {regionSplit?.length > 0 && (
            <>
              <Divider t={t} />
              <div style={{ fontSize: '.52rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '6px' }}>Region ranking</div>
              {sortedRegions.slice(0, 3).map((r, i) => (
                <RankRow key={i} rank={i + 1} label={r.region}
                  value={Number(r.total_txns).toLocaleString('en-IN')}
                  sub={`${r.total_txns > 0 ? Math.round((r.physical_count / r.total_txns) * 100) : 0}% physical`}
                  color={t.gold} t={t} isTop={i === 0} />
              ))}
            </>
          )}
        </Panel>

        {/* MONTH HALF */}
        <Panel {...P('month-half')}>
          <SectionTitle title="Month Half Analysis" t={t} />
          {firstHalf || secondHalf ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[
                { label: 'First Half (1–15)',   data: firstHalf,  color: t.gold, days: 15 },
                { label: 'Second Half (16–31)', data: secondHalf, color: t.blue, days: 16 },
              ].map(({ label, data, color, days }) => {
                const txnPct    = halfTotal > 0 ? ((Number(data?.txn_count) / halfTotal) * 100).toFixed(1) : 0
                const dailyRate = data ? (Number(data.txn_count) / days).toFixed(1) : '—'
                return (
                  <div key={label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '.7rem', color: t.text2 }}>{label}</span>
                      <span style={{ fontSize: '.7rem', color, fontWeight: 400 }}>{txnPct}%</span>
                    </div>
                    <div style={{ height: '6px', borderRadius: '3px', background: t.border, marginBottom: '9px' }}>
                      <div style={{ height: '100%', width: `${txnPct}%`, background: color, borderRadius: '3px', transition: 'width .5s' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
                      <StatBox label="Txns"      value={Number(data?.txn_count || 0).toLocaleString('en-IN')}   color={color}    t={t} />
                      <StatBox label="Net Wt"    value={`${fmt(data?.total_net)}g`}                             color={t.text2}  t={t} />
                      <StatBox label="Avg Svc %" value={`${Number(data?.avg_service_charge || 0).toFixed(2)}%`} color={t.orange} t={t} />
                      <StatBox label="Txns/Day"  value={dailyRate}                                               color={t.purple} t={t} />
                    </div>
                  </div>
                )
              })}
              <Divider t={t} />
              <DualMetric
                leftLabel="First Half Net Wt"   leftVal={firstHalf  ? `${fmt(firstHalf.total_net)}g`  : '—'} leftColor={t.gold}
                rightLabel="Second Half Net Wt" rightVal={secondHalf ? `${fmt(secondHalf.total_net)}g` : '—'} rightColor={t.blue}
                t={t}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: `${secondBusier ? t.blue : t.gold}0d`, borderLeft: `3px solid ${secondBusier ? t.blue : t.gold}`, borderRadius: '0 6px 6px 0', padding: '7px 10px' }}>
                <span style={{ fontSize: '.65rem', color: secondBusier ? t.blue : t.gold, fontWeight: 500 }}>{secondBusier ? '▲' : '▼'}</span>
                <span style={{ fontSize: '.62rem', color: t.text2 }}>
                  {secondBusier ? 'Second' : 'First'} half is busier
                  {fhDaily && shDaily && ` — ${secondBusier ? shDaily : fhDaily} txns/day vs ${secondBusier ? fhDaily : shDaily}`}
                </span>
              </div>
            </div>
          ) : <div style={{ color: t.text4, fontSize: '.72rem', textAlign: 'center', padding: '30px' }}>No data</div>}
        </Panel>
      </div>

      {/* ── COMING SOON — noExpand so it's not clickable ── */}
      <Panel {...P('coming-soon', { opacity: 0.45 }, true)}>
        <SectionTitle title="Time of Day Analysis — Morning vs Afternoon" t={t} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', gap: '10px' }}>
          <div style={{ fontSize: '1.4rem', opacity: .4 }}>&#x23F1;</div>
          <div style={{ fontSize: '.8rem', color: t.text2, fontWeight: 400 }}>Coming Soon</div>
          <div style={{ fontSize: '.68rem', color: t.text3, textAlign: 'center', maxWidth: '360px' }}>
            Time-of-day breakdown requires transaction timestamps. Currently the CRM exports purchase dates only — once time data is available this panel will show morning vs afternoon split by volume, value, and purity.
          </div>
        </div>
      </Panel>

    </div>
  )
}