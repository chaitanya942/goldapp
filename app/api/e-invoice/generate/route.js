// app/api/e-invoice/generate/route.js
// Generate an E-Invoice (IRN) via ClearTax / IRP for a consignment.
// Body: { consignment_id }
// On success: stores irn / ack_no / ack_dt / signed_qr_code on the consignment row.

import { createClient } from '@supabase/supabase-js'
import { generateEInvoice } from '../../../../lib/clearTaxClient'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { loadConsignmentForGeneration } from '../../../../lib/consignmentSnapshot'
import { checkWorkflow } from '../../../../lib/workflowGate'
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
  // Accounts owns GST documents — they generate as part of approval review.
  // Operations can no longer generate; they only download once approved.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
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

    const result = await generateEInvoice({ consignment, branch, items: items || [], companySettings: companySettings || {} })
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
      details:     { irn, ack_no: ackNo, ack_dt: ackDt },
    })

    return Response.json({ success: true, irn, ack_no: ackNo, ack_dt: ackDt })
  } catch (err) {
    console.error('E-Invoice generate error:', err)
    // Debug payloads stay server-side only (see ctaxLog in lib/clearTaxClient.js).
    return Response.json({
      error: err.message || 'E-Invoice generation failed',
    }, { status: 500 })
  }
}
