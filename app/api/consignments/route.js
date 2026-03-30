// app/api/consignments/route.js

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Derive state code from region ─────────────────────────────────────────────
function regionToStateCode(region) {
  const map = {
    'Andhra Pradesh':    'AP',
    'Kerala':            'KL',
    'Telangana':         'TS',
    'Rest of Karnataka': 'KA',
    'Bangalore':         'KA',
  }
  return map[region] || 'KA'
}

// ── Auto-generate branch code from branch name ────────────────────────────────
// KL-THRISSUR → THR, AP-GUNTUR → GNT, TUMKUR → TUM, TS-KUKATPALLY → KKP
function autoBranchCode(branchName) {
  const name = branchName.toUpperCase().trim()
  // Remove state prefix if present (AP-, KL-, TS-)
  const stripped = name.replace(/^(AP|KL|TS|KA)-/, '')
  const words    = stripped.split(/[\s-]+/).filter(Boolean)

  if (words.length === 1) {
    // Single word — take first 3 chars
    return words[0].substring(0, 3)
  }
  if (words.length === 2) {
    // Two words — take first 2 chars of each
    return (words[0].substring(0, 2) + words[1].substring(0, 2)).substring(0, 4)
  }
  // Multiple words — take first char of each word, up to 4
  return words.map(w => w[0]).join('').substring(0, 4)
}

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

// ── Generate External No + Challan No ────────────────────────────────────────
async function generateExternalNo(branchCode, stateCode) {
  const now        = new Date()
  const month      = now.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year       = now.getFullYear()
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

// ── Generate Internal No ──────────────────────────────────────────────────────
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

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // ── Get outside-Bangalore branches from branches master ──────────────────
  if (action === 'branches') {
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, state, region, cluster, model_type, address, city, pin_code, contact_person, contact_phone, branch_gstin')
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

    // Get outside-Bangalore branch names
    const { data: outsideBranches } = await supabase
      .from('branches')
      .select('name')
      .eq('is_active', true)
      .neq('region', 'Bangalore')

    const outsideNames = (outsideBranches || []).map(b => b.name)

    let query = supabase
      .from('purchases')
      .select('*')
      .eq('stock_status', 'at_branch')
      .eq('is_deleted', false)
      .in('branch_name', outsideNames)
      .order('purchase_date', { ascending: false })

    if (branch)   query = query.eq('branch_name', branch)
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
      .select('branch_name, stock_status, net_weight, total_amount')
      .eq('is_deleted', false)
      .in('stock_status', ['at_branch', 'in_consignment'])
      .in('branch_name', Object.keys(branchMeta))

    const summary = {}
    for (const row of purchases || []) {
      const key  = row.branch_name
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

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req) {
  const body   = await req.json()
  const { action } = body

  // ── Create consignment ───────────────────────────────────────────────────
  if (action === 'create_consignment') {
    const { purchase_ids, branch_name, movement_type, created_by } = body
    if (!purchase_ids?.length) return Response.json({ error: 'No purchases selected' }, { status: 400 })

    // Get branch meta from branches table
    const { data: branchData } = await supabase
      .from('branches')
      .select('name, region, state')
      .eq('name', branch_name)
      .single()

    const stateCode  = branchData ? regionToStateCode(branchData.region) : 'KA'
    const branchCode = autoBranchCode(branch_name)

    const tmpPrfNo           = await generateTmpPrfNo()
    const { extNo, challan } = await generateExternalNo(branchCode, stateCode)
    const internalNo         = movement_type === 'INTERNAL' ? await generateInternalNo(branchCode) : null

    // Totals
    const { data: purchases } = await supabase
      .from('purchases')
      .select('net_weight, total_amount')
      .in('id', purchase_ids)

    const totalNetWt  = purchases?.reduce((s, p) => s + parseFloat(p.net_weight || 0), 0) || 0
    const totalAmount = purchases?.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0) || 0

    const { data: consignment, error: ce } = await supabase
      .from('consignments')
      .insert({
        tmp_prf_no:    tmpPrfNo,
        external_no:   extNo,
        internal_no:   internalNo,
        challan_no:    challan,
        branch_name,
        branch_code:   branchCode,
        state_code:    stateCode,
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

    // Link items
    await supabase.from('consignment_items').insert(
      purchase_ids.map(pid => ({ consignment_id: consignment.id, purchase_id: pid, added_by: created_by }))
    )

    // Move purchases to in_consignment
    await supabase.from('purchases')
      .update({ stock_status: 'in_consignment', dispatched_at: new Date().toISOString() })
      .in('id', purchase_ids)

    return Response.json({ data: consignment })
  }

  // ── Dispatch consignment ─────────────────────────────────────────────────
  if (action === 'dispatch') {
    const { id, dispatched_by } = body
    const { data, error } = await supabase
      .from('consignments')
      .update({ status: 'dispatched', dispatched_at: new Date().toISOString(), dispatched_by })
      .eq('id', id).select().single()
    return Response.json({ data, error: error?.message })
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