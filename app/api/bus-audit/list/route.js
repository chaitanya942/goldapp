// app/api/bus-audit/list/route.js
// Admin/founder review: filterable, searchable list of buses with their audit
// status + location. Admin-only.

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

  const p = new URL(req.url).searchParams
  const q = normalizePlate(p.get('q') || '')
  const status = p.get('status') || ''
  const region = p.get('region') || ''
  const limit = Math.min(100, parseInt(p.get('limit') || '50', 10))
  const offset = Math.max(0, parseInt(p.get('offset') || '0', 10))

  let query = admin.from('bus_audit_buses')
    .select('reg_number, reg_norm, region, depot, status, photo_count, first_audited_at, audited_by_name, audit_lat, audit_lng, audit_address', { count: 'exact' })
  if (q) query = query.ilike('reg_norm', `%${q}%`)
  if (status === 'audited' || status === 'pending') query = query.eq('status', status)
  if (region) query = query.eq('region', region)
  query = query.order('first_audited_at', { ascending: false, nullsFirst: false }).order('reg_norm').range(offset, offset + limit - 1)

  const { data, count, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ rows: data || [], total: count || 0, limit, offset })
}
