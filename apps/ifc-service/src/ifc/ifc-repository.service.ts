import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { Sql } from 'postgres';
import type {
  IfcProcessingStage,
  IfcSpatialNodeInput,
  IfcElementInput,
  IfcQuantityInput,
  IfcMaterialInput,
  IfcElementMaterialInput,
  IfcClassificationInput,
  IfcRelationshipInput,
} from '@engineeringos/types';

export interface BimModelRow {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  storageKey: string;
  status: string;
  stageCompletion: Record<string, boolean>;
  attemptCount: number;
}

@Injectable()
export class IfcRepositoryService {
  private readonly logger = new Logger(IfcRepositoryService.name);

  constructor(private readonly db: DatabaseService) {}

  async getModel(companyId: string, modelId: string): Promise<BimModelRow> {
    const [row] = await this.db.withTenant(companyId, (sql) => sql`
      SELECT id, company_id, project_id, name, storage_key, status, stage_completion, attempt_count
      FROM bim_models WHERE id = ${modelId} AND company_id = ${companyId}
    `);
    if (!row) throw new NotFoundException(`BIM model ${modelId} not found.`);
    return row as unknown as BimModelRow;
  }

  // postgres.js's camel transform converts jsonb VALUE keys (not just
  // column names) to camelCase on every read, regardless of how they were
  // written — confirmed via a direct test: writing {extracting_hierarchy:
  // true} reads back as {extractingHierarchy: true}. IFC_PROCESSING_STAGES
  // are snake_case string literals (matching the DB's processing_stage
  // VARCHAR values, which are NOT affected — only this jsonb column is),
  // so the stage name has to be converted the same way postgres.js's own
  // toCamel() does before indexing into the parsed object.
  private toCamelKey(snakeCase: string): string {
    let str = snakeCase[0];
    for (let i = 1; i < snakeCase.length; i++) {
      str += snakeCase[i] === '_' ? snakeCase[++i].toUpperCase() : snakeCase[i];
    }
    return str;
  }

  isStageComplete(model: BimModelRow, stage: IfcProcessingStage): boolean {
    return model.stageCompletion?.[this.toCamelKey(stage)] === true;
  }

  async markJobStarted(companyId: string, modelId: string): Promise<void> {
    await this.db.withTenant(companyId, (sql) => sql`
      UPDATE bim_models
      SET status = 'processing', started_at = COALESCE(started_at, NOW()),
          attempt_count = attempt_count + 1, processing_error = NULL, updated_at = NOW()
      WHERE id = ${modelId} AND company_id = ${companyId}
    `);
  }

  async updateProgress(companyId: string, modelId: string, stage: IfcProcessingStage, percent: number): Promise<void> {
    await this.db.withTenant(companyId, (sql) => sql`
      UPDATE bim_models
      SET processing_stage = ${stage}, processing_progress = ${percent}, updated_at = NOW()
      WHERE id = ${modelId} AND company_id = ${companyId}
    `);
  }

  // Runs one pipeline stage inside a single transaction: the caller's
  // writes AND the stage_completion flag land atomically together. If the
  // process crashes mid-stage, the transaction never commits, so
  // stage_completion never shows this stage as done — a retry safely
  // redoes the whole stage (each stage's fn is expected to clear its own
  // prior output for this model before writing fresh output, making that
  // redo idempotent).
  async runStage(companyId: string, modelId: string, stage: IfcProcessingStage, fn: (sql: Sql) => Promise<void>): Promise<void> {
    await this.db.withTenant(companyId, async (sql) => {
      await fn(sql);
      await sql`
        UPDATE bim_models
        SET stage_completion = stage_completion || ${sql.json({ [stage]: true })}
        WHERE id = ${modelId} AND company_id = ${companyId}
      `;
    });
  }

