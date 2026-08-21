-- ══════════════════════════════════════════════════════════════════════════
-- Migration 031 — Snag Items Location
--
-- Lets a pin's auto-created Issue (issues.location_id, from migration 005 /
-- the pin-creation feature) be converted into a Snag item instead, without
-- losing the pin linkage. Adds a nullable snag_items.location_id FK back to
-- locations, mirroring issues.location_id, so a Snag item can be "the
-- record this pin is currently linked to" exactly like an Issue can be.
--
-- Purely additive:
--   - 1 new nullable column on snag_items
--   - a new partial index
--
-- Nothing existing is dropped, renamed, or rewritten.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE snag_items
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_snag_items_location ON snag_items(location_id)
  WHERE location_id IS NOT NULL;

INSERT INTO _migrations (filename)
VALUES ('031_snag_items_location.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP INDEX IF EXISTS idx_snag_items_location;
--   ALTER TABLE snag_items DROP COLUMN IF EXISTS location_id;
-- ══════════════════════════════════════════════════════════════════════════
