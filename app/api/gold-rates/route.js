// app/api/gold-rates/route.js
// Live gold buying rates from the new CRM (Postgres). One row per state with
// the most recent rate, joined to the State table for human-readable names.
//
// Source of truth: "GoldRate" table in the new CRM. The new-CRM team owns the
// feeder process that inserts a row per state on each rate change. We just
// surface the latest row per state to the admin UI.

import postgres from 'postgres'
import { requireAuth } from '../../../lib/apiAuth'

// Small in-memory cache so multiple users polling every 30s share one DB hit.
// Rates only change every few minutes at most, so a 15s TTL is generous.
const CACHE_TTL_MS = 15_000
let cache = null   // { data, ts }

let sqlRef
function getSql() {
  if (sqlRef) return sqlRef
  const sslOptions = process.env.NEW_CRM_DB_CA
    ? { ca: process.env.NEW_CRM_DB_CA, rejectUnauthorized: true }
    : { rejectUnauthorized: false }
  sqlRef = postgres({
    host:     process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
    database: process.env.NEW_CRM_DB_NAME,
    username: process.env.NEW_CRM_DB_USER,
    password: process.env.NEW_CRM_DB_PASSWORD,
    ssl:      sslOptions,
    connect_timeout: 5,
    idle_timeout:    10,
    max:             2,
  })
  return sqlRef
}

export async function GET(req) {
  // Any authenticated user can read rates — this is operational reference data,
  // not customer-PII. Page-level role gating happens client-side via canSee.
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json({ ...cache.data, cached: true })
  }

  try {
    const sql = getSql()
    // DISTINCT ON (state_id) + ORDER BY state_id, created_at DESC gives us
    // exactly one row per state — the most recent. LEFT JOIN State for the
    // display name; if a rate row's state_id is orphaned we still return the
    // numbers (state field becomes null and the UI shows the raw id).
    const rows = await sql`
      SELECT DISTINCT ON (gr.state_id)
        gr.state_id,
        s.name        AS state,
        gr.rate_22k,
        gr.rate_24k,
        gr.rate_17_21k,
        gr.rate_14_17k,
        gr.margin_22k,
        gr.margin_24k,
        gr.created_at,
        gr.updated_at
      FROM "GoldRate" gr
      LEFT JOIN "State" s ON s.id = gr.state_id
      ORDER BY gr.state_id, gr.created_at DESC
    `

    const rates = rows.map(r => ({
      state:        r.state || null,
      state_id:     r.state_id,
      rate_22k:     Number(r.rate_22k)     || 0,
      rate_24k:     Number(r.rate_24k)     || 0,
      rate_17_21k:  Number(r.rate_17_21k)  || 0,
      rate_14_17k:  Number(r.rate_14_17k)  || 0,
      margin_22k:   Number(r.margin_22k)   || 0,
      margin_24k:   Number(r.margin_24k)   || 0,
      created_at:   r.created_at,
      updated_at:   r.updated_at,
    }))

    const newestTs = rates.reduce(
      (max, r) => r.created_at && (!max || new Date(r.created_at) > new Date(max)) ? r.created_at : max,
      null
    )

    const data = { rates, newest_at: newestTs, count: rates.length }
    cache = { data, ts: Date.now() }
    return Response.json(data)
  } catch (err) {
    console.error('gold-rates error:', err)
    return Response.json({ error: err.message, rates: [], count: 0 }, { status: 500 })
  }
}
