// app/api/eway-bill/cancel/route.js
// Cancel an E-Way Bill (must be done within 24 hours of generation per GSTN rules).
// Body: { consignment_id, reason_code?, remark? }

import { createClient } from '@supabase/supabase-js'
import { cancelEWayBill } from '../../../../lib/clearTaxClient'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
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
    const REGION_TO_STATE_CODE = { 'Andhra Pradesh': 'AP', 'Kerala': 'KL', 'Telangana': 'TS', 'Tamil Nadu': 'TN', 'Rest of Karnataka': 'KA', 'Bangalore': 'KA' }
    const stateCode  = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinFor   = stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    const result = await cancelEWayBill({
      ewbNumber:     consignment.eway_bill_no,
      reasonCode:    reason_code || 'DUPLICATE',
      remark:        remark      || 'Duplicate Entry',
      gstinOverride: gstinFor,
    })

    const cancelledEwb = consignment.eway_bill_no
    await supabase.from('consignments')
      .update({ eway_bill_no: null, ewb_valid_until: null, ewb_generated_at: null })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type: 'ewb_cancelled',
      details:    { ewb_no: cancelledEwb, reason_code: reason_code || 'DUPLICATE', remark: remark || 'Duplicate Entry' },
    })

    return Response.json({ success: true, raw: result })
  } catch (err) {
    console.error('E-Way Bill cancel error:', err)
    return Response.json({ error: err.message || 'Failed to cancel E-Way Bill' }, { status: 500 })
  }
}
