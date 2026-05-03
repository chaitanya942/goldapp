import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Returns the branch-employee directory (name, designation, branch, contact).
// Any authenticated user — used by both admin and ops UIs.
export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { data, error } = await supabase
    .from('branch_employees')
    .select('*')
    .order('name')

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ employees: data || [] })
}
