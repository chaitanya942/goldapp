// app/api/delete-user/route.js
// Removes a user from user_profiles + Supabase Auth. Admin-only with several
// guards so a careless click can't lock the org out.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(request) {
  const auth = await requireAuth(request, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  try {
    const { userId } = await request.json()
    if (!userId) return Response.json({ error: 'userId is required.' }, { status: 400 })

    // Guard 1: never delete yourself. Easy to do by accident, locks you out.
    if (userId === auth.user?.id) {
      return Response.json({ error: 'You cannot delete your own account.' }, { status: 400 })
    }

    // Look up the target so we can run the next two guards.
    const { data: target } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, email')
      .eq('id', userId)
      .maybeSingle()
    if (!target) return Response.json({ error: 'User not found.' }, { status: 404 })

    // Guard 2: don't allow deleting the last super_admin. Locks the whole org out.
    if (target.role === 'super_admin') {
      const { count } = await supabaseAdmin
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('is_active', true)
      if ((count || 0) <= 1) {
        return Response.json({ error: 'Cannot delete the last super_admin. Promote another user first.' }, { status: 400 })
      }
    }

    // 1. Delete the profile row first (so even if auth deletion fails the
    //    user can no longer access role-gated routes).
    const { error: profileErr } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('id', userId)
    if (profileErr) throw new Error(profileErr.message)

    // 2. Delete the Supabase auth row. If this fails the profile is already
    //    gone, leaving an orphaned auth row — surface the error so an admin
    //    can clean it up via the Supabase dashboard.
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (authErr) {
      return Response.json({
        error: `Profile deleted but Supabase Auth deletion failed: ${authErr.message}. Remove the user manually from Supabase Auth dashboard.`,
      }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message || 'Server error.' }, { status: 500 })
  }
}
