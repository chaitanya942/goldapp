// app/api/generate-issue-voucher-pdf/route.js
// Generates the Issue Voucher PDF for Branch → Hub transfers.

import { createClient } from '@supabase/supabase-js'
import { generateIssueVoucher } from '../../../lib/generateIssueVoucher'
import { checkApproval } from '../../../lib/approvalGate'
import { requireAuth } from '../../../lib/apiAuth'
import fs   from 'fs'
import path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Logo cache: read once at module load instead of fs.readFileSync per request.
const _LOGO = (() => {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.png')
    if (fs.existsSync(logoPath)) return fs.readFileSync(logoPath).toString('base64')
  } catch {}
  return null
})()
function loadLogo() { return _LOGO }

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const consignmentId = searchParams.get('id')
  if (!consignmentId) return Response.json({ error: 'Consignment ID required' }, { status: 400 })

  // Pre-approval document for Branch → Hub transfers. The branch needs the
  // voucher to pack and dispatch the goods before accounts approves.
  const gate = await checkApproval(supabase, consignmentId, req, auth, 'issue_voucher')
  if (gate.blocked) return gate.response

  try {
    const { data: consignment, error: ce } = await supabase
      .from('consignments').select('*').eq('id', consignmentId).single()
    if (ce || !consignment) return Response.json({ error: 'Consignment not found' }, { status: 404 })

    if (consignment.movement_type !== 'INTERNAL') {
      return Response.json({ error: 'Issue Voucher only valid for Branch → Hub (INTERNAL) consignments. Use Delivery Challan for Direct → HO.' }, { status: 400 })
    }
    if (!consignment.dest_branch) {
      return Response.json({ error: 'Consignment is missing destination hub' }, { status: 400 })
    }

    // Source + dest branches — built from consignment snapshot first, live branch as backstop.
    const [{ data: liveSource }, { data: liveDest }] = await Promise.all([
      supabase.from('branches').select('*').eq('name', consignment.branch_name).single(),
      supabase.from('branches').select('*').eq('name', consignment.dest_branch).single(),
    ])

    const sourceBranch = {
      ...(liveSource || {}),
      name:         consignment.branch_name,
      address:      consignment.source_address  || liveSource?.address,
      city:         consignment.source_city     || liveSource?.city,
      pin_code:     consignment.source_pin      || liveSource?.pin_code,
      state:        consignment.source_state    || liveSource?.state,
      region:       consignment.source_region   || liveSource?.region,
      branch_gstin: consignment.source_gstin    || liveSource?.branch_gstin,
    }
    const destBranch = {
      ...(liveDest || {}),
      name:         consignment.dest_branch,
      address:      consignment.dest_address    || liveDest?.address,
      city:         consignment.dest_city       || liveDest?.city,
      pin_code:     consignment.dest_pin        || liveDest?.pin_code,
      state:        consignment.dest_state      || liveDest?.state,
      region:       consignment.dest_region     || liveDest?.region,
      branch_gstin: consignment.dest_gstin      || liveDest?.branch_gstin,
    }

    if (!sourceBranch.address) return Response.json({ error: `Consignment ${consignment.tmp_prf_no} has no source address (snapshot or live).` }, { status: 400 })
    if (!destBranch.address)   return Response.json({ error: `Consignment ${consignment.tmp_prf_no} has no destination address (snapshot or live).` }, { status: 400 })

    const { data: rawSettings } = await supabase.from('company_settings').select('*').single()
    const companySettings = { company_name: '', ...(rawSettings || {}) }

    // Items — snapshot-first.
    const { data: consignmentItems } = await supabase
      .from('consignment_items')
      .select('purchase_id, bill_no_snap, gross_weight_snap, net_weight_snap, total_amount_snap, customer_name_snap, purchase_date_snap, hsn_code_snap')
      .eq('consignment_id', consignmentId)

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
      const { data: live } = await supabase.from('purchases').select('*').in('id', purchaseIds)
      items = live || []
    }

    const logoBase64 = loadLogo()

    const pdf = generateIssueVoucher({
      consignment,
      sourceBranch,
      destBranch,
      companySettings,
      items: items || [],
      logoBase64,
    })

    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))
    const filename  = (consignment.challan_no || consignment.tmp_prf_no || consignmentId).replace(/\//g, '-') + '_voucher.pdf'

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('Issue Voucher PDF error:', err)
    return Response.json({ error: err.message || 'Failed to generate voucher' }, { status: 500 })
  }
}
