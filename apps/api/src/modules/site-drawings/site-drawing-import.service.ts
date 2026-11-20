import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type {
  DocSource, SiteDrawingImportBatch, SiteDrawingImportBatchStatus, SiteDrawingRevision, SiteDrawingReviewQueueItem, ExtractedDrawingFields,
} from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { ResolveReviewDto } from './dto/resolve-review.dto';
import type { SplitAsNewDrawingDto } from './dto/split-as-new-drawing.dto';

const BATCH_MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB: "hundreds of PDF drawings" in one archive
const BATCH_ALLOWED_EXTENSIONS = new Set(['zip', 'rar', 'pdf']);

// Site Drawing Hub, extraction accuracy Phase 0: the other half of
// logExtractionOutcome() (extract-drawing-fields.ts) -- knowing which
// path produced a guess is only half the feedback loop; knowing whether
// a human later had to CORRECT that guess is the half that actually says
// something about accuracy. revision.extractedFieldsRaw already holds
// the original, as-extracted values (the jsonb column this service's own
// INSERT already writes; see site-drawing-import.processor.ts), so a
// genuine correction can be detected by diffing it against what the
// reviewer submits -- no new column, no new query, nothing to migrate.
// Logged, not persisted to its own table: this is meant to be read as
// log data for now, not queried as structured state (that's a reasonable
// next step once there's enough of it to be worth a real analysis, not
// before).
const reviewCorrectionLogger = new Logger('SiteDrawingReviewCorrection');

function logReviewCorrections(revisionId: string, original: ExtractedDrawingFields | null | undefined, dto: ResolveReviewDto): void {
  const corrections: string[] = [];
  if (dto.drawingNumber !== undefined && dto.drawingNumber !== original?.drawingNumber) {
    corrections.push(`drawingNumber: ${JSON.stringify(original?.drawingNumber ?? null)} -> ${JSON.stringify(dto.drawingNumber)}`);
  }
  if (dto.drawingTitle !== undefined && dto.drawingTitle !== original?.drawingTitle) {
    corrections.push(`drawingTitle: ${JSON.stringify(original?.drawingTitle ?? null)} -> ${JSON.stringify(dto.drawingTitle)}`);
  }
  if (dto.revisionNumber !== undefined && dto.revisionNumber !== original?.revisionNumber) {
    corrections.push(`revisionNumber: ${JSON.stringify(original?.revisionNumber ?? null)} -> ${JSON.stringify(dto.revisionNumber)}`);
  }
  if (corrections.length === 0) return; // a reviewer confirming an already-correct extraction is not a miss worth logging
  reviewCorrectionLogger.log(
    `Revision ${revisionId}: reviewer corrected an extraction originally sourced from ${original?.source ?? 'unknown'} `
    + `(confidence ${original?.confidence ?? 'n/a'}): ${corrections.join('; ')}`,
  );
}

export interface SiteDrawingImportJob {
  batchId: string;
  companyId: string;
  projectId: string;
}

