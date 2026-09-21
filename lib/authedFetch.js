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

// In-memory prefetch cache. Stores the in-flight Response Promise keyed on
// URL. When a hover prefetch fires, it populates the cache; when the actual
// picker render fires the same URL within the TTL, it reuses the same
// Promise instead of doing a duplicate round trip.
//
// Only caches GET requests with no body. Cache is cleared on consumption to
// avoid stale data — second consumer triggers a fresh fetch.
const _prefetchCache = new Map()
const PREFETCH_TTL_MS = 5000  // a hover-then-click is usually <1s; 5s is generous

export function prefetch(url) {
  if (typeof window === 'undefined') return
  const existing = _prefetchCache.get(url)
  if (existing && Date.now() - existing.t < PREFETCH_TTL_MS) return  // already warming
  const promise = authedFetch(url).then(r => r.clone())  // clone so consumer can read body
  _prefetchCache.set(url, { promise, t: Date.now() })
  // Auto-evict after TTL so a hover that never converts doesn't pin memory.
  setTimeout(() => {
    const entry = _prefetchCache.get(url)
    if (entry && entry.promise === promise) _prefetchCache.delete(url)
  }, PREFETCH_TTL_MS)
}

// supabase.auth.getSession() runs BEFORE the actual network fetch() below, so
// a caller's own AbortController/timeout on the fetch (e.g. a 20s abort on a
// slow action) has NO effect on it — if getSession() itself stalls (a known
// failure mode of the Supabase JS client's cross-tab session-refresh lock),
// the whole call hangs forever with no timeout and no error, and no caller
// can do anything about it since their abort signal is never even attached
// yet. Race it against a short timeout so authedFetch always settles.
const SESSION_TIMEOUT_MS = 8000

function getSessionWithTimeout() {
  return Promise.race([
    supabase.auth.getSession(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SESSION_TIMEOUT')), SESSION_TIMEOUT_MS)),
  ])
}

export async function authedFetch(input, init = {}) {
  // Reuse a prefetch if one is in flight for the same URL (GET only, no body).
  // The picker calls authedFetch on mount; a hover prefetch may already have
  // started the same request 200-800ms earlier — sharing the Promise lets the
  // mount return instantly with cached data.
  if (typeof input === 'string' && (!init.method || init.method === 'GET') && !init.body) {
    const cached = _prefetchCache.get(input)
    if (cached && Date.now() - cached.t < PREFETCH_TTL_MS) {
      _prefetchCache.delete(input)  // single-use; next call fires fresh
      return cached.promise
    }
  }

  let session
  try {
    const result = await getSessionWithTimeout()
    session = result?.data?.session
  } catch {
    // getSession() stalled — fail fast with a real Response (not a thrown
    // rejection) so every existing caller's `if (!r.ok)` handling already
    // does the right thing, instead of the whole action freezing silently.
    return new Response(JSON.stringify({ error: 'Session check timed out — please retry.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
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
