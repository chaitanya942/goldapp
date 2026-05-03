// app/api/add-user-profile/route.js
// Upserts a user_profiles row, bypassing RLS via the service role key. Used
// when an admin manually adds a profile for a user that already exists in
// Supabase Auth (typically created out-of-band via the Supabase dashboard).
// Admin-only.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  try {
    const { id, email, full_name, role } = await req.json()
    if (!id || !email || !role) return Response.json({ error: 'id, email, and role are required.' }, { status: 400 })

    const { error } = await serviceSupabase.from('user_profiles').upsert({
      id,
      email,
      full_name: full_name || email,
      role,
      is_active: true,
    }, { onConflict: 'id' })

    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
