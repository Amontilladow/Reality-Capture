-- ══════════════════════════════════════════════════════════════════════════
-- Migration 070 — RFI subcontractor access
--
-- Splits the RFI register into two views -- "Main Contractor's RFIs" and
-- "Subcontractor's RFIs" -- and introduces a genuine, project-scoped
-- subcontractor login: a user invited onto one project only, restricted to
-- the RFI module (SubcontractorRfiAccessGuard), who can raise their own
-- RFIs and read (but not write) the main contractor's. Deliberately NOT a
-- cross-company/multi-tenant change: a subcontractor is still a plain
-- `users` row under the project owner's own company_id, same RLS model as
-- every other table -- see that guard's own header comment.
--
-- Also adds `origin`/`origin_reference` so a document controller can log an
-- RFI that was actually raised and answered on Aconex/Procore/email and
-- just needs recording here, tagged by where it really came from.
-- ══════════════════════════════════════════════════════════════════════════

-- New project role: an outside subcontractor-company user, restricted to
-- the RFI module only. See PROJECT_ROLES in packages/types/src/user.types.ts.
ALTER TYPE project_role_enum ADD VALUE IF NOT EXISTS 'subcontractor';

-- New, narrow project permission: attach supporting files to an RFI you
-- raised yourself, without the full manage_project_records grant. Held
-- automatically by the 'subcontractor' project role on its own project --
-- see ProjectAuthorizationService.hasProjectPermission().
ALTER TYPE project_permission_enum ADD VALUE IF NOT EXISTS 'raise_rfis';

-- Which of the project's 5 named organizations (project_organizations.slot)
-- raised this RFI -- reuses that exact vocabulary rather than inventing a
-- parallel one. Defaults to 'main_contractor' so every existing row keeps
-- its current (sole) list membership unchanged.
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS raised_by_organization_slot VARCHAR(20) NOT NULL DEFAULT 'main_contractor'
    CHECK (raised_by_organization_slot IN ('client', 'pmc', 'ldc', 'main_contractor', 'subcontractor')),
  ADD COLUMN IF NOT EXISTS origin VARCHAR(20) NOT NULL DEFAULT 'platform'
    CHECK (origin IN ('platform', 'aconex', 'procore', 'email', 'other')),
  ADD COLUMN IF NOT EXISTS origin_reference VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_rfis_raised_by_org_slot ON rfis(project_id, raised_by_organization_slot);
CREATE INDEX IF NOT EXISTS idx_rfis_origin ON rfis(project_id, origin);
