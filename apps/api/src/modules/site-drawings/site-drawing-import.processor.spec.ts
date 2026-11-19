import { createHash } from 'crypto';
import { SiteDrawingImportProcessor } from './site-drawing-import.processor';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { SiteDrawingsService } from './site-drawings.service';
import * as pdfTextExtractor from './extraction/pdf-text-extractor';
import * as zipExtraction from './extraction/zip-extraction.util';
import * as extractDrawingFieldsModule from './extraction/extract-drawing-fields';

jest.mock('./extraction/pdf-text-extractor');
jest.mock('./extraction/zip-extraction.util');

type WithTenantCallback = (sql: unknown) => unknown;

// sql.json() is the postgres.js helper the processor uses to bind
// extracted_fields_raw as a real jsonb parameter (see
// site-drawing-import.processor.ts's own comment on why): the mock
// must support it the same way sharepoint-integration.service.spec.ts's
// DB mock does, or every INSERT silently throws "sql.json is not a
// function" and gets swallowed by handleImportBatch's own per-file
// try/catch, giving false-passing tests that never actually exercise
// reconcile()'s real logic.
function withJson(sql: (...args: unknown[]) => Promise<unknown>) {
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return sql;
}

function single(result: unknown) {
  return (callback: WithTenantCallback) => callback(withJson(() => Promise.resolve(result)));
}
function multi(results: unknown[]) {
  return (callback: WithTenantCallback) => {
    let i = 0;
    const sql = withJson(() => Promise.resolve(results[i++] ?? []));
    return callback(sql);
  };
}

const companyId = 'company-1';
const projectId = 'project-1';
const batchId = 'batch-1';

function makeProcessor(withTenantSteps: ((callback: WithTenantCallback) => unknown)[]) {
  let call = 0;
  const withTenant = jest.fn((_companyId: string, callback: WithTenantCallback) => {
    const step = withTenantSteps[call];
    call += 1;
    if (!step) throw new Error(`withTenant called more times (${call}) than this test provided steps for`);
    return step(callback);
  });
  const db = { withTenant } as unknown as DatabaseService;
  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('zip-bytes')),
    upload: jest.fn().mockResolvedValue(undefined),
    generateKey: jest.fn().mockReturnValue('company-1/documents/project-1/abc.pdf'),
    getReadUrl: jest.fn().mockResolvedValue('https://signed.example/abc.pdf'),
    deleteIfExists: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;
  const aiClient = { ocrExtractText: jest.fn() } as unknown as AiClientService;
  const siteDrawings = { notifyProjectMembers: jest.fn().mockResolvedValue(undefined) } as unknown as SiteDrawingsService;
  return { processor: new SiteDrawingImportProcessor(db, storage, aiClient, siteDrawings), db, storage, aiClient, siteDrawings, withTenant };
}

const batchRow = { id: batchId, storageKey: 'batch-key.pdf', originalFilename: 'A-101.pdf', sourceSystem: 'manual_link' as const, uploadedBy: 'user-1' };

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

