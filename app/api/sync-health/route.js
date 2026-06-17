// GET /api/sync-health — reports each sync's freshness from the sync_status
// heartbeat table. A sync is "stale" if its last successful run is older than
// STALE_MINUTES (or it has never recorded a success). The super-admin in-app
// notifier polls this and alerts when anyStale is true.
//
// Auth: ADMIN group can read it; the client notifier further restricts the
// ALERT to super_admin only.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
)

const STALE_MINUTES = 10
// Syncs we expect to be running continuously. A row that never appears here
// (e.g. the worker has never run since deploy) is reported as missing+stale.
const EXPECTED = [
  { name: 'new_crm', label: 'New CRM sync' },
  { name: 'old_crm', label: 'Old CRM sync' },
]

export async function GET(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const { data, error } = await supabase
    .from('sync_status')
    .select('sync_name, last_success_at, last_attempt_at, last_error, last_count')
  if (error) {
    // Table missing / unreadable — report unknown rather than 500 so the
    // notifier degrades gracefully (shows nothing) until the table exists.
    return Response.json({ syncs: [], stale: [], anyStale: false, threshold_min: STALE_MINUTES, unavailable: true })
  }

  const byName = Object.fromEntries((data || []).map(r => [r.sync_name, r]))
  const now = Date.now()
  const syncs = EXPECTED.map(({ name, label }) => {
    const r = byName[name]
    const ts = r?.last_success_at ? new Date(r.last_success_at).getTime() : null
    const ageMin = ts ? Math.round((now - ts) / 60000) : null
    return {
      name, label,
      last_success_at: r?.last_success_at || null,
      last_error:      r?.last_error || null,
      last_count:      r?.last_count ?? null,
      age_minutes:     ageMin,
      stale:           ageMin == null || ageMin > STALE_MINUTES,
    }
  })
  const stale = syncs.filter(s => s.stale)
  return Response.json({ syncs, stale, anyStale: stale.length > 0, threshold_min: STALE_MINUTES })
}
