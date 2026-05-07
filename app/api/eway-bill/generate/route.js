// app/api/eway-bill/generate/route.js
// Generate an E-Way Bill via ClearTax for a given consignment.
// Body: { consignment_id }
// On success: stores ewb_no on the consignment row and returns the ClearTax response.

import { createClient } from '@supabase/supabase-js'
import { generateEWayBill } from '../../../../lib/clearTaxClient'
import { estimateDistanceKm } from '../../../../lib/distanceCalc'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { loadConsignmentForGeneration } from '../../../../lib/consignmentSnapshot'
import { checkWorkflow } from '../../../../lib/workflowGate'
import {
  validateConsignmentStatus,
  validateBranchReadiness,
  validateItemTotals,
} from '../../../../lib/gstDocPreflight'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Composes the shared validators into the EWB-specific preflight. Includes
// the source-state-GSTIN check that's unique to EWB (uses state_gstins map
// rather than the gstin_<code> column flow that E-Invoice uses).
function preflightValidate({ consignment, branch, destBranch, items, companySettings }) {
  const isInternal = consignment.movement_type === 'INTERNAL'
  const errors = [
    ...validateConsignmentStatus(consignment, 'an E-Way Bill'),
    ...validateBranchReadiness(branch, 'source'),
    ...(isInternal ? validateBranchReadiness(destBranch, 'destination') : []),
    ...validateItemTotals(items, 'an E-Way Bill', { weightField: 'gross_weight' }),
  ]

  // EWB-specific: when a state_gstins map is configured, ensure the source
  // state has a GSTIN (otherwise sender section is built from fallback values
  // that NIC won't accept on OWN_USE).
  const stateGstinMap = companySettings?.state_gstins || {}
  const dispatcherState = branch?.state || branch?.region
  if (dispatcherState && !stateGstinMap[dispatcherState] && !companySettings?.gstin) {
    errors.push(`No GSTIN configured for source state '${dispatcherState}'`)
  }

  // Vehicle info is NOT required at generation time — for gold, the vehicle
  // is often decided at pickup. NIC/ClearTax accepts EWB without it (Part-A
  // only). Vehicle can be updated later via the EWB update-vehicle API.
  return errors
}

