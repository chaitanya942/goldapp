// app/api/crm-export-all/route.js
//
// ONE-SHOT EXPORT: pull every transac_tbl row (joined with branch + summed
// ornaments) from old CRM since 2021-03-01 and return as a single CSV
// download. Admin-only.
//
// Usage (in browser, while logged in as admin / founders_office / super_admin):
//   /api/crm-export-all                      → CSV from 2021-03-01 onwards
//   /api/crm-export-all?from=YYYY-MM-DD      → CSV from any date onwards
//
// Every column on transac_tbl is dumped via SELECT t.*, so even fields not
// referenced anywhere else in the codebase (PAN / bank / payment ref / etc.,
// if present in CRM) flow through to the export.
//
// Heavy query — give it the full 5-minute budget.

import mysql from 'mysql2/promise'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const csvEscape = (v) => {
  if (v == null) return ''
  // Dates: mysql2 returns Date objects for DATE columns
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10)
  }
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const sumCSV = (str) => {
  if (!str) return 0
  return String(str).split(',').reduce((acc, v) => {
    const n = parseFloat(v)
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const url      = new URL(req.url)
  const fromDate = url.searchParams.get('from') || '2021-03-01'

  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      user:     process.env.CRM_DB_USER,
      database: process.env.CRM_DB_NAME,
      password: process.env.CRM_DB_PASSWORD,
    })

    // Pull EVERY column off transac_tbl (SELECT t.*) so columns the app
    // never reads (PAN / bank / payment ref if they exist) flow through.
    // Ornaments are GROUP_CONCAT'd per-item AND summed, so the recipient
    // gets both the rolled-up totals and the per-item breakdown in one row.
    const [rows] = await conn.execute(`
      SELECT
        t.*,
        b.brnch_name                              AS branch_name,
        GROUP_CONCAT(o.grms_wet   ORDER BY o.id)  AS items_gross_weight,
        GROUP_CONCAT(o.stnt_wet   ORDER BY o.id)  AS items_stone_weight,
        GROUP_CONCAT(o.wastag_wet ORDER BY o.id)  AS items_wastage,
        GROUP_CONCAT(o.net_wet    ORDER BY o.id)  AS items_net_weight,
        GROUP_CONCAT(o.purity     ORDER BY o.id)  AS items_purity,
        GROUP_CONCAT(o.grs_amnt   ORDER BY o.id)  AS items_gross_amount,
        COUNT(o.id)                               AS item_count
      FROM transac_tbl t
      LEFT JOIN branch_tbl   b ON b.brnch_id  = t.branch_id
      LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
      WHERE t.date >= ?
      GROUP BY t.id
      ORDER BY t.date ASC, t.time ASC, t.id ASC
    `, [fromDate])

    if (!rows.length) {
      return Response.json({ error: `No CRM rows since ${fromDate}` }, { status: 404 })
    }

    // Headers = every column from the first row, plus the computed totals
    // tacked on so they sit at the end of each line and don't shift the
    // raw-column order if CRM ever adds new columns.
    const rawCols = Object.keys(rows[0]).filter(k =>
      !['items_gross_weight','items_stone_weight','items_wastage','items_net_weight','items_purity','items_gross_amount','item_count'].includes(k)
    )
    const computed = [
      'sum_gross_weight', 'sum_stone_weight', 'sum_wastage', 'sum_net_weight', 'sum_gross_amount',
      'service_charge_amount_calc',
      'item_count',
      'items_gross_weight', 'items_stone_weight', 'items_wastage', 'items_net_weight', 'items_purity', 'items_gross_amount',
    ]
    const headers = [...rawCols, ...computed]

    const lines = [headers.map(csvEscape).join(',')]
    for (const r of rows) {
      const sumGross  = sumCSV(r.items_gross_weight)
      const sumStone  = sumCSV(r.items_stone_weight)
      const sumWaste  = sumCSV(r.items_wastage)
      const sumNet    = sumCSV(r.items_net_weight)
      const sumAmt    = sumCSV(r.items_gross_amount)
      const finalAmt  = parseFloat(r.finl_amnt) || 0
      const svcPct    = parseFloat(r.serv_chr)  || 0
      const svcAmtCalc = finalAmt * (svcPct / 100)

      const enriched = {
        ...r,
        sum_gross_weight:           sumGross.toFixed(3),
        sum_stone_weight:           sumStone.toFixed(3),
        sum_wastage:                sumWaste.toFixed(3),
        sum_net_weight:             sumNet.toFixed(3),
        sum_gross_amount:           sumAmt.toFixed(2),
        service_charge_amount_calc: svcAmtCalc.toFixed(2),
      }
      lines.push(headers.map(h => csvEscape(enriched[h])).join(','))
    }

    const csv = lines.join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="old-crm-export_from-${fromDate}_${new Date().toISOString().slice(0,10)}.csv"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err) {
    console.error('[crm-export-all] failed:', err)
    return Response.json({ error: err.message || 'Export failed' }, { status: 500 })
  } finally {
    try { await conn?.end() } catch {}
  }
}
