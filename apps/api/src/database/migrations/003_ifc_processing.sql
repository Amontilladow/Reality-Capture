BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- bim_models: processing/tracking columns for the async IFC pipeline.
-- `status` already exists ('pending'|'processing'|'completed'|'failed').
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS processing_progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS processing_stage     VARCHAR(100);
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS processing_error     TEXT;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS fragments_storage_key VARCHAR(1000);
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS element_count        INTEGER;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS parsed_at            TIMESTAMPTZ;
ALTER TABLE bim_models ADD COLUMN IF NOT EXISTS job_id               VARCHAR(100);

-- ══════════════════════════════════════════════════════════════════════════
-- bim_spatial_nodes — the IFC-native Site → Building → Storey → Space tree.
-- Kept separate from the existing buildings/levels/locations tables, which
-- are reality-capture-facing and don't map 1:1 onto arbitrary IFC spatial
-- hierarchies. bim_elements.spatial_node_id (added below) is the precise
-- IFC-native link; level_id remains for the reality-capture-facing view.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_spatial_nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID         NOT NULL REFERENCES companies(id),
  model_id    UUID         NOT NULL REFERENCES bim_models(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES bim_spatial_nodes(id) ON DELETE CASCADE,
  ifc_guid    VARCHAR(22)  NOT NULL,
  ifc_type    VARCHAR(50)  NOT NULL,
  name        VARCHAR(255),
  elevation   NUMERIC(12,4),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, ifc_guid)
);
CREATE INDEX IF NOT EXISTS idx_spatial_nodes_model  ON bim_spatial_nodes(model_id);
CREATE INDEX IF NOT EXISTS idx_spatial_nodes_parent ON bim_spatial_nodes(parent_id);

ALTER TABLE bim_elements ADD COLUMN IF NOT EXISTS spatial_node_id UUID REFERENCES bim_spatial_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bim_elements_spatial_node ON bim_elements(spatial_node_id);

-- ══════════════════════════════════════════════════════════════════════════
-- bim_element_quantities — from IfcElementQuantity (IfcQuantityLength,
-- IfcQuantityArea, IfcQuantityVolume, IfcQuantityWeight, IfcQuantityCount).
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_element_quantities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id),
  element_id     UUID         NOT NULL REFERENCES bim_elements(id) ON DELETE CASCADE,
  quantity_set   VARCHAR(255),
  name           VARCHAR(255) NOT NULL,
  quantity_type  VARCHAR(50),
  value          NUMERIC(18,6),
  unit           VARCHAR(50),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_element_quantities_element ON bim_element_quantities(element_id);

-- ══════════════════════════════════════════════════════════════════════════
-- bim_materials / bim_element_materials — from IfcMaterial /
-- IfcMaterialLayerSet / IfcRelAssociatesMaterial.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_materials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID         NOT NULL REFERENCES companies(id),
  model_id    UUID         NOT NULL REFERENCES bim_models(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  category    VARCHAR(100),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, name)
);

CREATE TABLE IF NOT EXISTS bim_element_materials (
  element_id  UUID NOT NULL REFERENCES bim_elements(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES bim_materials(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id),
  PRIMARY KEY (element_id, material_id)
);

-- ══════════════════════════════════════════════════════════════════════════
-- bim_element_classifications — from IfcRelAssociatesClassification.
-- omniclass_code/uniclass_code/uniformat_code/csi_masterformat already on
-- bim_elements cover the 4 most common systems as first-class columns for
-- fast filtering; this table holds the full set (including those 4 again,
-- redundantly but harmlessly, plus any others the file declares) so no
-- classification system found in a file is ever silently dropped.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_element_classifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID         NOT NULL REFERENCES companies(id),
  element_id  UUID         NOT NULL REFERENCES bim_elements(id) ON DELETE CASCADE,
  system      VARCHAR(255) NOT NULL,
  code        VARCHAR(100),
  name        VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_element_classifications_element ON bim_element_classifications(element_id);

-- ══════════════════════════════════════════════════════════════════════════
-- bim_element_relationships — generic edge list for IfcRelAggregates,
-- IfcRelContainedInSpatialStructure, IfcRelVoidsElement, IfcRelFillsElement.
-- Stored by GUID (not FK'd to bim_elements.id) because the related entity
-- on either side of a relationship can be a spatial node, not always an
-- element — GUIDs are resolved at read time against whichever table has
-- them.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bim_element_relationships (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID         NOT NULL REFERENCES companies(id),
  model_id           UUID         NOT NULL REFERENCES bim_models(id) ON DELETE CASCADE,
  relationship_type  VARCHAR(100) NOT NULL,
  relating_guid      VARCHAR(22)  NOT NULL,
  related_guid       VARCHAR(22)  NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_element_relationships_model    ON bim_element_relationships(model_id);
CREATE INDEX IF NOT EXISTS idx_element_relationships_relating ON bim_element_relationships(relating_guid);
CREATE INDEX IF NOT EXISTS idx_element_relationships_related  ON bim_element_relationships(related_guid);

-- ══════════════════════════════════════════════════════════════════════════
-- Row-level security for all new tables (same pattern as 001).
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
  new_tenant_tables TEXT[] := ARRAY[
    'bim_spatial_nodes','bim_element_quantities','bim_materials',
    'bim_element_materials','bim_element_classifications',
    'bim_element_relationships'
  ];
BEGIN
  FOREACH t IN ARRAY new_tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.current_company_id'', true)::UUID)',
      t
    );
  END LOOP;
END $$;

INSERT INTO _migrations (filename) VALUES ('003_ifc_processing.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
