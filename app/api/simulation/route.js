// Live operations map for the Simulation tab (chaitanya-only).
// GET  → overview built in lib/simulationData.js.
// POST ?action=geocode_missing → fills lat/lng for up to 5 branches still
//        without coordinates (Nominatim, ~1 req/s).

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { canSeeSimulation } from '../../../lib/simulationAccess'
import { buildSimulationOverview, HO_BRANCH } from '../../../lib/simulationData'
import { geocodeBranch } from '../../../lib/branchGeocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

async function authorize(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth
  if (!canSeeSimulation(auth.profile?.email || auth.user?.email)) {
    return { ok: false, response: Response.json({ error: 'Not authorized for the simulation.' }, { status: 403 }) }
  }
  return auth
}

export async function GET(req) {
  const auth = await authorize(req)
  if (!auth.ok) return auth.response
  try {
    return Response.json(await buildSimulationOverview(supabase))
  } catch (err) {
    return Response.json({ error: err.message || String(err) }, { status: 500 })
  }
}

export async function POST(req) {
  const auth = await authorize(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  if (searchParams.get('action') !== 'geocode_missing') return Response.json({ error: 'Unknown action' }, { status: 400 })

  const { data: missing, error } = await supabase.from('branches')
    .select('id, name, city, state, pin_code')
    .is('lat', null).or(`is_active.eq.true,name.eq.${HO_BRANCH}`).limit(5)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const placed = [], failed = []
  for (const b of missing || []) {
    const g = await geocodeBranch(b)
    if (!g) { failed.push(b.name); continue }
    await supabase.from('branches').update({ lat: g.lat, lng: g.lng }).eq('id', b.id).is('lat', null)
    placed.push(b.name)
  }
  return Response.json({ placed, failed })
}
