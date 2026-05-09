'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmt, fmtVal } from './reportUtils'
import { istNow, istStr } from '../../../lib/dateIst'

const addDays = (dateStr, n) => {
  const d = new Date(dateStr); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

// Returns { current: {from,to}, previous: {from,to}, label }
function getPeriods(mode) {
  const today = istStr()
  if (mode === 'day') {
    const yesterday = addDays(today, -1)
    return {
      current:  { from: today,     to: today,     label: 'Today' },
      previous: { from: yesterday, to: yesterday, label: 'Yesterday' },
    }
  }
  if (mode === 'week') {
    const now = istNow()
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1   // 0 = Mon
    const weekStart = addDays(today, -dow)
    const lastWeekStart = addDays(weekStart, -7)
    const lastWeekEnd   = addDays(weekStart, -1)
    return {
      current:  { from: weekStart,     to: today,         label: 'This Week' },
      previous: { from: lastWeekStart, to: lastWeekEnd,   label: 'Last Week' },
    }
  }
  // month
  const now = istNow()
  const y  = now.getFullYear(), m = now.getMonth()
  const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const prevM      = m === 0 ? 11 : m - 1
  const prevY      = m === 0 ? y - 1 : y
  const lastDayPrev = new Date(prevY, prevM + 1, 0).getDate()
  const dayOfMonth  = now.getDate()
  // For MTD vs same-days-last-month, cap previous to same day count for fair compare
  const sameDayLastMonth = Math.min(dayOfMonth, lastDayPrev)
  return {
    current:  { from: monthStart, to: today, label: 'This Month' },
    previous: {
      from:  `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`,
      to:    `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(sameDayLastMonth).padStart(2, '0')}`,
      label: 'Last Month (same days)',
    },
  }
}

async function fetchKpis({ from, to, p_branch, p_region_branches, p_txn_type }) {
  const { data } = await supabase.rpc('get_purchase_aggregates', {
    p_from_date: from, p_to_date: to,
    p_branch: p_branch || null, p_txn_type: p_txn_type || null,
    p_region_branches: p_region_branches || null,
    p_single_day: from === to,
  })
  return data?.kpis || null
}

function deltaPct(curr, prev) {
  if (prev == null || prev === 0) return curr ? 100 : 0
  return ((Number(curr || 0) - Number(prev || 0)) / Number(prev)) * 100
}

function Arrow({ pct, t }) {
  if (pct === 0)  return <span style={{ color: t.text4 }}>•</span>
  const up = pct > 0
  return <span style={{ color: up ? t.green : t.red, fontSize: '.8em' }}>{up ? '▲' : '▼'}</span>
}

export default function ReportComparePeriods({ t, isMobile, fromDate, toDate, filterBranch, filterRegion, filterTxn, branches }) {
  const [mode,    setMode]    = useState('day')
  const [loading, setLoading] = useState(true)
  const [curr,    setCurr]    = useState(null)
  const [prev,    setPrev]    = useState(null)
  const [periods, setPeriods] = useState(getPeriods('day'))

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const p = getPeriods(mode)
      setPeriods(p)

      // Resolve filter for region (need branch list under region)
      let p_region_branches = null
      if (filterRegion) {
        const { data: bData } = await supabase.from('branches').select('name').eq('region', filterRegion)
        p_region_branches = (bData || []).map(b => b.name)
      }
      const args = { p_branch: filterBranch || null, p_region_branches, p_txn_type: filterTxn || null }
      const [c, pr] = await Promise.all([
        fetchKpis({ from: p.current.from,  to: p.current.to,  ...args }),
        fetchKpis({ from: p.previous.from, to: p.previous.to, ...args }),
      ])
      if (cancelled) return
      setCurr(c); setPrev(pr); setLoading(false)
    }
    run().catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [mode, filterBranch, filterRegion, filterTxn])

  const metrics = [
    { key: 'total_count', label: 'Bills',       fmt: v => Number(v || 0).toLocaleString('en-IN') },
    { key: 'total_net',   label: 'Net Wt',      fmt: v => `${fmt(v || 0)}g` },
    { key: 'total_value', label: 'Gross Value', fmt: v => fmtVal(v || 0) },
    { key: 'avg_purity',  label: 'Avg Purity',  fmt: v => `${Number(v || 0).toFixed(2)}%` },
  ]

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: isMobile ? '16px 14px' : '20px 22px' }
  const pillBase = { padding: '6px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: `1px solid ${t.border2}`, background: 'transparent', color: t.text3 }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 600 }}>Compare</div>
          <div style={{ fontSize: '15px', fontWeight: 500, color: t.text1 }}>{periods.current.label} vs {periods.previous.label}</div>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { k: 'day',   l: 'Day' },
            { k: 'week',  l: 'Week' },
            { k: 'month', l: 'Month' },
          ].map(p => (
            <button key={p.k} onClick={() => setMode(p.k)}
              style={{
                ...pillBase,
                background: mode === p.k ? t.gold : 'transparent',
                color: mode === p.k ? '#1a0a00' : t.text3,
                borderColor: mode === p.k ? t.gold : t.border2,
              }}>
              {p.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px' }}>
        {metrics.map(m => {
          const cv = curr?.[m.key]
          const pv = prev?.[m.key]
          const pct = deltaPct(cv, pv)
          const up = pct > 0
          const noChange = pct === 0
          const color = noChange ? t.text3 : up ? t.green : t.red
          return (
            <div key={m.key} style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px' }}>{m.label}</div>
              {loading ? (
                <div style={{ height: '22px', background: `linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize: '200% 100%', borderRadius: '4px', animation: 'shimmer 1.5s infinite' }} />
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ fontSize: isMobile ? '15px' : '18px', fontWeight: 600, color: t.text1, fontFamily: 'monospace' }}>{m.fmt(cv)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                    <Arrow pct={pct} t={t} />
                    <span style={{ color, fontWeight: 600 }}>{Math.abs(pct).toFixed(1)}%</span>
                    <span style={{ color: t.text4 }}>vs {m.fmt(pv)}</span>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
