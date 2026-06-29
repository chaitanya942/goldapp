// app/api/branch-stock-png/route.js
//
// POST { rows: [...], meta?: {...} } → PNG image of the Branch Stock Overview.
// Rows are passed verbatim from the client (already filtered by region + date),
// so the image matches exactly what ops sees on screen.

import { requireAuth } from '../../../lib/apiAuth'
import { generateBranchStockPng } from '../../../lib/generateBranchStockPng'

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  let body
  try { body = await req.json() }
  catch { return Response.json({ error: 'Bad JSON body' }, { status: 400 }) }

  const { rows, meta } = body || {}
  if (!Array.isArray(rows)) return Response.json({ error: 'rows array required' }, { status: 400 })
  if (rows.length > 2000) return Response.json({ error: 'Too many rows — narrow the filter first (max 2000).' }, { status: 400 })

  try {
    const pngBuffer = await generateBranchStockPng({
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
        'Content-Disposition': `attachment; filename="BranchStockOverview_${new Date().toISOString().slice(0, 10)}.png"`,
      },
    })
  } catch (err) {
    console.error('Branch Stock Overview image generation error:', err)
    return Response.json({ error: err.message || 'Failed to generate image' }, { status: 500 })
  }
}
