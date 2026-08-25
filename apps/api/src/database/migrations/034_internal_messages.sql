BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLES: messages, message_recipients
-- Internal (in-app only) messaging: users compose messages to each other,
-- with reply threads and an inbox. No outbound email sending yet -- the
-- schema is designed so a future email-delivery step can be added later
-- without restructuring (MessagingService.create()/reply() are the sole
-- choke points where a `messages` row is inserted).
--
-- `messages.id` deliberately has NO `DEFAULT gen_random_uuid()`: the first
-- message in a thread sets `thread_id` equal to its own `id` in the SAME
-- INSERT, so the app generates the UUID (via Node's crypto.randomUUID())
-- and passes it explicitly to both columns.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY,
  company_id    UUID NOT NULL REFERENCES companies(id),
  project_id    UUID REFERENCES projects(id),
  thread_id     UUID NOT NULL REFERENCES messages(id),
  subject       VARCHAR(500) NOT NULL,
  body          TEXT NOT NULL,
  from_user_id  UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_message_recipients_user_unread ON message_recipients(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messages;
CREATE POLICY tenant_isolation ON messages
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

ALTER TABLE message_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON message_recipients;
CREATE POLICY tenant_isolation ON message_recipients
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename) VALUES ('034_internal_messages.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
