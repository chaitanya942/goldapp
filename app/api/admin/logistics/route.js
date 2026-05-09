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
// Restricted to ROLE_GROUPS.ADMIN (super_admin, founders_office, admin).

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const ALLOWED_TAT  = new Set([24, 48, 72])
const VALID_DAYS   = new Set(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
const HHMM_REGEX   = /^([01]?\d|2[0-3]):[0-5]\d$/

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
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
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const kind = body?.kind

    if (kind !== 'update') {
      return Response.json({ error: `Unknown kind '${kind}'. Use 'update'.` }, { status: 400 })
    }

    const { branch_name, partner, pickup_time, delivery_tat_hours, pickup_days, contact_name, contact_phone, notes } = body
    if (!branch_name) return Response.json({ error: 'branch_name required' }, { status: 400 })

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
