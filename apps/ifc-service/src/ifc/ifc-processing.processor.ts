import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import {
  IFC_PROCESSING_QUEUE,
  IFC_PARSE_JOB_NAME,
  IFC_PROCESSING_STAGES,
} from '@engineeringos/types';
import type { IfcParseJobData, IfcProcessingStage } from '@engineeringos/types';
import { StorageService } from '../storage/storage.service';
import { IfcParserService } from './ifc-parser.service';
import { IfcFragmentsService } from './ifc-fragments.service';
import { IfcRepositoryService } from './ifc-repository.service';
import { IfcReportService } from './ifc-report.service';
import { JobMetrics } from './job-metrics';

// Elements are extracted and written in fixed-size batches so memory use
// stays bounded by batch size, not total element count — see
// IFC_ARCHITECTURE_PROPOSAL.md and MASTER_BACKLOG.md for why this is the
// realistic scalability lever available on top of web-ifc's synchronous,
// whole-file-open API.
const ELEMENT_BATCH_SIZE = 200;

@Processor(IFC_PROCESSING_QUEUE)
export class IfcProcessingProcessor {
  private readonly logger = new Logger(IfcProcessingProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly parser: IfcParserService,
    private readonly fragments: IfcFragmentsService,
    private readonly repo: IfcRepositoryService,
    private readonly report: IfcReportService,
  ) {}