export async function POST(req) {
  // Accounts owns GST documents — they generate as part of approval review.
  // Operations can no longer generate; they only download once approved.
  // ROLE_GROUPS.ACCOUNTS includes super_admin / founders_office / accounts.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response
  try {
    const { consignment_id } = await req.json()
    if (!consignment_id) return Response.json({ error: 'consignment_id required' }, { status: 400 })

    // Sequential workflow gate: voucher / challan must have been generated first.
    const wf = await checkWorkflow(supabase, consignment_id, auth, 'ewb_generate')
    if (wf.blocked) return wf.response

    // Single source of truth: snapshot loader returns consignment + branch + destBranch + items + companySettings
    // with snapshot-first resolution. Avoids divergent re-fetch logic across doc routes.
    const loaded = await loadConsignmentForGeneration(supabase, consignment_id, auth)
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
    const { consignment, branch, destBranch, items, companySettings } = loaded

    // Refuse to fire NIC for a cancelled / rejected consignment.
    if (consignment.status === 'cancelled') {
      return Response.json({ error: `${consignment.tmp_prf_no} is cancelled. Cannot generate an E-Way Bill against a cancelled consignment.` }, { status: 400 })
    }
    if (consignment.approval_status === 'rejected') {
      return Response.json({ error: `${consignment.tmp_prf_no} was rejected. Cannot generate an E-Way Bill.` }, { status: 400 })
    }
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
      return Response.json({ error: 'Another E-Way Bill generation is already in progress for this consignment. Wait 30 seconds and retry.' }, { status: 409 })
    }

    // Helper: release the lock on every error path so user can retry immediately.
    const releaseLock = () => supabase.from('consignments').update({ ewb_generation_started_at: null }).eq('id', consignment_id)

    // Pre-flight validation — catch the common errors locally before burning a ClearTax API call.
    const validationErrors = preflightValidate({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} })
    if (validationErrors.length) {
      await releaseLock()
      return Response.json({
        error: 'Pre-flight validation failed. Fix these before generating the E-Way Bill:\n' + validationErrors.join('\n'),
        validation_errors: validationErrors,
      }, { status: 400 })
    }

    const result = await generateEWayBill({ consignment, branch, destBranch, items: items || [], companySettings: companySettings || {} })
    // Redacted copy of the response is already logged by ctaxLog (lib/clearTaxClient.js).

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
      // Don't echo `result` — it contains GSTINs and goods/value details.
      // Redacted copy is in server logs.
      await releaseLock()
      return Response.json({
        success: false,
        error: 'E-Way Bill was generated but the number could not be extracted from the response. See server logs for details.',
      }, { status: 502 })
    }

    // ── Defensive freshness check ───────────────────────────────────────
    // NIC silently returns the EXISTING EWB when DocNo collides with one
    // already on its books (the 2026-05-07 incident: a wiped DB recycled
    // WG000001, NIC returned the May-3 EWB for that DocNo). The returned
    // ewbDate would be days old; reject and force the operator to bump
    // the TMP_PRF generator past the historical max.
    if (ewbDate) {
      // ewbDate format from NIC: 'DD/MM/YYYY HH:MM:SS' or 'DD/MM/YYYY HH:MM AM'
      const m = String(ewbDate).match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (m) {
        const [, dd, mm, yyyy] = m
        const ewbDayMs = new Date(`${yyyy}-${mm}-${dd}T00:00:00+05:30`).getTime()
        const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // YYYY-MM-DD
        const todayMs  = new Date(`${todayIst}T00:00:00+05:30`).getTime()
        const daysOld  = Math.round((todayMs - ewbDayMs) / 86400000)
        if (daysOld >= 1) {
          await releaseLock()
          // Surface the stale EWB number so operators can verify on the NIC portal
          // (and so the activity log has a paper trail of what NIC returned).
          return Response.json({
            success: false,
            error: `NIC returned a stale E-Way Bill (${ewbNo}, dated ${ewbDate}, ${daysOld} day${daysOld === 1 ? '' : 's'} old) instead of generating a fresh one. This usually means the consignment's DocNo (${consignment.tmp_prf_no}) was already used on NIC's books. Cancel this consignment locally, run sql/consignment_doc_history.sql to advance the TMP_PRF sequence past the historical max, and re-create with a fresh number.`,
            stale_ewb_no:   String(ewbNo),
            stale_ewb_date: String(ewbDate),
          }, { status: 409 })
        }
      }
    }

    // EWB validity: NIC rule is 1 day per 200 km (rounded up). Min 1 day.
    // HO PIN/state read from company_settings (admin-editable). Final fallback
    // is the same Bangalore HO that clearTaxClient uses for its EWB payload.
    const fromPin   = branch?.pin_code
    const toPin     = (consignment.movement_type === 'INTERNAL' ? destBranch?.pin_code : (companySettings?.head_office_pin || companySettings?.ho_pin_code || '560095'))
    const toState   = (consignment.movement_type === 'INTERNAL' ? destBranch?.state : (companySettings?.head_office_state || 'KA'))
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
      actor_email: auth.profile?.email || auth.user?.email || 'unknown',
      details:     { ewb_no: String(ewbNo), ewb_date: ewbDate, valid_until: validUntil, distance_km: distKm },
    })

    return Response.json({ success: true, ewb_no: ewbNo, ewb_date: ewbDate, valid_until: validUntil })
  } catch (err) {
    console.error('E-Way Bill generate error:', err)
    // Always release the lock (success or failure) so user can retry.
    try { await supabase.from('consignments').update({ ewb_generation_started_at: null }).eq('id', consignment_id) } catch {}
    // Debug payloads (cleartax_response / outgoing_payload) are intentionally NOT echoed
    // to the browser — they contain GSTINs, addresses and item totals. Server-side logs
    // (lib/clearTaxClient.js#ctaxLog, redacted) are the source of truth for diagnosis.
    return Response.json({
      error: err.message || 'E-Way Bill generation failed',
    }, { status: 500 })
  }
}
