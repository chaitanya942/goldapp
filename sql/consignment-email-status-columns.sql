-- Real columns for the "Mail Sent" / "Delivery Failed" row status.
--
-- Why: the status was derived only from consignment_activity_log events
-- (documents_emailed / documents_email_bounced). Emailing docs therefore
-- changed NO row in the consignments table, so the realtime subscription
-- (which listens to `consignments` UPDATEs) never fired for OTHER users —
-- their screens kept showing "Email" until a manual refresh, even though the
-- sender saw "Mail Sent" instantly (their own client refetches on send).
--
-- Promoting these to real columns means send/bounce now UPDATE the consignments
-- row, the realtime UPDATE propagates, and every open screen flips itself
-- without a refresh. The activity-log events stay (audit / who-sent-when).

ALTER TABLE consignments
  ADD COLUMN IF NOT EXISTS documents_emailed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS documents_email_bounced_at  timestamptz;

-- Backfill from the existing event log so already-sent consignments keep their
-- status the moment the columns exist.
UPDATE consignments c
SET    documents_emailed_at = e.ts
FROM (
  SELECT consignment_id, MAX(created_at) AS ts
  FROM   consignment_activity_log
  WHERE  event_type = 'documents_emailed'
  GROUP  BY consignment_id
) e
WHERE e.consignment_id = c.id
  AND (c.documents_emailed_at IS NULL OR c.documents_emailed_at <> e.ts);

UPDATE consignments c
SET    documents_email_bounced_at = e.ts
FROM (
  SELECT consignment_id, MAX(created_at) AS ts
  FROM   consignment_activity_log
  WHERE  event_type = 'documents_email_bounced'
  GROUP  BY consignment_id
) e
WHERE e.consignment_id = c.id
  AND (c.documents_email_bounced_at IS NULL OR c.documents_email_bounced_at <> e.ts);
