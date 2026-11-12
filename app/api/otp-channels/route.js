// GET /api/otp-channels?from=YYYY-MM-DD&to=YYYY-MM-DD
// Telesales (TS) vs Direct Walk-in (DW) OTP generation from the CRM, with
// walk-in / purchase conversion, by region, branch and day. Region-scoped
// users only get their regions. Data starts 1 Oct 2026. See lib/otpChannels.js.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'
import { getAllowedRegionsForAuth } from '../../../lib/regionScope'
import { buildOtpChannelReport, OTP_DATA_START } from '../../../lib/otpChannels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const cache = new Map()
const CACHE_MS = 60_000

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const today = istToday()
  let from = isDate(searchParams.get('from')) ? searchParams.get('from') : today
  let to   = isDate(searchParams.get('to'))   ? searchParams.get('to')   : today
  if (from < OTP_DATA_START) from = OTP_DATA_START
  if (to > today) to = today
  if (to < from) return Response.json({ error: `No data before ${OTP_DATA_START}.` }, { status: 400 })

  const allowedRegions = await getAllowedRegionsForAuth(supabase, auth)
  const key = `${from}|${to}|${(allowedRegions || ['ALL']).slice().sort().join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return Response.json({ ...hit.data, cached: true })
  try {
    const data = await buildOtpChannelReport({ from, to, allowedRegions })
    cache.set(key, { at: Date.now(), data })
    if (cache.size > 60) cache.delete(cache.keys().next().value)
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: `CRM unavailable: ${e.message}` }, { status: 502 })
  }
}
