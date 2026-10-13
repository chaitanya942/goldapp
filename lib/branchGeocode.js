// Branch → map coordinates via OpenStreetMap Nominatim (free; max 1 request/sec,
// identifying User-Agent required). Tries the most specific query first and
// only accepts a hit that Nominatim places in the branch's own state, so a
// same-named locality elsewhere in India is never used.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const UA = 'WhiteGold-GoldApp/1.0 (ops@whitegold.money)'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')

// "KA-JP NAGAR" → "JP NAGAR"; "KL-VENNALA-BY-PASS" → "VENNALA BY PASS"
export const branchLocality = (name) => String(name || '').replace(/^[A-Z]{2}-/, '').replace(/-/g, ' ').trim()

async function search(params) {
  const url = `${NOMINATIM}?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '3', countrycodes: 'in', ...params })}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)
  return res.json()
}

// Returns { lat, lng, precision } or null. Waits ~1.1s between requests.
export async function geocodeBranch(b) {
  const state = norm(b.state)
  const locality = branchLocality(b.name)
  const attempts = [
    ['locality', { q: `${locality}, ${b.city || ''}, ${b.state || ''}` }],
    ['pin', { postalcode: String(b.pin_code || '').trim(), country: 'India' }],
    ['city', { q: `${b.city || ''}, ${b.state || ''}` }],
  ].filter(([, p]) => Object.values(p).every(v => String(v).replace(/[,\s]/g, '')))

  for (const [precision, params] of attempts) {
    let hits = []
    try { hits = await search(params) } catch { hits = [] }
    await sleep(1100)
    const hit = hits.find(h => !state || norm(h.address?.state).includes(state) || state.includes(norm(h.address?.state)))
    if (hit) return { lat: Number(hit.lat), lng: Number(hit.lon), precision }
  }
  return null
}
