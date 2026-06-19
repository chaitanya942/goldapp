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
  // Best-effort last-login stamp for active members.
  if (r.member?.active) {
    try { await mdmAdmin.from('mdm_users').update({ last_login_at: new Date().toISOString() }).eq('id', r.member.id) } catch {}
  }
  return Response.json({ member: r.member })
}
