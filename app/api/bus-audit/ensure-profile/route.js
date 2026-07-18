// app/api/bus-audit/ensure-profile/route.js
// Called right after a successful email-OTP sign-in on /bus-audit.
//
// This is the REAL access gate. Anyone can ask Supabase for an OTP, but only
// someone who controls a @whitegold.money inbox can complete it — and only then
// do we provision the `marketing` role that the bus-audit APIs require. Without
// a profile+role every bus-audit endpoint 403s, so a stranger who somehow got a
// session still can't use the app.
//
// Deliberately does NOT use requireAuth: a brand-new OTP user has no
// user_profiles row yet, which requireAuth treats as unauthorized.

import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const ALLOWED_DOMAIN = (process.env.BUS_AUDIT_ALLOWED_DOMAIN || 'whitegold.money').toLowerCase()

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return Response.json({ error: 'No session token.' }, { status: 401 })

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Invalid or expired session.' }, { status: 401 })

  const email = (user.email || '').toLowerCase().trim()
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return Response.json({ error: `Bus Audit is limited to @${ALLOWED_DOMAIN} accounts.`, code: 'DOMAIN_NOT_ALLOWED' }, { status: 403 })
  }

  // Existing profile? Never downgrade someone (an admin signing in stays admin).
  const { data: existing } = await admin
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) {
    if (existing.is_active === false) return Response.json({ error: 'Account disabled.' }, { status: 403 })
    return Response.json({ ok: true, role: existing.role, created: false })
  }

  // First-time sign-in — provision as marketing (the bus-audit field role).
  const fullName = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const { error: insErr } = await admin.from('user_profiles').insert({
    id: user.id, email, full_name: fullName, role: 'marketing', is_active: true,
  })
  if (insErr) return Response.json({ error: 'Could not set up your account.', detail: insErr.message }, { status: 500 })

  return Response.json({ ok: true, role: 'marketing', created: true })
}
