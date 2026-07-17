// app/api/bus-audit/submit/route.js
// Commits a batch of confirmed photos for ONE bus:
//   • uploads each image to the private 'bus-audit-photos' bucket (service role)
//   • records a bus_audit_photos row per image
//   • enforces the 5-photo ceiling ("audit already done for this bus")
//   • flips the bus to 'audited' once it has ≥3 photos AND ≥1 confirmed plate shot
//
// Multipart form fields:
//   reg_norm : confirmed bus match key (from /read-plate, user-confirmed)
//   meta     : JSON array aligned to the images, each { is_plate_shot, blur_score,
//              detected_number, confidence }
//   images   : one or more image files (getAll)

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { normalizePlate } from '@/lib/busPlate'

export const runtime = 'nodejs'
export const maxDuration = 30

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const MAX_PHOTOS = 5
const MIN_PHOTOS = 3

const extFor = (t) => (t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg')

export async function POST(req) {
  const auth = await requireAuth(req, {})
  if (!auth.ok) return auth.response
  const uploader = auth.profile?.full_name || auth.profile?.email || 'unknown'

  let form
  try { form = await req.formData() } catch { return Response.json({ error: 'Expected multipart form-data.' }, { status: 400 }) }

  const regNorm = normalizePlate(form.get('reg_norm') || '')
  if (!regNorm) return Response.json({ error: 'Missing reg_norm.' }, { status: 400 })

  let meta = []
  try { meta = JSON.parse(form.get('meta') || '[]') } catch { meta = [] }
  const images = form.getAll('images').filter(f => f && typeof f.arrayBuffer === 'function')
  if (!images.length) return Response.json({ error: 'No images provided.' }, { status: 400 })

  // ── Resolve the bus ─────────────────────────────────────────────────────
  const { data: bus, error: busErr } = await admin
    .from('bus_audit_buses')
    .select('id, reg_number, reg_norm, status, photo_count, region')
    .eq('reg_norm', regNorm)
    .maybeSingle()
  if (busErr) return Response.json({ error: 'Lookup failed', detail: busErr.message }, { status: 500 })
  if (!bus) return Response.json({ error: `No bus in the master list matches ${regNorm}.` }, { status: 404 })

  const already = bus.photo_count || 0
  if (already >= MAX_PHOTOS) {
    return Response.json({ error: 'AUDIT_ALREADY_DONE', message: `Audit already done for ${bus.reg_number} — ${MAX_PHOTOS} photos already on file.`, bus }, { status: 409 })
  }

  const slots = MAX_PHOTOS - already
  const accept = images.slice(0, slots)
  const rejectedOverflow = images.length - accept.length

  // ── Upload + record each accepted photo ─────────────────────────────────
  const inserted = []
  for (let i = 0; i < accept.length; i++) {
    const file = accept[i]
    const m = meta[i] || {}
    const type = /^image\/(jpeg|png|webp|jpg)$/.test(file.type) ? file.type : 'image/jpeg'
    const buf = Buffer.from(await file.arrayBuffer())
    const path = `${regNorm}/${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}.${extFor(type)}`

    const { error: upErr } = await admin.storage.from('bus-audit-photos').upload(path, buf, { contentType: type, upsert: false })
    if (upErr) return Response.json({ error: 'Upload failed', detail: upErr.message }, { status: 500 })

    const detectedNorm = normalizePlate(m.detected_number || '')
    const { data: row, error: insErr } = await admin.from('bus_audit_photos').insert({
      bus_id: bus.id,
      reg_norm: regNorm,
      storage_path: path,
      detected_number: m.detected_number || null,
      detected_norm: detectedNorm || null,
      matched: detectedNorm ? detectedNorm === regNorm : false,
      is_plate_shot: !!m.is_plate_shot,
      confidence: typeof m.confidence === 'number' ? m.confidence : null,
      blur_score: typeof m.blur_score === 'number' ? m.blur_score : null,
      uploaded_by: auth.user?.id || null,
      uploaded_by_name: uploader,
    }).select('id, is_plate_shot').single()
    if (insErr) return Response.json({ error: 'Record failed', detail: insErr.message }, { status: 500 })
    inserted.push(row)
  }

  // ── Recompute bus state from ALL its photos ─────────────────────────────
  const { data: allPhotos } = await admin
    .from('bus_audit_photos')
    .select('is_plate_shot')
    .eq('bus_id', bus.id)
  const total = (allPhotos || []).length
  const hasPlateShot = (allPhotos || []).some(p => p.is_plate_shot)
  const nowAudited = total >= MIN_PHOTOS && hasPlateShot

  const patch = { photo_count: total, status: nowAudited ? 'audited' : 'pending' }
  if (nowAudited && bus.status !== 'audited') {
    patch.first_audited_at = new Date().toISOString()
    patch.audited_by = auth.user?.id || null
    patch.audited_by_name = uploader
  }
  const { data: updated } = await admin
    .from('bus_audit_buses')
    .update(patch)
    .eq('id', bus.id)
    .select('id, reg_number, reg_norm, region, status, photo_count, first_audited_at, audited_by_name')
    .single()

  return Response.json({
    ok: true,
    bus: updated,
    added: inserted.length,
    rejected_overflow: rejectedOverflow,
    audited: nowAudited,
    needs_more: nowAudited ? 0 : Math.max(0, MIN_PHOTOS - total),
    needs_plate_shot: !hasPlateShot,
  })
}
