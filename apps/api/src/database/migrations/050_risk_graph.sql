-- ══════════════════════════════════════════════════════════════════════════
-- Migration 050 — Project Risk Graph (nodes + edges)
--
-- Foundation table pair for the new Project Risk Intelligence feature. This
-- is deliberately a *generic* graph layer sitting alongside the existing
-- domain tables (rfis, issues, snag_items, bim_elements, drawings, ...) --
-- it does not replace or duplicate any of them. A graph node is a pointer
-- to one real row in one real existing table (company_id/node_type/
-- entity_id uniquely identifies it); a graph edge is a typed, sourced,
-- confidence-scored relationship between two nodes.
--
-- No cross-entity link table existed anywhere in this schema before this
-- migration (document_links is document-specific and only supports
-- capture/element/location/issue targets) -- this is genuinely new
-- relationship modeling, not a reuse of prior work.
--
-- Node types cover every entity that is real and populated today
-- (rfi, issue, snag_item, qa_inspection, drawing, document, submittal,
-- transmittal, bim_model, bim_element, building, level, location, capture,
-- project, user, company) plus two that the schema supports but this
-- codebase has no backing module for yet (programme_activity, material) --
-- these exist in the enum so the graph/risk engine can represent them
-- later without another migration, but nothing in this feature will ever
-- create a node of those two types today. The `risk` node type lets a
-- calculated Risk (migration 051) participate in the same graph as an
-- ordinary node, so a risk chain can be expressed as one connected path.
--
-- Explicit vs inferred relationships (brief section 6): every edge records
-- `source` and `confidence`. An EXPLICIT edge (source='EXPLICIT',
-- confidence=1.0) mirrors a real foreign key that already exists in the
-- domain schema (e.g. issues.location_id). A RULE_INFERENCE or
-- AI_SEMANTIC_MATCH edge is a detected/probable relationship with
-- confidence < 1.0 and must never be presented as a confirmed project
-- fact by anything reading this table.
--
-- Purely additive: two new tables, two new enums, RLS applied the same way
-- migration 037 applied it for its new tables. Nothing existing is
-- touched.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  CREATE TYPE risk_node_type AS ENUM (
    'project', 'building', 'level', 'location',
    'rfi', 'issue', 'snag_item', 'qa_inspection',
    'drawing', 'document', 'submittal', 'transmittal',
    'bim_model', 'bim_element',
    'capture',
    'programme_activity', 'material',
    'user', 'company',
    'risk'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Controlled relationship vocabulary (brief section 5). AFFECTED_BY exists
-- in the vocabulary for completeness but extraction code in this feature
-- always writes the AFFECTS direction (cause -> effect) and derives the
-- inverse at query time, rather than persisting both directions of the
-- same fact.
DO $$ BEGIN
  CREATE TYPE risk_relationship_type AS ENUM (
    'RELATED_TO', 'AFFECTS', 'AFFECTED_BY', 'LOCATED_AT', 'REFERENCES',
    'DEPENDS_ON', 'BLOCKS', 'IMPACTS', 'CAUSES', 'CONTRIBUTES_TO',
    'RESOLVES', 'SUPERSEDES', 'DUPLICATES', 'SIMILAR_TO', 'ASSIGNED_TO',
    'OWNED_BY', 'REQUIRES', 'PRECEDES', 'FOLLOWS', 'CONTAINS',
    'BELONGS_TO', 'EVIDENCE_FOR', 'TRIGGERS', 'MITIGATES'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_edge_source AS ENUM (
    'EXPLICIT', 'RULE_INFERENCE', 'AI_SEMANTIC_MATCH', 'USER_DEFINED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS risk_graph_nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_type     risk_node_type NOT NULL,
  entity_id     UUID NOT NULL,           -- the real row's id in its own table
  entity_table  VARCHAR(64) NOT NULL,    -- e.g. 'rfis' -- for traceability/debugging only, never used to build SQL dynamically
  label         VARCHAR(500) NOT NULL,   -- cached display name (rfi_number, issue title, drawing number, ...)
  -- Cached, cheap-to-filter-on fields copied from the source row so the
  -- signal/scoring engine and the graph UI don't have to re-join back to
  -- 8 different domain tables on every read. This is a read cache, never
  -- the source of truth -- re-extraction refreshes it from the real row.
  discipline    VARCHAR(64),
  status        VARCHAR(64),
  priority      VARCHAR(20),
  due_date      TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, node_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_risk_graph_nodes_project ON risk_graph_nodes(project_id, node_type);
CREATE INDEX IF NOT EXISTS idx_risk_graph_nodes_discipline ON risk_graph_nodes(project_id, discipline) WHERE discipline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_risk_graph_nodes_due_date ON risk_graph_nodes(project_id, due_date) WHERE due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS risk_graph_edges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_node_id       UUID NOT NULL REFERENCES risk_graph_nodes(id) ON DELETE CASCADE,
  to_node_id         UUID NOT NULL REFERENCES risk_graph_nodes(id) ON DELETE CASCADE,
  relationship_type  risk_relationship_type NOT NULL,
  source             risk_edge_source NOT NULL,
  confidence         NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence           JSONB NOT NULL DEFAULT '{}'::JSONB, -- why this edge was inferred, e.g. {"reason":"same_location_and_discipline","daysApart":3}
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  CHECK ((source = 'EXPLICIT' AND confidence = 1.0) OR source <> 'EXPLICIT'),
  UNIQUE (company_id, from_node_id, to_node_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_risk_graph_edges_from ON risk_graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_risk_graph_edges_to ON risk_graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_risk_graph_edges_project ON risk_graph_edges(project_id, relationship_type);

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY['risk_graph_nodes', 'risk_graph_edges'];
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
VALUES ('050_risk_graph.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS risk_graph_edges;
--   DROP TABLE IF EXISTS risk_graph_nodes;
--   DROP TYPE IF EXISTS risk_edge_source;
--   DROP TYPE IF EXISTS risk_relationship_type;
--   DROP TYPE IF EXISTS risk_node_type;
-- ══════════════════════════════════════════════════════════════════════════
