// app/api/consignments/scan-bounces/route.js
// Reads the sending mailbox (GMAIL_USER) over IMAP and looks for bounce-backs
// ("Mail Delivery Subsystem" / Address not found) for consignment document
// emails. SMTP accepts a message even for a non-existent mailbox and only
// bounces asynchronously, so this is how we learn a "Mail Sent" actually
// FAILED — we then log a `documents_email_bounced` event and the UI flips the
// row to "Delivery Failed" + notifies ops.
//
// Cron-gated (CRON_SECRET). Driven by the goldapp-cron worker every few minutes.
// Requires IMAP enabled on the Gmail account (Settings → Forwarding and
// POP/IMAP → Enable IMAP) and the same app password used for sending.

import { createClient } from '@supabase/supabase-js'
import { ImapFlow } from 'imapflow'
import { logConsignmentEvent } from '../../../../lib/consignmentLog'

export const runtime = 'nodejs'
export const maxDuration = 60

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

function cronOk(req) {
  const tok = req.headers.get('x-cron-token') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  return !!process.env.CRON_SECRET && tok === process.env.CRON_SECRET
}

// Find the consignment a bounce belongs to: match the failed recipient against
// documents_emailed events, and (if the bounce carried the WG number) prefer the
// consignment whose tmp_prf_no matches. tmp_prf_no repeats across branches, so
// the recipient address is the real disambiguator.
async function correlate(rcpt, wg) {
  const { data: evs } = await admin.from('consignment_activity_log')
    .select('consignment_id, created_at')
    .eq('event_type', 'documents_emailed')
    .filter('details->>to', 'eq', rcpt)
    .order('created_at', { ascending: false })
    .limit(50)
  if (!evs?.length) return null
  if (wg) {
    const ids = [...new Set(evs.map(e => e.consignment_id))]
    const { data: cons } = await admin.from('consignments').select('id, tmp_prf_no').in('id', ids)
    const m = (cons || []).find(c => c.tmp_prf_no === wg)
    if (m) return m.id
  }
  return evs[0].consignment_id
}

// Idempotent: only log a bounce if we haven't already flagged one for this
// recipient AT/AFTER the latest send (so re-scans don't duplicate, and a fresh
// resend that bounces again is still caught).
async function alreadyFlagged(consignmentId, rcpt) {
  const [{ data: sends }, { data: bnc }] = await Promise.all([
    admin.from('consignment_activity_log').select('created_at').eq('consignment_id', consignmentId).eq('event_type', 'documents_emailed').filter('details->>to', 'eq', rcpt).order('created_at', { ascending: false }).limit(1),
    admin.from('consignment_activity_log').select('created_at').eq('consignment_id', consignmentId).eq('event_type', 'documents_email_bounced').filter('details->>to', 'eq', rcpt).order('created_at', { ascending: false }).limit(1),
  ])
  if (!bnc?.length) return false
  if (!sends?.length) return true
  return new Date(bnc[0].created_at).getTime() >= new Date(sends[0].created_at).getTime()
}

async function handle(req) {
  if (!cronOk(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const user = process.env.GMAIL_USER
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '')
  if (!user || !pass) return Response.json({ error: 'mail not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' }, { status: 503 })

  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false })
  let scanned = 0, bounces = 0, flagged = 0
  const details = []
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - 3 * 24 * 3600 * 1000)   // last 3 days
      let uids = await client.search({ since, from: 'mailer-daemon' }, { uid: true })
      if (!Array.isArray(uids)) uids = []
      uids = uids.slice(-80)   // cap work per run
      for (const uid of uids) {
        scanned++
        const msg = await client.fetchOne(uid, { source: true }, { uid: true })
        const src = msg?.source ? msg.source.toString('utf8') : ''
        if (!src) continue
        // A genuine failure DSN?
        if (!/Action:\s*failed/i.test(src) && !/Address not found|couldn'?t be found|wasn'?t delivered|not be delivered|550/i.test(src)) continue
        const rcpt = (
          src.match(/Final-Recipient:\s*rfc822;\s*<?([^\s<>]+@[^\s<>]+?)>?\s/i)?.[1] ||
          src.match(/wasn'?t delivered to\s+\**<?([^\s<>*]+@[^\s<>*]+)>?/i)?.[1] || ''
        ).trim().toLowerCase()
        if (!rcpt) continue
        bounces++
        const wg = (src.match(/White Gold[^\n]*?(WG\d{4,})/i)?.[1] || src.match(/\b(WG\d{4,})\b/)?.[1] || '').toUpperCase()
        const consignmentId = await correlate(rcpt, wg)
        if (!consignmentId) continue
        if (await alreadyFlagged(consignmentId, rcpt)) continue
        await logConsignmentEvent(admin, {
          consignment_id: consignmentId,
          event_type:     'documents_email_bounced',
          actor_email:    'system',
          details:        { to: rcpt, tmp_prf_no: wg || null, reason: 'Bounced — address could not be delivered' },
        })
        flagged++
        details.push({ consignment_id: consignmentId, to: rcpt, wg: wg || null })
      }
    } finally {
      lock.release()
    }
    await client.logout()
  } catch (e) {
    try { await client.close() } catch {}
    return Response.json({ error: 'IMAP scan failed: ' + (e?.message || e) }, { status: 502 })
  }
  return Response.json({ ok: true, scanned, bounces, flagged, details })
}

export async function GET(req)  { return handle(req) }
export async function POST(req) { return handle(req) }
