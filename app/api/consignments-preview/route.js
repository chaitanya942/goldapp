// Preview next consignment numbers without creating
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

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

function autoBranchCode(branchName) {
  const name = branchName.toUpperCase().trim()
  const stripped = name.replace(/^(AP|KL|TS|KA)-/, '')
  const words = stripped.split(/[\s-]+/).filter(Boolean)

  if (words.length === 1) return words[0].substring(0, 3)
  if (words.length === 2) return (words[0].substring(0, 2) + words[1].substring(0, 2)).substring(0, 4)
  return words.map(w => w[0]).join('').substring(0, 4)
}

async function previewTmpPrfNo() {
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

async function previewExternalNo(branchCode, stateCode) {
  const now = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year = now.getFullYear()
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

  const lastNo = data?.external_no ? parseInt(data.external_no) : 0
  const extNo = String(lastNo + 1).padStart(6, '0')
  const challan = `WG${stateCode}/${stateCode}-${branchCode}/${month}/${year}/${extNo}`
  return { extNo, challan }
}

async function previewInternalNo(branchCode) {
  const now = new Date()
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
  try {
    const { searchParams } = new URL(req.url)
    const branchName = searchParams.get('branch')
    const movementType = searchParams.get('movement_type') || 'EXTERNAL'

    if (!branchName) {
      return Response.json({ error: 'Branch name required' }, { status: 400 })
    }

    // Get branch data
    const { data: branchData } = await supabase
      .from('branches')
      .select('name, region, state')
      .eq('name', branchName)
      .single()

    const stateCode = branchData ? regionToStateCode(branchData.region) : 'KA'
    const branchCode = autoBranchCode(branchName)

    // Preview numbers
    const tmpPrfNo = await previewTmpPrfNo()
    const { extNo, challan } = await previewExternalNo(branchCode, stateCode)
    const internalNo = movementType === 'INTERNAL' ? await previewInternalNo(branchCode) : null

    return Response.json({
      tmp_prf_no: tmpPrfNo,
      external_no: extNo,
      internal_no: internalNo,
      challan_no: challan,
      branch_code: branchCode,
      state_code: stateCode
    })
  } catch (err) {
    console.error('Preview error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
