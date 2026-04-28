// app/api/eway-bill/pdf/route.js
// GET ?id=<consignment_id> → returns the E-Way Bill PDF from ClearTax.

import { createClient } from '@supabase/supabase-js'
import { fetchEWayBillPdf } from '../../../../lib/clearTaxClient'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const consignmentId    = searchParams.get('id')
    if (!consignmentId) return Response.json({ error: 'id required' }, { status: 400 })

    const { data: consignment, error } = await supabase
      .from('consignments').select('eway_bill_no, branch_name, challan_no, tmp_prf_no').eq('id', consignmentId).single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.eway_bill_no) {
      return Response.json({ error: 'No E-Way Bill exists for this consignment yet' }, { status: 400 })
    }

    const { data: branch } = await supabase
      .from('branches').select('branch_gstin').eq('name', consignment.branch_name).single()

    const pdfBuffer = await fetchEWayBillPdf({
      ewbNumbers:    [consignment.eway_bill_no],
      gstinOverride: branch?.branch_gstin,
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
