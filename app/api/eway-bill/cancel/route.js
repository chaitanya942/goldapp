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

    // Defensive verification: cancelEWayBill throws on outright failure, but a
    // 200 with missing/false govt_response (rare ClearTax soft-fail shape) would
    // slip past. Only clear the local doc number once we have explicit Y from NIC.
    const govtResp = result?.govt_response || result?.[0]?.govt_response
    const success  = String(govtResp?.Success ?? '').trim().toUpperCase()
    if (success !== 'Y' && success !== '1' && success !== 'TRUE') {
      console.error('[ewb/cancel] NIC did not confirm cancel; preserving local EWB no.', { result })
      return Response.json({
        error: 'NIC did not confirm cancellation. The E-Way Bill remains active locally — check NIC portal directly.',
        cleartax_response: result,
      }, { status: 502 })
    }

    const cancelledEwb = consignment.eway_bill_no
    await supabase.from('consignments')
      .update({ eway_bill_no: null, ewb_valid_until: null, ewb_generated_at: null, ewb_generation_started_at: null })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type:  'ewb_cancelled',
      actor_email: auth.profile?.email || auth.user?.email || 'unknown',
      details:     {
        ewb_no:      cancelledEwb,
        reason_code: reason_code || '1',
        remark:      remark      || 'Duplicate Entry',
        nic_ack:     govtResp,
      },
    })

    return Response.json({ success: true })
  } catch (err) {
    console.error('E-Way Bill cancel error:', err)
    return Response.json({ error: err.message || 'Failed to cancel E-Way Bill' }, { status: 500 })
  }
}
