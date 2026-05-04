// app/api/generate-challan-pdf/route.js

import { createClient } from '@supabase/supabase-js'
import { generateDeliveryChallan } from '../../../lib/generateDeliveryChallan'
import { checkApproval } from '../../../lib/approvalGate'
import { requireAuth } from '../../../lib/apiAuth'
import fs   from 'fs'
import path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// ── Structural defaults only — no hardcoded GSTINs, PANs, or addresses ───────
// All company data must be configured via Admin > Company Settings
const DEFAULT_COMPANY = {
  company_name:          '',
  gstin:                 '',
  gstin_ka:              '',
  gstin_ap:              '',
  gstin_kl:              '',
  gstin_ts:              '',
  gstin_tn:              '',
  pan:                   '',
  hsn_code:              '711319',
  transporter_name:      'BVC LOGISTICS PVT. LTD.',
  transportation_mode:   'BY AIR & ROAD',
  head_office_building:  '',
  head_office_address:   '',
  head_office_city:      '',
  head_office_state:     '',
  head_office_pin:       '',
  igst_rate:             3,
  value_uplift_pct:      7.5,
}

// Logo loaded once at module load, not per request — fs.readFileSync on every
// PDF call adds ~5ms latency for an asset that never changes.
const _LOGO_BASE64 = (() => {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.png')
    if (fs.existsSync(logoPath)) return fs.readFileSync(logoPath).toString('base64')
  } catch {
    // Logo not critical — PDF generation continues without it
  }
  return null
})()
function loadLogo() { return _LOGO_BASE64 }

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')

  if (!consignmentId) {
    return Response.json({ error: 'Consignment ID required' }, { status: 400 })
  }

  // Pre-approval document. The branch needs the challan to physically pack
  // and dispatch the consignment before accounts has approved.
  const gate = await checkApproval(supabase, consignmentId, req, auth, 'delivery_challan')
  if (gate.blocked) return gate.response

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

    // ── Build branch from snapshot — frozen at consignment creation. ─────────
    // Live branch is fetched only as a backstop for legacy rows that don't
    // have a snapshot yet. If a live row's address has been corrected since,
    // the consignment's challan still shows what was approved at creation.
    const { data: liveBranch } = await supabase
      .from('branches').select('*').eq('name', consignment.branch_name).single()

    const branch = {
      ...(liveBranch || {}),
      name:         consignment.branch_name,
      address:      consignment.source_address  || liveBranch?.address,
      city:         consignment.source_city     || liveBranch?.city,
      pin_code:     consignment.source_pin      || liveBranch?.pin_code,
      state:        consignment.source_state    || liveBranch?.state,
      region:       consignment.source_region   || liveBranch?.region,
      branch_gstin: consignment.source_gstin    || liveBranch?.branch_gstin,
    }

    if (!branch.address) {
      return Response.json({
        error: `Consignment ${consignment.tmp_prf_no} has no address (neither snapshot nor live branch). Update Branch Management.`,
      }, { status: 400 })
    }

    // ── Fetch company settings (DB row merged with defaults) ─────────────────
    const { data: rawSettings } = await supabase.from('company_settings').select('*').single()
    const companySettings = { ...DEFAULT_COMPANY, ...(rawSettings || {}) }

    // ── Fetch consignment_items with snapshot — fall back to live purchases ──
    const { data: consignmentItems, error: cie } = await supabase
      .from('consignment_items')
      .select('purchase_id, bill_no_snap, gross_weight_snap, net_weight_snap, total_amount_snap, customer_name_snap, purchase_date_snap, hsn_code_snap')
      .eq('consignment_id', consignmentId)

    if (cie) {
      return Response.json({ error: 'Failed to fetch consignment items' }, { status: 500 })
    }

    const hasSnapshots = (consignmentItems || []).every(r => r.gross_weight_snap != null && r.total_amount_snap != null)
    let items = []
    if (hasSnapshots && consignmentItems?.length) {
      items = consignmentItems.map(r => ({
        id:            r.purchase_id,
        bill_no:       r.bill_no_snap,
        gross_weight:  Number(r.gross_weight_snap || 0),
        net_weight:    Number(r.net_weight_snap   || 0),
        total_amount:  Number(r.total_amount_snap || 0),
        customer_name: r.customer_name_snap,
        purchase_date: r.purchase_date_snap,
        hsn_code:      r.hsn_code_snap,
      }))
    } else {
      const purchaseIds = (consignmentItems || []).map(i => i.purchase_id)
      const { data: live, error: ie } = await supabase.from('purchases').select('*').in('id', purchaseIds)
      if (ie) return Response.json({ error: 'Failed to fetch purchase items' }, { status: 500 })
      items = live || []
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
