import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(request) {
  try {
    const { userId } = await request.json()
    if (!userId) return Response.json({ error: 'userId is required.' }, { status: 400 })

    // 1. Delete from user_profiles
    const { error: profileErr } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('id', userId)
    if (profileErr) throw new Error(profileErr.message)

    // 2. Delete from Supabase Auth
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (authErr) throw new Error(authErr.message)

    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message || 'Server error.' }, { status: 500 })
  }
}
