import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  SiteDrawing, SiteDrawingRevision, SiteDrawingWithCurrentRevision, SiteDrawingWorkflowStatus,
  SiteDrawingOfflinePackage, SiteDrawingOfflinePackageStatus, SiteDrawingSourceHealth, ExtractedDrawingFields,
  SiteDrawingOrgMapping, SiteDrawingOrgMappingRole,
} from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { SiteDrawingAdapterRegistry } from './adapters/site-drawing-adapter-registry';
import { NotificationsService, type NotificationPriority } from '../notifications/notifications.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { isConfirmedCurrent, workflowStatusLabel } from './site-drawing-workflow';
import { buildSiteDrawingRegisterWorkbookBuffer, type SiteDrawingRegisterRow } from './site-drawing-register-xls';
import { extractDrawingFields } from './extraction/extract-drawing-fields';
import { resolveOrgMapping } from './extraction/org-mapping-lookup';
import type { RegisterSiteDrawingDto } from './dto/register-drawing.dto';
import type { RegisterSiteDrawingRevisionDto } from './dto/register-revision.dto';
import type { CompleteOfflinePackageDto } from './dto/offline-package.dto';

const DRAWING_MAX_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB: larger than the floor-plan drawings cap; real IFC/architectural PDF sets run bigger
const DRAWING_ALLOWED_EXTENSIONS = new Set(['pdf']);

export interface SiteDrawingFilters {
  search?: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
  responsibleSubcontractor?: string;
  workflowStatus?: SiteDrawingWorkflowStatus;
  page?: number;
  perPage?: number;
}

