// One-time temporary password for a newly added account — shown once to the
// admin who created it, never stored. The person must replace it on first
// sign-in. 12 chars, unambiguous alphabet, guaranteed an upper + lower + digit.
// Server-only (Node crypto). Used by /api/invite-user and the MDM portal.
import crypto from 'crypto'

export function genTempPassword() {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789'
  const all = U + L + D
  const b = crypto.randomBytes(12)
  let p = U[b[0] % U.length] + L[b[1] % L.length] + D[b[2] % D.length]
  for (let i = 3; i < 12; i++) p += all[b[i] % all.length]
  return p
}
