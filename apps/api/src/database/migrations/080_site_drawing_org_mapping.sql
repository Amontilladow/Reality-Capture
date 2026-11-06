BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Master spec section 4: identify the originator (consultant) and
-- responsible subcontractor for a drawing, and let an authorized user
-- maintain a project-specific mapping once a reliable pattern is known, so
-- later uploads reuse it instead of asking again.
--
-- Two plain columns on site_drawings (not a join table): originator and
-- responsible subcontractor are drawing-level facts, same as discipline/
-- building/floor already on this table -- never a per-revision concern.
--
-- site_drawing_org_mappings is the project-specific lookup itself:
-- `pattern` is matched as a case-insensitive drawing-number prefix (the
-- same signal the brief names -- "drawing-number prefixes, originator
-- codes") against newly extracted drawing numbers, both in bulk import
-- reconciliation and the single-drawing register/add-revision flow. Kept
-- deliberately simple (prefix match, not a rules engine): the brief asks
-- for a maintainable mapping an authorized user curates, not an inference
-- engine.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE site_drawings
  ADD COLUMN IF NOT EXISTS originator                 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS responsible_subcontractor   VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_site_drawings_subcontractor ON site_drawings(project_id, responsible_subcontractor);

CREATE TABLE IF NOT EXISTS site_drawing_org_mappings (
  id                 UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID            NOT NULL REFERENCES companies(id),
  project_id         UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- A drawing-number prefix, matched case-insensitively (e.g. "S-" for a
  -- structural consultant, "MEP-ACME-" for a specific MEP subcontractor).
  -- Not a regex or fuzzy pattern -- a literal prefix, so the mapping stays
  -- auditable and a non-technical document controller can maintain it.
  pattern            VARCHAR(100)    NOT NULL,
  organization_name  VARCHAR(200)    NOT NULL,
  role               VARCHAR(20)     NOT NULL CHECK (role IN ('originator', 'subcontractor')),
  created_by         UUID            NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, pattern, role)
);

CREATE INDEX IF NOT EXISTS idx_site_drawing_org_mappings_project ON site_drawing_org_mappings(project_id);

-- Same RLS form migration 078 standardized on for every tenant table (the
-- CASE guard against an empty, unset app.current_company_id on a pooled
-- connection; system_bypass for the fixed set of cross-tenant operations;
-- FORCE so table ownership changes can't silently disable it).
ALTER TABLE site_drawing_org_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON site_drawing_org_mappings;
CREATE POLICY tenant_isolation ON site_drawing_org_mappings USING (
  CASE WHEN current_setting('app.current_company_id', true) = '' THEN false
  ELSE company_id = current_setting('app.current_company_id', true)::UUID END
);

DROP POLICY IF EXISTS system_bypass ON site_drawing_org_mappings;
CREATE POLICY system_bypass ON site_drawing_org_mappings
  USING (current_setting('app.system_bypass', true) = 'true');

ALTER TABLE site_drawing_org_mappings FORCE ROW LEVEL SECURITY;

INSERT INTO _migrations (filename)
VALUES ('080_site_drawing_org_mapping.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS site_drawing_org_mappings;
--   ALTER TABLE site_drawings DROP COLUMN IF EXISTS originator;
--   ALTER TABLE site_drawings DROP COLUMN IF EXISTS responsible_subcontractor;
-- ══════════════════════════════════════════════════════════════════════════
