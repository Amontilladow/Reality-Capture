-- ══════════════════════════════════════════════════════════════════════════
-- QAQC NCR/SOR/WIR/MIR -- one shared table with a record_type discriminator
-- ('ncr' | 'sor' | 'wir' | 'mir'), mirroring the precedent issues.issue_type
-- already set (one issues table, several conceptually different issueType
-- values). Deliberately NOT four tables/modules -- see qaqc.service.ts for
-- the shared service.
--
-- Distinct from the pre-existing qa_inspections table/module (scheduled
-- pass/fail checklist inspections, "QA Inspections" nav tab) -- that
-- feature is untouched by this migration and this feature. NCR
-- (non-conformance report), SOR (site observation report), WIR (work
-- inspection request), and MIR (material inspection request) are all
-- RFI-shaped records: issued by a restricted role, responded by one set of
-- roles and then confirmed by a different, narrower set, with attachments
-- and a PDF export -- not a checklist.
--
-- record_number mirrors rfis.rfiNumber's generated-sequence idea but
-- scoped per (project, record_type) rather than (project, discipline) --
-- each of NCR/SOR/WIR/MIR gets its own independent sequence on a project
-- (NCR-001, SOR-001, WIR-001, MIR-001, ... never sharing a counter). See
-- QaqcService.generateRecordNumber().
--
-- discipline reuses the existing RFI_DISCIPLINES vocabulary from
-- packages/types (civil/structural/architectural/.../other) -- no new
-- discipline values were needed.
--
-- status is a two-step close, mirroring RfisService's submitForReview()/
-- decideReview() 'responded' -> 'under_review' -> 'closed'/back shape, same
-- pattern with the roles swapped (QAQC opens instead of being the final
-- approver; QAQC confirms instead of opening):
--   'open'                 -- issued by QAQC, awaiting a response.
--   'pending_confirmation' -- construction/PM/director/engineering has
--                             responded and believes it's resolved; waiting
--                             on QAQC's confirmation.
--   'closed'               -- QAQC confirmed. Terminal.
--   'reopened'              -- QAQC rejected the response and sent it back.
--                             Functionally equivalent to 'open' (can be
--                             responded to again) but kept distinct in the
--                             status/audit history so it's visible that
--                             this record bounced once already.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS qaqc_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  record_type          VARCHAR(10) NOT NULL CHECK (record_type IN ('ncr', 'sor', 'wir', 'mir')),
  record_number        VARCHAR(50),
  subject              VARCHAR(500) NOT NULL,
  description          TEXT NOT NULL,
  discipline           VARCHAR(20) NOT NULL,
  discipline_other     VARCHAR(255),
  priority             VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status               VARCHAR(25) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','pending_confirmation','closed','reopened')),
  location_id          UUID REFERENCES locations(id),
  assigned_to          UUID REFERENCES users(id),
  due_date             DATE,
  response             TEXT,
  responded_by         UUID REFERENCES users(id),
  responded_at         TIMESTAMPTZ,
  confirmation_comment TEXT,
  issued_by            UUID NOT NULL REFERENCES users(id),
  confirmed_by         UUID REFERENCES users(id),
  confirmed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qaqc_records_project ON qaqc_records(project_id, record_type);

CREATE TABLE IF NOT EXISTS qaqc_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qaqc_id       UUID NOT NULL REFERENCES qaqc_records(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES companies(id),
  kind          VARCHAR(20) NOT NULL DEFAULT 'issue' CHECK (kind IN ('issue', 'response')),
  -- Reuses RFI_DOCUMENT_TYPES' vocabulary (drawing/specification/
  -- method_statement/calculation/schedule/contract/email/site_instruction/
  -- submittal/other, etc.) -- null/omitted for a quick "+Add photo" pick,
  -- since those go through qaqc_captures (linked Captures) instead, not
  -- through this generic-document table. See create-qaqc-attachment flow.
  document_type VARCHAR(30),
  storage_key   VARCHAR(500) NOT NULL,
  filename      VARCHAR(255) NOT NULL,
  size_bytes    BIGINT NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qaqc_attachments_record ON qaqc_attachments(qaqc_id);

-- Links a QAQC record to real Captures, same shape/purpose as issue_captures
-- (migration 001) -- the "+Add photo" quick picker uploads a real Capture
-- (captureType: 'photo_standard') so it also shows up in the project's
-- Captures grid, then links it here, rather than storing it as a bare
-- qaqc_attachments row. kind distinguishes a photo taken when the record
-- was raised ('issue') from one taken when responding ('response'), same
-- split as qaqc_attachments.kind.
CREATE TABLE IF NOT EXISTS qaqc_captures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qaqc_id     UUID NOT NULL REFERENCES qaqc_records(id) ON DELETE CASCADE,
  capture_id  UUID NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id),
  kind        VARCHAR(20) NOT NULL DEFAULT 'issue' CHECK (kind IN ('issue', 'response')),
  caption     TEXT,
  added_by    UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(qaqc_id, capture_id)
);
CREATE INDEX IF NOT EXISTS idx_qaqc_captures_record ON qaqc_captures(qaqc_id);

-- Tenant-isolation RLS, same CASE-guarded shape migration 053 hardened
-- every pre-existing tenant table with (never a plain `AND` -- the planner
-- can split/reorder a top-level AND inside USING, so only the CASE
-- expression reliably avoids casting an empty-string GUC placeholder to
-- UUID on a pooled connection that previously ran a withSystemBypass/
-- withTransaction query), applied here from day one since these tables are
-- new rather than a retrofit.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['qaqc_records', 'qaqc_attachments', 'qaqc_captures']
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
-- 'sor'/'wir'/'mir' must be added to it before RiskGraphService/
-- RelationshipExtractionService can register a node of any of these types.
-- ADD VALUE IF NOT EXISTS as bare top-level statements (not inside a DO
-- block or an explicit transaction), matching this repo's own established
-- pattern for every prior enum addition (e.g. 059_snag_verify_permission.sql).
ALTER TYPE risk_node_type ADD VALUE IF NOT EXISTS 'ncr';
ALTER TYPE risk_node_type ADD VALUE IF NOT EXISTS 'sor';
ALTER TYPE risk_node_type ADD VALUE IF NOT EXISTS 'wir';
ALTER TYPE risk_node_type ADD VALUE IF NOT EXISTS 'mir';
