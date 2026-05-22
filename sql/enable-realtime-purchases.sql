-- Enable Supabase Realtime on the `purchases` table.
-- Run once in the Supabase SQL editor. Without this the Master Purchase Data
-- "New data synced — refresh" nudge will never fire (the subscription stays
-- silent because the table isn't published).

alter publication supabase_realtime add table purchases;
