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
import { auditorAccessNow, getIstNow } from './auditShiftGate'

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
  // Telesales operators + admins — can sync recordings from S3, manage call list.
  TELESALES: ['super_admin', 'founders_office', 'admin', 'telesales'],
  // Operations team — confirms consignments, generates pre-approval docs (report,
  // voucher, challan). Excludes accounts (they review, not author) and telesales/
  // viewer (no role on the operations workflow).
  OPERATIONS: ['super_admin', 'founders_office', 'admin', 'manager', 'branch_staff'],
  // Audit team — receives goods at HO and verifies each bill's gross weight
  // against what the source branch entered in CRM. Owns the at_branch /
  // in_consignment → at_ho transition for every inbound bill.
  AUDIT: ['super_admin', 'founders_office', 'admin', 'audit'],
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
    .select('id, email, full_name, role, is_active, allowed_regions')
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

  // ── Audit-shift time gate ──────────────────────────────────────────────
  // Users with role='audit' can only access the API during their assigned
  // shift's window (lib/auditShiftGate.js). EVERY OTHER ROLE bypasses
  // this gate — super_admin / founders_office / admin / accounts / etc.
  // keep the existing always-on flow. The /api/auditor-access endpoint
  // opts out via skipAuditGate so the client can still query its own
  // gate status when it's locked out.
  if (profile.role === 'audit' && !opts.skipAuditGate) {
    const today = getIstNow().date
    const { data: shifts } = await adminSupabase
      .from('audit_shift_assignments')
      .select('shift_date, shift_type')
      .eq('auditor_id', profile.id)
      .eq('shift_date', today)
    const decision = auditorAccessNow(shifts || [])
    if (!decision.allowed) {
      return { ok: false, response: Response.json({
        error: decision.reason || 'Outside your assigned shift window.',
        code:  'OUTSIDE_SHIFT_WINDOW',
      }, { status: 403 }) }
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

// ─────────────────────────────────────────────────────────────────────────────
// Page-permission authorisation
//
// Some admin pages are intended to be selectively delegated — ops grants
// `page.X` to non-admin roles via Role Management. The legacy pattern of
// requireAuth({ requiredRoles: ROLE_GROUPS.ADMIN }) hard-codes which roles
// may hit the API, ignoring whatever the org actually granted in role_-
// permissions. Result: a user sees the page in the sidebar (client canSee
// passes) but the API rejects them 403.
//
// `requireAuthForPage` instead asks: "does this user's role have
// `page.<pageName>` enabled in role_permissions?" — falling back to the
// hardcoded ROLE_PAGES map when the role has no DB rows yet, and always
// allowing super_admin. Caller can still pass extra opts (allowServiceToken
// etc.) — only the role-list semantics change.
//
//   const auth = await requireAuthForPage(req, 'consignment-seeds')
//   if (!auth.ok) return auth.response
//
import { ROLE_PAGES, emailAllowedForPage, PAGE_EMAIL_ALLOWLIST } from './context'

export async function requireAuthForPage(req, pageName, opts = {}) {
  // Strip role gating — we'll do permission gating ourselves below.
  const base = await requireAuth(req, { ...opts, requiredRoles: null })
  if (!base.ok) return base

  // ── Hard email allowlist — for a restricted page this is the SOLE policy,
  // checked BEFORE super_admin god-mode: a listed email is granted, everyone
  // else (including super_admin hitting the API directly) gets 403.
  if (PAGE_EMAIL_ALLOWLIST[pageName]) {
    const email = base.profile?.email || base.user?.email || null
    if (!emailAllowedForPage(email, pageName)) {
      return { ok: false, response: Response.json({ error: 'Not authorized for this page.' }, { status: 403 }) }
    }
    return base   // allowlisted — grant, skip role/super_admin gating entirely
  }

  const role = base.role
  if (role === 'super_admin') return base   // god-mode preserved

  // Pull DB-stored permissions for this role.
  const { data: perms, error } = await adminSupabase
    .from('role_permissions')
    .select('permission_key, enabled')
    .eq('role_name', role)

  if (error) {
    // Database hiccup — don't lock the user out. Fall through to the
    // hardcoded map so production access doesn't disappear on a transient
    // Supabase error.
    console.warn('requireAuthForPage: role_permissions lookup failed, falling back to ROLE_PAGES', error)
  }

  if (perms && perms.length > 0) {
    const enabled = new Set(perms.filter(p => p.enabled).map(p => p.permission_key))
    if (enabled.has(`page.${pageName}`)) return base
    return { ok: false, response: Response.json({ error: `Forbidden. Role '${role}' has not been granted access to ${pageName}.` }, { status: 403 }) }
  }

  // No DB config for this role → use the static fallback (same logic as
  // client-side canSee). If the role isn't in ROLE_PAGES at all, deny.
  const fallback = ROLE_PAGES[role]
  if (Array.isArray(fallback) && fallback.includes(pageName)) return base
  return { ok: false, response: Response.json({ error: `Forbidden. Role '${role}' does not have access to ${pageName}.` }, { status: 403 }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Region-scoped access
//
// Non-admin users can be restricted to a subset of regions via
// user_profiles.allowed_regions (TEXT[]). The bypass roles below ALWAYS see
// everything regardless of allowed_regions — they need org-wide visibility for
// operations safety (incident response, multi-region reporting, etc.).
//
// Empty / NULL allowed_regions = no restriction (default for existing users).
// ─────────────────────────────────────────────────────────────────────────────
const REGION_BYPASS_ROLES = new Set(['super_admin', 'founders_office', 'admin'])

/**
 * Resolve the region filter for an authenticated request.
 *
 *   - Returns null when the user is unrestricted (bypass role, OR allowed_regions empty).
 *     null is the sentinel: "no filter, show everything."
 *   - Returns string[] when the user is restricted: filter source-branch by these regions.
 */
export function getRegionFilter(auth) {
  if (!auth || auth.role === 'service') return null
  if (REGION_BYPASS_ROLES.has(auth.role)) return null
  const regions = auth.profile?.allowed_regions
  if (!Array.isArray(regions) || regions.length === 0) return null
  return regions
}

/**
 * Resolve the list of branch names a user can see, given their region filter.
 * Returns null when unrestricted (caller should NOT apply any branch filter).
 *
 * Pass `supabase` (admin client) so we can look up branches by region.
 *
 * Defense-in-depth: re-fetches allowed_regions directly from the DB. We do this
 * because PostgREST occasionally serves cached column shapes (the auth.profile
 * came through requireAuth which DOES read allowed_regions, but if PostgREST's
 * schema cache hasn't picked up the column, that read returns undefined).
 * A fresh query through service_role bypasses RLS and always sees the current schema.
 */
export async function resolveAllowedBranchNames(supabase, auth) {
  if (!auth || auth.role === 'service') return null
  if (REGION_BYPASS_ROLES.has(auth.role)) return null

  // Re-fetch directly to dodge any stale auth.profile shape.
  let regions = auth?.profile?.allowed_regions
  if (!Array.isArray(regions) || regions.length === 0) {
    const { data: fresh } = await supabase
      .from('user_profiles')
      .select('allowed_regions')
      .eq('id', auth.user?.id || auth.profile?.id)
      .maybeSingle()
    regions = fresh?.allowed_regions
  }
  if (!Array.isArray(regions) || regions.length === 0) return null

  const { data } = await supabase.from('branches').select('name').in('region', regions)
  return (data || []).map(b => b.name)
}
