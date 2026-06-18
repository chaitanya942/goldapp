// app/api/bidding/section1-audit/route.js
//
// Bangalore Section 1 — end-of-day audit job.
//
//   POST  /api/bidding/section1-audit       → run today's audit, upsert
//                                              into bidding_audit_log,
//                                              return the summary.
//                                              Auth: ADMIN or X-Cron-Token.
//   GET   /api/bidding/section1-audit       → latest audit_log row
//   GET   /api/bidding/section1-audit?date= → audit_log row for that date
//   GET   /api/bidding/section1-audit?list=1 → last 30 daily rows
//
// Wired into goldapp-cron at 23:30 IST. Idempotent — audit_date is UNIQUE
// in bidding_audit_log so a re-run for the same day upserts cleanly.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { istToday } from '../../../../lib/dateIst'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

async function runAudit(actor) {
  const auditDate = istToday()

  // Bangalore branches (the Section 1 pool).
  const { data: branches, error: bErr } = await supabase
    .from('branches')
    .select('name, region')
    .eq('region', 'Bangalore')
    .eq('is_active', true)
  if (bErr) throw new Error(`branches select failed: ${bErr.message}`)
  const bangaloreNames = (branches || []).map(b => b.name)
  if (bangaloreNames.length === 0) {
    return { audit_date: auditDate, swept: { count: 0, net_wt: 0 }, attributed: { count: 0, net_wt: 0 }, held: { count: 0, net_wt: 0 }, details: { reason: 'no_bangalore_branches' } }
  }

  // ── Pass 1a: EOD auto-attach (overshoot allowed, debits gain) ─────────────
  // Unlike the daytime no-overshoot attacher, the EOD attacher attaches a
  // leftover bill to a booking with pipeline still owed EVEN IF it overshoots,
  // so a real purchased bill is never left in standalone-gain limbo while a
  // pipeline is owed. The overshoot debits that booking's realized gain.
  // (sql/eod-pipeline-attach-overshoot-debit.sql)
  let sweptCount    = 0
  let sweptWeight   = 0
  let gainDebited   = 0
  try {
    const { data: attachRows, error: paErr } = await supabase.rpc('process_pipeline_attachments_eod')
    if (paErr) {
      console.warn('[section1-audit] process_pipeline_attachments_eod failed:', paErr.message)
    } else if (Array.isArray(attachRows)) {
      for (const r of attachRows) {
        sweptCount  += Number(r.bills_attached  || 0)
        sweptWeight += Number(r.weight_attached || 0)
        gainDebited += Number(r.gain_debited_g  || 0)
      }
    }
  } catch (paErr) {
    console.warn('[section1-audit] EOD auto-attach threw:', paErr?.message)
  }

  // ── Pass 1b: Close stale pipelines → gain ─────────────────────────────────
  // Any pipeline STILL owed after the attach pass (no more bills to fill it)
  // converts to realized gain — "whatever is left in the pipeline at midnight
  // is gain". (close_stale_pipelines, sql/cal_quotas_pipeline_phase2.sql)
  try {
    const { error: csErr } = await supabase.rpc('close_stale_pipelines')
    if (csErr) console.warn('[section1-audit] close_stale_pipelines failed:', csErr.message)
  } catch (csErr) {
    console.warn('[section1-audit] close_stale_pipelines threw:', csErr?.message)
  }

  // ── Pass 2: Attribute stragglers to gain ──────────────────────────────────
  // Bangalore-today bills that survived the sweep — booking_id still null,
  // not held, still at_branch, not deleted, approved — get stamped with the
  // audit columns. They become explicit gain inventory.
  const { data: stragglers, error: sErr } = await supabase
    .from('purchases')
    .select('id, net_weight')
    .in('branch_name', bangaloreNames)
    .eq('purchase_date', auditDate)
    .eq('stock_status', 'at_branch')
    .eq('crm_status', 'approved')
    .eq('is_deleted', false)
    .is('booking_id', null)
    .eq('audit_hold', false)
    .is('audit_consumed_at', null)
  if (sErr) throw new Error(`stragglers query failed: ${sErr.message}`)

  let attributedCount  = 0
  let attributedWeight = 0
  if ((stragglers || []).length > 0) {
    const ids = stragglers.map(b => b.id)
    attributedCount  = stragglers.length
    attributedWeight = stragglers.reduce((s, b) => s + Number(b.net_weight || 0), 0)
    const { error: updErr } = await supabase
      .from('purchases')
      .update({ audit_consumed_at: new Date().toISOString(), audit_attributed_to: 'gain' })
      .in('id', ids)
    if (updErr) throw new Error(`attribute update failed: ${updErr.message}`)
  }

  // ── Held bills snapshot (audit_hold = true, Bangalore-today). Just for the
  // log — these bills are intentionally untouched. Visibility into how
  // much ops is parking outside the audit each day. ───────────────────────
  const { data: held } = await supabase
    .from('purchases')
    .select('id, net_weight')
    .in('branch_name', bangaloreNames)
    .eq('purchase_date', auditDate)
    .eq('audit_hold', true)
    .eq('is_deleted', false)
  const heldCount  = (held || []).length
  const heldWeight = (held || []).reduce((s, b) => s + Number(b.net_weight || 0), 0)

  // ── Log row ───────────────────────────────────────────────────────────────
  const logRow = {
    audit_date:        auditDate,
    ran_at:            new Date().toISOString(),
    swept_count:       sweptCount,
    swept_net_wt:      Number(sweptWeight.toFixed(3)),
    attributed_count:  attributedCount,
    attributed_net_wt: Number(attributedWeight.toFixed(3)),
    held_count:        heldCount,
    held_net_wt:       Number(heldWeight.toFixed(3)),
    details:           { actor: actor || 'cron', bangalore_branches: bangaloreNames.length, gain_debited_g: Number(gainDebited.toFixed(3)) },
  }
  const { data: savedLog, error: logErr } = await supabase
    .from('bidding_audit_log')
    .upsert(logRow, { onConflict: 'audit_date' })
    .select()
    .single()
  if (logErr) throw new Error(`audit log upsert failed: ${logErr.message}`)

  return savedLog
}

export async function POST(req) {
  const cronToken = req.headers.get('x-cron-token')
  let actor = 'cron'
  if (process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET) {
    // Authorized via cron token; no user attached.
  } else {
    const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
    if (!auth.ok) return auth.response
    actor = auth.profile?.email || auth.user?.email || 'admin'
  }
  try {
    const result = await runAudit(actor)
    return Response.json({ success: true, audit: result })
  } catch (e) {
    return Response.json({ error: e.message || 'audit failed' }, { status: 500 })
  }
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ANY })
  if (!auth.ok) return auth.response

  const url  = new URL(req.url)
  const list = url.searchParams.get('list')
  if (list) {
    const { data, error } = await supabase
      .from('bidding_audit_log')
      .select('*')
      .order('audit_date', { ascending: false })
      .limit(30)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ list: data || [] })
  }

  const date = url.searchParams.get('date')
  let q = supabase
    .from('bidding_audit_log')
    .select('*')
    .order('audit_date', { ascending: false })
    .limit(1)
  const { data, error } = date
    ? await q.eq('audit_date', date).maybeSingle()
    : await q.maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data)  return Response.json({ audit: null }, { status: 404 })
  return Response.json({ audit: data })
}
