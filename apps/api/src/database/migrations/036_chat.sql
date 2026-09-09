BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLES: chat_dm_channels, chat_messages, chat_reads
-- Live, real-time team chat (Socket.io) — deliberately separate from the
-- existing async, threaded/subject-based "messaging" feature
-- (apps/api/src/modules/messaging/, tables `messages` / `message_recipients`).
-- This is a running conversation with no subject/thread concept: one
-- channel per project (channel_type='project', channel_id=projects.id) plus
-- one channel per 1-to-1 direct-message pair (channel_type='dm',
-- channel_id=chat_dm_channels.id). Do not merge with or reuse the
-- `messages` tables.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chat_dm_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  user_a_id   UUID NOT NULL REFERENCES users(id),
  user_b_id   UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_a_id < user_b_id),
  UNIQUE (user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  channel_type  VARCHAR(10) NOT NULL,  -- 'project' | 'dm'
  channel_id    UUID NOT NULL,          -- a project_id (channel_type='project') or a chat_dm_channels.id (channel_type='dm')
  from_user_id  UUID NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_type, channel_id, created_at);

CREATE TABLE IF NOT EXISTS chat_reads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id),
  channel_type   VARCHAR(10) NOT NULL,
  channel_id     UUID NOT NULL,
  user_id        UUID NOT NULL REFERENCES users(id),
  last_read_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_type, channel_id, user_id)
);

ALTER TABLE chat_dm_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chat_dm_channels;
CREATE POLICY tenant_isolation ON chat_dm_channels
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chat_messages;
CREATE POLICY tenant_isolation ON chat_messages
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

ALTER TABLE chat_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chat_reads;
CREATE POLICY tenant_isolation ON chat_reads
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename) VALUES ('036_chat.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
