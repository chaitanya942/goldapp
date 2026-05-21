// app/api/heatmap/aggregate/route.js
//
// Returns aggregated click events for a project + page + filters,
// binned to a 100x100 grid for fast heatmap rendering.
//
// GET ?project=goldapp&page=/dashboard&from=2026-05-01&to=2026-05-06&device=desktop
//
// Returns: { bins: [{ x_bin, y_bin, count }], total, top_elements: [...] }
// Admin only.

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'heatmap-insights')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const project = searchParams.get('project') || 'goldapp'
  const page    = searchParams.get('page')    || '/dashboard'
  const from    = searchParams.get('from')    || null
  const to      = searchParams.get('to')      || null
  const device  = searchParams.get('device')  || null  // 'mobile' | 'desktop' | etc.
  const eventType = searchParams.get('event_type') || 'click'
  const userId  = searchParams.get('user_id') || null  // optional — single-user view

  let q = supabase
    .from('heatmap_events')
    .select('x_pct, y_pct, el_tag, el_text, el_id, el_class, scroll_y_pct, session_id, ts, device_class, user_id')
    .eq('project', project)
    .eq('page_path', page)
    .eq('event_type', eventType)
    .not('x_pct', 'is', null)
    .not('y_pct', 'is', null)
  if (from)   q = q.gte('ts', from)
  if (to)     q = q.lte('ts', to)
  if (device) q = q.eq('device_class', device)
  if (userId) q = q.eq('user_id', userId)

  // Pull up to 50k events; clients with more should narrow the date range.
  q = q.limit(50000)

  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Bin to 100x100 grid for canvas rendering.
  const bins = new Map()  // 'x,y' → count
  const elementCounts = new Map()  // sig → count
  const elementCentroids = new Map()  // sig → { sumX, sumY, sumPx, sumPy, count, label }
  const sessions = new Set()
  const uniqueUsers = new Set()
  const deviceCounts = new Map()  // device_class → count
  // Hourly buckets across the queried window (for the time-of-day chart).
  const hourCounts = new Array(24).fill(0)
  for (const e of data || []) {
    const xPct = Number(e.x_pct) || 0
    const yPct = Number(e.y_pct) || 0
    const xb = Math.min(99, Math.floor(xPct))
    const yb = Math.min(99, Math.floor(yPct))
    const key = `${xb},${yb}`
    bins.set(key, (bins.get(key) || 0) + 1)

    if (e.el_tag) {
      const sig = `${e.el_tag}${e.el_id ? '#' + e.el_id : ''}${e.el_class ? '.' + String(e.el_class).split(' ')[0] : ''}${e.el_text ? ` "${e.el_text}"` : ''}`
      elementCounts.set(sig, (elementCounts.get(sig) || 0) + 1)
      // Build a friendlier label: prefer text, then tag/id
      const label = e.el_text
        ? String(e.el_text).slice(0, 28)
        : `<${e.el_tag}${e.el_id ? ' #' + e.el_id : ''}>`
      const cur = elementCentroids.get(sig) || { sumX: 0, sumY: 0, count: 0, label }
      cur.sumX += xPct
      cur.sumY += yPct
      cur.count++
      elementCentroids.set(sig, cur)
    }
    if (e.session_id) sessions.add(e.session_id)
    if (e.user_id)    uniqueUsers.add(e.user_id)
    if (e.device_class) deviceCounts.set(e.device_class, (deviceCounts.get(e.device_class) || 0) + 1)
    if (e.ts) {
      const h = new Date(e.ts).getHours()
      if (h >= 0 && h < 24) hourCounts[h]++
    }
  }

  const binsArr = []
  for (const [key, count] of bins) {
    const [x_bin, y_bin] = key.split(',').map(Number)
    binsArr.push({ x_bin, y_bin, count })
  }

  const topElements = [...elementCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([sig, count]) => ({ element: sig, count }))

  // Top zones: spatial centroids of the most-clicked labelled elements.
  // The viewer renders these as labelled callouts on top of the heatmap so
  // people can see *what* is being clicked, not just *where*.
  const topZones = [...elementCentroids.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([sig, p]) => ({
      label: p.label,
      sig,
      x_pct: p.sumX / p.count,
      y_pct: p.sumY / p.count,
      count: p.count,
    }))

  const deviceBreakdown = [...deviceCounts.entries()]
    .map(([device, count]) => ({ device, count }))
    .sort((a, b) => b.count - a.count)

  return Response.json({
    project, page, event_type: eventType, user_id: userId,
    total: data?.length || 0,
    sessions: sessions.size,
    unique_users: uniqueUsers.size,
    bins: binsArr,
    top_elements: topElements,
    top_zones: topZones,
    device_breakdown: deviceBreakdown,
    hourly: hourCounts,
  })
}
