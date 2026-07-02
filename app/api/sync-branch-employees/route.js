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
  // Cron-token bypass (server-to-server, no session) — the daily midnight sync in
  // scripts/cron-sync.mjs calls this with x-cron-token. Interactive callers still
  // need ADMIN.
  const cronToken = req.headers.get('x-cron-token') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const isCron = process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET
  if (!isCron) {
    const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
    if (!auth.ok) return auth.response
  }

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
             e.date_of_joining, e.active, e.status, e.logged_in_at,
             e.branch_id AS crm_branch_uuid,
             b.name AS crm_branch_name, b.state AS crm_branch_state, b.code AS crm_branch_code
        FROM "Employee" e
        LEFT JOIN "Branch" b ON b.id = e.branch_id
       WHERE trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) <> ''
       ORDER BY b.name, e.designation, e.first_name
    `)
    // ── CRM activity per employee (keyed by emp_id code) ──
    // cases opened = transactions they created; cases handled = distinct
    // transactions they touched in ANY stage (opener / negotiation / quotation /
    // payment / order / KYC), normalised to emp_id via the Employee table.
    const { rows: opened } = await client.query(`
      SELECT emp_id, count(*)::int n, max(created_at) last_txn
        FROM "Transaction" WHERE emp_id IS NOT NULL GROUP BY emp_id`)
    const { rows: handled } = await client.query(`
      WITH h AS (
        SELECT id tid, emp_id hk FROM "Transaction" WHERE emp_id IS NOT NULL
        UNION ALL SELECT transaction_id, negotiation_approved_id FROM "Estimation" WHERE negotiation_approved_id IS NOT NULL
        UNION ALL SELECT transaction_id, quotation_approved_id FROM "Quotation" WHERE quotation_approved_id IS NOT NULL
        UNION ALL SELECT transaction_id, employee_id FROM "Payment" WHERE employee_id IS NOT NULL
        UNION ALL SELECT transaction_id, emp_id FROM "Order" WHERE emp_id IS NOT NULL
        UNION ALL SELECT k.transaction_id, l.emp_id FROM "KycLog" l JOIN "Kyc" k ON k.id=l.kyc_id WHERE l.emp_id IS NOT NULL
      ), norm AS (
        SELECT h.tid, COALESCE(e1.emp_id, e2.emp_id) emp FROM h
        LEFT JOIN "Employee" e1 ON e1.emp_id = h.hk
        LEFT JOIN "Employee" e2 ON e2.id = h.hk
      )
      SELECT emp, count(DISTINCT tid)::int n FROM norm WHERE emp IS NOT NULL GROUP BY emp`)
    await client.end(); client = null

    const openedBy  = Object.fromEntries(opened.map(r => [r.emp_id, r]))
    const handledBy = Object.fromEntries(handled.map(r => [r.emp, r.n]))

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
        // CRM activity
        cases_opened:    openedBy[emp.emp_id]?.n ?? 0,
        cases_handled:   handledBy[emp.emp_id] ?? 0,
        last_txn_at:     openedBy[emp.emp_id]?.last_txn || null,
        logged_in_at:    emp.logged_in_at || null,
        synced_at:       new Date().toISOString(),
      }
    }).filter(r => r.name)

    // Insert in chunks. If the richer columns aren't in the table yet, strip them
    // and insert the core set (so the sync still works before the migration runs).
    const NEW_COLS = ['emp_id', 'email', 'pan_number', 'role', 'access_level', 'date_of_joining', 'cases_opened', 'cases_handled', 'last_txn_at', 'logged_in_at']
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
