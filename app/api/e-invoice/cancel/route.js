// app/api/e-invoice/cancel/route.js
// Cancel an E-Invoice (must be done within 24 hours per IRP rules).
// Body: { consignment_id, reason_code?, remark? }

import { createClient } from '@supabase/supabase-js'
import { cancelEInvoice } from '../../../../lib/clearTaxClient'
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
      .from('consignments').select('irn, branch_name').eq('id', consignment_id).single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.irn) return Response.json({ error: 'No E-Invoice to cancel' }, { status: 400 })

    const { data: branch } = await supabase
      .from('branches').select('branch_gstin, region').eq('name', consignment.branch_name).single()

    // Mirror generate path — resolve state-wise GSTIN, fall back to branch-level, then env.
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const REGION_TO_STATE_CODE = { 'Andhra Pradesh': 'AP', 'Kerala': 'KL', 'Telangana': 'TS', 'Tamil Nadu': 'TN', 'Rest of Karnataka': 'KA', 'Bangalore': 'KA' }
    const stateCode  = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinFor   = stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    const result = await cancelEInvoice({
      irn:           consignment.irn,
      reasonCode:    reason_code || '1',
      remark:        remark      || 'Duplicate',
      gstinOverride: gstinFor,
    })

    const cancelledIrn = consignment.irn
    await supabase.from('consignments')
      .update({ irn: null, ack_no: null, ack_dt: null, signed_qr_code: null, einvoice_generated_at: null })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type: 'einvoice_cancelled',
      details:    { irn: cancelledIrn, reason_code: reason_code || '1', remark: remark || 'Duplicate' },
    })

    return Response.json({ success: true, raw: result })
  } catch (err) {
    console.error('E-Invoice cancel error:', err)
    return Response.json({ error: err.message || 'Failed to cancel E-Invoice' }, { status: 500 })
  }
}
