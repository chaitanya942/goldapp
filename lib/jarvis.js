// Jarvis (Staqu) footfall API client — server-only.
// Auth: login_key + password → jwt_access_token (valid 15 min). The sign-in
// response also lists every camera store the account can see
// (permitted_jails): store_code_id is what the footfall endpoint expects,
// and the store name matches our branches.name.

const BASE = 'https://cloud.jarvis.live/consumer/api'
const TOKEN_TTL_MS = 13 * 60 * 1000

let session = null // { token, stores: [{ code, name }], at }

// Branch-name join key: letters + digits only, so 'KA-KR PURAM' == 'KA-K R PURAM'.
export const storeKey = (name) => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

async function signIn() {
  const login_key = process.env.JARVIS_LOGIN_KEY
  const password = process.env.JARVIS_PASSWORD
  if (!login_key || !password) throw new Error('JARVIS_LOGIN_KEY / JARVIS_PASSWORD are not set')
  const res = await fetch(`${BASE}/v1/sign-in/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_key, password }),
    signal: AbortSignal.timeout(20000),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.jwt_access_token) throw new Error(`Jarvis sign-in failed (${res.status}): ${j.message || j.detail || 'no token'}`)
  const stores = (j.permitted_jails || [])
    .filter(s => s?.store_code_id && s?.name)
    .map(s => ({ code: String(s.store_code_id).trim(), name: String(s.name).trim() }))
  session = { token: j.jwt_access_token, stores, at: Date.now() }
  return session
}

export async function jarvisSession(force = false) {
  if (!force && session && Date.now() - session.at < TOKEN_TTL_MS) return session
  return signIn()
}

// One store-day of footfall. Returns { ok, status, body }; re-signs in once on 401.
export async function fetchStoreDay(code, date) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { token } = await jarvisSession(attempt > 0)
    const res = await fetch(`${BASE}/client/store-wise-visitor-daily`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, store_code: code }),
      signal: AbortSignal.timeout(20000),
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 && attempt === 0) continue
    return { ok: res.ok && body.error === false, status: res.status, body }
  }
  return { ok: false, status: 401, body: { message: 'Token is invalid or expired' } }
}
