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

    // Get Supabase branches — try with crm_branch_id, fall back if column missing
    let supabaseBranches
    const hasCrmIdCol = await (async () => {
      const { error } = await supabase.from('branches').select('crm_branch_id').limit(1)
      return !error
    })()

    const selectCols = hasCrmIdCol ? 'id, name, crm_branch_id' : 'id, name'
    const { data: fetched, error: fetchErr } = await supabase.from('branches').select(selectCols)
    if (fetchErr) {
      return Response.json({ error: 'Failed to fetch branches', details: fetchErr.message }, { status: 500 })
    }
    supabaseBranches = fetched || []

    // Build lookup maps
    const byId   = {}  // crm_branch_id → supabase branch
    const byName = {}  // uppercase name → supabase branch
    supabaseBranches.forEach(b => {
      if (b.crm_branch_id) byId[b.crm_branch_id] = b
      byName[b.name?.toUpperCase()] = b
    })

    const created = []
    const linked  = []  // existing branches that got crm_branch_id stamped
    const skipped = []
    const errors  = []

    for (const crm of crmBranches) {
      const crmName = crm.brnch_name?.trim()
      if (!crmName) continue

      const crmBranchId = crm.brnch_id != null ? String(crm.brnch_id) : null
      const match = byId[crmBranchId] || byName[crmName.toUpperCase()]

      if (match) {
        // Branch already exists — only stamp crm_branch_id if not set yet
        // This enables employee linking without overwriting any other data
        if (hasCrmIdCol && !match.crm_branch_id) {
          const { error } = await supabase
            .from('branches')
            .update({ crm_branch_id: crmBranchId })
            .eq('id', match.id)
          if (!error) linked.push(crmName)
        } else {
          skipped.push(crmName)
        }
        continue
      }

      // Branch does not exist in Supabase → INSERT it
      const manager    = managerMap[crm.brnch_id]
      const branchCode = crm.branchcode?.trim()
        ? crm.branchcode.trim().toUpperCase()
        : autoBranchCode(crmName)

      const payload = {
        name:      crmName,
        is_active: crm.brn_status === 'unblock',
      }
      if (crm.brnch_address) payload.address      = crm.brnch_address.trim()
      if (crm.city)          payload.city          = crm.city.trim()
      if (crm.pincode)       payload.pin_code      = crm.pincode.trim()
      if (crm.brnch_contact) payload.contact_phone = crm.brnch_contact.trim()
      if (manager?.name)     payload.contact_person = manager.name.trim()
      if (hasCrmIdCol)       payload.crm_branch_id = crmBranchId

      // Try with branch_code first, retry without if column missing
      let result = await supabase.from('branches').insert({ ...payload, branch_code: branchCode }).select('id').single()
      if (result.error?.message?.includes('branch_code')) {
        result = await supabase.from('branches').insert(payload).select('id').single()
      }

      if (result.error) {
        // If it's a unique constraint (branch was found by different casing), just skip
        if (result.error.code === '23505') {
          skipped.push(crmName + ' (name conflict)')
        } else {
          errors.push({ name: crmName, error: result.error.message })
        }
      } else {
        created.push(crmName)
      }
    }

    return Response.json({
      success: true,
      summary: {
        total_crm_branches: crmBranches.length,
        new_branches_added: created.length,
        crm_id_stamped:     linked.length,
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
