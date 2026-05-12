-- One-off backfill: convert legacy *_cancel_skipped audit rows to their
-- canonical *_cancelled counterparts.
--
-- Context: an interim soft-success implementation logged audit events as
-- `einvoice_cancel_skipped` / `ewb_cancel_skipped` when NIC returned 107
-- (document not active at IRP/NIC) and we proceeded with local cleanup.
-- The Cancellations tab filters on the canonical *_cancelled types, so
-- those rows didn't surface. The current code path always writes the
-- canonical type with a `not_active_at_irp` / `not_active_at_nic` flag
-- in details — this UPDATE makes the DB match.
--
-- Idempotent. Safe to run multiple times.

UPDATE consignment_activity_log
SET
  event_type = 'einvoice_cancelled',
  details    = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
                 'not_active_at_irp', true,
                 'not_active_reason',
                   COALESCE(details->>'reason',
                            'IRP returned 107 (IRN not recognised) — treated as already cancelled upstream')
               )
WHERE event_type = 'einvoice_cancel_skipped';

UPDATE consignment_activity_log
SET
  event_type = 'ewb_cancelled',
  details    = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
                 'not_active_at_nic', true,
                 'not_active_reason',
                   COALESCE(details->>'reason',
                            'NIC returned 107 (EWB not recognised) — treated as already cancelled upstream')
               )
WHERE event_type = 'ewb_cancel_skipped';
