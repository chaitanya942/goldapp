// GET /api/fifty-lakh?from=YYYY-MM-DD&to=YYYY-MM-DD
// 50L+ Transactions (Finance & Accounts): customers whose cumulative final
// amount this financial year exceeds ₹50L, and their bills in [from, to] in the
// Billed vs Paid case-wise format. See lib/fiftyLakh.js.

import { requireAuthForPage } from '../../../lib/apiAuth'
import { buildFiftyLakhReport } from '../../../lib/fiftyLakh'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'fifty-lakh')
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const to   = searchParams.get('to')   || istToday()
  const from = searchParams.get('from') || '2026-06-15'
  if (from > to) return Response.json({ error: '"From" must be on or before "To".' }, { status: 400 })
  try {
    return Response.json(await buildFiftyLakhReport({ from, to }))
  } catch (e) {
    return Response.json({ error: e.message || 'Failed to build the report' }, { status: 500 })
  }
}
