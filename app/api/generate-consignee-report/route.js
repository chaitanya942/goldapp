// app/api/generate-consignee-report/route.js

import { createClient } from '@supabase/supabase-js'
import { generateConsigneeReport } from '../../../lib/generateConsigneeReport'
import { checkApproval } from '../../../lib/approvalGate'
import { requireAuth } from '../../../lib/apiAuth'
import { loadConsignmentForGeneration } from '../../../lib/consignmentSnapshot'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')

  if (!consignmentId) {
    return Response.json({ error: 'Consignment ID required' }, { status: 400 })
  }

  // Pre-approval document. Operations sends this to the branch so they can
  // physically pack the consignment before accounts has reviewed it.
  const gate = await checkApproval(supabase, consignmentId, req, auth, 'consignee_report')
  if (gate.blocked) return gate.response

  try {
    const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
    const { consignment, items: snappedItems, companySettings } = loaded

    if (!snappedItems.length) return Response.json({ error: 'No items in consignment' }, { status: 400 })

    // Snapshot fields don't carry stone_weight / wastage — read from live purchases for display only.
    const purchaseIds = snappedItems.map(i => i.id)
    const { data: liveExtras } = await supabase
      .from('purchases')
      .select('id, branch_name, current_branch, stone_weight, wastage')
      .in('id', purchaseIds)
    const extrasById = new Map((liveExtras || []).map(p => [p.id, p]))

    const items = snappedItems.map(s => ({
      ...s,
      branch_name:    extrasById.get(s.id)?.branch_name || null,
      current_branch: extrasById.get(s.id)?.current_branch || null,
      stone_weight:   extrasById.get(s.id)?.stone_weight || 0,
      wastage:        extrasById.get(s.id)?.wastage || 0,
    })).sort((a, b) => String(a.purchase_date || '').localeCompare(String(b.purchase_date || '')))

    // For Hub→HO consolidations: look up the prior INTERNAL consignment (Branch→Hub)
    // for each bill, so the report can show "via WG000010 from KL-EDAPPALLY".
    const { data: priorLinks } = await supabase
      .from('consignment_items')
      .select('purchase_id, consignment:consignment_id(tmp_prf_no, movement_type, status, branch_name, dest_branch, created_at)')
      .in('purchase_id', purchaseIds)
    const transferHistory = {}
    for (const link of priorLinks || []) {
      const cn = link.consignment
      if (!cn || cn.movement_type !== 'INTERNAL' || cn.status !== 'received') continue
      const existing = transferHistory[link.purchase_id]
      if (!existing || new Date(cn.created_at) > new Date(existing.created_at)) {
        transferHistory[link.purchase_id] = {
          tmp_prf_no:    cn.tmp_prf_no,
          source_branch: cn.branch_name,
          dest_branch:   cn.dest_branch,
          created_at:    cn.created_at,
        }
      }
    }

    // Generate JPEG image
    const jpegBuffer = await generateConsigneeReport({
      consignment,
      items: items || [],
      companySettings: companySettings || {},
      transferHistory,
    })

    const filename = `GoldConsigneeReport-${consignment.tmp_prf_no}.jpg`

    return new Response(jpegBuffer, {
      headers: {
        'Content-Type':        'image/jpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Consignee report error:', error)
    return Response.json({ error: error.message || 'Failed to generate report' }, { status: 500 })
  }
}
