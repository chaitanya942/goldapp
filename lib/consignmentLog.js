// Helper to record consignment lifecycle events.
// Failures are logged but never block the calling flow — log table outage
// must not break consignment ops.

export async function logConsignmentEvent(supabase, { consignment_id, event_type, actor_email, actor_role, details }) {
  if (!consignment_id || !event_type) return
  try {
    await supabase.from('consignment_activity_log').insert({
      consignment_id,
      event_type,
      actor_email: actor_email || null,
      actor_role:  actor_role  || null,
      details:     details     || null,
    })
  } catch (err) {
    console.warn('[consignment-log] failed to record event:', event_type, err.message)
  }
}
