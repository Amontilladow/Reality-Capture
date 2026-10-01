-- ══════════════════════════════════════════════════════════════════════════
-- Migration 052 — Risk Matrix (human Probability x Impact assessment)
--
-- Adds a second, deliberately separate scoring system to `risks` alongside
-- the existing 6-factor deterministic engine (automated_score/override_score/
-- score, 0-100, 4-level, migration 051) -- that engine is untouched and
-- keeps driving exposure amplification, clustering, trend math, and every
-- existing dashboard/PDF number.
--
-- This is the Risk Assessment brief's own 5x5 Probability x Impact matrix:
-- an engineer assigns human_probability/human_impact (1-5 each), the app
-- computes human_score (1-25) and human_level deterministically (never an
-- LLM -- brief section 36). ai_score/ai_level/ai_confidence (populated by a
-- later phase) re-express the existing deterministic engine's own output on
-- this same 1-25/5-level scale purely so the two can be compared side by
-- side -- not a second independent AI guess. final_score/final_level are
-- the one number actually shown as "the" risk on this matrix: an explicit
-- engineer override if made, else the human assessment, else the AI score --
-- kept in sync by application code, exactly like score/level already are
-- for the 0-100 engine in migration 051.
--
-- primary_driver/secondary_driver are plain VARCHAR validated against
-- RISK_DRIVERS in packages/types (not a Postgres enum), matching
-- risk_signals.signal_type's own reasoning in migration 051: a company can
-- extend the driver list via PATCH /company/settings { riskMatrix: {
-- drivers: [...] } } without a migration.
--
-- Configurable matrix thresholds (brief section 4) reuse the existing
-- companies.settings JSONB column + PATCH /company/settings endpoint
-- (tenancy.controller.ts) rather than a new settings table -- RiskService
-- reads company.settings.riskMatrix.thresholds at assessment time, falling
-- back to DEFAULT_RISK_MATRIX_THRESHOLDS (packages/types) when unset.
--
-- risk_assessment_history is the audit trail (brief section 40): one
-- append-only row per human assessment, AI (re)calculation, or override.
-- Separate from risk_status_history (migration 051), which only tracks the
-- risk's lifecycle status, not its probability/impact/score inputs.
--
-- status gains MONITORING/ACCEPTED/ESCALATED (brief section 6) -- purely
-- additive to the CHECK constraint; DETECTED continues to double as that
-- brief's "Not Assessed" (a risk the engine found but no human has assessed
-- yet), so no new status value was needed for it.
--
-- Purely additive: new columns (all nullable) + one new table. Nothing
-- existing is touched or renamed.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS human_probability   SMALLINT CHECK (human_probability BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS human_impact        SMALLINT CHECK (human_impact BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS human_score         SMALLINT CHECK (human_score BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS human_level         VARCHAR(16) CHECK (human_level IN ('LOW','MEDIUM','HIGH','VERY_HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS primary_driver      VARCHAR(32),
  ADD COLUMN IF NOT EXISTS secondary_driver    VARCHAR(32),
  ADD COLUMN IF NOT EXISTS human_assessed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS human_assessed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_score            SMALLINT CHECK (ai_score BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS ai_level            VARCHAR(16) CHECK (ai_level IN ('LOW','MEDIUM','HIGH','VERY_HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS ai_confidence       SMALLINT CHECK (ai_confidence BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS final_score         SMALLINT CHECK (final_score BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS final_level         VARCHAR(16) CHECK (final_level IN ('LOW','MEDIUM','HIGH','VERY_HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS matrix_override_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matrix_override_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matrix_override_reason  TEXT;

-- Widen the status CHECK to add MONITORING/ACCEPTED/ESCALATED. The
-- constraint was created inline with no explicit name in migration 051, so
-- Postgres gave it the default `<table>_<column>_check` name.
ALTER TABLE risks DROP CONSTRAINT IF EXISTS risks_status_check;
ALTER TABLE risks ADD CONSTRAINT risks_status_check
  CHECK (status IN ('DETECTED','ACTIVE','MITIGATION_IN_PROGRESS','MONITORING','ACCEPTED','ESCALATED','RESOLVED','CLOSED'));

CREATE TABLE IF NOT EXISTS risk_assessment_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_id           UUID NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  assessment_type   VARCHAR(16) NOT NULL CHECK (assessment_type IN ('HUMAN','AI','OVERRIDE')),
  probability       SMALLINT,
  impact            SMALLINT,
  score             SMALLINT,
  level             VARCHAR(16),
  primary_driver    VARCHAR(32),
  secondary_driver  VARCHAR(32),
  confidence        SMALLINT,
  reason            TEXT,
  performed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_assessment_history_risk ON risk_assessment_history(risk_id, performed_at DESC);

ALTER TABLE risk_assessment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON risk_assessment_history;
CREATE POLICY tenant_isolation ON risk_assessment_history
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename)
VALUES ('052_risk_matrix.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS risk_assessment_history;
--   ALTER TABLE risks DROP CONSTRAINT IF EXISTS risks_status_check;
--   ALTER TABLE risks ADD CONSTRAINT risks_status_check
--     CHECK (status IN ('DETECTED','ACTIVE','MITIGATION_IN_PROGRESS','RESOLVED','CLOSED'));
--   ALTER TABLE risks
--     DROP COLUMN IF EXISTS human_probability, DROP COLUMN IF EXISTS human_impact,
--     DROP COLUMN IF EXISTS human_score, DROP COLUMN IF EXISTS human_level,
--     DROP COLUMN IF EXISTS primary_driver, DROP COLUMN IF EXISTS secondary_driver,
--     DROP COLUMN IF EXISTS human_assessed_by, DROP COLUMN IF EXISTS human_assessed_at,
--     DROP COLUMN IF EXISTS ai_score, DROP COLUMN IF EXISTS ai_level, DROP COLUMN IF EXISTS ai_confidence,
--     DROP COLUMN IF EXISTS final_score, DROP COLUMN IF EXISTS final_level,
--     DROP COLUMN IF EXISTS matrix_override_by, DROP COLUMN IF EXISTS matrix_override_at,
--     DROP COLUMN IF EXISTS matrix_override_reason;
-- ══════════════════════════════════════════════════════════════════════════
