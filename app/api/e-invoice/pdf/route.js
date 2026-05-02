// app/api/e-invoice/pdf/route.js
// GET ?id=<consignment_id> → returns the signed E-Invoice PDF (with QR code).

import { createClient } from '@supabase/supabase-js'
import { fetchEInvoicePdf } from '../../../../lib/clearTaxClient'
import { REGION_TO_STATE_CODE } from '../../../../lib/stateMap'

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
      .from('consignments')
      .select('irn, branch_name, tmp_prf_no')
      .eq('id', consignmentId)
      .single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.irn) {
      return Response.json({ error: 'No E-Invoice has been generated for this consignment' }, { status: 400 })
    }

    // Use the GSTIN that generated the IRN (state-wise from company_settings)
    const { data: branch } = await supabase
      .from('branches').select('branch_gstin, region').eq('name', consignment.branch_name).single()
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()
    const stateCode    = REGION_TO_STATE_CODE[branch?.region]
    const stateGstin   = stateCode ? companySettings?.[`gstin_${stateCode.toLowerCase()}`] : null
    const gstinForPdf  = stateGstin || branch?.branch_gstin || process.env.WG_GSTIN

    const pdfBuffer = await fetchEInvoicePdf({
      irn:           consignment.irn,
      gstinOverride: gstinForPdf,
    })

    const filename = `EInvoice_${consignment.tmp_prf_no || consignmentId}.pdf`.replace(/\//g, '-')
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('E-Invoice PDF error:', err)
    return Response.json({ error: err.message || 'Failed to fetch E-Invoice PDF' }, { status: 500 })
  }
}
