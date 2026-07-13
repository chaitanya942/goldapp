// lib/clearTaxClient.js
// ClearTax GSP integration for E-Way Bill generation, PDF retrieval, and cancellation.
// Port of the NestJS ClearTaxService from the WG backend, adapted for goldapp.

import { estimateDistanceKm } from './distanceCalc'
import { REGION_TO_STATE_CODE, STATE_TO_GSTIN_NUM } from './stateMap'
import { computeConsignmentTotals } from './consignmentTotals'

// ── Unique DocumentNumber for NIC / IRP ─────────────────────────────────────
// NIC dedupes EWBs by (GSTIN, DocumentNumber). Sending the bare TMP_PRF as the
// reference means: wipe the DB (test reset), recreate with the same TMP_PRF,
// and NIC silently returns the OLD EWB instead of generating a new one (the
// 2026-05-07 incident — 4-day-stale EWB returned for a recycled WG000001).
//
// Fix: append a 6-char fingerprint from consignment.id (UUID) so each
// consignment row has a unique reference even if the TMP_PRF gets reused.
// New consignment row → new UUID → different DocumentNumber → no collision.
//
// Format: '<TMP_PRF>-<6-char-uuid-prefix>'  →  'WG000001-A1B2C3'  (15 chars)
// ClearTax/NIC accept up to 16 chars alphanumeric + '-' + '/'. Our format
// stays well within that. The TMP_PRF is still printed on every PDF for
// human reference; this fingerprint is purely the NIC-side identifier.
function buildNicDocRef(consignment) {
  const tmp   = String(consignment?.tmp_prf_no  || '').slice(0, 8)
  const idHex = String(consignment?.id          || '').replace(/-/g, '').slice(0, 6).toUpperCase()
  if (tmp && idHex) return `${tmp}-${idHex}`.slice(0, 16)
  // Fallbacks if either piece is missing — keeps the old behaviour rather
  // than failing closed.
  return String(consignment?.tmp_prf_no || consignment?.challan_no || '').slice(0, 16)
}

// DD/MM/YYYY in IST — ClearTax expects this format for DocumentDate.
// Uses Intl.DateTimeFormat so we don't double-shift if the host is already IST.
function formatDocumentDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year:  'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t) => parts.find(p => p.type === t)?.value
  return `${get('day')}/${get('month')}/${get('year')}`
}

const CLEARTAX_URL = process.env.CLEARTAX_URL
const CLEARTAX_TOKEN = process.env.CLEARTAX_TOKEN
const WG_GSTIN = process.env.WG_GSTIN  // HO Bangalore GSTIN — fallback when buyer GSTIN not derivable
// 60s default — NIC/IRP routinely takes 25-45s during business hours.
// The previous 20s default was triggering false-positive timeouts while the
// EWB / IRN was actually being processed successfully on NIC's books, which
// led to ghost-duplicate retries and "already in progress" lockouts.
// Override via Railway env if NIC is being consistently slow.
const CTAX_TIMEOUT_MS = Number(process.env.CLEARTAX_TIMEOUT_MS) || 60000
const CTAX_DEBUG = process.env.CLEARTAX_DEBUG === '1' || process.env.NODE_ENV !== 'production'

// ── Logging helpers ──────────────────────────────────────────────────────────
// GSTIN is 15 chars: 2-digit state + 10 PAN + 1 entity + 1 'Z' + 1 checksum.
// Mask the PAN portion: keep state + last 3.
function redactGstin(g) {
  if (!g || typeof g !== 'string' || g.length < 15) return g
  return g.slice(0, 2) + 'XXXXXXXXXX' + g.slice(12)
}
function redactObj(input, depth = 0) {
  if (depth > 6 || input == null) return input
  if (Array.isArray(input)) return input.map(v => redactObj(v, depth + 1))
  if (typeof input === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(input)) {
      const lk = k.toLowerCase()
      if (lk === 'x-cleartax-auth-token' || lk === 'authorization') { out[k] = '[REDACTED]'; continue }
      if (lk === 'gstin') { out[k] = redactGstin(v); continue }
      if (lk === 'irn' || lk === 'ewbno' || lk === 'eway_bill_no' || lk === 'acknowno') {
        out[k] = typeof v === 'string' ? `…${v.slice(-6)}` : v
        continue
      }
      if (lk === 'ph' || lk === 'phone' || lk === 'em' || lk === 'email') { out[k] = '[REDACTED]'; continue }
      out[k] = redactObj(v, depth + 1)
    }
    return out
  }
  return input
}
function ctaxLog(label, obj) {
  if (!CTAX_DEBUG) return
  try { console.log(`[ClearTax] ${label}:`, JSON.stringify(redactObj(obj))) }
  catch { console.log(`[ClearTax] ${label}: <unserialisable>`) }
}

// fetch wrapper: adds AbortSignal.timeout + structured logging.
// Returns a normal Response; throws AbortError on timeout.
async function ctaxFetch(url, opts = {}) {
  const t0 = Date.now()
  const method = opts.method || 'GET'
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(CTAX_TIMEOUT_MS) })
    if (CTAX_DEBUG) console.log(`[ClearTax] ${method} ${url.replace(CLEARTAX_URL || '', '')} → ${res.status} (${Date.now() - t0}ms)`)
    return res
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`ClearTax timeout after ${CTAX_TIMEOUT_MS}ms: ${method} ${url}`)
    }
    throw err
  }
}

