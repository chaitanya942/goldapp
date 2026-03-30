// API to set/get initial seed values for consignment number generation
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET: Fetch current seed values
export async function GET(req) {
  try {
    // Get last TMP PRF number
    const { data: lastTmpPrf } = await supabase
      .from('consignments')
      .select('tmp_prf_no')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Get last external numbers per branch
    const { data: branches } = await supabase
      .from('branches')
      .select('name')
      .eq('is_active', true)

    const branchSeeds = []
    for (const branch of branches || []) {
      const { data: lastExt } = await supabase
        .from('consignments')
        .select('external_no, challan_no, branch_code')
        .eq('branch_name', branch.name)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      branchSeeds.push({
        branch_name: branch.name,
        last_external_no: lastExt?.external_no || '000000',
        last_challan_no: lastExt?.challan_no || 'Not set',
        branch_code: lastExt?.branch_code
      })
    }

    return Response.json({
      tmp_prf_no: lastTmpPrf?.tmp_prf_no || 'WG000000',
      branches: branchSeeds.slice(0, 20) // First 20 for display
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
        status: 'seed', // Special status for seed records
        total_bills: 0,
        total_net_wt: 0,
        total_amount: 0,
        created_by: 'SYSTEM_SEED'
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
