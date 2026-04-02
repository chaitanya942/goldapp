// app/api/generate-consignee-report/route.js

import { createClient } from '@supabase/supabase-js'
import { generateConsigneeReport } from '../../../lib/generateConsigneeReport'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')

  if (!consignmentId) {
    return Response.json({ error: 'Consignment ID required' }, { status: 400 })
  }

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
      .select('id, purchase_date, customer_name, branch_name, gross_weight, stone_weight, wastage, net_weight, total_amount')
      .in('id', purchaseIds)
      .order('purchase_date', { ascending: true })

    if (ie) return Response.json({ error: 'Failed to fetch purchase items' }, { status: 500 })

    // Generate JPEG image
    const jpegBuffer = await generateConsigneeReport({
      consignment,
      items: items || [],
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
