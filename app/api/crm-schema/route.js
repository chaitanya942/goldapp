import mysql from 'mysql2/promise'
import postgres from 'postgres'

export async function GET() {
  const result = { oldCrm: {}, newCrm: {}, errors: {} }

  // ── OLD CRM (MySQL) ────────────────────────────────────────────────────────
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

    // All tables in the database
    const [tables] = await conn.execute(`
      SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, CREATE_TIME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_ROWS DESC
    `)

    // Schema for every table
    const schema = {}
    for (const tbl of tables) {
      const name = tbl.TABLE_NAME
      try {
        const [cols] = await conn.execute(`DESCRIBE \`${name}\``)
        schema[name] = {
          columns: cols.map(c => ({ field: c.Field, type: c.Type, key: c.Key, null: c.Null, default: c.Default })),
          approx_rows: tbl.TABLE_ROWS,
        }
      } catch (e) {
        schema[name] = { error: e.message }
      }
    }

    // Sample 3 rows from every table (to understand data shape)
    const samples = {}
    for (const tbl of tables) {
      const name = tbl.TABLE_NAME
      try {
        const [rows] = await conn.execute(`SELECT * FROM \`${name}\` ORDER BY 1 DESC LIMIT 3`)
        samples[name] = rows
      } catch (e) {
        samples[name] = { error: e.message }
      }
    }

    // Distinct values for key operational fields across ALL tables
    const distinctValues = {}
    const fieldQueries = [
      { tbl: 'transac_tbl',    col: 'trxn_status'    },
      { tbl: 'transac_tbl',    col: 'type_gold'       },
      { tbl: 'transac_tbl',    col: 'pymt_mde'        },
      { tbl: 'transac_tbl',    col: 'txn_rmrk'        },
      { tbl: 'customer_walkin',col: 'walkin_status'   },
      { tbl: 'customer_walkin',col: 'walk_reason'     },
      { tbl: 'customer_walkin',col: 'source'          },
      { tbl: 'rejctd_tbl',     col: 'rej_rsn'         },
      { tbl: 'cust_walk_status',col: 'led_status'     },
      { tbl: 'paymt_trxns',    col: 'pymt_status'     },
      { tbl: 'paymt_trxns',    col: 'pymt_mode'       },
      { tbl: 'tkovr_app',      col: 'status'          },
    ]
    for (const { tbl, col } of fieldQueries) {
      try {
        const [rows] = await conn.execute(
          `SELECT IFNULL(\`${col}\`,'(null)') val, COUNT(*) cnt FROM \`${tbl}\` GROUP BY \`${col}\` ORDER BY cnt DESC LIMIT 30`
        )
        distinctValues[`${tbl}.${col}`] = rows
      } catch (e) {
        distinctValues[`${tbl}.${col}`] = { error: e.message }
      }
    }

    result.oldCrm = { tableCount: tables.length, tables: tables.map(t => ({ name: t.TABLE_NAME, approx_rows: t.TABLE_ROWS })), schema, samples, distinctValues }
  } catch (e) {
    result.errors.oldCrm = e.message
  } finally {
    if (conn) await conn.end()
  }

  // ── NEW CRM (PostgreSQL) ───────────────────────────────────────────────────
  let sql
  try {
    const sslOptions = process.env.NEW_CRM_DB_CA
      ? { ca: process.env.NEW_CRM_DB_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: false }
    sql = postgres({
      host:     process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
      port:     parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
      database: process.env.NEW_CRM_DB_NAME,
      username: process.env.NEW_CRM_DB_USER,
      password: process.env.NEW_CRM_DB_PASSWORD,
      ssl:      sslOptions,
      connect_timeout: 10,
      max: 1,
    })

    // All tables (public schema)
    const tables = await sql`
      SELECT
        t.table_name,
        pg_stat_user_tables.n_live_tup AS approx_rows
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables ON pg_stat_user_tables.relname = t.table_name
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY pg_stat_user_tables.n_live_tup DESC NULLS LAST
    `

    // Columns for every table
    const allCols = await sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `

    const schema = {}
    for (const tbl of tables) {
      schema[tbl.table_name] = {
        approx_rows: tbl.approx_rows,
        columns: allCols.filter(c => c.table_name === tbl.table_name)
          .map(c => ({ field: c.column_name, type: c.data_type, null: c.is_nullable, default: c.column_default }))
      }
    }

    // Foreign keys — understand join topology
    const fkeys = await sql`
      SELECT
        kcu.table_name, kcu.column_name,
        ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY kcu.table_name
    `

    // Sample 3 rows from every table
    const samples = {}
    for (const tbl of tables) {
      try {
        const rows = await sql.unsafe(`SELECT * FROM "${tbl.table_name}" ORDER BY 1 DESC LIMIT 3`)
        samples[tbl.table_name] = [...rows]
      } catch (e) {
        samples[tbl.table_name] = { error: e.message }
      }
    }

    // Distinct values for key enums/status fields
    const enumCols = await sql`
      SELECT t.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND (c.column_name ILIKE '%status%'
          OR c.column_name ILIKE '%type%'
          OR c.column_name ILIKE '%mode%'
          OR c.column_name ILIKE '%reason%'
          OR c.column_name ILIKE '%source%'
          OR c.column_name ILIKE '%role%')
      ORDER BY t.table_name, c.column_name
    `

    const distinctValues = {}
    for (const { table_name, column_name } of enumCols) {
      try {
        const rows = await sql.unsafe(
          `SELECT COALESCE("${column_name}"::text,'(null)') val, COUNT(*) cnt FROM "${table_name}" GROUP BY "${column_name}" ORDER BY cnt DESC LIMIT 20`
        )
        distinctValues[`${table_name}.${column_name}`] = [...rows]
      } catch (e) {
        distinctValues[`${table_name}.${column_name}`] = { error: e.message }
      }
    }

    result.newCrm = {
      tableCount: tables.length,
      tables: tables.map(t => ({ name: t.table_name, approx_rows: t.approx_rows })),
      foreignKeys: [...fkeys],
      schema,
      samples,
      distinctValues,
    }
  } catch (e) {
    result.errors.newCrm = e.message
  } finally {
    if (sql) try { await sql.end() } catch {}
  }

  return Response.json(result)
}
