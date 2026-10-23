import { randomUUID } from 'crypto';
import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import type { DocSource, ExtractedDrawingFields, SiteDrawingWorkflowStatus } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { SiteDrawingImportJob } from './site-drawing-import.service';
import { extractPdfEntriesFromZip, type ExtractedZipEntry } from './extraction/zip-extraction.util';
import { extractEmbeddedText, hasUsableEmbeddedText } from './extraction/pdf-text-extractor';
import { extractTitleBlockFields, isConfidentExtraction } from './extraction/title-block-extractor';

type ReconcileOutcome = 'created' | 'revision_added' | 'duplicate_skipped';

interface ImportBatchDbRow {
  id: string;
  storageKey: string;
  originalFilename: string;
  sourceSystem: DocSource;
  uploadedBy: string;
}

interface ExistingDrawingRow {
  id: string;
  drawingTitle: string;
  currentRevisionId: string | null;
}

interface CurrentRevisionRow {
  id: string;
  revisionNumber: string;
}

// Runs in a Bull worker, same pattern as ImageProcessingProcessor/
// WebhookDeliveryProcessor -- never blocks the request that uploaded the
// archive (brief section 2: "handle large packages through background
// processing, with progress, retry and error reporting").
//
// Per-file failures (a corrupt individual PDF, an extraction error) are
// caught and counted, never allowed to abort the rest of the batch --
// one bad file in a package of hundreds must not lose the other 399.
// A whole-batch failure (the archive itself won't open, storage is
// unreachable) fails the batch record and rethrows so Bull's own retry/
// backoff (3 attempts, exponential) takes over -- this is the "retry
// logic" brief section 2 asks for, reused rather than reinvented.
@Processor('site-drawing-import')
export class SiteDrawingImportProcessor {
  private readonly logger = new Logger(SiteDrawingImportProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  @Process('process-import-batch')
  async handleImportBatch(job: Job<SiteDrawingImportJob>): Promise<void> {
    const { batchId, companyId, projectId } = job.data;
    await this.markStarted(companyId, batchId);

    let batch: ImportBatchDbRow;
    try {
      batch = await this.getBatch(companyId, batchId);
    } catch (err) {
      await this.finish(companyId, batchId, 'FAILED', { fileCount: 0, createdCount: 0, revisionCount: 0, skippedCount: 0, errorCount: 0 }, this.describeError(err));
      throw err;
    }

    let entries: ExtractedZipEntry[];
    try {
      const archiveBuffer = await this.storage.download(batch.storageKey);
      entries = batch.originalFilename.toLowerCase().endsWith('.zip')
        ? (await extractPdfEntriesFromZip(archiveBuffer)).entries
        : [{ filename: batch.originalFilename, buffer: archiveBuffer }];
    } catch (err) {
      // The archive itself is unsafe/corrupt/unreadable -- never a partial
      // success for something this fundamentally wrong (brief section 10:
      // "never silently fall back to a potentially stale/incomplete state").
      await this.finish(companyId, batchId, 'FAILED', { fileCount: 0, createdCount: 0, revisionCount: 0, skippedCount: 0, errorCount: 0 }, this.describeError(err));
      throw err;
    }

    let createdCount = 0, revisionCount = 0, skippedCount = 0, errorCount = 0;
    for (const entry of entries) {
      try {
        const outcome = await this.processOneFile(companyId, projectId, batch, entry);
        if (outcome === 'created') createdCount++;
        else if (outcome === 'revision_added') revisionCount++;
        else skippedCount++;
      } catch (err) {
        errorCount++;
        this.logger.warn(`Import batch ${batchId}: failed to process "${entry.filename}": ${this.describeError(err)}`);
      }
    }

    const counts = { fileCount: entries.length, createdCount, revisionCount, skippedCount, errorCount };
    // COMPLETED only once every file succeeded; PARTIAL when some did and
    // some didn't (never silently reported as a plain success); FAILED
    // only when literally nothing could be processed.
    const status = errorCount === 0 ? 'COMPLETED' : createdCount + revisionCount + skippedCount > 0 ? 'PARTIAL' : 'FAILED';
    await this.finish(companyId, batchId, status, counts, errorCount > 0 ? `${errorCount} of ${entries.length} file(s) could not be processed.` : null);
  }

  private async processOneFile(companyId: string, projectId: string, batch: ImportBatchDbRow, entry: ExtractedZipEntry): Promise<ReconcileOutcome> {
    // The original consultant-issued file, preserved exactly as uploaded
    // (brief section 2) -- a new, dedicated storage key per drawing, same
    // convention registerDrawing() already uses for a direct upload.
    const storageKey = this.storage.generateKey(companyId, projectId, 'documents', entry.filename);
    await this.storage.upload(storageKey, entry.buffer, 'application/pdf');

    let fields: ExtractedDrawingFields | null = null;
    try {
      const { text } = await extractEmbeddedText(entry.buffer);
      if (hasUsableEmbeddedText(text)) fields = extractTitleBlockFields(text, 'embedded_text');
    } catch (err) {
      this.logger.warn(`Embedded-text extraction failed for "${entry.filename}": ${this.describeError(err)}`);
    }
    // OCR fallback (Decision 1 step 2, via the existing ai-service
    // pytesseract installation) is not yet wired into this processor --
    // a file with no usable embedded text layer is flagged NEEDS_REVIEW
    // today rather than silently guessed at. Tracked as a follow-up, not
    // claimed as done.

    return this.reconcile(companyId, projectId, batch, entry.filename, storageKey, entry.buffer.length, fields);
  }

  private async reconcile(
    companyId: string, projectId: string, batch: ImportBatchDbRow, filename: string, storageKey: string, fileSizeBytes: number, fields: ExtractedDrawingFields | null,
  ): Promise<ReconcileOutcome> {
    const filenameWithoutExtension = filename.replace(/\.pdf$/i, '');
    const drawingNumber = fields?.drawingNumber ?? filenameWithoutExtension;
    const drawingTitle = fields?.drawingTitle ?? filenameWithoutExtension;
    const revisionNumber = fields?.revisionNumber ?? '1';
    // Never inferred as MANUAL -- an import always went through extraction
    // (even a fallback-to-filename case), so 'MANUAL' (reserved for a
    // human directly typing values in the register UI) would misrepresent
    // its origin.
    const baseExtractionStatus = fields && isConfidentExtraction(fields) ? 'CONFIRMED' : 'NEEDS_REVIEW';

    return this.db.withTenant(companyId, async (sql) => {
      const [existing] = await sql<ExistingDrawingRow[]>`
        SELECT id, drawing_title, current_revision_id FROM site_drawings
        WHERE project_id = ${projectId} AND source_provider = ${batch.sourceSystem} AND drawing_number = ${drawingNumber}
      `;

      if (!existing) {
        const [drawing] = await sql<{ id: string }[]>`
          INSERT INTO site_drawings (company_id, project_id, drawing_number, drawing_title, discipline, source_provider, source_file_id, current_workflow_status)
          VALUES (${companyId}, ${projectId}, ${drawingNumber}, ${drawingTitle}, ${fields?.discipline ?? null}, ${batch.sourceSystem}, ${randomUUID()}, 'UNKNOWN')
          RETURNING id
        `;
        const [revision] = await sql<{ id: string }[]>`
          INSERT INTO site_drawing_revisions (
            company_id, project_id, drawing_id, revision_number, workflow_status, issue_date, storage_key, file_size_bytes,
            synchronization_status, extraction_status, extracted_fields_raw, import_batch_id, uploaded_by
          ) VALUES (
            ${companyId}, ${projectId}, ${drawing.id}, ${revisionNumber}, 'UNKNOWN', ${fields?.issueDate ?? null}, ${storageKey}, ${fileSizeBytes},
            'NOT_APPLICABLE', ${baseExtractionStatus}, ${sql.json(toJsonSafe(fields))}, ${batch.id}, ${batch.uploadedBy ?? null}
          ) RETURNING id
        `;
        await sql`UPDATE site_drawings SET current_revision_id = ${revision.id} WHERE id = ${drawing.id}`;
        return 'created';
      }

      // A possible drawing-number mismatch (brief section 4): the same
      // drawing number already exists under a materially different
      // title. Flagged as CONFLICT rather than silently overwritten --
      // unlike SiteDrawingSyncService's SharePoint path (which trusts its
      // source), extracted metadata here is uncertain by construction.
      const titleConflict = Boolean(fields?.drawingTitle) && !titlesCompatible(existing.drawingTitle, drawingTitle);
      const extractionStatus = titleConflict ? 'CONFLICT' : baseExtractionStatus;
      const reviewNotes = titleConflict
        ? `Drawing ${drawingNumber} already exists with title "${existing.drawingTitle}" -- this import's extracted title ("${drawingTitle}") does not match. Possible drawing-number collision between two different drawings -- please verify.`
        : null;

      const [currentRevision] = existing.currentRevisionId
        ? await sql<CurrentRevisionRow[]>`SELECT id, revision_number FROM site_drawing_revisions WHERE id = ${existing.currentRevisionId}`
        : [];

      // "Repeated packages containing previously imported drawings" (brief
      // section 2) -- the SAME revision number re-imported is a duplicate,
      // not a new revision (brief section 2: "prevent... duplicate
      // processing"). The already-uploaded file for this revision is left
      // alone; this one is simply not attached as a new revision. Its
      // freshly-uploaded (now orphaned) storage object is removed rather
      // than left as a stray billable object with nothing pointing to it.
      if (currentRevision && currentRevision.revisionNumber === revisionNumber && !titleConflict) {
        await this.storage.deleteIfExists(storageKey);
        return 'duplicate_skipped';
      }

      const [newRevision] = await sql<{ id: string }[]>`
        INSERT INTO site_drawing_revisions (
          company_id, project_id, drawing_id, revision_number, workflow_status, issue_date, storage_key, file_size_bytes,
          supersedes_revision_id, synchronization_status, extraction_status, extracted_fields_raw, import_batch_id,
          review_notes, uploaded_by
        ) VALUES (
          ${companyId}, ${projectId}, ${existing.id}, ${revisionNumber}, 'UNKNOWN', ${fields?.issueDate ?? null}, ${storageKey}, ${fileSizeBytes},
          ${currentRevision?.id ?? null}, 'NOT_APPLICABLE', ${extractionStatus}, ${sql.json(toJsonSafe(fields))}, ${batch.id},
          ${reviewNotes}, ${batch.uploadedBy ?? null}
        ) RETURNING id
      `;
      if (currentRevision) {
        await sql`UPDATE site_drawing_revisions SET is_superseded = true WHERE id = ${currentRevision.id}`;
      }
      // Never changes workflow_status away from what the previous current
      // revision had set -- a new, unreviewed revision starts at UNKNOWN,
      // the same "never auto-promote" rule applies regardless of path.
      const newWorkflowStatus: SiteDrawingWorkflowStatus = 'UNKNOWN';
      await sql`
        UPDATE site_drawings SET current_revision_id = ${newRevision.id}, current_workflow_status = ${newWorkflowStatus}, current_is_superseded = false
        WHERE id = ${existing.id}
      `;
      return 'revision_added';
    });
  }

  private async getBatch(companyId: string, batchId: string): Promise<ImportBatchDbRow> {
    const [row] = await this.db.withTenant(companyId, sql => sql<ImportBatchDbRow[]>`
      SELECT id, storage_key, original_filename, source_system, uploaded_by FROM site_drawing_import_batches WHERE id = ${batchId}
    `);
    if (!row) throw new Error(`Import batch ${batchId} not found.`);
    return row;
  }

  private async markStarted(companyId: string, batchId: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE site_drawing_import_batches SET status = 'PROCESSING', started_at = now() WHERE id = ${batchId}
    `);
  }

  private async finish(
    companyId: string, batchId: string, status: 'COMPLETED' | 'PARTIAL' | 'FAILED',
    counts: { fileCount: number; createdCount: number; revisionCount: number; skippedCount: number; errorCount: number },
    errorMessage: string | null,
  ): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE site_drawing_import_batches SET
        status = ${status}, file_count = ${counts.fileCount}, created_count = ${counts.createdCount},
        revision_count = ${counts.revisionCount}, skipped_count = ${counts.skippedCount}, error_count = ${counts.errorCount},
        error_message = ${errorMessage}, finished_at = now()
      WHERE id = ${batchId}
    `);
  }

  private describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

// Normalizes whitespace/case before comparing two drawing titles for the
// conflict check above -- not a fuzzy/edit-distance match, just enough to
// not flag "Ground Floor Plan" against "GROUND FLOOR PLAN " as a
// conflict. Anything beyond exact-after-normalization is treated as a
// genuine mismatch worth a human's attention, not silently reconciled.
function titlesCompatible(a: string, b: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalize(a) === normalize(b);
}

// sql.json()'s JSONValue type needs an index signature a plain interface
// can't structurally satisfy -- same boundary TenancyService.
// updateSettings() already documents. Also handles null directly (no
// extraction at all), since sql.json(null) is itself a valid jsonb NULL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJsonSafe(fields: ExtractedDrawingFields | null): any {
  return fields;
}
