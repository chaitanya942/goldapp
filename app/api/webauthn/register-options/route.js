import { createClient } from '@supabase/supabase-js'
import { generateRegistrationOptions } from '@simplewebauthn/server'
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

    const { data: existingCreds } = await adminSupabase
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', user.id)

    const options = await generateRegistrationOptions({
      rpName: 'White Gold',
      rpID,
      userName: user.email,
      attestationType: 'none',
      excludeCredentials: (existingCreds || []).map(c => ({
        id: c.credential_id,
        type: 'public-key',
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
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
