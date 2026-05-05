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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

function isValidGstin(g) {
  if (!g || typeof g !== 'string') return false
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g.toUpperCase())
}
function isValidPin(pin) {
  return /^[1-9][0-9]{5}$/.test(String(pin || '').trim())
}

export async function GET(req) {
  // ACCOUNTS only — same gate as generate.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')
  if (!consignmentId) return Response.json({ error: 'id required' }, { status: 400 })

  const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
  if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
  const { consignment, branch, destBranch, items, companySettings } = loaded

  // Same preflight checks the generate route runs — surface them here so accounts sees them BEFORE clicking Generate.
  const errors = []
  const isInternal = consignment.movement_type === 'INTERNAL'
  if (!branch?.address && !branch?.city) errors.push('Source branch has no address')
  if (isInternal && !destBranch?.address && !destBranch?.city) errors.push('Destination hub has no address')
  if (branch?.pin_code && !isValidPin(branch.pin_code)) errors.push(`Source PIN '${branch.pin_code}' is invalid`)
  if (isInternal && destBranch?.pin_code && !isValidPin(destBranch.pin_code)) errors.push(`Dest PIN '${destBranch.pin_code}' is invalid`)
  if (consignment.source_gstin && !isValidGstin(consignment.source_gstin)) errors.push(`Source GSTIN '${consignment.source_gstin}' is malformed`)
  if (!items?.length) errors.push('Consignment has no items')
  const totalGross = (items || []).reduce((s, i) => s + Number(i.gross_weight || 0), 0)
  if (totalGross <= 0) errors.push('Total gross weight is 0')
  const totalVal = (items || []).reduce((s, i) => s + Number(i.total_amount || 0), 0)
  if (totalVal <= 0) errors.push('Total value is 0')

  // Build the exact payload the generate route would send.
  const payload = buildPayload({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} })

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
