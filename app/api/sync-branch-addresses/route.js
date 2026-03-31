import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function autoBranchCode(branchName) {
  const name     = branchName.toUpperCase().trim()
  const stripped = name.replace(/^(AP|KL|TS|KA)-/, '')
  const words    = stripped.split(/[\s-]+/).filter(Boolean)
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

    // All branches from CRM
    const [crmBranches] = await conn.execute(`
      SELECT brnch_id, brnch_name, brnch_address, city, state, pincode,
             brnch_contact, branchcode, brn_status
      FROM branch_tbl
    `)

    // Active branch managers per branch
    const [crmManagers] = await conn.execute(`
      SELECT branch, name, contact, omn, designation
      FROM emp_tbl
      WHERE emp_status = 'unblock'
        AND (designation LIKE '%Branch Manager%' OR designation LIKE '%BM%')
      ORDER BY
        CASE WHEN designation LIKE '%Level 1%' THEN 1
             WHEN designation LIKE '%Branch Manager%' THEN 2
             ELSE 3 END
    `)

    const managerMap = {}
    for (const emp of crmManagers) {
      if (!managerMap[emp.branch]) {
        managerMap[emp.branch] = { name: emp.name, phone: emp.omn || emp.contact || '' }
      }
    }

    // Get existing Supabase branches (name lookup only — crm_branch_id may not exist yet)
    const { data: existingBranches, error: fetchErr } = await supabase
      .from('branches')
      .select('id, name')

    if (fetchErr) {
      return Response.json({ error: 'Failed to fetch branches', details: fetchErr.message }, { status: 500 })
    }

    // Build set of existing branch names (uppercase) for quick lookup
    const existingNames = new Set(existingBranches.map(b => b.name?.toUpperCase()))

    const created  = []
    const skipped  = []
    const errors   = []

    for (const crm of crmBranches) {
      const crmName = crm.brnch_name?.trim()
      if (!crmName) continue

      // Skip branches already in Supabase
      if (existingNames.has(crmName.toUpperCase())) {
        skipped.push(crmName)
        continue
      }

      // Only insert branches not yet in Supabase
      const manager    = managerMap[crm.brnch_id]
      const branchCode = crm.branchcode?.trim()
        ? crm.branchcode.trim().toUpperCase()
        : autoBranchCode(crmName)

      const payload = {
        name:      crmName,
        is_active: crm.brn_status === 'unblock',
      }

      // Only include optional columns if they have values — missing columns won't cause errors
      // (Supabase just ignores unknown columns in insert when using PostgREST? No — it errors.)
      // We build a minimal safe payload and add extended columns conditionally.
      if (crm.brnch_address) payload.address      = crm.brnch_address.trim()
      if (crm.city)          payload.city          = crm.city.trim()
      if (crm.pincode)       payload.pin_code      = crm.pincode.trim()
      if (crm.brnch_contact) payload.contact_phone = crm.brnch_contact.trim()
      if (manager?.name) {
        payload.contact_person = manager.name.trim()
      }

      // Try inserting with branch_code (may not exist if SQL not run yet)
      // If it fails, retry without extended columns
      let insertResult = await supabase.from('branches').insert({ ...payload, branch_code: branchCode }).select('id, name').single()

      if (insertResult.error) {
        // Retry without extended columns (in case branch_code / others don't exist yet)
        insertResult = await supabase.from('branches').insert(payload).select('id, name').single()
      }

      if (insertResult.error) {
        errors.push({ name: crmName, error: insertResult.error.message })
      } else {
        created.push(crmName)
      }
    }

    return Response.json({
      success: true,
      summary: {
        total_crm_branches: crmBranches.length,
        new_branches_added: created.length,
        already_existed:    skipped.length,
        errors:             errors.length,
      },
      new_branches: created,
      errors: errors.slice(0, 20),
    })

  } catch (err) {
    console.error('Branch sync error:', err)
    return Response.json({ error: 'Failed to sync branches', details: err.message }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
