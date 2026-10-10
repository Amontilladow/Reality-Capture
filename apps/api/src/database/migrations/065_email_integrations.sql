BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Phase 3B — secure backend OAuth infrastructure for Outlook/Gmail connect
--
-- One shared table for both providers (provider column distinguishes rows),
-- not two parallel tables -- the connect/status/disconnect shape is
-- identical between them (EmailTokenStore, email-integration module).
--
-- Token storage deliberately does NOT follow workforce_calendar_integrations'
-- precedent (plaintext access_token/refresh_token columns). That table's own
-- migration comment already flags this as the thing not to copy forward (see
-- common/crypto/credential-encryption.service.ts's header comment) -- tokens
-- here are stored the same way user_ai_connections' API keys are: AES-256-GCM
-- ciphertext + IV + auth tag per secret, decryptable only by the API process
-- holding CREDENTIAL_ENCRYPTION_KEY, never readable as plaintext from SQL
-- alone even with full database access.
--
-- connected_email is the actual mailbox address granted (confirmed via the
-- provider's own "who am I" endpoint after token exchange, not assumed from
-- the login email) -- this is what the brief's "Connected account" UI field
-- shows, and what the future email composer's "From" must match server-side.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_integrations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id                     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                    VARCHAR(20)  NOT NULL, -- 'microsoft' | 'google'
  connected_email             VARCHAR(320) NOT NULL,
  scopes                      TEXT         NOT NULL, -- space-separated, exactly what the provider granted (not what was requested)
  access_token_ciphertext     TEXT         NOT NULL,
  access_token_iv             TEXT         NOT NULL,
  access_token_auth_tag       TEXT         NOT NULL,
  refresh_token_ciphertext    TEXT         NOT NULL,
  refresh_token_iv            TEXT         NOT NULL,
  refresh_token_auth_tag      TEXT         NOT NULL,
  token_expires_at            TIMESTAMPTZ  NOT NULL,
  -- Set on a failed refresh/send attempt (e.g. 'invalid_grant' meaning the
  -- user revoked consent at the provider) and cleared on the next success --
  -- getStatus() derives 'authorization_required' vs 'error' vs
  -- 'connection_expired' from this plus token_expires_at rather than storing
  -- a separately-maintained status enum that could drift from reality.
  last_error_code             VARCHAR(50),
  last_error_at               TIMESTAMPTZ,
  connected_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  connected_by                UUID REFERENCES users(id),
  last_used_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_email_integrations_company ON email_integrations(company_id);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY['email_integrations'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.current_company_id'', true)::UUID)',
      t
    );
  END LOOP;
END $$;

INSERT INTO _migrations (filename) VALUES ('065_email_integrations.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
