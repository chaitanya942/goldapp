// app/api/heatmap/users/route.js
//
// Lists users who have generated heatmap events for a project, joined with
// user_profiles to surface email + role for the picker. Sorted by event count.
//
// GET ?project=goldapp&from=ISO&to=ISO
// Returns: { users: [{ user_id, email, role, event_count, last_seen, sessions }] }
// Admin only.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const project = searchParams.get('project') || 'goldapp'
  const from    = searchParams.get('from') || new Date(Date.now() - 90 * 86400000).toISOString()
  const to      = searchParams.get('to')   || null

  let q = supabase
    .from('heatmap_events')
    .select('user_id, session_id, ts')
    .eq('project', project)
    .gte('ts', from)
  if (to) q = q.lte('ts', to)
  q = q.order('ts', { ascending: false }).limit(50000)

  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Aggregate per user_id (null grouped as 'anonymous').
  const map = new Map()
  for (const r of data || []) {
    const key = r.user_id || '__anon__'
    const cur = map.get(key) || { user_id: r.user_id, count: 0, sessions: new Set(), last_seen: r.ts }
    cur.count++
    cur.sessions.add(r.session_id)
    if (r.ts > cur.last_seen) cur.last_seen = r.ts
    map.set(key, cur)
  }

  // Look up emails for the user_ids we have.
  const ids = [...map.values()].map(v => v.user_id).filter(Boolean)
  let profiles = []
  if (ids.length > 0) {
    const { data: pdata } = await supabase
      .from('user_profiles')
      .select('id, email, role')
      .in('id', ids)
    profiles = pdata || []
  }
  const profileMap = new Map(profiles.map(p => [p.id, p]))

  const users = [...map.values()]
    .map(v => {
      const prof = v.user_id ? profileMap.get(v.user_id) : null
      return {
        user_id:     v.user_id,
        email:       prof?.email || (v.user_id ? '(no profile)' : 'Anonymous'),
        role:        prof?.role || null,
        event_count: v.count,
        sessions:    v.sessions.size,
        last_seen:   v.last_seen,
      }
    })
    .sort((a, b) => b.event_count - a.event_count)

  return Response.json({ project, users })
}
