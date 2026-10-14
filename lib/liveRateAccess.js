// Who sees the dashboard's live gold-rate strip (24K / 22K / 18K): every
// super_admin, plus these named users. Plain module (not 'use client') so the
// API route and the dashboards share one list.
export const LIVE_RATE_EMAILS = [
  'director@whitegroup.in',     // Rahul Joseph
  'saleshead@whitegold.money',  // Mithun Shetty
]

export function canSeeLiveRates(role, email) {
  return role === 'super_admin' || LIVE_RATE_EMAILS.includes(String(email || '').trim().toLowerCase())
}
