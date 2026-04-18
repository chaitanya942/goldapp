import { createClient } from '@supabase/supabase-js'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { cookies } from 'next/headers'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const rpID = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').hostname

export async function POST(request) {
  try {
    const cookieStore = await cookies()
    const challenge = cookieStore.get('wg_webauthn_challenge')?.value
    if (!challenge) return Response.json({ error: 'Challenge expired — please try again' }, { status: 400 })

    const { email, response: authnResponse } = await request.json()
    if (!email || !authnResponse) return Response.json({ error: 'Missing fields' }, { status: 400 })

    const { data: profile } = await adminSupabase
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (!profile) return Response.json({ error: 'User not found' }, { status: 404 })

    const { data: cred } = await adminSupabase
      .from('webauthn_credentials')
      .select('*')
      .eq('credential_id', authnResponse.id)
      .eq('user_id', profile.id)
      .single()

    if (!cred) return Response.json({ error: 'Credential not found' }, { status: 404 })

    const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: authnResponse,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64')),
        counter: cred.counter,
      },
    })

    if (!verified) return Response.json({ error: 'Verification failed' }, { status: 400 })

    await adminSupabase
      .from('webauthn_credentials')
      .update({ counter: authenticationInfo.newCounter })
      .eq('credential_id', authnResponse.id)

    const { data: sessionData, error: sessionErr } = await adminSupabase.auth.admin.signInAsUser({
      id: profile.id,
    })

    if (sessionErr || !sessionData?.session) {
      return Response.json({ error: 'Failed to create session' }, { status: 500 })
    }

    cookieStore.delete('wg_webauthn_challenge')

    return Response.json({
      success: true,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      },
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
