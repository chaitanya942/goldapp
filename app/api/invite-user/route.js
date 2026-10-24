// app/api/invite-user/route.js
// Adds a user to the gold app. SUPER ADMIN ONLY.
//
// No invite email is sent. The account is created directly with a one-time
// temporary password (lib/tempPassword), returned once in the response for
// the super admin to hand over. The account carries
// app_metadata.must_reset_password, so on first sign-in the person is sent to
// /auth/reset and must choose their own password before using the app
// (cleared by /api/auth/password-set).
//
// Adding an address that already has an account which has NEVER signed in
// issues a fresh temporary password (e.g. the first one was lost).

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { genTempPassword } from '../../../lib/tempPassword'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function findAuthUserByEmail(email) {
  const target = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find(u => (u.email || '').toLowerCase() === target)
    if (hit) return hit
    if (data.users.length < 1000) return null
  }
  return null
}

export async function POST(request) {
  const auth = await requireAuth(request, { requiredRoles: ['super_admin'] })
  if (!auth.ok) return auth.response

  try {
    const { email, full_name, role } = await request.json()

    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      return Response.json({ error: 'Valid email is required.' }, { status: 400 })
    }
    const cleanName = String(full_name || '').trim()
    const cleanRole = String(role || 'viewer').trim()

    // Validate role exists in the roles table — otherwise the user lands on a
    // role that grants nothing.
    const { data: roleRow } = await supabaseAdmin
      .from('roles').select('name').eq('name', cleanRole).maybeSingle()
    if (!roleRow && cleanRole !== 'viewer') {
      return Response.json({ error: `Role '${cleanRole}' does not exist.` }, { status: 400 })
    }

    const tempPassword = genTempPassword()
    let userId

    const existing = await findAuthUserByEmail(cleanEmail)
    if (existing) {
      if (existing.last_sign_in_at) {
        return Response.json({ error: `${cleanEmail} already has an account and has signed in before.` }, { status: 400 })
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password: tempPassword, email_confirm: true,
        app_metadata: { must_reset_password: true },
      })
      if (error) return Response.json({ error: error.message }, { status: 400 })
      userId = existing.id
    } else {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: tempPassword,
        email_confirm: true,
        app_metadata: { must_reset_password: true },
        user_metadata: { full_name: cleanName, role: cleanRole },
      })
      if (error) return Response.json({ error: error.message }, { status: 400 })
      userId = data.user.id
    }

    // Profile row so the role is ready on first sign-in.
    const { error: profileErr } = await supabaseAdmin.from('user_profiles').upsert({
      id:        userId,
      email:     cleanEmail,
      full_name: cleanName || cleanEmail,
      role:      cleanRole,
      is_active: true,
    }, { onConflict: 'id' })
    if (profileErr) {
      return Response.json({
        error: `Account created for ${cleanEmail}, but the profile failed: ${profileErr.message}. Add the profile manually via Admin > Users.`,
        temp_password: tempPassword,
      }, { status: 500 })
    }

    return Response.json({ success: true, userId, email: cleanEmail, temp_password: tempPassword })
  } catch (err) {
    return Response.json({ error: err.message || 'Server error.' }, { status: 500 })
  }
}
