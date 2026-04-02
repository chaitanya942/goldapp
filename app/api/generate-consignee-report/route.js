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
    const { data: consignment, error: ce } = await supabase
      .from('consignments').select('*').eq('id', consignmentId).single()

    if (ce || !consignment) {
      return Response.json({ error: 'Consignment not found' }, { status: 404 })
    }

    const { data: consignmentItems, error: cie } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', consignmentId)

    if (cie) return Response.json({ error: 'Failed to fetch items' }, { status: 500 })

    const purchaseIds = consignmentItems.map(i => i.purchase_id)

    const { data: items, error: ie } = await supabase
      .from('purchases')
      .select('id, purchase_date, customer_name, branch_name, gross_weight, stone_weight, wastage, net_weight, total_amount')
      .in('id', purchaseIds)
      .order('purchase_date', { ascending: true })

    if (ie) return Response.json({ error: 'Failed to fetch purchases' }, { status: 500 })

    const pdf    = generateConsigneeReport({ consignment, items: items || [] })
    const buffer = Buffer.from(pdf.output('arraybuffer'))
    const filename = `GoldConsigneeReport-${consignment.tmp_prf_no}.pdf`

    return new Response(buffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('Consignee report error:', err)
    return Response.json({ error: err.message || 'Failed to generate report' }, { status: 500 })
  }
}
