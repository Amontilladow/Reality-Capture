-- Per-project permission grants: lets a super_admin hand a specific
-- company_admin a specific, named capability on a specific project,
-- without making it company-wide or permanent-by-default (revocable
-- anytime). company_admin has no special authority beyond creating
-- projects unless granted here -- everything else flows through this
-- table, or through the target project's own project_lead, who keeps
-- natural authority over their own project regardless of grants.
DO $$ BEGIN
  CREATE TYPE project_permission_enum AS ENUM (
    'manage_team', 'manage_issues', 'manage_project_records'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS project_permission_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID                     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID                     NOT NULL REFERENCES companies(id),
  permission  project_permission_enum  NOT NULL,
  granted_by  UUID                     NOT NULL REFERENCES users(id),
  granted_at  TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_project_permission_grants_project ON project_permission_grants(project_id);
CREATE INDEX IF NOT EXISTS idx_project_permission_grants_user    ON project_permission_grants(user_id);

ALTER TABLE project_permission_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_permission_grants;
CREATE POLICY tenant_isolation ON project_permission_grants
  USING (company_id = current_setting('app.current_company_id', true)::UUID);
