import { createClient } from '@supabase/supabase-js'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { cookies } from 'next/headers'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const rpID = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').hostname

export async function POST(request) {
  try {
    const { email, credentialId } = await request.json()
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 })

    const { data: profile } = await adminSupabase
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (!profile) return Response.json({ error: 'No passkey found for this account' }, { status: 404 })

    // If a specific credential ID is stored on this device, only request that one
    const credQuery = adminSupabase
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', profile.id)
    const { data: creds } = credentialId
      ? await credQuery.eq('credential_id', credentialId)
      : await credQuery

    if (!creds?.length) {
      return Response.json({ error: 'No passkey found for this account' }, { status: 404 })
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds.map(c => ({ id: c.credential_id, type: 'public-key' })),
      userVerification: 'preferred',
    })

    const cookieStore = await cookies()
    cookieStore.set('wg_webauthn_challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 120,
      path: '/',
    })

    return Response.json(options)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
