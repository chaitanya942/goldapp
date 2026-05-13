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

const ENDPOINT = `${APP_URL}/api/sync-purchases?days=${SYNC_DAYS}`
const HEADERS  = { Authorization: `Bearer ${CRON_SECRET}` }

let inFlight = false   // guard against overlap if a sync runs longer than the interval

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
