// API to set/get initial seed values for consignment number generation
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET: Fetch current seed values
export async function GET(req) {
  try {
    // Get last External No — global unique across all branches
    const { data: lastTmpPrf } = await supabase
      .from('consignments')
      .select('external_no')
      .not('external_no', 'is', null)
      .order('external_no', { ascending: false })
      .limit(1)
      .single()

    // Get all outside-Bangalore branches
    const { data: branches } = await supabase
      .from('branches')
      .select('name, region')
      .eq('is_active', true)
      .neq('region', 'Bangalore')
      .order('region')
      .order('name')

    const branchSeeds = []
    for (const branch of branches || []) {
      // Last TMP PRF for this branch (per-branch sequence)
      const { data: lastTmp } = await supabase
        .from('consignments')
        .select('tmp_prf_no')
        .eq('branch_name', branch.name)
        .not('tmp_prf_no', 'is', null)
        .order('tmp_prf_no', { ascending: false })
        .limit(1)
        .single()

      // Last challan for this branch (external_no here is for reference only — global counter)
      const { data: lastExt } = await supabase
        .from('consignments')
        .select('external_no, challan_no, branch_code')
        .eq('branch_name', branch.name)
        .not('challan_no', 'is', null)
        .order('external_no', { ascending: false })
        .limit(1)
        .single()

      branchSeeds.push({
        branch_name:      branch.name,
        region:           branch.region,
        last_tmp_prf_no:  lastTmp?.tmp_prf_no  || '—',
        last_external_no: lastExt?.external_no || '—',
        last_challan_no:  lastExt?.challan_no  || 'Not set',
        branch_code:      lastExt?.branch_code,
      })
    }

    return Response.json({
      last_external_no: lastTmpPrf?.external_no || '000000',
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

    // Insert a seed consignment record
    const { data, error } = await supabase
      .from('consignments')
      .insert({
        tmp_prf_no,
        external_no,
        internal_no: null,
        challan_no: challan_no || `SEED-${branch_name}`,
        branch_name,
        branch_code: branch_code || branch_name.substring(0, 3).toUpperCase(),
        state_code: state_code || 'KA',
        movement_type: 'EXTERNAL',
        status: 'seed',
        total_bills: 0,
        total_net_wt: 0,
        total_amount: 0,
        created_by: 'SYSTEM_SEED',
      })
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, data })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
