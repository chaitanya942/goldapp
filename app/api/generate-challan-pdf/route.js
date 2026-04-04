// app/api/generate-challan-pdf/route.js

import { createClient } from '@supabase/supabase-js'
import { generateDeliveryChallan } from '../../../lib/generateDeliveryChallan'
import fs   from 'fs'
import path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Actual company GSTINs (used as fallback if company_settings row is missing) ─
const DEFAULT_COMPANY = {
  company_name:          'WHITE GOLD BULLION PVT.LTD',
  gstin:                 '29AAPCA3170M1Z5',   // HO (Karnataka) — consignee side
  gstin_ka:              '29AAPCA3170M1Z5',   // Karnataka branches
  gstin_ap:              '37AAPCA3170M1Z8',   // Andhra Pradesh branches
  gstin_kl:              '32AAPCA3170M1ZI',   // Kerala branches
  gstin_ts:              '36AAPCA3170M1ZA',   // Telangana branches
  gstin_tn:              '33AAPCA3170M1ZG',   // Tamil Nadu branches
  pan:                   'AAPCA3170M',
  hsn_code:              '711319',
  transporter_name:      'BVC LOGISTICS PVT. LTD.',
  transportation_mode:   'BY AIR & ROAD',
  head_office_building:  'HOUSE OF WHITE GOLD',
  head_office_address:   'NO. 1, COMMERCIAL STREET',
  head_office_city:      'BENGALURU',
  head_office_state:     'KARNATAKA',
  head_office_pin:       '560001',
  igst_rate:             3,
  value_uplift_pct:      7.5,
}

// ── Load company logo from public/logo.png ────────────────────────────────────
function loadLogo() {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.png')
    if (fs.existsSync(logoPath)) {
      return fs.readFileSync(logoPath).toString('base64')
    }
  } catch {
    // Logo not critical — PDF generation continues without it
  }
  return null
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')

  if (!consignmentId) {
    return Response.json({ error: 'Consignment ID required' }, { status: 400 })
  }

  try {
    // ── Fetch consignment ────────────────────────────────────────────────────
    const { data: consignment, error: ce } = await supabase
      .from('consignments')
      .select('*')
      .eq('id', consignmentId)
      .single()

    if (ce || !consignment) {
      return Response.json({ error: 'Consignment not found' }, { status: 404 })
    }

    // ── Fetch branch ─────────────────────────────────────────────────────────
    const { data: branch, error: be } = await supabase
      .from('branches')
      .select('*')
      .eq('name', consignment.branch_name)
      .single()

    if (be || !branch) {
      return Response.json({ error: `Branch '${consignment.branch_name}' not found` }, { status: 404 })
    }

    if (!branch.address) {
      return Response.json({
        error: `Branch '${branch.name}' is missing address. Please update in Admin > Branch Management.`,
      }, { status: 400 })
    }

    // ── Fetch company settings (DB row merged with defaults) ─────────────────
    const { data: rawSettings } = await supabase.from('company_settings').select('*').single()
    const companySettings = { ...DEFAULT_COMPANY, ...(rawSettings || {}) }

    // ── Fetch purchase items for this consignment ─────────────────────────────
    const { data: consignmentItems, error: cie } = await supabase
      .from('consignment_items')
      .select('purchase_id')
      .eq('consignment_id', consignmentId)

    if (cie) {
      return Response.json({ error: 'Failed to fetch consignment items' }, { status: 500 })
    }

    const purchaseIds = (consignmentItems || []).map(i => i.purchase_id)

    const { data: items, error: ie } = await supabase
      .from('purchases')
      .select('*')
      .in('id', purchaseIds)

    if (ie) {
      return Response.json({ error: 'Failed to fetch purchase items' }, { status: 500 })
    }

    // ── Load logo ─────────────────────────────────────────────────────────────
    const logoBase64 = loadLogo()

    // ── Generate PDF ──────────────────────────────────────────────────────────
    const pdf = generateDeliveryChallan({
      consignment,
      branch,
      companySettings,
      items: items || [],
      logoBase64,
    })

    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))
    const filename  = (consignment.challan_no || consignmentId).replace(/\//g, '-') + '.pdf'

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return Response.json({ error: err.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
