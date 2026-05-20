// app/api/generate-issue-voucher-pdf/route.js
// Generates the Issue Voucher PDF for Branch → Hub transfers.

import { createClient } from '@supabase/supabase-js'
import { generateIssueVoucher } from '../../../lib/generateIssueVoucher'
import { checkApproval } from '../../../lib/approvalGate'
import { checkWorkflow, stampWorkflowStep } from '../../../lib/workflowGate'
import { requireAuth } from '../../../lib/apiAuth'
import { loadConsignmentForGeneration } from '../../../lib/consignmentSnapshot'
import { docFilename } from '../../../lib/docFilename'
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

  // Sequential workflow gate: requires the consignee report to have been
  // generated first — the voucher uses the same data and is reviewed against it.
  const wf = await checkWorkflow(supabase, consignmentId, auth, 'issue_voucher')
  if (wf.blocked) return wf.response

  try {
    const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
    const { consignment, branch: sourceBranch, destBranch, items, companySettings: rawSettings } = loaded

    if (consignment.movement_type !== 'INTERNAL') {
      return Response.json({ error: 'Issue Voucher only valid for Branch → Hub (INTERNAL) consignments. Use Delivery Challan for Direct → HO.' }, { status: 400 })
    }
    if (!destBranch) {
      return Response.json({ error: 'Consignment is missing destination hub' }, { status: 400 })
    }
    if (!sourceBranch.address) return Response.json({ error: `Consignment ${consignment.tmp_prf_no} has no source address (snapshot or live).` }, { status: 400 })
    if (!destBranch.address)   return Response.json({ error: `Consignment ${consignment.tmp_prf_no} has no destination address (snapshot or live).` }, { status: 400 })

    const companySettings = { company_name: '', ...(rawSettings || {}) }
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
    const filename  = docFilename({ consignment, branch: sourceBranch, docType: 'voucher', ext: 'pdf' })

    // Stamp the workflow step so EWB / E-Invoice preview unlocks for this consignment.
    stampWorkflowStep(supabase, consignmentId, 'issue_voucher', auth).catch(() => {})

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
