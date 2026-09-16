BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Workforce Intelligence™ — reporting-chain table (manager -> employee)
-- Adds manager/chain-of-command visibility on top of the existing
-- self-view-only Workforce Intelligence MVP (037). Deliberately its own
-- workforce-scoped table, not a manager_id column on the core `users`
-- table -- see docs/workforce-intelligence-architecture.md's
-- independent-deployability principle (Workforce Intelligence's data model
-- has no dependency on, and is not depended on by, the rest of the app).
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workforce_reporting_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  manager_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id <> manager_id)
);

-- One row per employee (user_id UNIQUE -- one manager per person). A user
-- with no row simply has no manager recorded, which is the common case.
CREATE INDEX IF NOT EXISTS idx_workforce_reporting_lines_manager ON workforce_reporting_lines(manager_id);

ALTER TABLE workforce_reporting_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workforce_reporting_lines;
CREATE POLICY tenant_isolation ON workforce_reporting_lines
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename) VALUES ('038_workforce_reporting_lines.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
