-- QA/QC inspections -- a formal quality check against a scope of work
-- (a checklist + findings), distinct from Issues (a specific defect) and
-- Submittals (contractor data awaiting review): an inspection records
-- whether a scope of work passes quality standards, not a question or a
-- single defect.
CREATE TABLE IF NOT EXISTS qa_inspections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inspection_number VARCHAR(50),
  title             VARCHAR(500) NOT NULL,
  inspection_type   VARCHAR(100),
  location          VARCHAR(255),
  checklist         TEXT NOT NULL,
  findings          TEXT,
  status            VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  assigned_to       UUID REFERENCES users(id),
  inspection_date   TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  completed_by      UUID REFERENCES users(id),
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_inspections_project ON qa_inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_qa_inspections_status ON qa_inspections(project_id, status);
