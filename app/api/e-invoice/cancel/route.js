// app/api/e-invoice/cancel/route.js
// Cancel an E-Invoice (must be done within 24 hours per IRP rules).
// Body: { consignment_id, reason_code?, remark? }
// Cancellation is destructive and irreversible at the IRP — restricted to
// ADMIN role group.

import { createClient } from '@supabase/supabase-js'
import { cancelEInvoice } from '../../../../lib/clearTaxClient'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'
import { REGION_TO_STATE_CODE } from '../../../../lib/stateMap'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response
  try {
    const { consignment_id, reason_code, remark } = await req.json()
    if (!consignment_id) return Response.json({ error: 'consignment_id required' }, { status: 400 })

    const { data: consignment, error } = await supabase
      .from('consignments').select('irn, branch_name, source_gstin').eq('id', consignment_id).single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.irn) return Response.json({ error: 'No E-Invoice to cancel' }, { status: 400 })

    const { data: branch } = await supabase
      .from('branches').select('branch_gstin, region').eq('name', consignment.branch_name).single()

    // GSTIN MUST match the one used to GENERATE the IRN. If company_settings has
    // been edited since (or the state-wise GSTIN was overridden), re-resolving
    // here can pick a different value, and IRP rejects the cancel with
    // "Valid Irn number is missing in the request (107)" — i.e. that IRN
    // doesn't belong to the GSTIN we're presenting.
    //
    // Resolution order (mirrors lib/clearTaxClient.buildPayload):
    //   1. source_gstin snapshot frozen on the consignment at create time
    //   2. company_settings state-wise GSTIN
    //   3. branch.branch_gstin
    //   4. WG_GSTIN env
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const stateCode  = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinFor   = consignment.source_gstin || stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    const result = await cancelEInvoice({
      irn:           consignment.irn,
      reasonCode:    reason_code || '1',
      remark:        remark      || 'Duplicate',
      gstinOverride: gstinFor,
    })

    // Trust the library: cancelEInvoice throws if IRP's govt_response.Success
    // isn't 'Y' (or if HTTP fails). If we're past that throw, IRP accepted.
    // Capture whatever ack shape IRP returned for the audit log — varies by
    // tenant (sometimes top-level, sometimes wrapped under data/response).
    const govtResp = result?.govt_response || result?.data?.govt_response || result?.response?.govt_response || result

    const cancelledIrn = consignment.irn
    const actorEmail   = auth.profile?.email || auth.user?.email || 'unknown'
    const REJECTION_REASON = 'Rejected because of cancellation of E-Invoice'

    // Cancelling the E-Invoice voids the consignment as a whole — same semantics
    // as accounts rejecting at approval time. Atomic RPC returns bills to source
    // (if approval_status was 'approved') in the same txn as the status flip.
    const { error: rpcErr } = await supabase.rpc('cancel_consignment_atomic', {
      p_consignment_id: consignment_id,
      p_reason:         REJECTION_REASON,
      p_cancelled_by:   actorEmail,
    })
    if (rpcErr && rpcErr.code !== 'PGRST202') {
      console.error('[einvoice/cancel] cancel_consignment_atomic failed:', rpcErr)
    }

    const nowIso = new Date().toISOString()
    await supabase.from('consignments')
      .update({
        irn:                  null,
        ack_no:               null,
        ack_dt:               null,
        signed_qr_code:       null,
        einvoice_generated_at: null,
        approval_status:      'rejected',
        rejection_reason:     REJECTION_REASON,
        approved_at:          nowIso,
        approved_by:          actorEmail,
      })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type:  'einvoice_cancelled',
      actor_email: actorEmail,
      details:     {
        irn:         cancelledIrn,
        reason_code: reason_code || '1',
        remark:      remark      || 'Duplicate',
        irp_ack:     govtResp,
        auto_rejected: true,
      },
    })

    return Response.json({ success: true })
  } catch (err) {
    console.error('E-Invoice cancel error:', err)
    return Response.json({ error: err.message || 'Failed to cancel E-Invoice' }, { status: 500 })
  }
}
