// app/api/generate-challan-pdf/route.js

import { createClient } from '@supabase/supabase-js'
import { generateDeliveryChallan } from '../../../lib/generateDeliveryChallan'

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
    // Fetch consignment details
    const { data: consignment, error: ce } = await supabase
      .from('consignments')
      .select('*')
      .eq('id', consignmentId)
      .single()

    if (ce || !consignment) {
      return Response.json({ error: 'Consignment not found' }, { status: 404 })
    }

    // Fetch branch details with address fields
    const { data: branch, error: be } = await supabase
      .from('branches')
      .select('*, address, city, pin_code, contact_person, contact_phone, branch_gstin')
      .eq('name', consignment.branch_name)
      .single()

    if (be || !branch) {
      return Response.json({ error: `Branch '${consignment.branch_name}' not found` }, { status: 404 })
    }

    // Validate required address data
    if (!branch.address) {
      return Response.json({
        error: `Branch '${branch.name}' is missing address. Please update in Admin > Branch Management.`
      }, { status: 400 })
    }

    // Fetch company settings
    const { data: companySettings, error: cse } = await supabase
      .from('company_settings')
      .select('*')
      .single()

    if (cse || !companySettings) {
      return Response.json({ error: 'Company settings not found' }, { status: 404 })
    }

    // Fetch consignment items (purchases)
    const { data: consignmentItems, error: cie } = await supabase
      .from('consignment_items')
      .select('purchase_id')
      .eq('consignment_id', consignmentId)

    if (cie) {
      return Response.json({ error: 'Failed to fetch consignment items' }, { status: 500 })
    }

    const purchaseIds = consignmentItems.map(item => item.purchase_id)

    const { data: items, error: ie } = await supabase
      .from('purchases')
      .select('*')
      .in('id', purchaseIds)

    if (ie) {
      return Response.json({ error: 'Failed to fetch purchase items' }, { status: 500 })
    }

    // Generate PDF
    const pdf = generateDeliveryChallan({
      consignment,
      branch,
      companySettings,
      items,
    })

    // Convert PDF to buffer
    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))

    // Return PDF
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${consignment.challan_no.replace(/\//g, '-')}.pdf"`,
      },
    })
  } catch (error) {
    console.error('PDF generation error:', error)
    return Response.json({ error: error.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
