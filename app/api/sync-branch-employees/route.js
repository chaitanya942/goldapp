import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Ensure branch_employees table exists; returns true if ready
async function ensureTable() {
  const { error } = await supabase.from('branch_employees').select('id').limit(1)
  if (!error || error.code !== '42P01') return { ok: true }

  // Table doesn't exist — try to create it via branches API workaround
  // We can't run DDL directly via JS client, so return a helpful error
  return {
    ok: false,
    message: 'branch_employees table not found. Run Phase 2 SQL in Supabase SQL Editor (see supabase_schema_consignment.sql) then try again.'
  }
}

export async function POST() {
  let conn
  try {
    // Check table exists first
    const tableCheck = await ensureTable()
    if (!tableCheck.ok) {
      return Response.json({ error: tableCheck.message }, { status: 400 })
    }

    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // Fetch all employees from CRM (active + inactive)
    const [employees] = await conn.execute(`
      SELECT
        branch,
        name,
        designation,
        contact,
        omn,
        emp_status
      FROM emp_tbl
      WHERE name IS NOT NULL AND name != ''
      ORDER BY branch, designation, name
    `)

    if (!employees.length) {
      return Response.json({ success: true, summary: { total: 0, inserted: 0 } })
    }

    // Get all Supabase branches keyed by crm_branch_id
    const { data: branches, error: branchErr } = await supabase
      .from('branches')
      .select('id, crm_branch_id, name')

    if (branchErr) {
      return Response.json({ error: 'Failed to fetch branches', details: branchErr.message }, { status: 500 })
    }

    const branchById   = {}  // crm_branch_id → branch
    branches.forEach(b => {
      if (b.crm_branch_id) branchById[b.crm_branch_id] = b
    })

    // Wipe existing synced employees (full-refresh)
    const { error: delError } = await supabase
      .from('branch_employees')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000') // delete all rows

    if (delError) {
      return Response.json({ error: 'Failed to clear old employees', details: delError.message }, { status: 500 })
    }

    // Build insert rows
    const rows = employees
      .map(emp => {
        const branch    = branchById[emp.branch]
        const desig     = emp.designation?.trim() || ''
        const isManager = /branch manager|bm/i.test(desig)

        // emp_tbl.branch can be a number (brnch_id) OR a string like 'HO' (Head Office)
        // Only store as crm_branch_id if it's a valid integer
        const branchNum    = parseInt(emp.branch)
        const crmBranchId  = !isNaN(branchNum) && String(branchNum) === String(emp.branch) ? branchNum : null

        return {
          branch_id:     branch?.id || null,
          crm_branch_id: crmBranchId,
          name:          emp.name.trim(),
          designation:   desig || null,
          contact_phone: emp.contact?.trim() || null,
          mobile_phone:  emp.omn?.trim()     || null,
          emp_status:    emp.emp_status === 'unblock' ? 'active' : 'inactive',
          is_manager:    isManager,
          synced_at:     new Date().toISOString(),
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
        return Response.json({
          error:   'Insert failed',
          details: error.message,
          hint:    error.hint || null,
          at_row:  i,
        }, { status: 500 })
      }
      inserted += chunk.length
    }

    const managers  = rows.filter(r => r.is_manager).length
    const active    = rows.filter(r => r.emp_status === 'active').length
    const unmatched = rows.filter(r => !r.branch_id).length

    return Response.json({
      success: true,
      summary: {
        total_crm_employees: employees.length,
        inserted,
        managers,
        active,
        inactive:         rows.length - active,
        unmatched_branch: unmatched,
      }
    })

  } catch (err) {
    console.error('Employee sync error:', err)
    return Response.json({ error: 'Failed to sync employees', details: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
