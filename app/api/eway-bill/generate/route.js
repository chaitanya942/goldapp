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

    // For Branch → Hub (INTERNAL) consignments, fetch the destination hub too
    let destBranch = null
    if (consignment.movement_type === 'INTERNAL' && consignment.dest_branch) {
      const { data } = await supabase.from('branches').select('*').eq('name', consignment.dest_branch).single()
      destBranch = data || null
    }

    const { data: linkRows } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', consignment_id)
    const purchaseIds = (linkRows || []).map(r => r.purchase_id)
    const { data: items } = await supabase.from('purchases').select('*').in('id', purchaseIds)

    const { data: companySettings } = await supabase.from('company_settings').select('*').single()

    const result = await generateEWayBill({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} })

    // Log full response so we can adjust extraction if ClearTax response shape changes
    console.log('[EWB] ClearTax response:', JSON.stringify(result, null, 2))

    // ClearTax/GSTN response uses inconsistent casing — check every plausible path.
    const sources = [result?.govt_response, result?.data, result?.response, result]
    const pickFromSrc = (src, keys) => {
      if (!src || typeof src !== 'object') return null
      for (const k of keys) {
        const v = src[k]
        if (v != null && String(v).trim()) return String(v)
      }
      return null
    }
    const ewbNo = sources.map(s => pickFromSrc(s, ['ewbNo', 'EwbNo', 'EWB_NO', 'eway_bill_number', 'ewayBillNumber'])).find(Boolean)
    const ewbDate = sources.map(s => pickFromSrc(s, ['ewbDate', 'EwbDate', 'eway_bill_date'])).find(Boolean)

    if (!ewbNo) {
      // Generation may have succeeded but we couldn't parse the number — surface raw for debugging
      return Response.json({
        success: false,
        error: 'EWB generated but number could not be extracted from response — see server logs',
        raw: result,
      }, { status: 502 })
    }

    await supabase.from('consignments')
      .update({ eway_bill_no: String(ewbNo) })
      .eq('id', consignment_id)

    return Response.json({ success: true, ewb_no: ewbNo, ewb_date: ewbDate })
  } catch (err) {
    console.error('E-Way Bill generate error:', err)
    return Response.json({
      error:             err.message || 'E-Way Bill generation failed',
      cleartax_response: err.cleartaxResponse || null,
      outgoing_payload:  err.outgoingPayload  || null,
    }, { status: 500 })
  }
}
