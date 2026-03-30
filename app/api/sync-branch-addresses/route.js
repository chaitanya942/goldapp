import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(req) {
  let conn
  try {
    // Connect to CRM MySQL database
    conn = await mysql.createConnection({
      host:     process.env.CRM_DB_HOST,
      port:     parseInt(process.env.CRM_DB_PORT || '3306'),
      database: process.env.CRM_DB_NAME,
      user:     process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
    })

    // Fetch all branch data from CRM
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

    // Get all branches from Supabase
    const { data: supabaseBranches, error: fetchError } = await supabase
      .from('branches')
      .select('id, name')

    if (fetchError) {
      return Response.json({ error: 'Failed to fetch Supabase branches', details: fetchError.message }, { status: 500 })
    }

    // Create mapping: CRM branch name -> Supabase branch
    const supabaseMap = {}
    supabaseBranches.forEach(b => {
      supabaseMap[b.name?.toUpperCase()] = b
    })

    const updates = []
    const notFound = []
    let updated = 0
    let skipped = 0

    // Match and prepare updates
    for (const crmBranch of crmBranches) {
      const crmName = crmBranch.brnch_name?.trim()?.toUpperCase()

      // Try to find match by name
      let match = supabaseMap[crmName]

      if (!match) {
        notFound.push(crmName)
        continue
      }

      // Check if address data exists
      if (!crmBranch.brnch_address && !crmBranch.brnch_contact) {
        skipped++
        continue
      }

      // Prepare update data
      const updateData = {}

      if (crmBranch.brnch_address) {
        updateData.address = crmBranch.brnch_address.trim()
      }

      if (crmBranch.city) {
        updateData.city = crmBranch.city.trim()
      }

      if (crmBranch.pincode) {
        updateData.pin_code = crmBranch.pincode.trim()
      }

      if (crmBranch.brnch_contact) {
        updateData.contact_phone = crmBranch.brnch_contact.trim()
      }

      // Only update if we have at least one field
      if (Object.keys(updateData).length > 0) {
        updates.push({
          id: match.id,
          name: match.name,
          ...updateData
        })
      }
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
        results.push({ name, status: 'success' })
        updated++
      }
    }

    return Response.json({
      success: true,
      summary: {
        total_crm_branches: crmBranches.length,
        matched: updates.length,
        updated,
        skipped,
        not_found: notFound.length
      },
      not_found_branches: notFound.slice(0, 20), // First 20 not found
      results: results.slice(0, 10) // First 10 update results
    })

  } catch (err) {
    console.error('Branch address sync error:', err)
    return Response.json({
      error: 'Failed to sync branch addresses',
      details: err.message
    }, { status: 500 })
  } finally {
    if (conn) await conn.end()
  }
}
