// app/api/eway-bill/preview/route.js
//
// Returns the EWB payload that WOULD be sent to NIC, WITHOUT firing the API.
// Accounts uses this to verify addresses / GSTINs / weight / value match the
// challan / voucher / consignment BEFORE clicking Generate. Catches "wrong
// doc would be generated" before it becomes "wrong doc on NIC's books".
//
// GET ?id=<consignment_id>
// Returns: { payload, summary, validation_errors[] }
//   - payload: full EWB-01 JSON ClearTax would receive
//   - summary: human-readable digest (from / to / qty / value / IGST)
//   - validation_errors: same preflight errors the generate route would surface
//
// IMPORTANT: this route MUST NOT call ClearTax / NIC. It only constructs the
// payload locally using the exported builder.

import { createClient } from '@supabase/supabase-js'
import { buildPayload } from '../../../../lib/clearTaxClient'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { loadConsignmentForGeneration } from '../../../../lib/consignmentSnapshot'
import { checkWorkflow } from '../../../../lib/workflowGate'
import {
  validateConsignmentStatus,
  validateBranchReadiness,
  validateItemTotals,
  validateDistinctGstins,
  isValidGstin,
} from '../../../../lib/gstDocPreflight'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function GET(req) {
  // ACCOUNTS only — same gate as generate.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')
  if (!consignmentId) return Response.json({ error: 'id required' }, { status: 400 })

  // Sequential workflow gate: requires the issue voucher OR delivery challan
  // to have been generated first. Preview should mirror what the user already
  // saw on the physical document.
  const wf = await checkWorkflow(supabase, consignmentId, auth, 'ewb_preview')
  if (wf.blocked) return wf.response

  const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
  if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
  const { consignment, branch, destBranch, items, companySettings } = loaded

  // Shared preflight — same validators the generate route runs. Order matters:
  // status / approval guards first so they always show regardless of other
  // issues. Document-specific checks (source GSTIN format, distinct GSTINs)
  // come after the universal ones.
  const isInternal = consignment.movement_type === 'INTERNAL'
  const errors = [
    ...validateConsignmentStatus(consignment, 'an E-Way Bill'),
    ...validateBranchReadiness(branch, 'source'),
    ...(isInternal ? validateBranchReadiness(destBranch, 'destination') : []),
    ...validateItemTotals(items, 'an E-Way Bill', { weightField: 'gross_weight' }),
  ]
  if (consignment.source_gstin && !isValidGstin(consignment.source_gstin)) {
    errors.push(`Source GSTIN '${consignment.source_gstin}' is malformed`)
  }

  // Build the exact payload the generate route would send.
  const payload = buildPayload({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} })

  // Distinct seller/buyer GSTIN check — EXTERNAL only.
  // INTERNAL Branch→Hub is OWN_USE under the same GSTIN by design (intra-
  // company stock transfer); NIC requires same seller/buyer Gstin in that
  // mode. Surfacing this as an error there blocks legal consignments.
  // E-Invoice has a different rule (IRP outright rejects same-GSTIN), so
  // that gate stays in the E-Invoice preview unchanged.
  if (consignment.movement_type !== 'INTERNAL') {
    errors.push(
      ...validateDistinctGstins(payload.SellerDtls?.Gstin, payload.BuyerDtls?.Gstin, 'an E-Way Bill'),
    )
  }

  // Human-readable digest the UI shows in the modal — what accounts will compare against the challan.
  const summary = {
    document_no:        payload.DocumentNumber,
    document_date:      payload.DocumentDate,
    supply_type:        payload.SupplyType,
    sub_supply_type:    payload.SubSupplyType,
    movement_type:      consignment.movement_type,
    seller: {
      gstin: payload.SellerDtls?.Gstin,
      legal_name: payload.SellerDtls?.LglNm,
      address1: payload.SellerDtls?.Addr1,
      address2: payload.SellerDtls?.Addr2,
      location: payload.SellerDtls?.Loc,
      pin: payload.SellerDtls?.Pin,
      state_code: payload.SellerDtls?.Stcd,
    },
    buyer: {
      gstin: payload.BuyerDtls?.Gstin,
      legal_name: payload.BuyerDtls?.LglNm,
      address1: payload.BuyerDtls?.Addr1,
      address2: payload.BuyerDtls?.Addr2,
      location: payload.BuyerDtls?.Loc,
      pin: payload.BuyerDtls?.Pin,
      state_code: payload.BuyerDtls?.Stcd,
    },
    dispatch_from: payload.DispatchDtls,
    ship_to:       payload.ShipDtls,
    quantity_grams:    payload.ItemList?.[0]?.Qty,
    unit:              payload.ItemList?.[0]?.Unit,
    hsn:               payload.ItemList?.[0]?.HsnCd,
    product_name:      payload.ItemList?.[0]?.ProdName,
    taxable_amount:    payload.TotalAssessableAmount,
    igst_rate:         payload.ItemList?.[0]?.IgstRt,
    igst_amount:       payload.TotalIgstAmount,
    cgst_amount:       payload.TotalCgstAmount,
    sgst_amount:       payload.TotalSgstAmount,
    total_invoice:     payload.TotalInvoiceAmount,
    distance_km:       payload.TransDistance,
    items: (items || []).map(i => ({
      bill_no:       i.bill_no || i.sl_no || null,
      customer:      i.customer_name,
      gross_weight:  Number(i.gross_weight || 0),
      net_weight:    Number(i.net_weight   || 0),
      total_amount:  Number(i.total_amount || 0),
    })),
  }

  return Response.json({
    consignment_id:     consignment.id,
    tmp_prf_no:         consignment.tmp_prf_no,
    document_type:      'EWB',
    can_generate:       errors.length === 0 && !consignment.eway_bill_no,
    already_generated:  !!consignment.eway_bill_no,
    existing_ewb_no:    consignment.eway_bill_no || null,
    validation_errors:  errors,
    summary,
    payload,  // raw payload for advanced users / debugging
  })
}
