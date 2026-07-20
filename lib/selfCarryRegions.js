// lib/selfCarryRegions.js
//
// Which regions move stock by a branch employee carrying it personally,
// rather than handing it to a logistics partner.
//
// WHY THIS IS A CONSTANT AND NOT DERIVED
// ─────────────────────────────────────
// The obvious derivation — "branches with no logistics_partner" — does NOT
// work. Checked against live data: Andhra Pradesh is 13 BVC / 4 none and
// Telangana is 11 BVC / 1 none, so those regions look exactly like Kerala
// (38 BVC) on that column. Bangalore, which is NOT self-carry, is 22 none /
// 12 Transaction Executives — i.e. the branches with no partner are mostly in
// a region that doesn't self-carry at all.
//
// So this is an operations policy, not a property of the branch row. It lives
// here as a single named list that both the ops UI and the Issue Voucher
// import, so the policy can never drift between what ops is asked to enter and
// what the document prints.
//
// To change the policy, edit this list — nothing else.

export const SELF_CARRY_REGIONS = [
  'Rest of Karnataka',
  'Andhra Pradesh',
  'Telangana',
]

/** True when a branch in this region carries its own stock to the hub. */
export function isSelfCarryRegion(region) {
  if (!region) return false
  return SELF_CARRY_REGIONS.includes(String(region).trim())
}

/**
 * The transporter label printed on documents for a self-carried movement.
 *
 * Ops enters the employee's name at consignment creation. Falls back to the
 * bare generic label when no name was captured — older consignments store
 * exactly 'BRANCH EMPLOYEE', and those must keep rendering sensibly.
 */
export function branchEmployeeTransporter(name) {
  const n = (name || '').trim()
  return n ? `Branch Employee - ${n}` : 'BRANCH EMPLOYEE'
}
