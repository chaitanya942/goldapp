// lib/auditShiftGate.js
//
// Time-window gate for the `audit` role. Auditors can only access the app
// during the operating window of a shift they're assigned to:
//
//   Night shift, shift_date = N    →  19:30 – 24:00 IST on N
//   Morning shift, shift_date = N  →  08:30 – 20:00 IST on N
//
// Every other role bypasses this gate entirely (super_admin, founders_office,
// admin, accounts, etc.) — they have unconditional access regardless of any
// shift table state.
//
// The gate runs in two places:
//
//   1. Server (lib/apiAuth.js): every API call by a role=audit user is
//      gated; outside the window → 403.
//   2. Client (components/AuditAccessGuard.js): polls /api/auditor-access on
//      mount + schedules a setTimeout to the window's end so the auditor
//      gets auto-logged-out exactly when their window closes (e.g. midnight
//      for night, 20:00 for morning).
//
// Both call the pure helpers below so the rule is single-sourced.

// Windows are minutes-from-midnight in IST (UTC+5:30).
//   Night    19:30 → 24:00  (1170 → 1440)   — "1440" means "end of day"
//   Morning  08:30 → 20:00  (510  → 1200)
const NIGHT_START_MINS   = 19 * 60 + 30
const NIGHT_END_MINS     = 24 * 60
const MORNING_START_MINS = 8 * 60 + 30
const MORNING_END_MINS   = 20 * 60

const IST_OFFSET_MS = 5.5 * 3600_000

// ── IST time helpers ────────────────────────────────────────────────────────
// We treat IST as a fixed offset (no DST in India). All date math runs on
// the wall-clock by shifting UTC ms by +5:30 and reading the resulting
// Date as if it were UTC — that yields IST fields without needing
// Intl.DateTimeFormat at every call site.

export function getIstNow(nowMs = Date.now()) {
  const dt = new Date(nowMs + IST_OFFSET_MS)
  const date = dt.toISOString().slice(0, 10)                 // YYYY-MM-DD
  const hours   = dt.getUTCHours()
  const minutes = dt.getUTCMinutes()
  const totalMins = hours * 60 + minutes
  return { date, totalMins, hours, minutes }
}

// Convert a YYYY-MM-DD + minutes-from-midnight IST into a real UTC ms
// timestamp. Used to compute when the current window expires.
function istDateMinsToUtcMs(ymd, mins) {
  const [y, m, d] = ymd.split('-').map(Number)
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + mins * 60_000 - IST_OFFSET_MS
  return utcMs
}

// ── Window lookup ──────────────────────────────────────────────────────────

function windowFor(shiftType) {
  if (shiftType === 'night')   return { startMins: NIGHT_START_MINS,   endMins: NIGHT_END_MINS,   label: 'night' }
  if (shiftType === 'morning') return { startMins: MORNING_START_MINS, endMins: MORNING_END_MINS, label: 'morning' }
  return null
}

// Pretty-print a minutes-from-midnight as HH:MM (24h, IST).
export function formatHm(mins) {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ── The gate decision ──────────────────────────────────────────────────────

/**
 * Decide whether an auditor is currently allowed in.
 *
 * @param {Array<{shift_date: string, shift_type: 'night'|'morning'}>} shifts
 *        ALL shifts assigned to this auditor (any date). The function picks
 *        the one for today (IST) — if any — and checks its time window.
 * @param {number} [nowMs] — defaults to Date.now(). Pass an explicit clock for tests.
 *
 * @returns {{
 *   allowed: boolean,
 *   reason:  string,
 *   activeShift: {shift_date: string, shift_type: 'night'|'morning'} | null,
 *   windowStartIst: string | null,    // 'HH:MM'
 *   windowEndIst:   string | null,    // 'HH:MM'
 *   expiresAtMs:    number | null,    // UTC ms when the current window ends
 * }}
 */
export function auditorAccessNow(shifts, nowMs = Date.now()) {
  const now = getIstNow(nowMs)
  const todaysShifts = (shifts || []).filter(s => s.shift_date === now.date)

  // Find a shift whose window currently contains `now`. If multiple match
  // (shouldn't really happen — night and morning windows don't overlap on
  // the same date), prefer the one that ends later so the auditor gets
  // the longer remaining grace period.
  let best = null
  for (const s of todaysShifts) {
    const w = windowFor(s.shift_type)
    if (!w) continue
    if (now.totalMins >= w.startMins && now.totalMins < w.endMins) {
      if (!best || w.endMins > best.window.endMins) best = { shift: s, window: w }
    }
  }

  if (best) {
    return {
      allowed: true,
      reason:  '',
      activeShift:    best.shift,
      windowStartIst: formatHm(best.window.startMins),
      windowEndIst:   formatHm(best.window.endMins),
      expiresAtMs:    istDateMinsToUtcMs(best.shift.shift_date, best.window.endMins),
    }
  }

  // Not in any window today. Build the most useful error message we can —
  // either "your window opens at X" or "no shift assigned today".
  if (todaysShifts.length > 0) {
    // Some shifts today, but we're outside all their windows. Pick the
    // soonest upcoming one (today) for the message, or the most recently
    // closed one if everything's already past.
    const todayWith = todaysShifts.map(s => ({ s, w: windowFor(s.shift_type) })).filter(x => x.w)
    const upcoming  = todayWith.filter(x => now.totalMins < x.w.startMins).sort((a, b) => a.w.startMins - b.w.startMins)[0]
    if (upcoming) {
      return {
        allowed: false,
        reason:  `Your ${upcoming.w.label} shift starts at ${formatHm(upcoming.w.startMins)} IST. Come back then.`,
        activeShift:    null,
        windowStartIst: formatHm(upcoming.w.startMins),
        windowEndIst:   formatHm(upcoming.w.endMins),
        expiresAtMs:    null,
      }
    }
    return {
      allowed: false,
      reason:  'Your shift window for today has ended. You can sign in again on your next assigned shift date.',
      activeShift: null, windowStartIst: null, windowEndIst: null, expiresAtMs: null,
    }
  }

  return {
    allowed: false,
    reason:  'You have no audit shift assigned for today. Ask the roster admin to assign you on a shift date.',
    activeShift: null, windowStartIst: null, windowEndIst: null, expiresAtMs: null,
  }
}
