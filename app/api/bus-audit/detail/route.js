// app/api/bus-audit/detail/route.js
// Admin/founder review: one bus with its captured photos (signed URLs from the
// private bucket) + all the verification metadata. Admin-only.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '@/lib/apiAuth'
import { normalizePlate } from '@/lib/busPlate'

export const runtime = 'nodejs'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const regNorm = normalizePlate(new URL(req.url).searchParams.get('reg_norm') || '')
  if (!regNorm) return Response.json({ error: 'Missing reg_norm.' }, { status: 400 })

  const { data: bus, error: busErr } = await admin
    .from('bus_audit_buses')
    .select('reg_number, reg_norm, region, depot, route, status, photo_count, first_audited_at, audited_by_name, audit_lat, audit_lng, audit_address')
    .eq('reg_norm', regNorm)
    .maybeSingle()
  if (busErr) return Response.json({ error: busErr.message }, { status: 500 })
  if (!bus) return Response.json({ error: 'Not found' }, { status: 404 })

  const { data: photos } = await admin
    .from('bus_audit_photos')
    .select('id, storage_path, detected_number, is_plate_shot, matched, confidence, blur_score, lat, lng, gps_accuracy, address, source, uploaded_by_name, created_at')
    .eq('reg_norm', regNorm)
    .order('is_plate_shot', { ascending: false })
    .order('created_at')

  // Sign each photo for temporary viewing.
  const withUrls = []
  for (const ph of photos || []) {
    const { data: signed } = await admin.storage.from('bus-audit-photos').createSignedUrl(ph.storage_path, 3600)
    withUrls.push({ ...ph, url: signed?.signedUrl || null })
  }

  return Response.json({ bus, photos: withUrls })
}
