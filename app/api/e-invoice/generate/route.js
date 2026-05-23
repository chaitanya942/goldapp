// app/api/e-invoice/generate/route.js
// Generate an E-Invoice (IRN) via ClearTax / IRP for a consignment.
// Body: { consignment_id }
// On success: stores irn / ack_no / ack_dt / signed_qr_code on the consignment row.

import { createClient } from '@supabase/supabase-js'
import { generateEInvoice } from '../../../../lib/clearTaxClient'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'
import { requireAuthForPage } from '../../../../lib/apiAuth'
import { applyConsignmentApproval } from '../../../../lib/consignmentApproval'
import { loadConsignmentForGeneration } from '../../../../lib/consignmentSnapshot'
import { checkWorkflow } from '../../../../lib/workflowGate'
import { nextEInvoiceDocNo, getCurrentFyCode } from '../../../../lib/consignmentUtils'
import { REGION_TO_STATE_CODE } from '../../../../lib/stateMap'
import {
  validateConsignmentStatus,
  validateBranchReadiness,
  validateItemTotals,
  validateDistinctGstins,
  resolveSellerGstinForBranch,
  resolveBuyerGstinForHo,
} from '../../../../lib/gstDocPreflight'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  // E-Invoice is now operations self-service (mirrors EWB): anyone who can
  // see the Consignment Data module may generate it. Generating IS the
  // dispatch decision — on success this route auto-approves the consignment
  // and moves stock (see the applyConsignmentApproval call below), so
  // accounts is no longer in the E-Invoice path.
  const auth = await requireAuthForPage(req, 'consignment-data')
  if (!auth.ok) return auth.response
  try {
    const { consignment_id } = await req.json()
    if (!consignment_id) return Response.json({ error: 'consignment_id required' }, { status: 400 })

    // Sequential workflow gate: voucher / challan must have been generated first.
    const wf = await checkWorkflow(supabase, consignment_id, auth, 'einvoice_generate')
    if (wf.blocked) return wf.response

    // Snapshot-first load (consignment + branch + items + companySettings).
    const loaded = await loadConsignmentForGeneration(supabase, consignment_id, auth)
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
    const { consignment, branch, items, companySettings } = loaded

    // Universal preflight (status + branch + items) via the shared lib so the
    // EWB and E-Invoice routes can never silently disagree on what's blocking.
    const preflight = [
      ...validateConsignmentStatus(consignment, 'an E-Invoice'),
      ...validateBranchReadiness(branch, 'source'),
      ...validateItemTotals(items, 'an E-Invoice', { weightField: 'gross_weight' }),
    ]
    if (preflight.length) return Response.json({ error: preflight[0] }, { status: 400 })
    if (consignment.irn) return Response.json({ error: `E-Invoice already exists: ${consignment.irn}` }, { status: 400 })

    // E-Invoice-specific: resolve seller + buyer GSTINs via the shared resolvers
    // (same fallback chain the preview uses). Distinct check is mandatory — IRP
    // outright rejects identical seller/buyer.
    const sellerR = resolveSellerGstinForBranch({ branch, companySettings: companySettings || {} })
    if (sellerR.error) return Response.json({ error: sellerR.error }, { status: 400 })
    const buyerR  = resolveBuyerGstinForHo({ companySettings: companySettings || {} })
    if (buyerR.error) return Response.json({ error: buyerR.error }, { status: 400 })
    const distinct = validateDistinctGstins(sellerR.gstin, buyerR.gstin, 'an E-Invoice')
    if (distinct.length) return Response.json({ error: distinct[0] }, { status: 400 })

    // Allocate the next per-state E-Invoice doc number atomically. Format is
    // 'WG/{STATE}/{FY}/{SEQ}' — KL/TS/AP each have their own monotonic counter
    // per fiscal year. The RPC commits the increment, so even on a generation
    // failure downstream the number is consumed (intentional: GST audit
    // requires a clean monotonic series with no quiet gaps).
    const sourceState = REGION_TO_STATE_CODE[branch?.region] || consignment.state_code
    if (!sourceState || sourceState === 'KA') {
      return Response.json({ error: `E-Invoice not applicable for source state '${sourceState || branch?.region}'. KA-source consignments use E-Way Bill instead.` }, { status: 400 })
    }
    const fy            = getCurrentFyCode()
    const einvoiceDocNo = await nextEInvoiceDocNo(supabase, sourceState, fy)
    // Persist immediately so the audit trail records the number even if the
    // IRP call fails — operator can see what number was burned.
    await supabase.from('consignments')
      .update({ einvoice_doc_no: einvoiceDocNo })
      .eq('id', consignment_id)
    // Reflect on the in-memory consignment so buildEInvoicePayload picks it up.
    consignment.einvoice_doc_no = einvoiceDocNo

    const result = await generateEInvoice({ consignment, branch, items: items || [], companySettings: companySettings || {}, docNoOverride: einvoiceDocNo })
    // Full response (with redaction) is logged by ctaxLog inside lib/clearTaxClient.js.

    // Robust extraction across response shapes
    const sources = [result?.govt_response, result?.data, result?.response, result]
    const pick = (keys) => {
      for (const s of sources) {
        if (!s || typeof s !== 'object') continue
        for (const k of keys) {
          const v = s[k]
          if (v != null && String(v).trim()) return String(v)
        }
      }
      return null
    }
    const irn          = pick(['Irn', 'irn', 'IRN'])
    const ackNo        = pick(['AckNo', 'ackNo', 'ack_no'])
    const ackDt        = pick(['AckDt', 'ackDt', 'ack_dt'])
    const signedQrCode = pick(['SignedQRCode', 'signedQRCode', 'signed_qr_code'])

    if (!irn) {
      // Don't echo `result` to the client — it contains GSTINs / addresses /
      // signed QR JWT. Server-side ctaxLog already captured a redacted copy.
      return Response.json({
        success: false,
        error:   'IRN not found in response. See server logs for details.',
      }, { status: 502 })
    }

    await supabase.from('consignments')
      .update({ irn, ack_no: ackNo, ack_dt: ackDt, signed_qr_code: signedQrCode, einvoice_generated_at: new Date().toISOString() })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type:  'einvoice_generated',
      actor_email: auth.profile?.email || auth.user?.email || 'unknown',
      details:     { irn, ack_no: ackNo, ack_dt: ackDt, doc_no: einvoiceDocNo },
    })

    // ── Auto-approve + dispatch ──────────────────────────────────────────
    // E-Invoice is now ops self-service (same model as EWB). Generating the
    // legally-binding doc on IRP IS the dispatch decision, so we run the SAME
    // approval transition accounts used to do (mark approved, move linked
    // bills' stock, log the event) via the shared helper.
    //
    // Wrapped: the E-Invoice is already on IRP's books at this point, so a
    // hiccup here must NOT 500 the request (that would hide a real IRN).
    // We surface a warning instead so ops/accounts can reconcile.
    let autoApproveWarning = null
    try {
      const appr = await applyConsignmentApproval(supabase, {
        id:           consignment_id,
        approverEmail: auth.profile?.email || auth.user?.email || 'system',
        eventType:    'approved_on_einvoice_generate',
        note:         'Auto-approved on E-Invoice generation (operations self-service)',
      })
      if (appr?.error) {
        autoApproveWarning = appr.error.message || String(appr.error)
        console.error('[E-Invoice] auto-approve failed after generation:', consignment_id, autoApproveWarning)
      }
    } catch (e) {
      autoApproveWarning = e?.message || String(e)
      console.error('[E-Invoice] auto-approve threw after generation:', consignment_id, autoApproveWarning)
    }

    return Response.json({
      success: true, irn, ack_no: ackNo, ack_dt: ackDt, doc_no: einvoiceDocNo,
      ...(autoApproveWarning ? { auto_approve_warning: autoApproveWarning } : {}),
    })
  } catch (err) {
    console.error('E-Invoice generate error:', err)
    // Debug payloads stay server-side only (see ctaxLog in lib/clearTaxClient.js).
    return Response.json({
      error: err.message || 'E-Invoice generation failed',
    }, { status: 500 })
  }
}
