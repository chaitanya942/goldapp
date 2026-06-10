'use client'

// MonthProjection — two cards on the dashboard, below LiveFeedFlashcards.
//
//   Run Rate              — g per working day (MTD net weight ÷ working days
//                            elapsed; "working day" = not a Sunday and not an
//                            active 'All India' holiday).
//   Estimated Closure     — projected month-end net weight (sum over each
//                            state of: state's MTD ÷ state's elapsed working
//                            days × state's total working days). Captures
//                            state-specific holidays properly.
//
// Working day counting:
//   - Sundays are always excluded (logistics partner is off).
//   - Holidays from holiday_calendar are excluded. 'All India' rows count
//     for every state. Per-state rows count only for that state.
//   - Inactive holiday rows (is_active=false) are ignored.
//
// Fetches:
//   - /api/report-aggregates?from=<month-start>&to=<today> → MTD by branch
//     (we bucket to state client-side using the embedded b.state field).
//   - /api/admin/holidays?year=<current> → all active+inactive entries for
//     this year (cheap; never more than a few hundred rows).

import { useEffect, useState, useMemo, useCallback } from 'react'
import { authedFetch } from '../../lib/authedFetch'
import { REGION_COLORS } from '../../lib/consignmentTheme'

// 'All India' is a DB-defined wildcard sentinel from holiday_calendar's
// state CHECK constraint — when a row carries this value, the holiday
// applies to every state. Kept as a named constant so the magic string
// is referenced from one place; the value itself comes from the schema.
const ALL_INDIA = 'All India'

// IST helpers — month-start / month-end / today as YYYY-MM-DD in IST. Avoids
// the off-by-one where a UTC-midnight stamp lands on the previous IST day.
const istNow = () => new Date(Date.now() + 5.5 * 3600_000)
const isoYMD = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const istToday      = () => isoYMD(istNow())
const istMonthStart = () => { const d = istNow(); d.setUTCDate(1); return isoYMD(d) }
const istMonthEnd   = () => { const d = istNow(); d.setUTCMonth(d.getUTCMonth() + 1, 0); return isoYMD(d) }

// Count working days between two YYYY-MM-DD dates (inclusive) for a given
// state, skipping Sundays and any active holiday entry covering that
// (date, state) — including 'All India' wildcards.
function countWorkingDays(startYmd, endYmd, state, holidaysByDate) {
  let count = 0
  const start = new Date(`${startYmd}T00:00:00Z`)
  const end   = new Date(`${endYmd}T00:00:00Z`)
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0) continue                           // Sunday
    const key = isoYMD(d)
    const list = holidaysByDate[key] || []
    if (list.some(h => h.is_active && (h.state === state || h.state === ALL_INDIA))) continue
    count++
  }
  return count
}

