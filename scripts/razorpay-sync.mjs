// scripts/razorpay-sync.mjs
//
// Sync RazorpayX TRANSACTIONS (the actual account statement) into the
// `razorpay_payouts` table that Billed vs Paid reads. Each debit transaction
// whose source is a payout = real money that left our bank, with its UTR,
// amount and status. Supports history (from/to) AND ongoing incremental runs.
//
// SECURITY: run this as an ISOLATED job — the GoldApp web app never holds a
// Razorpay key. Use a READ-ONLY key if RazorpayX issues one (this only does
// GET /v1/transactions), and ideally IP-allowlist the key to this job's IP.
// The key is passed inline at run time, never written to Railway or git.
//
// Usage (history, one-time):
//   RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAYX_ACCOUNT_NUMBER=... \
//     node scripts/razorpay-sync.mjs 2024-01-01 2025-12-31
// Usage (incremental — default last 10 days, schedule this):
//   RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAYX_ACCOUNT_NUMBER=... \
//     node scripts/razorpay-sync.mjs
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
const today = new Date().toISOString().slice(0, 10)
const tenAgo = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10)
const [from = tenAgo, to = today] = process.argv.slice(2)
const fromEpoch = Math.floor(new Date(`${from}T00:00:00+05:30`).getTime() / 1000)
const toEpoch   = Math.floor(new Date(`${to}T23:59:59+05:30`).getTime() / 1000)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const auth = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64')

console.log(`Syncing RazorpayX transactions ${from} → ${to} …`)
let skip = 0, scanned = 0, payouts = 0
for (let page = 0; page < 1000; page++) {
  const url = `https://api.razorpay.com/v1/transactions?account_number=${encodeURIComponent(ACCT)}&count=100&skip=${skip}&from=${fromEpoch}&to=${toEpoch}`
  const res = await fetch(url, { headers: { Authorization: auth } })
  if (!res.ok) { console.error(`Razorpay ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1) }
  const items = (await res.json()).items || []
  if (!items.length) break
  scanned += items.length

  // Keep only real money-out: debit transactions sourced from a payout.
  const rows = items
    .filter(t => Number(t.debit) > 0 && t.source && t.source.entity === 'payout')
    .map(t => {
      const s = t.source
      return {
        payout_id:         s.id,
        utr:               s.utr || null,
        amount:            s.amount != null ? Number(s.amount) / 100 : Number(t.debit) / 100,  // payout amount in ₹
        status:            s.status || null,
        reference_id:      s.reference_id || null,
        benef_account:     s.fund_account?.bank_account?.account_number || null,
        benef_ifsc:        s.fund_account?.bank_account?.ifsc || null,
        fund_account_id:   s.fund_account_id || null,
        notes:             s.notes || null,
        payout_created_at: t.created_at ? new Date(t.created_at * 1000).toISOString() : null,
        event:             'txn_sync',
        received_at:       new Date().toISOString(),
        raw:               t,
      }
    })
  if (rows.length) {
    const { error } = await supabase.from('razorpay_payouts').upsert(rows, { onConflict: 'payout_id' })
    if (error) { console.error('Supabase upsert error:', error.message); process.exit(1) }
    payouts += rows.length
  }
  console.log(`  … scanned ${scanned} txns, ${payouts} payouts upserted`)
  if (items.length < 100) break
  skip += 100
}
console.log(`Done. ${payouts} payout transactions upserted into razorpay_payouts.`)
