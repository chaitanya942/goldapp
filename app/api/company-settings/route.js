// app/api/company-settings/route.js

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET - Fetch company settings
export async function GET() {
  const { data, error } = await supabase
    .from('company_settings')
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

// POST - Update company settings
export async function POST(req) {
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
