// lib/approvalGate.js
// Gate document downloads behind accounts-team approval — but only for
// documents that legally cannot move until approval is in (EWB / E-Invoice).
// Operations-side documents (Consignee Report, Delivery Challan, Issue
// Voucher) are always available to any authenticated user, because the
// branch needs them to prepare the goods BEFORE the consignment is approved.
//
// Document types:
//   - 'consignee_report' / 'delivery_challan' / 'issue_voucher' → always free
//     for authenticated users (no approval needed). Branch staff need these
//     to physically pack the consignment before accounts gets involved.
//   - 'ewb' / 'e_invoice' → gated until accounts has approved. These are the
//     legally binding GST documents; accounts must verify the values first.
//
// Usage in a download route:
//   const auth = await requireAuth(req, { requiredRoles: null })
//   if (!auth.ok) return auth.response
//   const gate = await checkApproval(supabase, consignmentId, req, auth, 'ewb')
//   if (gate.blocked) return gate.response
//
// Bypass logic for the gated documents (NOTHING is trusted from the client
// request — only the server-verified `auth` object set by lib/apiAuth.js):
//   1. ADMIN role group (super_admin / founders_office / admin) — always
//      bypasses for ops convenience and incident response.
//   2. ACCOUNTS role group with ?preview=accounts — accounts team needs to
//      review documents before approving. The role check happens server-side;
//      a regular operator can't just append the query param.

import { ROLE_GROUPS } from './apiAuth'

// Documents the operations team needs BEFORE accounts approval. These flow
// to the branch for physical preparation of the consignment.
const PRE_APPROVAL_DOCS = new Set([
  'consignee_report',
  'delivery_challan',
  'issue_voucher',
])

export async function checkApproval(supabase, consignmentId, req, auth, documentType) {
  if (!consignmentId) {
    return { blocked: true, response: Response.json({ error: 'consignment id required' }, { status: 400 }) }
  }
  if (!auth || !auth.role) {
    // Defensive — every download route should authenticate before calling us.
    return { blocked: true, response: Response.json({ error: 'auth context required' }, { status: 401 }) }
  }

  // Pre-approval documents (Consignee Report, Delivery Challan, Issue
  // Voucher): any authenticated user can download. Operations needs to ship
  // these to the branch the moment the consignment is created.
  if (documentType && PRE_APPROVAL_DOCS.has(documentType)) {
    return { blocked: false }
  }

  // Everything else (EWB, E-Invoice) goes through the approval check.
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
    ? `${cn.tmp_prf_no || 'This consignment'} was rejected by accounts. Reason: ${cn.rejection_reason || 'not given'}.`
    : `${cn.tmp_prf_no || 'This consignment'} is awaiting accounts team approval.`
  return {
    blocked: true,
    response: Response.json({ error: msg, approval_status: cn.approval_status }, { status: 403 }),
  }
}
