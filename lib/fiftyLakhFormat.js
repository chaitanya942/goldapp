// 50L+ Transactions CSV — Billed vs Paid case-wise columns plus the
// customer's financial-year columns, with each customer's bills listed
// together under a heading row (name, all mobiles, FY total). Browser-safe.
import { BVP_HEADER, bvpRowCells, toCsv } from './billedVsPaidFormat'

export const FIFTY_LAKH_EXTRA_HEADER = ['Customer Group', 'All Mobiles', 'Name Variants', 'Mobile (this bill)',
  'FY Cumulative to this bill (₹)', 'Customer FY Total (₹)', 'Customer FY Bills', 'Crossed ₹50L on this bill']

const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

// rows must be sorted customer by customer (as /api/fifty-lakh returns them).
export function fiftyLakhCsv(rows) {
  const width = BVP_HEADER.length + FIFTY_LAKH_EXTRA_HEADER.length
  const aoa = [[...BVP_HEADER, ...FIFTY_LAKH_EXTRA_HEADER]]
  let current = null, n = 0
  for (const r of rows) {
    if (r.customer_id !== current) {
      current = r.customer_id
      const heading = new Array(width).fill('')
      heading[1] = `▶ ${r.customer_name} — ${(r.mobiles || []).join(', ')} — FY total ${inr(r.fy_total)} (${r.fy_bills} bill${r.fy_bills === 1 ? '' : 's'})`
      aoa.push(heading)
    }
    aoa.push([...bvpRowCells(r, n++),
      r.customer_name, (r.mobiles || []).join(' / '), (r.customer_names || []).join(' / '), r.mobile,
      r.fy_running, r.fy_total, r.fy_bills, r.crossed_here ? 'YES' : ''])
  }
  return toCsv(aoa)
}
