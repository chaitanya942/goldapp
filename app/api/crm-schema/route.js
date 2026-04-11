import mysql from 'mysql2/promise'

export async function GET() {
  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    const [tables] = await conn.execute(`SHOW TABLES`)
    const tableNames = tables.map(r => Object.values(r)[0])

    const schema = {}
    for (const tbl of tableNames) {
      const [cols] = await conn.execute(`DESCRIBE \`${tbl}\``)
      schema[tbl] = cols.map(c => ({ field: c.Field, type: c.Type, null: c.Null, key: c.Key, default: c.Default }))
    }

    return Response.json({ tableNames, schema })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
