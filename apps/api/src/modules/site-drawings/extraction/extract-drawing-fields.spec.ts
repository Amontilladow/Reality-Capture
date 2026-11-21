import type { StorageService } from '../../storage/storage.service';
import type { AiClientService } from '../../ai-client/ai-client.service';
import * as pdfTextExtractor from './pdf-text-extractor';
import { extractDrawingFields } from './extract-drawing-fields';

jest.mock('./pdf-text-extractor');

// Covers the wiring extractDrawingFields itself owns: which path runs
// (table-cells vs whole-page, embedded-text vs OCR) and in what order --
// not title-block-extractor's own regex/matching engine, which has its
// own exhaustive spec already. Fixtures here are deliberately the same
// kind already proven against the real engine in that file and in
// ocr-structure.spec.ts's real captured Tesseract word boxes.
describe('extractDrawingFields', () => {
  function makeDeps(ocrWords: { text: string; left: number; top: number; width: number; height: number; conf: number }[] = []) {
    const storage = { getReadUrl: jest.fn().mockResolvedValue('https://signed.example/abc.pdf') } as unknown as StorageService;
    const aiClient = {
      ocrExtractText: jest.fn().mockResolvedValue({
        text: 'DRAWING NO: M-301\nREV: A',
        confidence: 0.9,
        words: ocrWords,
        pageWidth: 2000,
        pageHeight: 1500,
        rotationDetectedDegrees: 0,
        rotationConfidence: 0,
      }),
    } as unknown as AiClientService;
    return { storage, aiClient };
  }

  afterEach(() => jest.clearAllMocks());

  it('prefers table-cell extraction over whole-page when the embedded-text layer has a detected table', async () => {
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({
      text: 'Drawing No: S-101 Rev: C Drawing Title: GROUND FLOOR PLAN - STRUCTURAL LAYOUT',
      tableRows: [['Drawing No: S-101', 'Rev: C', 'Drawing Title: GROUND FLOOR PLAN - STRUCTURAL LAYOUT']],
      pageCount: 1,
    });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);
    const { storage, aiClient } = makeDeps();

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'S-101.pdf');

    expect(result.fields?.drawingNumber).toBe('S-101');
    expect(result.fields?.revisionNumber).toBe('C');
    expect(result.fields?.source).toBe('embedded_text');
    expect(aiClient.ocrExtractText).not.toHaveBeenCalled();
  });

  it('falls back to whole-page embedded-text matching when the page has no detected table', async () => {
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({
      text: 'DRAWING NO: M-301\nREV: A\nDRAWING TITLE: ROOF PLAN',
      tableRows: [],
      pageCount: 1,
    });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(true);
    const { storage, aiClient } = makeDeps();

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'M-301.pdf');

    expect(result.fields?.drawingNumber).toBe('M-301');
    expect(result.fields?.source).toBe('embedded_text');
    expect(aiClient.ocrExtractText).not.toHaveBeenCalled();
  });

  it('OCR branch: reconstructs cell structure from word boxes and prefers it over whole-page OCR text', async () => {
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', tableRows: [], pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);
    // Two words on one visual row, far enough apart to read as separate
    // cells (same ratio-based column-boundary logic validated in
    // ocr-structure.spec.ts): "Drawing No: S-101" and "Rev: C" must not
    // merge into one run-on cell, and the whole-page text below
    // (deliberately a DIFFERENT drawing number) must not be what wins.
    const { storage, aiClient } = makeDeps([
      { text: 'Drawing', left: 100, top: 100, width: 70, height: 20, conf: 95 },
      { text: 'No:', left: 175, top: 101, width: 30, height: 20, conf: 95 },
      { text: 'S-101', left: 210, top: 100, width: 50, height: 20, conf: 95 },
      { text: 'Rev:', left: 400, top: 101, width: 35, height: 20, conf: 95 },
      { text: 'C', left: 440, top: 100, width: 15, height: 20, conf: 95 },
    ]);

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'S-101.pdf');

    expect(result.fields?.drawingNumber).toBe('S-101');
    expect(result.fields?.revisionNumber).toBe('C');
    expect(result.fields?.source).toBe('ocr');
    expect(aiClient.ocrExtractText).toHaveBeenCalledWith('company-1', 'project-1', 'https://signed.example/abc.pdf', 1);
  });

  it('OCR branch: falls back to whole-page OCR text matching when the word boxes reconstruct no plausible cell table', async () => {
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', tableRows: [], pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);
    // No words at all (e.g. a page OSD/Tesseract found too sparse to box
    // anything usefully): buildPseudoTableFromOcrWords([]) is [], so
    // extractTitleBlockFieldsFromCells must return null and this must
    // fall back to the flat OCR text already mocked in makeDeps().
    const { storage, aiClient } = makeDeps([]);

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'M-301.pdf');

    expect(result.fields?.drawingNumber).toBe('M-301');
    expect(result.fields?.revisionNumber).toBe('A');
    expect(result.fields?.source).toBe('ocr');
  });

  it('tolerates an OCR result with no words field at all (older/partial mock shapes elsewhere), degrading to whole-page text', async () => {
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', tableRows: [], pageCount: 1 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);
    const storage = { getReadUrl: jest.fn().mockResolvedValue('https://signed.example/abc.pdf') } as unknown as StorageService;
    const aiClient = {
      ocrExtractText: jest.fn().mockResolvedValue({ text: 'DRAWING NO: M-301\nREV: A', confidence: 0.9 }),
    } as unknown as AiClientService;

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'M-301.pdf');

    expect(result.fields?.drawingNumber).toBe('M-301');
  });

  it('returns null fields (never throws) when the OCR fallback itself fails, while still reporting the embedded-text page count', async () => {
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockResolvedValue({ text: '', tableRows: [], pageCount: 3 });
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);
    const storage = { getReadUrl: jest.fn().mockResolvedValue('https://signed.example/abc.pdf') } as unknown as StorageService;
    const aiClient = { ocrExtractText: jest.fn().mockRejectedValue(new Error('ai-service down')) } as unknown as AiClientService;

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'corrupt.pdf');

    expect(result.fields).toBeNull();
    expect(result.pageCount).toBe(3);
  });

  it('returns a null pageCount (not a false "1 page") when even embedded-text extraction throws', async () => {
    (pdfTextExtractor.extractEmbeddedText as jest.Mock).mockRejectedValue(new Error('not a valid PDF'));
    (pdfTextExtractor.hasUsableEmbeddedText as jest.Mock).mockReturnValue(false);
    const { storage, aiClient } = makeDeps([]);
    aiClient.ocrExtractText = jest.fn().mockResolvedValue({ text: '', confidence: 0, words: [], pageWidth: 0, pageHeight: 0, rotationDetectedDegrees: 0, rotationConfidence: 0 });

    const result = await extractDrawingFields(storage, aiClient, 'company-1', 'project-1', 'key.pdf', Buffer.from('x'), 'broken.pdf');

    expect(result.pageCount).toBeNull();
    expect(result.fields).toBeNull();
  });
});
