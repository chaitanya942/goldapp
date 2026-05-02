// lib/authedFetch.js
// Frontend wrapper around fetch() that injects the user's Supabase access token
// as a Bearer header. Use this for every call to a /api/* endpoint that needs
// auth (i.e. essentially all of them after the security audit).
//
// Pattern:
//   - Reads the current session from the browser supabase client.
//   - If no session, returns a 401 Response without making a network call so
//     the caller can handle redirect-to-login uniformly.
//   - Forwards all other fetch options (method, body, headers) untouched.
//
// We deliberately don't auto-refresh tokens here — supabase-js manages that
// in the background; we just read whatever is current.

import { supabase } from './supabase'

export async function authedFetch(input, init = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    // No session — fabricate a 401-like response so callers can branch on res.ok.
    return new Response(JSON.stringify({ error: 'Not signed in' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

// Convenience: same as authedFetch but parses JSON and throws on non-OK.
// Returns the parsed body on success.
export async function authedJson(input, init) {
  const res = await authedFetch(input, init)
  let body = null
  try { body = await res.json() } catch {}
  if (!res.ok) {
    const msg = body?.error || `Request failed: ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}
