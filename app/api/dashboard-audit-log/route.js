// app/api/dashboard-audit-log/route.js
//
// Authoritative audit trail for Dashboard access/viewing activity.
//
// POST — any authenticated user logs their own "viewed the dashboard" event.
// Identity fields (user/email/name/role) are ALWAYS derived server-side from
// the validated bearer token via requireAuth() — never trusted from the
// client body — so a compromised client can't forge who did the viewing.
// Contextual fields (page/section/region/branch/period/filters) describe
// what was viewed, so they come from the client.
//
// GET — super_admin only. Lists entries for the audit-log viewer, newest first.
//
// Writes go through the service-role client, since dashboard_audit_log has
// no authenticated-write RLS policy at all (see sql/dashboard_audit_log.sql) —
// this is what makes the log genuinely non-editable by normal users.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  let body = {}
  try { body = await req.json() } catch {}

  const page = String(body.page || '').trim()
  if (!page) return Response.json({ error: 'page is required' }, { status: 400 })

  const row = {
    user_id:    auth.user.id,
    user_email: auth.profile.email,
    user_name:  auth.profile.full_name || null,
    user_role:  auth.profile.role,
    session_id: body.sessionId ? String(body.sessionId).slice(0, 100) : null,
    page,
    section:    body.section ? String(body.section).slice(0, 200) : null,
    region:     body.region  ? String(body.region).slice(0, 200)  : null,
    branch:     body.branch  ? String(body.branch).slice(0, 200)  : null,
    period:     body.period  ? String(body.period).slice(0, 200)  : null,
    filters:    body.filters && typeof body.filters === 'object' ? body.filters : null,
    access_result: body.accessResult === 'denied' ? 'denied' : 'granted',
    denied_reason: body.deniedReason ? String(body.deniedReason).slice(0, 500) : null,
  }

  const { error } = await supabase.from('dashboard_audit_log').insert(row)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ['super_admin'] })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('user_id') || null
  const page   = searchParams.get('page')    || null
  const from   = searchParams.get('from')    || null   // ISO instant
  const to     = searchParams.get('to')      || null   // ISO instant
  const limit  = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 100))
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

  let q = supabase
    .from('dashboard_audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (userId) q = q.eq('user_id', userId)
  if (page)   q = q.eq('page', page)
  if (from)   q = q.gte('created_at', from)
  if (to)     q = q.lte('created_at', to)

  const { data, error, count } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ rows: data || [], total: count || 0 })
}
