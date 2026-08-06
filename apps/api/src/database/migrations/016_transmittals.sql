-- Transmittals -- the formal record of documents/drawings sent to a
-- recipient (often an external consultant/contractor, not a system user)
-- for review, approval, or record. Distinct from RFIs (a question) and
-- Submittals (contractor-submitted data awaiting review): a transmittal is
-- a one-way delivery record, not a request-response workflow.
CREATE TABLE IF NOT EXISTS transmittals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id),
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  transmittal_number VARCHAR(50),
  subject            VARCHAR(500) NOT NULL,
  recipient_name     VARCHAR(255) NOT NULL,
  recipient_company  VARCHAR(255),
  purpose            VARCHAR(30) NOT NULL DEFAULT 'for_review',
  items              TEXT NOT NULL,
  notes              TEXT,
  status             VARCHAR(20) NOT NULL DEFAULT 'draft',
  sent_date          TIMESTAMPTZ,
  due_date           TIMESTAMPTZ,
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transmittals_project ON transmittals(project_id);
CREATE INDEX IF NOT EXISTS idx_transmittals_status ON transmittals(project_id, status);
