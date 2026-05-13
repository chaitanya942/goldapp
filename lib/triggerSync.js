// Shared CRM→Supabase sync trigger with in-flight + min-interval guard.
//
// Multiple surfaces (Dashboard, Branch Stock, Consignment Data, Live Feed
// flashcards) all want the purchases table to be as fresh as CRM. If each
// one fires its own POST every 10 s independently, the server gets
// overlapping syncs that pile up. This helper coalesces them: while a sync
// is in flight every caller awaits the same promise, and a freshly-completed
// sync short-circuits any caller within `minIntervalMs`.
//
// Usage:
//   import { triggerSync } from '../../lib/triggerSync'
//   triggerSync()                       // fire-and-forget
//   await triggerSync()                 // wait for fresh data
//   triggerSync({ minIntervalMs: 0 })   // force a fresh sync (refresh button)

import { authedFetch } from './authedFetch'

let lastFinishedAt = 0
let inFlight       = null

export function triggerSync({ minIntervalMs = 8000, days = 2 } = {}) {
  if (inFlight) return inFlight
  if (Date.now() - lastFinishedAt < minIntervalMs) return Promise.resolve(null)

  inFlight = authedFetch(`/api/sync-purchases?days=${days}`, { method: 'POST' })
    .catch(() => null)
    .finally(() => {
      lastFinishedAt = Date.now()
      inFlight = null
    })
  return inFlight
}
