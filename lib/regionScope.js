// Region scoping for API routes that read across branches.

const REGION_BYPASS_ROLES = new Set(['super_admin', 'founders_office', 'admin'])

// Returns the user's allowed regions array, or null when unrestricted (bypass role
// or no scoping set). Reads user_profiles directly via the supabase admin client
// (which bypasses RLS) to dodge any PostgREST schema cache staleness.
export async function getAllowedRegionsForAuth(supabase, auth) {
  if (!auth || REGION_BYPASS_ROLES.has(auth.role)) return null
  const uid = auth.user?.id || auth.profile?.id
  if (!uid) return null
  const { data: prof } = await supabase
    .from('user_profiles')
    .select('allowed_regions')
    .eq('id', uid)
    .maybeSingle()
  const regions = Array.isArray(prof?.allowed_regions) ? prof.allowed_regions : []
  return regions.length === 0 ? null : regions
}
