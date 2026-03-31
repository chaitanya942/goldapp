import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Auto-generate branch code from name if CRM doesn't have one
function autoBranchCode(branchName) {
  const name = branchName.toUpperCase().trim()
  const stripped = name.replace(/^(AP|KL|TS|KA)-/, '')
  const words = stripped.split(/[\s-]+/).filter(Boolean)
  if (words.length === 1) return words[0].substring(0, 4)
  if (words.length === 2) return (words[0].substring(0, 2) + words[1].substring(0, 2)).substring(0, 4)
  return words.map(w => w[0]).join('').substring(0, 4).toUpperCase()
}

export async function POST() {
  let conn
  try {
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // Fetch ALL branch data from CRM (active + inactive for completeness)
    const [crmBranches] = await conn.execute(`
      SELECT
        brnch_id,
        brnch_name,
        brnch_address,
        city,
        state,
        pincode,
        brnch_contact,
        branchcode,
        brn_status
      FROM branch_tbl
    `)

    // Fetch active branch managers per branch
    const [crmManagers] = await conn.execute(`
      SELECT
        branch,
        name,
        contact,
        omn,
        designation,
        emp_status
      FROM emp_tbl
      WHERE emp_status = 'unblock'
        AND (
          designation LIKE '%Branch Manager%'
          OR designation LIKE '%BM%'
        )
      ORDER BY
        CASE
          WHEN designation LIKE '%Level 1%' THEN 1
          WHEN designation LIKE '%Branch Manager%' THEN 2
          ELSE 3
        END
    `)

    // Build manager map: brnch_id → manager
    const managerMap = {}
    for (const emp of crmManagers) {
      if (!managerMap[emp.branch]) {
        managerMap[emp.branch] = {
          name:  emp.name,
          phone: emp.omn || emp.contact || ''
        }
      }
    }

    // Get all Supabase branches (by crm_branch_id and by name for legacy matching)
    const { data: supabaseBranches, error: fetchError } = await supabase
      .from('branches')
      .select('id, name, crm_branch_id')

    if (fetchError) {
      return Response.json({ error: 'Failed to fetch Supabase branches', details: fetchError.message }, { status: 500 })
    }

    // Build two lookup maps
    const byId   = {}  // crm_branch_id → supabase branch
    const byName = {}  // uppercase name → supabase branch
    supabaseBranches.forEach(b => {
      if (b.crm_branch_id) byId[b.crm_branch_id] = b
      byName[b.name?.toUpperCase()] = b
    })

    const results  = []
    const created  = []
    let   updated  = 0
    let   inserted = 0

    for (const crm of crmBranches) {
      const crmName    = crm.brnch_name?.trim()
      const isActive   = crm.brn_status === 'unblock'
      const manager    = managerMap[crm.brnch_id]
      const branchCode = crm.branchcode?.trim()
        ? crm.branchcode.trim().toUpperCase()
        : autoBranchCode(crmName)

      // Try match by CRM ID first, then by name
      const match = byId[crm.brnch_id] || byName[crmName?.toUpperCase()]

      const payload = {
        crm_branch_id: crm.brnch_id,
        branch_code:   branchCode,
        is_active:     isActive,
      }

      if (crmName)           payload.name          = crmName.trim()
      if (crm.brnch_address) payload.address       = crm.brnch_address.trim()
      if (crm.city)          payload.city          = crm.city.trim()
      if (crm.state)         payload.state         = crm.state.trim()
      if (crm.pincode)       payload.pin_code      = crm.pincode.trim()
      if (crm.brnch_contact) payload.contact_phone = crm.brnch_contact.trim()
      if (manager?.name) {
        payload.branch_employee = manager.name.trim()
        payload.contact_person  = manager.name.trim()
      }
      if (manager?.phone) {
        payload.branch_employee_phone = manager.phone.trim()
        if (!payload.contact_phone) payload.contact_phone = manager.phone.trim()
      }

      if (match) {
        // UPDATE existing branch
        const { error } = await supabase.from('branches').update(payload).eq('id', match.id)
        if (error) {
          results.push({ name: crmName, status: 'error', error: error.message })
        } else {
          results.push({ name: crmName, status: 'updated', branch_code: branchCode, manager: manager?.name })
          updated++
        }
      } else {
        // INSERT new branch — CRM has it but Supabase doesn't
        const { data: newBranch, error } = await supabase
          .from('branches')
          .insert(payload)
          .select('id, name')
          .single()

        if (error) {
          results.push({ name: crmName, status: 'insert_error', error: error.message })
        } else {
          results.push({ name: crmName, status: 'created', branch_code: branchCode, id: newBranch.id })
          created.push(crmName)
          inserted++
        }
      }
    }

    return Response.json({
      success: true,
      summary: {
        total_crm_branches: crmBranches.length,
        updated,
        created: inserted,
        with_manager: results.filter(r => r.manager).length,
        errors: results.filter(r => r.status.includes('error')).length,
      },
      new_branches: created,
      sample_results: results.slice(0, 20),
    })

  } catch (err) {
    console.error('Branch sync error:', err)
    return Response.json({ error: 'Failed to sync branches', details: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
