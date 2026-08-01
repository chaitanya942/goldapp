// app/api/purchases/live-rates/route.js
//
// Live gold buying rates from the NEW CRM. The rate operations sets per state
// lives in the NEW-CRM Postgres `GoldRate` table (one active row per state,
// with per-purity bands + margins). Every estimation snapshots these values, so
// they are the authoritative live board.
//
//   GET /api/purchases/live-rates  → { rates: [ { state, code, rate_24k,
//        rate_22k, rate_17_21k, rate_14_17k, margin_24k, margin_22k,
//        is_offline, updated_at } ], fetched_at }
//
// Read-only. The app never writes NEW-CRM rates — ops manage them in the CRM.

import { Client } from 'pg'
import { requireAuthForPage } from '../../../../lib/apiAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  // Same page gate as the rest of the Purchase module.
  const auth = await requireAuthForPage(req, 'purchase-data')
  if (!auth.ok) return auth.response

  const client = new Client({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  })

  try {
    await client.connect()
    // Latest GoldRate row per state (the active rate). state names come from the
    // State table — never a hardcoded list.
    const { rows } = await client.query(`
      SELECT DISTINCT ON (g.state_id)
        s.name           AS state,
        s.code           AS code,
        g.rate_24k       AS rate_24k,
        g.rate_22k       AS rate_22k,
        g.rate_17_21k    AS rate_17_21k,
        g.rate_14_17k    AS rate_14_17k,
        g.margin_24k     AS margin_24k,
        g.margin_22k     AS margin_22k,
        g.is_offline     AS is_offline,
        g.updated_at     AS updated_at
      FROM "GoldRate" g
      JOIN "State" s ON s.id = g.state_id
      ORDER BY g.state_id, g.updated_at DESC NULLS LAST, g.created_at DESC NULLS LAST
    `)
    // Present alphabetically by state.
    rows.sort((a, b) => String(a.state || '').localeCompare(String(b.state || '')))
    return Response.json({ rates: rows, fetched_at: new Date().toISOString() })
  } catch (e) {
    return Response.json({ error: 'Could not load live rates: ' + (e?.message || e) }, { status: 502 })
  } finally {
    try { await client.end() } catch {}
  }
}
