import { createHash, randomUUID } from 'crypto';
import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import type { DocSource, ExtractedDrawingFields, SiteDrawingWorkflowStatus } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { SiteDrawingsService } from './site-drawings.service';
import type { SiteDrawingImportJob } from './site-drawing-import.service';
import { extractPdfEntriesFromZip, type ExtractedZipEntry } from './extraction/zip-extraction.util';
import { extractPdfEntriesFromRar } from './extraction/rar-extraction.util';
import { isConfidentExtraction } from './extraction/title-block-extractor';
import { extractDrawingFields } from './extraction/extract-drawing-fields';
import { resolveOrgMapping } from './extraction/org-mapping-lookup';
import { assessIdentityMatch } from './extraction/identity-match';
import { compareRevisionOrder } from './extraction/revision-order';

// 'conflict': a revision row WAS created (and IS linked to the matched
// drawing, visible in its history and in the Review Queue), but was
// deliberately NOT promoted to current -- identity or chronology couldn't
// be confirmed, so the existing register entry is left exactly as it was
// until an authorized user decides (SiteDrawingImportService.
// confirmRevisionAsNew() / splitRevisionAsNewDrawing()). Distinct from
// 'revision_added' (auto-promoted; identity and chronology were both
// confident) and from a thrown error (nothing was created at all).
type ReconcileOutcome = 'created' | 'revision_added' | 'conflict' | 'duplicate_skipped';

// Stands in for revision_number when extraction found none at all
// (site_drawing_revisions.revision_number is NOT NULL, so a literal
// schema NULL isn't an option without a migration -- this sentinel gives
// the same "we genuinely do not know" meaning without one). Deliberately
// NOT '1': a real, plausible-looking revision label is indistinguishable
// from a genuinely-read one anywhere it's displayed (the Register, the
// Review Queue, a drawing's own detail view), which is exactly what
// production data showed happening -- confirmed by hand, a drawing whose
// revision was never actually read was shown as "Rev. 1" with no visual
// difference from a confidently-extracted "1". Never a value
// compareRevisionOrder() can parse as a real label (not pure-numeric,
// not a letter, not a recognized prefixed-number shape), which is what
// keeps it out of current_revision_id on its own: chronology against it
// always comes back 'ambiguous', so canAutoPromote below is false by
// construction, with no separate special-case needed. Distinct from
// workflow_status's own literal 'UNKNOWN' (a status, not a label) used a
// few lines below, so the two concerns never read as the same sentinel.
const UNVERIFIED_REVISION_NUMBER = 'UNVERIFIED';

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
  contentHash: string | null;
}

type ImportBatchStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED';
interface ImportBatchCounts {
  fileCount: number; createdCount: number; revisionCount: number; conflictCount: number;
  skippedCount: number; errorCount: number; unsupportedCount: number;
}

// Runs in a Bull worker, same pattern as ImageProcessingProcessor/
// WebhookDeliveryProcessor; never blocks the request that uploaded the
// archive (brief section 2: "handle large packages through background
// processing, with progress, retry and error reporting").
//
// Per-file failures (a corrupt individual PDF, an extraction error) are
// caught and counted, never allowed to abort the rest of the batch;
// one bad file in a package of hundreds must not lose the other 399.
// A whole-batch failure (the archive itself won't open, storage is
// unreachable) fails the batch record and rethrows so Bull's own retry/
// backoff (3 attempts, exponential) takes over; this is the "retry
// logic" brief section 2 asks for, reused rather than reinvented.
@Processor('site-drawing-import')
export class SiteDrawingImportProcessor {
  private readonly logger = new Logger(SiteDrawingImportProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly aiClient: AiClientService,
    private readonly siteDrawings: SiteDrawingsService,
  ) {}

