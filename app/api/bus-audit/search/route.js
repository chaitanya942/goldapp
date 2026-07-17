// app/api/bus-audit/search/route.js
// Manual bus lookup — the fallback when Claude can't read a plate and the field
// user needs to pick the bus by hand. Matches on the normalized key so partial
// typing (with or without spaces/dashes) works.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { normalizePlate } from '@/lib/busPlate'

export const runtime = 'nodejs'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export async function GET(req) {
  const auth = await requireAuth(req, {})
  if (!auth.ok) return auth.response

  const q = normalizePlate(new URL(req.url).searchParams.get('q') || '')
  if (!q || q.length < 3) return Response.json({ results: [] })

  const { data, error } = await admin
    .from('bus_audit_buses')
    .select('id, reg_number, reg_norm, region, status, photo_count')
    .like('reg_norm', `%${q}%`)
    .order('reg_norm')
    .limit(20)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ results: data || [] })
}
