// app/api/diag-new-crm/route.js
// TEMPORARY diagnostic — reports (a) this Railway service's current outbound
// IP and (b) a live connectivity test against the New CRM Postgres database,
// so ops can tell whether Railway's egress IP is on the RDS security group's
// allowlist. New CRM Live Feed + the goldapp-cron sync have been failing with
// connect ETIMEDOUT while the DB is reachable from outside Railway — this
// endpoint exists to get the exact IP to allowlist without guessing.
//
// DELETE THIS FILE once the connectivity issue is resolved — it's a one-off
// diagnostic, not a permanent feature.

import { Client } from 'pg'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'
import { newCrmSslForPg } from '../../../lib/newCrmPg'

export const runtime = 'nodejs'

export async function GET(req) {
  // Admin session (normal in-app call) OR a shared secret as a query param —
  // this is meant to be opened directly in a browser address bar, which
  // can't attach the Bearer token authedFetch sends, so a pure session check
  // would always 401 a manual check. Reuses CRON_SECRET (already set in
  // Railway for the cron worker) rather than adding a new env var just for
  // a temporary diagnostic.
  const { searchParams } = new URL(req.url)
  const hasSecret = !!process.env.CRON_SECRET && searchParams.get('key') === process.env.CRON_SECRET
  if (!hasSecret) {
    const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
    if (!auth.ok) return auth.response
  }

  // What IP is this Railway instance's traffic leaving from right now? That's
  // exactly what needs to be on the RDS security group's inbound allowlist.
  let outboundIp = null, ipLookupError = null
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
    const j = await r.json()
    outboundIp = j.ip || null
  } catch (e) {
    ipLookupError = e?.message || String(e)
  }

  // Live connect attempt against the New CRM DB, same config as
  // app/api/sync-new-crm/route.js.
  const client = new Client({
    host:     process.env.NEW_CRM_DB_HOST,
    port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME,
    user:     process.env.NEW_CRM_DB_USER,
    password: process.env.NEW_CRM_DB_PASSWORD,
    ssl:      newCrmSslForPg(),
    connectionTimeoutMillis: 8000,
  })
  const t0 = Date.now()
  let connected = false, dbTime = null, dbError = null
  try {
    await client.connect()
    const res = await client.query('select now() as db_time')
    dbTime = res.rows?.[0]?.db_time || null
    connected = true
  } catch (e) {
    dbError = { code: e?.code || null, message: e?.message || String(e) }
  } finally {
    try { await client.end() } catch {}
  }

  return Response.json({
    railway_outbound_ip: outboundIp,
    ip_lookup_error: ipLookupError,
    new_crm_db: {
      host: process.env.NEW_CRM_DB_HOST || null,
      port: process.env.NEW_CRM_DB_PORT || null,
      pgbouncer_mode: process.env.NEW_CRM_DB_PGBOUNCER === 'true',
      connected,
      elapsed_ms: Date.now() - t0,
      db_time: dbTime,
      error: dbError,
    },
  })
}
