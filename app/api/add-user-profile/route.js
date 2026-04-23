// app/api/add-user-profile/route.js
// Uses service role to upsert a user_profiles row, bypassing RLS.
// Only callable by admins/super_admins (enforced by checking the caller's own profile).

import { createClient } from '@supabase/supabase-js'

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  try {
    // Verify caller is an admin-level user
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return new Response('Unauthorized', { status: 401 })

    const { data: { user }, error: authErr } = await serviceSupabase.auth.getUser(token)
    if (authErr || !user) return new Response('Unauthorized', { status: 401 })

    const { data: callerProfile } = await serviceSupabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const allowedRoles = ['super_admin', 'founders_office', 'admin']
    if (!callerProfile || !allowedRoles.includes(callerProfile.role)) {
      return new Response('Forbidden', { status: 403 })
    }

    const { id, email, full_name, role } = await req.json()
    if (!id || !email || !role) return new Response('Missing fields', { status: 400 })

    const { error } = await serviceSupabase.from('user_profiles').upsert({
      id,
      email,
      full_name: full_name || email,
      role,
      is_active: true,
    }, { onConflict: 'id' })

    if (error) return new Response(error.message, { status: 500 })

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(err.message, { status: 500 })
  }
}
