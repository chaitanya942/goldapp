// app/api/e-invoice/generate/route.js
// Generate an E-Invoice (IRN) via ClearTax / IRP for a consignment.
// Body: { consignment_id }
// On success: stores irn / ack_no / ack_dt / signed_qr_code on the consignment row.

import { createClient } from '@supabase/supabase-js'
import { generateEInvoice } from '../../../../lib/clearTaxClient'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  try {
    const { consignment_id } = await req.json()
    if (!consignment_id) return Response.json({ error: 'consignment_id required' }, { status: 400 })

    const { data: consignment, error: ce } = await supabase
      .from('consignments').select('*').eq('id', consignment_id).single()
    if (ce || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (consignment.irn) return Response.json({ error: `E-Invoice already exists: ${consignment.irn}` }, { status: 400 })

    const { data: branch } = await supabase
      .from('branches').select('*').eq('name', consignment.branch_name).single()
    if (!branch) return Response.json({ error: `Branch '${consignment.branch_name}' not found` }, { status: 404 })

    const { data: linkRows } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', consignment_id)
    const purchaseIds = (linkRows || []).map(r => r.purchase_id)
    const { data: items } = await supabase.from('purchases').select('*').in('id', purchaseIds)

    const result = await generateEInvoice({ consignment, branch, items: items || [] })
    console.log('[E-Invoice] ClearTax response:', JSON.stringify(result, null, 2))

    // Robust extraction across response shapes
    const sources = [result?.govt_response, result?.data, result?.response, result]
    const pick = (keys) => {
      for (const s of sources) {
        if (!s || typeof s !== 'object') continue
        for (const k of keys) {
          const v = s[k]
          if (v != null && String(v).trim()) return String(v)
        }
      }
      return null
    }
    const irn          = pick(['Irn', 'irn', 'IRN'])
    const ackNo        = pick(['AckNo', 'ackNo', 'ack_no'])
    const ackDt        = pick(['AckDt', 'ackDt', 'ack_dt'])
    const signedQrCode = pick(['SignedQRCode', 'signedQRCode', 'signed_qr_code'])

    if (!irn) {
      return Response.json({
        success: false,
        error:   'IRN not found in response — see server logs',
        raw:     result,
      }, { status: 502 })
    }

    await supabase.from('consignments')
      .update({ irn, ack_no: ackNo, ack_dt: ackDt, signed_qr_code: signedQrCode })
      .eq('id', consignment_id)

    return Response.json({ success: true, irn, ack_no: ackNo, ack_dt: ackDt })
  } catch (err) {
    console.error('E-Invoice generate error:', err)
    return Response.json({
      error:    err.message || 'E-Invoice generation failed',
      // Surface the actual payload + ClearTax response so the user can see what was rejected
      // without needing to dig through Railway logs.
      cleartax_response: err.cleartaxResponse || null,
      outgoing_payload:  err.outgoingPayload  || null,
    }, { status: 500 })
  }
}
