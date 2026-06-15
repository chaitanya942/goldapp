// lib/crmBranchAlias.js
//
// New-CRM → GoldApp branch-name normalization. DevOps recorded a number of
// branches in the new CRM under variant spellings, missing prefixes, or extra
// "branches" (HO / Head Office) that are physically an existing branch. Each
// new-CRM bill's branch name is passed through aliasBranchName() on the way in
// (sync → Master Purchase Data, Live Feed, region roll-ups) so it lands on
// GoldApp's canonical (old-CRM) name.
//
// Mapping confirmed against the CRM ↔ GoldApp branch map
// (docs/crm-branch-name-comparison.md). Matching is case-insensitive on the
// trimmed, whitespace-collapsed name. Anything WITHOUT an explicit entry falls
// through to an uppercase + space-collapse normalization, so a case-only
// difference (e.g. 'Koramangala', 'Kolar', 'Tavarekere') still matches the
// branches table (all GoldApp branch names are uppercase). Keep entries here
// only until DevOps fixes the source row, then remove.
const NEW_CRM_BRANCH_ALIASES = {
  // Spelling / case variants that duplicate an existing branch
  'flagship store':           'VELLARA JUNCTION',
  'mangaluru':                'MANGALORE',
  'basaveshwarnagar':         'BASAWESHWARANAGAR',
  'bomanahalli':              'BOMMANAHALLI',
  'mattikere':                'MATHIKERE',
  'sunkadkatte':              'SUNKADAKATTE',
  't c palya':                'TC PALYA',
  'thirupathi':               'AP-TIRUPATHI',
  'ts-warangal (hanamkonda)': 'TS-WARANGAL',
  // Differently-named entries that map to an existing branch (per ops)
  'jigani':                   'BANNERGHATTA',
  'jp nagar 7thphs':          'JP NAGAR',
  'by-pass':                  'KL-VENNALA-BY-PASS',
  'cauvery junction':         'SADASHIVA NAGAR',
  // HO / Head Office bills are booked at the Koramangala branch
  'ho':                       'KORAMANGALA',
  'head office':              'KORAMANGALA',
}

export function aliasBranchName(name) {
  if (!name) return name
  const key = String(name).trim().toLowerCase().replace(/\s+/g, ' ')
  if (NEW_CRM_BRANCH_ALIASES[key]) return NEW_CRM_BRANCH_ALIASES[key]
  // No explicit alias — normalize to GoldApp's canonical UPPERCASE form so a
  // case-only difference still matches the branches table. Genuinely new /
  // unknown branches simply pass through uppercased (they match once added to
  // the branches table under that name).
  return String(name).trim().replace(/\s+/g, ' ').toUpperCase()
}
