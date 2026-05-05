// lib/consignmentSnapshot.js
//
// Single source of truth for loading a consignment + its branch + items + company
// settings, ready for any document generator (EWB, E-Invoice, Delivery Challan,
// Issue Voucher, Consignee Report).
//
// Design:
//   - Snapshot fields on `consignments` and `consignment_items` are authoritative.
//   - Live `branches` and `purchases` are loaded only as a backstop for legacy
//     rows that pre-date the snapshot model (where _snap fields are NULL).
//   - Returns a synthetic `branch` / `destBranch` object that merges snapshot
//     over live, so callers don't have to.
//
// Without this helper, every doc-generation route was re-implementing the same
// 30-line resolution logic — small bugs would diverge between routes (e.g. EWB
// using the snapshot but Issue Voucher reading live data).

import { resolveAllowedBranchNames } from './apiAuth'

export async function loadConsignmentForGeneration(supabase, consignmentId, auth) {
  const { data: consignment, error: ce } = await supabase
    .from('consignments').select('*').eq('id', consignmentId).single()
  if (ce || !consignment) {
    return { error: { status: 404, message: 'Consignment not found' } }
  }

  // Region scoping: when auth is provided and the user is restricted, deny if
  // this consignment's source branch is outside their allowed regions.
  // Passing auth is optional for backwards compatibility — older callers that
  // don't pass it skip the check.
  if (auth) {
    const allowedBranches = await resolveAllowedBranchNames(supabase, auth)
    if (allowedBranches && !allowedBranches.includes(consignment.branch_name)) {
      return { error: { status: 403, message: 'Forbidden — consignment is outside your assigned region.' } }
    }
  }

  // Source branch: snapshot first, live as backstop.
  const { data: liveBranch } = await supabase
    .from('branches').select('*').eq('name', consignment.branch_name).single()
  if (!liveBranch && !consignment.source_address) {
    return {
      error: {
        status: 404,
        message: `Branch '${consignment.branch_name}' not found and consignment has no address snapshot`,
      },
    }
  }
  const branch = mergeSnapshotBranch({
    name:    consignment.branch_name,
    snap: {
      address:      consignment.source_address,
      city:         consignment.source_city,
      pin_code:     consignment.source_pin,
      state:        consignment.source_state,
      region:       consignment.source_region,
      branch_gstin: consignment.source_gstin,
    },
    live: liveBranch,
  })

  // Destination branch (only meaningful for INTERNAL).
  let destBranch = null
  if (consignment.movement_type === 'INTERNAL' && consignment.dest_branch) {
    const { data: liveDest } = await supabase
      .from('branches').select('*').eq('name', consignment.dest_branch).single()
    destBranch = mergeSnapshotBranch({
      name: consignment.dest_branch,
      snap: {
        address:      consignment.dest_address,
        city:         consignment.dest_city,
        pin_code:     consignment.dest_pin,
        state:        consignment.dest_state,
        region:       consignment.dest_region,
        branch_gstin: consignment.dest_gstin,
      },
      live: liveDest,
    })
  }

  // Items: snapshot first, live purchases as legacy bridge.
  const { data: linkRows } = await supabase
    .from('consignment_items')
    .select('purchase_id, bill_no_snap, gross_weight_snap, net_weight_snap, total_amount_snap, customer_name_snap, purchase_date_snap')
    .eq('consignment_id', consignmentId)

  let items = []
  const hasSnapshots = (linkRows || []).length > 0
    && (linkRows || []).every(r => r.gross_weight_snap != null && r.total_amount_snap != null)

  if (hasSnapshots) {
    items = linkRows.map(r => ({
      id:            r.purchase_id,
      bill_no:       r.bill_no_snap,
      gross_weight:  Number(r.gross_weight_snap || 0),
      net_weight:    Number(r.net_weight_snap   || 0),
      total_amount:  Number(r.total_amount_snap || 0),
      customer_name: r.customer_name_snap,
      purchase_date: r.purchase_date_snap,
    }))
  } else if (linkRows?.length) {
    const purchaseIds = linkRows.map(r => r.purchase_id)
    const { data: live } = await supabase.from('purchases').select('*').in('id', purchaseIds)
    items = live || []
  }

  const { data: companySettings } = await supabase.from('company_settings').select('*').single()

  return { consignment, branch, destBranch, items, companySettings: companySettings || {} }
}

function mergeSnapshotBranch({ name, snap, live }) {
  return {
    ...(live || {}),
    name,
    address:      snap.address      || live?.address,
    city:         snap.city         || live?.city,
    pin_code:     snap.pin_code     || live?.pin_code,
    state:        snap.state        || live?.state,
    region:       snap.region       || live?.region,
    branch_gstin: snap.branch_gstin || live?.branch_gstin,
  }
}
