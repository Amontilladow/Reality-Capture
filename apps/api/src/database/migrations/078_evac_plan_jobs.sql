BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 3D Evacuation Plans (apps/evac3d-service): one row per conversion of a batch
-- of 2D evacuation-plan PDFs into 3D evacuation-plan sheets.
--
-- The uploaded PDFs (and optional logo) are kept untouched at their storage
-- keys; a re-run is a NEW row on the same originals, so every run stays
-- auditable. Results are DRAFTS for Fire & Life Safety consultant review:
-- no status here claims code compliance or Civil Defence approval.
-- ══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE evac_plan_job_status_enum AS ENUM (
    'QUEUED', 'RUNNING', 'READY_FOR_REVIEW', 'NEEDS_ATTENTION', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS evac_plan_jobs (
  id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID            NOT NULL REFERENCES companies(id),
  project_id           UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_files         JSONB           NOT NULL,
  logo_storage_key     VARCHAR(1000),
  settings             JSONB           NOT NULL DEFAULT '{}'::jsonb,
  status               evac_plan_job_status_enum NOT NULL DEFAULT 'QUEUED',
  status_label         TEXT,
  -- Per-sheet progress copied from the conversion service while it runs.
  progress             JSONB,
  service_job_id       VARCHAR(100),
  outputs              JSONB           NOT NULL DEFAULT '[]'::jsonb,
  report_storage_key   VARCHAR(1000),
  plan_pdf_storage_key VARCHAR(1000),
  package_storage_key  VARCHAR(1000),
  -- A human-readable summary only, never drawing content or a secret.
  error_message        TEXT,
  parent_job_id        UUID            REFERENCES evac_plan_jobs(id),
  created_by           UUID            NOT NULL REFERENCES users(id),
  started_at           TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evac_plan_jobs_project ON evac_plan_jobs(project_id, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY['evac_plan_jobs'];
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

INSERT INTO _migrations (filename) VALUES ('078_evac_plan_jobs.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
