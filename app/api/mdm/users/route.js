// app/api/mdm/users/route.js
// IT-admin user management for the MDM portal.
//   GET   → list all MDM users
//   POST  → invite a user (Supabase invite email + mdm_users row). The user
//           sets a password but cannot enter until `active` is true.
//   PATCH → toggle a user's `active` (the IT-admin master switch) or `role`.
// All admin-only (requireMdmAuth requireAdmin).

import crypto from 'crypto'
import { requireMdmAuth, mdmAdmin } from '../../../../lib/mdmAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// One-time temporary password — shown once to the admin, never stored. The
// user is forced to reset it on first login (app_metadata.mdm_must_reset).
// 12 chars, unambiguous alphabet, guaranteed an upper + lower + digit.
function genTempPassword() {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789'
  const all = U + L + D
  const b = crypto.randomBytes(12)
  let p = U[b[0] % U.length] + L[b[1] % L.length] + D[b[2] % D.length]
  for (let i = 3; i < 12; i++) p += all[b[i] % all.length]
  return p
}

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
    const tempPassword = genTempPassword()

    // 1. Create the auth account with the temp password. email_confirm:true so
    //    they can log in straight away (no email step); mdm_must_reset forces a
    //    password reset on first login.
    const { data: created, error: cErr } = await mdmAdmin.auth.admin.createUser({
      email:         cleanEmail,
      password:      tempPassword,
      email_confirm: true,
      user_metadata: { full_name: String(full_name || '').trim() },
      app_metadata:  { mdm_must_reset: true },
    })
    let userId = created?.user?.id
    // Existing auth user → reset their temp password + re-arm must_reset.
    if (cErr) {
      if (/already|exists|registered/i.test(cErr.message || '')) {
        const { data: list } = await mdmAdmin.auth.admin.listUsers()
        const existing = (list?.users || []).find(u => (u.email || '').toLowerCase() === cleanEmail)
        if (!existing) return Response.json({ error: cErr.message }, { status: 400 })
        userId = existing.id
        await mdmAdmin.auth.admin.updateUserById(userId, {
          password: tempPassword, app_metadata: { mdm_must_reset: true },
        })
      } else {
        return Response.json({ error: cErr.message }, { status: 400 })
      }
    }
    if (!userId) return Response.json({ error: 'Could not create the user.' }, { status: 500 })

    // 2. Membership row — active defaults to false unless the admin opts in now.
    const { error: upErr } = await mdmAdmin.from('mdm_users').upsert({
      id:         userId,
      email:      cleanEmail,
      full_name:  String(full_name || '').trim() || cleanEmail,
      role:       cleanRole,
      active:     active === true,
      invited_by: auth.member.id,
    }, { onConflict: 'id' })
    if (upErr) return Response.json({ error: `User created but membership failed: ${upErr.message}` }, { status: 500 })

    // temp_password is returned ONCE for the admin to copy + share. Never stored.
    return Response.json({ success: true, userId, temp_password: tempPassword })
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
