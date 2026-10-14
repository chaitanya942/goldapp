-- Jarvis group footfall: group_count from store-wise-visitor-daily (people
-- entering together counted as one group). NULL = Jarvis didn't report it.
-- Idempotent: safe to re-run in the Supabase SQL editor.
ALTER TABLE jarvis_footfall ADD COLUMN IF NOT EXISTS group_count INTEGER;
