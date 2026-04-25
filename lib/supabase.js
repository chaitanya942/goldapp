import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL     || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

// createBrowserClient is a drop-in replacement for createClient.
// It stores sessions in both cookies (readable by middleware) and localStorage.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
