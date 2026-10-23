BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Drawing Intelligence & Control — bulk ZIP/PDF ingestion + metadata
-- extraction (Phases 2-4 of the M4 brief).
--
-- document_classification is a column deliberately SEPARATE from
-- workflow_status (the brief's own Decision 2): approval (workflow_status),
-- revision currency (is_superseded, already its own column since migration
-- 072), and document classification (this column) are three different
-- questions. A FINAL/AS_BUILT drawing can be APPROVED and still not be the
-- current construction drawing -- see isConfirmedCurrent()'s new guard in
-- site-drawing-workflow.ts. Every existing row (and every future row this
-- migration doesn't touch) defaults to 'CONSTRUCTION', the neutral,
-- no-claim value -- nothing is retroactively classified as FINAL/AS_BUILT
-- without real evidence.
--
-- extraction_status/extracted_fields_raw/import_batch_id support the new
-- extraction pipeline (Phase 3): a field extracted from a title block is a
-- SUGGESTION, never written straight to the authoritative drawing_number/
-- drawing_title/revision_number columns without going through
-- 'CONFIRMED' (extraction's own confidence, not a human yet) or an
-- authorized user's explicit correction. extracted_fields_raw keeps the
-- ORIGINAL extracted values (even after a human edits the authoritative
-- fields), so what the system actually read is always auditable.
-- ══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE site_drawing_document_classification_enum AS ENUM ('CONSTRUCTION', 'FINAL', 'AS_BUILT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CONFIRMED: matched a known title-block pattern with the embedded text
-- layer, high confidence. NEEDS_REVIEW: OCR fallback was used, or no
-- pattern matched, or confidence fell below threshold. CONFLICT: two
-- extraction attempts disagreed, or this drawing number already exists in
-- the project under a materially different title (a possible drawing-
-- number mismatch, per the brief). MANUAL: a human typed the values
-- directly (the existing Local-upload path) -- there was never anything to
-- extract, so this is not a lower-confidence state, just a different origin.
DO $$ BEGIN
  CREATE TYPE site_drawing_extraction_status_enum AS ENUM ('CONFIRMED', 'NEEDS_REVIEW', 'CONFLICT', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE site_drawing_import_batch_status_enum AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: site_drawing_import_batches (one row per uploaded ZIP or single
-- PDF -- brief section 2: "store import batch identifiers, timestamps,
-- source information and the uploading user")
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS site_drawing_import_batches (
  id                 UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID            NOT NULL REFERENCES companies(id),
  project_id         UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Which system the consultant-issued files originally came from, per the
  -- brief's own "identify its source, such as Aconex, Procore or another
  -- source" -- reuses doc_source_enum (documents.source_system's own type),
  -- same convention site_drawings.source_provider already follows.
  source_system      doc_source_enum NOT NULL DEFAULT 'manual_link',
  -- The ORIGINAL uploaded archive/file, preserved untouched (brief: "preserve
  -- the original consultant-issued files") -- never overwritten or
  -- repacked, even though each extracted PDF also gets its own storage key.
  original_filename  VARCHAR(500)    NOT NULL,
  storage_key        VARCHAR(1000)   NOT NULL,
  status             site_drawing_import_batch_status_enum NOT NULL DEFAULT 'PENDING',
  file_count         INTEGER         NOT NULL DEFAULT 0,
  created_count      INTEGER         NOT NULL DEFAULT 0,
  revision_count     INTEGER         NOT NULL DEFAULT 0,
  skipped_count      INTEGER         NOT NULL DEFAULT 0,
  error_count        INTEGER         NOT NULL DEFAULT 0,
  -- A human-readable summary only -- never a secret, and never raw document
  -- content, same rule site_drawing_sync_log.error_message already follows.
  error_message      TEXT,
  uploaded_by         UUID            NOT NULL REFERENCES users(id),
  started_at          TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_drawing_import_batches_project ON site_drawing_import_batches(project_id, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY['site_drawing_import_batches'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.current_company_id'', true)::UUID)',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS system_bypass ON %I', t);
    EXECUTE format(
      'CREATE POLICY system_bypass ON %I USING (current_setting(''app.system_bypass'', true) = ''true'')',
      t
    );
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- site_drawing_revisions additions
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS
  document_classification site_drawing_document_classification_enum NOT NULL DEFAULT 'CONSTRUCTION';
ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS suitability_code VARCHAR(100);
ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS
  extraction_status site_drawing_extraction_status_enum NOT NULL DEFAULT 'MANUAL';
ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS extracted_fields_raw JSONB;
ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS
  import_batch_id UUID REFERENCES site_drawing_import_batches(id);
-- A human-entered note explaining a CONFLICT/NEEDS_REVIEW flag, or an
-- authorized user's resolution of one -- surfaced in the register's review
-- queue (brief section 4).
ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS review_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_site_drawing_revisions_extraction_status ON site_drawing_revisions(project_id, extraction_status);
CREATE INDEX IF NOT EXISTS idx_site_drawing_revisions_import_batch ON site_drawing_revisions(import_batch_id);

INSERT INTO _migrations (filename) VALUES ('075_site_drawing_import_batches.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
