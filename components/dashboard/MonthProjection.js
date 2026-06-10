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

const STATES = ['Karnataka', 'Andhra Pradesh', 'Telangana', 'Kerala']

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
    if (list.some(h => h.is_active && (h.state === state || h.state === 'All India'))) continue
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
  const [mtdByState,  setMtdByState]  = useState({})              // { Karnataka: 12345.6, ... }
  const [mtdOverall,  setMtdOverall]  = useState(0)
  const [holidays,    setHolidays]    = useState([])              // raw rows
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

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
        setMtdOverall(0); setMtdByState({})
      } else {
        setMtdOverall(Number(aggJson.kpis.total_net || 0))
        // Endpoint returns the per-branch breakdown under `branchData` (legacy
        // alias for `branches`). Read both — whichever the server happens to
        // ship today wins.
        const branchRows = aggJson.branchData || aggJson.branches || []
        const bucket = {}
        for (const b of branchRows) {
          const s = b.state || 'Unknown'
          bucket[s] = (bucket[s] || 0) + Number(b.total_net || 0)
        }
        setMtdByState(bucket)
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

  // Per-state run rate + projected closure. Aggregated to two scalars.
  // Fallback: if no recognised state is present in the breakdown (e.g. the
  // branches array shape changed or rows lack a state field), but the overall
  // MTD is non-zero, fall back to a single-bucket aggregate calculation
  // using only 'All India' holidays. Sundays still excluded. This keeps the
  // dashboard useful while the data schema settles.
  const { totalClosure, overallRunRate, statesWithData, totalWorkingDaysElapsed } = useMemo(() => {
    let totalClosure   = 0
    let totalMtd       = 0
    let totalWdElapsed = 0
    let statesWithData = 0

    for (const state of STATES) {
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

    // ── Fallback path ───────────────────────────────────────────────────────
    // Use 'All India' wildcard ('__OVERALL__' is treated as no-state in
    // countWorkingDays — only All India entries match). This still respects
    // active national holidays + Sundays.
    if (statesWithData === 0 && mtdOverall > 0) {
      const elapsed = countWorkingDays(monthStartYmd, todayYmd,    '__OVERALL__', holidaysByDate)
      const total   = countWorkingDays(monthStartYmd, monthEndYmd, '__OVERALL__', holidaysByDate)
      const runRate = elapsed > 0 ? mtdOverall / elapsed : 0
      return {
        totalClosure:            runRate * total,
        overallRunRate:          runRate,
        statesWithData:          1,
        totalWorkingDaysElapsed: elapsed,
      }
    }

    // Per-state path: headline run rate = aggregated MTD ÷ aggregated elapsed
    // working days, averaged across active states so the figure reads as
    // "average daily pace" rather than "sum of state paces" (which would
    // overshoot when states share elapsed days).
    const overallRunRate = totalWdElapsed > 0
      ? totalMtd / (totalWdElapsed / Math.max(1, statesWithData))
      : 0
    return { totalClosure, overallRunRate, statesWithData, totalWorkingDaysElapsed: totalWdElapsed }
  }, [mtdByState, mtdOverall, holidaysByDate, monthStartYmd, monthEndYmd, todayYmd])

  // ─── Render ─────────────────────────────────────────────────────────────
  const card = {
    background: `linear-gradient(135deg, ${t.gold}0c, ${t.card2 || t.card})`,
    border: `1px solid ${t.border}`,
    borderRadius: 14,
    padding: isMobile ? '14px 16px' : '16px 20px',
  }

  const subtle = { fontSize: 10, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }

  const monthName = new Date(monthStartYmd).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.gold, display: 'inline-block' }} />
        <span style={{ fontSize: 11, color: t.text2, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Month Projection</span>
        <span style={{ fontSize: 10, color: t.text4 }}>· {monthName} · Sundays + holidays excluded</span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 12,
      }}>
        {/* Run Rate */}
        <div style={card}>
          <div style={subtle}>Run Rate</div>
          <div style={{ fontSize: isMobile ? 28 : 32, color: t.gold, fontWeight: 300, lineHeight: 1.1, letterSpacing: '-.02em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '…' : fmtWt(overallRunRate)}
            {!loading && overallRunRate > 0 && (
              <span style={{ fontSize: 12, color: t.text4, fontWeight: 500, marginLeft: 6 }}>/ working day</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: t.text4, marginTop: 6 }}>
            MTD net weight ÷ working days elapsed · {totalWorkingDaysElapsed > 0 ? `${Math.round(totalWorkingDaysElapsed / Math.max(1, statesWithData))} avg WD` : 'no working day yet'}
          </div>
        </div>

        {/* Estimated Closure */}
        <div style={card}>
          <div style={subtle}>Estimated Month Closure</div>
          <div style={{ fontSize: isMobile ? 28 : 32, color: t.green || '#3aaa6a', fontWeight: 300, lineHeight: 1.1, letterSpacing: '-.02em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '…' : fmtWt(totalClosure)}
          </div>
          <div style={{ fontSize: 10, color: t.text4, marginTop: 6 }}>
            Per-state run rate × per-state working days remaining, summed
          </div>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 10, color: t.red || '#e05555', marginTop: 6 }}>
          Couldn&apos;t refresh: {error}
        </div>
      )}
    </div>
  )
}
