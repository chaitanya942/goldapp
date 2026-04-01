// API to set/get initial seed values for consignment number generation
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET: Fetch current seed values — 3 queries total (was 140+)
export async function GET(req) {
  try {
    // Run all 3 fetches in parallel
    const [branchesRes, consignmentsRes, globalExtRes] = await Promise.all([
      // 1. All outside-Bangalore branches
      supabase
        .from('branches')
        .select('name, region')
        .eq('is_active', true)
        .neq('region', 'Bangalore')
        .order('region')
        .order('name'),

      // 2. All consignments — just the columns we need to derive per-branch max tmp_prf_no
      supabase
        .from('consignments')
        .select('branch_name, tmp_prf_no, challan_no, branch_code')
        .not('tmp_prf_no', 'is', null)
        .order('tmp_prf_no', { ascending: false }),

      // 3. Global max external_no (seed floor: 001903)
      supabase
        .from('consignments')
        .select('external_no')
        .not('external_no', 'is', null)
        .order('external_no', { ascending: false })
        .limit(1)
        .single(),
    ])

    const branches     = branchesRes.data   || []
    const consignments = consignmentsRes.data || []

    // Build per-branch maps in a single pass (already sorted DESC so first hit = max)
    const tmpPrfMap  = {}   // branch_name → last tmp_prf_no
    const challanMap = {}   // branch_name → { challan_no, branch_code }
    for (const c of consignments) {
      if (!tmpPrfMap[c.branch_name])  tmpPrfMap[c.branch_name]  = c.tmp_prf_no
      if (!challanMap[c.branch_name]) challanMap[c.branch_name] = { challan_no: c.challan_no, branch_code: c.branch_code }
    }

    const branchSeeds = branches.map(b => ({
      branch_name:     b.name,
      region:          b.region,
      last_tmp_prf_no: tmpPrfMap[b.name]          || '—',
      last_challan_no: challanMap[b.name]?.challan_no || 'Not set',
      branch_code:     challanMap[b.name]?.branch_code,
    }))

    const rawExt         = globalExtRes.data?.external_no
    const lastExternalNo = rawExt
      ? String(Math.max(parseInt(rawExt), 1903)).padStart(6, '0')
      : '001903'

    return Response.json({
      last_external_no: lastExternalNo,
      branches:         branchSeeds,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST: Manually set seed consignment for a branch
export async function POST(req) {
  try {
    const body = await req.json()
    const { branch_name, tmp_prf_no, external_no, challan_no, state_code, branch_code } = body

    if (!branch_name || !tmp_prf_no || !external_no) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('consignments')
      .insert({
        tmp_prf_no,
        external_no,
        internal_no:   null,
        challan_no:    challan_no || `SEED-${branch_name}`,
        branch_name,
        branch_code:   branch_code || branch_name.substring(0, 3).toUpperCase(),
        state_code:    state_code  || 'KA',
        movement_type: 'EXTERNAL',
        status:        'seed',
        total_bills:   0,
        total_net_wt:  0,
        total_amount:  0,
        created_by:    'SYSTEM_SEED',
      })
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, data })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