// Attach debug data to thrown errors as NON-ENUMERABLE — won't leak via JSON.stringify(err)
// or naive res.json({ err }). Routes can still read err.cleartaxResponse explicitly when
// gating debug payloads behind a role check.
function attachDebug(err, { cleartaxResponse, outgoingPayload }) {
  if (cleartaxResponse !== undefined) {
    Object.defineProperty(err, 'cleartaxResponse', { value: cleartaxResponse, enumerable: false, writable: true })
  }
  if (outgoingPayload !== undefined) {
    Object.defineProperty(err, 'outgoingPayload', { value: outgoingPayload, enumerable: false, writable: true })
  }
  return err
}

// Case-insensitive Success-flag check. NIC sometimes returns 'Y'/'N', sometimes
// 'y'/'n', occasionally numeric '1'.
function isGovtSuccess(govtResponse) {
  const v = String(govtResponse?.Success ?? '').trim().toUpperCase()
  return v === 'Y' || v === '1' || v === 'TRUE'
}

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

// Split an address into Addr1 + Addr2 (each ≤100 chars). Prefer breaking at the
// last comma in the first 100 chars; if none, the last space; if neither (rare —
// no whitespace in 100 chars), hard-truncate. Avoids mid-word truncation that
// looked unprofessional on EWBs from branches with long apartment names.
function splitAddress(raw, max = 100) {
  const cleaned = String(raw || '').replace(/[^A-Za-z0-9 .,\-/()]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return { addr1: cleaned, addr2: '' }
  let cut = cleaned.slice(0, max)
  const lastComma = cut.lastIndexOf(',')
  if (lastComma > 0) cut = cleaned.slice(0, lastComma)
  else {
    const lastSpace = cut.lastIndexOf(' ')
    if (lastSpace > 0) cut = cleaned.slice(0, lastSpace)
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
  const code = STATE_TO_GSTIN_NUM[stateCode]
  if (!code) {
    // Don't silently default to KA (29) — that would stamp the wrong GSTIN-prefix
    // on a non-KA invoice. Caller must handle unknown states (e.g. fall back to
    // an explicit branch GSTIN, or fail loudly).
    return null
  }
  return code
}

function normalizePin(pin) {
  if (!pin) return undefined
  const n = Number(pin)
  return Number.isNaN(n) ? undefined : n
}

// ── Build EWB-01 payload from consignment + branch + items ──────────────────
// Exported so /api/eway-bill/preview can show accounts the EXACT payload that
// would be sent to NIC, without firing the API. Matching this preview to the
// challan/voucher/consignment values is the whole point — no more "wrong doc
// generated, then cancel" cycles.
export function buildPayload({ consignment, branch, items, destBranch, companySettings }) {
  // HO defaults resolved from company_settings (admin-editable). Used for any
  // EXTERNAL Direct→HO / Hub→HO consignment.
  const HO_DEFAULTS  = resolveHoDefaults(companySettings)
  const stateCode    = getStateCodeFromRegion(branch?.region) || 'KA'
  const isKa         = stateCode === 'KA'
  const supplyType   = isKa ? 'INWARD' : 'OUTWARD'
  // GSTIN resolution order:
  //   1. Consignment snapshot (source_gstin) — frozen at creation time
  //   2. company_settings state-wise GSTIN — current value
  //   3. branch.branch_gstin (legacy per-branch override)
  //   4. env var
  // The snapshot wins so a later edit to company_settings or branch row can't
  // re-stamp an EWB/E-Invoice generated against a previously-created consignment.
  const sellerGstin  = consignment?.source_gstin
                    || resolveSellerGstin(branch, companySettings)
                    || branch?.branch_gstin
                    || WG_GSTIN
                    || ''
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
    const destGstin     = consignment?.dest_gstin
                       || resolveSellerGstin(destBranch, companySettings)
                       || destBranch?.branch_gstin
                       || sellerGstin
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

  // Totals via the canonical calculator in lib/consignmentTotals.js — the
  // same helper feeds the Issue Voucher / Delivery Challan / Consignee Report
  // PDFs so all five documents agree by construction (no more cross-doc
  // drift; the audit endpoint is now a tripwire, not the only line of defence).
  const T = computeConsignmentTotals({ consignment, items, companySettings: companySettings || {} })
  const totalGrossWt        = T.totalGrossWt
  const rawAmt              = T.rawValue
  const upliftPct           = T.upliftPct
  const isExternalInterstate = T.isExternalInterstate
  const gstRate             = T.gstRate
  const totalAss            = T.assessableValue
  const igstAmt             = T.igstAmt
  const totalInv            = T.grandTotal

  // HSN + product name from company_settings (admin-editable)
  const productHsn  = companySettings?.hsn_code  || '71131910'
  const productName = companySettings?.product_name || 'Used Gold Ornaments and Gold Jewellery'

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
    // Unique-per-row reference for NIC. Combines TMP_PRF (display name) with
    // a 6-char UUID fingerprint so reusing TMP_PRF after a DB reset doesn't
    // collide with stale EWBs already on NIC's books. See buildNicDocRef
    // header comment for the 2026-05-07 incident that motivated this.
    DocumentNumber:           buildNicDocRef(consignment),
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
    TransDistance:            transDistance,
  }
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
    const rawDetails = c.ErrorDetails || c.errorDetails
    // Normalize errorDetails -> array. ClearTax returns either an array
    // (NIC's preferred shape) or a single object (their own validator).
    const details = rawDetails == null ? null
      : Array.isArray(rawDetails) ? rawDetails
      : (typeof rawDetails === 'object' ? [rawDetails] : null)
    if (details && details.length) {
      const msg = details
        .map(d => [d?.error_message, d?.errorMessage, d?.message, d?.error_code ? `(${d.error_code})` : null].filter(Boolean).join(' '))
        .filter(Boolean).join(', ')
      if (msg) return msg
    }
    const direct = [c.message, c.error_message, c.errorMessage, c.ErrorMessage, c.status_desc, c.info, c.remarks]
      .find(v => typeof v === 'string' && v.trim().length)
    if (direct) return direct
  }
  return fallback
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

  ctaxLog('EWB → outgoing', payload)

  const res = await ctaxFetch(`${CLEARTAX_URL}/einv/v3/ewaybill/generate`, {
    method: 'PUT',
    headers: {
      'Content-Type':         'application/json',
      'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
      'gstin':                 gstin,
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  ctaxLog(`EWB ← ${res.status}`, data)

  if (!res.ok || !isGovtSuccess(data?.govt_response)) {
    const msg = extractClearTaxMessage(data, 'E-Way Bill generation failed')
    throw attachDebug(new Error(msg), { cleartaxResponse: data, outgoingPayload: payload })
  }
  return data
}

export async function fetchEWayBillPdf({ ewbNumbers, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  const gstin = gstinOverride || WG_GSTIN
  const res = await ctaxFetch(`${CLEARTAX_URL}/einv/v2/eInvoice/ewaybill/print?format=PDF`, {
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
// Exported for /api/e-invoice/preview — same rationale as buildPayload above.
export function buildEInvoicePayload({ consignment, branch, items, companySettings, docNoOverride }) {
  const HO_DEFAULTS  = resolveHoDefaults(companySettings)
  const stateCode    = getStateCodeFromRegion(branch?.region) || 'KA'
  // Snapshot-first GSTIN resolution — see buildPayload for rationale.
  const sellerGstin  = consignment?.source_gstin
                    || resolveSellerGstin(branch, companySettings)
                    || branch?.branch_gstin
                    || WG_GSTIN
                    || ''
  const sellerStcd   = getStateCodeFromGstin(sellerGstin) || gstinNumForState(stateCode)
  const sellerPin    = normalizePin(branch?.pin_code)

  // Buyer = HO Karnataka. For E-Invoice the buyer GSTIN must differ from seller GSTIN
  // (B2B requirement); seller is now correctly resolved per-state.
  const buyerGstin = companySettings?.gstin_ka || companySettings?.gstin || WG_GSTIN || sellerGstin
  const buyerStcd  = getStateCodeFromGstin(buyerGstin) || HO_DEFAULTS.Stcd

  // Totals via the canonical calculator — same helper used by buildPayload
  // (EWB) and the Issue Voucher / Delivery Challan / Consignee Report PDFs.
  // Five docs, one math.
  const T = computeConsignmentTotals({ consignment, items, companySettings: companySettings || {} })
  const totalGrossWt = T.totalGrossWt
  const rawAmt       = T.rawValue
  const upliftPct    = T.upliftPct
  const gstRate      = T.gstRate
  const isInterstate = T.isExternalInterstate
  const totalAss     = T.assessableValue
  const igstAmt      = T.igstAmt

  const productHsn   = companySettings?.hsn_code  || '71131910'
  const productName  = companySettings?.product_name || 'Used Gold Ornaments and Gold Jewellery'

  // Intrastate splits CGST/SGST half-and-half off the assessable value.
  // (Computed locally — not part of the shared calculator since CGST/SGST
  // only matter for the IRP payload, not for the EWB or PDF docs.)
  const cgstAmt = isInterstate ? 0 : parseFloat((totalAss * gstRate / 200).toFixed(2))
  const sgstAmt = isInterstate ? 0 : parseFloat((totalAss * gstRate / 200).toFixed(2))
  const totalInv = parseFloat((totalAss + igstAmt + cgstAmt + sgstAmt).toFixed(2))

  // E-Invoice DocNo: per-state, per-FY sequence — 'WG/{STATE}/{FY}/{SEQ}'.
  // Allocated by app/api/e-invoice/generate via nextEInvoiceDocNo() before
  // this function runs and passed in as docNoOverride. Falls back to the
  // existing UUID-fingerprinted reference for preview / credit-note paths
  // that haven't allocated a sequence yet (preview shouldn't burn numbers;
  // credit notes carry their OWN doc number, generated separately below).
  const docNo   = consignment?.einvoice_doc_no || docNoOverride || buildNicDocRef(consignment)
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
    // Delivery-note reference on the e-invoice. Accounts asked that the
    // printed "Reference No." come from the delivery challan number rather
    // than our internal TMP_PRF counter — RefDtls.ContrDtls.OthRefr is the
    // IRP slot meant for "other reference number" (generic doc ref) and
    // surfaces on the GSTN-issued invoice document.
    ...(consignment?.challan_no ? {
      RefDtls: {
        ContrDtls: [{ OthRefr: String(consignment.challan_no).slice(0, 20) }],
      },
    } : {}),
  }
  return stripEmpty(raw)
}

export async function generateEInvoice({ consignment, branch, items, companySettings, gstinOverride, docNoOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured: set CLEARTAX_URL and CLEARTAX_TOKEN env vars')
  const transaction = buildEInvoicePayload({ consignment, branch, items, companySettings, docNoOverride })
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

  ctaxLog('E-Invoice → outgoing', payload)

  const url = `${CLEARTAX_URL}/einv/v2/eInvoice/generate`
  const headers = {
    'Content-Type':          'application/json',
    'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
    'gstin':                 gstin,
  }
  let res = await ctaxFetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) })
  if (res.status === 405) {
    res = await ctaxFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  }
  const data = await res.json().catch(() => ({}))
  ctaxLog(`E-Invoice ← ${res.status}`, data)

  // Response is also an array — first element holds the result for our single transaction.
  const first = Array.isArray(data) ? data[0] : data
  const documentStatus = first?.document_status

  if (!res.ok || !isGovtSuccess(first?.govt_response) || documentStatus === 'NOT_CREATED') {
    const msg = extractClearTaxMessage(first || data, 'E-Invoice generation failed')
    throw attachDebug(new Error(msg), { cleartaxResponse: data, outgoingPayload: payload })
  }
  return first || data
}

// ─────────────────────────────────────────────────────────────────────────────
// generateCreditNote — for E-Invoices past the 24-hour cancel window.
//
// IRP allows cancellation only within 24 hours of IRN generation. After that,
// to nullify a wrongly-issued invoice, GST law requires issuing a Credit Note
// (Typ: 'CRN') referencing the original IRN. Both documents end up in GSTR-1,
// netting to zero tax liability.
//
// The Credit Note shape mirrors the original invoice but with:
//   - DocDtls.Typ = 'CRN' (instead of 'INV')
//   - DocDtls.No  = a NEW unique number (e.g. CN-{tmp_prf_no})
//   - RefDtls.InvRm = remark explaining the reversal
//   - RefDtls.PrecDocDtls = reference to the original invoice number/date
// All other fields (seller, buyer, items, totals) are identical to the original
// so the credit note is a perfect mirror that nullifies it.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateCreditNote({ originalConsignment, branch, items, companySettings, remark, gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured: set CLEARTAX_URL and CLEARTAX_TOKEN env vars')
  if (!originalConsignment?.irn) throw new Error('Original IRN missing — credit note must reference an existing IRN')

  // Build the same payload shape as a regular invoice, then mutate to CRN.
  // base.DocDtls.No / Dt at this point are TODAY's date — that's correct for
  // the credit note's OWN document date (today is when we're issuing the CN).
  // For the PrecDocDtls reference to the ORIGINAL invoice, we need the original
  // doc number AND the original doc date, NOT today's.
  const base = buildEInvoicePayload({ consignment: originalConsignment, branch, items, companySettings })

  // Original invoice number — what was sent as DocDtls.No when the IRN was first generated.
  // Must match the issued DocNo exactly so IRP can find the precedent doc.
  // Newer rows (post sql/einvoice_sequence.sql) carry the per-state DocNo on
  // einvoice_doc_no. Legacy rows (pre-migration) fall back to buildNicDocRef.
  const originalDocNo = originalConsignment.einvoice_doc_no || buildNicDocRef(originalConsignment)

  // Original invoice DATE — must be in DD/MM/YYYY format per IRP.
  // Best source: einvoice_generated_at (TIMESTAMPTZ) → reformat to DD/MM/YYYY in IST.
  // Fall back to ack_dt parsing if einvoice_generated_at not present (legacy rows).
  let originalDocDate = null
  if (originalConsignment.einvoice_generated_at) {
    originalDocDate = formatDocumentDate(new Date(originalConsignment.einvoice_generated_at))
  } else if (originalConsignment.ack_dt) {
    // ack_dt from IRP is typically "YYYY-MM-DD HH:MM:SS" — convert to DD/MM/YYYY.
    const m = String(originalConsignment.ack_dt).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) originalDocDate = `${m[3]}/${m[2]}/${m[1]}`
  }
  if (!originalDocDate) {
    throw new Error('Cannot determine original invoice date — credit note requires einvoice_generated_at or ack_dt on the consignment')
  }

  // CN doc number must be unique. Prefixing CN- gives us the natural pair.
  base.DocDtls = {
    ...base.DocDtls,
    Typ: 'CRN',
    No:  `CN-${originalDocNo}`.slice(0, 16),  // IRP limits No to 16 chars
    // base.DocDtls.Dt stays as today's date (the CN's own issue date — correct).
  }
  // RefDtls links this CN to the original invoice on the GSTN portal.
  base.RefDtls = {
    InvRm: (remark || 'Reversal of wrongly-issued invoice').slice(0, 100),
    PrecDocDtls: [{
      InvNo:  originalDocNo,
      InvDt:  originalDocDate,
    }],
  }

  const sellerGstin = resolveSellerGstin(branch, companySettings) || branch?.branch_gstin || WG_GSTIN
  const gstin       = gstinOverride || originalConsignment?.source_gstin || sellerGstin
  if (!gstin) throw new Error('No GSTIN available for Credit Note request')

  const payload = [{
    transaction: base,
    custom_fields: {
      tmp_prf_no:    originalConsignment?.tmp_prf_no || '',
      original_irn:  originalConsignment.irn,
      doc_type:      'credit_note',
    },
  }]

  ctaxLog('Credit Note → outgoing', payload)

  const url = `${CLEARTAX_URL}/einv/v2/eInvoice/generate`
  const headers = {
    'Content-Type':          'application/json',
    'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
    'gstin':                 gstin,
  }
  let res = await ctaxFetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) })
  if (res.status === 405) {
    res = await ctaxFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  }
  const data = await res.json().catch(() => ({}))
  ctaxLog(`Credit Note ← ${res.status}`, data)

  const first = Array.isArray(data) ? data[0] : data
  if (!res.ok || !isGovtSuccess(first?.govt_response) || first?.document_status === 'NOT_CREATED') {
    const msg = extractClearTaxMessage(first || data, 'Credit Note generation failed')
    throw attachDebug(new Error(msg), { cleartaxResponse: data, outgoingPayload: payload })
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
      const res = await ctaxFetch(a.url, {
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

// NIC IRP cancellation reason codes: 1=Duplicate, 2=Data Entry Mistake,
// 3=Order Cancelled, 4=Others. Caller must supply a valid one.
const VALID_IRP_CANCEL_REASONS = new Set(['1', '2', '3', '4'])
// NIC EWB cancellation reason codes: 1=Duplicate, 2=Order Cancelled,
// 3=Data Entry Mistake, 4=Others.
const VALID_EWB_CANCEL_REASONS = new Set(['1', '2', '3', '4'])

// True if the response failed because of a SHAPE/SCHEMA problem on either
// ClearTax (4xx) or NIC IRP (error code 102 = invalid request, 107 =
// required field missing — both indicate the payload envelope reached NIC
// in the wrong form). We retry with a different shape in that case. Any
// other failure (already-cancelled, IRN out of 24h window, etc.) is
// terminal — never retry.
//
// Walks the entire response body looking for ErrorDetails arrays. ClearTax
// has at least three common envelope shapes for the same NIC error:
//   { govt_response: { ErrorDetails: [...] } }                  // wrapped
//   [{ govt_response: { ErrorDetails: [...] } }]                // array-wrapped
//   { ErrorDetails: [...] }                                     // flat
//   { data: { govt_response: { ErrorDetails: [...] } } }        // double-wrapped
// Just look everywhere.
function findErrorCodes(input, found = []) {
  if (!input || typeof input !== 'object') return found
  if (Array.isArray(input)) {
    for (const v of input) findErrorCodes(v, found)
    return found
  }
  for (const [k, v] of Object.entries(input)) {
    const lk = k.toLowerCase()
    if (lk === 'errordetails') {
      // ClearTax returns errorDetails as EITHER an array (NIC's preferred
      // shape) OR a single object (ClearTax's own pre-NIC validation
      // rejection). Normalize to array so the same extraction works.
      const arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : [])
      for (const e of arr) {
        const code = String(e?.error_code || e?.errorCode || e?.ErrorCode || '').trim()
        if (code) found.push(code)
      }
    } else if (typeof v === 'object') {
      findErrorCodes(v, found)
    }
  }
  return found
}
function isShapeError(httpStatus, body) {
  if (httpStatus === 405 || httpStatus === 415 || httpStatus === 400) return true
  const codes = findErrorCodes(body)
  return codes.includes('102') || codes.includes('107')
}

// "IRN not active at IRP" detector — fires when the cancel endpoint replies
// with code 107 ("Valid Irn number is missing in the request") AFTER we've
// already exhausted shape retries. Real-world cause: the IRN was either
// (a) already cancelled at IRP — a prior retry succeeded at NIC but our
//     downstream pipeline errored before persisting the cancellation, OR
// (b) never persisted at NIC in the first place (e.g. sandbox cleanup, or
//     the generate response we trusted didn't actually register an IRN).
//
// In both cases the user's intent — void the consignment — is unreachable
// via the cancel API and the IRN/EWB on file in our DB is stale. Callers
// can treat this as a soft success and proceed with local cleanup; the
// audit log will record the discrepancy.
function isIrnGoneAtIrp(body) {
  if (!body || typeof body !== 'object') return false
  const codes = findErrorCodes(body)
  if (!codes.includes('107')) return false
  // ClearTax also returns 107 for their OWN pre-NIC validation rejections
  // (e.g. payload shape issues) with error_source='CLEARTAX'. Only treat
  // 107 as "EWB / IRN actually gone at NIC" when the error originated at
  // NIC — otherwise we'd let a shape-broken request masquerade as a
  // soft-success and silently clear local state while NIC still has the
  // document active. error_source 'NIC' / 'GOVT' / 'GSP' are valid;
  // missing source counts as NIC since older responses didn't include it.
  const sources = findErrorSources(body)
  if (!sources.length) return true
  return sources.some(s => {
    const u = String(s).toUpperCase()
    return u !== 'CLEARTAX' && u !== 'CT' && u !== 'CLIENT'
  })
}

// Mirror findErrorCodes but for error_source / errorSource (whatever
// case ClearTax shipped). Same array-or-object normalization.
function findErrorSources(input, found = []) {
  if (!input || typeof input !== 'object') return found
  if (Array.isArray(input)) {
    for (const v of input) findErrorSources(v, found)
    return found
  }
  for (const [k, v] of Object.entries(input)) {
    const lk = k.toLowerCase()
    if (lk === 'errordetails') {
      const arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : [])
      for (const e of arr) {
        const src = e?.error_source || e?.errorSource || e?.ErrorSource
        if (src) found.push(src)
      }
    } else if (typeof v === 'object') {
      findErrorSources(v, found)
    }
  }
  return found
}

export async function cancelEInvoice({ irn, reasonCode = '1', remark = 'Duplicate', gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  if (!gstinOverride) throw new Error('cancelEInvoice: gstinOverride is required (must match the GSTIN that issued the IRN)')
  const reason = String(reasonCode)
  if (!VALID_IRP_CANCEL_REASONS.has(reason)) {
    throw new Error(`Invalid IRP cancel reason '${reasonCode}'. Use 1=Duplicate, 2=Data Entry Mistake, 3=Order Cancelled, 4=Others`)
  }
  const url = `${CLEARTAX_URL}/einv/v2/eInvoice/cancel`
  const headers = {
    'Content-Type':          'application/json',
    'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
    'gstin':                 gstinOverride,
  }

  // ClearTax's IRP cancel endpoint has shipped multiple accepted shapes over
  // time. WG000024 (Jun 2026) surfaced that the array+`transaction` envelope
  // — which mirrors generate — gets ClearTax-side validated against the
  // GENERATE schema (which expects a full E-Invoice doc, not just Irn/CnlRsn/
  // CnlRem), producing a confusing "Irn missing" error with error_source=
  // CLEARTAX and a `transaction: null` echo. The fix is to use the native
  // NIC-flat shape but with PUT (ClearTax 405s POST on this endpoint).
  //
  // Order, from "most likely today" to "documented legacy":
  //   1. Flat PUT            : { Irn, CnlRsn, CnlRem }                              // current ClearTax requirement (NIC IRP native + PUT verb)
  //   2. Flat POST           : { Irn, CnlRsn, CnlRem }                              // older tenants
  //   3. Array-of-flat PUT   : [{ Irn, CnlRsn, CnlRem }]                            // observed 200 + 107 on Jun 2026
  //   4. Transaction-wrapped : [{ transaction: { Irn, CnlRsn, CnlRem } }]           // documented legacy, also 200 + 107
  //
  // For each shape: if HTTP 4xx (incl. 405) OR body contains NIC error 102/107
  // (shape errors), advance to the next shape. Any other failure (already-
  // cancelled, out-of-window, real NIC reject) is terminal — never retry on
  // 5xx, never retry on a non-shape error.
  // ClearTax's IRP cancel validator can't bind ANY of NIC's native PascalCase
  // field keys (`Irn`/`CnlRsn`/`CnlRem`) — both String and Number CnlRsn
  // returned the same "Invalid value for the field null" / code 107.
  // The neighbouring EWB cancel uses lowercase-first camelCase
  // (`ewbNo`/`cancelRsnCode`/`cancelRmrk`) — so ClearTax has clearly
  // camelCased their cancel schema across both endpoints. Try IRP cancel
  // with the same convention. We try two camelCase variants since NIC's
  // IRP cancel has two documented field name styles in the wild:
  //   - Abbreviated  (`cnlRsn`/`cnlRem`) — direct lowercase of PascalCase
  //   - Descriptive  (`cancelReasonCode`/`cancelRemark`) — mirrors EWB
  //
  // CnlRsn / cancelReasonCode is sent as a Number to be safe — EWB cancel
  // requires numeric and there's no upside to sending string.
  const reasonNum = Number(reason)
  if (!Number.isFinite(reasonNum)) throw new Error(`cancelEInvoice: reasonCode must be numeric, got ${JSON.stringify(reasonCode)}`)
  const flatCamelAbbrev = { irn, cnlRsn: reasonNum, cnlRem: remark }
  const flatCamelVerbose = { irn, cancelReasonCode: reasonNum, cancelRemark: remark }
  const flatPascal       = { Irn: irn, CnlRsn: reasonNum, CnlRem: remark }
  const arrayPayload     = [flatPascal]
  const wrappedPayload   = [{ transaction: flatPascal }]

  const attempts = [
    { label: 'flat-camel-abbrev',  method: 'PUT',  body: flatCamelAbbrev  },
    { label: 'flat-camel-verbose', method: 'PUT',  body: flatCamelVerbose },
    { label: 'flat-pascal-put',    method: 'PUT',  body: flatPascal       },
    { label: 'flat-pascal-post',   method: 'POST', body: flatPascal       },
    { label: 'array',              method: 'PUT',  body: arrayPayload,   fallbackMethod: 'POST' },
    { label: 'wrapped',            method: 'PUT',  body: wrappedPayload, fallbackMethod: 'POST' },
  ]

  let res, data, first, usedShape, usedMethod
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]
    res = await ctaxFetch(url, { method: a.method, headers, body: JSON.stringify(a.body) })
    if (res.status === 405 && a.fallbackMethod) {
      res = await ctaxFetch(url, { method: a.fallbackMethod, headers, body: JSON.stringify(a.body) })
      usedMethod = a.fallbackMethod
    } else {
      usedMethod = a.method
    }
    data = await res.json().catch(() => ({}))
    first = Array.isArray(data) ? data[0] : data
    usedShape = a.label

    // Always log the outcome of each attempt unconditionally — Railway prod
    // doesn't enable CTAX_DEBUG, so without this we have zero visibility into
    // why ClearTax rejected. EWB cancel learned the same lesson on WG000097.
    console.log(`[ClearTax] E-Invoice cancel ← ${res.status} (${usedShape}/${usedMethod}) gstin=${redactGstin(gstinOverride)} irn=…${String(irn).slice(-6)} body=${JSON.stringify(data).slice(0, 600)}`)

    // Success — return immediately.
    if (res.ok && isGovtSuccess(first?.govt_response) && first?.document_status !== 'NOT_CREATED') {
      return first || data
    }
    // Shape/schema error — advance to next shape (if any).
    if (isShapeError(res.status, data) && i < attempts.length - 1) {
      ctaxLog(`E-Invoice cancel: ${usedShape} shape rejected (${res.status}), advancing to ${attempts[i + 1].label}`, data)
      continue
    }
    // Non-shape failure on first attempt OR final-attempt failure — stop.
    break
  }

  // All shape attempts exhausted (or first non-shape failure). Decide between
  // soft-success and hard-throw.
  // Soft-success: NIC genuinely says the IRN is gone (error_source = NIC/GOVT/GSP/missing
  // with code 107). Means either a prior retry already cancelled it upstream
  // OR the IRN was never persisted there in the first place.
  // Hard-throw: error_source = CLEARTAX → ClearTax never forwarded to NIC.
  // The IRN is still active at NIC; caller must NOT clear local state.
  if (isIrnGoneAtIrp(data)) {
    ctaxLog(`E-Invoice cancel ← treating 107 as already-not-found at IRP`, data)
    return { irp_not_found: true, raw: first || data }
  }
  throw attachDebug(
    new Error(extractClearTaxMessage(first || data, 'Failed to cancel E-Invoice')),
    {
      cleartaxResponse: data,
      outgoingPayload:  usedShape === 'flat' ? flatPayload : usedShape === 'array' ? arrayPayload : wrappedPayload,
    },
  )
}

