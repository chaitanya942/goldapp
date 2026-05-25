// app/api/crm-export-all/route.js
//
// ONE-SHOT EXPORT — every transac_tbl row (with every column the CRM has)
// since 2021-03-01, streamed as CSV.
//
// Streaming is the key change vs the original implementation: the previous
// version built the entire CSV string in memory and sent it after the whole
// MySQL query resolved. For 5 years of data the browser appeared to "hang"
// because nothing flowed until the very end. Here we stream row-by-row
// from MySQL into a ReadableStream and into the browser's download — the
// file appears immediately and grows as the query runs.
//
// Usage (admin-only, via authedFetch from the Consignment Seeds button):
//   GET /api/crm-export-all                        (since 2021-03-01)
//   GET /api/crm-export-all?from=YYYY-MM-DD        (custom start date)
//   GET /api/crm-export-all?include_items=false    (skip per-item ornaments)

import mysql from 'mysql2/promise'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const csvEscape = (v) => {
  if (v == null) return ''
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

  const url          = new URL(req.url)
  const fromDate     = url.searchParams.get('from') || '2021-03-01'
  // Item-level join (ornments_tbl) is the slow part. Default ON because the
  // user listed weights / purity in their required columns; can be turned
  // off via ?include_items=false for a much faster transac-only dump.
  const includeItems = (url.searchParams.get('include_items') ?? 'true') !== 'false'

  // ── Connect (createPool so we get .pool.query().stream()) ──────────────────
  const pool = mysql.createPool({
    host:               process.env.CRM_DB_HOST,
    port:               parseInt(process.env.CRM_DB_PORT || '3306'),
    database:           process.env.CRM_DB_NAME,
    user:               process.env.CRM_DB_USER,
    password:           process.env.CRM_DB_PASSWORD,
    waitForConnections: true,
    connectionLimit:    2,
    queueLimit:         0,
  })

  // Pre-fetch branch map (small, one round trip) so we can attach branch_name
  // to each streamed row without a per-row lookup.
  let branchMap = {}
  try {
    const [branches] = await pool.execute('SELECT brnch_id, brnch_name FROM branch_tbl')
    for (const b of branches) branchMap[b.brnch_id] = String(b.brnch_name || '').trim()
  } catch (err) {
    console.error('[crm-export-all] branch lookup failed:', err)
  }

  // Discover transac_tbl columns up-front so the CSV header is complete the
  // moment the stream starts. (sql/per-column DESCRIBE = one tiny query.)
  let transacCols = []
  try {
    const [cols] = await pool.execute('DESCRIBE `transac_tbl`')
    transacCols  = cols.map(c => c.Field)
  } catch (err) {
    console.error('[crm-export-all] DESCRIBE failed:', err)
    await pool.end()
    return Response.json({ error: 'Could not discover transac_tbl columns' }, { status: 500 })
  }

  // Final header order: every raw transac column → branch_name → computed
  // sums + item-level lists (if includeItems).
  const itemCols = includeItems ? [
    'item_count',
    'sum_gross_weight', 'sum_stone_weight', 'sum_wastage', 'sum_net_weight', 'sum_gross_amount',
    'service_charge_amount_calc',
    'items_gross_weight', 'items_stone_weight', 'items_wastage',
    'items_net_weight',  'items_purity',       'items_gross_amount',
  ] : ['service_charge_amount_calc']
  const headers = [...transacCols, 'branch_name', ...itemCols]
  // Prefixed select list so we can stream `SELECT t.col1, t.col2, …` without
  // a `*` (mysql2 streaming + GROUP BY can choke on `*` aliases).
  const transacSelectList = transacCols.map(c => `t.\`${c}\``).join(', ')

  const sql = includeItems ? `
    SELECT
      ${transacSelectList},
      GROUP_CONCAT(o.grms_wet   ORDER BY o.id)  AS items_gross_weight,
      GROUP_CONCAT(o.stnt_wet   ORDER BY o.id)  AS items_stone_weight,
      GROUP_CONCAT(o.wastag_wet ORDER BY o.id)  AS items_wastage,
      GROUP_CONCAT(o.net_wet    ORDER BY o.id)  AS items_net_weight,
      GROUP_CONCAT(o.purity     ORDER BY o.id)  AS items_purity,
      GROUP_CONCAT(o.grs_amnt   ORDER BY o.id)  AS items_gross_amount,
      COUNT(o.id)                               AS item_count
    FROM transac_tbl t
    LEFT JOIN ornments_tbl o ON o.trnxnn_id = t.id
    WHERE t.date >= ?
    GROUP BY t.id
    ORDER BY t.date ASC, t.time ASC, t.id ASC
  ` : `
    SELECT ${transacSelectList}
    FROM transac_tbl t
    WHERE t.date >= ?
    ORDER BY t.date ASC, t.time ASC, t.id ASC
  `

  // ── Build the streaming response ──────────────────────────────────────────
  const encoder = new TextEncoder()
  const stream  = new ReadableStream({
    async start(controller) {
      // Header line out the door immediately so the browser starts the download.
      controller.enqueue(encoder.encode(headers.join(',') + '\n'))

      let conn
      try {
        conn = await pool.getConnection()
        // mysql2 connection.query(...).stream() emits one row at a time.
        const query = conn.connection.query(sql, [fromDate])
        const rowStream = query.stream({ highWaterMark: 100 })

        for await (const r of rowStream) {
          const finalAmt   = parseFloat(r.finl_amnt) || 0
          const svcPct     = parseFloat(r.serv_chr)  || 0
          const enriched = {
            ...r,
            branch_name: branchMap[r.branch_id] || '',
            service_charge_amount_calc: (finalAmt * (svcPct / 100)).toFixed(2),
          }
          if (includeItems) {
            enriched.sum_gross_weight = sumCSV(r.items_gross_weight).toFixed(3)
            enriched.sum_stone_weight = sumCSV(r.items_stone_weight).toFixed(3)
            enriched.sum_wastage      = sumCSV(r.items_wastage).toFixed(3)
            enriched.sum_net_weight   = sumCSV(r.items_net_weight).toFixed(3)
            enriched.sum_gross_amount = sumCSV(r.items_gross_amount).toFixed(2)
          }
          const line = headers.map(h => csvEscape(enriched[h])).join(',') + '\n'
          controller.enqueue(encoder.encode(line))
        }
      } catch (err) {
        console.error('[crm-export-all] stream error:', err)
        // CSV-readable error trailer (commented row, then the message)
        controller.enqueue(encoder.encode(`\n# ERROR: ${String(err.message || err).replace(/\n/g, ' ')}\n`))
      } finally {
        try { conn?.release() } catch {}
        try { await pool.end() } catch {}
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="old-crm-export_from-${fromDate}_${new Date().toISOString().slice(0,10)}.csv"`,
      'Cache-Control':       'no-store',
      // Hint to Cloudflare/Railway that we want streaming, not buffering.
      'X-Accel-Buffering':   'no',
    },
  })
}
