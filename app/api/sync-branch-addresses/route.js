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
  if (words.length === 1) return words[0].substring(0, 3)
  if (words.length === 2) return (words[0].substring(0, 2) + words[1].substring(0, 2)).substring(0, 4)
  return words.map(w => w[0]).join('').substring(0, 4)
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

    // Fetch all branch data from CRM (including branch code)
    const [crmBranches] = await conn.execute(`
      SELECT
        brnch_id,
        brnch_name,
        brnch_address,
        city,
        state,
        pincode,
        brnch_contact,
        branchcode
      FROM branch_tbl
      WHERE brn_status = 'unblock'
    `)

    // Fetch active branch managers from emp_tbl per branch
    // Pick the most senior active manager per branch
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
          name: emp.name,
          phone: emp.omn || emp.contact || ''
        }
      }
    }

    // Get all branches from Supabase
    const { data: supabaseBranches, error: fetchError } = await supabase
      .from('branches')
      .select('id, name')

    if (fetchError) {
      return Response.json({ error: 'Failed to fetch Supabase branches', details: fetchError.message }, { status: 500 })
    }

    // Create mapping: CRM branch name → Supabase branch
    const supabaseMap = {}
    supabaseBranches.forEach(b => {
      supabaseMap[b.name?.toUpperCase()] = b
    })

    const updates = []
    const notFound = []
    let updated = 0

    for (const crmBranch of crmBranches) {
      const crmName = crmBranch.brnch_name?.trim()?.toUpperCase()
      const match = supabaseMap[crmName]

      if (!match) {
        notFound.push(crmName)
        continue
      }

      const manager = managerMap[crmBranch.brnch_id]

      // Use CRM branch code if exists, else auto-generate
      const branchCode = crmBranch.branchcode?.trim()
        ? crmBranch.branchcode.trim().toUpperCase()
        : autoBranchCode(crmBranch.brnch_name)

      const updateData = {
        branch_code: branchCode,
      }

      if (crmBranch.brnch_address) updateData.address       = crmBranch.brnch_address.trim()
      if (crmBranch.city)          updateData.city           = crmBranch.city.trim()
      if (crmBranch.pincode)       updateData.pin_code       = crmBranch.pincode.trim()
      if (crmBranch.brnch_contact) updateData.contact_phone  = crmBranch.brnch_contact.trim()
      if (manager?.name) {
        updateData.branch_employee  = manager.name.trim()
        updateData.contact_person   = manager.name.trim() // also set challan contact
      }
      if (manager?.phone) {
        updateData.branch_employee_phone = manager.phone.trim()
        if (!updateData.contact_phone) updateData.contact_phone = manager.phone.trim()
      }

      updates.push({ id: match.id, name: match.name, ...updateData })
    }

    // Perform batch updates
    const results = []
    for (const update of updates) {
      const { id, name, ...data } = update
      const { error: updateError } = await supabase
        .from('branches')
        .update(data)
        .eq('id', id)

      if (updateError) {
        results.push({ name, status: 'error', error: updateError.message })
      } else {
        results.push({ name, status: 'success', branch_code: data.branch_code, manager: data.contact_person })
        updated++
      }
    }

    return Response.json({
      success: true,
      summary: {
        total_crm_branches: crmBranches.length,
        matched: updates.length,
        updated,
        not_found: notFound.length,
        with_manager: results.filter(r => r.manager).length
      },
      not_found_branches: notFound.slice(0, 20),
      sample_results: results.slice(0, 10)
    })

  } catch (err) {
    console.error('Branch sync error:', err)
    return Response.json({ error: 'Failed to sync branches', details: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
