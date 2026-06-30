// app/api/productivity/route.js
//
// Data engine for the Productivity module (gated to a hard email allowlist —
// see PAGE_EMAIL_ALLOWLIST). Scrapes the CRMs and returns insight slices.
//
// Date → source convention (per ops): purchase date 1–14 Jun 2026 = OLD CRM
// (MySQL), 15 Jun onward = NEW CRM (Postgres). The client passes from/to; this
// route routes each window to the right CRM and returns like-for-like shapes so
// OLD and NEW compare apples-to-apples.
//
// action=tat → turn-around-time slices (overall / state / type / stone /
//              ornament-count), the seed report. More actions to come
//              (throughput, conversion, employee, branch, …).

import mysql from 'mysql2/promise'
import { requireAuthForPage } from '../../../lib/apiAuth'

const OLD_CUTOVER = '2026-06-15'   // < this = OLD CRM, >= this = NEW CRM

let _oldPool = null
function oldPool() {
  if (!_oldPool) {
    _oldPool = mysql.createPool({
      host: process.env.CRM_DB_HOST, port: parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME, user: process.env.CRM_DB_USER, password: process.env.CRM_DB_PASSWORD,
      waitForConnections: true, connectionLimit: 3, connectTimeout: 20000,
    })
  }
  return _oldPool
}

// ── OLD CRM TAT (MySQL) ──────────────────────────────────────────────────────
// TAT = payment datetime − walk-in datetime (minutes). Joins are 100% clean:
//   ornments_tbl.trnxnn_id = transac_tbl.bill_no, branch_tbl.brnch_id = branch_id.
// Stone via ornments_tbl.stnt_wet > 0; ornament count via num_ornmnts; type via
// type_gold ('physical' | 'released' = takeover); state via branch_tbl.state.
async function oldCrmTat(from, to) {
  const p = oldPool()
  const TAT = 'TIMESTAMPDIFF(MINUTE, TIMESTAMP(t.date,t.time), TIMESTAMP(t.pmt_date,t.pmt_time))'
  const TYP = "CASE WHEN t.type_gold='released' OR COALESCE(NULLIF(t.tkvr_amnt,''),'0')+0>0 THEN 'TAKEOVER' ELSE 'PHYSICAL' END"
  const STONE = "CASE WHEN CAST(o.stnt_wet AS DECIMAL(10,3))>0 THEN 'with_stone' ELSE 'no_stone' END"
  const ORN = "CASE WHEN CAST(o.num_ornmnts AS UNSIGNED)=1 THEN '1' WHEN CAST(o.num_ornmnts AS UNSIGNED) BETWEEN 2 AND 5 THEN '2-5' WHEN CAST(o.num_ornmnts AS UNSIGNED) BETWEEN 6 AND 10 THEN '6-10' ELSE '>10' END"
  const BASE = `FROM transac_tbl t
    JOIN ornments_tbl o ON o.trnxnn_id=t.bill_no
    JOIN branch_tbl b ON b.brnch_id=t.branch_id
    WHERE t.date BETWEEN ? AND ? AND t.pmt_date IS NOT NULL AND ${TAT} BETWEEN 0 AND 1440`
  const run = async (sql) => { const [r] = await p.query(sql, [from, to]); return r }

  const [overall] = await run(`SELECT COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min, MIN(${TAT}) min_min, MAX(${TAT}) max_min ${BASE}`)
  const by_state       = await run(`SELECT b.state, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY b.state ORDER BY bills DESC`)
  const by_type        = await run(`SELECT ${TYP} typ, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY typ`)
  const by_stone       = await run(`SELECT ${STONE} stone, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY stone`)
  const by_state_type  = await run(`SELECT b.state, ${TYP} typ, ${STONE} stone, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY b.state, typ, stone ORDER BY b.state, typ, stone`)
  const by_ornament    = await run(`SELECT ${ORN} orn, ${STONE} stone, COUNT(*) bills, ROUND(AVG(${TAT}),1) avg_min ${BASE} GROUP BY orn, stone ORDER BY orn, stone`)

  return { source: 'old_crm', overall, by_state, by_type, by_stone, by_state_type, by_ornament }
}

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'productivity')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'tat'
  const from   = searchParams.get('from') || '2026-06-01'
  const to     = searchParams.get('to')   || '2026-06-14'

  try {
    if (action === 'tat') {
      // Route the window to the right CRM. (NEW-CRM TAT lands next iteration;
      // for now any window touching < cutover is served from OLD CRM.)
      if (to < OLD_CUTOVER) {
        return Response.json({ data: await oldCrmTat(from, to), window: { from, to } })
      }
      // NEW CRM / mixed window — placeholder until the NEW-CRM engine ships.
      return Response.json({ data: null, window: { from, to }, note: 'NEW-CRM TAT engine not wired yet — use a 1–14 Jun window for OLD-CRM data.' })
    }
    return Response.json({ error: `Unknown action '${action}'` }, { status: 400 })
  } catch (err) {
    console.error('[productivity] error:', err)
    return Response.json({ error: err.message || 'Productivity query failed' }, { status: 500 })
  }
}
