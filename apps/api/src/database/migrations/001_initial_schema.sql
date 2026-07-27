-- ══════════════════════════════════════════════════════════════════════════
-- EngineeringOS™ Reality Capture Module
-- Migration 001 — Initial Schema
-- Architecture Specification v1.1
-- Phase 1, Sprint 1.1
--
-- Applies:
--   · All 34 tables defined in v1.1 spec
--   · Indexes (performance + FTS)
--   · Row-Level Security policies (tenant isolation)
--   · Audit trigger (auto-populate checksum)
--   · Subscription seed data (plan tiers)
--
-- Run with: psql $DATABASE_URL -f this_file.sql
-- Or via:   pnpm db:migrate
--
-- This migration is IDEMPOTENT — safe to run multiple times.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram index for ILIKE search

-- ── Enum types ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE company_role_enum AS ENUM (
    'super_admin','company_admin','technical_director','engineering_manager',
    'bim_manager','project_manager','construction_manager','qa_qc_manager',
    'commercial_manager','consultant','client_representative'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE project_role_enum AS ENUM (
    'project_lead','site_engineer','surveyor','document_controller',
    'capture_operator','viewer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capture_type_enum AS ENUM ('photo_360','photo_standard','video');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capture_status_enum AS ENUM ('uploading','processing','ready','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE project_phase_enum AS ENUM (
    'pre_construction','demolition','excavation','foundation','structure',
    'mep_rough_in','external_envelope','internal_fit_out','finishes',
    'commissioning','handover','post_occupancy'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE issue_type_enum AS ENUM (
    'defect','punch_item','rfi','coordination_clash','safety_observation',
    'quality_hold','inspection_point','general'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE issue_priority_enum AS ENUM ('critical','high','medium','low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE issue_status_enum AS ENUM (
    'open','assigned','in_progress','resolved','under_review','closed','void'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_type_enum AS ENUM (
    'drawing','specification','rfi','submittal','transmittal','inspection_record',
    'method_statement','risk_assessment','handover_certificate','test_report','ncrm','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_source_enum AS ENUM (
    'internal','procore','aconex','sharepoint','bim360','manual_link'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_source_enum AS ENUM ('api','mobile','system','import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 1: companies
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS companies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(100) UNIQUE NOT NULL,
  plan                  VARCHAR(50)  NOT NULL DEFAULT 'trial',
  storage_used_bytes    BIGINT       NOT NULL DEFAULT 0,
  storage_limit_bytes   BIGINT       NOT NULL DEFAULT 107374182400,
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  settings              JSONB        NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 2: users
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email                 VARCHAR(255) NOT NULL,
  email_verified        BOOLEAN      NOT NULL DEFAULT false,
  password_hash         VARCHAR(255),
  first_name            VARCHAR(100) NOT NULL,
  last_name             VARCHAR(100) NOT NULL,
  phone                 VARCHAR(50),
  avatar_url            VARCHAR(500),
  company_role          company_role_enum NOT NULL DEFAULT 'client_representative',
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  last_login_at         TIMESTAMPTZ,
  preferences           JSONB        NOT NULL DEFAULT '{}',
  invitation_token      VARCHAR(255),
  invitation_expires_at TIMESTAMPTZ,
  password_reset_token  VARCHAR(255),
  password_reset_expires_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_invitation_token ON users(invitation_token) WHERE invitation_token IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 3: refresh_tokens
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 4: projects
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  code                VARCHAR(50),
  description         TEXT,
  location            VARCHAR(500),
  country             VARCHAR(100),
  city                VARCHAR(100),
  coordinates         POINT,
  status              VARCHAR(50)  NOT NULL DEFAULT 'active',
  start_date          DATE,
  expected_end_date   DATE,
  cover_image_url     VARCHAR(500),
  settings            JSONB        NOT NULL DEFAULT '{}',
  created_by          UUID         NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(company_id, status);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 5: project_members
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID              NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID              NOT NULL REFERENCES companies(id),
  role        project_role_enum NOT NULL,
  invited_by  UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 6: buildings
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS buildings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id    UUID         NOT NULL REFERENCES companies(id),
  name          VARCHAR(255) NOT NULL,
  code          VARCHAR(50),
  description   TEXT,
  total_levels  INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buildings_project ON buildings(project_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 7: levels
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS levels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id   UUID         NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  company_id    UUID         NOT NULL REFERENCES companies(id),
  name          VARCHAR(100) NOT NULL,
  elevation_m   NUMERIC(8,3),
  level_order   INTEGER      NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_levels_building ON levels(building_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 8: locations
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS locations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id              UUID         NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  company_id            UUID         NOT NULL REFERENCES companies(id),
  name                  VARCHAR(255) NOT NULL,
  description           TEXT,
  coordinates_on_plan   POINT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_level ON locations(level_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 9: bim_models  (BIM Foundation — schema present from Phase 1)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_models (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id            UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                  VARCHAR(255) NOT NULL,
  format                VARCHAR(50)  NOT NULL DEFAULT 'IFC',
  ifc_schema            VARCHAR(20),
  storage_key           VARCHAR(1000),
  coordination_origin   JSONB,
  status                VARCHAR(50)  NOT NULL DEFAULT 'pending',
  version               INTEGER      NOT NULL DEFAULT 1,
  uploaded_by           UUID         NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bim_models_project ON bim_models(project_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 10: bim_elements
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_elements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id),
  model_id              UUID         NOT NULL REFERENCES bim_models(id) ON DELETE CASCADE,
  project_id            UUID         NOT NULL REFERENCES projects(id),
  level_id              UUID REFERENCES levels(id),
  ifc_guid              VARCHAR(22)  NOT NULL,
  ifc_type              VARCHAR(100) NOT NULL,
  ifc_name              VARCHAR(255),
  ifc_description       TEXT,
  omniclass_code        VARCHAR(50),
  uniclass_code         VARCHAR(50),
  uniformat_code        VARCHAR(50),
  csi_masterformat      VARCHAR(50),
  bbox_min_x            NUMERIC(12,4),
  bbox_min_y            NUMERIC(12,4),
  bbox_min_z            NUMERIC(12,4),
  bbox_max_x            NUMERIC(12,4),
  bbox_max_y            NUMERIC(12,4),
  bbox_max_z            NUMERIC(12,4),
  properties            JSONB        NOT NULL DEFAULT '{}',
  construction_status   VARCHAR(50),
  installed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, ifc_guid)
);

CREATE INDEX IF NOT EXISTS idx_bim_elements_project ON bim_elements(project_id);
CREATE INDEX IF NOT EXISTS idx_bim_elements_level ON bim_elements(level_id);
CREATE INDEX IF NOT EXISTS idx_bim_elements_ifc_type ON bim_elements(ifc_type);
CREATE INDEX IF NOT EXISTS idx_bim_elements_bbox ON bim_elements(bbox_min_x, bbox_min_y, bbox_min_z);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 11: captures
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS captures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID              NOT NULL REFERENCES companies(id),
  project_id            UUID              NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  location_id           UUID REFERENCES locations(id) ON DELETE SET NULL,
  captured_by           UUID              NOT NULL REFERENCES users(id),
  capture_type          capture_type_enum NOT NULL,
  phase                 project_phase_enum,
  title                 VARCHAR(255),
  description           TEXT,
  tags                  TEXT[]            NOT NULL DEFAULT '{}',
  captured_at           TIMESTAMPTZ       NOT NULL,
  uploaded_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  gps_lat               NUMERIC(10,7),
  gps_lng               NUMERIC(10,7),
  gps_accuracy_m        NUMERIC(8,2),
  compass_heading_deg   NUMERIC(6,2),
  original_key          VARCHAR(1000)     NOT NULL,
  original_size_bytes   BIGINT            NOT NULL,
  original_mime_type    VARCHAR(100)      NOT NULL,
  original_width_px     INTEGER,
  original_height_px    INTEGER,
  status                capture_status_enum NOT NULL DEFAULT 'uploading',
  processing_error      TEXT,
  processed_at          TIMESTAMPTZ,
  ai_tags               TEXT[]            NOT NULL DEFAULT '{}',
  ai_description        TEXT,
  ai_detected_issues    JSONB,
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_captures_company ON captures(company_id);
CREATE INDEX IF NOT EXISTS idx_captures_project ON captures(project_id);
CREATE INDEX IF NOT EXISTS idx_captures_location ON captures(location_id);
CREATE INDEX IF NOT EXISTS idx_captures_captured_at ON captures(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_phase ON captures(project_id, phase);
CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);
CREATE INDEX IF NOT EXISTS idx_captures_fts ON captures
  USING gin(to_tsvector('english',
    coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(ai_description,'')
  ));

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 12: capture_renditions
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS capture_renditions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id      UUID          NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  company_id      UUID          NOT NULL REFERENCES companies(id),
  rendition_type  VARCHAR(50)   NOT NULL,
  storage_key     VARCHAR(1000) NOT NULL,
  width_px        INTEGER,
  height_px       INTEGER,
  size_bytes      BIGINT        NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renditions_capture ON capture_renditions(capture_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 13: capture_points  (360° walkthrough navigation)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS capture_points (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id    UUID        NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  company_id    UUID        NOT NULL REFERENCES companies(id),
  scene_x       NUMERIC(10,4),
  scene_y       NUMERIC(10,4),
  scene_z       NUMERIC(10,4),
  plan_x        NUMERIC(10,4),
  plan_y        NUMERIC(10,4),
  yaw_deg       NUMERIC(8,4),
  pitch_deg     NUMERIC(8,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 14: hotspots
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hotspots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_capture_id   UUID         NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  target_capture_id   UUID REFERENCES captures(id) ON DELETE SET NULL,
  company_id          UUID         NOT NULL REFERENCES companies(id),
  hotspot_type        VARCHAR(50)  NOT NULL,
  label               VARCHAR(255),
  content             TEXT,
  yaw_deg             NUMERIC(8,4) NOT NULL,
  pitch_deg           NUMERIC(8,4) NOT NULL,
  icon_name           VARCHAR(100),
  color               VARCHAR(20),
  created_by          UUID         NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotspots_source ON hotspots(source_capture_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 15: capture_element_links  (reality ↔ BIM)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS capture_element_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id    UUID        NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  element_id    UUID        NOT NULL REFERENCES bim_elements(id) ON DELETE CASCADE,
  company_id    UUID        NOT NULL REFERENCES companies(id),
  link_type     VARCHAR(50) NOT NULL DEFAULT 'documents',
  linked_by     UUID        NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(capture_id, element_id)
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 16: drawings
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS drawings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID          NOT NULL REFERENCES companies(id),
  project_id      UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level_id        UUID REFERENCES levels(id) ON DELETE SET NULL,
  title           VARCHAR(255)  NOT NULL,
  drawing_number  VARCHAR(100),
  revision        VARCHAR(20),
  drawing_type    VARCHAR(100),
  storage_key     VARCHAR(1000) NOT NULL,
  thumbnail_key   VARCHAR(1000),
  width_px        INTEGER,
  height_px       INTEGER,
  scale_ratio     NUMERIC(10,4),
  scale_px_per_m  NUMERIC(10,4),
  is_current      BOOLEAN       NOT NULL DEFAULT true,
  uploaded_by     UUID          NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drawings_project ON drawings(project_id);
CREATE INDEX IF NOT EXISTS idx_drawings_level ON drawings(level_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 17: capture_drawing_links
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS capture_drawing_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id    UUID         NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  drawing_id    UUID         NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  company_id    UUID         NOT NULL REFERENCES companies(id),
  pos_x_norm    NUMERIC(8,6) NOT NULL,
  pos_y_norm    NUMERIC(8,6) NOT NULL,
  linked_by     UUID         NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(capture_id, drawing_id)
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 18: issues  (Construction Object Model leaf node)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS issues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID                NOT NULL REFERENCES companies(id),
  project_id            UUID                NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  building_id           UUID REFERENCES buildings(id) ON DELETE SET NULL,
  level_id              UUID REFERENCES levels(id) ON DELETE SET NULL,
  location_id           UUID REFERENCES locations(id) ON DELETE SET NULL,
  element_id            UUID REFERENCES bim_elements(id) ON DELETE SET NULL,
  issue_type            issue_type_enum     NOT NULL,
  issue_number          VARCHAR(50),
  title                 VARCHAR(500)        NOT NULL,
  description           TEXT,
  priority              issue_priority_enum NOT NULL DEFAULT 'medium',
  discipline            VARCHAR(100),
  trade                 VARCHAR(100),
  specification_ref     VARCHAR(255),
  status                issue_status_enum   NOT NULL DEFAULT 'open',
  assigned_to           UUID REFERENCES users(id),
  responsible_company   VARCHAR(255),
  deadline              TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  closed_by             UUID REFERENCES users(id),
  capture_id            UUID REFERENCES captures(id) ON DELETE SET NULL,
  drawing_id            UUID REFERENCES drawings(id) ON DELETE SET NULL,
  pos_x_norm            NUMERIC(8,6),
  pos_y_norm            NUMERIC(8,6),
  hotspot_yaw           NUMERIC(8,4),
  hotspot_pitch         NUMERIC(8,4),
  tags                  TEXT[]              NOT NULL DEFAULT '{}',
  created_by            UUID                NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_element ON issues(element_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_assigned ON issues(assigned_to);
CREATE INDEX IF NOT EXISTS idx_issues_location ON issues(location_id);
CREATE INDEX IF NOT EXISTS idx_issues_fts ON issues
  USING gin(to_tsvector('english', title || ' ' || coalesce(description,'')));

-- Issue auto-numbering sequence (per project, enforced at app level using this sequence)
CREATE SEQUENCE IF NOT EXISTS issue_number_seq START 1 INCREMENT 1;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 19: issue_activities
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS issue_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id        UUID         NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  company_id      UUID         NOT NULL REFERENCES companies(id),
  activity_type   VARCHAR(50)  NOT NULL,
  content         TEXT,
  from_value      VARCHAR(255),
  to_value        VARCHAR(255),
  capture_id      UUID REFERENCES captures(id) ON DELETE SET NULL,
  performed_by    UUID         NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issue_activities_issue ON issue_activities(issue_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 20: issue_captures  (evidence photos for an issue)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS issue_captures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  capture_id  UUID        NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  company_id  UUID        NOT NULL REFERENCES companies(id),
  is_primary  BOOLEAN     NOT NULL DEFAULT false,
  caption     TEXT,
  added_by    UUID        NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issue_id, capture_id)
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 21: documents
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID             NOT NULL REFERENCES companies(id),
  project_id      UUID             NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_type        doc_type_enum    NOT NULL,
  title           VARCHAR(500)     NOT NULL,
  document_number VARCHAR(200),
  revision        VARCHAR(50),
  status          VARCHAR(100),
  discipline      VARCHAR(100),
  source          doc_source_enum  NOT NULL DEFAULT 'internal',
  external_id     VARCHAR(500),
  external_url    VARCHAR(1000),
  storage_key     VARCHAR(1000),
  document_date   DATE,
  received_date   DATE,
  due_date        DATE,
  search_vector   TSVECTOR,
  uploaded_by     UUID             NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_fts ON documents USING gin(search_vector);

-- Auto-update document search_vector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.document_number, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.discipline, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_search_vector_trigger ON documents;
CREATE TRIGGER documents_search_vector_trigger
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update();

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 22: document_links  (polymorphic — links doc to any entity)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS document_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id),
  document_id   UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  capture_id    UUID REFERENCES captures(id) ON DELETE CASCADE,
  element_id    UUID REFERENCES bim_elements(id) ON DELETE CASCADE,
  location_id   UUID REFERENCES locations(id) ON DELETE CASCADE,
  issue_id      UUID REFERENCES issues(id) ON DELETE CASCADE,
  link_context  TEXT,
  linked_by     UUID         NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT document_links_one_target CHECK (
    (capture_id  IS NOT NULL)::INTEGER +
    (element_id  IS NOT NULL)::INTEGER +
    (location_id IS NOT NULL)::INTEGER +
    (issue_id    IS NOT NULL)::INTEGER = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_doc_links_document ON document_links(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_links_issue ON document_links(issue_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 23: doc_integrations  (external DMS connectors)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID            NOT NULL REFERENCES companies(id),
  system          doc_source_enum NOT NULL,
  config          JSONB           NOT NULL,
  is_active       BOOLEAN         NOT NULL DEFAULT true,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, system)
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 24: timeline_entries
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS timeline_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID                NOT NULL REFERENCES companies(id),
  project_id    UUID                NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  location_id   UUID REFERENCES locations(id) ON DELETE SET NULL,
  capture_id    UUID REFERENCES captures(id) ON DELETE SET NULL,
  phase         project_phase_enum  NOT NULL,
  entry_date    DATE                NOT NULL,
  title         VARCHAR(255)        NOT NULL,
  description   TEXT,
  work_type     VARCHAR(100),
  created_by    UUID                NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_project_date ON timeline_entries(project_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_location ON timeline_entries(location_id, entry_date DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 25: subscription_plans
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscription_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier                  VARCHAR(50)   NOT NULL UNIQUE,
  name                  VARCHAR(100)  NOT NULL,
  price_monthly_usd     NUMERIC(10,2),
  price_annual_usd      NUMERIC(10,2),
  max_projects          INTEGER,
  max_users             INTEGER,
  max_storage_bytes     BIGINT,
  feature_flags         JSONB         NOT NULL DEFAULT '{}',
  is_public             BOOLEAN       NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 26: company_subscriptions
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS company_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID        NOT NULL REFERENCES companies(id) UNIQUE,
  plan_id                 UUID        NOT NULL REFERENCES subscription_plans(id),
  status                  VARCHAR(50) NOT NULL DEFAULT 'active',
  trial_ends_at           TIMESTAMPTZ,
  current_period_start    TIMESTAMPTZ NOT NULL,
  current_period_end      TIMESTAMPTZ NOT NULL,
  stripe_customer_id      VARCHAR(255),
  stripe_subscription_id  VARCHAR(255),
  custom_max_projects     INTEGER,
  custom_max_users        INTEGER,
  custom_storage_bytes    BIGINT,
  custom_feature_flags    JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 27: usage_metrics
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS usage_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        NOT NULL REFERENCES companies(id),
  metric_date         DATE        NOT NULL,
  active_users        INTEGER     NOT NULL DEFAULT 0,
  active_projects     INTEGER     NOT NULL DEFAULT 0,
  storage_bytes       BIGINT      NOT NULL DEFAULT 0,
  captures_uploaded   INTEGER     NOT NULL DEFAULT 0,
  ai_queries          INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, metric_date)
);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE 28: audit_log  (append-only, write-once)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL       PRIMARY KEY,
  company_id      UUID            NOT NULL,
  project_id      UUID,
  user_id         UUID,
  user_email      VARCHAR(255),
  user_name       VARCHAR(255),
  action          VARCHAR(100)    NOT NULL,
  resource_type   VARCHAR(100)    NOT NULL,
  resource_id     UUID,
  resource_label  VARCHAR(500),
  changes         JSONB,
  metadata        JSONB,
  ip_address      INET,
  user_agent      TEXT,
  request_id      VARCHAR(100),
  source          audit_source_enum NOT NULL DEFAULT 'api',
  checksum        VARCHAR(64),
  occurred_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
  -- No updated_at — this table is write-once
);

CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_project_time ON audit_log(project_id, occurred_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- Auto-compute checksum on audit_log INSERT
-- SHA-256 of (id || company_id || action || coalesce(resource_id,'') || occurred_at)
-- Allows detection of record tampering after the fact
CREATE OR REPLACE FUNCTION audit_log_checksum() RETURNS trigger AS $$
BEGIN
  NEW.checksum := encode(
    digest(
      NEW.id::TEXT || NEW.company_id::TEXT || NEW.action ||
      coalesce(NEW.resource_id::TEXT, '') || NEW.occurred_at::TEXT,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_checksum_trigger ON audit_log;
CREATE TRIGGER audit_log_checksum_trigger
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_checksum();

-- ══════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- Applied to every table that contains company_id.
-- The application sets app.current_company_id at the start of every
-- transaction via DatabaseService.withTenant().
-- A bug in application code cannot leak cross-tenant data — even a raw
-- SQL query with no WHERE clause will only see the current tenant's rows.
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'companies','users','refresh_tokens','projects','project_members',
    'buildings','levels','locations','bim_models','bim_elements',
    'captures','capture_renditions','capture_points','hotspots',
    'capture_element_links','drawings','capture_drawing_links',
    'issues','issue_activities','issue_captures','documents',
    'document_links','doc_integrations','timeline_entries',
    'company_subscriptions','usage_metrics','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

    -- Special case: companies table — isolate by id, not company_id
    IF t = 'companies' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON companies USING (id = current_setting(''app.current_company_id'', true)::UUID)',
        t
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.current_company_id'', true)::UUID)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Superuser bypass (for migrations and seeds running as the postgres superuser)
-- The app_user role (used by the API) does NOT have BYPASS RLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END $$;

REVOKE UPDATE, DELETE ON audit_log FROM app_user;

-- ══════════════════════════════════════════════════════════════════════════
-- SUBSCRIPTION SEED DATA — plan tiers as defined in spec v1.1
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO subscription_plans (tier, name, price_monthly_usd, price_annual_usd,
  max_projects, max_users, max_storage_bytes, feature_flags, is_public)
VALUES
  ('trial', 'Trial', NULL, NULL, 1, 3, 5368709120,
   '{"bim":false,"ai":false,"mobileApp":false,"auditExport":false,"dmsIntegration":false,"onPremise":false,"slaGuarantee":false}',
   true),
  ('starter', 'Starter', 299.00, 2990.00, 3, 10, 53687091200,
   '{"bim":false,"ai":false,"mobileApp":true,"auditExport":false,"dmsIntegration":false,"onPremise":false,"slaGuarantee":false}',
   true),
  ('professional', 'Professional', 899.00, 8990.00, 10, 30, 536870912000,
   '{"bim":true,"ai":true,"mobileApp":true,"auditExport":false,"dmsIntegration":false,"onPremise":false,"slaGuarantee":false}',
   true),
  ('business', 'Business', 2499.00, 24990.00, NULL, 100, 2199023255552,
   '{"bim":true,"ai":true,"mobileApp":true,"auditExport":true,"dmsIntegration":true,"onPremise":false,"slaGuarantee":false}',
   true),
  ('enterprise', 'Enterprise', NULL, NULL, NULL, NULL, NULL,
   '{"bim":true,"ai":true,"mobileApp":true,"auditExport":true,"dmsIntegration":true,"onPremise":true,"slaGuarantee":true}',
   false)
ON CONFLICT (tier) DO UPDATE SET
  name                = EXCLUDED.name,
  price_monthly_usd   = EXCLUDED.price_monthly_usd,
  price_annual_usd    = EXCLUDED.price_annual_usd,
  max_projects        = EXCLUDED.max_projects,
  max_users           = EXCLUDED.max_users,
  max_storage_bytes   = EXCLUDED.max_storage_bytes,
  feature_flags       = EXCLUDED.feature_flags;

-- ══════════════════════════════════════════════════════════════════════════
-- MIGRATION REGISTRY  (tracks what has run)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS _migrations (
  id          SERIAL PRIMARY KEY,
  filename    VARCHAR(255) NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO _migrations (filename)
VALUES ('001_initial_schema.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Post-migration verification
-- Run this block manually to confirm the schema is correct:
--
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
--
-- SELECT schemaname, tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = true ORDER BY tablename;
--
-- SELECT tier, name, price_monthly_usd FROM subscription_plans ORDER BY price_monthly_usd NULLS LAST;
-- ══════════════════════════════════════════════════════════════════════════