@Injectable()
export class SiteDrawingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly adapters: SiteDrawingAdapterRegistry,
    private readonly notifications: NotificationsService,
    private readonly aiClient: AiClientService,
  ) {}

  // ── Upload / registration (Local/internal source; brief section 6's
  // "first source for which valid API access and administrator
  // authorization are available": our own platform needs neither, unlike
  // SharePoint/Aconex/Procore, which all require admin-provisioned
  // credentials this environment does not have) ──────────────────────────

  async getUploadUrl(companyId: string, projectId: string, filename: string) {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!DRAWING_ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`File type ".${ext}" is not supported. Allowed: PDF.`);
    }
    const key = this.storage.generateKey(companyId, projectId, 'documents', filename);
    const url = await this.storage.getUploadUrl(key, 'application/pdf', DRAWING_MAX_SIZE_BYTES);
    return { ...url, storageKey: key };
  }

  private async assertUploadedSizeWithinLimit(storageKey: string): Promise<number> {
    const actualSizeBytes = await this.storage.getObjectSize(storageKey);
    if (actualSizeBytes === null) {
      throw new BadRequestException('Uploaded file not found in storage. Complete the upload before registering the drawing.');
    }
    if (actualSizeBytes > DRAWING_MAX_SIZE_BYTES) {
      await this.storage.deleteIfExists(storageKey);
      throw new BadRequestException(
        `Uploaded file (${(actualSizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds the ${DRAWING_MAX_SIZE_BYTES / 1024 / 1024} MB limit. The upload has been rejected and removed.`,
      );
    }
    return actualSizeBytes;
  }

  // Lets "Register a drawing" (a single manual upload) auto-fill from the
  // same embedded-text/OCR pipeline the bulk import path already uses,
  // instead of asking the uploader to type everything from a blank form.
  // Read-only: never writes a drawing/revision row itself -- the caller
  // still submits the (possibly corrected) fields through registerDrawing()
  // afterward, same "never invent, always let a human confirm" rule the
  // import pipeline already follows. Returns null (not a thrown error) when
  // nothing could be confidently read; the form just stays blank for manual
  // entry, exactly like today.
  async extractFields(companyId: string, projectId: string, storageKey: string): Promise<ExtractedDrawingFields | null> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    await this.assertUploadedSizeWithinLimit(storageKey);
    const buffer = await this.storage.download(storageKey);
    return extractDrawingFields(this.storage, this.aiClient, companyId, projectId, storageKey, buffer, storageKey);
  }

  async registerDrawing(companyId: string, projectId: string, userId: string, dto: RegisterSiteDrawingDto): Promise<SiteDrawingWithCurrentRevision> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const fileSizeBytes = await this.assertUploadedSizeWithinLimit(dto.storageKey);

    return this.db.withTenant(companyId, async (sql) => {
      // An explicit value on the DTO always wins; only resolved from the
      // project's own org mapping (master spec section 4) when the human
      // left a field blank.
      const mapped = (dto.originator === undefined || dto.responsibleSubcontractor === undefined)
        ? await resolveOrgMapping(sql, projectId, dto.drawingNumber)
        : { originator: undefined, responsibleSubcontractor: undefined };
      const originator = dto.originator ?? mapped.originator ?? null;
      const responsibleSubcontractor = dto.responsibleSubcontractor ?? mapped.responsibleSubcontractor ?? null;

      const [drawing] = await sql<SiteDrawingRow[]>`
        INSERT INTO site_drawings (
          company_id, project_id, drawing_number, drawing_title, discipline, building_or_zone, floor_or_level,
          originator, responsible_subcontractor, source_provider, source_file_id, created_by, current_workflow_status
        ) VALUES (
          ${companyId}, ${projectId}, ${dto.drawingNumber}, ${dto.drawingTitle}, ${dto.discipline ?? null},
          ${dto.buildingOrZone ?? null}, ${dto.floorOrLevel ?? null}, ${originator}, ${responsibleSubcontractor},
          'internal', ${randomUUID()}, ${userId}, ${dto.workflowStatus}
        ) RETURNING *
      `;

      const [revision] = await sql<SiteDrawingRevisionRow[]>`
        INSERT INTO site_drawing_revisions (
          company_id, project_id, drawing_id, revision_number, workflow_status, issue_date,
          storage_key, file_size_bytes, synchronization_status, uploaded_by
        ) VALUES (
          ${companyId}, ${projectId}, ${drawing.id}, ${dto.revisionNumber}, ${dto.workflowStatus}, ${dto.issueDate ?? null},
          ${dto.storageKey}, ${fileSizeBytes}, 'NOT_APPLICABLE', ${userId}
        ) RETURNING *
      `;

      const [updated] = await sql<SiteDrawingRow[]>`
        UPDATE site_drawings SET current_revision_id = ${revision.id}, current_workflow_status = ${revision.workflowStatus}
        WHERE id = ${drawing.id} RETURNING *
      `;

      return { ...toSiteDrawing(updated), currentRevision: toSiteDrawingRevision(revision) };
    });
  }

  // Adds a new revision to an existing drawing. The previous current
  // revision (if any) is marked superseded; section 5's "latest revision
  // known to the system" moves forward, but the old file stays in the
  // register, clearly labeled, not deleted (section 5: "Keep historical
  // revisions accessible ... label superseded revisions clearly").
  async addRevision(companyId: string, projectId: string, drawingId: string, userId: string, dto: RegisterSiteDrawingRevisionDto): Promise<SiteDrawingWithCurrentRevision> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const fileSizeBytes = await this.assertUploadedSizeWithinLimit(dto.storageKey);

    const result = await this.db.withTenant(companyId, async (sql) => {
      const [drawing] = await sql<SiteDrawingRow[]>`SELECT * FROM site_drawings WHERE id = ${drawingId} AND project_id = ${projectId}`;
      if (!drawing) throw new NotFoundException(`Drawing ${drawingId} not found.`);

      const previousRevisionId = drawing.currentRevisionId ?? null;
      const [previousRevision] = previousRevisionId
        ? await sql<SiteDrawingRevisionRow[]>`SELECT revision_number FROM site_drawing_revisions WHERE id = ${previousRevisionId}`
        : [];

      // Same duplicate concept the bulk import path reconciles against
      // (site-drawing-import.processor.ts's `currentRevision.revisionNumber
      // === revisionNumber` check) -- a human re-adding the current
      // revision's own number isn't a new revision; rejecting it here beats
      // silently creating a second row with the same revision number and
      // marking the real one superseded by its own duplicate.
      if (previousRevision && previousRevision.revisionNumber.trim().toLowerCase() === dto.revisionNumber.trim().toLowerCase()) {
        throw new BadRequestException(`Revision ${previousRevision.revisionNumber} is already the current revision for this drawing. Give the new file its own revision number.`);
      }

      const [revision] = await sql<SiteDrawingRevisionRow[]>`
        INSERT INTO site_drawing_revisions (
          company_id, project_id, drawing_id, revision_number, workflow_status, issue_date,
          storage_key, file_size_bytes, supersedes_revision_id, synchronization_status, uploaded_by,
          offline_eligibility
        ) VALUES (
          ${companyId}, ${projectId}, ${drawingId}, ${dto.revisionNumber}, ${dto.workflowStatus}, ${dto.issueDate ?? null},
          ${dto.storageKey}, ${fileSizeBytes}, ${previousRevisionId}, 'NOT_APPLICABLE', ${userId},
          ${dto.offlineEligibility ?? true}
        ) RETURNING *
      `;

      if (previousRevisionId) {
        await sql`UPDATE site_drawing_revisions SET is_superseded = true WHERE id = ${previousRevisionId}`;
      }

      const [updated] = await sql<SiteDrawingRow[]>`
        UPDATE site_drawings
        SET current_revision_id = ${revision.id}, current_workflow_status = ${revision.workflowStatus}, current_is_superseded = false
        WHERE id = ${drawingId} RETURNING *
      `;

      return { ...toSiteDrawing(updated), currentRevision: toSiteDrawingRevision(revision) };
    });

    // Brief section 5: "Notify relevant users" when a new revision becomes
    // current. Every project member, same as the brief's own wording (no
    // narrower "watchers" concept exists on this register yet); called
    // after the transaction commits, never nested inside it (notifications
    // writes through its own withTenant call, a separate connection).
    await this.notifyProjectMembers(companyId, projectId, userId, {
      type: 'site_drawing_revision_added',
      title: `New revision ${dto.revisionNumber} for drawing ${result.drawingNumber}: ${result.drawingTitle}`,
      resourceType: 'site_drawing',
      resourceId: drawingId,
      priority: 'normal',
    });

    return result;
  }

  // ── Register: search, filter, list ──────────────────────────────────────

  // The Hub's filter bar (SiteDrawingHubPage.tsx) keeps every unset filter
  // as '' rather than undefined (a controlled-input/Listbox convention --
  // "All disciplines" etc. is represented as the empty string), and sends
  // it straight through as a query param. Each filter clause below only
  // skips itself on NULL (`${x ?? null}::text IS NULL`), so an empty
  // string was falling through to an actual equality/tsquery check against
  // '' -- which matches nothing -- silently filtering out every drawing on
  // first load. Normalizing '' (and whitespace-only) to undefined here,
  // once, is the fix: it matches exportSiteDrawingRegister()'s own
  // existing (client-side only) empty-string stripping, but makes it a
  // real contract of this method instead of something only one caller
  // happened to do correctly.
  private normalizeFilters<T extends SiteDrawingFilters>(filters: T): T {
    const clean = (v: string | undefined) => (v && v.trim() !== '' ? v : undefined);
    return {
      ...filters,
      search: clean(filters.search),
      discipline: clean(filters.discipline),
      buildingOrZone: clean(filters.buildingOrZone),
      floorOrLevel: clean(filters.floorOrLevel),
      responsibleSubcontractor: clean(filters.responsibleSubcontractor),
      workflowStatus: filters.workflowStatus ? filters.workflowStatus : undefined,
    };
  }

  async listDrawings(companyId: string, projectId: string, rawFilters: SiteDrawingFilters): Promise<{ data: SiteDrawingWithCurrentRevision[]; total: number }> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const filters = this.normalizeFilters(rawFilters);
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(200, Math.max(1, filters.perPage ?? 50));
    const offset = (page - 1) * perPage;

    return this.db.withTenant(companyId, async (sql) => {
      const rows = await sql<(SiteDrawingRow & SiteDrawingRevisionJoinRow)[]>`
        SELECT d.*, r.id AS revision_id, r.revision_number, r.workflow_status AS revision_workflow_status,
               r.source_status_raw, r.issue_date, r.source_modified_at, r.last_verified_at, r.content_hash,
               r.storage_key, r.source_revision_id, r.source_web_url AS revision_source_web_url, r.file_size_bytes,
               r.supersedes_revision_id, r.is_superseded, r.offline_eligibility, r.synchronization_status,
               r.uploaded_by, r.document_classification, r.suitability_code, r.extraction_status,
               r.extracted_fields_raw, r.import_batch_id, r.review_notes,
               r.created_at AS revision_created_at, r.updated_at AS revision_updated_at,
               count(*) OVER() AS full_count
        FROM site_drawings d
        LEFT JOIN site_drawing_revisions r ON r.id = d.current_revision_id
        WHERE d.project_id = ${projectId}
          AND (${filters.search ?? null}::text IS NULL OR d.search_vector @@ plainto_tsquery('english', ${filters.search ?? ''}))
          AND (${filters.discipline ?? null}::text IS NULL OR d.discipline = ${filters.discipline ?? null})
          AND (${filters.buildingOrZone ?? null}::text IS NULL OR d.building_or_zone = ${filters.buildingOrZone ?? null})
          AND (${filters.floorOrLevel ?? null}::text IS NULL OR d.floor_or_level = ${filters.floorOrLevel ?? null})
          AND (${filters.responsibleSubcontractor ?? null}::text IS NULL OR d.responsible_subcontractor = ${filters.responsibleSubcontractor ?? null})
          AND (${filters.workflowStatus ?? null}::text IS NULL OR d.current_workflow_status = ${filters.workflowStatus ?? null})
        ORDER BY d.drawing_number ASC
        LIMIT ${perPage} OFFSET ${offset}
      `;

      const data = rows.map((row) => ({
        ...toSiteDrawing(row),
        currentRevision: row.revisionId ? toSiteDrawingRevisionFromJoin(row) : null,
      }));
      const total = rows.length > 0 ? Number(rows[0].fullCount) : 0;
      return { data, total };
    });
  }

  // Distinct discipline/building/floor values actually present, for filter
  // dropdowns; never a hardcoded list, since every project's own taxonomy
  // differs.
  async getFilterOptions(companyId: string, projectId: string) {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    return this.db.withTenant(companyId, sql => sql<{ discipline: string | null; buildingOrZone: string | null; floorOrLevel: string | null; responsibleSubcontractor: string | null }[]>`
      SELECT DISTINCT discipline, building_or_zone, floor_or_level, responsible_subcontractor FROM site_drawings WHERE project_id = ${projectId}
    `).then((rows) => ({
      disciplines: Array.from(new Set(rows.map(r => r.discipline).filter((v): v is string => Boolean(v)))).sort(),
      buildingsOrZones: Array.from(new Set(rows.map(r => r.buildingOrZone).filter((v): v is string => Boolean(v)))).sort(),
      floorsOrLevels: Array.from(new Set(rows.map(r => r.floorOrLevel).filter((v): v is string => Boolean(v)))).sort(),
      subcontractors: Array.from(new Set(rows.map(r => r.responsibleSubcontractor).filter((v): v is string => Boolean(v)))).sort(),
    }));
  }

  // Brief section 3: Excel export of the register. Same WHERE clause as
  // listDrawings() (every filter the Hub's search/filter bar supports
  // applies here too), but every matching row, never just the current
  // page; the register is a persistent record, and a document controller
  // exporting it for a client/consultant needs the whole filtered set,
  // not whatever happened to be on screen.
  async exportRegister(companyId: string, projectId: string, rawFilters: Omit<SiteDrawingFilters, 'page' | 'perPage'>): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const filters = this.normalizeFilters(rawFilters);

    const [project, rows] = await this.db.withTenant(companyId, async (sql) => {
      const [projectRow] = await sql<{ name: string; code: string | null }[]>`
        SELECT name, code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
      `;
      const drawingRows = await sql<(SiteDrawingRow & SiteDrawingRevisionJoinRow)[]>`
        SELECT d.*, r.id AS revision_id, r.revision_number, r.workflow_status AS revision_workflow_status,
               r.source_status_raw, r.issue_date, r.source_modified_at, r.last_verified_at, r.content_hash,
               r.storage_key, r.source_revision_id, r.source_web_url AS revision_source_web_url, r.file_size_bytes,
               r.supersedes_revision_id, r.is_superseded, r.offline_eligibility, r.synchronization_status,
               r.uploaded_by, r.document_classification, r.suitability_code, r.extraction_status,
               r.extracted_fields_raw, r.import_batch_id, r.review_notes,
               r.created_at AS revision_created_at, r.updated_at AS revision_updated_at
        FROM site_drawings d
        LEFT JOIN site_drawing_revisions r ON r.id = d.current_revision_id
        WHERE d.project_id = ${projectId}
          AND (${filters.search ?? null}::text IS NULL OR d.search_vector @@ plainto_tsquery('english', ${filters.search ?? ''}))
          AND (${filters.discipline ?? null}::text IS NULL OR d.discipline = ${filters.discipline ?? null})
          AND (${filters.buildingOrZone ?? null}::text IS NULL OR d.building_or_zone = ${filters.buildingOrZone ?? null})
          AND (${filters.floorOrLevel ?? null}::text IS NULL OR d.floor_or_level = ${filters.floorOrLevel ?? null})
          AND (${filters.responsibleSubcontractor ?? null}::text IS NULL OR d.responsible_subcontractor = ${filters.responsibleSubcontractor ?? null})
          AND (${filters.workflowStatus ?? null}::text IS NULL OR d.current_workflow_status = ${filters.workflowStatus ?? null})
        ORDER BY d.drawing_number ASC
      `;
      return [projectRow, drawingRows] as const;
    });

    const registerRows: SiteDrawingRegisterRow[] = rows.map((row) => ({
      drawingNumber: row.drawingNumber,
      drawingTitle: row.drawingTitle,
      discipline: row.discipline ?? undefined,
      buildingOrZone: row.buildingOrZone ?? undefined,
      floorOrLevel: row.floorOrLevel ?? undefined,
      originator: row.originator ?? undefined,
      responsibleSubcontractor: row.responsibleSubcontractor ?? undefined,
      revisionNumber: row.revisionId ? row.revisionNumber : undefined,
      workflowStatus: row.currentWorkflowStatus,
      documentClassification: row.revisionId ? row.documentClassification : 'CONSTRUCTION',
      isSuperseded: row.currentIsSuperseded,
      sourceProvider: row.sourceProvider,
      issueDate: row.issueDate ?? undefined,
      lastVerifiedAt: row.lastVerifiedAt ?? undefined,
      extractionStatus: row.revisionId ? row.extractionStatus : undefined,
      importBatchId: row.importBatchId ?? undefined,
    }));

    const projectLabel = project ? (project.code ? `${project.name} (${project.code})` : project.name) : 'Project';
    const buffer = await buildSiteDrawingRegisterWorkbookBuffer(registerRows, projectLabel);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${(project?.code ?? 'drawing-register').replace(/[^a-z0-9-]+/gi, '-')}-drawing-register-${date}.xlsx`;
    return { buffer: Buffer.from(buffer), filename };
  }

  async getDrawing(companyId: string, projectId: string, drawingId: string): Promise<SiteDrawingWithCurrentRevision> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    return this.db.withTenant(companyId, async (sql) => {
      const [drawing] = await sql<SiteDrawingRow[]>`SELECT * FROM site_drawings WHERE id = ${drawingId} AND project_id = ${projectId}`;
      if (!drawing) throw new NotFoundException(`Drawing ${drawingId} not found.`);
      const revision = drawing.currentRevisionId
        ? (await sql<SiteDrawingRevisionRow[]>`SELECT * FROM site_drawing_revisions WHERE id = ${drawing.currentRevisionId}`)[0]
        : undefined;
      return { ...toSiteDrawing(drawing), currentRevision: revision ? toSiteDrawingRevision(revision) : null };
    });
  }

  async listRevisions(companyId: string, projectId: string, drawingId: string): Promise<SiteDrawingRevision[]> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const rows = await this.db.withTenant(companyId, sql => sql<SiteDrawingRevisionRow[]>`
      SELECT * FROM site_drawing_revisions WHERE drawing_id = ${drawingId} AND project_id = ${projectId} ORDER BY created_at DESC
    `);
    return rows.map(r => toSiteDrawingRevision(r));
  }

  // Short-lived, scoped download link for an authenticated, authorized
  // request only (section 9: never a persistent unrestricted signed URL).
  // Authorization is enforced by the controller's own guard + this
  // project-membership assertion; possessing a revisionId alone is never
  // sufficient (it's resolved through the project it actually belongs to).
  //
  // `purpose` splits the one URL this always was into what the spec
  // actually asks for two different things: 'view' (default) backs the
  // in-browser PDF viewer, which must keep working on a superseded
  // revision (section 7/8 require the watermark + history to stay
  // reachable there); 'download' backs an explicit save-the-file action
  // (today: "Download for offline") and is the one the spec means by
  // "no original PDF download through Reality Capture" for a superseded
  // revision -- enforced here, not by hiding the button, and not
  // bypassable by reusing a URL minted before the drawing was superseded
  // (each call re-checks current status; the signed URL itself still
  // expires on its own short TTL regardless).
  //
  // Audited explicitly (writeAccessAudit below) rather than relying on
  // AuditInterceptor; this is a GET route (read, by design: issuing a
  // download URL doesn't change anything), and the interceptor only covers
  // mutating methods. Section 9's "audit events for document access,
  // download" needs this logged regardless of HTTP verb.
  async getAuthorizedDownloadUrl(
    companyId: string, projectId: string, userId: string, revisionId: string, purpose: 'view' | 'download' = 'view',
  ): Promise<{ url: string; expiresInSeconds: number; workflowStatus: SiteDrawingWorkflowStatus; isSuperseded: boolean }> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const [revision] = await this.db.withTenant(companyId, sql => sql<SiteDrawingRevisionRow[]>`
      SELECT * FROM site_drawing_revisions WHERE id = ${revisionId} AND project_id = ${projectId}
    `);
    if (!revision) throw new NotFoundException(`Revision ${revisionId} not found.`);

    if (purpose === 'download' && revision.isSuperseded) {
      throw new ForbiddenException('This revision has been superseded and can no longer be downloaded through Reality Capture. View it in the browser, or open the current revision to download.');
    }

    const { url, expiresInSeconds } = revision.storageKey
      ? { url: await this.storage.getReadUrl(revision.storageKey, 900), expiresInSeconds: 900 }
      : await this.getAuthorizedFileFromSource(companyId, projectId, revision);

    await this.writeAccessAudit(companyId, projectId, userId, 'site_drawing_revision', revision.id, purpose === 'download' ? 'site_drawing.downloaded' : 'site_drawing.viewed');
    return { url, expiresInSeconds, workflowStatus: revision.workflowStatus, isSuperseded: revision.isSuperseded };
  }

  // The "not stored locally" branch above: resolves the revision's own
  // drawing (for its sourceProvider + sourceFileId) and asks that
  // provider's adapter for a short-lived URL to the file itself
  // (revision.sourceRevisionId, when set, asks for that specific
  // historical version rather than the current one; see
  // DrawingSourceAdapter's own comment).
  private async getAuthorizedFileFromSource(companyId: string, projectId: string, revision: SiteDrawingRevisionRow): Promise<{ url: string; expiresInSeconds: number }> {
    const [drawing] = await this.db.withTenant(companyId, sql => sql<SiteDrawingRow[]>`
      SELECT * FROM site_drawings WHERE id = ${revision.drawingId} AND project_id = ${projectId}
    `);
    if (!drawing) throw new NotFoundException(`Drawing ${revision.drawingId} not found.`);

    const adapter = this.adapters.resolve(drawing.sourceProvider);
    if (!adapter?.getAuthorizedFile) {
      throw new BadRequestException('This revision has no locally stored file and its source does not support a proxied download — open it at the source instead.');
    }
    return adapter.getAuthorizedFile(companyId, projectId, drawing.sourceFileId, revision.sourceRevisionId ?? undefined);
  }

  // Supplements, does not replace, AuditInterceptor's generic coverage of
  // mutating routes; mirrors RfisService.writeRfiAudit()'s own pattern
  // for the same reason (a GET-based access the interceptor can't see).
  private async writeAccessAudit(companyId: string, projectId: string, userId: string, resourceType: string, resourceId: string, action: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO audit_log (company_id, project_id, user_id, action, resource_type, resource_id, source)
      VALUES (${companyId}, ${projectId}, ${userId}, ${action}, ${resourceType}, ${resourceId}, 'api')
    `);
  }

  // ── Workflow status (document-control decisions; gated by the
  // 'approve' category action in the controller, stricter than 'edit') ────

  async setWorkflowStatus(companyId: string, projectId: string, drawingId: string, revisionId: string, status: SiteDrawingWorkflowStatus, userId?: string): Promise<SiteDrawingRevision> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const { revision, drawingNumber, drawingTitle } = await this.db.withTenant(companyId, async (sql) => {
      const [updatedRevision] = await sql<SiteDrawingRevisionRow[]>`
        UPDATE site_drawing_revisions SET workflow_status = ${status}, updated_at = now()
        WHERE id = ${revisionId} AND drawing_id = ${drawingId} AND project_id = ${projectId} RETURNING *
      `;
      if (!updatedRevision) throw new NotFoundException(`Revision ${revisionId} not found on drawing ${drawingId}.`);

      const [drawing] = await sql<{ currentRevisionId: string | null; drawingNumber: string; drawingTitle: string }[]>`
        SELECT current_revision_id, drawing_number, drawing_title FROM site_drawings WHERE id = ${drawingId}
      `;
      if (drawing?.currentRevisionId === revisionId) {
        await sql`UPDATE site_drawings SET current_workflow_status = ${status} WHERE id = ${drawingId}`;
      }
      return { revision: updatedRevision, drawingNumber: drawing?.drawingNumber, drawingTitle: drawing?.drawingTitle };
    });

    // Brief section 5: "Notify relevant users" on every status change --
    // an approval, a rejection, a withdrawal are all decisions the rest of
    // the project needs to know about, not just the person who made them.
    await this.notifyProjectMembers(companyId, projectId, userId, {
      type: 'site_drawing_status_changed',
      title: `Drawing ${drawingNumber ?? drawingId} (${drawingTitle ?? ''}) revision ${revision.revisionNumber} is now ${workflowStatusLabel(status)}`,
      resourceType: 'site_drawing',
      resourceId: drawingId,
      priority: (['SUPERSEDED', 'REJECTED', 'WITHDRAWN'] as SiteDrawingWorkflowStatus[]).includes(status) ? 'high' : 'normal',
    });

    return toSiteDrawingRevision(revision);
  }

  async getSourceHealth(companyId: string, projectId: string): Promise<SiteDrawingSourceHealth> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const [lastLog] = await this.db.withTenant(companyId, sql => sql<{ startedAt: string; finishedAt: string | null; status: string | null }[]>`
      SELECT started_at, finished_at, status FROM site_drawing_sync_log
      WHERE project_id = ${projectId} AND source_provider = 'internal'
      ORDER BY started_at DESC LIMIT 1
    `);
    const health = await this.adapters.resolve('internal')!.getSourceHealth(companyId, projectId);
    return {
      provider: 'internal',
      reachable: health.reachable,
      detail: health.detail,
      lastAttemptedSyncAt: lastLog?.startedAt,
      lastSuccessfulSyncAt: lastLog?.status === 'SUCCESS' ? (lastLog.finishedAt ?? undefined) : undefined,
    };
  }

  // ── Offline packages (brief section 8; metadata only; the PDF bytes
  // live in the client's own IndexedDB, never in Postgres) ───────────────

  async startOfflinePackage(companyId: string, userId: string, projectId: string, revisionId: string): Promise<SiteDrawingOfflinePackage> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    return this.db.withTenant(companyId, async (sql) => {
      const [revision] = await sql<SiteDrawingRevisionRow[]>`SELECT * FROM site_drawing_revisions WHERE id = ${revisionId} AND project_id = ${projectId}`;
      if (!revision) throw new NotFoundException(`Revision ${revisionId} not found.`);
      if (!revision.offlineEligibility) throw new BadRequestException('This revision is not eligible for offline download.');

      const [pkg] = await sql<SiteDrawingOfflinePackageRow[]>`
        INSERT INTO site_drawing_offline_packages (company_id, user_id, project_id, drawing_id, revision_id, status)
        VALUES (${companyId}, ${userId}, ${projectId}, ${revision.drawingId}, ${revisionId}, 'DOWNLOADING')
        ON CONFLICT (user_id, revision_id) DO UPDATE SET status = 'DOWNLOADING', updated_at = now()
        RETURNING *
      `;
      return toOfflinePackage(pkg);
    });
  }

  // The client reports what actually happened to the download; a
  // 'FAILED' report here is exactly how section 8/10's "a partial or
  // corrupted download is never presented as a complete package" is
  // enforced: the server trusts the client's own integrity check, not a
  // bare "it finished" signal.
  async completeOfflinePackage(companyId: string, userId: string, packageId: string, dto: CompleteOfflinePackageDto): Promise<SiteDrawingOfflinePackage> {
    const [pkg] = await this.db.withTenant(companyId, sql => sql<SiteDrawingOfflinePackageRow[]>`
      UPDATE site_drawing_offline_packages
      SET status = ${dto.status}, content_hash = ${dto.contentHash ?? null}, file_size_bytes = ${dto.fileSizeBytes ?? null},
          downloaded_at = CASE WHEN ${dto.status} = 'COMPLETE' THEN now() ELSE downloaded_at END,
          last_verified_at = now(), updated_at = now()
      WHERE id = ${packageId} AND user_id = ${userId} RETURNING *
    `);
    if (!pkg) throw new NotFoundException(`Offline package ${packageId} not found.`);
    return toOfflinePackage(pkg);
  }

  async listOfflinePackages(companyId: string, userId: string, projectId?: string): Promise<SiteDrawingOfflinePackage[]> {
    const rows = await this.db.withTenant(companyId, sql => sql<SiteDrawingOfflinePackageRow[]>`
      SELECT * FROM site_drawing_offline_packages
      WHERE user_id = ${userId} AND status != 'REMOVED' AND (${projectId ?? null}::uuid IS NULL OR project_id = ${projectId ?? null})
      ORDER BY updated_at DESC
    `);
    return rows.map(toOfflinePackage);
  }

  // Revalidates one offline package against the current register on
  // reconnect (section 8: "revalidate metadata and detect changed,
  // superseded, withdrawn, or revoked documents"). Returns the package's
  // own freshness alongside the revision it was taken from, so the client
  // can show "this offline copy has been superseded" without a second
  // round trip.
  async revalidateOfflinePackage(companyId: string, userId: string, packageId: string): Promise<{ package: SiteDrawingOfflinePackage; revision: SiteDrawingRevision; isStale: boolean }> {
    return this.db.withTenant(companyId, async (sql) => {
      const [pkg] = await sql<SiteDrawingOfflinePackageRow[]>`SELECT * FROM site_drawing_offline_packages WHERE id = ${packageId} AND user_id = ${userId}`;
      if (!pkg) throw new NotFoundException(`Offline package ${packageId} not found.`);
      const [revision] = await sql<SiteDrawingRevisionRow[]>`SELECT * FROM site_drawing_revisions WHERE id = ${pkg.revisionId}`;
      if (!revision) throw new NotFoundException(`Revision for offline package ${packageId} no longer exists.`);

      const isStale = revision.isSuperseded || revision.workflowStatus === 'WITHDRAWN' || !isConfirmedCurrent(revision.workflowStatus, revision.isSuperseded, revision.documentClassification);
      const newStatus: SiteDrawingOfflinePackageStatus = isStale ? 'STALE' : pkg.status;
      const [updated] = await sql<SiteDrawingOfflinePackageRow[]>`
        UPDATE site_drawing_offline_packages SET status = ${newStatus}, last_verified_at = now(), updated_at = now()
        WHERE id = ${packageId} RETURNING *
      `;
      return { package: toOfflinePackage(updated), revision: toSiteDrawingRevision(revision), isStale };
    });
  }

  async removeOfflinePackage(companyId: string, userId: string, packageId: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE site_drawing_offline_packages SET status = 'REMOVED', updated_at = now() WHERE id = ${packageId} AND user_id = ${userId}
    `);
  }

  // Clears every offline-package record for a user in this company (section
  // 9: "Clear locally cached protected data when the user signs out or
  // access policy requires it"). Only clears the server-side *record* of
  // what's cached; the client is responsible for actually deleting the
  // IndexedDB bytes on sign-out; see the web app's offline store for that
  // half.
  async clearAllOfflinePackagesForUser(companyId: string, userId: string): Promise<number> {
    const rows = await this.db.withTenant(companyId, sql => sql`
      UPDATE site_drawing_offline_packages SET status = 'REMOVED', updated_at = now()
      WHERE user_id = ${userId} AND status != 'REMOVED' RETURNING id
    `);
    return rows.length;
  }

  // ── Organization mapping (master spec section 4) ────────────────────────

  async listOrgMappings(companyId: string, projectId: string): Promise<SiteDrawingOrgMapping[]> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const rows = await this.db.withTenant(companyId, sql => sql<SiteDrawingOrgMappingRow[]>`
      SELECT * FROM site_drawing_org_mappings WHERE project_id = ${projectId} ORDER BY pattern ASC
    `);
    return rows.map(toOrgMapping);
  }

  async createOrgMapping(
    companyId: string, projectId: string, userId: string, pattern: string, organizationName: string, role: SiteDrawingOrgMappingRole,
  ): Promise<SiteDrawingOrgMapping> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const [row] = await this.db.withTenant(companyId, sql => sql<SiteDrawingOrgMappingRow[]>`
      INSERT INTO site_drawing_org_mappings (company_id, project_id, pattern, organization_name, role, created_by)
      VALUES (${companyId}, ${projectId}, ${pattern}, ${organizationName}, ${role}, ${userId})
      ON CONFLICT (project_id, pattern, role) DO UPDATE SET organization_name = EXCLUDED.organization_name
      RETURNING *
    `);
    return toOrgMapping(row);
  }

  async deleteOrgMapping(companyId: string, projectId: string, mappingId: string): Promise<void> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    await this.db.withTenant(companyId, sql => sql`
      DELETE FROM site_drawing_org_mappings WHERE id = ${mappingId} AND project_id = ${projectId}
    `);
  }

  // ── Landing dashboard stats (master spec section 10) ────────────────────
  // One pass over the register's status columns, server-side -- the Hub
  // page needs this on first load alongside the filtered list, not a
  // second full client-side scan of whatever page happens to be loaded.
  async getDashboardStats(companyId: string, projectId: string): Promise<{
    total: number; currentAuthorized: number; superseded: number; underReview: number;
    newlyReceived: number; requiringAttention: number; recentRevisionActivity: number;
  }> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    return this.db.withTenant(companyId, async (sql) => {
      const [counts] = await sql<{
        total: string; currentAuthorized: string; superseded: string; underReview: string;
        newlyReceived: string; requiringAttention: string;
      }[]>`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE current_workflow_status IN ('APPROVED', 'APPROVED_FOR_CONSTRUCTION') AND NOT current_is_superseded) AS "currentAuthorized",
          count(*) FILTER (WHERE current_is_superseded) AS superseded,
          count(*) FILTER (WHERE current_workflow_status = 'UNDER_REVIEW') AS "underReview",
          count(*) FILTER (WHERE created_at > now() - interval '7 days') AS "newlyReceived",
          count(*) FILTER (WHERE current_workflow_status IN ('UNKNOWN', 'REJECTED', 'WITHDRAWN')) AS "requiringAttention"
        FROM site_drawings WHERE project_id = ${projectId}
      `;
      const [{ recentRevisionActivity }] = await sql<{ recentRevisionActivity: string }[]>`
        SELECT count(*) AS "recentRevisionActivity" FROM site_drawing_revisions
        WHERE project_id = ${projectId} AND created_at > now() - interval '7 days'
      `;
      return {
        total: Number(counts.total), currentAuthorized: Number(counts.currentAuthorized), superseded: Number(counts.superseded),
        underReview: Number(counts.underReview), newlyReceived: Number(counts.newlyReceived),
        requiringAttention: Number(counts.requiringAttention), recentRevisionActivity: Number(recentRevisionActivity),
      };
    });
  }

  private async assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
  }

  // "Every project member" (brief section 5), not a narrower watchers/
  // subscribers list -- this register has no such concept yet. Excludes
  // the actor who made the change: a user doesn't need to be told about
  // their own action. Runs after the triggering write's own withTenant
  // call has already resolved -- each notification is its own separate
  // withTenant call (NotificationsService.create()), never nested inside
  // another one.
  private async notifyProjectMembers(
    companyId: string, projectId: string, excludeUserId: string | undefined,
    input: { type: string; title: string; resourceType: string; resourceId: string; priority?: NotificationPriority },
  ): Promise<void> {
    const members = await this.db.withTenant(companyId, sql => sql<{ userId: string }[]>`
      SELECT user_id FROM project_members WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    await Promise.all(
      members
        .filter((m) => m.userId !== excludeUserId)
        .map((m) => this.notifications.create(companyId, { ...input, category: 'drawing', userId: m.userId, projectId, createdBy: excludeUserId ?? null })),
    );
  }
}

