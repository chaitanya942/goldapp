import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL     || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

// detectSessionInUrl: false — our /auth/confirm and /auth/reset pages handle
// invite/reset tokens from the URL hash manually. Letting the client auto-process
// them asynchronously on init creates a race condition with our useEffect.
// flowType: 'implicit' — matches the invite email link format Supabase sends
// (hash tokens), keeping it consistent with the Supabase project settings.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType:          'implicit',
    detectSessionInUrl: false,
  },
})