  // Removes only what's genuinely gone from this run of the file --
  // elements/nodes still present are left alone here and get updated in
  // place by the ON CONFLICT upserts below, keeping the same id. That
  // matters beyond this pipeline: a pin's or issue's element_id points at
  // a bim_elements row, and used to get silently orphaned (or, since
  // locations_has_a_place_check started requiring a place, hard-crash the
  // whole reprocess) every time a model was reprocessed, because the old
  // version of this method deleted and recreated every element
  // unconditionally, including ones that hadn't actually changed.
  // bim_element_relationships and bim_materials have no external
  // references into them (only bim_elements does, via FK), so a full wipe
  // there is still safe -- both get freshly rebuilt from the walk anyway.
  async removeStaleResults(
    sql: Sql, companyId: string, modelId: string,
    currentSpatialGuids: string[], currentElementGuids: string[],
  ): Promise<void> {
    // Cascades (ON DELETE CASCADE) clean up quantities/material-links/
    // classifications for whatever elements actually get removed here.
    await sql`
      DELETE FROM bim_elements
      WHERE model_id = ${modelId} AND company_id = ${companyId}
        AND NOT (ifc_guid = ANY(${currentElementGuids}))
    `;
    await sql`
      DELETE FROM bim_spatial_nodes
      WHERE model_id = ${modelId} AND company_id = ${companyId}
        AND NOT (ifc_guid = ANY(${currentSpatialGuids}))
    `;
    await sql`DELETE FROM bim_element_relationships WHERE model_id = ${modelId} AND company_id = ${companyId}`;
    await sql`DELETE FROM bim_materials WHERE model_id = ${modelId} AND company_id = ${companyId}`;
  }

  async insertSpatialNodes(sql: Sql, companyId: string, modelId: string, nodes: IfcSpatialNodeInput[]): Promise<Map<string, string>> {
    const idByGuid = new Map<string, string>();
    // Parent-before-child insert order: nodes are produced in tree-walk
    // (pre-)order already, so a simple sequential insert (not a bulk
    // multi-row insert) lets each row resolve its parent's real UUID from
    // idByGuid before it's used as a foreign key.
    for (const node of nodes) {
      const parentId = node.parentGuid ? (idByGuid.get(node.parentGuid) ?? null) : null;
      const [row] = await sql`
        INSERT INTO bim_spatial_nodes (company_id, model_id, parent_id, ifc_guid, ifc_type, name, elevation)
        VALUES (${companyId}, ${modelId}, ${parentId}, ${node.ifcGuid}, ${node.ifcType}, ${node.name ?? null}, ${node.elevation ?? null})
        ON CONFLICT (model_id, ifc_guid) DO UPDATE SET
          parent_id = EXCLUDED.parent_id, ifc_type = EXCLUDED.ifc_type,
          name = EXCLUDED.name, elevation = EXCLUDED.elevation
        RETURNING id
      `;
      idByGuid.set(node.ifcGuid, row.id as string);
    }
    return idByGuid;
  }

