'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { useApp } from '../../../lib/context'
import { THEMES, STATES, fmt, fmtVal, fmtDate, pct, getStyles, exportReportPDF } from './reportUtils'
import ReportCharts from './ReportCharts'
import ReportDistribution from './ReportDistribution'
import ReportBranches from './ReportBranches'
import ReportCompare from './ReportCompare'
import GoldModal from '../../ui/GoldModal'
import ReportSameDay from './ReportSameDay'
import ReportCrmInsights from './ReportCrmInsights'

const SECTIONS = [
  { key: 'charts',       label: 'Trends',       icon: '↗' },
  { key: 'distribution', label: 'Distribution',  icon: '◎' },
  { key: 'branches',     label: 'Branches',      icon: '⬡' },
  { key: 'sameday',      label: 'Same Day',      icon: '⊙' },
  { key: 'compare',      label: 'Compare',       icon: '⇄' },
  { key: 'crm',          label: 'CRM Insights',  icon: '⚡' },
]

const istNow = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const istStr = (d = istNow()) => d.toISOString().split('T')[0]

const EXPORT_COLS = [
  { key: 'purchase_date',             label: 'Date' },
  { key: 'branch_name',               label: 'Branch' },
  { key: 'customer_name',             label: 'Customer' },
  { key: 'phone_number',              label: 'Phone' },
  { key: 'application_id',            label: 'App ID' },
  { key: 'transaction_type',          label: 'Type' },
  { key: 'gross_weight',              label: 'Gross Wt (g)' },
  { key: 'stone_weight',              label: 'Stone (g)' },
  { key: 'wastage',                   label: 'Wastage (g)' },
  { key: 'net_weight',                label: 'Net Wt (g)' },
  { key: 'purity',                    label: 'Purity (%)' },
  { key: 'total_amount',              label: 'Gross Amt (₹)' },
  { key: 'service_charge_pct',        label: 'Svc %' },
  { key: 'service_charge_amount_crm', label: 'Svc Amt (₹)' },
  { key: 'final_amount_crm',          label: 'Final Amt (₹)' },
  { key: 'stock_status',              label: 'Stock Status' },
]

// ── KPI CARD ──
const DRILL_MAP = {
  'Total Transactions':    { field: 'total_count',          fmt: v => Number(v||0).toLocaleString('en-IN'),  col: 'Bills' },
  'Gross Weight':          { field: 'total_gross',          fmt: v => `${fmt(v)}g`,                          col: 'Gross Wt' },
  'Net Weight':            { field: 'total_net',            fmt: v => `${fmt(v)}g`,                          col: 'Net Wt' },
  'Avg Purity %':          { field: 'avg_purity',           fmt: v => `${Number(v||0).toFixed(2)}%`,         col: 'Avg Purity' },
  'Gross Purchase Value':  { field: 'total_value',          fmt: v => fmtVal(v),                             col: 'Value' },
  'Avg Net Wt / Bill':     { field: 'avg_net_per_txn',      fmt: v => `${fmt(v)}g`,                         col: 'Avg Net Wt' },
  'Avg Service Charge %':  { field: 'avg_service_charge_pct', fmt: v => `${Number(v||0).toFixed(2)}%`,      col: 'Avg Svc %' },
  'Avg Rate / Gram':       { field: 'avg_rate_per_gram',    fmt: v => fmtVal(v),                             col: 'Rate/g' },
  'Transacted Branches':   { field: 'total_count',          fmt: v => Number(v||0).toLocaleString('en-IN'),  col: 'Bills' },
}

function KpiCard({ label, value, sub, color, loading, onClick }) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)',
        transition: 'transform .18s ease, box-shadow .18s ease',
        height: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,0,0,.5), 0 0 0 1px ${color}30`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: '16px', right: '16px', height: '1.5px', background: `linear-gradient(90deg, transparent, ${color}70, transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '.55rem', color: 'var(--text3)', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500 }}>{label}</div>
        {onClick && !loading && <div style={{ fontSize: '9px', color: color, opacity: 0.6, letterSpacing: '.08em' }}>↗ BRANCHES</div>}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        {loading
          ? <div style={{ height: '28px', background: 'var(--border)', borderRadius: '6px', width: '55%', animation: 'shimmer 1.5s infinite' }} />
          : <div style={{ fontSize: '1.45rem', fontWeight: 200, color, letterSpacing: '-.01em', lineHeight: 1 }}>{value ?? '—'}</div>
        }
      </div>
      {sub && !loading && (
        <div style={{ fontSize: '.6rem', color: 'var(--text3)', lineHeight: 1.4 }}>{sub}</div>
      )}
    </div>
  )
}

const autoSize = (str) => {
  const len = String(str).length
  if (len > 12) return '.85rem'
  if (len > 9)  return '1rem'
  if (len > 6)  return '1.15rem'
  return '1.3rem'
}

