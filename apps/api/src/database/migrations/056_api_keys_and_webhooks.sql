-- ══════════════════════════════════════════════════════════════════════════
-- Migration 056 — Public API keys and outbound webhooks (F3)
--
-- api_keys: per-tenant (company_id) credentials for the new Public API.
-- Looked up by exact hash equality, same pattern as refresh_tokens
-- (auth.service.ts hashToken()) -- SHA-256 of the raw secret, not
-- argon2/bcrypt, because this needs an O(1) indexed lookup against every
-- inbound request, not a one-row password verify. key_prefix is stored
-- only for display ("rc_live_a1b2c3d4...") -- never used for lookup.
--
-- webhook_endpoints: a tenant's subscription to outbound event delivery.
-- `secret` is stored in the clear (unlike api_keys.key_hash) because it
-- must be read back on every delivery to compute an HMAC signature --
-- hashing it would make it useless for that purpose. This is the same
-- category of secret as a Stripe/GitHub webhook signing secret.
--
-- webhook_deliveries: one row per (endpoint, event) delivery attempt,
-- retried with backoff by a Bull worker (see webhook-delivery.processor.ts).
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  key_prefix    VARCHAR(16) NOT NULL,
  key_hash      VARCHAR(255) NOT NULL UNIQUE,
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[],
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_company ON api_keys(company_id);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url           VARCHAR(2048) NOT NULL,
  secret        VARCHAR(128) NOT NULL,
  event_types   TEXT[] NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_company ON webhook_endpoints(company_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  webhook_endpoint_id   UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type            VARCHAR(100) NOT NULL,
  payload               JSONB NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts              INTEGER NOT NULL DEFAULT 0,
  last_attempted_at     TIMESTAMPTZ,
  last_response_status  INTEGER,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries(webhook_endpoint_id, created_at DESC);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_keys;
CREATE POLICY tenant_isolation ON api_keys
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhook_endpoints;
CREATE POLICY tenant_isolation ON webhook_endpoints
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename)
VALUES ('056_api_keys_and_webhooks.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS webhook_deliveries;
--   DROP TABLE IF EXISTS webhook_endpoints;
--   DROP TABLE IF EXISTS api_keys;
-- ══════════════════════════════════════════════════════════════════════════
