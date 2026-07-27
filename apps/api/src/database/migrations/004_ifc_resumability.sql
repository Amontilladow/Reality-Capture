BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- bim_models: resumability + observability columns.
--
-- Resumability contract (documented here because it's a real design
-- decision, not an implementation detail): processing is broken into
-- discrete, ORDERED stages. Each stage's database writes happen inside a
-- single transaction that starts with deleting that stage's prior output
-- for this model (safe because every stage's output is fully derived from
-- the IFC file, never from user edits) and ends by setting
-- stage_completion->>'<stage>' = 'true' in the SAME transaction. That
-- makes each stage atomic: either it fully committed (flag included) or
-- it didn't happen at all (flag absent, prior data — if any — untouched
-- because the delete+insert is in the same transaction as the flag write).
-- On retry/resume, the processor reads stage_completion and skips any
-- stage already marked true, re-running only from the first incomplete
-- stage onward. This is stage-level resume, not element-level resume —
-- documented explicitly rather than overclaiming finer granularity.
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS stage_completion   JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS started_at         TIMESTAMPTZ;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS completed_at       TIMESTAMPTZ;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS duration_ms        INTEGER;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS peak_memory_bytes  BIGINT;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS elements_skipped   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS warnings           JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS attempt_count      INTEGER NOT NULL DEFAULT 0;

-- ══════════════════════════════════════════════════════════════════════════
-- bim_import_reports — one row per completed (successful or failed) import
-- attempt, holding the human-readable report and its structured form.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_import_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id),
  model_id      UUID         NOT NULL REFERENCES bim_models(id) ON DELETE CASCADE,
  report_text   TEXT         NOT NULL,
  report_json   JSONB        NOT NULL,
  status        VARCHAR(20)  NOT NULL,
  generated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_reports_model ON bim_import_reports(model_id, generated_at DESC);

DO $$
BEGIN
  ALTER TABLE bim_import_reports ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON bim_import_reports;
  CREATE POLICY tenant_isolation ON bim_import_reports
    USING (company_id = current_setting('app.current_company_id', true)::UUID);
END $$;

INSERT INTO _migrations (filename) VALUES ('004_ifc_resumability.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
