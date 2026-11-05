// Billed vs Paid case-wise columns — shared by the Billed vs Paid export and
// the 50L+ Transactions CSV so both stay in exactly the same format.
// Browser-safe (no server imports).

export function bvpIssues(r) {
  const out = []
  if (r.paid == null || r.paid === 0)          out.push({ k: 'unpaid', label: 'Unpaid' })
  if (r.paid != null && Math.abs(r.diff) > 1)  out.push({ k: 'amount', label: 'Amount ≠' })
  if (r.acct_match === false)                  out.push({ k: 'acct',   label: 'Wrong a/c' })
  if (r.payout_sum_match === false)            out.push({ k: 'psum',   label: 'Payout ≠' })
  if (r.payout_acct_match === false)           out.push({ k: 'pacct',  label: 'Payout a/c' })
  return out
}

export const BVP_HEADER = ['#', 'Customer', 'Bill / App ID', 'Branch', 'Region', 'CRM', 'Purchase Date',
  'Penny Drop (₹)', 'Release (₹)', 'Final (₹)', 'Billed (₹)',
  'Paid – CRM (₹)', 'Paid – Bank (₹)', 'Payouts', 'Payout Status',
  'Diff (₹)', 'Account No', 'IFSC', 'PAN', 'UTR(s)',
  'Account Match', 'Payout Sum Match', 'Payout A/c Match', 'Issues']

const amt = (v) => (v == null ? '' : Math.round(v))
const match = (v) => (v == null ? '' : (v ? 'MATCH' : 'MISMATCH'))

export function bvpRowCells(r, i) {
  return [
    i + 1, r.customer, r.app_id, r.branch, r.region, r.crm.toUpperCase(), r.purchase_date,
    amt(r.penny), amt(r.release), amt(r.final), Math.round(r.billed),
    amt(r.paid_crm), amt(r.paid_bank), r.payout_count || '', r.payout_status || '',
    amt(r.diff), r.fin_acct || r.pen_acct, r.fin_ifsc || r.pen_ifsc, r.pan, (r.utrs || []).join(' '),
    match(r.acct_match), match(r.payout_sum_match), match(r.payout_acct_match),
    bvpIssues(r).map(x => x.label).join('; '),
  ]
}

// RFC 4180 CSV (quotes, commas, newlines) with a UTF-8 BOM so Excel shows ₹.
export function toCsv(aoa) {
  const cell = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + aoa.map(row => row.map(cell).join(',')).join('\r\n')
}
