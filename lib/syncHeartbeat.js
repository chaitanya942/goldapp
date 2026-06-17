// Sync heartbeat — each sync worker stamps sync_status on completion so the
// /api/sync-health check (and the super-admin alert) can detect a stalled sync.
// All writes are best-effort: if the sync_status table doesn't exist yet, or
// the write fails, we swallow the error so heartbeat bookkeeping never breaks
// the sync itself.

export async function recordSyncSuccess(supabase, syncName, count = null) {
  try {
    const now = new Date().toISOString()
    await supabase.from('sync_status').upsert({
      sync_name:       syncName,
      last_success_at: now,
      last_attempt_at: now,
      last_error:      null,
      last_count:      count,
      updated_at:      now,
    }, { onConflict: 'sync_name' })
  } catch { /* non-fatal */ }
}

export async function recordSyncFailure(supabase, syncName, errorMessage) {
  try {
    const now = new Date().toISOString()
    // Only touch last_attempt_at + last_error — DON'T move last_success_at,
    // so staleness keeps climbing until a real success lands.
    await supabase.from('sync_status').upsert({
      sync_name:       syncName,
      last_attempt_at: now,
      last_error:      String(errorMessage || 'unknown').slice(0, 500),
      updated_at:      now,
    }, { onConflict: 'sync_name' })
  } catch { /* non-fatal */ }
}
