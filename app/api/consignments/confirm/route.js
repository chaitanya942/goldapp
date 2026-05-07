// app/api/consignments/confirm/route.js
//
// Operations explicitly confirms the consignment is ready for documentation.
// This:
//   - validates the bill list is non-empty and totals are sane
//   - stamps ops_confirmed_at + ops_confirmed_by
//   - unlocks the consignee-report generation step
//
// Idempotent — re-confirming refreshes the timestamp.
//
// POST /api/consignments/confirm  body: { consignment_id }

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function POST(req) {
  // Operations + admins. Accounts shouldn't be confirming consignments — they
  // review what ops produced. Viewer / telesales have no role here either.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.OPERATIONS })
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const consignmentId = body.consignment_id
  if (!consignmentId) return Response.json({ error: 'consignment_id required' }, { status: 400 })

  const { data: c, error: ce } = await supabase
    .from('consignments')
    .select('id, tmp_prf_no, status, approval_status, ops_confirmed_at')
    .eq('id', consignmentId)
    .maybeSingle()
  if (ce || !c) return Response.json({ error: 'Consignment not found' }, { status: 404 })
  if (c.status === 'cancelled') return Response.json({ error: `${c.tmp_prf_no} is cancelled.` }, { status: 400 })
  if (c.approval_status === 'rejected') return Response.json({ error: `${c.tmp_prf_no} was rejected by accounts.` }, { status: 400 })

  // Validate bills exist and totals look sane.
  const { data: items, error: ie } = await supabase
    .from('consignment_items')
    .select('id, gross_weight, total_amount')
    .eq('consignment_id', consignmentId)
  if (ie) return Response.json({ error: ie.message }, { status: 500 })

  if (!items?.length) {
    return Response.json({ error: 'Cannot confirm an empty consignment — add at least one bill first.' }, { status: 400 })
  }
  const totalGross = items.reduce((s, i) => s + Number(i.gross_weight || 0), 0)
  const totalValue = items.reduce((s, i) => s + Number(i.total_amount || 0), 0)
  if (totalGross <= 0) return Response.json({ error: 'Total gross weight is 0 — fix the bill weights before confirming.' }, { status: 400 })
  if (totalValue <= 0) return Response.json({ error: 'Total value is 0 — fix the bill amounts before confirming.' }, { status: 400 })

  const now = new Date().toISOString()
  const { error: ue } = await supabase
    .from('consignments')
    .update({
      ops_confirmed_at: now,
      ops_confirmed_by: auth.user.id,
    })
    .eq('id', consignmentId)
  if (ue) return Response.json({ error: ue.message }, { status: 500 })

  return Response.json({
    ok: true,
    consignment_id: consignmentId,
    tmp_prf_no: c.tmp_prf_no,
    confirmed_at: now,
    bills: items.length,
    total_gross_weight: parseFloat(totalGross.toFixed(3)),
    total_value: parseFloat(totalValue.toFixed(2)),
    message: c.ops_confirmed_at ? 'Confirmation refreshed.' : 'Consignment confirmed and bill list locked.',
  })
}
