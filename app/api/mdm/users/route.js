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
    .select('*')   // include username if migrated; tolerant of pre-migration schema
    .order('created_at', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ users: data || [] })
}

export async function POST(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { username, email, full_name, role, active } = await req.json()
    const uname = String(username || '').trim()
    if (!uname) return Response.json({ error: 'A username is required (name / employee id / phone / email).' }, { status: 400 })
    const realEmail = String(email || '').trim().toLowerCase()
    if (realEmail && !EMAIL_RE.test(realEmail)) return Response.json({ error: 'That email looks invalid.' }, { status: 400 })
    const cleanRole = role === 'admin' ? 'admin' : 'user'

    // Username must be unique (login identifier).
    const { data: dup } = await mdmAdmin.from('mdm_users').select('id').ilike('username', uname).maybeSingle()
    if (dup) return Response.json({ error: `Username "${uname}" is already taken.` }, { status: 400 })

    // Supabase Auth needs an email. Use the real one if given (so forgot-password
    // works) — otherwise a synthetic, undeliverable @mdm.local address. The user
    // always logs in with their USERNAME, not this email.
    const authEmail = realEmail || `mdm_${crypto.randomBytes(7).toString('hex')}@mdm.local`
    const tempPassword = genTempPassword()

    const { data: created, error: cErr } = await mdmAdmin.auth.admin.createUser({
      email:         authEmail,
      password:      tempPassword,
      email_confirm: true,
      user_metadata: { full_name: String(full_name || '').trim(), mdm_username: uname },
      app_metadata:  { mdm_must_reset: true },
    })
    let userId = created?.user?.id
    if (cErr) {
      if (realEmail && /already|exists|registered/i.test(cErr.message || '')) {
        const { data: list } = await mdmAdmin.auth.admin.listUsers()
        const existing = (list?.users || []).find(u => (u.email || '').toLowerCase() === authEmail)
        if (!existing) return Response.json({ error: cErr.message }, { status: 400 })
        userId = existing.id
        await mdmAdmin.auth.admin.updateUserById(userId, { password: tempPassword, app_metadata: { mdm_must_reset: true } })
      } else {
        return Response.json({ error: cErr.message }, { status: 400 })
      }
    }
    if (!userId) return Response.json({ error: 'Could not create the user.' }, { status: 500 })

    // Membership row — active defaults to false unless the admin opts in now.
    const row = { id: userId, username: uname, email: authEmail, full_name: String(full_name || '').trim() || uname, role: cleanRole, active: active === true, invited_by: auth.member.id }
    let { error: upErr } = await mdmAdmin.from('mdm_users').upsert(row, { onConflict: 'id' })
    // Resilience: if the username column isn't migrated yet, save without it.
    if (upErr && /username/i.test(upErr.message || '')) {
      const { username: _u, ...noUsername } = row
      ;({ error: upErr } = await mdmAdmin.from('mdm_users').upsert(noUsername, { onConflict: 'id' }))
    }
    if (upErr) return Response.json({ error: `User created but membership failed: ${upErr.message}` }, { status: 500 })

    // temp_password is returned ONCE for the admin to copy + share. Never stored.
    return Response.json({ success: true, userId, username: uname, temp_password: tempPassword })
  } catch (err) {
    return Response.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { id, active, role, reset_password } = await req.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    // Re-issue a one-time temp password (for users with no email / forgot path).
    // Returns it once; forces a reset on next login.
    if (reset_password) {
      const temp = genTempPassword()
      const { error } = await mdmAdmin.auth.admin.updateUserById(id, { password: temp, app_metadata: { mdm_must_reset: true } })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ success: true, temp_password: temp })
    }
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
