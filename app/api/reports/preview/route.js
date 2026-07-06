// GET /api/reports/preview?report=purchase_report&date=YYYY-MM-DD
// Builds a report and returns its subject/HTML/Excel (base64) for on-screen
// preview + download, WITHOUT sending any email. IST dates.
import { requireAuth } from '../../../../lib/apiAuth'
import { getReport, listReports } from '../../../../lib/reports'

const REPORT_ROLES = ['super_admin', 'founders_office', 'admin', 'accounts']
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: REPORT_ROLES })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('report') || 'purchase_report'
  const date = searchParams.get('date') || istToday()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })

  const report = getReport(key)
  if (!report) return Response.json({ error: `unknown report '${key}'`, reports: listReports() }, { status: 400 })

  try {
    const built = await report.build(date)
    return Response.json({ report: key, date, ...built })
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 })
  }
}
