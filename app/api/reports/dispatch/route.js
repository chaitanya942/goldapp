// POST /api/reports/dispatch
// Fires any report schedule that is due right now (IST). Called every tick by
// the goldapp-cron worker (x-cron-token) — also runnable by an admin for a
// manual "run due now". Idempotent: at most one successful send per schedule
// per IST day; failed attempts retry at most every ~15 min.
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/apiAuth'
import { getReport } from '../../../../lib/reports'
import { sendMail, mailConfigured } from '../../../../lib/sendMail'

const REPORT_ROLES = ['super_admin', 'founders_office', 'admin', 'accounts']
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const RETRY_MS = 15 * 60 * 1000

function istParts() {
  const d = new Date(Date.now() + 5.5 * 3600000)
  return {
    date: d.toISOString().slice(0, 10),                 // YYYY-MM-DD
    weekday: d.getUTCDay(),                              // 0=Sun..6=Sat (shifted clock)
    hhmm: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  }
}
function addDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

// Is this schedule due to send at the current IST time?
function isDue(s, now) {
  if (!s.enabled) return false
  if (s.last_sent_date === now.date) return false                 // already sent today
  if (now.hhmm < (s.send_time || '09:00')) return false           // not yet time
  // Frequency / weekday gate.
  if (s.frequency === 'weekly' || s.frequency === 'custom') {
    if (!Array.isArray(s.weekdays) || !s.weekdays.includes(now.weekday)) return false
  }
  // Retry throttle: if the last attempt errored recently, wait.
  if (s.last_status === 'error' && s.last_sent_at) {
    if (Date.now() - new Date(s.last_sent_at).getTime() < RETRY_MS) return false
  }
  return true
}

async function runDispatch({ force, onlyId } = {}) {
  const now = istParts()
  const results = []
  if (!mailConfigured()) return { ran: false, reason: 'mail not configured', results }

  let q = supabase.from('report_schedules').select('*')
  if (onlyId) q = q.eq('id', onlyId)
  const { data: schedules, error } = await q
  if (error) return { ran: false, reason: error.message, results }

  for (const s of (schedules || [])) {
    if (!force && !isDue(s, now)) continue
    const reportDate = (s.report_date_basis === 'today') ? now.date : addDays(now.date, -1)
    const report = getReport(s.report_key)
    if (!report) {
      await supabase.from('report_schedules').update({ last_sent_at: new Date().toISOString(), last_status: 'error', last_error: `unknown report '${s.report_key}'` }).eq('id', s.id)
      results.push({ id: s.id, status: 'error', error: `unknown report '${s.report_key}'` })
      continue
    }
    try {
      const built = await report.build(reportDate)
      // Skip empty days (Sundays / holidays with no purchases) — don't email a
      // blank report to Finance. Mark it handled for today so we don't rebuild
      // every tick.
      if (built.isEmpty) {
        await supabase.from('report_schedules').update({
          last_sent_date: now.date, last_sent_at: new Date().toISOString(),
          last_status: 'skipped_empty', last_error: null,
        }).eq('id', s.id)
        results.push({ id: s.id, status: 'skipped_empty', reportDate })
        continue
      }
      const sendRes = await sendMail({
        to: s.recipients, cc: s.cc || [],
        subject: built.subject, html: built.html,
        attachments: built.xlsxBase64 ? [{
          filename: built.filename, content: built.xlsxBase64, encoding: 'base64',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }] : [],
      })
      await supabase.from('report_schedules').update({
        last_sent_date: now.date, last_sent_at: new Date().toISOString(),
        last_status: built.isEmpty ? 'sent_empty' : 'sent', last_error: null,
      }).eq('id', s.id)
      results.push({ id: s.id, status: 'sent', reportDate, to: s.recipients, messageId: sendRes.messageId, isEmpty: built.isEmpty })
    } catch (e) {
      const msg = e.message || String(e)
      await supabase.from('report_schedules').update({
        last_sent_at: new Date().toISOString(), last_status: 'error', last_error: msg,
      }).eq('id', s.id)
      results.push({ id: s.id, status: 'error', error: msg })
    }
  }
  return { ran: true, now, results }
}

export async function POST(req) {
  // Auth: cron token OR an admin user.
  const cronToken = req.headers.get('x-cron-token')
  const isCron = process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET
  if (!isCron) {
    const auth = await requireAuth(req, { requiredRoles: REPORT_ROLES })
    if (!auth.ok) return auth.response
  }
  let body = {}; if (!isCron) { try { body = await req.json() } catch { body = {} } }
  const out = await runDispatch({ force: !!body.force, onlyId: body.id || null })
  return Response.json({ success: true, ...out })
}
