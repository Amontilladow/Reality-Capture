-- ══════════════════════════════════════════════════════════════════════════
-- Migration 005 — Pin Locations
--
-- Lets a "pin" on a floor plan be a Location that exists on its own,
-- instead of requiring a capture to exist first. A location can now
-- optionally carry a drawing position (drawing_id + pos_x_norm/pos_y_norm),
-- making it renderable as a pin. Captures attach to it afterward via the
-- existing captures.location_id column (already there, already nullable,
-- already used by getLocationHistory).
--
-- Purely additive / constraint-relaxing:
--   - 4 new nullable columns on locations
--   - level_id becomes optional (see note below — real drawings in
--     production don't all have a level assigned)
--   - a new partial index
--   - one CHECK ensuring a location isn't left with neither a level nor
--     a drawing position (would be an orphaned, unreachable record)
--
-- Nothing existing is dropped, renamed, or rewritten. The old
-- capture_drawing_links table and its endpoints are left exactly as they
-- are — new pin creation stops writing to it, but it isn't touched.
--
-- This migration does NOT run automatically. It is reviewed here first.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS drawing_id   UUID REFERENCES drawings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_x_norm   NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS pos_y_norm   NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS created_via  VARCHAR(20) NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  ALTER TABLE locations ADD CONSTRAINT locations_created_via_check
    CHECK (created_via IN ('manual', 'floor_plan_tap'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Real production drawings do not all have a level assigned (level_id is
-- nullable on drawings, and none of the 3 test drawings checked have one
-- set). Requiring a level on locations would make pin creation fail on
-- exactly those drawings. Relaxing this to optional; the CHECK below
-- ensures a location still can't end up with neither a level nor a
-- drawing position.
ALTER TABLE locations ALTER COLUMN level_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE locations ADD CONSTRAINT locations_has_a_place_check
    CHECK (level_id IS NOT NULL OR drawing_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_locations_drawing ON locations(drawing_id)
  WHERE drawing_id IS NOT NULL;

INSERT INTO _migrations (filename)
VALUES ('005_pin_locations.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_has_a_place_check;
--   ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_created_via_check;
--   DROP INDEX IF EXISTS idx_locations_drawing;
--   ALTER TABLE locations DROP COLUMN IF EXISTS created_via;
--   ALTER TABLE locations DROP COLUMN IF EXISTS pos_y_norm;
--   ALTER TABLE locations DROP COLUMN IF EXISTS pos_x_norm;
--   ALTER TABLE locations DROP COLUMN IF EXISTS drawing_id;
--   -- level_id NOT NULL is only safely restorable if no row has it NULL.
-- ══════════════════════════════════════════════════════════════════════════
