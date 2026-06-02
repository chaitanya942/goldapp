// app/api/audit-shifts/route.js
//
// Audit Roster shift assignments — read + write for the Night / Morning
// auditor picker on the Audit Roster page.
//
//   GET  /api/audit-shifts?date=YYYY-MM-DD
//     Returns { night: [...assignments], morning: [...assignments] } for the
//     given calendar day. Each assignment carries the auditor's name + email
//     so the UI can render chips without a second lookup.
//
//   POST /api/audit-shifts
//     Body: { shift_date, shift_type, auditor_id }
//     Inserts one assignment. DB triggers enforce the 2-auditors-per-slot cap
//     and the no-back-to-back (night N → morning N+1) rule. Their RAISE
//     EXCEPTION messages are returned verbatim so ops sees exactly why a
//     pick was rejected.
//
//   DELETE /api/audit-shifts?id=<assignment_id>
//     Removes one assignment.

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const VALID_SHIFTS = new Set(['night', 'morning'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Roles that count as "an auditor" for shift staffing. Kept in lockstep
// with AUDITOR_ROLES in components/consignments/AuditRoster.js.
// master_auditor is admin-like but still does the actual audit work, so
// they're assignable too. Both 'master_auditor' and the typo
// 'mater_auditor' are accepted since ops may have created either.
const AUDITOR_ROLES = new Set(['audit', 'master_auditor', 'mater_auditor'])

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req) {
  const auth = await requireAuthForPage(req, 'audit-roster')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  if (!date || !DATE_RE.test(date)) {
    return Response.json({ error: 'date (YYYY-MM-DD) required' }, { status: 400 })
  }

  // Pull night-on-date + morning-on-date together. Two rows max per shift.
  const { data: rows, error } = await supabase
    .from('audit_shift_assignments')
    .select('id, shift_date, shift_type, auditor_id, assigned_at, assigned_by')
    .eq('shift_date', date)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Resolve auditor UUIDs to {name, email} so the UI doesn't need a second
  // round-trip to render a chip.
  const auditorIds = [...new Set((rows || []).map(r => r.auditor_id))]
  let auditorByid = new Map()
  if (auditorIds.length) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, full_name, email')
      .in('id', auditorIds)
    auditorByid = new Map((profiles || []).map(p => [p.id, p]))
  }

  const enrich = (r) => ({
    ...r,
    auditor: auditorByid.get(r.auditor_id) || null,
  })

  const night   = (rows || []).filter(r => r.shift_type === 'night').map(enrich)
  const morning = (rows || []).filter(r => r.shift_type === 'morning').map(enrich)

  return Response.json({ date, night, morning })
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req) {
  const auth = await requireAuthForPage(req, 'audit-roster')
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const { shift_date, shift_type, auditor_id } = body

  if (!shift_date || !DATE_RE.test(shift_date)) {
    return Response.json({ error: 'shift_date (YYYY-MM-DD) required' }, { status: 400 })
  }
  if (!shift_type || !VALID_SHIFTS.has(shift_type)) {
    return Response.json({ error: 'shift_type must be "night" or "morning"' }, { status: 400 })
  }
  if (!auditor_id) {
    return Response.json({ error: 'auditor_id required' }, { status: 400 })
  }

  // Sanity check: the auditor must exist and have the audit role. We don't
  // want to assign a non-audit user to an audit shift even if the UI passes
  // the wrong id.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('id', auditor_id)
    .maybeSingle()
  if (!profile)            return Response.json({ error: 'Auditor not found' }, { status: 404 })
  if (!AUDITOR_ROLES.has(profile.role)) {
    return Response.json({ error: `User is not an auditor (role '${profile.role}' is not assignable to shifts).` }, { status: 400 })
  }
  if (profile.is_active === false) {
    return Response.json({ error: 'Auditor is inactive' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('audit_shift_assignments')
    .insert({
      shift_date,
      shift_type,
      auditor_id,
      assigned_by: auth.user?.id || null,
    })
    .select()
    .single()
  if (error) {
    // The triggers in sql/audit_shift_assignments.sql raise human-readable
    // messages — pass them through. PGRST codes for trigger violations
    // come back as 23514 (check_violation, via the RAISE) or 23505
    // (unique_violation for re-assigning the same auditor).
    return Response.json({ error: error.message || 'Failed to assign auditor' }, { status: 400 })
  }
  return Response.json({ assignment: data })
}

// ── DELETE ──────────────────────────────────────────────────────────────────
export async function DELETE(req) {
  const auth = await requireAuthForPage(req, 'audit-roster')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('audit_shift_assignments')
    .delete()
    .eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
