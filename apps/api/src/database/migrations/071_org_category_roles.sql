-- ══════════════════════════════════════════════════════════════════════════
-- Migration 071 — Organizational category roles
--
-- Adds 7 new company_role_enum values backing the owner's category-level
-- RBAC sprint (see packages/types/src/user.types.ts ORG_CATEGORIES/
-- getOrgCategory/COMPANY_ROLE_TO_ORG_CATEGORY, and org-permission.types.ts
-- for the permission matrix these roles are checked against).
--
-- Purely additive -- same non-breaking ALTER TYPE ADD VALUE pattern already
-- used for 'project_engineer' (063_project_engineer_role.sql) and
-- 'subcontractor' (070_rfi_subcontractor_access.sql). Nobody holds any of
-- these new values until a company_admin/super_admin explicitly assigns them
-- through the existing company-role admin UI (ManageMembersModal) -- no
-- default, no backfill of existing users.
-- ══════════════════════════════════════════════════════════════════════════

-- Org chart category "Management" (1.1-1.3). 1.4 (Engineering Manager)
-- already existed as 'engineering_manager'.
ALTER TYPE company_role_enum ADD VALUE IF NOT EXISTS 'chairman';
ALTER TYPE company_role_enum ADD VALUE IF NOT EXISTS 'general_manager';
ALTER TYPE company_role_enum ADD VALUE IF NOT EXISTS 'operations_manager';

-- Org chart category "Document Control" (5.1-5.2) -- had no company-wide
-- title at all before this; 'document_controller' is a separate, per-project
-- ProjectRole (project_members.role), not a CompanyRole.
ALTER TYPE company_role_enum ADD VALUE IF NOT EXISTS 'project_document_controller';
ALTER TYPE company_role_enum ADD VALUE IF NOT EXISTS 'document_control_assistant';

-- Interim, deliberately generic individual-contributor placeholders for the
-- 8 Engineering Team / 2 QAQC Team titles on the org chart that have no
-- company-wide role today beyond the existing *_manager titles (Architect,
-- Structural/Mechanical/Electrical Engineer, Draftsman, BIM Coordinator, BIM
-- Modeler, Materials Engineer, QAQC Engineer, QAQC Inspector). Full
-- per-title granularity is an explicit future extension point, not built
-- this sprint -- see COMPANY_ROLES' own comment in user.types.ts.
ALTER TYPE company_role_enum ADD VALUE IF NOT EXISTS 'engineering_team_member';
ALTER TYPE company_role_enum ADD VALUE IF NOT EXISTS 'qaqc_team_member';