// ── Row shapes + mappers ───────────────────────────────────────────────────

interface SiteDrawingRow {
  id: string; companyId: string; projectId: string; drawingNumber: string; drawingTitle: string;
  discipline: string | null; buildingOrZone: string | null; floorOrLevel: string | null;
  originator: string | null; responsibleSubcontractor: string | null;
  sourceProvider: SiteDrawing['sourceProvider']; sourceFileId: string; sourceWebUrl: string | null;
  currentRevisionId: string | null; currentWorkflowStatus: SiteDrawingWorkflowStatus; currentIsSuperseded: boolean;
  createdBy: string | null; createdAt: string; updatedAt: string;
}

interface SiteDrawingRevisionRow {
  id: string; companyId: string; projectId: string; drawingId: string; revisionNumber: string;
  workflowStatus: SiteDrawingWorkflowStatus; sourceStatusRaw: string | null; issueDate: string | null;
  sourceModifiedAt: string | null; lastVerifiedAt: string | null; contentHash: string | null;
  storageKey: string | null; sourceRevisionId: string | null; sourceWebUrl: string | null; fileSizeBytes: string | number | null;
  supersedesRevisionId: string | null; isSuperseded: boolean; offlineEligibility: boolean;
  synchronizationStatus: SiteDrawingRevision['synchronizationStatus']; uploadedBy: string | null;
  documentClassification: SiteDrawingRevision['documentClassification']; suitabilityCode: string | null;
  extractionStatus: SiteDrawingRevision['extractionStatus']; extractedFieldsRaw: SiteDrawingRevision['extractedFieldsRaw'] | null;
  importBatchId: string | null; reviewNotes: string | null;
  createdAt: string; updatedAt: string;
}

