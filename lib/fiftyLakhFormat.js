// 50L+ Transactions CSV — a plain table: one header row, then one row per
// bill. Each customer's bills are consecutive and the "Customer Group" column
// names whose they are. Same columns as Billed vs Paid's case-wise export plus
// the FY columns, but plain-ASCII headers and values (no symbols, no heading
// rows, no byte-order mark) so it opens cleanly anywhere. Browser-safe.
import { bvpRowCells, toCsv } from './billedVsPaidFormat'

export const FIFTY_LAKH_CSV_HEADER = [
  'S No', 'Customer', 'Bill / App ID', 'Branch', 'Region', 'CRM', 'Purchase Date',
  'Penny Drop (INR)', 'Release (INR)', 'Final (INR)', 'Billed (INR)',
  'Paid CRM (INR)', 'Paid Bank (INR)', 'Payouts', 'Payout Status',
  'Diff (INR)', 'Account No', 'IFSC', 'PAN', 'UTRs',
  'Account Match', 'Payout Sum Match', 'Payout Account Match', 'Issues',
  'Customer Group', 'All Mobiles', 'Name Variants', 'Mobile (this bill)',
  'FY Cumulative to this bill (INR)', 'Customer FY Total (INR)', 'Customer FY Bills', 'Crossed 50L on this bill',
]

// Billed vs Paid issue labels use symbols; spell them out for the CSV.
const PLAIN_ISSUE = { 'Unpaid': 'Unpaid', 'Amount ≠': 'Amount mismatch', 'Wrong a/c': 'Wrong account', 'Payout ≠': 'Payout mismatch', 'Payout a/c': 'Payout account mismatch' }
const plain = (v) => typeof v === 'string'
  ? v.replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()
  : v

// rows must be sorted customer by customer (as /api/fifty-lakh returns them).
export function fiftyLakhCsv(rows) {
  const ISSUES = FIFTY_LAKH_CSV_HEADER.indexOf('Issues')
  const body = rows.map((r, i) => {
    const cells = bvpRowCells(r, i)
    cells[ISSUES] = String(cells[ISSUES] || '').split('; ').filter(Boolean).map(x => PLAIN_ISSUE[x] || x).join('; ')
    return [...cells,
      r.customer_name, (r.mobiles || []).join(' / '), (r.customer_names || []).join(' / '), r.mobile,
      r.fy_running, r.fy_total, r.fy_bills, r.crossed_here ? 'YES' : 'NO',
    ].map(plain)
  })
  return toCsv([FIFTY_LAKH_CSV_HEADER, ...body], { bom: false })
}
