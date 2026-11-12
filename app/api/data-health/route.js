// /api/data-health — accuracy checks for CRM purchases & walk-ins, the
// Telesales/Direct Walk-in split and Jarvis footfall (lib/dataHealth.js).
//   POST (cron worker, x-cron-token): run checks, self-heal by re-running the
//        CRM / Jarvis sync when data is missing, store results, email alerts.
//   GET  (super_admin): run the checks now and return the results (no
//        healing, no email) — drives Admin → Data Health.

import { requireAuth } from '../../../lib/apiAuth'
import { runDataHealth } from '../../../lib/dataHealth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const cronOk = (req) => !!process.env.CRON_SECRET && req.headers.get('x-cron-token') === process.env.CRON_SECRET

// In-process calls to the existing sync handlers (same auth they expect).
const heal = (req) => ({
  crm: async () => {
    const { GET } = await import('../sync-new-crm/route')
    await GET(new Request(new URL('/api/sync-new-crm', req.url), { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))
  },
  jarvis: async () => {
    const { POST } = await import('../sync-jarvis/route')
    await POST(new Request(new URL('/api/sync-jarvis?days=3', req.url), { method: 'POST', headers: { 'x-cron-token': process.env.CRON_SECRET } }))
  },
})

export async function POST(req) {
  if (!cronOk(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await runDataHealth({ heal: heal(req), notify: true }))
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ['super_admin'] })
  if (!auth.ok) return auth.response
  return Response.json(await runDataHealth({}))
}
