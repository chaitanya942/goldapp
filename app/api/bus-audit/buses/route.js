// app/api/bus-audit/buses/route.js
// Field-facing bus list for the Progress tab: the actual bus numbers split by
// status (pending vs audited), searchable + paginated. Any authenticated user
// (the marketing team needs their work list). Minimal fields only.

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
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.BUS_AUDIT })
  if (!auth.ok) return auth.response

  const p = new URL(req.url).searchParams
  const q = normalizePlate(p.get('q') || '')
  const status = p.get('status') === 'audited' ? 'audited' : 'pending'
  const region = p.get('region') || ''
  const limit = Math.min(200, parseInt(p.get('limit') || '100', 10))
  const offset = Math.max(0, parseInt(p.get('offset') || '0', 10))

  let query = admin.from('bus_audit_buses')
    .select('reg_number, reg_norm, region, depot, photo_count', { count: 'exact' })
    .eq('status', status)
  if (q) query = query.ilike('reg_norm', `%${q}%`)
  if (region) query = query.eq('region', region)
  query = query.order('region', { nullsFirst: false }).order('reg_norm').range(offset, offset + limit - 1)

  const { data, count, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ rows: data || [], total: count || 0, offset, limit })
}
