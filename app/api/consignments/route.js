// app/api/consignments/route.js
// Handles consignment creation, number generation, status updates

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Generate TMP PRF No (WG + 6 digits, global sequential) ───────────────────
async function generateTmpPrfNo() {
  const { data } = await supabase
    .from('consignments')
    .select('tmp_prf_no')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!data?.tmp_prf_no) return 'WG000001'
  const last = parseInt(data.tmp_prf_no.replace('WG', '')) || 0
  return `WG${String(last + 1).padStart(6, '0')}`
}

// ── Generate External No (sequential per branch per month) ───────────────────
// Challan format: WG{STATE}/{STATE}-{BRANCH}/{MMM}/{YYYY}/{EXTNO}
async function generateExternalNo(branchCode, stateCode, branchName) {
  const now      = new Date()
  const month    = now.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year     = now.getFullYear()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data } = await supabase
    .from('consignments')
    .select('external_no')
    .eq('branch_code', branchCode)
    .gte('created_at', monthStart)
    .not('external_no', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastNo  = data?.external_no ? parseInt(data.external_no) : 0
  const extNo   = String(lastNo + 1).padStart(6, '0')
  const challan = `WG${stateCode}/${stateCode}-${branchCode}/${month}/${year}/${extNo}`
  return { extNo, challan }
}

// ── Generate Internal No (sequential per branch per month) ───────────────────
async function generateInternalNo(branchCode) {
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data } = await supabase
    .from('consignments')
    .select('internal_no')
    .eq('branch_code', branchCode)
    .eq('movement_type', 'INTERNAL')
    .gte('created_at', monthStart)
    .not('internal_no', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastNo = data?.internal_no ? parseInt(data.internal_no) : 0
  return String(lastNo + 1).padStart(6, '0')
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // Get all branches
  if (action === 'branches') {
    const { data, error } = await supabase
      .from('consignment_branches')
      .select('*')
      .eq('is_active', true)
      .order('state_code')
      .order('branch_name')
    return Response.json({ data, error: error?.message })
  }

  // Get stock in branch (purchases with stock_status = 'in_branch', outside Bangalore)
  if (action === 'stock_in_branch') {
    const branch = searchParams.get('branch')
    const dateFrom = searchParams.get('date_from')
    const dateTo   = searchParams.get('date_to')

    let query = supabase
      .from('purchases')
      .select('*')
      .eq('stock_status', 'in_branch')
      .eq('is_deleted', false)
      .order('purchase_date', { ascending: false })

    if (branch) query = query.eq('branch_name', branch)
    if (dateFrom) query = query.gte('purchase_date', dateFrom)
    if (dateTo)   query = query.lte('purchase_date', dateTo)

    const { data, error } = await query
    return Response.json({ data, error: error?.message })
  }

  // Get all consignments
  if (action === 'consignments') {
    const status = searchParams.get('status')
    const branch = searchParams.get('branch')
    const dateFrom = searchParams.get('date_from')
    const dateTo   = searchParams.get('date_to')

    let query = supabase
      .from('consignments')
      .select(`*, consignment_items(count)`)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)
    if (branch) query = query.eq('branch_name', branch)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo)   query = query.lte('created_at', dateTo)

    const { data, error } = await query
    return Response.json({ data, error: error?.message })
  }

  // Get consignment with its purchase items
  if (action === 'consignment_detail') {
    const id = searchParams.get('id')
    const { data: consignment, error: ce } = await supabase
      .from('consignments')
      .select('*')
      .eq('id', id)
      .single()

    if (ce) return Response.json({ error: ce.message }, { status: 404 })

    const { data: items } = await supabase
      .from('consignment_items')
      .select('*, purchase:purchase_id(*)')
      .eq('consignment_id', id)

    return Response.json({ data: { ...consignment, items } })
  }

  // Get branch-wise stock summary
  if (action === 'branch_summary') {
    const { data, error } = await supabase
      .from('purchases')
      .select('branch_name, stock_status, net_weight, total_amount, purchase_date')
      .eq('is_deleted', false)
      .in('stock_status', ['in_branch', 'in_transit'])

    if (error) return Response.json({ error: error.message })

    // Group by branch and status
    const summary = {}
    for (const row of data || []) {
      const key = row.branch_name
      if (!summary[key]) summary[key] = { branch: key, in_branch: 0, in_transit: 0, in_branch_wt: 0, in_transit_wt: 0 }
      if (row.stock_status === 'in_branch')  { summary[key].in_branch++;  summary[key].in_branch_wt  += parseFloat(row.net_weight || 0) }
      if (row.stock_status === 'in_transit') { summary[key].in_transit++; summary[key].in_transit_wt += parseFloat(row.net_weight || 0) }
    }
    return Response.json({ data: Object.values(summary) })
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}

