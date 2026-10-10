-- ══════════════════════════════════════════════════════════════════════════
-- QAQC NCR/SOR -- one shared table with a record_type discriminator
-- ('ncr' | 'sor'), mirroring the precedent issues.issue_type already set
-- (one issues table, several conceptually different issueType values) and
-- the user's own framing ("SOR, the exact same thing" as NCR). Deliberately
-- NOT two tables/modules -- see qaqc.service.ts for the shared service.
--
-- Distinct from the pre-existing qa_inspections table/module (scheduled
-- pass/fail checklist inspections, "QA Inspections" nav tab) -- that
-- feature is untouched by this migration and this feature. NCR
-- (non-conformance report) and SOR (site observation report) are
-- RFI-shaped records: issued by a restricted role, responded/closed by a
-- different restricted role, with attachments and a PDF export -- not a
-- checklist.
--
-- record_number mirrors rfis.rfiNumber's generated-sequence idea but
-- scoped per (project, record_type) rather than (project, discipline) --
-- each of NCR/SOR gets its own independent sequence on a project
-- (NCR-001, NCR-002, ... and SOR-001, SOR-002, ... never sharing a
-- counter). See QaqcService.generateRecordNumber().
--
-- discipline reuses the existing RFI_DISCIPLINES vocabulary from
-- packages/types (civil/structural/architectural/.../other) -- no new
-- discipline values were needed for NCR/SOR.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS qaqc_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  record_type         VARCHAR(10) NOT NULL CHECK (record_type IN ('ncr', 'sor')),
  record_number       VARCHAR(50),
  subject             VARCHAR(500) NOT NULL,
  description         TEXT NOT NULL,
  discipline          VARCHAR(20) NOT NULL,
  discipline_other    VARCHAR(255),
  priority            VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status              VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','closed','void')),
  location_id         UUID REFERENCES locations(id),
  assigned_to         UUID REFERENCES users(id),
  due_date            DATE,
  response            TEXT,
  issued_by           UUID NOT NULL REFERENCES users(id),
  closed_by           UUID REFERENCES users(id),
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qaqc_records_project ON qaqc_records(project_id, record_type);

CREATE TABLE IF NOT EXISTS qaqc_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qaqc_id     UUID NOT NULL REFERENCES qaqc_records(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id),
  kind        VARCHAR(20) NOT NULL DEFAULT 'issue' CHECK (kind IN ('issue', 'response')),
  storage_key VARCHAR(500) NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  size_bytes  BIGINT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qaqc_attachments_record ON qaqc_attachments(qaqc_id);

-- Tenant-isolation RLS, same CASE-guarded shape migration 053 hardened
-- every pre-existing tenant table with (never a plain `AND` -- the planner
-- can split/reorder a top-level AND inside USING, so only the CASE
-- expression reliably avoids casting an empty-string GUC placeholder to
-- UUID on a pooled connection that previously ran a withSystemBypass/
-- withTransaction query), applied here from day one since these two
-- tables are new rather than a retrofit.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['qaqc_records', 'qaqc_attachments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (' ||
      'CASE WHEN current_setting(''app.current_company_id'', true) = '''' THEN false ' ||
      'ELSE company_id = current_setting(''app.current_company_id'', true)::UUID END)',
      t
    );
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Risk Engine integration (brief section 6): risk_graph_nodes.node_type is a
-- native Postgres enum (migration 050), not a free-text column -- 'ncr'/
-- 'sor' must be added to it before RiskGraphService/RelationshipExtractionService
-- can register a node of either type. ADD VALUE IF NOT EXISTS as bare
-- top-level statements (not inside a DO block or an explicit transaction),
-- matching this repo's own established pattern for every prior enum
-- addition (e.g. 059_snag_verify_permission.sql).
ALTER TYPE risk_node_type ADD VALUE IF NOT EXISTS 'ncr';
ALTER TYPE risk_node_type ADD VALUE IF NOT EXISTS 'sor';
