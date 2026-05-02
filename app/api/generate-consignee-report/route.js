// app/api/generate-consignee-report/route.js

import { createClient } from '@supabase/supabase-js'
import { generateConsigneeReport } from '../../../lib/generateConsigneeReport'
import { checkApproval } from '../../../lib/approvalGate'
import { requireAuth } from '../../../lib/apiAuth'

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

  const gate = await checkApproval(supabase, consignmentId, req, auth)
  if (gate.blocked) return gate.response

  try {
    // Fetch consignment
    const { data: consignment, error: ce } = await supabase
      .from('consignments')
      .select('*')
      .eq('id', consignmentId)
      .single()

    if (ce || !consignment) {
      return Response.json({ error: 'Consignment not found' }, { status: 404 })
    }

    // Fetch consignment items
    const { data: consignmentItems, error: cie } = await supabase
      .from('consignment_items')
      .select('purchase_id')
      .eq('consignment_id', consignmentId)

    if (cie) return Response.json({ error: 'Failed to fetch consignment items' }, { status: 500 })

    const purchaseIds = consignmentItems.map(item => item.purchase_id)
    if (!purchaseIds.length) return Response.json({ error: 'No items in consignment' }, { status: 400 })

    const { data: items, error: ie } = await supabase
      .from('purchases')
      .select('id, purchase_date, customer_name, branch_name, current_branch, gross_weight, stone_weight, wastage, net_weight, total_amount')
      .in('id', purchaseIds)
      .order('purchase_date', { ascending: true })

    if (ie) return Response.json({ error: 'Failed to fetch purchase items' }, { status: 500 })

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

    // Fetch company settings so tax rates are dynamic (not hardcoded)
    const { data: companySettings } = await supabase.from('company_settings').select('*').single()

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