interface SiteDrawingRevisionJoinRow {
  revisionId: string | null; revisionNumber: string; revisionWorkflowStatus: SiteDrawingWorkflowStatus;
  sourceStatusRaw: string | null; issueDate: string | null; sourceModifiedAt: string | null; lastVerifiedAt: string | null;
  contentHash: string | null; storageKey: string | null; sourceRevisionId: string | null; revisionSourceWebUrl: string | null;
  fileSizeBytes: string | number | null; supersedesRevisionId: string | null; isSuperseded: boolean;
  offlineEligibility: boolean; synchronizationStatus: SiteDrawingRevision['synchronizationStatus'];
  uploadedBy: string | null; documentClassification: SiteDrawingRevision['documentClassification']; suitabilityCode: string | null;
  extractionStatus: SiteDrawingRevision['extractionStatus']; extractedFieldsRaw: SiteDrawingRevision['extractedFieldsRaw'] | null;
  importBatchId: string | null; reviewNotes: string | null;
  revisionCreatedAt: string; revisionUpdatedAt: string; fullCount: string | number;
}

interface SiteDrawingOfflinePackageRow {
  id: string; companyId: string; userId: string; projectId: string; drawingId: string; revisionId: string;
  status: SiteDrawingOfflinePackageStatus; contentHash: string | null; fileSizeBytes: string | number | null;
  downloadedAt: string | null; lastVerifiedAt: string; createdAt: string; updatedAt: string;
}

