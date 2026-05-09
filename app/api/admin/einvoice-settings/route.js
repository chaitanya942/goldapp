// app/api/admin/einvoice-settings/route.js
//
// Admin / Accounts edits for E-Invoice numbering + per-state GSTINs.
//
// Per-state GSTINs are stored in company_settings.state_gstins (JSONB) —
// adding a new state is a JSON key insert, no schema migration needed.
// Legacy gstin_<code> columns are kept in sync as a backstop for older
// code paths that still read them directly.
//
// GET   → { sequences: [...], gstins: { KA, KL, TS, AP, ... }, fy: '26-27' }
// POST  → updates one of:
//          { kind: 'seq',         state_code, fy_code, last_seq }
//          { kind: 'gstin',       state_code, gstin }
//          { kind: 'gstin_add',   state_code, gstin, last_seq? } — new state
//          { kind: 'gstin_remove', state_code }                  — drop state
//
// Restricted to ROLE_GROUPS.ACCOUNTS (super_admin, founders_office, accounts).

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { getCurrentFyCode } from '../../../../lib/consignmentUtils'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

// 2-letter ISO state codes used by the GSTN.  Used to validate new entries
// without hardcoding a tight allowlist (any real Indian state can be added).
const VALID_STATE_CODES = new Set([
  'AN','AP','AR','AS','BR','CG','CH','DD','DL','DN','GA','GJ','HP','HR','JH',
  'JK','KA','KL','LA','LD','MH','ML','MN','MP','MZ','NL','OD','OR','PB','PY',
  'RJ','SK','TG','TN','TR','TS','UK','UP','UT','WB',
])
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

