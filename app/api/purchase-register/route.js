// Purchase Register — unified daily-bills export in the legacy 26-column report.
//
// The reconciled per-bill data is built by lib/purchaseRegisterData.js (shared
// with the scheduled Finance report so the emailed numbers match this export
// exactly). This route just serializes those records to CSV + an xlsx AoA.
//   GET /api/purchase-register?from=YYYY-MM-DD&to=YYYY-MM-DD   (IST dates)
import { requireAuth } from '../../../lib/apiAuth'
import { buildPurchaseRegister, REGISTER_COLUMNS } from '../../../lib/purchaseRegisterData'

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
  const from = searchParams.get('from') || today
  const to   = searchParams.get('to')   || from
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return Response.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
  }

  let built
  try { built = await buildPurchaseRegister(from, to) }
  catch (e) { return Response.json({ error: `master data: ${e.message}` }, { status: 500 }) }

  const { records, columns, errors, counts } = built
  const COLUMNS = REGISTER_COLUMNS

  const lines = [COLUMNS.join(',')]
  records.forEach((rec, i) => {
    lines.push(COLUMNS.map(c => csvCell(c === 'SL' ? i + 1 : rec.cell[c])).join(','))
  })

  // Array-of-arrays for the .xlsx export — same rows, but with the CSV
  // text-guard (="…") unwrapped so the account number is a plain text cell.
  const aoa = [COLUMNS]
  records.forEach((rec, i) => {
    aoa.push(COLUMNS.map(c => {
      if (c === 'SL') return i + 1
      let v = rec.cell[c]
      if (typeof v === 'string') { const m = v.match(/^="(.*)"$/); if (m) v = m[1] }
      return v == null ? '' : v
    }))
  })

  return Response.json({
    from, to,
    total: counts.total, oldCount: counts.oldCount, newCount: counts.newCount,
    completedCount: counts.completedCount, pendingCount: counts.pendingCount,
    errors,
    csv: '﻿' + lines.join('\r\n'),
    aoa,
  })
}
