// Preview next consignment numbers without creating
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const EXT_NO_SEED = 1903

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
  const name     = branchName.toUpperCase().trim()
  const stripped = name.replace(/^(AP|KL|TS|KA)-/, '')
  const words    = stripped.split(/[\s-]+/).filter(Boolean)
  if (words.length === 1) return words[0].substring(0, 3)
  if (words.length === 2) return (words[0].substring(0, 2) + words[1].substring(0, 2)).substring(0, 4)
  return words.map(w => w[0]).join('').substring(0, 4)
}

// TMP PRF is per-branch sequential
async function previewTmpPrfNo(branchName) {
  const { data } = await supabase
    .from('consignments')
    .select('tmp_prf_no')
    .eq('branch_name', branchName)
    .not('tmp_prf_no', 'is', null)
    .order('tmp_prf_no', { ascending: false })
    .limit(1)
    .single()

  const last = data?.tmp_prf_no ? parseInt(data.tmp_prf_no.replace('WG', '')) || 0 : 0
  return `WG${String(last + 1).padStart(6, '0')}`
}

// External No is GLOBAL — no branch filter, seed floor 1903
async function previewExternalNo(branchCode, stateCode) {
  const now   = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year  = now.getFullYear()

  const { data } = await supabase
    .from('consignments')
    .select('external_no')
    .not('external_no', 'is', null)
    .order('external_no', { ascending: false })
    .limit(1)
    .single()

  const lastNo  = data?.external_no ? parseInt(data.external_no) : 0
  const extNo   = String(Math.max(lastNo, EXT_NO_SEED) + 1).padStart(6, '0')
  const challan = `WG${stateCode}/${stateCode}-${branchCode}/${month}/${year}/${extNo}`
  return { extNo, challan }
}

async function previewInternalNo(branchCode) {
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
  try {
    const { searchParams } = new URL(req.url)
    const branchName   = searchParams.get('branch')
    const movementType = searchParams.get('movement_type') || 'EXTERNAL'

    if (!branchName) {
      return Response.json({ error: 'Branch name required' }, { status: 400 })
    }

    const { data: branchData } = await supabase
      .from('branches')
      .select('name, region, state')
      .eq('name', branchName)
      .single()

    const stateCode  = branchData ? regionToStateCode(branchData.region) : 'KA'
    const branchCode = autoBranchCode(branchName)

    const [tmpPrfNo, { extNo, challan }, internalNo] = await Promise.all([
      previewTmpPrfNo(branchName),
      previewExternalNo(branchCode, stateCode),
      movementType === 'INTERNAL' ? previewInternalNo(branchCode) : Promise.resolve(null),
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
