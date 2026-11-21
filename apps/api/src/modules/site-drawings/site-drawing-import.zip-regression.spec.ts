import type { ExtractedDrawingFields } from '@engineeringos/types';
import { SiteDrawingImportProcessor } from './site-drawing-import.processor';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { AiClientService, DrawingExtractionResult } from '../ai-client/ai-client.service';
import type { SiteDrawingsService } from './site-drawings.service';
import * as zipExtraction from './extraction/zip-extraction.util';

jest.mock('./extraction/zip-extraction.util');

/**
 * Hybrid Drawing Intelligence Engine replacement -- the acceptance
 * criterion called out as "particularly important": a ZIP containing
 * several DIFFERENT drawings must result in that many INDEPENDENTLY and
 * CORRECTLY identified drawing records, with no cross-contamination
 * between them.
 *
 * Unlike the other multi-file tests in site-drawing-import.processor.spec.ts
 * (which mock extractDrawingFieldsModule.extractDrawingFields directly,
 * bypassing its own region-trying/verification logic entirely), this
 * file mocks ONLY the AI-service boundary (AiClientService.
 * extractDrawingStructure) and lets the REAL extractDrawingFields(),
 * title-block-extractor.ts, text-run-structure.ts and verification.ts
 * run unmocked for every file -- the actual code path a real ZIP upload
 * exercises end to end, Node-side.
 *
 * No real customer drawings were available to build this from; the four
 * per-file AI-service responses below are realistic synthetic data built
 * to reproduce the SPECIFIC documented real failure patterns this
 * engagement has already found (a revision-history table that must not
 * be confused with the title block; a scanned/OCR-sourced page; a
 * missing revision filled from a file's OWN revision-history table, not
 * another file's) rather than generic happy-path fixtures.
 * apps/ai-service's own tests/test_drawing_vision.py separately
 * validates the real OpenCV/pypdfium2/pytesseract pipeline that would
 * actually produce data shaped like this, against real PDF files.
 */
