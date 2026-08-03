-- RFIs (Requests for Information) -- a distinct workflow from Issues:
-- a question needing a formal answer, not a defect needing a fix.
CREATE TABLE IF NOT EXISTS rfis (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rfi_number    VARCHAR(50),
  subject       VARCHAR(500) NOT NULL,
  question      TEXT NOT NULL,
  answer        TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'open',
  priority      VARCHAR(20) NOT NULL DEFAULT 'medium',
  discipline    VARCHAR(100),
  assigned_to   UUID REFERENCES users(id),
  due_date      TIMESTAMPTZ,
  answered_at   TIMESTAMPTZ,
  answered_by   UUID REFERENCES users(id),
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfis_project ON rfis(project_id);
CREATE INDEX IF NOT EXISTS idx_rfis_status ON rfis(project_id, status);