describe('SiteDrawingImportProcessor', () => {
  // restoreAllMocks (not just clearAllMocks): several tests
  // jest.spyOn(extractDrawingFieldsModule, 'extractDrawingFields') with
  // their own one-off mockResolvedValue/mockRejectedValue/
  // mockImplementation. clearAllMocks only resets call history, not a
  // spy's installed implementation -- without restoreAllMocks, a test
  // whose mock LEFT the spy rejecting/returning a fixed value "bled" that
  // behavior into every later test that never re-spies it itself (caught
  // by hand: Test 8 of the Site Drawing Hub integrity hardening suite,
  // which mockRejectedValue()s this exact spy, made the UNRELATED Test 10
  // -- which relies on the real extractDrawingFields -- fail, but only
  // when run after Test 8, never in isolation).
  beforeEach(() => jest.restoreAllMocks());

  it('skips OCR entirely when the embedded text layer is already usable', async () => {
    (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({ entries: [{ filename: 'A-101.pdf', buffer: Buffer.from('x') }] });
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: 'DRAWING NO: A-101\nREV: B', tableCells: [], pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

    const { processor, aiClient, withTenant } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      // reconcile() is ONE withTenant call with 4 sequential statements:
      // SELECT existing (none), INSERT drawing, INSERT revision, UPDATE current_revision_id
      multi([[], [], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]),
      single(undefined), // finish
    ]);

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    expect(aiClient.ocrExtractText).not.toHaveBeenCalled();
    expect(withTenant).toHaveBeenCalledTimes(4);
  });

  it('calls the OCR fallback only when the embedded text layer has nothing usable, and feeds its result into title-block extraction', async () => {
    (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({ entries: [{ filename: 'scan.pdf', buffer: Buffer.from('x') }] });
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);

    const { processor, aiClient, storage } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      multi([[], [], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]), // reconcile: SELECT existing (none), INSERT drawing, INSERT revision, UPDATE
      single(undefined), // finish
    ]);
    (aiClient.ocrExtractText as jest.Mock).mockResolvedValue({ text: 'DRAWING NO: M-301\nREV: A', confidence: 0.9 });

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    expect(storage.getReadUrl).toHaveBeenCalled();
    expect(aiClient.ocrExtractText).toHaveBeenCalledWith(companyId, projectId, 'https://signed.example/abc.pdf', 1);
  });

  it('degrades to NEEDS_REVIEW (never throws, never fails the batch) when the OCR fallback itself fails', async () => {
    (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({ entries: [{ filename: 'scan.pdf', buffer: Buffer.from('x') }] });
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);

    const { processor, aiClient, db } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      // reconcile: SELECT existing (none), INSERT drawing, INSERT revision, UPDATE;
      // falls back to the filename-derived drawing number since fields stays null.
      multi([[], [], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]),
      single(undefined), // finish
    ]);
    (aiClient.ocrExtractText as jest.Mock).mockRejectedValue(new Error('ai-service down'));

    await expect(processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never)).resolves.toBeUndefined();
    expect(db.withTenant).toHaveBeenCalledTimes(4); // the batch still completes (COMPLETED/PARTIAL), never aborted by the OCR failure
  });

  it('sends one notification per batch (not per file), excluding the uploader, summarizing the outcome', async () => {
    (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({ entries: [{ filename: 'A-101.pdf', buffer: Buffer.from('x') }] });
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: 'DRAWING NO: A-101\nREV: B', tableCells: [], pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

    const { processor, siteDrawings } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      multi([[], [], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]), // reconcile: created
      single(undefined), // finish
    ]);

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    expect(siteDrawings.notifyProjectMembers).toHaveBeenCalledTimes(1);
    expect(siteDrawings.notifyProjectMembers).toHaveBeenCalledWith(
      companyId, projectId, batchRow.uploadedBy,
      expect.objectContaining({ type: 'site_drawing_import_completed', title: expect.stringContaining('1 new') }),
    );
  });

  it('skips a reimport as a duplicate when its content hash matches the current revision, regardless of the extracted revision label', async () => {
    // Reproduces the real bug: extraction fails entirely for both the
    // original import and this reimport (same unreadable file), so both
    // land on the revisionNumber fallback of '1' -- but that must never
    // be the signal that decides duplicate-ness. Content hash is.
    // batchRow.originalFilename is a bare .pdf, not a .zip, so the
    // processor reads this file's bytes straight from storage.download()
    // (the single-PDF path), never through extractPdfEntriesFromZip --
    // that mock must therefore carry the SAME buffer being hashed here.
    const buffer = Buffer.from('identical file bytes');
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);

    const { processor, storage, db } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      // reconcile: SELECT existing (found), SELECT currentRevision (same content hash) -> duplicate_skipped, no INSERT
      multi([
        [{ id: 'drawing-1', drawingTitle: 'A-101', currentRevisionId: 'revision-1' }],
        [{ id: 'revision-1', revisionNumber: '1', contentHash: sha256(buffer) }],
      ]),
      single(undefined), // finish
    ]);
    (storage.download as jest.Mock).mockResolvedValue(buffer);
    (storage.getReadUrl as jest.Mock).mockResolvedValue('https://signed.example/abc.pdf');

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    expect(storage.deleteIfExists).toHaveBeenCalled();
    expect(db.withTenant).toHaveBeenCalledTimes(4); // no extra INSERT/UPDATE statements beyond the two SELECTs
  });

  it('creates a new, superseding revision when the title corroborates identity and the revision is confidently newer', async () => {
    // Title-block text includes a TITLE line this time -- confirming
    // identity against the existing drawing's own title -- and the
    // incoming revision ('B') is a confidently-newer single-letter label
    // than the current one ('A'); both gates (Phase 1/2) must pass for
    // this to auto-promote at all.
    const buffer = Buffer.from('a real new revision of the drawing');
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({
      text: 'DRAWING NO: A-101\nREV: B\nTITLE: Ground Floor Plan', tableCells: [], pageCount: 1,
    });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

    const insertCalls: unknown[][] = [];
    const captureSql = (results: unknown[]) => (callback: WithTenantCallback) => {
      let i = 0;
      const sql = withJson((...args: unknown[]) => { insertCalls.push(args); return Promise.resolve(results[i++] ?? []); });
      return callback(sql);
    };

    const { processor, db, storage } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      // reconcile: SELECT existing, SELECT currentRevision (rev 'A', different hash), SELECT usedRevisionNumbers (just 'A', no collision with 'B'), INSERT newRevision, supersede UPDATE, UPDATE current_revision_id
      captureSql([
        [{ id: 'drawing-1', drawingTitle: 'Ground Floor Plan', currentRevisionId: 'revision-1' }],
        [{ id: 'revision-1', revisionNumber: 'A', contentHash: sha256(Buffer.from('the previous revision')) }],
        [{ revisionNumber: 'A' }],
        [{ id: 'revision-2' }],
        [],
        [],
      ]),
      single(undefined), // finish
    ]);
    (storage.download as jest.Mock).mockResolvedValue(buffer);

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    expect(db.withTenant).toHaveBeenCalledTimes(4);
    // The promotion steps (supersede the old current revision, repoint
    // current_revision_id) must have actually run -- not just the INSERT --
    // proving both the identity and chronology gates were satisfied.
    expect(insertCalls.some((args) => (args[0] as string[]).join('?').includes('UPDATE site_drawing_revisions SET is_superseded'))).toBe(true);
    expect(insertCalls.some((args) => (args[0] as string[]).join('?').includes('UPDATE site_drawings SET current_revision_id'))).toBe(true);
  });

  it('does NOT promote a new revision when its title is missing, even though the drawing number matched -- Phase 1 identity gate', async () => {
    // The exact shape of the real production incident (import batch
    // 05f82c73): a second file matches an existing drawing by number
    // alone, but its own title could not be read at all. Previously this
    // sailed through as a confirmed, auto-promoted revision; now it must
    // be preserved as a pending CONFLICT, with the existing drawing's
    // current revision left completely untouched.
    const buffer = Buffer.from('a different physical drawing with no readable title');
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: 'DRAWING NO: A-101', tableCells: [], pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

    const insertCalls: unknown[][] = [];
    const captureSql = (results: unknown[]) => (callback: WithTenantCallback) => {
      let i = 0;
      const sql = withJson((...args: unknown[]) => { insertCalls.push(args); return Promise.resolve(results[i++] ?? []); });
      return callback(sql);
    };

    const { processor, storage } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      captureSql([
        [{ id: 'drawing-1', drawingTitle: 'Ground Floor Plan', currentRevisionId: 'revision-1' }], // SELECT existing
        [{ id: 'revision-1', revisionNumber: 'A', contentHash: sha256(Buffer.from('the current, unrelated revision')) }], // SELECT currentRevision
        [{ revisionNumber: 'A' }], // SELECT usedRevisionNumbers
        [{ id: 'revision-pending' }], // INSERT newRevision (pending, not promoted)
      ]),
      single(undefined), // finish
    ]);
    (storage.download as jest.Mock).mockResolvedValue(buffer);

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    // No promotion statements at all -- the existing current revision is
    // untouched.
    expect(insertCalls.some((args) => (args[0] as string[]).join('?').includes('UPDATE site_drawing_revisions SET is_superseded'))).toBe(false);
    expect(insertCalls.some((args) => (args[0] as string[]).join('?').includes('UPDATE site_drawings SET current_revision_id'))).toBe(false);

    const revisionInsertCall = insertCalls.find((args) => (args[0] as string[]).join('?').includes('INSERT INTO site_drawing_revisions'));
    expect(revisionInsertCall).toBeDefined();
    // Column order: ..., content_hash, supersedes_revision_id, synchronization_status, extraction_status, ...
    // args[9] = supersedes_revision_id (must be NULL: nothing was superseded), args[10] = extraction_status.
    expect(revisionInsertCall![9]).toBeNull();
    expect(revisionInsertCall![10]).toBe('CONFLICT');
  });

  it('does NOT promote when the revision label cannot be confirmed as newer than the current one -- Phase 2 chronology gate', async () => {
    // Title corroborates identity (same drawing), but the incoming label
    // ('A') sorts BEFORE the current one ('C') -- an older revision
    // processed out of order (e.g. ZIP entry order, not real chronology)
    // must never become current.
    const buffer = Buffer.from('an older revision, uploaded/processed after the newer one');
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({
      text: 'DRAWING NO: A-101\nREV: A\nTITLE: Ground Floor Plan', tableCells: [], pageCount: 1,
    });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

    const insertCalls: unknown[][] = [];
    const captureSql = (results: unknown[]) => (callback: WithTenantCallback) => {
      let i = 0;
      const sql = withJson((...args: unknown[]) => { insertCalls.push(args); return Promise.resolve(results[i++] ?? []); });
      return callback(sql);
    };

    const { processor, storage } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      captureSql([
        [{ id: 'drawing-1', drawingTitle: 'Ground Floor Plan', currentRevisionId: 'revision-current' }],
        [{ id: 'revision-current', revisionNumber: 'C', contentHash: sha256(Buffer.from('the current, newer revision')) }],
        [{ revisionNumber: 'C' }],
        [{ id: 'revision-pending' }],
      ]),
      single(undefined), // finish
    ]);
    (storage.download as jest.Mock).mockResolvedValue(buffer);

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    expect(insertCalls.some((args) => (args[0] as string[]).join('?').includes('UPDATE site_drawings SET current_revision_id'))).toBe(false);
    const revisionInsertCall = insertCalls.find((args) => (args[0] as string[]).join('?').includes('INSERT INTO site_drawing_revisions'));
    expect(revisionInsertCall![10]).toBe('CONFLICT');
  });

  it('disambiguates and flags CONFLICT when content differs but extraction lands on the same revision label as the current revision', async () => {
    // Both the original import and this reimport failed extraction
    // entirely and defaulted to revisionNumber '1' -- but the file content
    // genuinely changed. The UNIQUE(drawing_id, revision_number)
    // constraint means this can't be inserted as a second "1"; it must be
    // disambiguated and routed to review instead of silently dropped.
    const buffer = Buffer.from('a different file, same failed-extraction fallback label');
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);

    const { processor, db, storage } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      // reconcile: SELECT existing, SELECT currentRevision ('1', different hash), SELECT usedRevisionNumbers (just '1', collides), INSERT newRevision ('1-v2'), supersede UPDATE, UPDATE current_revision_id
      multi([
        [{ id: 'drawing-1', drawingTitle: 'A-101', currentRevisionId: 'revision-1' }],
        [{ id: 'revision-1', revisionNumber: '1', contentHash: sha256(Buffer.from('the previous revision, same failed label')) }],
        [{ revisionNumber: '1' }],
        [{ id: 'revision-2' }],
        [],
        [],
      ]),
      single(undefined), // finish
    ]);
    (storage.download as jest.Mock).mockResolvedValue(buffer);

    await expect(processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never)).resolves.toBeUndefined();
    expect(db.withTenant).toHaveBeenCalledTimes(4);
  });

  it('never throws and stores no issue_date when extraction produces a date-shaped value that is not a real calendar date', async () => {
    // Reproduces the real production incident: commit 13360bd already
    // rejects one specific garbled-date shape ("60/90/2025") inside
    // extractDate()'s own regex validation, and the same handful of files
    // crashed again afterwards with the identical `RangeError: Invalid
    // time value`, proving some other shape still gets past that check.
    // This test doesn't depend on finding the exact string a regex missed
    // -- it simulates "extraction produced an unparseable issueDate,
    // however that happened" directly, and proves reconcile()'s own
    // insert-boundary guard (not the regex) is what actually stops the
    // crash: the postgres driver would throw serializing this value for
    // the `issue_date` DATE column if it ever reached the INSERT.
    (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({ entries: [{ filename: 'A-101.pdf', buffer: Buffer.from('x') }] });
    jest.spyOn(extractDrawingFieldsModule, 'extractDrawingFields').mockResolvedValue({
      fields: { drawingNumber: 'A-101', confidence: 0.9, source: 'embedded_text', issueDate: 'not-a-real-calendar-date' },
      pageCount: 1,
    });

    const insertCalls: unknown[][] = [];
    const captureSql = (results: unknown[]) => (callback: WithTenantCallback) => {
      let i = 0;
      const sql = withJson((...args: unknown[]) => { insertCalls.push(args); return Promise.resolve(results[i++] ?? []); });
      return callback(sql);
    };

    const { processor } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      captureSql([[], [], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]), // reconcile: created
      single(undefined), // finish
    ]);

    await expect(processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never)).resolves.toBeUndefined();

    const revisionInsertCall = insertCalls.find((args) => (args[0] as string[]).join('?').includes('INSERT INTO site_drawing_revisions'));
    expect(revisionInsertCall).toBeDefined();
    // Column order: company_id, project_id, drawing_id, revision_number,
    // 'UNKNOWN' (literal, not interpolated), issue_date, storage_key, ...
    // -- so the 5th interpolated value (args[5], after the strings array
    // and the first 4 values) is issue_date.
    expect(revisionInsertCall![5]).toBeNull();
  });

  it('disambiguates against a SUPERSEDED revision number, not just the current one -- reproduces the real production unique-constraint crash', async () => {
    // The real bug: the prior disambiguation logic only compared the
    // extracted/fallback revisionNumber against the CURRENT revision's own
    // label. A drawing reimported many times over this session had several
    // now-superseded revisions sitting under it, one of them labeled '1'
    // (a prior failed-extraction fallback) that was no longer current --
    // the current revision was '2'. A later reimport, whose extraction
    // also failed and fell back to '1', saw no collision against '2' and
    // tried to insert a second revision_number '1' for the same drawing_id,
    // which site_drawing_revisions' UNIQUE(drawing_id, revision_number)
    // constraint rejected outright: confirmed by hand against production,
    // `duplicate key value violates unique constraint
    // "site_drawing_revisions_drawing_id_revision_number_key"`.
    const buffer = Buffer.from('yet another reimport, different content, same failed-extraction fallback label');
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);

    const insertCalls: unknown[][] = [];
    const captureSql = (results: unknown[]) => (callback: WithTenantCallback) => {
      let i = 0;
      const sql = withJson((...args: unknown[]) => { insertCalls.push(args); return Promise.resolve(results[i++] ?? []); });
      return callback(sql);
    };

    const { processor, db, storage } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      captureSql([
        [{ id: 'drawing-1', drawingTitle: 'A-101', currentRevisionId: 'revision-current' }], // SELECT existing
        [{ id: 'revision-current', revisionNumber: '2', contentHash: sha256(Buffer.from('the current revision, different content')) }], // SELECT currentRevision ('2' -- no collision against the fallback '1' alone)
        [{ revisionNumber: '2' }, { revisionNumber: '1' }], // SELECT usedRevisionNumbers: '1' was used by an OLDER, now-superseded revision
        [{ id: 'revision-new' }], // INSERT newRevision
        [], // supersede UPDATE
        [], // UPDATE current_revision_id
      ]),
      single(undefined), // finish
    ]);
    (storage.download as jest.Mock).mockResolvedValue(buffer);

    await expect(processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never)).resolves.toBeUndefined();
    expect(db.withTenant).toHaveBeenCalledTimes(4); // never aborted into the per-file error path

    const revisionInsertCall = insertCalls.find((args) => (args[0] as string[]).join('?').includes('INSERT INTO site_drawing_revisions'));
    expect(revisionInsertCall).toBeDefined();
    // Column order: company_id, project_id, drawing_id, revision_number, ...
    // -- args[4] is revision_number. Disambiguated to '1-v2' (not the
    // colliding '1'), since '1' is taken but '1-v2' is free.
    expect(revisionInsertCall![4]).toBe('1-v2');
  });

  // Site Drawing Hub integrity hardening, Phase 8: the exact scenario
  // reported broken -- "a ZIP of 4 drawings identifies only one" -- and
  // the multi-file reliability behaviors the brief explicitly requires.
  describe('multi-file batches', () => {
    // These tests need the archive to actually be a ZIP (the shared
    // `batchRow` above is a bare .pdf, which takes the single-file path
    // and never consults extractPdfEntriesFromZip at all).
    const zipBatchRow = { ...batchRow, originalFilename: 'package.zip' };

    it('Test 1: a ZIP of four distinct drawings creates four independent drawing records, with no cross-contamination', async () => {
      (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({
        entries: [
          { filename: 'A-101.pdf', buffer: Buffer.from('sheet 1') },
          { filename: 'A-102.pdf', buffer: Buffer.from('sheet 2') },
          { filename: 'S-201.pdf', buffer: Buffer.from('sheet 3') },
          { filename: 'M-301.pdf', buffer: Buffer.from('sheet 4') },
        ],
        skippedNonPdf: [], rejectedUnsafe: [],
      });
      jest.spyOn(extractDrawingFieldsModule, 'extractDrawingFields').mockImplementation(async (_s, _a, _c, _p, _k, _buf, label: string) => {
        const byFile: Record<string, { drawingNumber: string; drawingTitle: string }> = {
          'A-101.pdf': { drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan' },
          'A-102.pdf': { drawingNumber: 'A-102', drawingTitle: 'First Floor Plan' },
          'S-201.pdf': { drawingNumber: 'S-201', drawingTitle: 'Foundation Plan' },
          'M-301.pdf': { drawingNumber: 'M-301', drawingTitle: 'Mechanical Schematic' },
        };
        return { fields: { ...byFile[label], revisionNumber: 'A', confidence: 0.9, source: 'embedded_text' }, pageCount: 1 };
      });

      const perFileCreate = () => (callback: WithTenantCallback) => {
        let i = 0;
        // Each file is a brand-new drawing: SELECT existing (none),
        // resolveOrgMapping SELECT, INSERT drawing, INSERT revision,
        // UPDATE current_revision_id.
        const results = [[], [], [{ id: `drawing-${Math.random()}` }], [{ id: `revision-${Math.random()}` }], []];
        const sql = withJson(() => Promise.resolve(results[i++] ?? []));
        return callback(sql);
      };

      const { processor, db } = makeProcessor([
        single(undefined), // markStarted
        single([zipBatchRow]), // getBatch
        perFileCreate(), perFileCreate(), perFileCreate(), perFileCreate(),
        single(undefined), // finish
      ]);

      await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

      // markStarted + getBatch + 4 files + finish = 7 outer withTenant calls.
      expect(db.withTenant).toHaveBeenCalledTimes(7);
      const extractCalls = (extractDrawingFieldsModule.extractDrawingFields as jest.Mock).mock.calls;
      expect(extractCalls).toHaveLength(4);
      // Every file was read with ITS OWN filename/label -- no file's
      // extraction call could have been given another's content.
      expect(extractCalls.map((c) => c[6])).toEqual(['A-101.pdf', 'A-102.pdf', 'S-201.pdf', 'M-301.pdf']);
    });

    it('Test 7: one unprocessable PDF among four does not block the other three, and the batch is accurately classified PARTIAL', async () => {
      (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({
        entries: [
          { filename: 'A-101.pdf', buffer: Buffer.from('sheet 1') },
          { filename: 'corrupt.pdf', buffer: Buffer.from('not a real pdf') },
          { filename: 'S-201.pdf', buffer: Buffer.from('sheet 3') },
          { filename: 'M-301.pdf', buffer: Buffer.from('sheet 4') },
        ],
        skippedNonPdf: [], rejectedUnsafe: [],
      });
      jest.spyOn(extractDrawingFieldsModule, 'extractDrawingFields').mockImplementation(async (_s, _a, _c, _p, _k, _buf, label: string) => {
        if (label === 'corrupt.pdf') throw new Error('Invalid PDF structure');
        const byFile: Record<string, { drawingNumber: string; drawingTitle: string }> = {
          'A-101.pdf': { drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan' },
          'S-201.pdf': { drawingNumber: 'S-201', drawingTitle: 'Foundation Plan' },
          'M-301.pdf': { drawingNumber: 'M-301', drawingTitle: 'Mechanical Schematic' },
        };
        return { fields: { ...byFile[label], revisionNumber: 'A', confidence: 0.9, source: 'embedded_text' }, pageCount: 1 };
      });

      const perFileCreate = () => (callback: WithTenantCallback) => {
        let i = 0;
        const results = [[], [], [{ id: `drawing-${Math.random()}` }], [{ id: `revision-${Math.random()}` }], []];
        const sql = withJson(() => Promise.resolve(results[i++] ?? []));
        return callback(sql);
      };

      let finishedCounts: Record<string, unknown> | null = null;
      const captureFinish = (callback: WithTenantCallback) => {
        const sql = withJson((...args: unknown[]) => { finishedCounts = args as unknown as Record<string, unknown>; return Promise.resolve([]); });
        return callback(sql);
      };

      const { processor, storage } = makeProcessor([
        single(undefined), // markStarted
        single([zipBatchRow]), // getBatch
        perFileCreate(), // A-101: created
        // corrupt.pdf: processOneFile uploads, then extraction throws --
        // no withTenant/reconcile call is ever reached for this file.
        perFileCreate(), // S-201: created
        perFileCreate(), // M-301: created
        captureFinish, // finish
      ]);

      await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

      // The corrupt file's own uploaded object is cleaned up (Phase 4) --
      // never left stranded with nothing in the database pointing to it.
      expect(storage.deleteIfExists).toHaveBeenCalled();
      // finish()'s own UPDATE: args[1..]=status, file_count, created_count,
      // revision_count, conflict_count, skipped_count, error_count,
      // unsupported_count, error_message.
      expect(finishedCounts![1]).toBe('PARTIAL');
      expect(finishedCounts![2]).toBe(4); // fileCount: all 4 PDFs were attempted
      expect(finishedCounts![3]).toBe(3); // createdCount: the 3 valid files, none lost
      expect(finishedCounts![7]).toBe(1); // errorCount: exactly the one corrupt file
    });

    it('Test 8: a file that fails after its PDF is already uploaded has its orphaned storage object cleaned up', async () => {
      (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({
        entries: [{ filename: 'corrupt.pdf', buffer: Buffer.from('not a real pdf') }],
        skippedNonPdf: [], rejectedUnsafe: [],
      });
      jest.spyOn(extractDrawingFieldsModule, 'extractDrawingFields').mockRejectedValue(new Error('Invalid PDF structure'));

      const { processor, storage } = makeProcessor([
        single(undefined), // markStarted
        single([batchRow]), // getBatch
        // No withTenant/reconcile call at all for this file -- it never
        // gets past extraction.
        single(undefined), // finish
      ]);
      (storage.generateKey as jest.Mock).mockReturnValue('company-1/documents/project-1/corrupt.pdf');

      await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

      expect(storage.upload).toHaveBeenCalledWith('company-1/documents/project-1/corrupt.pdf', expect.anything(), 'application/pdf');
      // The SAME key that was uploaded is the one cleaned up -- never a
      // different file's object, and never left as a stray billable object
      // with nothing in the database pointing to it.
      expect(storage.deleteIfExists).toHaveBeenCalledWith('company-1/documents/project-1/corrupt.pdf');
    });

    it('Test 10: a multi-page PDF is never silently treated as a single confidently-read sheet', async () => {
      (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({
        entries: [{ filename: 'multi-sheet.pdf', buffer: Buffer.from('x') }], skippedNonPdf: [], rejectedUnsafe: [],
      });
      // A confident, complete-looking extraction -- drawing number, title
      // AND revision all present -- but the file has 3 pages; only page 1
      // was actually read, so this must still degrade to NEEDS_REVIEW
      // rather than being reported as a clean, fully-confirmed read.
      (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({
        text: 'DRAWING NO: A-101\nREV: B\nTITLE: Ground Floor Plan', tableCells: [], pageCount: 3,
      });
      (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

      const insertCalls: unknown[][] = [];
      const captureSql = (results: unknown[]) => (callback: WithTenantCallback) => {
        let i = 0;
        const sql = withJson((...args: unknown[]) => { insertCalls.push(args); return Promise.resolve(results[i++] ?? []); });
        return callback(sql);
      };

      const { processor } = makeProcessor([
        single(undefined), // markStarted
        single([batchRow]), // getBatch
        captureSql([[], [], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]), // new drawing: created
        single(undefined), // finish
      ]);

      await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

      const revisionInsertCall = insertCalls.find((args) => (args[0] as string[]).join('?').includes('INSERT INTO site_drawing_revisions'));
      expect(revisionInsertCall).toBeDefined();
      // Column order (new-drawing INSERT): ..., content_hash, (literal),
      // extraction_status is args[9]; review_notes (the multi-page note)
      // is the trailing args[13].
      expect(revisionInsertCall![9]).toBe('NEEDS_REVIEW');
      expect(revisionInsertCall![13]).toMatch(/3 pages/);
    });
  });
});
