// app/api/auditor-access/route.js
//
// Client-facing status endpoint for the audit-shift time gate.
//
//   GET /api/auditor-access
//     For role === 'audit' users: looks up their assigned shifts for today
//     (IST) and runs the shift-window check in lib/auditShiftGate.js.
//     Returns:
//       {
//         role:          'audit' | <other>,
//         gated:         true,         // false for all non-audit roles
//         allowed:       true | false,
//         reason:        string,
//         activeShift:   { shift_date, shift_type } | null,
//         windowStartIst: 'HH:MM' | null,
//         windowEndIst:   'HH:MM' | null,
//         expiresAtMs:    number | null,    // when allowed=true: ms-since-epoch the window closes
//       }
//
//     For every other role: returns { role, gated: false, allowed: true }.
//
// IMPORTANT: This endpoint MUST be reachable when the auditor is outside
// their window — otherwise the client gate would itself be blocked and
// couldn't tell the user why they're being signed out. We achieve that
// by passing { skipAuditGate: true } to requireAuth so apiAuth doesn't
// short-circuit role=audit users on this specific route.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { auditorAccessNow, findNextShift, getIstNow } from '../../../lib/auditShiftGate'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

export async function GET(req) {
  const auth = await requireAuth(req, { skipAuditGate: true })
  if (!auth.ok) return auth.response

  // Non-audit roles bypass the gate unconditionally.
  if (auth.role !== 'audit') {
    return Response.json({
      role:    auth.role,
      gated:   false,
      allowed: true,
      reason:  '',
      auditor: null,
      activeShift:    null,
      nextShift:      null,
      windowStartIst: null,
      windowEndIst:   null,
      expiresAtMs:    null,
    })
  }

  // Pull this auditor's shifts from today onwards. We need today's set to
  // evaluate the current window, and the broader future set so the lock
  // screen can show "Your next shift opens at X" when they're denied.
  const today = getIstNow().date
  const { data: shifts, error } = await supabase
    .from('audit_shift_assignments')
    .select('shift_date, shift_type')
    .eq('auditor_id', auth.profile.id)
    .gte('shift_date', today)
    .order('shift_date', { ascending: true })

  const auditor = {
    id:        auth.profile.id,
    full_name: auth.profile.full_name || null,
    email:     auth.profile.email     || null,
  }

  if (error) {
    // Fail-closed: an auditor we can't verify against the table is denied.
    // Better to lock out one auditor for a minute than silently let
    // someone in during a Supabase hiccup.
    return Response.json({
      role: 'audit', gated: true, allowed: false,
      reason: 'Unable to verify your shift assignment right now. Try again in a minute.',
      auditor, activeShift: null, nextShift: null,
      windowStartIst: null, windowEndIst: null, expiresAtMs: null,
    }, { status: 200 })
  }

  const todaysShifts = (shifts || []).filter(s => s.shift_date === today)
  const decision     = auditorAccessNow(todaysShifts)
  const nextShift    = findNextShift(shifts || [])

  return Response.json({
    role:    'audit',
    gated:   true,
    allowed: decision.allowed,
    reason:  decision.reason,
    auditor,
    activeShift:    decision.activeShift,
    nextShift,                          // null if nothing assigned ahead
    windowStartIst: decision.windowStartIst,
    windowEndIst:   decision.windowEndIst,
    expiresAtMs:    decision.expiresAtMs,
  })
}