// ── E-Way Bill cancel ────────────────────────────────────────────────────────
// Mirrors cancelEInvoice's PUT → POST → flat-body fallback chain. NIC EWB cancel
// expects numeric reason codes (1-4), not string keywords.
export async function cancelEWayBill({ ewbNumber, reasonCode = '1', remark = 'Duplicate Entry', gstinOverride }) {
  if (!CLEARTAX_URL || !CLEARTAX_TOKEN) throw new Error('ClearTax not configured')
  if (!gstinOverride) throw new Error('cancelEWayBill: gstinOverride is required (must match the GSTIN that issued the EWB)')
  const reason = String(reasonCode)
  if (!VALID_EWB_CANCEL_REASONS.has(reason)) {
    throw new Error(`Invalid EWB cancel reason '${reasonCode}'. Use 1=Duplicate, 2=Order Cancelled, 3=Data Entry Mistake, 4=Others`)
  }
  const url = `${CLEARTAX_URL}/einv/v2/eInvoice/ewaybill/cancel`
  const headers = {
    'Content-Type':          'application/json',
    'X-Cleartax-Auth-Token': CLEARTAX_TOKEN,
    'gstin':                 gstinOverride,
  }
  // ClearTax EWB cancel — mirror cancelEInvoice's flat-first + wrapped
  // fallback pattern. The previous wrapped-first pattern stopped working:
  // ClearTax now bounces the array+`transaction:` wrapper with
  //   { errorDetails: { error_code: '107',
  //     error_message: 'cancelRsnCode : Cancel Reason Code is mandatory…',
  //     error_source: 'CLEARTAX' } }
  // because their validator looks for cancelRsnCode on the OUTER object,
  // not nested under `transaction:`. The flat shape works fine — same
  // shape NIC's IRP cancel uses natively.
  //
  // We still retry to the wrapped shape if flat hits a shape error (some
  // older tenants required wrapped). Never retry on 5xx — cancel is
  // destructive and an idempotent retry could mask a partial success.
  //
  // Type coercion: NIC's cancel API expects ewbNo and cancelRsnCode as
  // NUMBERS, not strings. consignment.eway_bill_no is TEXT in our DB and
  // reasonCode comes in as a user-facing string '1'..'4'. Sending strings
  // makes NIC's validator come back with "Invalid value for the field
  // null" — a confusingly-worded type-mismatch error where the field
  // name reads as null because their schema-lookup failed before binding
  // the field key. Coerce here so callers don't have to know.
  const ewbNoNum  = Number(ewbNumber)
  const reasonNum = Number(reason)
  if (!Number.isFinite(ewbNoNum))  throw new Error(`cancelEWayBill: ewbNumber must be numeric, got ${JSON.stringify(ewbNumber)}`)
  if (!Number.isFinite(reasonNum)) throw new Error(`cancelEWayBill: reasonCode must be numeric, got ${JSON.stringify(reasonCode)}`)
  const flatPayload    = { ewbNo: ewbNoNum, cancelRsnCode: reasonNum, cancelRmrk: remark }
  const wrappedPayload = [{ transaction: flatPayload }]

  // ClearTax EWB cancel historically wanted PUT (the legacy wrapped-payload
  // code used PUT and fell back to POST on 405). The flat shape works on
  // both, but PUT is the documented default — start there. If PUT returns
  // 405 (method not allowed) we fall through to POST. isShapeError catches
  // the case where the verb is fine but the body shape is rejected, and
  // we retry with the wrapped payload then.
  let res  = await ctaxFetch(url, { method: 'PUT', headers, body: JSON.stringify(flatPayload) })
  let data = await res.json().catch(() => ({}))
  let first = Array.isArray(data) ? data[0] : data
  let usedShape  = 'flat'
  let usedMethod = 'PUT'
  if (res.status === 405) {
    res = await ctaxFetch(url, { method: 'POST', headers, body: JSON.stringify(flatPayload) })
    data = await res.json().catch(() => ({}))
    first = Array.isArray(data) ? data[0] : data
    usedMethod = 'POST'
  }

  // isShapeError now also catches the object-shape errorDetails ClearTax
  // returns inside a 200 OK body (the symptom that surfaced this bug).
  if (isShapeError(res.status, data)) {
    ctaxLog(`EWB cancel: flat shape rejected (${res.status}), retrying with wrapped`, data)
    res = await ctaxFetch(url, { method: 'PUT', headers, body: JSON.stringify(wrappedPayload) })
    if (res.status === 405) {
      res = await ctaxFetch(url, { method: 'POST', headers, body: JSON.stringify(wrappedPayload) })
    }
    data = await res.json().catch(() => ({}))
    first = Array.isArray(data) ? data[0] : data
    usedShape = 'wrapped'
  }

  // Always log the outcome so Railway has the trail even when CTAX_DEBUG
  // is off — surfacing the field-by-field NIC reply was the bottleneck
  // on the WG000097 debug spiral; this makes the next round faster.
  console.log(`[ClearTax] EWB cancel ← ${res.status} (${usedShape}/${usedMethod}) gstin=${redactGstin(gstinOverride)} ewbNo=…${String(ewbNoNum).slice(-6)} body=${JSON.stringify(data).slice(0, 600)}`)
  ctaxLog(`EWB cancel ← ${res.status} (${usedShape}/${usedMethod})`, data)

  // Success detection. Two valid shapes:
  //
  //   a) govt_response.Success === 'Y'  — NIC's reply forwarded verbatim.
  //   b) { ewbNumber, ewbStatus: 'CANCELLED', errorDetails: null } — ClearTax's OWN
  //      cancel reply. It carries NO govt_response field at all.
  //
  // Only (a) was accepted, so (b) — an explicit confirmation that the EWB is
  // CANCELLED on NIC — was thrown as "Failed to cancel E-Way Bill". Ops was then
  // pushed into the force-cancel-local path and the row was recorded as "still live
  // on NIC" while NIC had in fact already cancelled it. Exactly backwards, and the
  // reason cancellation appeared broken. Accept an explicit CANCELLED status.
  const statusStr = String(first?.ewbStatus ?? first?.ewb_status ?? '').trim().toUpperCase()
  const cancelledAtNic = statusStr === 'CANCELLED' && !first?.errorDetails && !first?.ErrorDetails
  if (!res.ok || (!isGovtSuccess(first?.govt_response) && !cancelledAtNic)) {
    // 107 ("missing EWB") is the one tolerated soft-failure: the EWB
    // genuinely isn't on NIC's books anymore (either already cancelled
    // upstream OR — dangerously — never persisted, or our presented
    // GSTIN doesn't match the one that issued it). The route handler
    // decides whether to clean up local state or demand manual portal
    // verification. BUT we only treat it as soft-success if both shapes
    // failed the same way — a pre-NIC ClearTax shape rejection (also
    // code 107) must NOT be confused for "EWB not at NIC".
    if (usedShape === 'wrapped' && isIrnGoneAtIrp(data)) {
      ctaxLog(`EWB cancel ← NIC returned 107 (EWB not recognised). Marking ewb_not_found — caller must verify on the portal.`, data)
      return { ewb_not_found: true, raw: first || data }
    }
    throw attachDebug(
      new Error(extractClearTaxMessage(first || data, 'Failed to cancel E-Way Bill')),
      { cleartaxResponse: data, outgoingPayload: usedShape === 'flat' ? flatPayload : wrappedPayload },
    )
  }
  return first || data
}
