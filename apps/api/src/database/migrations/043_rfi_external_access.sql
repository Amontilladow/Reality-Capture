-- RFI external stakeholder access -- lets a Lead Design Consultant, PMC, or
-- Client respond to or review an RFI via an opaque, expiring, revocable link
-- with no EngineeringOS account, mirroring the same "unauthenticated holder
-- of a secret DB-backed token" pattern this codebase already uses for
-- password-reset/invitation tokens (see auth.service.ts). Not single-use --
-- the same link is meant to be reopened to re-read the RFI, add a follow-up
-- comment, or revise before final submission, so `used_at` is an
-- informational last-access timestamp, not a consumption lock. Always
-- revocable by an internal manage_rfis-permitted user before natural expiry.

CREATE TABLE IF NOT EXISTS rfi_external_access (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rfi_id             UUID NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
  organization_slot  VARCHAR(20) NOT NULL,  -- validated against PROJECT_ORGANIZATION_SLOTS at the app layer, same convention as rfi_comments.organization_slot
  action             VARCHAR(20) NOT NULL CHECK (action IN ('respond','review','comment_only')),
  recipient_email    VARCHAR(255) NOT NULL,
  recipient_name     VARCHAR(255),
  token              VARCHAR(128) NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID REFERENCES users(id),
  used_at            TIMESTAMPTZ,          -- last successful use, not single-use -- see note above
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfi_external_access_rfi ON rfi_external_access(rfi_id);

ALTER TABLE rfi_external_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rfi_external_access;
CREATE POLICY tenant_isolation ON rfi_external_access
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

-- Reserved, non-login placeholder account so audit_log rows for an action
-- taken by an external token holder (who has no real `users` row) still
-- attribute to a valid, joinable user_id rather than requiring
-- audit_log.user_id to become nullable -- a cross-cutting change to a table
-- every other module also writes to, which this avoids on purpose. One row
-- PER COMPANY (not a single platform-wide row): `users` carries the same
-- tenant_isolation RLS policy as everywhere else, and every existing
-- RLS-scoped join back to `users` (e.g. RfisService.getPdfData()'s
-- `LEFT JOIN users u ON u.id = a.user_id`, run under
-- db.withTenant(companyId, ...)) would silently resolve to no row at all
-- for a system account belonging to a different company than the one
-- currently in RLS context -- a platform-wide row would make the existing
-- audit-trail name lookup go blank for every company except whichever one
-- happens to own it. A per-company row keeps that lookup working with zero
-- changes to that existing query. Rows are created lazily (get-or-create)
-- by RfiExternalAccessService the first time a company generates an
-- external link, not seeded here for every existing company.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT false;
