// app/api/consignment-in-transit-jpg/route.js
//
// POST { viewMode: 'branch'|'case', rows: [...], meta?: {...} }
//   → PNG image of the Consignment Report.
//
// Returns PNG (lossless) rather than JPEG — text-heavy reports get visible
// chroma-subsampling ghosting on JPEG bodies, no matter the quality setting.
// The endpoint URL keeps the `-jpg` slug for backward compatibility with the
// client button; the downloaded file is .png and the Content-Type matches.
//
// Rows are passed verbatim from the client (already filtered + sorted) so the
// image matches what ops sees on screen. No DB roundtrip on the server side
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
    const pngBuffer = await generateInTransitJpg({
      viewMode,
      rows,
      meta: {
        ...(meta || {}),
        generated_at: new Date().toISOString(),
        generated_by: auth.profile?.email || auth.user?.email || null,
      },
    })
    return new Response(pngBuffer, {
      headers: {
        'Content-Type':        'image/png',
        'Content-Disposition': `attachment; filename="ConsignmentReport_${viewMode}_${new Date().toISOString().slice(0, 10)}.png"`,
      },
    })
  } catch (err) {
    console.error('Consignment Report image generation error:', err)
    return Response.json({ error: err.message || 'Failed to generate report image' }, { status: 500 })
  }
}
