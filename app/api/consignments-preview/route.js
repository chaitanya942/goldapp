// Preview next consignment numbers without creating
import { createClient } from '@supabase/supabase-js'
import {
  regionToStateCode,
  autoBranchCode,
  generateTmpPrfNo,
  generateExternalNo,
  generateIssueVoucherNo,
} from '../../../lib/consignmentUtils'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
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

    // Mirror create_consignment logic exactly so preview == actual generated value.
    const tmpPrfNo = await generateTmpPrfNo(supabase, branchName)

    let extNo = null, internalNo = null, challan = null
    if (movementType === 'INTERNAL') {
      const { internalNo: seq, voucher } = await generateIssueVoucherNo(supabase, branchCode, stateCode)
      internalNo = seq
      challan    = voucher
    } else {
      const ext = await generateExternalNo(supabase, branchCode, stateCode)
      extNo   = ext.extNo
      challan = ext.challan
    }

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
