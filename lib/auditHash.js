// lib/auditHash.js
//
// Short deterministic fingerprint stamped on every consignment document
// (Consignee Report, Issue Voucher, Delivery Challan, and exposed via the
// document-audit API so accounts can read it off the EWB / E-Invoice
// previews too).
//
// PURPOSE
//   Manual cross-check. Hold three printed PDFs in hand. Read the
//   AUDIT HASH: footer on each. If they all match, the documents agree
//   on every audited field — addresses, gross weight, raw value, markup,
//   IGST, grand total, doc number. If they differ, something diverged
//   somewhere and accounts should investigate before goods move.
//
//   We already have:
//     - snapshot loader → single source of truth for consignment + branch
//     - computeConsignmentTotals → single source of truth for math
//     - document-audit endpoint → runtime cross-check
//     - DocAuditPanel → preview-modal banner
//   This hash is the visible, paper-trail-friendly cousin of all of those.
//
// FORMULA
//   Short SHA-1 prefix (8 hex chars, uppercase) of a stable JSON string
//   built from the canonical fields. Same inputs → same output, every
//   render, every doc. ~4 billion possible values; collisions theoretical
//   but operationally negligible.

import crypto from 'crypto'

// Normalize an address for the fingerprint: strip case + collapse whitespace
// so 'WHITE GOLD  BULLION' and 'White Gold Bullion' produce the same hash.
// Mirrors lib/consignmentTotals.js's caller intent — the audit treats minor
// formatting differences as the same address (only material drift matters).
function normAddr(b) {
  if (!b) return ''
  return [
    b.legal_name || b.name,
    b.address1   || b.address,
    b.address2   || b.city,
    b.pin || b.pin_code,
    b.state_code || b.state,
    b.gstin      || b.branch_gstin,
  ]
    .filter(Boolean)
    .map(s => String(s).replace(/\s+/g, ' ').trim().toLowerCase())
    .join(' | ')
}

export function computeAuditHash({ consignment, branch, totals }) {
  if (!totals) return '--------'
  // Field order is locked — changing it would break cross-doc comparability
  // for any document already issued. Only ADD to the end if you ever extend.
  //
  // destBranch is INTENTIONALLY NOT in the fingerprint. The EWB Direct→HO
  // flow uses HO_DEFAULTS that the Delivery Challan route doesn't load,
  // so including it would break parity. The source branch + totals already
  // capture everything material — the destination is implied by the
  // consignment's movement_type and never differs between docs of the
  // same consignment.
  const fingerprint = JSON.stringify([
    String(consignment?.tmp_prf_no  || ''),
    String(consignment?.challan_no  || ''),
    String(consignment?.movement_type || ''),
    normAddr(branch),
    Number(totals.totalGrossWt    || 0).toFixed(3),
    Number(totals.rawValue        || 0).toFixed(2),
    Number(totals.markupAmt       || 0).toFixed(2),
    Number(totals.igstAmt         || 0).toFixed(2),
    Number(totals.assessableValue || 0).toFixed(2),
    Number(totals.grandTotal      || 0).toFixed(2),
  ])
  return crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 8).toUpperCase()
}
