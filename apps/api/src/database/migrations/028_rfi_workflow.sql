-- RFI enterprise workflow, Phase 1 (schema + workflow core, backend-only).
-- See engineering-review / plan "RFI Module: Enterprise Document-Control
-- Upgrade" for the full design. This migration is additive only: no
-- existing rfis/rfi_attachments row loses data, no existing column is
-- dropped or renamed, and the legacy status vocabulary (open/answered/
-- closed/void) stays legal so the current (unmodified in this phase)
-- frontend keeps working against the widened API.
--
-- Verified empirically against the local Docker Postgres (16.14) that
-- `ALTER TYPE ... ADD VALUE IF NOT EXISTS` combined with other DDL in the
-- same multi-statement file, run the same way the migration runner runs it
-- (postgres.js `sql.unsafe()`, which sends the whole file as one implicit
-- transaction), applies cleanly as long as the new enum values are not
-- themselves used elsewhere in the same file -- which this migration does
-- not do. No file split was necessary.

-- (a) Expand rfi_discipline_enum. One ADD VALUE per statement -- Postgres
-- does not allow combining multiple new enum labels into a single
-- ALTER TYPE ... ADD VALUE statement.
ALTER TYPE rfi_discipline_enum ADD VALUE IF NOT EXISTS 'general';
ALTER TYPE rfi_discipline_enum ADD VALUE IF NOT EXISTS 'infra';
ALTER TYPE rfi_discipline_enum ADD VALUE IF NOT EXISTS 'mep_general';
ALTER TYPE rfi_discipline_enum ADD VALUE IF NOT EXISTS 'elv';
ALTER TYPE rfi_discipline_enum ADD VALUE IF NOT EXISTS 'av';

-- (b) New project-level RBAC capability for reviewing/responding/closing
-- RFIs -- see project_permission_grants (024_project_permission_grants.sql).
ALTER TYPE project_permission_enum ADD VALUE IF NOT EXISTS 'manage_rfis';

-- (c) Five named stakeholder organizations per project (client/PMC/LDC/
-- main contractor/subcontractor), each with its own logo for the RFI PDF
-- header -- distinct from the single project-wide logo/stamp added in
-- 027_rfi_attachments_and_branding.sql, which is the *authoring party's*
-- letterhead, not a stakeholder's.
CREATE TABLE IF NOT EXISTS project_organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id        UUID         NOT NULL REFERENCES companies(id),
  slot              VARCHAR(20)  NOT NULL CHECK (slot IN ('client','pmc','ldc','main_contractor','subcontractor')),
  name              VARCHAR(255),
  org_ref           VARCHAR(100),
  logo_storage_key  VARCHAR(500),
  contact_name      VARCHAR(255),
  contact_email     VARCHAR(255),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_project_organizations_project ON project_organizations(project_id);

ALTER TABLE project_organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_organizations;
CREATE POLICY tenant_isolation ON project_organizations
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

-- (d) Free-text clarification thread on an RFI -- separate from the formal
-- question/answer record. Must exist before the rfi_attachments.comment_id
-- FK added in (f) below.
CREATE TABLE IF NOT EXISTS rfi_comments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfi_id             UUID         NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
  company_id         UUID         NOT NULL REFERENCES companies(id),
  user_id            UUID         NOT NULL REFERENCES users(id),
  organization_slot  VARCHAR(20),
  body               TEXT         NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfi_comments_rfi ON rfi_comments(rfi_id);

ALTER TABLE rfi_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rfi_comments;
CREATE POLICY tenant_isolation ON rfi_comments
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

-- (e) Widen rfis for the new lifecycle + 4-state cost/time impact.
--
-- Status: a superset CHECK covering both the legacy vocabulary
-- (open/answered/closed/void -- still the only values any existing row can
-- have, and still what the current, unmodified-in-this-phase frontend
-- filters on) and the new workflow vocabulary. The DEFAULT stays 'open' and
-- no existing row's status is rewritten -- 'open'/'answered' are treated as
-- workflow-equivalent to 'submitted'/'responded' at the application layer
-- (rfis.service.ts state machine), not renamed at the data layer.
ALTER TABLE rfis DROP CONSTRAINT IF EXISTS chk_rfi_status;
ALTER TABLE rfis ADD CONSTRAINT chk_rfi_status CHECK (status IN (
  'draft','open','submitted','under_review','awaiting_clarification',
  'responded','answered','closed','rejected','cancelled','void'
));

ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS cost_impact_level       VARCHAR(20) NOT NULL DEFAULT 'no'
    CHECK (cost_impact_level IN ('no','yes','potential','tbd')),
  ADD COLUMN IF NOT EXISTS cost_impact_amount       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS cost_impact_currency     VARCHAR(10),
  ADD COLUMN IF NOT EXISTS cost_impact_description  TEXT,
  ADD COLUMN IF NOT EXISTS time_impact_level        VARCHAR(20) NOT NULL DEFAULT 'no'
    CHECK (time_impact_level IN ('no','yes','potential','tbd')),
  ADD COLUMN IF NOT EXISTS time_impact_days         INTEGER,
  ADD COLUMN IF NOT EXISTS time_impact_description  TEXT,
  -- Upload stamps -- computed once, server-side, at submit/respond time
  -- (see rfis.service.ts submit()/respond()). Never written by a general
  -- UPDATE.
  ADD COLUMN IF NOT EXISTS query_stamp   TEXT,
  ADD COLUMN IF NOT EXISTS answer_stamp  TEXT;

-- Backfill the new level columns from the existing booleans. The booleans
-- themselves are NOT dropped in this migration -- the service layer keeps
-- writing both old and new columns in sync until a later phase retires the
-- booleans once the frontend has moved off them.
UPDATE rfis SET
  cost_impact_level = CASE WHEN cost_impact THEN 'yes' ELSE 'no' END,
  time_impact_level = CASE WHEN time_impact THEN 'yes' ELSE 'no' END;

-- (f) Attachment split -- query/response/comment kind, document type,
-- revision, free description, and an optional link back to the comment it
-- was attached to (added after rfi_comments above so the FK can resolve).
-- Existing rows backfill to kind='query', document_type='other' via the
-- column DEFAULTs below (NOT NULL + DEFAULT applies retroactively to
-- existing rows on ADD COLUMN).
ALTER TABLE rfi_attachments
  ADD COLUMN IF NOT EXISTS kind                 VARCHAR(20) NOT NULL DEFAULT 'query'
    CHECK (kind IN ('query','response','comment')),
  ADD COLUMN IF NOT EXISTS document_type        VARCHAR(50) NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS document_type_other  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS revision             VARCHAR(50),
  ADD COLUMN IF NOT EXISTS description          TEXT,
  ADD COLUMN IF NOT EXISTS comment_id           UUID REFERENCES rfi_comments(id) ON DELETE CASCADE;
