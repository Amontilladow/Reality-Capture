-- ══════════════════════════════════════════════════════════════════════════
-- REPLACE app_bypass_rls (ROLE-BASED) BYPASS WITH A GUC-FLAG-BASED ONE
--
-- URGENT FIX: migration 052 introduced app_bypass_rls, a NOLOGIN BYPASSRLS
-- role that app_user assumes via `SET LOCAL ROLE app_bypass_rls` for the
-- handful of genuinely pre-tenant/cross-tenant system operations (login by
-- email, password reset/invite-accept by token, company registration, the
-- two system crons, RFI external-access token lookup). CREATE ROLE requires
-- CREATEROLE privilege -- confirmed live against this project's own hosted
-- Postgres that its database-owner role does NOT have it (a managed-
-- Postgres platform restriction, not something grantable from inside the
-- database itself). Migration 052's role creation therefore silently (see
-- its own loud WARNING) never succeeds there, which took every one of the
-- operations above down in production the moment the first deploy finally
-- got far enough to actually run that migration (every deploy before that
-- had been failing outright on an unrelated TLS certificate issue, so this
-- gap was never previously exercised).
--
-- Fix: replace the role-based bypass with a session-local GUC flag, which
-- needs no elevated privilege at all. Any ordinary role, including
-- app_user, can SET a custom "app.*" parameter in its own session with no
-- special grant -- this is exactly how app.current_company_id already
-- works in DatabaseService.withTenant(), which has worked correctly in
-- production the whole time. An additional PERMISSIVE policy per RLS-
-- enabled table makes rows visible when app.system_bypass is set to
-- 'true' -- permissive policies for the same command OR together, so this
-- is additive to (not a replacement for) tenant_isolation, scoped the same
-- way BYPASSRLS was: only for the lifetime of the one transaction that
-- explicitly asked for it via SET LOCAL / set_config(..., true), never
-- persisting outside it (same transaction-local behavior
-- app.current_company_id already relies on).
--
-- Plain string comparison (not a cast), unlike tenant_isolation's
-- current_setting(...)::UUID -- so there's no equivalent of the empty-
-- string-GUC-placeholder cast-error quirk documented in migration 052 to
-- guard against here: current_setting('app.system_bypass', true) simply
-- returns NULL or '' when never set, and NULL = 'true' / '' = 'true' are
-- both false, which is exactly the desired default-closed behavior with no
-- special-casing needed.
--
-- app_bypass_rls itself is left alone (no DROP ROLE) -- on an environment
-- where CREATEROLE IS available (e.g. local dev, where it already exists)
-- it's simply unused going forward; dropping it isn't necessary for this
-- fix and isn't worth the extra privileged operation.
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'system_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY system_bypass ON %I USING (current_setting(''app.system_bypass'', true) = ''true'')',
        t
      );
    END IF;
  END LOOP;
END $$;
