// Per-branch tamper-proof seal state.
//   GET  — last used (max WG###### on non-cancelled consignments) + any pending
//          one-shot "next" override, per branch. Powers the Branches detail panel.
//   POST — ops edits Last used and/or Next for one branch (validated + notified).
// GET cached in-module (5 min); POST busts the cache.
import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'
import { tmpPrfToInt, intToTmpPrf, tmpPrfUsedBy } from '../../../lib/consignmentUtils'

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
        const n = tmpPrfToInt(c.tmp_prf_no)
        if (!lastTmp[c.branch_name] || n > lastTmp[c.branch_name]) lastTmp[c.branch_name] = n
      }
      if (data.length < CHUNK) break
    }

    // Pending one-shot "next" overrides per branch (branches.next_seal_override).
    const overrides = {}
    const { data: ovRows } = await supabase
      .from('branches')
      .select('name, next_seal_override')
      .not('next_seal_override', 'is', null)
    for (const b of (ovRows || [])) overrides[b.name] = b.next_seal_override

    _cache = { lastTmp, overrides, generated_at: new Date().toISOString() }
    _cacheAt = now
    return Response.json(_cache)
  } catch (err) {
    return Response.json({ error: err.message, lastTmp: {}, overrides: {} }, { status: 500 })
  }
}

// Highest REAL seal (non-cancelled, non-seed) for a branch — the floor below which
// "Last used" cannot be set, because those seals were physically issued.
async function realDispatchedMax(branchName) {
  let max = 0
  const CHUNK = 1000
  for (let i = 0; ; i += CHUNK) {
    const { data, error } = await supabase
      .from('consignments')
      .select('tmp_prf_no, status')
      .eq('branch_name', branchName)
      .like('tmp_prf_no', 'WG%')
      .neq('status', 'cancelled')
      .neq('status', 'seed')
      .range(i, i + CHUNK - 1)
    if (error || !data || !data.length) break
    for (const c of data) { const n = tmpPrfToInt(c.tmp_prf_no); if (n > max) max = n }
    if (data.length < CHUNK) break
  }
  return max
}

// Current max INCLUDING seed floor rows.
async function currentMax(branchName) {
  const { data } = await supabase
    .from('consignments')
    .select('tmp_prf_no')
    .eq('branch_name', branchName)
    .like('tmp_prf_no', 'WG%')
    .neq('status', 'cancelled')
    .order('tmp_prf_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  return tmpPrfToInt(data?.tmp_prf_no)
}

// POST { branch_name, last_used?, next? } — set either/both, with validation.
export async function POST(req) {
  const auth = await requireAuthForPage(req, 'branch-management')
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const branchName = (body.branch_name || '').trim()
    if (!branchName) return Response.json({ error: 'branch_name is required' }, { status: 400 })

    const { data: branch } = await supabase
      .from('branches').select('name, branch_code, state').eq('name', branchName).maybeSingle()
    if (!branch) return Response.json({ error: `Branch '${branchName}' not found` }, { status: 400 })

    const stateCode = (branchName.match(/^([A-Z]{2})-/) || [])[1] || 'KA'
    let newLast = await currentMax(branchName)

    // ── 1) Last used ──────────────────────────────────────────────────────────
    if (body.last_used != null && String(body.last_used).trim() !== '') {
      const L = tmpPrfToInt(body.last_used)
      if (L < 1) return Response.json({ error: 'Last used must be a WG number.' }, { status: 400 })
      const realMax = await realDispatchedMax(branchName)
      if (L < realMax) {
        return Response.json({
          error: `Last used can't be set below ${intToTmpPrf(realMax)} — a live consignment already used that seal.`,
          code: 'BELOW_DISPATCHED',
        }, { status: 409 })
      }
      // Drop any seed floor rows above the new last-used (they'd re-inflate the max).
      const { data: seeds } = await supabase
        .from('consignments').select('id, tmp_prf_no')
        .eq('branch_name', branchName).eq('status', 'seed')
      const killIds = (seeds || []).filter(s => tmpPrfToInt(s.tmp_prf_no) > L).map(s => s.id)
      if (killIds.length) await supabase.from('consignments').delete().in('id', killIds)
      // Raise the floor with a seed row if nothing non-cancelled reaches L yet.
      const maxNow = await currentMax(branchName)
      if (maxNow < L) {
        const wg = intToTmpPrf(L)
        await supabase.from('consignments').insert({
          consignment_no: `SEED-${branchName}-${wg}`, tmp_prf_no: wg,
          external_no: `SEED-${branchName}-${wg}`, challan_no: `SEED-${branchName}-${wg}`,
          branch_name: branchName, branch_code: branch.branch_code || branchName.substring(0, 3).toUpperCase(),
          state_code: stateCode, movement_type: 'EXTERNAL', status: 'seed',
          total_bills: 0, total_net_wt: 0, total_amount: 0, created_by: 'SYSTEM_SEED',
        })
      }
      newLast = L
    }

    // ── 2) Next (one-shot override) ───────────────────────────────────────────
    let overrideVal = null
    if (body.next != null && String(body.next).trim() !== '') {
      const N = tmpPrfToInt(body.next)
      if (N < 1) return Response.json({ error: 'Next must be a WG number.' }, { status: 400 })
      const usedBy = await tmpPrfUsedBy(supabase, branchName, N)
      if (usedBy) {
        return Response.json({
          error: `${intToTmpPrf(N)} is already used by consignment ${usedBy.challan_no || usedBy.consignment_no}. Pick an unused number.`,
          code: 'ALREADY_USED',
          used_by: usedBy.challan_no || usedBy.consignment_no,
        }, { status: 409 })
      }
      // If Next equals the natural default (last + 1), store NULL (no override).
      overrideVal = (N === newLast + 1) ? null : N
    }
    // Only touch the override column when Next was actually supplied.
    if (body.next != null) {
      await supabase.from('branches').update({ next_seal_override: overrideVal }).eq('name', branchName)
    }

    _cache = null  // bust GET cache so the panel reflects the change immediately
    return Response.json({
      success: true,
      branch_name: branchName,
      last_used: intToTmpPrf(newLast),
      next: intToTmpPrf(overrideVal || newLast + 1),
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
