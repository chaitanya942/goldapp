// app/api/branches/resolve-address/route.js
// Resolve branch addresses via Google APIs.
// Body: { branch_names: string[], hint?: string }   (hint added to every query, e.g. "WhiteGold jewellery")
// Returns: { results: [{ branch_name, suggestion?: {...}, error?: string }] }
//
// Strategy: Geocoding API first ($5/1000), Places Text Search fallback ($32/1000)
// when Geocoding gives ZERO_RESULTS or returns a result with no PIN code.
// Cheapest path that still produces NIC-compliant addresses (with PIN).

import { requireAuthForPage } from '../../../../lib/apiAuth'

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

function pickComponent(components, type) {
  const c = (components || []).find(x => (x.types || []).includes(type))
  return c?.long_name || null
}

function parseGeocodeResult(r) {
  const comps = r.address_components || []
  const pin   = pickComponent(comps, 'postal_code')
  const city  = pickComponent(comps, 'locality') || pickComponent(comps, 'administrative_area_level_2')
  const state = pickComponent(comps, 'administrative_area_level_1')
  return {
    address:    r.formatted_address || null,
    pin_code:   pin,
    city,
    state,
    lat:        r.geometry?.location?.lat ?? null,
    lng:        r.geometry?.location?.lng ?? null,
    place_id:   r.place_id || null,
    confidence: r.geometry?.location_type === 'ROOFTOP' ? 'high'
              : r.geometry?.location_type === 'GEOMETRIC_CENTER' ? 'medium'
              : 'low',
    source:     'google_geocoding',
  }
}

async function tryGeocoding(query, apiKey) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&region=in&key=${apiKey}`
  const res = await fetch(url, { method: 'GET' })
  const body = await res.json()
  if (body.status !== 'OK' || !body.results?.length) return null
  const parsed = parseGeocodeResult(body.results[0])
  // If no PIN, treat as low-quality and let Places fallback try.
  if (!parsed.pin_code) return null
  return parsed
}

async function tryPlacesTextSearch(query, apiKey) {
  // Places API (New) - POST with field mask. Cheaper than legacy Find Place + Details.
  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.addressComponents,places.location',
    },
    body: JSON.stringify({
      textQuery: query,
      regionCode: 'IN',
      maxResultCount: 1,
    }),
  })
  const body = await res.json()
  if (!body.places?.length) return null
  const p = body.places[0]
  // Places API returns addressComponents in a different shape than Geocoding.
  const findComp = (type) => {
    const c = (p.addressComponents || []).find(x => (x.types || []).includes(type))
    return c?.longText || null
  }
  return {
    address:    p.formattedAddress || null,
    pin_code:   findComp('postal_code'),
    city:       findComp('locality') || findComp('administrative_area_level_2'),
    state:      findComp('administrative_area_level_1'),
    lat:        p.location?.latitude ?? null,
    lng:        p.location?.longitude ?? null,
    place_id:   p.id || null,
    confidence: 'medium',
    source:     'google_places',
  }
}

export async function POST(req) {
  const auth = await requireAuthForPage(req, 'branch-management')
  if (!auth.ok) return auth.response

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json({
      error: 'Google Maps API key is not configured. Set GOOGLE_MAPS_API_KEY in Vercel environment variables.',
    }, { status: 503 })
  }

  try {
    const { branch_names, hint } = await req.json()
    if (!Array.isArray(branch_names) || branch_names.length === 0) {
      return Response.json({ error: 'branch_names array required' }, { status: 400 })
    }
    if (branch_names.length > 100) {
      return Response.json({ error: 'Resolve at most 100 branches per call.' }, { status: 400 })
    }

    const queryHint = hint || 'WhiteGold jewellery India'
    const results = []
    for (const name of branch_names) {
      // Strip state-code prefixes like "TS-KUKATPALLY" → "KUKATPALLY".
      // The state code is signal for *us* (which GSTIN to use) but adds noise to the search.
      const cleaned = String(name).replace(/^[A-Z]{2}-/, '').replace(/[-_]+/g, ' ').trim()
      const query = `${queryHint} ${cleaned}`
      try {
        let suggestion = await tryGeocoding(query, apiKey)
        if (!suggestion) {
          suggestion = await tryPlacesTextSearch(query, apiKey)
        }
        if (!suggestion) {
          results.push({ branch_name: name, error: 'No match found' })
        } else {
          results.push({ branch_name: name, suggestion })
        }
      } catch (e) {
        results.push({ branch_name: name, error: e.message || 'Lookup failed' })
      }
    }

    return Response.json({ results })
  } catch (err) {
    console.error('[branches/resolve-address] error:', err)
    return Response.json({ error: err.message || 'Resolve failed' }, { status: 500 })
  }
}
