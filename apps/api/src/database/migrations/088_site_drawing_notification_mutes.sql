BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Migration 088: per-drawing "Notify me" toggle (watchers).
--
-- Default stays exactly as it's always been: every project member is
-- notified about every drawing's updates (SiteDrawingsService's own
-- notifyProjectMembers()). This table holds only the EXCEPTIONS -- a row's
-- existence means that one user has explicitly muted that one drawing.
-- No row for a given (drawing, user) pair means "notifying" (the
-- unchanged default); nobody currently relying on today's notifications
-- loses them just because this feature shipped. Re-enabling just deletes
-- the row, rather than flipping a boolean, so the table only ever holds
-- what's actually been touched.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS site_drawing_notification_mutes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES companies(id),
  project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_id   UUID        NOT NULL REFERENCES site_drawings(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (drawing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_site_drawing_notification_mutes_drawing ON site_drawing_notification_mutes(drawing_id);
CREATE INDEX IF NOT EXISTS idx_site_drawing_notification_mutes_user ON site_drawing_notification_mutes(user_id);

-- Same RLS form migration 078 standardized on for every tenant table.
ALTER TABLE site_drawing_notification_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON site_drawing_notification_mutes;
CREATE POLICY tenant_isolation ON site_drawing_notification_mutes USING (
  CASE WHEN current_setting('app.current_company_id', true) = '' THEN false
  ELSE company_id = current_setting('app.current_company_id', true)::UUID END
);

DROP POLICY IF EXISTS system_bypass ON site_drawing_notification_mutes;
CREATE POLICY system_bypass ON site_drawing_notification_mutes
  USING (current_setting('app.system_bypass', true) = 'true');

ALTER TABLE site_drawing_notification_mutes FORCE ROW LEVEL SECURITY;

INSERT INTO _migrations (filename)
VALUES ('088_site_drawing_notification_mutes.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS site_drawing_notification_mutes;
-- ══════════════════════════════════════════════════════════════════════════
