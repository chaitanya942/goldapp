// app/api/discrepancy-cases/route.js
//
// Discrepancy Cases — auditor queues a bill for ops review, ops writes
// reasoning + marks it resolved.
//
//   GET  /api/discrepancy-cases?status=pending|resolved|all
//     Returns { cases: [...] }. Each case is enriched with the underlying
//     purchase snapshot (customer, branch, weights), the sending auditor's
//     name, and the resolver's name (when resolved). Most-recent first.
//
//   POST /api/discrepancy-cases
//     Body: { purchase_ids: [uuid, ...] }
//     Creates one PENDING case per purchase. Bills that already have an
//     open case are silently skipped (the unique partial index rejects the
//     duplicate; we map that to a soft skip rather than a hard error so
//     ops can select 50 rows and the call still succeeds for the new ones).
//     Returns { created: number, skipped: number }.
//
//   PATCH /api/discrepancy-cases
//     Body: { id, reason }
//     Stamps reason, resolved_by, resolved_at, status='resolved'.

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req) {
  const auth = await requireAuthForPage(req, 'discrepancy-cases')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'

  let q = supabase
    .from('audit_discrepancy_cases')
    .select('id, purchase_id, case_type, snapshot_crm_gross_g, snapshot_audit_gross_g, snapshot_discrepancy_g, extra_app_id, extra_customer, extra_branch, extra_gross_g, auditor_note, consignment_id, sent_by, sent_at, status, reason, resolved_by, resolved_at')
    .order('sent_at', { ascending: false })
    .limit(2000)
  if (status === 'pending' || status === 'resolved') q = q.eq('status', status)

  const { data: cases, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (!cases || cases.length === 0) return Response.json({ cases: [] })

  // Enrich with purchase snapshot + auditor + resolver in batched lookups
  // so the screen has everything it needs in one round-trip. (extra_received
  // cases may have no purchase_id — they carry their own app id / branch.)
  const purchaseIds = [...new Set(cases.map(c => c.purchase_id).filter(Boolean))]
  const userIds     = [...new Set(cases.flatMap(c => [c.sent_by, c.resolved_by]).filter(Boolean))]

  const [{ data: purchases }, { data: profiles }] = await Promise.all([
    purchaseIds.length
      ? supabase.from('purchases')
          .select('id, application_id, customer_name, branch_name, gross_weight, audit_gross_weight, audit_discrepancy_g, audited_at, stock_status')
          .in('id', purchaseIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase.from('user_profiles')
          .select('id, full_name, email')
          .in('id', userIds)
      : Promise.resolve({ data: [] }),
  ])

  const purchaseById = new Map((purchases || []).map(p => [p.id, p]))
  const profileById  = new Map((profiles  || []).map(p => [p.id, { name: p.full_name || p.email || '—', email: p.email || '—' }]))

  const enriched = cases.map(c => {
    const p = c.purchase_id ? purchaseById.get(c.purchase_id) : null
    return {
      ...c,
      purchase:  p || null,
      auditor:   profileById.get(c.sent_by) || null,
      resolver:  c.resolved_by ? (profileById.get(c.resolved_by) || null) : null,
      // Unified display fields — work for weight/not_received (purchase-linked)
      // AND extra_received (may have only the auditor-entered app id / branch).
      display_app_id:      p?.application_id || c.extra_app_id || '—',
      display_customer:    p?.customer_name  || c.extra_customer || '—',
      display_branch:      p?.branch_name    || c.extra_branch || '—',
      display_crm_gross:   c.snapshot_crm_gross_g,
      display_audit_gross: c.snapshot_audit_gross_g,
    }
  })

  return Response.json({ cases: enriched })
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req) {
  const auth = await requireAuthForPage(req, 'discrepancy-cases')
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const ids  = Array.isArray(body?.purchase_ids) ? body.purchase_ids.filter(Boolean) : []
  if (ids.length === 0) {
    return Response.json({ error: 'purchase_ids required' }, { status: 400 })
  }

  // Pull current weights so the snapshot is frozen at queue time. If a
  // re-audit happens after the case is raised, the case still reflects
  // what the auditor saw.
  const { data: purchases, error: pErr } = await supabase
    .from('purchases')
    .select('id, gross_weight, audit_gross_weight, audit_discrepancy_g')
    .in('id', ids)
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 })

  const snapshotById = new Map((purchases || []).map(p => [p.id, p]))

  // Build one insert payload per requested id. Bills missing from
  // `purchases` (deleted, bad id) are skipped silently.
  const payload = []
  for (const pid of ids) {
    const snap = snapshotById.get(pid)
    if (!snap) continue
    payload.push({
      purchase_id:            pid,
      snapshot_crm_gross_g:   snap.gross_weight,
      snapshot_audit_gross_g: snap.audit_gross_weight,
      snapshot_discrepancy_g: snap.audit_discrepancy_g,
      sent_by:                auth.user?.id || null,
    })
  }
  if (payload.length === 0) {
    return Response.json({ created: 0, skipped: ids.length })
  }

  // Insert one-by-one so the unique-partial-index conflict on an
  // already-pending bill just skips that row instead of aborting the
  // whole batch. Volume here is bounded by what an auditor selects
  // in one click (typically <50), so this is fine.
  let created = 0, skipped = 0
  for (const row of payload) {
    const { error } = await supabase.from('audit_discrepancy_cases').insert(row)
    if (error) {
      // 23505 = unique_violation (already an open case for this bill)
      if (error.code === '23505') { skipped += 1; continue }
      return Response.json({ error: error.message, created, skipped }, { status: 500 })
    }
    created += 1
  }
  skipped += (ids.length - payload.length)
  return Response.json({ created, skipped })
}

// ── PATCH ───────────────────────────────────────────────────────────────────
export async function PATCH(req) {
  const auth = await requireAuthForPage(req, 'discrepancy-cases')
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const id     = body?.id
  const reason = (body?.reason || '').trim()
  if (!id)     return Response.json({ error: 'id required' },     { status: 400 })
  if (!reason) return Response.json({ error: 'reason required' }, { status: 400 })

  const { data, error } = await supabase
    .from('audit_discrepancy_cases')
    .update({
      reason,
      status:      'resolved',
      resolved_by: auth.user?.id || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')   // never re-resolve a closed case
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data)  return Response.json({ error: 'Case not found or already resolved' }, { status: 404 })
  return Response.json({ case: data })
}
