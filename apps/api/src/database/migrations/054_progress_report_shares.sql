-- ══════════════════════════════════════════════════════════════════════════
-- Migration 054 — Progress Report share links (F1: Automated Progress Report)
--
-- A progress report's content is never stored -- it's always computed live
-- from captures/issues at view time (see ProgressReportsService.generate()),
-- exactly like the general Reports tab's KPI payload. This table only
-- persists the SHARE: an opaque, expiring, revocable token authorizing an
-- unauthenticated viewer to see one report (one project, optional building/
-- level scope, one date range) without an EngineeringOS account.
--
-- Mirrors rfi_external_access (migration 043) deliberately: same random
-- 128-hex-char token (the secret itself, not hashed -- same category as a
-- password-reset token), same expires_at/revoked_at/used_at shape, same
-- public-controller + withSystemBypass validation pattern. No "action"
-- column here -- a progress report link only ever grants one capability
-- (view), unlike RFI external access's respond/review/comment_only split.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS progress_report_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  building_id   UUID REFERENCES buildings(id) ON DELETE SET NULL,
  level_id      UUID REFERENCES levels(id) ON DELETE SET NULL,
  date_from     TIMESTAMPTZ NOT NULL,
  date_to       TIMESTAMPTZ NOT NULL,
  token         VARCHAR(128) NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at       TIMESTAMPTZ,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_report_shares_project ON progress_report_shares(project_id, created_at DESC);

ALTER TABLE progress_report_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON progress_report_shares;
CREATE POLICY tenant_isolation ON progress_report_shares
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename)
VALUES ('054_progress_report_shares.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS progress_report_shares;
-- ══════════════════════════════════════════════════════════════════════════
