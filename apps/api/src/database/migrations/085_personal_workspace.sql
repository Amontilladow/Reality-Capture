BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Personal workspace: the user's own tasks/reminders and saved items.
--
-- Both tables are private to one user: every query filters on user_id,
-- on top of the same company tenant_isolation + system_bypass RLS policies
-- every other tenant table has (migrations 052/057/078). Nothing here
-- copies project records: a personal task may *link* to a record
-- (linked_type/linked_id) and a saved item *points at* one, but dates,
-- status and titles of project records keep living in their own tables.
-- The calendar (/me/agenda) reads those directly.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID         REFERENCES projects(id) ON DELETE SET NULL,
  -- 'task' (something to do) or 'reminder' (something to be reminded of
  -- at a date and time); same shape, shown differently.
  kind          VARCHAR(10)  NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'reminder')),
  title         VARCHAR(300) NOT NULL,
  description   TEXT,
  notes         TEXT,
  -- Date and optional wall-clock time, interpreted in the user's own
  -- timezone (users.preferences.timezone); a date-only task is due by the
  -- end of that day.
  due_date      DATE,
  due_time      TIME,
  priority      VARCHAR(10)  NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status        VARCHAR(12)  NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  completed_at  TIMESTAMPTZ,
  -- Optional link to the project record this task is about.
  linked_type   VARCHAR(20)  CHECK (linked_type IN ('issue', 'rfi', 'snag', 'qaqc', 'submittal', 'inspection', 'drawing')),
  linked_id     UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT user_tasks_link_check CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_user_due ON user_tasks(user_id, due_date) WHERE status <> 'done';
CREATE INDEX IF NOT EXISTS idx_user_tasks_user_status ON user_tasks(user_id, status);

CREATE TABLE IF NOT EXISTS saved_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID         REFERENCES projects(id) ON DELETE CASCADE,
  item_type     VARCHAR(20)  NOT NULL CHECK (item_type IN ('issue', 'rfi', 'snag', 'qaqc', 'submittal', 'inspection', 'drawing', 'task')),
  item_id       UUID         NOT NULL,
  -- Display label captured when saved, so the list renders without
  -- joining every module; the live record is always one click away.
  label         VARCHAR(300) NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_items_user ON saved_items(user_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_tasks', 'saved_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (' ||
      'CASE WHEN current_setting(''app.current_company_id'', true) = '''' THEN false ' ||
      'ELSE company_id = current_setting(''app.current_company_id'', true)::UUID END)',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS system_bypass ON %I', t);
    EXECUTE format(
      'CREATE POLICY system_bypass ON %I USING (current_setting(''app.system_bypass'', true) = ''true'')',
      t
    );
  END LOOP;
END $$;

-- Grants for app_user come from 052's ALTER DEFAULT PRIVILEGES.

COMMIT;