  async insertElementsBatch(sql: Sql, companyId: string, modelId: string, projectId: string, elements: IfcElementInput[], spatialNodeIdByGuid: Map<string, string>): Promise<Map<string, string>> {
    const idByGuid = new Map<string, string>();
    if (elements.length === 0) return idByGuid;

    const rows = elements.map((el) => ({
      companyId,
      modelId,
      projectId,
      spatialNodeId: el.spatialNodeGuid ? (spatialNodeIdByGuid.get(el.spatialNodeGuid) ?? null) : null,
      ifcGuid: el.ifcGuid,
      ifcType: el.ifcType,
      ifcName: el.ifcName ?? null,
      ifcDescription: el.ifcDescription ?? null,
      omniclassCode: el.omniclassCode ?? null,
      uniclassCode: el.uniclassCode ?? null,
      uniformatCode: el.uniformatCode ?? null,
      csiMasterformat: el.csiMasterformat ?? null,
      bboxMinX: el.bbox?.minX ?? null,
      bboxMinY: el.bbox?.minY ?? null,
      bboxMinZ: el.bbox?.minZ ?? null,
      bboxMaxX: el.bbox?.maxX ?? null,
      bboxMaxY: el.bbox?.maxY ?? null,
      bboxMaxZ: el.bbox?.maxZ ?? null,
      properties: JSON.stringify(el.properties ?? {}),
    }));

    const inserted = await sql`
      INSERT INTO bim_elements ${sql(rows, 'companyId', 'modelId', 'projectId', 'spatialNodeId', 'ifcGuid', 'ifcType', 'ifcName', 'ifcDescription', 'omniclassCode', 'uniclassCode', 'uniformatCode', 'csiMasterformat', 'bboxMinX', 'bboxMinY', 'bboxMinZ', 'bboxMaxX', 'bboxMaxY', 'bboxMaxZ', 'properties')}
      ON CONFLICT (model_id, ifc_guid) DO UPDATE SET
        ifc_name = EXCLUDED.ifc_name, ifc_description = EXCLUDED.ifc_description,
        spatial_node_id = EXCLUDED.spatial_node_id, properties = EXCLUDED.properties,
        bbox_min_x = EXCLUDED.bbox_min_x, bbox_min_y = EXCLUDED.bbox_min_y, bbox_min_z = EXCLUDED.bbox_min_z,
        bbox_max_x = EXCLUDED.bbox_max_x, bbox_max_y = EXCLUDED.bbox_max_y, bbox_max_z = EXCLUDED.bbox_max_z
      RETURNING id, ifc_guid
    `;
    for (const row of inserted) idByGuid.set(row.ifcGuid as string, row.id as string);
    return idByGuid;
  }

  async insertQuantitiesBatch(sql: Sql, companyId: string, quantities: IfcQuantityInput[], elementIdByGuid: Map<string, string>): Promise<number> {
    const rows = quantities
      .map((q) => ({ elementId: elementIdByGuid.get(q.elementGuid), quantitySet: q.quantitySet ?? null, name: q.name, quantityType: q.quantityType ?? null, value: q.value ?? null }))
      .filter((r): r is { elementId: string; quantitySet: string | null; name: string; quantityType: string | null; value: number | null } => !!r.elementId);
    if (rows.length === 0) return 0;
    const withCompany = rows.map((r) => ({ ...r, companyId }));
    await sql`
      INSERT INTO bim_element_quantities ${sql(withCompany, 'elementId', 'companyId', 'quantitySet', 'name', 'quantityType', 'value')}
    `;
    return rows.length;
  }

  async insertMaterialsAndLinks(sql: Sql, companyId: string, modelId: string, materials: IfcMaterialInput[], elementMaterials: IfcElementMaterialInput[], elementIdByGuid: Map<string, string>): Promise<number> {
    const uniqueMaterials = [...new Map(materials.map((m) => [m.name, m])).values()];
    if (uniqueMaterials.length === 0) return 0;

    const materialIdByName = new Map<string, string>();
    for (const mat of uniqueMaterials) {
      const [row] = await sql`
        INSERT INTO bim_materials (company_id, model_id, name, category)
        VALUES (${companyId}, ${modelId}, ${mat.name}, ${mat.category ?? null})
        ON CONFLICT (model_id, name) DO UPDATE SET category = EXCLUDED.category
        RETURNING id
      `;
      materialIdByName.set(mat.name, row.id as string);
    }

    const linkRows = elementMaterials
      .map((em) => ({ elementId: elementIdByGuid.get(em.elementGuid), materialId: materialIdByName.get(em.materialName), companyId }))
      .filter((r): r is { elementId: string; materialId: string; companyId: string } => !!r.elementId && !!r.materialId);

    if (linkRows.length > 0) {
      await sql`
        INSERT INTO bim_element_materials ${sql(linkRows, 'elementId', 'materialId', 'companyId')}
        ON CONFLICT DO NOTHING
      `;
    }
    return uniqueMaterials.length;
  }

