import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  SiteDrawing, SiteDrawingRevision, SiteDrawingWithCurrentRevision, SiteDrawingWorkflowStatus,
  SiteDrawingOfflinePackage, SiteDrawingOfflinePackageStatus, SiteDrawingSourceHealth,
} from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { SiteDrawingLocalAdapter } from './adapters/local-adapter';
import { isConfirmedCurrent } from './site-drawing-workflow';
import type { RegisterSiteDrawingDto } from './dto/register-drawing.dto';
import type { RegisterSiteDrawingRevisionDto } from './dto/register-revision.dto';
import type { CompleteOfflinePackageDto } from './dto/offline-package.dto';

const DRAWING_MAX_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB -- larger than the floor-plan drawings cap; real IFC/architectural PDF sets run bigger
const DRAWING_ALLOWED_EXTENSIONS = new Set(['pdf']);

export interface SiteDrawingFilters {
  search?: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
  workflowStatus?: SiteDrawingWorkflowStatus;
  page?: number;
  perPage?: number;
}

@Injectable()
export class SiteDrawingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly localAdapter: SiteDrawingLocalAdapter,
  ) {}

  // ── Upload / registration (Local/internal source — brief section 6's
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

  async registerDrawing(companyId: string, projectId: string, userId: string, dto: RegisterSiteDrawingDto): Promise<SiteDrawingWithCurrentRevision> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const fileSizeBytes = await this.assertUploadedSizeWithinLimit(dto.storageKey);

    return this.db.withTenant(companyId, async (sql) => {
      const [drawing] = await sql<SiteDrawingRow[]>`
        INSERT INTO site_drawings (
          company_id, project_id, drawing_number, drawing_title, discipline, building_or_zone, floor_or_level,
          source_provider, source_file_id, created_by, current_workflow_status
        ) VALUES (
          ${companyId}, ${projectId}, ${dto.drawingNumber}, ${dto.drawingTitle}, ${dto.discipline ?? null},
          ${dto.buildingOrZone ?? null}, ${dto.floorOrLevel ?? null}, 'internal', ${randomUUID()}, ${userId}, ${dto.workflowStatus}
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
  // revision (if any) is marked superseded — section 5's "latest revision
  // known to the system" moves forward, but the old file stays in the
  // register, clearly labeled, not deleted (section 5: "Keep historical
  // revisions accessible ... label superseded revisions clearly").
  async addRevision(companyId: string, projectId: string, drawingId: string, userId: string, dto: RegisterSiteDrawingRevisionDto): Promise<SiteDrawingWithCurrentRevision> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const fileSizeBytes = await this.assertUploadedSizeWithinLimit(dto.storageKey);

    return this.db.withTenant(companyId, async (sql) => {
      const [drawing] = await sql<SiteDrawingRow[]>`SELECT * FROM site_drawings WHERE id = ${drawingId} AND project_id = ${projectId}`;
      if (!drawing) throw new NotFoundException(`Drawing ${drawingId} not found.`);

      const previousRevisionId = drawing.currentRevisionId ?? null;

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
  }

  // ── Register: search, filter, list ──────────────────────────────────────

  async listDrawings(companyId: string, projectId: string, filters: SiteDrawingFilters): Promise<{ data: SiteDrawingWithCurrentRevision[]; total: number }> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(200, Math.max(1, filters.perPage ?? 50));
    const offset = (page - 1) * perPage;

    return this.db.withTenant(companyId, async (sql) => {
      const rows = await sql<(SiteDrawingRow & SiteDrawingRevisionJoinRow)[]>`
        SELECT d.*, r.id AS revision_id, r.revision_number, r.workflow_status AS revision_workflow_status,
               r.source_status_raw, r.issue_date, r.source_modified_at, r.last_verified_at, r.content_hash,
               r.storage_key, r.source_web_url AS revision_source_web_url, r.file_size_bytes,
               r.supersedes_revision_id, r.is_superseded, r.offline_eligibility, r.synchronization_status,
               r.uploaded_by, r.created_at AS revision_created_at, r.updated_at AS revision_updated_at,
               count(*) OVER() AS full_count
        FROM site_drawings d
        LEFT JOIN site_drawing_revisions r ON r.id = d.current_revision_id
        WHERE d.project_id = ${projectId}
          AND (${filters.search ?? null}::text IS NULL OR d.search_vector @@ plainto_tsquery('english', ${filters.search ?? ''}))
          AND (${filters.discipline ?? null}::text IS NULL OR d.discipline = ${filters.discipline ?? null})
          AND (${filters.buildingOrZone ?? null}::text IS NULL OR d.building_or_zone = ${filters.buildingOrZone ?? null})
          AND (${filters.floorOrLevel ?? null}::text IS NULL OR d.floor_or_level = ${filters.floorOrLevel ?? null})
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
  // dropdowns -- never a hardcoded list, since every project's own taxonomy
  // differs.
  async getFilterOptions(companyId: string, projectId: string) {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    return this.db.withTenant(companyId, sql => sql<{ discipline: string | null; buildingOrZone: string | null; floorOrLevel: string | null }[]>`
      SELECT DISTINCT discipline, building_or_zone, floor_or_level FROM site_drawings WHERE project_id = ${projectId}
    `).then((rows) => ({
      disciplines: Array.from(new Set(rows.map(r => r.discipline).filter((v): v is string => Boolean(v)))).sort(),
      buildingsOrZones: Array.from(new Set(rows.map(r => r.buildingOrZone).filter((v): v is string => Boolean(v)))).sort(),
      floorsOrLevels: Array.from(new Set(rows.map(r => r.floorOrLevel).filter((v): v is string => Boolean(v)))).sort(),
    }));
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
  // Audited explicitly (writeAccessAudit below) rather than relying on
  // AuditInterceptor -- this is a GET route (read, by design: issuing a
  // download URL doesn't change anything), and the interceptor only covers
  // mutating methods. Section 9's "audit events for document access,
  // download" needs this logged regardless of HTTP verb.
  async getAuthorizedDownloadUrl(companyId: string, projectId: string, userId: string, revisionId: string): Promise<{ url: string; expiresInSeconds: number; workflowStatus: SiteDrawingWorkflowStatus; isSuperseded: boolean }> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const [revision] = await this.db.withTenant(companyId, sql => sql<SiteDrawingRevisionRow[]>`
      SELECT * FROM site_drawing_revisions WHERE id = ${revisionId} AND project_id = ${projectId}
    `);
    if (!revision) throw new NotFoundException(`Revision ${revisionId} not found.`);
    if (!revision.storageKey) throw new BadRequestException('This revision has no locally stored file — open it at the source instead.');

    const expiresInSeconds = 900; // 15 min -- short-lived per section 9
    const url = await this.storage.getReadUrl(revision.storageKey, expiresInSeconds);
    await this.writeAccessAudit(companyId, projectId, userId, 'site_drawing_revision', revision.id, 'site_drawing.downloaded');
    return { url, expiresInSeconds, workflowStatus: revision.workflowStatus, isSuperseded: revision.isSuperseded };
  }

  // Supplements, does not replace, AuditInterceptor's generic coverage of
  // mutating routes -- mirrors RfisService.writeRfiAudit()'s own pattern
  // for the same reason (a GET-based access the interceptor can't see).
  private async writeAccessAudit(companyId: string, projectId: string, userId: string, resourceType: string, resourceId: string, action: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO audit_log (company_id, project_id, user_id, action, resource_type, resource_id, source)
      VALUES (${companyId}, ${projectId}, ${userId}, ${action}, ${resourceType}, ${resourceId}, 'api')
    `);
  }

  // ── Workflow status (document-control decisions — gated by the
  // 'approve' category action in the controller, stricter than 'edit') ────

  async setWorkflowStatus(companyId: string, projectId: string, drawingId: string, revisionId: string, status: SiteDrawingWorkflowStatus): Promise<SiteDrawingRevision> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    return this.db.withTenant(companyId, async (sql) => {
      const [revision] = await sql<SiteDrawingRevisionRow[]>`
        UPDATE site_drawing_revisions SET workflow_status = ${status}, updated_at = now()
        WHERE id = ${revisionId} AND drawing_id = ${drawingId} AND project_id = ${projectId} RETURNING *
      `;
      if (!revision) throw new NotFoundException(`Revision ${revisionId} not found on drawing ${drawingId}.`);

      const [drawing] = await sql<SiteDrawingRow[]>`SELECT current_revision_id FROM site_drawings WHERE id = ${drawingId}`;
      if (drawing?.currentRevisionId === revisionId) {
        await sql`UPDATE site_drawings SET current_workflow_status = ${status} WHERE id = ${drawingId}`;
      }
      return toSiteDrawingRevision(revision);
    });
  }

  async getSourceHealth(companyId: string, projectId: string): Promise<SiteDrawingSourceHealth> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const [lastLog] = await this.db.withTenant(companyId, sql => sql<{ startedAt: string; finishedAt: string | null; status: string | null }[]>`
      SELECT started_at, finished_at, status FROM site_drawing_sync_log
      WHERE project_id = ${projectId} AND source_provider = 'internal'
      ORDER BY started_at DESC LIMIT 1
    `);
    const health = await this.localAdapter.getSourceHealth(projectId);
    return {
      provider: 'internal',
      reachable: health.reachable,
      detail: health.detail,
      lastAttemptedSyncAt: lastLog?.startedAt,
      lastSuccessfulSyncAt: lastLog?.status === 'SUCCESS' ? (lastLog.finishedAt ?? undefined) : undefined,
    };
  }

  // ── Offline packages (brief section 8 — metadata only; the PDF bytes
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

  // The client reports what actually happened to the download -- a
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

      const isStale = revision.isSuperseded || revision.workflowStatus === 'WITHDRAWN' || !isConfirmedCurrent(revision.workflowStatus, revision.isSuperseded);
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
  // what's cached -- the client is responsible for actually deleting the
  // IndexedDB bytes on sign-out; see the web app's offline store for that
  // half.
  async clearAllOfflinePackagesForUser(companyId: string, userId: string): Promise<number> {
    const rows = await this.db.withTenant(companyId, sql => sql`
      UPDATE site_drawing_offline_packages SET status = 'REMOVED', updated_at = now()
      WHERE user_id = ${userId} AND status != 'REMOVED' RETURNING id
    `);
    return rows.length;
  }

  private async assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
  }
}

// ── Row shapes + mappers ───────────────────────────────────────────────────

interface SiteDrawingRow {
  id: string; companyId: string; projectId: string; drawingNumber: string; drawingTitle: string;
  discipline: string | null; buildingOrZone: string | null; floorOrLevel: string | null;
  sourceProvider: SiteDrawing['sourceProvider']; sourceFileId: string; sourceWebUrl: string | null;
  currentRevisionId: string | null; currentWorkflowStatus: SiteDrawingWorkflowStatus; currentIsSuperseded: boolean;
  createdBy: string; createdAt: string; updatedAt: string;
}

interface SiteDrawingRevisionRow {
  id: string; companyId: string; projectId: string; drawingId: string; revisionNumber: string;
  workflowStatus: SiteDrawingWorkflowStatus; sourceStatusRaw: string | null; issueDate: string | null;
  sourceModifiedAt: string | null; lastVerifiedAt: string | null; contentHash: string | null;
  storageKey: string | null; sourceWebUrl: string | null; fileSizeBytes: string | number | null;
  supersedesRevisionId: string | null; isSuperseded: boolean; offlineEligibility: boolean;
  synchronizationStatus: SiteDrawingRevision['synchronizationStatus']; uploadedBy: string | null;
  createdAt: string; updatedAt: string;
}

interface SiteDrawingRevisionJoinRow {
  revisionId: string | null; revisionNumber: string; revisionWorkflowStatus: SiteDrawingWorkflowStatus;
  sourceStatusRaw: string | null; issueDate: string | null; sourceModifiedAt: string | null; lastVerifiedAt: string | null;
  contentHash: string | null; storageKey: string | null; revisionSourceWebUrl: string | null;
  fileSizeBytes: string | number | null; supersedesRevisionId: string | null; isSuperseded: boolean;
  offlineEligibility: boolean; synchronizationStatus: SiteDrawingRevision['synchronizationStatus'];
  uploadedBy: string | null; revisionCreatedAt: string; revisionUpdatedAt: string; fullCount: string | number;
}

interface SiteDrawingOfflinePackageRow {
  id: string; companyId: string; userId: string; projectId: string; drawingId: string; revisionId: string;
  status: SiteDrawingOfflinePackageStatus; contentHash: string | null; fileSizeBytes: string | number | null;
  downloadedAt: string | null; lastVerifiedAt: string; createdAt: string; updatedAt: string;
}

function toSiteDrawing(row: SiteDrawingRow): SiteDrawing {
  return {
    id: row.id, companyId: row.companyId, projectId: row.projectId, drawingNumber: row.drawingNumber,
    drawingTitle: row.drawingTitle, discipline: row.discipline ?? undefined, buildingOrZone: row.buildingOrZone ?? undefined,
    floorOrLevel: row.floorOrLevel ?? undefined, sourceProvider: row.sourceProvider, sourceFileId: row.sourceFileId,
    sourceWebUrl: row.sourceWebUrl ?? undefined, currentRevisionId: row.currentRevisionId ?? undefined,
    currentWorkflowStatus: row.currentWorkflowStatus, currentIsSuperseded: row.currentIsSuperseded,
    createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toSiteDrawingRevision(r: SiteDrawingRevisionRow): SiteDrawingRevision {
  return {
    id: r.id, companyId: r.companyId, projectId: r.projectId, drawingId: r.drawingId, revisionNumber: r.revisionNumber,
    workflowStatus: r.workflowStatus, sourceStatusRaw: r.sourceStatusRaw ?? undefined, issueDate: r.issueDate ?? undefined,
    sourceModifiedAt: r.sourceModifiedAt ?? undefined, lastVerifiedAt: r.lastVerifiedAt ?? undefined, contentHash: r.contentHash ?? undefined,
    storageKey: r.storageKey ?? undefined, sourceWebUrl: r.sourceWebUrl ?? undefined,
    fileSizeBytes: r.fileSizeBytes != null ? Number(r.fileSizeBytes) : undefined, supersedesRevisionId: r.supersedesRevisionId ?? undefined,
    isSuperseded: r.isSuperseded, offlineEligibility: r.offlineEligibility, synchronizationStatus: r.synchronizationStatus,
    uploadedBy: r.uploadedBy ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt,
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
    contentHash: r.contentHash ?? undefined, storageKey: r.storageKey ?? undefined, sourceWebUrl: r.revisionSourceWebUrl ?? undefined,
    fileSizeBytes: r.fileSizeBytes != null ? Number(r.fileSizeBytes) : undefined, supersedesRevisionId: r.supersedesRevisionId ?? undefined,
    isSuperseded: r.isSuperseded, offlineEligibility: r.offlineEligibility, synchronizationStatus: r.synchronizationStatus,
    uploadedBy: r.uploadedBy ?? undefined, createdAt: r.revisionCreatedAt, updatedAt: r.revisionUpdatedAt,
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