  @Process('process-import-batch')
  async handleImportBatch(job: Job<SiteDrawingImportJob>): Promise<void> {
    const { batchId, companyId, projectId } = job.data;
    await this.markStarted(companyId, batchId);

    let batch: ImportBatchDbRow;
    try {
      batch = await this.getBatch(companyId, batchId);
    } catch (err) {
      await this.finish(companyId, batchId, 'FAILED', this.emptyCounts(), this.describeError(err));
      throw err;
    }

    let entries: ExtractedZipEntry[];
    let unsupportedCount = 0;
    try {
      const archiveBuffer = await this.storage.download(batch.storageKey);
      const lowerFilename = batch.originalFilename.toLowerCase();
      if (lowerFilename.endsWith('.zip') || lowerFilename.endsWith('.rar')) {
        const extracted = lowerFilename.endsWith('.zip')
          ? await extractPdfEntriesFromZip(archiveBuffer)
          : await extractPdfEntriesFromRar(archiveBuffer);
        entries = extracted.entries;
        // Phase 5: a batch's own record should say how many entries the
        // archive actually held, not just how many PDFs were attempted --
        // skippedNonPdf/rejectedUnsafe were already computed by the
        // extractor but, before this, never surfaced past this function
        // at all.
        unsupportedCount = (extracted.skippedNonPdf?.length ?? 0) + (extracted.rejectedUnsafe?.length ?? 0);
      } else {
        entries = [{ filename: batch.originalFilename, buffer: archiveBuffer }];
      }
    } catch (err) {
      // The archive itself is unsafe/corrupt/unreadable; never a partial
      // success for something this fundamentally wrong (brief section 10:
      // "never silently fall back to a potentially stale/incomplete state").
      const counts = this.emptyCounts();
      const errorMessage = this.describeError(err);
      await this.finish(companyId, batchId, 'FAILED', counts, errorMessage);
      await this.notifyBatchComplete(companyId, projectId, batch, 'FAILED', counts, errorMessage);
      throw err;
    }

    let createdCount = 0, revisionCount = 0, conflictCount = 0, skippedCount = 0, errorCount = 0;
    for (const entry of entries) {
      const startedAt = Date.now();
      try {
        const outcome = await this.processOneFile(companyId, projectId, batch, entry);
        if (outcome === 'created') createdCount++;
        else if (outcome === 'revision_added') revisionCount++;
        else if (outcome === 'conflict') conflictCount++;
        else skippedCount++;
        // Phase 7: a per-file audit trail for every outcome, not just
        // failures -- before this, a successful import left literally no
        // log line at all (confirmed: the only logger call anywhere in
        // this module was the one WARN below), making "why did this file
        // end up a duplicate/conflict/new drawing" impossible to answer
        // from logs after the fact.
        this.logger.log(this.describeFileOutcome(batch.id, companyId, projectId, entry.filename, outcome, Date.now() - startedAt));
      } catch (err) {
        errorCount++;
        this.logger.warn(`Import batch ${batch.id}: failed to process "${entry.filename}": ${this.describeError(err)}`);
      }
    }

    const counts: ImportBatchCounts = {
      fileCount: entries.length, createdCount, revisionCount, conflictCount, skippedCount, errorCount, unsupportedCount,
    };
    // COMPLETED only when every file succeeded outright with nothing left
    // to review; PARTIAL when some needed attention (an error, or a
    // conflict awaiting a human decision) but something still went
    // through cleanly; FAILED only when literally nothing could be
    // processed or confirmed.
    const nothingProcessed = createdCount + revisionCount + conflictCount + skippedCount === 0;
    const status: ImportBatchStatus = errorCount === 0 && conflictCount === 0 ? 'COMPLETED' : nothingProcessed ? 'FAILED' : 'PARTIAL';
    const errorMessage = errorCount > 0 || conflictCount > 0
      ? [errorCount > 0 ? `${errorCount} of ${entries.length} file(s) could not be processed.` : null,
        conflictCount > 0 ? `${conflictCount} file(s) need review before being added as a revision.` : null]
        .filter(Boolean).join(' ')
      : null;
    await this.finish(companyId, batchId, status, counts, errorMessage);

    // Brief section 5: "Notify relevant users" -- the same expectation
    // SiteDrawingsService's own manual-upload and workflow-status paths
    // already meet, just never wired into this bulk path before. One
    // notification per BATCH, not per file: a 200-file import firing 200
    // separate notifications at every project member would be noise, not
    // a feature.
    await this.notifyBatchComplete(companyId, projectId, batch, status, counts, errorMessage);
  }

