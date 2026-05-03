import mysql from 'mysql2/promise'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

// Admin-tooling endpoint — exposes raw CRM schema + sample rows. Lock to ADMIN.
export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'schema'

  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    if (action === 'schema') {
      // Get branch_tbl schema
      const [columns] = await conn.execute(`DESCRIBE branch_tbl`)
      return Response.json({ columns })
    }

    if (action === 'data') {
      const [branches] = await conn.execute(`SELECT * FROM branch_tbl LIMIT 100`)
      return Response.json({ branches })
    }

    if (action === 'tables') {
      const [tables] = await conn.execute(`SHOW TABLES`)
      return Response.json({ tables })
    }

    if (action === 'emp_schema') {
      const table = req.url.includes('emp_tbl') ? 'emp_tbl' : 'employee_tbl'
      const [columns] = await conn.execute(`DESCRIBE ${table}`)
      return Response.json({ columns })
    }

    if (action === 'describe') {
      const table = searchParams.get('table') || ''
      if (!table.match(/^[a-zA-Z0-9_]+$/)) return Response.json({ error: 'Invalid table name' }, { status: 400 })
      const [columns] = await conn.execute(`DESCRIBE ${table}`)
      return Response.json({ columns })
    }

    if (action === 'emp_data') {
      const [rows] = await conn.execute(`SELECT * FROM emp_tbl LIMIT 10`)
      return Response.json({ rows })
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
