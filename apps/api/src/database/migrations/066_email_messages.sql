BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Phase 3E/3G — outgoing email audit trail
--
-- Deliberately metadata-only -- the brief's own Section 8 field list
-- (company/project/record IDs, initiating user, sender account, recipient
-- metadata, subject, provider, provider message/thread IDs, timestamp,
-- result, failure reason, attachment metadata) never includes the message
-- BODY. The real message lives in the user's own mailbox (Sent Items) --
-- this table is a pointer/audit record to it, not a copy of it. This is a
-- deliberate reading of "do not silently import an entire mailbox" and "do
-- not expose private mailbox contents to other project members": project
-- members see that a message was sent, to whom, about what subject, and
-- whether it succeeded -- not its content.
--
-- project_id is NOT NULL -- every field in the brief's own example workflow
-- (Section 7) is project-scoped ("EngineeringOS prepares a message using
-- the RFI's existing data... the relevant authorized project members can
-- see the communication history"); an email with no project context has
-- nowhere for that visibility rule to apply.
--
-- related_record_type/id are nullable -- Section 7's workflow names RFI as
-- the example, but Section 7's module list is broader (issues, snagging,
-- submittals, drawings, documents, "project communications" generally),
-- and a general project-communication email may have no single record to
-- attach to.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id            UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  related_record_type   VARCHAR(30), -- 'rfi' | 'issue' | 'snag_item' | 'submittal' | NULL
  related_record_id     UUID,
  initiating_user_id    UUID         NOT NULL REFERENCES users(id),
  provider              VARCHAR(20)  NOT NULL, -- 'microsoft' | 'google'
  sender_email          VARCHAR(320) NOT NULL,
  recipients_to         JSONB        NOT NULL, -- ["a@example.com", ...]
  recipients_cc         JSONB        NOT NULL DEFAULT '[]'::JSONB,
  recipients_bcc        JSONB        NOT NULL DEFAULT '[]'::JSONB,
  subject               TEXT         NOT NULL,
  provider_message_id   TEXT,
  thread_id             TEXT,
  status                VARCHAR(20)  NOT NULL, -- 'sent' | 'failed'
  failure_reason        TEXT,                  -- never a raw provider error body / never a secret -- see EmailSendingService's own comment
  attachment_metadata   JSONB        NOT NULL DEFAULT '[]'::JSONB, -- [{filename, sizeBytes, contentType}], never file content
  -- Client-generated per compose-and-send attempt (Section 6: "prevent
  -- accidental duplicate sends when users retry after a timeout"). The
  -- UNIQUE constraint below is the actual enforcement -- a retried request
  -- with the same key hits a conflict instead of sending twice.
  idempotency_key       VARCHAR(100) NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (initiating_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_email_messages_project ON email_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_related_record ON email_messages(related_record_type, related_record_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_company ON email_messages(company_id);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY['email_messages'];
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

INSERT INTO _migrations (filename) VALUES ('066_email_messages.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
