-- ══════════════════════════════════════════════════════════════════════════
-- Migration 055 — Planned vs Actual Progress by Element/Zone (F2)
--
-- Adds a completion percentage alongside bim_elements' existing free-text
-- construction_status, plus a full audit trail for every element status
-- change (mirrors issue_activities' from_value/to_value/capture_id shape
-- exactly, including the optional evidence link).
--
-- "Zone" in the product brief maps directly onto the existing `levels`
-- table (confirmed: there is no separate zone concept in this schema, and
-- the brief's own acceptance criterion asks for "a summary per level") --
-- so zone_progress is one current-status row per level, with its own
-- mirrored history table. A building-level summary is a live rollup of its
-- levels' zone_progress rows, not a separately stored row.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE bim_elements
  ADD COLUMN IF NOT EXISTS completion_pct SMALLINT
    CONSTRAINT bim_elements_completion_pct_range CHECK (completion_pct IS NULL OR completion_pct BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS bim_element_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  element_id      UUID        NOT NULL REFERENCES bim_elements(id) ON DELETE CASCADE,
  from_status     VARCHAR(50),
  to_status       VARCHAR(50) NOT NULL,
  completion_pct  SMALLINT CHECK (completion_pct IS NULL OR completion_pct BETWEEN 0 AND 100),
  capture_id      UUID REFERENCES captures(id) ON DELETE SET NULL,
  performed_by    UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bim_element_status_history_element ON bim_element_status_history(element_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bim_element_status_history_project ON bim_element_status_history(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zone_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level_id        UUID        NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  status          VARCHAR(50) NOT NULL DEFAULT 'not_started',
  completion_pct  SMALLINT CHECK (completion_pct IS NULL OR completion_pct BETWEEN 0 AND 100),
  capture_id      UUID REFERENCES captures(id) ON DELETE SET NULL,
  updated_by      UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(level_id)
);

CREATE TABLE IF NOT EXISTS zone_progress_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level_id        UUID        NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  from_status     VARCHAR(50),
  to_status       VARCHAR(50) NOT NULL,
  completion_pct  SMALLINT CHECK (completion_pct IS NULL OR completion_pct BETWEEN 0 AND 100),
  capture_id      UUID REFERENCES captures(id) ON DELETE SET NULL,
  performed_by    UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zone_progress_project ON zone_progress(project_id);
CREATE INDEX IF NOT EXISTS idx_zone_progress_history_level ON zone_progress_history(level_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zone_progress_history_project ON zone_progress_history(project_id, created_at DESC);

ALTER TABLE bim_element_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bim_element_status_history;
CREATE POLICY tenant_isolation ON bim_element_status_history
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

ALTER TABLE zone_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON zone_progress;
CREATE POLICY tenant_isolation ON zone_progress
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

ALTER TABLE zone_progress_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON zone_progress_history;
CREATE POLICY tenant_isolation ON zone_progress_history
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename)
VALUES ('055_element_zone_progress.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS zone_progress_history;
--   DROP TABLE IF EXISTS zone_progress;
--   DROP TABLE IF EXISTS bim_element_status_history;
--   ALTER TABLE bim_elements DROP CONSTRAINT IF EXISTS bim_elements_completion_pct_range;
--   ALTER TABLE bim_elements DROP COLUMN IF EXISTS completion_pct;
-- ══════════════════════════════════════════════════════════════════════════
