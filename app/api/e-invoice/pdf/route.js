// app/api/e-invoice/pdf/route.js
// GET ?id=<consignment_id> → returns a printable E-Invoice PDF.
//
// ClearTax/IRP doesn't expose a "give me the PDF" endpoint — it only returns
// the signed JSON. So we render the PDF ourselves using the stored signed
// data + the QR code (SignedQRCode JWT) for NIC verification.

import { createClient } from '@supabase/supabase-js'
import { generateEInvoicePdf } from '../../../../lib/generateEInvoicePdf'
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
      .from('consignments')
      .select('*')
      .eq('id', consignmentId)
      .single()
    if (error || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!consignment.irn) {
      return Response.json({ error: 'No E-Invoice has been generated for this consignment' }, { status: 400 })
    }

    const { data: branch } = await supabase
      .from('branches').select('*').eq('name', consignment.branch_name).single()

    const { data: linkRows } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', consignmentId)
    const purchaseIds = (linkRows || []).map(r => r.purchase_id)
    const { data: items } = await supabase.from('purchases').select('*').in('id', purchaseIds)

    const { data: companySettings } = await supabase.from('company_settings').select('*').single()

    // Pull signed QR code from cleartax_response (saved at generation time).
    // Path may vary across ClearTax SDK versions — check all known shapes.
    const ct = consignment.cleartax_response || {}
    const govt = ct.govt_response || ct.data?.govt_response || ct.transaction?.govt_response || ct
    const signedQrCode = govt.SignedQRCode || govt.signed_qr_code || consignment.signed_qr_code || null

    const pdfBuffer = await generateEInvoicePdf({
      consignment,
      branch:          branch || {},
      items:           items  || [],
      companySettings: companySettings || {},
      irn:             consignment.irn,
      ackNo:           consignment.ack_no,
      ackDt:           consignment.ack_dt,
      signedQrCode,
    })

    const filename = `EInvoice_${(consignment.tmp_prf_no || consignmentId)}.pdf`.replace(/\//g, '-')
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('E-Invoice PDF error:', err)
    return Response.json({ error: err.message || 'Failed to render E-Invoice PDF' }, { status: 500 })
  }
}
