// app/api/admin/einvoice-settings/route.js
//
// Admin / Accounts edits for E-Invoice numbering + per-state GSTINs.
//
// GET  → { sequences: [...], gstins: { ka, kl, ts, ap }, fy: '26-27' }
// POST → updates a single sequence row OR a single state's GSTIN.
//        Body: { kind: 'seq', state_code, fy_code, last_seq } | { kind: 'gstin', state_code, gstin }
//
// Restricted to ROLE_GROUPS.ACCOUNTS (super_admin, founders_office, accounts).

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'
import { getCurrentFyCode } from '../../../../lib/consignmentUtils'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const ALLOWED_STATES = new Set(['KA', 'KL', 'TS', 'AP'])

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response
  try {
    const fy = getCurrentFyCode()

    // Sequences for current FY only — older FYs aren't editable here (audit).
    const { data: seqRows, error: seqErr } = await supabase
      .from('einvoice_sequence')
      .select('state_code, fy_code, last_seq, updated_at')
      .eq('fy_code', fy)
      .order('state_code')
    if (seqErr) return Response.json({ error: seqErr.message }, { status: 500 })

    // Make sure KL/TS/AP rows exist (so the UI doesn't show an empty list
    // before the first generation). KA is excluded — KA-source consignments
    // get EWB, never E-Invoice.
    const present = new Set((seqRows || []).map(r => r.state_code))
    const sequences = ['KL', 'TS', 'AP'].map(s => {
      const row = (seqRows || []).find(r => r.state_code === s)
      return {
        state_code: s,
        fy_code:    fy,
        last_seq:   row?.last_seq ?? 0,
        next_no:    `WG/${s}/${fy}/${(row?.last_seq ?? 0) + 1}`,
        updated_at: row?.updated_at || null,
        exists:     present.has(s),
      }
    })

    const { data: cs } = await supabase
      .from('company_settings')
      .select('gstin, gstin_ka, gstin_kl, gstin_ts, gstin_ap, head_office_address, head_office_city, head_office_pin, head_office_state')
      .single()

    return Response.json({
      fy,
      sequences,
      gstins: {
        KA: cs?.gstin_ka || cs?.gstin || '',
        KL: cs?.gstin_kl || '',
        TS: cs?.gstin_ts || '',
        AP: cs?.gstin_ap || '',
      },
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

export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ACCOUNTS })
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const kind = body?.kind

    // ── Sequence edit ────────────────────────────────────────────────────
    if (kind === 'seq') {
      const { state_code, fy_code, last_seq } = body
      if (!ALLOWED_STATES.has(state_code) || state_code === 'KA') {
        return Response.json({ error: `Invalid state_code '${state_code}'. Allowed: KL, TS, AP.` }, { status: 400 })
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

    // ── GSTIN edit ───────────────────────────────────────────────────────
    if (kind === 'gstin') {
      const { state_code, gstin } = body
      if (!ALLOWED_STATES.has(state_code)) {
        return Response.json({ error: `Invalid state_code '${state_code}'. Allowed: KA, KL, TS, AP.` }, { status: 400 })
      }
      const cleaned = String(gstin || '').trim().toUpperCase()
      if (cleaned && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(cleaned)) {
        return Response.json({ error: `GSTIN '${cleaned}' is malformed (15 chars, format 22AAAAA0000A1Z5).` }, { status: 400 })
      }
      const fieldName = `gstin_${state_code.toLowerCase()}`
      // Upsert into the singleton company_settings row.
      const { data: existing } = await supabase.from('company_settings').select('id').single()
      if (!existing) {
        return Response.json({ error: 'company_settings row missing — cannot update GSTIN' }, { status: 500 })
      }
      const { error } = await supabase
        .from('company_settings')
        .update({ [fieldName]: cleaned || null })
        .eq('id', existing.id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ success: true, state_code, gstin: cleaned })
    }

    return Response.json({ error: `Unknown kind '${kind}'. Use 'seq' or 'gstin'.` }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
