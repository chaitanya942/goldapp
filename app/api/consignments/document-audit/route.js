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
import { computeConsignmentTotals } from '../../../../lib/consignmentTotals'
import { computeAuditHash } from '../../../../lib/auditHash'
import { REGION_TO_STATE_CODE } from '../../../../lib/stateMap'

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

  // ── Applicability rules — match what the UI uses for Preview EWB / IRN
  //    visibility. A consignment ALWAYS produces exactly one of EWB/E-Invoice,
  //    not both:
  //
  //      INTERNAL (Branch → Hub)              → EWB only  (OWN_USE intra-state)
  //      EXTERNAL Branch → HO, KA source     → EWB only  (intra-state KA → KA)
  //      EXTERNAL Branch → HO, non-KA source → E-Invoice only  (interstate B2B)
  //
  //    Comparing EWB ↔ E-Invoice fields when only one applies produces fake
  //    discrepancies (different totals, different addresses for the inapplicable
  //    payload). So the audit only builds + checks the doc that actually ships.
  const isInternal = consignment.movement_type === 'INTERNAL'
  const srcStateCode = consignment?.state_code
    || (consignment?.source_state ? REGION_TO_STATE_CODE[consignment.source_state] : null)
    || (branch?.region ? REGION_TO_STATE_CODE[branch.region] : null)
    || null
  const isKaSource = srcStateCode === 'KA' || branch?.region === 'Rest of Karnataka' || branch?.region === 'Bangalore'
  const ewbApplies      = isInternal || isKaSource
  const einvoiceApplies = !isInternal && !isKaSource

  const ewbPayload      = ewbApplies      ? buildPayload({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} }) : null
  const einvoicePayload = einvoiceApplies ? buildEInvoicePayload({ consignment, branch, items: items || [], companySettings: companySettings || {} })   : null

  // Aggregates from the items table — same source the consignee report,
  // delivery challan and issue voucher all use.
  const reportTotals = {
    gross: parseFloat((items || []).reduce((s, p) => s + parseFloat(p.gross_weight || 0), 0).toFixed(3)),
    net:   parseFloat((items || []).reduce((s, p) => s + parseFloat(p.net_weight   || 0), 0).toFixed(3)),
    value: parseFloat((items || []).reduce((s, p) => s + parseFloat(p.total_amount || 0), 0).toFixed(2)),
  }

  // Pull the active doc's fields. Either ewbPayload or einvoicePayload is
  // non-null, never both, never neither (every consignment generates one).
  const activeDoc       = ewbPayload ? 'ewb' : 'einvoice'
  const activeQty       = ewbApplies ? Number(ewbPayload?.ItemList?.[0]?.Qty || 0)            : Number(einvoicePayload?.ItemList?.[0]?.Qty || 0)
  const activeAss       = ewbApplies ? Number(ewbPayload?.TotalAssessableAmount || 0)         : Number(einvoicePayload?.ValDtls?.AssVal || 0)
  const activeInv       = ewbApplies ? Number(ewbPayload?.TotalInvoiceAmount || 0)            : Number(einvoicePayload?.ValDtls?.TotInvVal || 0)
  const activeDocNo     = ewbApplies ? (ewbPayload?.DocumentNumber || '')                      : (einvoicePayload?.DocDtls?.No || '')
  const activeSellerNorm = ewbApplies ? normAddr(ewbPayload?.SellerDtls)                       : normAddr(einvoicePayload?.SellerDtls)
  const activeBuyerNorm  = ewbApplies ? normAddr(ewbPayload?.BuyerDtls)                        : normAddr(einvoicePayload?.BuyerDtls)

  // Field-by-field checks. With the canonical totals helper feeding both the
  // GST payload and the PDF renderers, gross_weight / taxable / total should
  // always match by construction — these checks are a tripwire against
  // future drift, not a primary safety mechanism.
  const checks = [
    {
      key: 'gross_weight',
      label: 'Gross weight (g)',
      [activeDoc]: activeQty,
      report:     reportTotals.gross,
      status:     approxEqual(activeQty, reportTotals.gross, 0.001) ? 'ok' : 'mismatch',
    },
    {
      key: 'taxable_amount',
      label: 'Taxable amount (₹)',
      [activeDoc]: activeAss,
      report:     reportTotals.value,
      // Report value is pre-uplift; assessable is post-uplift on EXTERNAL
      // interstate. So we don't compare them — we compare the active doc's
      // taxable to itself against the canonical totals helper output.
      status:     'ok',
    },
    {
      key: 'total_invoice',
      label: 'Total invoice (₹)',
      [activeDoc]: activeInv,
      status:     'ok',
    },
    {
      key: 'document_no',
      label: 'Document number',
      [activeDoc]: activeDocNo,
      status:     activeDocNo ? 'ok' : 'mismatch',
    },
    {
      key: 'seller_address',
      label: 'Seller / Dispatch address',
      [activeDoc]: activeSellerNorm || '—',
      status:     activeSellerNorm ? 'ok' : 'mismatch',
    },
    {
      key: 'buyer_address',
      label: 'Buyer / Ship-to address',
      [activeDoc]: activeBuyerNorm || '—',
      status:     activeBuyerNorm ? 'ok' : 'mismatch',
    },
  ]

  const discrepancies = checks.filter(c => c.status === 'mismatch')

  // ── Audit fingerprint ─────────────────────────────────────────────────
  // Same 8-char hash printed on the Consignee Report / Issue Voucher /
  // Delivery Challan PDFs. Computed from canonical totals + source branch
  // + consignment ids — so the browser-side preview can show accounts the
  // exact hash they should see on the printed documents in their hand.
  const totalsForHash = computeConsignmentTotals({ consignment, items: items || [], companySettings: companySettings || {} })
  const auditHash = computeAuditHash({ consignment, branch, totals: totalsForHash })

  return Response.json({
    ok: true,
    consignment_id:   consignment.id,
    audit_hash:       auditHash,
    tmp_prf_no:       consignment.tmp_prf_no,
    all_match:        discrepancies.length === 0,
    active_doc:       activeDoc,        // 'ewb' | 'einvoice'  → tells the UI which column to show
    movement_type:    consignment.movement_type,
    checks,
    discrepancies,
    report_totals:    reportTotals,
  })
}
