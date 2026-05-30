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
    const { consignment_id, reason_code, remark, force_local } = await req.json()
    if (!consignment_id) return Response.json({ error: 'consignment_id required' }, { status: 400 })

    const { data: consignment, error } = await supabase
      .from('consignments').select('id, tmp_prf_no, eway_bill_no, ewb_generated_at, branch_name, source_gstin, status').eq('id', consignment_id).single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.eway_bill_no) {
      return Response.json({ error: 'No E-Way Bill to cancel for this consignment' }, { status: 400 })
    }

    const actorEmail   = auth.profile?.email || auth.user?.email || 'unknown'
    const cancelledEwb = consignment.eway_bill_no

    // ── Force-local path ──────────────────────────────────────────────────────
    // Admin-only escape hatch when NIC keeps refusing the cancel (24h window
    // expired, already cancelled upstream, NIC outage, GSTIN mismatch we
    // can't fix from our side). Clears the LOCAL state — consignment goes
    // to cancelled, bills return to source, EWB fields cleared — without
    // hitting NIC. The EWB stays in whatever state NIC has it (often
    // expires naturally after 24h). Logged separately so accounts can
    // reconcile later if needed.
    if (force_local) {
      const REJECTION_REASON = `Cancelled locally (NIC bypass): ${remark || 'cleared without NIC confirmation'}`

      const { error: rpcErr } = await supabase.rpc('cancel_consignment_atomic', {
        p_consignment_id: consignment_id,
        p_reason:         REJECTION_REASON,
        p_cancelled_by:   actorEmail,
      })
      if (rpcErr && rpcErr.code !== 'PGRST202') {
        console.error('[ewb/cancel force_local] cancel_consignment_atomic failed:', rpcErr)
        return Response.json({ error: `Local cancel failed: ${rpcErr.message}` }, { status: 500 })
      }

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
        event_type:  'ewb_cancelled_local_only',
        actor_email: actorEmail,
        details: {
          ewb_no:         cancelledEwb,
          remark:         remark || null,
          warning:        'EWB was NOT cancelled on NIC — local state cleared only. Verify the EWB status manually on ewaybillgst.gov.in.',
          tmp_prf_no:     consignment.tmp_prf_no,
        },
      })

      return Response.json({
        success: true,
        force_local: true,
        warning: 'Local state cleared. The E-Way Bill was NOT cancelled on NIC — verify its status on ewaybillgst.gov.in.',
      })
    }

    const { data: branch } = await supabase
      .from('branches').select('branch_gstin, region').eq('name', consignment.branch_name).single()

    // GSTIN MUST match the one used to GENERATE the EWB. If company_settings has
    // been edited since (or the state-wise GSTIN was overridden), re-resolving
    // here can pick a different value and NIC rejects the cancel. The
    // source_gstin snapshot frozen on the consignment is authoritative —
    // same priority order as buildPayload in lib/clearTaxClient.
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const stateCode  = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinFor   = consignment.source_gstin || stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    // Surface the EWB age — NIC won't accept cancellation past 24h.
    const ewbAgeMs = consignment.ewb_generated_at ? (Date.now() - new Date(consignment.ewb_generated_at).getTime()) : null
    const ewbAgeHours = ewbAgeMs != null ? (ewbAgeMs / 3600000) : null

    // NIC EWB cancel reason codes: 1=Duplicate, 2=Order Cancelled,
    // 3=Data Entry Mistake, 4=Others. Default to 1=Duplicate.
    let result
    try {
      result = await cancelEWayBill({
        ewbNumber:     consignment.eway_bill_no,
        reasonCode:    reason_code || '1',
        remark:        remark      || 'Duplicate Entry',
        gstinOverride: gstinFor,
      })
    } catch (clearTaxErr) {
      // Surface every diagnostic detail attached to the error so the UI can
      // show the actual NIC reason — used to be swallowed into the generic
      // 'Failed to cancel E-Way Bill' message.
      //
      // lib/clearTaxClient.js attachDebug stamps the raw NIC payload directly
      // on the Error object as `cleartaxResponse` (non-enumerable property),
      // NOT under `.debug.cleartaxResponse`. Earlier code looked at the
      // wrong path and always got `undefined` — so nic_error_code / text /
      // raw all came back null. Read the actual property here.
      const nicResponse = clearTaxErr?.cleartaxResponse
      const firstResp   = Array.isArray(nicResponse) ? nicResponse[0] : nicResponse
      const govt        = firstResp?.govt_response
      const errorDetails =
        govt?.ErrorDetails || govt?.errorDetails ||
        firstResp?.ErrorDetails || firstResp?.errorDetails ||
        nicResponse?.ErrorDetails || nicResponse?.errorDetails
      const nicErrorCode = Array.isArray(errorDetails)
        ? errorDetails.map(e => e?.error_code   || e?.errorCode).filter(Boolean).join(', ')
        : (govt?.error_code || firstResp?.error_code || null)
      const nicErrorMsg  = Array.isArray(errorDetails)
        ? errorDetails.map(e => e?.error_message || e?.errorMessage || e?.message).filter(Boolean).join('; ')
        : (govt?.info || govt?.status_desc || firstResp?.message || firstResp?.status_desc || null)

      console.error('[ewb/cancel] ClearTax/NIC error:', clearTaxErr?.message, JSON.stringify(nicResponse))

      // Helpful hint about the 24h window when applicable.
      let hint = null
      if (ewbAgeHours != null && ewbAgeHours > 24) {
        hint = `This EWB is ${ewbAgeHours.toFixed(1)}h old — NIC only allows cancellation within 24 hours of generation. Use Force Cancel (Local) to clear our records; the EWB will expire on NIC naturally.`
      }

      return Response.json({
        error:           clearTaxErr?.message || 'Failed to cancel E-Way Bill',
        nic_error_code:  nicErrorCode || null,
        nic_error_text:  nicErrorMsg  || null,
        nic_raw:         nicResponse || null,
        ewb_age_hours:   ewbAgeHours != null ? Number(ewbAgeHours.toFixed(1)) : null,
        hint,
        can_force_local: true,
      }, { status: 502 })
    }

    // 107 from NIC ("EWB not recognised") is NOT a proof of cancellation —
    // it can also mean the EWB exists at NIC under a different GSTIN, or
    // that our request never reached the portal cleanly. Treating 107 as
    // success previously let local state get cleared while the EWB stayed
    // active on the gov portal (the bug accounts spotted).
    //
    // Now: refuse to touch local state. Surface a verification banner so
    // the operator confirms on ewaybillgst.gov.in before clearing anything.
    const ewbNotFound = !!result?.ewb_not_found

    if (ewbNotFound) {
      await logConsignmentEvent(supabase, {
        consignment_id,
        event_type:  'ewb_cancel_not_recognised_at_nic',
        actor_email: actorEmail,
        details: {
          ewb_no:      cancelledEwb,
          reason_code: reason_code || '1',
          remark:      remark      || 'Duplicate Entry',
          nic_raw:     result?.raw || result,
          warning:     'NIC returned 107 (EWB not recognised). Local state NOT modified. Verify on ewaybillgst.gov.in before retrying or clearing manually.',
        },
      })
      return Response.json({
        success: false,
        verification_required: true,
        ewb_no: cancelledEwb,
        portal_url: 'https://ewaybillgst.gov.in/',
        error: 'NIC says this E-Way Bill is not recognised. The cancel did NOT confirm. Verify on the NIC portal — if it shows as active there, the GSTIN may not match the one that issued it; if it shows already cancelled, contact admin to clear local state manually.',
      }, { status: 409 })
    }

    // Real success — NIC accepted with Success='Y'. Capture whatever ack
    // shape NIC returned for the audit log (varies by tenant).
    const govtResp = result?.govt_response || result?.data?.govt_response || result?.response?.govt_response || result
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
