// app/api/generate-challan-pdf/route.js

import { createClient } from '@supabase/supabase-js'
import { generateDeliveryChallan } from '../../../lib/generateDeliveryChallan'
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

  // Sequential workflow gate: requires the consignee report to have been
  // generated first.
  const wf = await checkWorkflow(supabase, consignmentId, auth, 'delivery_challan')
  if (wf.blocked) return wf.response

  try {
    const loaded = await loadConsignmentForGeneration(supabase, consignmentId, auth)
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: loaded.error.status })
    const { consignment, branch, items, companySettings: rawSettings } = loaded

    if (!branch.address) {
      return Response.json({
        error: `Consignment ${consignment.tmp_prf_no} has no address (neither snapshot nor live branch). Update Branch Management.`,
      }, { status: 400 })
    }

    const companySettings = { ...DEFAULT_COMPANY, ...(rawSettings || {}) }
    const logoBase64 = loadLogo()

    // Hub-mode detection — if the source branch is a Bangalore hub and this
    // is an EXTERNAL movement, the challan renders a branch-wise summary
    // instead of the per-bill verification list. Hub status is read live
    // from the branches table so a one-off correction in admin works
    // without re-snapshotting.
    let hubGroups = null
    if (consignment.movement_type === 'EXTERNAL' && consignment.source_region === 'Bangalore') {
      const { data: srcBranch } = await supabase
        .from('branches')
        .select('is_hub')
        .eq('name', consignment.branch_name)
        .maybeSingle()
      if (srcBranch?.is_hub) {
        // Roll items up by the bill's source branch (purchases.branch_name —
        // each consignment_item carries this via the snapshot if present,
        // otherwise we fall back to the live purchase row). The result is
        // one row per branch with bills count, gross weight, and value.
        const billMap = new Map()
        for (const it of items || []) {
          const src = it.branch_name || consignment.branch_name
          if (!billMap.has(src)) billMap.set(src, { branch_name: src, is_hub: src === consignment.branch_name, bills: 0, gross_wt: 0, net_wt: 0, value: 0 })
          const g = billMap.get(src)
          g.bills    += 1
          g.gross_wt += Number(it.gross_weight || 0)
          g.net_wt   += Number(it.net_weight   || 0)
          g.value    += Number(it.total_amount || 0)
        }
        hubGroups = [...billMap.values()].sort((a, b) => b.gross_wt - a.gross_wt)
      }
    }

    const pdf = generateDeliveryChallan({
      consignment,
      branch,
      companySettings,
      items: items || [],
      hubGroups,
      logoBase64,
    })

    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))
    const filename  = docFilename({ consignment, branch, docType: 'challan', ext: 'pdf' })

    // Stamp the workflow step so EWB / E-Invoice preview unlocks for this consignment.
    stampWorkflowStep(supabase, consignmentId, 'delivery_challan', auth).catch(() => {})

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
