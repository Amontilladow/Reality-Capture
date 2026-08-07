-- Snagging (punch list) -- pre-handover defect items with a two-step
-- closure: the responsible trade marks an item fixed, then a supervisor
-- verifies it before it's truly closed. Distinct from Issues (general,
-- ongoing defect tracking with a single resolve step) and QA/QC (a
-- checklist-based pass/fail against a scope of work, not a punch item).
CREATE TABLE IF NOT EXISTS snag_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snag_number  VARCHAR(50),
  title        VARCHAR(500) NOT NULL,
  description  TEXT,
  location     VARCHAR(255),
  trade        VARCHAR(100),
  priority     VARCHAR(20) NOT NULL DEFAULT 'medium',
  status       VARCHAR(20) NOT NULL DEFAULT 'open',
  assigned_to  UUID REFERENCES users(id),
  due_date     TIMESTAMPTZ,
  fixed_at     TIMESTAMPTZ,
  fixed_by     UUID REFERENCES users(id),
  verified_at  TIMESTAMPTZ,
  verified_by  UUID REFERENCES users(id),
  created_by   UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snag_items_project ON snag_items(project_id);
CREATE INDEX IF NOT EXISTS idx_snag_items_status ON snag_items(project_id, status);
