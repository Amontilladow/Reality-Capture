BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- GIS Preparation (apps/adm-gis-prep as a built-in module): one row per run
-- of the M4 ADM/DRM GIS preparation tool on an uploaded DXF/DWG.
--
-- The original drawing is kept untouched at source_storage_key; a re-run with
-- new decisions is a NEW row (parent_job_id) on the same original, never an
-- overwrite, so every run stays auditable. status is the platform job state
-- plus the tool's own outcome; status_label keeps the tool's exact wording.
-- None of these values claims ADM/DRM compliance or approval -- the official
-- QC tool and review decide that.
-- ══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE gis_prep_job_status_enum AS ENUM (
    'QUEUED', 'RUNNING', 'READY_FOR_REVIEW', 'PREPARED_WITH_WARNINGS', 'BLOCKED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS gis_prep_jobs (
  id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID            NOT NULL REFERENCES companies(id),
  project_id           UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile              VARCHAR(50)     NOT NULL,
  source_filename      VARCHAR(500)    NOT NULL,
  source_storage_key   VARCHAR(1000)   NOT NULL,
  source_sha256        VARCHAR(64),
  status               gis_prep_job_status_enum NOT NULL DEFAULT 'QUEUED',
  status_label         TEXT,
  tool_job_id          VARCHAR(200),
  counts               JSONB,
  settings             JSONB           NOT NULL,
  outputs              JSONB           NOT NULL DEFAULT '[]'::jsonb,
  report_storage_key   VARCHAR(1000),
  package_storage_key  VARCHAR(1000),
  -- A human-readable summary only, never drawing content or a secret.
  error_message        TEXT,
  parent_job_id        UUID            REFERENCES gis_prep_jobs(id),
  created_by           UUID            NOT NULL REFERENCES users(id),
  started_at           TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gis_prep_jobs_project ON gis_prep_jobs(project_id, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY['gis_prep_jobs'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.current_company_id'', true)::UUID)',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS system_bypass ON %I', t);
    EXECUTE format(
      'CREATE POLICY system_bypass ON %I USING (current_setting(''app.system_bypass'', true) = ''true'')',
      t
    );
  END LOOP;
END $$;

INSERT INTO _migrations (filename) VALUES ('076_gis_prep_jobs.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
