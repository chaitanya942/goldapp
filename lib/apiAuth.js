// lib/apiAuth.js
// Server-side authentication + authorization helper for API routes.
//
// Pattern (mirrors app/api/add-user-profile/route.js, the existing reference):
//   1. Caller's frontend includes `Authorization: Bearer <supabase access_token>`.
//   2. We validate the token with the Supabase admin client.
//   3. We look up user_profiles.role for that user.
//   4. We compare against `requiredRoles` and return either { user, role, profile }
//      or a Response { 401 / 403 } the route can early-return.
//
// Why not middleware? Next.js middleware can't carry the supabase admin client
// without leaking the service role key into the edge runtime. Per-route auth
// keeps the service-role key in the Node runtime and lets each route declare
// its own role requirements (super_admin vs accounts vs operator).

import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// Role groups — keep in sync with lib/context.js ROLE_RESTRICTIONS / ROLE_PAGES.
export const ROLE_GROUPS = {
  // Full god-mode — can do everything including admin actions.
  ADMIN: ['super_admin', 'founders_office', 'admin'],
  // Accounts team — approves/rejects consignments, reviews documents.
  ACCOUNTS: ['super_admin', 'founders_office', 'accounts'],
  // Anyone with a real role — read-only access to consignment data.
  ANY: null,  // sentinel: no role check, just authenticated
}

/**
 * Authenticate + authorize the request.
 *
 * @param {Request} req — the incoming Request object
 * @param {object} opts
 * @param {string[] | null} [opts.requiredRoles] — list of role names; null/undefined = any authenticated user
 * @param {boolean} [opts.allowServiceToken] — accept a server-to-server token via X-Internal-Token (rarely used)
 * @returns {Promise<{ ok: true, user, role, profile } | { ok: false, response: Response }>}
 */
export async function requireAuth(req, opts = {}) {
  const { requiredRoles = null, allowServiceToken = false } = opts

  // Optional internal-service bypass (e.g. cron jobs hitting our own API).
  if (allowServiceToken) {
    const internal = req.headers.get('x-internal-token')
    if (internal && process.env.WG_INTERNAL_TOKEN && internal === process.env.WG_INTERNAL_TOKEN) {
      return { ok: true, user: null, role: 'service', profile: { id: 'service', role: 'service', email: 'service@internal' } }
    }
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return { ok: false, response: Response.json({ error: 'Unauthorized. No session token provided.' }, { status: 401 }) }
  }

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token)
  if (authErr || !user) {
    return { ok: false, response: Response.json({ error: 'Unauthorized. Invalid or expired session.' }, { status: 401 }) }
  }

  const { data: profile, error: profileErr } = await adminSupabase
    .from('user_profiles')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profileErr || !profile) {
    return { ok: false, response: Response.json({ error: 'Unauthorized. No user profile found.' }, { status: 401 }) }
  }
  if (profile.is_active === false) {
    return { ok: false, response: Response.json({ error: 'Account disabled' }, { status: 403 }) }
  }

  if (Array.isArray(requiredRoles) && requiredRoles.length > 0) {
    if (!requiredRoles.includes(profile.role)) {
      return { ok: false, response: Response.json({ error: `Forbidden. Role '${profile.role}' cannot perform this action.` }, { status: 403 }) }
    }
  }

  return { ok: true, user, role: profile.role, profile }
}

/**
 * Convenience wrapper: takes a route handler that expects (req, ctx, auth) and
 * wraps it with requireAuth() so failed auth short-circuits before the handler
 * runs. The handler receives the resolved { user, role, profile } as ctx.auth.
 *
 *   export const POST = withAuth({ requiredRoles: ROLE_GROUPS.ACCOUNTS }, async (req, _, auth) => {
 *     // auth.user, auth.role, auth.profile are guaranteed populated here.
 *   })
 */
export function withAuth(opts, handler) {
  return async function authedHandler(req, ctx) {
    const result = await requireAuth(req, opts)
    if (!result.ok) return result.response
    return handler(req, ctx, result)
  }
}

// Returns true if the role is a "debug-eligible" role — used to gate showing
// raw ClearTax payloads in API responses to the same users who could already
// access Railway logs anyway.
export function canSeeDebugPayloads(role) {
  return ROLE_GROUPS.ADMIN.includes(role)
}
