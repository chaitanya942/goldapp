// Preview next consignment numbers without creating
import { createClient } from '@supabase/supabase-js'
import {
  regionToStateCode,
  autoBranchCode,
  generateTmpPrfNo,
  generateExternalNo,
  generateInternalNo,
} from '../../../lib/consignmentUtils'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const branchName   = searchParams.get('branch')
    const movementType = searchParams.get('movement_type') || 'EXTERNAL'

    if (!branchName) {
      return Response.json({ error: 'Branch name required' }, { status: 400 })
    }

    const { data: branchData, error: branchErr } = await supabase
      .from('branches')
      .select('name, region, state')
      .eq('name', branchName)
      .single()

    if (branchErr || !branchData) {
      return Response.json({ error: `Branch '${branchName}' not found` }, { status: 400 })
    }

    const stateCode  = regionToStateCode(branchData.region)
    const branchCode = autoBranchCode(branchName)

    const [tmpPrfNo, { extNo, challan }, internalNo] = await Promise.all([
      generateTmpPrfNo(supabase, branchName),
      generateExternalNo(supabase, branchCode, stateCode),
      movementType === 'INTERNAL' ? generateInternalNo(supabase, branchCode) : Promise.resolve(null),
    ])

    return Response.json({
      tmp_prf_no:  tmpPrfNo,
      external_no: extNo,
      internal_no: internalNo,
      challan_no:  challan,
      branch_code: branchCode,
      state_code:  stateCode,
    })
  } catch (err) {
    console.error('Preview error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
