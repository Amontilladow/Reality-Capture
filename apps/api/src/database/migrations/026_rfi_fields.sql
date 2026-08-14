-- Structured discipline list (replacing the old free-text field), an
-- "Other, please specify" companion field, and the cost/time impact
-- tickboxes. discipline also drives the new 5-segment numbering scheme
-- (see rfis.service.ts generateRfiNumber).
DO $$ BEGIN
  CREATE TYPE rfi_discipline_enum AS ENUM (
    'civil', 'structural', 'architectural', 'interior_design',
    'mechanical', 'electrical', 'plumbing', 'hvac', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Convert the existing free-text column in place. Any existing value that
-- doesn't cleanly match one of the new enum labels becomes NULL rather
-- than blocking the migration -- discipline was optional free text before
-- (placeholder examples like "MEP, Structural…"), so there's no reliable
-- way to map arbitrary prior text onto the new fixed list. Left nullable
-- at the DB level even though it's required going forward at the
-- application layer (CreateRfiDto), so this migration can't fail against
-- existing rows.
ALTER TABLE rfis ALTER COLUMN discipline TYPE rfi_discipline_enum USING (
  CASE lower(discipline)
    WHEN 'civil' THEN 'civil'::rfi_discipline_enum
    WHEN 'structural' THEN 'structural'::rfi_discipline_enum
    WHEN 'architectural' THEN 'architectural'::rfi_discipline_enum
    WHEN 'interior_design' THEN 'interior_design'::rfi_discipline_enum
    WHEN 'mechanical' THEN 'mechanical'::rfi_discipline_enum
    WHEN 'electrical' THEN 'electrical'::rfi_discipline_enum
    WHEN 'plumbing' THEN 'plumbing'::rfi_discipline_enum
    WHEN 'hvac' THEN 'hvac'::rfi_discipline_enum
    WHEN 'other' THEN 'other'::rfi_discipline_enum
    ELSE NULL
  END
);

ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS discipline_other VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cost_impact BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_impact BOOLEAN NOT NULL DEFAULT false;