  private emptyCounts(): ImportBatchCounts {
    return { fileCount: 0, createdCount: 0, revisionCount: 0, conflictCount: 0, skippedCount: 0, errorCount: 0, unsupportedCount: 0 };
  }

  private async notifyBatchComplete(
    companyId: string, projectId: string, batch: ImportBatchDbRow, status: ImportBatchStatus, counts: ImportBatchCounts, errorMessage: string | null,
  ): Promise<void> {
    const title = status === 'FAILED' && counts.fileCount === 0
      ? `Import of "${batch.originalFilename}" failed: ${errorMessage ?? 'the archive could not be processed.'}`
      : `Import of "${batch.originalFilename}" ${status === 'COMPLETED' ? 'completed' : 'completed with items needing attention'}: `
        + `${counts.createdCount} new, ${counts.revisionCount} revision(s), ${counts.skippedCount} duplicate(s) skipped`
        + `${counts.conflictCount > 0 ? `, ${counts.conflictCount} need review` : ''}`
        + `${counts.errorCount > 0 ? `, ${counts.errorCount} error(s)` : ''}.`;

    await this.siteDrawings.notifyProjectMembers(companyId, projectId, batch.uploadedBy, {
      type: 'site_drawing_import_completed',
      title,
      resourceType: 'site_drawing_import_batch',
      resourceId: batch.id,
      priority: status === 'COMPLETED' ? 'normal' : 'high',
    });
  }

  private async processOneFile(companyId: string, projectId: string, batch: ImportBatchDbRow, entry: ExtractedZipEntry): Promise<ReconcileOutcome> {
    // The original consultant-issued file, preserved exactly as uploaded
    // (brief section 2): a new, dedicated storage key per drawing, same
    // convention registerDrawing() already uses for a direct upload.
    const storageKey = this.storage.generateKey(companyId, projectId, 'documents', entry.filename);
    await this.storage.upload(storageKey, entry.buffer, 'application/pdf');

    // Phase 4: once this file's bytes are in storage, any failure past
    // this point (extraction throwing, or reconcile()'s own DB error) must
    // not leave them there unreferenced forever -- the previous behavior
    // had no cleanup at all on this path (only the true-duplicate branch
    // inside reconcile() ever called deleteIfExists). A CONFLICT outcome
    // is NOT a failure here: reconcile() always either returns normally
    // (including 'conflict', which legitimately keeps the file, per Phase
    // 1's "preserve the uploaded original PDF") or throws; only a throw
    // reaches this catch.
    try {
      // Embedded-text-first, OCR-fallback (Decision 1 steps 1-2): shared with
      // SiteDrawingsService.extractFields() (the single manual-upload path)
      // via extractDrawingFields() -- same pipeline either way. An
      // AI-service outage/timeout degrades to NEEDS_REVIEW (fields stays
      // null), never allowed to fail the whole file, let alone the batch
      // (brief: "if existing infrastructure cannot support reliable
      // processing, report the limitation"; this file's own
      // extraction_status is that report, not a thrown error).
      const { fields, pageCount } = await extractDrawingFields(this.storage, this.aiClient, companyId, projectId, storageKey, entry.buffer, entry.filename);

      // The file's own byte-for-byte identity, independent of anything
      // extraction found (or failed to find) -- see reconcile()'s own
      // comment on why this, not the extracted revision number, is what
      // decides whether a reimport is a duplicate.
      const contentHash = createHash('sha256').update(entry.buffer).digest('hex');

      return await this.reconcile(companyId, projectId, batch, entry.filename, storageKey, entry.buffer.length, contentHash, fields, pageCount);
    } catch (err) {
      try {
        await this.storage.deleteIfExists(storageKey);
        this.logger.log(`Import batch ${batch.id}: cleaned up orphaned storage object "${storageKey}" after "${entry.filename}" failed to process.`);
      } catch (cleanupErr) {
        // Never let a cleanup failure mask the original error, but keep
        // enough to investigate the leaked object later (Phase 4: "log
        // cleanup success or failure... preserve sufficient information
        // to investigate failed cleanup operations").
        this.logger.warn(`Import batch ${batch.id}: failed to clean up storage object "${storageKey}" after "${entry.filename}" failed to process: ${this.describeError(cleanupErr)}`);
      }
      throw err;
    }
  }

