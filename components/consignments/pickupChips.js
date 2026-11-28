'use client'

// Branch pickup-schedule chips — shared by Booking Volume and Branch Stock so
// both show a branch's BVC pickup the same way: a gold ⏱ time chip (12h) and a
// days chip listing only the days pickup runs (Mon–Sat compacts to a range).

export const PICKUP_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Branch pickup_time is stored 24h ("16:00"); ops want it read as 12h with
// AM/PM. Anything that isn't HH:MM (free-form notes) is shown verbatim.
export function fmtPickupTime(s) {
  if (!s) return ''
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s).trim())
  if (!m) return String(s)
  let h = Number(m[1]); const min = m[2]
  const ap = h < 12 ? 'AM' : 'PM'
  h = h % 12 || 12
  return `${h}:${min} ${ap}`
}

export function PickupTimeChip({ t, time }) {
  if (!time) return null
  return (
    <span title={`Scheduled pickup time · ${fmtPickupTime(time)} (informational — pickups can run late)`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        fontSize: 11, fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap',
        color: t.gold, background: `${t.gold}12`, border: `1px solid ${t.gold}3a`,
        borderRadius: 6, padding: '3px 9px', lineHeight: 1.25 }}>
      <span aria-hidden="true" style={{ fontSize: 10 }}>⏱</span>{fmtPickupTime(time)}
    </span>
  )
}

export function PickupDaysChip({ t, days }) {
  if (!Array.isArray(days) || days.length === 0) return null
  // Show ONLY the days pickup actually runs — ops don't want the skipped days
  // shown at all (an earlier full-week bar that greyed the off-days read as
  // "all 6 days"). A genuine Mon–Sat branch compacts to a range; anything else
  // lists its days, so a Tue/Thu/Sat branch pops as exactly that.
  const active = PICKUP_WEEK.filter(d => days.includes(d))
  if (!active.length) return null
  const full = active.length === PICKUP_WEEK.length
  return (
    <span title={`Pickup days · ${active.join(', ')}`}
      style={{
        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
        fontSize: 12, fontWeight: 800, letterSpacing: '.01em', whiteSpace: 'nowrap',
        color: t.gold, background: `${t.gold}22`,
        border: `1px solid ${t.gold}5c`, borderRadius: 6, padding: '3px 11px', lineHeight: 1.25,
      }}>
      {full ? 'Mon–Sat' : active.map((d, i) => (
        <span key={d} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {i > 0 && <span style={{ margin: '0 5px', color: `${t.gold}7a`, fontWeight: 700 }}>·</span>}
          {d}
        </span>
      ))}
    </span>
  )
}