  async insertClassifications(sql: Sql, companyId: string, classifications: IfcClassificationInput[], elementIdByGuid: Map<string, string>): Promise<number> {
    const rows = classifications
      .map((c) => ({ elementId: elementIdByGuid.get(c.elementGuid), companyId, system: c.system, code: c.code ?? null, name: c.name ?? null }))
      .filter((r): r is { elementId: string; companyId: string; system: string; code: string | null; name: string | null } => !!r.elementId);
    if (rows.length === 0) return 0;
    await sql`
      INSERT INTO bim_element_classifications ${sql(rows, 'elementId', 'companyId', 'system', 'code', 'name')}
    `;
    return rows.length;
  }

  async insertRelationships(sql: Sql, companyId: string, modelId: string, relationships: IfcRelationshipInput[]): Promise<number> {
    if (relationships.length === 0) return 0;
    const rows = relationships.map((r) => ({ companyId, modelId, relationshipType: r.relationshipType, relatingGuid: r.relatingGuid, relatedGuid: r.relatedGuid }));
    await sql`
      INSERT INTO bim_element_relationships ${sql(rows, 'companyId', 'modelId', 'relationshipType', 'relatingGuid', 'relatedGuid')}
    `;
    return rows.length;
  }

  async finalize(companyId: string, modelId: string, result: {
    status: 'ready' | 'failed';
    elementCount: number;
    elementsSkipped: number;
    durationMs: number;
    peakMemoryBytes: number;
    warnings: string[];
    fragmentsStorageKey?: string;
    error?: string;
    sourceSha256?: string;
    sourceSizeBytes?: number;
    fragmentsSha256?: string;
    fragmentsSizeBytes?: number;
    generationNodeVersion?: string;
    generationFragmentsVersion?: string;
    generationWebIfcVersion?: string;
    generationGitCommit?: string | null;
  }): Promise<void> {
    await this.db.withTenant(companyId, (sql) => sql`
      UPDATE bim_models
      SET status = ${result.status},
          element_count = ${result.elementCount},
          elements_skipped = ${result.elementsSkipped},
          duration_ms = ${result.durationMs},
          peak_memory_bytes = ${result.peakMemoryBytes},
          warnings = ${sql.json(result.warnings)},
          fragments_storage_key = ${result.fragmentsStorageKey ?? null},
          processing_error = ${result.error ?? null},
          processing_progress = ${result.status === 'ready' ? 100 : sql`processing_progress`},
          source_sha256 = ${result.sourceSha256 ?? null},
          source_size_bytes = ${result.sourceSizeBytes ?? null},
          fragments_sha256 = ${result.fragmentsSha256 ?? null},
          fragments_size_bytes = ${result.fragmentsSizeBytes ?? null},
          generation_node_version = ${result.generationNodeVersion ?? null},
          generation_fragments_version = ${result.generationFragmentsVersion ?? null},
          generation_web_ifc_version = ${result.generationWebIfcVersion ?? null},
          generation_git_commit = ${result.generationGitCommit ?? null},
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${modelId} AND company_id = ${companyId}
    `);
  }

  async markFailed(companyId: string, modelId: string, error: string): Promise<void> {
    await this.db.withTenant(companyId, (sql) => sql`
      UPDATE bim_models
      SET status = 'failed', processing_error = ${error}, updated_at = NOW()
      WHERE id = ${modelId} AND company_id = ${companyId}
    `);
  }

  async saveReport(companyId: string, modelId: string, reportText: string, reportJson: Record<string, unknown>, status: string): Promise<void> {
    await this.db.withTenant(companyId, (sql) => sql`
      INSERT INTO bim_import_reports (company_id, model_id, report_text, report_json, status)
      VALUES (${companyId}, ${modelId}, ${reportText}, ${JSON.stringify(reportJson)}::jsonb, ${status})
    `);
  }
}
