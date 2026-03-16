import { createClient } from '@supabase/supabase-js'

// Server-side only — uses service role key (never exposed to browser)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const { email, full_name, role } = await request.json()

    if (!email) {
      return Response.json({ error: 'Email is required.' }, { status: 400 })
    }

    // 1. Send invite email via Supabase Admin API
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.trim(),
      {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
        data: { full_name: full_name?.trim() || '', role }
      }
    )

    if (authErr) {
      return Response.json({ error: authErr.message }, { status: 400 })
    }

    // 2. Insert profile row immediately so role is ready on first login
    const userId = authData?.user?.id
    if (userId) {
      await supabaseAdmin.from('user_profiles').upsert({
        id:        userId,
        email:     email.trim(),
        full_name: full_name?.trim() || email.trim(),
        role:      role || 'viewer',
        is_active: true,
      }, { onConflict: 'id' })
    }

    return Response.json({ success: true, userId })

  } catch (err) {
    return Response.json({ error: err.message || 'Server error.' }, { status: 500 })
  }
}