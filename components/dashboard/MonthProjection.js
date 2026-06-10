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
    let totalWdAll     = 0      // sum of total working days across active states
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
      totalWdAll     += wdTotal
    }

    if (statesWithData === 0 && mtdOverall > 0) {
      // Sentinel state value that won't match any real state row in
      // holiday_calendar — leaves only ALL_INDIA matches active.
      const sentinel = '__no_state__'
      const elapsed  = countWorkingDays(monthStartYmd, todayYmd,    sentinel, holidaysByDate)
      const total    = countWorkingDays(monthStartYmd, monthEndYmd, sentinel, holidaysByDate)
      const runRate  = elapsed > 0 ? mtdOverall / elapsed : 0
      return {
        mtd:                     mtdOverall,
        runRate,
        closure:                 runRate * total,
        wdElapsed:               elapsed,
        wdTotal:                 total,
        wdRemaining:             Math.max(0, total - elapsed),
        statesWithData:          1,
      }
    }

    // Per-state path: present the AVERAGE state's working day count so the
    // footer caption reads sensibly. (Sum-across-states would imply more
    // days than the month has.)
    const avgWdElapsed = Math.round(totalWdElapsed / Math.max(1, statesWithData))
    const avgWdTotal   = Math.round(totalWdAll     / Math.max(1, statesWithData))
    const runRate = totalWdElapsed > 0
      ? totalMtd / (totalWdElapsed / Math.max(1, statesWithData))
      : 0
    return {
      mtd:            totalMtd,
      runRate,
      closure:        totalClosure,
      wdElapsed:      avgWdElapsed,
      wdTotal:        avgWdTotal,
      wdRemaining:    Math.max(0, avgWdTotal - avgWdElapsed),
      statesWithData,
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
        return {
          region, state, mtd, runRate,
          closure:     runRate * wdTotal,
          wdElapsed,
          wdTotal,
          wdRemaining: Math.max(0, wdTotal - wdElapsed),
        }
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
        <ProjectionHero
          accent={t.gold}
          title="Estimated Month Closure"
          loading={loading}
          mtd={overall.mtd}
          runRate={overall.runRate}
          closure={overall.closure}
          wdElapsed={overall.wdElapsed}
          wdRemaining={overall.wdRemaining}
          wdTotal={overall.wdTotal}
          subhead={overall.statesWithData > 0 ? `Avg across ${overall.statesWithData} state${overall.statesWithData === 1 ? '' : 's'} · total ${overall.wdTotal} WD this month` : null}
          t={t} isMobile={isMobile}
        />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 12,
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
              <ProjectionHero
                key={row.region}
                accent={accent}
                title={row.region}
                titleBadge={row.state && row.state !== row.region ? row.state : null}
                loading={false}
                mtd={row.mtd}
                runRate={row.runRate}
                closure={row.closure}
                wdElapsed={row.wdElapsed}
                wdRemaining={row.wdRemaining}
                wdTotal={row.wdTotal}
                compact
                t={t} isMobile={isMobile}
              />
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

// ─────────────────────────────────────────────────────────────────────────────
// ProjectionHero — single card showing Closure as the hero number, a progress
// bar (MTD / Closure = working days completed proportion), and three small
// stat tiles below for MTD / Run Rate / Working Days.
//
// Used by both the overall view (one big card) and the regionwise view (one
// compact card per region). `compact` shrinks paddings/typography for the
// per-region density; otherwise the same layout.
// ─────────────────────────────────────────────────────────────────────────────
function ProjectionHero({
  accent, title, titleBadge, subhead, loading,
  mtd, runRate, closure, wdElapsed, wdRemaining, wdTotal,
  compact, t, isMobile,
}) {
  const pct = closure > 0 ? Math.min(100, (mtd / closure) * 100) : 0
  const heroSize    = compact ? (isMobile ? 26 : 30) : (isMobile ? 30 : 38)
  const padding     = compact ? (isMobile ? '14px 16px' : '16px 18px') : (isMobile ? '18px 20px' : '20px 24px')
  const tileSize    = compact ? 13 : 15
  const labelSize   = compact ? 9  : 10

  const card = {
    background: `linear-gradient(135deg, ${accent}10 0%, ${accent}04 50%, ${t.card2 || t.card} 100%)`,
    border: `1px solid ${accent}30`,
    borderLeft: `3px solid ${accent}`,
    borderRadius: 14,
    padding,
    display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14,
    position: 'relative', overflow: 'hidden',
  }

  const tileLabel = { fontSize: labelSize, color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }

  return (
    <div style={card}>
      {/* Faint accent glow in the corner — subtle premium feel */}
      <div aria-hidden style={{
        position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}1c 0%, transparent 70%)`, pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
        <span style={{
          fontSize: compact ? 12 : 10,
          color: accent,
          fontWeight: compact ? 700 : 700,
          letterSpacing: compact ? '.03em' : '.12em',
          textTransform: compact ? 'none' : 'uppercase',
        }}>
          {title}
        </span>
        {titleBadge && (
          <span style={{ fontSize: 9, color: t.text4, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{titleBadge}</span>
        )}
      </div>

      {/* Hero number */}
      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: heroSize,
          color: accent,
          fontWeight: 300,
          lineHeight: 1.05,
          letterSpacing: '-.02em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {loading ? '…' : fmtWt(closure)}
        </div>
        {!compact && (
          <div style={{ fontSize: 10, color: t.text4, marginTop: 4, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600 }}>
            Estimated month closure
          </div>
        )}
      </div>

      {/* Progress bar — MTD/Closure (≡ wdElapsed/wdTotal at current pace) */}
      <div style={{ position: 'relative' }}>
        <div style={{
          height: 6, width: '100%',
          background: `${t.border}`,
          borderRadius: 99, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
            transition: 'width .35s ease',
            boxShadow: `0 0 8px ${accent}55`,
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 9.5, color: t.text4, letterSpacing: '.04em', fontWeight: 600 }}>
          <span><strong style={{ color: t.text2, fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%</strong> through projected closure</span>
          <span>{wdElapsed}/{wdTotal} WD · <strong style={{ color: t.text2 }}>{wdRemaining}</strong> left</span>
        </div>
      </div>

      {/* Stat tiles — MTD, Run Rate, Working Days */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: compact ? 6 : 10,
        position: 'relative',
        paddingTop: compact ? 6 : 8,
        borderTop: `1px dashed ${t.border}`,
      }}>
        <div>
          <div style={tileLabel}>MTD</div>
          <div style={{ fontSize: tileSize, color: t.blue || '#3a8fbf', fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {fmtWt(mtd)}
          </div>
        </div>
        <div>
          <div style={tileLabel}>Run Rate</div>
          <div style={{ fontSize: tileSize, color: t.text1, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {fmtWt(runRate)}
            <span style={{ fontSize: 9.5, color: t.text4, fontWeight: 500, marginLeft: 3 }}>/ WD</span>
          </div>
        </div>
        <div>
          <div style={tileLabel}>Working Days</div>
          <div style={{ fontSize: tileSize, color: t.text1, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {wdElapsed}<span style={{ color: t.text4, fontWeight: 500 }}> / {wdTotal}</span>
          </div>
        </div>
      </div>

      {subhead && !compact && (
        <div style={{ fontSize: 10, color: t.text4, position: 'relative', marginTop: -4 }}>{subhead}</div>
      )}
    </div>
  )
}
