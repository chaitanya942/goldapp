// lib/mdmAuth.js
// Server-side auth for the isolated MDM portal. Mirrors lib/apiAuth.js but
// checks the SEPARATE mdm_users table instead of user_profiles — so GoldApp
// membership grants nothing here and vice-versa.
//
// The IT-admin gate: a user can hold a valid Supabase session but is refused
// entry unless mdm_users.active = true. requireMdmAuth enforces that on every
// protected route; getMdmMember returns the membership (incl. inactive) so the
// /api/mdm/me gate can render the right lock screen.

import { createClient } from '@supabase/supabase-js'

export const mdmAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

function bearer(req) {
  const h = req.headers.get('authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

// Validate the token and look up MDM membership. Returns
//   { ok, user, member }  — member is null if the auth user isn't in mdm_users.
// Does NOT enforce the active gate (the caller decides).
export async function getMdmMember(req) {
  const token = bearer(req)
  if (!token) return { ok: false, status: 401, error: 'Not authenticated' }
  const { data: { user }, error } = await mdmAdmin.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, error: 'Invalid or expired session' }
  let { data: member } = await mdmAdmin
    .from('mdm_users')
    .select('id, email, full_name, role, active')
    .eq('id', user.id)
    .maybeSingle()

  // First-login provisioning for SSO users: a Google (SAML) sign-in from the
  // approved domain creates an auth user but no mdm_users row yet. Auto-create
  // an INACTIVE membership so (a) they land on the "pending approval" lock
  // screen instead of a dead "no access" card, and (b) the IT admin sees them
  // in the Users list to switch on. Non-domain accounts are never provisioned.
  if (!member && user.email) {
    const email  = user.email.toLowerCase()
    const domain = (process.env.MDM_SSO_DOMAIN || 'sell-gold.in').toLowerCase()
    if (email.endsWith('@' + domain)) {
      const full_name = user.user_metadata?.full_name || user.user_metadata?.name || null
      await mdmAdmin.from('mdm_users').upsert(
        { id: user.id, email, full_name, role: 'user', active: false },
        { onConflict: 'id', ignoreDuplicates: true },
      )
      const { data: created } = await mdmAdmin
        .from('mdm_users').select('id, email, full_name, role, active').eq('id', user.id).maybeSingle()
      member = created || null
    }
  }
  return { ok: true, user, member: member || null }
}

// Enforce: authenticated + an MDM member + active (+ admin when requireAdmin).
// Returns { ok:true, user, member } or { ok:false, response } to early-return.
export async function requireMdmAuth(req, { requireAdmin = false } = {}) {
  const r = await getMdmMember(req)
  if (!r.ok) return { ok: false, response: Response.json({ error: r.error }, { status: r.status }) }
  if (!r.member) return { ok: false, response: Response.json({ error: 'Not an MDM user', code: 'not_member' }, { status: 403 }) }
  if (!r.member.active) return { ok: false, response: Response.json({ error: 'Access not enabled by IT admin', code: 'not_active' }, { status: 403 }) }
  if (requireAdmin && r.member.role !== 'admin') {
    return { ok: false, response: Response.json({ error: 'IT admin only', code: 'not_admin' }, { status: 403 }) }
  }
  return { ok: true, user: r.user, member: r.member, admin: mdmAdmin }
}
