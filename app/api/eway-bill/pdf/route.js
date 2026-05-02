// app/api/eway-bill/pdf/route.js
// GET ?id=<consignment_id> → returns the E-Way Bill PDF from ClearTax.

import { createClient } from '@supabase/supabase-js'
import { fetchEWayBillPdf } from '../../../../lib/clearTaxClient'
import { REGION_TO_STATE_CODE } from '../../../../lib/stateMap'
import { checkApproval } from '../../../../lib/approvalGate'
import { requireAuth } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const consignmentId    = searchParams.get('id')
    if (!consignmentId) return Response.json({ error: 'id required' }, { status: 400 })

    const gate = await checkApproval(supabase, consignmentId, req, auth)
    if (gate.blocked) return gate.response

    const { data: consignment, error } = await supabase
      .from('consignments').select('eway_bill_no, branch_name, challan_no, tmp_prf_no').eq('id', consignmentId).single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.eway_bill_no) {
      return Response.json({ error: 'No E-Way Bill exists for this consignment yet' }, { status: 400 })
    }

    const { data: branch } = await supabase
      .from('branches').select('branch_gstin, region').eq('name', consignment.branch_name).single()

    // Use the SAME GSTIN that generated this EWB — must be the state-wise GSTIN
    // from company_settings, not the legacy branch.branch_gstin (often the KA HO one).
    // ClearTax error 900201 ("EWayBill not present") means we're querying with a
    // different GSTIN's account context — it can't see EWBs created under another GSTIN.
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const stateCode    = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin   = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinForPdf  = stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    const pdfBuffer = await fetchEWayBillPdf({
      ewbNumbers:    [consignment.eway_bill_no],
      gstinOverride: gstinForPdf,
    })

    const filename = `EWB_${consignment.eway_bill_no}_${(consignment.tmp_prf_no || consignmentId)}.pdf`.replace(/\//g, '-')
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('E-Way Bill PDF error:', err)
    return Response.json({ error: err.message || 'Failed to fetch E-Way Bill PDF' }, { status: 500 })
  }
}
