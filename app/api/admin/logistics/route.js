// app/api/admin/logistics/route.js
//
// Admin-only logistics configuration per branch.
//
// GET  → all outstation branches (region != 'Bangalore') with their logistics
//        fields, plus the running-stats per branch (last pickup at HO, etc.).
// POST → update one branch's logistics config.
//        Body: { kind: 'update', branch_name, partner, pickup_time,
//                delivery_tat_hours, pickup_days, contact_name, contact_phone, notes }
//
// Gated by the SAME permission as the Logistics page (page.logistics)
// rather than a hardcoded role group — so whichever role ops grants the
// page to (custom roles included) can actually read/write it. Previously
// hardcoded to ROLE_GROUPS.ADMIN; non-admin users with page.logistics
// granted via Role Management would see the page but get 403 from the
// API and an empty table.

import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const ALLOWED_TAT  = new Set([24, 48, 72])
const VALID_DAYS   = new Set(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
const HHMM_REGEX   = /^([01]?\d|2[0-3]):[0-5]\d$/

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'logistics')
  if (!auth.ok) return auth.response
  try {
    const { data: branches, error } = await supabase
      .from('branches')
      .select('id, name, region, state, is_hub, is_active, pickup_time, logistics_partner, delivery_tat_hours, pickup_days, logistics_contact_name, logistics_contact_phone, logistics_notes')
      .eq('is_active', true)
      .neq('region', 'Bangalore')
      .order('region')
      .order('name')
    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ branches: branches || [] })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  const auth = await requireAuthForPage(req, 'logistics')
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const kind = body?.kind

    // ── kind: 'seed_bvc_schedule' ────────────────────────────────────────────
    // One-click apply the BVC partner schedule (partner + pickup time + TAT +
    // days) to the 36 branches BVC currently services. Branches not in the
    // table stay untouched. KOLAR has no published pickup time in the BVC
    // schedule, so its existing pickup_time is preserved.
    if (kind === 'seed_bvc_schedule') {
      const DAY_GROUPS = {
        daily: ['Mon','Tue','Wed','Thu','Fri','Sat'],   // Mon-Sat, Sundays off
        mwf:   ['Mon','Wed','Fri'],
        ts:    ['Tue','Sat'],
        tts:   ['Tue','Thu','Sat'],
      }

      const SCHEDULE = [
        // ─── Karnataka ─────────────────────────────────────────────
        { name: 'MYSURU',                 time: '16:00', tat: 24, days: 'daily' },
        { name: 'TUMKUR',                 time: '15:00', tat: 24, days: 'daily' },
        { name: 'HASSAN',                 time: '15:00', tat: 24, days: 'daily' },
        { name: 'MANGALORE',              time: '14:00', tat: 24, days: 'daily' },
        { name: 'CHIKMAGALURU',           time: '14:00', tat: 24, days: 'daily' },
        { name: 'DAVANAGERE',             time: '11:00', tat: 24, days: 'daily' },
        { name: 'SHIVAMOGGA',             time: '11:00', tat: 24, days: 'daily' },
        { name: 'HUBLI',                  time: '17:00', tat: 48, days: 'daily' },
        { name: 'UDUPI',                  time: '14:00', tat: 24, days: 'daily' },
        { name: 'DEVANAHALLI',            time: '15:00', tat: 24, days: 'daily' },
        { name: 'MANDYA',                 time: '17:00', tat: 24, days: 'daily' },
        { name: 'KOLAR',                  time: null,    tat: 24, days: 'mwf' },
        { name: 'CHITRADURGA',            time: '12:00', tat: 24, days: 'daily' },
        { name: 'HOSPETE',                time: '11:00', tat: 48, days: 'ts' },
        { name: 'VIJAYAPURA',             time: '11:00', tat: 48, days: 'mwf' },
        { name: 'BELAGAVI',               time: '16:00', tat: 48, days: 'daily' },
        // ─── Andhra Pradesh ────────────────────────────────────────
        { name: 'AP-KAKINADA',            time: '13:00', tat: 48, days: 'daily' },
        { name: 'AP-GAJUWAKA',            time: '15:00', tat: 24, days: 'daily' },
        { name: 'AP-VIJAYAWADA',          time: '17:00', tat: 24, days: 'daily' },
        { name: 'AP-GUNTUR',              time: '15:00', tat: 24, days: 'daily' },
        { name: 'AP-TIRUPATHI',           time: '15:00', tat: 24, days: 'daily' },
        { name: 'AP-RAJAMAHENDRAVARAM',   time: '13:00', tat: 24, days: 'tts' },
        { name: 'AP-NAD',                 time: '16:00', tat: 24, days: 'daily' },
        { name: 'AP-RAMATALKIES',         time: '16:00', tat: 24, days: 'daily' },
        { name: 'AP-NELLORE',             time: '16:00', tat: 24, days: 'daily' },
        { name: 'AP-ONGOLE',              time: '13:00', tat: 48, days: 'daily' },
        { name: 'AP-ANANTAPUR',           time: '17:00', tat: 24, days: 'mwf' },
        { name: 'AP-KURNOOL',             time: '16:00', tat: 48, days: 'tts' },
        // ─── Telangana — all identical (5-6pm, NEXT DAY, daily) ────
        { name: 'TS-CHANDA NAGAR',        time: '17:00', tat: 24, days: 'daily' },
        { name: 'TS-KUKATPALLY',          time: '17:00', tat: 24, days: 'daily' },
        { name: 'TS-AS RAO NAGAR',        time: '17:00', tat: 24, days: 'daily' },
        { name: 'TS-PANJAGUTTA',          time: '17:00', tat: 24, days: 'daily' },
        { name: 'TS-DILSUKH NAGAR',       time: '17:00', tat: 24, days: 'daily' },
        { name: 'TS-HIMAYAT NAGAR',       time: '17:00', tat: 24, days: 'daily' },
        { name: 'TS-TOLI CHOWKI',         time: '17:00', tat: 24, days: 'daily' },
        { name: 'TS-LB NAGAR',            time: '17:00', tat: 24, days: 'daily' },
      ]

      // Group rows that share the exact same patch so we apply the table in
      // ~8 bulk updates instead of 36 individual ones.
      const buckets = new Map()
      for (const row of SCHEDULE) {
        // KOLAR (no pickup time) goes into its own bucket without pickup_time —
        // we don't want to null out an existing value.
        const includesTime = row.time != null
        const key = `${includesTime ? row.time : 'X'}|${row.tat}|${row.days}`
        if (!buckets.has(key)) {
          buckets.set(key, { time: row.time, includesTime, tat: row.tat, days: row.days, names: [] })
        }
        buckets.get(key).names.push(row.name)
      }

      const errors = []
      let updatedTotal = 0
      for (const [, group] of buckets) {
        const patch = {
          logistics_partner:  'BVC',
          delivery_tat_hours: group.tat,
          pickup_days:        DAY_GROUPS[group.days],
        }
        if (group.includesTime) patch.pickup_time = group.time
        const { data, error } = await supabase
          .from('branches')
          .update(patch)
          .in('name', group.names)
          .select('name')
        if (error) {
          errors.push({ message: error.message, names: group.names })
          continue
        }
        updatedTotal += (data || []).length
      }

      // Re-fetch the updated branches so the client can patch local state.
      const { data: rows } = await supabase
        .from('branches')
        .select('id, name, region, state, is_hub, is_active, pickup_time, logistics_partner, delivery_tat_hours, pickup_days, logistics_contact_name, logistics_contact_phone, logistics_notes')
        .in('name', SCHEDULE.map(r => r.name))

      return Response.json({
        success: errors.length === 0,
        updated_count: updatedTotal,
        requested_count: SCHEDULE.length,
        branches: rows || [],
        errors: errors.length ? errors : undefined,
      })
    }

    if (kind !== 'update' && kind !== 'bulk_update') {
      return Response.json({ error: `Unknown kind '${kind}'. Use 'update', 'bulk_update', or 'seed_bvc_schedule'.` }, { status: 400 })
    }

    const { branch_name, branch_names, partner, pickup_time, delivery_tat_hours, pickup_days, contact_name, contact_phone, notes } = body

    if (kind === 'update') {
      if (!branch_name) return Response.json({ error: 'branch_name required' }, { status: 400 })
    }
    if (kind === 'bulk_update') {
      if (!Array.isArray(branch_names) || branch_names.length === 0) {
        return Response.json({ error: 'branch_names array required' }, { status: 400 })
      }
    }

    // Build the update object — only keys that were explicitly sent are
    // included, so the caller can patch a single field without nulling the
    // rest. Pass an empty string to clear a text field.
    const updates = {}

    if (partner !== undefined) {
      const cleaned = String(partner || '').trim()
      if (cleaned.length > 60) return Response.json({ error: 'partner too long (max 60 chars)' }, { status: 400 })
      updates.logistics_partner = cleaned || null
    }

    if (pickup_time !== undefined) {
      const cleaned = String(pickup_time || '').trim()
      if (cleaned && !HHMM_REGEX.test(cleaned)) {
        return Response.json({ error: `pickup_time '${cleaned}' must be HH:MM (24h)` }, { status: 400 })
      }
      updates.pickup_time = cleaned || null
    }

    if (delivery_tat_hours !== undefined) {
      if (delivery_tat_hours == null || delivery_tat_hours === '') {
        updates.delivery_tat_hours = null
      } else {
        const n = parseInt(delivery_tat_hours)
        if (!ALLOWED_TAT.has(n)) {
          return Response.json({ error: `delivery_tat_hours must be 24, 48, or 72 (got '${delivery_tat_hours}')` }, { status: 400 })
        }
        updates.delivery_tat_hours = n
      }
    }

    if (pickup_days !== undefined) {
      if (!Array.isArray(pickup_days)) {
        return Response.json({ error: 'pickup_days must be an array' }, { status: 400 })
      }
      const invalid = pickup_days.find(d => !VALID_DAYS.has(d))
      if (invalid) {
        return Response.json({ error: `Invalid day '${invalid}'. Use Mon/Tue/Wed/Thu/Fri/Sat/Sun.` }, { status: 400 })
      }
      // De-dup + canonical order so the DB row is consistent.
      const order = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
      const set = new Set(pickup_days)
      updates.pickup_days = order.filter(d => set.has(d))
    }

    if (contact_name  !== undefined) updates.logistics_contact_name  = String(contact_name  || '').trim() || null
    if (contact_phone !== undefined) updates.logistics_contact_phone = String(contact_phone || '').trim() || null
    if (notes         !== undefined) updates.logistics_notes         = String(notes         || '').trim() || null

    if (!Object.keys(updates).length) {
      return Response.json({ error: 'no fields to update' }, { status: 400 })
    }

    if (kind === 'bulk_update') {
      const { data, error } = await supabase
        .from('branches')
        .update(updates)
        .in('name', branch_names)
        .select()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({
        success: true,
        branches: data || [],
        updated_count: (data || []).length,
        requested_count: branch_names.length,
      })
    }

    const { data, error } = await supabase
      .from('branches')
      .update(updates)
      .eq('name', branch_name)
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!data)  return Response.json({ error: `Branch '${branch_name}' not found` }, { status: 404 })

    return Response.json({ success: true, branch: data })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
