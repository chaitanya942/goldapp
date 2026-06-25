// app/api/admin/gsheet-test/route.js
//
// Test the GoldApp → Google Sheets push. Writes a handful of sample rows to a
// tab in a sheet you've shared with the service account. Admin-gated.
//
//   POST /api/admin/gsheet-test
//   body: { spreadsheetId: "<sheet id>", tab: "Sheet1", startCell?: "A1" }
//
// Confirms the pipe works (auth + write) before we wire real datasets.

import { pushToSheet } from '../../../../lib/googleSheets'
import { requireAuthForPage } from '../../../../lib/apiAuth'

export const runtime = 'nodejs'

export async function POST(req) {
  const auth = await requireAuthForPage(req, 'company-settings')   // admin only
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const spreadsheetId = (body.spreadsheetId || '').trim()
  const tab           = (body.tab || 'Sheet1').trim()
  const startCell     = (body.startCell || 'A1').trim()
  if (!spreadsheetId) return Response.json({ error: 'spreadsheetId required' }, { status: 400 })

  const header = ['Purchase Date', 'Application No.', 'Cust Name', 'Branch', 'Net Weight', 'Final Amount']
  const rows = [
    ['2026-06-24', 'WGKA-TEST1', 'Test Customer A', 'HUBLI',  '12.34', '85000'],
    ['2026-06-24', 'WGKA-TEST2', 'Test Customer B', 'MYSURU', '5.67',  '41000'],
    ['2026-06-24', 'WGKA-TEST3', 'Test Customer C', 'UDUPI',  '20.10', '150000'],
  ]
  try {
    const r = await pushToSheet(spreadsheetId, tab, header, rows, startCell)
    return Response.json({ ok: true, wrote: r, tab, message: `Wrote ${rows.length} sample rows to "${tab}".` })
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 })
  }
}
