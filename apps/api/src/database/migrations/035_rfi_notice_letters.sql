BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: rfi_notice_letters
-- One formal notice letter per RFI (UNIQUE (rfi_id) enforces this), created
-- as a draft and then "shared" -- shared delivery goes through the internal
-- messaging feature (messages/message_recipients, see 034_internal_messages.sql)
-- so the recipient's inbox becomes the audit trail proving the letter was
-- sent. status/shared_at/shared_by track that delivery; editing an already-
-- shared letter's text does not reset these (see RfisService.upsertNoticeLetter).
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rfi_notice_letters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  project_id        UUID NOT NULL REFERENCES projects(id),
  rfi_id            UUID NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  recipient_title   VARCHAR(100) NOT NULL,
  body              TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',
  shared_at         TIMESTAMPTZ,
  shared_by         UUID REFERENCES users(id),
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfi_id)
);

CREATE INDEX IF NOT EXISTS idx_rfi_notice_letters_rfi ON rfi_notice_letters(rfi_id);

ALTER TABLE rfi_notice_letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rfi_notice_letters;
CREATE POLICY tenant_isolation ON rfi_notice_letters
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename) VALUES ('035_rfi_notice_letters.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
