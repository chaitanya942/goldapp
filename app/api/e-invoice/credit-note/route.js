// app/api/e-invoice/credit-note/route.js
//
// Generate a Credit Note IRN that nullifies an originally-issued E-Invoice
// when the 24-hour cancellation window has passed.
//
// Body: { consignment_id, remark? }
// On success: stores credit_note_irn / credit_note_ack_no on the consignment row
// (as new fields — original irn/ack_no are preserved for the audit trail).
//
// Restricted to ADMIN — same gate as cancel.

import { createClient } from '@supabase/supabase-js'
import { generateCreditNote } from '../../../../lib/clearTaxClient'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { loadConsignmentForGeneration } from '../../../../lib/consignmentSnapshot'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  try {
    const { consignment_id, remark } = await req.json()
    if (!consignment_id) return Response.json({ error: 'consignment_id required' }, { status: 400 })

    // Load consignment via snapshot loader so the credit note uses the EXACT same
    // address/items/values as the original invoice — they must mirror perfectly.
    const loaded = await loadConsignmentForGeneration(supabase, consignment_id, auth)
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
    const { consignment, branch, items, companySettings } = loaded

    if (!consignment.irn) {
      return Response.json({ error: 'No original E-Invoice exists — credit note requires an issued IRN to nullify.' }, { status: 400 })
    }
    if (consignment.credit_note_irn) {
      return Response.json({ error: `Credit Note already issued (${consignment.credit_note_irn}). The original IRN ${consignment.irn} is already nullified.` }, { status: 400 })
    }

    const result = await generateCreditNote({
      originalConsignment: consignment,
      branch,
      items: items || [],
      companySettings: companySettings || {},
      remark: remark || 'Reversal — wrong invoice issued',
    })

    // Extract the new IRN/ack from the IRP response.
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
    const cnIrn   = pick(['Irn', 'irn', 'IRN'])
    const cnAckNo = pick(['AckNo', 'ackNo', 'ack_no'])
    const cnAckDt = pick(['AckDt', 'ackDt', 'ack_dt'])

    if (!cnIrn) {
      return Response.json({
        success: false,
        error: 'Credit Note generated but IRN not found in response. Check server logs.',
      }, { status: 502 })
    }

    // Persist the credit note. We store it ALONGSIDE the original irn so the
    // audit trail shows both. credit_note_irn is the nullifier; original irn
    // is what NIC has on its books — both surface in GSTR-1.
    await supabase.from('consignments').update({
      credit_note_irn:           cnIrn,
      credit_note_ack_no:        cnAckNo,
      credit_note_ack_dt:        cnAckDt,
      credit_note_generated_at:  new Date().toISOString(),
      credit_note_response:      result,
    }).eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type:  'credit_note_generated',
      actor_email: auth.profile?.email || auth.user?.email || 'unknown',
      details:     {
        original_irn: consignment.irn,
        credit_note_irn: cnIrn,
        ack_no: cnAckNo,
        remark: remark || 'Reversal — wrong invoice issued',
      },
    })

    return Response.json({ success: true, irn: cnIrn, ack_no: cnAckNo, ack_dt: cnAckDt })
  } catch (err) {
    console.error('Credit Note generate error:', err)
    return Response.json({ error: err.message || 'Credit Note generation failed' }, { status: 500 })
  }
}
