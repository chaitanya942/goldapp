// lib/crmBranchAlias.js
//
// Transient new-CRM branch-name aliases. A branch was briefly recorded under an
// old name in the new CRM before DevOps migrated it to the canonical name; the
// few bills stamped with the stale name are mapped here so GoldApp shows the
// correct branch everywhere (Live Feed, sync → Master Purchase Data, region
// roll-ups). Keep this minimal — remove an entry once the CRM source row is
// re-pointed/renamed. Matching is case-insensitive on the trimmed name.
const NEW_CRM_BRANCH_ALIASES = {
  'flagship store':   'VELLARA JUNCTION',
  'mangaluru':        'MANGALORE',
  // Spelling/case variants DevOps created in the new CRM that duplicate an
  // existing branch — map each to GoldApp's canonical (old-CRM) spelling so
  // bills tagged with the variant still match.
  'basaveshwarnagar': 'BASAWESHWARANAGAR',
  'bomanahalli':      'BOMMANAHALLI',
  'mattikere':        'MATHIKERE',
  'sunkadkatte':      'SUNKADAKATTE',
  't c palya':        'TC PALYA',
}

export function aliasBranchName(name) {
  if (!name) return name
  return NEW_CRM_BRANCH_ALIASES[String(name).trim().toLowerCase()] || name
}
