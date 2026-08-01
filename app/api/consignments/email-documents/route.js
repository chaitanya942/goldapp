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
import { logConsignmentEvent } from '../../../../lib/consignmentLog'
import { isCompanyEmail, COMPANY_MAIL_DOMAIN } from '../../../../lib/companyMail'
import { checkRecipientDomain } from '../../../../lib/emailDomain'

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
  'eway_bill_no, einvoice_doc_no, irn, total_bills, total_net_wt, total_gross_wt, status, approval_status, ' +
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
    .from('branches').select('name, branch_code, contact_email, region').eq('name', c.branch_name).maybeSingle()
  return { c, branch: branch || { name: c.branch_name } }
}

// Cc is now operator-driven only — no standing/always-Cc. Ops adds recipients
// manually when needed. We just de-duplicate what they typed and never Cc the
// same address that's already in To.
function buildCc(extraCc, to) {
  const set = new Set()
  for (const e of String(extraCc || '').split(',').map(s => s.trim()).filter(Boolean)) set.add(e)
  const toLc = (to || '').trim().toLowerCase()
  return [...set].filter(e => e.toLowerCase() !== toLc)
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

  // Most recent send (if any) — so the modal can say "already emailed" and let
  // ops resend. Best-effort; a log-table hiccup just hides the banner.
  let last_sent = null
  try {
    const { data: rows } = await admin
      .from('consignment_activity_log')
      .select('actor_email, details, created_at')
      .eq('consignment_id', id).eq('event_type', 'documents_emailed')
      .order('created_at', { ascending: false }).limit(1)
    const r = rows?.[0]
    if (r) last_sent = { at: r.created_at, by: r.details?.from_name || r.actor_email || null, to: r.details?.to || null }
  } catch {}

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
    last_sent,
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
  // Operator-typed Cc (may be comma-separated), validated per-address, then
  // merged with the standing Cc (ops lead always + GM-ops for Kerala).
  for (const e of String(body.cc || '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (!EMAIL_RE.test(e)) return Response.json({ error: `Cc "${e}" is not a valid email address.` }, { status: 400 })
  }
  const ccList = buildCc(body.cc, to)

  // Domain guards — SMTP accepts almost anything and only bounces a bad address
  // asynchronously, so a typo'd domain (e.g. whitegold1.money) would otherwise
  // be recorded as "sent" while never reaching the branch. Verify BEFORE we
  // send so nothing is falsely marked delivered.
  //   (B) the branch address must be on the company domain — catches domain typos.
  if (!isCompanyEmail(to)) {
    return Response.json({ error: `"${to}" is not a ${COMPANY_MAIL_DOMAIN} address — check the branch email for a typo (e.g. "${COMPANY_MAIL_DOMAIN}" vs a look-alike).`, code: 'BAD_DOMAIN' }, { status: 400 })
  }
  //   (A) the recipient + every Cc domain must actually exist / accept mail.
  const toDom = await checkRecipientDomain(to)
  if (!toDom.ok) return Response.json({ error: `Can't send — ${toDom.reason}. Fix the branch email and try again.`, code: 'BAD_DOMAIN' }, { status: 400 })
  for (const e of ccList) {
    const cd = await checkRecipientDomain(e)
    if (!cd.ok) return Response.json({ error: `Cc "${e}" — ${cd.reason}.`, code: 'BAD_DOMAIN' }, { status: 400 })
  }

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
    // All three in PARALLEL — the button only enables once every step is already
    // generated, so the workflow gate is satisfied and ordering no longer
    // matters. This is the main latency win: build time drops from the sum of
    // the three round-trips to the slowest single one.
    attachments = await Promise.all([
      fetchDoc(`/api/generate-consignee-report?id=${id}`, 'image/jpeg',
        docFilename({ consignment: c, branch, docType: 'report', ext: 'jpg' })),
      fetchDoc(
        a.isInternal ? `/api/generate-issue-voucher-pdf?id=${id}` : `/api/generate-challan-pdf?id=${id}`,
        'application/pdf',
        docFilename({ consignment: c, branch, docType: a.isInternal ? 'voucher' : 'challan', ext: 'pdf' })),
      fetchDoc(
        a.gstKind === 'ewb' ? `/api/eway-bill/pdf?id=${id}` : `/api/e-invoice/pdf?id=${id}`,
        'application/pdf',
        docFilename({ consignment: c, branch, docType: a.gstKind === 'ewb' ? 'ewb' : 'einvoice', ext: 'pdf' })),
    ])
  } catch (e) {
    return Response.json({ error: `Could not build the documents — ${e.message}` }, { status: 502 })
  }

  const dest = a.isInternal ? (c.dest_branch || 'Hub') : 'Head Office'
  const wt   = c.total_gross_wt != null ? `${Number(c.total_gross_wt).toFixed(3)} g` : '—'
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
        <tr><td style="padding:2px 14px 2px 0;color:#666">Gross weight</td><td>${wt}</td></tr>
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
    const info = await sendMail({ to, cc: ccList.length ? ccList : undefined, subject, html, attachments, fromName: senderName, replyTo: senderEmail })
    // Record the send so the modal can tell ops it was already emailed (and by
    // whom / when) — while still allowing a resend. Best-effort; never blocks.
    await logConsignmentEvent(admin, {
      consignment_id: id,
      event_type:     'documents_emailed',
      actor_email:    senderEmail || null,
      actor_role:     auth.profile?.role || null,
      details:        { to, cc: ccList, from_name: senderName, attachments: attachments.map(x => x.filename) },
    })
    // Stamp the real column too. This is what makes OTHER users' open screens
    // flip to "Mail Sent" without a refresh: the consignments-row UPDATE fires
    // the realtime subscription. Clearing the bounce marker means a resend to a
    // corrected address drops the old "Delivery Failed". Best-effort — a missing
    // column (migration not yet applied) must never fail the send.
    try {
      await admin.from('consignments')
        .update({ documents_emailed_at: new Date().toISOString(), documents_email_bounced_at: null })
        .eq('id', id)
    } catch (e) { console.warn('[email-documents] column stamp failed:', e?.message) }
    return Response.json({ ok: true, sent_to: to, cc: ccList, from_name: senderName, reply_to: senderEmail || null, attachments: attachments.map(x => x.filename), messageId: info.messageId })
  } catch (e) {
    return Response.json({ error: `Send failed: ${e.message}` }, { status: 502 })
  }
}
