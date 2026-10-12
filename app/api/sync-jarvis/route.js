// Copies Jarvis store footfall into Supabase (jarvis_footfall).
// Jarvis keeps only the last 15 days, so this runs on the cron worker:
// every ~20 min for the last couple of days (today is partial until close),
// plus any day in the 15-day window Jarvis hasn't finalised yet (data_status
// not FULL, or staff reduction not SUCCESS — those counts get revised).
// ?days=15 does a full backfill of everything Jarvis still serves.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'
import { jarvisSession, fetchStoreDay } from '../../../lib/jarvis'
import { selectAllRows } from '../../../lib/supabaseAll'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const JARVIS_WINDOW_DAYS = 15
const CONCURRENCY = 8

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const isMissingTable = (err) => /jarvis_footfall/.test(err?.message || '') && /does not exist|schema cache/i.test(err?.message || '')

async function runPool(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]) }
  }))
}

export async function POST(req) {
  const cronToken = req.headers.get('x-cron-token')
  const isCron = !!process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET
  if (!isCron) {
    const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
    if (!auth.ok) return auth.response
  }

  const { searchParams } = new URL(req.url)
  const days = Math.min(JARVIS_WINDOW_DAYS, Math.max(1, parseInt(searchParams.get('days') || '2', 10) || 2))
  const today = istToday()
  const oldest = addDays(today, -(JARVIS_WINDOW_DAYS - 1))

  const dates = new Set(Array.from({ length: days }, (_, i) => addDays(today, -i)))
  let unsettled
  try {
    unsettled = await selectAllRows(() => supabase.from('jarvis_footfall')
      .select('footfall_date')
      .gte('footfall_date', oldest)
      .or('data_status.neq.FULL,staff_reduction_status.neq.SUCCESS,data_status.is.null,staff_reduction_status.is.null'))
  } catch (err) {
    if (isMissingTable(err)) return Response.json({ success: false, error: 'jarvis_footfall table missing — run sql/jarvis_footfall.sql in Supabase' }, { status: 500 })
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
  for (const r of unsettled) if (r.footfall_date >= oldest) dates.add(r.footfall_date)

  let sess
  try { sess = await jarvisSession(true) }
  catch (err) { return Response.json({ success: false, error: err.message }, { status: 502 }) }

  const jobs = []
  for (const d of [...dates].sort()) for (const s of sess.stores) jobs.push({ d, s })

  const rows = []
  const failures = []
  const fetchedAt = new Date().toISOString()
  await runPool(jobs, CONCURRENCY, async ({ d, s }) => {
    try {
      const r = await fetchStoreDay(s.code, d)
      if (!r.ok) { failures.push(`${s.name} ${d}: ${r.body?.message || r.status}`); return }
      const x = r.body.data || {}
      rows.push({
        store_code: s.code,
        store_name: s.name,
        footfall_date: d,
        entry_count: Number(x.entry_count) || 0,
        male_count: x.male_count ?? null,
        female_count: x.female_count ?? null,
        age_data: x.age_data && typeof x.age_data === 'object' ? x.age_data : null,
        data_status: r.body.data_status || null,
        staff_reduction_status: r.body.staff_reduction_status || null,
        message: r.body.message || null,
        fetched_at: fetchedAt,
      })
    } catch (err) {
      failures.push(`${s.name} ${d}: ${err.message}`)
    }
  })

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('jarvis_footfall').upsert(rows.slice(i, i + 500), { onConflict: 'store_code,footfall_date' })
    if (error) {
      const msg = isMissingTable(error) ? 'jarvis_footfall table missing — run sql/jarvis_footfall.sql in Supabase' : error.message
      return Response.json({ success: false, error: msg }, { status: 500 })
    }
  }

  return Response.json({
    success: true,
    dates: [...dates].sort(),
    stores: sess.stores.length,
    upserted: rows.length,
    failed: failures.length,
    failures: failures.slice(0, 10),
  })
}
