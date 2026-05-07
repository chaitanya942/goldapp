// lib/consignmentTotals.js
//
// Single canonical calculator for the consolidated weight + value totals on
// every consignment document. Five callers must agree on the exact numbers:
//
//   - buildPayload          (EWB)      → lib/clearTaxClient.js
//   - buildEInvoicePayload  (E-Invoice)→ lib/clearTaxClient.js
//   - generateIssueVoucher  (PDF)      → Issue Voucher VALUE BREAKDOWN
//   - generateDeliveryChallan (PDF)    → Challan GST footer (Value of Goods /
//                                         IGST / Grand Total)
//   - generateConsigneeReport (JPEG)   → consolidated weight only, no value
//
// Each previously did its own .toFixed() / its own uplift logic / its own
// IGST math. The cross-document audit endpoint catches drift, but a single
// helper makes drift impossible by construction. The order/precision below
// matches what was already in buildPayload — so no values move on the
// existing EWB / E-Invoice payloads.
//
// FORMULA (mirrors buildPayload):
//   totalGrossWt   = sum of items.gross_weight, rounded to 3 decimals
//   totalNetWt     = sum of items.net_weight, rounded to 3 decimals
//   rawValue       = sum of items.total_amount, rounded to 2 decimals
//
//   isInternal           = consignment.movement_type === 'INTERNAL'
//   isExternalInterstate = !isInternal && srcState !== 'KA'
//   upliftPct            = company_settings.value_uplift_pct  (default 7.5%)
//   gstRate              = company_settings.igst_rate          (default 3%)
//
//   markupAmt            = isExternalInterstate ? rawValue * upliftPct/100 : 0
//   assessableValue      = rawValue + markupAmt   (= taxable value sent to NIC)
//   igstAmt              = isExternalInterstate ? assessableValue * gstRate/100 : 0
//   grandTotal           = assessableValue + igstAmt  (= total invoice amount)
//
// Internal Branch→Hub flows: never interstate (enforced in UI), so always
// markupAmt = 0, igstAmt = 0, grandTotal = rawValue. Documents still print
// the four-row breakdown for layout consistency — the bottom three rows
// show '—' so it's visually clear that intra-company moves don't carry tax.

import { REGION_TO_STATE_CODE } from './stateMap'

export function computeConsignmentTotals({ consignment, items, companySettings = {} }) {
  const safeItems = Array.isArray(items) ? items : []

  const totalGrossWt = parseFloat(
    safeItems.reduce((s, it) => s + parseFloat(it.gross_weight || 0), 0).toFixed(3),
  )
  const totalNetWt = parseFloat(
    safeItems.reduce((s, it) => s + parseFloat(it.net_weight || 0), 0).toFixed(3),
  )
  const rawValue = parseFloat(
    safeItems.reduce((s, it) => s + parseFloat(it.total_amount || 0), 0).toFixed(2),
  )

  // Source state — prefer the snapshot column, fall back to mapping the
  // branch's region. Both clearTaxClient paths use this exact resolution.
  const srcStateCode =
    consignment?.state_code
    || (consignment?.source_state ? REGION_TO_STATE_CODE[consignment.source_state] : null)
    || (consignment?.source_region ? REGION_TO_STATE_CODE[consignment.source_region] : null)
    || null

  const isInternal           = consignment?.movement_type === 'INTERNAL'
  const isExternalInterstate = !isInternal && srcStateCode && srcStateCode !== 'KA'

  const upliftPct = parseFloat(companySettings?.value_uplift_pct ?? 7.5) || 0
  const gstRate   = parseFloat(companySettings?.igst_rate          ?? 3)   || 3

  const markupAmt = isExternalInterstate
    ? parseFloat((rawValue * upliftPct / 100).toFixed(2))
    : 0
  const assessableValue = parseFloat((rawValue + markupAmt).toFixed(2))
  const igstAmt = isExternalInterstate
    ? parseFloat((assessableValue * gstRate / 100).toFixed(2))
    : 0
  const grandTotal = parseFloat((assessableValue + igstAmt).toFixed(2))

  return {
    bills:                safeItems.length,
    totalGrossWt,
    totalNetWt,
    rawValue,
    upliftPct,
    markupAmt,
    assessableValue,
    gstRate,
    igstAmt,
    grandTotal,
    isInternal,
    isExternalInterstate,
    srcStateCode,
  }
}
