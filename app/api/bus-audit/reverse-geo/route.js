// app/api/bus-audit/reverse-geo/route.js
// Turn a GPS fix into a human-readable place ("MG Road, Mangalore") so audits
// show WHERE, not just coordinates. Server-side (avoids browser CORS and lets
// us send a compliant User-Agent to OpenStreetMap Nominatim). Best-effort —
// returns { address: null } on any failure so the client falls back to coords.

import { requireAuth, ROLE_GROUPS } from '@/lib/apiAuth'

export const runtime = 'nodejs'
export const maxDuration = 15

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.BUS_AUDIT })
  if (!auth.ok) return auth.response

  const u = new URL(req.url)
  const lat = parseFloat(u.searchParams.get('lat'))
  const lng = parseFloat(u.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ address: null })

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`
    const r = await fetch(url, { headers: { 'User-Agent': 'WhiteGold-BusAudit/1.0 (ops@whitegold.money)', 'Accept': 'application/json' } })
    if (!r.ok) return Response.json({ address: null })
    const j = await r.json()
    const a = j.address || {}
    // Headline like "Mangalore, Karnataka, India"; full = the detailed line.
    const city = a.city || a.town || a.village || a.municipality || a.county
    const place = [city, a.state, a.country].filter(Boolean).join(', ') || null
    const address = j.display_name || [a.road || a.suburb || a.neighbourhood, city].filter(Boolean).join(', ') || null
    return Response.json({ place, address })
  } catch {
    return Response.json({ address: null })
  }
}
