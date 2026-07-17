// lib/busPlate.js
// Registration-plate normalization + matching for the Bus Advertising Audit.
//
// The master list and the field OCR must reduce to the SAME key before we can
// match. Karnataka plates come in many written forms —
//   "KA-09-F-5029" · "KA 09 F 5029" · "KA09F5029" · "ಕೆಎ೦೯ ಎಫ್ ೫೦೨೯"
// — and Claude is asked to return Latin, but we still fold Kannada digits and
// strip every separator here so the key is canonical no matter the source.

// Kannada (Devanagari-family) digit glyphs → Latin digits.
const KANNADA_DIGITS = { '೦':'0','೧':'1','೨':'2','೩':'3','೪':'4','೫':'5','೬':'6','೭':'7','೮':'8','೯':'9' }

/**
 * Canonical match key for a registration number.
 * Folds Kannada digits, uppercases, and removes everything that isn't A–Z/0–9.
 * Returns '' for empty/garbage input.
 */
export function normalizePlate(raw) {
  if (!raw || typeof raw !== 'string') return ''
  let s = raw.trim()
  // Fold Kannada digits to Latin.
  s = s.replace(/[೦-೯]/g, ch => KANNADA_DIGITS[ch] || ch)
  // Uppercase + drop any non-alphanumeric (spaces, hyphens, dots, script marks).
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s
}

// A well-formed Indian registration looks like: 2 letters (state) + 1–2 digits
// (RTO) + 0–3 letters (series) + 1–4 digits (number). We don't hard-reject on
// this — some fleet plates vary — but it's used to sanity-flag a read.
const PLATE_SHAPE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/

export function looksLikePlate(norm) {
  return PLATE_SHAPE.test(norm || '')
}

/**
 * Match a normalized detected plate against a set/array of known normalized keys.
 * Exact first. If no exact hit and the read is plate-shaped, try a single-edit
 * tolerance (one substituted character) — OCR routinely confuses 0/O, 8/B, 1/I,
 * 5/S, 2/Z — but ONLY when exactly one candidate is within edit-distance 1, so
 * an ambiguous read is treated as "no match" (and the field user confirms).
 *
 * @param {string} detectedNorm
 * @param {Set<string>|string[]} knownNorms
 * @returns {{ key: string, exact: boolean } | null}
 */
export function matchPlate(detectedNorm, knownNorms) {
  const d = normalizePlate(detectedNorm)
  if (!d) return null
  const set = knownNorms instanceof Set ? knownNorms : new Set(knownNorms)
  if (set.has(d)) return { key: d, exact: true }
  if (!looksLikePlate(d)) return null

  // One-substitution fuzzy pass, same length only (OCR char confusions).
  let hit = null
  for (const k of set) {
    if (k.length !== d.length) continue
    let diff = 0
    for (let i = 0; i < d.length && diff < 2; i++) if (d[i] !== k[i]) diff++
    if (diff === 1) {
      if (hit) return null      // ambiguous — two candidates one edit away → bail
      hit = k
    }
  }
  return hit ? { key: hit, exact: false } : null
}
