-- ══════════════════════════════════════════════════════════════════════════
-- Migration 032 — Snag Activities
--
-- Brings Snagging's backend up to the same workflow richness as Issues: an
-- activity/comment log, reassignment ("forward"), an admin force-status
-- override, and file attachments. issue_activities (migration
-- 001_initial_schema.sql, extended with its attachment_url/attachment_name/
-- attachment_size_bytes columns in 022_issue_reminders_and_attachments.sql)
-- is the reference shape -- snag_activities mirrors it exactly from day
-- one, just keyed off snag_item_id instead of issue_id.
--
-- Purely additive: one new table, one new index. Nothing existing is
-- dropped, renamed, or rewritten.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS snag_activities (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_item_id           UUID         NOT NULL REFERENCES snag_items(id) ON DELETE CASCADE,
  company_id             UUID         NOT NULL REFERENCES companies(id),
  activity_type          VARCHAR(50)  NOT NULL,
  content                TEXT,
  from_value             VARCHAR(255),
  to_value                VARCHAR(255),
  attachment_url         VARCHAR(1000),
  attachment_name        VARCHAR(255),
  attachment_size_bytes  BIGINT,
  performed_by           UUID         NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snag_activities_snag ON snag_activities(snag_item_id, created_at DESC);

INSERT INTO _migrations (filename)
VALUES ('032_snag_activities.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP INDEX IF EXISTS idx_snag_activities_snag;
--   DROP TABLE IF EXISTS snag_activities;
-- ══════════════════════════════════════════════════════════════════════════
