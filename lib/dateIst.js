// Centralised IST (Asia/Kolkata, UTC+05:30) date helpers.
// Use these everywhere instead of inline `new Date(Date.now() + 5.5 * 3600 * 1000)`
// shims so server (Railway = UTC) and client stay in lock-step.
//
// Convention (matches the project's pre-existing inline pattern):
//   - istNow()       → Date pre-shifted by +5:30. getUTC*() / setDate() read & operate
//                      on IST calendar fields. toISOString() then emits the IST date.
//                      Use for date arithmetic ("yesterday", "7 days ago", etc).
//   - istStr(d)      → 'YYYY-MM-DD' for a pre-shifted Date (or current IST if omitted).
//                      Pass the result of istNow() or arithmetic on it.
//   - istToday()     → 'YYYY-MM-DD' for today in IST. Convenience for istStr().
//   - istDaysAgo(n)  → 'YYYY-MM-DD' for n days ago in IST.
//   - istHour()      → integer 0-23 for current IST hour.
//   - istStartOfDayIso(ymd) / istEndOfDayIso(ymd) → UTC ISO instants bounding an
//                      IST calendar day. Use in TIMESTAMPTZ .gte() / .lte() filters.
//   - fmtIst(input)  → "10 May 2026, 12:34" via Intl in Asia/Kolkata.
//   - fmtIstDate(input) → "10 May 2026".

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export const istNow = () => new Date(Date.now() + IST_OFFSET_MS)

// Pass a pre-shifted Date (e.g. from istNow()). If you have a *real* Date and
// want its IST calendar day, use fromUtcDate() below to shift first.
export const istStr = (d = istNow()) => d.toISOString().slice(0, 10)

export const istToday = () => istStr()

export const istDaysAgo = (n) => {
  const d = istNow()
  d.setUTCDate(d.getUTCDate() - n)
  return istStr(d)
}

export const istHour = () => istNow().getUTCHours()

// Shift a real (UTC) Date into the IST-aligned representation used by istStr / arithmetic.
export const fromUtcDate = (d) => new Date((d instanceof Date ? d.getTime() : Date.now()) + IST_OFFSET_MS)

// Convenience: real Date → 'YYYY-MM-DD' in IST.
export const istDateStr = (d) => istStr(fromUtcDate(d))

// IST midnight of `ymd` expressed as a UTC ISO instant.
// Use for TIMESTAMPTZ .gte() / .lte() filters so the boundary lines up
// with the IST calendar day, not the server's local day.
export const istStartOfDayIso = (ymd) => new Date(`${ymd}T00:00:00+05:30`).toISOString()
export const istEndOfDayIso   = (ymd) => new Date(`${ymd}T23:59:59.999+05:30`).toISOString()

// Pretty-print a Date or ISO string in IST. Defaults to "10 May 2026, 12:34".
export const fmtIst = (input, opts = {}) => {
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d)) return ''
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    ...opts,
  })
}

// Date-only IST formatter. "10 May 2026".
export const fmtIstDate = (input) => fmtIst(input, { hour: undefined, minute: undefined, hour12: undefined })

// ── Working-day arithmetic (skip Sundays — logistics partner is off) ────────
// Used by both the Consignment Report (Expected Delivery) and Bidding Volume
// (arrival_date) so the two screens render the same date for the same input.
//
// Examples (n = ceil(delivery_tat_hours / 24)):
//   Saturday + 1 working day = Monday   (24h TAT — Sunday skipped)
//   Saturday + 2 working days = Tuesday (48h TAT — Sunday skipped)
//   Friday   + 2 working days = Monday  (Sat + Sun → only Sat counts, then Mon)
//
// Caller responsibility: convert TAT hours → working days first (ceil-divide
// by 24). Returns the input unchanged for n <= 0 or invalid input.
export function addWorkingDaysSkipSunday(yyyymmdd, n) {
  if (!yyyymmdd || !Number.isFinite(n) || n <= 0) return yyyymmdd
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  let added = 0
  while (added < n) {
    dt.setUTCDate(dt.getUTCDate() + 1)
    if (dt.getUTCDay() !== 0) added += 1   // 0 = Sunday (no logistics)
  }
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}
