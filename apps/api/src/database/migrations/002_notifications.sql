BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: notifications
-- Replaces the "notification queued (Phase 2)" log-only stub in
-- IssuesService with a real, polled, in-app notification. Delivery is
-- honestly scoped to in-app/polling only — email/push are not wired to a
-- provider yet and are not faked here.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(50)  NOT NULL,
  title         VARCHAR(500) NOT NULL,
  body          TEXT,
  resource_type VARCHAR(50),
  resource_id   UUID,
  read_at       TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_all
  ON notifications(user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename) VALUES ('002_notifications.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
