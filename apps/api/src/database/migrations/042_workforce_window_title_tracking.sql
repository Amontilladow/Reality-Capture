BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Workforce Intelligence™ — window title tracking
--
-- The same DeskTime/Hubstaff/ActivTrak/Time Doctor category feature this
-- product's own competitive-research doc names: the active window's title
-- bar text (e.g. "Q3-Budget.xlsx - Excel"), not just the app name. This is
-- meaningfully more revealing than an app name alone -- a title can carry
-- a document name, an email subject line, a browser tab title -- so it
-- gets the exact same treatment as screenshots (migration 037):
-- off by default, one company-wide switch, enforced server-side at
-- ingest regardless of what any client sends, and never captured during
-- Private Time (migration 040's own 'PRIVATE' activity type already
-- force-redacts application_name_raw/domain/raw_metadata in
-- ActivitiesService.insertOne() -- window_title joins that same
-- redaction, not a separate carve-out).
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE workforce_privacy_settings
  ADD COLUMN IF NOT EXISTS window_title_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS window_title VARCHAR(500);

INSERT INTO _migrations (filename) VALUES ('042_workforce_window_title_tracking.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
