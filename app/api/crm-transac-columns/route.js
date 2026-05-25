// app/api/crm-transac-columns/route.js
//
// Tiny diagnostic endpoint: returns the column list of `transac_tbl` from old
// CRM as JSON. Used once to figure out the exact column names for fields we
// want to add to the sync (PAN, bank name, payment reference, …) so we don't
// have to guess naming conventions.
//
// Admin-only. Cheap (one DESCRIBE call).

import mysql from 'mysql2/promise'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

export const dynamic = 'force-dynamic'

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
      connectTimeout: 10000,
    })

    const [cols] = await conn.execute('DESCRIBE `transac_tbl`')
    // Also peek at one row so the user can see what each column actually
    // holds — sometimes the column name doesn't make the content obvious.
    const [[sample]] = await conn.execute('SELECT * FROM `transac_tbl` ORDER BY id DESC LIMIT 1')

    return Response.json({
      table: 'transac_tbl',
      columns: cols.map(c => ({ field: c.Field, type: c.Type, null: c.Null })),
      sample_row: sample,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    try { await conn?.end() } catch {}
  }
}
