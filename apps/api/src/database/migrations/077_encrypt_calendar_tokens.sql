BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Fix H-4 (KNOWN_ISSUES_AND_REMEDIATION.md): Google Calendar OAuth tokens
-- were stored in plaintext in workforce_calendar_integrations.access_token/
-- refresh_token -- unlike email_integrations (065_email_integrations.sql),
-- which has used CredentialEncryptionService's AES-256-GCM scheme from the
-- start. This migration is purely additive: it adds the same
-- ciphertext/iv/auth_tag column triplet per token that email_integrations
-- already uses, and relaxes the old plaintext columns to nullable so new
-- writes (CalendarIntegrationService, updated alongside this migration) can
-- stop populating them. It does NOT touch, re-encrypt, or null out any
-- existing row's plaintext value -- a legacy row keeps working exactly as
-- before (the application layer reads plaintext when the ciphertext
-- columns are NULL) until it next writes (a token refresh or a reconnect),
-- at which point it's written encrypted and the plaintext columns are
-- cleared for that row. No backfill script, no forced re-encryption pass,
-- nothing destructive -- the presence/absence of *_ciphertext IS the
-- legacy-vs-encrypted marker, so no separate version column is needed.
--
-- A later, separate migration can drop the now-unused plaintext columns
-- once every row has naturally rotated to the encrypted ones (or after a
-- one-time, explicitly-approved backfill) -- deliberately not done here.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE workforce_calendar_integrations
  ALTER COLUMN access_token DROP NOT NULL,
  ALTER COLUMN refresh_token DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS access_token_ciphertext  TEXT,
  ADD COLUMN IF NOT EXISTS access_token_iv           TEXT,
  ADD COLUMN IF NOT EXISTS access_token_auth_tag     TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_ciphertext  TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_iv           TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_auth_tag     TEXT;

INSERT INTO _migrations (filename) VALUES ('077_encrypt_calendar_tokens.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
