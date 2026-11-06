import { Logger } from '@nestjs/common';
import type { ExtractedDrawingFields } from '@engineeringos/types';
import { StorageService } from '../../storage/storage.service';
import { AiClientService } from '../../ai-client/ai-client.service';
import { extractEmbeddedText, hasUsableEmbeddedText } from './pdf-text-extractor';
import { extractTitleBlockFields } from './title-block-extractor';

const logger = new Logger('extractDrawingFields');

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
): Promise<ExtractedDrawingFields | null> {
  let fields: ExtractedDrawingFields | null = null;
  let hasUsableText = false;
  try {
    const { text } = await extractEmbeddedText(buffer);
    hasUsableText = hasUsableEmbeddedText(text);
    if (hasUsableText) fields = extractTitleBlockFields(text, 'embedded_text');
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

  return fields;
}
