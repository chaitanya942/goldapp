// GET /api/cron/<job> — entry point for Vercel Cron (schedules in vercel.json).
//
// Vercel Cron can only send a GET with `Authorization: Bearer <CRON_SECRET>`,
// but most of our scheduled endpoints take a POST gated by `x-cron-token`
// (the contract the Railway worker, scripts/cron-sync.mjs, uses). This route
// checks the Bearer secret, then calls the job's existing handler in-process
// with the header/method it expects — no job logic is duplicated here.
//
// The once-a-day jobs rely on their fixed cron times (IST noted per job) rather
// than the worker's in-memory "already ran today" flags; each target endpoint
// is already idempotent per day.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const JOBS = {
  // every 20 min: last 2 days of Jarvis footfall; once a day: full 15-day pass
  'jarvis':        { load: () => import('../../sync-jarvis/route'),            method: 'POST', path: '/api/sync-jarvis?days=2' },
  'jarvis-full':   { load: () => import('../../sync-jarvis/route'),            method: 'POST', path: '/api/sync-jarvis?days=15' },
  // every 5 min: scheduled email reports (sends only when a schedule is due)
  'reports':       { load: () => import('../../reports/dispatch/route'),       method: 'POST', path: '/api/reports/dispatch', body: '{}' },
  // 23:30 IST
  'eod-snapshot':  { load: () => import('../../eod-inventory-snapshot/route'), method: 'POST', path: '/api/eod-inventory-snapshot' },
  // 23:35 IST
  'section1-audit':{ load: () => import('../../bidding/section1-audit/route'), method: 'POST', path: '/api/bidding/section1-audit' },
  // 19:00 IST — at-risk bookings summary (logged)
  'at-risk':       { load: () => import('../../consignments/route'),           method: 'GET',  path: '/api/consignments?action=bidding_at_risk_summary' },
  // 00:05 / 00:10 IST — branch staff directory + branch auto-add
  'employees':     { load: () => import('../../sync-branch-employees/route'),  method: 'POST', path: '/api/sync-branch-employees' },
  'branches':      { load: () => import('../../sync-branches-auto/route'),     method: 'POST', path: '/api/sync-branches-auto' },
}

export async function GET(req, { params }) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { job } = await params
  const def = JOBS[job]
  if (!def) return Response.json({ error: `Unknown cron job '${job}'` }, { status: 404 })

  const started = Date.now()
  try {
    const mod = await def.load()
    const handler = mod[def.method]
    const inner = new Request(new URL(def.path, req.url), {
      method: def.method,
      headers: { 'x-cron-token': secret, 'content-type': 'application/json' },
      body: def.method === 'POST' ? (def.body ?? '{}') : undefined,
    })
    const res = await handler(inner, { params: Promise.resolve({}) })
    const text = await res.text()
    const ms = Date.now() - started
    console.log(`[cron] ${job} → ${res.status} in ${ms}ms: ${text.slice(0, 300)}`)
    return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    console.error(`[cron] ${job} threw:`, err?.message || err)
    return Response.json({ error: err?.message || 'cron job failed' }, { status: 500 })
  }
}
