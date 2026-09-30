-- ══════════════════════════════════════════════════════════════════════════
-- Migration 051 — Risk Engine (risks, signals, evidence, snapshots, history)
--
-- Builds the deterministic Risk entity (brief section 16) on top of the
-- Project Risk Graph added in migration 050. A Risk is always anchored to
-- a real graph node (root_node_id) -- either the single entity it centers
-- on (an RFI, an Issue) or a location node when the risk represents a
-- cluster rather than one entity.
--
-- Automated vs override scoring (section 36): `automated_score`/
-- `automated_level` are written only by the calculation engine and are
-- never overwritten by a user action. `override_score`/`override_level`/
-- `override_by`/`override_at`/`override_reason` are a separate, optional
-- layer a user can set. `score`/`level` are the *effective* values the
-- application keeps in sync (override if present, else automated) so
-- every other table (evidence, snapshots) and the UI can read one column
-- without re-deriving it, while the automated calculation is never lost.
--
-- Risk confidence (section 38) is stored separately from risk severity --
-- `confidence_level`/`confidence_reason` say how much the assessment
-- itself should be trusted (e.g. a risk built mostly from inferred, low-
-- confidence graph edges), independent of how severe the score says the
-- risk is.
--
-- risk_signals stores every measurable signal (brief section 9) that fed
-- into a risk, `signal_type` is a plain VARCHAR validated against a
-- constant list in application code (packages/types) rather than a
-- Postgres enum, since the signal catalog is expected to grow steadily as
-- more real project data sources are connected -- unlike node/relationship
-- types, which are structural and rarely change.
--
-- risk_evidence is the clickable Risk -> Evidence -> original record path
-- (section 15): each row points at one risk_graph_nodes row, which in turn
-- points at one real domain row.
--
-- risk_snapshots is the historical time-series (section 18) -- one row per
-- meaningful recalculation, read-only after insert, used for trend charts.
-- Never backfilled with fabricated history: a project's trend chart is
-- only as long as the snapshots that actually exist.
--
-- risk_status_history is the lifecycle audit trail (section 17), append-
-- only, `changed_by IS NULL` meaning the automated engine made the change.
--
-- Purely additive: five new tables, RLS applied the same way as migration
-- 050. Nothing existing is touched.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS risks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_node_id        UUID NOT NULL UNIQUE REFERENCES risk_graph_nodes(id) ON DELETE CASCADE,

  title               VARCHAR(500) NOT NULL,
  category            VARCHAR(64) NOT NULL,
  discipline          VARCHAR(64),
  location_node_id    UUID REFERENCES risk_graph_nodes(id) ON DELETE SET NULL,
  location_label      VARCHAR(255),

  automated_score     SMALLINT NOT NULL CHECK (automated_score BETWEEN 0 AND 100),
  automated_level     VARCHAR(16) NOT NULL CHECK (automated_level IN ('LOW','MODERATE','HIGH','CRITICAL')),
  override_score      SMALLINT CHECK (override_score BETWEEN 0 AND 100),
  override_level      VARCHAR(16) CHECK (override_level IN ('LOW','MODERATE','HIGH','CRITICAL')),
  override_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  override_at         TIMESTAMPTZ,
  override_reason     TEXT,

  score               SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  level               VARCHAR(16) NOT NULL CHECK (level IN ('LOW','MODERATE','HIGH','CRITICAL')),

  probability         SMALLINT NOT NULL CHECK (probability BETWEEN 0 AND 100),
  impact              SMALLINT NOT NULL CHECK (impact BETWEEN 0 AND 100),
  exposure            SMALLINT NOT NULL CHECK (exposure BETWEEN 0 AND 100),
  dependency          SMALLINT NOT NULL CHECK (dependency BETWEEN 0 AND 100),
  urgency             SMALLINT NOT NULL CHECK (urgency BETWEEN 0 AND 100),
  recurrence          SMALLINT NOT NULL CHECK (recurrence BETWEEN 0 AND 100),

  confidence_level    VARCHAR(16) NOT NULL CHECK (confidence_level IN ('HIGH','MODERATE','LOW')),
  confidence_reason   TEXT,

  trend               VARCHAR(16) NOT NULL DEFAULT 'NEW' CHECK (trend IN ('NEW','INCREASING','STABLE','DECREASING')),
  status              VARCHAR(24) NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED','ACTIVE','MITIGATION_IN_PROGRESS','RESOLVED','CLOSED')),

  owner_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date            TIMESTAMPTZ,

  explanation         TEXT,
  recommended_action  TEXT,

  first_detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_calculated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risks_project_status ON risks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_risks_project_level ON risks(project_id, level);
CREATE INDEX IF NOT EXISTS idx_risks_owner ON risks(owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS risk_signals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id               UUID NOT NULL REFERENCES risk_graph_nodes(id) ON DELETE CASCADE,
  risk_id               UUID REFERENCES risks(id) ON DELETE SET NULL,
  signal_type           VARCHAR(64) NOT NULL,
  severity_contribution SMALLINT NOT NULL CHECK (severity_contribution BETWEEN 0 AND 100),
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  details               JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_risk_signals_project ON risk_signals(project_id, signal_type);
CREATE INDEX IF NOT EXISTS idx_risk_signals_risk ON risk_signals(risk_id) WHERE risk_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS risk_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_id     UUID NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  node_id     UUID NOT NULL REFERENCES risk_graph_nodes(id) ON DELETE CASCADE,
  role        VARCHAR(48) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (risk_id, node_id, role)
);

CREATE INDEX IF NOT EXISTS idx_risk_evidence_risk ON risk_evidence(risk_id);

CREATE TABLE IF NOT EXISTS risk_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_id         UUID NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  score           SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  level           VARCHAR(16) NOT NULL CHECK (level IN ('LOW','MODERATE','HIGH','CRITICAL')),
  probability     SMALLINT NOT NULL,
  impact          SMALLINT NOT NULL,
  exposure        SMALLINT NOT NULL,
  dependency      SMALLINT NOT NULL,
  urgency         SMALLINT NOT NULL,
  recurrence      SMALLINT NOT NULL,
  major_signals   JSONB NOT NULL DEFAULT '[]'::JSONB,
  graph_exposure  JSONB NOT NULL DEFAULT '{}'::JSONB,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_snapshots_risk_time ON risk_snapshots(risk_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_project_time ON risk_snapshots(project_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS risk_status_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_id      UUID NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  from_status  VARCHAR(24),
  to_status    VARCHAR(24) NOT NULL,
  changed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reason       TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_status_history_risk ON risk_status_history(risk_id, changed_at DESC);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'risks', 'risk_signals', 'risk_evidence', 'risk_snapshots', 'risk_status_history'
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

INSERT INTO _migrations (filename)
VALUES ('051_risk_engine.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS risk_status_history;
--   DROP TABLE IF EXISTS risk_snapshots;
--   DROP TABLE IF EXISTS risk_evidence;
--   DROP TABLE IF EXISTS risk_signals;
--   DROP TABLE IF EXISTS risks;
-- ══════════════════════════════════════════════════════════════════════════
