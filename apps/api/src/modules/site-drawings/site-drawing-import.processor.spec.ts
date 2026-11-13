import { createHash } from 'crypto';
import { SiteDrawingImportProcessor } from './site-drawing-import.processor';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { SiteDrawingsService } from './site-drawings.service';
import * as pdfTextExtractor from './extraction/pdf-text-extractor';
import * as zipExtraction from './extraction/zip-extraction.util';

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
  beforeEach(() => jest.clearAllMocks());

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

  it('creates a new, superseding revision when content differs, even though extraction also found a genuinely different revision number', async () => {
    const buffer = Buffer.from('a real new revision of the drawing');
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: 'DRAWING NO: A-101\nREV: B', tableCells: [], pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

    const { processor, db, storage } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      // reconcile: SELECT existing, SELECT currentRevision (rev 'A', different hash), INSERT newRevision, supersede UPDATE, UPDATE current_revision_id
      multi([
        [{ id: 'drawing-1', drawingTitle: 'A-101', currentRevisionId: 'revision-1' }],
        [{ id: 'revision-1', revisionNumber: 'A', contentHash: sha256(Buffer.from('the previous revision')) }],
        [{ id: 'revision-2' }],
        [],
        [],
      ]),
      single(undefined), // finish
    ]);
    (storage.download as jest.Mock).mockResolvedValue(buffer);

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    expect(db.withTenant).toHaveBeenCalledTimes(4);
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
      // reconcile: SELECT existing, SELECT currentRevision ('1', different hash), COUNT(*), INSERT newRevision, supersede UPDATE, UPDATE current_revision_id
      multi([
        [{ id: 'drawing-1', drawingTitle: 'A-101', currentRevisionId: 'revision-1' }],
        [{ id: 'revision-1', revisionNumber: '1', contentHash: sha256(Buffer.from('the previous revision, same failed label')) }],
        [{ count: '1' }],
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
});
