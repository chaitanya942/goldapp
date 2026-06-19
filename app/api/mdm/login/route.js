// app/api/mdm/login/route.js
// Username-based login for MDM. The user types ANY identifier (username /
// employee id / phone / email); we resolve it to the Supabase auth email and
// sign in server-side, returning session tokens for the client to adopt.
//
// Resilient: tries username, then email, then the raw input — so it works
// before/after the username migration and whether the user types a username or
// their email.

import { createClient } from '@supabase/supabase-js'
import { mdmAdmin } from '../../../../lib/mdmAuth'

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

async function resolveEmail(input) {
  // 1) username match (column may not exist yet → swallow error)
  try {
    const { data } = await mdmAdmin.from('mdm_users').select('email').ilike('username', input).maybeSingle()
    if (data?.email) return data.email
  } catch {}
  // 2) email match
  try {
    const { data } = await mdmAdmin.from('mdm_users').select('email').ilike('email', input).maybeSingle()
    if (data?.email) return data.email
  } catch {}
  // 3) treat the input itself as the email
  return input
}

export async function POST(req) {
  try {
    const { username, password } = await req.json()
    const id = String(username || '').trim()
    if (!id || !password) return Response.json({ error: 'Username and password are required.' }, { status: 400 })

    const email = await resolveEmail(id)
    const { data, error } = await anon.auth.signInWithPassword({ email, password })
    if (error || !data?.session) {
      return Response.json({ error: 'Invalid username or password.' }, { status: 401 })
    }
    return Response.json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
  } catch (e) {
    return Response.json({ error: e.message || 'Login failed' }, { status: 500 })
  }
}
