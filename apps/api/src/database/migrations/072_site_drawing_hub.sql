-- ══════════════════════════════════════════════════════════════════════════
-- Migration 072 — Site Drawing Hub
--
-- A document-control-grade drawing register, deliberately separate from two
-- existing, narrower tables that are NOT fit for this purpose:
--   - `drawings` (001_initial_schema.sql) is the Buildlense Captures floor
--     plan background image + pin-placement feature (single `is_current`
--     boolean, no revision history, no discipline/workflow-status/approval
--     model). Different product, different shape.
--   - `documents` (001_initial_schema.sql) is a generic attach-a-file-to-a-
--     record system used by RFIs/Issues/Submittals/Transmittals/Snagging
--     (one row per document, no revision-vs-drawing separation, free-text
--     `status`, no source sync tracking). Reused here only for its
--     `doc_source_enum` values/naming convention, per the brief's "reuse
--     existing naming conventions" instruction -- the table itself has no
--     room for a revision history or a verified approval state.
--   - `doc_integrations` (001_initial_schema.sql) exists but was never wired
--     to any service (confirmed: zero references outside this migration
--     file). It is exactly the per-company external-connector config shape
--     this feature needs (system/config JSONB/is_active/last_synced_at), so
--     it's finally put to use below rather than duplicated.
--
-- Drawing identity (site_drawings) and revision identity
-- (site_drawing_revisions) are kept in separate tables per the brief's own
-- instruction, with site_drawings.current_revision_id as the one pointer a
-- client needs to resolve "what's current" without a window-function query
-- on every register page load. current_workflow_status/current_is_superseded
-- are a deliberate denormalization of the current revision's own columns,
-- kept in sync by the service layer (never trust a mismatch — see
-- SiteDrawingsService's own comment) purely so the register can filter/sort
-- by workflow status with a plain indexed column instead of a join.
-- ══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE site_drawing_workflow_status_enum AS ENUM (
    'UNDER_REVIEW', 'APPROVED', 'APPROVED_FOR_CONSTRUCTION', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'NOT_APPLICABLE' covers the local/manual-upload source, which has nothing
-- to synchronize against -- distinct from 'SYNCED' (an external source that
-- IS kept in sync and was, last time it ran).
DO $$ BEGIN
  CREATE TYPE site_drawing_sync_status_enum AS ENUM ('SYNCED', 'PENDING', 'STALE', 'ERROR', 'NOT_APPLICABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE site_drawing_sync_log_status_enum AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE site_drawing_offline_package_status_enum AS ENUM ('DOWNLOADING', 'COMPLETE', 'FAILED', 'STALE', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: site_drawings (drawing identity — stable across revisions)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS site_drawings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID            NOT NULL REFERENCES companies(id),
  project_id               UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_number           VARCHAR(200)    NOT NULL,
  drawing_title            VARCHAR(500)    NOT NULL,
  discipline               VARCHAR(100),
  building_or_zone         VARCHAR(200),
  floor_or_level           VARCHAR(100),
  source_provider          doc_source_enum NOT NULL DEFAULT 'internal',
  -- Stable provider identity (never a filename/path). Always set, including
  -- for 'internal' drawings -- SiteDrawingsService generates a UUID at
  -- registration time rather than leaving this NULL, so the unique
  -- constraint below can't treat two unrelated internal drawings in the
  -- same project as duplicates of each other.
  source_file_id           VARCHAR(500)    NOT NULL,
  source_web_url           VARCHAR(1000),
  -- Denormalized from current_revision_id's own row -- see migration header.
  current_revision_id      UUID,
  current_workflow_status  site_drawing_workflow_status_enum NOT NULL DEFAULT 'UNKNOWN',
  current_is_superseded    BOOLEAN         NOT NULL DEFAULT false,
  search_vector            TSVECTOR,
  created_by               UUID            NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  -- One register row per (project, source, source file) -- prevents a
  -- re-run sync job from creating a duplicate drawing for the same source
  -- document. source_file_id is NOT NULL (see its own comment above), so
  -- this needs no NULLS NOT DISTINCT handling.
  UNIQUE (project_id, source_provider, source_file_id)
);

CREATE INDEX IF NOT EXISTS idx_site_drawings_project ON site_drawings(project_id);
CREATE INDEX IF NOT EXISTS idx_site_drawings_number ON site_drawings(project_id, drawing_number);
CREATE INDEX IF NOT EXISTS idx_site_drawings_discipline ON site_drawings(project_id, discipline);
CREATE INDEX IF NOT EXISTS idx_site_drawings_status ON site_drawings(project_id, current_workflow_status);
CREATE INDEX IF NOT EXISTS idx_site_drawings_fts ON site_drawings USING gin(search_vector);

CREATE OR REPLACE FUNCTION site_drawings_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.drawing_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.drawing_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.discipline, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.building_or_zone, '')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_site_drawings_search_vector ON site_drawings;
CREATE TRIGGER trg_site_drawings_search_vector
  BEFORE INSERT OR UPDATE ON site_drawings
  FOR EACH ROW EXECUTE FUNCTION site_drawings_search_vector_update();

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: site_drawing_revisions (revision identity, logically separate from
-- the drawing identity above — section 4/5 of the brief)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS site_drawing_revisions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID            NOT NULL REFERENCES companies(id),
  project_id              UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_id              UUID            NOT NULL REFERENCES site_drawings(id) ON DELETE CASCADE,
  revision_number         VARCHAR(50)     NOT NULL,
  -- The system's own normalized determination of valid-for-site-use status
  -- (section 5) — never inferred from the filename/timestamp/revision
  -- number, always set explicitly (by the uploader for the local source, or
  -- by a provider adapter's own status-mapping config for an external one).
  workflow_status         site_drawing_workflow_status_enum NOT NULL DEFAULT 'UNKNOWN',
  -- The untranslated status string as the source itself reports it (e.g.
  -- "Issued for Construction", "Pending Approval") — kept verbatim so a
  -- mis-mapping is auditable and never silently lossy.
  source_status_raw       VARCHAR(200),
  issue_date              DATE,
  source_modified_at      TIMESTAMPTZ,
  last_verified_at        TIMESTAMPTZ,
  content_hash            VARCHAR(128),
  storage_key             VARCHAR(1000),
  source_web_url          VARCHAR(1000),
  file_size_bytes         BIGINT,
  supersedes_revision_id  UUID REFERENCES site_drawing_revisions(id),
  is_superseded           BOOLEAN         NOT NULL DEFAULT false,
  offline_eligibility     BOOLEAN         NOT NULL DEFAULT true,
  synchronization_status  site_drawing_sync_status_enum NOT NULL DEFAULT 'NOT_APPLICABLE',
  uploaded_by             UUID            REFERENCES users(id),
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(drawing_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_site_drawing_revisions_drawing ON site_drawing_revisions(drawing_id);
CREATE INDEX IF NOT EXISTS idx_site_drawing_revisions_project ON site_drawing_revisions(project_id);

ALTER TABLE site_drawings
  ADD CONSTRAINT fk_site_drawings_current_revision
  FOREIGN KEY (current_revision_id) REFERENCES site_drawing_revisions(id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: site_drawing_sync_log (section 6/10 — last successful vs. last
-- attempted synchronization tracked as separate, queryable facts, and a
-- failed run can never be mistaken for a successful one)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS site_drawing_sync_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID            NOT NULL REFERENCES companies(id),
  project_id         UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_provider    doc_source_enum NOT NULL,
  started_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  finished_at        TIMESTAMPTZ,
  status              site_drawing_sync_log_status_enum,
  drawings_seen       INTEGER         NOT NULL DEFAULT 0,
  drawings_created     INTEGER        NOT NULL DEFAULT 0,
  revisions_created    INTEGER        NOT NULL DEFAULT 0,
  -- A human-readable failure summary only — never a secret, token, or raw
  -- document content (section 6: "log failures without recording secrets or
  -- document contents").
  error_message       TEXT,
  triggered_by         UUID           REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_site_drawing_sync_log_project ON site_drawing_sync_log(project_id, started_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: site_drawing_offline_packages (section 8 — per-user explicit
-- offline downloads; the metadata lives here, the PDF bytes live in the
-- browser's own IndexedDB, never in Postgres)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS site_drawing_offline_packages (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID            NOT NULL REFERENCES companies(id),
  user_id           UUID            NOT NULL REFERENCES users(id),
  project_id        UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_id        UUID            NOT NULL REFERENCES site_drawings(id) ON DELETE CASCADE,
  revision_id       UUID            NOT NULL REFERENCES site_drawing_revisions(id) ON DELETE CASCADE,
  status            site_drawing_offline_package_status_enum NOT NULL DEFAULT 'DOWNLOADING',
  content_hash      VARCHAR(128),
  file_size_bytes   BIGINT,
  downloaded_at     TIMESTAMPTZ,
  last_verified_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, revision_id)
);

CREATE INDEX IF NOT EXISTS idx_site_drawing_offline_user ON site_drawing_offline_packages(user_id, project_id);

-- ══════════════════════════════════════════════════════════════════════════
-- doc_integrations (existing table, never previously wired to any service —
-- now the per-company external source config store this feature uses.
-- `config` JSONB holds non-secret connection details only (tenant/site ids,
-- library paths); any client secret/refresh token belongs in environment
-- variables, never this column, per section 3's "never expose ... in
-- public Firestore documents or URLs" -- same rule, this platform's own
-- equivalent store).
-- ══════════════════════════════════════════════════════════════════════════
