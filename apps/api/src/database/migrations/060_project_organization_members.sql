-- RBAC Phase 4: real user membership for the 5 project_organizations slots
-- (client/pmc/ldc/main_contractor/subcontractor). project_organizations
-- itself (024_project_permission_grants.sql's sibling, added in
-- 028_rfi_workflow.sql) stays exactly as-is -- a branding/contact row per
-- slot, no user link at all. This is a separate, additive join table, the
-- same relationship project_permission_grants has to project_members: it
-- doesn't touch the table it extends, just adds a new dimension on top.
--
-- Not FK'd to project_organizations.id -- a slot can be assigned members
-- before anyone has configured its name/logo/contact row (upsertOrganization
-- creates that row lazily on first PUT), so membership must not depend on
-- it already existing.
--
-- One slot per (project, user) -- UNIQUE(project_id, user_id) means a
-- person has at most one organization role per project, matching the
-- model's own framing: the organization a user belongs to plays ONE role
-- on a given project, not several at once.
CREATE TABLE IF NOT EXISTS project_organization_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id  UUID         NOT NULL REFERENCES companies(id),
  slot        VARCHAR(20)  NOT NULL CHECK (slot IN ('client','pmc','ldc','main_contractor','subcontractor')),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by    UUID         NOT NULL REFERENCES users(id),
  added_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_organization_members_project ON project_organization_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_organization_members_user    ON project_organization_members(user_id);

ALTER TABLE project_organization_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_organization_members;
CREATE POLICY tenant_isolation ON project_organization_members
  USING (company_id = current_setting('app.current_company_id', true)::UUID);
