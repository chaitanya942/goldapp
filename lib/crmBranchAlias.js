// lib/crmBranchAlias.js
//
// New-CRM → GoldApp branch-name normalization. Each new-CRM bill's branch name is
// passed through aliasBranchName() on the way in (sync → Master Purchase Data,
// Live Feed, region roll-ups) so it lands on GoldApp's canonical name.
//
// KARNATAKA PREFIX MIGRATION: every Karnataka branch (Bangalore + Rest of
// Karnataka) is now KA-prefixed, matching AP-/TS-/KL-. The CRM still sends the
// bare name ("Adugodi", "Mysuru"), so each needs an explicit alias here — WITHOUT
// these an incoming bill would normalize to the old bare name, miss the branches
// table, and sync-branches-auto would recreate it as a duplicate branch.
//
// Matching is case-insensitive on the trimmed, whitespace-collapsed name.
const NEW_CRM_BRANCH_ALIASES = {
  // ── Karnataka: bare CRM name → KA- canonical (50 branches) ──
  'adugodi':                      'KA-ADUGODI',
  'bannerghatta':                 'KA-BANNERGHATTA',
  'basaweshwaranagar':            'KA-BASAWESHWARANAGAR',
  'belagavi':                     'KA-BELAGAVI',
  'bommanahalli':                 'KA-BOMMANAHALLI',
  'chikmagaluru':                 'KA-CHIKMAGALURU',
  'chitradurga':                  'KA-CHITRADURGA',
  'davanagere':                   'KA-DAVANAGERE',
  'devanahalli':                  'KA-DEVANAHALLI',
  'electronic city':              'KA-ELECTRONIC CITY',
  'hassan':                       'KA-HASSAN',
  'hebbal':                       'KA-HEBBAL',
  'hosa road':                    'KA-HOSA ROAD',
  'hosakote':                     'KA-HOSAKOTE',
  'hospete':                      'KA-HOSPETE',
  'hubli':                        'KA-HUBLI',
  'indiranagar':                  'KA-INDIRANAGAR',
  'jalahalli':                    'KA-JALAHALLI',
  'jayanagar':                    'KA-JAYANAGAR',
  'jp nagar':                     'KA-JP NAGAR',
  'k r puram':                    'KA-K R PURAM',
  'kaikondrahalli':               'KA-KAIKONDRAHALLI',
  'katriguppe':                   'KA-KATRIGUPPE',
  'kengeri':                      'KA-KENGERI',
  'kodigehalli':                  'KA-KODIGEHALLI',
  'kolar':                        'KA-KOLAR',
  'koramangala':                  'KA-KORAMANGALA',
  'lingarajpuram':                'KA-LINGARAJPURAM',
  'malleshwaram':                 'KA-MALLESHWARAM',
  'mandya':                       'KA-MANDYA',
  'mangalore':                    'KA-MANGALORE',
  'marathahalli':                 'KA-MARATHAHALLI',
  'mathikere':                    'KA-MATHIKERE',
  'mysuru':                       'KA-MYSURU',
  'nagarbhavi':                   'KA-NAGARBHAVI',
  'sadashiva nagar':              'KA-SADASHIVA NAGAR',
  'sarjapura':                    'KA-SARJAPURA',
  'shivamogga':                   'KA-SHIVAMOGGA',
  'sunkadakatte':                 'KA-SUNKADAKATTE',
  'tavarekere':                   'KA-TAVAREKERE',
  'tc palya':                     'KA-TC PALYA',
  'thanisandra':                  'KA-THANISANDRA',
  'tumkur':                       'KA-TUMKUR',
  'udupi':                        'KA-UDUPI',
  'ullal':                        'KA-ULLAL',
  'uttarahalli':                  'KA-UTTARAHALLI',
  'vajrahalli':                   'KA-VAJRAHALLI',
  'vellara junction':             'KA-VELLARA JUNCTION',
  'vijayapura':                   'KA-VIJAYAPURA',
  'white field':                  'KA-WHITE FIELD',
  'yelahanka':                    'KA-YELAHANKA',
  // ── Spelling / naming variants that map onto an existing branch ──
  'flagship store':               'KA-VELLARA JUNCTION',
  'mangaluru':                    'KA-MANGALORE',
  'basaveshwarnagar':             'KA-BASAWESHWARANAGAR',
  'bomanahalli':                  'KA-BOMMANAHALLI',
  'mattikere':                    'KA-MATHIKERE',
  'sunkadkatte':                  'KA-SUNKADAKATTE',
  'ap-chittor':                   'AP-CHITTOOR',
  'ka-bagalkot':                  'KA-BAGALKOTE',
  't c palya':                    'KA-TC PALYA',
  'thirupathi':                   'AP-TIRUPATHI',
  'ts-warangal (hanamkonda)':     'TS-WARANGAL',
  'jigani':                       'KA-BANNERGHATTA',
  'jp nagar 7thphs':              'KA-JP NAGAR',
  'by-pass':                      'KL-VENNALA-BY-PASS',
  'cauvery junction':             'KA-SADASHIVA NAGAR',
  'mavoor road':                  'KL-MAVOOR-ROAD',
  'alappuzha':                    'KL-ALAPPUZHA',
  'ho':                           'KA-KORAMANGALA',
  'head office':                  'KA-KORAMANGALA',
}

export function aliasBranchName(name) {
  if (!name) return name
  const key = String(name).trim().toLowerCase().replace(/\s+/g, ' ')
  if (NEW_CRM_BRANCH_ALIASES[key]) return NEW_CRM_BRANCH_ALIASES[key]
  // No explicit alias — normalize to GoldApp's canonical UPPERCASE form so a
  // case-only difference still matches the branches table.
  return String(name).trim().replace(/\s+/g, ' ').toUpperCase()
}