interface SiteDrawingOrgMappingRow {
  id: string; companyId: string; projectId: string; pattern: string; organizationName: string;
  role: SiteDrawingOrgMappingRole; createdBy: string; createdAt: string;
}

function toOrgMapping(row: SiteDrawingOrgMappingRow): SiteDrawingOrgMapping {
  return {
    id: row.id, companyId: row.companyId, projectId: row.projectId, pattern: row.pattern,
    organizationName: row.organizationName, role: row.role, createdBy: row.createdBy, createdAt: row.createdAt,
  };
}

function toSiteDrawing(row: SiteDrawingRow): SiteDrawing {
  return {
    id: row.id, companyId: row.companyId, projectId: row.projectId, drawingNumber: row.drawingNumber,
    drawingTitle: row.drawingTitle, discipline: row.discipline ?? undefined, buildingOrZone: row.buildingOrZone ?? undefined,
    floorOrLevel: row.floorOrLevel ?? undefined, originator: row.originator ?? undefined,
    responsibleSubcontractor: row.responsibleSubcontractor ?? undefined,
    sourceProvider: row.sourceProvider, sourceFileId: row.sourceFileId,
    sourceWebUrl: row.sourceWebUrl ?? undefined, currentRevisionId: row.currentRevisionId ?? undefined,
    currentWorkflowStatus: row.currentWorkflowStatus, currentIsSuperseded: row.currentIsSuperseded,
    createdBy: row.createdBy ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toSiteDrawingRevision(r: SiteDrawingRevisionRow): SiteDrawingRevision {
  return {
    id: r.id, companyId: r.companyId, projectId: r.projectId, drawingId: r.drawingId, revisionNumber: r.revisionNumber,
    workflowStatus: r.workflowStatus, sourceStatusRaw: r.sourceStatusRaw ?? undefined, issueDate: r.issueDate ?? undefined,
    sourceModifiedAt: r.sourceModifiedAt ?? undefined, lastVerifiedAt: r.lastVerifiedAt ?? undefined, contentHash: r.contentHash ?? undefined,
    storageKey: r.storageKey ?? undefined, sourceRevisionId: r.sourceRevisionId ?? undefined, sourceWebUrl: r.sourceWebUrl ?? undefined,
    fileSizeBytes: r.fileSizeBytes != null ? Number(r.fileSizeBytes) : undefined, supersedesRevisionId: r.supersedesRevisionId ?? undefined,
    isSuperseded: r.isSuperseded, offlineEligibility: r.offlineEligibility, synchronizationStatus: r.synchronizationStatus,
    uploadedBy: r.uploadedBy ?? undefined, documentClassification: r.documentClassification, suitabilityCode: r.suitabilityCode ?? undefined,
    extractionStatus: r.extractionStatus, extractedFieldsRaw: r.extractedFieldsRaw ?? undefined, importBatchId: r.importBatchId ?? undefined,
    reviewNotes: r.reviewNotes ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

// Reads the current_revision_id-joined column names (revisionX) instead of
// the plain revision-table column names, for listDrawings()'s single-query
// register fetch.
function toSiteDrawingRevisionFromJoin(r: SiteDrawingRow & SiteDrawingRevisionJoinRow): SiteDrawingRevision {
  return {
    id: r.revisionId!, companyId: r.companyId, projectId: r.projectId, drawingId: r.id,
    revisionNumber: r.revisionNumber, workflowStatus: r.revisionWorkflowStatus, sourceStatusRaw: r.sourceStatusRaw ?? undefined,
    issueDate: r.issueDate ?? undefined, sourceModifiedAt: r.sourceModifiedAt ?? undefined, lastVerifiedAt: r.lastVerifiedAt ?? undefined,
    contentHash: r.contentHash ?? undefined, storageKey: r.storageKey ?? undefined, sourceRevisionId: r.sourceRevisionId ?? undefined, sourceWebUrl: r.revisionSourceWebUrl ?? undefined,
    fileSizeBytes: r.fileSizeBytes != null ? Number(r.fileSizeBytes) : undefined, supersedesRevisionId: r.supersedesRevisionId ?? undefined,
    isSuperseded: r.isSuperseded, offlineEligibility: r.offlineEligibility, synchronizationStatus: r.synchronizationStatus,
    uploadedBy: r.uploadedBy ?? undefined, documentClassification: r.documentClassification, suitabilityCode: r.suitabilityCode ?? undefined,
    extractionStatus: r.extractionStatus, extractedFieldsRaw: r.extractedFieldsRaw ?? undefined, importBatchId: r.importBatchId ?? undefined,
    reviewNotes: r.reviewNotes ?? undefined, createdAt: r.revisionCreatedAt, updatedAt: r.revisionUpdatedAt,
  };
}

function toOfflinePackage(row: SiteDrawingOfflinePackageRow): SiteDrawingOfflinePackage {
  return {
    id: row.id, companyId: row.companyId, userId: row.userId, projectId: row.projectId, drawingId: row.drawingId,
    revisionId: row.revisionId, status: row.status, contentHash: row.contentHash ?? undefined,
    fileSizeBytes: row.fileSizeBytes != null ? Number(row.fileSizeBytes) : undefined, downloadedAt: row.downloadedAt ?? undefined,
    lastVerifiedAt: row.lastVerifiedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
