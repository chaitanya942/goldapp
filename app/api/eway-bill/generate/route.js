// app/api/eway-bill/generate/route.js
// Generate an E-Way Bill via ClearTax for a given consignment.
// Body: { consignment_id }
// On success: stores ewb_no on the consignment row and returns the ClearTax response.

import { createClient } from '@supabase/supabase-js'
import { generateEWayBill } from '../../../../lib/clearTaxClient'
import { estimateDistanceKm } from '../../../../lib/distanceCalc'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Validates GSTIN format: 15 chars, state-code(2) + PAN(10) + entity(1) + Z + checksum(1).
function isValidGstin(gstin) {
  if (!gstin || typeof gstin !== 'string') return false
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.toUpperCase())
}

function isValidPin(pin) {
  return /^[1-9][0-9]{5}$/.test(String(pin || '').trim())
}

function preflightValidate({ consignment, branch, destBranch, items, companySettings }) {
  const errors = []
  const isInternal = consignment.movement_type === 'INTERNAL'
  const dispatcher = branch
  const recipient  = isInternal ? destBranch : null

  if (!dispatcher) errors.push('Source branch record missing')
  if (isInternal && !recipient) errors.push('Destination hub record missing')

  // GSTIN — for OWN_USE, source state determines which GSTIN to use; check it exists
  const stateGstinMap = companySettings.state_gstins || {}
  const dispatcherState = dispatcher?.state || dispatcher?.region
  if (dispatcherState && !stateGstinMap[dispatcherState] && !companySettings.gstin) {
    errors.push(`No GSTIN configured for source state '${dispatcherState}'`)
  }

  if (dispatcher?.branch_gstin && !isValidGstin(dispatcher.branch_gstin)) {
    errors.push(`Source branch GSTIN '${dispatcher.branch_gstin}' is malformed`)
  }
  if (recipient?.branch_gstin && !isValidGstin(recipient.branch_gstin)) {
    errors.push(`Destination GSTIN '${recipient.branch_gstin}' is malformed`)
  }

  // PIN codes
  if (dispatcher && !isValidPin(dispatcher.pin_code)) {
    errors.push(`Source branch PIN '${dispatcher.pin_code || ''}' is invalid (must be 6 digits, not starting with 0)`)
  }
  if (isInternal && recipient && !isValidPin(recipient.pin_code)) {
    errors.push(`Destination hub PIN '${recipient.pin_code || ''}' is invalid`)
  }
  // HO PIN check skipped — clearTaxClient uses HO_DEFAULTS (Bangalore 560095)
  // baked in, so company_settings.ho_pin_code is not required for EWB generation.

  // Address
  if (!dispatcher?.address && !dispatcher?.city) errors.push('Source branch has no address')
  if (isInternal && !recipient?.address && !recipient?.city) errors.push('Destination hub has no address')

  // Items + weight + value
  if (!items || items.length === 0) errors.push('Consignment has no items')
  const totalWeight = (items || []).reduce((s, i) => s + Number(i.net_weight || 0), 0)
  if (totalWeight <= 0) errors.push('Total net weight is 0 — cannot generate EWB')
  const totalValue = (items || []).reduce((s, i) => s + Number(i.total_amount || 0), 0)
  if (totalValue < 50000) {
    // Below 50k threshold EWB isn't legally required — warn, don't block
    // (some businesses generate anyway for documentation)
  }

  // Vehicle info is NOT required at generation time — for gold, the vehicle
  // is often decided at pickup. NIC/ClearTax accepts EWB without it (Part-A only).
  // The vehicle number can be updated via the EWB update-vehicle API later.

  return errors
}

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

    // Atomic lock — only one in-flight EWB generation per consignment.
    // The update succeeds only if ewb_generation_started_at is NULL or older than 5 min (stale).
    const lockCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: lockRow, error: lockErr } = await supabase
      .from('consignments')
      .update({ ewb_generation_started_at: new Date().toISOString() })
      .eq('id', consignment_id)
      .or(`ewb_generation_started_at.is.null,ewb_generation_started_at.lt.${lockCutoff}`)
      .select('id')
      .maybeSingle()
    if (lockErr) console.warn('[EWB] lock acquire warning:', lockErr.message)
    if (!lockRow) {
      return Response.json({ error: 'Another EWB generation is already in progress for this consignment — wait 30 seconds and retry' }, { status: 409 })
    }

    // Helper: release the lock on every error path so user can retry immediately.
    const releaseLock = () => supabase.from('consignments').update({ ewb_generation_started_at: null }).eq('id', consignment_id)

    const { data: branch } = await supabase
      .from('branches').select('*').eq('name', consignment.branch_name).single()
    if (!branch) {
      await releaseLock()
      return Response.json({ error: `Branch '${consignment.branch_name}' not found` }, { status: 404 })
    }

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

    // Pre-flight validation — catch the common errors locally before burning a ClearTax API call.
    const validationErrors = preflightValidate({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} })
    if (validationErrors.length) {
      await releaseLock()
      return Response.json({
        error: 'Pre-flight validation failed — fix these before generating EWB:\n' + validationErrors.join('\n'),
        validation_errors: validationErrors,
      }, { status: 400 })
    }

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
      await releaseLock()
      return Response.json({
        success: false,
        error: 'EWB generated but number could not be extracted from response — see server logs',
        raw: result,
      }, { status: 502 })
    }

    // EWB validity: NIC rule is 1 day per 200 km (rounded up). Min 1 day.
    // For Direct→HO and Hub→HO, HO is hardcoded as Bangalore (Koramangala 560095, KA)
    // — same defaults clearTaxClient uses in its EWB payload.
    const fromPin   = branch?.pin_code
    const toPin     = (consignment.movement_type === 'INTERNAL' ? destBranch?.pin_code : (companySettings?.ho_pin_code || '560095'))
    const toState   = (consignment.movement_type === 'INTERNAL' ? destBranch?.state : 'KA')
    const distKm    = estimateDistanceKm({ fromPin, toPin, fromState: branch?.state, toState }) || 50
    const validDays = Math.max(1, Math.ceil(distKm / 200))
    const validUntil = new Date(Date.now() + validDays * 86400000).toISOString()

    await supabase.from('consignments')
      .update({
        eway_bill_no:                String(ewbNo),
        ewb_generated_at:            new Date().toISOString(),
        ewb_valid_until:             validUntil,
        ewb_generation_started_at:   null,
        cleartax_response:           result,
      })
      .eq('id', consignment_id)

    await logConsignmentEvent(supabase, {
      consignment_id,
      event_type:  'ewb_generated',
      details:     { ewb_no: String(ewbNo), ewb_date: ewbDate, valid_until: validUntil, distance_km: distKm },
    })

    return Response.json({ success: true, ewb_no: ewbNo, ewb_date: ewbDate, valid_until: validUntil })
  } catch (err) {
    console.error('E-Way Bill generate error:', err)
    // Release lock so user can retry
    await supabase.from('consignments').update({ ewb_generation_started_at: null }).eq('id', consignment_id)
    return Response.json({
      error:             err.message || 'E-Way Bill generation failed',
      cleartax_response: err.cleartaxResponse || null,
      outgoing_payload:  err.outgoingPayload  || null,
    }, { status: 500 })
  }
}
