// scripts/razorpay-backfill.mjs
//
// ONE-TIME historical backfill of RazorpayX payouts into `razorpay_payouts`.
// Run this ONCE, LOCALLY, with a READ-ONLY Razorpay key, then forget the key.
// The key is passed inline at run time and is NEVER written to Railway or git.
//
// Usage (PowerShell):
//   $env:RAZORPAY_KEY_ID="rzp_live_xxx"; $env:RAZORPAY_KEY_SECRET="xxx"; `
//   $env:RAZORPAYX_ACCOUNT_NUMBER="409200xxxx"; `
//   node scripts/razorpay-backfill.mjs 2024-01-01 2025-12-31
//   # then close the terminal (env vars vanish)
//
// Usage (bash):
//   RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx \
//   RAZORPAYX_ACCOUNT_NUMBER=409200xxxx \
//   node scripts/razorpay-backfill.mjs 2024-01-01 2025-12-31
//
// Supabase creds are read from .env.local (not money-capable).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
  .split('\n').filter(l => l.trim() && !l.startsWith('#'))
  .reduce((a, l) => { const i = l.indexOf('='); if (i > -1) a[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, ''); return a }, {})

const KEY    = process.env.RAZORPAY_KEY_ID
const SECRET = process.env.RAZORPAY_KEY_SECRET
const ACCT   = process.env.RAZORPAYX_ACCOUNT_NUMBER
if (!KEY || !SECRET || !ACCT) {
  console.error('Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAYX_ACCOUNT_NUMBER inline (read-only key). Aborting.')
  process.exit(1)
}
const [from = '2024-01-01', to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2)
const fromEpoch = Math.floor(new Date(`${from}T00:00:00+05:30`).getTime() / 1000)
const toEpoch   = Math.floor(new Date(`${to}T23:59:59+05:30`).getTime() / 1000)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const auth = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64')

console.log(`Backfilling payouts ${from} → ${to} …`)
let skip = 0, total = 0
for (let page = 0; page < 500; page++) {
  const url = `https://api.razorpay.com/v1/payouts?account_number=${encodeURIComponent(ACCT)}&count=100&skip=${skip}&from=${fromEpoch}&to=${toEpoch}&expand[]=fund_account.bank_account`
  const res = await fetch(url, { headers: { Authorization: auth } })
  if (!res.ok) { console.error(`Razorpay ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1) }
  const items = (await res.json()).items || []
  if (!items.length) break
  const rows = items.map(p => ({
    payout_id: p.id, utr: p.utr || null,
    amount: p.amount != null ? Number(p.amount) / 100 : null,
    status: p.status || null, reference_id: p.reference_id || null,
    benef_account: p.fund_account?.bank_account?.account_number || null,
    benef_ifsc: p.fund_account?.bank_account?.ifsc || null,
    fund_account_id: p.fund_account_id || null, notes: p.notes || null,
    payout_created_at: p.created_at ? new Date(p.created_at * 1000).toISOString() : null,
    event: 'backfill', received_at: new Date().toISOString(), raw: p,
  }))
  const { error } = await supabase.from('razorpay_payouts').upsert(rows, { onConflict: 'payout_id' })
  if (error) { console.error('Supabase upsert error:', error.message); process.exit(1) }
  total += rows.length; skip += 100
  console.log(`  … ${total} payouts`)
  if (items.length < 100) break
}
console.log(`Done. ${total} payouts upserted into razorpay_payouts.`)
