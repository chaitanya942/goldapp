// app/api/admin/holidays/route.js
//
// Admin → Calendar API: statewise holiday list backing the dashboard
// monthly run-rate / closure projection.
//
// GET    ?state=&year=     → list rows (default: all states, current year)
// POST   { kind: 'upsert', rows: [...] }     → bulk upsert (insert-or-update by date+state)
// POST   { kind: 'toggle', id, is_active }   → flip the soft-delete flag
// DELETE ?id=<uuid>                          → hard delete (rare; soft toggle preferred)
//
// Gated by requireAuthForPage('holiday-calendar') so whichever role ops
// grants the page to (custom roles included via Role Management) can read
// and write the calendar. Same pattern as Logistics.

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const ALLOWED_STATES = new Set(['Karnataka', 'Andhra Pradesh', 'Telangana', 'Kerala', 'All India'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ─────────────────────────────────────────────────────────────────────────────
// GET — list holidays. Optional filters: state, year.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req) {
  const auth = await requireAuthForPage(req, 'holiday-calendar')
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const state = searchParams.get('state') || null
    const year  = searchParams.get('year')  || null

    let q = supabase
      .from('holiday_calendar')
      .select('id, holiday_date, state, description, is_active, created_at, created_by, updated_at, updated_by')
      .order('holiday_date', { ascending: true })
      .order('state',        { ascending: true })

    if (state && ALLOWED_STATES.has(state)) {
      q = q.eq('state', state)
    }
    if (year && /^\d{4}$/.test(year)) {
      q = q.gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
    }

    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ holidays: data || [] })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — upsert one row or many. Same endpoint handles both:
//   - { kind:'upsert', rows: [{ holiday_date, state, description, is_active }] }
//   - { kind:'toggle', id, is_active }
// Bulk upsert is keyed on (holiday_date, state) — the unique constraint from
// the schema. So re-adding the same (date, state) just updates description.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req) {
  const auth = await requireAuthForPage(req, 'holiday-calendar')
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const kind = body?.kind

    if (kind === 'toggle') {
      const { id, is_active } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const { data, error } = await supabase
        .from('holiday_calendar')
        .update({ is_active: !!is_active, updated_by: auth.user.id })
        .eq('id', id)
        .select()
        .single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ holiday: data })
    }

    if (kind === 'upsert') {
      const raw = Array.isArray(body?.rows) ? body.rows : []
      if (raw.length === 0) return Response.json({ error: 'rows[] required' }, { status: 400 })

      // Validate + normalise. Reject the whole batch if any row is malformed
      // — bulk-add UX is "all-or-nothing" so the admin sees one clean error
      // instead of partial writes scattered across the table.
      const cleaned = []
      const errors  = []
      raw.forEach((r, i) => {
        if (!r.holiday_date || !DATE_RE.test(String(r.holiday_date))) {
          errors.push(`row ${i + 1}: holiday_date must be YYYY-MM-DD`); return
        }
        if (!r.state || !ALLOWED_STATES.has(r.state)) {
          errors.push(`row ${i + 1}: state must be one of ${[...ALLOWED_STATES].join(', ')}`); return
        }
        cleaned.push({
          holiday_date: r.holiday_date,
          state:        r.state,
          description:  (r.description || '').trim() || null,
          is_active:    r.is_active === false ? false : true,
          created_by:   auth.user.id,
          updated_by:   auth.user.id,
        })
      })
      if (errors.length) return Response.json({ error: errors.join(' · ') }, { status: 400 })

      const { data, error } = await supabase
        .from('holiday_calendar')
        .upsert(cleaned, { onConflict: 'holiday_date,state' })
        .select()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ holidays: data || [], upserted: cleaned.length })
    }

    return Response.json({ error: `Unknown kind '${kind}'` }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE ?id=<uuid> — hard delete. Prefer toggle for routine ops; this is
// only for cleaning up mistakes / test data.
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req) {
  const auth = await requireAuthForPage(req, 'holiday-calendar')
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await supabase.from('holiday_calendar').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
