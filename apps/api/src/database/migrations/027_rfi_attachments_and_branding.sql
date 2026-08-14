-- RFI attachments -- supporting drawing PDFs, photos, and calculation
-- files (Excel/Word), same presigned-PUT pattern and allow-list as issue
-- attachments (see 022_issue_reminders_and_attachments.sql). RFIs have no
-- activity/comment thread to hang these off like issue_activities does,
-- so this is its own flat table instead.
CREATE TABLE IF NOT EXISTS rfi_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfi_id      UUID         NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
  company_id  UUID         NOT NULL REFERENCES companies(id),
  storage_key VARCHAR(500) NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  size_bytes  BIGINT       NOT NULL,
  uploaded_by UUID         NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfi_attachments_rfi ON rfi_attachments(rfi_id);

ALTER TABLE rfi_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rfi_attachments;
CREATE POLICY tenant_isolation ON rfi_attachments
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

-- Per-project branding for RFI PDFs -- one logo + one stamp per project
-- (not per company: different projects can run under different
-- consultant/JV branding). Nullable -- a project's RFI PDFs render fine
-- with neither set, per rfi-pdf.template.ts.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS logo_storage_key  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS stamp_storage_key VARCHAR(500);
