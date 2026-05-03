// app/api/invite-user/route.js
// Sends a Supabase invite email and pre-creates the profile row so the
// role is ready on first login. Admin-only.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request) {
  const auth = await requireAuth(request, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  try {
    const { email, full_name, role } = await request.json()

    const cleanEmail = String(email || '').trim()
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      return Response.json({ error: 'Valid email is required.' }, { status: 400 })
    }
    const cleanRole = String(role || 'viewer').trim()

    // Validate role exists in the roles table — otherwise the user gets an
    // invite for a role that grants nothing, and silently lands in a broken
    // state on first login.
    const { data: roleRow } = await supabaseAdmin
      .from('roles').select('name').eq('name', cleanRole).maybeSingle()
    if (!roleRow && cleanRole !== 'viewer') {
      // Allow 'viewer' even if the row is missing, since it's the safe default.
      return Response.json({ error: `Role '${cleanRole}' does not exist.` }, { status: 400 })
    }

    // 1. Send invite email via Supabase Admin API.
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      cleanEmail,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
        data: { full_name: full_name?.trim() || '', role: cleanRole }
      }
    )

    if (authErr) {
      return Response.json({ error: authErr.message }, { status: 400 })
    }

    // 2. Insert profile row immediately so role is ready on first login.
    const userId = authData?.user?.id
    if (userId) {
      const { error: profileErr } = await supabaseAdmin.from('user_profiles').upsert({
        id:        userId,
        email:     cleanEmail,
        full_name: full_name?.trim() || cleanEmail,
        role:      cleanRole,
        is_active: true,
      }, { onConflict: 'id' })

      // If the profile upsert fails after the invite was sent, surface the
      // problem so the inviting admin can clean up — otherwise the user gets
      // an email and a confused first-login experience.
      if (profileErr) {
        return Response.json({
          error: `Invite was sent to ${cleanEmail} but profile creation failed: ${profileErr.message}. Add the profile manually via Admin > Users.`,
        }, { status: 500 })
      }
    }

    return Response.json({ success: true, userId })

  } catch (err) {
    return Response.json({ error: err.message || 'Server error.' }, { status: 500 })
  }
}