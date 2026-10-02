-- ══════════════════════════════════════════════════════════════════════════
-- CLOSE THE RLS-BYPASS-BY-OWNERSHIP GAP
--
-- Migration 001's comment claimed "a bug in application code cannot leak
-- cross-tenant data -- even a raw SQL query with no WHERE clause will only
-- see the current tenant's rows." That was never actually true in
-- production: every deployment this repo ships (render.yaml, docker-
-- compose.prod.yml) runs migrations AND the running application as the
-- exact same DB role, which Postgres therefore makes the OWNER of every
-- table it creates -- and table owners are exempt from their own RLS
-- policies by default, superuser or not. app_user (created by migration
-- 001 specifically to be the real, RLS-subject runtime role) was never
-- granted a single privilege, so nothing could actually connect as it.
--
-- This migration:
--   1. Grants app_user the real privileges its name always implied.
--   2. Adds FORCE ROW LEVEL SECURITY to every RLS-enabled table, so RLS
--      still holds even if a future migration accidentally makes app_user
--      (or any other non-superuser role) an owner of one of these tables.
--   3. Creates a narrow, explicit bypass role for the handful of
--      genuinely pre-tenant/cross-tenant system operations that cannot be
--      scoped to one company_id (login-by-email, password reset by token,
--      invitation accept by token, company self-registration, the
--      overdue-issues cron, the screenshot-retention cron, and the RFI
--      external-access token lookup) -- see DatabaseService.withSystemBypass()
--      for how application code uses it.
--
-- None of this changes which role migrations themselves run as -- that
-- stays whatever DB_MIGRATOR_USER/DB_USER resolves to (see run-migrations.ts),
-- which must remain the tables' owner (or a superuser) to keep running
-- future ALTER/CREATE TABLE migrations.
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Grant app_user real DML privileges on every current and future table.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- Re-apply migration 001's audit_log restriction -- the blanket GRANT above
-- would otherwise silently re-add UPDATE/DELETE that migration 001 revoked.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;

-- 2. FORCE ROW LEVEL SECURITY on every table that already has RLS enabled.
-- (Enforces RLS even against the table owner; harmless no-op for roles that
-- were never going to be the owner in the first place, which is the
-- intended steady state for app_user going forward.)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 3. Narrow escape hatch for genuinely pre-tenant/cross-tenant system reads
-- and writes. NOLOGIN: nothing can connect directly as this role. app_user
-- may only assume it for the duration of a single transaction via
-- `SET LOCAL ROLE app_bypass_rls` (see DatabaseService.withSystemBypass()),
-- after which the transaction ends and the elevated context is gone.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_bypass_rls') THEN
    CREATE ROLE app_bypass_rls NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_bypass_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_bypass_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_bypass_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_bypass_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_bypass_rls;
REVOKE UPDATE, DELETE ON audit_log FROM app_bypass_rls;

GRANT app_bypass_rls TO app_user;

-- 4. Harden every tenant_isolation policy against a real Postgres GUC quirk,
-- confirmed by hand against a live database while validating this migration:
-- a custom runtime parameter like app.current_company_id that has never been
-- read before reports as NULL via current_setting(name, true) (missing_ok),
-- exactly as every policy here already assumes -- but the FIRST time any
-- transaction on a pooled connection sets it with set_config(..., true)
-- (transaction-local), Postgres creates a session-level placeholder for that
-- GUC. Once that placeholder exists, it no longer reports NULL afterwards;
-- it reverts to the placeholder's own default, which for a never-otherwise-
-- set custom string GUC is '' (empty string), not NULL. Every later
-- non-tenant query on that SAME pooled connection -- `this.db.query` or
-- `this.db.withTransaction`, i.e. exactly the operations this migration's
-- app_bypass_rls role exists for -- would then hit `''::UUID`, which errors,
-- rather than simply filtering out all rows the way a NULL comparison does.
-- `original_qual <> ''` as an added AND clause does NOT reliably prevent
-- this: Postgres's planner can split a top-level AND into independently
-- reordered scan quals, so the cast can still execute before the guard
-- clause runs. A CASE expression cannot be split or reordered that way, so
-- it's the only form that reliably skips the cast for an empty string.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
  LOOP
    IF t = 'companies' THEN
      EXECUTE format(
        'ALTER POLICY tenant_isolation ON %I USING (' ||
        'CASE WHEN current_setting(''app.current_company_id'', true) = '''' THEN false ' ||
        'ELSE id = current_setting(''app.current_company_id'', true)::UUID END)',
        t
      );
    ELSE
      EXECUTE format(
        'ALTER POLICY tenant_isolation ON %I USING (' ||
        'CASE WHEN current_setting(''app.current_company_id'', true) = '''' THEN false ' ||
        'ELSE company_id = current_setting(''app.current_company_id'', true)::UUID END)',
        t
      );
    END IF;
  END LOOP;
END $$;
