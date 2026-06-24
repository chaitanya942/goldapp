// app/api/razorpay-webhook/route.js
//
// RazorpayX webhook receiver — the ONLY Razorpay-facing surface in the app.
// Razorpay POSTs payout.* events here, signed with the webhook secret
// (RAZORPAY_WEBHOOK_SECRET). We verify the HMAC-SHA256 signature over the RAW
// body, then upsert the payout into `razorpay_payouts`.
//
// Security: the webhook secret can ONLY verify signatures — it cannot call the
// Razorpay API or move money. So a full server/Railway compromise exposes zero
// financial capability. No money-capable API key is ever stored.
//
// Configure in the Razorpay dashboard:
//   URL    : https://<your-domain>/api/razorpay-webhook
//   Secret : RAZORPAY_WEBHOOK_SECRET (set the same value as a Railway env var)
//   Events : payout.processed, payout.reversed, payout.failed, payout.updated

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'   // need Node crypto + the raw body

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

function verify(raw, signature, secret) {
  if (!signature || !secret) return false
  const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  const a = Buffer.from(signature), b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function POST(req) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return Response.json({ error: 'webhook not configured' }, { status: 503 })

  // Read the RAW body — the signature is computed over the exact bytes.
  const raw = await req.text()
  const sig = req.headers.get('x-razorpay-signature') || ''
  if (!verify(raw, sig, secret)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 })
  }

  let body
  try { body = JSON.parse(raw) } catch { return Response.json({ error: 'bad json' }, { status: 400 }) }

  const event = body?.event || ''
  const p = body?.payload?.payout?.entity
  if (p && event.startsWith('payout.')) {
    const bank = p.fund_account?.bank_account || {}
    const { error } = await supabase.from('razorpay_payouts').upsert({
      payout_id:         p.id,
      utr:               p.utr || null,
      amount:            p.amount != null ? Number(p.amount) / 100 : null,   // paise → ₹
      status:            p.status || null,
      reference_id:      p.reference_id || null,
      benef_account:     bank.account_number || null,
      benef_ifsc:        bank.ifsc || null,
      fund_account_id:   p.fund_account_id || null,
      notes:             p.notes || null,
      payout_created_at: p.created_at ? new Date(p.created_at * 1000).toISOString() : null,
      event,
      received_at:       new Date().toISOString(),
      raw:               body,
    }, { onConflict: 'payout_id' })
    // 500 on a write failure so Razorpay retries the delivery.
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // 200 for everything we accept (incl. non-payout events) so Razorpay
  // doesn't enter a retry storm.
  return Response.json({ ok: true })
}
