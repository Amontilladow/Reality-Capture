-- ══════════════════════════════════════════════════════════════════════════
-- Migration 008 — Project / Building Phase
--
-- Moves "phase" from a per-pin concept (which caused real confusion --
-- see conversation history) to what it actually is: a property of the
-- project overall, optionally refined per building. A pin can still
-- accumulate photos from different phases over its lifetime (phase stays
-- on each capture too, unchanged) -- this is a separate, coarser-grained
-- classification for "what phase is this project/building in right now."
--
-- Purely additive: two nullable enum columns, reusing the existing
-- project_phase_enum type. Nothing existing is touched.
--
-- This migration does NOT run automatically. It is reviewed here first.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS phase project_phase_enum;

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS phase project_phase_enum;

INSERT INTO _migrations (filename)
VALUES ('008_project_building_phase.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   ALTER TABLE buildings DROP COLUMN IF EXISTS phase;
--   ALTER TABLE projects DROP COLUMN IF EXISTS phase;
-- ══════════════════════════════════════════════════════════════════════════
