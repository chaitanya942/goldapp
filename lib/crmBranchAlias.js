// lib/crmBranchAlias.js
//
// Transient new-CRM branch-name aliases. A branch was briefly recorded under an
// old name in the new CRM before DevOps migrated it to the canonical name; the
// few bills stamped with the stale name are mapped here so GoldApp shows the
// correct branch everywhere (Live Feed, sync → Master Purchase Data, region
// roll-ups). Keep this minimal — remove an entry once the CRM source row is
// re-pointed/renamed. Matching is case-insensitive on the trimmed name.
const NEW_CRM_BRANCH_ALIASES = {
  'flagship store': 'VELLARA JUNCTION',
  'mangaluru':      'MANGALORE',
}

export function aliasBranchName(name) {
  if (!name) return name
  return NEW_CRM_BRANCH_ALIASES[String(name).trim().toLowerCase()] || name
}
