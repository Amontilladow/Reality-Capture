BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Workforce Intelligence™ — MVP schema
-- See docs/workforce-intelligence-data-model.md for full rationale.
--
-- activity_type / application_registry.category /
-- application_registry.discipline / activity_project_attributions.method
-- are VARCHAR, not enum types, by design: they're validated at the API
-- layer against extensible `const` arrays in packages/types so new values
-- never require a migration (see the data model doc's "Extensibility
-- decisions" section).
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: devices
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform            VARCHAR(20)  NOT NULL,
  hostname            VARCHAR(255),
  device_fingerprint  VARCHAR(255),
  agent_version       VARCHAR(50),
  enrolled_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ,
  is_active           BOOLEAN      NOT NULL DEFAULT true,
  revoked_at          TIMESTAMPTZ,
  revoked_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_company ON devices(company_id);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: application_registry
-- Per-company, admin-managed. No global rows -- each company populates
-- its own (brief: "configurable rather than hard-coded").
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS application_registry (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                        VARCHAR(255) NOT NULL,
  match_pattern               VARCHAR(255) NOT NULL,
  category                    VARCHAR(100),
  discipline                  VARCHAR(100),
  productivity_classification VARCHAR(20)  NOT NULL DEFAULT 'unclassified',
  engineering_relevance       BOOLEAN      NOT NULL DEFAULT false,
  is_active                   BOOLEAN      NOT NULL DEFAULT true,
  created_by                  UUID REFERENCES users(id),
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, match_pattern)
);

CREATE INDEX IF NOT EXISTS idx_application_registry_company ON application_registry(company_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: activities  (raw telemetry -- insert-only)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id             UUID REFERENCES devices(id) ON DELETE SET NULL,
  client_event_id       VARCHAR(255),
  application_id        UUID REFERENCES application_registry(id) ON DELETE SET NULL,
  application_name_raw  VARCHAR(255) NOT NULL,
  domain                VARCHAR(255),
  activity_type         VARCHAR(50)  NOT NULL,
  started_at            TIMESTAMPTZ  NOT NULL,
  ended_at              TIMESTAMPTZ  NOT NULL,
  duration_seconds      INTEGER      NOT NULL,
  source                VARCHAR(20)  NOT NULL DEFAULT 'agent',
  confidence            NUMERIC(4,3),
  raw_metadata          JSONB        NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT activities_duration_check CHECK (ended_at >= started_at)
);

-- Idempotency guarantee for retried ingestion batches (brief: duplicate
-- events must be a no-op, not a duplicate row). Partial because
-- manual/seed rows carry neither device_id nor client_event_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_device_client_event
  ON activities(device_id, client_event_id)
  WHERE device_id IS NOT NULL AND client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_company_user_started
  ON activities(company_id, user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_application ON activities(application_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: activity_project_attributions
-- One current attribution per activity -- revisable without ever mutating
-- the immutable activities row it points to.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_project_attributions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  activity_id    UUID         NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  project_id     UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  confidence     NUMERIC(4,3) NOT NULL,
  method         VARCHAR(50)  NOT NULL,
  evidence       JSONB        NOT NULL DEFAULT '{}',
  attributed_by  UUID REFERENCES users(id),
  attributed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_attributions_project ON activity_project_attributions(project_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: productivity_scores  (derived, versioned, recalculable)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS productivity_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id        UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
  period_type    VARCHAR(10)   NOT NULL,
  period_start   DATE          NOT NULL,
  period_end     DATE          NOT NULL,
  score          NUMERIC(5,2)  NOT NULL,
  factors        JSONB         NOT NULL,
  model_version  VARCHAR(20)   NOT NULL,
  calculated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productivity_scores_lookup
  ON productivity_scores(company_id, user_id, period_type, period_start);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: workforce_privacy_settings  (one row per company)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workforce_privacy_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID         NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  monitoring_level    VARCHAR(20)  NOT NULL DEFAULT 'standard',
  screenshot_enabled  BOOLEAN      NOT NULL DEFAULT false,
  retention_days      INTEGER      NOT NULL DEFAULT 90,
  self_view_enabled   BOOLEAN      NOT NULL DEFAULT true,
  updated_by          UUID REFERENCES users(id),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY -- identical pattern to migration 001
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'devices','application_registry','activities',
    'activity_project_attributions','productivity_scores',
    'workforce_privacy_settings'
  ];
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

-- ══════════════════════════════════════════════════════════════════════════
-- Subscription gating -- additive, matches how 'bim'/'ai' flags were added.
-- Off by default on every existing tier; on for professional/business/
-- enterprise, matching the tier where 'bim'/'ai' are already enabled.
-- ══════════════════════════════════════════════════════════════════════════
UPDATE subscription_plans
SET feature_flags = feature_flags || '{"workforce": false}'::JSONB
WHERE NOT (feature_flags ? 'workforce');

UPDATE subscription_plans
SET feature_flags = feature_flags || '{"workforce": true}'::JSONB
WHERE tier IN ('professional', 'business', 'enterprise');

INSERT INTO _migrations (filename) VALUES ('037_workforce_intelligence.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
