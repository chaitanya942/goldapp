// app/api/branches/save-resolved-addresses/route.js
// Bulk-save Google-resolved addresses to branches.
// Body: { accepted: [{ branch_name, address, pin_code, city, state, lat, lng, place_id, source }] }
// Returns: { saved: number, skipped: [{ branch_name, reason }] }
//
// IMPORTANT: never overwrites a row where address_verified = true. Manual edit always wins.
// Creates the branches row if it doesn't exist (e.g. branches discovered via purchases sync).

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  try {
    const { accepted } = await req.json()
    if (!Array.isArray(accepted) || accepted.length === 0) {
      return Response.json({ error: 'accepted array required' }, { status: 400 })
    }
    if (accepted.length > 100) {
      return Response.json({ error: 'Save at most 100 branches per call.' }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    let saved = 0
    const skipped = []

    for (const a of accepted) {
      if (!a.branch_name) {
        skipped.push({ branch_name: '(missing)', reason: 'branch_name missing' })
        continue
      }

      // Check if row exists and whether it's verified.
      const { data: existing } = await supabase
        .from('branches')
        .select('id, name, address_verified')
        .eq('name', a.branch_name)
        .maybeSingle()

      if (existing && existing.address_verified === true) {
        skipped.push({ branch_name: a.branch_name, reason: 'address is manually verified — auto-fill skipped' })
        continue
      }

      const payload = {
        name:                 a.branch_name,
        address:              a.address || null,
        pin_code:             a.pin_code || null,
        city:                 a.city || null,
        state:                a.state || null,
        lat:                  a.lat ?? null,
        lng:                  a.lng ?? null,
        google_place_id:      a.place_id || null,
        address_source:       a.source || 'google_geocoding',
        address_verified:     false,
        address_resolved_at:  nowIso,
      }

      let err
      if (existing) {
        const { error } = await supabase.from('branches').update(payload).eq('id', existing.id)
        err = error
      } else {
        const { error } = await supabase.from('branches').insert(payload)
        err = error
      }

      if (err) {
        skipped.push({ branch_name: a.branch_name, reason: err.message })
      } else {
        saved++
      }
    }

    return Response.json({ saved, skipped })
  } catch (err) {
    console.error('[branches/save-resolved-addresses] error:', err)
    return Response.json({ error: err.message || 'Save failed' }, { status: 500 })
  }
}
