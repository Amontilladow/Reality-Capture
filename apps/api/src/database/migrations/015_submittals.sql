-- Submittals -- contractor-submitted product data/shop drawings awaiting
-- formal design-team review, distinct from RFIs (a question) and Issues
-- (a defect).
CREATE TABLE IF NOT EXISTS submittals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  submittal_number VARCHAR(50),
  title            VARCHAR(500) NOT NULL,
  spec_section     VARCHAR(100),
  description      TEXT,
  status           VARCHAR(30) NOT NULL DEFAULT 'submitted',
  priority         VARCHAR(20) NOT NULL DEFAULT 'medium',
  discipline       VARCHAR(100),
  revision         VARCHAR(20),
  assigned_to      UUID REFERENCES users(id),
  due_date         TIMESTAMPTZ,
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      UUID REFERENCES users(id),
  review_comments  TEXT,
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submittals_project ON submittals(project_id);
CREATE INDEX IF NOT EXISTS idx_submittals_status ON submittals(project_id, status);
