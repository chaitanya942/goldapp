// app/api/mdm/me/route.js
// Returns the caller's MDM membership so the client can gate the UI:
//   { member: null }                         → not an MDM user (show "no access")
//   { member: { active:false, ... } }        → invited but IT admin hasn't enabled
//   { member: { active:true, role, ... } }   → allowed in
// Does not enforce the active gate here — the client renders the lock screen.

import { getMdmMember, mdmAdmin } from '../../../../lib/mdmAuth'

export async function GET(req) {
  const r = await getMdmMember(req)
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status })
  // must_reset lives in app_metadata (service-role only → user can't bypass it).
  const must_reset = r.user?.app_metadata?.mdm_must_reset === true
  // Best-effort last-login stamp for active members.
  if (r.member?.active && !must_reset) {
    try { await mdmAdmin.from('mdm_users').update({ last_login_at: new Date().toISOString() }).eq('id', r.member.id) } catch {}
  }
  return Response.json({ member: r.member ? { ...r.member, must_reset } : null })
}
