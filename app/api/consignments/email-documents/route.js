// app/api/consignments/email-documents/route.js
//
// Emails a consignment's three documents — Consignee Report, Issue Voucher /
// Delivery Challan, and E-Way Bill / E-Invoice — to the destination branch's
// mailbox, so ops no longer has to download each PDF and hand-forward it into a
// branch WhatsApp group.
//
//   GET  ?id=<consignment>   → prefill info: branch email, readiness, the exact
//                              filenames that will attach. Drives the modal.
//   POST { id, to?, cc? }    → regenerates the 3 docs and sends them. `to`
//                              overrides the branch email (used when the branch
//                              has none on file, or ops wants a different id).
//
// The docs are produced by fetching this app's OWN generation routes with the
// caller's Authorization forwarded — so all the existing workflow/approval gates
// and generators are reused verbatim rather than duplicated here.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/apiAuth'
import { sendMail, mailConfigured } from '../../../../lib/sendMail'
import { docFilename } from '../../../../lib/docFilename'

export const runtime = 'nodejs'
export const maxDuration = 60

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CONS_COLS =
  'id, tmp_prf_no, challan_no, branch_name, dest_branch, movement_type, created_at, ' +
  'eway_bill_no, einvoice_doc_no, irn, total_bills, total_net_wt, status, approval_status, ' +
  'consignee_report_generated_at, issue_voucher_generated_at, delivery_challan_generated_at'

// Work out which documents this consignment has, and whether all three are
// actually producible right now (the E-Invoice PDF additionally needs accounts
// approval; the EWB PDF is available the moment it's generated).
function assess(c) {
  const isInternal = c.movement_type === 'INTERNAL'
  const reportDone = !!c.consignee_report_generated_at
  const docDone    = !!(c.issue_voucher_generated_at || c.delivery_challan_generated_at)
  const gstKind    = c.eway_bill_no ? 'ewb' : c.irn ? 'einvoice' : null
  const gstReady   = gstKind === 'ewb' ? true
                   : gstKind === 'einvoice' ? c.approval_status === 'approved'
                   : false
  const missing = []
  if (!reportDone) missing.push('Consignee Report')
  if (!docDone)    missing.push(isInternal ? 'Issue Voucher' : 'Delivery Challan')
  if (!gstKind)    missing.push('E-Way Bill / E-Invoice')
  else if (!gstReady && gstKind === 'einvoice') missing.push('E-Invoice (awaiting accounts approval)')
  return {
    isInternal, gstKind,
    ready: reportDone && docDone && gstReady,
    missing,
    docLabel: isInternal ? 'Issue Voucher' : 'Delivery Challan',
    gstLabel: gstKind === 'einvoice' ? 'E-Invoice' : 'E-Way Bill',
  }
}

async function loadContext(id) {
  const { data: c, error } = await admin.from('consignments').select(CONS_COLS).eq('id', id).maybeSingle()
  if (error || !c) return { error: 'Consignment not found', status: 404 }
  const { data: branch } = await admin
    .from('branches').select('name, branch_code, contact_email').eq('name', c.branch_name).maybeSingle()
  return { c, branch: branch || { name: c.branch_name } }
}

