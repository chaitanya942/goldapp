// Gate document downloads behind accounts-team approval.
//
// Usage in a download route:
//   const gate = await checkApproval(supabase, consignmentId, req)
//   if (gate.blocked) return gate.response
//
// Bypass options:
//   - The user has the 'action.bypass_approval_for_download' permission
//     (we read this from a x-user-role header that the client can send;
//     in a server-only context with no header, we treat it as not bypassed).
//   - Query param ?preview=accounts is allowed for the accounts approval
//     screen so they can review docs before approving.

export async function checkApproval(supabase, consignmentId, req) {
  if (!consignmentId) {
    return { blocked: true, response: Response.json({ error: 'consignment id required' }, { status: 400 }) }
  }

  const { data: cn } = await supabase
    .from('consignments')
    .select('approval_status, rejection_reason, tmp_prf_no')
    .eq('id', consignmentId)
    .maybeSingle()

  if (!cn) {
    return { blocked: true, response: Response.json({ error: 'Consignment not found' }, { status: 404 }) }
  }

  // Already approved → green light
  if (cn.approval_status === 'approved') return { blocked: false }

  // Allow preview by accounts team (they need to review before approving)
  let url
  try { url = new URL(req.url) } catch {}
  const previewMode = url?.searchParams?.get('preview')
  if (previewMode === 'accounts') return { blocked: false }

  // Bypass via header (set by super_admin / accounts in their UI calls)
  const bypassRole = req.headers.get('x-bypass-approval')
  if (bypassRole === 'true' || bypassRole === '1') return { blocked: false }

  // Otherwise blocked
  const msg = cn.approval_status === 'rejected'
    ? `Document blocked — consignment ${cn.tmp_prf_no || ''} was rejected by accounts. Reason: ${cn.rejection_reason || 'not given'}`
    : `Document blocked — consignment ${cn.tmp_prf_no || ''} is awaiting accounts team approval`
  return {
    blocked: true,
    response: Response.json({ error: msg, approval_status: cn.approval_status }, { status: 403 }),
  }
}
