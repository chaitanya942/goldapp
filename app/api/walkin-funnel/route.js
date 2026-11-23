// GET /api/walkin-funnel?from=YYYY-MM-DD&to=YYYY-MM-DD[&filter_type=region|state|cluster|branch&filter_value=X]
//
// The day's walk-in funnel in one place:
//   1. Jarvis store footfall (camera branches) — group count + unique count
//   2. OTPs generated — Telesales (TS) + Direct Walk-in (DW)
//   3. CRM punch-ins (walk-in transactions) — TS + DW (+ walk-ins with no OTP)
// plus the stage-to-stage attribution. Composes lib/otpChannels (OTP + punch-ins
// attributed by channel) and lib/jarvisFootfallData (camera footfall vs CRM
// walk-ins). Region-scoped users only get their regions; the Jarvis stage is
// returned only to accounts allowed to see Jarvis (lib/jarvisAccess).
//
// Ranges end yesterday (IST) at the latest — today's camera counts are partial —
// and never start before the OTP data start (1 Oct 2026).

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { canSeeJarvis } from '../../../lib/jarvisAccess'
import { getAllowedRegionsForAuth } from '../../../lib/regionScope'
import { selectAllRows } from '../../../lib/supabaseAll'
import { newCrmWalkins, mergeFootfallRows } from '../../../lib/jarvisFootfallData'
import { buildBranchResolver } from '../../../lib/branchNameResolver'
import { buildOtpChannelReport, OTP_DATA_START, OTP_FILTER_TYPES } from '../../../lib/otpChannels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const isMissingTable = (err) => /jarvis_footfall/.test(err?.message || '') && /does not exist|schema cache/i.test(err?.message || '')

const cache = new Map()
const CACHE_MS = 60_000

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const today = istToday()
  const yesterday = addDays(today, -1)
  let from = isDate(searchParams.get('from')) ? searchParams.get('from') : yesterday
  let to = isDate(searchParams.get('to')) ? searchParams.get('to') : from
  if (from < OTP_DATA_START) from = OTP_DATA_START
  if (to > yesterday) to = yesterday           // camera data is only complete through yesterday
  if (to < from) return Response.json({ error: `Pick a range from ${OTP_DATA_START} up to yesterday.` }, { status: 400 })

  const fType = searchParams.get('filter_type'), fValue = searchParams.get('filter_value')
  const filter = OTP_FILTER_TYPES.includes(fType) && fValue ? { type: fType, value: fValue } : null

  const allowedRegions = await getAllowedRegionsForAuth(supabase, auth)
  const jarvisOk = canSeeJarvis(auth.role, auth.profile?.email || auth.user?.email)
  const key = `${from}|${to}|${filter ? filter.type + ':' + filter.value : ''}|${jarvisOk ? 'J' : ''}|${(allowedRegions || ['ALL']).slice().sort().join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_MS) return Response.json({ ...hit.data, cached: true })

  try {
    const [{ data: branchMeta }, otp] = await Promise.all([
      supabase.from('branches').select('name, region, state, cluster'),
      buildOtpChannelReport({ from, to, allowedRegions, filter }),
    ])

    // ── Per-day union: OTPs + punch-ins (from the OTP report) ──
    const days = new Map()
    const dayCell = (d) => days.get(d) || days.set(d, { date: d, otp_TS: 0, otp_DW: 0, punch_TS: 0, punch_DW: 0, jarvis_group: 0, jarvis_footfall: 0 }).get(d)
    for (const x of otp.days || []) {
      const c = dayCell(x.date)
      c.otp_TS = x.TS || 0; c.otp_DW = x.DW || 0
      c.punch_TS = x.TS_walk || 0; c.punch_DW = x.DW_walk || 0
    }

    const otpTotals = {
      TS: otp.totals?.TS?.otps || 0, DW: otp.totals?.DW?.otps || 0,
    }
    const punch = {
      TS: otp.totals?.TS?.walked_in || 0, DW: otp.totals?.DW?.walked_in || 0,
      no_otp: otp.no_otp?.walked_in || 0,
    }
    otpTotals.total = otpTotals.TS + otpTotals.DW
    punch.total = punch.TS + punch.DW + punch.no_otp

    // ── Jarvis footfall (camera branches), only for allowed accounts ──
    let jarvis = { available: false }
    if (jarvisOk) {
      let footfall = [], tableMissing = false
      try {
        footfall = await selectAllRows(() => supabase.from('jarvis_footfall')
          .select('*').gte('footfall_date', from).lte('footfall_date', to)
          .order('footfall_date').order('store_code'))
      } catch (err) {
        if (isMissingTable(err)) tableMissing = true
        else throw err
      }
      const newRows = await newCrmWalkins(from, to).catch(() => null)
      let rows = mergeFootfallRows({ branches: branchMeta || [], footfall, newRows, from, to, allowedRegions })

      // Apply the dashboard's location filter to the camera rows.
      if (filter) {
        const resolve = buildBranchResolver(branchMeta || [])
        const metaByDisplay = new Map()
        for (const b of (branchMeta || [])) metaByDisplay.set(resolve(b.name).name, b)
        rows = rows.filter(r => {
          if (filter.type === 'region') return r.region === filter.value
          if (filter.type === 'branch') return r.branch === filter.value
          return metaByDisplay.get(r.branch)?.[filter.type] === filter.value
        })
      }

      let group = 0, unique = 0
      const cameraBranches = new Set()
      for (const r of rows) {
        if (r.footfall == null) continue
        unique += Number(r.footfall) || 0
        group += Number(r.group) || 0
        cameraBranches.add(r.branch)
        const c = dayCell(r.date)
        c.jarvis_footfall += Number(r.footfall) || 0
        c.jarvis_group += Number(r.group) || 0
      }
      jarvis = { available: true, tableMissing, group, footfall: unique, cameraBranches: cameraBranches.size }
    }

    const data = {
      from, to, filter,
      jarvis,
      otp: otpTotals,
      punch,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    }
    cache.set(key, { data, ts: Date.now() })
    if (cache.size > 60) cache.delete(cache.keys().next().value)
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: `Walk-in funnel unavailable: ${e.message}` }, { status: 502 })
  }
}
