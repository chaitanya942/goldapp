// lib/businessCalendarInsight.js
//
// "Today's Insight" for the Dashboard — a heuristic, South Indian
// Panchangam-aware read on whether walk-in gold-SELLING is likely to run
// low or normal today. This is a PURCHASE business (buying gold FROM the
// public), so the driving logic throughout is:
//
//   auspicious-for-BUYING-gold day → people want to ACQUIRE gold, not part
//   with it → sellers are more hesitant → SELLING volume trends LOW.
//
// This is advisory, not a statistical forecast — there is no correlation
// against this business's own historical purchase data behind it (that
// would be a separate, much bigger project). Treat the label as "here's
// what regional custom would predict," a heads-up for staffing/expectations,
// not a guaranteed outcome.
//
// DATES ARE YEAR-SPECIFIC. Lunar-calendar occasions (Amavasya, Akshaya
// Tritiya, Ugadi, Navaratri, Onam, Diwali, Varalakshmi Vratam) shift every
// year and are hand-curated per year below, verified against Drik Panchang
// (Bengaluru) and other published 2026 panchangams. THIS FILE MUST BE
// REFRESHED EVERY YEAR — a date not covered here silently falls back to
// just the weekly Tuesday/Friday rule (see getDayInsight below), which is
// the one evergreen, day-of-week-only signal that needs no yearly update.

const YEARLY_DATA = {
  2026: {
    // One date per lunar month. Where a source listed two consecutive days
    // for the same tithi (it can straddle midnight), both are included —
    // better to flag an extra day than miss the real one.
    amavasya: [
      '2026-01-18', '2026-02-17', '2026-03-18', '2026-03-19',
      '2026-04-17', '2026-05-16', '2026-06-14', '2026-06-15',
      '2026-07-14', '2026-08-12', '2026-09-10', '2026-09-11',
      '2026-10-10', '2026-11-08', '2026-11-09', '2026-12-08',
    ],
    // Single-day festivals/occasions strongly associated with BUYING gold —
    // each is a real, named entry so the UI can say why, not just "festival".
    festivals: [
      { date: '2026-01-14', name: 'Makar Sankranti / Pongal' },
      { date: '2026-03-19', name: 'Ugadi (Kannada/Telugu New Year)' },
      { date: '2026-04-19', name: 'Akshaya Tritiya', weight: 3 },   // the single most gold-buying-auspicious day of the year
      { date: '2026-08-25', name: 'Onam (First Onam)' },
      { date: '2026-08-26', name: 'Thiruvonam (Onam, main day)' },
      { date: '2026-08-28', name: 'Varalakshmi Vratam' },
      { date: '2026-10-19', name: 'Vijayadashami (Dussehra)' },
      { date: '2026-10-20', name: 'Vijayadashami (Dussehra)' },
      { date: '2026-11-06', name: 'Dhanteras' },
      { date: '2026-11-07', name: 'Deepavali (South India)' },
    ],
    // Ranges — a whole window carries a lighter, sustained effect rather
    // than one sharp dip/spike.
    ranges: [
      // Tamil solar month; also Ashada-Shravana under Amavasyant systems.
      // Widely observed as a subdued month for major purchases across South
      // India — retailers running "Aadi sale" discounts to counter the lull
      // is itself evidence this is a genuinely low-activity period for gold.
      { from: '2026-07-17', to: '2026-08-17', name: 'Aadi Masam', effect: 'low', weight: 1 },
      // Navaratri — nine nights of festivities leading into Vijayadashami;
      // gifting/buying skews up, so selling skews down for the window, not
      // just the final day (already covered above).
      { from: '2026-03-19', to: '2026-03-27', name: 'Vasanta Navaratri', effect: 'low', weight: 1 },
      { from: '2026-10-11', to: '2026-10-19', name: 'Sharada Navaratri',  effect: 'low', weight: 1 },
      // Peak Indian wedding season (Dev Uthani Ekadashi onward, and again
      // after Uttarayana) — gold jewellery demand is reported to peak here,
      // meaning families are acquiring rather than parting with gold.
      // Deliberately EXCLUDES mid-Dec–mid-Jan (Dhanu/Shunya Masam), when
      // South Indian custom pauses weddings entirely, so that gap reads as
      // a normal day rather than incorrectly "high wedding season".
      { from: '2026-11-01', to: '2026-12-15', name: 'Wedding season',    effect: 'low', weight: 1 },
      { from: '2026-01-15', to: '2026-02-28', name: 'Wedding season',    effect: 'low', weight: 1 },
    ],
  },
}

function inRange(dateStr, from, to) {
  return dateStr >= from && dateStr <= to
}

// IST weekday for a 'YYYY-MM-DD' string — treated as an IST calendar date
// directly (no further TZ shift), matching every other istXxx helper's
// "the string IS the IST day" convention in this codebase.
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()   // 0=Sun..6=Sat
}

/**
 * @param {string} dateStr 'YYYY-MM-DD' (IST calendar day)
 * @returns {{ level: 'low'|'low-normal'|'normal', score: number, factors: {label:string, weight:number}[], dataAvailable: boolean }}
 */
export function getDayInsight(dateStr) {
  const factors = []
  let score = 0

  const dow = weekdayOf(dateStr)
  if (dow === 2) factors.push({ label: 'Tuesday — considered auspicious; sellers tend to hold back', weight: 1 })
  if (dow === 5) factors.push({ label: 'Friday — considered auspicious; sellers tend to hold back', weight: 1 })

  const year = Number(dateStr.slice(0, 4))
  const yearData = YEARLY_DATA[year]
  const dataAvailable = !!yearData

  if (yearData) {
    if (yearData.amavasya.includes(dateStr)) {
      factors.push({ label: 'Amavasya (new moon) — traditionally a low-activity day', weight: 2 })
    }
    for (const f of yearData.festivals) {
      if (f.date === dateStr) factors.push({ label: f.name, weight: f.weight || 2 })
    }
    for (const r of yearData.ranges) {
      if (inRange(dateStr, r.from, r.to)) factors.push({ label: r.name, weight: r.weight || 1 })
    }
  }

  score = factors.reduce((s, f) => s + f.weight, 0)
  const level = score >= 3 ? 'low' : score >= 1 ? 'low-normal' : 'normal'

  return { level, score, factors, dataAvailable }
}