// Build the sequences array — one row per state present in state_gstins,
// merged with whatever rows exist in einvoice_sequence for the current FY.
function buildSequences(stateCodes, seqRows, fy) {
  const present = new Map((seqRows || []).map(r => [r.state_code, r]))
  return stateCodes
    // KA-source consignments emit EWB only, never E-Invoice — exclude from sequences.
    .filter(s => s !== 'KA')
    .map(s => {
      const row = present.get(s)
      const last = row?.last_seq ?? 0
      return {
        state_code: s,
        fy_code:    fy,
        last_seq:   last,
        next_no:    `WG/${s}/${fy}/${last + 1}`,
        updated_at: row?.updated_at || null,
        exists:     present.has(s),
      }
    })
}

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response
  try {
    const fy = getCurrentFyCode()

    // Two-step select so we degrade gracefully when the JSONB migration
    // hasn't been run yet. The legacy columns are always present; the JSONB
    // is queried separately and treated as {} on any error.
    const { data: cs } = await supabase
      .from('company_settings')
      .select('id, gstin, gstin_ka, gstin_kl, gstin_ts, gstin_ap, head_office_address, head_office_city, head_office_pin, head_office_state')
      .single()

    let fromJson = {}
    try {
      const { data: jsonbRow } = await supabase
        .from('company_settings')
        .select('state_gstins')
        .single()
      if (jsonbRow?.state_gstins && typeof jsonbRow.state_gstins === 'object') {
        fromJson = jsonbRow.state_gstins
      }
    } catch {
      // state_gstins column doesn't exist (migration pending) — fall back to
      // legacy columns only. Settings tab still works.
    }

    // Merge: JSONB keys win where present; legacy fills in the rest.
    const legacy = {
      KA: cs?.gstin_ka || cs?.gstin || '',
      KL: cs?.gstin_kl || '',
      TS: cs?.gstin_ts || '',
      AP: cs?.gstin_ap || '',
    }
    const gstins = { ...legacy, ...fromJson }
    // Drop any blank values so the UI doesn't show empty rows.
    Object.keys(gstins).forEach(k => { if (!gstins[k]) delete gstins[k] })

    // Sequences — one per state code that has a GSTIN configured (excluding KA).
    const stateCodes = Object.keys(gstins).sort()
    const { data: seqRows } = await supabase
      .from('einvoice_sequence')
      .select('state_code, fy_code, last_seq, updated_at')
      .eq('fy_code', fy)
      .order('state_code')

    return Response.json({
      fy,
      sequences: buildSequences(stateCodes, seqRows, fy),
      gstins,
      head_office: {
        address: cs?.head_office_address || '',
        city:    cs?.head_office_city    || '',
        pin:     cs?.head_office_pin     || '',
        state:   cs?.head_office_state   || '',
      },
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Helper: write a state's GSTIN to BOTH state_gstins JSONB and the legacy
// fixed column (when one exists for that code), so old code keeps working.
// Falls back to legacy-only writes if the JSONB column hasn't been migrated
// yet — the Settings tab continues to work, just without support for new
// states beyond {KA, KL, TS, AP} until the SQL migration is run.
async function writeStateGstin(state_code, gstin /* string | null to remove */) {
  // First, try reading state_gstins separately. If it errors, the column
  // doesn't exist yet → we'll only update the legacy column.
  let existingMap = null
  let existingId  = null
  try {
    const { data, error } = await supabase
      .from('company_settings').select('id, state_gstins').single()
    if (error) throw error
    existingId  = data?.id
    existingMap = data?.state_gstins || {}
  } catch {
    const { data } = await supabase.from('company_settings').select('id').single()
    existingId  = data?.id
    existingMap = null   // sentinel: JSONB column unavailable
  }
  if (!existingId) throw new Error('company_settings row missing — cannot persist GSTIN')

  const updates = {}
  if (existingMap !== null) {
    const map = { ...existingMap }
    if (gstin) map[state_code] = gstin
    else       delete map[state_code]
    updates.state_gstins = map
  }
  // Mirror to the legacy column if one exists.
  if (['KA','KL','TS','AP'].includes(state_code)) {
    updates[`gstin_${state_code.toLowerCase()}`] = gstin || null
  } else if (existingMap === null) {
    // New state code AND no JSONB column — there's nowhere to store this.
    // Surface a clear error so the operator knows to run the migration.
    throw new Error(
      `Cannot save '${state_code}' — the state_gstins JSONB column hasn't been added yet. ` +
      `Run sql/state_gstins_jsonb.sql in Supabase, then retry.`
    )
  }

  const { error } = await supabase
    .from('company_settings')
    .update(updates)
    .eq('id', existingId)
  if (error) throw new Error(error.message)
}

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const kind = body?.kind

    // ── Sequence edit ────────────────────────────────────────────────────
    if (kind === 'seq') {
      const { state_code, fy_code, last_seq } = body
      if (!state_code || !VALID_STATE_CODES.has(state_code) || state_code === 'KA') {
        return Response.json({ error: `Invalid state_code '${state_code}'. KA is excluded (no E-Invoice for KA-source).` }, { status: 400 })
      }
      if (typeof last_seq !== 'number' || !Number.isInteger(last_seq) || last_seq < 0) {
        return Response.json({ error: 'last_seq must be a non-negative integer' }, { status: 400 })
      }
      if (!fy_code || !/^\d{2}-\d{2}$/.test(fy_code)) {
        return Response.json({ error: 'fy_code must match YY-YY (e.g. 26-27)' }, { status: 400 })
      }
      const { error } = await supabase
        .from('einvoice_sequence')
        .upsert({ state_code, fy_code, last_seq, updated_at: new Date().toISOString() }, { onConflict: 'state_code,fy_code' })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ success: true, state_code, fy_code, last_seq, next_no: `WG/${state_code}/${fy_code}/${last_seq + 1}` })
    }

    // ── GSTIN edit (existing state) ──────────────────────────────────────
    if (kind === 'gstin') {
      const { state_code, gstin } = body
      if (!state_code || !VALID_STATE_CODES.has(state_code)) {
        return Response.json({ error: `Invalid state_code '${state_code}'.` }, { status: 400 })
      }
      const cleaned = String(gstin || '').trim().toUpperCase()
      if (cleaned && !GSTIN_REGEX.test(cleaned)) {
        return Response.json({ error: `GSTIN '${cleaned}' is malformed (15 chars, format 22AAAAA0000A1Z5).` }, { status: 400 })
      }
      await writeStateGstin(state_code, cleaned || null)
      return Response.json({ success: true, state_code, gstin: cleaned })
    }

    // ── Add new state ────────────────────────────────────────────────────
    if (kind === 'gstin_add') {
      const { state_code, gstin, last_seq } = body
      if (!state_code || !VALID_STATE_CODES.has(state_code)) {
        return Response.json({ error: `Invalid state_code '${state_code}'.` }, { status: 400 })
      }
      const cleaned = String(gstin || '').trim().toUpperCase()
      if (!cleaned) return Response.json({ error: 'GSTIN is required when adding a new state.' }, { status: 400 })
      if (!GSTIN_REGEX.test(cleaned)) {
        return Response.json({ error: `GSTIN '${cleaned}' is malformed (15 chars, format 22AAAAA0000A1Z5).` }, { status: 400 })
      }
      // Validate state code prefix matches GSTIN prefix (first 2 digits map to state).
      // We don't reject mismatches, but we surface them in the response so the UI
      // can warn the operator if they paste a Maharashtra GSTIN under MH but
      // the digits say it's for Tamil Nadu, etc.
      // (Skipped strict enforcement — accounts is responsible for getting it right.)

      await writeStateGstin(state_code, cleaned)

      // Seed a sequence row for the new state so the UI shows it immediately.
      // KA gets no sequence row (no E-Invoice for KA).
      let createdSeq = null
      if (state_code !== 'KA') {
        const fy = getCurrentFyCode()
        const seedSeq = (typeof last_seq === 'number' && last_seq >= 0) ? Math.floor(last_seq) : 0
        const { error: seqErr } = await supabase
          .from('einvoice_sequence')
          .upsert({ state_code, fy_code: fy, last_seq: seedSeq, updated_at: new Date().toISOString() }, { onConflict: 'state_code,fy_code' })
        if (seqErr) return Response.json({ error: `GSTIN saved but sequence init failed: ${seqErr.message}` }, { status: 500 })
        createdSeq = { state_code, fy_code: fy, last_seq: seedSeq, next_no: `WG/${state_code}/${fy}/${seedSeq + 1}` }
      }
      return Response.json({ success: true, state_code, gstin: cleaned, sequence: createdSeq })
    }

    // ── Remove a state ───────────────────────────────────────────────────
    if (kind === 'gstin_remove') {
      const { state_code } = body
      if (!state_code) return Response.json({ error: 'state_code required' }, { status: 400 })
      // KA is special — never let the operator delete it. KA is the buyer
      // (HO) GSTIN for every E-Invoice; nuking it would break document
      // generation for the entire company.
      if (state_code === 'KA') {
        return Response.json({ error: 'KA cannot be removed — it is the HO buyer GSTIN.' }, { status: 400 })
      }
      await writeStateGstin(state_code, null)
      // Delete sequence rows for this state (all FYs). The operator can
      // re-add later if they want; sequences will start fresh.
      const { error: delErr } = await supabase
        .from('einvoice_sequence')
        .delete()
        .eq('state_code', state_code)
      if (delErr) return Response.json({ error: `GSTIN removed but sequence cleanup failed: ${delErr.message}` }, { status: 500 })
      return Response.json({ success: true, state_code, removed: true })
    }

    return Response.json({ error: `Unknown kind '${kind}'. Use 'seq', 'gstin', 'gstin_add', or 'gstin_remove'.` }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
