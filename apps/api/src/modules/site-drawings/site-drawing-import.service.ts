import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type {
  DocSource, SiteDrawingImportBatch, SiteDrawingImportBatchStatus, SiteDrawingRevision, ExtractedDrawingFields,
} from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { ResolveReviewDto } from './dto/resolve-review.dto';

const BATCH_MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB -- "hundreds of PDF drawings" in one archive
const BATCH_ALLOWED_EXTENSIONS = new Set(['zip', 'pdf']);

export interface SiteDrawingImportJob {
  batchId: string;
  companyId: string;
  projectId: string;
}

// Bulk ingestion (brief Phase 2): a ZIP of many drawings, or a single PDF,
// uploaded the same presigned-URL way every other upload in this app
// works, then processed asynchronously by SiteDrawingImportProcessor --
// this service only creates the batch record and enqueues the job; it
// never blocks a request on the actual extraction work.
@Injectable()
export class SiteDrawingImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    @InjectQueue('site-drawing-import') private readonly importQueue: Queue<SiteDrawingImportJob>,
  ) {}

  async getUploadUrl(companyId: string, projectId: string, filename: string) {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!BATCH_ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`File type ".${ext}" is not supported. Allowed: ZIP, PDF.`);
    }
    const contentType = ext === 'zip' ? 'application/zip' : 'application/pdf';
    const key = this.storage.generateKey(companyId, projectId, 'documents', filename);
    const url = await this.storage.getUploadUrl(key, contentType, BATCH_MAX_SIZE_BYTES);
    return { ...url, storageKey: key };
  }

  async createBatch(companyId: string, projectId: string, userId: string, input: { storageKey: string; originalFilename: string; sourceSystem: DocSource }): Promise<SiteDrawingImportBatch> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const sizeBytes = await this.storage.getObjectSize(input.storageKey);
    if (sizeBytes === null) {
      throw new BadRequestException('Uploaded file not found in storage. Complete the upload before creating the import batch.');
    }
    if (sizeBytes > BATCH_MAX_SIZE_BYTES) {
      await this.storage.deleteIfExists(input.storageKey);
      throw new BadRequestException(`Uploaded file (${(sizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds the ${BATCH_MAX_SIZE_BYTES / 1024 / 1024} MB limit. The upload has been rejected and removed.`);
    }

    const [batch] = await this.db.withTenant(companyId, sql => sql<ImportBatchRow[]>`
      INSERT INTO site_drawing_import_batches (company_id, project_id, source_system, original_filename, storage_key, uploaded_by)
      VALUES (${companyId}, ${projectId}, ${input.sourceSystem}, ${input.originalFilename}, ${input.storageKey}, ${userId})
      RETURNING *
    `);

    // Queued, never processed inline -- a batch of hundreds of PDFs (each
    // needing text extraction, and possibly an OCR round trip) must not
    // block this request (brief section 2: "handle large packages through
    // background processing").
    await this.importQueue.add('process-import-batch', { batchId: batch.id, companyId, projectId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
    });

    return toImportBatch(batch);
  }

  async getBatch(companyId: string, projectId: string, batchId: string): Promise<SiteDrawingImportBatch> {
    const [batch] = await this.db.withTenant(companyId, sql => sql<ImportBatchRow[]>`
      SELECT * FROM site_drawing_import_batches WHERE id = ${batchId} AND project_id = ${projectId}
    `);
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found.`);
    return toImportBatch(batch);
  }

  async listBatches(companyId: string, projectId: string): Promise<SiteDrawingImportBatch[]> {
    const rows = await this.db.withTenant(companyId, sql => sql<ImportBatchRow[]>`
      SELECT * FROM site_drawing_import_batches WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 50
    `);
    return rows.map(toImportBatch);
  }

  // The review queue (brief section 4: "a review queue for uncertain
  // records") -- every revision an import flagged as needing a human
  // look, newest first.
  async listReviewQueue(companyId: string, projectId: string): Promise<SiteDrawingRevision[]> {
    const rows = await this.db.withTenant(companyId, sql => sql<RevisionRow[]>`
      SELECT * FROM site_drawing_revisions
      WHERE project_id = ${projectId} AND extraction_status IN ('NEEDS_REVIEW', 'CONFLICT')
      ORDER BY created_at DESC
    `);
    return rows.map(toRevision);
  }

  // An authorized user's correction/confirmation (brief section 3: "allow
  // authorized users to correct metadata"). Updates the revision's own
  // fields and, when this is the drawing's CURRENT revision, the
  // denormalized fields on site_drawings too -- the same "keep current_*
  // in sync" discipline SiteDrawingsService's own mutations already
  // follow. Never changes workflowStatus: a reviewer confirming extracted
  // METADATA is not the same action as an approval decision (brief's
  // document-control rules apply here just as much as everywhere else).
  async resolveReview(companyId: string, projectId: string, revisionId: string, dto: ResolveReviewDto): Promise<SiteDrawingRevision> {
    return this.db.withTenant(companyId, async (sql) => {
      const [revision] = await sql<RevisionRow[]>`SELECT * FROM site_drawing_revisions WHERE id = ${revisionId} AND project_id = ${projectId}`;
      if (!revision) throw new NotFoundException(`Revision ${revisionId} not found.`);

      const [updatedRevision] = await sql<RevisionRow[]>`
        UPDATE site_drawing_revisions SET
          revision_number = COALESCE(${dto.revisionNumber ?? null}, revision_number),
          extraction_status = 'CONFIRMED', review_notes = ${dto.reviewNotes}, updated_at = now()
        WHERE id = ${revisionId} RETURNING *
      `;

      if (dto.drawingNumber || dto.drawingTitle) {
        await sql`
          UPDATE site_drawings SET
            drawing_number = COALESCE(${dto.drawingNumber ?? null}, drawing_number),
            drawing_title = COALESCE(${dto.drawingTitle ?? null}, drawing_title)
          WHERE id = ${revision.drawingId}
        `;
      }

      return toRevision(updatedRevision);
    });
  }

  private async assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
  }
}

interface ImportBatchRow {
  id: string; companyId: string; projectId: string; sourceSystem: DocSource; originalFilename: string; storageKey: string;
  status: SiteDrawingImportBatchStatus; fileCount: number; createdCount: number; revisionCount: number; skippedCount: number;
  errorCount: number; errorMessage: string | null; uploadedBy: string; startedAt: string | null; finishedAt: string | null; createdAt: string;
}

function toImportBatch(row: ImportBatchRow): SiteDrawingImportBatch {
  return {
    id: row.id, companyId: row.companyId, projectId: row.projectId, sourceSystem: row.sourceSystem,
    originalFilename: row.originalFilename, storageKey: row.storageKey, status: row.status, fileCount: row.fileCount,
    createdCount: row.createdCount, revisionCount: row.revisionCount, skippedCount: row.skippedCount, errorCount: row.errorCount,
    errorMessage: row.errorMessage ?? undefined, uploadedBy: row.uploadedBy, startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined, createdAt: row.createdAt,
  };
}

interface RevisionRow {
  id: string; companyId: string; projectId: string; drawingId: string; revisionNumber: string;
  workflowStatus: SiteDrawingRevision['workflowStatus']; sourceStatusRaw: string | null; issueDate: string | null;
  sourceModifiedAt: string | null; lastVerifiedAt: string | null; contentHash: string | null; storageKey: string | null;
  sourceRevisionId: string | null; sourceWebUrl: string | null; fileSizeBytes: string | number | null;
  supersedesRevisionId: string | null; isSuperseded: boolean; offlineEligibility: boolean;
  synchronizationStatus: SiteDrawingRevision['synchronizationStatus']; uploadedBy: string | null;
  documentClassification: SiteDrawingRevision['documentClassification']; suitabilityCode: string | null;
  extractionStatus: SiteDrawingRevision['extractionStatus']; extractedFieldsRaw: ExtractedDrawingFields | null;
  importBatchId: string | null; reviewNotes: string | null; createdAt: string; updatedAt: string;
}

function toRevision(r: RevisionRow): SiteDrawingRevision {
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
