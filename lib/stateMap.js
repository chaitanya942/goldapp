// Centralised region/state mapping. Edit here once instead of in 4+ files.
// If a new state is added (e.g. Maharashtra), append it here and add a
// company_settings.gstin_<code> column for that state's GSTIN.

export const REGION_TO_STATE_CODE = {
  'Andhra Pradesh':    'AP',
  'Kerala':            'KL',
  'Telangana':         'TS',
  'Tamil Nadu':        'TN',
  'Rest of Karnataka': 'KA',
  'Bangalore':         'KA',
}

// 2-char state code → 2-digit GSTIN-prefix code (NIC standard)
export const STATE_TO_GSTIN_NUM = {
  KA: '29', KL: '32', AP: '37', TS: '36', TN: '33',
}

export const STATE_NAME = {
  KA: 'KARNATAKA', KL: 'KERALA', AP: 'ANDHRA PRADESH', TS: 'TELANGANA', TN: 'TAMIL NADU',
}

export function getStateCodeFromRegion(region) {
  return REGION_TO_STATE_CODE[region] || null
}

export function getGstinNumForState(stateCode) {
  return STATE_TO_GSTIN_NUM[stateCode] || '29'
}
