// app/api/consignment-in-transit-jpg/route.js
//
// POST { viewMode: 'branch'|'case', rows: [...], meta?: {...} }
//   → JPEG image of the in-transit Consignment Report.
//
// Rows are passed verbatim from the client (already filtered + sorted) so the
// JPG matches what ops sees on screen. No DB roundtrip on the server side
// beyond auth — the same in_transit_stock pull that drives the UI is reused.

import { requireAuth } from '../../../lib/apiAuth'
import { generateInTransitJpg } from '../../../lib/generateInTransitJpg'

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  let body
  try { body = await req.json() }
  catch { return Response.json({ error: 'Bad JSON body' }, { status: 400 }) }

  const { viewMode, rows, meta } = body || {}
  if (viewMode !== 'branch' && viewMode !== 'case') {
    return Response.json({ error: "viewMode must be 'branch' or 'case'" }, { status: 400 })
  }
  if (!Array.isArray(rows)) {
    return Response.json({ error: 'rows array required' }, { status: 400 })
  }
  if (rows.length > 5000) {
    return Response.json({ error: 'Too many rows — narrow the filter first (max 5000 per export).' }, { status: 400 })
  }

  try {
    const jpegBuffer = await generateInTransitJpg({
      viewMode,
      rows,
      meta: {
        ...(meta || {}),
        generated_at: new Date().toISOString(),
        generated_by: auth.profile?.email || auth.user?.email || null,
      },
    })
    return new Response(jpegBuffer, {
      headers: {
        'Content-Type':        'image/jpeg',
        'Content-Disposition': `attachment; filename="ConsignmentReport_${viewMode}_${new Date().toISOString().slice(0, 10)}.jpg"`,
      },
    })
  } catch (err) {
    console.error('in-transit JPG generation error:', err)
    return Response.json({ error: err.message || 'Failed to generate JPG' }, { status: 500 })
  }
}
