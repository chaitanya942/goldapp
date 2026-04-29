// lib/clearTaxClient.js
// ClearTax GSP integration for E-Way Bill generation, PDF retrieval, and cancellation.
// Port of the NestJS ClearTaxService from the WG backend, adapted for goldapp.

// DD/MM/YYYY in IST — ClearTax expects this format for DocumentDate.
function formatDocumentDate(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  const dd  = String(ist.getUTCDate()).padStart(2, '0')
  const mm  = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const yy  = ist.getUTCFullYear()
  return `${dd}/${mm}/${yy}`
}

const CLEARTAX_URL = process.env.CLEARTAX_URL
const CLEARTAX_TOKEN = process.env.CLEARTAX_TOKEN
const WG_GSTIN = process.env.WG_GSTIN  // HO Bangalore GSTIN — fallback when buyer GSTIN not derivable

// Region (in `branches.region`) → 2-char state code (used to map state → GSTIN prefix)
const REGION_TO_STATE_CODE = {
  'Andhra Pradesh':    'AP',
  'Kerala':            'KL',
  'Telangana':         'TS',
  'Tamil Nadu':        'TN',
  'Rest of Karnataka': 'KA',
  'Bangalore':         'KA',
}

// 2-char state code → 2-digit GSTIN-prefix code
const STATE_TO_GSTIN_NUM = { KA: '29', KL: '32', AP: '37', TS: '36', TN: '33' }

const STATE_NAME = { KA: 'KARNATAKA', KL: 'KERALA', AP: 'ANDHRA PRADESH', TS: 'TELANGANA', TN: 'TAMIL NADU' }

// HO address — replace via env or company_settings if needed
const HO_DEFAULTS = {
  Gstin: WG_GSTIN || '',
  LglNm: 'White Gold Bullion pvt ltd',
  TrdNm: 'White Gold Money',
  Addr1: 'First Floor, Hosur Rd, nearby Subway Shop, Industrial Area, 5th Block',
  Addr2: 'Koramangala, Bengaluru',
  Loc:   'KORAMANGLA',
  Pin:   560095,
  Stcd:  '29',
}

