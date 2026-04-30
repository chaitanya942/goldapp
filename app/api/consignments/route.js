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
    // Today in IST
    const now      = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000)
    const todayIST = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`

    // Fetch today's purchases (all approved, any stock_status) — separate from pending
    // Use current_branch when set, fall back to branch_name (pre-Phase B rows)
    const { data: todayPurchases, error: tErr } = await supabase
      .from('purchases')
      .select('branch_name, current_branch, purchase_date, gross_weight, net_weight, total_amount')
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
      .eq('purchase_date', todayIST)

    if (tErr) return Response.json({ data: [], error: tErr.message })

    // Pending stock = at_branch (incl. transferred-in at hub) before today
    const { data: pendingPurchases, error: pErr } = await supabase
      .from('purchases')
      .select('branch_name, current_branch, purchase_date, gross_weight, net_weight, total_amount')
      .eq('stock_status', 'at_branch')
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
      .lt('purchase_date', todayIST)

    if (pErr) return Response.json({ data: [], error: pErr.message })

    const purchases = [...(todayPurchases || []), ...(pendingPurchases || [])]

    // Fetch branch metadata — filter outside_bangalore by model_type
    const { data: branches, error: bErr } = await supabase
      .from('branches')
      .select('name, region, state, model_type, pickup_time')
      .eq('is_active', true)

    if (bErr) return Response.json({ data: [], error: bErr.message })

    const branchMeta = {}
    for (const b of branches || []) {
      branchMeta[b.name] = { region: b.region || 'Unknown', state: b.state, model_type: b.model_type, pickup_time: b.pickup_time || null }
    }

    // Only outside_bangalore branches
    const outsideBranches = new Set(
      (branches || []).filter(b => b.model_type === 'outside_bangalore').map(b => b.name)
    )

    // Last moved consignment date per branch — most recent created_at across all consignments
    const { data: lastMoved } = await supabase
      .from('consignments')
      .select('branch_name, created_at, status')
      .neq('status', 'seed')
      .order('created_at', { ascending: false })

    const lastMovedByBranch = {}
    for (const c of lastMoved || []) {
      if (!lastMovedByBranch[c.branch_name]) lastMovedByBranch[c.branch_name] = c.created_at
    }

    // Pre-populate all outside-bangalore branches so zero-stock branches appear in the table
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

    for (const row of purchases || []) {
      // Use current_branch (physical location) when set, fall back to branch_name
      const key = row.current_branch || row.branch_name
      if (!outsideBranches.has(key)) continue
      const s = summary[key]
      if (!s) continue
      const nw = parseFloat(row.net_weight   || 0)
      const gw = parseFloat(row.gross_weight || 0)
      const ta = parseFloat(row.total_amount || 0)
      const isToday = row.purchase_date === todayIST
      s.total_bills++
      s.total_gross_wt    += gw
      s.total_net_wt      += nw
      s.total_gross_value += ta
      if (isToday) {
        s.today_bills++
        s.today_net_wt      += nw
        s.today_gross_value += ta
      } else {
        s.older_bills++
        s.older_net_wt      += nw
        s.older_gross_value += ta
        if (!s.oldest_date || row.purchase_date < s.oldest_date) s.oldest_date = row.purchase_date
      }
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

    // Filter by current_branch (physical location). For older rows where current_branch
    // is null we fall back to branch_name. The OR captures both cases.
    let query = supabase
      .from('purchases')
      .select('*')
      .eq('stock_status', 'at_branch')
      .eq('crm_status', 'approved')
      .eq('is_deleted', false)
      .order('purchase_date', { ascending: false })

    if (branch) {
      query = query.or(`current_branch.eq.${branch},and(current_branch.is.null,branch_name.eq.${branch})`)
    } else {
      // Limit to outside branches only — match on whichever location field is populated
      query = query.or(`current_branch.in.(${outsideNames.map(n => `"${n}"`).join(',')}),and(current_branch.is.null,branch_name.in.(${outsideNames.map(n => `"${n}"`).join(',')}))`)
    }
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

    // Creation = consignment is in transit. Skip 'draft' state — the user mental
    // model is "challan/voucher generated → it's moving". Receipt at HO is handled
    // by a separate module.
    const nowIso = new Date().toISOString()
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
        status:        'dispatched',
        dispatched_at: nowIso,
        total_bills:   purchase_ids.length,
        total_net_wt:  totalNetWt,
        total_amount:  totalAmount,
        created_by,
      })
      .select()
      .single()

    if (ce) return Response.json({ error: ce.message }, { status: 500 })

    await supabase.from('consignment_items').insert(
      purchase_ids.map(pid => ({ consignment_id: consignment.id, purchase_id: pid, added_by: created_by }))
    )

    await supabase.from('purchases')
      .update({ stock_status: 'in_consignment', dispatched_at: new Date().toISOString() })
      .in('id', purchase_ids)

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

    const { data, error } = await supabase
      .from('consignments')
      .update({ status: 'received', received_at: new Date().toISOString(), received_by })
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
    }

    return Response.json({ data })
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