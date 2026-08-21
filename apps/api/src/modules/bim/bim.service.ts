import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { IssuesService } from '../issues/issues.service';
import type { PaginationQuery, IfcParseJobData } from '@engineeringos/types';
import { IFC_PROCESSING_QUEUE, IFC_PARSE_JOB_NAME } from '@engineeringos/types';

@Injectable()
export class BimService {
  private readonly logger = new Logger(BimService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly issues: IssuesService,
    @InjectQueue(IFC_PROCESSING_QUEUE) private readonly ifcQueue: Queue<IfcParseJobData>,
  ) {}

  // ── BIM Models ────────────────────────────────────────────────────────────
  async getModels(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT m.*, u.first_name || ' ' || u.last_name AS uploaded_by_name,
        COUNT(e.id) AS element_count
      FROM bim_models m
      LEFT JOIN users u ON u.id = m.uploaded_by
      LEFT JOIN bim_elements e ON e.model_id = m.id
      WHERE m.project_id = ${projectId} AND m.company_id = ${companyId}
      GROUP BY m.id, u.first_name, u.last_name
      ORDER BY m.created_at DESC
    `);
  }

  async getModelUploadUrl(companyId: string, projectId: string, filename: string) {
    const key = this.storage.generateKey(companyId, projectId, 'captures', filename);
    const url = await this.storage.getUploadUrl(key, 'application/octet-stream', 500 * 1024 * 1024);
    return { ...url, storageKey: key };
  }

  async registerModel(companyId: string, projectId: string, userId: string, dto: { name: string; storageKey: string; format?: string; ifcSchema?: string; originalFilename?: string }) {
    // withTenant required -- bim_models carries the tenant_isolation RLS policy.
    const [model] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO bim_models (company_id, project_id, name, format, ifc_schema, storage_key, status, uploaded_by, original_filename)
      VALUES (${companyId}, ${projectId}, ${dto.name}, ${dto.format ?? 'IFC'}, ${dto.ifcSchema ?? null}, ${dto.storageKey}, 'pending', ${userId}, ${dto.originalFilename ?? null})
      RETURNING *
    `);
    await this.enqueueParseJob(companyId, projectId, model.id as string, dto.storageKey);
    return model;
  }

  // Queues (or re-queues) IFC parsing for a model. Orchestration only —
  // apps/ifc-service owns everything past this point. Each enqueue gets a
  // fresh, unique Bull job id — reusing modelId as the job id was tried
  // first but reverted: Bull treats jobId as a dedup key across a job's
  // entire lifecycle, not just while active, so a second add() with the
  // same id after the first job COMPLETED silently no-ops and returns the
  // stale completed job instead of actually re-running (confirmed via a
  // reprocess resilience test — see MASTER_BACKLOG.md). Idempotency for
  // resume/retry is enforced at the application level instead, via
  // bim_models.stage_completion (see ifc-repository.service.ts).
  private async enqueueParseJob(companyId: string, projectId: string, modelId: string, storageKey: string) {
    const job = await this.ifcQueue.add(
      IFC_PARSE_JOB_NAME,
      { modelId, companyId, projectId, storageKey } satisfies IfcParseJobData,
      { jobId: `${modelId}:${Date.now()}` },
    );
    // withTenant required -- bim_models carries the tenant_isolation RLS policy.
    await this.db.withTenant(companyId, sql => sql`
      UPDATE bim_models SET job_id = ${job.id as string}, updated_at = NOW()
      WHERE id = ${modelId} AND company_id = ${companyId}
    `);
    this.logger.log(`BIM model ${modelId} — IFC parsing job ${job.id as string} queued.`);
    return job;
  }

  async getModel(companyId: string, modelId: string) {
    const [model] = await this.db.withTenant(companyId, sql => sql`
      SELECT * FROM bim_models WHERE id = ${modelId} AND company_id = ${companyId}
    `);
    if (!model) throw new NotFoundException('BIM model not found.');
    return model;
  }

  // Polling-friendly status endpoint for the frontend — deliberately a
  // thin read of bim_models, no cross-service call, so it stays fast and
  // available even if apps/ifc-service is temporarily down.
  async getModelStatus(companyId: string, modelId: string) {
    const model = await this.getModel(companyId, modelId);
    return {
      id: model.id,
      status: model.status,
      processingStage: model.processingStage,
      processingProgress: model.processingProgress,
      processingError: model.processingError,
      elementCount: model.elementCount,
      parsedAt: model.parsedAt,
    };
  }

  // Re-queues a failed (or stuck) model for reprocessing without
  // re-uploading the file — the storage key doesn't change.
  async reprocessModel(companyId: string, projectId: string, modelId: string) {
    const model = await this.getModel(companyId, modelId);
    // stage_completion has to be cleared too, not just status -- otherwise
    // the resumability logic (built for retrying a crashed job without
    // redoing committed work) sees every stage as already done and skips
    // straight to the end, re-running nothing. A deliberate reprocess
    // should always start over for real.
    // withTenant required -- bim_models carries the tenant_isolation RLS policy.
    await this.db.withTenant(companyId, sql => sql`
      UPDATE bim_models
      SET status = 'pending', processing_progress = 0, processing_stage = NULL,
          processing_error = NULL, stage_completion = '{}'::jsonb
      WHERE id = ${modelId} AND company_id = ${companyId}
    `);
    await this.enqueueParseJob(companyId, projectId, modelId, model.storageKey as string);
    return this.getModelStatus(companyId, modelId);
  }

  // Everything the viewer needs to open a ready model: a presigned URL to
  // the generated Fragments file, plus the current status (so the
  // frontend can show a clear message instead of a broken viewer if the
  // model isn't ready or Fragments generation failed/was skipped).
  async getModelViewerData(companyId: string, modelId: string) {
    const model = await this.getModel(companyId, modelId);
    if (model.status !== 'ready') {
      return { status: model.status, fragmentsUrl: null, processingError: model.processingError };
    }
    if (!model.fragmentsStorageKey) {
      return { status: 'ready', fragmentsUrl: null, processingError: 'Fragments were not generated for this model — see the import report for warnings.' };
    }
    const fragmentsUrl = await this.storage.getReadUrl(model.fragmentsStorageKey as string, 3600);
    return { status: 'ready', fragmentsUrl, processingError: null };
  }

  // Metadata-only provenance for a model's generated artifacts -- what
  // produced this .frag, from which exact IFC, in which environment. Never
  // returns storage credentials, storage URLs, or file bytes; fields are
  // null until the model has been (re)processed by a worker build that
  // records them (see migration 011_bim_model_provenance.sql).
  async getModelProvenance(companyId: string, modelId: string) {
    const model = await this.getModel(companyId, modelId);
    return {
      modelId: model.id,
      originalFilename: model.originalFilename ?? null,
      storageProvider: 'cloudflare-r2',
      sourceSha256: model.sourceSha256 ?? null,
      sourceSizeBytes: model.sourceSizeBytes ?? null,
      fragmentsSha256: model.fragmentsSha256 ?? null,
      fragmentsSizeBytes: model.fragmentsSizeBytes ?? null,
      generationNodeVersion: model.generationNodeVersion ?? null,
      generationFragmentsVersion: model.generationFragmentsVersion ?? null,
      generationWebIfcVersion: model.generationWebIfcVersion ?? null,
      generationGitCommit: model.generationGitCommit ?? null,
      uploadedAt: model.createdAt,
      generatedAt: model.completedAt ?? null,
    };
  }

  // The IFC-native spatial tree (Site → Building → Storey → Space),
  // returned flat with parent_id so the frontend builds the tree shape —
  // cheaper to transfer and easier to reason about than a nested payload.
  async getHierarchy(companyId: string, modelId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT n.id, n.parent_id, n.ifc_guid, n.ifc_type, n.name, n.elevation,
        COUNT(e.id) AS element_count
      FROM bim_spatial_nodes n
      LEFT JOIN bim_elements e ON e.spatial_node_id = n.id
      WHERE n.model_id = ${modelId} AND n.company_id = ${companyId}
      GROUP BY n.id
      ORDER BY n.elevation NULLS FIRST, n.name
    `);
  }

  // ── BIM Elements ──────────────────────────────────────────────────────────
  async getElements(companyId: string, projectId: string, query: PaginationQuery & {
    modelId?: string; ifcType?: string; levelId?: string; constructionStatus?: string;
  }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 50, 200);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT e.*,
        COUNT(i.id) FILTER (WHERE i.status NOT IN ('closed','void')) AS open_issue_count,
        COUNT(cel.id) AS capture_count,
        COUNT(*) OVER() AS full_count
      FROM bim_elements e
      LEFT JOIN issues i ON i.element_id = e.id
      LEFT JOIN capture_element_links cel ON cel.element_id = e.id
      WHERE e.project_id = ${projectId} AND e.company_id = ${companyId}
        AND (${query.modelId ?? null}::uuid IS NULL OR e.model_id = ${query.modelId ?? null}::uuid)
        AND (${query.ifcType ?? null}::text IS NULL OR e.ifc_type = ${query.ifcType ?? null}::text)
        AND (${query.levelId ?? null}::uuid IS NULL OR e.level_id = ${query.levelId ?? null}::uuid)
        AND (${query.constructionStatus ?? null}::text IS NULL OR e.construction_status = ${query.constructionStatus ?? null}::text)
        AND (${query.search ?? null}::text IS NULL OR
          e.ifc_name ILIKE ${'%' + (query.search ?? '') + '%'}
          OR e.ifc_guid ILIKE ${'%' + (query.search ?? '') + '%'})
      GROUP BY e.id
      -- e.id tiebreaker: (ifc_type, ifc_name) is not unique -- many elements
      -- share a type+name (e.g. generic "Beam"/"Fastener" instances) -- so
      -- without a unique final sort key, LIMIT/OFFSET pagination over ties
      -- is unstable and can return the same row on multiple pages while
      -- skipping others entirely. Confirmed by direct reproduction: paging
      -- through this exact endpoint with 200/page returned 2999 rows but
      -- only 2887 distinct ids.
      ORDER BY e.ifc_type, e.ifc_name, e.id
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async getElement(companyId: string, elementId: string) {
    const [el] = await this.db.withTenant(companyId, sql => sql`
      SELECT e.*, m.name AS model_name, l.name AS level_name, sn.name AS spatial_node_name, sn.ifc_type AS spatial_node_type
      FROM bim_elements e
      LEFT JOIN bim_models m ON m.id = e.model_id
      LEFT JOIN levels l ON l.id = e.level_id
      LEFT JOIN bim_spatial_nodes sn ON sn.id = e.spatial_node_id
      WHERE e.id = ${elementId} AND e.company_id = ${companyId}
    `);
    if (!el) throw new NotFoundException('BIM element not found.');

    const [quantities, materials, classifications, linkedPins] = await Promise.all([
      this.db.withTenant(companyId, sql => sql`
        SELECT quantity_set, name, quantity_type, value, unit FROM bim_element_quantities
        WHERE element_id = ${elementId} AND company_id = ${companyId} ORDER BY quantity_set, name
      `),
      this.db.withTenant(companyId, sql => sql`
        SELECT mat.name, mat.category FROM bim_element_materials em
        JOIN bim_materials mat ON mat.id = em.material_id
        WHERE em.element_id = ${elementId} AND em.company_id = ${companyId}
      `),
      this.db.withTenant(companyId, sql => sql`
        SELECT system, code, name FROM bim_element_classifications
        WHERE element_id = ${elementId} AND company_id = ${companyId}
      `),
      this.db.withTenant(companyId, sql => sql`
        SELECT loc.id AS location_id, loc.name, loc.drawing_id,
          (SELECT iss.id FROM issues iss WHERE iss.location_id = loc.id ORDER BY iss.created_at ASC LIMIT 1) AS linked_issue_id,
          (SELECT sg.id FROM snag_items sg WHERE sg.location_id = loc.id ORDER BY sg.created_at ASC LIMIT 1) AS linked_snag_id
        FROM locations loc
        WHERE loc.element_id = ${elementId} AND loc.company_id = ${companyId} AND loc.archived_at IS NULL
        ORDER BY loc.created_at DESC LIMIT 1
      `),
    ]);

    return {
      ...el,
      quantities,
      materials,
      classifications,
      linkedPin: linkedPins[0]
        ? {
            ...linkedPins[0],
            linkedRecord: linkedPins[0].linkedIssueId
              ? { type: 'issue', id: linkedPins[0].linkedIssueId }
              : linkedPins[0].linkedSnagId
                ? { type: 'snag', id: linkedPins[0].linkedSnagId }
                : null,
          }
        : null,
    };
  }

  async getElementByGuid(companyId: string, modelId: string, ifcGuid: string) {
    const [el] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM bim_elements WHERE model_id = ${modelId} AND ifc_guid = ${ifcGuid} AND company_id = ${companyId}
    `);
    if (!el) throw new NotFoundException(`No element with GUID ${ifcGuid} in this model.`);
    return this.getElement(companyId, el.id as string);
  }

  // Creates a pin that starts out attached to nothing but this element --
  // no drawing, no position yet. It's a real Location like any other pin,
  // so it shows up normally in the floor-plan pin list and capture picker
  // once someone (from the floor plan side) gives it a position; until
  // then it's still valid, since locations_has_a_place_check now accepts
  // element_id on its own as a place.
  async createPinForElement(companyId: string, projectId: string, elementId: string, userId: string, name: string) {
    // withTenant required -- locations carries the tenant_isolation RLS policy.
    const [loc] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO locations (company_id, name, element_id)
      VALUES (${companyId}, ${name}, ${elementId})
      RETURNING id, name, element_id
    `);

    // Every pin automatically gets a matching Issue, linked via
    // issues.location_id (and, for an element-originated pin, issues.element_id
    // too) -- see the drawings.service.ts createPin() equivalent.
    const issue = await this.issues.create(companyId, projectId, userId, {
      issueType: 'general',
      title: name,
      discipline: 'OTHER',
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      locationId: loc.id as string,
      elementId,
    });

    return { ...loc, issueId: issue.id as string };
  }

  async updateElementStatus(companyId: string, elementId: string, status: string) {
    // withTenant required -- bim_elements carries the tenant_isolation RLS policy.
    const [el] = await this.db.withTenant(companyId, sql => sql`
      UPDATE bim_elements
      SET construction_status = ${status},
          installed_at = CASE WHEN ${status} = 'complete' THEN NOW() ELSE installed_at END,
          updated_at = NOW()
      WHERE id = ${elementId} AND company_id = ${companyId}
      RETURNING *
    `);
    if (!el) throw new NotFoundException('BIM element not found.');
    return el;
  }

  // ── Capture ↔ Element linking ─────────────────────────────────────────────
  async linkCaptureToElement(companyId: string, captureId: string, elementId: string, userId: string, linkType = 'documents') {
    // withTenant required -- capture_element_links carries the tenant_isolation RLS policy.
    const [link] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO capture_element_links (capture_id, element_id, company_id, link_type, linked_by)
      VALUES (${captureId}, ${elementId}, ${companyId}, ${linkType}, ${userId})
      ON CONFLICT (capture_id, element_id) DO UPDATE SET link_type = ${linkType}
      RETURNING *
    `);
    return link;
  }

  // Routed through whichever Location (pin) carries this element's
  // element_id, not through capture_element_links -- a photo attaches to a
  // Place, and a Place can now be a BIM element, the same as it can be a
  // floor-plan position. capture_element_links stays in the schema, unused,
  // same as capture_drawing_links was before the pins work replaced it.
  async getCapturesForElement(companyId: string, elementId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT c.id, c.capture_type, c.captured_at, c.phase, c.title, c.status,
             NULL::varchar AS link_type,
             u.first_name || ' ' || u.last_name AS captured_by_name
      FROM locations loc
      JOIN captures c ON c.location_id = loc.id AND c.status = 'ready'
      JOIN users u ON u.id = c.captured_by
      WHERE loc.element_id = ${elementId} AND loc.company_id = ${companyId}
        AND loc.archived_at IS NULL
      ORDER BY c.captured_at DESC
    `);
  }

  // ── Progress summary by element type ─────────────────────────────────────
  async getProgressSummary(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT
        e.ifc_type,
        COUNT(*)                                                      AS total,
        COUNT(*) FILTER (WHERE e.construction_status = 'complete')   AS complete,
        COUNT(*) FILTER (WHERE e.construction_status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE e.construction_status = 'defective')  AS defective,
        COUNT(*) FILTER (WHERE e.construction_status IS NULL OR e.construction_status = 'not_started') AS not_started,
        ROUND(100.0 * COUNT(*) FILTER (WHERE e.construction_status = 'complete') / NULLIF(COUNT(*), 0), 1) AS completion_pct
      FROM bim_elements e
      WHERE e.project_id = ${projectId} AND e.company_id = ${companyId}
      GROUP BY e.ifc_type
      ORDER BY total DESC
    `);
  }
}