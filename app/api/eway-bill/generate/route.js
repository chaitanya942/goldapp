// app/api/eway-bill/generate/route.js
// Generate an E-Way Bill via ClearTax for a given consignment.
// Body: { consignment_id }
// On success: stores ewb_no on the consignment row and returns the ClearTax response.

import { createClient } from '@supabase/supabase-js'
import { generateEWayBill } from '../../../../lib/clearTaxClient'

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

    if (consignment.eway_bill_no) {
      return Response.json({ error: `E-Way Bill already exists: ${consignment.eway_bill_no}` }, { status: 400 })
    }

    const { data: branch } = await supabase
      .from('branches').select('*').eq('name', consignment.branch_name).single()
    if (!branch) return Response.json({ error: `Branch '${consignment.branch_name}' not found` }, { status: 404 })

    const { data: linkRows } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', consignment_id)
    const purchaseIds = (linkRows || []).map(r => r.purchase_id)
    const { data: items } = await supabase.from('purchases').select('*').in('id', purchaseIds)

    const result = await generateEWayBill({ consignment, branch, items: items || [] })

    // ClearTax response shape: { govt_response: { ewbNo, ewbDate, validUpto, ... } }
    const ewbNo   = result?.govt_response?.ewbNo || result?.ewbNo
    const ewbDate = result?.govt_response?.ewbDate || result?.ewbDate

    if (ewbNo) {
      await supabase.from('consignments')
        .update({ eway_bill_no: String(ewbNo) })
        .eq('id', consignment_id)
    }

    return Response.json({ success: true, ewb_no: ewbNo, ewb_date: ewbDate, raw: result })
  } catch (err) {
    console.error('E-Way Bill generate error:', err)
    return Response.json({ error: err.message || 'E-Way Bill generation failed' }, { status: 500 })
  }
}
