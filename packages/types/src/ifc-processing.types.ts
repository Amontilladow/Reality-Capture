// ── IFC processing job contract ─────────────────────────────────────────────
// Shared between apps/api (producer) and apps/ifc-service (consumer) so both
// sides stay in sync on the queue name and payload/progress shapes without
// either app importing the other's code.

export const IFC_PROCESSING_QUEUE = 'ifc-processing';
export const IFC_PARSE_JOB_NAME = 'parse-ifc';

export interface IfcParseJobData {
  modelId: string;
  companyId: string;
  projectId: string;
  storageKey: string;
}

export type IfcProcessingStage =
  | 'downloading'
  | 'parsing'
  | 'extracting_hierarchy'
  | 'extracting_properties'
  | 'extracting_quantities'
  | 'extracting_materials'
  | 'extracting_classifications'
  | 'extracting_relationships'
  | 'generating_fragments'
  | 'uploading_fragments'
  | 'finalizing';

// Canonical stage order. The processor executes these in order and skips
// any stage already marked complete in bim_models.stage_completion when
// resuming a retried job. See migration 004_ifc_resumability.sql for the
// full resumability contract.
export const IFC_PROCESSING_STAGES: IfcProcessingStage[] = [
  'downloading',
  'parsing',
  'extracting_hierarchy',
  'extracting_properties',
  'extracting_quantities',
  'extracting_materials',
  'extracting_classifications',
  'extracting_relationships',
  'generating_fragments',
  'uploading_fragments',
  'finalizing',
];

export interface IfcImportReport {
  modelId: string;
  projectId: string;
  modelName: string;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  importDurationMs: number;
  peakMemoryBytes: number;
  elementsProcessed: number;
  elementsSkipped: number;
  warnings: string[];
  errors: string[];
  hierarchy: { sites: number; buildings: number; storeys: number; spaces: number };
  objectCounts: Record<string, number>;
  propertiesExtracted: number;
  materialsExtracted: number;
  quantitiesExtracted: number;
  relationshipsExtracted: number;
  fragmentsGenerated: boolean;
  fragmentsSizeBytes?: number;
}

export interface IfcSpatialNodeInput {
  ifcGuid: string;
  ifcType: 'IFCPROJECT' | 'IFCSITE' | 'IFCBUILDING' | 'IFCBUILDINGSTOREY' | 'IFCSPACE';
  name?: string;
  elevation?: number;
  parentGuid?: string;
}

export interface IfcQuantityInput {
  elementGuid: string;
  quantitySet?: string;
  name: string;
  quantityType?: string;
  value?: number;
  unit?: string;
}

export interface IfcMaterialInput {
  name: string;
  category?: string;
}

export interface IfcElementMaterialInput {
  elementGuid: string;
  materialName: string;
}

export interface IfcClassificationInput {
  elementGuid: string;
  system: string;
  code?: string;
  name?: string;
}

export interface IfcRelationshipInput {
  relationshipType: 'aggregates' | 'contained_in_structure' | 'voids' | 'fills';
  relatingGuid: string;
  relatedGuid: string;
}

export interface IfcElementInput {
  ifcGuid: string;
  ifcType: string;
  ifcName?: string;
  ifcDescription?: string;
  spatialNodeGuid?: string;
  omniclassCode?: string;
  uniclassCode?: string;
  uniformatCode?: string;
  csiMasterformat?: string;
  bbox?: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  properties: Record<string, unknown>;
}
