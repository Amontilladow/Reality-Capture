import { Logger } from '@nestjs/common';
import type { ExtractedDrawingFields } from '@engineeringos/types';
import { StorageService } from '../../storage/storage.service';
import { AiClientService } from '../../ai-client/ai-client.service';
import { extractEmbeddedText, hasUsableEmbeddedText } from './pdf-text-extractor';
import { extractTitleBlockFields, extractTitleBlockFieldsFromCells } from './title-block-extractor';
import { buildPseudoTableFromOcrWords } from './ocr-structure';

const logger = new Logger('extractDrawingFields');

// Site Drawing Hub, extraction accuracy Phase 0: before this, there was
// no way to tell WHICH path actually produced a given extraction in
// production (table-cells, the whole-page fallback, OCR, or nothing at
// all) without re-reading the file by hand -- the exact blind spot that
// let the table-cell path silently never fire at all for months (see
// rar-extraction.util.ts's sibling fix, pdf-parse's patched crash). One
// structured log line per file is enough to answer, going forward and
// from real data rather than a guess, how often each path actually runs
// and how confident its results are.
function logExtractionOutcome(label: string, path: 'table-cells' | 'whole-page' | 'ocr' | 'none', fields: ExtractedDrawingFields | null): void {
  logger.log(
    `Extraction for "${label}": path=${path}, confidence=${fields?.confidence ?? 'n/a'}, `
    + `hasDrawingNumber=${Boolean(fields?.drawingNumber)}, hasRevision=${Boolean(fields?.revisionNumber)}, hasTitle=${Boolean(fields?.drawingTitle)}`,
  );
}

export interface DrawingFieldsExtractionResult {
  fields: ExtractedDrawingFields | null;
  // Null only when even getInfo() failed (embedded-text extraction threw
  // before it could report a page count at all) -- effectively "unknown",
  // never read as "single page" by a caller that cares about this (Site
  // Drawing Hub integrity hardening, Phase 6): a PDF with more than one
  // page may hold several independently-numbered sheets, which this
  // pipeline only ever reads page 1 of (see extractEmbeddedText's own
  // comment); callers that skip this field entirely and just read .fields
  // get the exact same behavior as before this existed.
  pageCount: number | null;
}

// Shared by SiteDrawingImportProcessor (a bulk ZIP/PDF import) and
// SiteDrawingsService.extractFields() (a single manual upload via
// "Register a drawing") -- same embedded-text-first, OCR-fallback pipeline
// either way, so a drawing read the same way regardless of which path it
// came in through. A failure anywhere here degrades to a null result
// (manual entry required), never thrown: an extraction failure must not
// block a drawing from being registered.
export async function extractDrawingFields(
  storage: StorageService,
  aiClient: AiClientService,
  companyId: string,
  projectId: string,
  storageKey: string,
  buffer: Buffer,
  label: string,
): Promise<DrawingFieldsExtractionResult> {
  let fields: ExtractedDrawingFields | null = null;
  let hasUsableText = false;
  let pageCount: number | null = null;
  try {
    const { text, tableRows, pageCount: pages } = await extractEmbeddedText(buffer);
    pageCount = pages;
    hasUsableText = hasUsableEmbeddedText(text);
    if (hasUsableText) {
      // Table-cell-scoped extraction first, when the page has a detected
      // table (almost always the title block itself): structurally immune
      // to one field's value landing on a different field, which plain
      // whole-page matching below is not (see PdfTextResult.tableRows's
      // own comment). Only when that finds no plausible drawing number at
      // all -- no table on the page, or the table isn't the title block --
      // does this fall back to the original whole-page regex pass.
      const cellFields = extractTitleBlockFieldsFromCells(tableRows, 'embedded_text');
      fields = cellFields ?? extractTitleBlockFields(text, 'embedded_text');
      logExtractionOutcome(label, cellFields ? 'table-cells' : (fields ? 'whole-page' : 'none'), fields);
    }
  } catch (err) {
    logger.warn(`Embedded-text extraction failed for "${label}": ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!hasUsableText) {
    try {
      const readUrl = await storage.getReadUrl(storageKey, 300);
      const ocrResult = await aiClient.ocrExtractText(companyId, projectId, readUrl, 1);
      // Engineering improvement assignment, Phase 2: same table-cells-first,
      // whole-page-fallback structure as the embedded-text branch above,
      // now that OCR has its own reconstructed cell geometry
      // (ocr-structure.ts, built from Tesseract's own per-word bounding
      // boxes) instead of only ever having flat text to regex against.
      const ocrTableRows = buildPseudoTableFromOcrWords(ocrResult.words ?? []);
      const ocrCellFields = extractTitleBlockFieldsFromCells(ocrTableRows, 'ocr');
      fields = ocrCellFields ?? extractTitleBlockFields(ocrResult.text, 'ocr');
      logExtractionOutcome(label, ocrCellFields ? 'table-cells' : (fields ? 'ocr' : 'none'), fields);
    } catch (err) {
      logger.warn(`OCR fallback failed for "${label}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { fields, pageCount };
}
