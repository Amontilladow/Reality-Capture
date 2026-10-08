-- CTO spec section 5/7/23: Bring-Your-Own-AI. A user can connect their own
-- provider credentials; RealityCapture's Gateway (domain guard, tool
-- authorization, project isolation, usage logging) still applies exactly
-- as it does for RealityCapture's own provider -- BYO AI changes WHO pays
-- for the model call, never WHAT the model is allowed to see or do.

-- One active connection per user (not per company -- this is explicitly a
-- personal credential, matching the spec's "My AI Provider" framing, not a
-- company-wide setting). api_key_ciphertext/iv/auth_tag are AES-256-GCM
-- output from the new CredentialEncryptionService
-- (common/crypto/credential-encryption.service.ts) -- never the plaintext
-- key. base_url is only meaningful for 'custom_openai_compatible' and
-- 'ollama' (self-hosted/enterprise endpoints); null for the hosted
-- providers.
CREATE TABLE IF NOT EXISTS user_ai_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_id           UUID         NOT NULL REFERENCES companies(id),
  provider             VARCHAR(30)  NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini', 'custom_openai_compatible', 'ollama')),
  model                VARCHAR(100) NOT NULL,
  base_url             TEXT,
  api_key_ciphertext   TEXT         NOT NULL,
  api_key_iv           TEXT         NOT NULL,
  api_key_auth_tag     TEXT         NOT NULL,
  -- Last four characters only, for the settings UI to show "...a1b2" without
  -- ever decrypting the key just to display something -- the API key itself
  -- is never sent back to the frontend after it's first submitted.
  api_key_last4        VARCHAR(4)   NOT NULL,
  last_validated_at    TIMESTAMPTZ,
  last_validation_error TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ai_connections_company ON user_ai_connections(company_id);

ALTER TABLE user_ai_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_ai_connections;
CREATE POLICY tenant_isolation ON user_ai_connections
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

-- Which "brain" actually answered this request -- 'realitycapture' (the
-- platform's own configured provider) or 'byo' (the requesting user's own
-- connection). Lets the future usage dashboard split cost/volume by mode;
-- NULL for rows written before this column existed.
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS ai_mode VARCHAR(20) CHECK (ai_mode IN ('realitycapture', 'byo'));
