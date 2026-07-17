// app/api/bus-audit/stats/route.js
// Progress summary for the dashboard + the field header: totals, audited vs
// pending, per-region breakdown, and the most recent audits.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '@/lib/apiAuth'

export const runtime = 'nodejs'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.BUS_AUDIT })
  if (!auth.ok) return auth.response

  const { count: total } = await admin.from('bus_audit_buses').select('id', { count: 'exact', head: true })
  const { count: audited } = await admin.from('bus_audit_buses').select('id', { count: 'exact', head: true }).eq('status', 'audited')

  // Per-region breakdown (audited vs total). Pull minimal columns; aggregate here.
  const byRegion = {}
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('bus_audit_buses')
      .select('region, status')
      .range(from, from + PAGE - 1)
    if (error) break
    for (const r of data) {
      const k = r.region || 'Unassigned'
      byRegion[k] = byRegion[k] || { region: k, total: 0, audited: 0 }
      byRegion[k].total++
      if (r.status === 'audited') byRegion[k].audited++
    }
    if (data.length < PAGE) break
  }

  const { data: recent } = await admin
    .from('bus_audit_buses')
    .select('reg_number, region, photo_count, first_audited_at, audited_by_name, audit_lat, audit_lng, audit_address')
    .eq('status', 'audited')
    .order('first_audited_at', { ascending: false })
    .limit(10)

  return Response.json({
    total: total || 0,
    audited: audited || 0,
    pending: (total || 0) - (audited || 0),
    by_region: Object.values(byRegion).sort((a, b) => b.total - a.total),
    recent: recent || [],
  })
}