// ── SPLIT CARD (count OR weight) ──
function SplitCard({ title, leftLabel, leftValue, leftColor, leftSub, rightLabel, rightValue, rightColor, rightSub, loading, t }) {
  const lv = Number(leftValue)  || 0
  const rv = Number(rightValue) || 0
  return (
    <div
      style={{
        background: t.card,
        border: `1px solid ${t.border}`,
        borderRadius: '12px',
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)',
        transition: 'transform .18s ease, box-shadow .18s ease',
        height: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,0,0,.5), 0 0 0 1px ${leftColor}30`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: '16px', right: '16px', height: '1.5px', background: `linear-gradient(90deg, transparent, ${leftColor}70, transparent)` }} />
      <div style={{ fontSize: '.55rem', color: t.text3, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500 }}>{title}</div>

      {loading ? (
        <div style={{ height: '28px', background: t.border, borderRadius: '6px', width: '55%', animation: 'shimmer 1.5s infinite' }} />
      ) : (
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: autoSize(leftValue), fontWeight: 200, color: leftColor, lineHeight: 1 }}>{leftValue}</div>
            <div style={{ fontSize: '.6rem', color: leftColor, marginTop: '3px', fontWeight: 500 }}>{leftSub}</div>
          </div>
          <div style={{ width: '1px', height: '32px', background: t.border, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: autoSize(rightValue), fontWeight: 200, color: rightColor, lineHeight: 1 }}>{rightValue}</div>
            <div style={{ fontSize: '.6rem', color: rightColor, marginTop: '3px', fontWeight: 500 }}>{rightSub}</div>
          </div>
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', height: '3px', borderRadius: '2px', overflow: 'hidden', gap: '2px' }}>
          <div style={{ flex: lv, background: leftColor,  borderRadius: '2px', transition: 'flex .5s' }} />
          <div style={{ flex: rv, background: rightColor, borderRadius: '2px', transition: 'flex .5s' }} />
        </div>
      )}
    </div>
  )
}

// ── FILTER CHIP ──
function FilterChip({ label, onRemove, color }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '100px', background: `${color}15`, border: `1px solid ${color}40`, fontSize: '.62rem', color }}>
      {label}
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 0, lineHeight: 1, fontSize: '.75rem' }}>✕</button>
    </div>
  )
}

// ── MAIN ──
const SECTION_KEY_MAP = {
  charts:       'element.reports.charts',
  distribution: 'element.reports.distribution',
  branches:     'element.reports.branch_table',
  sameday:      'element.reports.same_day',
  compare:      'element.reports.period_compare',
  crm:          'element.reports.crm_insights',
}

export default function PurchaseReports() {
  const { theme, canSee } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const s = getStyles(t)

  const cssVars = {
    '--bg': t.bg, '--card': t.card, '--card2': t.card2,
    '--text1': t.text1, '--text2': t.text2, '--text3': t.text3, '--text4': t.text4,
    '--gold': t.gold, '--border': t.border, '--border2': t.border2 || t.border,
    '--green': t.green, '--red': t.red, '--blue': t.blue,
  }

  const _now = istNow()
  const _mtdFrom = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-01`
  const [fromDate,      setFromDate]      = useState(_mtdFrom)
  const [toDate,        setToDate]        = useState(istStr(_now))
  const [filterBranch,  setFilterBranch]  = useState('')
  const [filterTxn,     setFilterTxn]     = useState('')
  const [filterState,   setFilterState]   = useState('')
  const [kpis,          setKpis]          = useState(null)
  const [trend,         setTrend]         = useState([])
  const [monthly,       setMonthly]       = useState([])
  const [branchData,    setBranchData]    = useState([])
  const [stateData,     setStateData]     = useState([])
  const [dowData,       setDowData]       = useState([])
  const [purityDist,    setPurityDist]    = useState([])
  const [weightBuckets, setWeightBuckets] = useState([])
  const [regionSplit,   setRegionSplit]   = useState([])
  const [monthHalf,     setMonthHalf]     = useState([])
  const [topBills,      setTopBills]      = useState([])
  const [branches,      setBranches]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [activeSection, setActiveSection] = useState(null)
  const [exporting,     setExporting]     = useState(false)
  const [selectedKpi,   setSelectedKpi]   = useState(null)
  const [hourlyTrend,   setHourlyTrend]   = useState([])
  const [error,         setError]         = useState(null)

  useEffect(() => {
    supabase.from('branches').select('name').order('name').then(({ data }) => {
      if (data) setBranches(data.map(b => b.name))
    })
  }, [])

  useEffect(() => { fetchAll() }, [fromDate, toDate, filterBranch, filterTxn, filterState])

  const fetchAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const isSingleDay = fromDate && toDate && fromDate === toDate

      // ── 1. Branch metadata ────────────────────────────────
      const { data: branchMeta } = await supabase
        .from('branches')
        .select('name, region, state, cluster')
      const branchMetaMap = {}
      ;(branchMeta || []).forEach(b => { branchMetaMap[b.name] = b })

      // ── State filter → resolve to branch names ────────────
      let stateFilterBranches = null
      if (filterState) {
        stateFilterBranches = (branchMeta || [])
          .filter(b => b.state === filterState)
          .map(b => b.name)
      }

      // ── 2. Fetch all approved purchases (chunked) ─────────
      let rows = [], offset = 0
      const CHUNK = 1000
      while (true) {
        let q = supabase.from('purchases')
          .select('*')
          .eq('crm_status', 'approved')
          .eq('is_deleted', false)
        if (fromDate)            q = q.gte('purchase_date', fromDate)
        if (toDate)              q = q.lte('purchase_date', toDate)
        if (filterBranch)        q = q.eq('branch_name', filterBranch)
        if (filterTxn)           q = q.eq('transaction_type', filterTxn)
        if (stateFilterBranches) q = q.in('branch_name', stateFilterBranches)
        q = q.order('purchase_date', { ascending: true }).range(offset, offset + CHUNK - 1)
        const { data: chunk } = await q
        if (!chunk || chunk.length === 0) break
        rows = rows.concat(chunk)
        if (chunk.length < CHUNK) break
        offset += CHUNK
      }

      if (!rows.length) {
        setKpis(null); setTrend([]); setBranchData([]); setStateData([])
        setMonthly([]); setDowData([]); setPurityDist([]); setWeightBuckets([])
        setRegionSplit([]); setMonthHalf([]); setTopBills([])
        setHourlyTrend([])
        setLoading(false)
        return
      }

      // ── 3. KPIs ────────────────────────────────────────────
      let totalGross = 0, totalNet = 0, totalValue = 0, purityWt = 0
      let svcPctSum = 0, stoneWastageSum = 0
      let physCount = 0, takovCount = 0, physNet = 0, takovNet = 0
      const dateSet = new Set(), branchSet = new Set()

      for (const r of rows) {
        const nw = parseFloat(r.net_weight    || 0)
        const gw = parseFloat(r.gross_weight  || 0)
        const sw = parseFloat(r.stone_weight  || 0)
        const ww = parseFloat(r.wastage       || 0)
        const fa = parseFloat(r.final_amount_crm || 0)
        const pu = parseFloat(r.purity        || 0)
        const sp = parseFloat(r.service_charge_pct || 0)
        totalGross     += gw
        totalNet       += nw
        totalValue     += fa
        purityWt       += nw * pu
        svcPctSum      += sp
        stoneWastageSum += sw + ww
        if (r.transaction_type === 'PHYSICAL') { physCount++; physNet  += nw }
        else                                   { takovCount++; takovNet += nw }
        if (r.purchase_date) dateSet.add(r.purchase_date)
        if (r.branch_name)   branchSet.add(r.branch_name)
      }

      const n          = rows.length
      const avgPurity  = totalNet > 0 ? purityWt / totalNet : 0
      const sortedDates = [...dateSet].sort()

      setKpis({
        total_count:            n,
        total_gross:            totalGross,
        total_net:              totalNet,
        avg_purity:             avgPurity,
        total_value:            totalValue,
        avg_net_per_txn:        n > 0 ? totalNet   / n : 0,
        avg_service_charge_pct: n > 0 ? svcPctSum  / n : 0,
        avg_rate_per_gram:      totalNet > 0 ? totalValue / totalNet : 0,
        branch_count:           branchSet.size,
        min_date:               sortedDates[0] || null,
        max_date:               sortedDates[sortedDates.length - 1] || null,
        business_days:          sortedDates.length,
        physical_count:         physCount,
        takeover_count:         takovCount,
        physical_net:           physNet,
        takeover_net:           takovNet,
        avg_stone_wastage_bill: n > 0 ? stoneWastageSum / n : 0,
      })

      // ── 4. Daily trend ─────────────────────────────────────
      const trendMap = {}
      for (const r of rows) {
        const d = r.purchase_date; if (!d) continue
        if (!trendMap[d]) trendMap[d] = { net_wt: 0, value: 0, txn_count: 0, pw: 0 }
        const nw = parseFloat(r.net_weight || 0)
        trendMap[d].net_wt    += nw
        trendMap[d].value     += parseFloat(r.final_amount_crm || 0)
        trendMap[d].txn_count += 1
        trendMap[d].pw        += nw * parseFloat(r.purity || 0)
      }
      setTrend(
        Object.entries(trendMap).sort(([a], [b]) => a < b ? -1 : 1).map(([day, d]) => ({
          day,
          net_wt:    parseFloat(d.net_wt.toFixed(3)),
          value:     Math.round(d.value),
          txn_count: d.txn_count,
          avg_purity: d.net_wt > 0 ? parseFloat((d.pw / d.net_wt).toFixed(2)) : 0,
        }))
      )

      // ── 5. Monthly summary ─────────────────────────────────
      const monthMap = {}
      for (const r of rows) {
        if (!r.purchase_date) continue
        const m = r.purchase_date.slice(0, 7)
        if (!monthMap[m]) monthMap[m] = { txn_count: 0, gw: 0, nw: 0, val: 0, pw: 0 }
        const nw = parseFloat(r.net_weight || 0)
        monthMap[m].txn_count += 1
        monthMap[m].gw  += parseFloat(r.gross_weight || 0)
        monthMap[m].nw  += nw
        monthMap[m].val += parseFloat(r.final_amount_crm || 0)
        monthMap[m].pw  += nw * parseFloat(r.purity || 0)
      }
      setMonthly(
        Object.entries(monthMap).sort(([a], [b]) => a > b ? -1 : 1).map(([m, d]) => ({
          month:       m,
          month_label: new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
          txn_count:   d.txn_count,
          total_gross: parseFloat(d.gw.toFixed(3)),
          total_net:   parseFloat(d.nw.toFixed(3)),
          total_value: Math.round(d.val),
          avg_purity:  d.nw > 0 ? parseFloat((d.pw / d.nw).toFixed(2)) : 0,
          avg_per_txn: d.txn_count > 0 ? parseFloat((d.nw / d.txn_count).toFixed(3)) : 0,
        }))
      )

      // ── 6. Branch summary ──────────────────────────────────
      const branchAgg = {}
      for (const r of rows) {
        const bn = r.branch_name || 'Unknown'
        if (!branchAgg[bn]) {
          const meta = branchMetaMap[bn] || {}
          branchAgg[bn] = { branch_name: bn, region: meta.region || 'Unknown', state: meta.state || 'Unknown', cluster: meta.cluster || null, txn_count: 0, physical_count: 0, nw: 0, val: 0, pw: 0 }
        }
        const nw = parseFloat(r.net_weight || 0)
        branchAgg[bn].txn_count     += 1
        branchAgg[bn].nw            += nw
        branchAgg[bn].val           += parseFloat(r.final_amount_crm || 0)
        branchAgg[bn].pw            += nw * parseFloat(r.purity || 0)
        if (r.transaction_type === 'PHYSICAL') branchAgg[bn].physical_count++
      }
      setBranchData(
        Object.values(branchAgg).map(b => ({
          branch_name:    b.branch_name,
          region:         b.region,
          state:          b.state,
          cluster:        b.cluster,
          txn_count:      b.txn_count,
          physical_count: b.physical_count,
          total_net:      parseFloat(b.nw.toFixed(3)),
          total_value:    Math.round(b.val),
          avg_purity:     b.nw > 0 ? parseFloat((b.pw / b.nw).toFixed(2)) : 0,
        })).sort((a, b) => b.total_net - a.total_net)
      )
      setStateData([])  // derived from branchData in ReportBranches

      // ── 7. Day of week ─────────────────────────────────────
      const dowMap = {}
      for (const r of rows) {
        if (!r.purchase_date) continue
        const dow = new Date(r.purchase_date + 'T12:00:00').getDay()
        if (!dowMap[dow]) dowMap[dow] = { dow, net_wt: 0, txn_count: 0 }
        dowMap[dow].net_wt    += parseFloat(r.net_weight || 0)
        dowMap[dow].txn_count += 1
      }
      setDowData([0,1,2,3,4,5,6].filter(d => dowMap[d]).map(d => ({
        dow:       d,
        net_wt:    parseFloat(dowMap[d].net_wt.toFixed(3)),
        txn_count: dowMap[d].txn_count,
      })))

      // ── 8. Purity distribution ─────────────────────────────
      const PURITY_BUCKETS = [
        { label: '< 70%',  min: 0,  max: 70  },
        { label: '70–75%', min: 70, max: 75  },
        { label: '75–80%', min: 75, max: 80  },
        { label: '80–85%', min: 80, max: 85  },
        { label: '85–90%', min: 85, max: 90  },
        { label: '90–95%', min: 90, max: 95  },
        { label: '≥ 95%',  min: 95, max: 1e9 },
      ]
      const pAgg = {}
      PURITY_BUCKETS.forEach(b => { pAgg[b.label] = { count: 0, nw: 0, val: 0, spc: 0 } })
      for (const r of rows) {
        const pu  = parseFloat(r.purity || 0)
        const bkt = PURITY_BUCKETS.find(b => pu >= b.min && pu < b.max) || PURITY_BUCKETS[PURITY_BUCKETS.length - 1]
        pAgg[bkt.label].count += 1
        pAgg[bkt.label].nw    += parseFloat(r.net_weight || 0)
        pAgg[bkt.label].val   += parseFloat(r.final_amount_crm || 0)
        pAgg[bkt.label].spc   += parseFloat(r.service_charge_pct || 0)
      }
      setPurityDist(
        PURITY_BUCKETS.map(b => ({
          bucket:             b.label,
          count:              pAgg[b.label].count,
          net_wt:             parseFloat(pAgg[b.label].nw.toFixed(3)),
          total_value:        Math.round(pAgg[b.label].val),
          avg_service_charge: pAgg[b.label].count > 0 ? parseFloat((pAgg[b.label].spc / pAgg[b.label].count).toFixed(2)) : 0,
        })).filter(b => b.count > 0)
      )

      // ── 9. Weight buckets ──────────────────────────────────
      const WT_BUCKETS = [
        { label: '< 5g',    min: 0,   max: 5   },
        { label: '5–10g',   min: 5,   max: 10  },
        { label: '10–20g',  min: 10,  max: 20  },
        { label: '20–30g',  min: 20,  max: 30  },
        { label: '30–50g',  min: 30,  max: 50  },
        { label: '50–100g', min: 50,  max: 100 },
        { label: '≥ 100g',  min: 100, max: 1e9 },
      ]
      const wtAgg = {}
      WT_BUCKETS.forEach(b => { wtAgg[b.label] = { count: 0, nw: 0, pw: 0, spc: 0 } })
      for (const r of rows) {
        const nw  = parseFloat(r.net_weight || 0)
        const bkt = WT_BUCKETS.find(b => nw >= b.min && nw < b.max) || WT_BUCKETS[WT_BUCKETS.length - 1]
        wtAgg[bkt.label].count += 1
        wtAgg[bkt.label].nw   += nw
        wtAgg[bkt.label].pw   += nw * parseFloat(r.purity || 0)
        wtAgg[bkt.label].spc  += parseFloat(r.service_charge_pct || 0)
      }
      setWeightBuckets(
        WT_BUCKETS.map(b => ({
          bucket:             b.label,
          count:              wtAgg[b.label].count,
          avg_purity:         wtAgg[b.label].nw > 0 ? parseFloat((wtAgg[b.label].pw / wtAgg[b.label].nw).toFixed(2)) : 0,
          avg_service_charge: wtAgg[b.label].count > 0 ? parseFloat((wtAgg[b.label].spc / wtAgg[b.label].count).toFixed(2)) : 0,
        })).filter(b => b.count > 0)
      )

      // ── 10. Region split ───────────────────────────────────
      const regAgg = {}
      for (const r of rows) {
        const reg = branchMetaMap[r.branch_name || '']?.region || 'Unknown'
        if (!regAgg[reg]) regAgg[reg] = { region: reg, total_txns: 0, takeover_count: 0 }
        regAgg[reg].total_txns++
        if (r.transaction_type !== 'PHYSICAL') regAgg[reg].takeover_count++
      }
      setRegionSplit(Object.values(regAgg).sort((a, b) => b.total_txns - a.total_txns))

      // ── 11. Month half ─────────────────────────────────────
      let firstHalf = 0, secondHalf = 0
      for (const r of rows) {
        if (!r.purchase_date) continue
        parseInt(r.purchase_date.slice(8, 10)) <= 15 ? firstHalf++ : secondHalf++
      }
      setMonthHalf([
        { half: 'First Half',  txn_count: firstHalf  },
        { half: 'Second Half', txn_count: secondHalf },
      ])

      // ── 12. Top 10 bills by net weight ─────────────────────
      setTopBills(
        [...rows]
          .sort((a, b) => parseFloat(b.net_weight || 0) - parseFloat(a.net_weight || 0))
          .slice(0, 10)
          .map(r => ({
            branch_name:      r.branch_name,
            customer_name:    r.customer_name,
            net_weight:       parseFloat(r.net_weight   || 0),
            gross_weight:     parseFloat(r.gross_weight || 0),
            purity:           parseFloat(r.purity       || 0),
            total_amount:     parseFloat(r.final_amount_crm || 0),
            transaction_type: r.transaction_type,
            purchase_date:    r.purchase_date,
          }))
      )

      // ── 13. Hourly trend (single-day only) ─────────────────
      if (isSingleDay) {
        const hmap = {}
        for (const r of rows) {
          if (!r.transaction_time) continue
          const h = parseInt(String(r.transaction_time).split(':')[0])
          if (isNaN(h) || h < 0 || h > 23) continue
          if (!hmap[h]) hmap[h] = { net_wt: 0, value: 0, txn_count: 0 }
          hmap[h].net_wt    += parseFloat(r.net_weight || 0)
          hmap[h].value     += parseFloat(r.final_amount_crm || 0)
          hmap[h].txn_count += 1
        }
        const hours = Object.keys(hmap).map(Number)
        const minH  = 10
        const maxH  = hours.length > 0 ? Math.max(...hours) : 18
        const hourlyData = []
        for (let h = minH; h <= maxH; h++) {
          const label = h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
          hourlyData.push({
            day:       label,
            net_wt:    parseFloat((hmap[h]?.net_wt || 0).toFixed(3)),
            value:     Math.round(hmap[h]?.value || 0),
            txn_count: hmap[h]?.txn_count || 0,
            avg_purity: 0,
          })
        }
        setHourlyTrend(hourlyData)
      } else {
        setHourlyTrend([])
      }

      setLoading(false)
    } catch (err) {
      console.error('Error fetching report data:', err)
      setError(err.message || 'Failed to load report data.')
      setLoading(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      let allRows = [], from = 0
      const CHUNK = 1000
      while (true) {
        let q = supabase.from('purchases').select('*').eq('is_deleted', false).eq('crm_status', 'approved')
        if (fromDate)     q = q.gte('purchase_date', fromDate)
        if (toDate)       q = q.lte('purchase_date', toDate)
        if (filterBranch) q = q.eq('branch_name', filterBranch)
        if (filterTxn)    q = q.eq('transaction_type', filterTxn)
        q = q.order('purchase_date', { ascending: true }).range(from, from + CHUNK - 1)
        const { data } = await q
        if (!data || data.length === 0) break
        allRows = [...allRows, ...data]
        if (data.length < CHUNK) break
        from += CHUNK
      }
      const ts       = new Date().toISOString().slice(0, 10)
      const tag      = filterBranch ? `_${filterBranch}` : filterState ? `_${filterState}` : ''
      const filename = `purchase_report${tag}_${ts}.pdf`
      const meta = {
        dateRange: kpis?.min_date ? `${fmtDate(kpis.min_date)} — ${fmtDate(kpis.max_date)}` : 'All time',
        kpis: [
          { label: 'Total Transactions', value: Number(kpis?.total_count || 0).toLocaleString('en-IN') },
          { label: 'Net Weight',         value: `${fmt(kpis?.total_net)}g` },
          { label: 'Avg Purity',         value: `${Number(kpis?.avg_purity || 0).toFixed(2)}%` },
          { label: 'Gross Value',        value: fmtVal(kpis?.total_value) },
          { label: 'Avg Rate/g',         value: fmtVal(kpis?.avg_rate_per_gram) },
          { label: 'Branches',           value: Number(kpis?.branch_count || 0).toLocaleString('en-IN') },
        ],
      }
      await exportReportPDF(allRows, EXPORT_COLS, filename, meta)
    } finally {
      setExporting(false)
    }
  }

  const setToday      = () => { const d = istStr(); setFromDate(d); setToDate(d) }
  const setYesterday  = () => { const d = istNow(); d.setDate(d.getDate() - 1); const s2 = istStr(d); setFromDate(s2); setToDate(s2) }
  const setQuickRange = (days) => { const to = istNow(); const fr = istNow(); fr.setDate(fr.getDate() - days); setToDate(istStr(to)); setFromDate(istStr(fr)) }
  const setThisMonth  = () => { const now = istNow(); setFromDate(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`); setToDate(istStr(now)) }

  const hasFilters    = fromDate || toDate || filterBranch || filterTxn || filterState
  const canSeeSection = (key) => canSee(SECTION_KEY_MAP[key] ?? key)
  const showSection   = (key) => canSeeSection(key) && (!activeSection || activeSection === key)
  const visibleSections = SECTIONS.filter(sec => canSeeSection(sec.key))

  const k = kpis

  // computed
  const phTotal  = (Number(k?.physical_count) || 0) + (Number(k?.takeover_count) || 0)
  const phPct    = phTotal > 0 ? ((Number(k?.physical_count) / phTotal) * 100).toFixed(1) : '0.0'
  const tkPct    = phTotal > 0 ? ((Number(k?.takeover_count) / phTotal) * 100).toFixed(1) : '0.0'
  const nwTotal  = (Number(k?.physical_net) || 0) + (Number(k?.takeover_net) || 0)
  const phNwPct  = nwTotal > 0 ? ((Number(k?.physical_net) / nwTotal) * 100).toFixed(1) : '0.0'
  const tkNwPct  = nwTotal > 0 ? ((Number(k?.takeover_net) / nwTotal) * 100).toFixed(1) : '0.0'

  const inp = {
    background: t.card2, border: `1px solid ${t.border}`,
    borderRadius: '8px', padding: '8px 12px', color: t.text1,
    fontSize: '.72rem', outline: 'none', cursor: 'pointer',
  }
  const btnSmall = {
    background: 'transparent', color: t.text3,
    border: `1px solid ${t.border}`,
    borderRadius: '6px', padding: '6px 14px',
    fontSize: '.65rem', letterSpacing: '.06em', textTransform: 'uppercase',
    cursor: 'pointer', transition: 'all .15s',
  }

  const gridRow4 = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px', alignItems: 'stretch' }
  const gridRow5 = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '12px', alignItems: 'stretch' }
  const gridRow5b = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '28px', alignItems: 'stretch' }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '100%', ...cssVars }}>
      <style>{`
        @keyframes shimmer { 0%{opacity:.4} 50%{opacity:.8} 100%{opacity:.4} }
        .pr-pill:hover { border-color: var(--gold) !important; color: var(--gold) !important; }
        .exp-btn:hover { color: var(--gold) !important; border-color: var(--gold) !important; }
      `}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '6px' }}>Analytics</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 200, color: t.text1, letterSpacing: '.02em', lineHeight: 1 }}>Purchase Reports</div>
          <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '6px' }}>
            {k?.min_date ? `${fmtDate(k.min_date)} — ${fmtDate(k.max_date)}` : 'All time data'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="exp-btn" style={btnSmall} disabled={exporting} onClick={handleExport}>
            {exporting ? 'Generating...' : '↓ PDF'}
          </button>
          {hasFilters && (
            <button
              onClick={() => { setFromDate(''); setToDate(''); setFilterBranch(''); setFilterTxn(''); setFilterState('') }}
              style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 16px', color: t.text3, fontSize: '.7rem', cursor: 'pointer' }}
            >
              ✕ Clear All
            </button>
          )}
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '16px 20px', marginBottom: '24px', boxShadow: t.shadow }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '5px', marginRight: '4px' }}>
            {[
              ['Today',      setToday],
              ['Yesterday',  setYesterday],
              ['7D',         () => setQuickRange(7)],
              ['30D',        () => setQuickRange(30)],
              ['90D',        () => setQuickRange(90)],
              ['This Month', setThisMonth],
            ].map(([lbl, fn]) => (
              <button key={lbl} onClick={fn} className="pr-pill"
                style={{ padding: '5px 12px', borderRadius: '100px', border: `1px solid ${t.border}`, background: 'transparent', color: t.text3, fontSize: '.63rem', cursor: 'pointer', transition: 'all .15s', letterSpacing: '.04em' }}>
                {lbl}
              </button>
            ))}
          </div>
          <div style={{ width: '1px', height: '24px', background: t.border, margin: '0 4px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '.6rem', color: t.text4 }}>From</span>
            <input type="date" style={inp} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '.6rem', color: t.text4 }}>To</span>
            <input type="date" style={inp} value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <div style={{ width: '1px', height: '24px', background: t.border, margin: '0 4px' }} />
          <select style={inp} value={filterState} onChange={e => setFilterState(e.target.value)}>
            <option value="">All States</option>
            {STATES.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
          <select style={inp} value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select style={inp} value={filterTxn} onChange={e => setFilterTxn(e.target.value)}>
            <option value="">All Types</option>
            <option value="PHYSICAL">Physical</option>
            <option value="TAKEOVER">Takeover</option>
          </select>
        </div>
        {hasFilters && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
            {filterState  && <FilterChip label={filterState}  onRemove={() => setFilterState('')}  color={t.blue}   />}
            {filterBranch && <FilterChip label={filterBranch} onRemove={() => setFilterBranch('')} color={t.gold}   />}
            {filterTxn    && <FilterChip label={filterTxn}    onRemove={() => setFilterTxn('')}    color={t.purple} />}
            {(fromDate || toDate) && (
              <FilterChip
                label={`${fromDate ? fmtDate(fromDate) : '…'} → ${toDate ? fmtDate(toDate) : '…'}`}
                onRemove={() => { setFromDate(''); setToDate('') }}
                color={t.green}
              />
            )}
          </div>
        )}
      </div>

      {/* ROW 1 — Volume (4 cols) */}
      <div style={gridRow4}>
        <KpiCard label="Total Transactions"    color={t.gold}  loading={loading}
          value={Number(k?.total_count || 0).toLocaleString('en-IN')}
          onClick={branchData.length ? () => setSelectedKpi('Total Transactions') : null} />
        <KpiCard label="Gross Weight"          color={t.text1} loading={loading}
          value={`${fmt(k?.total_gross)}g`}
          onClick={branchData.length ? () => setSelectedKpi('Gross Weight') : null} />
        <KpiCard label="Avg Stone & Wastage / Bill" color={t.text2} loading={loading}
          value={`${fmt(k?.avg_stone_wastage_bill)}g`}
          sub="avg deduction per transaction" />
        <KpiCard label="Net Weight"            color={t.gold}  loading={loading}
          value={`${fmt(k?.total_net)}g`}
          onClick={branchData.length ? () => setSelectedKpi('Net Weight') : null} />
      </div>

      {/* ROW 2 — Quality + Split (5 cols) */}
      <div style={gridRow5}>
        <KpiCard label="Stone & Wastage %" color={t.orange} loading={loading}
          value={`${Number(k?.stone_wastage_pct || 0).toFixed(2)}%`}
          sub="of gross weight" />
        <KpiCard label="Avg Purity %" color={t.purple} loading={loading}
          value={`${Number(k?.avg_purity || 0).toFixed(2)}%`}
          sub="weighted by net weight"
          onClick={branchData.length ? () => setSelectedKpi('Avg Purity %') : null} />
        <SplitCard
          title="Physical & Takeover — Bills"
          leftLabel="Physical"  leftValue={Number(k?.physical_count || 0).toLocaleString('en-IN')}  leftColor={t.gold}  leftSub={`Physical · ${phPct}%`}
          rightLabel="Takeover" rightValue={Number(k?.takeover_count || 0).toLocaleString('en-IN')} rightColor={t.blue} rightSub={`Takeover · ${tkPct}%`}
          loading={loading} t={t}
        />
        <SplitCard
          title="Physical & Takeover — Net Wt"
          leftLabel="Physical"  leftValue={`${fmt(k?.physical_net)}g`}  leftColor={t.gold}  leftSub={`Physical · ${phNwPct}%`}
          rightLabel="Takeover" rightValue={`${fmt(k?.takeover_net)}g`} rightColor={t.blue} rightSub={`Takeover · ${tkNwPct}%`}
          loading={loading} t={t}
        />
        <KpiCard label="Avg Net Wt / Bill" color={t.blue} loading={loading}
          value={`${fmt(k?.avg_net_per_txn)}g`}
          onClick={branchData.length ? () => setSelectedKpi('Avg Net Wt / Bill') : null} />
      </div>

      {/* ROW 3 — Value (5 cols) */}
      <div style={gridRow5b}>
        <KpiCard label="Avg Service Charge %" color={t.text2} loading={loading}
          value={`${Number(k?.avg_service_charge_pct || 0).toFixed(2)}%`}
          onClick={branchData.length ? () => setSelectedKpi('Avg Service Charge %') : null} />
        <KpiCard label="Gross Purchase Value" color={t.green} loading={loading}
          value={fmtVal(k?.total_value)}
          onClick={branchData.length ? () => setSelectedKpi('Gross Purchase Value') : null} />
        <KpiCard label="Avg Rate / Gram" color={t.green} loading={loading}
          value={fmtVal(k?.avg_rate_per_gram)}
          sub="gross value ÷ net weight"
          onClick={branchData.length ? () => setSelectedKpi('Avg Rate / Gram') : null} />
        <KpiCard label="Transacted Branches" color={t.blue} loading={loading}
          value={Number(k?.branch_count || 0).toLocaleString('en-IN')} />
        <KpiCard label="Business Days" color={t.text2} loading={loading}
          value={Number(k?.business_days || 0).toLocaleString('en-IN')}
          sub="unique trading days" />
      </div>

      {/* SECTION NAV */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '24px', padding: '5px', background: t.card, borderRadius: '12px', border: `1px solid ${t.border}`, width: 'fit-content', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }}>
        <button
          onClick={() => setActiveSection(null)}
          style={{ padding: '7px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: !activeSection ? t.gold : 'transparent', color: !activeSection ? '#0a0a0a' : t.text3, fontSize: '.68rem', fontWeight: !activeSection ? 600 : 400, letterSpacing: '.04em', transition: 'all .2s ease' }}
        >
          All
        </button>
        {visibleSections.map(sec => (
          <button
            key={sec.key}
            onClick={() => setActiveSection(activeSection === sec.key ? null : sec.key)}
            style={{ padding: '7px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: activeSection === sec.key ? t.gold : 'transparent', color: activeSection === sec.key ? '#0a0a0a' : t.text3, fontSize: '.68rem', fontWeight: activeSection === sec.key ? 600 : 400, letterSpacing: '.04em', transition: 'all .2s ease', display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            <span style={{ fontSize: '.75rem' }}>{sec.icon}</span>{sec.label}
          </button>
        ))}
      </div>

      {/* ERROR MESSAGE */}
      {error && (
        <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}40`, borderRadius: '12px', padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ fontSize: '.9rem', color: t.red, fontWeight: 600, marginBottom: '8px' }}>⚠ Error Loading Reports</div>
          <div style={{ fontSize: '.75rem', color: t.text2, marginBottom: '12px' }}>{error}</div>
          <div style={{ fontSize: '.7rem', color: t.text3, lineHeight: 1.6 }}>
            Check your Supabase connection and environment variables. Refresh the page to retry.
          </div>
        </div>
      )}

      {/* SECTIONS */}
      {!loading && !error && (
        <>
          {showSection('charts')       && <ReportCharts       trend={trend} monthly={monthly} dowData={dowData} hourlyTrend={hourlyTrend} isSingleDay={fromDate && toDate && fromDate === toDate} t={t} fromDate={fromDate} filterBranch={filterBranch} filterTxn={filterTxn} />}
          {showSection('distribution') && <ReportDistribution kpis={kpis} purityDist={purityDist} weightBuckets={weightBuckets} regionSplit={regionSplit} monthHalf={monthHalf} t={t} />}
          {showSection('branches')     && <ReportBranches     branchData={branchData} stateData={stateData} topBills={topBills} fromDate={fromDate} toDate={toDate} filterTxn={filterTxn} t={t} />}
          {showSection('sameday')      && <ReportSameDay      t={t} />}
          {showSection('compare')      && <ReportCompare      t={t} />}
          {showSection('crm')          && <ReportCrmInsights  t={t} />}
        </>
      )}

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', height: '200px', animation: 'shimmer 1.5s infinite' }} />
          ))}
        </div>
      )}

      {/* KPI Drill-Down Modal */}
      {selectedKpi && (() => {
        const drill = DRILL_MAP[selectedKpi]
        if (!drill || !branchData.length) return null
        const sorted = [...branchData]
          .filter(b => b[drill.field] != null && Number(b[drill.field]) > 0)
          .sort((a, b) => Number(b[drill.field] || 0) - Number(a[drill.field] || 0))
        const maxVal = Number(sorted[0]?.[drill.field] || 0)
        return (
          <GoldModal open={true} onClose={() => setSelectedKpi(null)} title={selectedKpi} width={520}>
            <div style={{ fontSize: 10, color: t.text3, letterSpacing: '.1em', marginBottom: 16 }}>
              BRANCH BREAKDOWN — {sorted.length} BRANCHES
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sorted.map((b, i) => {
                const val = Number(b[drill.field] || 0)
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0
                return (
                  <div key={b.branch_name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 10, color: t.text3, width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#e8d9b0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.branch_name}</span>
                        <span style={{ fontSize: 11, color: '#C9A84C', fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 8 }}>{drill.fmt(b[drill.field])}</span>
                      </div>
                      <div style={{ height: 3, background: 'rgba(201,168,76,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #8B6914, #FFD700)', borderRadius: 2, transition: 'width .6s ease' }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </GoldModal>
        )
      })()}
    </div>
  )
}