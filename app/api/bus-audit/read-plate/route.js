// app/api/bus-audit/read-plate/route.js
// Reads the vehicle registration plate off a single field photo using Claude
// vision, normalizes it, and matches it against the master bus list. The client
// calls this per photo to show the detected number for a 1-tap confirm before
// committing via /api/bus-audit/submit.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { normalizePlate, looksLikePlate, matchPlate } from '@/lib/busPlate'

export const runtime = 'nodejs'
export const maxDuration = 30

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const VISION_MODEL = process.env.BUS_AUDIT_VISION_MODEL || 'claude-sonnet-5'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const PROMPT = `You are auditing bus advertising. This photo shows a public transport bus (often ad-wrapped). Find the vehicle's official REGISTRATION NUMBER PLATE — the government number plate (usually a yellow or white plate with black text near the bumper), e.g. "KA 09 F 5029".

Rules:
- Report the registration in standard Latin/English format with NO spaces or dashes, e.g. "KA09F5029". If the plate is written in Kannada script or Kannada digits, transliterate it to the standard Latin registration format.
- Do NOT report a route number, fleet code, phone number, advertisement text, or the code painted on the bus body — ONLY the official registration plate.
- If no registration plate is visible in the image, set plate_visible=false.
- If a plate is visible but you cannot read it confidently (blurry, too far, glare, cut off, obscured), set readable=false and still give your best guess in registration if you have one.
- confidence is your certainty in the exact characters (0.0–1.0).`

const TOOL = {
  name: 'report_plate',
  description: 'Report the bus registration plate read from the image.',
  input_schema: {
    type: 'object',
    properties: {
      plate_visible: { type: 'boolean', description: 'Is an official registration number plate visible at all?' },
      readable:      { type: 'boolean', description: 'Can the plate characters be read confidently (not blurry/cut off/obscured)?' },
      registration:  { type: ['string', 'null'], description: 'The registration in Latin, no separators, e.g. KA09F5029. null if none.' },
      confidence:    { type: 'number', description: 'Certainty in the exact characters, 0.0 to 1.0.' },
      reason:        { type: 'string', description: 'Short reason when not readable (e.g. "blurry", "plate cut off", "no plate in frame").' },
    },
    required: ['plate_visible', 'readable', 'registration', 'confidence'],
  },
}

export async function POST(req) {
  const auth = await requireAuth(req, {})
  if (!auth.ok) return auth.response

  let form
  try { form = await req.formData() } catch { return Response.json({ error: 'Expected multipart form-data with an image.' }, { status: 400 }) }
  const file = form.get('image')
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'No image provided.' }, { status: 400 })
  }
  const mediaType = file.type || 'image/jpeg'
  if (!/^image\/(jpeg|png|webp|jpg)$/.test(mediaType)) {
    return Response.json({ error: `Unsupported image type: ${mediaType}` }, { status: 400 })
  }
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length > 8 * 1024 * 1024) {
    return Response.json({ error: 'Image too large (max 8MB). Compress before sending.' }, { status: 400 })
  }
  const base64 = buf.toString('base64')

  // ── Ask Claude to read the plate ──────────────────────────────────────────
  let out
  try {
    const msg = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 400,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report_plate' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType === 'image/jpg' ? 'image/jpeg' : mediaType, data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    out = tool?.input
  } catch (e) {
    return Response.json({ error: 'Plate reading failed', detail: e?.message || String(e) }, { status: 502 })
  }
  if (!out) return Response.json({ error: 'Vision model returned no result.' }, { status: 502 })

  const detectedNorm = normalizePlate(out.registration || '')

  // ── Match against the master list ─────────────────────────────────────────
  let match = null
  if (detectedNorm) {
    // Exact first (indexed lookup), then fall back to a fuzzy pass over a small
    // candidate window (same length) for common OCR char confusions.
    const { data: exact } = await admin
      .from('bus_audit_buses')
      .select('id, reg_number, reg_norm, region, status, photo_count')
      .eq('reg_norm', detectedNorm)
      .maybeSingle()
    if (exact) {
      match = { ...exact, exact: true }
    } else if (looksLikePlate(detectedNorm)) {
      const { data: sameLen } = await admin
        .from('bus_audit_buses')
        .select('id, reg_number, reg_norm, region, status, photo_count')
        .filter('reg_norm', 'like', `${detectedNorm[0]}%`)   // cheap prefix narrow
      const m = matchPlate(detectedNorm, (sameLen || []).map(b => b.reg_norm))
      if (m) {
        const b = (sameLen || []).find(x => x.reg_norm === m.key)
        if (b) match = { ...b, exact: false }
      }
    }
  }

  return Response.json({
    plate_visible: !!out.plate_visible,
    readable:      !!out.readable,
    registration:  out.registration || null,
    registration_norm: detectedNorm || null,
    confidence:    typeof out.confidence === 'number' ? out.confidence : null,
    reason:        out.reason || null,
    match,   // null = no bus in master list matched; UI lets user confirm/correct
  })
}
