/**
 * Background CRM→Supabase sync worker — runs as a separate long-lived
 * Railway service so freshness doesn't depend on anyone keeping the
 * dashboard open. Hits the same /api/sync-purchases endpoint that the
 * client-side triggerSync helper hits, but on a fixed cadence regardless
 * of user activity.
 *
 * The GET handler on /api/sync-purchases is CRON_SECRET-gated server-to-
 * server (no user session needed), so this worker only needs the secret
 * to authenticate.
 *
 * Deploy as a new Railway service in the same project, pointing at this
 * repo, with start command `node scripts/cron-sync.mjs`. Required env vars
 * on that service:
 *   APP_URL       — https://goldapp-production.up.railway.app
 *   CRON_SECRET   — same secret set on the web service (any strong random string)
 *
 * Optional env vars:
 *   SYNC_INTERVAL_MS — defaults to 30000 (30 seconds)
 *   SYNC_DAYS        — defaults to 2 (matches client-side triggerSync)
 *
 * The script runs forever, retrying on failure, logging each tick so you
 * can scan Railway logs for sync health.
 */

const APP_URL        = (process.env.APP_URL || '').replace(/\/$/, '')
const CRON_SECRET    = process.env.CRON_SECRET || ''
const INTERVAL_MS    = Number(process.env.SYNC_INTERVAL_MS) || 30_000
const SYNC_DAYS      = Number(process.env.SYNC_DAYS) || 2

if (!APP_URL || !CRON_SECRET) {
  console.error('[cron-sync] missing required env vars APP_URL or CRON_SECRET — exiting')
  process.exit(1)
}

const ENDPOINT     = `${APP_URL}/api/sync-purchases?days=${SYNC_DAYS}`
const EOD_ENDPOINT = `${APP_URL}/api/eod-inventory-snapshot`
const HEADERS      = { Authorization: `Bearer ${CRON_SECRET}` }
// /api/eod-inventory-snapshot POST gates on x-cron-token (not Bearer).
const EOD_HEADERS  = { 'x-cron-token': CRON_SECRET, 'Content-Type': 'application/json' }

let inFlight     = false      // guard against overlap if a sync runs longer than the interval
let lastEodDate  = ''         // YYYY-MM-DD (IST) of the last successful EOD snapshot — keeps us idempotent within a day

// IST date helper — Asia/Kolkata is fixed UTC+5:30, no DST so we can shift manually.
const istNow = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const istDateStr = () => istNow().toISOString().slice(0, 10)

async function maybeRunEodSnapshot() {
  const ist = istNow()
  const hh  = ist.getUTCHours()
  const mm  = ist.getUTCMinutes()
  // Fire once daily after 23:30 IST. If the worker was offline at 23:30, the
  // next tick at/after that time still triggers it (we just guard with
  // lastEodDate so we don't run multiple times per day).
  const afterThreshold = hh > 23 || (hh === 23 && mm >= 30)
  if (!afterThreshold) return
  const today = istDateStr()
  if (lastEodDate === today) return

  try {
    const res  = await fetch(EOD_ENDPOINT, { method: 'POST', headers: EOD_HEADERS })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = { raw: text } }
    if (!res.ok || body.success === false) {
      console.error(new Date().toISOString(), `[cron-sync] EOD snapshot FAIL ${res.status}`, body.error || text.slice(0, 200))
    } else {
      lastEodDate = today
      console.log(new Date().toISOString(), `[cron-sync] EOD snapshot ok for ${today}`)
    }
  } catch (err) {
    console.error(new Date().toISOString(), '[cron-sync] EOD snapshot threw:', err?.message || err)
  }
}

async function syncOnce() {
  if (inFlight) {
    console.log(new Date().toISOString(), '[cron-sync] previous run still in flight, skipping tick')
    return
  }
  inFlight = true
  const startedAt = Date.now()
  try {
    const res  = await fetch(ENDPOINT, { headers: HEADERS })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = { raw: text } }
    const ms = Date.now() - startedAt
    if (!res.ok || body.success === false) {
      console.error(new Date().toISOString(), `[cron-sync] FAIL ${res.status} (${ms}ms)`, body.error || body.message || text.slice(0, 200))
    } else {
      console.log(new Date().toISOString(), `[cron-sync] ok (${ms}ms)`, body.message || `synced ${body.synced} renamed ${body.renamed || 0}`)
    }
  } catch (err) {
    console.error(new Date().toISOString(), '[cron-sync] threw:', err?.message || err)
  } finally {
    inFlight = false
  }

  // Piggy-back the daily EOD snapshot on this tick — runs at most once per
  // IST day, only after 23:30 IST. Fire-and-forget; sync health isn't tied to it.
  maybeRunEodSnapshot().catch(() => null)
}

console.log(`[cron-sync] starting — ${ENDPOINT} every ${INTERVAL_MS}ms`)
syncOnce()
setInterval(syncOnce, INTERVAL_MS)

// Graceful shutdown on Railway restarts/deploys.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[cron-sync] received ${sig}, exiting`)
    process.exit(0)
  })
}
