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

    // Get all employees from CRM
    const [employees] = await conn.execute(`
      SELECT branch, name, designation, contact, omn, emp_status
      FROM emp_tbl
      WHERE name IS NOT NULL AND name != ''
      ORDER BY branch, designation, name
    `)

    // Get CRM branch list — needed to resolve brnch_id → brnch_name for name-based matching
    const [crmBranches] = await conn.execute(`
      SELECT brnch_id, brnch_name FROM branch_tbl
    `)

    // Map: CRM brnch_id (int) → branch name (uppercase)
    const crmNameById = {}
    crmBranches.forEach(b => {
      crmNameById[b.brnch_id] = b.brnch_name?.trim()?.toUpperCase()
    })

    if (!employees.length) {
      return Response.json({ success: true, summary: { total: 0, inserted: 0 } })
    }

    // Get all Supabase branches — match by crm_branch_id OR by name
    const { data: branches, error: branchErr } = await supabase
      .from('branches')
      .select('id, name, crm_branch_id')

    if (branchErr) {
      // crm_branch_id column might not exist yet — fall back to name-only
      const { data: fallback, error: fallbackErr } = await supabase
        .from('branches')
        .select('id, name')
      if (fallbackErr) {
        return Response.json({ error: 'Failed to fetch branches', details: fallbackErr.message }, { status: 500 })
      }
      branches = fallback
    }

    const branchById   = {}  // crm_branch_id (int) → supabase branch
    const branchByName = {}  // uppercase name    → supabase branch
    ;(branches || []).forEach(b => {
      if (b.crm_branch_id) branchById[b.crm_branch_id] = b
      branchByName[b.name?.toUpperCase()] = b
    })

    // Wipe all existing synced employees (full refresh)
    await supabase
      .from('branch_employees')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000')

    // Build insert rows
    const rows = employees
      .map(emp => {
        const desig     = emp.designation?.trim() || ''
        const isManager = /branch manager|bm/i.test(desig)

        // emp.branch can be numeric (brnch_id) or string like 'HO'
        const branchNum   = parseInt(emp.branch)
        const isNumeric   = !isNaN(branchNum) && String(branchNum) === String(emp.branch)
        const crmBranchId = isNumeric ? branchNum : null

        // Match to Supabase branch:
        // 1. By crm_branch_id (if branches have that column set)
        // 2. By CRM branch name → Supabase name (always works even without crm_branch_id)
        let branch = null
        if (crmBranchId) {
          branch = branchById[crmBranchId]
          if (!branch) {
            const crmBranchName = crmNameById[crmBranchId]
            if (crmBranchName) branch = branchByName[crmBranchName]
          }
        }

        return {
          branch_id:     branch?.id    || null,
          crm_branch_id: crmBranchId,
          name:          emp.name.trim(),
          designation:   desig         || null,
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
        }, { status: 500 })
      }
      inserted += chunk.length
    }

    const managers  = rows.filter(r => r.is_manager).length
    const active    = rows.filter(r => r.emp_status === 'active').length
    const matched   = rows.filter(r => r.branch_id).length
    const unmatched = rows.length - matched

    return Response.json({
      success: true,
      summary: {
        total_crm_employees: employees.length,
        inserted,
        managers,
        active,
        inactive:  rows.length - active,
        matched,
        unmatched,
      }
    })

  } catch (err) {
    console.error('Employee sync error:', err)
    return Response.json({ error: 'Failed to sync employees', details: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
