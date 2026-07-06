// POST /api/reports/send   { report, date, to:[], cc:[] }
// Builds a report and emails it immediately (the "Send now / test" path). Does
// NOT touch schedules. IST dates.
import { requireAuth } from '../../../../lib/apiAuth'
import { getReport } from '../../../../lib/reports'
import { sendMail, mailConfigured } from '../../../../lib/sendMail'

const REPORT_ROLES = ['super_admin', 'founders_office', 'admin', 'accounts']
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
const arr = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [])

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: REPORT_ROLES })
  if (!auth.ok) return auth.response

  if (!mailConfigured()) {
    return Response.json({ error: 'Email not configured on the server (GMAIL_USER / GMAIL_APP_PASSWORD missing).' }, { status: 503 })
  }

  let body
  try { body = await req.json() } catch { body = {} }
  const key = body.report || 'purchase_report'
  const date = body.date || istToday()
  const to = arr(body.to)
  const cc = arr(body.cc)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  if (!to.length) return Response.json({ error: 'at least one recipient (to) is required' }, { status: 400 })

  const report = getReport(key)
  if (!report) return Response.json({ error: `unknown report '${key}'` }, { status: 400 })

  try {
    const built = await report.build(date)
    const attachments = (built.attachments || []).map(a => ({
      filename: a.filename, content: a.contentBase64, encoding: 'base64', contentType: a.contentType,
    }))
    const res = await sendMail({
      to, cc,
      subject: built.subject,
      html: built.html,
      attachments,
    })
    return Response.json({ success: true, sentBy: auth.profile?.email, to, cc, isEmpty: built.isEmpty, messageId: res.messageId })
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 })
  }
}
