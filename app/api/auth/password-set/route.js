// POST /api/auth/password-set — called by /auth/reset after the signed-in user
// has chosen their own password. Clears app_metadata.must_reset_password on
// their own account (set when a super admin added them with a temporary
// password — see /api/invite-user), so the first-sign-in gate stops firing.
// Auth: the user's own session; the client then refreshes its session so the
// new token no longer carries the flag.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/apiAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response
  if (!auth.user?.id) return Response.json({ error: 'A signed-in user is required.' }, { status: 400 })
  const { error } = await supabaseAdmin.auth.admin.updateUserById(auth.user.id, {
    app_metadata: { must_reset_password: false },
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
