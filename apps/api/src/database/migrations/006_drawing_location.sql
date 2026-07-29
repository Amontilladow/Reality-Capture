-- ══════════════════════════════════════════════════════════════════════════
-- Migration 006 — Drawing Location
--
-- Lets a drawing optionally reference a Room (a Location) in addition to
-- its existing Level reference, so the upload form's "Room" field can
-- actually persist instead of going nowhere.
--
-- Purely additive: one nullable column + one partial index. Nothing
-- existing is touched. ON DELETE SET NULL means deleting a Location never
-- takes a drawing down with it.
--
-- This migration does NOT run automatically. It is reviewed here first.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE drawings
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_drawings_location ON drawings(location_id)
  WHERE location_id IS NOT NULL;

INSERT INTO _migrations (filename)
VALUES ('006_drawing_location.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP INDEX IF EXISTS idx_drawings_location;
--   ALTER TABLE drawings DROP COLUMN IF EXISTS location_id;
-- ══════════════════════════════════════════════════════════════════════════
