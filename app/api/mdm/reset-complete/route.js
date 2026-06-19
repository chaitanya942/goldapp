// app/api/mdm/reset-complete/route.js
// Called by /mdm/reset after the user has set a NEW password. Clears the
// mdm_must_reset flag (app_metadata) on their own account so the forced-reset
// gate stops firing. Auth: the user's own valid session.

import { getMdmMember, mdmAdmin } from '../../../../lib/mdmAuth'

export async function POST(req) {
  const r = await getMdmMember(req)
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status })
  if (!r.member) return Response.json({ error: 'Not an MDM user' }, { status: 403 })
  try {
    await mdmAdmin.auth.admin.updateUserById(r.user.id, { app_metadata: { mdm_must_reset: false } })
    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message || 'Failed to clear reset flag' }, { status: 500 })
  }
}
