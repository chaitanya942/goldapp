// GET /api/live-rate — latest 24K sell rate for the dashboard's live gold-rate
// strip. gold_rates isn't readable from the browser for regular roles (RLS),
// so the strip reads it here with the service key, gated by canSeeLiveRates.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { canSeeLiveRates } from '../../../lib/liveRateAccess'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response
  if (!canSeeLiveRates(auth.role, auth.profile?.email || auth.user?.email)) {
    return Response.json({ error: 'Not authorized for live rates.' }, { status: 403 })
  }
  const { data, error } = await supabase
    .from('gold_rates').select('ambica_sell_rate, fetched_at')
    .order('fetched_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ rate24: data?.ambica_sell_rate ?? null, fetchedAt: data?.fetched_at ?? null })
}
