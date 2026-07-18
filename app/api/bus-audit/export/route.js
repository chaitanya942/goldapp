// app/api/bus-audit/export/route.js
// CSV of the audit for reporting — every bus with its status, who audited it,
// when, and exactly where (coords + resolved address + whether that location
// matched the bus's own city). Admin-only: it carries auditor names and
// locations, same sensitivity as /list.
//
//   /api/bus-audit/export              -> all 3,600
//   /api/bus-audit/export?status=audited

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '@/lib/apiAuth'

export const runtime = 'nodejs'
export const maxDuration = 60

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// RFC4180: quote everything and double any embedded quotes. Addresses contain
// commas, and a leading =/+/-/@ would be executed as a formula by Excel.
const cell = (v) => {
  if (v === null || v === undefined) return '""'
  let s = String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

const COLUMNS = [
  ['reg_number', 'Bus Number'], ['region', 'City'], ['depot', 'Depot'], ['route', 'Bus Type'],
  ['ad_type', 'Ad Type'], ['mounting_date', 'Mounting Date'],
  ['status', 'Status'], ['photo_count', 'Photos'],
  ['first_audited_at', 'Audited At'], ['audited_by_name', 'Audited By'],
  ['audit_address', 'Audit Location'], ['audit_lat', 'Latitude'], ['audit_lng', 'Longitude'],
  ['audit_city', 'Audit City'], ['location_status', 'Location Check'],
]

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const status = new URL(req.url).searchParams.get('status') || ''

  // Page through — 3,600 rows exceeds PostgREST's max_rows in one shot.
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = admin.from('bus_audit_buses').select(COLUMNS.map(c => c[0]).join(','))
    if (status === 'audited' || status === 'pending') q = q.eq('status', status)
    const { data, error } = await q.order('region', { nullsFirst: false }).order('reg_norm').range(from, from + PAGE - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }

  const csv = [
    COLUMNS.map(c => cell(c[1])).join(','),
    ...rows.map(r => COLUMNS.map(c => cell(r[c[0]])).join(',')),
  ].join('\r\n')

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response('﻿' + csv, {   // BOM so Excel reads UTF-8 correctly
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bus-audit-${status || 'all'}-${stamp}.csv"`,
    },
  })
}
