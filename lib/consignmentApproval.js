// lib/consignmentApproval.js
//
// Single source of truth for the "consignment is approved → linked bills
// physically move" transition. Approval is the exact moment stock leaves the
// source branch, so this logic must never diverge between its callers:
//
//   1. The accounts `approve_consignment` action (manual approval — still the
//      path for E-Invoice-route consignments, which accounts continues to
//      review).
//   2. The EWB generate route, which auto-approves the moment operations
//      generates the E-Way Bill. EWB-route consignments no longer wait for a
//      separate accounts click; generating the legally-binding doc IS the
//      dispatch decision.
//
// Keeping the stock-movement rules in one function means an EWB auto-approval
// and an accounts approval move inventory identically — a divergence here
// would silently corrupt branch stock counts.
//
// Caller is responsible for the guards (not cancelled / not already decided /
// required document exists). This function only performs the transition.

import { logConsignmentEvent } from './consignmentLog'

export async function applyConsignmentApproval(
  supabase,
  { id, approverEmail, eventType = 'approved_by_accounts', note = null },
) {
  const nowIso = new Date().toISOString()

  // Idempotency guard. EWB / E-Invoice generation routes call this on success;
  // a retry after a network blip (NIC accepts but our response gets lost) would
  // otherwise re-run the bill flip below, overwriting the original
  // dispatched_at with a later timestamp and silently corrupting the audit
  // trail. Read the row first — if it's already approved, bail with a clean
  // signal so the caller can log a no-op warning.
  const { data: existing } = await supabase
    .from('consignments')
    .select('approval_status')
    .eq('id', id)
    .single()
  if (existing?.approval_status === 'approved') {
    return { already_approved: true, bills_moved: 0 }
  }

  const { data, error } = await supabase
    .from('consignments')
    .update({
      approval_status:  'approved',
      approved_at:      nowIso,
      approved_by:      approverEmail || null,
      rejection_reason: null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) return { error }

  // Look up linked purchases and flip their state.
  const { data: links } = await supabase
    .from('consignment_items').select('purchase_id').eq('consignment_id', id)
  const purchaseIds = (links || []).map(l => l.purchase_id)

  if (purchaseIds.length) {
    const isInternal   = data.movement_type === 'INTERNAL'
    const dispatchedAt = data.dispatched_at || nowIso
    if (isInternal) {
      // INTERNAL Branch → Hub: bills stay 'at_branch' — they just move to a
      // different branch within the network (the hub). DO NOT stamp
      // dispatched_at: that column tracks at_branch → in_consignment, which
      // only happens on the HO-bound leg (handled by the EXTERNAL branch when
      // the hub later issues a Hub → HO consignment).
      await supabase.from('purchases')
        .update({
          stock_status:   'at_branch',
          current_branch: data.dest_branch,
        })
        .in('id', purchaseIds)
    } else {
      // EXTERNAL Branch → HO or Hub → HO: bills enter transit. Stamp
      // dispatched_at as the at_branch → in_consignment transition time.
      await supabase.from('purchases')
        .update({
          stock_status:  'in_consignment',
          dispatched_at: dispatchedAt,
        })
        .in('id', purchaseIds)
    }
  }

  await logConsignmentEvent(supabase, {
    consignment_id: id,
    event_type:     eventType,
    actor_email:    approverEmail,
    details:        { note: note || null, bills_moved: purchaseIds.length },
  })

  return { data, bills_moved: purchaseIds.length }
}
