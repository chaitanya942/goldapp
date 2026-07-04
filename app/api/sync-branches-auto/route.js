// Auto-add branches to the master when they start purchasing + backfill branch
// addresses from the NEW CRM. Runs once a day from the cron worker
// (maybeSyncBranches in scripts/cron-sync.mjs). A branch appears in Branch
// Management the first day it has a purchase, and its address/pin/city/GSTIN
// self-populate from the CRM (blanks only — a manually-verified address is
// never overwritten). Replaces the retired old-CRM sync + Google auto-resolve.
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
    const { rows: crm } = await client.query(`SELECT name, address, city, pin, gstin FROM "Branch" WHERE name IS NOT NULL AND btrim(name) <> ''`)
    await client.end(); client = null

    // 6-digit PIN from the pin column, else scraped from the address string.
    const pinOf = (b) => (b?.pin && String(b.pin).trim()) || (String(b?.address || '').match(/\b(\d{6})\b/) || [])[1] || null
    // canonical (aliased) name → best CRM row (prefer one carrying an address).
    const crmByName = {}
    for (const b of crm) {
      const canon = aliasBranchName(b.name); if (!canon) continue
      const cur = crmByName[canon]
      const hasAddr = !!(b.address && b.address.trim())
      if (!cur || (hasAddr && !(cur.address && cur.address.trim()))) crmByName[canon] = b
    }
    const valid = Object.keys(crmByName)

    // 2) Existing master (with address fields so we know what's blank / verified).
    const { data: existing, error: exErr } = await supabase
      .from('branches').select('name, region, state, model_type, branch_code, cluster, address, city, pin_code, branch_gstin, address_verified')
    if (exErr) return Response.json({ success: false, error: exErr.message }, { status: 500 })
    const have = new Set((existing || []).map(b => b.name))

    // 3) New branches = valid CRM not in master, that have started purchasing.
    const candidates = valid.filter(n => !have.has(n) && n.length >= 3 && !IGNORE_NAMES.has(n.toUpperCase()))
    const toAdd = []
    for (const name of candidates) {
      const { count } = await supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('branch_name', name)
      if (count && count > 0) toAdd.push(name)
    }

    // 4) Insert new branches — derived fields + CRM address if present.
    let added = 0
    if (toAdd.length) {
      const used = new Set((existing || []).map(b => b.branch_code).filter(Boolean))
      const today = new Date().toISOString().split('T')[0]
      const rows = toAdd.map(name => {
        const f = deriveBranchFields(name, existing || [])
        const code = autoBranchCode(name, used); used.add(code)
        const src = crmByName[name] || {}
        const row = { name, region: f.region, state: f.state, model_type: f.model_type, cluster: f.cluster, branch_code: code, is_active: true, opening_date: today }
        const addr = (src.address || '').trim(), city = (src.city || '').trim(), pin = pinOf(src), gstin = (src.gstin || '').trim()
        if (addr)  { row.address = addr; row.address_source = 'new_crm' }
        if (pin)   row.pin_code = pin
        if (city)  row.city = city
        if (gstin) row.branch_gstin = gstin
        return row
      })
      const { error: insErr } = await supabase.from('branches').insert(rows)
      if (insErr) return Response.json({ success: false, error: insErr.message }, { status: 500 })
      added = rows.length
    }

    // 5) Backfill addresses from CRM into existing branches — blanks only, and
    //    never touch a manually-verified address (address_verified = true).
    let addressesFilled = 0
    for (const b of (existing || [])) {
      if (b.address_verified) continue
      const src = crmByName[b.name]; if (!src) continue
      const patch = {}
      const addr = (src.address || '').trim(), city = (src.city || '').trim(), pin = pinOf(src), gstin = (src.gstin || '').trim()
      if (addr  && !(b.address && b.address.trim())) patch.address = addr
      if (city  && !(b.city && b.city.trim()))       patch.city = city
      if (pin   && !b.pin_code)                      patch.pin_code = pin
      if (gstin && !b.branch_gstin)                  patch.branch_gstin = gstin
      if (Object.keys(patch).length) {
        patch.address_source = 'new_crm'
        const { error } = await supabase.from('branches').update(patch).eq('name', b.name)
        if (!error) addressesFilled++
      }
    }

    return Response.json({ success: true, added, branches: toAdd, addresses_filled: addressesFilled })
  } catch (err) {
    console.error('[sync-branches-auto] error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  } finally {
    if (client) { try { await client.end() } catch {} }
  }
}
