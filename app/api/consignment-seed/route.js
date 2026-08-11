// API to set/get initial seed values for consignment number generation.
// Authorisation: page-permission based — any role granted
// `page.consignment-seeds` via Role Management can read AND write. Previously
// hard-coded to ROLE_GROUPS.ADMIN, which silently broke delegation.
import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// GET: Fetch current seed values (3 parallel queries instead of 140+).
export async function GET(req) {
  const auth = await requireAuthForPage(req, 'consignment-seeds')
  if (!auth.ok) return auth.response
  try {
    // Branches + last external_no in parallel.
    const [branchesRes, lastExtRes] = await Promise.all([
      // 1. All outside-Bangalore branches
      supabase
        .from('branches')
        .select('name, region')
        .eq('is_active', true)
        .neq('region', 'Bangalore')
        .order('region')
        .order('name'),

      // 3. Last issued external_no via the sequence-backed RPC. Atomic and
      // immune to the dirty-data issue that broke the old SELECT MAX
      // approach (SEED-* + WG-prefixed garbage in external_no column sorted
      // ABOVE real numeric values, alpha-tricking parseInt into NaN).
      supabase.rpc('get_last_external_no'),
    ])

    // 2. All consignments — columns needed to derive per-branch max tmp_prf_no.
    // Exclude cancelled rows so "last used" matches the next-number generator.
    // PAGINATE: a single call caps at Supabase's 1000-row max_rows, which
    // silently dropped whole branches once consignments exceed 1000 (their
    // "last used" then showed as —). Ordered tmp_prf_no DESC across pages, so
    // the first hit per branch is still the global max.
    const consignments = []
    const CHUNK = 1000
    for (let i = 0; ; i += CHUNK) {
      const { data, error } = await supabase
        .from('consignments')
        .select('branch_name, tmp_prf_no, challan_no, branch_code, status')
        .not('tmp_prf_no', 'is', null)
        .neq('status', 'cancelled')
        .order('tmp_prf_no', { ascending: false })
        .range(i, i + CHUNK - 1)
      if (error || !data || !data.length) break
      consignments.push(...data)
      if (data.length < CHUNK) break
    }

    const branches = branchesRes.data || []

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

    // RPC returns a 6-digit zero-padded text. If it errors (sequence not
    // installed yet), fall back to the seed floor so the page still loads.
    const lastExternalNo = (typeof lastExtRes.data === 'string' && lastExtRes.data)
      ? lastExtRes.data
      : '001903'

    return Response.json({
      last_external_no: lastExternalNo,
      branches:         branchSeeds,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST: Manually set seed consignment for a branch — changes the next
// number issued. Allowed for any role granted page.consignment-seeds.
//
// Ops only need to set the TMP PRF (the "tamper-proof" number). external_no
// and challan_no on a seed row are placeholders; the live external_no
// sequence skips status='seed' rows so these values never bleed into a
// real consignment's challan. Both are auto-generated if not provided.
export async function POST(req) {
  const auth = await requireAuthForPage(req, 'consignment-seeds')
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const { branch_name, tmp_prf_no, external_no, challan_no, state_code, branch_code } = body

    if (!branch_name || !tmp_prf_no) {
      return Response.json({ error: 'branch_name and tmp_prf_no are required' }, { status: 400 })
    }

    // Placeholder values — these only live on this seed row and never form
    // a real challan. The TMP PRF the user actually cares about is set above.
    const externalNoFinal = external_no || `SEED-${branch_name}-${tmp_prf_no}`
    const challanFinal    = challan_no  || `SEED-${branch_name}-${tmp_prf_no}`
    const { data, error } = await supabase
      .from('consignments')
      .insert({
        consignment_no: challanFinal,                 // NOT NULL — mirror challan_no
        tmp_prf_no,
        external_no:   externalNoFinal,
        internal_no:   null,
        challan_no:    challanFinal,
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
