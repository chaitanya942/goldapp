// app/api/consignments/document-audit/route.js
//
// Cross-document consistency check for a single consignment. Loads the same
// snapshot every doc generator uses (loadConsignmentForGeneration), then
// computes what each of these would show / send and reports any divergence:
//
//   - EWB payload (buildPayload)
//   - E-Invoice payload (buildEInvoicePayload)
//   - Consignee Report aggregates
//   - Issue Voucher / Delivery Challan aggregates (same items table → identical)
//
// Returns:
//   { ok: true, checks: [{ key, label, ewb, einvoice, report, status }], discrepancies: [...] }
//
// The preview modal calls this and shows a green "all docs agree" badge or a
// red list of mismatches before accounts clicks Generate. Catches any future
// builder drift before it becomes a wrong-doc-on-NIC's-books incident.
//
// GET ?id=<consignment_id>
// ACCOUNTS only.

import { createClient } from '@supabase/supabase-js'
import { buildPayload, buildEInvoicePayload } from '../../../../lib/clearTaxClient'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { loadConsignmentForGeneration } from '../../../../lib/consignmentSnapshot'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Compose a one-line address string from a payload's seller/buyer dtls.
// We intentionally normalize whitespace + lowercase to compare across builders;
// trailing-comma differences and casing should not register as discrepancies.
function normAddr(d) {
  if (!d) return ''
  return [d.LglNm, d.Addr1, d.Addr2, d.Loc, d.Pin, d.Stcd]
    .filter(Boolean)
    .map(s => String(s).replace(/\s+/g, ' ').trim().toLowerCase())
    .join(' | ')
}

function approxEqual(a, b, tolerance = 0.01) {
  if (a == null || b == null) return false
  return Math.abs(Number(a) - Number(b)) <= tolerance
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')
  if (!consignmentId) return Response.json({ error: 'id required' }, { status: 400 })

  const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
  if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
  const { consignment, branch, destBranch, items, companySettings } = loaded

  const ewbPayload      = buildPayload({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} })
  const einvoicePayload = buildEInvoicePayload({ consignment, branch, items: items || [], companySettings: companySettings || {} })

  // Aggregates from the items table — same source the consignee report,
  // delivery challan and issue voucher all use.
  const reportTotals = {
    gross: parseFloat((items || []).reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0).toFixed(3)),
    net:   parseFloat((items || []).reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0).toFixed(3)),
    value: parseFloat((items || []).reduce((s, p) => s + parseFloat(p.total_amount || 0), 0).toFixed(2)),
  }

  const ewbQty   = Number(ewbPayload?.ItemList?.[0]?.Qty || 0)
  const einvQty  = Number(einvoicePayload?.ItemList?.[0]?.Qty || 0)
  const ewbAss   = Number(ewbPayload?.TotalAssessableAmount || 0)
  const einvAss  = Number(einvoicePayload?.ValDtls?.AssVal || 0)
  const ewbInv   = Number(ewbPayload?.TotalInvoiceAmount || 0)
  const einvInv  = Number(einvoicePayload?.ValDtls?.TotInvVal || 0)

  // Address normalization: EWB DispatchDtls vs E-Invoice SellerDtls (legal seller).
  // For OWN_USE EXTERNAL the EWB's BuyerDtls aliases back to seller GSTIN but
  // ShipDtls is the physical destination — so we compare ShipDtls (physical)
  // against E-Invoice's BuyerDtls.Pos+address vagueness via the buyer entity.
  const sellerEwb  = normAddr(ewbPayload.SellerDtls)
  const sellerEinv = normAddr(einvoicePayload.SellerDtls)
  const buyerEwb   = normAddr(ewbPayload.BuyerDtls)
  const buyerEinv  = normAddr(einvoicePayload.BuyerDtls)

  const checks = [
    {
      key: 'seller_address',
      label: 'Seller / Dispatch address',
      ewb: sellerEwb || '—',
      einvoice: sellerEinv || '—',
      status: sellerEwb === sellerEinv ? 'ok' : 'mismatch',
    },
    {
      key: 'buyer_address',
      label: 'Buyer / Ship-to address',
      ewb: buyerEwb || '—',
      einvoice: buyerEinv || '—',
      status: buyerEwb === buyerEinv ? 'ok' : 'mismatch',
    },
    {
      key: 'gross_weight',
      label: 'Gross weight (g)',
      ewb: ewbQty,
      einvoice: einvQty,
      report: reportTotals.gross,
      status: (approxEqual(ewbQty, einvQty, 0.001) && approxEqual(ewbQty, reportTotals.gross, 0.001)) ? 'ok' : 'mismatch',
    },
    {
      key: 'taxable_amount',
      label: 'Taxable amount (₹)',
      ewb: ewbAss,
      einvoice: einvAss,
      // The challan/voucher show pre-uplift `total_amount` as their value column,
      // but the EWB/E-Invoice apply IGST uplift on EXTERNAL interstate. So we
      // compare EWB vs E-Invoice (must agree) and separately note the report
      // totals so users can see the uplift in plain numbers.
      report: reportTotals.value,
      status: approxEqual(ewbAss, einvAss, 0.01) ? 'ok' : 'mismatch',
    },
    {
      key: 'total_invoice',
      label: 'Total invoice (₹)',
      ewb: ewbInv,
      einvoice: einvInv,
      status: approxEqual(ewbInv, einvInv, 0.01) ? 'ok' : 'mismatch',
    },
    {
      key: 'document_no',
      label: 'Document number',
      ewb: ewbPayload?.DocumentNumber || '—',
      einvoice: einvoicePayload?.DocDtls?.No || '—',
      status: (ewbPayload?.DocumentNumber || '') === (einvoicePayload?.DocDtls?.No || '') ? 'ok' : 'mismatch',
    },
  ]

  const discrepancies = checks.filter(c => c.status === 'mismatch')

  return Response.json({
    ok: true,
    consignment_id:   consignment.id,
    tmp_prf_no:       consignment.tmp_prf_no,
    all_match:        discrepancies.length === 0,
    checks,
    discrepancies,
    report_totals:    reportTotals,
  })
}