describe('ZIP multi-drawing regression: four distinct drawings, independently and correctly identified', () => {
  type WithTenantCallback = (sql: unknown) => unknown;

  function withJson(sql: (...args: unknown[]) => Promise<unknown>) {
    (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
    return sql;
  }
  function single(result: unknown) {
    return (callback: WithTenantCallback) => callback(withJson(() => Promise.resolve(result)));
  }

  const companyId = 'company-1';
  const projectId = 'project-1';
  const batchId = 'batch-1';
  const zipBatchRow = {
    id: batchId, storageKey: 'batch-key.zip', originalFilename: 'four-drawings.zip',
    sourceSystem: 'manual_link' as const, uploadedBy: 'user-1',
  };

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
      generateKey: jest.fn().mockImplementation((_c: string, _p: string, _kind: string, filename: string) => `company-1/documents/project-1/${filename}`),
      getReadUrl: jest.fn().mockImplementation((storageKey: string) => Promise.resolve(`https://signed.example/${storageKey}`)),
      deleteIfExists: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;
    const extractDrawingStructure = jest.fn();
    const aiClient = { extractDrawingStructure } as unknown as AiClientService;
    const siteDrawings = { notifyProjectMembers: jest.fn().mockResolvedValue(undefined) } as unknown as SiteDrawingsService;
    return { processor: new SiteDrawingImportProcessor(db, storage, aiClient, siteDrawings), db, storage, aiClient, extractDrawingStructure };
  }

  function region(runs: DrawingExtractionResult['regions'][number]['runs']): DrawingExtractionResult['regions'][number] {
    return { left: 0, top: 0, width: 500, height: 300, runs };
  }

  it('processes four drawings from one ZIP independently, each with its own correctly-identified number/title/revision, and no field from one leaking into another', async () => {
    (zipExtraction.extractPdfEntriesFromZip as jest.Mock).mockResolvedValue({
      entries: [
        { filename: 'A-101.pdf', buffer: Buffer.from('sheet 1: native text, clean title block') },
        { filename: 'S-201.pdf', buffer: Buffer.from('sheet 2: native text, title block PLUS a separate revision-history table') },
        { filename: 'M-301.pdf', buffer: Buffer.from('sheet 3: scanned, OCR-sourced title block only') },
        { filename: 'E-401.pdf', buffer: Buffer.from('sheet 4: native text, no revision in the title block, filled from its own revision-history table') },
      ],
      skippedNonPdf: [], rejectedUnsafe: [],
    });

    // Each file is a brand-new drawing: SELECT existing (none), INSERT
    // drawing, INSERT revision (captured below, per file), UPDATE
    // current_revision_id. insertCallsByFile[i] collects every bound-args
    // array for file i's own reconcile() call, in order.
    const insertCallsByFile: unknown[][][] = [[], [], [], []];
    const perFileCapture = (fileIndex: number, idResults: unknown[]) => (callback: WithTenantCallback) => {
      let i = 0;
      const sql = withJson((...args: unknown[]) => {
        insertCallsByFile[fileIndex].push(args);
        return Promise.resolve(idResults[i++] ?? []);
      });
      return callback(sql);
    };

    const { processor, db, extractDrawingStructure } = makeProcessor([
      single(undefined), // markStarted
      single([zipBatchRow]), // getBatch
      perFileCapture(0, [[], [], [{ id: 'drawing-A-101' }], [{ id: 'revision-A-101' }], []]),
      perFileCapture(1, [[], [], [{ id: 'drawing-S-201' }], [{ id: 'revision-S-201' }], []]),
      perFileCapture(2, [[], [], [{ id: 'drawing-M-301' }], [{ id: 'revision-M-301' }], []]),
      perFileCapture(3, [[], [], [{ id: 'drawing-E-401' }], [{ id: 'revision-E-401' }], []]),
      single(undefined), // finish
    ]);

    // One realistic, DIFFERENT AI-service response per file, in the
    // exact order the ZIP's entries are processed.
    const perFileResponses: DrawingExtractionResult[] = [
      // A-101: a clean single-region title block.
      {
        pageCount: 1, pageWidth: 2000, pageHeight: 1500, pageRotationDegrees: 0,
        regions: [region([
          { text: 'Drawing No: A-101', left: 10, top: 10, width: 150, height: 20, conf: 100, method: 'native' },
          { text: 'Rev: B', left: 10, top: 40, width: 60, height: 20, conf: 100, method: 'native' },
          { text: 'Title: Ground Floor Plan', left: 10, top: 70, width: 220, height: 20, conf: 100, method: 'native' },
        ])],
        wholePageNativeText: '', wholePageOcrText: null, wholePageOcrConfidence: null,
      },
      // S-201: a title block AND a separate revision-history table --
      // the real documented false-match pattern. Must not contaminate
      // S-201's own revision ('C' from the title block, not '00' from
      // the history table's own data row).
      {
        pageCount: 1, pageWidth: 2000, pageHeight: 1500, pageRotationDegrees: 0,
        regions: [
          region([
            { text: 'Rev.', left: 10, top: 10, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'Date', left: 70, top: 10, width: 30, height: 15, conf: 95, method: 'native' },
            { text: '00', left: 10, top: 30, width: 20, height: 15, conf: 95, method: 'native' },
            { text: '01-01-2026', left: 70, top: 30, width: 70, height: 15, conf: 95, method: 'native' },
          ]),
          region([
            { text: 'Drawing No: S-201', left: 10, top: 110, width: 150, height: 20, conf: 100, method: 'native' },
            { text: 'Rev: C', left: 10, top: 140, width: 60, height: 20, conf: 100, method: 'native' },
            { text: 'Title: Foundation Plan', left: 10, top: 170, width: 220, height: 20, conf: 100, method: 'native' },
          ]),
        ],
        wholePageNativeText: '', wholePageOcrText: null, wholePageOcrConfidence: null,
      },
      // M-301: scanned -- no native text at all, title block recovered
      // only via targeted OCR on its own region.
      {
        pageCount: 1, pageWidth: 2000, pageHeight: 1500, pageRotationDegrees: 0,
        regions: [region([
          { text: 'Drawing', left: 10, top: 10, width: 70, height: 20, conf: 92, method: 'ocr' },
          { text: 'No:', left: 85, top: 11, width: 30, height: 20, conf: 90, method: 'ocr' },
          { text: 'M-301', left: 120, top: 10, width: 60, height: 20, conf: 88, method: 'ocr' },
          { text: 'Rev:', left: 10, top: 40, width: 35, height: 20, conf: 93, method: 'ocr' },
          { text: 'A', left: 50, top: 40, width: 15, height: 20, conf: 93, method: 'ocr' },
        ])],
        wholePageNativeText: '', wholePageOcrText: null, wholePageOcrConfidence: null,
      },
      // E-401: title block has NO revision at all; its own, separate
      // revision-history table supplies it as supplementary (UNVERIFIED)
      // evidence -- must be scoped to THIS file's own table, never
      // picking up S-201's or any other file's data.
      {
        pageCount: 1, pageWidth: 2000, pageHeight: 1500, pageRotationDegrees: 0,
        regions: [
          region([{ text: 'Drawing No: E-401', left: 10, top: 10, width: 150, height: 20, conf: 100, method: 'native' }]),
          region([
            { text: 'Rev.', left: 10, top: 210, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'Date', left: 70, top: 210, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'D', left: 10, top: 230, width: 20, height: 15, conf: 95, method: 'native' },
            { text: '15-04-2026', left: 70, top: 230, width: 70, height: 15, conf: 95, method: 'native' },
          ]),
        ],
        wholePageNativeText: '', wholePageOcrText: null, wholePageOcrConfidence: null,
      },
    ];
    let callIndex = 0;
    extractDrawingStructure.mockImplementation(() => Promise.resolve(perFileResponses[callIndex++]));

    await processor.handleImportBatch({ data: { batchId, companyId, projectId } } as never);

    // All four files were independently processed -- markStarted + getBatch + 4 files + finish.
    expect(db.withTenant).toHaveBeenCalledTimes(7);
    expect(extractDrawingStructure).toHaveBeenCalledTimes(4);
    expect(extractDrawingStructure.mock.calls.map((c) => c[2])).toEqual([
      'https://signed.example/company-1/documents/project-1/A-101.pdf',
      'https://signed.example/company-1/documents/project-1/S-201.pdf',
      'https://signed.example/company-1/documents/project-1/M-301.pdf',
      'https://signed.example/company-1/documents/project-1/E-401.pdf',
    ]);

    // For a brand-new drawing, reconcile()'s own INSERT INTO
    // site_drawing_revisions column order places revision_number at
    // args[4] and extracted_fields_raw (the full ExtractedDrawingFields,
    // bound via sql.json()) at args[10] -- the same layout already
    // established and exercised by the UNVERIFIED-fallback tests in
    // site-drawing-import.processor.spec.ts.
    function rawFieldsFor(fileIndex: number): ExtractedDrawingFields {
      const insertCall = insertCallsByFile[fileIndex].find((args) => (args[0] as string[]).join('?').includes('INSERT INTO site_drawing_revisions'));
      expect(insertCall).toBeDefined();
      return insertCall![10] as ExtractedDrawingFields;
    }

    const aFields = rawFieldsFor(0);
    expect(aFields.drawingNumber).toBe('A-101');
    expect(aFields.revisionNumber).toBe('B');
    expect(aFields.drawingTitle).toBe('Ground Floor Plan');

    const sFields = rawFieldsFor(1);
    expect(sFields.drawingNumber).toBe('S-201');
    expect(sFields.revisionNumber).toBe('C'); // from its OWN title block, never '00' from its revision-history table
    expect(sFields.drawingTitle).toBe('Foundation Plan');
    expect(sFields.fieldStates?.revisionNumber).toBe('VERIFIED'); // a real title-block match, not a supplementary fallback

    const mFields = rawFieldsFor(2);
    expect(mFields.drawingNumber).toBe('M-301');
    expect(mFields.revisionNumber).toBe('A');
    expect(mFields.source).toBe('ocr');

    const eFields = rawFieldsFor(3);
    expect(eFields.drawingNumber).toBe('E-401');
    expect(eFields.revisionNumber).toBe('D'); // filled from ITS OWN revision-history table, not S-201's ('C') or any other file's
    expect(eFields.fieldEvidence?.revisionNumber?.method).toBe('revision_table');
    expect(eFields.fieldStates?.revisionNumber).toBe('UNVERIFIED'); // a supplementary fill is never VERIFIED

    // The real point of this whole test: every revision number is
    // distinct and traceable to its OWN file -- nothing bled across.
    expect([aFields.revisionNumber, sFields.revisionNumber, mFields.revisionNumber, eFields.revisionNumber]).toEqual(['B', 'C', 'A', 'D']);
    expect([aFields.drawingNumber, sFields.drawingNumber, mFields.drawingNumber, eFields.drawingNumber]).toEqual(['A-101', 'S-201', 'M-301', 'E-401']);
  });
});