// Bulk ingestion (brief Phase 2): a ZIP of many drawings, or a single PDF,
// uploaded the same presigned-URL way every other upload in this app
// works, then processed asynchronously by SiteDrawingImportProcessor;
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
      throw new BadRequestException(`File type ".${ext}" is not supported. Allowed: ZIP, RAR, PDF.`);
    }
    const contentType = ext === 'zip' ? 'application/zip' : ext === 'rar' ? 'application/x-rar-compressed' : 'application/pdf';
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

    // Queued, never processed inline; a batch of hundreds of PDFs (each
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

  // Clears one row from the Import Activity log -- never the drawings or
  // revisions that batch actually created. Those are real register
  // entries a user wants to keep regardless of whether its own upload-log
  // entry is still useful to look at; this undoes none of that, it just
  // stops a growing list of (often repeat-test) uploads from cluttering
  // the Batches tab forever, with no automatic cleanup otherwise.
  //
  // site_drawing_revisions.import_batch_id has no ON DELETE clause
  // (migration 075), so this must detach every revision that still
  // references this batch FIRST -- without it, deleting any batch that
  // actually created something (COMPLETED/PARTIAL, i.e. most of them)
  // would fail outright with a foreign-key violation.
  async deleteBatch(companyId: string, projectId: string, batchId: string): Promise<void> {
    const result = await this.db.withTenant(companyId, async (sql) => {
      const [batch] = await sql<{ storageKey: string }[]>`
        SELECT storage_key FROM site_drawing_import_batches WHERE id = ${batchId} AND project_id = ${projectId}
      `;
      if (!batch) return null;
      await sql`UPDATE site_drawing_revisions SET import_batch_id = NULL WHERE import_batch_id = ${batchId} AND project_id = ${projectId}`;
      await sql`DELETE FROM site_drawing_import_batches WHERE id = ${batchId} AND project_id = ${projectId}`;
      return batch;
    });
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found.`);
    this.storage.deleteIfExists(result.storageKey).catch(() => {});
  }

  // The review queue (brief section 4: "a review queue for uncertain
  // records"): every revision an import flagged as needing a human
  // look, newest first. Joined to site_drawings for drawing_number/
  // drawing_title: a reviewer needs to know WHICH drawing a flagged
  // revision belongs to, which a bare site_drawing_revisions row can't
  // say on its own.
  async listReviewQueue(companyId: string, projectId: string): Promise<SiteDrawingReviewQueueItem[]> {
    // d.current_revision_id is joined in (never previously selected here)
    // so the frontend can tell apart a revision that's just flagged for a
    // VALUE correction (it's already current -- e.g. NEEDS_REVIEW from an
    // OCR read) from one reconcile() deliberately left un-promoted
    // pending a human's identity/chronology decision (Site Drawing Hub
    // integrity hardening, Phase 1/2). Those need different actions in
    // the Review Queue, not just the same "Confirm" button.
    const rows = await this.db.withTenant(companyId, sql => sql<ReviewQueueRow[]>`
      SELECT r.*, d.drawing_number, d.drawing_title, d.current_revision_id AS drawing_current_revision_id FROM site_drawing_revisions r
      JOIN site_drawings d ON d.id = r.drawing_id
      WHERE r.project_id = ${projectId} AND r.extraction_status IN ('NEEDS_REVIEW', 'CONFLICT')
      ORDER BY r.created_at DESC
    `);
    return rows.map(toReviewQueueItem);
  }

  // Phase 1/2's "confirm" half: an authorized human has looked at a
  // pending (not-yet-current) revision and decided it genuinely IS a new
  // revision of the drawing it's already linked to. Performs exactly the
  // promotion reconcile() itself used to do unconditionally -- mark the
  // previous current revision superseded, repoint current_revision_id --
  // now gated behind an explicit decision instead of an assumption.
  async confirmRevisionAsNew(companyId: string, projectId: string, revisionId: string, reviewNotes: string): Promise<SiteDrawingRevision> {
    return this.db.withTenant(companyId, async (sql) => {
      const [revision] = await sql<RevisionRow[]>`SELECT * FROM site_drawing_revisions WHERE id = ${revisionId} AND project_id = ${projectId}`;
      if (!revision) throw new NotFoundException(`Revision ${revisionId} not found.`);

      const [drawing] = await sql<{ currentRevisionId: string | null }[]>`SELECT current_revision_id FROM site_drawings WHERE id = ${revision.drawingId}`;
      if (drawing?.currentRevisionId && drawing.currentRevisionId !== revisionId) {
        await sql`UPDATE site_drawing_revisions SET is_superseded = true WHERE id = ${drawing.currentRevisionId}`;
      }
      await sql`UPDATE site_drawings SET current_revision_id = ${revisionId}, current_is_superseded = false WHERE id = ${revision.drawingId}`;

      const [updatedRevision] = await sql<RevisionRow[]>`
        UPDATE site_drawing_revisions SET
          extraction_status = 'CONFIRMED', is_superseded = false, supersedes_revision_id = ${drawing?.currentRevisionId ?? null},
          review_notes = ${reviewNotes}, updated_at = now()
        WHERE id = ${revisionId} RETURNING *
      `;
      return toRevision(updatedRevision);
    });
  }

  // Phase 1's other half: the human decided this is really a DIFFERENT
  // drawing that happened to extract the same number as an existing one.
  // Detaches the revision into its own brand-new site_drawings row rather
  // than leaving it mis-attached to the original drawing's history --
  // the drawingNumber/drawingTitle a human now supplies are the real
  // identity a machine couldn't confirm, never guessed here. The
  // ORIGINAL drawing's own current revision is left completely untouched.
  async splitRevisionAsNewDrawing(companyId: string, projectId: string, revisionId: string, dto: SplitAsNewDrawingDto): Promise<SiteDrawingRevision> {
    return this.db.withTenant(companyId, async (sql) => {
      const [revision] = await sql<RevisionRow[]>`SELECT * FROM site_drawing_revisions WHERE id = ${revisionId} AND project_id = ${projectId}`;
      if (!revision) throw new NotFoundException(`Revision ${revisionId} not found.`);

      const [originalDrawing] = await sql<{ sourceProvider: DocSource; discipline: string | null }[]>`
        SELECT source_provider, discipline FROM site_drawings WHERE id = ${revision.drawingId}`;
      if (!originalDrawing) throw new NotFoundException(`Drawing for revision ${revisionId} not found.`);

      const [newDrawing] = await sql<{ id: string }[]>`
        INSERT INTO site_drawings (
          company_id, project_id, drawing_number, drawing_title, discipline, source_provider, source_file_id, current_workflow_status
        ) VALUES (
          ${companyId}, ${projectId}, ${dto.drawingNumber}, ${dto.drawingTitle}, ${originalDrawing.discipline},
          ${originalDrawing.sourceProvider}, ${randomUUID()}, 'UNKNOWN'
        ) RETURNING id
      `;

      // The new drawing has no other revisions yet, so there is nothing
      // for this revision_number to collide with; kept as-is (or the
      // reviewer's own correction) rather than re-run through the
      // disambiguation suffix logic that only exists for a SHARED history.
      const [movedRevision] = await sql<RevisionRow[]>`
        UPDATE site_drawing_revisions SET
          drawing_id = ${newDrawing.id}, revision_number = ${dto.revisionNumber ?? revision.revisionNumber},
          extraction_status = 'CONFIRMED', is_superseded = false, supersedes_revision_id = NULL,
          review_notes = ${dto.reviewNotes}, updated_at = now()
        WHERE id = ${revisionId} RETURNING *
      `;
      await sql`UPDATE site_drawings SET current_revision_id = ${revisionId} WHERE id = ${newDrawing.id}`;
      return toRevision(movedRevision);
    });
  }

  // An authorized user's correction/confirmation (brief section 3: "allow
  // authorized users to correct metadata"). Updates the revision's own
  // fields and, when this is the drawing's CURRENT revision, the
  // denormalized fields on site_drawings too; the same "keep current_*
  // in sync" discipline SiteDrawingsService's own mutations already
  // follow. Never changes workflowStatus: a reviewer confirming extracted
  // METADATA is not the same action as an approval decision (brief's
  // document-control rules apply here just as much as everywhere else).
  async resolveReview(companyId: string, projectId: string, revisionId: string, dto: ResolveReviewDto): Promise<SiteDrawingRevision> {
    return this.db.withTenant(companyId, async (sql) => {
      const [revision] = await sql<RevisionRow[]>`SELECT * FROM site_drawing_revisions WHERE id = ${revisionId} AND project_id = ${projectId}`;
      if (!revision) throw new NotFoundException(`Revision ${revisionId} not found.`);
      logReviewCorrections(revisionId, revision.extractedFieldsRaw, dto);

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
  status: SiteDrawingImportBatchStatus; fileCount: number; createdCount: number; revisionCount: number; conflictCount: number; skippedCount: number;
  errorCount: number; unsupportedCount: number; errorMessage: string | null; uploadedBy: string; startedAt: string | null; finishedAt: string | null; createdAt: string;
}

function toImportBatch(row: ImportBatchRow): SiteDrawingImportBatch {
  return {
    id: row.id, companyId: row.companyId, projectId: row.projectId, sourceSystem: row.sourceSystem,
    originalFilename: row.originalFilename, storageKey: row.storageKey, status: row.status, fileCount: row.fileCount,
    createdCount: row.createdCount, revisionCount: row.revisionCount, conflictCount: row.conflictCount ?? 0,
    skippedCount: row.skippedCount, errorCount: row.errorCount, unsupportedCount: row.unsupportedCount ?? 0,
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

interface ReviewQueueRow extends RevisionRow {
  drawingNumber: string;
  drawingTitle: string;
  drawingCurrentRevisionId: string | null;
}

function toReviewQueueItem(r: ReviewQueueRow): SiteDrawingReviewQueueItem {
  return {
    ...toRevision(r), drawingNumber: r.drawingNumber, drawingTitle: r.drawingTitle,
    isPendingPromotion: r.drawingCurrentRevisionId !== r.id,
  };
}
