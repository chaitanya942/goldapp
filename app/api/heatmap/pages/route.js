// app/api/heatmap/pages/route.js
//
// Returns the list of pages we have events for (per project), with event counts.
// Used by the admin viewer to populate the page picker dropdown.
//
// GET ?project=goldapp
// Returns: { pages: [{ page_path, page_title, event_count, last_seen }] }
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

  // Most recent 90 days of events. Group + count client-side (Supabase doesn't have a clean GROUP BY here).
  const since = new Date(Date.now() - 90 * 86400000).toISOString()
  const { data, error } = await supabase
    .from('heatmap_events')
    .select('page_path, page_title, ts')
    .eq('project', project)
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(20000)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const map = new Map()  // path → { count, title, last_seen }
  for (const r of data || []) {
    const cur = map.get(r.page_path) || { count: 0, title: r.page_title, last_seen: r.ts }
    cur.count++
    if (!cur.title && r.page_title) cur.title = r.page_title
    if (r.ts > cur.last_seen) cur.last_seen = r.ts
    map.set(r.page_path, cur)
  }

  const pages = [...map.entries()]
    .map(([page_path, x]) => ({ page_path, page_title: x.title, event_count: x.count, last_seen: x.last_seen }))
    .sort((a, b) => b.event_count - a.event_count)

  return Response.json({ project, pages })
}
