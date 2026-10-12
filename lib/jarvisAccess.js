// Who can see Jarvis store footfall (dashboard card/section + /api/jarvis-footfall):
// every super_admin, plus these named non-super_admin accounts.
// Plain module (no 'use client') so both client components and API routes can call it.

export const JARVIS_EXTRA_EMAILS = ['director@whitegroup.in']

export function canSeeJarvis(role, email) {
  return role === 'super_admin' || JARVIS_EXTRA_EMAILS.includes(String(email || '').trim().toLowerCase())
}
