-- issue_reminders (migration 022) was always an immediate-send log --
-- broadcastReminder()/userReminder() insert a row and fire it in the same
-- step. This adds the ability to schedule a reminder for a specific issue
-- at a future date/time instead:
--
-- scheduled_for: when the reminder should fire. NULL for every existing
-- (and every future immediate) row -- those aren't scheduled, they already
-- happened.
-- sent_at: when it actually fired. Backfilled to created_at for all
-- existing rows (every one of them was sent immediately, at insert time).
-- NULL means "scheduled but not yet fired" -- that's the row IssueScheduled
-- RemindersService's cron looks for.
ALTER TABLE issue_reminders
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ;

UPDATE issue_reminders SET sent_at = created_at WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_issue_reminders_due
  ON issue_reminders(scheduled_for)
  WHERE scheduled_for IS NOT NULL AND sent_at IS NULL;
