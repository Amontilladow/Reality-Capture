-- ══════════════════════════════════════════════════════════════════════════
-- Migration 084: Notification escalation tracking
--
-- Part of the Centralized Notification & Communication Engine's Phase 4
-- (priority/escalation rules). escalated_at marks a critical,
-- action-required notification that NotificationEscalationService has
-- already bumped up to the recipient's manager, so its cron never
-- escalates the same notification twice.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

-- Matches the existing idx_notifications_user_priority partial index's own
-- reasoning (migration 081): the escalation scan only ever looks at
-- unacknowledged, unescalated rows, so a partial index on exactly that
-- predicate stays small regardless of how many notifications accumulate.
CREATE INDEX IF NOT EXISTS idx_notifications_escalation_scan
  ON notifications(priority, created_at)
  WHERE priority = 'critical' AND action_required = true AND acknowledged_at IS NULL AND escalated_at IS NULL;

INSERT INTO _migrations (filename)
VALUES ('084_notification_escalation.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP INDEX IF EXISTS idx_notifications_escalation_scan;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS escalated_at;
-- ══════════════════════════════════════════════════════════════════════════
