BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Workforce Intelligence™ — screenshot capture pipeline
-- Deliberately gated: workforce_privacy_settings.screenshot_enabled
-- defaults to false (set in 037) and this table only ever fills once a
-- company_admin explicitly turns it on. The enforcement point is in
-- ScreenshotsService (checked before ever issuing an upload URL, and
-- re-checked before recording), not here -- this migration only adds
-- storage for rows that enforcement already allowed to be created.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workforce_screenshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     UUID REFERENCES devices(id) ON DELETE SET NULL,
  storage_key   VARCHAR(500) NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workforce_screenshots_user_captured ON workforce_screenshots(company_id, user_id, captured_at DESC);

ALTER TABLE workforce_screenshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workforce_screenshots;
CREATE POLICY tenant_isolation ON workforce_screenshots
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename) VALUES ('039_workforce_screenshots.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
