// app/api/e-invoice/generate/route.js
// Generate an E-Invoice (IRN) via ClearTax / IRP for a consignment.
// Body: { consignment_id }
// On success: stores irn / ack_no / ack_dt / signed_qr_code on the consignment row.

import { createClient } from '@supabase/supabase-js'
import { generateEInvoice } from '../../../../lib/clearTaxClient'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { REGION_TO_STATE_CODE } from '../../../../lib/stateMap'
import { loadConsignmentForGeneration } from '../../../../lib/consignmentSnapshot'
import { checkWorkflow } from '../../../../lib/workflowGate'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

function isValidGstin(gstin) {
  if (!gstin || typeof gstin !== 'string') return false
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.toUpperCase())
}

function isValidPin(pin) {
  return /^[1-9][0-9]{5}$/.test(String(pin || '').trim())
}

export async function POST(req) {
  // Accounts owns GST documents — they generate as part of approval review.
  // Operations can no longer generate; they only download once approved.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response
  try {
    const { consignment_id } = await req.json()
    if (!consignment_id) return Response.json({ error: 'consignment_id required' }, { status: 400 })

    // Sequential workflow gate: voucher / challan must have been generated first.
    const wf = await checkWorkflow(supabase, consignment_id, auth, 'einvoice_generate')
    if (wf.blocked) return wf.response

    // Snapshot-first load (consignment + branch + items + companySettings).
    const loaded = await loadConsignmentForGeneration(supabase, consignment_id, auth)
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
    const { consignment, branch, items, companySettings } = loaded

    if (consignment.status === 'cancelled') {
      return Response.json({ error: `${consignment.tmp_prf_no} is cancelled. Cannot generate an E-Invoice against a cancelled consignment.` }, { status: 400 })
    }
    if (consignment.approval_status === 'rejected') {
      return Response.json({ error: `${consignment.tmp_prf_no} was rejected. Cannot generate an E-Invoice.` }, { status: 400 })
    }
    if (consignment.irn) {
      return Response.json({ error: `E-Invoice already exists: ${consignment.irn}` }, { status: 400 })
    }

    // Resolve seller GSTIN from company_settings.gstin_<state> (preferred) → branch.branch_gstin → env.
    // Use the shared region→state-code map so adding a new state in stateMap.js
    // automatically propagates here (and avoids the previous drift bug).
    const stateCode = REGION_TO_STATE_CODE[branch.region]
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
        error: `Seller and buyer GSTINs are the same (${sellerGstin}). E-Invoice requires distinct GSTINs. This typically means an intra-state Karnataka move, which does not legally need an E-Invoice. Use only the E-Way Bill instead.`,
      }, { status: 400 })
    }
    if (!isValidGstin(sellerGstin)) {
      return Response.json({ error: `Seller GSTIN '${sellerGstin}' is malformed. Fix it in Admin → Company Settings.` }, { status: 400 })
    }
    if (!isValidGstin(buyerGstin)) {
      return Response.json({ error: `Buyer (HO) GSTIN '${buyerGstin}' is malformed. Fix it in Admin → Company Settings.` }, { status: 400 })
    }
    if (!branch.address || !branch.pin_code) {
      return Response.json({ error: `Branch '${branch.name}' is missing address or PIN. Fill them in Branch Management.` }, { status: 400 })
    }
    if (!isValidPin(branch.pin_code)) {
      return Response.json({ error: `Branch '${branch.name}' PIN '${branch.pin_code}' is invalid (must be 6 digits, not starting with 0).` }, { status: 400 })
    }

    // Item-level preflight — same as EWB. NIC IRP rejects line items with
    // zero weight/quantity/value, but the error message is generic. Catch it here.
    if (!items || items.length === 0) {
      return Response.json({ error: 'Consignment has no items.' }, { status: 400 })
    }
    const totalGross = items.reduce((s, i) => s + Number(i.gross_weight || i.net_weight || 0), 0)
    if (totalGross <= 0) {
      return Response.json({ error: 'Total weight is 0; cannot generate an E-Invoice.' }, { status: 400 })
    }
    const totalValue = items.reduce((s, i) => s + Number(i.total_amount || 0), 0)
    if (totalValue <= 0) {
      return Response.json({ error: 'Total value is 0; cannot generate an E-Invoice.' }, { status: 400 })
    }

    const result = await generateEInvoice({ consignment, branch, items: items || [], companySettings: companySettings || {} })
    // Full response (with redaction) is logged by ctaxLog inside lib/clearTaxClient.js.

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
      // Don't echo `result` to the client — it contains GSTINs / addresses /
      // signed QR JWT. Server-side ctaxLog already captured a redacted copy.
      return Response.json({
        success: false,
        error:   'IRN not found in response. See server logs for details.',
      }, { status: 502 })
    }

    await supabase.from('consignments')
      .update({ irn, ack_no: ackNo, ack_dt: ackDt, signed_qr_code: signedQrCode, einvoice_generated_at: new Date().toISOString() })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type:  'einvoice_generated',
      actor_email: auth.profile?.email || auth.user?.email || 'unknown',
      details:     { irn, ack_no: ackNo, ack_dt: ackDt },
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
