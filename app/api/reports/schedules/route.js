// /api/reports/schedules — CRUD for auto-emailed report schedules.
//   GET                      → list all schedules + available reports
//   POST   { ...fields }     → create
//   PATCH  { id, ...fields } → update
//   DELETE ?id=…             → delete
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/apiAuth'
import { listReports, getReport } from '../../../../lib/reports'

const REPORT_ROLES = ['super_admin', 'founders_office', 'admin', 'accounts']
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const arr = (v) => Array.isArray(v) ? v.filter(Boolean).map(s => String(s).trim()) : (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [])
const intArr = (v) => arr(v).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)

// Whitelist + normalize an incoming schedule payload.
function clean(body) {
  const out = {}
  if (body.report_key != null)  out.report_key = String(body.report_key)
  if (body.label != null)       out.label = String(body.label).slice(0, 120)
  if (body.enabled != null)     out.enabled = !!body.enabled
  if (body.frequency != null)   out.frequency = ['daily', 'weekly', 'custom'].includes(body.frequency) ? body.frequency : 'daily'
  if (body.send_time != null)   out.send_time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(body.send_time) ? body.send_time : '09:00'
  if (body.weekdays != null)    out.weekdays = intArr(body.weekdays)
  if (body.report_date_basis != null) out.report_date_basis = ['today', 'yesterday'].includes(body.report_date_basis) ? body.report_date_basis : 'yesterday'
  if (body.recipients != null)  out.recipients = arr(body.recipients)
  if (body.cc != null)          out.cc = arr(body.cc)
  return out
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: REPORT_ROLES })
  if (!auth.ok) return auth.response
  const { data, error } = await supabase.from('report_schedules').select('*').order('created_at', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ schedules: data || [], reports: listReports() })
}

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: REPORT_ROLES })
  if (!auth.ok) return auth.response
  let body; try { body = await req.json() } catch { body = {} }
  const row = clean(body)
  if (!row.report_key) row.report_key = 'purchase_report'
  if (!getReport(row.report_key)) return Response.json({ error: `unknown report '${row.report_key}'` }, { status: 400 })
  if (!row.recipients || !row.recipients.length) return Response.json({ error: 'at least one recipient is required' }, { status: 400 })
  row.created_by = auth.profile?.email || null
  const { data, error } = await supabase.from('report_schedules').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true, schedule: data })
}

export async function PATCH(req) {
  const auth = await requireAuth(req, { requiredRoles: REPORT_ROLES })
  if (!auth.ok) return auth.response
  let body; try { body = await req.json() } catch { body = {} }
  if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 })
  const row = clean(body)
  if (row.report_key && !getReport(row.report_key)) return Response.json({ error: `unknown report '${row.report_key}'` }, { status: 400 })
  const { data, error } = await supabase.from('report_schedules').update(row).eq('id', body.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true, schedule: data })
}

export async function DELETE(req) {
  const auth = await requireAuth(req, { requiredRoles: REPORT_ROLES })
  if (!auth.ok) return auth.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabase.from('report_schedules').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
