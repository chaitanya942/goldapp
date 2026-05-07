// app/api/eway-bill/cancel/route.js
// Cancel an E-Way Bill (must be done within 24 hours of generation per GSTN rules).
// Body: { consignment_id, reason_code?, remark? }
// Cancellation is destructive — restricted to ADMIN role group.

import { createClient } from '@supabase/supabase-js'
import { cancelEWayBill } from '../../../../lib/clearTaxClient'
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
      .from('consignments').select('eway_bill_no, branch_name').eq('id', consignment_id).single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.eway_bill_no) {
      return Response.json({ error: 'No E-Way Bill to cancel for this consignment' }, { status: 400 })
    }

    const { data: branch } = await supabase
      .from('branches').select('branch_gstin, region').eq('name', consignment.branch_name).single()

    // Cancel must use the same GSTIN that generated the EWB (state-wise GSTIN, not legacy KA one)
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const stateCode  = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinFor   = stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    // NIC EWB cancel reason codes: 1=Duplicate, 2=Order Cancelled,
    // 3=Data Entry Mistake, 4=Others. Default to 1=Duplicate.
    const result = await cancelEWayBill({
      ewbNumber:     consignment.eway_bill_no,
      reasonCode:    reason_code || '1',
      remark:        remark      || 'Duplicate Entry',
      gstinOverride: gstinFor,
    })

    // Trust the library: cancelEWayBill throws if NIC's govt_response.Success
    // isn't 'Y' (or if HTTP fails). If we're past that throw, NIC accepted.
    // Capture whatever ack shape NIC returned for the audit log — varies by
    // tenant (sometimes top-level, sometimes wrapped under data/response).
    const govtResp = result?.govt_response || result?.data?.govt_response || result?.response?.govt_response || result

    const cancelledEwb = consignment.eway_bill_no
    const actorEmail   = auth.profile?.email || auth.user?.email || 'unknown'
    const REJECTION_REASON = 'Rejected because of cancellation of EWB'

    // Cancelling the EWB voids the consignment as a whole. Operator's only path
    // forward is to recreate with the same (or corrected) bills — same semantics
    // as accounts rejecting at approval time. Use the atomic RPC so bills are
    // returned to source (if approval_status was 'approved') in the same txn
    // as the status flip — race-safe under concurrent receive attempts.
    const { error: rpcErr } = await supabase.rpc('cancel_consignment_atomic', {
      p_consignment_id: consignment_id,
      p_reason:         REJECTION_REASON,
      p_cancelled_by:   actorEmail,
    })
    if (rpcErr && rpcErr.code !== 'PGRST202') {
      // PGRST202 means the RPC isn't deployed — fall through to manual update.
      // Any other error is real: surface it but don't unwind the NIC cancel
      // (NIC is already cancelled, only the local state is inconsistent).
      console.error('[ewb/cancel] cancel_consignment_atomic failed:', rpcErr)
    }

    // Clear EWB fields + flip approval_status to rejected. Done after the RPC
    // so the RPC's "already cancelled" guard doesn't trip on a row we just
    // cancelled. status='cancelled' is set by the RPC; we just add the
    // approval-side fields the RPC doesn't touch.
    const nowIso = new Date().toISOString()
    await supabase.from('consignments')
      .update({
        eway_bill_no:                null,
        ewb_valid_until:             null,
        ewb_generated_at:            null,
        ewb_generation_started_at:   null,
        approval_status:             'rejected',
        rejection_reason:            REJECTION_REASON,
        approved_at:                 nowIso,
        approved_by:                 actorEmail,
      })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type:  'ewb_cancelled',
      actor_email: actorEmail,
      details:     {
        ewb_no:      cancelledEwb,
        reason_code: reason_code || '1',
        remark:      remark      || 'Duplicate Entry',
        nic_ack:     govtResp,
        auto_rejected: true,
      },
    })

    return Response.json({ success: true })
  } catch (err) {
    console.error('E-Way Bill cancel error:', err)
    return Response.json({ error: err.message || 'Failed to cancel E-Way Bill' }, { status: 500 })
  }
}
