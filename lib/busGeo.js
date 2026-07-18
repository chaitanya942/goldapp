// lib/busGeo.js
// Does the place a bus was photographed in match the place it's registered to?
//
// The audit's whole point is proving someone actually stood in front of the bus.
// A bus registered to Kundapura (Mangalore) but photographed on Hosur Road,
// Bengaluru is the signal worth catching.
//
// The hard part is naming: the campaign sheet uses the older city names
// (Mangalore, Hubli, Belgaum, Mysore) while geocoders return the official
// current ones (Mangaluru, Hubballi, Belagavi, Mysuru). A plain string compare
// would flag almost every honest audit, so both sides are resolved to a
// canonical city first.

// canonical -> every spelling we might see, from either side.
const CITY_ALIASES = {
  bengaluru:      ['bengaluru', 'bangalore'],
  devanahalli:    ['devanahalli'],
  mysuru:         ['mysuru', 'mysore'],
  mandya:         ['mandya'],
  hassan:         ['hassan'],
  kolar:          ['kolar'],
  tumakuru:       ['tumakuru', 'tumkur'],
  mangaluru:      ['mangaluru', 'mangalore'],
  puttur:         ['puttur'],
  udupi:          ['udupi'],
  shivamogga:     ['shivamogga', 'shimoga'],
  davangere:      ['davangere', 'davanagere'],
  chitradurga:    ['chitradurga'],
  chikkamagaluru: ['chikkamagaluru', 'chikkamagalur', 'chikmagalur'],
  hosapete:       ['hosapete', 'hospete', 'hospet'],
  ballari:        ['ballari', 'bellary'],
  vijayapura:     ['vijayapura', 'bijapur'],
  belagavi:       ['belagavi', 'belgaum'],
  hubballi:       ['hubballi', 'hubli'],
  dharwad:        ['dharwad'],
  kalaburagi:     ['kalaburagi', 'gulbarga'],
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Resolve free text (a region label, or a reverse-geocoded address) to a
 * canonical city key. Returns null when nothing recognisable is present —
 * callers must treat null as "unknown", never as a mismatch.
 */
export function cityOf(text) {
  const t = ` ${norm(text)} `
  // Longest aliases first so "bangalore" doesn't shadow a longer match.
  const pairs = []
  for (const [canon, aliases] of Object.entries(CITY_ALIASES)) for (const a of aliases) pairs.push([canon, a])
  pairs.sort((x, y) => y[1].length - x[1].length)
  for (const [canon, alias] of pairs) if (t.includes(` ${alias} `)) return canon
  return null
}

/**
 * Compare where a bus is registered against where it was photographed.
 * @returns {{ status:'match'|'mismatch'|'unknown', expected:string|null, actual:string|null }}
 *
 * 'unknown' whenever either side can't be resolved — we'd rather say nothing
 * than accuse someone because a geocoder returned an unfamiliar locality.
 */
export function compareLocation(busRegion, geoText) {
  const expected = cityOf(busRegion)
  const actual = cityOf(geoText)
  if (!expected || !actual) return { status: 'unknown', expected, actual }
  return { status: expected === actual ? 'match' : 'mismatch', expected, actual }
}

/** Pretty label for a canonical city key ("mangaluru" -> "Mangaluru"). */
export function cityLabel(key) {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : ''
}
