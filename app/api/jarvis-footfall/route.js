// Jarvis store footfall vs CRM walk-ins, per branch per IST day.
// Footfall comes from jarvis_footfall (filled by /api/sync-jarvis); walk-ins
// and the join live in lib/jarvisFootfallData. Region-scoped users only get
// their regions.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { getAllowedRegionsForAuth } from '../../../lib/regionScope'
import { selectAllRows } from '../../../lib/supabaseAll'
import { oldCrmWalkins, newCrmWalkins, mergeFootfallRows } from '../../../lib/jarvisFootfallData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const MAX_SPAN_DAYS = 92
const CACHE_TTL_MS = 60_000
const LIVE_CACHE_TTL_MS = 20_000   // ranges that include today refresh near-realtime
const cache = new Map()

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const spanDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1
const isMissingTable = (err) => /jarvis_footfall/.test(err?.message || '') && /does not exist|schema cache/i.test(err?.message || '')

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const today = istToday()
  const from = isDate(searchParams.get('from')) ? searchParams.get('from') : today
  const to = isDate(searchParams.get('to')) ? searchParams.get('to') : from
  if (to < from) return Response.json({ error: 'from must be on or before to' }, { status: 400 })
  if (spanDays(from, to) > MAX_SPAN_DAYS) return Response.json({ error: `Range is limited to ${MAX_SPAN_DAYS} days` }, { status: 400 })

  const allowedRegions = await getAllowedRegionsForAuth(supabase, auth)
  const cacheKey = `${from}|${to}|${(allowedRegions || ['ALL']).slice().sort().join(',')}`
  const hit = cache.get(cacheKey)
  const ttl = to >= today ? LIVE_CACHE_TTL_MS : CACHE_TTL_MS
  if (hit && Date.now() - hit.ts < ttl) return Response.json({ ...hit.data, cached: true })

  const { data: branches, error: brErr } = await supabase.from('branches').select('name, region, crm_branch_id')
  if (brErr) return Response.json({ error: brErr.message }, { status: 500 })

  let footfall = []
  let tableMissing = false
  try {
    footfall = await selectAllRows(() => supabase.from('jarvis_footfall')
      .select('store_code, store_name, footfall_date, entry_count, male_count, female_count, age_data, data_status, staff_reduction_status')
      .gte('footfall_date', from).lte('footfall_date', to)
      .order('footfall_date').order('store_code'))
  } catch (err) {
    if (isMissingTable(err)) tableMissing = true
    else return Response.json({ error: err.message }, { status: 500 })
  }

  const [oldRes, newRes, lastSync] = await Promise.allSettled([
    oldCrmWalkins(from, to),
    newCrmWalkins(from, to),
    tableMissing ? Promise.resolve(null) : supabase.from('jarvis_footfall').select('fetched_at').order('fetched_at', { ascending: false }).limit(1),
  ])

  const rows = mergeFootfallRows({
    branches, footfall, from, to, allowedRegions,
    oldRows: oldRes.status === 'fulfilled' ? oldRes.value : null,
    newRows: newRes.status === 'fulfilled' ? newRes.value : null,
  })
  const crm = {
    old: oldRes.status === 'fulfilled' ? 'ok' : (oldRes.reason?.message || 'unavailable'),
    new: newRes.status === 'fulfilled' ? 'ok' : (newRes.reason?.message || 'unavailable'),
  }
  const lastSyncedAt = lastSync.status === 'fulfilled' ? lastSync.value?.data?.[0]?.fetched_at || null : null

  const data = { from, to, today, tableMissing, lastSyncedAt, crm, rows }
  cache.set(cacheKey, { data, ts: Date.now() })
  if (cache.size > 60) cache.delete(cache.keys().next().value)
  return Response.json(data)
}
