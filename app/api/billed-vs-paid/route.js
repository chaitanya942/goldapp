// app/api/billed-vs-paid/route.js
//
// Billed vs Paid — case-wise reconciliation for the Accounts module.
//
//   GET /api/billed-vs-paid?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// For every approved purchase whose FINAL-PAYMENT day falls in [from, to] it
// answers three questions per case:
//   1. BILLED  — what the case shows as purchased (master purchases.amount).
//   2. PAID    — what actually left our bank: NEW-CRM FINAL_PAYMENT +
//                RELEASE_PAYMENT (takeover) − CREDITED reversals. If RazorpayX
//                creds are configured we also fetch the REAL payout amount/status
//                by UTR (the authoritative "money out").
//   3. ACCOUNT — did the FINAL_PAYMENT go to the penny-drop-verified account?
//
// Scope: both CRMs. OLD CRM has no clean paid-amount or payout account, so its
// rows carry billed + customer bank only (paid / account-match shown blank).
//
// RazorpayX "Paid (Bank)" data comes from the webhook-fed `razorpay_payouts`
// table — Razorpay pushes payout.* events to /api/razorpay-webhook. The app
// holds NO money-capable API key (only the webhook signing secret lives on the
// server). Until payouts are captured, the module works off the CRM-recorded
// payout.

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'
import { buildBilledVsPaidRows, addDays } from '../../../lib/billedVsPaid'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'billed-vs-paid')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const to   = searchParams.get('to')   || istToday()
  const from = searchParams.get('from') || addDays(to, -7)

  // Branch → region map (region isn't a column on purchases).
  const regionByBranch = {}
  {
    const { data: brs } = await supabase.from('branches').select('name, region')
    for (const b of brs || []) regionByBranch[b.name] = b.region
  }

  // 1) Master billed — approved purchases whose purchase_date (== final-payment
  //    day) is in range. `final_amount_crm` is what the case shows as purchased.
  //    Paginated to clear Supabase's 1000-row cap.
  const master = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('purchases')
      .select('application_id, customer_name, branch_name, crm_source, purchase_date, final_amount_crm, gross_weight, transaction_type, pan_number')
      .gte('purchase_date', from).lte('purchase_date', to)
      .eq('is_deleted', false).eq('crm_status', 'approved')
      .order('purchase_date', { ascending: false })
      .range(offset, offset + 999)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    master.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  // 2) + 3) New-CRM payment enrichment, RazorpayX payouts and per-case rows —
  //    shared with the 50L+ Transactions report (lib/billedVsPaid).
  const { rows, razorpay_linked, warnings } = await buildBilledVsPaidRows(master, { from, to, regionByBranch })

  rows.sort((a, b) => (b.purchase_date || '').localeCompare(a.purchase_date || ''))

  // Mismatch threshold: ignore sub-₹1 rounding (payout amounts are float).
  const AMT_EPS = 1
  const summary = {
    cases:            rows.length,
    total_billed:     rows.reduce((s, r) => s + r.billed, 0),
    total_paid_crm:   rows.reduce((s, r) => s + (r.paid_crm || 0), 0),
    total_paid_bank:  rows.reduce((s, r) => s + (r.paid_bank || 0), 0),
    amount_mismatch:  rows.filter(r => r.paid != null && Math.abs(r.diff) > AMT_EPS).length,
    unpaid:           rows.filter(r => r.paid == null || r.paid === 0).length,
    account_mismatch: rows.filter(r => r.acct_match === false).length,
    payout_mismatch:  rows.filter(r => r.payout_sum_match === false || r.payout_acct_match === false).length,
  }

  return Response.json({
    from, to, rows, summary,
    razorpay_linked,
    warnings,
  })
}
