-- ══════════════════════════════════════════════════════════════════════════
-- Migration 007 — Location Archive
--
-- Lets a pin (a Location) be "deleted" safely: archived_at set = hidden
-- from normal views, but the row and everything attached to it (photos,
-- videos, notes) survives untouched and is recoverable. Nothing is ever
-- actually erased by this feature.
--
-- Purely additive: one nullable timestamp column + one partial index for
-- the common "give me the active ones" query.
--
-- This migration does NOT run automatically. It is reviewed here first.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_locations_archived ON locations(archived_at)
  WHERE archived_at IS NOT NULL;

INSERT INTO _migrations (filename)
VALUES ('007_location_archive.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP INDEX IF EXISTS idx_locations_archived;
--   ALTER TABLE locations DROP COLUMN IF EXISTS archived_at;
-- ══════════════════════════════════════════════════════════════════════════
