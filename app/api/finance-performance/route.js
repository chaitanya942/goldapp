// GET /api/finance-performance — Finance performance (lib/financePerformance).
//   ?from&to            IST dates (from ≥ 15 Jun 2026; to ≤ today)
//   &types=A,B          PENNY_DROP | FINAL_PAYMENT | RELEASE_PAYMENT | MANUAL_PAYMENT
//   &employee &branch &region &txn_type
//   &min=10|15|20       only cases whose queue time is more than N minutes
//   &format=csv         every filtered case as a plain CSV
// Access: Finance & Accounts page permission "finance-performance".

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'
import { getAllowedRegionsForAuth } from '../../../lib/regionScope'
import { buildFinancePerformance, FINANCE_DATA_START, REQUEST_TYPES } from '../../../lib/financePerformance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)

const CSV_COLS = [
  ['Request Type', r => REQUEST_TYPES[r.req] || r.req], ['App ID', r => r.code], ['Transaction Type', r => r.txn_type],
  ['Branch', r => r.branch], ['Region', r => r.region], ['Employee', r => r.emp_name || 'Not recorded'],
  ['Employee Code', r => r.emp_code], ['Designation', r => r.designation], ['Landed In Queue (IST)', r => r.landed_ist],
  ['Actioned (IST)', r => r.actioned_ist], ['Time In Queue (min)', r => r.wait_min],
  ['Bank Confirmation (min)', r => r.bank_min], ['Status', r => r.status], ['UTR', r => r.utr],
  ['Payout Screenshots', r => r.screenshots], ['Timing Basis', r => r.basis],
]
const cell = (v) => { const s = v == null ? '' : String(v).replace(/→/g, ' to ').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim(); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'finance-performance')
  if (!auth.ok) return auth.response

  const q = new URL(req.url).searchParams
  const today = istToday()
  let from = isDate(q.get('from')) ? q.get('from') : today
  let to = isDate(q.get('to')) ? q.get('to') : today
  if (from < FINANCE_DATA_START) from = FINANCE_DATA_START
  if (to > today) to = today
  if (to < from) return Response.json({ error: `Pick dates from ${FINANCE_DATA_START} onwards.` }, { status: 400 })
  const filters = {
    types: (q.get('types') || '').split(',').filter(t => REQUEST_TYPES[t]),
    employee: q.get('employee') || null, branch: q.get('branch') || null, region: q.get('region') || null,
    txnType: q.get('txn_type') || null, minMinutes: [10, 15, 20].includes(Number(q.get('min'))) ? Number(q.get('min')) : null,
  }

  try {
    const allowedRegions = await getAllowedRegionsForAuth(supabase, auth)
    const r = await buildFinancePerformance({ from, to, filters, allowedRegions })
    if (q.get('format') === 'csv') {
      const lines = [CSV_COLS.map(c => c[0]).join(','), ...r._all.map(row => CSV_COLS.map(c => cell(c[1](row))).join(','))]
      return new Response(lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="finance-performance_${from}_to_${to}.csv"` } })
    }
    const { _all, ...json } = r
    return Response.json(json)
  } catch (e) {
    return Response.json({ error: `CRM unavailable: ${e.message}` }, { status: 502 })
  }
}
