-- ══════════════════════════════════════════════════════════════════════════
-- ADD MISSING RLS TO rfis, submittals, transmittals, qa_inspections,
-- snag_items, AND snag_activities
--
-- These six multi-tenant tables (each with a NOT NULL company_id column)
-- never received ENABLE ROW LEVEL SECURITY / CREATE POLICY in migrations
-- 014-018 or 032, while every one of their own child tables did (e.g.
-- rfi_attachments, rfi_comments, rfi_external_access). Every current query
-- against these six tables already includes an explicit company_id filter
-- tied to the caller's authenticated company, so this closes a missing
-- database-level backstop rather than an active leak -- but
-- rfis.service.ts's create() comment incorrectly claims rfis "carries the
-- tenant_isolation RLS policy, same as every other table"; that comment is
-- corrected below alongside the actual fix.
--
-- Written against the post-052 world: app_user/app_bypass_rls already hold
-- DML privileges on these (pre-existing) tables via migration 052's blanket
-- `GRANT ... ON ALL TABLES IN SCHEMA public` and
-- `ALTER DEFAULT PRIVILEGES ... ON TABLES`, so no additional GRANT is
-- needed here. FORCE ROW LEVEL SECURITY is applied explicitly per table
-- below, since 052's own FORCE-everything loop only ran once, against
-- whatever already had RLS enabled at that time -- these six tables didn't
-- yet, so they weren't caught by it. The tenant_isolation policy uses the
-- same CASE-guarded form migration 052 hardened every other policy with
-- (never a plain `AND`), for the identical reason: a top-level AND inside a
-- USING clause can be split and reordered by the planner, so only a CASE
-- expression reliably avoids casting an empty-string GUC placeholder to
-- UUID on a pooled connection that previously ran a withSystemBypass/
-- withTransaction query.
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['rfis', 'submittals', 'transmittals', 'qa_inspections', 'snag_items', 'snag_activities']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (' ||
      'CASE WHEN current_setting(''app.current_company_id'', true) = '''' THEN false ' ||
      'ELSE company_id = current_setting(''app.current_company_id'', true)::UUID END)',
      t
    );
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