// ── Resolve seller GSTIN from company_settings based on branch state ────────
// branches no longer need branch_gstin filled per-row; we look it up from
// company_settings.gstin_<state_code_lower> (e.g. gstin_kl for Kerala).
function resolveSellerGstin(branch, companySettings) {
  if (!branch || !companySettings) return null
  const stateCode = REGION_TO_STATE_CODE[branch?.region]
  if (!stateCode) return null
  const fieldName = `gstin_${stateCode.toLowerCase()}`
  return companySettings[fieldName] || null
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getStateCodeFromGstin(gstin) {
  if (!gstin || gstin.length < 2) return null
  return gstin.slice(0, 2)
}

function getStateCodeFromRegion(region) {
  return REGION_TO_STATE_CODE[region] || null
}

function gstinNumForState(stateCode) {
  return STATE_TO_GSTIN_NUM[stateCode] || '29'
}

function normalizePin(pin) {
  if (!pin) return undefined
  const n = Number(pin)
  return Number.isNaN(n) ? undefined : n
}

// ── Build EWB-01 payload from consignment + branch + items ──────────────────
function buildPayload({ consignment, branch, items, companySettings }) {
  const stateCode    = getStateCodeFromRegion(branch?.region) || 'KA'
  const isKa         = stateCode === 'KA'
  const supplyType   = isKa ? 'INWARD' : 'OUTWARD'
  // Prefer company_settings state-wise GSTIN. Fall back to branch.branch_gstin, then env var.
  const sellerGstin  = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN || ''
  const sellerStcd   = getStateCodeFromGstin(sellerGstin) || gstinNumForState(stateCode)
  const sellerPin    = normalizePin(branch?.pin_code)

  const sellerDetails = {
    Gstin: sellerGstin,
    LglNm: 'White Gold Bullion pvt ltd',
    TrdNm: 'White Gold Money',
    Addr1: branch?.address || '',
    Loc:   branch?.name || '',
    Pin:   sellerPin,
    Stcd:  sellerStcd,
  }

  // OUTWARD (interstate, branch → HO) → buyer is the same legal entity at the *originating* state-GSTIN (own use).
  // INWARD (intra-state KA, branch → HO) → buyer is HO (Bangalore Koramangla).
  const isOwnUseOutward = supplyType === 'OUTWARD'
  const buyerDetails    = isOwnUseOutward
    ? { ...sellerDetails }
    : HO_DEFAULTS

  // Totals
  const totalGrossWt = parseFloat(
    (items.reduce((s, it) => s + parseFloat(it.gross_weight || 0), 0)).toFixed(2)
  )
  const totalAss     = parseFloat(
    (items.reduce((s, it) => s + parseFloat(it.total_amount || 0), 0)).toFixed(2)
  )

  const ItemList = [{
    ProdName:     'Used Gold Ornaments and Gold Jewellery',
    ProdDesc:     '',
    HsnCd:        '71131910',
    Qty:          totalGrossWt,
    Unit:         'GMS',
    AssAmt:       totalAss,
    CgstRt:       0, CgstAmt:      0,
    SgstRt:       0, SgstAmt:      0,
    IgstRt:       0, IgstAmt:      0,
    CesRt:        0, CesAmt:       0,
    OthChrg:      0,
    CesNonAdvAmt: 0,
  }]

  return {
    // ClearTax limits DocumentNumber to 16 chars (alphanumeric + '-' + '/').
    // Our challan_no is ~27 chars, so use tmp_prf_no (e.g. "WG000003" — 8 chars).
    DocumentNumber:           (consignment.tmp_prf_no || consignment.challan_no || '').slice(0, 16),
    DocumentType:             'CHL',
    DocumentDate:             formatDocumentDate(),
    SupplyType:               supplyType,
    SubSupplyType:            'OWN_USE',
    TransactionType:          'Regular',
    TransMode:                'ROAD',
    BuyerDtls:                buyerDetails,
    SellerDtls:               sellerDetails,
    DispatchDtls:             sellerDetails,
    ShipDtls:                 buyerDetails,
    ItemList,
    TotalAssessableAmount:    totalAss,
    TotalCgstAmount:          0,
    TotalSgstAmount:          0,
    TotalIgstAmount:          0,
    TotalCessAmount:          0,
    TotalCessNonAdvolAmount:  0,
    OtherAmount:              0,
    OtherTcsAmount:           0,
    TotalInvoiceAmount:       totalAss,
  }
}

// ── Error extraction ─────────────────────────────────────────────────────────
function extractClearTaxMessage(err, fallback = 'ClearTax request failed') {
  if (!err) return fallback
  if (typeof err === 'string') return err
  const candidates = [err.govt_response, err.error, err.response?.data, err]
  for (const c of candidates) {
    if (!c) continue
    if (typeof c === 'string') return c
    const details = c.ErrorDetails || c.errorDetails
    if (Array.isArray(details) && details.length) {
      const msg = details
        .map(d => [d?.error_message, d?.errorMessage, d?.message, d?.error_code ? `(${d.error_code})` : null].filter(Boolean).join(' '))
        .filter(Boolean).join(', ')
      if (msg) return msg
    }
    const direct = [c.message, c.error_message, c.errorMessage, c.ErrorMessage, c.status_desc, c.info, c.remarks]
      .find(v => typeof v === 'string' && v.trim().length)
    if (direct) return direct
  }
  try { return JSON.stringify(err).slice(0, 500) } catch { return fallback }
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function generateEWayBill({ consignment, branch, items, companySettings, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) {
    throw new Error('ClearTax not configured: set CLEARTAX_URL and CLEARTAX_TOKEN env vars')
  }
  const payload = buildPayload({ consignment, branch, items, companySettings })
  const sellerGstin = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN
  const gstin       = gstinOverride || sellerGstin
  if (!gstin) throw new Error('No GSTIN available for E-Way Bill request')

  const res = await fetch(`${CLEARTAX_URL}/einv/v3/ewaybill/generate`, {
    method: 'PUT',
    headers: {
      'Content-Type':         'application/json',
      'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
      'gstin':                 gstin,
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.govt_response?.Success !== 'Y') {
    throw new Error(extractClearTaxMessage(data, 'E-Way Bill generation failed'))
  }
  return data
}

export async function fetchEWayBillPdf({ ewbNumbers, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  const gstin = gstinOverride || WG_GSTIN
  const res = await fetch(`${CLEARTAX_URL}/einv/v2/eInvoice/ewaybill/print?format=PDF`, {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
      'gstin':                 gstin,
    },
    body: JSON.stringify({ ewb_numbers: Array.isArray(ewbNumbers) ? ewbNumbers : [ewbNumbers], print_type: 'DETAILED' }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(extractClearTaxMessage(errText || res.statusText, 'Failed to fetch E-Way Bill PDF'))
  }
  return Buffer.from(await res.arrayBuffer())
}

// Recursively remove null / undefined / empty-string fields. IRP rejects them.
function stripEmpty(obj) {
  if (Array.isArray(obj)) return obj.map(stripEmpty)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue
      const cleaned = stripEmpty(v)
      if (cleaned !== null && cleaned !== undefined && cleaned !== '') out[k] = cleaned
    }
    return out
  }
  return obj
}

// ── E-Invoice (IRP) ──────────────────────────────────────────────────────────
function buildEInvoicePayload({ consignment, branch, items, companySettings }) {
  const stateCode    = getStateCodeFromRegion(branch?.region) || 'KA'
  const sellerGstin  = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN || ''
  const sellerStcd   = getStateCodeFromGstin(sellerGstin) || gstinNumForState(stateCode)
  const sellerPin    = normalizePin(branch?.pin_code)

  // Buyer = HO Karnataka. For E-Invoice the buyer GSTIN must differ from seller GSTIN
  // (B2B requirement); seller is now correctly resolved per-state.
  const buyerGstin = companySettings?.gstin_ka || companySettings?.gstin || WG_GSTIN || sellerGstin
  const buyerStcd  = getStateCodeFromGstin(buyerGstin) || HO_DEFAULTS.Stcd

  // FOC stock-transfer pattern — taxable = cost, tax rates = 0 (matches our EWB payload).
  const totalGrossWt = parseFloat((items.reduce((s, it) => s + parseFloat(it.gross_weight || 0), 0)).toFixed(3))
  const totalAss     = parseFloat((items.reduce((s, it) => s + parseFloat(it.total_amount || 0), 0)).toFixed(2))

  const docNo   = (consignment.tmp_prf_no || consignment.challan_no || '').slice(0, 16)
  const docDate = formatDocumentDate()

  const raw = {
    Version: '1.1',
    TranDtls: {
      TaxSch:  'GST',
      SupTyp:  'B2B',
      RegRev:  'N',
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: 'INV',
      No:  docNo,
      Dt:  docDate,
    },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: 'White Gold Bullion pvt ltd',
      TrdNm: 'White Gold Money',
      Addr1: branch?.address || '',
      Loc:   branch?.name || '',
      Pin:   sellerPin,
      Stcd:  sellerStcd,
    },
    BuyerDtls: {
      Gstin: buyerGstin,
      LglNm: HO_DEFAULTS.LglNm,
      TrdNm: HO_DEFAULTS.TrdNm,
      Pos:   buyerStcd,
      Addr1: HO_DEFAULTS.Addr1,
      Addr2: HO_DEFAULTS.Addr2,
      Loc:   HO_DEFAULTS.Loc,
      Pin:   HO_DEFAULTS.Pin,
      Stcd:  buyerStcd,
    },
    ItemList: [{
      SlNo:        '1',
      PrdDesc:     'Used Gold Ornaments and Gold Jewellery',
      IsServc:     'N',
      HsnCd:       '71131910',
      Qty:         totalGrossWt,
      Unit:        'GMS',
      UnitPrice:   totalGrossWt > 0 ? parseFloat((totalAss / totalGrossWt).toFixed(2)) : 0,
      TotAmt:      totalAss,
      Discount:    0,
      AssAmt:      totalAss,
      GstRt:       0,
      IgstAmt:     0,
      CgstAmt:     0,
      SgstAmt:     0,
      CesRt:       0,
      CesAmt:      0,
      CesNonAdvlAmt: 0,
      StateCesRt:    0,
      StateCesAmt:   0,
      StateCesNonAdvlAmt: 0,
      OthChrg:     0,
      TotItemVal:  totalAss,
    }],
    ValDtls: {
      AssVal:        totalAss,
      CgstVal:       0,
      SgstVal:       0,
      IgstVal:       0,
      CesVal:        0,
      StCesVal:      0,
      Discount:      0,
      OthChrg:       0,
      RndOffAmt:     0,
      TotInvVal:     totalAss,
    },
  }
  return stripEmpty(raw)
}

export async function generateEInvoice({ consignment, branch, items, companySettings, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured: set CLEARTAX_URL and CLEARTAX_TOKEN env vars')
  const payload = buildEInvoicePayload({ consignment, branch, items, companySettings })
  const sellerGstin = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN
  const gstin       = gstinOverride || sellerGstin
  if (!gstin) throw new Error('No GSTIN available for E-Invoice request')

  console.log('[E-Invoice] Outgoing payload:', JSON.stringify(payload, null, 2))

  const url = `${CLEARTAX_URL}/einv/v2/eInvoice/generate`
  const headers = {
    'Content-Type':          'application/json',
    'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
    'gstin':                 gstin,
  }
  let res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) })
  if (res.status === 405) {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  }
  const data = await res.json().catch(() => ({}))
  console.log('[E-Invoice] ClearTax response status:', res.status, 'body:', JSON.stringify(data, null, 2))

  if (!res.ok || data?.govt_response?.Success === 'N') {
    const msg = extractClearTaxMessage(data, 'E-Invoice generation failed')
    const err = new Error(msg)
    err.cleartaxResponse = data
    err.outgoingPayload  = payload
    throw err
  }
  return data
}

export async function cancelEInvoice({ irn, reasonCode = '1', remark = 'Duplicate', gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  const gstin = gstinOverride || WG_GSTIN
  const res = await fetch(`${CLEARTAX_URL}/einv/v2/eInvoice/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
      'gstin':                 gstin,
    },
    body: JSON.stringify({ Irn: irn, CnlRsn: reasonCode, CnlRem: remark }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractClearTaxMessage(data, 'Failed to cancel E-Invoice'))
  return data
}

// ── E-Way Bill cancel (existing) ─────────────────────────────────────────────
export async function cancelEWayBill({ ewbNumber, reasonCode = 'DUPLICATE', remark = 'Duplicate Entry', gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  const gstin = gstinOverride || WG_GSTIN
  const res = await fetch(`${CLEARTAX_URL}/einv/v2/eInvoice/ewaybill/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
      'gstin':                 gstin,
    },
    body: JSON.stringify({ ewbNo: ewbNumber, cancelRsnCode: reasonCode, cancelRmrk: remark }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractClearTaxMessage(data, 'Failed to cancel E-Way Bill'))
  return data
}