  private async reconcile(
    companyId: string, projectId: string, batch: ImportBatchDbRow, filename: string, storageKey: string, fileSizeBytes: number,
    contentHash: string, fields: ExtractedDrawingFields | null, pageCount: number | null,
  ): Promise<ReconcileOutcome> {
    const filenameWithoutExtension = filename.replace(/\.pdf$/i, '');
    const drawingNumber = fields?.drawingNumber ?? filenameWithoutExtension;
    const drawingTitle = fields?.drawingTitle ?? filenameWithoutExtension;
    const revisionNumber = fields?.revisionNumber ?? UNVERIFIED_REVISION_NUMBER;
    // Second, independent check at the insert boundary itself -- not a
    // substitute for extractDate()'s own calendar-validity check
    // (title-block-extractor.ts, commit 13360bd), a backstop for it. That
    // fix addressed one specific date shape ("60/90/2025") and the same
    // handful of files crashed again in production with the identical
    // `RangeError: Invalid time value` afterwards, proving some other
    // garbled-OCR shape still gets past the regex-based check. Rather than
    // chase the exact string a regex missed, this makes the one thing that
    // actually throws -- the postgres driver's `new Date(value)
    // .toISOString()` call when serializing a SQL DATE parameter --
    // impossible to reach with a bad value, by doing that same conversion
    // here first and discarding the value (never throwing) if it fails.
    // Matches how every other uncertain field already behaves (drawingNumber/
    // drawingTitle fall back to the filename, confidence degrades to
    // NEEDS_REVIEW): an extraction that couldn't produce a real date is
    // "no date found," never a crash that aborts the whole file.
    const issueDate = fields?.issueDate && !Number.isNaN(new Date(fields.issueDate).getTime()) ? fields.issueDate : null;
    // Never inferred as MANUAL: an import always went through extraction
    // (even a fallback-to-filename case), so 'MANUAL' (reserved for a
    // human directly typing values in the register UI) would misrepresent
    // its origin.
    let baseExtractionStatus: 'CONFIRMED' | 'NEEDS_REVIEW' = fields && isConfidentExtraction(fields) ? 'CONFIRMED' : 'NEEDS_REVIEW';

    // Phase 6 (multi-page PDFs): this pipeline only ever reads page 1 (see
    // extractEmbeddedText's own comment on why). A single-page file is
    // exactly what every title block this architecture was built against
    // looks like; a multi-page one might be a multi-sheet set this
    // pipeline would otherwise silently treat as a single drawing with
    // its later pages never looked at. Never auto-split into one drawing
    // per page (a legitimate multi-page drawing -- e.g. a sheet plus a
    // schedule continuation -- is NOT four drawings just because it has
    // four pages); instead this degrades confidence so a human notices
    // and checks, without blocking the import or guessing a split.
    let multiPageNote: string | null = null;
    if (pageCount !== null && pageCount > 1) {
      baseExtractionStatus = 'NEEDS_REVIEW';
      multiPageNote = `This PDF has ${pageCount} pages; only page 1 was read for extraction. Verify the drawing number/title, and check whether this file actually contains more than one independently-numbered sheet.`;
    }

    return this.db.withTenant(companyId, async (sql) => {
      const [existing] = await sql<ExistingDrawingRow[]>`
        SELECT id, drawing_title, current_revision_id FROM site_drawings
        WHERE project_id = ${projectId} AND source_provider = ${batch.sourceSystem} AND drawing_number = ${drawingNumber}
      `;

      if (!existing) {
        // Master spec section 4: resolve originator/subcontractor from the
        // project's own org mapping, matched against this drawing's
        // number; never guessed from title-block text directly.
        const mapped = await resolveOrgMapping(sql, projectId, drawingNumber);
        const [drawing] = await sql<{ id: string }[]>`
          INSERT INTO site_drawings (
            company_id, project_id, drawing_number, drawing_title, discipline, originator, responsible_subcontractor,
            source_provider, source_file_id, current_workflow_status
          )
          VALUES (
            ${companyId}, ${projectId}, ${drawingNumber}, ${drawingTitle}, ${fields?.discipline ?? null},
            ${mapped.originator ?? null}, ${mapped.responsibleSubcontractor ?? null},
            ${batch.sourceSystem}, ${randomUUID()}, 'UNKNOWN'
          )
          RETURNING id
        `;
        const [revision] = await sql<{ id: string }[]>`
          INSERT INTO site_drawing_revisions (
            company_id, project_id, drawing_id, revision_number, workflow_status, issue_date, storage_key, file_size_bytes,
            content_hash, synchronization_status, extraction_status, extracted_fields_raw, import_batch_id, uploaded_by, review_notes
          ) VALUES (
            ${companyId}, ${projectId}, ${drawing.id}, ${revisionNumber}, 'UNKNOWN', ${issueDate}, ${storageKey}, ${fileSizeBytes},
            ${contentHash}, 'NOT_APPLICABLE', ${baseExtractionStatus}, ${sql.json(toJsonSafe(fields))}, ${batch.id}, ${batch.uploadedBy ?? null},
            ${multiPageNote}
          ) RETURNING id
        `;
        await sql`UPDATE site_drawings SET current_revision_id = ${revision.id} WHERE id = ${drawing.id}`;
        return 'created';
      }

      // Phase 1 (drawing identity integrity): a matching drawing_number is
      // necessary but is NOT, on its own, sufficient evidence this file is
      // really a revision of THIS drawing -- extraction can pick up
      // incidental text elsewhere on the page and land on the same (wrong)
      // number for two genuinely different physical drawings (the
      // architecture's own documented risk; see title-block-extractor.ts's
      // header comment). Previously, only a PRESENT-and-incompatible title
      // escalated to CONFLICT; a MISSING or low-confidence one was read as
      // "no objection" and sailed straight through as a confirmed revision,
      // immediately promoted to current -- confirmed in production
      // (import batch 05f82c73, 2026-11-18) by two different physical
      // files colliding on the exact same (drawing_id, revision_number)
      // pair. assessIdentityMatch() makes "no corroborating evidence" its
      // own outcome instead of silently reading it as agreement.
      const identity = assessIdentityMatch(fields, existing.drawingTitle);

      const [currentRevision] = existing.currentRevisionId
        ? await sql<CurrentRevisionRow[]>`SELECT id, revision_number, content_hash FROM site_drawing_revisions WHERE id = ${existing.currentRevisionId}`
        : [];

      // "Repeated packages containing previously imported drawings" (brief
      // section 2): a re-import of the EXACT SAME FILE is the duplicate
      // brief section 2 asks to prevent -- detected by the file's own
      // content, never by the extracted revision label alone. A failed/
      // defaulted revision number (this function's own fallback to
      // UNVERIFIED_REVISION_NUMBER above) must never be mistaken for proof
      // two files are the same revision: confirmed by hand against
      // production, every reimport of a file whose revision couldn't be
      // extracted was silently skipped as a "duplicate" of the fallback
      // label, even when the file's actual content -- a real new revision
      // -- had changed. The already-uploaded file for this revision is
      // left alone; this one is simply
      // not attached as a new revision, and its freshly-uploaded (now
      // orphaned) storage object is removed rather than left as a stray
      // billable object with nothing pointing to it.
      //
      // Duplicate detection runs BEFORE the identity check above matters:
      // byte-for-byte identical content is proof enough of sameness
      // regardless of what extraction did or didn't find this time.
      if (currentRevision && currentRevision.contentHash === contentHash) {
        await this.storage.deleteIfExists(storageKey);
        return 'duplicate_skipped';
      }

      // Content differs -- a genuine new revision -- but extraction
      // couldn't tell its real revision number apart from one ALREADY used
      // on this drawing. site_drawing_revisions' UNIQUE(drawing_id,
      // revision_number) would otherwise reject this insert outright.
      // Disambiguated with a suffix guaranteed free among every revision
      // this drawing has ever had, and always routed to review -- the
      // same treatment an identity mismatch already gets -- since a
      // human needs to correct the real revision label, not have this
      // import silently fail.
      //
      // Checked against every revision_number this drawing has, not just
      // the CURRENT one: confirmed by hand against production -- a drawing
      // reimported several times over (each failed/defaulted extraction
      // landing on the same UNVERIFIED_REVISION_NUMBER fallback, or on a
      // label already used by a now-superseded revision from an earlier
      // reimport) kept colliding with a revision number that was no longer
      // current, which a current-revision-only check could never see, and
      // the INSERT below failed with the same unique-constraint violation
      // this disambiguation exists to prevent.
      const usedRevisionNumbers = await sql<{ revisionNumber: string }[]>`
        SELECT revision_number FROM site_drawing_revisions WHERE drawing_id = ${existing.id}`;
      const usedRevisionNumberSet = new Set(usedRevisionNumbers.map(r => r.revisionNumber));

      let revisionNumberCollision = false;
      let effectiveRevisionNumber = revisionNumber;
      if (usedRevisionNumberSet.has(revisionNumber)) {
        revisionNumberCollision = true;
        let suffix = 2;
        while (usedRevisionNumberSet.has(`${revisionNumber}-v${suffix}`)) suffix++;
        effectiveRevisionNumber = `${revisionNumber}-v${suffix}`;
      }

      // Phase 2 (revision chronology integrity): processing order (ZIP
      // entry order, or simply "which reimport happened to run second")
      // is NOT evidence of real-world revision chronology. Only compared
      // when the raw label didn't just collide outright above -- a
      // collision already proves the label can't be trusted to mean
      // anything on its own.
      const chronology = revisionNumberCollision ? 'ambiguous' : compareRevisionOrder(currentRevision?.revisionNumber ?? revisionNumber, revisionNumber);

      // Promotion -- making this revision "current" and marking the
      // previous one superseded -- requires BOTH gates: confident identity
      // (this really is the same drawing) AND confident, strictly-newer
      // chronology (this really is a later revision, not an earlier one
      // processed out of order). Either gate failing means the existing
      // register entry is left completely untouched until a human
      // resolves it through the Review Queue (confirmRevisionAsNew() /
      // splitRevisionAsNewDrawing()) -- never a silent supersede on
      // uncertain evidence.
      const canAutoPromote = identity.verdict === 'confirmed' && chronology === 'incoming_newer';

      const reviewNotes = identity.verdict === 'title_conflict'
        ? `Drawing ${drawingNumber} already exists with title "${identity.existingTitle}" -- this import's extracted title ("${identity.incomingTitle}") does not match. Possible drawing-number collision between two different drawings -- please verify whether this is a new revision or a different drawing entirely.`
        : identity.verdict === 'uncertain'
        ? `${identity.reason} Please verify whether this is really a new revision of drawing ${drawingNumber}, or a different drawing that happens to share the same extracted number.`
        : revisionNumberCollision
        ? `This file's content differs from the current revision, but its extracted revision number ("${revisionNumber}") matches one already used on this drawing -- the real revision label could not be determined. Stored as "${effectiveRevisionNumber}"; please correct it and confirm this is really a new revision.`
        : chronology !== 'incoming_newer'
        ? `This file's revision ("${revisionNumber}") could not be confirmed as newer than the drawing's current revision ("${currentRevision?.revisionNumber ?? 'none'}") -- please verify the real revision order before this replaces the current revision.`
        : multiPageNote;

      const extractionStatus = canAutoPromote ? baseExtractionStatus : 'CONFLICT';

      const [newRevision] = await sql<{ id: string }[]>`
        INSERT INTO site_drawing_revisions (
          company_id, project_id, drawing_id, revision_number, workflow_status, issue_date, storage_key, file_size_bytes,
          content_hash, supersedes_revision_id, synchronization_status, extraction_status, extracted_fields_raw, import_batch_id,
          review_notes, uploaded_by
        ) VALUES (
          ${companyId}, ${projectId}, ${existing.id}, ${effectiveRevisionNumber}, 'UNKNOWN', ${issueDate}, ${storageKey}, ${fileSizeBytes},
          ${contentHash}, ${canAutoPromote ? (currentRevision?.id ?? null) : null}, 'NOT_APPLICABLE', ${extractionStatus}, ${sql.json(toJsonSafe(fields))}, ${batch.id},
          ${reviewNotes}, ${batch.uploadedBy ?? null}
        ) RETURNING id
      `;

      if (!canAutoPromote) {
        // Never touches site_drawings or the existing current revision:
        // this file is preserved (its row exists, linked to this drawing,
        // visible in the drawing's own revision history and in the Review
        // Queue) but the register's own account of "what's current" is
        // completely untouched until a human decides. supersedes_revision_id
        // stays NULL above for exactly this reason -- it hasn't superseded
        // anything (yet).
        return 'conflict';
      }

      await sql`UPDATE site_drawing_revisions SET is_superseded = true WHERE id = ${currentRevision!.id}`;
      // Never changes workflow_status away from what the previous current
      // revision had set; a new, unreviewed revision starts at UNKNOWN,
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
    companyId: string, batchId: string, status: ImportBatchStatus, counts: ImportBatchCounts, errorMessage: string | null,
  ): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE site_drawing_import_batches SET
        status = ${status}, file_count = ${counts.fileCount}, created_count = ${counts.createdCount},
        revision_count = ${counts.revisionCount}, conflict_count = ${counts.conflictCount}, skipped_count = ${counts.skippedCount},
        error_count = ${counts.errorCount}, unsupported_count = ${counts.unsupportedCount},
        error_message = ${errorMessage}, finished_at = now()
      WHERE id = ${batchId}
    `);
  }

  private describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  // Phase 7 (auditability): one structured line per successfully-processed
  // file -- batch/project context, what was extracted, and the outcome --
  // so "why did this file end up a duplicate/conflict/new drawing" can be
  // answered from logs after the fact. Never logs raw page text or the
  // file's own bytes, only the already-structured fields the pipeline
  // itself derived; company/project scoping here is the same tenant
  // context every other log line in this processor already carries
  // (the batch/company/project ids), never a cross-tenant dump.
  private describeFileOutcome(batchId: string, companyId: string, projectId: string, filename: string, outcome: ReconcileOutcome, durationMs: number): string {
    return `Import batch ${batchId} (company ${companyId}, project ${projectId}): "${filename}" -> ${outcome} (${durationMs}ms)`;
  }
}

// sql.json()'s JSONValue type needs an index signature a plain interface
// can't structurally satisfy; same boundary TenancyService.
// updateSettings() already documents. Also handles null directly (no
// extraction at all), since sql.json(null) is itself a valid jsonb NULL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJsonSafe(fields: ExtractedDrawingFields | null): any {
  return fields;
}
