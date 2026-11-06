BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Centralized Notification & Communication Engine, Phase 1: upgrade the
-- existing in-app notifications table rather than building a parallel one.
-- `type` (migration 002) stays the fine-grained event name every caller
-- already sets (e.g. 'issue_assigned', 'rfi_overdue'); `category` is the
-- coarser grouping the notification center's filter UI and future
-- per-category channel preferences need (drawings/issues/ncr/sor/rfi/
-- assignment/approval/deadline/announcement) -- a many-types-to-one-category
-- mapping, not a replacement for `type`.
--
-- `priority` exists because "send critical notifications through every
-- enabled channel immediately" (master spec section 6) needs a value to
-- branch on; defaults to 'normal' so every existing caller keeps working
-- unchanged until it's updated to pass a real priority.
--
-- `acknowledged_at` is deliberately separate from `read_at`: opening the
-- dropdown marks a notification read, but section 6's escalation rules need
-- a distinct "a human confirmed they will act on this" signal a read alone
-- doesn't give. `action_required` flags which notifications that even
-- applies to.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS priority         VARCHAR(10) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS action_required  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_at  TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE notifications ADD CONSTRAINT notifications_priority_check
    CHECK (priority IN ('normal', 'high', 'critical'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_category ON notifications(user_id, category);
CREATE INDEX IF NOT EXISTS idx_notifications_user_priority ON notifications(user_id, priority) WHERE read_at IS NULL;

INSERT INTO _migrations (filename)
VALUES ('081_notification_engine.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   ALTER TABLE notifications DROP COLUMN IF EXISTS category;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS priority;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS action_required;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS acknowledged_at;
-- ══════════════════════════════════════════════════════════════════════════
