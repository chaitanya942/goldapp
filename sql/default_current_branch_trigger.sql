-- Auto-default purchases.current_branch = branch_name on INSERT.
-- Important: trigger runs only on INSERT, not UPDATE — so existing transferred-in
-- bills (current_branch = hub) keep their hub assignment when the upsert sync
-- re-touches them (sync's upsert UPDATEs only the columns it explicitly sets,
-- and current_branch is not in the sync payload, so it stays as is).
-- Run once in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION set_default_current_branch()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_branch IS NULL THEN
    NEW.current_branch := NEW.branch_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchases_default_current_branch ON purchases;

CREATE TRIGGER trg_purchases_default_current_branch
BEFORE INSERT ON purchases
FOR EACH ROW EXECUTE FUNCTION set_default_current_branch();

-- Backfill any rows that slipped through before the trigger existed
UPDATE purchases SET current_branch = branch_name WHERE current_branch IS NULL;
