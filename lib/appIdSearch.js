// lib/appIdSearch.js
// Hyphen-insensitive matching for application_id search.
//
// New-CRM bills are stored as WGKA-XXXX (the source's native format); old-CRM
// bills are WGKAXXXX (no hyphen). A user shouldn't have to remember which: typing
// `WGKA56026` must still find `WGKA-56026`, and vice-versa. We make the hyphen
// irrelevant to search without touching the stored value.

// Lowercase + drop hyphens, for a format-agnostic compare.
export function stripHyphens(s) {
  return String(s || '').toLowerCase().replace(/-/g, '')
}

// Client-side: does `stored` match `query`, ignoring hyphens entirely?
// (substring match, both sides hyphen-stripped)
export function appIdMatches(stored, query) {
  if (!query) return true
  return stripHyphens(stored).includes(stripHyphens(query))
}

// Server-side (Supabase ilike): the column keeps its hyphen, so stripping the
// search term alone won't match a hyphenated value. Instead we expand the term
// into the forms the column could take and OR them:
//   raw, hyphen-stripped, and hyphen-inserted (after the letter prefix).
// e.g. "WGKA56026"  -> ["WGKA56026", "WGKA-56026"]
//      "WGKA-56026" -> ["WGKA-56026", "WGKA56026"]
//      "56026"      -> ["56026"]
export function appIdVariants(term) {
  const raw = String(term || '').trim()
  if (!raw) return []
  const stripped   = raw.replace(/-/g, '')
  const hyphenated = raw.replace(/^([A-Za-z]+)(\d)/, '$1-$2')
  return [...new Set([raw, stripped, hyphenated])]
}
