// Per-branch last-used tamper-proof number (max WG###### on consignments).
// Powers the Branches detail panel: Last used = this value; Next = value + 1.
// Cached in-module (5 min).
import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

let _cache = null
let _cacheAt = 0
const TTL = 5 * 60 * 1000

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'branch-management')
  if (!auth.ok) return auth.response

  const now = Date.now()
  if (_cache && now - _cacheAt < TTL) return Response.json(_cache)

  try {
    // Max numeric tmp_prf_no per branch, over non-cancelled WG consignments.
    const lastTmp = {}
    const CHUNK = 1000
    for (let i = 0; ; i += CHUNK) {
      const { data, error } = await supabase
        .from('consignments')
        .select('branch_name, tmp_prf_no')
        .like('tmp_prf_no', 'WG%')
        .neq('status', 'cancelled')
        .range(i, i + CHUNK - 1)
      if (error || !data || !data.length) break
      for (const c of data) {
        const n = parseInt(String(c.tmp_prf_no).replace(/\D/g, '')) || 0
        if (!lastTmp[c.branch_name] || n > lastTmp[c.branch_name]) lastTmp[c.branch_name] = n
      }
      if (data.length < CHUNK) break
    }
    _cache = { lastTmp, generated_at: new Date().toISOString() }
    _cacheAt = now
    return Response.json(_cache)
  } catch (err) {
    return Response.json({ error: err.message, lastTmp: {} }, { status: 500 })
  }
}
