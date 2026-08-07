-- Issues module reconciliation (ticket 2a): discipline as a real enum,
-- an additive "category" classification distinct from the existing
-- issue_type_enum, and issue-numbering keyed off discipline instead of
-- type. See 020_issue_status_enum_values.sql (run just before this file)
-- for why the two new issue_status_enum values live in their own
-- migration.
--
-- building_id, level_id, and location_id (the "room" reference) already
-- exist on the issues table (added in 001_initial_schema.sql) -- verified
-- via `\d issues` against the local dev DB before writing this migration.
-- They were simply never exposed on the create/update DTOs, which is an
-- application-layer fix, not a schema change, and is handled in
-- issues.service.ts / the DTOs rather than here.
--
-- The issue_activities.activity_type column is plain VARCHAR(50) with no
-- backing DB enum or CHECK constraint (verified: no ALTER/CHECK on it in
-- any migration) -- the actual "enum" there is the class-validator
-- @IsIn([...]) list in add-activity.dto.ts. There is nothing to migrate
-- at the DB level for that; the 6 new activity-type values ('forward',
-- 'reopened', 'auto_warning', 'manual_warning', 'status_force',
-- 'reminder') are added to that DTO's @IsIn list instead.

-- ── issue_discipline_enum ───────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE issue_discipline_enum AS ENUM (
    'MEP','ARC','STR','CIV','ELE','INFRA','LANDSCAPE','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: uppercase+trim the existing free-text value; anything that
-- doesn't match one of the 8 codes (including NULL/blank) becomes 'OTHER'.
UPDATE issues
SET discipline = CASE
  WHEN UPPER(TRIM(COALESCE(discipline, ''))) IN
    ('MEP','ARC','STR','CIV','ELE','INFRA','LANDSCAPE','OTHER')
  THEN UPPER(TRIM(discipline))
  ELSE 'OTHER'
END
WHERE discipline IS NULL
   OR UPPER(TRIM(discipline)) NOT IN ('MEP','ARC','STR','CIV','ELE','INFRA','LANDSCAPE','OTHER')
   OR discipline <> UPPER(TRIM(discipline));

ALTER TABLE issues
  ALTER COLUMN discipline TYPE issue_discipline_enum USING (discipline::issue_discipline_enum);

ALTER TABLE issues
  ALTER COLUMN discipline SET DEFAULT 'OTHER';

ALTER TABLE issues
  ALTER COLUMN discipline SET NOT NULL;

-- ── issue_category_enum (additive, nullable; distinct from issue_type) ─
DO $$ BEGIN
  CREATE TYPE issue_category_enum AS ENUM (
    'design_issue','bim_modeling_issue','coordination_issue','clash_detection',
    'constructability_issue','shop_drawing_issue','site_issue','rfi',
    'client_comment','consultant_comment','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS category issue_category_enum;
