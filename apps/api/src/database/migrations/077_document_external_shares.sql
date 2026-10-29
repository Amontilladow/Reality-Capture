-- ══════════════════════════════════════════════════════════════════════════
-- Migration 077 — Document external share links
--
-- Lets a project team hand a document (an internally-stored upload, not a
-- metadata-only external reference) to someone outside the company -- a
-- client, consultant, or subcontractor with no EngineeringOS account --
-- without routing through Dropbox/WeTransfer/etc. Mirrors
-- progress_report_shares (migration 054) and rfi_external_access (migration
-- 043) deliberately: same random 128-hex-char token (the secret itself, not
-- hashed -- same category as a password-reset token), same
-- expires_at/revoked_at/used_at shape, same public-controller +
-- withSystemBypass validation pattern. No "action" column (unlike RFI
-- external access) -- a document share only ever grants one capability
-- (view/download).
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS document_external_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  recipient_email VARCHAR(255),
  recipient_name  VARCHAR(255),
  token           VARCHAR(128) NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at         TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_external_shares_document ON document_external_shares(document_id, created_at DESC);

ALTER TABLE document_external_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_external_shares;
CREATE POLICY tenant_isolation ON document_external_shares
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename)
VALUES ('077_document_external_shares.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS document_external_shares;
-- ══════════════════════════════════════════════════════════════════════════
