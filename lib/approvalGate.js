// lib/approvalGate.js
// Gate document downloads behind accounts-team approval.
//
// Usage in a download route:
//   const auth = await requireAuth(req, { requiredRoles: null })
//   if (!auth.ok) return auth.response
//   const gate = await checkApproval(supabase, consignmentId, req, auth)
//   if (gate.blocked) return gate.response
//
// Bypass logic (NOTHING is trusted from the client request — only the
// server-verified `auth` object set by lib/apiAuth.js):
//   1. ADMIN role group (super_admin / founders_office / admin) — always
//      bypasses for ops convenience and incident response.
//   2. ACCOUNTS role group with ?preview=accounts — accounts team needs to
//      review documents before approving. The role check happens server-side;
//      a regular operator can't just append the query param.
//
// The previous version trusted an `x-bypass-approval` header from the client,
// which any authenticated user could set with curl — making the gate
// effectively useless. That bypass is removed entirely.

import { ROLE_GROUPS } from './apiAuth'

export async function checkApproval(supabase, consignmentId, req, auth) {
  if (!consignmentId) {
    return { blocked: true, response: Response.json({ error: 'consignment id required' }, { status: 400 }) }
  }
  if (!auth || !auth.role) {
    // Defensive — every download route should authenticate before calling us.
    return { blocked: true, response: Response.json({ error: 'auth context required' }, { status: 401 }) }
  }

  const { data: cn } = await supabase
    .from('consignments')
    .select('approval_status, rejection_reason, tmp_prf_no')
    .eq('id', consignmentId)
    .maybeSingle()

  if (!cn) {
    return { blocked: true, response: Response.json({ error: 'Consignment not found' }, { status: 404 }) }
  }

  // Approved → green light for everyone.
  if (cn.approval_status === 'approved') return { blocked: false }

  // Admin group bypasses always — they own the system and need access for
  // incident response (e.g. urgent EWB regeneration with a different vehicle).
  if (ROLE_GROUPS.ADMIN.includes(auth.role)) return { blocked: false }

  // Accounts group can preview pending documents via ?preview=accounts so
  // they can review before approving. The role check is server-side; the
  // query param alone is not sufficient.
  let url
  try { url = new URL(req.url) } catch {}
  const previewMode = url?.searchParams?.get('preview')
  if (previewMode === 'accounts' && ROLE_GROUPS.ACCOUNTS.includes(auth.role)) {
    return { blocked: false }
  }

  // Otherwise blocked.
  const msg = cn.approval_status === 'rejected'
    ? `Document blocked — consignment ${cn.tmp_prf_no || ''} was rejected by accounts. Reason: ${cn.rejection_reason || 'not given'}`
    : `Document blocked — consignment ${cn.tmp_prf_no || ''} is awaiting accounts team approval`
  return {
    blocked: true,
    response: Response.json({ error: msg, approval_status: cn.approval_status }, { status: 403 }),
  }
}