function plannedAttachments(c, branch, a) {
  const list = [
    { docType: 'report', ext: 'jpg' },
    { docType: a.isInternal ? 'voucher' : 'challan', ext: 'pdf' },
  ]
  if (a.gstKind) list.push({ docType: a.gstKind === 'ewb' ? 'ewb' : 'einvoice', ext: 'pdf' })
  return list.map(d => docFilename({ consignment: c, branch, docType: d.docType, ext: d.ext }))
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const ctx = await loadContext(id)
  if (ctx.error) return Response.json({ error: ctx.error }, { status: ctx.status })
  const { c, branch } = ctx
  const a = assess(c)
  return Response.json({
    branch_name:   c.branch_name,
    branch_email:  branch.contact_email || null,
    ready:         a.ready,
    missing:       a.missing,
    doc_label:     a.docLabel,
    gst_label:     a.gstLabel,
    attachments:   plannedAttachments(c, branch, a),
    tmp_prf_no:    c.tmp_prf_no,
    dest:          a.isInternal ? (c.dest_branch || 'Hub') : 'Head Office',
  })
}

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response
  if (!mailConfigured()) {
    return Response.json({ error: 'Email is not configured on the server (GMAIL_USER / GMAIL_APP_PASSWORD).' }, { status: 503 })
  }

  let body = {}
  try { body = await req.json() } catch {}
  const { id } = body
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const ctx = await loadContext(id)
  if (ctx.error) return Response.json({ error: ctx.error }, { status: ctx.status })
  const { c, branch } = ctx

  if (c.status === 'cancelled') return Response.json({ error: `${c.tmp_prf_no} is cancelled.` }, { status: 400 })
  const a = assess(c)
  if (!a.ready) {
    return Response.json({ error: `Not all documents are ready to send — missing: ${a.missing.join(', ')}.` }, { status: 409 })
  }

  // Recipient: explicit override, else the branch's mailbox.
  const to = (body.to || branch.contact_email || '').trim()
  if (!to) return Response.json({ error: 'No recipient — this branch has no email on file. Enter one to send.', code: 'NO_RECIPIENT' }, { status: 400 })
  if (!EMAIL_RE.test(to)) return Response.json({ error: `"${to}" is not a valid email address.` }, { status: 400 })
  const cc = (body.cc || '').trim()
  if (cc && !EMAIL_RE.test(cc)) return Response.json({ error: `Cc "${cc}" is not a valid email address.` }, { status: 400 })

  // Regenerate the three docs via the existing routes (auth forwarded).
  // Prefer the canonical public URL (Railway's proxy can make req.url's origin
  // an internal address); fall back to the request origin in dev.
  const origin  = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/+$/, '')
  const authHdr = req.headers.get('authorization') || ''
  const fetchDoc = async (path, contentType, filename) => {
    const res = await fetch(`${origin}${path}`, { headers: { authorization: authHdr } })
    if (!res.ok) {
      let msg = `${res.status}`
      try { msg = (await res.json())?.error || msg } catch {}
      throw new Error(`${filename}: ${msg}`)
    }
    return { filename, content: Buffer.from(await res.arrayBuffer()), contentType }
  }

  let attachments
  try {
    // Order matters — report first (unlocks the rest through the shared gate).
    const report = await fetchDoc(`/api/generate-consignee-report?id=${id}`, 'image/jpeg',
      docFilename({ consignment: c, branch, docType: 'report', ext: 'jpg' }))
    const doc = await fetchDoc(
      a.isInternal ? `/api/generate-issue-voucher-pdf?id=${id}` : `/api/generate-challan-pdf?id=${id}`,
      'application/pdf',
      docFilename({ consignment: c, branch, docType: a.isInternal ? 'voucher' : 'challan', ext: 'pdf' }))
    const gst = await fetchDoc(
      a.gstKind === 'ewb' ? `/api/eway-bill/pdf?id=${id}` : `/api/e-invoice/pdf?id=${id}`,
      'application/pdf',
      docFilename({ consignment: c, branch, docType: a.gstKind === 'ewb' ? 'ewb' : 'einvoice', ext: 'pdf' }))
    attachments = [report, doc, gst]
  } catch (e) {
    return Response.json({ error: `Could not build the documents — ${e.message}` }, { status: 502 })
  }

  const dest = a.isInternal ? (c.dest_branch || 'Hub') : 'Head Office'
  const wt   = c.total_net_wt != null ? `${Number(c.total_net_wt).toFixed(3)} g` : '—'
  // Dispatch (consignment) date in IST, e.g. "25 Jul 2026".
  const dateStr = c.created_at
    ? new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    : ''
  // Sender identity — the ops person who clicked Send. The From address stays
  // GMAIL_USER (Gmail limitation); their name shows and replies route to them.
  const senderName  = (auth.profile?.full_name || '').trim() || (auth.profile?.email || '').split('@')[0] || 'White Gold'
  const senderEmail = (auth.profile?.email || '').trim() || undefined

  const subject = `White Gold · ${c.branch_name} → ${dest} · ${c.tmp_prf_no} documents`
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.55">
      <p>Hello ${c.branch_name} team,</p>
      <p>Please find attached the documents for today's consignment dated: <b>${dateStr || '—'}</b></p>
      <table style="border-collapse:collapse;font-size:13px;margin:8px 0">
        <tr><td style="padding:2px 14px 2px 0;color:#666">Reference</td><td><b>${c.tmp_prf_no}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Route</td><td>${c.branch_name} → ${dest}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Bills</td><td>${c.total_bills ?? '—'}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Net weight</td><td>${wt}</td></tr>
      </table>
      <p style="margin:8px 0">Attachments:</p>
      <ol style="margin:4px 0 12px 18px;padding:0">
        <li>Consignee Report</li>
        <li>${a.docLabel}</li>
        <li>${a.gstLabel}</li>
      </ol>
      <p style="color:#888;font-size:12px">Sent by ${senderName} · White Gold consignment system.</p>
    </div>`

  try {
    const info = await sendMail({ to, cc: cc || undefined, subject, html, attachments, fromName: senderName, replyTo: senderEmail })
    return Response.json({ ok: true, sent_to: to, cc: cc || null, from_name: senderName, reply_to: senderEmail || null, attachments: attachments.map(x => x.filename), messageId: info.messageId })
  } catch (e) {
    return Response.json({ error: `Send failed: ${e.message}` }, { status: 502 })
  }
}
