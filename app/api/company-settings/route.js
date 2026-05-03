// app/api/company-settings/route.js

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Read company settings — any authenticated user (consumed by branch staff
// for HSN, tax rates, GSTIN lookups in their own UI).
export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { data, error } = await supabase
    .from('company_settings')
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

// Update company settings — admin only. Mistakes here propagate into every
// EWB / E-Invoice / PDF.
export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const body = await req.json()

  // Check if settings exist
  const { data: existing } = await supabase
    .from('company_settings')
    .select('id')
    .single()

  let result
  if (existing) {
    // Update existing
    result = await supabase
      .from('company_settings')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    // Insert new
    result = await supabase
      .from('company_settings')
      .insert(body)
      .select()
      .single()
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 500 })
  return Response.json({ data: result.data })
}
