// app/api/bus-audit/static-map/route.js
// Proxies an OpenStreetMap static map image for the geotag stamp. Served
// same-origin so the browser canvas can draw it into the photo without being
// tainted (which would block toBlob). No auth: it only relays a public map for
// numeric coordinates — no sensitive data passes through.

export const runtime = 'nodejs'
export const maxDuration = 15

export async function GET(req) {
  const u = new URL(req.url)
  const lat = parseFloat(u.searchParams.get('lat'))
  const lng = parseFloat(u.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return new Response('bad coords', { status: 400 })

  const src = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=220x220&markers=${lat},${lng},red-pushpin`
  try {
    const r = await fetch(src, { headers: { 'User-Agent': 'WhiteGold-BusAudit/1.0 (ops@whitegold.money)' } })
    if (!r.ok) return new Response('map unavailable', { status: 502 })
    const buf = Buffer.from(await r.arrayBuffer())
    return new Response(buf, { headers: { 'Content-Type': r.headers.get('content-type') || 'image/png', 'Cache-Control': 'public, max-age=86400' } })
  } catch {
    return new Response('map error', { status: 502 })
  }
}
