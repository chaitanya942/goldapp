// Auto-add branches to the master when they start purchasing.
// Runs once a day from the cron worker (maybeSyncBranches in scripts/cron-sync.mjs).
// A branch appears in Branch Management the first day it has a purchase — no
// manual "Sync CRM" needed (the old MySQL-CRM branch sync is retired).
//
// Validity gate = the NEW CRM "Branch" table (aliased to canonical names), so
// only real CRM branches are ever inserted — stray branch_name values in
// purchases ("Branch", blank, etc.) can never create a bogus master row.
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'
import { aliasBranchName } from '../../../lib/crmBranchAlias'
import { deriveBranchFields, autoBranchCode } from '../../../lib/branchDerive'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// Junk placeholder "branches" that exist in the NEW CRM but are not real
// branches — never create a master row for these even if one has a stray bill.
const IGNORE_NAMES = new Set(['BRANCH', 'HO', 'HEAD OFFICE', 'TEST', 'DUMMY', 'NA', 'N/A', '-'])

export async function POST(req) {
  // Cron-token bypass (server-to-server); interactive callers need ADMIN.
  const cronToken = req.headers.get('x-cron-token') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const isCron = process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET
  if (!isCron) {
    const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
    if (!auth.ok) return auth.response
  }

  let client
  try {
    // 1) Authoritative valid branch set = NEW CRM "Branch", aliased to canonical.
    client = new pg.Client({
      host: process.env.NEW_CRM_DB_HOST, port: parseInt(process.env.NEW_CRM_DB_PORT || '5432'),
      database: process.env.NEW_CRM_DB_NAME, user: process.env.NEW_CRM_DB_USER, password: process.env.NEW_CRM_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
    })
    await client.connect()
    const { rows: crm } = await client.query(`SELECT name FROM "Branch" WHERE name IS NOT NULL AND btrim(name) <> ''`)
    await client.end(); client = null
    const valid = [...new Set(crm.map(b => aliasBranchName(b.name)).filter(Boolean))]

    // 2) Which of those aren't in the master yet.
    const { data: existing, error: exErr } = await supabase
      .from('branches').select('name, region, state, model_type, branch_code')
    if (exErr) return Response.json({ success: false, error: exErr.message }, { status: 500 })
    const have = new Set((existing || []).map(b => b.name))
    const candidates = valid.filter(n => !have.has(n) && n.length >= 3 && !IGNORE_NAMES.has(n.toUpperCase()))
    if (!candidates.length) return Response.json({ success: true, added: 0, message: 'All CRM branches already in master' })

    // 3) Only add the ones that have actually purchased (the trigger).
    const toAdd = []
    for (const name of candidates) {
      const { count } = await supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('branch_name', name)
      if (count && count > 0) toAdd.push(name)
    }
    if (!toAdd.length) return Response.json({ success: true, added: 0, message: 'No new purchasing branches' })

    // 4) Derive fields from same-prefix peers + insert.
    const used = new Set((existing || []).map(b => b.branch_code).filter(Boolean))
    const today = new Date().toISOString().split('T')[0]
    const rows = toAdd.map(name => {
      const f = deriveBranchFields(name, existing || [])
      const code = autoBranchCode(name, used); used.add(code)
      return { name, region: f.region, state: f.state, model_type: f.model_type, branch_code: code, is_active: true, opening_date: today }
    })
    const { error: insErr } = await supabase.from('branches').insert(rows)
    if (insErr) return Response.json({ success: false, error: insErr.message }, { status: 500 })

    return Response.json({ success: true, added: rows.length, branches: toAdd })
  } catch (err) {
    console.error('[sync-branches-auto] error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (client) { try { await client.end() } catch {} }
  }
}
