// app/api/e-invoice/preview/route.js
// Same pattern as eway-bill/preview — returns the IRP payload without firing NIC.

import { createClient } from '@supabase/supabase-js'
import { buildEInvoicePayload } from '../../../../lib/clearTaxClient'
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
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')
  if (!consignmentId) return Response.json({ error: 'id required' }, { status: 400 })

  const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
  if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
  const { consignment, branch, items, companySettings } = loaded

  // Mirror the generate route's preflight checks so accounts sees the same blockers BEFORE clicking.
  // ORDER MATTERS: status / approval guards FIRST.
  const errors = []
  if (consignment.status === 'cancelled') {
    errors.push(`${consignment.tmp_prf_no} is cancelled. Cannot generate an E-Invoice against a cancelled consignment.`)
  }
  if (consignment.approval_status === 'rejected') {
    errors.push(`${consignment.tmp_prf_no} was rejected by accounts. Cannot generate an E-Invoice.`)
  }
  if (!items?.length) errors.push('Consignment has no items')
  const totalGross = (items || []).reduce((s, i) => s + Number(i.gross_weight || 0), 0)
  if (totalGross <= 0) errors.push('Total gross weight is 0')
  const totalVal = (items || []).reduce((s, i) => s + Number(i.total_amount || 0), 0)
  if (totalVal <= 0) errors.push('Total value is 0')
  if (!branch?.address || !branch?.pin_code) errors.push(`Source branch '${branch?.name}' missing address or PIN`)
  if (branch?.pin_code && !isValidPin(branch.pin_code)) errors.push(`Source PIN '${branch.pin_code}' is invalid`)
  if (consignment.source_gstin && !isValidGstin(consignment.source_gstin)) errors.push(`Source GSTIN '${consignment.source_gstin}' is malformed`)

  const payload = buildEInvoicePayload({ consignment, branch, items: items || [], companySettings: companySettings || {} })

  // Same-GSTIN check (intra-state KA — IRP rejects)
  if (payload.SellerDtls?.Gstin && payload.BuyerDtls?.Gstin && payload.SellerDtls.Gstin === payload.BuyerDtls.Gstin) {
    errors.push('Seller and Buyer GSTINs are identical — E-Invoice not required (use EWB only)')
  }

  const summary = {
    document_no:        payload.DocDtls?.No,
    document_date:      payload.DocDtls?.Dt,
    document_type:      payload.DocDtls?.Typ,
    transaction_type:   payload.TranDtls?.SupTyp,
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
      pos: payload.BuyerDtls?.Pos,
    },
    quantity_grams:    payload.ItemList?.[0]?.Qty,
    unit:              payload.ItemList?.[0]?.Unit,
    hsn:               payload.ItemList?.[0]?.HsnCd,
    product_name:      payload.ItemList?.[0]?.PrdDesc,
    unit_price:        payload.ItemList?.[0]?.UnitPrice,
    taxable_amount:    payload.ValDtls?.AssVal,
    igst_amount:       payload.ValDtls?.IgstVal,
    cgst_amount:       payload.ValDtls?.CgstVal,
    sgst_amount:       payload.ValDtls?.SgstVal,
    total_invoice:     payload.ValDtls?.TotInvVal,
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
    document_type:      'IRN',
    can_generate:       errors.length === 0 && !consignment.irn,
    already_generated:  !!consignment.irn,
    existing_irn:       consignment.irn || null,
    validation_errors:  errors,
    summary,
    payload,
  })
}
