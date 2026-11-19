import { Logger } from '@nestjs/common';
import type { ExtractedDrawingFields } from '@engineeringos/types';
import { StorageService } from '../../storage/storage.service';
import { AiClientService } from '../../ai-client/ai-client.service';
import { extractEmbeddedText, hasUsableEmbeddedText } from './pdf-text-extractor';
import { extractTitleBlockFields, extractTitleBlockFieldsFromCells } from './title-block-extractor';

const logger = new Logger('extractDrawingFields');

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
    const { text, tableCells, pageCount: pages } = await extractEmbeddedText(buffer);
    pageCount = pages;
    hasUsableText = hasUsableEmbeddedText(text);
    if (hasUsableText) {
      // Table-cell-scoped extraction first, when the page has a detected
      // table (almost always the title block itself): structurally immune
      // to one field's value landing on a different field, which plain
      // whole-page matching below is not (see PdfTextResult.tableCells's
      // own comment). Only when that finds no plausible drawing number at
      // all -- no table on the page, or the table isn't the title block --
      // does this fall back to the original whole-page regex pass.
      fields = extractTitleBlockFieldsFromCells(tableCells, 'embedded_text') ?? extractTitleBlockFields(text, 'embedded_text');
    }
  } catch (err) {
    logger.warn(`Embedded-text extraction failed for "${label}": ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!hasUsableText) {
    try {
      const readUrl = await storage.getReadUrl(storageKey, 300);
      const ocrResult = await aiClient.ocrExtractText(companyId, projectId, readUrl, 1);
      fields = extractTitleBlockFields(ocrResult.text, 'ocr');
    } catch (err) {
      logger.warn(`OCR fallback failed for "${label}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { fields, pageCount };
}
