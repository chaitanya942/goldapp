// app/api/mdm/users/route.js
// IT-admin user management for the MDM portal.
//   GET   → list all MDM users
//   POST  → invite a user (Supabase invite email + mdm_users row). The user
//           sets a password but cannot enter until `active` is true.
//   PATCH → toggle a user's `active` (the IT-admin master switch) or `role`.
// All admin-only (requireMdmAuth requireAdmin).

import { requireMdmAuth, mdmAdmin } from '../../../../lib/mdmAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  const { data, error } = await mdmAdmin
    .from('mdm_users')
    .select('id, email, full_name, role, active, created_at, last_login_at')
    .order('created_at', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ users: data || [] })
}

export async function POST(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { email, full_name, role, active } = await req.json()
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      return Response.json({ error: 'Valid email is required.' }, { status: 400 })
    }
    const cleanRole = role === 'admin' ? 'admin' : 'user'

    // 1. Invite via Supabase Auth → user gets an email to set a password.
    //    redirectTo lands them on the isolated MDM set-password page.
    const site = process.env.NEXT_PUBLIC_SITE_URL || ''
    const { data: invited, error: invErr } = await mdmAdmin.auth.admin.inviteUserByEmail(
      cleanEmail,
      { redirectTo: `${site}/mdm/confirm`, data: { full_name: String(full_name || '').trim(), mdm: true } },
    )
    let userId = invited?.user?.id
    // If the auth user already exists, look them up so we can still add/refresh
    // the mdm_users row (invite fails on duplicate email).
    if (invErr) {
      if (/already.*registered|exists/i.test(invErr.message || '')) {
        const { data: list } = await mdmAdmin.auth.admin.listUsers()
        const existing = (list?.users || []).find(u => (u.email || '').toLowerCase() === cleanEmail)
        if (!existing) return Response.json({ error: invErr.message }, { status: 400 })
        userId = existing.id
      } else {
        return Response.json({ error: invErr.message }, { status: 400 })
      }
    }
    if (!userId) return Response.json({ error: 'Could not resolve the invited user.' }, { status: 500 })

    // 2. Membership row — active defaults to false unless the admin opts in now.
    const { error: upErr } = await mdmAdmin.from('mdm_users').upsert({
      id:         userId,
      email:      cleanEmail,
      full_name:  String(full_name || '').trim() || cleanEmail,
      role:       cleanRole,
      active:     active === true,
      invited_by: auth.member.id,
    }, { onConflict: 'id' })
    if (upErr) return Response.json({ error: `Invite sent but membership failed: ${upErr.message}` }, { status: 500 })

    return Response.json({ success: true, userId })
  } catch (err) {
    return Response.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { id, active, role } = await req.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    // Don't let an admin lock themselves out (toggle their own access off).
    if (id === auth.member.id && active === false) {
      return Response.json({ error: "You can't disable your own access." }, { status: 400 })
    }
    const patch = {}
    if (typeof active === 'boolean') patch.active = active
    if (role === 'admin' || role === 'user') patch.role = role
    if (Object.keys(patch).length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 })
    const { error } = await mdmAdmin.from('mdm_users').update(patch).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
