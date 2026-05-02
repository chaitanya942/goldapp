// app/api/consignments/route.js

import { createClient } from '@supabase/supabase-js'
import {
  regionToStateCode,
  autoBranchCode,
  generateTmpPrfNo,
  generateExternalNo,
  generateInternalNo,
  generateIssueVoucherNo,
} from '../../../lib/consignmentUtils'
import { logConsignmentEvent } from '../../../lib/consignmentLog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // ── Branch Stock Overview (new landing view) ──────────────────────────────
  if (action === 'branch_overview') {
    // Server-side aggregation via RPC — single grouped SQL query handles
    // 24K+ bills in <500ms. Falls back to JS pagination if RPC missing.
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('branch_stock_summary')

    if (rpcErr) {
      console.warn('[branch_overview] RPC failed, falling back to pagination:', rpcErr.message)
      return Response.json({ data: [], error: 'branch_stock_summary RPC missing — apply sql/branch_stock_summary_rpc.sql' })
    }

    // Fetch branch metadata to filter outside_bangalore + attach region/pickup
    const { data: branches, error: bErr } = await supabase
      .from('branches')
      .select('name, region, state, model_type, pickup_time')
      .eq('is_active', true)
    if (bErr) return Response.json({ data: [], error: bErr.message })

    const branchMeta = {}
    for (const b of branches || []) {
      branchMeta[b.name] = { region: b.region || 'Unknown', state: b.state, model_type: b.model_type, pickup_time: b.pickup_time || null }
    }
    const outsideBranches = new Set(
      (branches || []).filter(b => b.model_type === 'outside_bangalore').map(b => b.name)
    )

    // Last moved consignment date per branch
    const { data: lastMoved } = await supabase
      .from('consignments')
      .select('branch_name, created_at, status')
      .neq('status', 'seed')
      .order('created_at', { ascending: false })

    const lastMovedByBranch = {}
    for (const c of lastMoved || []) {
      if (!lastMovedByBranch[c.branch_name]) lastMovedByBranch[c.branch_name] = c.created_at
    }

    // Pre-populate zero-stock outside branches so they still appear in the table
    const summary = {}
    for (const branchName of outsideBranches) {
      const meta = branchMeta[branchName] || { region: 'Unknown', pickup_time: null }
      summary[branchName] = {
        branch_name: branchName, region: meta.region, pickup_time: meta.pickup_time,
        last_moved_at: lastMovedByBranch[branchName] || null,
        total_bills: 0, today_bills: 0, older_bills: 0,
        today_net_wt: 0, older_net_wt: 0,
        today_gross_value: 0, older_gross_value: 0,
        total_gross_wt: 0, total_net_wt: 0, total_gross_value: 0,
        oldest_date: null,
      }
    }

    // Merge RPC aggregates into summary
    for (const row of rpcRows || []) {
      if (!outsideBranches.has(row.branch_name)) continue
      const s = summary[row.branch_name]
      if (!s) continue
      const totalBills = Number(row.total_bills || 0)
      const todayBills = Number(row.today_bills || 0)
      const totalNet   = parseFloat(row.total_net_wt      || 0)
      const todayNet   = parseFloat(row.today_net_wt      || 0)
      const totalGross = parseFloat(row.total_gross_wt    || 0)
      const totalVal   = parseFloat(row.total_gross_value || 0)
      const todayVal   = parseFloat(row.today_gross_value || 0)
      s.total_bills        = totalBills
      s.today_bills        = todayBills
      s.older_bills        = totalBills - todayBills
      s.total_net_wt       = totalNet
      s.today_net_wt       = todayNet
      s.older_net_wt       = totalNet - todayNet
      s.total_gross_wt     = totalGross
      s.total_gross_value  = totalVal
      s.today_gross_value  = todayVal
      s.older_gross_value  = totalVal - todayVal
      s.oldest_date        = row.oldest_pending_date
    }

    const result = Object.values(summary).map(s => {
      const oldestMs   = s.oldest_date ? new Date(s.oldest_date).getTime() : null
      const oldestDays = oldestMs ? Math.floor((Date.now() - oldestMs) / 86400000) : 0
      const lastMovedDays = s.last_moved_at ? Math.floor((Date.now() - new Date(s.last_moved_at).getTime()) / 86400000) : null
      return { ...s, oldest_age_days: oldestDays, last_moved_days_ago: lastMovedDays }
    }).sort((a, b) => b.total_gross_wt - a.total_gross_wt)

    return Response.json({ data: result })
  }

  // ── Get outside-Bangalore branches from branches master ──────────────────
  if (action === 'branches') {
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, state, region, cluster, model_type, address, city, pin_code, contact_person, contact_phone, branch_gstin, is_hub, hub_branch_name, pickup_time')
      .eq('is_active', true)
      .neq('region', 'Bangalore')
      .order('region')
      .order('name')

    // Enrich with state_code and branch_code
    const enriched = (data || []).map(b => ({
      ...b,
      branch_name: b.name,
      branch_code: autoBranchCode(b.name),
      state_code:  regionToStateCode(b.region),
    }))

    return Response.json({ data: enriched, error: error?.message })
  }

  // ── Get stock in branch (at_branch, outside Bangalore) ───────────────────
  if (action === 'stock_in_branch') {
    const branch   = searchParams.get('branch')
    const dateFrom = searchParams.get('date_from')
    const dateTo   = searchParams.get('date_to')

    const { data: outsideBranches } = await supabase
      .from('branches')
      .select('name')
      .eq('is_active', true)
      .neq('region', 'Bangalore')
    const outsideNames = (outsideBranches || []).map(b => b.name)

    // Two queries merged client-side:
    //   1. OWN bills — strict filter (approved, not deleted, at_branch)
    //   2. TRANSFERRED-IN bills — relaxed filter (just at_branch + not deleted)
    //      because the source branch already validated approval before transfer.
    //      Without this, bills that were legitimately moved disappear from the
    //      hub picker if their crm_status changed (e.g. amendments) post-move.
    if (branch) {
      let ownQ = supabase
        .from('purchases')
        .select('*')
        .eq('stock_status', 'at_branch')
        .eq('crm_status', 'approved')
        .eq('is_deleted', false)
        .eq('branch_name', branch)
        .or(`current_branch.eq.${branch},current_branch.is.null`)

      let transferredQ = supabase
        .from('purchases')
        .select('*')
        .eq('stock_status', 'at_branch')
        .eq('is_deleted', false)
        .neq('branch_name', branch)
        .eq('current_branch', branch)

      if (dateFrom) { ownQ = ownQ.gte('purchase_date', dateFrom); transferredQ = transferredQ.gte('purchase_date', dateFrom) }
      if (dateTo)   { ownQ = ownQ.lte('purchase_date', dateTo);   transferredQ = transferredQ.lte('purchase_date', dateTo) }

      const [{ data: ownData, error: ownErr }, { data: trData, error: trErr }] =
        await Promise.all([ownQ, transferredQ])
      if (ownErr || trErr) return Response.json({ data: [], error: (ownErr || trErr).message })

      const merged = [...(ownData || []), ...(trData || [])]
        .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date))
      return Response.json({ data: merged })
    }

    // Branch-overview path (no specific branch) — keep original strict filter.
    let query = supabase
      .from('purchases')
      .select('*')
      .eq('stock_status', 'at_branch')
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
      .order('purchase_date', { ascending: false })
      .or(`current_branch.in.(${outsideNames.map(n => `"${n}"`).join(',')}),and(current_branch.is.null,branch_name.in.(${outsideNames.map(n => `"${n}"`).join(',')}))`)
    if (dateFrom) query = query.gte('purchase_date', dateFrom)
    if (dateTo)   query = query.lte('purchase_date', dateTo)

    const { data, error } = await query
    return Response.json({ data, error: error?.message })
  }

  // ── Check for unknown branches (in purchases but not in branches table) ──
  if (action === 'unknown_branches') {
    const { data: knownBranches } = await supabase
      .from('branches')
      .select('name')
      .eq('is_active', true)

    const knownNames = new Set((knownBranches || []).map(b => b.name))

    const { data: purchaseBranches } = await supabase
      .from('purchases')
      .select('branch_name')
      .eq('is_deleted', false)
      .not('branch_name', 'is', null)

    const unknownSet = new Set()
    for (const p of purchaseBranches || []) {
      if (!knownNames.has(p.branch_name)) unknownSet.add(p.branch_name)
    }

    return Response.json({ data: [...unknownSet].sort() })
  }

  // ── Debug: dump current state of all bills in a given consignment ──────
  // Use to diagnose count mismatches: where did the bills actually end up?
  if (action === 'debug_consignment_bills') {
    const cid = searchParams.get('id')
    if (!cid) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data: links } = await supabase.from('consignment_items').select('purchase_id').eq('consignment_id', cid)
    const pids = (links || []).map(l => l.purchase_id)
    if (!pids.length) return Response.json({ data: [] })
    const { data: bills } = await supabase
      .from('purchases')
      .select('id, application_id, customer_name, branch_name, current_branch, stock_status, crm_status, is_deleted, purchase_date, net_weight, total_amount, dispatched_at')
      .in('id', pids)
    return Response.json({
      data: bills || [],
      summary: {
        count: pids.length,
        by_stock_status: (bills || []).reduce((a, b) => ({ ...a, [b.stock_status]: (a[b.stock_status] || 0) + 1 }), {}),
        by_current_branch: (bills || []).reduce((a, b) => ({ ...a, [b.current_branch || 'null']: (a[b.current_branch || 'null'] || 0) + 1 }), {}),
        by_crm_status: (bills || []).reduce((a, b) => ({ ...a, [b.crm_status]: (a[b.crm_status] || 0) + 1 }), {}),
        deleted: (bills || []).filter(b => b.is_deleted).length,
      },
    })
  }

  // ── Bill journey: every consignment a bill has been part of ────────────
  if (action === 'bill_journey') {
    const purchaseId = searchParams.get('purchase_id')
    if (!purchaseId) return Response.json({ error: 'purchase_id required' }, { status: 400 })
    const { data: links } = await supabase
      .from('consignment_items')
      .select('purchase_id, received_at, short_reason, consignment:consignment_id(id, tmp_prf_no, challan_no, movement_type, branch_name, dest_branch, status, created_at, received_at, cancelled_at, eway_bill_no, irn)')
      .eq('purchase_id', purchaseId)
    const journey = (links || [])
      .map(l => ({
        consignment_id:  l.consignment?.id,
        tmp_prf_no:      l.consignment?.tmp_prf_no,
        challan_no:      l.consignment?.challan_no,
        movement_type:   l.consignment?.movement_type,
        source:          l.consignment?.branch_name,
        dest:            l.consignment?.movement_type === 'INTERNAL' ? l.consignment?.dest_branch : 'HO',
        status:          l.consignment?.status,
        eway_bill_no:    l.consignment?.eway_bill_no,
        irn:             l.consignment?.irn,
        created_at:      l.consignment?.created_at,
        received_at:     l.consignment?.received_at,
        cancelled_at:    l.consignment?.cancelled_at,
        bill_received:   l.received_at,
        short_reason:    l.short_reason,
      }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    return Response.json({ data: journey })
  }

  // ── Activity log for a consignment ──────────────────────────────────────
  if (action === 'activity_log') {
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data, error } = await supabase
      .from('consignment_activity_log')
      .select('*')
      .eq('consignment_id', id)
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  }

  // ── Audit log: ClearTax response history for a consignment ──────────────
  // Returns the stored cleartax_response JSON + EWB/E-Invoice numbers + timestamps.
  // Used for compliance audits and dispute resolution.
  if (action === 'cleartax_audit') {
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data, error } = await supabase
      .from('consignments')
      .select('id, tmp_prf_no, challan_no, branch_name, dest_branch, movement_type, eway_bill_no, ewb_generated_at, irn, ack_no, ack_dt, einvoice_generated_at, cleartax_response, created_at, received_at, status')
      .eq('id', id)
      .maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!data) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    return Response.json({ data })
  }

  // ── Branch summary (state → branch → bills) ──────────────────────────────
  if (action === 'branch_summary') {
    const { data: branches } = await supabase
      .from('branches')
      .select('name, region, state')
      .eq('is_active', true)
      .neq('region', 'Bangalore')

    const branchMeta = {}
    for (const b of branches || []) {
      branchMeta[b.name] = {
        region:     b.region,
        state_code: regionToStateCode(b.region),
        state:      b.state,
      }
    }

    const { data: purchases } = await supabase
      .from('purchases')
      .select('branch_name, current_branch, stock_status, net_weight, total_amount')
      .eq('is_deleted', false)
      .in('stock_status', ['at_branch', 'in_consignment'])

    const summary = {}
    for (const row of purchases || []) {
      const key  = row.current_branch || row.branch_name
      const meta = branchMeta[key]
      if (!meta) continue
      if (!summary[key]) {
        summary[key] = {
          branch:        key,
          region:        meta.region,
          state_code:    meta.state_code,
          at_branch:     0,
          in_consignment: 0,
          at_branch_wt:  0,
          in_consignment_wt: 0,
        }
      }
      if (row.stock_status === 'at_branch') {
        summary[key].at_branch++
        summary[key].at_branch_wt += parseFloat(row.net_weight || 0)
      }
      if (row.stock_status === 'in_consignment') {
        summary[key].in_consignment++
        summary[key].in_consignment_wt += parseFloat(row.net_weight || 0)
      }
    }

    return Response.json({ data: Object.values(summary) })
  }

  // ── Get all consignments ─────────────────────────────────────────────────
  if (action === 'consignments') {
    const status   = searchParams.get('status')
    const branch   = searchParams.get('branch')
    const dateFrom = searchParams.get('date_from')
    const dateTo   = searchParams.get('date_to')

    let query = supabase
      .from('consignments')
      .select('*')
      .neq('status', 'seed')          // never show seed records in reports
      .order('created_at', { ascending: false })

    if (status)   query = query.eq('status', status)
    if (branch)   query = query.eq('branch_name', branch)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo)   query = query.lte('created_at', dateTo)

    const { data, error } = await query
    return Response.json({ data, error: error?.message })
  }

  // ── Get consignment detail with items ────────────────────────────────────
  if (action === 'consignment_detail') {
    const id = searchParams.get('id')
    const { data: consignment, error: ce } = await supabase
      .from('consignments').select('*').eq('id', id).single()

    if (ce) return Response.json({ error: ce.message }, { status: 404 })

    const { data: items } = await supabase
      .from('consignment_items')
      .select('*, purchase:purchase_id(*)')
      .eq('consignment_id', id)

    return Response.json({ data: { ...consignment, items } })
  }

  // ── Transfer history: for a list of purchase IDs (or a hub branch),
  //    return the most recent INTERNAL (Branch→Hub) consignment that brought
  //    each bill to its current location. Used to surface "via WG000010"
  //    info in hub-level bill pickers and consolidated Hub→HO documents.
  if (action === 'transfer_history') {
    const branch       = searchParams.get('branch')             // hub name
    const idsParam     = searchParams.get('purchase_ids')        // comma-separated
    let purchaseIds = []

    if (idsParam) {
      purchaseIds = idsParam.split(',').filter(Boolean)
    } else if (branch) {
      // All bills currently at this hub (transferred-in OR own — we'll filter below)
      const { data } = await supabase
        .from('purchases')
        .select('id')
        .eq('current_branch', branch)
        .eq('crm_status', 'approved')
        .eq('is_deleted', false)
      purchaseIds = (data || []).map(r => r.id)
    } else {
      return Response.json({ error: 'branch or purchase_ids required' }, { status: 400 })
    }

    if (!purchaseIds.length) return Response.json({ data: {} })

    // Pull all INTERNAL consignment_items for these purchases + parent consignment
    const { data: links } = await supabase
      .from('consignment_items')
      .select('purchase_id, consignment:consignment_id(id, tmp_prf_no, challan_no, internal_no, movement_type, status, branch_name, dest_branch, created_at, received_at)')
      .in('purchase_id', purchaseIds)

    // For each purchase, pick the most recent INTERNAL+received consignment
    const map = {}
    for (const link of links || []) {
      const c = link.consignment
      if (!c || c.movement_type !== 'INTERNAL' || c.status !== 'received') continue
      const existing = map[link.purchase_id]
      if (!existing || new Date(c.created_at) > new Date(existing.created_at)) {
        map[link.purchase_id] = {
          consignment_id: c.id,
          tmp_prf_no:     c.tmp_prf_no,
          internal_no:    c.internal_no,
          challan_no:     c.challan_no,        // voucher no for INTERNAL
          source_branch:  c.branch_name,
          dest_branch:    c.dest_branch,
          received_at:    c.received_at,
          created_at:     c.created_at,
        }
      }
    }
    return Response.json({ data: map })
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req) {
  const body   = await req.json()
  const { action } = body

  // ── Create consignment ───────────────────────────────────────────────────
  if (action === 'create_consignment') {
    const { purchase_ids, branch_name, movement_type, dest_branch, eway_bill_no, created_by } = body
    if (!purchase_ids?.length) return Response.json({ error: 'No purchases selected' }, { status: 400 })
    if (!branch_name)          return Response.json({ error: 'Branch name required' },  { status: 400 })

    const isInternal = movement_type === 'INTERNAL'
    if (isInternal && !dest_branch) {
      return Response.json({ error: 'Destination hub is required for Branch → Hub movements' }, { status: 400 })
    }
    if (isInternal && dest_branch === branch_name) {
      return Response.json({ error: 'Source and destination cannot be the same branch' }, { status: 400 })
    }

    // Source branch meta
    const { data: branchData, error: branchErr } = await supabase
      .from('branches')
      .select('name, region, state, is_hub')
      .eq('name', branch_name)
      .single()

    if (branchErr || !branchData) {
      return Response.json({ error: `Branch '${branch_name}' not found in branch master` }, { status: 400 })
    }

    // Destination branch meta (for INTERNAL only).
    // Any branch can act as a hub for a given consignment — no pre-marking required.
    let destData = null
    if (isInternal) {
      const { data, error } = await supabase
        .from('branches')
        .select('name, region')
        .eq('name', dest_branch)
        .single()
      if (error || !data) return Response.json({ error: `Destination branch '${dest_branch}' not found` }, { status: 400 })
      destData = data
    }

    const stateCode  = regionToStateCode(branchData.region)
    const branchCode = autoBranchCode(branch_name)

    // Validate selected purchases are currently at this branch (use current_branch with branch_name fallback)
    const { data: purchaseCheck } = await supabase
      .from('purchases')
      .select('id, branch_name, current_branch, stock_status')
      .in('id', purchase_ids)

    const wrongBranch = (purchaseCheck || []).filter(p => (p.current_branch || p.branch_name) !== branch_name)
    if (wrongBranch.length) {
      return Response.json({
        error: `${wrongBranch.length} purchase(s) are not currently at '${branch_name}'.`,
      }, { status: 400 })
    }

    const alreadyInConsignment = (purchaseCheck || []).filter(p => p.stock_status === 'in_consignment')
    if (alreadyInConsignment.length) {
      return Response.json({
        error: `${alreadyInConsignment.length} purchase(s) are already in a consignment.`,
      }, { status: 400 })
    }

    const tmpPrfNo = await generateTmpPrfNo(supabase, branch_name)

    // Number generation depends on movement type:
    //   EXTERNAL (Branch→HO or Hub→HO): challan_no
    //   INTERNAL (Branch→Hub):           issue voucher (stored in internal_no, displayed via challan_no field as voucher)
    let extNo = null, challan = null, internalNo = null
    if (isInternal) {
      const { internalNo: seq, voucher } = await generateIssueVoucherNo(supabase, branchCode, stateCode)
      internalNo = seq
      challan    = voucher  // reuse challan_no column to store the voucher identifier
    } else {
      const ext = await generateExternalNo(supabase, branchCode, stateCode)
      extNo   = ext.extNo
      challan = ext.challan
    }

    const { data: purchaseTotals } = await supabase
      .from('purchases')
      .select('net_weight, total_amount')
      .in('id', purchase_ids)

    const totalNetWt  = (purchaseTotals || []).reduce((s, p) => s + parseFloat(p.net_weight || 0), 0)
    const totalAmount = (purchaseTotals || []).reduce((s, p) => s + parseFloat(p.total_amount || 0), 0)

    // Status & bill movement depends on movement type:
    //   INTERNAL (Branch → Hub): instantaneous transfer. No receive workflow at hub.
    //     - Consignment status = 'received' immediately
    //     - Bills' current_branch flips to dest_branch (hub) right away
    //     - Bills' stock_status stays 'at_branch' so they're available in hub's stock
    //   EXTERNAL (Direct → HO or Hub → HO): in-transit until received at HO.
    //     - Consignment status = 'dispatched'
    //     - Bills' stock_status flips to 'in_consignment'
    //     - Bills' current_branch unchanged until HO receive
    const nowIso = new Date().toISOString()

    // Snapshot GST rates from company_settings — frozen against retroactive changes.
    // Column names match what's exposed in the Company Settings admin UI.
    const { data: cs } = await supabase.from('company_settings').select('*').single()
    const igstRate = parseFloat(cs?.igst_rate ?? 3) || 3
    const gstSnapshot = {
      igst: igstRate,
      cgst: parseFloat(cs?.cgst_rate ?? (igstRate / 2)) || (igstRate / 2),
      sgst: parseFloat(cs?.sgst_rate ?? (igstRate / 2)) || (igstRate / 2),
      hsn:  cs?.hsn_code || '71131910',
      captured_at: nowIso,
    }

    const { data: consignment, error: ce } = await supabase
      .from('consignments')
      .insert({
        consignment_no: challan,
        tmp_prf_no:    tmpPrfNo,
        external_no:   extNo,
        internal_no:   internalNo,
        challan_no:    challan,
        branch_name,
        branch_code:   branchCode,
        state_code:    stateCode,
        movement_type: movement_type || 'EXTERNAL',
        dest_branch:   isInternal ? dest_branch : null,
        eway_bill_no:  eway_bill_no || null,
        status:        isInternal ? 'received'  : 'dispatched',
        dispatched_at: nowIso,
        received_at:   isInternal ? nowIso      : null,
        total_bills:   purchase_ids.length,
        total_net_wt:  totalNetWt,
        total_amount:  totalAmount,
        gst_rate_snapshot: gstSnapshot,
        created_by,
      })
      .select()
      .single()

    if (ce) return Response.json({ error: ce.message }, { status: 500 })

    await logConsignmentEvent(supabase, {
      consignment_id: consignment.id,
      event_type:     isInternal ? 'created_and_received' : 'created',
      actor_email:    created_by,
      details:        { movement_type: consignment.movement_type, source: branch_name, dest: isInternal ? dest_branch : 'HO', bills: purchase_ids.length, weight: totalNetWt },
    })

    await supabase.from('consignment_items').insert(
      purchase_ids.map(pid => ({ consignment_id: consignment.id, purchase_id: pid, added_by: created_by }))
    )

    if (isInternal) {
      // Branch → Hub: bills are immediately at the hub, available in hub's stock
      await supabase.from('purchases')
        .update({
          stock_status:  'at_branch',
          current_branch: dest_branch,
          dispatched_at: nowIso,
        })
        .in('id', purchase_ids)
    } else {
      // Direct → HO / Hub → HO: bills go in-transit until HO receive
      await supabase.from('purchases')
        .update({ stock_status: 'in_consignment', dispatched_at: nowIso })
        .in('id', purchase_ids)
    }

    return Response.json({ data: consignment })
  }

  // ── Dispatch consignment ─────────────────────────────────────────────────
  if (action === 'dispatch') {
    const { id, dispatched_by } = body
    // Validate: must be in draft status to dispatch
    const { data: current } = await supabase.from('consignments').select('status').eq('id', id).single()
    if (current?.status !== 'draft') {
      return Response.json({ error: `Cannot dispatch — consignment is '${current?.status}', must be 'draft'` }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('consignments')
      .update({ status: 'dispatched', dispatched_at: new Date().toISOString(), dispatched_by })
      .eq('id', id).select().single()
    return Response.json({ data, error: error?.message })
  }

  // ── Receive consignment ───────────────────────────────────────────────────
  if (action === 'receive') {
    const { id, received_by } = body

    const { data: current } = await supabase.from('consignments')
      .select('status, movement_type, dest_branch')
      .eq('id', id).single()
    if (current?.status !== 'dispatched') {
      return Response.json({ error: `Cannot receive — consignment is '${current?.status}', must be 'dispatched'` }, { status: 400 })
    }

    const { data: items } = await supabase
      .from('consignment_items')
      .select('purchase_id')
      .eq('consignment_id', id)
    const purchaseIds = (items || []).map(i => i.purchase_id)

    const nowIsoR = new Date().toISOString()
    const { data, error } = await supabase
      .from('consignments')
      .update({ status: 'received', received_at: nowIsoR, received_by })
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (purchaseIds.length) {
      // INTERNAL (Branch → Hub): bills now live at the hub. Reset to at_branch + update current_branch.
      // EXTERNAL (Branch → HO or Hub → HO): bills land at HO.
      if (current.movement_type === 'INTERNAL' && current.dest_branch) {
        await supabase.from('purchases')
          .update({ stock_status: 'at_branch', current_branch: current.dest_branch })
          .in('id', purchaseIds)
      } else {
        await supabase.from('purchases')
          .update({ stock_status: 'at_ho' })
          .in('id', purchaseIds)
      }
      // Mark each item as received by this user
      await supabase.from('consignment_items')
        .update({ received_at: nowIsoR, received_by_email: received_by })
        .eq('consignment_id', id)
    }

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'received',
      actor_email:    received_by,
      details:        { bills: purchaseIds.length, dest: current.dest_branch || 'HO' },
    })

    return Response.json({ data })
  }

  // ── Cancel consignment (reverse flow) ────────────────────────────────────
  // Voids a consignment that was created by mistake. Bills return to source.
  // Blocked if any bill has since been re-consigned in a later movement.
  if (action === 'cancel_consignment') {
    const { id, reason, cancelled_by } = body
    const { data: c } = await supabase.from('consignments').select('*').eq('id', id).single()
    if (!c) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (c.status === 'cancelled') return Response.json({ error: 'Already cancelled' }, { status: 400 })
    if (c.status === 'received' && c.movement_type !== 'INTERNAL') {
      return Response.json({ error: 'Cannot cancel — already received at HO. Initiate a return instead.' }, { status: 400 })
    }

    const { data: links } = await supabase.from('consignment_items').select('purchase_id').eq('consignment_id', id)
    const pids = (links || []).map(l => l.purchase_id)

    // For INTERNAL consignments that auto-marked received: check no bill is in a later
    // consignment (e.g. Hub→HO) before reversing. Reversing under those bills would
    // corrupt the later consignment's stock_status / current_branch.
    if (pids.length && c.movement_type === 'INTERNAL') {
      const { data: laterLinks } = await supabase
        .from('consignment_items')
        .select('purchase_id, consignment:consignment_id(id, status, created_at)')
        .in('purchase_id', pids)
        .neq('consignment_id', id)
      const laterActive = (laterLinks || []).filter(l =>
        l.consignment && l.consignment.status !== 'cancelled' && new Date(l.consignment.created_at) > new Date(c.created_at)
      )
      if (laterActive.length) {
        return Response.json({
          error: `Cannot void — ${laterActive.length} bill(s) are in a later consignment. Cancel that one first.`,
        }, { status: 409 })
      }
    }

    // Bills return to source branch
    if (pids.length) {
      await supabase.from('purchases')
        .update({ stock_status: 'at_branch', current_branch: c.branch_name, dispatched_at: null })
        .in('id', pids)
    }

    // If EWB / E-Invoice still active, surface a warning in the activity log so the
    // operator can also cancel them on the GST portal. We don't auto-cancel here
    // because that requires user input (reason code).
    const hadEwb = !!c.eway_bill_no
    const hadIrn = !!c.irn

    const cancelIso = new Date().toISOString()
    await supabase.from('consignments')
      .update({
        status:        'cancelled',
        cancelled_at:  cancelIso,
        cancel_reason: reason || null,
        // Clear received_at — INTERNAL was auto-marked received, but cancellation undoes that
        received_at:   null,
      })
      .eq('id', id)

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     'cancelled',
      actor_email:    cancelled_by,
      details:        {
        reason: reason || null,
        bills_returned: pids.length,
        returned_to: c.branch_name,
        active_ewb: hadEwb ? c.eway_bill_no : null,
        active_irn: hadIrn ? c.irn : null,
        warning: (hadEwb || hadIrn) ? 'EWB/IRN still active — cancel separately on GST portal' : null,
      },
    })

    return Response.json({
      success: true,
      warning: (hadEwb || hadIrn) ? 'EWB/IRN still active — cancel separately within 24h' : null,
    })
  }

  // ── Partial receive — mark specific bills received, others as missing/short ──
  if (action === 'partial_receive') {
    const { id, received_purchase_ids, short_purchase_ids, short_reason, received_by } = body
    if (!id) return Response.json({ error: 'consignment id required' }, { status: 400 })
    const { data: c } = await supabase.from('consignments').select('status, movement_type, dest_branch').eq('id', id).single()
    if (!c) return Response.json({ error: 'Consignment not found' }, { status: 404 })
    if (!['dispatched', 'partial_received'].includes(c.status)) {
      return Response.json({ error: `Cannot receive — consignment is '${c.status}'` }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    if ((received_purchase_ids || []).length) {
      await supabase.from('consignment_items')
        .update({ received_at: nowIso, received_by_email: received_by })
        .eq('consignment_id', id).in('purchase_id', received_purchase_ids)
      const newStatus = c.movement_type === 'INTERNAL' ? 'at_branch' : 'at_ho'
      const updates = { stock_status: newStatus }
      if (c.movement_type === 'INTERNAL' && c.dest_branch) updates.current_branch = c.dest_branch
      await supabase.from('purchases').update(updates).in('id', received_purchase_ids)
    }
    if ((short_purchase_ids || []).length) {
      await supabase.from('consignment_items')
        .update({ short_reason: short_reason || 'short' })
        .eq('consignment_id', id).in('purchase_id', short_purchase_ids)
    }

    // Closure rule: a consignment is fully resolved when every item is either
    // received_at IS NOT NULL OR short_reason IS NOT NULL. Pure-pending count
    // is what we check — receive_at null AND short_reason null.
    const { count: pendingCount } = await supabase
      .from('consignment_items')
      .select('purchase_id', { count: 'exact', head: true })
      .eq('consignment_id', id)
      .is('received_at', null)
      .is('short_reason', null)
    const finalStatus = (pendingCount || 0) === 0 ? 'received' : 'partial_received'
    const upd = { status: finalStatus }
    if (finalStatus === 'received') upd.received_at = nowIso
    await supabase.from('consignments').update(upd).eq('id', id)

    await logConsignmentEvent(supabase, {
      consignment_id: id,
      event_type:     finalStatus === 'received' ? 'received_with_shortage' : 'partial_received',
      actor_email:    received_by,
      details:        { received: (received_purchase_ids || []).length, short: (short_purchase_ids || []).length, short_reason },
    })

    return Response.json({ success: true, status: finalStatus })
  }

  // ── Remove item from consignment ─────────────────────────────────────────
  if (action === 'remove_item') {
    const { consignment_id, purchase_id } = body
    await supabase.from('consignment_items')
      .delete().eq('consignment_id', consignment_id).eq('purchase_id', purchase_id)
    await supabase.from('purchases')
      .update({ stock_status: 'at_branch', dispatched_at: null }).eq('id', purchase_id)

    // Recalculate totals
    const { data: items } = await supabase
      .from('consignment_items')
      .select('purchase:purchase_id(net_weight, total_amount)')
      .eq('consignment_id', consignment_id)

    const totalNetWt  = items?.reduce((s, i) => s + parseFloat(i.purchase?.net_weight || 0), 0) || 0
    const totalAmount = items?.reduce((s, i) => s + parseFloat(i.purchase?.total_amount || 0), 0) || 0
    await supabase.from('consignments')
      .update({ total_bills: items?.length || 0, total_net_wt: totalNetWt, total_amount: totalAmount })
      .eq('id', consignment_id)

    return Response.json({ success: true })
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}