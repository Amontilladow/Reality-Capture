-- ══════════════════════════════════════════════════════════════════════════
-- Migration 049 — Snag Items Building/Level
--
-- Snag items today only carry a free-text `location` string and, since
-- migration 031, an optional `location_id` FK back to a pin/room. Neither
-- lets the Snagging list be grouped/filtered by building and level the way
-- Issues already can be (issues.building_id/level_id, added earlier).
--
-- Adds the same two nullable FKs directly to snag_items, mirroring
-- issues.building_id/level_id exactly (not derived from location_id/level,
-- since a snag item need not have a specific room/pin to still be tagged
-- to a building and level).
--
-- Purely additive:
--   - 2 new nullable columns on snag_items
--   - 2 new indexes
--
-- Nothing existing is dropped, renamed, or rewritten. The free-text
-- `location` column and the existing `location_id` FK are untouched.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE snag_items
  ADD COLUMN IF NOT EXISTS building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS level_id    UUID REFERENCES levels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_snag_items_building ON snag_items(building_id) WHERE building_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_snag_items_level ON snag_items(level_id) WHERE level_id IS NOT NULL;

INSERT INTO _migrations (filename)
VALUES ('049_snag_items_building_level.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP INDEX IF EXISTS idx_snag_items_level;
--   DROP INDEX IF EXISTS idx_snag_items_building;
--   ALTER TABLE snag_items DROP COLUMN IF EXISTS level_id;
--   ALTER TABLE snag_items DROP COLUMN IF EXISTS building_id;
-- ══════════════════════════════════════════════════════════════════════════
