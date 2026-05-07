// lib/gstDocPreflight.js
//
// Shared preflight validators for the GST document routes (EWB + E-Invoice,
// preview + generate). Before today these checks were inlined four times —
// drift between the four routes was inevitable. Pulling them into one place
// means every preview shows the same errors the corresponding generate would
// surface, and adding a new check fixes all four routes at once.
//
// Each validator returns an array of human-readable error strings. Routes
// concatenate the arrays and check `errors.length === 0` to decide whether
// to proceed. Empty array = all good.
//
// Routes that build on these can also add their own document-specific checks
// (e.g. EWB requires distance_km, E-Invoice requires distinct seller/buyer
// GSTINs). Those live in the route, not here.

import { REGION_TO_STATE_CODE } from './stateMap'

// ── Format validators (re-exported so route files don't redefine them) ──────
export function isValidGstin(g) {
  if (!g || typeof g !== 'string') return false
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g.toUpperCase())
}

export function isValidPin(pin) {
  return /^[1-9][0-9]{5}$/.test(String(pin || '').trim())
}

// ── Lifecycle guards: status / approval / already-generated ────────────────
//
// Every doc route runs these. They return user-facing strings that mention
// the document name so accounts knows which workflow they tripped.
export function validateConsignmentStatus(consignment, docName) {
  const errors = []
  if (!consignment) {
    errors.push('Consignment record missing')
    return errors
  }
  if (consignment.status === 'cancelled') {
    errors.push(`${consignment.tmp_prf_no || 'This consignment'} is cancelled. Cannot generate ${docName}.`)
  }
  if (consignment.approval_status === 'rejected') {
    errors.push(`${consignment.tmp_prf_no || 'This consignment'} was rejected by accounts. Cannot generate ${docName}.`)
  }
  return errors
}

// ── Branch readiness: address + PIN + GSTIN format ─────────────────────────
//
// `kind` is 'source' | 'destination' for the error labels. PIN format is
// validated only when present so missing-PIN and bad-PIN remain distinct
// errors (helpful for support).
export function validateBranchReadiness(branch, kind = 'source') {
  const errors = []
  if (!branch) {
    errors.push(`${kind === 'source' ? 'Source branch' : 'Destination'} record missing`)
    return errors
  }
  const label = kind === 'source' ? 'Source branch' : 'Destination'
  if (!branch.address && !branch.city) {
    errors.push(`${label} has no address`)
  }
  if (!branch.pin_code) {
    errors.push(`${label} '${branch.name || ''}' is missing PIN`)
  } else if (!isValidPin(branch.pin_code)) {
    errors.push(`${label} PIN '${branch.pin_code}' is invalid (must be 6 digits, not starting with 0)`)
  }
  if (branch.branch_gstin && !isValidGstin(branch.branch_gstin)) {
    errors.push(`${label} GSTIN '${branch.branch_gstin}' is malformed`)
  }
  return errors
}

// ── Item-level totals: non-empty + weight > 0 + value > 0 ──────────────────
//
// `weightField` defaults to 'gross_weight' so checks line up with what NIC
// actually sees on the EWB Qty field. Routes that key off net_weight (some
// older EWB code) can override.
export function validateItemTotals(items, docName, opts = {}) {
  const { weightField = 'gross_weight' } = opts
  const errors = []
  if (!items || items.length === 0) {
    errors.push(`Consignment has no items; cannot generate ${docName}.`)
    return errors
  }
  // Fall back to net_weight if gross is null on a legacy row.
  const totalWeight = items.reduce(
    (s, i) => s + Number(i[weightField] || i.net_weight || 0), 0,
  )
  if (totalWeight <= 0) {
    errors.push(`Total ${weightField === 'gross_weight' ? 'gross' : 'net'} weight is 0; cannot generate ${docName}.`)
  }
  const totalValue = items.reduce((s, i) => s + Number(i.total_amount || 0), 0)
  if (totalValue <= 0) {
    errors.push(`Total value is 0; cannot generate ${docName}.`)
  }
  return errors
}

// ── Resolve the seller GSTIN (state-wise → branch → env) ────────────────────
//
// Returns `{ gstin, stateCode, error? }`. Error is set when no valid GSTIN
// could be resolved AND the caller can format that into a route-specific
// message ('Set GSTIN_KL in Admin → Company Settings.', etc).
//
// This is the same resolution every doc route was inlining; centralizing it
// guarantees EWB and E-Invoice never disagree on which GSTIN to send.
export function resolveSellerGstinForBranch({ branch, companySettings }) {
  const stateCode = branch?.region ? REGION_TO_STATE_CODE[branch.region] : null
  const stateGstinField = stateCode ? `gstin_${stateCode.toLowerCase()}` : null
  const sellerGstin =
    (stateGstinField && companySettings?.[stateGstinField]) ||
    branch?.branch_gstin ||
    process.env.WG_GSTIN ||
    ''

  if (!sellerGstin) {
    return {
      gstin: '',
      stateCode,
      error: stateCode
        ? `No seller GSTIN found for ${branch?.region || stateCode}. Set 'GSTIN_${stateCode}' in Admin → Company Settings.`
        : `No seller GSTIN found for branch '${branch?.name || ''}'. Set the branch GSTIN or company-wide GSTIN in Admin → Company Settings.`,
    }
  }
  if (!isValidGstin(sellerGstin)) {
    return {
      gstin: sellerGstin,
      stateCode,
      error: `Seller GSTIN '${sellerGstin}' is malformed. Fix it in Admin → Company Settings.`,
    }
  }
  return { gstin: sellerGstin, stateCode, error: null }
}

// ── Resolve the buyer (HO) GSTIN — typically gstin_ka, then company-wide ──
export function resolveBuyerGstinForHo({ companySettings }) {
  const buyerGstin =
    companySettings?.gstin_ka ||
    companySettings?.gstin    ||
    process.env.WG_GSTIN      ||
    ''
  if (!buyerGstin) {
    return { gstin: '', error: `No HO (buyer) GSTIN configured. Set 'GSTIN_KA' or 'GSTIN' in Admin → Company Settings.` }
  }
  if (!isValidGstin(buyerGstin)) {
    return { gstin: buyerGstin, error: `Buyer (HO) GSTIN '${buyerGstin}' is malformed. Fix it in Admin → Company Settings.` }
  }
  return { gstin: buyerGstin, error: null }
}

// ── Distinct GSTIN check — both EWB and E-Invoice need this for the
//    interstate paths. NIC IRP outright rejects identical seller/buyer.
//    NIC EWB doesn't error but the document is functionally meaningless.
export function validateDistinctGstins(sellerGstin, buyerGstin, docName = 'this document') {
  if (!sellerGstin || !buyerGstin) return []
  if (sellerGstin === buyerGstin) {
    return [
      `Seller and buyer GSTINs are identical (${sellerGstin}). ${docName} is not legally required for intra-entity moves under the same GSTIN — use the E-Way Bill alone for intrastate Karnataka.`,
    ]
  }
  return []
}