const fmtWt = (g) => {
  if (!Number.isFinite(g) || g <= 0) return '—'
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`
  return `${g.toFixed(1)} g`
}

export default function MonthProjection({ t, isMobile }) {
  const [mtdByState,    setMtdByState]    = useState({})          // { <state>: net_wt } — auto-discovered from branchData
  const [mtdByRegion,   setMtdByRegion]   = useState({})          // { <region>: net_wt } — auto-discovered
  const [regionToState, setRegionToState] = useState({})          // { <region>: <state> } — for region→holiday calendar lookup
  const [mtdOverall,    setMtdOverall]    = useState(0)
  const [holidays,      setHolidays]      = useState([])          // raw rows
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [viewMode,      setViewMode]      = useState('overall')   // 'overall' | 'regionwise'

  const todayYmd      = useMemo(istToday,      [])
  const monthStartYmd = useMemo(istMonthStart, [])
  const monthEndYmd   = useMemo(istMonthEnd,   [])
  const currentYear   = useMemo(() => Number(todayYmd.slice(0, 4)), [todayYmd])

  const fetchAll = useCallback(async () => {
    try {
      const params = new URLSearchParams({ from: monthStartYmd, to: todayYmd })
      const [aggRes, holRes] = await Promise.all([
        authedFetch(`/api/report-aggregates?${params}`),
        authedFetch(`/api/admin/holidays?year=${currentYear}`),
      ])
      const aggJson = await aggRes.json().catch(() => ({}))
      const holJson = await holRes.json().catch(() => ({}))

      if (aggJson?.empty || !aggJson?.kpis) {
        setMtdOverall(0); setMtdByState({}); setMtdByRegion({}); setRegionToState({})
      } else {
        setMtdOverall(Number(aggJson.kpis.total_net || 0))
        // Endpoint returns the per-branch breakdown under `branchData` (legacy
        // alias for `branches`). Read both — whichever the server happens to
        // ship today wins. We bucket by both b.state (for state-level holiday
        // math) and b.region (for the regionwise view), and capture the
        // region→state link from each row so the regionwise math can look up
        // the right holiday calendar without hardcoding the mapping.
        const branchRows = aggJson.branchData || aggJson.branches || []
        const stateBucket   = {}
        const regionBucket  = {}
        const regionStateMap = {}
        for (const b of branchRows) {
          const s = b.state  || null
          const r = b.region || null
          if (s) stateBucket[s]   = (stateBucket[s]  || 0) + Number(b.total_net || 0)
          if (r) regionBucket[r]  = (regionBucket[r] || 0) + Number(b.total_net || 0)
          if (r && s) regionStateMap[r] = s
        }
        setMtdByState(stateBucket)
        setMtdByRegion(regionBucket)
        setRegionToState(regionStateMap)
      }

      // Holidays — 401/403 (auth-restricted) is fine; we just compute with
      // Sundays only. Don't block the whole component on a missing perm.
      if (holRes.ok && Array.isArray(holJson?.holidays)) {
        setHolidays(holJson.holidays)
      } else {
        setHolidays([])
      }

      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [monthStartYmd, todayYmd, currentYear])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Refetch every 5 min — month numbers don't move minute-to-minute and a
  // chattier interval just spams the network panel. Visibility-change also
  // pulls a fresh number when ops returns to the tab.
  useEffect(() => {
    const id = setInterval(fetchAll, 5 * 60 * 1000)
    const onVis = () => { if (document.visibilityState === 'visible') fetchAll() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [fetchAll])

  // Index holidays by date for O(1) lookup per day-iteration.
  const holidaysByDate = useMemo(() => {
    const m = {}
    for (const h of holidays) {
      if (!m[h.holiday_date]) m[h.holiday_date] = []
      m[h.holiday_date].push(h)
    }
    return m
  }, [holidays])

  // Overall (state-aggregated) metrics. Iterates only states that actually
  // showed up in branchData this month — no hardcoded state list, so adding
  // a new state to the system surfaces here automatically.
  // Fallback: if no state is present in the breakdown (e.g. the rows lack a
  // state field), but mtdOverall is non-zero, project from the overall MTD
  // using only Sundays + 'All India' holidays. Keeps the dashboard useful
  // while the data schema settles.
  const overall = useMemo(() => {
    const states = Object.keys(mtdByState)
    let totalClosure   = 0
    let totalMtd       = 0
    let totalWdElapsed = 0
    let statesWithData = 0

    for (const state of states) {
      const mtd = Number(mtdByState[state] || 0)
      if (mtd <= 0) continue
      statesWithData++
      const wdElapsed = countWorkingDays(monthStartYmd, todayYmd,    state, holidaysByDate)
      const wdTotal   = countWorkingDays(monthStartYmd, monthEndYmd, state, holidaysByDate)
      const runRate   = wdElapsed > 0 ? mtd / wdElapsed : 0
      totalClosure   += runRate * wdTotal
      totalMtd       += mtd
      totalWdElapsed += wdElapsed
    }

    if (statesWithData === 0 && mtdOverall > 0) {
      // Sentinel state value that won't match any real state row in
      // holiday_calendar — leaves only ALL_INDIA matches active.
      const sentinel = '__no_state__'
      const elapsed  = countWorkingDays(monthStartYmd, todayYmd,    sentinel, holidaysByDate)
      const total    = countWorkingDays(monthStartYmd, monthEndYmd, sentinel, holidaysByDate)
      const runRate  = elapsed > 0 ? mtdOverall / elapsed : 0
      return {
        totalClosure:            runRate * total,
        overallRunRate:          runRate,
        statesWithData:          1,
        totalWorkingDaysElapsed: elapsed,
      }
    }

    const overallRunRate = totalWdElapsed > 0
      ? totalMtd / (totalWdElapsed / Math.max(1, statesWithData))
      : 0
    return {
      totalClosure,
      overallRunRate,
      statesWithData,
      totalWorkingDaysElapsed: totalWdElapsed,
    }
  }, [mtdByState, mtdOverall, holidaysByDate, monthStartYmd, monthEndYmd, todayYmd])

  // Per-region metrics. Each region inherits its state's holiday calendar
  // (the state is looked up via regionToState which was built from
  // branchData — no hardcoded mapping). Sorted by closure desc so the
  // biggest contributors land at the top.
  const regionwise = useMemo(() => {
    return Object.keys(mtdByRegion)
      .filter(r => Number(mtdByRegion[r] || 0) > 0)
      .map(region => {
        const mtd       = Number(mtdByRegion[region] || 0)
        const state     = regionToState[region]
        const wdElapsed = countWorkingDays(monthStartYmd, todayYmd,    state, holidaysByDate)
        const wdTotal   = countWorkingDays(monthStartYmd, monthEndYmd, state, holidaysByDate)
        const runRate   = wdElapsed > 0 ? mtd / wdElapsed : 0
        return { region, state, mtd, runRate, closure: runRate * wdTotal, wdElapsed, wdTotal }
      })
      .sort((a, b) => b.closure - a.closure)
  }, [mtdByRegion, regionToState, holidaysByDate, monthStartYmd, monthEndYmd, todayYmd])

  // ─── Render ─────────────────────────────────────────────────────────────
  const card = {
    background: `linear-gradient(135deg, ${t.gold}0c, ${t.card2 || t.card})`,
    border: `1px solid ${t.border}`,
    borderRadius: 14,
    padding: isMobile ? '14px 16px' : '16px 20px',
  }

  const subtle = { fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }

  const monthName = new Date(monthStartYmd).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const toggleChip = (active) => ({
    padding: '4px 11px', borderRadius: 99,
    background: active ? `${t.gold}22` : 'transparent',
    border: `1px solid ${active ? `${t.gold}80` : t.border}`,
    color: active ? t.gold : t.text3,
    fontSize: 10.5, fontWeight: active ? 700 : 600,
    cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '.04em',
    transition: 'background .15s, color .15s, border-color .15s',
    fontFamily: 'inherit',
  })

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.gold, display: 'inline-block' }} />
        <span style={{ fontSize: 11, color: t.text2, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Month Projection</span>
        <span style={{ fontSize: 10, color: t.text4 }}>· {monthName} · Sundays + holidays excluded</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setViewMode('overall')}     style={toggleChip(viewMode === 'overall')}>Overall</button>
        <button onClick={() => setViewMode('regionwise')}  style={toggleChip(viewMode === 'regionwise')}>Regionwise</button>
      </div>

      {viewMode === 'overall' ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: 12,
        }}>
          {/* Run Rate */}
          <div style={card}>
            <div style={subtle}>Run Rate</div>
            <div style={{ fontSize: isMobile ? 28 : 32, color: t.gold, fontWeight: 300, lineHeight: 1.1, letterSpacing: '-.02em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
              {loading ? '…' : fmtWt(overall.overallRunRate)}
              {!loading && overall.overallRunRate > 0 && (
                <span style={{ fontSize: 12, color: t.text4, fontWeight: 500, marginLeft: 6 }}>/ working day</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: t.text4, marginTop: 6 }}>
              MTD net weight ÷ working days elapsed
              {overall.totalWorkingDaysElapsed > 0
                ? ` · ${Math.round(overall.totalWorkingDaysElapsed / Math.max(1, overall.statesWithData))} avg WD`
                : ' · no working day yet'}
            </div>
          </div>

          {/* Estimated Closure */}
          <div style={card}>
            <div style={subtle}>Estimated Month Closure</div>
            <div style={{ fontSize: isMobile ? 28 : 32, color: t.green || '#3aaa6a', fontWeight: 300, lineHeight: 1.1, letterSpacing: '-.02em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
              {loading ? '…' : fmtWt(overall.totalClosure)}
            </div>
            <div style={{ fontSize: 10, color: t.text4, marginTop: 6 }}>
              Per-state run rate × per-state working days remaining, summed
            </div>
          </div>
        </div>
      ) : (
        // Regionwise — one card per region surfaced in branchData this month.
        // Each region uses its state's holiday calendar (resolved from
        // regionToState which itself came from the data).
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
        }}>
          {loading ? (
            <div style={{ ...card, color: t.text4, fontSize: 12 }}>Loading…</div>
          ) : regionwise.length === 0 ? (
            <div style={{ ...card, color: t.text4, fontSize: 12 }}>
              No region has MTD purchases yet this month.
            </div>
          ) : regionwise.map(row => {
            const accent = (REGION_COLORS && REGION_COLORS[row.region]) || t.gold
            return (
              <div key={row.region} style={{
                background: `linear-gradient(135deg, ${accent}10, ${t.card2 || t.card})`,
                border: `1px solid ${accent}30`,
                borderLeft: `3px solid ${accent}`,
                borderRadius: 14,
                padding: isMobile ? '12px 14px' : '14px 16px',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 12, color: accent, fontWeight: 700, letterSpacing: '.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.region}
                  </span>
                  {row.state && row.state !== row.region && (
                    <span style={{ fontSize: 9, color: t.text4, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{row.state}</span>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 9, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>Run Rate</div>
                  <div style={{ fontSize: 17, color: t.text1, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                    {fmtWt(row.runRate)}
                    <span style={{ fontSize: 10, color: t.text4, fontWeight: 500, marginLeft: 4 }}>/ WD</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>Est. Closure</div>
                  <div style={{ fontSize: 19, color: accent, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                    {fmtWt(row.closure)}
                  </div>
                </div>
                <div style={{ fontSize: 9, color: t.text4, marginTop: 2 }}>
                  MTD {fmtWt(row.mtd)} · {row.wdElapsed}/{row.wdTotal} WD
                </div>
              </div>
            )
          })}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: t.red || '#e05555', marginTop: 6 }}>
          Couldn&apos;t refresh: {error}
        </div>
      )}
    </div>
  )
}
