import { createClient } from '@supabase/supabase-js'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { cookies } from 'next/headers'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const rpID = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').hostname

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token)
    if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const cookieStore = await cookies()
    const challenge = cookieStore.get('wg_webauthn_challenge')?.value
    if (!challenge) return Response.json({ error: 'Challenge expired — please try again' }, { status: 400 })

    const body = await request.json()
    const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })

    if (!verified || !registrationInfo) {
      return Response.json({ error: 'Verification failed' }, { status: 400 })
    }

    const { credential } = registrationInfo
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64')

    await adminSupabase.from('webauthn_credentials').insert({
      user_id: user.id,
      credential_id: credential.id,
      public_key: publicKeyBase64,
      counter: credential.counter,
    })

    cookieStore.delete('wg_webauthn_challenge')

    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
