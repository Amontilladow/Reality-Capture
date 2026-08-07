-- Ticket 2b: workflow-actions layer on top of ticket 2a's schema/DTO work.
-- Two independent additive pieces:
--
-- 1. issue_reminders -- a log of reminder broadcasts/per-user sends, so the
--    "Reminders" tab has something to list. issue_id is nullable because a
--    broadcast reminder fans out to every open issue in the project (one
--    row per affected issue is inserted by the service, so issue_id is
--    always populated in practice for both broadcast and per-user sends --
--    it's kept nullable at the schema level only to allow a future
--    project-wide-with-no-issue-target reminder type without another
--    migration). sent_to is nullable for the same reason: a broadcast
--    reminder doesn't target one specific user.
--
-- 2. issue_activities gets three new nullable columns for direct file
--    attachments (presigned-PUT pattern, same as documents/captures --
--    the API never touches the file bytes). No new table needed since an
--    attachment is always hung off a single activity entry, same shape as
--    issue_captures already does for photos.

CREATE TABLE IF NOT EXISTS issue_reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id    UUID REFERENCES issues(id) ON DELETE CASCADE,
  sent_by     UUID        NOT NULL REFERENCES users(id),
  sent_to     UUID REFERENCES users(id),
  message     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issue_reminders_project ON issue_reminders(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_reminders_issue   ON issue_reminders(issue_id);

ALTER TABLE issue_activities
  ADD COLUMN IF NOT EXISTS attachment_url         VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS attachment_name         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS attachment_size_bytes   BIGINT;
