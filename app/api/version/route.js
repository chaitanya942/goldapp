// GET /api/version — the build stamp this server is running. Public and
// uncached; compared by AppVersionWatcher against the client's own stamp.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_APP_BUILD || null }, { headers: { 'Cache-Control': 'no-store' } })
}
