// lib/workflowGate.js
//
// Sequential-workflow gate. Used by the doc-generation routes to enforce that
// operations followed the right order: confirm → report → voucher/challan →
// preview/EWB → actual EWB.
//
// Returns { blocked: true, response } if a prior step is missing, otherwise
// { blocked: false, consignment }.
//
// Each route declares the step it's running:
//   - 'consignee_report' → requires ops_confirmed_at
//   - 'issue_voucher'    → requires consignee_report_generated_at
//   - 'delivery_challan' → requires consignee_report_generated_at
//   - 'ewb_preview'      → requires issue_voucher OR delivery_challan generated
//   - 'einvoice_preview' → requires issue_voucher OR delivery_challan generated
//
// Admin roles bypass these gates so they can recover stuck consignments.

const ADMIN_BYPASS = new Set(['super_admin', 'founders_office', 'admin'])

const HUMAN_LABEL = {
  ops_confirmed:           'Confirm Consignment',
  consignee_report:        'Generate Consignee Report',
  issue_voucher:           'Generate Issue Voucher',
  delivery_challan:        'Generate Delivery Challan',
  voucher_or_challan:      'Generate Issue Voucher or Delivery Challan',
}

export async function checkWorkflow(supabase, consignmentId, auth, step) {
  if (!consignmentId) {
    return { blocked: true, response: Response.json({ error: 'consignment id required' }, { status: 400 }) }
  }

  const { data: c, error } = await supabase
    .from('consignments')
    .select('id, tmp_prf_no, status, ops_confirmed_at, consignee_report_generated_at, issue_voucher_generated_at, delivery_challan_generated_at')
    .eq('id', consignmentId)
    .maybeSingle()

  if (error || !c) {
    return { blocked: true, response: Response.json({ error: 'Consignment not found' }, { status: 404 }) }
  }

  if (c.status === 'cancelled') {
    return { blocked: true, response: Response.json({ error: `${c.tmp_prf_no} is cancelled.` }, { status: 400 }) }
  }

  // Admin bypass — they own the system and need access for issue triage.
  if (auth?.role && ADMIN_BYPASS.has(auth.role)) {
    return { blocked: false, consignment: c }
  }

  // Determine the prior-step requirement for this step.
  const requiredField = (() => {
    switch (step) {
      case 'consignee_report':  return { field: 'ops_confirmed_at',              label: HUMAN_LABEL.ops_confirmed }
      case 'issue_voucher':     return { field: 'consignee_report_generated_at', label: HUMAN_LABEL.consignee_report }
      case 'delivery_challan':  return { field: 'consignee_report_generated_at', label: HUMAN_LABEL.consignee_report }
      // For preview / generate, accept EITHER voucher OR challan.
      case 'ewb_preview':
      case 'einvoice_preview':
      case 'ewb_generate':
      case 'einvoice_generate':
        return { eitherField: ['issue_voucher_generated_at', 'delivery_challan_generated_at'], label: HUMAN_LABEL.voucher_or_challan }
      default: return null
    }
  })()

  if (!requiredField) return { blocked: false, consignment: c }

  if (requiredField.eitherField) {
    const ok = requiredField.eitherField.some(f => !!c[f])
    if (!ok) {
      return {
        blocked: true,
        response: Response.json({
          error: `Please ${requiredField.label.toLowerCase()} first — every prior step must be done before this one.`,
          missing_step: requiredField.eitherField,
        }, { status: 409 }),
      }
    }
  } else if (!c[requiredField.field]) {
    return {
      blocked: true,
      response: Response.json({
        error: `Please ${requiredField.label.toLowerCase()} first — every prior step must be done before this one.`,
        missing_step: requiredField.field,
      }, { status: 409 }),
    }
  }

  return { blocked: false, consignment: c }
}

// Stamp a generation timestamp + actor on the consignment. Called after a
// doc successfully generates. Idempotent — overwrites previous timestamp.
export async function stampWorkflowStep(supabase, consignmentId, step, auth) {
  const fieldMap = {
    consignee_report:  { ts: 'consignee_report_generated_at', by: 'consignee_report_generated_by' },
    issue_voucher:     { ts: 'issue_voucher_generated_at',    by: 'issue_voucher_generated_by' },
    delivery_challan:  { ts: 'delivery_challan_generated_at', by: 'delivery_challan_generated_by' },
  }
  const f = fieldMap[step]
  if (!f) return  // unknown step — silent no-op so callers don't have to guard
  await supabase
    .from('consignments')
    .update({ [f.ts]: new Date().toISOString(), [f.by]: auth?.user?.id || null })
    .eq('id', consignmentId)
}
