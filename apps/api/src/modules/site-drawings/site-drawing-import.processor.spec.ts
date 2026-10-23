import { SiteDrawingImportProcessor } from './site-drawing-import.processor';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import * as pdfTextExtractor from './extraction/pdf-text-extractor';
import * as zipExtraction from './extraction/zip-extraction.util';

jest.mock('./extraction/pdf-text-extractor');
jest.mock('./extraction/zip-extraction.util');

type WithTenantCallback = (sql: unknown) => unknown;

// sql.json() is the postgres.js helper the processor uses to bind
// extracted_fields_raw as a real jsonb parameter (see
// site-drawing-import.processor.ts's own comment on why) -- the mock
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
  return { processor: new SiteDrawingImportProcessor(db, storage, aiClient), db, storage, aiClient, withTenant };
}

const batchRow = { id: batchId, storageKey: 'batch-key.pdf', originalFilename: 'A-101.pdf', sourceSystem: 'manual_link' as const, uploadedBy: 'user-1' };

describe('SiteDrawingImportProcessor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips OCR entirely when the embedded text layer is already usable', async () => {
    (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({ entries: [{ filename: 'A-101.pdf', buffer: Buffer.from('x') }] });
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: 'DRAWING NO: A-101\nREV: B', pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);

    const { processor, aiClient, withTenant } = makeProcessor([
      single(undefined), // markStarted
      single([batchRow]), // getBatch
      // reconcile() is ONE withTenant call with 4 sequential statements:
      // SELECT existing (none), INSERT drawing, INSERT revision, UPDATE current_revision_id
      multi([[], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]),
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
      multi([[], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]), // reconcile: SELECT existing (none), INSERT drawing, INSERT revision, UPDATE
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
      // reconcile: SELECT existing (none), INSERT drawing, INSERT revision, UPDATE --
      // falls back to the filename-derived drawing number since fields stays null.
      multi([[], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]),
      single(undefined), // finish
    ]);
    (aiClient.ocrExtractText as jest.Mock).mockRejectedValue(new Error('ai-service down'));

    await expect(processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never)).resolves.toBeUndefined();
    expect(db.withTenant).toHaveBeenCalledTimes(4); // the batch still completes (COMPLETED/PARTIAL), never aborted by the OCR failure
  });
});
