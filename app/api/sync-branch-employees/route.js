import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Full refresh of branch_employees from the NEW CRM "Employee" table (Postgres).
// Wipes the table and re-inserts every employee with their full profile. Branch
// is matched to a Supabase branch by name (NEW CRM Branch.name).
export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  let client
  try {
    const { error: checkErr } = await supabase.from('branch_employees').select('id').limit(1)
    if (checkErr?.code === '42P01') {
      return Response.json({ error: 'branch_employees table not found. Run the table SQL in Supabase first.' }, { status: 400 })
    }

    client = new pg.Client({
      host: process.env.NEW_CRM_DB_HOST, port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
      database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
    })
    await client.connect()
    const { rows: employees } = await client.query(`
      SELECT e.emp_id,
             trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) AS name,
             e.email, e.phone, e.pan_number, e.designation,
             e.role::text         AS role,
             e.access_level::text AS access_level,
             e.date_of_joining, e.active, e.status,
             e.branch_id AS crm_branch_uuid,
             b.name AS crm_branch_name, b.state AS crm_branch_state, b.code AS crm_branch_code
        FROM "Employee" e
        LEFT JOIN "Branch" b ON b.id = e.branch_id
       WHERE trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) <> ''
       ORDER BY b.name, e.designation, e.first_name
    `)
    await client.end(); client = null

    if (!employees.length) return Response.json({ success: true, summary: { total: 0, inserted: 0, source: 'NEW_CRM' } })

    // Supabase branches for name matching.
    const { data: branches, error: bErr } = await supabase.from('branches').select('id, name')
    if (bErr) return Response.json({ error: 'Failed to fetch branches', details: bErr.message }, { status: 500 })
    const branchByName = {}
    ;(branches || []).forEach(b => { branchByName[(b.name || '').toUpperCase().trim()] = b })

    // Full wipe (removes the OLD-CRM data).
    await supabase.from('branch_employees').delete().gte('id', '00000000-0000-0000-0000-000000000000')

    const rows = employees.map(emp => {
      const branch = branchByName[(emp.crm_branch_name || '').toUpperCase().trim()]
      const desig  = (emp.designation || '').trim()
      const phone  = (emp.phone || '').trim() || null
      return {
        branch_id:       branch?.id || null,
        crm_branch_id:   emp.crm_branch_uuid || null,
        crm_branch_name: emp.crm_branch_name || null,
        crm_branch_code: emp.crm_branch_code || null,
        name:            emp.name.trim(),
        emp_id:          emp.emp_id || null,
        email:           emp.email || null,
        pan_number:      emp.pan_number || null,
        designation:     desig || null,
        role:            emp.role || null,
        access_level:    emp.access_level || null,
        date_of_joining: emp.date_of_joining || null,
        contact_phone:   phone,
        mobile_phone:    phone,
        emp_status:      emp.active === false ? 'inactive' : 'active',
        is_manager:      /manager/i.test(desig),
        synced_at:       new Date().toISOString(),
      }
    }).filter(r => r.name)

    // Insert in chunks. If the richer columns aren't in the table yet, strip them
    // and insert the core set (so the sync still works before the migration runs).
    const NEW_COLS = ['emp_id', 'email', 'pan_number', 'role', 'access_level', 'date_of_joining']
    let inserted = 0, stripped = false
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      let chunk = rows.slice(i, i + CHUNK)
      if (stripped) chunk = chunk.map(r => { const c = { ...r }; NEW_COLS.forEach(k => delete c[k]); return c })
      let { error } = await supabase.from('branch_employees').insert(chunk)
      if (error && NEW_COLS.some(k => error.message?.includes(k))) {
        stripped = true
        chunk = rows.slice(i, i + CHUNK).map(r => { const c = { ...r }; NEW_COLS.forEach(k => delete c[k]); return c })
        ;({ error } = await supabase.from('branch_employees').insert(chunk))
      }
      if (error) return Response.json({ error: 'Insert failed', details: error.message }, { status: 500 })
      inserted += chunk.length
    }

    const managers  = rows.filter(r => r.is_manager).length
    const active    = rows.filter(r => r.emp_status === 'active').length
    const matched   = rows.filter(r => r.branch_id).length
    return Response.json({
      success: true,
      summary: {
        source: 'NEW_CRM',
        total_crm_employees: employees.length,
        inserted, managers, active, inactive: rows.length - active,
        matched, unmatched: rows.length - matched,
        full_profile_stored: !stripped,   // false = run the branch_employees column migration
      },
    })
  } catch (err) {
    console.error('Employee sync error:', err)
    return Response.json({ error: 'Failed to sync employees', details: err.message }, { status: 500 })
  } finally {
    if (client) { try { await client.end() } catch {} }
  }
}