  @Process(IFC_PARSE_JOB_NAME)
  async handle(job: Job<IfcParseJobData>): Promise<void> {
    const { modelId, companyId, projectId, storageKey } = job.data;
    const metrics = new JobMetrics(modelId);
    metrics.logJobStart();

    const model = await this.repo.getModel(companyId, modelId);
    await this.repo.markJobStarted(companyId, modelId);

    const stageDone = (stage: IfcProcessingStage) => this.repo.isStageComplete(model, stage);
    const stageIndex = (stage: IfcProcessingStage) => IFC_PROCESSING_STAGES.indexOf(stage);
    const reportProgress = async (stage: IfcProcessingStage) => {
      const percent = Math.round(((stageIndex(stage) + 1) / IFC_PROCESSING_STAGES.length) * 100);
      await this.repo.updateProgress(companyId, modelId, stage, percent);
      await job.progress(percent);
    };

    let api: import('web-ifc').IfcAPI | null = null;
    let ifcModelId: number | null = null;
    let elementCount = 0;
    let fragmentsSizeBytes: number | undefined;
    let fragmentsStorageKey: string | undefined;
    const objectCounts: Record<string, number> = {};
    let spatialCounts = { sites: 0, buildings: 0, storeys: 0, spaces: 0 };
    let propertiesCount = 0;
    let quantitiesCount = 0;
    let materialsCount = 0;
    let relationshipsCount = 0;

    try {
      // ── downloading + parsing: always re-run every attempt (cheap,
      // side-effect-free) rather than tracked in stage_completion. ────────
      metrics.startStage('downloading');
      await reportProgress('downloading');
      const bytes = await this.storage.download(storageKey);
      metrics.endStage('downloading');

      metrics.startStage('parsing');
      await reportProgress('parsing');
      const opened = await this.parser.openModel(bytes);
      api = opened.api;
      ifcModelId = opened.modelId;
      const walk = await this.parser.walkHierarchy(api, ifcModelId);
      metrics.endStage('parsing');

      spatialCounts = {
        sites: walk.spatialNodes.filter((n) => n.ifcType === 'IFCSITE').length,
        buildings: walk.spatialNodes.filter((n) => n.ifcType === 'IFCBUILDING').length,
        storeys: walk.spatialNodes.filter((n) => n.ifcType === 'IFCBUILDINGSTOREY').length,
        spaces: walk.spatialNodes.filter((n) => n.ifcType === 'IFCSPACE').length,
      };
      for (const el of walk.elementSkeletons) {
        objectCounts[el.ifcType] = (objectCounts[el.ifcType] ?? 0) + 1;
      }
      elementCount = walk.elementSkeletons.length;

      // ── extracting_hierarchy ─────────────────────────────────────────
      let spatialNodeIdByGuid = new Map<string, string>();
      if (!stageDone('extracting_hierarchy')) {
        metrics.startStage('extracting_hierarchy');
        await reportProgress('extracting_hierarchy');
        await this.repo.runStage(companyId, modelId, 'extracting_hierarchy', async (sql) => {
          await this.repo.removeStaleResults(
            sql, companyId, modelId,
            walk.spatialNodes.map((n) => n.ifcGuid),
            walk.elementSkeletons.map((s) => s.guid),
          );
          spatialNodeIdByGuid = await this.repo.insertSpatialNodes(sql, companyId, modelId, walk.spatialNodes);
        });
        metrics.endStage('extracting_hierarchy');
      } else {
        this.logger.log(`Model ${modelId} — extracting_hierarchy already complete, skipping (resume).`);
      }

      // ── extracting_properties + extracting_quantities + extracting_materials
      // (combined into one pass over elements — see JobMetrics/repo comments
      // for why: one web-ifc read per element instead of three). ──────────
      const elementIdByGuid = new Map<string, string>();
      const propertiesStagesDone = stageDone('extracting_properties') && stageDone('extracting_quantities') && stageDone('extracting_materials');
      if (!propertiesStagesDone) {
        await reportProgress('extracting_properties');
        metrics.startStage('extracting_properties');

        await this.repo.runStage(companyId, modelId, 'extracting_properties', async (sql) => {
          // Re-fetch spatial node ids fresh in case this stage is running
          // standalone on a resumed job where extracting_hierarchy was
          // already committed in a prior attempt.
          if (spatialNodeIdByGuid.size === 0) {
            const rows = await sql`SELECT id, ifc_guid FROM bim_spatial_nodes WHERE model_id = ${modelId} AND company_id = ${companyId}`;
            for (const r of rows) spatialNodeIdByGuid.set(r.ifcGuid as string, r.id as string);
          }

          for (let i = 0; i < walk.elementSkeletons.length; i += ELEMENT_BATCH_SIZE) {
            const batch = walk.elementSkeletons.slice(i, i + ELEMENT_BATCH_SIZE);
            const batchElements = [];
            const batchQuantities = [];
            const batchMaterials = [];
            const batchElementMaterials = [];

            for (const skeleton of batch) {
              try {
                const extracted = await this.parser.extractElement(api!, ifcModelId!, skeleton, walk.spatialNodeGuidByElement);
                batchElements.push(extracted.element);
                batchQuantities.push(...extracted.quantities);
                batchMaterials.push(...extracted.materials);
                batchElementMaterials.push(...extracted.elementMaterials);
              } catch (error) {
                metrics.recordSkippedElement(skeleton.guid, skeleton.ifcType, error instanceof Error ? error.message : String(error));
              }
            }

            const idByGuid = await this.repo.insertElementsBatch(sql, companyId, modelId, projectId, batchElements, spatialNodeIdByGuid);
            for (const [guid, id] of idByGuid) elementIdByGuid.set(guid, id);

            quantitiesCount += await this.repo.insertQuantitiesBatch(sql, companyId, batchQuantities, idByGuid);
            materialsCount += await this.repo.insertMaterialsAndLinks(sql, companyId, modelId, batchMaterials, batchElementMaterials, idByGuid);
            propertiesCount += batchElements.reduce((sum, el) => sum + Object.keys(el.properties ?? {}).length, 0);
            metrics.elementsProcessed += batchElements.length;

            const pct = Math.min(99, Math.round(((i + batch.length) / Math.max(1, walk.elementSkeletons.length)) * 100));
            await job.progress(pct);
          }
        });

        metrics.endStage('extracting_properties');
        await reportProgress('extracting_quantities');
        await reportProgress('extracting_materials');
      } else {
        this.logger.log(`Model ${modelId} — property/quantity/material extraction already complete, skipping (resume).`);
      }

      // ── extracting_classifications ───────────────────────────────────
      if (!stageDone('extracting_classifications')) {
        metrics.startStage('extracting_classifications');
        await reportProgress('extracting_classifications');
        const classifications = await this.parser.getClassifications(api, ifcModelId, walk.guidByExpressId);
        await this.repo.runStage(companyId, modelId, 'extracting_classifications', async (sql) => {
          let idMap = elementIdByGuid;
          if (idMap.size === 0) {
            idMap = new Map();
            const rows = await sql`SELECT id, ifc_guid FROM bim_elements WHERE model_id = ${modelId} AND company_id = ${companyId}`;
            for (const r of rows) idMap.set(r.ifcGuid as string, r.id as string);
          }
          await sql`DELETE FROM bim_element_classifications WHERE company_id = ${companyId} AND element_id IN (SELECT id FROM bim_elements WHERE model_id = ${modelId})`;
          await this.repo.insertClassifications(sql, companyId, classifications, idMap);
        });
        metrics.endStage('extracting_classifications');
      }

      // ── extracting_relationships ──────────────────────────────────────
      if (!stageDone('extracting_relationships')) {
        metrics.startStage('extracting_relationships');
        await reportProgress('extracting_relationships');
        const voidsAndFills = await this.parser.getVoidsAndFills(api, ifcModelId);
        const allRelationships = [...walk.aggregatesRelationships, ...walk.containedInStructureRelationships, ...voidsAndFills];
        await this.repo.runStage(companyId, modelId, 'extracting_relationships', async (sql) => {
          await sql`DELETE FROM bim_element_relationships WHERE model_id = ${modelId} AND company_id = ${companyId}`;
          relationshipsCount = await this.repo.insertRelationships(sql, companyId, modelId, allRelationships);
        });
        metrics.endStage('extracting_relationships');
      }

      // ── generating_fragments + uploading_fragments ───────────────────
      let fragmentsGenerated = false;
      if (!stageDone('generating_fragments') || !stageDone('uploading_fragments')) {
        metrics.startStage('generating_fragments');
        await reportProgress('generating_fragments');
        try {
          const fragBytes = await this.fragments.generate(bytes);
          fragmentsSizeBytes = fragBytes.byteLength;
          metrics.endStage('generating_fragments');

          metrics.startStage('uploading_fragments');
          await reportProgress('uploading_fragments');
          fragmentsStorageKey = this.storage.generateFragmentsKey(companyId, projectId, modelId);
          await this.storage.upload(fragmentsStorageKey, fragBytes, 'application/octet-stream');
          fragmentsGenerated = true;
          metrics.endStage('uploading_fragments');
        } catch (error) {
          // Fragments are a viewer convenience, not the source of truth —
          // a failure here is recorded as a warning, not a job failure,
          // since the model's hierarchy/properties/quantities are already
          // safely persisted by this point.
          metrics.warnings.push(`Fragments generation/upload failed: ${error instanceof Error ? error.message : String(error)}`);
          this.logger.warn(`Model ${modelId} — Fragments step failed, continuing without it: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // ── finalizing ─────────────────────────────────────────────────
      await reportProgress('finalizing');
      metrics.startStage('finalizing');
      await this.repo.finalize(companyId, modelId, {
        status: 'ready',
        elementCount,
        elementsSkipped: metrics.elementsSkipped,
        durationMs: metrics.totalDurationMs,
        peakMemoryBytes: metrics.peakMemoryBytes,
        warnings: metrics.warnings,
        fragmentsStorageKey,
      });

      const { report: successReportJson, text } = this.report.build({
        modelId,
        projectId,
        modelName: model.name,
        status: metrics.elementsSkipped > 0 ? 'PARTIAL' : 'SUCCESS',
        durationMs: metrics.totalDurationMs,
        peakMemoryBytes: metrics.peakMemoryBytes,
        elementsProcessed: metrics.elementsProcessed || elementCount,
        elementsSkipped: metrics.elementsSkipped,
        warnings: metrics.warnings,
        errors: [],
        spatialCounts,
        objectCounts,
        propertiesExtracted: propertiesCount,
        materialsExtracted: materialsCount,
        quantitiesExtracted: quantitiesCount,
        relationshipsExtracted: relationshipsCount,
        fragmentsGenerated,
        fragmentsSizeBytes,
      });
      await this.repo.saveReport(companyId, modelId, text, successReportJson as unknown as Record<string, unknown>, metrics.elementsSkipped > 0 ? 'PARTIAL' : 'SUCCESS');
      metrics.endStage('finalizing');
      metrics.logJobEnd(metrics.elementsSkipped > 0 ? 'PARTIAL' : 'SUCCESS');
      this.logger.log(`Model ${modelId} — IFC processing complete.\n${text}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Model ${modelId} — IFC processing failed: ${message}`);
      await this.repo.markFailed(companyId, modelId, message);
      metrics.logJobEnd('FAILED');
      const { report: failureReportJson, text } = this.report.build({
        modelId, projectId, modelName: model.name, status: 'FAILED',
        durationMs: metrics.totalDurationMs, peakMemoryBytes: metrics.peakMemoryBytes,
        elementsProcessed: metrics.elementsProcessed, elementsSkipped: metrics.elementsSkipped,
        warnings: metrics.warnings, errors: [message],
        spatialCounts, objectCounts, propertiesExtracted: propertiesCount,
        materialsExtracted: materialsCount, quantitiesExtracted: quantitiesCount,
        relationshipsExtracted: relationshipsCount, fragmentsGenerated: false,
      });
      await this.repo.saveReport(companyId, modelId, text, failureReportJson as unknown as Record<string, unknown>, 'FAILED').catch(() => undefined);
      throw error; // let Bull's attempts/backoff retry
    } finally {
      if (api && ifcModelId !== null) this.parser.closeModel(api, ifcModelId);
    }
  }
}
