BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Close the last tenant tables with no row level security at all.
--
-- issue_reminders (migration 022) and the four Site Drawing Hub tables
-- (migration 072) all carry company_id but never received the
-- tenant_isolation policy every other tenant table has. Application code
-- does scope every query on them (withTenant() + WHERE company_id/
-- project_id), but nothing in the database backed that up: one query that
-- forgot its filter would return every company's rows.
--
-- Policies use the same two forms every other tenant table ends up with
-- after migrations 052 and 057:
--   tenant_isolation -- the CASE form from 052 (an empty-string GUC on a
--                       pooled connection must filter rows, not error on
--                       ''::UUID).
--   system_bypass    -- 057's transaction-scoped app.system_bypass flag,
--                       for genuinely cross-tenant work such as
--                       IssueScheduledRemindersService's due-reminder scan
--                       (switched to withSystemBypass() alongside this).
--
-- Also adds FORCE ROW LEVEL SECURITY to every RLS-enabled table that is
-- still missing it. Migration 052 forced only the tables that had RLS at
-- the time; the ones created afterwards (api_keys, email_messages,
-- document_external_shares, ...) were never forced. The runtime role
-- (app_user) isn't their owner, so they were already enforced in practice
-- -- this just keeps RLS holding if ownership ever changes.
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'issue_reminders',
    'site_drawings',
    'site_drawing_revisions',
    'site_drawing_sync_log',
    'site_drawing_offline_packages'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
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

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relrowsecurity = true AND c.relforcerowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

INSERT INTO _migrations (filename)
VALUES ('078_rls_site_drawings_issue_reminders.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   ALTER TABLE issue_reminders               DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE site_drawings                 DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE site_drawing_revisions        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE site_drawing_sync_log         DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE site_drawing_offline_packages DISABLE ROW LEVEL SECURITY;
--   (FORCE on the other tables is harmless to leave in place.)
-- ══════════════════════════════════════════════════════════════════════════
