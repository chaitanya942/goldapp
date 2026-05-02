// app/api/e-invoice/generate/route.js
// Generate an E-Invoice (IRN) via ClearTax / IRP for a consignment.
// Body: { consignment_id }
// On success: stores irn / ack_no / ack_dt / signed_qr_code on the consignment row.

import { createClient } from '@supabase/supabase-js'
import { generateEInvoice } from '../../../../lib/clearTaxClient'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'

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

    const { data: companySettings } = await supabase.from('company_settings').select('*').single()

    // Resolve seller GSTIN from company_settings.gstin_<state> (preferred) → branch.branch_gstin → env
    const stateCode = ({ 'Andhra Pradesh': 'AP', 'Kerala': 'KL', 'Telangana': 'TS', 'Tamil Nadu': 'TN', 'Rest of Karnataka': 'KA', 'Bangalore': 'KA' })[branch.region]
    const stateGstinField = stateCode ? `gstin_${stateCode.toLowerCase()}` : null
    const sellerGstin = (stateGstinField && companySettings?.[stateGstinField]) || branch.branch_gstin || process.env.WG_GSTIN
    const buyerGstin  = companySettings?.gstin_ka || companySettings?.gstin || process.env.WG_GSTIN

    if (!sellerGstin) {
      return Response.json({ error: `No GSTIN found for ${branch.region}. Set 'GSTIN_${stateCode}' in Admin → Company Settings.` }, { status: 400 })
    }
    if (!buyerGstin) {
      return Response.json({ error: `No HO GSTIN configured. Set 'GSTIN' or 'GSTIN_KA' in Admin → Company Settings.` }, { status: 400 })
    }
    if (sellerGstin === buyerGstin) {
      return Response.json({
        error: `Seller and buyer GSTINs are the same (${sellerGstin}). E-Invoice requires distinct GSTINs — this happens for intra-state Karnataka moves, which don't legally need an E-Invoice. Use only the E-Way Bill instead.`,
      }, { status: 400 })
    }
    if (!branch.address || !branch.pin_code) {
      return Response.json({ error: `Branch '${branch.name}' is missing address or PIN. Fill them in Branch Management.` }, { status: 400 })
    }

    const { data: linkRows } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', consignment_id)
    const purchaseIds = (linkRows || []).map(r => r.purchase_id)
    const { data: items } = await supabase.from('purchases').select('*').in('id', purchaseIds)

    const result = await generateEInvoice({ consignment, branch, items: items || [], companySettings: companySettings || {} })
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
      .update({ irn, ack_no: ackNo, ack_dt: ackDt, signed_qr_code: signedQrCode, einvoice_generated_at: new Date().toISOString() })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type: 'einvoice_generated',
      details:    { irn, ack_no: ackNo, ack_dt: ackDt },
    })

    return Response.json({ success: true, irn, ack_no: ackNo, ack_dt: ackDt })
  } catch (err) {
    console.error('E-Invoice generate error:', err)
    // Debug payloads stay server-side only (see ctaxLog in lib/clearTaxClient.js).
    return Response.json({
      error: err.message || 'E-Invoice generation failed',
    }, { status: 500 })
  }
}
