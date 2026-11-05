// 50L+ Transactions CSV — Billed vs Paid case-wise columns plus the
// customer's financial-year cumulative columns. Browser-safe.
import { BVP_HEADER, bvpRowCells, toCsv } from './billedVsPaidFormat'

export const FIFTY_LAKH_EXTRA_HEADER = ['Mobile', 'FY Cumulative to this bill (₹)', 'Customer FY Total (₹)', 'Customer FY Bills', 'Crossed ₹50L on this bill']

export function fiftyLakhCsv(rows) {
  return toCsv([
    [...BVP_HEADER, ...FIFTY_LAKH_EXTRA_HEADER],
    ...rows.map((r, i) => [...bvpRowCells(r, i), r.mobile, r.fy_running, r.fy_total, r.fy_bills, r.crossed_here ? 'YES' : '']),
  ])
}
