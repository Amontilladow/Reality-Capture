import type { StorageService } from '../../storage/storage.service';
import type { AiClientService, DrawingExtractionResult } from '../../ai-client/ai-client.service';
import { extractDrawingFields } from './extract-drawing-fields';

// Covers the wiring extractDrawingFields itself owns (Drawing
// Identification Engine replacement): trying every candidate title-
// block region in order, falling back to whole-page matching only when
// none works, filling a missing revision from a supplementary
// revision-history region without ever overriding a real title-block
// value, and attaching per-field verification states. Not
// title-block-extractor.ts's own regex/matching engine (its own spec
// already covers that exhaustively) or apps/ai-service's real OpenCV/
// pytesseract pipeline (covered by apps/ai-service/tests/
// test_drawing_vision.py against real PDF fixtures).
describe('extractDrawingFields', () => {
  function makeDeps(result: Partial<DrawingExtractionResult> = {}) {
    const storage = { getReadUrl: jest.fn().mockResolvedValue('https://signed.example/abc.pdf') } as unknown as StorageService;
    const fullResult: DrawingExtractionResult = {
      pageCount: 1, pageWidth: 2000, pageHeight: 1500, pageRotationDegrees: 0,
      regions: [], wholePageNativeText: '', wholePageOcrText: null, wholePageOcrConfidence: null,
      ...result,
    };
    const aiClient = { extractDrawingStructure: jest.fn().mockResolvedValue(fullResult) } as unknown as AiClientService;
    return { storage, aiClient };
  }

  afterEach(() => jest.clearAllMocks());

  it('extracts from the first title-block-shaped region that yields a plausible drawing number', async () => {
    const { storage, aiClient } = makeDeps({
      regions: [{
        left: 0, top: 0, width: 100, height: 100,
        runs: [
          { text: 'Drawing No: S-101', left: 10, top: 10, width: 150, height: 20, conf: 100, method: 'native' },
          { text: 'Rev: C', left: 10, top: 40, width: 60, height: 20, conf: 100, method: 'native' },
          { text: 'Title: GROUND FLOOR PLAN', left: 10, top: 70, width: 200, height: 20, conf: 100, method: 'native' },
        ],
      }],
    });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'S-101.pdf');

    expect(result.fields?.drawingNumber).toBe('S-101');
    expect(result.fields?.revisionNumber).toBe('C');
    expect(result.fields?.source).toBe('embedded_text');
    expect(result.fields?.fieldStates?.drawingNumber).toBe('VERIFIED');
    expect(result.pageCount).toBe(1);
    expect(aiClient.extractDrawingStructure).toHaveBeenCalledWith('company-1', 'project-1', 'https://signed.example/abc.pdf', 1);
  });

  it('prefers the highest-confidence region over the first non-null one -- the real "OCR\'d hardware schedule" case', async () => {
    // Reproduces a real production failure, user-reported: a door-
    // hardware/ironmongery schedule table (not the title block at all)
    // got grid-detected as a candidate region, had no native text of its
    // own, and once OCR'd, a stray token ("HS-05(EML)") happened to match
    // the bare, unlabeled drawing-number shape -- a non-null but
    // near-worthless candidate (confidence ~0: no plausible title or
    // revision alongside it). Ranked BEFORE the real title block region
    // in this scenario. Stopping at the first non-null candidate used to
    // report "HS-05" with no title, instead of the real, fully-confident
    // title-block match found in the next region.
    const { storage, aiClient } = makeDeps({
      regions: [
        {
          left: 0, top: 0, width: 300, height: 200,
          runs: [
            { text: 'HS-05(EML)', left: 10, top: 10, width: 100, height: 20, conf: 60, method: 'ocr' },
            { text: 'Hinges, EuroArt', left: 10, top: 40, width: 150, height: 20, conf: 55, method: 'ocr' },
          ],
        },
        {
          left: 0, top: 250, width: 200, height: 150,
          runs: [
            { text: 'Drawing No: M19-M4C-C0-PW-AX-SD-05730', left: 10, top: 260, width: 220, height: 20, conf: 100, method: 'native' },
            { text: 'Revision: 00', left: 10, top: 290, width: 100, height: 20, conf: 100, method: 'native' },
            { text: 'Drawing Title: BS 90 Min Fire Rated Single Leaf Steel Door', left: 10, top: 320, width: 300, height: 20, conf: 100, method: 'native' },
          ],
        },
      ],
    });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'SD-05730.pdf');

    expect(result.fields?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05730');
    expect(result.fields?.revisionNumber).toBe('00');
    expect(result.fields?.drawingTitle).toBe('BS 90 Min Fire Rated Single Leaf Steel Door');
    expect(result.fields?.source).toBe('embedded_text');
  });

  it('skips a region with no plausible drawing number and tries the next one -- the real "revision-history table found before the title block" case', async () => {
    const { storage, aiClient } = makeDeps({
      regions: [
        {
          // A separate revision-history mini-table, ranked FIRST (closer
          // to a page edge than the real title block, in this scenario) --
          // must not be mistaken for the title block itself.
          left: 0, top: 0, width: 100, height: 50,
          runs: [
            { text: 'Rev.', left: 10, top: 10, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'Date', left: 50, top: 10, width: 30, height: 15, conf: 95, method: 'native' },
            { text: '00', left: 10, top: 30, width: 20, height: 15, conf: 95, method: 'native' },
            { text: '13-02-2026', left: 50, top: 30, width: 70, height: 15, conf: 95, method: 'native' },
          ],
        },
        {
          left: 0, top: 100, width: 150, height: 100,
          runs: [
            { text: 'Drawing No: S-101', left: 10, top: 110, width: 150, height: 20, conf: 100, method: 'native' },
            { text: 'Rev: C', left: 10, top: 140, width: 60, height: 20, conf: 100, method: 'native' },
          ],
        },
      ],
    });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'S-101.pdf');

    expect(result.fields?.drawingNumber).toBe('S-101');
    expect(result.fields?.revisionNumber).toBe('C');
  });

  it('fills a MISSING revision from a genuine revision-history table in another region, as UNVERIFIED supplementary evidence -- never VERIFIED', async () => {
    const { storage, aiClient } = makeDeps({
      regions: [
        {
          left: 0, top: 0, width: 150, height: 100,
          runs: [
            { text: 'Drawing No: S-101', left: 10, top: 10, width: 150, height: 20, conf: 100, method: 'native' },
            // No "Rev:" field in the title block itself this time.
          ],
        },
        {
          left: 0, top: 200, width: 100, height: 50,
          runs: [
            { text: 'Rev.', left: 10, top: 210, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'Date', left: 70, top: 210, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'C', left: 10, top: 230, width: 20, height: 15, conf: 95, method: 'native' },
            { text: '20-03-2026', left: 70, top: 230, width: 70, height: 15, conf: 95, method: 'native' },
          ],
        },
      ],
    });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'S-101.pdf');

    expect(result.fields?.drawingNumber).toBe('S-101');
    expect(result.fields?.revisionNumber).toBe('C');
    expect(result.fields?.fieldEvidence?.revisionNumber?.method).toBe('revision_table');
    expect(result.fields?.fieldStates?.revisionNumber).toBe('UNVERIFIED');
    // The title block's own drawing number is still confidently VERIFIED.
    expect(result.fields?.fieldStates?.drawingNumber).toBe('VERIFIED');
  });

  it('never overrides a title block\'s own revision with a supplementary hint, even when one is present', async () => {
    const { storage, aiClient } = makeDeps({
      regions: [
        {
          left: 0, top: 0, width: 150, height: 100,
          runs: [
            { text: 'Drawing No: S-101', left: 10, top: 10, width: 150, height: 20, conf: 100, method: 'native' },
            { text: 'Rev: B', left: 10, top: 40, width: 60, height: 20, conf: 100, method: 'native' },
          ],
        },
        {
          left: 0, top: 200, width: 100, height: 50,
          runs: [
            { text: 'Rev.', left: 10, top: 210, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'Date', left: 70, top: 210, width: 30, height: 15, conf: 95, method: 'native' },
            { text: 'Z', left: 10, top: 230, width: 20, height: 15, conf: 95, method: 'native' },
            { text: '20-03-2026', left: 70, top: 230, width: 70, height: 15, conf: 95, method: 'native' },
          ],
        },
      ],
    });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'S-101.pdf');

    expect(result.fields?.revisionNumber).toBe('B'); // untouched by the 'Z' hint
  });

  it('falls back to whole-page native text matching when no region yields a plausible drawing number', async () => {
    const { storage, aiClient } = makeDeps({
      regions: [{
        left: 0, top: 0, width: 50, height: 50,
        runs: [{ text: 'Checked By: J. Smith', left: 10, top: 10, width: 100, height: 15, conf: 95, method: 'native' }],
      }],
      wholePageNativeText: 'DRAWING NO: M-301\nREV: A\nTITLE: ROOF PLAN',
    });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'M-301.pdf');

    expect(result.fields?.drawingNumber).toBe('M-301');
    expect(result.fields?.source).toBe('embedded_text');
    // A whole-page match is never VERIFIED, however confident the pattern match -- see verification.ts.
    expect(result.fields?.fieldStates?.drawingNumber).toBe('UNVERIFIED');
  });

  it('falls back to the AI service\'s whole-page OCR text only as the deepest last resort', async () => {
    const { storage, aiClient } = makeDeps({
      regions: [],
      wholePageNativeText: '',
      wholePageOcrText: 'DRAWING NO: M-301\nREV: A',
      wholePageOcrConfidence: 0.6,
    });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'M-301.pdf');

    expect(result.fields?.drawingNumber).toBe('M-301');
    expect(result.fields?.source).toBe('ocr');
  });

  it('returns null fields (never throws) when the AI service call itself fails, while still reporting no page count', async () => {
    const storage = { getReadUrl: jest.fn().mockResolvedValue('https://signed.example/abc.pdf') } as unknown as StorageService;
    const aiClient = { extractDrawingStructure: jest.fn().mockRejectedValue(new Error('ai-service down')) } as unknown as AiClientService;

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'corrupt.pdf');

    expect(result.fields).toBeNull();
    expect(result.pageCount).toBeNull();
  });

  it('reports the AI service\'s own page count even when extraction finds no fields at all', async () => {
    const { storage, aiClient } = makeDeps({ pageCount: 3, regions: [], wholePageNativeText: 'no recognizable title block content' });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'blank.pdf');

    expect(result.fields).toBeNull();
    expect(result.pageCount).toBe(3);
  });
});
