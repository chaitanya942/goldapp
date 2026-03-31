import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST() {
  let conn
  try {
    // Check branch_employees table exists
    const { error: checkErr } = await supabase.from('branch_employees').select('id').limit(1)
    if (checkErr?.code === '42P01') {
      return Response.json({
        error: 'branch_employees table not found. Run Phase 2 SQL in Supabase SQL Editor first.'
      }, { status: 400 })
    }

    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // JOIN emp_tbl with branch_tbl to get branch name directly — most reliable matching
    const [employees] = await conn.execute(`
      SELECT
        e.name,
        e.designation,
        e.contact,
        e.omn,
        e.emp_status,
        b.brnch_id   AS crm_branch_id,
        b.brnch_name AS crm_branch_name,
        b.branchcode AS crm_branch_code,
        b.city       AS crm_branch_city,
        b.state      AS crm_branch_state
      FROM emp_tbl e
      LEFT JOIN branch_tbl b ON b.brnch_id = e.branch
      WHERE e.name IS NOT NULL AND TRIM(e.name) != ''
      ORDER BY b.brnch_name, e.designation, e.name
    `)

    if (!employees.length) {
      return Response.json({ success: true, summary: { total: 0, inserted: 0 } })
    }

    // Get Supabase branches for linking
    let branches
    const { data: d1, error: e1 } = await supabase.from('branches').select('id, name, crm_branch_id')
    if (!e1) {
      branches = d1
    } else {
      const { data: d2, error: e2 } = await supabase.from('branches').select('id, name')
      if (e2) return Response.json({ error: 'Failed to fetch branches', details: e2.message }, { status: 500 })
      branches = d2
    }

    const branchById   = {}  // crm_branch_id → supabase branch
    const branchByName = {}  // uppercase name → supabase branch
    ;(branches || []).forEach(b => {
      if (b.crm_branch_id) branchById[b.crm_branch_id] = b
      branchByName[b.name?.toUpperCase()?.trim()] = b
    })

    // Wipe and re-insert (full refresh)
    await supabase
      .from('branch_employees')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000')

    // Build insert rows
    const rows = employees
      .map(emp => {
        const desig     = emp.designation?.trim() || ''
        const isManager = /branch manager|bm/i.test(desig)

        // Match to Supabase branch:
        // 1. By crm_branch_id (if column exists on branches)
        // 2. By branch name (direct from JOIN — no lookup chain)
        const branch =
          branchById[emp.crm_branch_id] ||
          branchByName[emp.crm_branch_name?.toUpperCase()?.trim()]

        return {
          branch_id:        branch?.id || null,
          // Store as TEXT — CRM branch IDs can be numeric or string codes like "WG-2051"
          crm_branch_id:    emp.crm_branch_id != null ? String(emp.crm_branch_id) : null,
          crm_branch_name:  emp.crm_branch_name?.trim() || null,
          crm_branch_code:  emp.crm_branch_code?.trim() || null,
          name:             emp.name.trim(),
          designation:      desig || null,
          contact_phone:    emp.contact?.trim() || null,
          mobile_phone:     emp.omn?.trim()     || null,
          // CRM uses 'unblock'/'block' — treat anything that isn't explicitly 'block' as active
          emp_status:       emp.emp_status === 'block' ? 'inactive' : 'active',
          is_manager:       isManager,
          synced_at:        new Date().toISOString(),
        }
      })
      .filter(r => r.name)

    // Batch insert in chunks of 500
    let inserted = 0
    const CHUNK  = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const { error } = await supabase.from('branch_employees').insert(chunk)
      if (error) {
        // If optional columns don't exist yet, retry with only core columns
        if (error.message?.includes('crm_branch_name') || error.message?.includes('crm_branch_code')) {
          const stripped = chunk.map(({ crm_branch_name, crm_branch_code, ...rest }) => rest)
          const { error: e2 } = await supabase.from('branch_employees').insert(stripped)
          if (e2) return Response.json({ error: 'Insert failed', details: e2.message }, { status: 500 })
        } else {
          return Response.json({ error: 'Insert failed', details: error.message }, { status: 500 })
        }
      }
      inserted += chunk.length
    }

    const managers   = rows.filter(r => r.is_manager).length
    const active     = rows.filter(r => r.emp_status === 'active').length
    const matched    = rows.filter(r => r.branch_id).length
    const unmatched  = rows.length - matched

    // Collect distinct raw CRM status values for debugging
    const rawStatuses = [...new Set(employees.map(e => e.emp_status))]

    return Response.json({
      success: true,
      summary: {
        total_crm_employees: employees.length,
        inserted,
        managers,
        active,
        inactive:    rows.length - active,
        matched,
        unmatched,
        crm_statuses_found: rawStatuses,  // shows all raw values from CRM for visibility
      }
    })

  } catch (err) {
    console.error('Employee sync error:', err)
    return Response.json({ error: 'Failed to sync employees', details: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
