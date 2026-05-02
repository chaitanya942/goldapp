// lib/clearTaxClient.js
// ClearTax GSP integration for E-Way Bill generation, PDF retrieval, and cancellation.
// Port of the NestJS ClearTaxService from the WG backend, adapted for goldapp.

import { estimateDistanceKm } from './distanceCalc'

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

// NIC IRP / EWB schema constraints for address fields:
// - Addr1, Addr2: 1–100 chars each
// - Allowed: A-Z, a-z, 0-9, space, . , - / ( )
// - Disallowed special chars (e.g. # ' " & * | etc.) cause error 107
// This helper sanitises and splits a long address into compliant Addr1 + Addr2.
function sanitiseAddrPart(s, max = 100) {
  if (!s) return ''
  // Replace disallowed chars with spaces
  let cleaned = String(s).replace(/[^A-Za-z0-9 .,\-/()]+/g, ' ')
  // Collapse runs of whitespace, trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  // Truncate at last word boundary within the limit
  if (cleaned.length <= max) return cleaned
  const cut = cleaned.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()
}

// Split an address into Addr1 + Addr2 (each ≤100 chars). Tries to break at a
// comma or word boundary so the line breaks read naturally.
function splitAddress(raw, max = 100) {
  const cleaned = String(raw || '').replace(/[^A-Za-z0-9 .,\-/()]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return { addr1: cleaned, addr2: '' }
  // Try to break at a comma close to (but under) max
  let cut = cleaned.slice(0, max)
  const lastComma = cut.lastIndexOf(',')
  if (lastComma > 40) cut = cleaned.slice(0, lastComma)
  else {
    const lastSpace = cut.lastIndexOf(' ')
    if (lastSpace > 40) cut = cleaned.slice(0, lastSpace)
  }
  const addr1 = cut.trim().replace(/[,\s]+$/, '')
  const addr2 = cleaned.slice(cut.length).trim().replace(/^[,\s]+/, '').slice(0, max)
  return { addr1, addr2 }
}

// HO address fallback — used only if company_settings is missing fields.
// Real values come from company_settings via resolveHoDefaults() below.
const HO_FALLBACK = {
  Gstin: WG_GSTIN || '',
  LglNm: 'White Gold Bullion pvt ltd',
  TrdNm: 'White Gold Money',
  Addr1: 'First Floor, Hosur Rd, nearby Subway Shop, Industrial Area, 5th Block',
  Addr2: 'Koramangala, Bengaluru',
  Loc:   'KORAMANGLA',
  Pin:   560095,
  Stcd:  '29',
}

// Resolve HO defaults from company_settings (admin-editable in the app).
// Falls back to HO_FALLBACK only if a field is empty. Always read from
// company_settings — never hardcode HO details going forward.
function resolveHoDefaults(companySettings) {
  const cs = companySettings || {}
  const stateCode = REGION_TO_STATE_CODE[cs.head_office_state] || cs.head_office_state_code || HO_FALLBACK.Stcd
  return {
    Gstin: cs.gstin || cs.gstin_ka || HO_FALLBACK.Gstin,
    LglNm: cs.company_name        || HO_FALLBACK.LglNm,
    TrdNm: cs.trade_name          || cs.company_name || HO_FALLBACK.TrdNm,
    Addr1: cs.head_office_address || HO_FALLBACK.Addr1,
    Addr2: cs.head_office_building || HO_FALLBACK.Addr2,
    Loc:   cs.head_office_city    || HO_FALLBACK.Loc,
    Pin:   Number(cs.head_office_pin) || HO_FALLBACK.Pin,
    Stcd:  STATE_TO_GSTIN_NUM[stateCode] || HO_FALLBACK.Stcd,
  }
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
function buildPayload({ consignment, branch, items, destBranch, companySettings }) {
  // HO defaults resolved from company_settings (admin-editable). Used for any
  // EXTERNAL Direct→HO / Hub→HO consignment.
  const HO_DEFAULTS  = resolveHoDefaults(companySettings)
  const stateCode    = getStateCodeFromRegion(branch?.region) || 'KA'
  const isKa         = stateCode === 'KA'
  const supplyType   = isKa ? 'INWARD' : 'OUTWARD'
  // Prefer company_settings state-wise GSTIN. Fall back to branch.branch_gstin, then env var.
  const sellerGstin  = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN || ''
  const sellerStcd   = getStateCodeFromGstin(sellerGstin) || gstinNumForState(stateCode)
  const sellerPin    = normalizePin(branch?.pin_code)

  // Sanitise + split addresses to NIC's 100-char Addr1/Addr2 limits and
  // strip disallowed special chars (which trigger NIC error 107).
  const sellerSplit = splitAddress(branch?.address || '')
  const sellerDetails = {
    Gstin: sellerGstin,
    LglNm: sanitiseAddrPart(companySettings?.company_name || HO_DEFAULTS.LglNm, 100),
    TrdNm: sanitiseAddrPart(companySettings?.trade_name   || companySettings?.company_name || HO_DEFAULTS.TrdNm, 100),
    Addr1: sellerSplit.addr1,
    Addr2: sellerSplit.addr2 || undefined,
    // Loc must be the city (NIC validates against PIN), NOT the internal branch name
    Loc:   sanitiseAddrPart(branch?.city || branch?.name || '', 50),
    Pin:   sellerPin,
    Stcd:  sellerStcd,
  }

  // Buyer logic governed by NIC EWB rules (do NOT change without checking NIC docs):
  //  - INTERNAL (Branch → Hub): destBranch is the receiving hub; buyer = its GSTIN/address.
  //  - INWARD intra-state KA (KA branch → KA HO under same GSTIN): buyer = HO Bangalore.
  //  - OUTWARD interstate OWN_USE (e.g. KL branch → KA HO):
  //    NIC mandates "receiver GSTIN must equal supplier GSTIN" when SubSupplyType=OWN_USE.
  //    So buyer = seller (same GSTIN, same address). The actual physical movement
  //    happens to HO Bangalore but the EWB legally represents it as an intra-GSTIN move.
  //    NIC error 107 fires if you try to use a different buyer GSTIN.
  //    (To use a different buyer GSTIN, SubSupplyType would have to change to SUPPLY/B2B
  //    which triggers GST tax computation — not what we want for stock transfer.)
  const isInternal      = consignment?.movement_type === 'INTERNAL' && destBranch
  const isOwnUseOutward = supplyType === 'OUTWARD'
  let buyerDetails
  if (isInternal) {
    const destStateCode = getStateCodeFromRegion(destBranch?.region) || stateCode
    const destGstin     = resolveSellerGstin(destBranch, companySettings) || destBranch?.branch_gstin || sellerGstin
    const destSplit     = splitAddress(destBranch?.address || '')
    buyerDetails = {
      Gstin: destGstin,
      LglNm: sanitiseAddrPart(companySettings?.company_name || HO_DEFAULTS.LglNm, 100),
      TrdNm: sanitiseAddrPart(companySettings?.trade_name   || companySettings?.company_name || HO_DEFAULTS.TrdNm, 100),
      Addr1: destSplit.addr1,
      Addr2: destSplit.addr2 || undefined,
      Loc:   sanitiseAddrPart(destBranch?.city || destBranch?.name || '', 50),
      Pin:   normalizePin(destBranch?.pin_code),
      Stcd:  getStateCodeFromGstin(destGstin) || gstinNumForState(destStateCode),
    }
  } else if (isOwnUseOutward) {
    // NIC requires same GSTIN for OWN_USE OUTWARD — copy seller details as buyer
    buyerDetails = { ...sellerDetails }
  } else {
    // INWARD KA: buyer = HO Bangalore (HO and seller are the same KA GSTIN anyway)
    const hoGstin = companySettings?.gstin_ka || companySettings?.gstin || WG_GSTIN || HO_DEFAULTS.Gstin
    buyerDetails = {
      ...HO_DEFAULTS,
      Gstin: hoGstin,
    }
  }

  // Totals
  const totalGrossWt = parseFloat(
    (items.reduce((s, it) => s + parseFloat(it.gross_weight || 0), 0)).toFixed(2)
  )
  const rawAmt = parseFloat(
    (items.reduce((s, it) => s + parseFloat(it.total_amount || 0), 0)).toFixed(2)
  )

  // HSN + product name + uplift from company_settings (admin-editable)
  const productHsn  = companySettings?.hsn_code  || '71131910'
  const productName = companySettings?.product_name || 'Used Gold Ornaments and Gold Jewellery'
  const upliftPct   = parseFloat(companySettings?.value_uplift_pct ?? 7.5) || 0

  // Apply value uplift only for genuinely interstate movements (source state
  // != HO state) on EXTERNAL consignments. INTERNAL (Branch→Hub) is always
  // intrastate by enforcement. Keeps assessable value consistent across
  // Voucher/Challan, EWB, and E-Invoice documents.
  const isExternalInterstate = !isInternal && stateCode !== 'KA'
  const gstRate = parseFloat(companySettings?.igst_rate ?? 3) || 3
  const totalAss = isExternalInterstate
    ? parseFloat((rawAmt * (1 + upliftPct / 100)).toFixed(2))
    : rawAmt
  const igstAmt   = isExternalInterstate ? parseFloat((totalAss * gstRate / 100).toFixed(2)) : 0
  const totalInv  = parseFloat((totalAss + igstAmt).toFixed(2))

  const ItemList = [{
    ProdName:     productName,
    ProdDesc:     '',
    HsnCd:        productHsn,
    Qty:          totalGrossWt,
    Unit:         'GMS',
    AssAmt:       totalAss,
    CgstRt:       0, CgstAmt:      0,
    SgstRt:       0, SgstAmt:      0,
    IgstRt:       isExternalInterstate ? gstRate : 0,
    IgstAmt:      igstAmt,
    CesRt:        0, CesAmt:       0,
    OthChrg:      0,
    CesNonAdvAmt: 0,
  }]

  // Real distance estimate from PIN-prefix → city lookup + city-pair matrix.
  // Falls back to state-pair average, then 100km. NIC accepts ±10% deviation.
  const transDistance = estimateDistanceKm({
    fromPin:   sellerPin,
    toPin:     buyerDetails?.Pin,
    fromState: getStateCodeFromRegion(branch?.region) || stateCode,
    toState:   isInternal
      ? (getStateCodeFromRegion(destBranch?.region) || stateCode)
      : 'KA',
  })

  const payload = {
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
    // DispatchDtls = physical FROM location (the source branch).
    // ShipDtls = physical TO location:
    //  - INTERNAL (Branch → Hub): the hub's address
    //  - EXTERNAL Direct → HO: HO Bangalore physical address (even though BuyerDtls
    //    legally points back to seller's GSTIN per NIC OWN_USE rule).
    //  This way the EWB PDF shows the real Kerala → Bangalore movement under
    //  "Dispatch From" / "Ship To" while the legal BuyerDtls stays NIC-compliant.
    DispatchDtls:             sellerDetails,
    ShipDtls:                 isInternal
      ? buyerDetails  // hub already has its real address
      : { ...HO_DEFAULTS, Gstin: buyerDetails.Gstin },  // HO physical addr but seller's GSTIN
    ItemList,
    TotalAssessableAmount:    totalAss,
    TotalCgstAmount:          0,
    TotalSgstAmount:          0,
    TotalIgstAmount:          igstAmt,
    TotalCessAmount:          0,
    TotalCessNonAdvolAmount:  0,
    OtherAmount:              0,
    OtherTcsAmount:           0,
    TotalInvoiceAmount:       totalInv,
  }
  // Send distance under every plausible field name — ClearTax/NIC schema varies.
  // Extras are ignored by the API. One of these should be the right key.
  payload.TransDistance     = transDistance
  payload.transDistance     = transDistance
  payload.TransportDistance = transDistance
  payload.transportDistance = transDistance
  payload.Distance          = transDistance
  payload.distance          = transDistance
  return payload
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
export async function generateEWayBill({ consignment, branch, destBranch, items, companySettings, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) {
    throw new Error('ClearTax not configured: set CLEARTAX_URL and CLEARTAX_TOKEN env vars')
  }
  const payload = buildPayload({ consignment, branch, items, destBranch, companySettings })
  const sellerGstin = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN
  const gstin       = gstinOverride || sellerGstin
  if (!gstin) throw new Error('No GSTIN available for E-Way Bill request')

  console.log('[EWB] Outgoing payload:', JSON.stringify(payload, null, 2))

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
  console.log('[EWB] ClearTax response status:', res.status, 'body:', JSON.stringify(data, null, 2))

  if (!res.ok || data?.govt_response?.Success !== 'Y') {
    const msg = extractClearTaxMessage(data, 'E-Way Bill generation failed')
    const err = new Error(msg)
    err.cleartaxResponse = data
    err.outgoingPayload  = payload
    throw err
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
  const HO_DEFAULTS  = resolveHoDefaults(companySettings)
  const stateCode    = getStateCodeFromRegion(branch?.region) || 'KA'
  const sellerGstin  = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN || ''
  const sellerStcd   = getStateCodeFromGstin(sellerGstin) || gstinNumForState(stateCode)
  const sellerPin    = normalizePin(branch?.pin_code)

  // Buyer = HO Karnataka. For E-Invoice the buyer GSTIN must differ from seller GSTIN
  // (B2B requirement); seller is now correctly resolved per-state.
  const buyerGstin = companySettings?.gstin_ka || companySettings?.gstin || WG_GSTIN || sellerGstin
  const buyerStcd  = getStateCodeFromGstin(buyerGstin) || HO_DEFAULTS.Stcd

  const totalGrossWt = parseFloat((items.reduce((s, it) => s + parseFloat(it.gross_weight || 0), 0)).toFixed(3))
  const rawAmt       = parseFloat((items.reduce((s, it) => s + parseFloat(it.total_amount || 0), 0)).toFixed(2))

  // Tax rate + uplift from company_settings (admin-editable).
  const gstRate      = parseFloat(companySettings?.igst_rate ?? 3) || 3
  const upliftPct    = parseFloat(companySettings?.value_uplift_pct ?? 7.5) || 0
  const productHsn   = companySettings?.hsn_code  || '71131910'
  const productName  = companySettings?.product_name || 'Used Gold Ornaments and Gold Jewellery'

  // Interstate iff source state != HO state. INTERNAL (Branch→Hub) never reaches
  // E-Invoice generation (uses Issue Voucher only) — but if we ever change that,
  // INTERNAL is also intrastate by enforcement.
  const buyerStcd0   = HO_DEFAULTS.Stcd
  const isInternal   = consignment?.movement_type === 'INTERNAL'
  const isInterstate = !isInternal && sellerStcd !== buyerStcd0

  // Apply value uplift only for interstate. Same uplifted figure goes through
  // to the consignee report so both documents agree on goods value.
  const totalAss = isInterstate
    ? parseFloat((rawAmt * (1 + upliftPct / 100)).toFixed(2))
    : rawAmt

  const igstAmt = isInterstate ? parseFloat((totalAss * gstRate / 100).toFixed(2))   : 0
  const cgstAmt = isInterstate ? 0 : parseFloat((totalAss * gstRate / 200).toFixed(2))
  const sgstAmt = isInterstate ? 0 : parseFloat((totalAss * gstRate / 200).toFixed(2))
  const totalInv = parseFloat((totalAss + igstAmt + cgstAmt + sgstAmt).toFixed(2))

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
    SellerDtls: (() => {
      const split = splitAddress(branch?.address || '')
      return {
        Gstin: sellerGstin,
        LglNm: sanitiseAddrPart(companySettings?.company_name || 'White Gold Bullion pvt ltd', 100),
        TrdNm: sanitiseAddrPart(companySettings?.company_name || 'White Gold Money', 100),
        Addr1: split.addr1,
        Addr2: split.addr2 || undefined,
        Loc:   sanitiseAddrPart(branch?.city || branch?.name || '', 50),
        Pin:   sellerPin,
        Stcd:  sellerStcd,
        Ph:    branch?.contact_phone || '9999999999',
        Em:    'noreply@whitegold.money',
      }
    })(),
    BuyerDtls: {
      Gstin: buyerGstin,
      LglNm: sanitiseAddrPart(companySettings?.company_name || HO_DEFAULTS.LglNm, 100),
      TrdNm: sanitiseAddrPart(companySettings?.company_name || HO_DEFAULTS.TrdNm, 100),
      Pos:   buyerStcd,
      Addr1: sanitiseAddrPart(HO_DEFAULTS.Addr1, 100),
      Addr2: sanitiseAddrPart(HO_DEFAULTS.Addr2, 100) || undefined,
      Loc:   sanitiseAddrPart(HO_DEFAULTS.Loc, 50),
      Pin:   HO_DEFAULTS.Pin,
      Stcd:  buyerStcd,
      Ph:    '9999999999',
      Em:    'noreply@whitegold.money',
    },
    ItemList: [{
      SlNo:        '1',
      PrdDesc:     productName,
      IsServc:     'N',
      HsnCd:       productHsn,
      Qty:         totalGrossWt,
      Unit:        'GMS',
      UnitPrice:   totalGrossWt > 0 ? parseFloat((totalAss / totalGrossWt).toFixed(2)) : 0,
      TotAmt:      totalAss,
      Discount:    0,
      AssAmt:      totalAss,
      GstRt:       gstRate,
      IgstAmt:     igstAmt,
      CgstAmt:     cgstAmt,
      SgstAmt:     sgstAmt,
      CesRt:       0,
      CesAmt:      0,
      CesNonAdvlAmt: 0,
      StateCesRt:    0,
      StateCesAmt:   0,
      StateCesNonAdvlAmt: 0,
      OthChrg:     0,
      TotItemVal:  totalInv,
    }],
    ValDtls: {
      AssVal:        totalAss,
      CgstVal:       cgstAmt,
      SgstVal:       sgstAmt,
      IgstVal:       igstAmt,
      CesVal:        0,
      StCesVal:      0,
      Discount:      0,
      OthChrg:       0,
      RndOffAmt:     0,
      TotInvVal:     totalInv,
    },
  }
  return stripEmpty(raw)
}

export async function generateEInvoice({ consignment, branch, items, companySettings, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured: set CLEARTAX_URL and CLEARTAX_TOKEN env vars')
  const transaction = buildEInvoicePayload({ consignment, branch, items, companySettings })
  const sellerGstin = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN
  const gstin       = gstinOverride || sellerGstin
  if (!gstin) throw new Error('No GSTIN available for E-Invoice request')

  // ClearTax expects an ARRAY of { transaction, custom_fields } objects per spec.
  // See: https://docs.cleartax.in/cleartax-docs/e-invoicing-api/.../generate-irn
  const payload = [{
    transaction,
    custom_fields: {
      tmp_prf_no: consignment?.tmp_prf_no || '',
      challan_no: consignment?.challan_no || '',
    },
  }]

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

  // Response is also an array — first element holds the result for our single transaction.
  const first = Array.isArray(data) ? data[0] : data
  const govtResponse  = first?.govt_response
  const documentStatus = first?.document_status

  if (!res.ok || govtResponse?.Success === 'N' || documentStatus === 'NOT_CREATED') {
    const msg = extractClearTaxMessage(first || data, 'E-Invoice generation failed')
    const err = new Error(msg)
    err.cleartaxResponse = data
    err.outgoingPayload  = payload
    throw err
  }
  return first || data
}

// Fetch the printable E-Invoice PDF from ClearTax for a given IRN.
// Mirrors fetchEWayBillPdf — POST with body { irns: [...], print_type: 'DETAILED' }.
export async function fetchEInvoicePdf({ irn, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  if (!irn) throw new Error('IRN required to fetch E-Invoice PDF')
  const gstin = gstinOverride || WG_GSTIN

  // ClearTax E-Invoice print endpoint mirrors the EWB one. Try the well-known
  // POST shape first; fall back to alternatives if the format varies.
  const attempts = [
    {
      url: `${CLEARTAX_URL}/einv/v2/eInvoice/print?format=PDF`,
      method: 'POST',
      body: { irns: [irn], print_type: 'DETAILED' },
    },
    {
      url: `${CLEARTAX_URL}/einv/v2/eInvoice/print?format=PDF`,
      method: 'POST',
      body: { irn_list: [irn], print_type: 'DETAILED' },
    },
    {
      url: `${CLEARTAX_URL}/einv/v2/eInvoice/get?irn=${encodeURIComponent(irn)}`,
      method: 'GET',
    },
  ]

  let lastErr = null
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: a.method,
        headers: {
          'Content-Type':          'application/json',
          'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
          'gstin':                 gstin,
          'Accept':                'application/pdf, application/json',
        },
        body: a.body ? JSON.stringify(a.body) : undefined,
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        lastErr = `${a.method} ${a.url} → ${res.status} ${txt.slice(0, 200)}`
        continue
      }
      const ctype = res.headers.get('content-type') || ''
      if (ctype.includes('pdf') || ctype.includes('octet-stream')) {
        return Buffer.from(await res.arrayBuffer())
      }
      // JSON wrapper with base64 PDF
      const j = await res.json().catch(() => null)
      const b64 = j?.pdf || j?.data?.pdf || j?.data || j?.base64 || j?.invoice
      if (b64 && typeof b64 === 'string') {
        try { return Buffer.from(b64, 'base64') } catch {}
      }
      lastErr = `${a.method} ${a.url} → unexpected response (${ctype})`
    } catch (err) {
      lastErr = `${a.method} ${a.url} → ${err.message}`
    }
  }
  throw new Error(`E-Invoice PDF fetch failed: ${lastErr}`)
}

export async function cancelEInvoice({ irn, reasonCode = '1', remark = 'Duplicate', gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  const gstin = gstinOverride || WG_GSTIN
  const url = `${CLEARTAX_URL}/einv/v2/eInvoice/cancel`
  const headers = {
    'Content-Type':          'application/json',
    'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
    'gstin':                 gstin,
  }
  // Mirror generate: array of { transaction }, try PUT first, fall back to POST on 405.
  const payload = [{ transaction: { Irn: irn, CnlRsn: reasonCode, CnlRem: remark } }]
  let res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) })
  if (res.status === 405) {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  }
  // Some tenants accept the flat (non-array) shape — final fallback.
  if (res.status === 400 || res.status === 415) {
    res = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ Irn: irn, CnlRsn: reasonCode, CnlRem: remark }),
    })
  }
  const data = await res.json().catch(() => ({}))
  console.log('[E-Invoice cancel] status:', res.status, 'body:', JSON.stringify(data))
  const first = Array.isArray(data) ? data[0] : data
  if (!res.ok || first?.govt_response?.Success === 'N' || first?.document_status === 'NOT_CREATED') {
    throw new Error(extractClearTaxMessage(first || data, 'Failed to cancel E-Invoice'))
  }
  return first || data
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
