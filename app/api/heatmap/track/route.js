// app/api/heatmap/track/route.js
//
// PUBLIC ingest endpoint for heatmap events. Pasted-in trackers from any tool
// (goldapp, treasury, future apps) call this with a batch of click/scroll/
// pageview events. CORS-enabled so cross-origin trackers work.
//
// No auth required — events are published openly. We rely on:
//   - project_id validation (must exist in heatmap_projects)
//   - rate limiting via batching (clients send max once per 5s)
//   - small payload caps (max 100 events per request)
// to keep abuse manageable.
//
// Body shape:
//   { project: 'goldapp', events: [
//       { session_id, user_id?, page_path, page_title?, event_type, x_pct, y_pct, ... },
//       ...
//   ]}

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// CORS headers — allow any origin to POST since tracker scripts run on third-party tools.
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  }
}

export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req) {
  const origin = req.headers.get('origin') || ''
  const headers = corsHeaders(origin)

  let body
  try { body = await req.json() }
  catch { return Response.json({ error: 'invalid JSON' }, { status: 400, headers }) }

  const { project, events } = body || {}
  if (!project || typeof project !== 'string') return Response.json({ error: 'project required' }, { status: 400, headers })
  if (!Array.isArray(events) || events.length === 0) return Response.json({ error: 'events array required' }, { status: 400, headers })
  if (events.length > 100) return Response.json({ error: 'max 100 events per batch' }, { status: 400, headers })

  // Validate project exists. 'goldapp' is the host app — always allow it
  // implicitly so events flow before the projects table is even seeded.
  // Other projects (cross-tool trackers) must be registered.
  if (project !== 'goldapp') {
    const { data: proj } = await supabase
      .from('heatmap_projects')
      .select('id')
      .eq('id', project)
      .maybeSingle()
    if (!proj) return Response.json({ error: 'unknown project' }, { status: 400, headers })
  }

  // Sanitize + map to columns. Drop anything malformed silently rather than failing the whole batch.
  const rows = []
  for (const e of events) {
    if (!e || typeof e !== 'object') continue
    if (!e.session_id || !e.page_path || !e.event_type) continue
    if (!['click', 'scroll', 'pageview'].includes(e.event_type)) continue

    rows.push({
      project,
      session_id:    String(e.session_id).slice(0, 80),
      user_id:       e.user_id && /^[0-9a-f-]{36}$/i.test(String(e.user_id)) ? e.user_id : null,
      page_path:     String(e.page_path).slice(0, 500),
      page_title:    e.page_title ? String(e.page_title).slice(0, 200) : null,
      event_type:    e.event_type,
      x_pct:         e.x_pct != null ? clamp(Number(e.x_pct), 0, 100) : null,
      y_pct:         e.y_pct != null ? clamp(Number(e.y_pct), 0, 100) : null,
      x_px:          e.x_px != null ? Math.round(Number(e.x_px)) : null,
      y_px:          e.y_px != null ? Math.round(Number(e.y_px)) : null,
      scroll_y_pct:  e.scroll_y_pct != null ? clamp(Number(e.scroll_y_pct), 0, 100) : null,
      viewport_w:    e.viewport_w != null ? Math.round(Number(e.viewport_w)) : null,
      viewport_h:    e.viewport_h != null ? Math.round(Number(e.viewport_h)) : null,
      device_class:  e.device_class ? String(e.device_class).slice(0, 30) : null,
      user_agent:    (req.headers.get('user-agent') || '').slice(0, 300),
      el_tag:        e.el_tag ? String(e.el_tag).slice(0, 20) : null,
      el_text:       e.el_text ? String(e.el_text).slice(0, 50) : null,
      el_id:         e.el_id ? String(e.el_id).slice(0, 80) : null,
      el_class:      e.el_class ? String(e.el_class).slice(0, 200) : null,
    })
  }
  if (rows.length === 0) return Response.json({ inserted: 0 }, { status: 200, headers })

  const { error } = await supabase.from('heatmap_events').insert(rows)
  if (error) {
    console.error('[heatmap/track] insert failed:', error.message)
    return Response.json({ error: 'insert failed' }, { status: 500, headers })
  }
  return Response.json({ inserted: rows.length }, { status: 200, headers })
}

// GET — quick diagnostic so admins can check whether events are landing
// without opening Supabase. No auth required (returns counts only, no payload).
export async function GET(req) {
  const origin = req.headers.get('origin') || ''
  const headers = corsHeaders(origin)
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count: total }    = await supabase.from('heatmap_events').select('*', { count: 'exact', head: true })
    const { count: last24h }  = await supabase.from('heatmap_events').select('*', { count: 'exact', head: true }).gte('ts', since)
    return Response.json({ ok: true, total: total ?? 0, last_24h: last24h ?? 0 }, { headers })
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500, headers })
  }
}

function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return null
  return Math.max(lo, Math.min(hi, n))
}