export async function POST(req) {
  const body = await req.json()
  const { action } = body

  // Create new consignment from selected purchase IDs
  if (action === 'create_consignment') {
    const { purchase_ids, branch_name, branch_code, state_code, movement_type, created_by } = body

    if (!purchase_ids?.length) return Response.json({ error: 'No purchases selected' }, { status: 400 })

    // Generate numbers
    const tmpPrfNo = await generateTmpPrfNo()
    const { extNo, challan } = await generateExternalNo(branch_code, state_code, branch_name)
    const internalNo = movement_type === 'INTERNAL' ? await generateInternalNo(branch_code) : null

    // Get purchase totals
    const { data: purchases } = await supabase
      .from('purchases')
      .select('net_weight, total_amount')
      .in('id', purchase_ids)

    const totalNetWt  = purchases?.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0) || 0
    const totalAmount = purchases?.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0) || 0

    // Create consignment
    const { data: consignment, error: ce } = await supabase
      .from('consignments')
      .insert({
        tmp_prf_no:    tmpPrfNo,
        external_no:   extNo,
        internal_no:   internalNo,
        challan_no:    challan,
        branch_name,
        branch_code,
        state_code,
        movement_type: movement_type || 'EXTERNAL',
        status:        'draft',
        total_bills:   purchase_ids.length,
        total_net_wt:  totalNetWt,
        total_amount:  totalAmount,
        created_by,
      })
      .select()
      .single()

    if (ce) return Response.json({ error: ce.message }, { status: 500 })

    // Link purchases to consignment
    const items = purchase_ids.map(pid => ({ consignment_id: consignment.id, purchase_id: pid, added_by: created_by }))
    await supabase.from('consignment_items').insert(items)

    // Update purchase stock_status to in_transit
    await supabase.from('purchases').update({ stock_status: 'in_transit', dispatched_at: new Date().toISOString() }).in('id', purchase_ids)

    return Response.json({ data: consignment })
  }

  // Dispatch consignment (finalize)
  if (action === 'dispatch') {
    const { id, dispatched_by } = body
    const { data, error } = await supabase
      .from('consignments')
      .update({ status: 'dispatched', dispatched_at: new Date().toISOString(), dispatched_by })
      .eq('id', id)
      .select()
      .single()
    return Response.json({ data, error: error?.message })
  }

  // Remove purchase from consignment (move back to in_branch)
  if (action === 'remove_item') {
    const { consignment_id, purchase_id } = body
    await supabase.from('consignment_items').delete().eq('consignment_id', consignment_id).eq('purchase_id', purchase_id)
    await supabase.from('purchases').update({ stock_status: 'in_branch', dispatched_at: null }).eq('id', purchase_id)

    // Recalculate totals
    const { data: items } = await supabase.from('consignment_items').select('purchase:purchase_id(net_weight,total_amount)').eq('consignment_id', consignment_id)
    const totalNetWt  = items?.reduce((s, i) => s + parseFloat(i.purchase?.net_weight || 0), 0) || 0
    const totalAmount = items?.reduce((s, i) => s + parseFloat(i.purchase?.total_amount || 0), 0) || 0
    await supabase.from('consignments').update({ total_bills: items?.length || 0, total_net_wt: totalNetWt, total_amount: totalAmount }).eq('id', consignment_id)

    return Response.json({ success: true })
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}