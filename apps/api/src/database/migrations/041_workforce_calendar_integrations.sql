BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Workforce Intelligence™ — Google Calendar integration
--
-- DeskTime's own description: "DeskTime can integrate with calendar apps
-- to help you track offline time." Scoped deliberately narrow for this
-- pass: OAuth connect/disconnect + a live "today's events" read at request
-- time. Does NOT write calendar events into `activities` or factor them
-- into productivity scoring -- that would need real idempotency/dedup
-- design (a re-run must not double-count the same calendar event) and
-- this integration has never been exercised against a live Google account,
-- so it stays a read-only, additive view for now. A natural, explicitly
-- deferred follow-on, not an oversight.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workforce_calendar_integrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          VARCHAR(30)  NOT NULL DEFAULT 'google_calendar',
  access_token      TEXT         NOT NULL,
  refresh_token     TEXT         NOT NULL,
  token_expires_at  TIMESTAMPTZ  NOT NULL,
  connected_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  connected_by      UUID REFERENCES users(id),
  -- Last time this integration successfully round-tripped to Google (an
  -- events/today read), not a "last full sync" -- there is no sync job.
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_integrations_company ON workforce_calendar_integrations(company_id);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY['workforce_calendar_integrations'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.current_company_id'', true)::UUID)',
      t
    );
  END LOOP;
END $$;

INSERT INTO _migrations (filename) VALUES ('041_workforce_calendar_integrations.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
