-- sql/heatmap_events.sql
--
-- Event store for the in-app heatmap viewer.
-- Receives click + scroll + page-view events from any tool's tracker snippet.
-- Aggregated server-side into a grid for the admin viewer.
--
-- Apply via Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS heatmap_events (
  id            BIGSERIAL PRIMARY KEY,
  project       TEXT NOT NULL,                  -- slug of the tool ('goldapp', 'treasury', etc.)
  session_id    TEXT NOT NULL,                  -- random per-page-load id (no PII)
  user_id       UUID,                           -- optional — if the tool identifies the user
  page_path     TEXT NOT NULL,                  -- e.g. '/dashboard'  (no query string, hash stripped)
  page_title    TEXT,                           -- optional — for nicer admin display
  event_type    TEXT NOT NULL,                  -- 'click' | 'scroll' | 'pageview'
  -- Coordinates as percentages (0..100) of viewport so we can render correctly across screen sizes.
  x_pct         NUMERIC(6, 3),
  y_pct         NUMERIC(6, 3),
  -- Raw absolute coords (for debugging / advanced overlays). px.
  x_px          INT,
  y_px          INT,
  scroll_y_pct  NUMERIC(6, 3),                  -- scroll depth at time of event
  viewport_w    INT,
  viewport_h    INT,
  device_class  TEXT,                           -- 'mobile' | 'tablet' | 'desktop' | 'desktop-wide'
  user_agent    TEXT,
  -- Tag of the clicked element (button / a / div / etc.) for interpretation
  el_tag        TEXT,
  el_text       TEXT,                           -- truncated to 50 chars; null when sensitive
  el_id         TEXT,
  el_class      TEXT,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the aggregate query: filter by project + page + date, then bin coordinates.
CREATE INDEX IF NOT EXISTS idx_heatmap_events_project_page_ts ON heatmap_events (project, page_path, ts DESC);
CREATE INDEX IF NOT EXISTS idx_heatmap_events_session         ON heatmap_events (session_id);
CREATE INDEX IF NOT EXISTS idx_heatmap_events_device          ON heatmap_events (device_class);

ALTER TABLE heatmap_events ENABLE ROW LEVEL SECURITY;

-- INSERTs come from the public ingest endpoint (which uses service_role; bypasses RLS).
-- READs are admin-only (the aggregate endpoint also uses service_role; but we add a policy
-- so the table is safe by default).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='heatmap_events' AND policyname='admin read heatmap_events') THEN
    CREATE POLICY "admin read heatmap_events"
      ON heatmap_events FOR SELECT TO authenticated
      USING (public.user_is_admin());
  END IF;
END $$;
