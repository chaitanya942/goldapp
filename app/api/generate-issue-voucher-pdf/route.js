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

    // Source + dest branches
    const [{ data: sourceBranch }, { data: destBranch }] = await Promise.all([
      supabase.from('branches').select('*').eq('name', consignment.branch_name).single(),
      supabase.from('branches').select('*').eq('name', consignment.dest_branch).single(),
    ])

    if (!sourceBranch) return Response.json({ error: `Source branch '${consignment.branch_name}' not found` }, { status: 404 })
    if (!destBranch)   return Response.json({ error: `Destination hub '${consignment.dest_branch}' not found` }, { status: 404 })

    const { data: rawSettings } = await supabase.from('company_settings').select('*').single()
    const companySettings = { company_name: '', ...(rawSettings || {}) }

    // Items
    const { data: consignmentItems } = await supabase
      .from('consignment_items').select('purchase_id').eq('consignment_id', consignmentId)
    const purchaseIds = (consignmentItems || []).map(i => i.purchase_id)
    const { data: items } = await supabase.from('purchases').select('*').in('id', purchaseIds)

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
