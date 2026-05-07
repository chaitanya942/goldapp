// app/api/e-invoice/preview/route.js
// Same pattern as eway-bill/preview — returns the IRP payload without firing NIC.

import { createClient } from '@supabase/supabase-js'
import { buildEInvoicePayload } from '../../../../lib/clearTaxClient'
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
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')
  if (!consignmentId) return Response.json({ error: 'id required' }, { status: 400 })

  // Sequential workflow gate: requires the issue voucher OR delivery challan
  // to have been generated first.
  const wf = await checkWorkflow(supabase, consignmentId, auth, 'einvoice_preview')
  if (wf.blocked) return wf.response

  const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
  if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
  const { consignment, branch, items, companySettings } = loaded

  // Shared preflight — same validators EWB preview / generate use.
  const errors = [
    ...validateConsignmentStatus(consignment, 'an E-Invoice'),
    ...validateBranchReadiness(branch, 'source'),
    ...validateItemTotals(items, 'an E-Invoice', { weightField: 'gross_weight' }),
  ]
  if (consignment.source_gstin && !isValidGstin(consignment.source_gstin)) {
    errors.push(`Source GSTIN '${consignment.source_gstin}' is malformed`)
  }

  const payload = buildEInvoicePayload({ consignment, branch, items: items || [], companySettings: companySettings || {} })

  // IRP outright rejects identical seller/buyer GSTINs — surface here too.
  errors.push(
    ...validateDistinctGstins(payload.SellerDtls?.Gstin, payload.BuyerDtls?.Gstin, 'an E-Invoice'),
  )

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
